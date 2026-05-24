package openclaw

// OpenClaw plugin handlers expose the local OpenClaw plugin inventory and management commands.
//
// The handlers intentionally delegate lifecycle operations to the OpenClaw CLI so AgentBox keeps
// the same registry policy, config mutation behavior, install records, and gateway restart hints as
// terminal users.

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

var openClawPluginsStatusCache persistentCache[json.RawMessage]

type OpenClawPluginsListInput struct {
	Enabled bool `query:"enabled" doc:"Only return enabled plugins." example:"false"`
	Refresh bool `query:"refresh" doc:"Force refresh cached OpenClaw plugins status." example:"false"`
}

type OpenClawPluginsSearchInput struct {
	Query string `query:"query" doc:"ClawHub plugin search query." example:"discord"`
	Limit int    `query:"limit" minimum:"1" maximum:"100" doc:"Maximum number of search results." example:"20"`
}

type OpenClawPluginInspectInput struct {
	ID string `path:"id" doc:"Plugin id or name to inspect." example:"discord"`
}

type OpenClawPluginInstallInput struct {
	Body OpenClawPluginInstallRequest
}

type OpenClawPluginActionInput struct {
	ID string `path:"id" doc:"Plugin id or name." example:"discord"`
}

type OpenClawPluginUninstallInput struct {
	ID        string `path:"id" doc:"Plugin id or name to uninstall." example:"discord"`
	KeepFiles bool   `query:"keepFiles" doc:"Keep managed plugin files on disk." example:"false"`
}

type OpenClawPluginsRawOutput struct {
	Body json.RawMessage
}

type OpenClawPluginMutationOutput struct {
	Body OpenClawPluginMutationResponse
}

type OpenClawPluginDoctorOutput struct {
	Body OpenClawPluginDoctorResponse
}

type OpenClawPluginInstallRequest struct {
	Spec                          string `json:"spec" doc:"OpenClaw plugin install spec, e.g. clawhub:@openclaw/discord, npm:@scope/plugin, git:github.com/acme/plugin@v1, or a local path." example:"clawhub:@openclaw/discord"`
	Link                          bool   `json:"link,omitempty" doc:"Link a local path instead of copying. Only valid for local path installs." example:"false"`
	Force                         bool   `json:"force,omitempty" doc:"Overwrite an existing installed plugin or hook pack." example:"false"`
	Pin                           bool   `json:"pin,omitempty" doc:"Record npm installs as exact resolved name@version." example:"false"`
	Marketplace                   string `json:"marketplace,omitempty" doc:"Install a Claude-compatible marketplace plugin from this source."`
	DangerouslyForceUnsafeInstall bool   `json:"dangerouslyForceUnsafeInstall,omitempty" doc:"Bypass built-in dangerous-code install blocking after manual review." example:"false"`
}

type OpenClawPluginMutationResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-12T15:30:00Z" doc:"UTC response timestamp."`
	PluginID  string `json:"pluginId,omitempty" example:"discord" doc:"Plugin id or requested spec affected by the mutation."`
	Message   string `json:"message,omitempty" doc:"Human-readable operation summary."`
	Stdout    string `json:"stdout,omitempty" doc:"Command stdout."`
	Stderr    string `json:"stderr,omitempty" doc:"Command stderr."`
}

type OpenClawPluginDoctorResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-12T15:30:00Z" doc:"UTC response timestamp."`
	Output    string `json:"output" doc:"Raw openclaw plugins doctor output."`
	Stderr    string `json:"stderr,omitempty" doc:"Command stderr."`
}

func ListOpenClawPlugins(ctx context.Context, input *OpenClawPluginsListInput) (*OpenClawPluginsRawOutput, error) {
	enabled := false
	refresh := false
	if input != nil {
		enabled = input.Enabled
		refresh = input.Refresh
	}
	payload, err := cachedOpenClawPluginsStatus(ctx, enabled, refresh)
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw plugins list failed", err)
	}
	return &OpenClawPluginsRawOutput{Body: payload}, nil
}

func cachedOpenClawPluginsStatus(ctx context.Context, enabled bool, refresh bool) (json.RawMessage, error) {
	key := openClawPluginsStatusCacheKey(enabled)
	return cachedPersistent(&openClawPluginsStatusCache, key, refresh, func() (json.RawMessage, error) {
		return loadOpenClawPluginsStatus(ctx, enabled)
	})
}

func loadOpenClawPluginsStatus(ctx context.Context, enabled bool) (json.RawMessage, error) {
	args := []string{"plugins", "list", "--json"}
	if enabled {
		args = append(args, "--enabled")
	}
	return openClawJSONCommand(ctx, 20*time.Second, args...)
}

func openClawPluginsStatusCacheKey(enabled bool) string {
	if enabled {
		return "enabled=true"
	}
	return "enabled=false"
}

func invalidateOpenClawPluginsStatusCache() {
	invalidatePersistentCache(&openClawPluginsStatusCache)
}

func rebuildOpenClawPluginsStatusCache(ctx context.Context) {
	_, _ = cachedOpenClawPluginsStatus(ctx, false, true)
	_, _ = cachedOpenClawPluginsStatus(ctx, true, true)
}

func SearchOpenClawPlugins(ctx context.Context, input *OpenClawPluginsSearchInput) (*OpenClawPluginsRawOutput, error) {
	if input == nil || strings.TrimSpace(input.Query) == "" {
		return nil, huma.Error400BadRequest("plugin search query is required", nil)
	}
	args := []string{"plugins", "search", "--json"}
	if input.Limit > 0 {
		args = append(args, "--limit", intString(input.Limit))
	}
	args = append(args, strings.TrimSpace(input.Query))
	payload, err := openClawJSONCommand(ctx, 30*time.Second, args...)
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw plugins search failed", err)
	}
	return &OpenClawPluginsRawOutput{Body: payload}, nil
}

func GetOpenClawPluginInfo(ctx context.Context, input *OpenClawPluginInspectInput) (*OpenClawPluginsRawOutput, error) {
	id, err := requirePluginID(input)
	if err != nil {
		return nil, err
	}
	payload, cmdErr := openClawJSONCommand(ctx, 20*time.Second, "plugins", "inspect", id, "--json")
	if cmdErr != nil {
		return nil, huma.Error500InternalServerError("openclaw plugin inspect failed", cmdErr)
	}
	return &OpenClawPluginsRawOutput{Body: payload}, nil
}

func GetOpenClawPluginRuntimeInfo(ctx context.Context, input *OpenClawPluginInspectInput) (*OpenClawPluginsRawOutput, error) {
	id, err := requirePluginID(input)
	if err != nil {
		return nil, err
	}
	payload, cmdErr := openClawJSONCommand(ctx, 45*time.Second, "plugins", "inspect", id, "--runtime", "--json")
	if cmdErr != nil {
		return nil, huma.Error500InternalServerError("openclaw plugin runtime inspect failed", cmdErr)
	}
	return &OpenClawPluginsRawOutput{Body: payload}, nil
}

func InstallOpenClawPlugin(ctx context.Context, input *OpenClawPluginInstallInput) (*OpenClawPluginMutationOutput, error) {
	if input == nil || strings.TrimSpace(input.Body.Spec) == "" {
		return nil, huma.Error400BadRequest("plugin install spec is required", nil)
	}
	request := input.Body
	args := []string{"plugins", "install"}
	if request.Link {
		args = append(args, "--link")
	}
	if request.Force {
		args = append(args, "--force")
	}
	if request.Pin {
		args = append(args, "--pin")
	}
	if request.DangerouslyForceUnsafeInstall {
		args = append(args, "--dangerously-force-unsafe-install")
	}
	if strings.TrimSpace(request.Marketplace) != "" {
		args = append(args, "--marketplace", strings.TrimSpace(request.Marketplace))
	}
	args = append(args, strings.TrimSpace(request.Spec))
	stdout, stderr, err := openClawCommand(ctx, 10*time.Minute, args...)
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw plugin install failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
	}
	invalidateOpenClawPluginsStatusCache()
	rebuildOpenClawPluginsStatusCache(ctx)
	return openClawPluginMutation(strings.TrimSpace(request.Spec), "Plugin install finished", stdout, stderr), nil
}

func EnableOpenClawPlugin(ctx context.Context, input *OpenClawPluginActionInput) (*OpenClawPluginMutationOutput, error) {
	id, err := requirePluginActionID(input)
	if err != nil {
		return nil, err
	}
	stdout, stderr, cmdErr := openClawCommand(ctx, 30*time.Second, "plugins", "enable", id)
	if cmdErr != nil {
		return nil, huma.Error500InternalServerError("openclaw plugin enable failed", errors.New(strings.TrimSpace(stderr+"\n"+cmdErr.Error())))
	}
	invalidateOpenClawPluginsStatusCache()
	rebuildOpenClawPluginsStatusCache(ctx)
	return openClawPluginMutation(id, "Plugin enabled. Restart the gateway to apply.", stdout, stderr), nil
}

func DisableOpenClawPlugin(ctx context.Context, input *OpenClawPluginActionInput) (*OpenClawPluginMutationOutput, error) {
	id, err := requirePluginActionID(input)
	if err != nil {
		return nil, err
	}
	stdout, stderr, cmdErr := openClawCommand(ctx, 30*time.Second, "plugins", "disable", id)
	if cmdErr != nil {
		return nil, huma.Error500InternalServerError("openclaw plugin disable failed", errors.New(strings.TrimSpace(stderr+"\n"+cmdErr.Error())))
	}
	invalidateOpenClawPluginsStatusCache()
	rebuildOpenClawPluginsStatusCache(ctx)
	return openClawPluginMutation(id, "Plugin disabled. Restart the gateway to apply.", stdout, stderr), nil
}

func UpdateOpenClawPlugin(ctx context.Context, input *OpenClawPluginActionInput) (*OpenClawPluginMutationOutput, error) {
	id, err := requirePluginActionID(input)
	if err != nil {
		return nil, err
	}
	stdout, stderr, cmdErr := openClawCommand(ctx, 10*time.Minute, "plugins", "update", id)
	if cmdErr != nil {
		return nil, huma.Error500InternalServerError("openclaw plugin update failed", errors.New(strings.TrimSpace(stderr+"\n"+cmdErr.Error())))
	}
	invalidateOpenClawPluginsStatusCache()
	rebuildOpenClawPluginsStatusCache(ctx)
	return openClawPluginMutation(id, "Plugin update finished. Restart the gateway to apply.", stdout, stderr), nil
}

func UninstallOpenClawPlugin(ctx context.Context, input *OpenClawPluginUninstallInput) (*OpenClawPluginMutationOutput, error) {
	id := ""
	if input != nil {
		id = strings.TrimSpace(input.ID)
	}
	if id == "" {
		return nil, huma.Error400BadRequest("plugin id is required", nil)
	}
	args := []string{"plugins", "uninstall", id, "--force"}
	if input.KeepFiles {
		args = append(args, "--keep-files")
	}
	stdout, stderr, err := openClawCommand(ctx, 5*time.Minute, args...)
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw plugin uninstall failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
	}
	invalidateOpenClawPluginsStatusCache()
	rebuildOpenClawPluginsStatusCache(ctx)
	return openClawPluginMutation(id, "Plugin uninstalled. Restart the gateway to apply.", stdout, stderr), nil
}

func GetOpenClawPluginsRegistry(ctx context.Context, input *struct{}) (*OpenClawPluginsRawOutput, error) {
	payload, err := openClawJSONCommand(ctx, 20*time.Second, "plugins", "registry", "--json")
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw plugins registry inspect failed", err)
	}
	return &OpenClawPluginsRawOutput{Body: payload}, nil
}

func RefreshOpenClawPluginsRegistry(ctx context.Context, input *struct{}) (*OpenClawPluginsRawOutput, error) {
	payload, err := openClawJSONCommand(ctx, 45*time.Second, "plugins", "registry", "--refresh", "--json")
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw plugins registry refresh failed", err)
	}
	invalidateOpenClawPluginsStatusCache()
	rebuildOpenClawPluginsStatusCache(ctx)
	return &OpenClawPluginsRawOutput{Body: payload}, nil
}

func GetOpenClawPluginsDoctor(ctx context.Context, input *struct{}) (*OpenClawPluginDoctorOutput, error) {
	stdout, stderr, err := openClawCommand(ctx, 45*time.Second, "plugins", "doctor")
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw plugins doctor failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
	}
	return &OpenClawPluginDoctorOutput{Body: OpenClawPluginDoctorResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Output:    stdout,
		Stderr:    stderr,
	}}, nil
}

func requirePluginID(input *OpenClawPluginInspectInput) (string, error) {
	if input == nil || strings.TrimSpace(input.ID) == "" {
		return "", huma.Error400BadRequest("plugin id is required", nil)
	}
	return strings.TrimSpace(input.ID), nil
}

func requirePluginActionID(input *OpenClawPluginActionInput) (string, error) {
	if input == nil || strings.TrimSpace(input.ID) == "" {
		return "", huma.Error400BadRequest("plugin id is required", nil)
	}
	return strings.TrimSpace(input.ID), nil
}

func openClawPluginMutation(pluginID string, message string, stdout string, stderr string) *OpenClawPluginMutationOutput {
	return &OpenClawPluginMutationOutput{Body: OpenClawPluginMutationResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		PluginID:  pluginID,
		Message:   message,
		Stdout:    stdout,
		Stderr:    stderr,
	}}
}
