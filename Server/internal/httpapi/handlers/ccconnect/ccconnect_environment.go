package ccconnect

// CC-Connect 环境检测接口用于汇总本机 cc-connect CLI、配置文件、daemon 服务与
// Management API 的可用状态。该接口只返回脱敏后的服务形态和运行摘要，不返回
// config.toml 中的 token、API key、平台凭据或会话内容。

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"agent-box-server/internal/httpapi/toolenv"

	"github.com/BurntSushi/toml"
	"github.com/danielgtaylor/huma/v2"
)

const ccConnectEnvironmentCacheTTL = 10 * time.Second

var ccConnectEnvironmentCache struct {
	sync.Mutex
	expiresAt time.Time
	loaded    bool
	value     CCConnectEnvironmentResponse
}

type CCConnectEnvironmentInput struct {
	Refresh bool `query:"refresh" doc:"Force refresh cached CC-Connect environment data." example:"false"`
}

type CCConnectEnvironmentOutput struct {
	Body CCConnectEnvironmentResponse
}

type CCConnectDaemonActionOutput struct {
	Body CCConnectDaemonActionResponse
}

type CCConnectEnvironmentResponse struct {
	Status     string                  `json:"status" example:"ok" doc:"CC-Connect environment detection status."`
	Timestamp  string                  `json:"timestamp" example:"2026-05-18T10:30:00Z" doc:"UTC response timestamp."`
	Cache      CCConnectCacheInfo      `json:"cache" doc:"Cache behavior used for this response."`
	CLI        CCConnectCLIInfo        `json:"cli" doc:"CC-Connect CLI availability and version information."`
	Home       CCConnectHomeInfo       `json:"home" doc:"CC-Connect data and config locations."`
	Config     CCConnectConfigInfo     `json:"config" doc:"config.toml summary without secrets."`
	Daemon     CCConnectDaemonInfo     `json:"daemon" doc:"cc-connect daemon service status."`
	Runtime    CCConnectRuntimeInfo    `json:"runtime" doc:"Detected cc-connect runtime process and ownership."`
	Management CCConnectManagementInfo `json:"management" doc:"Management API status and summary."`
	Checks     []CCConnectCheck        `json:"checks" doc:"Readiness checks for local CC-Connect management."`
	Summary    string                  `json:"summary" example:"CC-Connect daemon running, Management API reachable." doc:"Human-readable summary."`
}

type CCConnectCacheInfo struct {
	Refresh bool `json:"refresh" example:"false" doc:"Whether refresh=true was requested."`
}

type CCConnectCLIInfo struct {
	Available bool   `json:"available" example:"true" doc:"Whether the cc-connect CLI is available."`
	Path      string `json:"path,omitempty" example:"/opt/homebrew/bin/cc-connect" doc:"Resolved cc-connect executable path."`
	Version   string `json:"version,omitempty" example:"cc-connect v1.3.0" doc:"cc-connect version output first line."`
	Source    string `json:"source,omitempty" example:"homebrew" doc:"Best-effort install source classification."`
	Error     string `json:"error,omitempty" doc:"CLI detection error."`
}

type CCConnectHomeInfo struct {
	Path             string `json:"path" example:"/Users/one/.cc-connect" doc:"CC-Connect data directory."`
	Exists           bool   `json:"exists" example:"true" doc:"Whether data directory exists."`
	ConfigPath       string `json:"configPath" example:"/Users/one/.cc-connect/config.toml" doc:"Resolved config.toml path."`
	ConfigExists     bool   `json:"configExists" example:"true" doc:"Whether config.toml exists."`
	DataDir          string `json:"dataDir" example:"/Users/one/.cc-connect" doc:"Effective data_dir from config or default."`
	DataDirExists    bool   `json:"dataDirExists" example:"true" doc:"Whether effective data_dir exists."`
	LogPath          string `json:"logPath,omitempty" example:"/Users/one/.cc-connect/logs/cc-connect.log" doc:"Daemon log path from metadata or default."`
	LogExists        bool   `json:"logExists" example:"true" doc:"Whether daemon log exists."`
	LogBytes         int64  `json:"logBytes,omitempty" example:"1024" doc:"Daemon log size in bytes."`
	DaemonMetaPath   string `json:"daemonMetaPath" example:"/Users/one/.cc-connect/daemon.json" doc:"cc-connect daemon metadata path."`
	DaemonMetaExists bool   `json:"daemonMetaExists" example:"true" doc:"Whether daemon metadata exists."`
}

type CCConnectConfigInfo struct {
	Path              string                         `json:"path" example:"/Users/one/.cc-connect/config.toml" doc:"Resolved config.toml path."`
	Exists            bool                           `json:"exists" example:"true" doc:"Whether config.toml exists."`
	Readable          bool                           `json:"readable" example:"true" doc:"Whether config.toml can be read."`
	Parsed            bool                           `json:"parsed" example:"true" doc:"Whether config.toml could be parsed."`
	Error             string                         `json:"error,omitempty" doc:"Config read or parse error when any."`
	DataDir           string                         `json:"dataDir,omitempty" doc:"data_dir value after defaults."`
	Language          string                         `json:"language,omitempty" example:"zh" doc:"Configured UI/runtime language."`
	LogLevel          string                         `json:"logLevel,omitempty" example:"info" doc:"Configured log level."`
	ProjectCount      int                            `json:"projectCount" example:"2" doc:"Configured project count."`
	Projects          []CCConnectProjectConfigInfo   `json:"projects,omitempty" doc:"Configured projects without secrets."`
	Management        CCConnectManagementConfigShape `json:"management" doc:"Management API config summary."`
	Bridge            CCConnectBridgeConfigShape     `json:"bridge" doc:"Bridge config summary."`
	ProviderCount     int                            `json:"providerCount" example:"3" doc:"Global provider count."`
	CommandCount      int                            `json:"commandCount" example:"1" doc:"Custom slash command count."`
	HookCount         int                            `json:"hookCount" example:"0" doc:"Lifecycle hook count."`
	BannedWordCount   int                            `json:"bannedWordCount" example:"0" doc:"Banned word count."`
	ConfigSourceLabel string                         `json:"configSourceLabel,omitempty" example:"home" doc:"Best-effort config source label."`
}

type CCConnectProjectConfigInfo struct {
	Name          string   `json:"name" example:"my-project" doc:"Project name."`
	AgentType     string   `json:"agentType" example:"codex" doc:"Project agent type."`
	WorkDir       string   `json:"workDir,omitempty" doc:"Agent work_dir option when configured."`
	Mode          string   `json:"mode,omitempty" doc:"Project mode, for example multi-workspace."`
	PlatformTypes []string `json:"platformTypes" doc:"Messaging platform types configured for this project."`
	ProviderRefs  []string `json:"providerRefs,omitempty" doc:"Global provider refs configured for this project."`
}

type CCConnectManagementConfigShape struct {
	Enabled  bool   `json:"enabled" example:"true" doc:"Whether management.enabled is true."`
	Port     int    `json:"port" example:"9820" doc:"Management API port after defaults."`
	URL      string `json:"url,omitempty" example:"http://127.0.0.1:9820" doc:"Local Management API base URL."`
	TokenSet bool   `json:"tokenSet" example:"true" doc:"Whether management.token is set."`
}

type CCConnectBridgeConfigShape struct {
	Enabled  bool   `json:"enabled" example:"true" doc:"Whether bridge.enabled is true."`
	Port     int    `json:"port" example:"9810" doc:"Bridge port after defaults."`
	Path     string `json:"path,omitempty" example:"/bridge/ws" doc:"Bridge WebSocket path after defaults."`
	TokenSet bool   `json:"tokenSet" example:"true" doc:"Whether bridge.token is set."`
}

type CCConnectDaemonInfo struct {
	Installed bool   `json:"installed" example:"true" doc:"Whether cc-connect daemon is installed."`
	Running   bool   `json:"running" example:"true" doc:"Whether cc-connect daemon is running."`
	PID       int    `json:"pid,omitempty" example:"12345" doc:"Daemon process PID when reported."`
	Platform  string `json:"platform,omitempty" example:"launchd" doc:"Daemon manager platform."`
	LogPath   string `json:"logPath,omitempty" doc:"Daemon log path from status or metadata."`
	WorkDir   string `json:"workDir,omitempty" doc:"Daemon work directory from status or metadata."`
	Raw       string `json:"raw,omitempty" doc:"Raw daemon status output."`
	Error     string `json:"error,omitempty" doc:"Daemon status command error when any."`
}

type CCConnectRuntimeInfo struct {
	Running  bool   `json:"running" example:"true" doc:"Whether a cc-connect runtime process is reachable."`
	Managed  bool   `json:"managed" example:"true" doc:"Whether the runtime process was started by AgentBox."`
	Mode     string `json:"mode" example:"agent-box" doc:"Runtime owner: agent-box, daemon, external, or stopped."`
	Label    string `json:"label" example:"运行中" doc:"Human-readable runtime ownership label."`
	PID      int    `json:"pid,omitempty" example:"12345" doc:"Detected runtime process PID."`
	RSSBytes int64  `json:"rssBytes,omitempty" example:"67108864" doc:"Resident memory size in bytes when detectable."`
	LogPath  string `json:"logPath,omitempty" doc:"AgentBox-managed runtime log path when known."`
}

type CCConnectManagementInfo struct {
	Enabled            bool                     `json:"enabled" example:"true" doc:"Whether Management API is enabled in config."`
	Reachable          bool                     `json:"reachable" example:"true" doc:"Whether /api/v1/status responded successfully."`
	URL                string                   `json:"url,omitempty" example:"http://127.0.0.1:9820" doc:"Local Management API base URL."`
	Version            string                   `json:"version,omitempty" example:"v1.3.0" doc:"cc-connect runtime version from status API."`
	UptimeSeconds      int                      `json:"uptimeSeconds,omitempty" example:"3600" doc:"cc-connect process uptime from status API."`
	ConnectedPlatforms []string                 `json:"connectedPlatforms,omitempty" doc:"Connected platform names from status API."`
	ProjectsCount      int                      `json:"projectsCount,omitempty" example:"2" doc:"Running project count from status API."`
	BridgeAdapters     []CCConnectBridgeAdapter `json:"bridgeAdapters,omitempty" doc:"Connected bridge adapters from status API."`
	Error              string                   `json:"error,omitempty" doc:"Management API request error when any."`
}

type CCConnectBridgeAdapter struct {
	Platform     string   `json:"platform,omitempty"`
	Project      string   `json:"project,omitempty"`
	Capabilities []string `json:"capabilities,omitempty"`
}

type CCConnectCheck struct {
	Name       string `json:"name" example:"cli" doc:"Check name."`
	OK         bool   `json:"ok" example:"true" doc:"Whether the check passed."`
	Message    string `json:"message" example:"CC-Connect CLI available." doc:"Check result message."`
	DurationMs int64  `json:"durationMs" example:"5" doc:"Check duration in milliseconds."`
}

type CCConnectDaemonActionResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-18T10:30:00Z" doc:"UTC response timestamp."`
	Action    string `json:"action" example:"install" doc:"Daemon action requested."`
	Message   string `json:"message" example:"cc-connect daemon install finished." doc:"Human-readable result."`
	PID       int    `json:"pid,omitempty" example:"12345" doc:"Started or stopped process PID when available."`
	LogPath   string `json:"logPath,omitempty" doc:"AgentBox-managed cc-connect log path."`
	Stdout    string `json:"stdout,omitempty" doc:"Command stdout."`
	Stderr    string `json:"stderr,omitempty" doc:"Command stderr."`
}

var ccConnectManagedRuntime struct {
	sync.Mutex
	cmd       *exec.Cmd
	pid       int
	logPath   string
	startedAt time.Time
	exited    bool
	waitErr   error
}

type ccConnectConfigFile struct {
	DataDir   string `toml:"data_dir"`
	Language  string `toml:"language"`
	Providers []struct {
		Name string `toml:"name"`
	} `toml:"providers"`
	Projects []struct {
		Name    string `toml:"name"`
		Mode    string `toml:"mode"`
		BaseDir string `toml:"base_dir"`
		Agent   struct {
			Type         string         `toml:"type"`
			Options      map[string]any `toml:"options"`
			ProviderRefs []string       `toml:"provider_refs"`
		} `toml:"agent"`
		Platforms []struct {
			Type string `toml:"type"`
		} `toml:"platforms"`
	} `toml:"projects"`
	Commands []struct {
		Name string `toml:"name"`
	} `toml:"commands"`
	BannedWords []string `toml:"banned_words"`
	Log         struct {
		Level string `toml:"level"`
	} `toml:"log"`
	Bridge struct {
		Enabled *bool  `toml:"enabled"`
		Port    int    `toml:"port"`
		Token   string `toml:"token"`
		Path    string `toml:"path"`
	} `toml:"bridge"`
	Management struct {
		Enabled *bool  `toml:"enabled"`
		Port    int    `toml:"port"`
		Token   string `toml:"token"`
	} `toml:"management"`
	Hooks []struct {
		Event string `toml:"event"`
	} `toml:"hooks"`
}

type ccConnectDaemonMeta struct {
	LogFile     string `json:"log_file"`
	WorkDir     string `json:"work_dir"`
	BinaryPath  string `json:"binary_path"`
	InstalledAt string `json:"installed_at"`
}

func CCConnectEnvironment(ctx context.Context, input *CCConnectEnvironmentInput) (*CCConnectEnvironmentOutput, error) {
	if input == nil {
		input = &CCConnectEnvironmentInput{}
	}

	body := cachedCCConnectEnvironment(input.Refresh, func() CCConnectEnvironmentResponse {
		return detectCCConnectEnvironment(ctx)
	})
	body.Timestamp = time.Now().UTC().Format(time.RFC3339)
	body.Cache = CCConnectCacheInfo{Refresh: input.Refresh}

	return &CCConnectEnvironmentOutput{Body: body}, nil
}

func StartCCConnectDaemon(ctx context.Context, input *struct{}) (*CCConnectDaemonActionOutput, error) {
	return runCCConnectRuntimeAction(ctx, "start")
}

func InstallCCConnectDaemon(ctx context.Context, input *struct{}) (*CCConnectDaemonActionOutput, error) {
	return runCCConnectRuntimeAction(ctx, "install")
}

func StopCCConnectDaemon(ctx context.Context, input *struct{}) (*CCConnectDaemonActionOutput, error) {
	return runCCConnectRuntimeAction(ctx, "stop")
}

func RestartCCConnectDaemon(ctx context.Context, input *struct{}) (*CCConnectDaemonActionOutput, error) {
	return runCCConnectRuntimeAction(ctx, "restart")
}

func cachedCCConnectEnvironment(refresh bool, load func() CCConnectEnvironmentResponse) CCConnectEnvironmentResponse {
	now := time.Now()
	ccConnectEnvironmentCache.Lock()
	defer ccConnectEnvironmentCache.Unlock()

	if ccConnectEnvironmentCache.loaded && !refresh && now.Before(ccConnectEnvironmentCache.expiresAt) {
		return ccConnectEnvironmentCache.value
	}

	ccConnectEnvironmentCache.value = load()
	ccConnectEnvironmentCache.loaded = true
	ccConnectEnvironmentCache.expiresAt = now.Add(ccConnectEnvironmentCacheTTL)
	return ccConnectEnvironmentCache.value
}

func invalidateCCConnectEnvironmentCache() {
	ccConnectEnvironmentCache.Lock()
	defer ccConnectEnvironmentCache.Unlock()
	ccConnectEnvironmentCache.loaded = false
	ccConnectEnvironmentCache.value = CCConnectEnvironmentResponse{}
	ccConnectEnvironmentCache.expiresAt = time.Time{}
}

func detectCCConnectEnvironment(ctx context.Context) CCConnectEnvironmentResponse {
	cli, cliCheck := detectCCConnectCLI(ctx)
	config, configCheck, parsed := detectCCConnectConfig()
	home := detectCCConnectHome(config, parsed)
	daemon, daemonCheck := detectCCConnectDaemon(ctx, cli, home)
	management, managementCheck := detectCCConnectManagement(ctx, config, parsed)
	runtime := detectCCConnectRuntime(ctx, config, daemon, management)
	daemonCheck = normalizeCCConnectDaemonCheck(daemonCheck, daemon, runtime)
	checks := []CCConnectCheck{cliCheck, configCheck, daemonCheck, managementCheck}

	return CCConnectEnvironmentResponse{
		Status:     "ok",
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		CLI:        cli,
		Home:       home,
		Config:     config,
		Daemon:     daemon,
		Runtime:    runtime,
		Management: management,
		Checks:     checks,
		Summary:    summarizeCCConnectEnvironment(cli, config, daemon, runtime, management),
	}
}

func detectCCConnectCLI(ctx context.Context) (CCConnectCLIInfo, CCConnectCheck) {
	started := time.Now()
	info := CCConnectCLIInfo{}
	path := resolveCCConnectCLIPath(ctx)
	if path == "" {
		info.Error = "cc-connect CLI not found"
		return info, ccConnectCheck("cli", false, "未检测到 cc-connect CLI。", started)
	}

	info.Available = true
	info.Path = path
	info.Source = classifyCCConnectCLISource(path)

	stdout, stderr, err := runCCConnectCommand(ctx, path, 4*time.Second, "--version")
	if err != nil {
		info.Error = strings.TrimSpace(strings.Join([]string{stderr, err.Error()}, "\n"))
		return info, ccConnectCheck("cli", true, "已检测到 cc-connect CLI，但版本读取失败。", started)
	}
	info.Version = firstNonEmptyLine(stdout, stderr)
	return info, ccConnectCheck("cli", true, "CC-Connect CLI 可用。", started)
}

func detectCCConnectConfig() (CCConnectConfigInfo, CCConnectCheck, *ccConnectConfigFile) {
	started := time.Now()
	path, label := resolveCCConnectConfigPath()
	info := CCConnectConfigInfo{
		Path:              path,
		ConfigSourceLabel: label,
	}
	if path == "" {
		info.Error = "cannot resolve config path"
		return info, ccConnectCheck("config", false, "无法解析 config.toml 路径。", started), nil
	}

	stat, err := os.Stat(path)
	if err != nil {
		info.Exists = false
		info.Error = err.Error()
		return info, ccConnectCheck("config", false, "config.toml 不存在。", started), nil
	}
	info.Exists = !stat.IsDir()
	if !info.Exists {
		info.Error = "config path is a directory"
		return info, ccConnectCheck("config", false, "config.toml 路径指向目录。", started), nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		info.Readable = false
		info.Error = err.Error()
		return info, ccConnectCheck("config", false, "config.toml 无法读取。", started), nil
	}
	info.Readable = true

	var cfg ccConnectConfigFile
	if err := toml.Unmarshal(data, &cfg); err != nil {
		info.Error = err.Error()
		return info, ccConnectCheck("config", false, "config.toml 解析失败。", started), nil
	}

	info.Parsed = true
	info.DataDir = effectiveCCConnectDataDir(cfg.DataDir)
	info.Language = cfg.Language
	info.LogLevel = cfg.Log.Level
	info.ProjectCount = len(cfg.Projects)
	info.ProviderCount = len(cfg.Providers)
	info.CommandCount = len(cfg.Commands)
	info.HookCount = len(cfg.Hooks)
	info.BannedWordCount = len(cfg.BannedWords)
	info.Management = ccConnectManagementConfigShape(cfg)
	info.Bridge = ccConnectBridgeConfigShape(cfg)
	info.Projects = make([]CCConnectProjectConfigInfo, 0, len(cfg.Projects))
	for _, project := range cfg.Projects {
		platforms := make([]string, 0, len(project.Platforms))
		for _, platform := range project.Platforms {
			if strings.TrimSpace(platform.Type) != "" {
				platforms = append(platforms, platform.Type)
			}
		}
		sort.Strings(platforms)
		info.Projects = append(info.Projects, CCConnectProjectConfigInfo{
			Name:          project.Name,
			AgentType:     project.Agent.Type,
			WorkDir:       stringOption(project.Agent.Options, "work_dir"),
			Mode:          project.Mode,
			PlatformTypes: platforms,
			ProviderRefs:  append([]string(nil), project.Agent.ProviderRefs...),
		})
	}
	sort.Slice(info.Projects, func(i, j int) bool { return info.Projects[i].Name < info.Projects[j].Name })

	return info, ccConnectCheck("config", true, "config.toml 可读取并已解析。", started), &cfg
}

func detectCCConnectHome(config CCConnectConfigInfo, parsed *ccConnectConfigFile) CCConnectHomeInfo {
	configPath := config.Path
	if configPath == "" {
		configPath, _ = resolveCCConnectConfigPath()
	}

	defaultDir := defaultCCConnectDataDir()
	dataDir := defaultDir
	if parsed != nil {
		dataDir = effectiveCCConnectDataDir(parsed.DataDir)
	}

	metaPath := filepath.Join(defaultDir, "daemon.json")
	meta := readCCConnectDaemonMeta(metaPath)
	logPath := ccConnectPreferredHomeLogPath(dataDir)
	if meta != nil && strings.TrimSpace(meta.LogFile) != "" {
		logPath = meta.LogFile
	}
	logStat, logErr := os.Stat(logPath)

	return CCConnectHomeInfo{
		Path:             defaultDir,
		Exists:           pathIsDir(defaultDir),
		ConfigPath:       configPath,
		ConfigExists:     pathIsFile(configPath),
		DataDir:          dataDir,
		DataDirExists:    pathIsDir(dataDir),
		LogPath:          logPath,
		LogExists:        logErr == nil && !logStat.IsDir(),
		LogBytes:         fileSize(logStat, logErr),
		DaemonMetaPath:   metaPath,
		DaemonMetaExists: pathIsFile(metaPath),
	}
}

func detectCCConnectDaemon(ctx context.Context, cli CCConnectCLIInfo, home CCConnectHomeInfo) (CCConnectDaemonInfo, CCConnectCheck) {
	started := time.Now()
	info := CCConnectDaemonInfo{}
	if cli.Path == "" {
		info.Error = "cc-connect CLI not found"
		return info, ccConnectCheck("daemon", false, "无法检测 daemon：cc-connect CLI 不可用。", started)
	}

	stdout, stderr, err := runCCConnectCommand(ctx, cli.Path, 5*time.Second, "daemon", "status")
	raw := strings.TrimSpace(strings.Join([]string{stdout, stderr}, "\n"))
	info.Raw = raw
	parseCCConnectDaemonStatus(raw, &info)
	if info.LogPath == "" {
		info.LogPath = home.LogPath
	}
	if err != nil {
		info.Error = strings.TrimSpace(strings.Join([]string{stderr, err.Error()}, "\n"))
		return info, ccConnectCheck("daemon", false, "daemon 状态命令执行失败。", started)
	}
	if info.Running {
		return info, ccConnectCheck("daemon", true, "cc-connect daemon 正在运行。", started)
	}
	if info.Installed {
		return info, ccConnectCheck("daemon", false, "cc-connect daemon 已安装但未运行。", started)
	}
	return info, ccConnectCheck("daemon", false, "cc-connect daemon 未安装。", started)
}

func normalizeCCConnectDaemonCheck(check CCConnectCheck, daemon CCConnectDaemonInfo, runtime CCConnectRuntimeInfo) CCConnectCheck {
	if runtime.Managed && runtime.Running {
		check.OK = true
		if daemon.Running {
			check.Message = "cc-connect daemon 正在运行。"
			return check
		}
		if daemon.Installed {
			check.Message = "AgentBox 托管运行中，daemon 未运行不影响当前服务。"
			return check
		}
		check.Message = "AgentBox 托管运行中，未安装 daemon 不影响当前服务。"
	}
	return check
}

func detectCCConnectManagement(ctx context.Context, config CCConnectConfigInfo, parsed *ccConnectConfigFile) (CCConnectManagementInfo, CCConnectCheck) {
	started := time.Now()
	info := CCConnectManagementInfo{
		Enabled: config.Management.Enabled,
		URL:     config.Management.URL,
	}
	if parsed == nil {
		info.Error = "config not parsed"
		return info, ccConnectCheck("management", false, "Management API 未检测：配置未解析。", started)
	}
	if !info.Enabled {
		return info, ccConnectCheck("management", false, "Management API 未启用。", started)
	}
	if !config.Management.TokenSet {
		info.Error = "management token is empty"
		return info, ccConnectCheck("management", false, "Management API 缺少 token。", started)
	}

	status, err := requestCCConnectManagementStatus(ctx, config.Management.URL, parsed.Management.Token)
	if err != nil {
		info.Error = err.Error()
		return info, ccConnectCheck("management", false, "Management API 不可达。", started)
	}

	info.Reachable = true
	info.Version = status.Version
	info.UptimeSeconds = status.UptimeSeconds
	info.ConnectedPlatforms = status.ConnectedPlatforms
	info.ProjectsCount = status.ProjectsCount
	info.BridgeAdapters = status.BridgeAdapters
	return info, ccConnectCheck("management", true, "Management API 可访问。", started)
}

func detectCCConnectRuntime(ctx context.Context, config CCConnectConfigInfo, daemon CCConnectDaemonInfo, management CCConnectManagementInfo) CCConnectRuntimeInfo {
	info := CCConnectRuntimeInfo{
		Mode:  "stopped",
		Label: "未运行",
	}

	port := config.Management.Port
	if port == 0 {
		port = 9820
	}
	listenPID := 0
	if management.Reachable {
		listenPID = detectTCPListenPID(ctx, port)
	}

	managedPID, managedLogPath := managedCCConnectRuntimeSnapshot()
	if managedPID > 0 && (listenPID == managedPID || (listenPID == 0 && management.Reachable)) {
		return CCConnectRuntimeInfo{
			Running:  true,
			Managed:  true,
			Mode:     "agent-box",
			Label:    "运行中",
			PID:      managedPID,
			RSSBytes: detectProcessRSSBytes(ctx, managedPID),
			LogPath:  managedLogPath,
		}
	}

	if daemon.Running {
		pid := daemon.PID
		if pid == 0 {
			pid = listenPID
		}
		return CCConnectRuntimeInfo{
			Running:  true,
			Managed:  false,
			Mode:     "daemon",
			Label:    "运行中",
			PID:      pid,
			RSSBytes: detectProcessRSSBytes(ctx, pid),
			LogPath:  daemon.LogPath,
		}
	}

	if management.Reachable {
		return CCConnectRuntimeInfo{
			Running:  true,
			Managed:  false,
			Mode:     "external",
			Label:    "运行中",
			PID:      listenPID,
			RSSBytes: detectProcessRSSBytes(ctx, listenPID),
		}
	}

	return info
}

func runCCConnectDaemonAction(ctx context.Context, action string) (*CCConnectDaemonActionOutput, error) {
	if action != "install" && action != "start" && action != "stop" && action != "restart" {
		return nil, fmt.Errorf("unsupported cc-connect daemon action: %s", action)
	}
	path := resolveCCConnectCLIPath(ctx)
	if path == "" {
		return nil, huma.Error409Conflict("未检测到 cc-connect CLI，无法管理 daemon。")
	}

	args, err := ccConnectDaemonActionArgs(action)
	if err != nil {
		return nil, err
	}

	stdout, stderr, err := runCCConnectCommand(ctx, path, 30*time.Second, args...)
	if err != nil {
		return nil, ccConnectDaemonCommandError(action, stdout, stderr, err)
	}
	invalidateCCConnectEnvironmentCache()
	return &CCConnectDaemonActionOutput{Body: CCConnectDaemonActionResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Action:    action,
		Message:   "cc-connect daemon " + action + " finished.",
		Stdout:    strings.TrimSpace(stdout),
		Stderr:    strings.TrimSpace(stderr),
	}}, nil
}

func resolveCCConnectCLIPath(ctx context.Context) string {
	if path := toolenv.ResolveToolPath("cc-connect"); path != "" {
		return path
	}
	prefix := ccConnectNPMPrefix(ctx)
	if prefix == "" {
		return ""
	}
	candidates := []string{
		filepath.Join(prefix, "bin", "cc-connect"),
		filepath.Join(prefix, "lib", "node_modules", "cc-connect", "run.js"),
	}
	for _, candidate := range candidates {
		if toolenv.IsExecutablePath(candidate) || pathExists(candidate) {
			return candidate
		}
	}
	return ""
}

func ccConnectNPMPrefix(ctx context.Context) string {
	npmPath := toolenv.ResolveToolPath("npm")
	if npmPath == "" {
		return ""
	}
	stdout, _, err := runCCConnectCommand(ctx, npmPath, 5*time.Second, "prefix", "-g")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(firstNonEmptyLine(stdout))
}

func runCCConnectRuntimeAction(ctx context.Context, action string) (*CCConnectDaemonActionOutput, error) {
	if action != "install" && action != "start" && action != "stop" && action != "restart" {
		return nil, fmt.Errorf("unsupported cc-connect runtime action: %s", action)
	}
	if action == "stop" {
		return stopManagedCCConnectRuntime(ctx, action)
	}
	return startManagedCCConnectRuntime(ctx, action)
}

func startManagedCCConnectRuntime(ctx context.Context, action string) (*CCConnectDaemonActionOutput, error) {
	path := resolveCCConnectCLIPath(ctx)
	if path == "" {
		return nil, huma.Error409Conflict("未检测到 cc-connect CLI，无法启动 CC-Connect。")
	}

	config, _, parsed := detectCCConnectConfig()
	if !config.Exists {
		return nil, huma.Error409Conflict("未找到 CC-Connect config.toml，无法启动。")
	}
	if !config.Parsed || parsed == nil {
		return nil, huma.Error409Conflict("CC-Connect config.toml 解析失败，无法启动。", errors.New(config.Error))
	}
	if len(parsed.Projects) == 0 {
		return nil, huma.Error409Conflict("CC-Connect config.toml 缺少 [[projects]] 项目，无法启动。请先在项目管理中创建项目。")
	}
	if !config.Management.Enabled {
		return nil, huma.Error409Conflict("CC-Connect Management API 未启用，无法由 AgentBox 接管运行。")
	}
	if !config.Management.TokenSet {
		return nil, huma.Error409Conflict("CC-Connect Management API token 未设置，无法由 AgentBox 接管运行。")
	}

	runtimePath := resolveCCConnectRuntimeExecutable(path)
	logPath := ccConnectManagedLogPath(config, parsed)
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return nil, huma.Error500InternalServerError("create cc-connect runtime log directory failed", err)
	}

	var lastDetail string
	for attempt := 1; attempt <= 3; attempt++ {
		logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
		if err != nil {
			return nil, huma.Error500InternalServerError("open cc-connect runtime log failed", err)
		}

		cmd := exec.Command(runtimePath, "--config", config.Path, "--force")
		cmd.Dir = filepath.Dir(config.Path)
		cmd.Env = ccConnectRuntimeEnv()
		cmd.Stdout = logFile
		cmd.Stderr = logFile
		if err := cmd.Start(); err != nil {
			_ = logFile.Close()
			return nil, huma.Error500InternalServerError("start cc-connect runtime failed", err)
		}

		pid := cmd.Process.Pid
		ccConnectManagedRuntime.Lock()
		ccConnectManagedRuntime.cmd = cmd
		ccConnectManagedRuntime.pid = pid
		ccConnectManagedRuntime.logPath = logPath
		ccConnectManagedRuntime.startedAt = time.Now()
		ccConnectManagedRuntime.exited = false
		ccConnectManagedRuntime.waitErr = nil
		ccConnectManagedRuntime.Unlock()

		go func(process *exec.Cmd, processPID int, file *os.File) {
			err := process.Wait()
			_ = file.Close()

			ccConnectManagedRuntime.Lock()
			if ccConnectManagedRuntime.pid == processPID {
				ccConnectManagedRuntime.exited = true
				ccConnectManagedRuntime.waitErr = err
				ccConnectManagedRuntime.cmd = nil
			}
			ccConnectManagedRuntime.Unlock()
		}(cmd, pid, logFile)

		if waitCCConnectManagementReady(ctx, config.Management.URL, parsed.Management.Token, pid, 20*time.Second) {
			invalidateCCConnectEnvironmentCache()
			return &CCConnectDaemonActionOutput{Body: CCConnectDaemonActionResponse{
				Status:    "ok",
				Timestamp: time.Now().UTC().Format(time.RFC3339),
				Action:    action,
				Message:   "cc-connect runtime started by AgentBox.",
				PID:       pid,
				LogPath:   logPath,
			}}, nil
		}

		lastDetail = strings.TrimSpace(tailFile(logPath, 8192))
		if ccConnectRuntimeLooksStarted(ctx, config, pid, lastDetail) {
			invalidateCCConnectEnvironmentCache()
			return &CCConnectDaemonActionOutput{Body: CCConnectDaemonActionResponse{
				Status:    "ok",
				Timestamp: time.Now().UTC().Format(time.RFC3339),
				Action:    action,
				Message:   "cc-connect runtime started by AgentBox; Management API readiness was not confirmed before timeout.",
				PID:       pid,
				LogPath:   logPath,
			}}, nil
		}
		if lastDetail == "" {
			lastDetail = "cc-connect runtime did not become ready before timeout"
		}
		if !ccConnectCanRetryTakeover(lastDetail) || attempt == 3 {
			break
		}
		time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
	}

	return nil, huma.Error500InternalServerError("cc-connect runtime start timed out", errors.New(ccConnectRuntimeStartFailureDetail(path, runtimePath, config.Path, logPath, lastDetail)))
}

func stopManagedCCConnectRuntime(ctx context.Context, action string) (*CCConnectDaemonActionOutput, error) {
	config, _, _ := detectCCConnectConfig()
	port := config.Management.Port
	if port == 0 {
		port = 9820
	}

	pid := managedCCConnectRuntimePID()
	if pid <= 0 {
		pid = detectTCPListenPID(ctx, port)
	}
	if pid <= 0 {
		invalidateCCConnectEnvironmentCache()
		return &CCConnectDaemonActionOutput{Body: CCConnectDaemonActionResponse{
			Status:    "ok",
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Action:    action,
			Message:   "cc-connect runtime is not running.",
		}}, nil
	}

	if err := stopProcessByPID(ctx, pid, port); err != nil {
		return nil, huma.Error500InternalServerError("stop cc-connect runtime failed", err)
	}
	invalidateCCConnectEnvironmentCache()
	return &CCConnectDaemonActionOutput{Body: CCConnectDaemonActionResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Action:    action,
		Message:   "cc-connect runtime stopped.",
		PID:       pid,
	}}, nil
}

func ccConnectDaemonActionArgs(action string) ([]string, error) {
	if action != "install" {
		return []string{"daemon", action}, nil
	}

	configPath, _ := resolveCCConnectConfigPath()
	if !pathIsFile(configPath) {
		return nil, huma.Error409Conflict("未找到 CC-Connect config.toml，无法安装 daemon。")
	}
	return []string{"daemon", "install", "--config", configPath}, nil
}

func ccConnectDaemonCommandError(action string, stdout string, stderr string, err error) error {
	detail := strings.TrimSpace(strings.Join([]string{stderr, stdout, err.Error()}, "\n"))
	if detail == "" {
		detail = "cc-connect daemon " + action + " failed"
	}

	lower := strings.ToLower(detail)
	switch {
	case strings.Contains(lower, "service is not installed"):
		return huma.Error409Conflict("CC-Connect daemon 尚未安装，请先安装并启动。", errors.New(detail))
	case strings.Contains(lower, "service already installed"):
		return huma.Error409Conflict("CC-Connect daemon 已安装。", errors.New(detail))
	default:
		return huma.Error500InternalServerError("CC-Connect daemon "+action+" 执行失败。", errors.New(detail))
	}
}

func runCCConnectCommand(ctx context.Context, path string, timeout time.Duration, args ...string) (string, string, error) {
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, path, args...)
	cmd.Env = toolenv.CommandEnv()
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if cmdCtx.Err() == context.DeadlineExceeded {
		err = fmt.Errorf("command timed out after %s", timeout)
	}
	return stdout.String(), stderr.String(), err
}

func resolveCCConnectRuntimeExecutable(path string) string {
	resolved := path
	if realPath, err := filepath.EvalSymlinks(path); err == nil && realPath != "" {
		resolved = realPath
	}

	executableName := "cc-connect"
	candidates := []string{
		filepath.Join(filepath.Dir(resolved), "bin", executableName),
		filepath.Join(filepath.Dir(filepath.Dir(resolved)), "bin", executableName),
	}
	for _, candidate := range candidates {
		if toolenv.IsExecutablePath(candidate) {
			return candidate
		}
	}
	return path
}

func ccConnectManagedLogPath(config CCConnectConfigInfo, parsed *ccConnectConfigFile) string {
	dataDir := defaultCCConnectDataDir()
	if parsed != nil {
		dataDir = effectiveCCConnectDataDir(parsed.DataDir)
	} else if strings.TrimSpace(config.DataDir) != "" {
		dataDir = effectiveCCConnectDataDir(config.DataDir)
	}
	return filepath.Join(dataDir, "logs", ccConnectRuntimeLogFile)
}

func ccConnectPreferredHomeLogPath(dataDir string) string {
	mainLogPath := filepath.Join(dataDir, "logs", ccConnectMainLogFile)
	if pathIsFile(mainLogPath) {
		return mainLogPath
	}
	runtimeLogPath := filepath.Join(dataDir, "logs", ccConnectRuntimeLogFile)
	if pathIsFile(runtimeLogPath) {
		return runtimeLogPath
	}
	return mainLogPath
}

func ccConnectRuntimeEnv() []string {
	env := toolenv.CommandEnv()
	filtered := make([]string, 0, len(env)+1)
	for _, item := range env {
		if strings.HasPrefix(item, "CLAUDECODE=") {
			continue
		}
		filtered = append(filtered, item)
	}
	return append(filtered, "CC_CONNECT_MANAGED_BY=AgentBox")
}

func waitCCConnectManagementReady(ctx context.Context, baseURL string, token string, pid int, timeout time.Duration) bool {
	if timeout <= 0 {
		timeout = 8 * time.Second
	}
	deadline := time.Now().Add(timeout)
	time.Sleep(300 * time.Millisecond)
	for time.Now().Before(deadline) {
		if strings.TrimSpace(baseURL) != "" && strings.TrimSpace(token) != "" {
			if _, err := requestCCConnectManagementStatus(ctx, baseURL, token); err == nil {
				return true
			}
		}
		if managedCCConnectRuntimeExited(pid) {
			return false
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(300 * time.Millisecond):
		}
	}
	return false
}

func ccConnectRuntimeLooksStarted(ctx context.Context, config CCConnectConfigInfo, pid int, detail string) bool {
	lowerDetail := strings.ToLower(detail)
	if strings.Contains(lowerDetail, "cc-connect is running") ||
		strings.Contains(lowerDetail, "management api started") ||
		strings.Contains(lowerDetail, "api server started") ||
		strings.Contains(lowerDetail, "server started") ||
		strings.Contains(lowerDetail, "listening") {
		return true
	}

	port := config.Management.Port
	if port == 0 {
		port = 9820
	}
	return detectTCPListenPID(ctx, port) > 0
}

func ccConnectRuntimeStartFailureDetail(cliPath string, runtimePath string, configPath string, logPath string, detail string) string {
	parts := []string{
		"cc-connect runtime did not become ready before timeout",
	}
	if strings.TrimSpace(cliPath) != "" {
		parts = append(parts, "cli: "+cliPath)
	}
	if strings.TrimSpace(runtimePath) != "" && runtimePath != cliPath {
		parts = append(parts, "runtime: "+runtimePath)
	}
	if strings.TrimSpace(configPath) != "" {
		parts = append(parts, "config: "+configPath)
	}
	if strings.TrimSpace(logPath) != "" {
		parts = append(parts, "log: "+logPath)
	}
	if strings.TrimSpace(detail) != "" {
		parts = append(parts, "log tail:\n"+strings.TrimSpace(detail))
	}
	return strings.Join(parts, "\n")
}

func ccConnectCanRetryTakeover(detail string) bool {
	lower := strings.ToLower(detail)
	return strings.Contains(lower, "another cc-connect instance is already running") ||
		strings.Contains(lower, "use --force to kill the existing instance") ||
		strings.Contains(lower, "killed existing instance via --force")
}

func managedCCConnectRuntimePID() int {
	ccConnectManagedRuntime.Lock()
	defer ccConnectManagedRuntime.Unlock()
	if ccConnectManagedRuntime.pid <= 0 || ccConnectManagedRuntime.exited {
		return 0
	}
	return ccConnectManagedRuntime.pid
}

func managedCCConnectRuntimeSnapshot() (int, string) {
	ccConnectManagedRuntime.Lock()
	defer ccConnectManagedRuntime.Unlock()
	if ccConnectManagedRuntime.pid <= 0 || ccConnectManagedRuntime.exited {
		return 0, ""
	}
	return ccConnectManagedRuntime.pid, ccConnectManagedRuntime.logPath
}

func managedCCConnectRuntimeExited(pid int) bool {
	ccConnectManagedRuntime.Lock()
	defer ccConnectManagedRuntime.Unlock()
	return ccConnectManagedRuntime.pid == pid && ccConnectManagedRuntime.exited
}

func detectTCPListenPID(ctx context.Context, port int) int {
	if port <= 0 {
		return 0
	}
	cmdCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, "lsof", "-nP", "-iTCP:"+strconv.Itoa(port), "-sTCP:LISTEN", "-Fp")
	var stdout strings.Builder
	cmd.Stdout = &stdout
	if err := cmd.Run(); err != nil {
		return 0
	}
	for _, line := range strings.Split(stdout.String(), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "p") {
			if pid, err := strconv.Atoi(strings.TrimPrefix(line, "p")); err == nil {
				return pid
			}
		}
	}
	return 0
}

func detectProcessRSSBytes(ctx context.Context, pid int) int64 {
	if pid <= 0 {
		return 0
	}
	cmdCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, "ps", "-p", strconv.Itoa(pid), "-o", "rss=")
	var stdout strings.Builder
	cmd.Stdout = &stdout
	if err := cmd.Run(); err != nil {
		return 0
	}
	rssKB, err := strconv.ParseInt(strings.TrimSpace(stdout.String()), 10, 64)
	if err != nil || rssKB <= 0 {
		return 0
	}
	return rssKB * 1024
}

func stopProcessByPID(ctx context.Context, pid int, port int) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	if err := process.Signal(os.Interrupt); err != nil {
		if killErr := process.Kill(); killErr != nil {
			return errors.Join(err, killErr)
		}
	}
	if waitTCPListenUnavailable(ctx, port, 4*time.Second) {
		return nil
	}
	if err := process.Kill(); err != nil {
		return err
	}
	if waitTCPListenUnavailable(ctx, port, 3*time.Second) {
		return nil
	}
	return fmt.Errorf("process %d did not stop", pid)
}

func waitTCPListenUnavailable(ctx context.Context, port int, timeout time.Duration) bool {
	if port <= 0 {
		return true
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if detectTCPListenPID(ctx, port) == 0 {
			return true
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(250 * time.Millisecond):
		}
	}
	return false
}

func tailFile(path string, limit int64) string {
	if limit <= 0 {
		limit = 8192
	}
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		return ""
	}
	offset := int64(0)
	if stat.Size() > limit {
		offset = stat.Size() - limit
	}
	if _, err := file.Seek(offset, 0); err != nil {
		return ""
	}
	buf := make([]byte, stat.Size()-offset)
	n, _ := file.Read(buf)
	return string(buf[:n])
}

type ccConnectManagementEnvelope struct {
	OK    bool                      `json:"ok"`
	Data  ccConnectManagementStatus `json:"data"`
	Error string                    `json:"error"`
}

type ccConnectManagementStatus struct {
	Version            string                   `json:"version"`
	UptimeSeconds      int                      `json:"uptime_seconds"`
	ConnectedPlatforms []string                 `json:"connected_platforms"`
	ProjectsCount      int                      `json:"projects_count"`
	BridgeAdapters     []CCConnectBridgeAdapter `json:"bridge_adapters"`
}

func requestCCConnectManagementStatus(ctx context.Context, baseURL string, token string) (ccConnectManagementStatus, error) {
	var zero ccConnectManagementStatus
	url := strings.TrimRight(baseURL, "/") + "/api/v1/status"
	reqCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	if err != nil {
		return zero, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return zero, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return zero, fmt.Errorf("status endpoint returned HTTP %d", res.StatusCode)
	}

	var envelope ccConnectManagementEnvelope
	if err := json.NewDecoder(res.Body).Decode(&envelope); err != nil {
		return zero, err
	}
	if !envelope.OK {
		if envelope.Error != "" {
			return zero, errors.New(envelope.Error)
		}
		return zero, fmt.Errorf("management status returned ok=false")
	}
	sort.Strings(envelope.Data.ConnectedPlatforms)
	return envelope.Data, nil
}

func ccConnectManagementConfigShape(cfg ccConnectConfigFile) CCConnectManagementConfigShape {
	port := cfg.Management.Port
	if port == 0 {
		port = 9820
	}
	url := fmt.Sprintf("http://127.0.0.1:%d", port)
	return CCConnectManagementConfigShape{
		Enabled:  boolPointerTrue(cfg.Management.Enabled),
		Port:     port,
		URL:      url,
		TokenSet: strings.TrimSpace(cfg.Management.Token) != "",
	}
}

func ccConnectBridgeConfigShape(cfg ccConnectConfigFile) CCConnectBridgeConfigShape {
	port := cfg.Bridge.Port
	if port == 0 {
		port = 9810
	}
	path := strings.TrimSpace(cfg.Bridge.Path)
	if path == "" {
		path = "/bridge/ws"
	}
	return CCConnectBridgeConfigShape{
		Enabled:  boolPointerTrue(cfg.Bridge.Enabled),
		Port:     port,
		Path:     path,
		TokenSet: strings.TrimSpace(cfg.Bridge.Token) != "",
	}
}

func parseCCConnectDaemonStatus(raw string, info *CCConnectDaemonInfo) {
	for _, line := range strings.Split(raw, "\n") {
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(parts[0]))
		value := strings.TrimSpace(parts[1])
		switch key {
		case "status":
			info.Installed = !strings.EqualFold(value, "Not installed")
			info.Running = strings.EqualFold(value, "Running")
		case "platform":
			info.Platform = value
		case "pid":
			if pid, err := strconv.Atoi(value); err == nil {
				info.PID = pid
			}
		case "log":
			info.LogPath = value
		case "workdir":
			info.WorkDir = value
		}
	}
}

func readCCConnectDaemonMeta(path string) *ccConnectDaemonMeta {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var meta ccConnectDaemonMeta
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil
	}
	return &meta
}

func resolveCCConnectConfigPath() (string, string) {
	if explicit := strings.TrimSpace(os.Getenv("CC_CONNECT_CONFIG")); explicit != "" {
		return explicit, "env"
	}
	if cwd, err := os.Getwd(); err == nil {
		local := filepath.Join(cwd, "config.toml")
		if pathIsFile(local) {
			return local, "cwd"
		}
	}
	return filepath.Join(defaultCCConnectDataDir(), "config.toml"), "home"
}

func defaultCCConnectDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ".cc-connect"
	}
	return filepath.Join(home, ".cc-connect")
}

func effectiveCCConnectDataDir(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return defaultCCConnectDataDir()
	}
	if strings.HasPrefix(value, "~/") {
		if home, err := os.UserHomeDir(); err == nil && home != "" {
			return filepath.Join(home, strings.TrimPrefix(value, "~/"))
		}
	}
	return value
}

func summarizeCCConnectEnvironment(cli CCConnectCLIInfo, config CCConnectConfigInfo, daemon CCConnectDaemonInfo, runtime CCConnectRuntimeInfo, management CCConnectManagementInfo) string {
	if !cli.Available {
		return "CC-Connect CLI 未检测到。"
	}
	if !config.Parsed {
		return "CC-Connect CLI 可用，但 config.toml 未就绪。"
	}
	if runtime.Managed && management.Reachable {
		return "CC-Connect 正在运行，Management API 可访问。"
	}
	if runtime.Running && management.Reachable {
		return "CC-Connect 进程正在运行，Management API 可访问。"
	}
	if daemon.Running && management.Reachable {
		return "CC-Connect daemon 正在运行，Management API 可访问。"
	}
	if daemon.Running {
		return "CC-Connect daemon 正在运行，Management API 尚未确认。"
	}
	if management.Reachable {
		return "Management API 可访问，但 daemon 状态未确认。"
	}
	if daemon.Installed {
		return "CC-Connect daemon 已安装但未运行。"
	}
	return "CC-Connect 配置已检测到，daemon 尚未安装或未运行。"
}

func classifyCCConnectCLISource(path string) string {
	lower := strings.ToLower(path)
	switch {
	case strings.Contains(lower, ".nvm/") || strings.Contains(lower, ".volta/") || strings.Contains(lower, "/npm/") || strings.Contains(lower, "node"):
		return "npm"
	case strings.Contains(lower, "homebrew") || strings.Contains(lower, "/opt/homebrew/") || strings.Contains(lower, "/usr/local/bin/"):
		return "homebrew"
	case strings.Contains(lower, ".local/bin"):
		return "local-bin"
	default:
		return "path"
	}
}

func stringOption(options map[string]any, key string) string {
	if options == nil {
		return ""
	}
	value, ok := options[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return fmt.Sprint(typed)
	}
}

func boolPointerTrue(value *bool) bool {
	return value != nil && *value
}

func firstNonEmptyLine(values ...string) string {
	for _, value := range values {
		for _, line := range strings.Split(value, "\n") {
			line = strings.TrimSpace(line)
			if line != "" {
				return line
			}
		}
	}
	return ""
}

func ccConnectCheck(name string, ok bool, message string, started time.Time) CCConnectCheck {
	return CCConnectCheck{
		Name:       name,
		OK:         ok,
		Message:    message,
		DurationMs: time.Since(started).Milliseconds(),
	}
}

func pathIsFile(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func pathIsDir(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func fileSize(info os.FileInfo, err error) int64 {
	if err != nil || info == nil || info.IsDir() {
		return 0
	}
	return info.Size()
}
