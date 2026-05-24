package openclaw

// OpenClawEnvironment handler 用于检测当前主机上 OpenClaw 的本地安装与 Gateway 运行环境。
//
// 该接口遵循 OpenClaw 自身的管理前缀 /openclaw，不挂在通用 /api 命名空间下。
// 检测重点包括 CLI、配置目录、openclaw.json、Gateway 端口、HTTP 健康端点、
// 设备密钥、owner 记录和错误日志。
//
// 接口只返回状态摘要和脱敏后的配置形态，不返回 token、password、credentials、聊天内容或原始日志全文。

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"agent-box-server/internal/httpapi/toolenv"

	"github.com/danielgtaylor/huma/v2"
)

const openClawCLIVersionCacheTTL = 10 * time.Minute

var (
	openClawEnvironmentCache cacheEntry[OpenClawEnvironmentResponse]
	openClawCLIVersionCache  cacheEntry[openClawCLIVersionCacheValue]
)

type openClawCLIVersionCacheValue struct {
	Path    string
	Version string
}

type OpenClawEnvironmentInput struct {
	Refresh bool `query:"refresh" doc:"Force refresh cached OpenClaw environment data." example:"false"`
}

type OpenClawEnvironmentOutput struct {
	Body OpenClawEnvironmentResponse
}

type OpenClawGatewayActionOutput struct {
	Body OpenClawGatewayActionResponse
}

type OpenClawEnvironmentResponse struct {
	Status    string              `json:"status" example:"ok" doc:"OpenClaw environment detection status."`
	Timestamp string              `json:"timestamp" example:"2026-05-11T15:59:00Z" doc:"UTC response timestamp."`
	Cache     OpenClawCacheInfo   `json:"cache" doc:"Cache behavior used for this response."`
	CLI       OpenClawCLIInfo     `json:"cli" doc:"OpenClaw CLI availability and version information."`
	Home      OpenClawHomeInfo    `json:"home" doc:"OpenClaw configuration directory information."`
	Gateway   OpenClawGatewayInfo `json:"gateway" doc:"OpenClaw Gateway local runtime information."`
	Checks    []OpenClawCheck     `json:"checks" doc:"Readiness checks for local OpenClaw management."`
	Summary   string              `json:"summary" example:"OpenClaw CLI available, Gateway reachable." doc:"Human-readable summary."`
}

type OpenClawCLIInfo struct {
	Available bool   `json:"available" example:"true" doc:"Whether the openclaw CLI is available."`
	Path      string `json:"path,omitempty" example:"/Users/one/.npm-global/bin/openclaw" doc:"Resolved openclaw executable path."`
	Version   string `json:"version,omitempty" example:"openclaw 2026.5.6" doc:"OpenClaw CLI version output."`
	Source    string `json:"source,omitempty" example:"npm-official" doc:"Best-effort install source classification."`
	Error     string `json:"error,omitempty" doc:"CLI detection error."`
}

type OpenClawHomeInfo struct {
	Path            string `json:"path" example:"/Users/one/.openclaw" doc:"OpenClaw home/config directory. Empty when missing."`
	Exists          bool   `json:"exists" example:"true" doc:"Whether OpenClaw home exists."`
	ConfigPath      string `json:"configPath" example:"/Users/one/.openclaw/openclaw.json" doc:"OpenClaw config file path. Empty when missing."`
	ConfigExists    bool   `json:"configExists" example:"true" doc:"Whether openclaw.json exists."`
	ConfigValid     bool   `json:"configValid" example:"true" doc:"Whether openclaw.json can be parsed."`
	ConfigError     string `json:"configError,omitempty" doc:"Config parse/read error when any."`
	DeviceKeyPath   string `json:"deviceKeyPath" example:"/Users/one/.openclaw/identity/device.json" doc:"OpenClaw device identity path. Empty when missing."`
	DeviceKeyExists bool   `json:"deviceKeyExists" example:"true" doc:"Whether OpenClaw device identity exists."`
	OwnerPath       string `json:"ownerPath" example:"/Users/one/.openclaw/gateway-owner.json" doc:"Gateway owner record path. Empty when missing."`
	OwnerExists     bool   `json:"ownerExists" example:"true" doc:"Whether Gateway owner record exists."`
	LogsDir         string `json:"logsDir" example:"/Users/one/.openclaw/logs" doc:"OpenClaw logs directory. Empty when missing."`
	LogsDirExists   bool   `json:"logsDirExists" example:"true" doc:"Whether OpenClaw logs directory exists."`
	ErrLogPath      string `json:"errLogPath" example:"/Users/one/.openclaw/logs/gateway.err.log" doc:"Gateway error log path. Empty when missing."`
	ErrLogExists    bool   `json:"errLogExists" example:"true" doc:"Whether Gateway error log exists."`
	ErrLogBytes     int64  `json:"errLogBytes,omitempty" example:"1024" doc:"Gateway error log size in bytes."`
	ErrLogHasFatal  bool   `json:"errLogHasFatal" example:"false" doc:"Whether recent error log tail contains fatal markers."`
}

type OpenClawGatewayInfo struct {
	Port               int                  `json:"port" example:"18789" doc:"Gateway listen port resolved from openclaw.json or default."`
	URL                string               `json:"url" example:"http://127.0.0.1:18789" doc:"Local Gateway HTTP URL."`
	WebSocketURL       string               `json:"webSocketUrl" example:"ws://127.0.0.1:18789" doc:"Local Gateway WebSocket URL."`
	PublicURL          string               `json:"publicUrl,omitempty" example:"https://openclaw.example.com" doc:"Public Gateway HTTP URL for browser clients when configured."`
	PublicWebSocketURL string               `json:"publicWebSocketUrl,omitempty" example:"wss://openclaw.example.com" doc:"Public Gateway WebSocket URL for browser clients when configured."`
	Bind               string               `json:"bind,omitempty" example:"lan" doc:"Configured Gateway bind mode when present."`
	AuthMode           string               `json:"authMode" example:"token" doc:"Configured auth mode: token, password, none, config_missing, or config_parse_error."`
	AllowedOrigins     []string             `json:"allowedOrigins,omitempty" doc:"Configured control UI allowed origins."`
	TCPReachable       bool                 `json:"tcpReachable" example:"true" doc:"Whether 127.0.0.1:port accepts TCP connections."`
	HTTPHealthOK       bool                 `json:"httpHealthOk" example:"true" doc:"Whether /health responds with 2xx."`
	HTTPHealthStatus   int                  `json:"httpHealthStatus,omitempty" example:"200" doc:"HTTP status from /health when reachable."`
	HealthzOK          bool                 `json:"healthzOk" example:"true" doc:"Whether /healthz responds with 2xx."`
	ReadyzOK           bool                 `json:"readyzOk" example:"true" doc:"Whether /readyz responds with 2xx."`
	OwnerPID           int                  `json:"ownerPid,omitempty" example:"12345" doc:"PID recorded in gateway-owner.json when available."`
	OwnerStartedBy     string               `json:"ownerStartedBy,omitempty" example:"clawpanel" doc:"Owner source from gateway-owner.json when available."`
	OwnerMatchesPort   bool                 `json:"ownerMatchesPort" example:"true" doc:"Whether owner record port matches resolved Gateway port."`
	OwnerMatchesHome   bool                 `json:"ownerMatchesHome" example:"true" doc:"Whether owner record OpenClaw directory matches resolved home."`
	OwnerMatchesCLI    bool                 `json:"ownerMatchesCli" example:"true" doc:"Whether owner record CLI path matches resolved CLI when both are available."`
	OwnerRecordStatus  string               `json:"ownerRecordStatus,omitempty" example:"matched" doc:"Owner record summary status."`
	OwnerProcess       *OpenClawProcessInfo `json:"ownerProcess,omitempty" doc:"Runtime process snapshot for ownerPid when available."`
}

type OpenClawProcessInfo struct {
	PID           int     `json:"pid" example:"12345" doc:"Process ID."`
	Detected      bool    `json:"detected" example:"true" doc:"Whether process information was resolved from the operating system."`
	State         string  `json:"state,omitempty" example:"S" doc:"Operating system process state from ps."`
	StartedAt     string  `json:"startedAt,omitempty" example:"2026-05-15T04:19:49Z" doc:"Best-effort process start time in RFC3339 format."`
	Uptime        string  `json:"uptime,omitempty" example:"01:41:52" doc:"Human-readable elapsed runtime from ps etime."`
	UptimeSeconds int64   `json:"uptimeSeconds,omitempty" example:"6112" doc:"Elapsed runtime in seconds when parseable."`
	CPUPercent    float64 `json:"cpuPercent,omitempty" example:"0.5" doc:"Current process CPU percentage from ps."`
	MemoryPercent float64 `json:"memoryPercent,omitempty" example:"0.8" doc:"Current process memory percentage from ps."`
	RSSBytes      int64   `json:"rssBytes,omitempty" example:"547987456" doc:"Resident set size in bytes."`
	RSSMB         float64 `json:"rssMb,omitempty" example:"522.6" doc:"Resident set size in MiB, rounded to one decimal."`
	Command       string  `json:"command,omitempty" doc:"Process command line."`
	Error         string  `json:"error,omitempty" doc:"Process inspection error when any."`
}

type OpenClawCheck struct {
	Name       string `json:"name" example:"cli" doc:"Check name."`
	OK         bool   `json:"ok" example:"true" doc:"Whether the check passed."`
	Message    string `json:"message" example:"OpenClaw CLI available." doc:"Check result message."`
	DurationMs int64  `json:"durationMs" example:"5" doc:"Check duration in milliseconds."`
}

type OpenClawGatewayActionResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-13T03:30:00Z" doc:"UTC response timestamp."`
	Action    string `json:"action" example:"restart" doc:"Gateway action that was requested."`
	Message   string `json:"message" doc:"Human-readable operation summary."`
	Stdout    string `json:"stdout,omitempty" doc:"Command stdout."`
	Stderr    string `json:"stderr,omitempty" doc:"Command stderr."`
}

type openClawConfigShape struct {
	Gateway struct {
		Port int    `json:"port"`
		Bind string `json:"bind"`
		Auth struct {
			Token    string `json:"token"`
			Password string `json:"password"`
		} `json:"auth"`
		ControlUI struct {
			AllowedOrigins []string `json:"allowedOrigins"`
		} `json:"controlUi"`
	} `json:"gateway"`
}

type gatewayOwnerShape struct {
	PID         int    `json:"pid"`
	Port        int    `json:"port"`
	CLIPath     string `json:"cli_path"`
	OpenClawDir string `json:"openclaw_dir"`
	StartedBy   string `json:"started_by"`
}

func OpenClawEnvironment(ctx context.Context, input *OpenClawEnvironmentInput) (*OpenClawEnvironmentOutput, error) {
	if input == nil {
		input = &OpenClawEnvironmentInput{}
	}

	body := cached(&openClawEnvironmentCache, 10*time.Second, input.Refresh, func() OpenClawEnvironmentResponse {
		return detectOpenClawEnvironment(ctx)
	})
	body.Timestamp = time.Now().UTC().Format(time.RFC3339)
	body.Cache = OpenClawCacheInfo{Refresh: input.Refresh}

	return &OpenClawEnvironmentOutput{Body: body}, nil
}

func RestartOpenClawGateway(ctx context.Context, input *struct{}) (*OpenClawGatewayActionOutput, error) {
	before := detectOpenClawEnvironment(ctx)
	_, _, _ = ensureOpenClawControlUIAllowedOrigins("", "")
	if openClawRunningInContainer() {
		response := OpenClawGatewayActionResponse{
			Status:    "ok",
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Action:    "restart",
			Message:   "Gateway process restarted.",
		}
		var lines []string
		if err := restartOpenClawGatewayProcessInContainer(ctx, before, func(line string) {
			lines = append(lines, line)
		}); err != nil {
			return nil, huma.Error500InternalServerError("openclaw gateway restart failed", err)
		}
		response.Stdout = strings.TrimSpace(strings.Join(lines, "\n"))
		appendOpenClawGatewayAutoApproveResult(ctx, &response)
		invalidateOpenClawEnvironmentCache()
		return &OpenClawGatewayActionOutput{Body: response}, nil
	}

	output, err := runOpenClawGatewayAction(ctx, "restart", 45*time.Second)
	if err != nil {
		return nil, err
	}
	if !gatewayActionWasServiceNotLoaded(output.Body.Stdout, output.Body.Stderr) {
		appendOpenClawGatewayAutoApproveResult(ctx, &output.Body)
		invalidateOpenClawEnvironmentCache()
		return output, nil
	}

	if gatewayStillReachable(ctx, before.Gateway.Port) {
		if err := stopGatewayOwnerProcess(ctx, before.Gateway); err != nil {
			return nil, huma.Error409Conflict("openclaw gateway restart could not stop the running gateway", err)
		}
	}
	if err := startDetachedOpenClawGateway(before.Home.LogsDir, before.Gateway.Port); err != nil {
		return nil, huma.Error500InternalServerError("openclaw gateway restart failed to start foreground gateway", err)
	}
	if !waitGatewayReachable(ctx, before.Gateway.Port, 12*time.Second) {
		return nil, huma.Error500InternalServerError("openclaw gateway restart timed out", errors.New("gateway did not become reachable"))
	}

	output.Body.Message = "Gateway process restarted."
	output.Body.Stdout = strings.TrimSpace(strings.Join([]string{output.Body.Stdout, "Restarted Gateway process."}, "\n"))
	appendOpenClawGatewayAutoApproveResult(ctx, &output.Body)
	invalidateOpenClawEnvironmentCache()
	return output, nil
}

func restartOpenClawGatewayProcessInContainer(ctx context.Context, environment OpenClawEnvironmentResponse, addLog func(string)) error {
	if addLog == nil {
		addLog = func(string) {}
	}
	addLog("检测到容器环境，跳过 systemd Gateway restart，改用直接进程重启。")
	if changed, err := ensureOpenClawContainerGatewayConfig(); err != nil {
		return fmt.Errorf("update container gateway config: %w", err)
	} else if changed {
		addLog("已更新容器 Gateway 监听配置。")
		environment = detectOpenClawEnvironment(ctx)
	}

	port := environment.Gateway.Port
	if port <= 0 {
		port = 18789
	}
	logsDir := environment.Home.LogsDir
	if strings.TrimSpace(logsDir) == "" {
		logsDir = filepath.Join(defaultOpenClawHomeDir(), "logs")
	}

	if gatewayStillReachable(ctx, port) {
		addLog("停止当前 Gateway 进程。")
		if err := stopOpenClawGatewayProcess(ctx, environment.Gateway); err != nil {
			return fmt.Errorf("stop gateway process: %w", err)
		}
	}

	if waitGatewayReachable(ctx, port, 8*time.Second) {
		addLog("Gateway 已由容器守护进程恢复监听。")
		invalidateOpenClawEnvironmentCache()
		return nil
	}

	addLog("执行 openclaw gateway run（后台进程）。")
	if err := startDetachedOpenClawGateway(logsDir, port); err != nil {
		return fmt.Errorf("start gateway process: %w", err)
	}
	if waitGatewayReachable(ctx, port, 15*time.Second) {
		addLog("Gateway 进程已重启并开始监听端口。")
		invalidateOpenClawEnvironmentCache()
		return nil
	}
	return errors.New("Gateway 进程重启后端口仍未监听，请稍后在服务管理页重试")
}

func StopOpenClawGateway(ctx context.Context, input *struct{}) (*OpenClawGatewayActionOutput, error) {
	before := detectOpenClawEnvironment(ctx)
	output, err := runOpenClawGatewayAction(ctx, "stop", 30*time.Second)
	if err != nil {
		return nil, err
	}

	if gatewayStillReachable(ctx, before.Gateway.Port) {
		if err := stopGatewayOwnerProcess(ctx, before.Gateway); err != nil {
			return nil, huma.Error409Conflict("openclaw gateway stop did not stop the running gateway", err)
		}
		output.Body.Message = "Gateway process stopped."
		output.Body.Stdout = strings.TrimSpace(strings.Join([]string{output.Body.Stdout, "Stopped Gateway owner process."}, "\n"))
	}

	if gatewayStillReachable(ctx, before.Gateway.Port) {
		return nil, huma.Error409Conflict("openclaw gateway is still reachable after stop", errors.New("gateway port is still reachable"))
	}

	invalidateOpenClawEnvironmentCache()
	return output, nil
}

func runOpenClawGatewayAction(ctx context.Context, action string, timeout time.Duration) (*OpenClawGatewayActionOutput, error) {
	stdout, stderr, err := openClawCommand(ctx, timeout, "gateway", action)
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw gateway "+action+" failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
	}
	invalidateOpenClawEnvironmentCache()
	return &OpenClawGatewayActionOutput{Body: OpenClawGatewayActionResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Action:    action,
		Message:   "Gateway " + action + " finished.",
		Stdout:    strings.TrimSpace(stdout),
		Stderr:    strings.TrimSpace(stderr),
	}}, nil
}

func gatewayActionWasServiceNotLoaded(stdout string, stderr string) bool {
	return strings.Contains(strings.ToLower(stdout+"\n"+stderr), "not loaded")
}

func appendOpenClawGatewayAutoApproveResult(ctx context.Context, response *OpenClawGatewayActionResponse) {
	if response == nil {
		return
	}
	result, err := autoApproveOpenClawGatewayDevices(ctx, nil)
	if err != nil {
		response.Stderr = strings.TrimSpace(strings.Join([]string{response.Stderr, "Gateway device auto-approval failed: " + err.Error()}, "\n"))
		return
	}
	if result.Approved == 0 && result.Skipped == 0 {
		response.Stdout = strings.TrimSpace(strings.Join([]string{response.Stdout, "No pending Gateway devices to approve."}, "\n"))
		return
	}
	for _, message := range result.Messages {
		response.Stdout = strings.TrimSpace(strings.Join([]string{response.Stdout, message}, "\n"))
	}
	if result.Skipped > 0 {
		response.Stdout = strings.TrimSpace(strings.Join([]string{response.Stdout, fmt.Sprintf("Skipped %d Gateway device request(s).", result.Skipped)}, "\n"))
	}
}

func startDetachedOpenClawGateway(logsDir string, port int) error {
	if strings.TrimSpace(logsDir) == "" {
		logsDir = filepath.Join(defaultOpenClawHomeDir(), "logs")
	}
	if err := os.MkdirAll(logsDir, 0o755); err != nil {
		return err
	}
	if port <= 0 {
		port = 18789
	}
	compileCacheDir := filepath.Join(os.TempDir(), "openclaw-compile-cache")
	_ = os.MkdirAll(compileCacheDir, 0o755)
	logFile, err := os.OpenFile(filepath.Join(logsDir, "gateway.err.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer logFile.Close()

	openClawPath := toolenv.ResolveToolPath("openclaw")
	if openClawPath == "" {
		openClawPath = "openclaw"
	}
	cmd := exec.Command(openClawPath, "gateway", "run")
	cmd.Env = append(toolenv.CommandEnv(),
		"NODE_COMPILE_CACHE="+compileCacheDir,
		"OPENCLAW_NO_RESPAWN=1",
		"OPENCLAW_GATEWAY_PORT="+strconv.Itoa(port),
	)
	if openClawRunningInContainer() {
		cmd.Env = append(cmd.Env, "OPENCLAW_GATEWAY_BIND=lan")
	}
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

func stopGatewayOwnerProcess(ctx context.Context, gateway OpenClawGatewayInfo) error {
	if gateway.OwnerPID <= 0 {
		return errors.New("gateway owner pid is missing")
	}
	if gateway.OwnerRecordStatus != "matched" {
		return fmt.Errorf("gateway owner record is not matched: %s", gateway.OwnerRecordStatus)
	}

	process, err := os.FindProcess(gateway.OwnerPID)
	if err != nil {
		return err
	}
	if err := process.Signal(os.Interrupt); err != nil {
		if killErr := process.Kill(); killErr != nil {
			return errors.Join(err, killErr)
		}
	}
	if waitGatewayUnavailable(ctx, gateway.Port, 4*time.Second) {
		return nil
	}
	if err := process.Kill(); err != nil {
		return err
	}
	if waitGatewayUnavailable(ctx, gateway.Port, 3*time.Second) {
		return nil
	}
	return errors.New("gateway process did not exit")
}

func stopOpenClawGatewayProcess(ctx context.Context, gateway OpenClawGatewayInfo) error {
	port := gateway.Port
	if port <= 0 {
		port = 18789
	}
	pid := gateway.OwnerPID
	if listenPID := detectOpenClawGatewayListenPID(ctx, port); listenPID > 0 {
		pid = listenPID
	}
	if pid <= 0 {
		return errors.New("gateway listen pid is missing")
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	if err := process.Signal(os.Interrupt); err != nil {
		_ = process.Kill()
	}
	if waitGatewayUnavailable(ctx, port, 5*time.Second) {
		return nil
	}
	if err := process.Kill(); err != nil {
		return err
	}
	if waitGatewayUnavailable(ctx, port, 5*time.Second) {
		return nil
	}
	return errors.New("gateway process did not exit")
}

func gatewayStillReachable(ctx context.Context, port int) bool {
	if port <= 0 {
		return false
	}
	return tcpReachable("127.0.0.1", port, 250*time.Millisecond)
}

func waitGatewayReachable(ctx context.Context, port int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for {
		if gatewayStillReachable(ctx, port) {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(250 * time.Millisecond):
		}
	}
}

func waitGatewayUnavailable(ctx context.Context, port int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for {
		if !gatewayStillReachable(ctx, port) {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(200 * time.Millisecond):
		}
	}
}

func invalidateOpenClawEnvironmentCache() {
	openClawEnvironmentCache.mu.Lock()
	defer openClawEnvironmentCache.mu.Unlock()
	openClawEnvironmentCache.loaded = false
	openClawEnvironmentCache.expiresAt = time.Time{}
}

func invalidateOpenClawCLIVersionCache() {
	openClawCLIVersionCache.mu.Lock()
	defer openClawCLIVersionCache.mu.Unlock()
	openClawCLIVersionCache.loaded = false
	openClawCLIVersionCache.expiresAt = time.Time{}
	openClawCLIVersionCache.value = openClawCLIVersionCacheValue{}
}

func detectOpenClawEnvironment(ctx context.Context) OpenClawEnvironmentResponse {
	checks := make([]OpenClawCheck, 0, 6)
	cli, cliCheck := detectOpenClawCLI(ctx)
	checks = append(checks, cliCheck)

	home, cfg, homeChecks := detectOpenClawHome()
	checks = append(checks, homeChecks...)

	gateway, gatewayChecks := detectOpenClawGateway(ctx, home, cfg, cli)
	checks = append(checks, gatewayChecks...)

	status := "ok"
	failed := make([]string, 0)
	for _, check := range checks {
		if !check.OK {
			status = "warning"
			failed = append(failed, check.Name)
		}
	}

	summary := "OpenClaw 环境检测通过"
	if len(failed) > 0 {
		summary = "以下检查需要关注: " + strings.Join(failed, ", ")
	}

	return OpenClawEnvironmentResponse{
		Status:    status,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		CLI:       cli,
		Home:      home,
		Gateway:   gateway,
		Checks:    checks,
		Summary:   summary,
	}
}

func detectOpenClawCLI(ctx context.Context) (OpenClawCLIInfo, OpenClawCheck) {
	start := time.Now()
	path := toolenv.ResolveToolPath("openclaw")
	if path == "" {
		_, err := exec.LookPath("openclaw")
		errorText := "executable file not found"
		if err != nil {
			errorText = err.Error()
		}
		info := OpenClawCLIInfo{Available: false, Error: errorText}
		return info, finishOpenClawCheck("cli", false, "未找到 openclaw CLI，请先安装或修正 PATH", start)
	}

	version := cachedOpenClawCLIVersion(ctx, path)
	info := OpenClawCLIInfo{
		Available: true,
		Path:      path,
		Version:   version,
		Source:    classifyOpenClawCLISource(path),
	}
	return info, finishOpenClawCheck("cli", true, "OpenClaw CLI 可用", start)
}

func cachedOpenClawCLIVersion(ctx context.Context, path string) string {
	load := func() openClawCLIVersionCacheValue {
		return openClawCLIVersionCacheValue{
			Path:    path,
			Version: firstLine(commandOutput(ctx, path, "--version")),
		}
	}

	value := cached(&openClawCLIVersionCache, openClawCLIVersionCacheTTL, false, load)
	if normalizePath(value.Path) == normalizePath(path) {
		return value.Version
	}
	return cached(&openClawCLIVersionCache, openClawCLIVersionCacheTTL, true, load).Version
}

func detectOpenClawHome() (OpenClawHomeInfo, *openClawConfigShape, []OpenClawCheck) {
	checks := make([]OpenClawCheck, 0, 4)
	homeDir := defaultOpenClawHomeDir()
	configPath := filepath.Join(homeDir, "openclaw.json")
	deviceKeyPath := openClawDeviceKeyPath()
	ownerPath := filepath.Join(homeDir, "gateway-owner.json")
	logsDir := filepath.Join(homeDir, "logs")
	errLogPath := filepath.Join(logsDir, "gateway.err.log")

	info := OpenClawHomeInfo{
		Exists:          pathExists(homeDir),
		ConfigExists:    pathExists(configPath),
		DeviceKeyExists: pathExists(deviceKeyPath),
		OwnerExists:     pathExists(ownerPath),
		LogsDirExists:   pathExists(logsDir),
		ErrLogExists:    pathExists(errLogPath),
	}
	if info.Exists {
		info.Path = homeDir
	}
	if info.ConfigExists {
		info.ConfigPath = configPath
	}
	if info.DeviceKeyExists {
		info.DeviceKeyPath = deviceKeyPath
	}
	if info.OwnerExists {
		info.OwnerPath = ownerPath
	}
	if info.LogsDirExists {
		info.LogsDir = logsDir
	}
	if info.ErrLogExists {
		info.ErrLogPath = errLogPath
	}

	checks = append(checks, finishOpenClawCheck("openclaw_home", info.Exists, boolMessage(info.Exists, "OpenClaw 配置目录存在", "OpenClaw 配置目录不存在"), time.Now()))

	configStart := time.Now()
	var cfg openClawConfigShape
	if !info.ConfigExists {
		checks = append(checks, finishOpenClawCheck("config", false, "openclaw.json 不存在", configStart))
	} else {
		content, err := os.ReadFile(configPath)
		if err != nil {
			info.ConfigError = err.Error()
			checks = append(checks, finishOpenClawCheck("config", false, "openclaw.json 读取失败: "+err.Error(), configStart))
		} else if err := json.Unmarshal(content, &cfg); err != nil {
			info.ConfigError = err.Error()
			checks = append(checks, finishOpenClawCheck("config", false, "openclaw.json 解析失败: "+err.Error(), configStart))
		} else {
			info.ConfigValid = true
			checks = append(checks, finishOpenClawCheck("config", true, "openclaw.json 可解析", configStart))
		}
	}

	deviceStart := time.Now()
	info.DeviceKeyExists = pathExists(deviceKeyPath)
	checks = append(checks, finishOpenClawCheck("device_key", info.DeviceKeyExists, boolMessage(info.DeviceKeyExists, "设备密钥存在", "设备密钥不存在，首次配对时可自动生成"), deviceStart))

	logStart := time.Now()
	if info.ErrLogExists {
		if stat, err := os.Stat(errLogPath); err == nil {
			info.ErrLogBytes = stat.Size()
		}
		info.ErrLogHasFatal = recentLogHasFatal(errLogPath)
	}
	checks = append(checks, finishOpenClawCheck("err_log", !info.ErrLogHasFatal, boolMessage(!info.ErrLogHasFatal, "错误日志未发现致命关键字", "错误日志尾部包含 fatal/eaddrinuse/config invalid"), logStart))

	if info.ConfigValid {
		return info, &cfg, checks
	}
	return info, nil, checks
}

func detectOpenClawGateway(ctx context.Context, home OpenClawHomeInfo, cfg *openClawConfigShape, cli OpenClawCLIInfo) (OpenClawGatewayInfo, []OpenClawCheck) {
	checks := make([]OpenClawCheck, 0, 4)
	port := 18789
	gateway := OpenClawGatewayInfo{Port: port, AuthMode: "config_missing"}
	if cfg != nil {
		if cfg.Gateway.Port > 0 && cfg.Gateway.Port < 65536 {
			port = cfg.Gateway.Port
		}
		gateway.Port = port
		gateway.Bind = cfg.Gateway.Bind
		gateway.AllowedOrigins = cfg.Gateway.ControlUI.AllowedOrigins
		gateway.AuthMode = openClawAuthMode(cfg)
	} else if home.ConfigExists {
		gateway.AuthMode = "config_parse_error"
	}

	gateway.URL = fmt.Sprintf("http://127.0.0.1:%d", port)
	gateway.WebSocketURL = fmt.Sprintf("ws://127.0.0.1:%d", port)
	gateway.PublicURL, gateway.PublicWebSocketURL = currentOpenClawPublicGatewayURLs()

	tcpStart := time.Now()
	gateway.TCPReachable = tcpReachable("127.0.0.1", port, time.Second)
	checks = append(checks, finishOpenClawCheck("tcp_port", gateway.TCPReachable, boolMessage(gateway.TCPReachable, fmt.Sprintf("端口 %d 可达", port), fmt.Sprintf("端口 %d 不可达", port)), tcpStart))

	healthStart := time.Now()
	gateway.HTTPHealthOK, gateway.HTTPHealthStatus = probeHTTPStatus(ctx, gateway.URL+"/health", 3*time.Second)
	checks = append(checks, finishOpenClawCheck("http_health", gateway.HTTPHealthOK, boolMessage(gateway.HTTPHealthOK, fmt.Sprintf("/health 返回 %d", gateway.HTTPHealthStatus), "/health 不可用或非 2xx"), healthStart))

	gateway.HealthzOK, _ = probeHTTPStatus(ctx, gateway.URL+"/healthz", 2*time.Second)
	gateway.ReadyzOK, _ = probeHTTPStatus(ctx, gateway.URL+"/readyz", 2*time.Second)

	ownerStart := time.Now()
	applyGatewayOwnerStatus(ctx, &gateway, home, cli)
	ownerOK := gateway.OwnerRecordStatus == "matched" || gateway.OwnerRecordStatus == "missing"
	checks = append(checks, finishOpenClawCheck("gateway_owner", ownerOK, gateway.OwnerRecordStatus, ownerStart))

	return gateway, checks
}

func applyGatewayOwnerStatus(ctx context.Context, gateway *OpenClawGatewayInfo, home OpenClawHomeInfo, cli OpenClawCLIInfo) {
	if !home.OwnerExists {
		gateway.OwnerRecordStatus = "missing"
		applyOpenClawListenProcessFallback(ctx, gateway, 0)
		return
	}

	content, err := os.ReadFile(home.OwnerPath)
	if err != nil {
		gateway.OwnerRecordStatus = "read_error: " + err.Error()
		return
	}

	var owner gatewayOwnerShape
	if err := json.Unmarshal(content, &owner); err != nil {
		gateway.OwnerRecordStatus = "parse_error: " + err.Error()
		return
	}

	gateway.OwnerPID = owner.PID
	gateway.OwnerStartedBy = owner.StartedBy
	if gateway.OwnerPID > 0 {
		gateway.OwnerProcess = detectOpenClawOwnerProcess(ctx, gateway.OwnerPID)
		if !gateway.OwnerProcess.Detected {
			applyOpenClawListenProcessFallback(ctx, gateway, gateway.OwnerPID)
		}
	}
	gateway.OwnerMatchesPort = owner.Port == gateway.Port
	gateway.OwnerMatchesHome = normalizePath(owner.OpenClawDir) == normalizePath(home.Path)
	gateway.OwnerMatchesCLI = owner.CLIPath == "" || cli.Path == "" || normalizePath(owner.CLIPath) == normalizePath(cli.Path)
	if gateway.OwnerMatchesPort && gateway.OwnerMatchesHome && gateway.OwnerMatchesCLI {
		gateway.OwnerRecordStatus = "matched"
		return
	}
	gateway.OwnerRecordStatus = "mismatch"
}

func applyOpenClawListenProcessFallback(ctx context.Context, gateway *OpenClawGatewayInfo, stalePID int) {
	if !gateway.TCPReachable {
		return
	}
	listenPID := detectOpenClawGatewayListenPID(ctx, gateway.Port)
	if listenPID <= 0 || listenPID == stalePID {
		return
	}
	fallback := detectOpenClawOwnerProcess(ctx, listenPID)
	if !fallback.Detected {
		return
	}
	if stalePID > 0 {
		fallback.Error = fmt.Sprintf("owner pid %d is stale: %s", stalePID, firstNonEmpty(gateway.OwnerProcess.Error, "process not detected"))
	}
	gateway.OwnerPID = listenPID
	gateway.OwnerProcess = fallback
}

func detectOpenClawOwnerProcess(ctx context.Context, pid int) *OpenClawProcessInfo {
	info := &OpenClawProcessInfo{PID: pid}
	if pid <= 0 {
		info.Error = "missing pid"
		return info
	}

	cmdCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	cmd := exec.CommandContext(
		cmdCtx,
		"ps",
		"-p",
		strconv.Itoa(pid),
		"-o",
		"pid=,stat=,lstart=,etime=,%cpu=,%mem=,rss=,command=",
	)
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
	startedAt := parsePSStartTime(fields[2:7])
	if !startedAt.IsZero() {
		info.StartedAt = startedAt.Format(time.RFC3339)
	}
	info.Uptime = fields[7]
	info.UptimeSeconds = parsePSElapsedSeconds(fields[7])
	info.CPUPercent = parseFloatField(fields[8])
	info.MemoryPercent = parseFloatField(fields[9])
	rssKB, _ := strconv.ParseInt(fields[10], 10, 64)
	if rssKB > 0 {
		info.RSSBytes = rssKB * 1024
		info.RSSMB = math.Round((float64(info.RSSBytes)/1024/1024)*10) / 10
	}
	if len(fields) > 11 {
		info.Command = strings.Join(fields[11:], " ")
	}
	return info
}

func detectOpenClawGatewayListenPID(ctx context.Context, port int) int {
	if port <= 0 || port >= 65536 {
		return 0
	}

	if pid := detectOpenClawGatewayListenPIDWithLsof(ctx, port); pid > 0 {
		return pid
	}
	return detectOpenClawGatewayListenPIDWithSS(ctx, port)
}

func detectOpenClawGatewayListenPIDWithLsof(ctx context.Context, port int) int {
	cmdCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, "lsof", "-nP", "-iTCP:"+strconv.Itoa(port), "-sTCP:LISTEN", "-Fp")
	cmd.Env = toolenv.CommandEnv()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "p") {
			continue
		}
		pid, err := strconv.Atoi(strings.TrimPrefix(line, "p"))
		if err == nil && pid > 0 {
			return pid
		}
	}
	return 0
}

func detectOpenClawGatewayListenPIDWithSS(ctx context.Context, port int) int {
	cmdCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, "ss", "-lntp")
	cmd.Env = toolenv.CommandEnv()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return 0
	}

	portSuffix := ":" + strconv.Itoa(port)
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if !strings.Contains(line, portSuffix) || !strings.Contains(line, "LISTEN") {
			continue
		}
		if pid := parseOpenClawSSPID(line); pid > 0 {
			return pid
		}
	}
	return 0
}

func parseOpenClawSSPID(line string) int {
	const marker = "pid="
	index := strings.Index(line, marker)
	if index < 0 {
		return 0
	}
	rest := line[index+len(marker):]
	end := 0
	for end < len(rest) && rest[end] >= '0' && rest[end] <= '9' {
		end++
	}
	if end == 0 {
		return 0
	}
	pid, err := strconv.Atoi(rest[:end])
	if err != nil || pid <= 0 {
		return 0
	}
	return pid
}

func parsePSStartTime(parts []string) time.Time {
	if len(parts) != 5 {
		return time.Time{}
	}
	value := strings.Join(parts, " ")
	parsed, err := time.ParseInLocation("Mon Jan 2 15:04:05 2006", value, time.Local)
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

func openClawAuthMode(cfg *openClawConfigShape) string {
	if strings.TrimSpace(cfg.Gateway.Auth.Token) != "" {
		return "token"
	}
	if strings.TrimSpace(cfg.Gateway.Auth.Password) != "" {
		return "password"
	}
	return "none"
}

func classifyOpenClawCLISource(cliPath string) string {
	lower := strings.ToLower(strings.ReplaceAll(cliPath, "\\", "/"))
	switch {
	case strings.Contains(lower, "/programs/openclaw/") || strings.Contains(lower, "/openclaw-bin/") || strings.Contains(lower, "/opt/openclaw/"):
		return "standalone"
	case strings.Contains(lower, "openclaw-zh") || strings.Contains(lower, "@qingchencloud"):
		return "npm-zh"
	case strings.Contains(lower, "/node_modules/") || strings.Contains(lower, "/.nvm/") || strings.Contains(lower, "/.npm-global/"):
		return "npm-official"
	case strings.Contains(lower, "/homebrew/") || strings.Contains(lower, "/usr/local/bin"):
		return "npm-global"
	default:
		return "unknown"
	}
}

func defaultOpenClawHomeDir() string {
	if value := strings.TrimSpace(os.Getenv("OPENCLAW_HOME")); value != "" {
		if filepath.Base(filepath.Clean(value)) != ".openclaw" {
			return filepath.Join(value, ".openclaw")
		}
		return value
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".openclaw"
	}
	return filepath.Join(home, ".openclaw")
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

func probeHTTPStatus(ctx context.Context, url string, timeout time.Duration) (bool, int) {
	client := http.Client{Timeout: timeout}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false, 0
	}
	resp, err := client.Do(req)
	if err != nil {
		return false, 0
	}
	defer resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 300, resp.StatusCode
}

func recentLogHasFatal(path string) bool {
	content, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	if len(content) > 4096 {
		content = content[len(content)-4096:]
	}
	text := strings.ToLower(string(content))
	return strings.Contains(text, "fatal") || strings.Contains(text, "eaddrinuse") || strings.Contains(text, "config invalid")
}

func finishOpenClawCheck(name string, ok bool, message string, start time.Time) OpenClawCheck {
	return OpenClawCheck{
		Name:       name,
		OK:         ok,
		Message:    message,
		DurationMs: time.Since(start).Milliseconds(),
	}
}

func boolMessage(ok bool, okMessage string, failMessage string) string {
	if ok {
		return okMessage
	}
	return failMessage
}

func normalizePath(path string) string {
	if path == "" {
		return ""
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return filepath.Clean(path)
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return filepath.Clean(abs)
	}
	if resolved == "" {
		return filepath.Clean(abs)
	}
	return filepath.Clean(resolved)
}
