package hermes

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"agent-box-server/internal/httpapi/toolenv"
)

var hermesEnvironmentCache cacheMap[HermesEnvironmentResponse]

type HermesEnvironmentInput struct {
	Refresh bool   `query:"refresh" doc:"Force refresh cached Hermes environment data." example:"false"`
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile from ~/.hermes/active_profile." example:"default"`
}

type HermesEnvironmentOutput struct {
	Body HermesEnvironmentResponse
}

type HermesEnvironmentResponse struct {
	Status    string                 `json:"status" example:"ok" doc:"Hermes environment detection status."`
	Timestamp string                 `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Cache     HermesCacheInfo        `json:"cache" doc:"Cache behavior used for this response."`
	Profile   HermesProfileSelection `json:"profile" doc:"Resolved Hermes profile used for this response."`
	CLI       HermesCLIInfo          `json:"cli" doc:"Hermes CLI availability and version information."`
	Home      HermesHomeInfo         `json:"home" doc:"Hermes home directory information."`
	Config    HermesConfigInfo       `json:"config" doc:"Hermes config.yaml summary."`
	Env       HermesEnvInfo          `json:"env" doc:"Hermes .env summary with key count only."`
	Gateway   HermesGatewayInfo      `json:"gateway" doc:"Hermes Gateway runtime information."`
	Checks    []HermesCheck          `json:"checks" doc:"Readiness checks for local Hermes management."`
	Summary   string                 `json:"summary" example:"Hermes CLI available, Gateway running." doc:"Human-readable summary."`
}

type HermesCLIInfo struct {
	Available     bool   `json:"available" example:"true" doc:"Whether the hermes CLI is available."`
	Path          string `json:"path,omitempty" example:"/Users/one/.local/bin/hermes" doc:"Resolved hermes executable path."`
	Version       string `json:"version,omitempty" example:"Hermes Agent v0.13.0 (2026.5.7)" doc:"Hermes CLI version output first line."`
	Project       string `json:"project,omitempty" example:"/Users/one/.hermes/hermes-agent" doc:"Hermes project path from version output when available."`
	Python        string `json:"python,omitempty" example:"3.11.15" doc:"Python version from version output when available."`
	OpenAISDK     string `json:"openaiSdk,omitempty" example:"2.24.0" doc:"OpenAI SDK version from version output when available."`
	UpdateSummary string `json:"updateSummary,omitempty" doc:"Update availability line from version output when available."`
	Source        string `json:"source,omitempty" example:"local-bin" doc:"Best-effort install source classification."`
	Error         string `json:"error,omitempty" doc:"CLI detection error."`
}

type HermesHomeInfo struct {
	Path               string `json:"path" example:"/Users/one/.hermes" doc:"Hermes home directory."`
	EnvOverride        string `json:"envOverride,omitempty" example:"/opt/hermes" doc:"HERMES_HOME value when explicitly set."`
	Exists             bool   `json:"exists" example:"true" doc:"Whether Hermes home exists."`
	ConfigPath         string `json:"configPath" example:"/Users/one/.hermes/config.yaml" doc:"Hermes config.yaml path."`
	ConfigExists       bool   `json:"configExists" example:"true" doc:"Whether config.yaml exists."`
	EnvPath            string `json:"envPath" example:"/Users/one/.hermes/.env" doc:"Hermes .env path."`
	EnvExists          bool   `json:"envExists" example:"true" doc:"Whether .env exists."`
	LogsDir            string `json:"logsDir" example:"/Users/one/.hermes/logs" doc:"Hermes logs directory."`
	LogsDirExists      bool   `json:"logsDirExists" example:"true" doc:"Whether logs directory exists."`
	SessionsDir        string `json:"sessionsDir" example:"/Users/one/.hermes/sessions" doc:"Hermes sessions directory."`
	SessionsDirExists  bool   `json:"sessionsDirExists" example:"true" doc:"Whether sessions directory exists."`
	SkillsDir          string `json:"skillsDir" example:"/Users/one/.hermes/skills" doc:"Hermes skills directory."`
	SkillsDirExists    bool   `json:"skillsDirExists" example:"true" doc:"Whether skills directory exists."`
	PluginsDir         string `json:"pluginsDir" example:"/Users/one/.hermes/plugins" doc:"Hermes plugins directory."`
	PluginsDirExists   bool   `json:"pluginsDirExists" example:"true" doc:"Whether plugins directory exists."`
	CronDir            string `json:"cronDir" example:"/Users/one/.hermes/cron" doc:"Hermes cron directory."`
	CronDirExists      bool   `json:"cronDirExists" example:"true" doc:"Whether cron directory exists."`
	StateDBPath        string `json:"stateDbPath" example:"/Users/one/.hermes/state.db" doc:"Hermes state.db path."`
	StateDBExists      bool   `json:"stateDbExists" example:"true" doc:"Whether state.db exists."`
	StateDBBytes       int64  `json:"stateDbBytes,omitempty" example:"102400" doc:"state.db size in bytes."`
	GatewayPIDPath     string `json:"gatewayPidPath" example:"/Users/one/.hermes/gateway.pid" doc:"Hermes Gateway PID file path."`
	GatewayPIDExists   bool   `json:"gatewayPidExists" example:"true" doc:"Whether gateway.pid exists."`
	GatewayStatePath   string `json:"gatewayStatePath" example:"/Users/one/.hermes/gateway_state.json" doc:"Hermes Gateway state file path."`
	GatewayStateExists bool   `json:"gatewayStateExists" example:"true" doc:"Whether gateway_state.json exists."`
}

type HermesConfigInfo struct {
	Path               string   `json:"path" example:"/Users/one/.hermes/config.yaml" doc:"Hermes config.yaml path."`
	Exists             bool     `json:"exists" example:"true" doc:"Whether config.yaml exists."`
	Readable           bool     `json:"readable" example:"true" doc:"Whether config.yaml can be read."`
	Parsed             bool     `json:"parsed" example:"true" doc:"Whether a best-effort summary could be parsed."`
	Error              string   `json:"error,omitempty" doc:"Config read or parse error when any."`
	TopKeys            []string `json:"topKeys,omitempty" doc:"Top-level config keys."`
	ModelDefault       string   `json:"modelDefault,omitempty" example:"gpt-5.5" doc:"model.default when detected."`
	ModelProvider      string   `json:"modelProvider,omitempty" example:"NEX-LLM" doc:"model.provider when detected."`
	TerminalBackend    string   `json:"terminalBackend,omitempty" example:"local" doc:"terminal.backend when detected."`
	TerminalCWD        string   `json:"terminalCwd,omitempty" example:"." doc:"terminal.cwd when detected."`
	TerminalTimeout    string   `json:"terminalTimeout,omitempty" example:"180" doc:"terminal.timeout when detected."`
	DisplayLanguage    string   `json:"displayLanguage,omitempty" example:"en" doc:"display.language when detected."`
	DisplayPersonality string   `json:"displayPersonality,omitempty" example:"kawaii" doc:"display.personality when detected."`
	DashboardTheme     string   `json:"dashboardTheme,omitempty" example:"default" doc:"dashboard.theme when detected."`
	Toolsets           []string `json:"toolsets,omitempty" doc:"Top-level toolsets list when detected."`
	APIServerEnabled   bool     `json:"apiServerEnabled" example:"true" doc:"platforms.api_server.enabled when detected."`
}

type HermesEnvInfo struct {
	Path     string `json:"path" example:"/Users/one/.hermes/.env" doc:"Hermes .env path."`
	Exists   bool   `json:"exists" example:"true" doc:"Whether .env exists."`
	KeyCount int    `json:"keyCount" example:"4" doc:"Number of environment keys in .env."`
	Error    string `json:"error,omitempty" doc:".env read error when any."`
}

type HermesGatewayInfo struct {
	Running          bool                    `json:"running" example:"true" doc:"Whether Hermes Gateway process is running."`
	PID              int                     `json:"pid,omitempty" example:"17969" doc:"Gateway process PID from gateway.pid or state."`
	Kind             string                  `json:"kind,omitempty" example:"hermes-gateway" doc:"PID file process kind."`
	Manager          string                  `json:"manager,omitempty" example:"manual" doc:"Best-effort manager: manual, service, or unknown."`
	State            string                  `json:"state,omitempty" example:"running" doc:"gateway_state value when available."`
	UpdatedAt        string                  `json:"updatedAt,omitempty" doc:"Gateway state updated_at value when available."`
	ActiveAgents     int                     `json:"activeAgents" example:"0" doc:"Active agent count from gateway_state when available."`
	RestartRequested bool                    `json:"restartRequested" example:"false" doc:"Gateway restart_requested flag."`
	ExitReason       string                  `json:"exitReason,omitempty" doc:"Gateway exit_reason when any."`
	Argv             []string                `json:"argv,omitempty" doc:"Gateway command argv from gateway.pid when available."`
	ListenPorts      []int                   `json:"listenPorts,omitempty" doc:"TCP listen ports held by the Gateway PID."`
	URLs             []string                `json:"urls,omitempty" doc:"Loopback URLs derived from listen ports."`
	Platforms        []HermesGatewayPlatform `json:"platforms,omitempty" doc:"Platform connection states from gateway_state."`
	Process          *HermesProcessInfo      `json:"process,omitempty" doc:"Runtime process snapshot for PID when available."`
	PIDFileError     string                  `json:"pidFileError,omitempty" doc:"gateway.pid parse error when any."`
	StateFileError   string                  `json:"stateFileError,omitempty" doc:"gateway_state.json parse error when any."`
}

type HermesGatewayPlatform struct {
	Name         string `json:"name" example:"api_server" doc:"Gateway platform key."`
	State        string `json:"state,omitempty" example:"connected" doc:"Platform connection state."`
	ErrorCode    string `json:"errorCode,omitempty" doc:"Platform error code when any."`
	ErrorMessage string `json:"errorMessage,omitempty" doc:"Platform error message when any."`
	UpdatedAt    string `json:"updatedAt,omitempty" doc:"Platform updated_at value when any."`
}

type HermesProcessInfo struct {
	PID           int     `json:"pid" example:"17969" doc:"Process ID."`
	Detected      bool    `json:"detected" example:"true" doc:"Whether process information was resolved from the operating system."`
	State         string  `json:"state,omitempty" example:"S" doc:"Operating system process state from ps."`
	StartedAt     string  `json:"startedAt,omitempty" example:"2026-05-15T10:57:36Z" doc:"Best-effort process start time in RFC3339 format."`
	Uptime        string  `json:"uptime,omitempty" example:"14:59:30" doc:"Human-readable elapsed runtime from ps etime."`
	UptimeSeconds int64   `json:"uptimeSeconds,omitempty" example:"53970" doc:"Elapsed runtime in seconds when parseable."`
	CPUPercent    float64 `json:"cpuPercent,omitempty" example:"0.1" doc:"Current process CPU percentage from ps."`
	MemoryPercent float64 `json:"memoryPercent,omitempty" example:"0.2" doc:"Current process memory percentage from ps."`
	RSSBytes      int64   `json:"rssBytes,omitempty" example:"40189952" doc:"Resident set size in bytes."`
	RSSMB         float64 `json:"rssMb,omitempty" example:"38.3" doc:"Resident set size in MiB, rounded to one decimal."`
	Command       string  `json:"command,omitempty" doc:"Process command line."`
	Error         string  `json:"error,omitempty" doc:"Process inspection error when any."`
}

type HermesCheck struct {
	Name       string `json:"name" example:"cli" doc:"Check name."`
	OK         bool   `json:"ok" example:"true" doc:"Whether the check passed."`
	Message    string `json:"message" example:"Hermes CLI available." doc:"Check result message."`
	DurationMs int64  `json:"durationMs" example:"5" doc:"Check duration in milliseconds."`
}

type hermesPIDFile struct {
	PID       int             `json:"pid"`
	Kind      string          `json:"kind"`
	Argv      []string        `json:"argv"`
	StartTime json.RawMessage `json:"start_time"`
}

type hermesGatewayStateFile struct {
	PID              int                                   `json:"pid"`
	Kind             string                                `json:"kind"`
	Argv             []string                              `json:"argv"`
	GatewayState     string                                `json:"gateway_state"`
	ExitReason       *string                               `json:"exit_reason"`
	RestartRequested bool                                  `json:"restart_requested"`
	ActiveAgents     int                                   `json:"active_agents"`
	Platforms        map[string]hermesGatewayPlatformState `json:"platforms"`
	UpdatedAt        string                                `json:"updated_at"`
}

type hermesGatewayPlatformState struct {
	State        *string `json:"state"`
	ErrorCode    *string `json:"error_code"`
	ErrorMessage *string `json:"error_message"`
	UpdatedAt    *string `json:"updated_at"`
}

type configSummary struct {
	TopKeys          []string
	Scalars          map[string]string
	Toolsets         []string
	APIServerEnabled bool
}

func HermesEnvironment(ctx context.Context, input *HermesEnvironmentInput) (*HermesEnvironmentOutput, error) {
	if input == nil {
		input = &HermesEnvironmentInput{}
	}

	profile, err := resolveHermesProfileCandidate(input.Profile)
	if err != nil {
		return nil, err
	}

	body := cachedByKey(&hermesEnvironmentCache, profile.Name, 10*time.Second, input.Refresh, func() HermesEnvironmentResponse {
		return detectHermesEnvironment(ctx, profile)
	})
	body.Timestamp = time.Now().UTC().Format(time.RFC3339)
	body.Cache = HermesCacheInfo{Refresh: input.Refresh}

	return &HermesEnvironmentOutput{Body: body}, nil
}

func RestartHermesGateway(ctx context.Context, input *HermesProfileQueryInput) (*HermesGatewayActionOutput, error) {
	profile := ""
	if input != nil {
		profile = input.Profile
	}
	return runHermesGatewayAction(ctx, profile, "restart", 5*time.Minute)
}

func StopHermesGateway(ctx context.Context, input *HermesProfileQueryInput) (*HermesGatewayActionOutput, error) {
	profile := ""
	if input != nil {
		profile = input.Profile
	}
	return runHermesGatewayAction(ctx, profile, "stop", 30*time.Second)
}

type HermesGatewayActionOutput struct {
	Body HermesGatewayActionResponse
}

type HermesGatewayActionResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Action    string `json:"action" example:"restart" doc:"Gateway action that was requested."`
	Message   string `json:"message" example:"Gateway restart finished." doc:"Human-readable action result."`
	Stdout    string `json:"stdout,omitempty" doc:"Command stdout."`
	Stderr    string `json:"stderr,omitempty" doc:"Command stderr."`
}

func runHermesGatewayAction(ctx context.Context, profileName string, action string, timeout time.Duration) (*HermesGatewayActionOutput, error) {
	path := toolenv.ResolveToolPath("hermes")
	if path == "" {
		resolved, err := exec.LookPath("hermes")
		if err == nil {
			path = resolved
		}
	}
	if path == "" {
		return nil, fmt.Errorf("hermes CLI not found")
	}
	profile, err := resolveHermesProfileSelection(profileName)
	if err != nil {
		return nil, err
	}

	if action == "restart" {
		response, err := runHermesGatewayRestartAndWait(ctx, path, profile, timeout, nil)
		if err != nil {
			return nil, err
		}
		return &HermesGatewayActionOutput{Body: *response}, nil
	}

	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	args := []string{"gateway", action}
	if profile.Name != "default" {
		args = append([]string{"-p", profile.Name}, args...)
	}
	cmd := exec.CommandContext(cmdCtx, path, args...)
	cmd.Env = hermesCommandEnvForProfile(profile)
	out, err := cmd.CombinedOutput()
	output := strings.TrimSpace(string(out))
	if err != nil {
		message := strings.TrimSpace(output + "\n" + err.Error())
		return nil, fmt.Errorf("hermes gateway %s failed: %s", action, message)
	}

	invalidateHermesEnvironmentCache()
	return &HermesGatewayActionOutput{Body: HermesGatewayActionResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Action:    action,
		Message:   "Gateway " + action + " finished.",
		Stdout:    output,
	}}, nil
}

func runHermesGatewayRestartAndWait(ctx context.Context, path string, profile HermesProfileSelection, timeout time.Duration, writeLog func(string)) (*HermesGatewayActionResponse, error) {
	home := profile.Path
	previous := detectHermesEnvironment(ctx, profile).Gateway
	previousPID := previous.PID
	logPath := filepath.Join(home, "logs", "agent-box-gateway-restart.log")
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return nil, err
	}
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, err
	}

	if writeLog != nil {
		writeLog("Gateway 重启日志：" + logPath)
	}
	_, _ = fmt.Fprintf(logFile, "\n[%s] agent-box starting: %s gateway restart (previous pid: %d)\n", time.Now().Format(time.RFC3339), path, previousPID)

	args := []string{"gateway", "restart"}
	if profile.Name != "default" {
		args = append([]string{"-p", profile.Name}, args...)
	}
	cmd := exec.Command(path, args...)
	cmd.Env = hermesCommandEnvForProfile(profile)
	cmd.Env = append(cmd.Env, "CI=1", "NO_COLOR=1", "TERM=dumb")
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	setHermesGatewayCommandAttrs(cmd)
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return nil, fmt.Errorf("hermes gateway restart failed to start: %w", err)
	}

	commandPID := cmd.Process.Pid
	if writeLog != nil {
		writeLog(fmt.Sprintf("已发起 hermes gateway restart，命令 PID: %d，等待 Gateway 上报运行态。", commandPID))
	}

	done := make(chan error, 1)
	go func() {
		err := cmd.Wait()
		_, _ = fmt.Fprintf(logFile, "[%s] agent-box command exited: %v\n", time.Now().Format(time.RFC3339), err)
		_ = logFile.Close()
		done <- err
	}()

	startedAt := time.Now()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	var commandDone <-chan error = done
	var lastGateway HermesGatewayInfo
	for {
		probeCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
		env := detectHermesEnvironment(probeCtx, profile)
		cancel()
		lastGateway = env.Gateway
		if hermesGatewayRestartObserved(env.Gateway, previousPID, commandPID) {
			invalidateHermesEnvironmentCache()
			message := fmt.Sprintf("Gateway restart finished; Gateway is running (PID: %d).", env.Gateway.PID)
			if writeLog != nil {
				writeLog(fmt.Sprintf("Hermes Gateway 已运行，PID: %d。", env.Gateway.PID))
			}
			return &HermesGatewayActionResponse{
				Status:    "ok",
				Timestamp: time.Now().UTC().Format(time.RFC3339),
				Action:    "restart",
				Message:   message,
				Stdout:    fmt.Sprintf("restart command pid: %d\nlog: %s", commandPID, logPath),
			}, nil
		}

		select {
		case err := <-commandDone:
			commandDone = nil
			if err != nil {
				return nil, fmt.Errorf("hermes gateway restart exited before Gateway was detected: %w (log: %s)", err, logPath)
			}
			if writeLog != nil {
				writeLog("hermes gateway restart 命令已退出，继续等待 Gateway 状态上报。")
			}
		case <-ticker.C:
		case <-timer.C:
			return nil, fmt.Errorf("hermes gateway restart did not report a running Gateway within %s (last pid: %d, state: %s, log: %s)", time.Since(startedAt).Round(time.Second), lastGateway.PID, firstNonEmpty(lastGateway.State, "unknown"), logPath)
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}

func hermesGatewayRestartObserved(gateway HermesGatewayInfo, previousPID int, commandPID int) bool {
	if !gateway.Running {
		return false
	}
	if previousPID <= 0 {
		return true
	}
	return gateway.PID != previousPID || gateway.PID == commandPID
}

func invalidateHermesEnvironmentCache() {
	invalidateCacheMap(&hermesEnvironmentCache)
}

func detectHermesEnvironment(ctx context.Context, profile HermesProfileSelection) HermesEnvironmentResponse {
	checks := make([]HermesCheck, 0, 7)

	cli, cliCheck := detectHermesCLI(ctx)
	checks = append(checks, cliCheck)

	home, homeCheck := detectHermesHome(profile)
	checks = append(checks, homeCheck)

	config, configCheck := detectHermesConfig(home.ConfigPath)
	checks = append(checks, configCheck)

	envInfo, envCheck := detectHermesEnv(home.EnvPath)
	checks = append(checks, envCheck)

	gateway, gatewayChecks := detectHermesGateway(ctx, home)
	checks = append(checks, gatewayChecks...)

	status := "ok"
	failed := make([]string, 0)
	for _, check := range checks {
		if !check.OK {
			status = "warning"
			failed = append(failed, check.Name)
		}
	}

	summary := "Hermes 环境检测通过"
	if len(failed) > 0 {
		summary = "以下检查需要关注: " + strings.Join(failed, ", ")
	}

	return HermesEnvironmentResponse{
		Status:    status,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Profile:   profile,
		CLI:       cli,
		Home:      home,
		Config:    config,
		Env:       envInfo,
		Gateway:   gateway,
		Checks:    checks,
		Summary:   summary,
	}
}

func detectHermesCLI(ctx context.Context) (HermesCLIInfo, HermesCheck) {
	start := time.Now()
	path := toolenv.ResolveToolPath("hermes")
	if path == "" {
		resolved, err := exec.LookPath("hermes")
		if err == nil {
			path = resolved
		}
	}
	if path == "" {
		info := HermesCLIInfo{Available: false, Error: "executable file not found"}
		return info, finishHermesCheck("cli", false, "未找到 hermes CLI，请先安装或修正 PATH", start)
	}

	versionOutput := commandOutput(ctx, 4*time.Second, path, "--version")
	info := HermesCLIInfo{
		Available: true,
		Path:      path,
		Version:   firstLine(versionOutput),
		Source:    classifyHermesCLISource(path),
	}
	applyHermesVersionDetails(&info, versionOutput)
	return info, finishHermesCheck("cli", true, "Hermes CLI 可用", start)
}

func detectHermesHome(profile HermesProfileSelection) (HermesHomeInfo, HermesCheck) {
	start := time.Now()
	homeDir := profile.Path
	override := ""
	if envHome := strings.TrimSpace(os.Getenv("HERMES_HOME")); envHome != "" {
		override = envHome
	}
	info := HermesHomeInfo{
		Path:             homeDir,
		EnvOverride:      override,
		Exists:           pathExists(homeDir),
		ConfigPath:       filepath.Join(homeDir, "config.yaml"),
		EnvPath:          filepath.Join(homeDir, ".env"),
		LogsDir:          filepath.Join(homeDir, "logs"),
		SessionsDir:      filepath.Join(homeDir, "sessions"),
		SkillsDir:        filepath.Join(homeDir, "skills"),
		PluginsDir:       filepath.Join(homeDir, "plugins"),
		CronDir:          filepath.Join(homeDir, "cron"),
		StateDBPath:      filepath.Join(homeDir, "state.db"),
		GatewayPIDPath:   filepath.Join(homeDir, "gateway.pid"),
		GatewayStatePath: filepath.Join(homeDir, "gateway_state.json"),
	}
	info.ConfigExists = pathExists(info.ConfigPath)
	info.EnvExists = pathExists(info.EnvPath)
	info.LogsDirExists = pathExists(info.LogsDir)
	info.SessionsDirExists = pathExists(info.SessionsDir)
	info.SkillsDirExists = pathExists(info.SkillsDir)
	info.PluginsDirExists = pathExists(info.PluginsDir)
	info.CronDirExists = pathExists(info.CronDir)
	info.StateDBExists = pathExists(info.StateDBPath)
	info.GatewayPIDExists = pathExists(info.GatewayPIDPath)
	info.GatewayStateExists = pathExists(info.GatewayStatePath)
	if stat, err := os.Stat(info.StateDBPath); err == nil {
		info.StateDBBytes = stat.Size()
	}

	return info, finishHermesCheck("hermes_home", info.Exists, boolMessage(info.Exists, "Hermes Home 存在", "Hermes Home 不存在"), start)
}

func detectHermesConfig(path string) (HermesConfigInfo, HermesCheck) {
	start := time.Now()
	info := HermesConfigInfo{Path: path, Exists: pathExists(path)}
	if !info.Exists {
		return info, finishHermesCheck("config", false, "config.yaml 不存在", start)
	}

	content, err := os.ReadFile(path)
	if err != nil {
		info.Error = err.Error()
		return info, finishHermesCheck("config", false, "config.yaml 读取失败: "+err.Error(), start)
	}
	info.Readable = true
	summary := parseHermesConfigSummary(string(content))
	info.Parsed = len(summary.TopKeys) > 0
	info.TopKeys = summary.TopKeys
	info.ModelDefault = summary.Scalars["model.default"]
	info.ModelProvider = summary.Scalars["model.provider"]
	info.TerminalBackend = summary.Scalars["terminal.backend"]
	info.TerminalCWD = summary.Scalars["terminal.cwd"]
	info.TerminalTimeout = summary.Scalars["terminal.timeout"]
	info.DisplayLanguage = summary.Scalars["display.language"]
	info.DisplayPersonality = summary.Scalars["display.personality"]
	info.DashboardTheme = summary.Scalars["dashboard.theme"]
	info.Toolsets = summary.Toolsets
	info.APIServerEnabled = summary.APIServerEnabled

	return info, finishHermesCheck("config", info.Parsed, boolMessage(info.Parsed, "config.yaml 可读取并完成摘要解析", "config.yaml 读取成功但未解析到有效键"), start)
}

func detectHermesEnv(path string) (HermesEnvInfo, HermesCheck) {
	start := time.Now()
	info := HermesEnvInfo{Path: path, Exists: pathExists(path)}
	if !info.Exists {
		return info, finishHermesCheck("env_file", false, ".env 不存在", start)
	}

	content, err := os.ReadFile(path)
	if err != nil {
		info.Error = err.Error()
		return info, finishHermesCheck("env_file", false, ".env 读取失败: "+err.Error(), start)
	}
	info.KeyCount = countEnvKeys(string(content))
	return info, finishHermesCheck("env_file", true, ".env 可读取，已返回 key 数量", start)
}

func detectHermesGateway(ctx context.Context, home HermesHomeInfo) (HermesGatewayInfo, []HermesCheck) {
	checks := make([]HermesCheck, 0, 3)
	info := HermesGatewayInfo{Manager: "unknown"}

	pidStart := time.Now()
	applyHermesGatewayPIDFile(&info, home.GatewayPIDPath)
	checks = append(checks, finishHermesCheck("gateway_pid_file", home.GatewayPIDExists && info.PIDFileError == "", boolMessage(home.GatewayPIDExists && info.PIDFileError == "", "gateway.pid 可读取", "gateway.pid 缺失或无法解析"), pidStart))

	stateStart := time.Now()
	applyHermesGatewayStateFile(&info, home.GatewayStatePath)
	checks = append(checks, finishHermesCheck("gateway_state", home.GatewayStateExists && info.StateFileError == "", boolMessage(home.GatewayStateExists && info.StateFileError == "", "gateway_state.json 可读取", "gateway_state.json 缺失或无法解析"), stateStart))

	processStart := time.Now()
	if info.PID > 0 {
		info.Process = detectHermesProcess(ctx, info.PID)
		info.Running = info.Process != nil && info.Process.Detected
		info.ListenPorts = detectHermesListenPorts(ctx, info.PID)
		info.URLs = makeLoopbackURLs(info.ListenPorts)
	}
	if info.Manager == "unknown" && len(info.Argv) > 0 {
		info.Manager = "manual"
	}
	checks = append(checks, finishHermesCheck("gateway_process", info.Running, boolMessage(info.Running, "Hermes Gateway 进程运行中", "未检测到 Hermes Gateway 进程"), processStart))

	return info, checks
}

func applyHermesGatewayPIDFile(info *HermesGatewayInfo, path string) {
	content, err := os.ReadFile(path)
	if err != nil {
		info.PIDFileError = err.Error()
		return
	}
	var pidFile hermesPIDFile
	if err := json.Unmarshal(content, &pidFile); err != nil {
		trimmed := strings.TrimSpace(string(content))
		pid, parseErr := strconv.Atoi(trimmed)
		if parseErr != nil {
			info.PIDFileError = err.Error()
			return
		}
		pidFile.PID = pid
	}
	if pidFile.PID > 0 {
		info.PID = pidFile.PID
	}
	info.Kind = firstNonEmpty(info.Kind, pidFile.Kind)
	if len(pidFile.Argv) > 0 {
		info.Argv = pidFile.Argv
		info.Manager = "manual"
	}
}

func applyHermesGatewayStateFile(info *HermesGatewayInfo, path string) {
	content, err := os.ReadFile(path)
	if err != nil {
		info.StateFileError = err.Error()
		return
	}
	var state hermesGatewayStateFile
	if err := json.Unmarshal(content, &state); err != nil {
		info.StateFileError = err.Error()
		return
	}
	if state.PID > 0 && info.PID == 0 {
		info.PID = state.PID
	}
	info.Kind = firstNonEmpty(info.Kind, state.Kind)
	if len(state.Argv) > 0 && len(info.Argv) == 0 {
		info.Argv = state.Argv
	}
	info.State = state.GatewayState
	info.UpdatedAt = state.UpdatedAt
	info.ActiveAgents = state.ActiveAgents
	info.RestartRequested = state.RestartRequested
	info.ExitReason = stringValue(state.ExitReason)

	names := make([]string, 0, len(state.Platforms))
	for name := range state.Platforms {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		platform := state.Platforms[name]
		info.Platforms = append(info.Platforms, HermesGatewayPlatform{
			Name:         name,
			State:        stringValue(platform.State),
			ErrorCode:    stringValue(platform.ErrorCode),
			ErrorMessage: stringValue(platform.ErrorMessage),
			UpdatedAt:    stringValue(platform.UpdatedAt),
		})
	}
}

func detectHermesProcess(ctx context.Context, pid int) *HermesProcessInfo {
	info := &HermesProcessInfo{PID: pid}
	if pid <= 0 {
		info.Error = "missing pid"
		return info
	}

	cmdCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, "ps", "-p", strconv.Itoa(pid), "-o", "pid=,stat=,lstart=,etime=,%cpu=,%mem=,rss=,command=")
	cmd.Env = toolenv.CommandEnv()
	out, err := cmd.CombinedOutput()
	text := strings.TrimSpace(string(out))
	if err != nil {
		if text == "" {
			text = err.Error()
		}
		info.Error = strings.TrimSpace(text)
		return info
	}

	fields := strings.Fields(text)
	if len(fields) < 11 {
		info.Error = "unexpected ps output"
		return info
	}
	parsedPID, err := strconv.Atoi(fields[0])
	if err != nil || parsedPID != pid {
		info.Error = "unexpected process pid"
		return info
	}

	info.Detected = true
	info.State = fields[1]
	if startedAt := parsePSStartTime(fields[2:7]); !startedAt.IsZero() {
		info.StartedAt = startedAt.Format(time.RFC3339)
	}
	info.Uptime = fields[7]
	info.UptimeSeconds = parsePSElapsedSeconds(fields[7])
	info.CPUPercent = parseFloatField(fields[8])
	info.MemoryPercent = parseFloatField(fields[9])
	if rssKB, err := strconv.ParseInt(fields[10], 10, 64); err == nil && rssKB > 0 {
		info.RSSBytes = rssKB * 1024
		info.RSSMB = float64(int((float64(info.RSSBytes)/1024/1024)*10+0.5)) / 10
	}
	if len(fields) > 11 {
		info.Command = strings.Join(fields[11:], " ")
	}
	return info
}

func detectHermesListenPorts(ctx context.Context, pid int) []int {
	cmdCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, "lsof", "-nP", "-a", "-p", strconv.Itoa(pid), "-iTCP", "-sTCP:LISTEN", "-FnP")
	cmd.Env = toolenv.CommandEnv()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil
	}

	seen := map[int]bool{}
	portPattern := regexp.MustCompile(`:(\d+)(?:\s|\(|$)`)
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "n") {
			continue
		}
		matches := portPattern.FindAllStringSubmatch(line, -1)
		for _, match := range matches {
			port, err := strconv.Atoi(match[1])
			if err == nil && port > 0 && port < 65536 {
				seen[port] = true
			}
		}
	}
	ports := make([]int, 0, len(seen))
	for port := range seen {
		ports = append(ports, port)
	}
	sort.Ints(ports)
	return ports
}

func makeLoopbackURLs(ports []int) []string {
	urls := make([]string, 0, len(ports))
	for _, port := range ports {
		if tcpReachable("127.0.0.1", port, 250*time.Millisecond) {
			urls = append(urls, fmt.Sprintf("http://127.0.0.1:%d", port))
		}
	}
	return urls
}

func parseHermesConfigSummary(content string) configSummary {
	summary := configSummary{Scalars: map[string]string{}}
	topKeySet := map[string]bool{}
	stack := map[int]string{}
	currentListPath := ""

	keyValuePattern := regexp.MustCompile(`^([A-Za-z0-9_.-]+):(?:\s*(.*))?$`)
	for _, raw := range strings.Split(content, "\n") {
		withoutComment := stripYAMLComment(raw)
		if strings.TrimSpace(withoutComment) == "" {
			continue
		}
		indent := leadingSpaces(withoutComment)
		trimmed := strings.TrimSpace(withoutComment)
		if strings.HasPrefix(trimmed, "- ") {
			if currentListPath == "toolsets" && indent == 0 {
				value := normalizeYAMLScalar(strings.TrimSpace(strings.TrimPrefix(trimmed, "- ")))
				if value != "" {
					summary.Toolsets = append(summary.Toolsets, value)
				}
			}
			continue
		}

		match := keyValuePattern.FindStringSubmatch(trimmed)
		if match == nil {
			continue
		}
		key := match[1]
		value := normalizeYAMLScalar(match[2])
		stack[indent] = key
		for knownIndent := range stack {
			if knownIndent > indent {
				delete(stack, knownIndent)
			}
		}
		if indent == 0 {
			topKeySet[key] = true
			currentListPath = key
		} else if trimmed != "" {
			currentListPath = ""
		}
		path := yamlPath(stack)
		if value != "" && value != "{}" && value != "[]" {
			summary.Scalars[path] = value
		}
	}

	for key := range topKeySet {
		summary.TopKeys = append(summary.TopKeys, key)
	}
	sort.Strings(summary.TopKeys)
	summary.APIServerEnabled = strings.EqualFold(summary.Scalars["platforms.api_server.enabled"], "true")
	return summary
}

func yamlPath(stack map[int]string) string {
	indents := make([]int, 0, len(stack))
	for indent := range stack {
		indents = append(indents, indent)
	}
	sort.Ints(indents)
	parts := make([]string, 0, len(indents))
	for _, indent := range indents {
		parts = append(parts, stack[indent])
	}
	return strings.Join(parts, ".")
}

func stripYAMLComment(value string) string {
	inQuote := rune(0)
	for index, char := range value {
		if char == '\'' || char == '"' {
			if inQuote == 0 {
				inQuote = char
			} else if inQuote == char {
				inQuote = 0
			}
			continue
		}
		if char == '#' && inQuote == 0 {
			return value[:index]
		}
	}
	return value
}

func normalizeYAMLScalar(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if (strings.HasPrefix(value, "\"") && strings.HasSuffix(value, "\"")) || (strings.HasPrefix(value, "'") && strings.HasSuffix(value, "'")) {
		value = strings.Trim(value, "\"'")
	}
	return strings.TrimSpace(value)
}

func countEnvKeys(content string) int {
	seen := map[string]bool{}
	pattern := regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	for _, raw := range strings.Split(content, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {
			continue
		}
		key, _, _ := strings.Cut(line, "=")
		key = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(key), "export "))
		if pattern.MatchString(key) && !seen[key] {
			seen[key] = true
		}
	}
	return len(seen)
}

func applyHermesVersionDetails(info *HermesCLIInfo, output string) {
	for _, line := range strings.Split(output, "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), ":")
		if !ok {
			if strings.Contains(strings.ToLower(line), "update available") {
				info.UpdateSummary = strings.TrimSpace(line)
			}
			continue
		}
		value = strings.TrimSpace(value)
		switch strings.TrimSpace(strings.ToLower(key)) {
		case "project":
			info.Project = value
		case "python":
			info.Python = value
		case "openai sdk":
			info.OpenAISDK = value
		case "update available":
			info.UpdateSummary = "Update available: " + value
		}
	}
}

func commandOutput(ctx context.Context, timeout time.Duration, name string, args ...string) string {
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, name, args...)
	cmd.Env = toolenv.CommandEnv()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return strings.TrimSpace(string(out))
	}
	return strings.TrimSpace(string(out))
}

func defaultHermesHomeDir() (string, string) {
	if value := strings.TrimSpace(os.Getenv("HERMES_HOME")); value != "" {
		return value, value
	}
	home, err := os.UserHomeDir()
	if err != nil {
		if current, userErr := user.Current(); userErr == nil && current.HomeDir != "" {
			return filepath.Join(current.HomeDir, ".hermes"), ""
		}
		return ".hermes", ""
	}
	return filepath.Join(home, ".hermes"), ""
}

func classifyHermesCLISource(cliPath string) string {
	lower := strings.ToLower(strings.ReplaceAll(cliPath, "\\", "/"))
	switch {
	case strings.Contains(lower, "/.hermes/hermes-agent/venv/"):
		return "hermes-home-venv"
	case strings.Contains(lower, "/.local/bin/"):
		return "local-bin"
	case strings.Contains(lower, "/pipx/"):
		return "pipx"
	case strings.Contains(lower, "/homebrew/") || strings.Contains(lower, "/usr/local/bin"):
		return "homebrew-or-global"
	case strings.Contains(lower, "/venv/") || strings.Contains(lower, "/.venv/"):
		return "venv"
	default:
		return "unknown"
	}
}

func parsePSStartTime(parts []string) time.Time {
	if len(parts) != 5 {
		return time.Time{}
	}
	parsed, err := time.ParseInLocation("Mon Jan 2 15:04:05 2006", strings.Join(parts, " "), time.Local)
	if err != nil {
		return time.Time{}
	}
	return parsed
}

func parsePSElapsedSeconds(value string) int64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	var days int64
	if before, after, ok := strings.Cut(value, "-"); ok {
		parsedDays, err := strconv.ParseInt(before, 10, 64)
		if err != nil {
			return 0
		}
		days = parsedDays
		value = after
	}
	parts := strings.Split(value, ":")
	var hours, minutes, seconds int64
	switch len(parts) {
	case 2:
		minutes = parseIntField(parts[0])
		seconds = parseIntField(parts[1])
	case 3:
		hours = parseIntField(parts[0])
		minutes = parseIntField(parts[1])
		seconds = parseIntField(parts[2])
	default:
		return 0
	}
	return days*24*60*60 + hours*60*60 + minutes*60 + seconds
}

func finishHermesCheck(name string, ok bool, message string, start time.Time) HermesCheck {
	return HermesCheck{
		Name:       name,
		OK:         ok,
		Message:    message,
		DurationMs: time.Since(start).Milliseconds(),
	}
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func tcpReachable(host string, port int, timeout time.Duration) bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", host, port), timeout)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func firstLine(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	return strings.TrimSpace(strings.Split(value, "\n")[0])
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func leadingSpaces(value string) int {
	return len(value) - len(strings.TrimLeft(value, " "))
}

func boolMessage(ok bool, okMessage string, failMessage string) string {
	if ok {
		return okMessage
	}
	return failMessage
}

func parseFloatField(value string) float64 {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil {
		return 0
	}
	return parsed
}

func parseIntField(value string) int64 {
	parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}
