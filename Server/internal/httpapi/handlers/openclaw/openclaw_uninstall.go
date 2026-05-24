package openclaw

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

func UninstallOpenClawStream(ctx context.Context, input *struct{}, send sse.Sender) {
	streamOpenClawChannelSteps(ctx, send, "openclaw-uninstall", "uninstall", []openClawChannelStep{
		{label: "执行 OpenClaw 官方非交互卸载", progress: 15, timeout: 15 * time.Minute, run: runOpenClawUninstallCommand},
		{label: "卸载 OpenClaw CLI", progress: 80, timeout: 5 * time.Minute, run: runOpenClawCLIUninstallCommand},
		{label: "刷新本机服务状态缓存", progress: 96, timeout: 15 * time.Second, run: runOpenClawUninstallCleanup},
	})
}

func runOpenClawUninstallCommand(ctx context.Context, task openClawChannelLogger) error {
	task.addLog("执行 openclaw uninstall --all --yes --non-interactive")
	stdout, stderr, err := runOpenClawStreamingCommandTo(ctx, 15*time.Minute, task.addLog, "uninstall", "--all", "--yes", "--non-interactive")
	if err == nil {
		return nil
	}
	if !openClawUninstallCLIUnavailable(stdout, stderr, err) {
		return err
	}
	if toolenv.ResolveToolPath("npx") == "" {
		return err
	}

	task.addLog("openclaw CLI 不可用，尝试 npx -y openclaw uninstall --all --yes --non-interactive。")
	return runOpenClawExternalStreamingCommand(ctx, 15*time.Minute, task.addLog, "npx", "-y", "openclaw", "uninstall", "--all", "--yes", "--non-interactive")
}

func runOpenClawCLIUninstallCommand(ctx context.Context, task openClawChannelLogger) error {
	beforePath := toolenv.ResolveToolPath("openclaw")
	if beforePath == "" {
		task.addLog("openclaw CLI 已不可用，无需继续卸载 CLI。")
		return nil
	}

	attempts := openClawCLIUninstallAttempts(beforePath)
	if len(attempts) == 0 {
		return fmt.Errorf("openclaw CLI 仍存在，但未找到 npm/pnpm/yarn/bun 用于卸载: %s", beforePath)
	}

	var errorsText []string
	for _, attempt := range attempts {
		task.addLog("执行 " + attempt.commandLine())
		err := runOpenClawExternalStreamingCommand(ctx, 5*time.Minute, task.addLog, attempt.name, attempt.args...)
		if err == nil && toolenv.ResolveToolPath("openclaw") == "" {
			task.addLog("OpenClaw CLI 已卸载。")
			return nil
		}
		if err != nil {
			errorsText = append(errorsText, attempt.commandLine()+": "+err.Error())
			task.addLog("CLI 卸载尝试未完成：" + err.Error())
		}
		if toolenv.ResolveToolPath("openclaw") == "" {
			task.addLog("OpenClaw CLI 已卸载。")
			return nil
		}
	}

	currentPath := toolenv.ResolveToolPath("openclaw")
	if currentPath == "" {
		task.addLog("OpenClaw CLI 已卸载。")
		return nil
	}
	return fmt.Errorf("openclaw CLI 仍存在: %s。尝试过: %s", currentPath, strings.Join(errorsText, "; "))
}

func runOpenClawUninstallCleanup(ctx context.Context, task openClawChannelLogger) error {
	invalidateOpenClawEnvironmentCache()
	invalidateOpenClawCLIVersionCache()
	invalidateOpenClawUpdateStatusCache()
	invalidateOpenClawPluginsStatusCache()
	task.addLog("已刷新 OpenClaw 环境、更新和插件缓存。")
	return nil
}

func runOpenClawExternalStreamingCommand(ctx context.Context, timeout time.Duration, writeOutput func(string), name string, args ...string) error {
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	path := toolenv.ResolveToolPath(name)
	if path == "" {
		path = name
	}
	cmd := exec.CommandContext(cmdCtx, path, args...)
	cmd.Env = toolenv.CommandEnv()
	cmd.Stdout = taskWriter{write: writeOutput}
	cmd.Stderr = taskWriter{write: writeOutput}
	err := cmd.Run()
	if cmdCtx.Err() != nil {
		return cmdCtx.Err()
	}
	return err
}

type openClawCLIUninstallAttempt struct {
	name string
	args []string
}

func (attempt openClawCLIUninstallAttempt) commandLine() string {
	return strings.TrimSpace(attempt.name + " " + strings.Join(attempt.args, " "))
}

func openClawCLIUninstallAttempts(cliPath string) []openClawCLIUninstallAttempt {
	lowerPath := strings.ToLower(strings.ReplaceAll(cliPath, "\\", "/"))
	candidates := []openClawCLIUninstallAttempt{
		{name: "npm", args: []string{"uninstall", "-g", "openclaw"}},
		{name: "pnpm", args: []string{"remove", "-g", "openclaw"}},
		{name: "yarn", args: []string{"global", "remove", "openclaw"}},
		{name: "bun", args: []string{"remove", "-g", "openclaw"}},
	}

	switch {
	case strings.Contains(lowerPath, "pnpm"):
		candidates = preferOpenClawUninstallAttempt(candidates, "pnpm")
	case strings.Contains(lowerPath, "yarn"):
		candidates = preferOpenClawUninstallAttempt(candidates, "yarn")
	case strings.Contains(lowerPath, "bun"):
		candidates = preferOpenClawUninstallAttempt(candidates, "bun")
	default:
		candidates = preferOpenClawUninstallAttempt(candidates, "npm")
	}
	if prefix := openClawNPMGlobalPrefixFromCLIPath(cliPath); prefix != "" {
		candidates = append([]openClawCLIUninstallAttempt{
			{name: "npm", args: []string{"uninstall", "-g", "openclaw", "--prefix", prefix}},
		}, candidates...)
	}

	available := make([]openClawCLIUninstallAttempt, 0, len(candidates))
	for _, candidate := range candidates {
		if toolenv.ResolveToolPath(candidate.name) != "" {
			available = append(available, candidate)
		}
	}
	return available
}

func openClawNPMGlobalPrefixFromCLIPath(cliPath string) string {
	cleanPath := filepath.Clean(strings.TrimSpace(cliPath))
	if cleanPath == "" {
		return ""
	}
	if info, err := os.Lstat(cleanPath); err == nil && info.Mode()&os.ModeSymlink != 0 {
		if target, err := os.Readlink(cleanPath); err == nil && target != "" {
			if !filepath.IsAbs(target) {
				target = filepath.Join(filepath.Dir(cleanPath), target)
			}
			if prefix := openClawNPMGlobalPrefixFromPackagePath(target); prefix != "" {
				return prefix
			}
		}
	}
	if prefix := openClawNPMGlobalPrefixFromPackagePath(cleanPath); prefix != "" {
		return prefix
	}
	if filepath.Base(filepath.Dir(cleanPath)) == "bin" {
		prefix := filepath.Dir(filepath.Dir(cleanPath))
		if pathExists(filepath.Join(prefix, "lib", "node_modules", "openclaw")) {
			return prefix
		}
	}
	return ""
}

func openClawNPMGlobalPrefixFromPackagePath(path string) string {
	parts := strings.Split(filepath.Clean(path), string(filepath.Separator))
	for index := len(parts) - 1; index >= 2; index-- {
		if parts[index] != "openclaw" || parts[index-1] != "node_modules" {
			continue
		}
		if parts[index-2] == "lib" {
			return strings.Join(parts[:index-2], string(filepath.Separator))
		}
		return strings.Join(parts[:index-1], string(filepath.Separator))
	}
	return ""
}

func preferOpenClawUninstallAttempt(attempts []openClawCLIUninstallAttempt, name string) []openClawCLIUninstallAttempt {
	preferred := make([]openClawCLIUninstallAttempt, 0, len(attempts))
	rest := make([]openClawCLIUninstallAttempt, 0, len(attempts))
	for _, attempt := range attempts {
		if attempt.name == name {
			preferred = append(preferred, attempt)
		} else {
			rest = append(rest, attempt)
		}
	}
	return append(preferred, rest...)
}

func openClawUninstallCLIUnavailable(stdout string, stderr string, err error) bool {
	if errors.Is(err, exec.ErrNotFound) {
		return true
	}
	output := strings.ToLower(strings.TrimSpace(stdout + "\n" + stderr + "\n" + err.Error()))
	return strings.Contains(output, "executable file not found") ||
		strings.Contains(output, "command not found") ||
		strings.Contains(output, "no such file or directory")
}
