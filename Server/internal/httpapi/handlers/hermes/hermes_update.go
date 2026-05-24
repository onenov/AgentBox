package hermes

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/sse"
)

var hermesUpdateStatusCache cacheEntry[HermesUpdateStatusResponse]

type HermesUpdateStatusInput struct {
	Refresh bool `query:"refresh" doc:"Force refresh cached Hermes update status." example:"false"`
}

type HermesUpdateStatusOutput struct {
	Body HermesUpdateStatusResponse
}

type HermesUpdateActionOutput struct {
	Body HermesUpdateActionResponse
}

type HermesUpdateStatusResponse struct {
	Status            string          `json:"status" example:"ok" doc:"Update check status."`
	Timestamp         string          `json:"timestamp" example:"2026-05-13T05:00:00Z" doc:"UTC response timestamp."`
	Cache             HermesCacheInfo `json:"cache" doc:"Cache behavior used for this response."`
	Available         bool            `json:"available" example:"true" doc:"Whether a Hermes update is available."`
	CurrentVersion    string          `json:"currentVersion,omitempty" example:"2026.5.7" doc:"Current Hermes CLI version."`
	LatestVersion     string          `json:"latestVersion,omitempty" example:"2026.5.8" doc:"Latest registry version when known."`
	Channel           string          `json:"channel,omitempty" example:"stable" doc:"Effective update channel."`
	ChannelLabel      string          `json:"channelLabel,omitempty" example:"stable (default)" doc:"Human-readable update channel label."`
	InstallKind       string          `json:"installKind,omitempty" example:"package" doc:"Detected Hermes install kind."`
	PackageManager    string          `json:"packageManager,omitempty" example:"pnpm" doc:"Detected package manager for package installs."`
	Root              string          `json:"root,omitempty" doc:"Detected Hermes installation root."`
	HasGitUpdate      bool            `json:"hasGitUpdate" example:"false" doc:"Whether a git update is available."`
	HasRegistryUpdate bool            `json:"hasRegistryUpdate" example:"true" doc:"Whether a registry update is available."`
	GitBehind         *int            `json:"gitBehind,omitempty" doc:"Git commits behind when known."`
	Error             string          `json:"error,omitempty" doc:"Update check error when any."`
	Stderr            string          `json:"stderr,omitempty" doc:"Command stderr when any."`
}

type HermesUpdateActionResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-13T05:00:00Z" doc:"UTC response timestamp."`
	Message   string `json:"message" doc:"Human-readable operation summary."`
	Stdout    string `json:"stdout,omitempty" doc:"Command stdout."`
	Stderr    string `json:"stderr,omitempty" doc:"Command stderr."`
}

func HermesUpdateStatus(ctx context.Context, input *HermesUpdateStatusInput) (*HermesUpdateStatusOutput, error) {
	if input == nil {
		input = &HermesUpdateStatusInput{}
	}

	body := cached(&hermesUpdateStatusCache, 5*time.Minute, input.Refresh, func() HermesUpdateStatusResponse {
		return detectHermesUpdateStatus(ctx)
	})
	body.Timestamp = time.Now().UTC().Format(time.RFC3339)
	body.Cache = HermesCacheInfo{Refresh: input.Refresh}

	return &HermesUpdateStatusOutput{Body: body}, nil
}

func UpdateHermes(ctx context.Context, input *struct{}) (*HermesUpdateActionOutput, error) {
	stdout, stderr, err := hermesCommand(ctx, 5*time.Minute, "update", "--json")
	if err != nil {
		return nil, huma.Error500InternalServerError("hermes update failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
	}

	invalidateHermesEnvironmentCache()
	invalidateHermesUpdateStatusCache()

	return &HermesUpdateActionOutput{Body: HermesUpdateActionResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Message:   "Hermes update finished.",
		Stdout:    strings.TrimSpace(stdout),
		Stderr:    strings.TrimSpace(stderr),
	}}, nil
}

func UpdateHermesStream(ctx context.Context, input *struct{}, send sse.Sender) {
	_ = input
	streamHermesTaskSteps(ctx, send, "hermes-update", "update", []hermesTaskStep{
		{label: "检查 Hermes CLI", progress: 8, timeout: 10 * time.Second, run: checkHermesCLIForUpdate},
		{label: "执行 Hermes 更新", progress: 28, timeout: 5 * time.Minute, run: runHermesUpdateStreamingCommand},
		{label: "刷新 Hermes 缓存", progress: 92, timeout: 15 * time.Second, run: refreshHermesUpdateCaches},
	})
}

func detectHermesUpdateStatus(ctx context.Context) HermesUpdateStatusResponse {
	cli, _ := detectHermesCLI(ctx)
	response := HermesUpdateStatusResponse{
		Status:         "ok",
		Timestamp:      time.Now().UTC().Format(time.RFC3339),
		CurrentVersion: normalizeHermesVersionOutput(cli.Version),
	}
	if !cli.Available {
		response.Status = "warning"
		response.Error = cli.Error
		return response
	}

	stdout, stderr, err := hermesCommand(ctx, 20*time.Second, "update", "status", "--json")
	response.Stderr = strings.TrimSpace(stderr)
	if err != nil {
		response.Status = "error"
		response.Error = strings.TrimSpace(stderr + "\n" + err.Error())
		return response
	}

	var payload map[string]any
	if err := json.Unmarshal([]byte(stdout), &payload); err != nil {
		response.Status = "error"
		response.Error = "hermes update status did not return valid JSON: " + err.Error()
		return response
	}

	update := hermesMapFromAny(payload["update"])
	registry := hermesMapFromAny(update["registry"])
	channel := hermesMapFromAny(payload["channel"])
	availability := hermesMapFromAny(payload["availability"])

	response.Root = strings.TrimSpace(stringFromAny(update["root"]))
	response.InstallKind = strings.TrimSpace(stringFromAny(update["installKind"]))
	response.PackageManager = strings.TrimSpace(stringFromAny(update["packageManager"]))
	if response.PackageManager == "" {
		response.PackageManager = strings.TrimSpace(stringFromAny(update["package_manager"]))
	}
	response.Channel = strings.TrimSpace(stringFromAny(channel["value"]))
	response.ChannelLabel = strings.TrimSpace(stringFromAny(channel["label"]))
	response.LatestVersion = strings.TrimSpace(stringFromAny(availability["latestVersion"]))
	if response.LatestVersion == "" {
		response.LatestVersion = strings.TrimSpace(stringFromAny(registry["latestVersion"]))
	}
	response.HasGitUpdate = hermesUpdateBoolFromAny(availability["hasGitUpdate"])
	response.HasRegistryUpdate = hermesUpdateBoolFromAny(availability["hasRegistryUpdate"])
	response.Available = hermesUpdateBoolFromAny(availability["available"]) || response.HasGitUpdate || response.HasRegistryUpdate
	response.GitBehind = hermesIntPtrFromAny(availability["gitBehind"])

	return response
}

func checkHermesCLIForUpdate(ctx context.Context, task hermesTaskLogger) error {
	return runHermesExternalStreamingCommand(ctx, 10*time.Second, task.addLog, "hermes", "--version")
}

func runHermesUpdateStreamingCommand(ctx context.Context, task hermesTaskLogger) error {
	if err := runHermesExternalStreamingCommand(ctx, 5*time.Minute, task.addLog, "hermes", "update", "--json"); err != nil {
		return err
	}
	task.addLog("Hermes 更新命令已完成。")
	return nil
}

func refreshHermesUpdateCaches(ctx context.Context, task hermesTaskLogger) error {
	_ = ctx
	invalidateHermesEnvironmentCache()
	invalidateHermesUpdateStatusCache()
	task.addLog("Hermes 环境和更新状态缓存已刷新。")
	return nil
}

func invalidateHermesUpdateStatusCache() {
	hermesUpdateStatusCache.mu.Lock()
	defer hermesUpdateStatusCache.mu.Unlock()
	hermesUpdateStatusCache.loaded = false
	hermesUpdateStatusCache.expiresAt = time.Time{}
}

func normalizeHermesVersionOutput(value string) string {
	value = strings.TrimSpace(firstLine(value))
	value = strings.TrimSpace(strings.TrimPrefix(value, "Hermes Agent"))
	value = strings.TrimSpace(strings.TrimPrefix(value, "Hermes"))
	value = strings.TrimSpace(strings.TrimPrefix(value, "hermes"))
	if index := strings.Index(value, " ("); index >= 0 {
		value = strings.TrimSpace(value[:index])
	}
	return value
}

func hermesMapFromAny(value any) map[string]any {
	if existing, ok := value.(map[string]any); ok && existing != nil {
		return existing
	}
	return map[string]any{}
}

func hermesUpdateBoolFromAny(value any) bool {
	if boolean, ok := value.(bool); ok {
		return boolean
	}
	return false
}

func hermesIntPtrFromAny(value any) *int {
	switch typed := value.(type) {
	case float64:
		next := int(typed)
		return &next
	case int:
		next := typed
		return &next
	case json.Number:
		parsed, err := strconv.Atoi(typed.String())
		if err != nil {
			return nil
		}
		return &parsed
	default:
		return nil
	}
}
