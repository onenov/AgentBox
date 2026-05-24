package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/sse"
)

const skillHubUnixInstallCommand = "curl -fsSL https://skillhub.cn/install/install.sh | bash -s -- --no-skills"
const installPackagesManifestURL = "https://agent.orence.net/releases/install-packages.json"
const pluginsStatusCacheTTL = 30 * time.Second
const homebrewPackageListCacheTTL = 5 * time.Second
const claudeCodeNPMInstallPackage = "@anthropic-ai/claude-code"
const claudeCodeID = "claude-code"
const codexCLIID = "codex"
const geminiCLIID = "gemini"
const openCodeID = "opencode"
const qoderID = "qoder"
const ccConnectID = "cc-connect"
const uvID = "uv"
const gitID = "git"
const nodeJSID = "nodejs"
const pnpmID = "pnpm"
const pm2ID = "pm2"
const ffmpegID = "ffmpeg"
const homebrewID = "homebrew"

type homebrewPackageKind string

const (
	homebrewFormula homebrewPackageKind = "formula"
	homebrewCask    homebrewPackageKind = "cask"
)

type homebrewPackageRef struct {
	kind homebrewPackageKind
	name string
}

type homebrewPackageList struct {
	formulae map[string]struct{}
	casks    map[string]struct{}
}

var (
	pluginsStatusCache    cacheEntry[[]PluginAppStatus]
	pluginsUpdatesCache   cacheEntry[[]PluginUpdateStatus]
	homebrewPackagesCache cacheEntry[homebrewPackageList]
)

type installPackageEntry struct {
	URL string `json:"url"`
}

type installPackagesManifest struct {
	Git      map[string]map[string]installPackageEntry `json:"git"`
	NodeJS   map[string]map[string]installPackageEntry `json:"nodejs"`
	Homebrew map[string]installPackageEntry            `json:"homebrew"`
}

type PluginsStatusInput struct {
	Refresh bool `query:"refresh" doc:"Force refresh plugin app status." example:"false"`
}

type PluginsUpdatesInput struct {
	Refresh bool `query:"refresh" doc:"Force refresh cached plugin app update checks." example:"false"`
}

type PluginPathInput struct {
	ID string `path:"id" doc:"Plugin app id." example:"skillhub"`
}

type PluginsStatusOutput struct {
	Body PluginsStatusResponse
}

type PluginsUpdatesOutput struct {
	Body PluginsUpdatesResponse
}

type PluginActionOutput struct {
	Body PluginActionResponse
}

type PluginsStatusResponse struct {
	Status    string               `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string               `json:"timestamp" example:"2026-05-13T13:30:00Z" doc:"UTC response timestamp."`
	Cache     CacheInfo            `json:"cache" doc:"Cache behavior used for this response."`
	Plugins   []PluginAppStatus    `json:"plugins" doc:"Third-party extension applications managed by AgentBox."`
	Summary   PluginsStatusSummary `json:"summary" doc:"Aggregate extension application counts."`
}

type PluginsStatusSummary struct {
	Total     int `json:"total" example:"1" doc:"Total known extension applications."`
	Installed int `json:"installed" example:"1" doc:"Installed extension applications."`
	Missing   int `json:"missing" example:"0" doc:"Missing extension applications."`
}

type PluginAppStatus struct {
	ID              string   `json:"id" example:"skillhub" doc:"Stable app id."`
	Name            string   `json:"name" example:"SkillHub" doc:"Display name."`
	Tagline         string   `json:"tagline" doc:"Short product tagline."`
	Description     string   `json:"description" doc:"Product description."`
	Homepage        string   `json:"homepage,omitempty" doc:"Product homepage."`
	LogoURL         string   `json:"logoUrl,omitempty" doc:"Application logo URL."`
	InstallCommand  string   `json:"installCommand" doc:"Recommended install command."`
	Installed       bool     `json:"installed" example:"true" doc:"Whether the app CLI is installed."`
	CLIPath         string   `json:"cliPath,omitempty" example:"/Users/one/.local/bin/skillhub" doc:"Resolved CLI path."`
	Version         string   `json:"version,omitempty" example:"1.0.0" doc:"Detected CLI version."`
	Status          string   `json:"status" example:"installed" doc:"Normalized status: installed or missing."`
	CanInstall      bool     `json:"canInstall" example:"true" doc:"Whether AgentBox can install this app."`
	CanUpdate       bool     `json:"canUpdate" example:"true" doc:"Whether AgentBox can update this app."`
	CanUninstall    bool     `json:"canUninstall" example:"false" doc:"Whether AgentBox can uninstall this app."`
	UpdateAvailable bool     `json:"updateAvailable" example:"false" doc:"Whether a silent delayed update check found an available update."`
	SearchExamples  []string `json:"searchExamples,omitempty" doc:"Example CLI searches."`
	Error           string   `json:"error,omitempty" doc:"Detection error."`
}

type PluginsUpdatesResponse struct {
	Status    string               `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string               `json:"timestamp" example:"2026-05-13T13:30:00Z" doc:"UTC response timestamp."`
	Cache     CacheInfo            `json:"cache" doc:"Cache behavior used for this response."`
	Updates   []PluginUpdateStatus `json:"updates" doc:"Slow update-check results for extension applications."`
}

type PluginUpdateStatus struct {
	ID              string `json:"id" example:"skillhub" doc:"Plugin app id."`
	CanUpdate       bool   `json:"canUpdate" example:"true" doc:"Whether AgentBox can update this app."`
	UpdateAvailable bool   `json:"updateAvailable" example:"false" doc:"Whether an update is available."`
	Error           string `json:"error,omitempty" doc:"Update check error."`
}

type PluginActionResponse struct {
	Status    string          `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string          `json:"timestamp" example:"2026-05-13T13:30:00Z" doc:"UTC response timestamp."`
	ID        string          `json:"id" example:"skillhub" doc:"Plugin app id."`
	Action    string          `json:"action" example:"install" doc:"Action name."`
	Command   string          `json:"command" doc:"Command executed by the server."`
	Stdout    string          `json:"stdout,omitempty" doc:"Command stdout."`
	Stderr    string          `json:"stderr,omitempty" doc:"Command stderr."`
	App       PluginAppStatus `json:"app" doc:"Detected app status after the action."`
}

type PluginActionStreamMetaEvent struct {
	ID        string `json:"id" doc:"Stream task id."`
	PluginID  string `json:"pluginId" doc:"Plugin app id."`
	Action    string `json:"action" doc:"Action name."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type PluginActionStreamStatusEvent struct {
	ID        string `json:"id" doc:"Stream task id."`
	PluginID  string `json:"pluginId" doc:"Plugin app id."`
	Action    string `json:"action" doc:"Action name."`
	Status    string `json:"status" doc:"Task status."`
	Progress  int    `json:"progress" doc:"Task progress from 0 to 100."`
	Error     string `json:"error,omitempty" doc:"Error message when status is error."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type PluginActionStreamLogEvent struct {
	ID        string `json:"id" doc:"Stream task id."`
	PluginID  string `json:"pluginId" doc:"Plugin app id."`
	Line      string `json:"line" doc:"Log line."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type PluginActionStreamErrorEvent struct {
	ID        string `json:"id" doc:"Stream task id."`
	PluginID  string `json:"pluginId" doc:"Plugin app id."`
	Message   string `json:"message" doc:"Error message."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type PluginActionStreamDoneEvent struct {
	ID        string          `json:"id" doc:"Stream task id."`
	PluginID  string          `json:"pluginId" doc:"Plugin app id."`
	Action    string          `json:"action" doc:"Action name."`
	App       PluginAppStatus `json:"app" doc:"Detected app status after the action."`
	Timestamp string          `json:"timestamp" doc:"UTC event timestamp."`
}

func ListPlugins(ctx context.Context, input *PluginsStatusInput) (*PluginsStatusOutput, error) {
	if input == nil {
		input = &PluginsStatusInput{}
	}
	plugins := cached(&pluginsStatusCache, pluginsStatusCacheTTL, input.Refresh, func() []PluginAppStatus {
		return detectPluginApps(ctx)
	})
	return &PluginsStatusOutput{Body: PluginsStatusResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Cache:     CacheInfo{Refresh: input.Refresh},
		Plugins:   plugins,
		Summary:   summarizePluginApps(plugins),
	}}, nil
}

func ListPluginUpdates(ctx context.Context, input *PluginsUpdatesInput) (*PluginsUpdatesOutput, error) {
	if input == nil {
		input = &PluginsUpdatesInput{}
	}
	updates := cached(&pluginsUpdatesCache, 0, input.Refresh, func() []PluginUpdateStatus {
		return detectPluginUpdates(ctx, input.Refresh)
	})
	return &PluginsUpdatesOutput{Body: PluginsUpdatesResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Cache:     CacheInfo{Refresh: input.Refresh},
		Updates:   updates,
	}}, nil
}

func InstallPlugin(ctx context.Context, input *PluginPathInput) (*PluginActionOutput, error) {
	id := normalizePluginAppID(input.ID)
	var command string
	switch id {
	case "skillhub":
		command = skillHubInstallCommand()
		if runtime.GOOS == "windows" && resolveToolPath("bash") == "" {
			return nil, huma.Error400BadRequest("install plugin app failed", errors.New("Windows 安装 SkillHub 需要 Git Bash 或 WSL bash；请先安装 Git 后重试"))
		}
	case claudeCodeID:
		command = claudeCodeInstallCommand()
	case codexCLIID:
		command = codexCLIInstallCommand()
	case geminiCLIID:
		command = geminiCLIInstallCommand()
	case openCodeID:
		command = openCodeInstallCommand()
	case qoderID:
		command = qoderInstallCommand()
	case ccConnectID:
		command = ccConnectInstallCommand()
	case uvID:
		command = uvInstallCommand()
	case gitID:
		command = gitInstallCommand()
		stdout, stderr, err := installGit(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("install plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "install", command, stdout, stderr), nil
	case homebrewID:
		command = homebrewInstallCommand()
		stdout, stderr, err := installHomebrew(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("install plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "install", command, stdout, stderr), nil
	case nodeJSID:
		command = nodeJSInstallCommand()
		stdout, stderr, err := installNodeJS(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("install plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "install", command, stdout, stderr), nil
	case pnpmID:
		command = pnpmInstallCommand()
	case pm2ID:
		command = pm2InstallCommand()
	case ffmpegID:
		command = ffmpegInstallCommand()
	default:
		return nil, huma.Error404NotFound("plugin app not found", fmt.Errorf("plugin app %q not found", input.ID))
	}
	stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
	if err != nil {
		return nil, huma.Error500InternalServerError("install plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
	}
	invalidatePluginsCache()
	return pluginActionResponse(ctx, id, "install", command, stdout, stderr), nil
}

func InstallPluginStream(ctx context.Context, input *PluginPathInput, send sse.Sender) {
	id := normalizePluginAppID(input.ID)
	run := pluginActionStreamRun{
		id:       "plugin-install-" + id + "-" + time.Now().UTC().Format("20060102-150405"),
		pluginID: id,
		action:   "install",
		send:     send,
	}
	if !run.emitMeta() {
		return
	}
	if !run.emitLog("任务已创建。") || !run.emitStatus("running", 1, "") {
		return
	}

	command, err := pluginInstallCommand(id)
	if err != nil {
		run.fail(err)
		return
	}
	run.emitLog("安装目标：" + id)
	if strings.TrimSpace(command) != "" {
		run.emitLog("执行安装命令：" + command)
	}
	if !run.emitStatus("running", 10, "") {
		return
	}

	if err := runPluginInstallStreaming(ctx, id, command, run.emitLog); err != nil {
		run.fail(err)
		return
	}
	invalidatePluginsCache()
	run.emitLog("安装命令已完成。")
	if err := send.Data(PluginActionStreamDoneEvent{
		ID:        run.id,
		PluginID:  id,
		Action:    "install",
		App:       pluginStreamDoneApp(id),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		return
	}
	_ = run.emitStatus("done", 100, "")
}

func UpdatePlugin(ctx context.Context, input *PluginPathInput) (*PluginActionOutput, error) {
	id := normalizePluginAppID(input.ID)
	var path string
	var args []string
	switch id {
	case "skillhub":
		path = resolveSkillHubPath()
		args = []string{"self-upgrade"}
	case claudeCodeID:
		path = resolveClaudeCodePath()
		if path == "" && !homebrewPackageInstalled(ctx, brewCask("claude-code"), brewCask("claude-code@latest")) {
			return nil, huma.Error400BadRequest(id+" is not installed", nil)
		}
		command, stdout, stderr, err := updateClaudeCode(ctx, path)
		if err != nil {
			return nil, huma.Error500InternalServerError("update plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "update", command, stdout, stderr), nil
	case codexCLIID:
		path = resolveCodexCLIPath()
		if path == "" && !homebrewPackageInstalled(ctx, brewCask("codex")) {
			return nil, huma.Error400BadRequest(id+" is not installed", nil)
		}
		command, stdout, stderr, err := updateCodexCLI(ctx, path)
		if err != nil {
			return nil, huma.Error500InternalServerError("update plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "update", command, stdout, stderr), nil
	case geminiCLIID:
		path = resolveGeminiCLIPath()
		if path == "" && !homebrewPackageInstalled(ctx, brewFormula("gemini-cli")) {
			return nil, huma.Error400BadRequest(id+" is not installed", nil)
		}
		command, stdout, stderr, err := updateGeminiCLI(ctx, path)
		if err != nil {
			return nil, huma.Error500InternalServerError("update plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "update", command, stdout, stderr), nil
	case openCodeID:
		path = resolveOpenCodePath()
		if path == "" && !homebrewPackageInstalled(ctx, brewFormula("opencode"), brewFormula("anomalyco/tap/opencode")) {
			return nil, huma.Error400BadRequest(id+" is not installed", nil)
		}
		command, stdout, stderr, err := updateOpenCode(ctx, path)
		if err != nil {
			return nil, huma.Error500InternalServerError("update plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "update", command, stdout, stderr), nil
	case qoderID:
		path = resolveQoderPath()
		if path == "" {
			return nil, huma.Error400BadRequest(id+" is not installed", nil)
		}
		command, stdout, stderr, err := updateQoder(ctx, path)
		if err != nil {
			return nil, huma.Error500InternalServerError("update plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "update", command, stdout, stderr), nil
	case ccConnectID:
		path = resolveCCConnectPath()
		if path == "" && !homebrewPackageInstalled(ctx, brewFormula("cc-connect")) {
			return nil, huma.Error400BadRequest(id+" is not installed", nil)
		}
		command, stdout, stderr, err := updateCCConnect(ctx, path)
		if err != nil {
			return nil, huma.Error500InternalServerError("update plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "update", command, stdout, stderr), nil
	case uvID:
		path = resolveUVPath()
		if path == "" && !homebrewPackageInstalled(ctx, brewFormula("uv")) {
			return nil, huma.Error400BadRequest(id+" is not installed", nil)
		}
		command, stdout, stderr, err := updateUV(ctx, path)
		if err != nil {
			return nil, huma.Error500InternalServerError("update plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "update", command, stdout, stderr), nil
	case homebrewID:
		path = resolveHomebrewPath()
		if path == "" {
			return nil, huma.Error400BadRequest(id+" is not installed", nil)
		}
		command, stdout, stderr, err := updateHomebrew(ctx, path)
		if err != nil {
			return nil, huma.Error500InternalServerError("update plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "update", command, stdout, stderr), nil
	case gitID:
		path = resolveGitPath()
		if path == "" && !homebrewPackageInstalled(ctx, brewFormula("git")) {
			return nil, huma.Error400BadRequest(id+" is not installed", nil)
		}
		command, stdout, stderr, err := updateGit(ctx, path)
		if err != nil {
			return nil, huma.Error500InternalServerError("update plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "update", command, stdout, stderr), nil
	case nodeJSID:
		path = resolveNodeJSPath()
		if path == "" && !homebrewPackageInstalled(ctx, brewFormula("node"), brewFormula("node@24"), brewFormula("node@22")) {
			return nil, huma.Error400BadRequest(id+" is not installed", nil)
		}
		command, stdout, stderr, err := updateNodeJS(ctx, path)
		if err != nil {
			return nil, huma.Error500InternalServerError("update plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "update", command, stdout, stderr), nil
	case pnpmID:
		path = resolvePNPMPath()
		if path == "" && !homebrewPackageInstalled(ctx, brewFormula("pnpm")) {
			return nil, huma.Error400BadRequest(id+" is not installed", nil)
		}
		command, stdout, stderr, err := updatePNPM(ctx, path)
		if err != nil {
			return nil, huma.Error500InternalServerError("update plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "update", command, stdout, stderr), nil
	case pm2ID:
		path = resolvePM2Path()
		if path == "" && !homebrewPackageInstalled(ctx, brewFormula("pm2")) {
			return nil, huma.Error400BadRequest(id+" is not installed", nil)
		}
		command, stdout, stderr, err := updatePM2(ctx, path)
		if err != nil {
			return nil, huma.Error500InternalServerError("update plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "update", command, stdout, stderr), nil
	case ffmpegID:
		path = resolveFFmpegPath()
		if path == "" && !homebrewPackageInstalled(ctx, brewFormula("ffmpeg")) {
			return nil, huma.Error400BadRequest(id+" is not installed", nil)
		}
		command, stdout, stderr, err := updateFFmpeg(ctx, path)
		if err != nil {
			return nil, huma.Error500InternalServerError("update plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "update", command, stdout, stderr), nil
	default:
		return nil, huma.Error404NotFound("plugin app not found", fmt.Errorf("plugin app %q not found", input.ID))
	}
	if path == "" {
		return nil, huma.Error400BadRequest(id+" is not installed", nil)
	}
	stdout, stderr, err := runCommand(ctx, 5*time.Minute, path, args...)
	if err != nil {
		return nil, huma.Error500InternalServerError("update plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
	}
	invalidatePluginsCache()
	return pluginActionResponse(ctx, id, "update", strings.Join(append([]string{path}, args...), " "), stdout, stderr), nil
}

func UninstallPlugin(ctx context.Context, input *PluginPathInput) (*PluginActionOutput, error) {
	id := normalizePluginAppID(input.ID)
	switch id {
	case "skillhub":
		return nil, huma.Error400BadRequest("skillhub uninstall is not supported yet", nil)
	case claudeCodeID:
		if !isNativeClaudeCodeInstall(resolveClaudeCodePath()) {
			return nil, huma.Error400BadRequest("claude code uninstall is only supported for native installs", nil)
		}
		stdout, stderr, err := uninstallNativeClaudeCode()
		if err != nil {
			return nil, huma.Error500InternalServerError("uninstall plugin app failed", err)
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "uninstall", claudeCodeUninstallCommand(), stdout, stderr), nil
	case codexCLIID:
		path := resolveCodexCLIPath()
		command := codexCLIUninstallCommand(ctx, path)
		if command == "" {
			return nil, huma.Error400BadRequest("codex cli uninstall is not supported for this install source", nil)
		}
		stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
		if err != nil {
			return nil, huma.Error500InternalServerError("uninstall plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "uninstall", command, stdout, stderr), nil
	case geminiCLIID:
		path := resolveGeminiCLIPath()
		command := geminiCLIUninstallCommand(ctx, path)
		if command == "" {
			return nil, huma.Error400BadRequest("gemini cli uninstall is not supported for this install source", nil)
		}
		stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
		if err != nil {
			return nil, huma.Error500InternalServerError("uninstall plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "uninstall", command, stdout, stderr), nil
	case openCodeID:
		path := resolveOpenCodePath()
		command := openCodeUninstallCommand(path)
		if command == "" {
			return nil, huma.Error400BadRequest("opencode uninstall is only supported for npm global or Homebrew installs", nil)
		}
		stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
		if err != nil {
			return nil, huma.Error500InternalServerError("uninstall plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "uninstall", command, stdout, stderr), nil
	case qoderID:
		path := resolveQoderPath()
		command := qoderUninstallCommand(path)
		if command == "" {
			return nil, huma.Error400BadRequest("qoder uninstall is only supported for npm global installs", nil)
		}
		stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
		if err != nil {
			return nil, huma.Error500InternalServerError("uninstall plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "uninstall", command, stdout, stderr), nil
	case ccConnectID:
		path := resolveCCConnectPath()
		command := ccConnectUninstallCommand(path)
		if command == "" {
			return nil, huma.Error400BadRequest("cc-connect uninstall is only supported for npm global or Homebrew installs", nil)
		}
		stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
		if err != nil {
			return nil, huma.Error500InternalServerError("uninstall plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "uninstall", command, stdout, stderr), nil
	case uvID:
		path := resolveUVPath()
		command := uvUninstallCommand(ctx, path)
		if command == "" {
			return nil, huma.Error400BadRequest("uv uninstall is not supported for this install source", nil)
		}
		stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
		if err != nil {
			return nil, huma.Error500InternalServerError("uninstall plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "uninstall", command, stdout, stderr), nil
	case homebrewID:
		return nil, huma.Error400BadRequest("homebrew uninstall is not supported from AgentBox", nil)
	case gitID:
		path := resolveGitPath()
		command := gitUninstallCommand(path)
		if command == "" {
			return nil, huma.Error400BadRequest("git uninstall is only supported for package-manager installs", nil)
		}
		stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
		if err != nil {
			return nil, huma.Error500InternalServerError("uninstall plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "uninstall", command, stdout, stderr), nil
	case nodeJSID:
		command := nodeJSUninstallCommand()
		stdout, stderr, err := runPlatformShellCommand(ctx, 10*time.Minute, command)
		if err != nil {
			return nil, huma.Error500InternalServerError("uninstall plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "uninstall", command, stdout, stderr), nil
	case pnpmID:
		path := resolvePNPMPath()
		command := pnpmUninstallCommand(path)
		if command == "" {
			return nil, huma.Error400BadRequest("pnpm uninstall is only supported for npm global installs", nil)
		}
		stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
		if err != nil {
			return nil, huma.Error500InternalServerError("uninstall plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "uninstall", command, stdout, stderr), nil
	case pm2ID:
		path := resolvePM2Path()
		command := pm2UninstallCommand(path)
		if command == "" {
			return nil, huma.Error400BadRequest("pm2 uninstall is only supported for npm global installs", nil)
		}
		stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
		if err != nil {
			return nil, huma.Error500InternalServerError("uninstall plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "uninstall", command, stdout, stderr), nil
	case ffmpegID:
		path := resolveFFmpegPath()
		command := ffmpegUninstallCommand(path)
		if command == "" {
			return nil, huma.Error400BadRequest("ffmpeg uninstall is only supported for package-manager installs", nil)
		}
		stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
		if err != nil {
			return nil, huma.Error500InternalServerError("uninstall plugin app failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidatePluginsCache()
		return pluginActionResponse(ctx, id, "uninstall", command, stdout, stderr), nil
	default:
		return nil, huma.Error404NotFound("plugin app not found", fmt.Errorf("plugin app %q not found", input.ID))
	}
}

func detectPluginApps(ctx context.Context) []PluginAppStatus {
	detectors := []func(context.Context) PluginAppStatus{
		detectSkillHub,
		detectClaudeCode,
		detectCodexCLI,
		detectGeminiCLI,
		detectOpenCode,
		detectQoder,
		detectCCConnect,
		detectUV,
		detectHomebrewPlugin,
		detectGit,
		detectNodeJS,
		detectPNPM,
		detectPM2,
		detectFFmpeg,
	}

	plugins := make([]PluginAppStatus, len(detectors))
	var wg sync.WaitGroup
	for index, detect := range detectors {
		wg.Add(1)
		go func(index int, detect func(context.Context) PluginAppStatus) {
			defer wg.Done()
			plugins[index] = detect(ctx)
		}(index, detect)
	}
	wg.Wait()
	return plugins
}

func detectPluginUpdates(ctx context.Context, refreshStatus bool) []PluginUpdateStatus {
	plugins := cached(&pluginsStatusCache, 0, refreshStatus, func() []PluginAppStatus {
		return detectPluginApps(ctx)
	})
	updates := make([]PluginUpdateStatus, 0, len(plugins))
	for _, plugin := range plugins {
		update := PluginUpdateStatus{ID: plugin.ID, CanUpdate: plugin.Installed && plugin.CanUpdate}
		if update.CanUpdate {
			update.UpdateAvailable = pluginUpdateAvailable(ctx, plugin)
		}
		updates = append(updates, update)
	}
	return updates
}

func pluginUpdateAvailable(ctx context.Context, plugin PluginAppStatus) bool {
	switch plugin.ID {
	case "skillhub":
		return skillHubUpdateAvailable(ctx, plugin.CLIPath)
	case claudeCodeID:
		return claudeCodeUpdateAvailable(ctx, plugin.CLIPath)
	case codexCLIID:
		return codexCLIUpdateAvailable(ctx, plugin.CLIPath)
	case geminiCLIID:
		return geminiCLIUpdateAvailable(ctx, plugin.CLIPath)
	case openCodeID:
		return openCodeUpdateAvailable(ctx, plugin.CLIPath)
	case qoderID:
		return qoderUpdateAvailable(ctx, plugin.CLIPath)
	case ccConnectID:
		return ccConnectUpdateAvailable(ctx, plugin.CLIPath)
	case uvID:
		return uvUpdateAvailable(ctx, plugin.CLIPath)
	case homebrewID:
		return homebrewUpdateAvailable(ctx, plugin.CLIPath)
	case gitID:
		return gitUpdateAvailable(ctx, plugin.CLIPath)
	case nodeJSID:
		return nodeJSUpdateAvailable(ctx, plugin.CLIPath)
	case pnpmID:
		return pnpmUpdateAvailable(ctx, plugin.CLIPath)
	case pm2ID:
		return pm2UpdateAvailable(ctx, plugin.CLIPath)
	case ffmpegID:
		return ffmpegUpdateAvailable(ctx, plugin.CLIPath)
	default:
		return false
	}
}

func invalidatePluginsCache() {
	pluginsStatusCache.mu.Lock()
	pluginsStatusCache.loaded = false
	pluginsStatusCache.expiresAt = time.Time{}
	pluginsStatusCache.value = nil
	pluginsStatusCache.mu.Unlock()

	pluginsUpdatesCache.mu.Lock()
	pluginsUpdatesCache.loaded = false
	pluginsUpdatesCache.expiresAt = time.Time{}
	pluginsUpdatesCache.value = nil
	pluginsUpdatesCache.mu.Unlock()

	homebrewPackagesCache.mu.Lock()
	homebrewPackagesCache.loaded = false
	homebrewPackagesCache.expiresAt = time.Time{}
	homebrewPackagesCache.value = homebrewPackageList{}
	homebrewPackagesCache.mu.Unlock()
}

func pluginActionResponse(ctx context.Context, id string, action string, command string, stdout string, stderr string) *PluginActionOutput {
	return &PluginActionOutput{Body: PluginActionResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		ID:        id,
		Action:    action,
		Command:   command,
		Stdout:    strings.TrimSpace(stdout),
		Stderr:    strings.TrimSpace(stderr),
		App:       detectPluginApp(ctx, id),
	}}
}

func detectPluginApp(ctx context.Context, id string) PluginAppStatus {
	switch id {
	case "skillhub":
		return detectSkillHub(ctx)
	case claudeCodeID:
		return detectClaudeCode(ctx)
	case codexCLIID:
		return detectCodexCLI(ctx)
	case geminiCLIID:
		return detectGeminiCLI(ctx)
	case openCodeID:
		return detectOpenCode(ctx)
	case qoderID:
		return detectQoder(ctx)
	case ccConnectID:
		return detectCCConnect(ctx)
	case uvID:
		return detectUV(ctx)
	case homebrewID:
		return detectHomebrewPlugin(ctx)
	case gitID:
		return detectGit(ctx)
	case nodeJSID:
		return detectNodeJS(ctx)
	case pnpmID:
		return detectPNPM(ctx)
	case pm2ID:
		return detectPM2(ctx)
	case ffmpegID:
		return detectFFmpeg(ctx)
	default:
		return PluginAppStatus{ID: id, Name: id, Status: "missing"}
	}
}

func pluginStreamDoneApp(id string) PluginAppStatus {
	return PluginAppStatus{
		ID:         id,
		Name:       pluginDisplayName(id),
		Installed:  true,
		Status:     "installed",
		CanInstall: true,
		CanUpdate:  true,
	}
}

func pluginDisplayName(id string) string {
	switch id {
	case "skillhub":
		return "SkillHub"
	case claudeCodeID:
		return "Claude Code"
	case codexCLIID:
		return "Codex CLI"
	case geminiCLIID:
		return "Gemini CLI"
	case openCodeID:
		return "OpenCode"
	case qoderID:
		return "Qoder CLI"
	case ccConnectID:
		return "CC-Connect"
	case uvID:
		return "uv"
	case homebrewID:
		return "Homebrew"
	case gitID:
		return "Git"
	case nodeJSID:
		return "Node.js"
	case pnpmID:
		return "pnpm"
	case pm2ID:
		return "PM2"
	case ffmpegID:
		return "FFmpeg"
	default:
		return id
	}
}

func detectSkillHub(ctx context.Context) PluginAppStatus {
	path := resolveSkillHubPath()
	app := PluginAppStatus{
		ID:             "skillhub",
		Name:           "SkillHub",
		Tagline:        "专为中国用户优化的 AI Skills 社区",
		Description:    "中文优化的 AI Skills 搜索、安装与升级工具。",
		Homepage:       "https://skillhub.cn",
		LogoURL:        "https://assets.orence.net/file/20260514002457881.png",
		InstallCommand: skillHubInstallCommand(),
		Installed:      path != "",
		CLIPath:        path,
		Status:         "missing",
		CanInstall:     true,
		CanUpdate:      path != "",
		CanUninstall:   false,
	}
	if path == "" {
		return app
	}
	app.Status = "installed"
	if version := firstLine(pluginCommandOutput(ctx, path, "--skip-self-upgrade", "--version")); version != "" {
		app.Version = version
	}
	return app
}

func skillHubUpdateAvailable(ctx context.Context, path string) bool {
	stdout, stderr, err := runCommand(ctx, 20*time.Second, path, "--skip-self-upgrade", "self-upgrade", "--check-only", "--timeout", "5")
	output := strings.ToLower(strings.TrimSpace(stdout + "\n" + stderr))
	if strings.Contains(output, "self-upgrade available") || strings.Contains(output, "upgrade available") {
		return true
	}
	if strings.Contains(output, "up-to-date") || strings.Contains(output, "no upgrade needed") {
		return false
	}
	return err == nil && strings.Contains(output, "available")
}

func resolveSkillHubPath() string {
	return resolveToolPath("skillhub")
}

func skillHubInstallCommand() string {
	if runtime.GOOS == "windows" {
		return "bash -lc '" + skillHubUnixInstallCommand + "'"
	}
	return skillHubUnixInstallCommand
}

func detectClaudeCode(ctx context.Context) PluginAppStatus {
	path := resolveClaudeCodePath()
	brewInstalled := homebrewPackageInstalled(ctx, brewCask("claude-code"), brewCask("claude-code@latest"))
	if path == "" {
		path = homebrewPackageExecutablePath(ctx, "claude", brewCask("claude-code"), brewCask("claude-code@latest"))
	}
	app := PluginAppStatus{
		ID:             claudeCodeID,
		Name:           "Claude Code",
		Tagline:        "Anthropic 官方代理编码工具",
		Description:    "Anthropic 官方本地 AI 编码助手。",
		Homepage:       "https://code.claude.com/docs/zh-CN/overview",
		LogoURL:        "https://assets.orence.net/file/20260514002524491.png",
		InstallCommand: claudeCodeInstallCommand(),
		Installed:      path != "" || brewInstalled,
		CLIPath:        path,
		Status:         "missing",
		CanInstall:     true,
		CanUpdate:      path != "" || brewInstalled,
		CanUninstall:   isNativeClaudeCodeInstall(path),
	}
	if !app.Installed {
		return app
	}
	app.Status = "installed"
	if version := firstLine(pluginCommandOutput(ctx, path, "--version")); version != "" {
		app.Version = version
	}
	return app
}

func claudeCodeInstallCommand() string {
	if runtime.GOOS == "windows" {
		return "if (Get-Command npm -ErrorAction SilentlyContinue) { npm install -g " + claudeCodeNPMInstallPackage + " }; if (!(Get-Command claude -ErrorAction SilentlyContinue)) { irm https://downloads.claude.ai/claude-code-releases/bootstrap.ps1 | iex }"
	}
	return "if command -v npm >/dev/null 2>&1; then npm install -g " + claudeCodeNPMInstallPackage + "; fi; if ! command -v claude >/dev/null 2>&1; then curl -fsSL https://downloads.claude.ai/claude-code-releases/bootstrap.sh | bash; fi"
}

func claudeCodeUninstallCommand() string {
	if runtime.GOOS == "windows" {
		return `Remove-Item "$HOME\.local\bin\claude.exe" -Force; Remove-Item "$HOME\.local\share\claude" -Recurse -Force`
	}
	return "rm ~/.local/bin/claude && rm -rf ~/.local/share/claude"
}

func resolveClaudeCodePath() string {
	candidates := []string{}
	if runtime.GOOS == "windows" {
		candidates = append(candidates, windowsLocalAppDataExecutablePath("Claude", "claude.exe"))
	}
	return resolveToolPath("claude", candidates...)
}

func claudeCodeUpdateAvailable(ctx context.Context, path string) bool {
	if runtime.GOOS == "windows" {
		stdout, stderr, err := runCommand(ctx, 20*time.Second, "winget", "upgrade", "--id", "Anthropic.ClaudeCode", "--exact")
		output := strings.ToLower(strings.TrimSpace(stdout + "\n" + stderr))
		return err == nil && strings.Contains(output, "anthropic.claudecode")
	}
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewCask("claude-code"), brewCask("claude-code@latest")) {
		return homebrewPackageOutdated(ctx, brewCask("claude-code"), brewCask("claude-code@latest"))
	}
	return false
}

func updateClaudeCode(ctx context.Context, path string) (string, string, string, error) {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewCask("claude-code"), brewCask("claude-code@latest")) {
		return homebrewUpgrade(ctx, brewCask("claude-code"), brewCask("claude-code@latest"))
	}
	stdout, stderr, err := runCommand(ctx, 5*time.Minute, path, "update")
	return path + " update", stdout, stderr, err
}

func isNativeClaudeCodeInstall(path string) bool {
	if path == "" {
		return false
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return false
	}
	nativeBin := userLocalExecutablePath("claude")
	if samePath(path, nativeBin) {
		return true
	}
	target, err := filepath.EvalSymlinks(path)
	if err != nil {
		return false
	}
	claudeDir := filepath.Join(home, ".local", "share", "claude")
	return strings.HasPrefix(filepath.Clean(target), filepath.Clean(claudeDir)+string(os.PathSeparator))
}

func uninstallNativeClaudeCode() (string, string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", "", err
	}
	removed := []string{}
	for _, path := range []string{
		userLocalExecutablePath("claude"),
		filepath.Join(home, ".local", "share", "claude"),
	} {
		if path == "" {
			continue
		}
		if _, err := os.Lstat(path); os.IsNotExist(err) {
			continue
		}
		if err := os.RemoveAll(path); err != nil {
			return "", "", err
		}
		removed = append(removed, path)
	}
	if len(removed) == 0 {
		return "Claude Code native install files were already absent.", "", nil
	}
	return "Removed " + strings.Join(removed, "\nRemoved "), "", nil
}

func detectCodexCLI(ctx context.Context) PluginAppStatus {
	path := resolveCodexCLIPath()
	brewInstalled := homebrewPackageInstalled(ctx, brewCask("codex"))
	if path == "" {
		path = homebrewPackageExecutablePath(ctx, "codex", brewCask("codex"))
	}
	app := PluginAppStatus{
		ID:             codexCLIID,
		Name:           "Codex CLI",
		Tagline:        "OpenAI 的本机终端编码代理",
		Description:    "OpenAI 本地终端编码代理，支持 TUI 与自动化。",
		Homepage:       "https://developers.openai.com/codex/cli",
		LogoURL:        "https://assets.orence.net/file/20260514002449434.png",
		InstallCommand: codexCLIInstallCommand(),
		Installed:      path != "" || brewInstalled,
		CLIPath:        path,
		Status:         "missing",
		CanInstall:     true,
		CanUpdate:      path != "" || brewInstalled,
		CanUninstall:   canUninstallCodexCLI(path),
	}
	if !app.Installed {
		return app
	}
	app.Status = "installed"
	if version := firstLine(pluginCommandOutput(ctx, path, "--version")); version != "" {
		app.Version = version
	}
	return app
}

func codexCLIInstallCommand() string {
	if runtime.GOOS == "darwin" && resolveHomebrewPath() != "" {
		return "brew install --cask codex"
	}
	return "npm i -g @openai/codex"
}

func resolveCodexCLIPath() string {
	return resolveToolPath("codex")
}

func codexCLIUpdateAvailable(ctx context.Context, path string) bool {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewCask("codex")) {
		return homebrewPackageOutdated(ctx, brewCask("codex"))
	}
	if isNPMPackageInstall(path, "@openai/codex") {
		stdout, stderr, err := runPlatformShellCommand(ctx, 20*time.Second, "npm outdated -g --json @openai/codex")
		output := strings.ToLower(strings.TrimSpace(stdout + "\n" + stderr))
		return err != nil && strings.Contains(output, "@openai/codex")
	}
	return false
}

func updateCodexCLI(ctx context.Context, path string) (string, string, string, error) {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewCask("codex")) {
		return homebrewUpgrade(ctx, brewCask("codex"))
	}
	if isNPMPackageInstall(path, "@openai/codex") {
		command := "npm i -g @openai/codex@latest"
		stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
		return command, stdout, stderr, err
	}
	stdout, stderr, err := runCommand(ctx, 5*time.Minute, path, "update")
	return path + " update", stdout, stderr, err
}

func codexCLIUninstallCommand(ctx context.Context, path string) string {
	if isHomebrewInstallPath(path) {
		return "brew uninstall --cask codex"
	}
	if isNPMPackageInstall(path, "@openai/codex") {
		return "npm uninstall -g @openai/codex"
	}
	return ""
}

func canUninstallCodexCLI(path string) bool {
	return isHomebrewInstallPath(path) || isNPMPackageInstall(path, "@openai/codex")
}

func detectGeminiCLI(ctx context.Context) PluginAppStatus {
	path := resolveGeminiCLIPath()
	brewInstalled := homebrewPackageInstalled(ctx, brewFormula("gemini-cli"))
	if path == "" {
		path = homebrewPackageExecutablePath(ctx, "gemini", brewFormula("gemini-cli"))
	}
	app := PluginAppStatus{
		ID:             geminiCLIID,
		Name:           "Gemini CLI",
		Tagline:        "Google Gemini 的本机终端 AI 代理",
		Description:    "Google Gemini 本地命令行代理，支持扩展与技能。",
		Homepage:       "https://geminicli.com/docs/",
		LogoURL:        "https://assets.orence.net/file/20260514002511560.png",
		InstallCommand: geminiCLIInstallCommand(),
		Installed:      path != "" || brewInstalled,
		CLIPath:        path,
		Status:         "missing",
		CanInstall:     true,
		CanUpdate:      path != "" || brewInstalled,
		CanUninstall:   canUninstallGeminiCLI(path),
	}
	if !app.Installed {
		return app
	}
	app.Status = "installed"
	if version := firstLine(pluginCommandOutput(ctx, path, "--version")); version != "" {
		app.Version = version
	}
	return app
}

func geminiCLIInstallCommand() string {
	if runtime.GOOS == "darwin" && resolveHomebrewPath() != "" {
		return "brew install gemini-cli"
	}
	return "npm install -g @google/gemini-cli"
}

func resolveGeminiCLIPath() string {
	return resolveToolPath("gemini")
}

func geminiCLIUpdateAvailable(ctx context.Context, path string) bool {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewFormula("gemini-cli")) {
		return homebrewPackageOutdated(ctx, brewFormula("gemini-cli"))
	}
	if isNPMPackageInstall(path, "@google/gemini-cli") {
		stdout, stderr, err := runPlatformShellCommand(ctx, 20*time.Second, "npm outdated -g --json @google/gemini-cli")
		output := strings.ToLower(strings.TrimSpace(stdout + "\n" + stderr))
		return err != nil && strings.Contains(output, "@google/gemini-cli")
	}
	return false
}

func updateGeminiCLI(ctx context.Context, path string) (string, string, string, error) {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewFormula("gemini-cli")) {
		return homebrewUpgrade(ctx, brewFormula("gemini-cli"))
	}
	if isNPMPackageInstall(path, "@google/gemini-cli") {
		command := "npm install -g @google/gemini-cli@latest"
		stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
		return command, stdout, stderr, err
	}
	stdout, stderr, err := runCommand(ctx, 5*time.Minute, path, "update")
	return path + " update", stdout, stderr, err
}

func geminiCLIUninstallCommand(ctx context.Context, path string) string {
	if isHomebrewInstallPath(path) {
		return "brew uninstall gemini-cli"
	}
	if isNPMPackageInstall(path, "@google/gemini-cli") {
		return "npm uninstall -g @google/gemini-cli"
	}
	return ""
}

func canUninstallGeminiCLI(path string) bool {
	return isHomebrewInstallPath(path) || isNPMPackageInstall(path, "@google/gemini-cli")
}

func detectOpenCode(ctx context.Context) PluginAppStatus {
	path := resolveOpenCodePath()
	brewInstalled := homebrewPackageInstalled(ctx, brewFormula("opencode"), brewFormula("anomalyco/tap/opencode"))
	if path == "" {
		path = homebrewPackageExecutablePath(ctx, "opencode", brewFormula("opencode"), brewFormula("anomalyco/tap/opencode"))
	}
	app := PluginAppStatus{
		ID:             openCodeID,
		Name:           "OpenCode",
		Tagline:        "开源的本机终端 AI 编码代理",
		Description:    "opencode 是开源 AI 编码代理，支持终端、IDE、桌面应用和多提供商模型。",
		Homepage:       "https://opencode.ai/docs/zh-cn/",
		LogoURL:        "https://assets.orence.net/file/20260520163923186.png",
		InstallCommand: openCodeInstallCommand(),
		Installed:      path != "" || brewInstalled,
		CLIPath:        path,
		Status:         "missing",
		CanInstall:     true,
		CanUpdate:      path != "" || brewInstalled,
		CanUninstall:   canUninstallOpenCode(path),
		SearchExamples: []string{"opencode --version", "opencode", "opencode auth login"},
	}
	if !app.Installed {
		return app
	}
	app.Status = "installed"
	if version := firstLine(pluginCommandOutput(ctx, path, "--version")); version != "" {
		app.Version = version
	}
	return app
}

func openCodeInstallCommand() string {
	if runtime.GOOS == "darwin" && resolveHomebrewPath() != "" {
		return "brew install anomalyco/tap/opencode"
	}
	return commandWithNodeJSPrerequisite("npm install -g opencode-ai")
}

func resolveOpenCodePath() string {
	return resolveToolPath("opencode")
}

func openCodeUpdateAvailable(ctx context.Context, path string) bool {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewFormula("opencode"), brewFormula("anomalyco/tap/opencode")) {
		return homebrewPackageOutdated(ctx, brewFormula("opencode"), brewFormula("anomalyco/tap/opencode"))
	}
	if isNPMPackageInstall(path, "opencode-ai") {
		stdout, stderr, err := runPlatformShellCommand(ctx, 20*time.Second, "npm outdated -g --json opencode-ai")
		output := strings.ToLower(strings.TrimSpace(stdout + "\n" + stderr))
		return err != nil && strings.Contains(output, `"opencode-ai"`)
	}
	return false
}

func updateOpenCode(ctx context.Context, path string) (string, string, string, error) {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewFormula("opencode"), brewFormula("anomalyco/tap/opencode")) {
		return homebrewUpgrade(ctx, brewFormula("opencode"), brewFormula("anomalyco/tap/opencode"))
	}
	if isNPMPackageInstall(path, "opencode-ai") {
		command := "npm install -g opencode-ai@latest"
		stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
		return command, stdout, stderr, err
	}
	stdout, stderr, err := runCommand(ctx, 5*time.Minute, path, "upgrade")
	return path + " upgrade", stdout, stderr, err
}

func openCodeUninstallCommand(path string) string {
	if isHomebrewInstallPath(path) {
		return "brew uninstall opencode"
	}
	if isNPMPackageInstall(path, "opencode-ai") {
		return "npm uninstall -g opencode-ai"
	}
	return ""
}

func canUninstallOpenCode(path string) bool {
	return isHomebrewInstallPath(path) || isNPMPackageInstall(path, "opencode-ai")
}

func detectQoder(ctx context.Context) PluginAppStatus {
	path := resolveQoderPath()
	app := PluginAppStatus{
		ID:             qoderID,
		Name:           "Qoder CLI",
		Tagline:        "Qoder 的本机终端 AI 编码代理",
		Description:    "Qoder CLI 提供本地命令行 AI 编码能力，可在项目中运行代理式开发任务。",
		Homepage:       "https://qoder.com/",
		LogoURL:        "https://assets.orence.net/file/20260520163944197.png",
		InstallCommand: qoderInstallCommand(),
		Installed:      path != "",
		CLIPath:        path,
		Status:         "missing",
		CanInstall:     true,
		CanUpdate:      path != "",
		CanUninstall:   canUninstallQoder(path),
		SearchExamples: []string{"qodercli --version", "qodercli", "qodercli --help"},
	}
	if path == "" {
		return app
	}
	app.Status = "installed"
	if version := firstLine(pluginCommandOutput(ctx, path, "--version")); version != "" {
		app.Version = version
	}
	return app
}

func qoderInstallCommand() string {
	if runtime.GOOS == "windows" {
		return commandWithNodeJSPrerequisite("npm install -g @qoder-ai/qodercli")
	}
	return "curl -fsSL https://qoder.com/install | bash"
}

func resolveQoderPath() string {
	return resolveToolPath("qodercli", "qoder")
}

func qoderUpdateAvailable(ctx context.Context, path string) bool {
	if isNPMPackageInstall(path, "@qoder-ai/qodercli") {
		stdout, stderr, err := runPlatformShellCommand(ctx, 20*time.Second, "npm outdated -g --json @qoder-ai/qodercli")
		output := strings.ToLower(strings.TrimSpace(stdout + "\n" + stderr))
		return err != nil && strings.Contains(output, `"@qoder-ai/qodercli"`)
	}
	return false
}

func updateQoder(ctx context.Context, path string) (string, string, string, error) {
	if isNPMPackageInstall(path, "@qoder-ai/qodercli") {
		command := "npm install -g @qoder-ai/qodercli@latest"
		stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
		return command, stdout, stderr, err
	}
	command := qoderInstallCommand()
	stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
	return command, stdout, stderr, err
}

func qoderUninstallCommand(path string) string {
	if isNPMPackageInstall(path, "@qoder-ai/qodercli") {
		return "npm uninstall -g @qoder-ai/qodercli"
	}
	if isStandaloneQoderInstall(path) {
		if runtime.GOOS == "windows" {
			return `Remove-Item "$HOME\.local\bin\qodercli.exe" -Force -ErrorAction SilentlyContinue; Remove-Item "$HOME\.qoder\bin\qodercli" -Recurse -Force -ErrorAction SilentlyContinue`
		}
		return `rm -f "$HOME/.local/bin/qodercli" "$HOME/.local/bin/qoder" && rm -rf "$HOME/.qoder/bin/qodercli"`
	}
	return ""
}

func canUninstallQoder(path string) bool {
	return isNPMPackageInstall(path, "@qoder-ai/qodercli") || isStandaloneQoderInstall(path)
}

func isStandaloneQoderInstall(path string) bool {
	if path == "" {
		return false
	}
	paths := []string{path}
	if target, err := filepath.EvalSymlinks(path); err == nil {
		paths = append(paths, target)
	}
	for _, item := range paths {
		normalized := strings.ToLower(filepath.ToSlash(filepath.Clean(item)))
		if strings.Contains(normalized, "/.qoder/bin/qodercli/") {
			return true
		}
		if samePath(item, userLocalExecutablePath("qodercli")) {
			return true
		}
	}
	return false
}

func detectCCConnect(ctx context.Context) PluginAppStatus {
	path := resolveCCConnectPath()
	brewInstalled := homebrewPackageInstalled(ctx, brewFormula("cc-connect"))
	if path == "" {
		path = homebrewPackageExecutablePath(ctx, "cc-connect", brewFormula("cc-connect"))
	}
	app := PluginAppStatus{
		ID:             ccConnectID,
		Name:           "cc-connect",
		Tagline:        "把本地 AI Agent 桥接到聊天工具",
		Description:    "支持通过聊天平台远程操控 Claude Code、Codex、Gemini CLI 等本地 Agent。",
		Homepage:       "https://github.com/chenhg5/cc-connect",
		LogoURL:        "https://assets.orence.net/file/20260520163648408.svg",
		InstallCommand: ccConnectInstallCommand(),
		Installed:      path != "" || brewInstalled,
		CLIPath:        path,
		Status:         "missing",
		CanInstall:     true,
		CanUpdate:      path != "" || brewInstalled,
		CanUninstall:   canUninstallCCConnect(path),
		SearchExamples: []string{"cc-connect --version", "cc-connect web", "cc-connect update"},
	}
	if !app.Installed {
		return app
	}
	app.Status = "installed"
	if version := firstLine(pluginCommandOutput(ctx, path, "--version")); version != "" {
		app.Version = version
	}
	return app
}

func ccConnectInstallCommand() string {
	return commandWithNodeJSPrerequisite("npm install -g cc-connect")
}

func resolveCCConnectPath() string {
	return resolveToolPath("cc-connect")
}

func ccConnectUpdateAvailable(ctx context.Context, path string) bool {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewFormula("cc-connect")) {
		return homebrewPackageOutdated(ctx, brewFormula("cc-connect"))
	}
	if isNPMPackageInstall(path, "cc-connect") {
		stdout, stderr, err := runPlatformShellCommand(ctx, 20*time.Second, "npm outdated -g --json cc-connect")
		output := strings.ToLower(strings.TrimSpace(stdout + "\n" + stderr))
		return err != nil && strings.Contains(output, `"cc-connect"`)
	}
	return false
}

func updateCCConnect(ctx context.Context, path string) (string, string, string, error) {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewFormula("cc-connect")) {
		return homebrewUpgrade(ctx, brewFormula("cc-connect"))
	}
	if isNPMPackageInstall(path, "cc-connect") {
		command := "npm install -g cc-connect@latest"
		stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
		return command, stdout, stderr, err
	}
	stdout, stderr, err := runCommand(ctx, 5*time.Minute, path, "update")
	return path + " update", stdout, stderr, err
}

func ccConnectUninstallCommand(path string) string {
	if isHomebrewInstallPath(path) {
		return "brew uninstall cc-connect"
	}
	if isNPMPackageInstall(path, "cc-connect") {
		return "npm uninstall -g cc-connect"
	}
	return ""
}

func canUninstallCCConnect(path string) bool {
	return isHomebrewInstallPath(path) || isNPMPackageInstall(path, "cc-connect")
}

func detectUV(ctx context.Context) PluginAppStatus {
	path := resolveUVPath()
	brewInstalled := homebrewPackageInstalled(ctx, brewFormula("uv"))
	if path == "" {
		path = homebrewPackageExecutablePath(ctx, "uv", brewFormula("uv"))
	}
	app := PluginAppStatus{
		ID:             uvID,
		Name:           "uv",
		Tagline:        "Astral 的极速 Python 包与项目管理工具",
		Description:    "uv 提供 Python 包安装、虚拟环境、项目管理与工具运行能力。",
		Homepage:       "https://hellowac.github.io/uv-zh-cn/",
		LogoURL:        "https://assets.orence.net/file/20260515185407410.png",
		InstallCommand: uvInstallCommand(),
		Installed:      path != "" || brewInstalled,
		CLIPath:        path,
		Status:         "missing",
		CanInstall:     true,
		CanUpdate:      path != "" || brewInstalled,
		CanUninstall:   canUninstallUV(path),
		SearchExamples: []string{"uv tool install ruff", "uv run python --version", "uv add requests"},
	}
	if !app.Installed {
		return app
	}
	app.Status = "installed"
	if version := firstLine(pluginCommandOutput(ctx, path, "--version")); version != "" {
		app.Version = version
	}
	return app
}

func uvInstallCommand() string {
	if runtime.GOOS == "windows" {
		return `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`
	}
	return "curl -LsSf https://astral.sh/uv/install.sh | sh"
}

func resolveUVPath() string {
	return resolveToolPath("uv")
}

func uvUpdateAvailable(ctx context.Context, path string) bool {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewFormula("uv")) {
		return homebrewPackageOutdated(ctx, brewFormula("uv"))
	}
	if isPipxInstallPath(path) {
		stdout, stderr, err := runPlatformShellCommand(ctx, 20*time.Second, "pipx upgrade --include-injected --dry-run uv")
		output := strings.ToLower(strings.TrimSpace(stdout + "\n" + stderr))
		return err == nil && strings.Contains(output, "upgrade")
	}
	if isStandaloneUVInstall(path) {
		stdout, stderr, err := runCommand(ctx, 20*time.Second, path, "self", "update", "--dry-run")
		output := strings.ToLower(strings.TrimSpace(stdout + "\n" + stderr))
		return err == nil && (strings.Contains(output, "would update") || strings.Contains(output, "available"))
	}
	return false
}

func updateUV(ctx context.Context, path string) (string, string, string, error) {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewFormula("uv")) {
		return homebrewUpgrade(ctx, brewFormula("uv"))
	}
	if isPipxInstallPath(path) {
		command := "pipx upgrade uv"
		stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
		return command, stdout, stderr, err
	}
	if isStandaloneUVInstall(path) {
		stdout, stderr, err := runCommand(ctx, 5*time.Minute, path, "self", "update")
		return path + " self update", stdout, stderr, err
	}
	stdout, stderr, err := runCommand(ctx, 5*time.Minute, path, "self", "update")
	return path + " self update", stdout, stderr, err
}

func uvUninstallCommand(ctx context.Context, path string) string {
	if isHomebrewInstallPath(path) {
		return "brew uninstall uv"
	}
	if isPipxInstallPath(path) {
		return "pipx uninstall uv"
	}
	if isStandaloneUVInstall(path) {
		return uvStandaloneUninstallCommand()
	}
	if isPipPackageInstall(path, "uv") {
		return "python3 -m pip uninstall -y uv || python -m pip uninstall -y uv"
	}
	return ""
}

func uvStandaloneUninstallCommand() string {
	if runtime.GOOS == "windows" {
		return `Remove-Item "$HOME\.local\bin\uv.exe" -Force -ErrorAction SilentlyContinue; Remove-Item "$HOME\.local\bin\uvx.exe" -Force -ErrorAction SilentlyContinue`
	}
	return "rm -f ~/.local/bin/uv ~/.local/bin/uvx ~/.local/bin/uvw"
}

func canUninstallUV(path string) bool {
	return isHomebrewInstallPath(path) || isPipxInstallPath(path) || isStandaloneUVInstall(path) || isPipPackageInstall(path, "uv")
}

func detectHomebrewPlugin(ctx context.Context) PluginAppStatus {
	path := resolveHomebrewPath()
	app := PluginAppStatus{
		ID:             homebrewID,
		Name:           "Homebrew",
		Tagline:        "macOS 与 Linux 软件包管理器",
		Description:    "Homebrew 提供命令行工具、图形应用和系统依赖的安装与升级能力。",
		Homepage:       "https://brew.sh/",
		LogoURL:        "https://assets.orence.net/file/20260520163958776.png",
		InstallCommand: homebrewInstallCommand(),
		Installed:      path != "",
		CLIPath:        path,
		Status:         "missing",
		CanInstall:     runtime.GOOS != "windows",
		CanUpdate:      path != "",
		CanUninstall:   false,
		SearchExamples: []string{"brew install git", "brew install --cask codex", "brew update"},
	}
	if path == "" {
		if runtime.GOOS == "windows" {
			app.Error = "Homebrew is not supported on native Windows"
		}
		return app
	}
	app.Status = "installed"
	if version := firstLine(pluginCommandOutput(ctx, path, "--version")); version != "" {
		app.Version = version
	}
	return app
}

func homebrewInstallCommand() string {
	if runtime.GOOS == "darwin" {
		return "download Homebrew.pkg from install-packages manifest and open with macOS Installer"
	}
	return `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
}

func installHomebrew(ctx context.Context) (string, string, error) {
	if resolveHomebrewPath() != "" {
		return "Homebrew is already installed.", "", nil
	}
	if runtime.GOOS == "windows" {
		return "", "", fmt.Errorf("homebrew install is not supported on native Windows")
	}
	if runtime.GOOS != "darwin" {
		return runPlatformShellCommand(ctx, 15*time.Minute, homebrewInstallCommand())
	}

	return installHomebrewPackage(ctx)
}

func installHomebrewPackage(ctx context.Context) (string, string, error) {
	installerPath, err := downloadInstallPackage(ctx, homebrewID, "Homebrew.pkg")
	if err != nil {
		return "", "", err
	}
	stdout, stderr, err := runCommand(ctx, 10*time.Second, "open", installerPath)
	if err != nil {
		return stdout, stderr, err
	}
	message := "Downloaded Homebrew.pkg and opened it with macOS Installer: " + installerPath
	return strings.TrimSpace(stdout + "\n" + message), stderr, nil
}

func fetchInstallPackagesManifest(ctx context.Context) (installPackagesManifest, error) {
	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		manifest, err := fetchInstallPackagesManifestOnce(ctx)
		if err == nil {
			return manifest, nil
		}
		lastErr = err
		if attempt < 3 {
			time.Sleep(time.Duration(attempt) * time.Second)
		}
	}
	return installPackagesManifest{}, fmt.Errorf("download install packages manifest failed after retries: %w", lastErr)
}

func fetchInstallPackagesManifestOnce(ctx context.Context) (installPackagesManifest, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(cmdCtx, http.MethodGet, installPackagesManifestURL, nil)
	if err != nil {
		return installPackagesManifest{}, err
	}
	req.Header.Set("User-Agent", "AgentBox")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return installPackagesManifest{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return installPackagesManifest{}, fmt.Errorf("download install packages manifest failed with status %s", resp.Status)
	}

	var manifest installPackagesManifest
	if err := json.NewDecoder(resp.Body).Decode(&manifest); err != nil {
		return installPackagesManifest{}, err
	}
	return manifest, nil
}

func installPackageURL(ctx context.Context, packageID string) (string, error) {
	manifest, err := fetchInstallPackagesManifest(ctx)
	if err != nil {
		return "", err
	}

	osKey := installPackageOSKey()
	archKey := installPackageArchKey()
	var entry installPackageEntry
	switch packageID {
	case gitID:
		entry = manifest.Git[osKey][archKey]
	case nodeJSID:
		entry = manifest.NodeJS[osKey][archKey]
	case homebrewID:
		entry = manifest.Homebrew[osKey]
	default:
		return "", fmt.Errorf("install package %q is not supported", packageID)
	}
	if entry.URL == "" {
		return "", fmt.Errorf("install package %q is not available for %s/%s", packageID, osKey, archKey)
	}
	return entry.URL, nil
}

func installPackageOSKey() string {
	if runtime.GOOS == "darwin" {
		return "macos"
	}
	return runtime.GOOS
}

func installPackageArchKey() string {
	switch runtime.GOARCH {
	case "amd64":
		return "x64"
	case "arm64":
		return "arm64"
	default:
		return runtime.GOARCH
	}
}

func downloadInstallPackage(ctx context.Context, packageID string, filename string) (string, error) {
	packageURL, err := installPackageURL(ctx, packageID)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(os.TempDir(), "agentbox-install-packages", packageID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	targetPath := filepath.Join(dir, filename)
	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		if err := downloadURLToFile(ctx, packageURL, targetPath); err == nil {
			return targetPath, nil
		} else {
			lastErr = err
		}
		if attempt < 3 {
			time.Sleep(time.Duration(attempt) * time.Second)
		}
	}
	return "", fmt.Errorf("download %s failed after retries: %w", filename, lastErr)
}

func downloadURLToFile(ctx context.Context, url string, targetPath string) error {
	cmdCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	req, err := http.NewRequestWithContext(cmdCtx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "AgentBox")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("download %s failed with status %s", url, resp.Status)
	}

	downloadPath := targetPath + ".download"
	file, err := os.Create(downloadPath)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(file, resp.Body)
	closeErr := file.Close()
	if copyErr != nil {
		_ = os.Remove(downloadPath)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(downloadPath)
		return closeErr
	}
	if err := os.Rename(downloadPath, targetPath); err != nil {
		_ = os.Remove(downloadPath)
		return err
	}
	return nil
}

func homebrewUpdateAvailable(ctx context.Context, path string) bool {
	if path == "" {
		return false
	}
	stdout, stderr, err := runCommand(ctx, 30*time.Second, path, "update", "--dry-run")
	output := strings.ToLower(strings.TrimSpace(stdout + "\n" + stderr))
	if strings.Contains(output, "already up-to-date") || strings.Contains(output, "already up to date") {
		return false
	}
	return err == nil && output != ""
}

func updateHomebrew(ctx context.Context, path string) (string, string, string, error) {
	stdout, stderr, err := runCommand(ctx, 5*time.Minute, path, "update")
	return path + " update", stdout, stderr, err
}

func brewFormula(name string) homebrewPackageRef {
	return homebrewPackageRef{kind: homebrewFormula, name: name}
}

func brewCask(name string) homebrewPackageRef {
	return homebrewPackageRef{kind: homebrewCask, name: name}
}

func homebrewPackageInstalled(ctx context.Context, refs ...homebrewPackageRef) bool {
	_, ok := installedHomebrewPackage(ctx, refs...)
	return ok
}

func installedHomebrewPackage(ctx context.Context, refs ...homebrewPackageRef) (homebrewPackageRef, bool) {
	if !shouldProbeHomebrewPackages() {
		return homebrewPackageRef{}, false
	}
	brewPath := resolveHomebrewPath()
	if brewPath == "" {
		return homebrewPackageRef{}, false
	}
	packages := cached(&homebrewPackagesCache, homebrewPackageListCacheTTL, false, func() homebrewPackageList {
		return loadHomebrewPackageList(ctx, brewPath)
	})
	for _, ref := range refs {
		if strings.TrimSpace(ref.name) == "" {
			continue
		}
		if packages.contains(ref) {
			return ref, true
		}
	}
	return homebrewPackageRef{}, false
}

func loadHomebrewPackageList(ctx context.Context, brewPath string) homebrewPackageList {
	packages := homebrewPackageList{
		formulae: map[string]struct{}{},
		casks:    map[string]struct{}{},
	}
	if stdout, _, err := runCommand(ctx, 5*time.Second, brewPath, "list", "--formula", "--full-name"); err == nil {
		addHomebrewPackageNames(packages.formulae, stdout)
	} else if stdout, _, err := runCommand(ctx, 5*time.Second, brewPath, "list", "--formula"); err == nil {
		addHomebrewPackageNames(packages.formulae, stdout)
	}
	if stdout, _, err := runCommand(ctx, 5*time.Second, brewPath, "list", "--cask", "--full-name"); err == nil {
		addHomebrewPackageNames(packages.casks, stdout)
	} else if stdout, _, err := runCommand(ctx, 5*time.Second, brewPath, "list", "--cask"); err == nil {
		addHomebrewPackageNames(packages.casks, stdout)
	}
	return packages
}

func addHomebrewPackageNames(packages map[string]struct{}, output string) {
	for _, field := range strings.Fields(output) {
		name := normalizeHomebrewPackageName(field)
		if name == "" {
			continue
		}
		packages[name] = struct{}{}
		if slash := strings.LastIndex(name, "/"); slash >= 0 && slash+1 < len(name) {
			packages[name[slash+1:]] = struct{}{}
		}
	}
}

func (packages homebrewPackageList) contains(ref homebrewPackageRef) bool {
	name := normalizeHomebrewPackageName(ref.name)
	if name == "" {
		return false
	}
	target := packages.formulae
	if ref.kind == homebrewCask {
		target = packages.casks
	}
	if _, ok := target[name]; ok {
		return true
	}
	if slash := strings.LastIndex(name, "/"); slash >= 0 && slash+1 < len(name) {
		_, ok := target[name[slash+1:]]
		return ok
	}
	return false
}

func normalizeHomebrewPackageName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func shouldProbeHomebrewPackages() bool {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("AGENTBOX_PROBE_HOMEBREW_PACKAGES")), "1") ||
		strings.EqualFold(strings.TrimSpace(os.Getenv("AGENTBOX_PROBE_HOMEBREW_PACKAGES")), "true") {
		return true
	}
	if runtime.GOOS == "linux" && runningInContainer() {
		return false
	}
	return true
}

func runningInContainer() bool {
	if pluginFileExists("/.dockerenv") || pluginFileExists("/run/.containerenv") {
		return true
	}
	data, err := os.ReadFile("/proc/1/cgroup")
	if err != nil {
		return false
	}
	lower := strings.ToLower(string(data))
	return strings.Contains(lower, "docker") ||
		strings.Contains(lower, "containerd") ||
		strings.Contains(lower, "kubepods") ||
		strings.Contains(lower, "podman")
}

func pluginFileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func homebrewPackageOutdated(ctx context.Context, refs ...homebrewPackageRef) bool {
	brewPath := resolveHomebrewPath()
	if brewPath == "" {
		return false
	}
	for _, ref := range refs {
		if strings.TrimSpace(ref.name) == "" {
			continue
		}
		if !homebrewPackageInstalled(ctx, ref) {
			continue
		}
		args := []string{"outdated"}
		if ref.kind == homebrewCask {
			args = append(args, "--cask")
		} else {
			args = append(args, "--formula")
		}
		args = append(args, ref.name)
		stdout, _, err := runCommand(ctx, 20*time.Second, brewPath, args...)
		if err == nil && strings.Contains(strings.ToLower(stdout), strings.ToLower(ref.name)) {
			return true
		}
	}
	return false
}

func homebrewUpgrade(ctx context.Context, refs ...homebrewPackageRef) (string, string, string, error) {
	ref, ok := installedHomebrewPackage(ctx, refs...)
	if !ok {
		return "", "", "", fmt.Errorf("Homebrew package is not installed")
	}
	args := []string{"upgrade"}
	if ref.kind == homebrewCask {
		args = append(args, "--cask")
	}
	args = append(args, ref.name)
	command := "brew " + strings.Join(args, " ")
	stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
	return command, stdout, stderr, err
}

func homebrewPackageExecutablePath(ctx context.Context, executable string, refs ...homebrewPackageRef) string {
	if _, ok := installedHomebrewPackage(ctx, refs...); !ok {
		return ""
	}
	for _, candidate := range []string{
		"/opt/homebrew/bin/" + executable,
		"/usr/local/bin/" + executable,
		"/home/linuxbrew/.linuxbrew/bin/" + executable,
	} {
		if isExecutablePath(candidate) {
			return candidate
		}
	}
	for _, ref := range refs {
		if ref.kind != homebrewFormula || strings.TrimSpace(ref.name) == "" {
			continue
		}
		if stdout, _, err := runCommand(ctx, 10*time.Second, resolveHomebrewPath(), "--prefix", ref.name); err == nil {
			prefix := strings.TrimSpace(stdout)
			if prefix != "" {
				candidate := filepath.Join(prefix, "bin", executable)
				if isExecutablePath(candidate) {
					return candidate
				}
			}
		}
	}
	return ""
}

func detectGit(ctx context.Context) PluginAppStatus {
	path := resolveGitPath()
	brewInstalled := homebrewPackageInstalled(ctx, brewFormula("git"))
	if path == "" {
		path = homebrewPackageExecutablePath(ctx, "git", brewFormula("git"))
	}
	app := PluginAppStatus{
		ID:             gitID,
		Name:           "Git",
		Tagline:        "分布式版本控制工具",
		Description:    "Git 提供源码版本管理、仓库克隆、分支提交和远程同步能力。",
		Homepage:       "https://git-scm.com/",
		LogoURL:        "https://assets.orence.net/file/20260518033254349.svg",
		InstallCommand: gitInstallCommand(),
		Installed:      path != "" || brewInstalled,
		CLIPath:        path,
		Status:         "missing",
		CanInstall:     true,
		CanUpdate:      canUpdateGit(ctx, path),
		CanUninstall:   canUninstallGit(path),
		SearchExamples: []string{"git --version", "git clone <repo>", "git status"},
	}
	if !app.Installed {
		return app
	}
	app.Status = "installed"
	if version := firstLine(pluginCommandOutput(ctx, path, "--version")); version != "" {
		app.Version = strings.TrimPrefix(version, "git version ")
	}
	return app
}

func gitInstallCommand() string {
	if runtime.GOOS == "windows" {
		return "download Git installer from install-packages manifest and run it with a visible progress window"
	}
	if runtime.GOOS == "darwin" {
		return "xcode-select --install"
	}
	return `if command -v apt-get >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y git; ` +
		`elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y git; ` +
		`elif command -v yum >/dev/null 2>&1; then sudo yum install -y git; ` +
		`elif command -v pacman >/dev/null 2>&1; then sudo pacman -Sy --noconfirm git; ` +
		`elif command -v zypper >/dev/null 2>&1; then sudo zypper install -y git; ` +
		`elif command -v apk >/dev/null 2>&1; then sudo apk add git; ` +
		`else echo "Unsupported Linux package manager for Git install" >&2; exit 1; fi; git --version`
}

func installGit(ctx context.Context) (string, string, error) {
	if runtime.GOOS == "windows" {
		installerPath, err := downloadInstallPackage(ctx, gitID, "Git.exe")
		if err != nil {
			return "", "", err
		}
		stdout, stderr, err := runCommand(ctx, 30*time.Minute, installerPath, "/SILENT", "/NORESTART")
		if err != nil {
			return stdout, stderr, err
		}
		path := waitForToolPath(ctx, "git", 45*time.Second)
		version := ""
		if path != "" {
			version = firstLine(pluginCommandOutput(ctx, path, "--version"))
		}
		return strings.TrimSpace(stdout + "\nInstalled Git from: " + installerPath + "\n" + version), stderr, nil
	}
	return runPlatformShellCommand(ctx, 5*time.Minute, gitInstallCommand())
}

func resolveGitPath() string {
	return resolveToolPath("git")
}

func gitUpdateAvailable(ctx context.Context, path string) bool {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewFormula("git")) {
		return homebrewPackageOutdated(ctx, brewFormula("git"))
	}
	if runtime.GOOS == "windows" {
		stdout, stderr, err := runCommand(ctx, 20*time.Second, "winget", "upgrade", "--id", "Git.Git", "--exact")
		output := strings.ToLower(strings.TrimSpace(stdout + "\n" + stderr))
		return err == nil && strings.Contains(output, "git.git")
	}
	return false
}

func updateGit(ctx context.Context, path string) (string, string, string, error) {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewFormula("git")) {
		return homebrewUpgrade(ctx, brewFormula("git"))
	}
	if runtime.GOOS == "windows" {
		command := gitInstallCommand()
		stdout, stderr, err := installGit(ctx)
		return command, stdout, stderr, err
	}
	if runtime.GOOS == "linux" {
		command := gitInstallCommand()
		stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
		return command, stdout, stderr, err
	}
	return "", "", "", fmt.Errorf("git update is only supported for Homebrew, Windows, or Linux package-manager installs")
}

func gitUninstallCommand(path string) string {
	if !canUninstallGit(path) {
		return ""
	}
	if isHomebrewInstallPath(path) {
		return "brew uninstall git"
	}
	if runtime.GOOS == "windows" {
		return "winget uninstall --id Git.Git --exact"
	}
	if runtime.GOOS == "linux" {
		return `if command -v apt-get >/dev/null 2>&1; then sudo apt-get remove -y git; ` +
			`elif command -v dnf >/dev/null 2>&1; then sudo dnf remove -y git; ` +
			`elif command -v yum >/dev/null 2>&1; then sudo yum remove -y git; ` +
			`elif command -v pacman >/dev/null 2>&1; then sudo pacman -R --noconfirm git; ` +
			`elif command -v zypper >/dev/null 2>&1; then sudo zypper remove -y git; ` +
			`elif command -v apk >/dev/null 2>&1; then sudo apk del git; ` +
			`else echo "Unsupported Linux package manager for Git uninstall" >&2; exit 1; fi`
	}
	return ""
}

func canUninstallGit(path string) bool {
	return isHomebrewInstallPath(path) || runtime.GOOS == "windows" || runtime.GOOS == "linux"
}

func canUpdateGit(ctx context.Context, path string) bool {
	return (path != "" && (isHomebrewInstallPath(path) || runtime.GOOS == "windows" || runtime.GOOS == "linux")) || homebrewPackageInstalled(ctx, brewFormula("git"))
}

func detectNodeJS(ctx context.Context) PluginAppStatus {
	path := resolveNodeJSPath()
	brewInstalled := homebrewPackageInstalled(ctx, brewFormula("node"), brewFormula("node@24"), brewFormula("node@22"))
	if path == "" {
		path = homebrewPackageExecutablePath(ctx, "node", brewFormula("node"), brewFormula("node@24"), brewFormula("node@22"))
	}
	app := PluginAppStatus{
		ID:             nodeJSID,
		Name:           "NodeJS",
		Tagline:        "JavaScript 运行时与 npm 包管理环境",
		Description:    "Node.js 提供本机 JavaScript 运行时与 npm 包管理能力。",
		Homepage:       "https://nodejs.org/",
		LogoURL:        "https://assets.orence.net/file/20260516014801900.png",
		InstallCommand: nodeJSInstallCommand(),
		Installed:      path != "" || brewInstalled,
		CLIPath:        path,
		Status:         "missing",
		CanInstall:     true,
		CanUpdate:      brewInstalled || isHomebrewInstallPath(path),
		CanUninstall:   path != "" || brewInstalled,
		SearchExamples: []string{"node -v", "npm -v", "npm install -g pm2"},
	}
	if !app.Installed {
		return app
	}
	app.Status = "installed"
	nodeVersion := firstLine(pluginCommandOutput(ctx, path, "--version"))
	npmVersion := firstLine(pluginCommandOutput(ctx, "npm", "--version"))
	if nodeVersion != "" && npmVersion != "" {
		app.Version = nodeVersion + " · npm " + npmVersion
	} else if nodeVersion != "" {
		app.Version = nodeVersion
	}
	return app
}

func nodeJSInstallCommand() string {
	if runtime.GOOS == "windows" {
		return "download Node.js MSI from install-packages manifest and run it with a visible progress window"
	}
	return nodeJSShellInstallCommand()
}

func nodeJSShellInstallCommand() string {
	if runtime.GOOS == "windows" {
		return `Write-Error "请先通过 AgentBox 的 Node.js 安装入口安装 Node.js。"; exit 1`
	}
	if runtime.GOOS == "linux" {
		return `if command -v apt-get >/dev/null 2>&1; then ` +
			`sudo apt-get update && sudo apt-get install -y nodejs npm; ` +
			`elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y nodejs npm; ` +
			`elif command -v yum >/dev/null 2>&1; then sudo yum install -y nodejs npm; ` +
			`elif command -v pacman >/dev/null 2>&1; then sudo pacman -Sy --noconfirm nodejs npm; ` +
			`elif command -v zypper >/dev/null 2>&1; then sudo zypper install -y nodejs npm; ` +
			`elif command -v apk >/dev/null 2>&1; then sudo apk add nodejs npm; ` +
			`else export NVM_DIR="$HOME/.nvm"; ` +
			`mkdir -p "$NVM_DIR"; ` +
			`PROFILE=/dev/null METHOD=script NVM_METHOD=script bash -c "$(curl --http1.1 -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh)"; ` +
			`. "$NVM_DIR/nvm.sh" && nvm install 24 && nvm alias default 24; fi; ` +
			`npm config set registry https://registry.npmmirror.com; ` +
			`node -v; npm -v`
	}
	return `export NVM_DIR="$HOME/.nvm"; ` +
		`mkdir -p "$NVM_DIR"; ` +
		`PROFILE=/dev/null METHOD=script NVM_METHOD=script bash -c "$(curl --http1.1 -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh)"; ` +
		`. "$NVM_DIR/nvm.sh" && nvm install 24 && nvm alias default 24 && node -v && npm -v`
}

func installNodeJS(ctx context.Context) (string, string, error) {
	if runtime.GOOS == "windows" {
		installerPath, err := downloadInstallPackage(ctx, nodeJSID, "NodeJS.msi")
		if err != nil {
			return "", "", err
		}
		stdout, stderr, err := runCommand(ctx, 30*time.Minute, "msiexec.exe", "/i", installerPath, "/passive", "/norestart")
		if err != nil && !isWindowsRebootRequiredExit(err) {
			return stdout, stderr, err
		}
		path := waitForToolPath(ctx, "node", 45*time.Second)
		nodeVersion := ""
		npmVersion := ""
		if path != "" {
			nodeVersion = firstLine(pluginCommandOutput(ctx, path, "--version"))
			if npmPath := resolveToolPath("npm"); npmPath != "" {
				npmVersion = firstLine(pluginCommandOutput(ctx, npmPath, "--version"))
			}
		}
		lines := []string{stdout, "Installed Node.js from: " + installerPath}
		if nodeVersion != "" {
			lines = append(lines, "node "+nodeVersion)
		}
		if npmVersion != "" {
			lines = append(lines, "npm "+npmVersion)
		}
		if err != nil {
			lines = append(lines, "Windows Installer requested a reboot to finish configuration.")
		}
		return strings.TrimSpace(strings.Join(lines, "\n")), stderr, nil
	}
	return runPlatformShellCommand(ctx, 10*time.Minute, nodeJSShellInstallCommand())
}

func nodeJSUninstallCommand() string {
	if runtime.GOOS == "windows" {
		return `$ErrorActionPreference = "Continue"; ` +
			`if (Get-Command pm2 -ErrorAction SilentlyContinue) { pm2 delete all; pm2 kill }; ` +
			`if (Get-Command npm -ErrorAction SilentlyContinue) { npm uninstall -g pm2 pnpm yarn; npm cache clean --force }; ` +
			`if (Get-Command corepack -ErrorAction SilentlyContinue) { corepack disable }; ` +
			`if (Get-Command pnpm -ErrorAction SilentlyContinue) { pnpm store prune }; ` +
			`if (Get-Command choco -ErrorAction SilentlyContinue) { choco uninstall nodejs nodejs.install -y }; ` +
			`if (Get-Command winget -ErrorAction SilentlyContinue) { winget uninstall --id OpenJS.NodeJS -e --silent; winget uninstall --id OpenJS.NodeJS.LTS -e --silent }; ` +
			`Remove-Item "$env:APPDATA\npm","$env:APPDATA\npm-cache","$env:LOCALAPPDATA\pnpm","$env:LOCALAPPDATA\node-gyp","$env:USERPROFILE\.npm","$env:USERPROFILE\.pnpm-store","$env:USERPROFILE\.node-gyp","$env:USERPROFILE\.nvm" -Recurse -Force -ErrorAction SilentlyContinue; ` +
			`Write-Output "NodeJS, npm, pnpm and PM2 cleanup completed."`
	}
	return `set +e; ` +
		`export NVM_DIR="$HOME/.nvm"; ` +
		`[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; ` +
		`command -v pm2 >/dev/null 2>&1 && { pm2 delete all; pm2 kill; }; ` +
		`command -v npm >/dev/null 2>&1 && { npm uninstall -g pm2 pnpm yarn; npm cache clean --force; }; ` +
		`command -v corepack >/dev/null 2>&1 && corepack disable; ` +
		`command -v pnpm >/dev/null 2>&1 && pnpm store prune; ` +
		`command -v nvm >/dev/null 2>&1 && { nvm deactivate; nvm uninstall 24.15.0 || nvm uninstall 24; }; ` +
		`command -v brew >/dev/null 2>&1 && { brew uninstall gemini-cli; brew uninstall --ignore-dependencies node node@24 node@22 npm pnpm pm2 yarn; brew cleanup; }; ` +
		`command -v apt-get >/dev/null 2>&1 && sudo apt-get remove -y nodejs npm pnpm yarn pm2; ` +
		`rm -rf "$HOME/.nvm" "$HOME/.npm" "$HOME/.npm-global" "$HOME/.pnpm-store" "$HOME/.local/share/pnpm" "$HOME/.cache/node-gyp" "$HOME/.node-gyp"; ` +
		`rm -f "$HOME/.npmrc"; ` +
		`echo "NodeJS, npm, pnpm and PM2 cleanup completed."`
}

func resolveNodeJSPath() string {
	return resolveToolPath("node")
}

func nodeJSUpdateAvailable(ctx context.Context, path string) bool {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewFormula("node"), brewFormula("node@24"), brewFormula("node@22")) {
		return homebrewPackageOutdated(ctx, brewFormula("node"), brewFormula("node@24"), brewFormula("node@22"))
	}
	return false
}

func updateNodeJS(ctx context.Context, path string) (string, string, string, error) {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewFormula("node"), brewFormula("node@24"), brewFormula("node@22")) {
		return homebrewUpgrade(ctx, brewFormula("node"), brewFormula("node@24"), brewFormula("node@22"))
	}
	return "", "", "", fmt.Errorf("nodejs update is only supported for Homebrew installs")
}

func commandWithNodeJSPrerequisite(command string) string {
	installCommand := nodeJSShellInstallCommand()
	if runtime.GOOS == "windows" {
		return `if (!(Get-Command node -ErrorAction SilentlyContinue) -or !(Get-Command npm -ErrorAction SilentlyContinue)) { Write-Error "请先通过 AgentBox 的 Node.js 安装入口安装 Node.js，然后重新运行当前安装任务。"; exit 1 }; ` + command
	}
	return `if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then ` + installCommand + ` || exit $?; fi; ` + command
}

func waitForToolPath(ctx context.Context, name string, timeout time.Duration) string {
	deadline := time.Now().Add(timeout)
	for {
		if path := resolveToolPath(name); path != "" {
			return path
		}
		if time.Now().After(deadline) {
			return ""
		}
		select {
		case <-ctx.Done():
			return ""
		case <-time.After(time.Second):
		}
	}
}

func isWindowsRebootRequiredExit(err error) bool {
	if runtime.GOOS != "windows" || err == nil {
		return false
	}
	var exitErr *exec.ExitError
	return errors.As(err, &exitErr) && exitErr.ExitCode() == 3010
}

func detectPNPM(ctx context.Context) PluginAppStatus {
	path := resolvePNPMPath()
	brewInstalled := homebrewPackageInstalled(ctx, brewFormula("pnpm"))
	if path == "" {
		path = homebrewPackageExecutablePath(ctx, "pnpm", brewFormula("pnpm"))
	}
	app := PluginAppStatus{
		ID:             pnpmID,
		Name:           "PNPM",
		Tagline:        "快速、节省磁盘空间的 Node.js 包管理器",
		Description:    "PNPM 提供高性能依赖安装和全局包管理能力，适合 Node.js 项目与本机工具链维护。",
		LogoURL:        "https://assets.orence.net/file/20260518033239514.svg",
		Homepage:       "https://pnpm.io/",
		InstallCommand: pnpmInstallCommand(),
		Installed:      path != "" || brewInstalled,
		CLIPath:        path,
		Status:         "missing",
		CanInstall:     true,
		CanUpdate:      path != "" || brewInstalled,
		CanUninstall:   canUninstallPNPM(path),
		SearchExamples: []string{"pnpm -v", "pnpm install", "pnpm add -g <package>"},
	}
	if !app.Installed {
		return app
	}
	app.Status = "installed"
	if version := firstLine(pluginCommandOutput(ctx, path, "--version")); version != "" {
		app.Version = version
	}
	return app
}

func pnpmInstallCommand() string {
	return commandWithNodeJSPrerequisite("npm install -g pnpm@latest-11")
}

func resolvePNPMPath() string {
	return resolveToolPath("pnpm")
}

func pnpmUpdateAvailable(ctx context.Context, path string) bool {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewFormula("pnpm")) {
		return homebrewPackageOutdated(ctx, brewFormula("pnpm"))
	}
	if !isNPMPackageInstall(path, "pnpm") {
		return false
	}
	stdout, stderr, err := runPlatformShellCommand(ctx, 20*time.Second, "npm outdated -g --json pnpm")
	output := strings.ToLower(strings.TrimSpace(stdout + "\n" + stderr))
	return err != nil && strings.Contains(output, `"pnpm"`)
}

func updatePNPM(ctx context.Context, path string) (string, string, string, error) {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewFormula("pnpm")) {
		return homebrewUpgrade(ctx, brewFormula("pnpm"))
	}
	command := "npm install -g pnpm@latest-11"
	stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
	return command, stdout, stderr, err
}

func pnpmUninstallCommand(path string) string {
	if !canUninstallPNPM(path) {
		return ""
	}
	if runtime.GOOS == "windows" {
		return `if (Get-Command pnpm -ErrorAction SilentlyContinue) { pnpm store prune }; npm uninstall -g pnpm; Remove-Item "$env:LOCALAPPDATA\pnpm","$env:USERPROFILE\.pnpm-store" -Recurse -Force -ErrorAction SilentlyContinue`
	}
	return `set +e; command -v pnpm >/dev/null 2>&1 && pnpm store prune; npm uninstall -g pnpm; rm -rf "$HOME/.pnpm-store" "$HOME/.local/share/pnpm"`
}

func canUninstallPNPM(path string) bool {
	return isNPMPackageInstall(path, "pnpm")
}

func detectPM2(ctx context.Context) PluginAppStatus {
	path := resolvePM2Path()
	brewInstalled := homebrewPackageInstalled(ctx, brewFormula("pm2"))
	if path == "" {
		path = homebrewPackageExecutablePath(ctx, "pm2", brewFormula("pm2"))
	}
	app := PluginAppStatus{
		ID:             pm2ID,
		Name:           "PM2",
		Tagline:        "Node.js 进程管理器",
		Description:    "PM2 用于守护、监控和管理 Node.js 应用进程。",
		Homepage:       "https://pm2.keymetrics.io/",
		LogoURL:        "https://assets.orence.net/file/20260515185421340.png",
		InstallCommand: pm2InstallCommand(),
		Installed:      path != "" || brewInstalled,
		CLIPath:        path,
		Status:         "missing",
		CanInstall:     true,
		CanUpdate:      path != "" || brewInstalled,
		CanUninstall:   canUninstallPM2(path),
		SearchExamples: []string{"pm2 list", "pm2 start npm --name app -- run start", "pm2 logs"},
	}
	if !app.Installed {
		return app
	}
	app.Status = "installed"
	if version := firstLine(pluginCommandOutput(ctx, path, "--version")); version != "" {
		app.Version = version
	}
	return app
}

func pm2InstallCommand() string {
	return commandWithNodeJSPrerequisite("npm install -g pm2")
}

func resolvePM2Path() string {
	return resolveToolPath("pm2")
}

func pm2UpdateAvailable(ctx context.Context, path string) bool {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewFormula("pm2")) {
		return homebrewPackageOutdated(ctx, brewFormula("pm2"))
	}
	if !isNPMPackageInstall(path, "pm2") {
		return false
	}
	stdout, stderr, err := runPlatformShellCommand(ctx, 20*time.Second, "npm outdated -g --json pm2")
	output := strings.ToLower(strings.TrimSpace(stdout + "\n" + stderr))
	return err != nil && strings.Contains(output, `"pm2"`)
}

func updatePM2(ctx context.Context, path string) (string, string, string, error) {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewFormula("pm2")) {
		return homebrewUpgrade(ctx, brewFormula("pm2"))
	}
	command := "npm install -g pm2@latest"
	stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
	return command, stdout, stderr, err
}

func pm2UninstallCommand(path string) string {
	if !canUninstallPM2(path) {
		return ""
	}
	return "npm uninstall -g pm2"
}

func canUninstallPM2(path string) bool {
	return isNPMPackageInstall(path, "pm2")
}

func detectFFmpeg(ctx context.Context) PluginAppStatus {
	path := resolveFFmpegPath()
	brewInstalled := homebrewPackageInstalled(ctx, brewFormula("ffmpeg"))
	if path == "" {
		path = homebrewPackageExecutablePath(ctx, "ffmpeg", brewFormula("ffmpeg"))
	}
	app := PluginAppStatus{
		ID:             ffmpegID,
		Name:           "FFmpeg",
		Tagline:        "音视频处理工具链",
		Description:    "FFmpeg 提供音视频转码、抽帧、剪辑、封装转换和媒体信息处理能力。",
		Homepage:       "https://ffmpeg.org/",
		LogoURL:        "https://assets.orence.net/file/20260515185346577.png",
		InstallCommand: ffmpegInstallCommand(),
		Installed:      path != "" || brewInstalled,
		CLIPath:        path,
		Status:         "missing",
		CanInstall:     true,
		CanUpdate:      path != "" || brewInstalled,
		CanUninstall:   canUninstallFFmpeg(path),
		SearchExamples: []string{"ffmpeg -version", "ffmpeg -i input.mp4 output.mp3", "ffprobe -v quiet -print_format json -show_format input.mp4"},
	}
	if !app.Installed {
		return app
	}
	app.Status = "installed"
	if version := firstLine(pluginCommandOutput(ctx, path, "-version")); version != "" {
		app.Version = version
	}
	return app
}

func ffmpegInstallCommand() string {
	if runtime.GOOS == "windows" {
		return "winget install --id Gyan.FFmpeg --exact"
	}
	if runtime.GOOS == "darwin" && resolveHomebrewPath() != "" {
		return "brew install ffmpeg"
	}
	return "sudo apt-get update && sudo apt-get install -y ffmpeg"
}

func resolveFFmpegPath() string {
	return resolveToolPath("ffmpeg")
}

func ffmpegUpdateAvailable(ctx context.Context, path string) bool {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewFormula("ffmpeg")) {
		return homebrewPackageOutdated(ctx, brewFormula("ffmpeg"))
	}
	if runtime.GOOS == "windows" {
		stdout, stderr, err := runCommand(ctx, 20*time.Second, "winget", "upgrade", "--id", "Gyan.FFmpeg", "--exact")
		output := strings.ToLower(strings.TrimSpace(stdout + "\n" + stderr))
		return err == nil && strings.Contains(output, "gyan.ffmpeg")
	}
	return false
}

func updateFFmpeg(ctx context.Context, path string) (string, string, string, error) {
	if isHomebrewInstallPath(path) || homebrewPackageInstalled(ctx, brewFormula("ffmpeg")) {
		return homebrewUpgrade(ctx, brewFormula("ffmpeg"))
	}
	if runtime.GOOS == "windows" {
		command := "winget upgrade --id Gyan.FFmpeg --exact"
		stdout, stderr, err := runPlatformShellCommand(ctx, 5*time.Minute, command)
		return command, stdout, stderr, err
	}
	return "", "", "", fmt.Errorf("ffmpeg update is only supported for Homebrew or winget installs")
}

func ffmpegUninstallCommand(path string) string {
	if isHomebrewInstallPath(path) {
		return "brew uninstall ffmpeg"
	}
	if runtime.GOOS == "windows" {
		return "winget uninstall --id Gyan.FFmpeg --exact"
	}
	return ""
}

func canUninstallFFmpeg(path string) bool {
	return isHomebrewInstallPath(path) || runtime.GOOS == "windows"
}

func isHomebrewInstallPath(path string) bool {
	if path == "" {
		return false
	}
	paths := []string{path}
	if target, err := filepath.EvalSymlinks(path); err == nil {
		paths = append(paths, target)
	}
	for _, item := range paths {
		normalized := strings.ToLower(filepath.ToSlash(filepath.Clean(item)))
		if strings.Contains(normalized, "/homebrew/") ||
			strings.Contains(normalized, "/cellar/") ||
			strings.Contains(normalized, "/caskroom/") ||
			strings.HasPrefix(normalized, "/opt/homebrew/") ||
			strings.HasPrefix(normalized, "/home/linuxbrew/.linuxbrew/") {
			return true
		}
	}
	return false
}

func isStandaloneUVInstall(path string) bool {
	if path == "" {
		return false
	}
	paths := []string{path}
	if target, err := filepath.EvalSymlinks(path); err == nil {
		paths = append(paths, target)
	}
	for _, item := range paths {
		normalized := filepath.ToSlash(filepath.Clean(item))
		if samePath(normalized, filepath.ToSlash(filepath.Clean(userLocalExecutablePath("uv")))) {
			return true
		}
		if strings.Contains(strings.ToLower(normalized), "/.local/bin/uv") {
			return true
		}
	}
	return false
}

func isPipxInstallPath(path string) bool {
	if path == "" {
		return false
	}
	paths := []string{path}
	if target, err := filepath.EvalSymlinks(path); err == nil {
		paths = append(paths, target)
	}
	for _, item := range paths {
		normalized := strings.ToLower(filepath.ToSlash(filepath.Clean(item)))
		if strings.Contains(normalized, "/.local/pipx/") || strings.Contains(normalized, "/pipx/venvs/") {
			return true
		}
	}
	return false
}

func isNPMPackageInstall(path string, packageName string) bool {
	if path == "" {
		return false
	}
	packagePath := "/" + strings.Trim(packageName, "/") + "/"
	paths := []string{path}
	if target, err := filepath.EvalSymlinks(path); err == nil {
		paths = append(paths, target)
	}
	for _, item := range paths {
		normalized := filepath.ToSlash(filepath.Clean(item))
		if strings.Contains(normalized, "/node_modules"+packagePath) {
			return true
		}
	}
	return false
}

func isPipPackageInstall(path string, packageName string) bool {
	if path == "" {
		return false
	}
	packageSegment := "/" + strings.Trim(strings.ToLower(packageName), "/") + "-"
	paths := []string{path}
	if target, err := filepath.EvalSymlinks(path); err == nil {
		paths = append(paths, target)
	}
	for _, item := range paths {
		normalized := strings.ToLower(filepath.ToSlash(filepath.Clean(item)))
		if strings.Contains(normalized, "/site-packages/"+packageSegment) || strings.Contains(normalized, "/dist-packages/"+packageSegment) {
			return true
		}
	}
	return false
}

func summarizePluginApps(plugins []PluginAppStatus) PluginsStatusSummary {
	summary := PluginsStatusSummary{Total: len(plugins)}
	for _, plugin := range plugins {
		if plugin.Installed {
			summary.Installed++
		} else {
			summary.Missing++
		}
	}
	return summary
}

func normalizePluginAppID(value string) string {
	id := strings.ToLower(strings.TrimSpace(value))
	switch id {
	case "skill-hub", "skill_hub":
		return "skillhub"
	case "claude", "claudecode", "claude_code":
		return claudeCodeID
	case "codex-cli", "codex_cli", "openai-codex", "openai_codex":
		return codexCLIID
	case "gemini-cli", "gemini_cli", "google-gemini", "google_gemini":
		return geminiCLIID
	case "open-code", "open_code", "opencode-ai", "opencode_ai":
		return openCodeID
	case "qoder-cli", "qoder_cli", "qodercli", "qoder-ai", "qoder_ai":
		return qoderID
	case "ccconnect", "cc_connect", "cc-connect-cli", "cc_connect_cli":
		return ccConnectID
	case "uv-python", "python-uv", "astral-uv":
		return uvID
	case "brew", "home-brew", "home_brew":
		return homebrewID
	case "git-cli", "git_cli", "git-scm", "git_scm":
		return gitID
	case "node", "node-js", "node_js", "nodejs-runtime", "nodejs_runtime":
		return nodeJSID
	case "pnpm-cli", "pnpm_cli", "pnpm-package-manager", "pnpm_package_manager":
		return pnpmID
	case "pm2-runtime", "pm2_runtime", "pm2-process-manager", "pm2_process_manager":
		return pm2ID
	case "ffmpeg-cli", "ffmpeg_cli", "ffprobe":
		return ffmpegID
	default:
		return id
	}
}

func pluginCommandOutput(ctx context.Context, name string, args ...string) string {
	stdout, stderr, err := runCommand(ctx, 5*time.Second, name, args...)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(stdout + "\n" + stderr)
}

type pluginActionStreamRun struct {
	id       string
	pluginID string
	action   string
	send     sse.Sender
}

func (run *pluginActionStreamRun) emitMeta() bool {
	return run.send.Data(PluginActionStreamMetaEvent{
		ID:        run.id,
		PluginID:  run.pluginID,
		Action:    run.action,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}) == nil
}

func (run *pluginActionStreamRun) emitStatus(status string, progress int, errorMessage string) bool {
	return run.send.Data(PluginActionStreamStatusEvent{
		ID:        run.id,
		PluginID:  run.pluginID,
		Action:    run.action,
		Status:    status,
		Progress:  progress,
		Error:     errorMessage,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}) == nil
}

func (run *pluginActionStreamRun) emitLog(value string) bool {
	for _, line := range strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n") {
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			continue
		}
		if err := run.send.Data(PluginActionStreamLogEvent{
			ID:        run.id,
			PluginID:  run.pluginID,
			Line:      line,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}); err != nil {
			return false
		}
	}
	return true
}

func (run *pluginActionStreamRun) fail(err error) {
	message := "unknown error"
	if err != nil {
		message = strings.TrimSpace(err.Error())
	}
	_ = run.emitLog("失败：" + message)
	_ = run.emitStatus("error", 100, message)
	_ = run.send.Data(PluginActionStreamErrorEvent{
		ID:        run.id,
		PluginID:  run.pluginID,
		Message:   message,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	})
}

func pluginInstallCommand(id string) (string, error) {
	switch id {
	case "skillhub":
		return skillHubInstallCommand(), nil
	case claudeCodeID:
		return claudeCodeInstallCommand(), nil
	case codexCLIID:
		return codexCLIInstallCommand(), nil
	case geminiCLIID:
		return geminiCLIInstallCommand(), nil
	case openCodeID:
		return openCodeInstallCommand(), nil
	case qoderID:
		return qoderInstallCommand(), nil
	case ccConnectID:
		return ccConnectInstallCommand(), nil
	case uvID:
		return uvInstallCommand(), nil
	case gitID:
		return gitInstallCommand(), nil
	case homebrewID:
		return homebrewInstallCommand(), nil
	case nodeJSID:
		return nodeJSInstallCommand(), nil
	case pnpmID:
		return pnpmInstallCommand(), nil
	case pm2ID:
		return pm2InstallCommand(), nil
	case ffmpegID:
		return ffmpegInstallCommand(), nil
	default:
		return "", huma.Error404NotFound("plugin app not found", fmt.Errorf("plugin app %q not found", id))
	}
}

func runPluginInstallStreaming(ctx context.Context, id string, command string, writeOutput func(string) bool) error {
	write := func(value string) {
		if writeOutput != nil {
			_ = writeOutput(value)
		}
	}
	switch id {
	case "skillhub":
		if runtime.GOOS == "windows" && resolveToolPath("bash") == "" {
			return errors.New("Windows 安装 SkillHub 需要 Git Bash 或 WSL bash；请先安装 Git 后重试")
		}
		return runPlatformShellCommandStreamingSuccess(ctx, 5*time.Minute, command, write, pluginInstallSuccessMatcher(id))
	case gitID:
		if runtime.GOOS == "windows" {
			write("Windows Git 安装需要下载安装包，下载阶段可能不会持续输出。")
			stdout, stderr, err := installGit(ctx)
			write(stdout)
			write(stderr)
			return err
		}
		return runPlatformShellCommandStreaming(ctx, 5*time.Minute, command, write)
	case homebrewID:
		if runtime.GOOS == "darwin" {
			write("Homebrew 安装会下载安装包并打开系统 Installer。")
		}
		stdout, stderr, err := installHomebrew(ctx)
		write(stdout)
		write(stderr)
		return err
	case nodeJSID:
		if runtime.GOOS == "windows" {
			write("Windows Node.js 安装需要下载安装包，下载阶段可能不会持续输出。")
			stdout, stderr, err := installNodeJS(ctx)
			write(stdout)
			write(stderr)
			return err
		}
		return runPlatformShellCommandStreamingSuccess(ctx, 10*time.Minute, command, write, pluginInstallSuccessMatcher(id))
	default:
		return runPlatformShellCommandStreamingSuccess(ctx, 5*time.Minute, command, write, pluginInstallSuccessMatcher(id))
	}
}

func runPlatformShellCommand(ctx context.Context, timeout time.Duration, command string) (string, string, error) {
	if runtime.GOOS == "windows" {
		return runCommand(ctx, timeout, "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command)
	}
	return runCommand(ctx, timeout, "bash", "-lc", command)
}

func runPlatformShellCommandStreaming(ctx context.Context, timeout time.Duration, command string, writeOutput func(string)) error {
	return runPlatformShellCommandStreamingSuccess(ctx, timeout, command, writeOutput, nil)
}

func runPlatformShellCommandStreamingSuccess(ctx context.Context, timeout time.Duration, command string, writeOutput func(string), success func(string) bool) error {
	if runtime.GOOS == "windows" {
		return runCommandStreamingSuccess(ctx, timeout, writeOutput, success, "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command)
	}
	return runCommandStreamingSuccess(ctx, timeout, writeOutput, success, "bash", "-lc", command)
}

func runCommandStreaming(ctx context.Context, timeout time.Duration, writeOutput func(string), name string, args ...string) error {
	return runCommandStreamingSuccess(ctx, timeout, writeOutput, nil, name, args...)
}

func runCommandStreamingSuccess(ctx context.Context, timeout time.Duration, writeOutput func(string), success func(string) bool, name string, args ...string) error {
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, resolveCommandExecutable(name), args...)
	cmd.Env = toolCommandEnv()
	cmd.Env = append(cmd.Env, "CI=1", "NO_COLOR=1", "TERM=dumb")
	cmd.WaitDelay = 2 * time.Second

	var mu sync.Mutex
	successSeen := false
	canceledAfterSuccess := false
	done := make(chan struct{})
	cancelAfterSuccess := func() {
		time.Sleep(1200 * time.Millisecond)
		select {
		case <-done:
			return
		default:
		}
		mu.Lock()
		canceledAfterSuccess = true
		mu.Unlock()
		cancel()
	}
	write := func(value string) {
		if writeOutput != nil {
			writeOutput(value)
		}
		if success == nil || !success(value) {
			return
		}
		mu.Lock()
		alreadySeen := successSeen
		successSeen = true
		mu.Unlock()
		if !alreadySeen {
			go cancelAfterSuccess()
		}
	}

	cmd.Stdout = pluginTaskWriter{write: write}
	cmd.Stderr = pluginTaskWriter{write: write}
	err := cmd.Run()
	close(done)

	mu.Lock()
	seen := successSeen
	canceledBySuccess := canceledAfterSuccess
	mu.Unlock()
	if seen && (err == nil || canceledBySuccess || errors.Is(err, exec.ErrWaitDelay)) {
		return nil
	}
	if cmdCtx.Err() == context.DeadlineExceeded {
		return fmt.Errorf("command timed out after %s", timeout)
	}
	if cmdCtx.Err() != nil {
		return cmdCtx.Err()
	}
	return err
}

func pluginInstallSuccessMatcher(id string) func(string) bool {
	switch id {
	case "skillhub":
		return func(output string) bool {
			return strings.Contains(strings.ToLower(output), "install complete.")
		}
	case qoderID:
		return func(output string) bool {
			return strings.Contains(strings.ToLower(output), "installed successfully.")
		}
	case claudeCodeID, codexCLIID, geminiCLIID, openCodeID, ccConnectID, pnpmID, pm2ID:
		return npmInstallSuccessOutput
	default:
		return nil
	}
}

func npmInstallSuccessOutput(output string) bool {
	for _, line := range strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n") {
		normalized := strings.ToLower(strings.TrimSpace(line))
		if strings.HasPrefix(normalized, "added ") ||
			strings.HasPrefix(normalized, "changed ") ||
			strings.HasPrefix(normalized, "removed ") ||
			strings.HasPrefix(normalized, "updated ") ||
			strings.HasPrefix(normalized, "up to date in ") {
			return true
		}
	}
	return false
}

type pluginTaskWriter struct {
	write func(string)
}

func (writer pluginTaskWriter) Write(data []byte) (int, error) {
	if writer.write != nil {
		writer.write(string(data))
	}
	return len(data), nil
}

func runCommand(ctx context.Context, timeout time.Duration, name string, args ...string) (string, string, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, resolveCommandExecutable(name), args...)
	cmd.Env = toolCommandEnv()
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if cmdCtx.Err() == context.DeadlineExceeded {
		err = fmt.Errorf("command timed out after %s", timeout)
	}
	return stdout.String(), stderr.String(), err
}

func windowsLocalAppDataExecutablePath(parts ...string) string {
	if runtime.GOOS != "windows" {
		return ""
	}
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		return ""
	}
	return filepath.Join(append([]string{localAppData, "Programs"}, parts...)...)
}

func samePath(left string, right string) bool {
	if left == "" || right == "" {
		return false
	}
	leftAbs, leftErr := filepath.Abs(left)
	rightAbs, rightErr := filepath.Abs(right)
	if leftErr == nil {
		left = leftAbs
	}
	if rightErr == nil {
		right = rightAbs
	}
	return filepath.Clean(left) == filepath.Clean(right)
}
