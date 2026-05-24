package openclaw

import (
	"context"
	"encoding/json"
	"errors"
	"os/exec"
	"strings"
	"time"

	"agent-box-server/internal/httpapi/toolenv"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/sse"
)

var openClawUpdateStatusCache cacheEntry[OpenClawUpdateStatusResponse]

type OpenClawUpdateStatusInput struct {
	Refresh bool `query:"refresh" doc:"Force refresh cached OpenClaw update status." example:"false"`
}

type OpenClawUpdateStatusOutput struct {
	Body OpenClawUpdateStatusResponse
}

type OpenClawUpdateActionOutput struct {
	Body OpenClawUpdateActionResponse
}

type OpenClawUpdateStatusResponse struct {
	Status            string            `json:"status" example:"ok" doc:"Update check status."`
	Timestamp         string            `json:"timestamp" example:"2026-05-13T05:00:00Z" doc:"UTC response timestamp."`
	Cache             OpenClawCacheInfo `json:"cache" doc:"Cache behavior used for this response."`
	Available         bool              `json:"available" example:"true" doc:"Whether an OpenClaw update is available."`
	CurrentVersion    string            `json:"currentVersion,omitempty" example:"2026.5.7" doc:"Current OpenClaw CLI version."`
	LatestVersion     string            `json:"latestVersion,omitempty" example:"2026.5.8" doc:"Latest registry version when known."`
	Channel           string            `json:"channel,omitempty" example:"stable" doc:"Effective update channel."`
	ChannelLabel      string            `json:"channelLabel,omitempty" example:"stable (default)" doc:"Human-readable update channel label."`
	InstallKind       string            `json:"installKind,omitempty" example:"package" doc:"Detected OpenClaw install kind."`
	PackageManager    string            `json:"packageManager,omitempty" example:"pnpm" doc:"Detected package manager for package installs."`
	Root              string            `json:"root,omitempty" doc:"Detected OpenClaw installation root."`
	HasGitUpdate      bool              `json:"hasGitUpdate" example:"false" doc:"Whether a git update is available."`
	HasRegistryUpdate bool              `json:"hasRegistryUpdate" example:"true" doc:"Whether a registry update is available."`
	GitBehind         *int              `json:"gitBehind,omitempty" doc:"Git commits behind when known."`
	Error             string            `json:"error,omitempty" doc:"Update check error when any."`
	Stderr            string            `json:"stderr,omitempty" doc:"Command stderr when any."`
}

type OpenClawUpdateActionResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-13T05:00:00Z" doc:"UTC response timestamp."`
	Message   string `json:"message" doc:"Human-readable operation summary."`
	Stdout    string `json:"stdout,omitempty" doc:"Command stdout."`
	Stderr    string `json:"stderr,omitempty" doc:"Command stderr."`
}

func OpenClawUpdateStatus(ctx context.Context, input *OpenClawUpdateStatusInput) (*OpenClawUpdateStatusOutput, error) {
	if input == nil {
		input = &OpenClawUpdateStatusInput{}
	}

	body := cached(&openClawUpdateStatusCache, 5*time.Minute, input.Refresh, func() OpenClawUpdateStatusResponse {
		return detectOpenClawUpdateStatus(ctx)
	})
	body.Timestamp = time.Now().UTC().Format(time.RFC3339)
	body.Cache = OpenClawCacheInfo{Refresh: input.Refresh}

	return &OpenClawUpdateStatusOutput{Body: body}, nil
}

func UpdateOpenClaw(ctx context.Context, input *struct{}) (*OpenClawUpdateActionOutput, error) {
	stdout, stderr, err := runOpenClawUpdateCommand(ctx, nil)
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw update failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
	}

	invalidateOpenClawEnvironmentCache()
	invalidateOpenClawCLIVersionCache()
	invalidateOpenClawUpdateStatusCache()

	return &OpenClawUpdateActionOutput{Body: OpenClawUpdateActionResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Message:   "OpenClaw update finished.",
		Stdout:    strings.TrimSpace(stdout),
		Stderr:    strings.TrimSpace(stderr),
	}}, nil
}

func UpdateOpenClawStream(ctx context.Context, input *struct{}, send sse.Sender) {
	streamOpenClawChannelSteps(ctx, send, "openclaw-update", "update", []openClawChannelStep{
		{label: "检查 OpenClaw CLI", progress: 8, timeout: 10 * time.Second, args: []string{"--version"}},
		{label: "执行 OpenClaw 更新", progress: 28, timeout: 5 * time.Minute, run: runOpenClawUpdateStreamingCommand},
		{label: "刷新 OpenClaw 缓存", progress: 92, run: refreshOpenClawUpdateCaches},
	})
}

func detectOpenClawUpdateStatus(ctx context.Context) OpenClawUpdateStatusResponse {
	cli, _ := detectOpenClawCLI(ctx)
	response := OpenClawUpdateStatusResponse{
		Status:         "ok",
		Timestamp:      time.Now().UTC().Format(time.RFC3339),
		CurrentVersion: normalizeOpenClawVersionOutput(cli.Version),
	}
	if !cli.Available {
		response.Status = "warning"
		response.Error = cli.Error
		return response
	}

	stdout, stderr, err := openClawCommand(ctx, 20*time.Second, "update", "status", "--json")
	response.Stderr = strings.TrimSpace(stderr)
	if err != nil {
		response.Status = "error"
		response.Error = strings.TrimSpace(stderr + "\n" + err.Error())
		return response
	}

	var payload map[string]any
	if err := json.Unmarshal([]byte(stdout), &payload); err != nil {
		response.Status = "error"
		response.Error = "openclaw update status did not return valid JSON: " + err.Error()
		return response
	}

	update := mapFromAny(payload["update"])
	registry := mapFromAny(update["registry"])
	channel := mapFromAny(payload["channel"])
	availability := mapFromAny(payload["availability"])

	response.Root = stringFromAny(update["root"])
	response.InstallKind = stringFromAny(update["installKind"])
	response.PackageManager = stringFromAny(update["packageManager"])
	if response.PackageManager == "" {
		response.PackageManager = stringFromAny(update["package_manager"])
	}
	response.Channel = stringFromAny(channel["value"])
	response.ChannelLabel = stringFromAny(channel["label"])
	response.LatestVersion = stringFromAny(availability["latestVersion"])
	if response.LatestVersion == "" {
		response.LatestVersion = stringFromAny(registry["latestVersion"])
	}
	response.HasGitUpdate = updateBoolFromAny(availability["hasGitUpdate"])
	response.HasRegistryUpdate = updateBoolFromAny(availability["hasRegistryUpdate"])
	response.Available = updateBoolFromAny(availability["available"]) || response.HasGitUpdate || response.HasRegistryUpdate
	response.GitBehind = intPtrFromAny(availability["gitBehind"])

	return response
}

func runOpenClawUpdateStreamingCommand(ctx context.Context, task openClawChannelLogger) error {
	stdout, stderr, err := runOpenClawUpdateCommand(ctx, task.addLog)
	if err != nil {
		return errors.New(strings.TrimSpace(stderr + "\n" + err.Error()))
	}
	if strings.TrimSpace(stdout) == "" && strings.TrimSpace(stderr) == "" {
		task.addLog("OpenClaw 更新命令已完成。")
	}
	return nil
}

func runOpenClawUpdateCommand(ctx context.Context, writeOutput func(string)) (string, string, error) {
	stdout, stderr, err := runOpenClawUpdateCommandWithEnv(ctx, writeOutput, nil)
	if !openClawOlderBinaryDestructiveGuard(stdout, stderr, err) {
		return stdout, stderr, err
	}

	if writeOutput != nil {
		writeOutput("检测到当前 OpenClaw CLI 版本旧于配置写入版本，进入恢复更新模式重试。")
		writeOutput("仅本次更新命令设置 OPENCLAW_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS=1。")
	}
	retryStdout, retryStderr, retryErr := runOpenClawUpdateCommandWithEnv(ctx, writeOutput, map[string]string{
		"OPENCLAW_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS": "1",
	})
	return strings.TrimSpace(stdout + "\n" + retryStdout), strings.TrimSpace(stderr + "\n" + retryStderr), retryErr
}

func runOpenClawUpdateCommandWithEnv(ctx context.Context, writeOutput func(string), extraEnv map[string]string) (string, string, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	path := toolenv.ResolveToolPath("openclaw")
	if path == "" {
		path = "openclaw"
	}
	cmd := exec.CommandContext(cmdCtx, path, "update", "--json")
	cmd.Env = toolenv.CommandEnv()
	for key, value := range extraEnv {
		cmd.Env = append(cmd.Env, key+"="+value)
	}
	var stdout strings.Builder
	var stderr strings.Builder
	cmd.Stdout = taskWriter{write: func(value string) {
		stdout.WriteString(value)
		if writeOutput != nil {
			writeOutput(value)
		}
	}}
	cmd.Stderr = taskWriter{write: func(value string) {
		stderr.WriteString(value)
		if writeOutput != nil {
			writeOutput(value)
		}
	}}
	err := cmd.Run()
	if cmdCtx.Err() != nil {
		return stdout.String(), stderr.String(), cmdCtx.Err()
	}
	return stdout.String(), stderr.String(), err
}

func openClawOlderBinaryDestructiveGuard(stdout string, stderr string, err error) bool {
	if err == nil {
		return false
	}
	output := strings.ToLower(stdout + "\n" + stderr + "\n" + err.Error())
	return strings.Contains(output, "older than the config last written") ||
		strings.Contains(output, "config was written by version") ||
		strings.Contains(output, "openclaw_allow_older_binary_destructive_actions")
}

func refreshOpenClawUpdateCaches(ctx context.Context, task openClawChannelLogger) error {
	invalidateOpenClawEnvironmentCache()
	invalidateOpenClawCLIVersionCache()
	invalidateOpenClawUpdateStatusCache()
	task.addLog("OpenClaw 环境、CLI 版本和更新状态缓存已刷新。")
	return nil
}

func invalidateOpenClawUpdateStatusCache() {
	openClawUpdateStatusCache.mu.Lock()
	defer openClawUpdateStatusCache.mu.Unlock()
	openClawUpdateStatusCache.loaded = false
	openClawUpdateStatusCache.expiresAt = time.Time{}
}

func normalizeOpenClawVersionOutput(value string) string {
	value = strings.TrimSpace(firstLine(value))
	value = strings.TrimSpace(strings.TrimPrefix(value, "OpenClaw"))
	value = strings.TrimSpace(strings.TrimPrefix(value, "openclaw"))
	if index := strings.Index(value, " ("); index >= 0 {
		value = strings.TrimSpace(value[:index])
	}
	return value
}

func mapFromAny(value any) map[string]any {
	if existing, ok := value.(map[string]any); ok && existing != nil {
		return existing
	}
	return map[string]any{}
}

func stringFromAny(value any) string {
	if str, ok := value.(string); ok {
		return strings.TrimSpace(str)
	}
	return ""
}

func updateBoolFromAny(value any) bool {
	if boolean, ok := value.(bool); ok {
		return boolean
	}
	return false
}

func intPtrFromAny(value any) *int {
	switch typed := value.(type) {
	case float64:
		next := int(typed)
		return &next
	case int:
		next := typed
		return &next
	default:
		return nil
	}
}
