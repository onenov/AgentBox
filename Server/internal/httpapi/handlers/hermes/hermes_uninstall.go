package hermes

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"agent-box-server/internal/httpapi/logfilter"
	"agent-box-server/internal/httpapi/toolenv"

	"github.com/danielgtaylor/huma/v2/sse"
)

type HermesTaskStreamMetaEvent struct {
	ID        string `json:"id" doc:"Stream task id."`
	Kind      string `json:"kind" doc:"Task kind."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type HermesTaskStreamStatusEvent struct {
	ID        string `json:"id" doc:"Stream task id."`
	Status    string `json:"status" doc:"Task status."`
	Progress  int    `json:"progress" doc:"Task progress from 0 to 100."`
	Error     string `json:"error,omitempty" doc:"Error message when status is error."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type HermesTaskStreamLogEvent struct {
	ID        string `json:"id" doc:"Stream task id."`
	Line      string `json:"line" doc:"Log line."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type HermesTaskStreamErrorEvent struct {
	ID        string `json:"id" doc:"Stream task id."`
	Message   string `json:"message" doc:"Error message."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type HermesTaskStreamDoneEvent struct {
	ID        string `json:"id" doc:"Stream task id."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type hermesTaskStep struct {
	label    string
	progress int
	timeout  time.Duration
	run      func(context.Context, hermesTaskLogger) error
}

type hermesTaskLogger interface {
	addLog(string)
}

type hermesTaskStreamRun struct {
	id       string
	kind     string
	mu       sync.Mutex
	send     sse.Sender
	qrFilter logfilter.TerminalQRFilter
}

func UninstallHermesStream(ctx context.Context, input *struct{}, send sse.Sender) {
	_ = input
	streamHermesTaskSteps(ctx, send, "hermes-uninstall", "uninstall", []hermesTaskStep{
		{label: "停止 Hermes Gateway", progress: 12, timeout: 45 * time.Second, run: stopHermesGatewayForUninstall},
		{label: "清理 Hermes 终端会话记录", progress: 24, timeout: 15 * time.Second, run: clearHermesTerminalSessionsForUninstall},
		{label: "移除 Hermes Home 与本地数据", progress: 45, timeout: 2 * time.Minute, run: removeHermesHomeForUninstall},
		{label: "卸载 Hermes CLI", progress: 82, timeout: 5 * time.Minute, run: removeHermesCLIForUninstall},
		{label: "刷新本机服务状态缓存", progress: 96, timeout: 15 * time.Second, run: cleanupHermesUninstallCache},
	})
}

func streamHermesTaskSteps(ctx context.Context, send sse.Sender, prefix string, kind string, steps []hermesTaskStep) {
	id := prefix + "-" + time.Now().UTC().Format("20060102-150405")
	run := hermesTaskStreamRun{id: id, kind: kind, send: send}
	if !run.emitMeta() {
		return
	}
	if !run.emitLog("任务已创建。") || !run.emitStatus("running", 1, "") {
		return
	}
	for _, step := range steps {
		if !run.emitLog("==> "+step.label) || !run.emitStatus("running", step.progress, "") {
			return
		}
		if step.run == nil {
			continue
		}
		if err := runHermesTaskStepWithHeartbeat(ctx, &run, step); err != nil {
			run.fail(err)
			return
		}
	}
	invalidateHermesEnvironmentCache()
	_ = run.emitStatus("done", 100, "")
	_ = send.Data(HermesTaskStreamDoneEvent{ID: id, Timestamp: time.Now().UTC().Format(time.RFC3339)})
}

func (run *hermesTaskStreamRun) emitMeta() bool {
	run.mu.Lock()
	defer run.mu.Unlock()
	return run.send.Data(HermesTaskStreamMetaEvent{
		ID:        run.id,
		Kind:      run.kind,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}) == nil
}

func (run *hermesTaskStreamRun) emitStatus(status string, progress int, errorMessage string) bool {
	run.mu.Lock()
	defer run.mu.Unlock()
	return run.send.Data(HermesTaskStreamStatusEvent{
		ID:        run.id,
		Status:    status,
		Progress:  progress,
		Error:     errorMessage,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}) == nil
}

func (run *hermesTaskStreamRun) emitLog(value string) bool {
	for _, line := range strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n") {
		line = strings.TrimRight(line, "\r\n")
		if line == "" || !run.qrFilter.AllowLine(line) {
			continue
		}
		run.mu.Lock()
		if err := run.send.Data(HermesTaskStreamLogEvent{
			ID:        run.id,
			Line:      line,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}); err != nil {
			run.mu.Unlock()
			return false
		}
		run.mu.Unlock()
	}
	return true
}

func (run *hermesTaskStreamRun) emitCommandOutput(value string) {
	_ = run.emitLog(value)
}

func (run *hermesTaskStreamRun) fail(err error) {
	message := err.Error()
	_ = run.emitLog("失败：" + message)
	_ = run.emitStatus("error", 100, message)
	run.mu.Lock()
	defer run.mu.Unlock()
	_ = run.send.Data(HermesTaskStreamErrorEvent{
		ID:        run.id,
		Message:   message,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	})
}

func runHermesTaskStepWithHeartbeat(ctx context.Context, run *hermesTaskStreamRun, step hermesTaskStep) error {
	if step.run == nil {
		return nil
	}
	done := make(chan error, 1)
	go func() {
		done <- step.run(ctx, hermesStreamTaskAdapter{run: run})
	}()

	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case err := <-done:
			return err
		case <-ticker.C:
			if !run.emitStatus("running", step.progress, "") {
				return errors.New("stream connection closed")
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

type hermesStreamTaskAdapter struct {
	run *hermesTaskStreamRun
}

func (adapter hermesStreamTaskAdapter) addLog(value string) {
	if adapter.run != nil {
		adapter.run.emitLog(value)
	}
}

func stopHermesGatewayForUninstall(ctx context.Context, task hermesTaskLogger) error {
	path := toolenv.ResolveToolPath("hermes")
	if path == "" {
		task.addLog("hermes CLI 不可用，跳过 Gateway 停止命令。")
		return nil
	}

	task.addLog("执行 hermes gateway stop")
	err := runHermesExternalStreamingCommand(ctx, 45*time.Second, task.addLog, "hermes", "gateway", "stop")
	if err == nil {
		task.addLog("Hermes Gateway 停止命令已完成。")
		return nil
	}
	if hermesCommandUnavailable("", "", err) {
		task.addLog("hermes CLI 不可用，跳过 Gateway 停止命令。")
		return nil
	}
	task.addLog("Gateway 停止命令未完成，继续执行本地清理：" + err.Error())
	return nil
}

func removeHermesHomeForUninstall(ctx context.Context, task hermesTaskLogger) error {
	_ = ctx
	home, envOverride := defaultHermesHomeDir()
	home = filepath.Clean(home)
	if strings.TrimSpace(home) == "" || home == "." || home == string(os.PathSeparator) {
		return fmt.Errorf("Hermes Home 路径不安全，已拒绝删除: %q", home)
	}
	if envOverride != "" {
		task.addLog("检测到 HERMES_HOME: " + envOverride)
	}
	if !pathExists(home) {
		task.addLog("Hermes Home 不存在，无需清理：" + home)
		return nil
	}
	task.addLog("移除 Hermes Home 与本地数据：" + home)
	if err := os.RemoveAll(home); err != nil {
		return err
	}
	task.addLog("Hermes Home 已移除。")
	return nil
}

func clearHermesTerminalSessionsForUninstall(ctx context.Context, task hermesTaskLogger) error {
	_ = ctx
	removed := globalHermesTerminalManager.clearAll()
	if removed == 0 {
		task.addLog("没有需要清理的 Hermes 终端会话记录。")
		return nil
	}
	task.addLog(fmt.Sprintf("已清理 %d 个 Hermes 终端会话记录。", removed))
	return nil
}

func removeHermesCLIForUninstall(ctx context.Context, task hermesTaskLogger) error {
	beforePath := toolenv.ResolveToolPath("hermes")
	if beforePath == "" {
		localBinPath := toolenv.UserLocalExecutablePath("hermes")
		if pathExistsByLstat(localBinPath) {
			if err := removeHermesCLIPathIfSafe(localBinPath, task); err != nil {
				return err
			}
			task.addLog("hermes CLI 已不可用，已清理本地命令残留。")
			return nil
		}
		task.addLog("hermes CLI 已不可用，无需继续卸载 CLI。")
		return nil
	}

	if isHermesDirectRemovalPreferred(beforePath) {
		if err := removeHermesCLIPathIfSafe(beforePath, task); err != nil {
			return err
		}
		if toolenv.ResolveToolPath("hermes") == "" {
			task.addLog("Hermes CLI 已卸载。")
			return nil
		}
	}

	attempts := hermesCLIUninstallAttempts(beforePath)
	var errorsText []string
	for _, attempt := range attempts {
		task.addLog("执行 " + attempt.commandLine())
		err := runHermesExternalStreamingCommand(ctx, 5*time.Minute, task.addLog, attempt.name, attempt.args...)
		if err != nil {
			errorsText = append(errorsText, attempt.commandLine()+": "+err.Error())
			task.addLog("CLI 卸载尝试未完成：" + err.Error())
		}
		if toolenv.ResolveToolPath("hermes") == "" {
			task.addLog("Hermes CLI 已卸载。")
			return nil
		}
	}

	if err := removeHermesCLIPathIfSafe(beforePath, task); err != nil {
		errorsText = append(errorsText, err.Error())
		task.addLog("CLI 路径清理未完成：" + err.Error())
	}
	if toolenv.ResolveToolPath("hermes") == "" {
		task.addLog("Hermes CLI 已卸载。")
		return nil
	}

	currentPath := toolenv.ResolveToolPath("hermes")
	if currentPath == "" {
		task.addLog("Hermes CLI 已卸载。")
		return nil
	}
	if len(errorsText) == 0 {
		return fmt.Errorf("hermes CLI 仍存在: %s", currentPath)
	}
	return fmt.Errorf("hermes CLI 仍存在: %s。尝试过: %s", currentPath, strings.Join(errorsText, "; "))
}

func cleanupHermesUninstallCache(ctx context.Context, task hermesTaskLogger) error {
	_ = ctx
	invalidateHermesEnvironmentCache()
	invalidateHermesUpdateStatusCache()
	task.addLog("已刷新 Hermes 环境状态缓存。")
	return nil
}

func runHermesExternalStreamingCommand(ctx context.Context, timeout time.Duration, writeOutput func(string), name string, args ...string) error {
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	path := toolenv.ResolveToolPath(name)
	if path == "" {
		path = name
	}
	cmd := exec.CommandContext(cmdCtx, path, args...)
	cmd.Env = toolenv.CommandEnv()
	cmd.Env = append(cmd.Env, "CI=1", "NO_COLOR=1", "TERM=dumb")
	cmd.Stdout = hermesTaskWriter{write: writeOutput}
	cmd.Stderr = hermesTaskWriter{write: writeOutput}
	err := cmd.Run()
	if cmdCtx.Err() != nil {
		return cmdCtx.Err()
	}
	return err
}

type hermesTaskWriter struct {
	write func(string)
}

func (writer hermesTaskWriter) Write(data []byte) (int, error) {
	if writer.write != nil {
		writer.write(string(data))
	}
	return len(data), nil
}

type hermesCLIUninstallAttempt struct {
	name string
	args []string
}

func (attempt hermesCLIUninstallAttempt) commandLine() string {
	return strings.TrimSpace(attempt.name + " " + strings.Join(attempt.args, " "))
}

func hermesCLIUninstallAttempts(cliPath string) []hermesCLIUninstallAttempt {
	lowerPath := strings.ToLower(strings.ReplaceAll(cliPath, "\\", "/"))
	candidates := []hermesCLIUninstallAttempt{
		{name: "uv", args: []string{"tool", "uninstall", "hermes-agent"}},
		{name: "pipx", args: []string{"uninstall", "hermes-agent"}},
	}

	switch {
	case strings.Contains(lowerPath, "/pipx/"):
		candidates = preferHermesUninstallAttempt(candidates, "pipx")
	case strings.Contains(lowerPath, "/.local/bin/") || strings.Contains(lowerPath, "/.hermes/hermes-agent/venv/"):
		candidates = preferHermesUninstallAttempt(candidates, "uv")
	default:
		candidates = preferHermesUninstallAttempt(candidates, "uv")
	}

	available := make([]hermesCLIUninstallAttempt, 0, len(candidates))
	for _, candidate := range candidates {
		if toolenv.ResolveToolPath(candidate.name) != "" {
			available = append(available, candidate)
		}
	}
	return available
}

func preferHermesUninstallAttempt(attempts []hermesCLIUninstallAttempt, name string) []hermesCLIUninstallAttempt {
	preferred := make([]hermesCLIUninstallAttempt, 0, len(attempts))
	rest := make([]hermesCLIUninstallAttempt, 0, len(attempts))
	for _, attempt := range attempts {
		if attempt.name == name {
			preferred = append(preferred, attempt)
		} else {
			rest = append(rest, attempt)
		}
	}
	return append(preferred, rest...)
}

func isHermesDirectRemovalPreferred(cliPath string) bool {
	lowerPath := strings.ToLower(strings.ReplaceAll(cliPath, "\\", "/"))
	return strings.Contains(lowerPath, "/.local/bin/hermes") ||
		strings.Contains(lowerPath, "/.hermes/hermes-agent/venv/bin/hermes")
}

func removeHermesCLIPathIfSafe(cliPath string, task hermesTaskLogger) error {
	if strings.TrimSpace(cliPath) == "" {
		return nil
	}
	cleanPath, err := filepath.Abs(filepath.Clean(cliPath))
	if err != nil {
		return err
	}
	if filepath.Base(cleanPath) != "hermes" {
		return fmt.Errorf("CLI 路径文件名不是 hermes，跳过直接删除: %s", cleanPath)
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	homeDir, err = filepath.Abs(filepath.Clean(homeDir))
	if err != nil {
		return err
	}
	if rel, relErr := filepath.Rel(homeDir, cleanPath); relErr != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return fmt.Errorf("CLI 路径不在用户 Home 下，跳过直接删除: %s", cleanPath)
	}
	if _, statErr := os.Lstat(cleanPath); statErr != nil {
		if errors.Is(statErr, os.ErrNotExist) {
			return nil
		}
		return statErr
	}
	task.addLog("移除 Hermes CLI 路径：" + cleanPath)
	return os.Remove(cleanPath)
}

func pathExistsByLstat(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	_, err := os.Lstat(path)
	return err == nil
}

func hermesCommandUnavailable(stdout string, stderr string, err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, exec.ErrNotFound) {
		return true
	}
	output := strings.ToLower(strings.TrimSpace(stdout + "\n" + stderr + "\n" + err.Error()))
	return strings.Contains(output, "executable file not found") ||
		strings.Contains(output, "command not found") ||
		strings.Contains(output, "no such file or directory")
}
