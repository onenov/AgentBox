package ccconnect

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"agent-box-server/internal/httpapi/toolenv"

	"github.com/danielgtaylor/huma/v2/sse"
)

type CCConnectTaskStatus string

const (
	CCConnectTaskStatusPending CCConnectTaskStatus = "pending"
	CCConnectTaskStatusRunning CCConnectTaskStatus = "running"
	CCConnectTaskStatusDone    CCConnectTaskStatus = "done"
	CCConnectTaskStatusError   CCConnectTaskStatus = "error"
)

type CCConnectTaskResponse struct {
	ID        string              `json:"id" doc:"Task id."`
	Status    CCConnectTaskStatus `json:"status" doc:"Task status."`
	Progress  int                 `json:"progress" doc:"Task progress percentage."`
	Logs      []string            `json:"logs" doc:"Task logs."`
	StartedAt string              `json:"startedAt" doc:"Task started timestamp."`
	UpdatedAt string              `json:"updatedAt" doc:"Task updated timestamp."`
	Error     string              `json:"error,omitempty" doc:"Task error message."`
}

type CCConnectTaskStreamMetaEvent struct {
	ID        string `json:"id" doc:"Task id."`
	Kind      string `json:"kind" doc:"Task kind."`
	Timestamp string `json:"timestamp" doc:"Event timestamp."`
}

type CCConnectTaskStreamStatusEvent struct {
	ID        string              `json:"id" doc:"Task id."`
	Status    CCConnectTaskStatus `json:"status" doc:"Task status."`
	Progress  int                 `json:"progress" doc:"Task progress percentage."`
	Error     string              `json:"error,omitempty" doc:"Error message when status is error."`
	Timestamp string              `json:"timestamp" doc:"Event timestamp."`
}

type CCConnectTaskStreamLogEvent struct {
	ID        string `json:"id" doc:"Task id."`
	Line      string `json:"line" doc:"Log line."`
	Timestamp string `json:"timestamp" doc:"Event timestamp."`
}

type CCConnectTaskStreamErrorEvent struct {
	ID        string `json:"id" doc:"Task id."`
	Message   string `json:"message" doc:"Error message."`
	Timestamp string `json:"timestamp" doc:"Event timestamp."`
}

type CCConnectTaskStreamDoneEvent struct {
	ID        string `json:"id" doc:"Task id."`
	Timestamp string `json:"timestamp" doc:"Event timestamp."`
}

type ccConnectTaskStep struct {
	label    string
	progress int
	timeout  time.Duration
	run      func(context.Context, ccConnectTaskLogger) error
}

type ccConnectTaskLogger interface {
	addLog(string)
}

type ccConnectTaskStreamRun struct {
	id   string
	kind string
	send sse.Sender
}

func UninstallCCConnectStream(ctx context.Context, input *struct{}, send sse.Sender) {
	_ = input
	streamCCConnectTaskSteps(ctx, send, "cc-connect-uninstall", "uninstall", []ccConnectTaskStep{
		{label: "停止 CC-Connect 运行时", progress: 15, timeout: 45 * time.Second, run: stopCCConnectRuntimeForUninstall},
		{label: "移除 CC-Connect Home 与本地数据", progress: 42, timeout: 2 * time.Minute, run: removeCCConnectHomeForUninstall},
		{label: "清理 Homebrew 配置残留", progress: 55, timeout: 30 * time.Second, run: removeCCConnectPackageConfigForUninstall},
		{label: "卸载 CC-Connect CLI", progress: 82, timeout: 5 * time.Minute, run: removeCCConnectCLIForUninstall},
		{label: "刷新本机服务状态缓存", progress: 96, timeout: 15 * time.Second, run: cleanupCCConnectUninstallCache},
	})
}

func streamCCConnectTaskSteps(ctx context.Context, send sse.Sender, prefix string, kind string, steps []ccConnectTaskStep) {
	id := prefix + "-" + time.Now().UTC().Format("20060102-150405")
	run := ccConnectTaskStreamRun{id: id, kind: kind, send: send}
	if !run.emitMeta() {
		return
	}
	if !run.emitLog("任务已创建。") || !run.emitStatus(CCConnectTaskStatusRunning, 1, "") {
		return
	}
	for _, step := range steps {
		if !run.emitLog("==> "+step.label) || !run.emitStatus(CCConnectTaskStatusRunning, step.progress, "") {
			return
		}
		if step.run == nil {
			continue
		}
		stepCtx := ctx
		var cancel context.CancelFunc
		if step.timeout > 0 {
			stepCtx, cancel = context.WithTimeout(ctx, step.timeout)
		}
		err := step.run(stepCtx, ccConnectStreamTaskAdapter{run: &run})
		if cancel != nil {
			cancel()
		}
		if err != nil {
			run.fail(err)
			return
		}
	}
	invalidateCCConnectEnvironmentCache()
	_ = run.emitStatus(CCConnectTaskStatusDone, 100, "")
	_ = send.Data(CCConnectTaskStreamDoneEvent{ID: id, Timestamp: time.Now().UTC().Format(time.RFC3339)})
}

func (run *ccConnectTaskStreamRun) emitMeta() bool {
	return run.send.Data(CCConnectTaskStreamMetaEvent{
		ID:        run.id,
		Kind:      run.kind,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}) == nil
}

func (run *ccConnectTaskStreamRun) emitStatus(status CCConnectTaskStatus, progress int, errorMessage string) bool {
	return run.send.Data(CCConnectTaskStreamStatusEvent{
		ID:        run.id,
		Status:    status,
		Progress:  progress,
		Error:     errorMessage,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}) == nil
}

func (run *ccConnectTaskStreamRun) emitLog(value string) bool {
	for _, line := range strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n") {
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			continue
		}
		if err := run.send.Data(CCConnectTaskStreamLogEvent{
			ID:        run.id,
			Line:      line,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}); err != nil {
			return false
		}
	}
	return true
}

func (run *ccConnectTaskStreamRun) fail(err error) {
	message := ccConnectTaskErrorMessage(err)
	_ = run.emitLog("失败：" + message)
	_ = run.emitStatus(CCConnectTaskStatusError, 100, message)
	_ = run.send.Data(CCConnectTaskStreamErrorEvent{
		ID:        run.id,
		Message:   message,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	})
}

func ccConnectTaskErrorMessage(err error) string {
	if err == nil {
		return "unknown error"
	}
	messages := []string{strings.TrimSpace(err.Error())}
	for unwrapped := errors.Unwrap(err); unwrapped != nil; unwrapped = errors.Unwrap(unwrapped) {
		message := strings.TrimSpace(unwrapped.Error())
		if message != "" && message != messages[len(messages)-1] {
			messages = append(messages, message)
		}
	}
	return strings.Join(messages, "\n")
}

type ccConnectStreamTaskAdapter struct {
	run *ccConnectTaskStreamRun
}

func (adapter ccConnectStreamTaskAdapter) addLog(value string) {
	if adapter.run != nil {
		adapter.run.emitLog(value)
	}
}

func stopCCConnectRuntimeForUninstall(ctx context.Context, task ccConnectTaskLogger) error {
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
		task.addLog("未检测到 CC-Connect 运行进程，跳过停止。")
		return nil
	}
	task.addLog(fmt.Sprintf("停止 CC-Connect 进程 PID %d。", pid))
	if err := stopProcessByPID(ctx, pid, port); err != nil {
		return err
	}
	task.addLog("CC-Connect 运行时已停止。")
	return nil
}

func removeCCConnectHomeForUninstall(ctx context.Context, task ccConnectTaskLogger) error {
	_ = ctx
	defaultDir := defaultCCConnectDataDir()
	paths := []string{defaultDir}
	if config, _, parsed := detectCCConnectConfig(); parsed != nil {
		dataDir := effectiveCCConnectDataDir(parsed.DataDir)
		if dataDir != "" && dataDir != defaultDir {
			paths = append(paths, dataDir)
		}
		if config.Path != "" && !strings.HasPrefix(filepath.Clean(config.Path), filepath.Clean(defaultDir)+string(os.PathSeparator)) {
			paths = append(paths, config.Path)
		}
	}

	seen := map[string]bool{}
	for _, target := range paths {
		target = strings.TrimSpace(target)
		if target == "" {
			continue
		}
		clean := filepath.Clean(target)
		if seen[clean] {
			continue
		}
		seen[clean] = true
		if !pathExists(clean) {
			task.addLog(clean + " 不存在，无需移除。")
			continue
		}
		task.addLog("移除 " + clean)
		if err := os.RemoveAll(clean); err != nil {
			return err
		}
	}
	return nil
}

func removeCCConnectPackageConfigForUninstall(ctx context.Context, task ccConnectTaskLogger) error {
	_ = ctx
	candidates := []string{
		"/opt/homebrew/etc/cc-connect",
		"/usr/local/etc/cc-connect",
	}
	for _, target := range candidates {
		if !pathExists(target) {
			continue
		}
		task.addLog("移除包管理器配置残留 " + target)
		if err := os.RemoveAll(target); err != nil {
			return err
		}
	}
	return nil
}

func removeCCConnectCLIForUninstall(ctx context.Context, task ccConnectTaskLogger) error {
	beforePath := toolenv.ResolveToolPath("cc-connect")
	if beforePath == "" {
		task.addLog("cc-connect CLI 已不可用，无需继续卸载 CLI。")
		return nil
	}

	attempt, ok := ccConnectCLIUninstallAttemptForPath(beforePath)
	if !ok {
		return fmt.Errorf("cc-connect CLI 仍存在，但无法识别安装来源或缺少对应卸载器: %s", beforePath)
	}

	task.addLog("检测到 cc-connect 安装来源：" + attempt.source + "（" + beforePath + "）")
	if attempt.source == "Homebrew" && !homebrewCCConnectKegExists() {
		task.addLog("Homebrew keg 已不存在，跳过 brew uninstall，仅清理残留入口。")
	} else {
		task.addLog("执行 " + attempt.commandLine())
		if err := runCCConnectExternalStreamingCommand(ctx, 5*time.Minute, task.addLog, attempt.name, attempt.args...); err != nil {
			return fmt.Errorf("%s 卸载失败: %w", attempt.source, err)
		}
	}
	if err := cleanupCCConnectCLIPathAfterUninstall(beforePath, task); err != nil {
		return err
	}
	currentPath := toolenv.ResolveToolPath("cc-connect")
	if currentPath != "" {
		return fmt.Errorf("cc-connect CLI 仍存在: %s。已按安装来源执行过: %s", currentPath, attempt.commandLine())
	}
	task.addLog("CC-Connect CLI 已卸载。")
	return nil
}

func cleanupCCConnectUninstallCache(ctx context.Context, task ccConnectTaskLogger) error {
	if err := saveCCConnectAutoStart(ctx, false); err != nil {
		return err
	}
	invalidateCCConnectEnvironmentCache()
	task.addLog("已关闭 AgentBox 托管自动启动并刷新 CC-Connect 环境缓存。")
	return nil
}

type ccConnectCLIUninstallAttempt struct {
	source string
	name   string
	args   []string
}

func (attempt ccConnectCLIUninstallAttempt) commandLine() string {
	return strings.TrimSpace(attempt.name + " " + strings.Join(attempt.args, " "))
}

func ccConnectCLIUninstallAttemptForPath(cliPath string) (ccConnectCLIUninstallAttempt, bool) {
	lowerPath := strings.ToLower(strings.ReplaceAll(cliPath, "\\", "/"))
	switch {
	case strings.Contains(lowerPath, "homebrew") || strings.Contains(lowerPath, "/opt/homebrew/") || strings.Contains(lowerPath, "/usr/local/"):
		return ccConnectCLIUninstallAttempt{source: "Homebrew", name: "brew", args: []string{"uninstall", "cc-connect"}}, toolenv.ResolveToolPath("brew") != ""
	case strings.Contains(lowerPath, "pnpm"):
		return ccConnectCLIUninstallAttempt{source: "pnpm", name: "pnpm", args: []string{"remove", "-g", "cc-connect"}}, toolenv.ResolveToolPath("pnpm") != ""
	case strings.Contains(lowerPath, "yarn"):
		return ccConnectCLIUninstallAttempt{source: "Yarn", name: "yarn", args: []string{"global", "remove", "cc-connect"}}, toolenv.ResolveToolPath("yarn") != ""
	case strings.Contains(lowerPath, "bun"):
		return ccConnectCLIUninstallAttempt{source: "Bun", name: "bun", args: []string{"remove", "-g", "cc-connect"}}, toolenv.ResolveToolPath("bun") != ""
	case strings.Contains(lowerPath, "/node_modules/") || strings.Contains(lowerPath, "/npm/") || strings.Contains(lowerPath, "/nvm/") || strings.Contains(lowerPath, "/fnm/") || strings.Contains(lowerPath, "/volta/"):
		return ccConnectCLIUninstallAttempt{source: "npm", name: "npm", args: []string{"uninstall", "-g", "cc-connect"}}, toolenv.ResolveToolPath("npm") != ""
	default:
		if toolenv.ResolveToolPath("npm") != "" {
			return ccConnectCLIUninstallAttempt{source: "npm", name: "npm", args: []string{"uninstall", "-g", "cc-connect"}}, true
		}
		return ccConnectCLIUninstallAttempt{}, false
	}
}

func homebrewCCConnectKegExists() bool {
	return pathExists("/opt/homebrew/Cellar/cc-connect") || pathExists("/usr/local/Cellar/cc-connect")
}

func cleanupCCConnectCLIPathAfterUninstall(cliPath string, task ccConnectTaskLogger) error {
	if strings.TrimSpace(cliPath) == "" || !pathExistsOrSymlink(cliPath) {
		return nil
	}
	if resolved, err := filepath.EvalSymlinks(cliPath); err == nil && resolved != "" && pathExists(resolved) {
		return nil
	}
	if strings.Contains(strings.ToLower(strings.ReplaceAll(cliPath, "\\", "/")), "homebrew") || strings.HasPrefix(cliPath, "/opt/homebrew/bin/") || strings.HasPrefix(cliPath, "/usr/local/bin/") {
		task.addLog("清理卸载后残留的 CLI 链接：" + cliPath)
		return os.Remove(cliPath)
	}
	return nil
}

func runCCConnectExternalStreamingCommand(ctx context.Context, timeout time.Duration, writeOutput func(string), name string, args ...string) error {
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	path := toolenv.ResolveToolPath(name)
	if path == "" {
		path = name
	}
	cmd := exec.CommandContext(cmdCtx, path, args...)
	cmd.Env = toolenv.CommandEnv()
	cmd.Stdout = ccConnectTaskWriter{write: writeOutput}
	cmd.Stderr = ccConnectTaskWriter{write: writeOutput}
	err := cmd.Run()
	if cmdCtx.Err() != nil {
		return cmdCtx.Err()
	}
	return err
}

type ccConnectTaskWriter struct {
	write func(string)
}

func (writer ccConnectTaskWriter) Write(data []byte) (int, error) {
	if writer.write != nil {
		writer.write(string(data))
	}
	return len(data), nil
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func pathExistsOrSymlink(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}
