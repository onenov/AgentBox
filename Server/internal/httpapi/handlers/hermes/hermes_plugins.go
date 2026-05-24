package hermes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"gopkg.in/yaml.v3"
)

var hermesPluginsCache cacheMap[HermesPluginsResponse]

type HermesPluginsInput struct {
	Refresh bool   `query:"refresh" doc:"Force refresh cached Hermes plugins inventory." example:"false"`
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
}

type HermesPluginActionInput struct {
	Name    string `path:"name" doc:"Hermes plugin key or name." example:"spotify"`
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
}

type HermesPluginDetailInput struct {
	Name    string `path:"name" doc:"Hermes plugin key or name." example:"spotify"`
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
}

type HermesPluginInstallInput struct {
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	Body    HermesPluginInstallRequest
}

type HermesPluginUninstallInput struct {
	Name    string `path:"name" doc:"Hermes plugin key or name to remove." example:"my-plugin"`
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
}

type HermesPluginsOutput struct {
	Body HermesPluginsResponse
}

type HermesPluginDetailOutput struct {
	Body HermesPluginDetailResponse
}

type HermesPluginMutationOutput struct {
	Body HermesPluginMutationResponse
}

type HermesPluginsResponse struct {
	Status     string               `json:"status" example:"ok" doc:"Operation status."`
	Timestamp  string               `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Cache      HermesCacheInfo      `json:"cache" doc:"Cache behavior used for this response."`
	HomePath   string               `json:"homePath" example:"/Users/one/.hermes" doc:"Hermes home directory."`
	PluginsDir string               `json:"pluginsDir" example:"/Users/one/.hermes/plugins" doc:"User plugin install directory."`
	Config     HermesPluginsConfig  `json:"config" doc:"Hermes plugin config summary."`
	Summary    HermesPluginsSummary `json:"summary" doc:"Plugin inventory summary."`
	Plugins    []HermesPluginInfo   `json:"plugins" doc:"Discovered Hermes plugins."`
	Errors     []string             `json:"errors,omitempty" doc:"Non-fatal scan errors."`
}

type HermesPluginsConfig struct {
	Path     string   `json:"path" example:"/Users/one/.hermes/config.yaml" doc:"Hermes config.yaml path."`
	Exists   bool     `json:"exists" example:"true" doc:"Whether config.yaml exists."`
	Enabled  []string `json:"enabled" doc:"plugins.enabled allow-list."`
	Disabled []string `json:"disabled" doc:"plugins.disabled deny-list."`
	Error    string   `json:"error,omitempty" doc:"Config read or parse error when any."`
}

type HermesPluginsSummary struct {
	Total     int            `json:"total" example:"4" doc:"Total discovered plugins."`
	Enabled   int            `json:"enabled" example:"1" doc:"Enabled plugins."`
	Disabled  int            `json:"disabled" example:"3" doc:"Disabled or not enabled plugins."`
	Bundled   int            `json:"bundled" example:"4" doc:"Bundled plugins."`
	User      int            `json:"user" example:"1" doc:"User-installed plugins."`
	Project   int            `json:"project" example:"0" doc:"Project plugins."`
	Dashboard int            `json:"dashboard" example:"1" doc:"Plugins with dashboard extension manifests."`
	Sources   map[string]int `json:"sources" doc:"Plugin count by source."`
	Kinds     map[string]int `json:"kinds" doc:"Plugin count by manifest kind."`
}

type HermesPluginInfo struct {
	Key                string               `json:"key" example:"spotify" doc:"Config key used by plugins.enabled/disabled."`
	Name               string               `json:"name" example:"spotify" doc:"Manifest plugin name."`
	DirName            string               `json:"dirName" example:"spotify" doc:"Filesystem directory name."`
	DisplayName        string               `json:"displayName,omitempty" doc:"Human display name when available."`
	Version            string               `json:"version,omitempty" doc:"Plugin version."`
	Description        string               `json:"description,omitempty" doc:"Manifest description."`
	Author             string               `json:"author,omitempty" doc:"Manifest author."`
	Kind               string               `json:"kind" example:"standalone" doc:"Plugin kind."`
	Source             string               `json:"source" example:"bundled" doc:"bundled, user, git, project, or entrypoint."`
	Path               string               `json:"path" doc:"Plugin directory path."`
	ManifestPath       string               `json:"manifestPath" doc:"plugin.yaml path."`
	Enabled            bool                 `json:"enabled" example:"false" doc:"Whether plugin is enabled via config."`
	LoadMode           string               `json:"loadMode" example:"opt-in" doc:"Hermes plugin activation mode: opt-in, auto, provider, exclusive."`
	StatusLabel        string               `json:"statusLabel" example:"not enabled" doc:"Human-readable plugin load status."`
	ExplicitlyEnabled  bool                 `json:"explicitlyEnabled" example:"false" doc:"Name/key present in plugins.enabled."`
	ExplicitlyDisabled bool                 `json:"explicitlyDisabled" example:"false" doc:"Name/key present in plugins.disabled."`
	Bundled            bool                 `json:"bundled" example:"true" doc:"Whether plugin is bundled with Hermes."`
	Git                bool                 `json:"git" example:"false" doc:"Whether plugin directory is a git checkout."`
	RequiresEnv        []string             `json:"requiresEnv,omitempty" doc:"Environment variables declared by requires_env."`
	ProvidesTools      []string             `json:"providesTools,omitempty" doc:"Tools declared by provides_tools."`
	ProvidesHooks      []string             `json:"providesHooks,omitempty" doc:"Hooks declared by provides_hooks."`
	Dashboard          *HermesDashboardInfo `json:"dashboard,omitempty" doc:"Dashboard extension metadata when present."`
	Files              []HermesPluginFile   `json:"files" doc:"Known plugin files."`
	Error              string               `json:"error,omitempty" doc:"Manifest read error when any."`
}

type HermesDashboardInfo struct {
	ManifestPath string   `json:"manifestPath" doc:"dashboard/manifest.json path."`
	Name         string   `json:"name,omitempty" doc:"Dashboard plugin name."`
	Label        string   `json:"label,omitempty" doc:"Dashboard tab label."`
	Description  string   `json:"description,omitempty" doc:"Dashboard description."`
	Bundle       string   `json:"bundle,omitempty" doc:"Dashboard JS bundle."`
	CSS          string   `json:"css,omitempty" doc:"Dashboard CSS file."`
	API          string   `json:"api,omitempty" doc:"Dashboard API file."`
	TabPath      string   `json:"tabPath,omitempty" doc:"Dashboard tab path."`
	TabIcon      string   `json:"tabIcon,omitempty" doc:"Dashboard tab icon."`
	TabHidden    bool     `json:"tabHidden" doc:"Whether dashboard tab is hidden."`
	Slots        []string `json:"slots,omitempty" doc:"Declared shell/page slots."`
}

type HermesPluginFile struct {
	Kind   string `json:"kind" example:"readme" doc:"File kind."`
	Path   string `json:"path" doc:"Absolute file path."`
	Exists bool   `json:"exists" example:"true" doc:"Whether file exists."`
}

type HermesPluginInstallRequest struct {
	Identifier string `json:"identifier" doc:"Git URL or owner/repo shorthand." example:"anpicasso/hermes-plugin-chrome-profiles"`
	Force      bool   `json:"force,omitempty" doc:"Remove existing plugin and reinstall." example:"false"`
	Enable     *bool  `json:"enable,omitempty" doc:"Auto-enable or install disabled. Omit to let Hermes default." example:"true"`
}

type HermesPluginMutationResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Plugin    string `json:"plugin,omitempty" example:"spotify" doc:"Plugin key/name affected."`
	Message   string `json:"message" doc:"Human-readable mutation result."`
	Stdout    string `json:"stdout,omitempty" doc:"Command stdout."`
	Stderr    string `json:"stderr,omitempty" doc:"Command stderr."`
}

type HermesPluginDetailResponse struct {
	Status            string           `json:"status" example:"ok" doc:"Operation status."`
	Timestamp         string           `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Plugin            HermesPluginInfo `json:"plugin" doc:"Plugin metadata."`
	Manifest          string           `json:"manifest,omitempty" doc:"Raw plugin.yaml content."`
	Readme            string           `json:"readme,omitempty" doc:"Raw README content."`
	AfterInstall      string           `json:"afterInstall,omitempty" doc:"Raw after-install.md content."`
	DashboardManifest string           `json:"dashboardManifest,omitempty" doc:"Raw dashboard manifest JSON."`
	Init              string           `json:"init,omitempty" doc:"Raw __init__.py content."`
}

func ListHermesPlugins(ctx context.Context, input *HermesPluginsInput) (*HermesPluginsOutput, error) {
	if input == nil {
		input = &HermesPluginsInput{}
	}
	profile, err := resolveHermesProfileSelection(input.Profile)
	if err != nil {
		return nil, err
	}
	body := cachedByKey(&hermesPluginsCache, profile.Name, 10*time.Second, input.Refresh, func() HermesPluginsResponse {
		return scanHermesPlugins(ctx, profile)
	})
	body.Timestamp = time.Now().UTC().Format(time.RFC3339)
	body.Cache = HermesCacheInfo{Refresh: input.Refresh}
	return &HermesPluginsOutput{Body: body}, nil
}

func GetHermesPlugin(ctx context.Context, input *HermesPluginDetailInput) (*HermesPluginDetailOutput, error) {
	name := strings.TrimSpace("")
	if input != nil {
		name = strings.TrimSpace(input.Name)
	}
	if name == "" {
		return nil, huma.Error400BadRequest("plugin name is required", nil)
	}
	profile, err := resolveHermesProfileSelection(input.Profile)
	if err != nil {
		return nil, err
	}
	snapshot := scanHermesPlugins(ctx, profile)
	for _, plugin := range snapshot.Plugins {
		if !hermesPluginNameMatches(plugin, name) {
			continue
		}
		return &HermesPluginDetailOutput{Body: HermesPluginDetailResponse{
			Status:            "ok",
			Timestamp:         time.Now().UTC().Format(time.RFC3339),
			Plugin:            plugin,
			Manifest:          readOptionalText(plugin.ManifestPath),
			Readme:            readFirstExistingText(plugin.Path, "README.md", "readme.md", "README"),
			AfterInstall:      readFirstExistingText(plugin.Path, "after-install.md", "AFTER_INSTALL.md"),
			DashboardManifest: readOptionalText(filepath.Join(plugin.Path, "dashboard", "manifest.json")),
			Init:              readOptionalLimitedText(filepath.Join(plugin.Path, "__init__.py"), 256*1024),
		}}, nil
	}
	return nil, huma.Error404NotFound("hermes plugin not found", nil)
}

func InstallHermesPlugin(ctx context.Context, input *HermesPluginInstallInput) (*HermesPluginMutationOutput, error) {
	if input == nil || strings.TrimSpace(input.Body.Identifier) == "" {
		return nil, huma.Error400BadRequest("plugin identifier is required", nil)
	}
	request := input.Body
	if request.Enable == nil {
		enabled := true
		request.Enable = &enabled
	}
	profile, err := resolveHermesProfileSelection(input.Profile)
	if err != nil {
		return nil, err
	}
	args := []string{"plugins", "install"}
	if request.Force {
		args = append(args, "--force")
	}
	if request.Enable != nil {
		if *request.Enable {
			args = append(args, "--enable")
		} else {
			args = append(args, "--no-enable")
		}
	}
	identifier := strings.TrimSpace(request.Identifier)
	args = append(args, identifier)
	stdout, stderr, err := hermesCommandWithProfile(ctx, 3*time.Minute, profile.Name, args...)
	if err != nil {
		return nil, huma.Error500InternalServerError("hermes plugin install failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
	}
	invalidateHermesPluginCaches()
	return hermesPluginMutation(identifier, "Hermes plugin install finished. Restart Hermes Gateway to apply.", stdout, stderr), nil
}

func EnableHermesPlugin(ctx context.Context, input *HermesPluginActionInput) (*HermesPluginMutationOutput, error) {
	enable := true
	return runHermesPluginAction(ctx, input, "enable", &enable, "Hermes plugin enabled. Restart Hermes Gateway to apply.")
}

func DisableHermesPlugin(ctx context.Context, input *HermesPluginActionInput) (*HermesPluginMutationOutput, error) {
	enable := false
	return runHermesPluginAction(ctx, input, "disable", &enable, "Hermes plugin disabled. Restart Hermes Gateway to apply.")
}

func UpdateHermesPlugin(ctx context.Context, input *HermesPluginActionInput) (*HermesPluginMutationOutput, error) {
	return runHermesPluginActionWithTimeout(ctx, input, "update", nil, 3*time.Minute, "Hermes plugin update finished. Restart Hermes Gateway to apply.")
}

func UninstallHermesPlugin(ctx context.Context, input *HermesPluginUninstallInput) (*HermesPluginMutationOutput, error) {
	name := ""
	if input != nil {
		name = strings.TrimSpace(input.Name)
	}
	if name == "" {
		return nil, huma.Error400BadRequest("plugin name is required", nil)
	}
	profile, err := resolveHermesProfileSelection(input.Profile)
	if err != nil {
		return nil, err
	}
	cliName := resolveHermesPluginCLIName(ctx, profile, name)
	stdout, stderr, err := hermesCommandWithProfile(ctx, 2*time.Minute, profile.Name, "plugins", "remove", cliName)
	if err != nil {
		return nil, huma.Error500InternalServerError("hermes plugin remove failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
	}
	invalidateHermesPluginCaches()
	return hermesPluginMutation(cliName, "Hermes plugin removed. Restart Hermes Gateway to apply.", stdout, stderr), nil
}

func runHermesPluginAction(ctx context.Context, input *HermesPluginActionInput, action string, enable *bool, message string) (*HermesPluginMutationOutput, error) {
	return runHermesPluginActionWithTimeout(ctx, input, action, enable, 45*time.Second, message)
}

func runHermesPluginActionWithTimeout(ctx context.Context, input *HermesPluginActionInput, action string, enable *bool, timeout time.Duration, message string) (*HermesPluginMutationOutput, error) {
	name := ""
	if input != nil {
		name = strings.TrimSpace(input.Name)
	}
	if name == "" {
		return nil, huma.Error400BadRequest("plugin name is required", nil)
	}
	profile, err := resolveHermesProfileSelection(input.Profile)
	if err != nil {
		return nil, err
	}
	cliName := resolveHermesPluginCLIName(ctx, profile, name)
	var stdout, stderr string
	if enable != nil {
		stdout, stderr, err = runHermesDashboardPluginToggle(ctx, timeout, profile, cliName, *enable)
		if err == nil {
			invalidateHermesPluginCaches()
			return hermesPluginMutation(cliName, message, stdout, stderr), nil
		}
	}
	stdout, stderr, err = hermesCommandWithProfile(ctx, timeout, profile.Name, "plugins", action, cliName)
	if err != nil {
		return nil, huma.Error500InternalServerError("hermes plugin "+action+" failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
	}
	invalidateHermesPluginCaches()
	return hermesPluginMutation(cliName, message, stdout, stderr), nil
}

func runHermesDashboardPluginToggle(ctx context.Context, timeout time.Duration, profile HermesProfileSelection, name string, enable bool) (string, string, error) {
	script := `
import json
import sys
from hermes_cli.plugins_cmd import dashboard_set_agent_plugin_enabled

result = dashboard_set_agent_plugin_enabled(sys.argv[1], enabled=(sys.argv[2].lower() == "true"))
print(json.dumps(result, ensure_ascii=False))
if not result.get("ok"):
    raise SystemExit(1)
`
	return hermesPythonCommandForProfile(ctx, timeout, profile, script, name, map[bool]string{true: "true", false: "false"}[enable])
}

func resolveHermesPluginCLIName(ctx context.Context, profile HermesProfileSelection, name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return name
	}
	snapshot := scanHermesPlugins(ctx, profile)
	for _, plugin := range snapshot.Plugins {
		if hermesPluginNameMatches(plugin, name) {
			if plugin.Name != "" {
				return plugin.Name
			}
			if plugin.DirName != "" {
				return plugin.DirName
			}
			return plugin.Key
		}
	}
	return name
}

func hermesPluginMutation(plugin string, message string, stdout string, stderr string) *HermesPluginMutationOutput {
	return &HermesPluginMutationOutput{Body: HermesPluginMutationResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Plugin:    plugin,
		Message:   message,
		Stdout:    stdout,
		Stderr:    stderr,
	}}
}

func invalidateHermesPluginCaches() {
	invalidateCacheMap(&hermesPluginsCache)
	invalidateHermesEnvironmentCache()
}

func scanHermesPlugins(ctx context.Context, profile HermesProfileSelection) HermesPluginsResponse {
	home := profile.Path
	pluginsDir := filepath.Join(home, "plugins")
	config := readHermesPluginsConfig(filepath.Join(home, "config.yaml"))
	errorsList := make([]string, 0)
	if config.Error != "" {
		errorsList = append(errorsList, config.Error)
	}
	enabled := stringSet(config.Enabled)
	disabled := stringSet(config.Disabled)
	pluginsByKey := map[string]HermesPluginInfo{}
	addPlugins := func(root string, source string, skip map[string]bool) {
		found, scanErrors := scanHermesPluginRoot(root, source, skip, enabled, disabled)
		errorsList = append(errorsList, scanErrors...)
		for _, plugin := range found {
			key := plugin.Key
			if key == "" {
				key = plugin.Name
			}
			pluginsByKey[key] = plugin
		}
	}
	project := hermesProjectPath(ctx)
	addPlugins(filepath.Join(project, "plugins"), "bundled", map[string]bool{"memory": true, "context_engine": true, "platforms": true, "model-providers": true})
	addPlugins(filepath.Join(project, "plugins", "platforms"), "bundled", nil)
	addPlugins(pluginsDir, "user", nil)
	if envTruthy(os.Getenv("HERMES_ENABLE_PROJECT_PLUGINS")) {
		addPlugins(filepath.Join(".", ".hermes", "plugins"), "project", nil)
	}

	keys := make([]string, 0, len(pluginsByKey))
	for key := range pluginsByKey {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	plugins := make([]HermesPluginInfo, 0, len(keys))
	summary := HermesPluginsSummary{Sources: map[string]int{}, Kinds: map[string]int{}}
	for _, key := range keys {
		plugin := pluginsByKey[key]
		plugins = append(plugins, plugin)
		summary.Total++
		if plugin.Enabled {
			summary.Enabled++
		} else {
			summary.Disabled++
		}
		if plugin.Bundled {
			summary.Bundled++
		}
		if plugin.Source == "user" || plugin.Source == "git" {
			summary.User++
		}
		if plugin.Source == "project" {
			summary.Project++
		}
		if plugin.Dashboard != nil {
			summary.Dashboard++
		}
		summary.Sources[plugin.Source]++
		summary.Kinds[plugin.Kind]++
	}
	status := "ok"
	if len(errorsList) > 0 {
		status = "warning"
	}
	return HermesPluginsResponse{
		Status:     status,
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		HomePath:   home,
		PluginsDir: pluginsDir,
		Config:     config,
		Summary:    summary,
		Plugins:    plugins,
		Errors:     errorsList,
	}
}

func scanHermesPluginRoot(root string, source string, skip map[string]bool, enabled map[string]bool, disabled map[string]bool) ([]HermesPluginInfo, []string) {
	plugins := make([]HermesPluginInfo, 0)
	errorsList := make([]string, 0)
	root = strings.TrimSpace(root)
	if root == "" {
		return plugins, errorsList
	}
	if !filepath.IsAbs(root) {
		if abs, err := filepath.Abs(root); err == nil {
			root = abs
		}
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		if !os.IsNotExist(err) {
			errorsList = append(errorsList, err.Error())
		}
		return plugins, errorsList
	}
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") || (skip != nil && skip[entry.Name()]) {
			continue
		}
		dir := filepath.Join(root, entry.Name())
		if plugin, ok := readHermesPlugin(dir, root, source, enabled, disabled); ok {
			plugins = append(plugins, plugin)
			continue
		}
		nested, nestedErrors := scanHermesPluginRoot(dir, source, nil, enabled, disabled)
		errorsList = append(errorsList, nestedErrors...)
		plugins = append(plugins, nested...)
	}
	return plugins, errorsList
}

func readHermesPlugin(dir string, root string, source string, enabled map[string]bool, disabled map[string]bool) (HermesPluginInfo, bool) {
	manifestPath := filepath.Join(dir, "plugin.yaml")
	if !pathExists(manifestPath) {
		manifestPath = filepath.Join(dir, "plugin.yml")
	}
	if !pathExists(manifestPath) {
		return HermesPluginInfo{}, false
	}
	content, err := os.ReadFile(manifestPath)
	manifest := parseHermesPluginManifest(string(content))
	relative, _ := filepath.Rel(root, dir)
	key := filepath.ToSlash(relative)
	if key == "." || key == "" {
		key = filepath.Base(dir)
	}
	name := firstNonEmpty(manifest["name"], filepath.Base(dir))
	if source == "user" && pathExists(filepath.Join(dir, ".git")) {
		source = "git"
	}
	lookupEnabled := enabled[key] || enabled[name]
	lookupDisabled := disabled[key] || disabled[name]
	loadMode, effectiveEnabled, statusLabel := hermesPluginLoadState(source, firstNonEmpty(manifest["kind"], "standalone"), lookupEnabled, lookupDisabled)
	plugin := HermesPluginInfo{
		Key:                key,
		Name:               name,
		DirName:            filepath.Base(dir),
		DisplayName:        firstNonEmpty(manifest["label"], manifest["display_name"], manifest["displayName"]),
		Version:            manifest["version"],
		Description:        manifest["description"],
		Author:             manifest["author"],
		Kind:               firstNonEmpty(manifest["kind"], "standalone"),
		Source:             source,
		Path:               dir,
		ManifestPath:       manifestPath,
		Enabled:            effectiveEnabled,
		LoadMode:           loadMode,
		StatusLabel:        statusLabel,
		ExplicitlyEnabled:  lookupEnabled,
		ExplicitlyDisabled: lookupDisabled,
		Bundled:            source == "bundled",
		Git:                pathExists(filepath.Join(dir, ".git")),
		RequiresEnv:        parseHermesPluginManifestList(string(content), "requires_env", manifest["requires_env"]),
		ProvidesTools:      parseHermesPluginManifestList(string(content), "provides_tools", manifest["provides_tools"]),
		ProvidesHooks:      parseHermesPluginManifestList(string(content), "provides_hooks", manifest["provides_hooks"]),
		Files:              hermesPluginKnownFiles(dir, manifestPath),
	}
	if err != nil {
		plugin.Error = err.Error()
	}
	if dashboard := readHermesDashboardManifest(filepath.Join(dir, "dashboard", "manifest.json")); dashboard != nil {
		plugin.Dashboard = dashboard
	}
	return plugin, true
}

func hermesPluginLoadState(source string, kind string, explicitlyEnabled bool, explicitlyDisabled bool) (string, bool, string) {
	if explicitlyDisabled {
		return "disabled", false, "disabled"
	}
	if kind == "exclusive" {
		return "exclusive", false, "exclusive"
	}
	if kind == "model-provider" {
		return "provider", true, "provider"
	}
	if source == "bundled" && (kind == "backend" || kind == "platform") {
		return "auto", true, "auto loaded"
	}
	if explicitlyEnabled {
		return "opt-in", true, "enabled"
	}
	return "opt-in", false, "not enabled"
}

func readHermesPluginsConfig(path string) HermesPluginsConfig {
	config := HermesPluginsConfig{Path: path, Exists: pathExists(path), Enabled: []string{}, Disabled: []string{}}
	content, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			config.Error = err.Error()
		}
		return config
	}
	var payload map[string]any
	if err := yaml.Unmarshal(content, &payload); err != nil {
		config.Error = err.Error()
		return config
	}
	plugins, _ := payload["plugins"].(map[string]any)
	config.Enabled = yamlStringList(plugins["enabled"])
	config.Disabled = yamlStringList(plugins["disabled"])
	sort.Strings(config.Enabled)
	sort.Strings(config.Disabled)
	return config
}

func yamlStringList(value any) []string {
	values := make([]string, 0)
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			values = appendUnique(values, yamlScalarString(item))
		}
	case []string:
		values = appendUnique(values, typed...)
	case string:
		values = appendUnique(values, parseYAMLListValue(typed)...)
	}
	return compactStrings(values)
}

func yamlScalarString(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	case nil:
		return ""
	default:
		if text, ok := typed.(interface{ String() string }); ok {
			return strings.TrimSpace(text.String())
		}
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func parseHermesPluginManifest(content string) map[string]string {
	result := map[string]string{}
	lines := strings.Split(content, "\n")
	for index := 0; index < len(lines); index++ {
		raw := stripYAMLComment(lines[index])
		if strings.TrimSpace(raw) == "" || leadingSpaces(raw) != 0 {
			continue
		}
		key, value, ok := strings.Cut(strings.TrimSpace(raw), ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if value == "|" || value == ">" {
			value = parseFrontmatterScalarOrBlock(lines, &index, len(lines), 0, value)
		} else {
			value = normalizeYAMLScalar(value)
		}
		result[key] = value
	}
	return result
}

func parseHermesPluginList(value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return parseYAMLListValue(value)
}

func parseHermesPluginManifestList(content string, key string, inlineValue string) []string {
	values := parseHermesPluginList(inlineValue)
	inBlock := false
	blockIndent := 0
	for _, raw := range strings.Split(content, "\n") {
		line := stripYAMLComment(raw)
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		indent := leadingSpaces(line)
		if !inBlock {
			if indent != 0 {
				continue
			}
			field, value, ok := strings.Cut(trimmed, ":")
			if !ok || strings.TrimSpace(field) != key {
				continue
			}
			if inline := parseHermesPluginList(value); len(inline) > 0 {
				values = appendUnique(values, inline...)
			}
			inBlock = true
			blockIndent = indent
			continue
		}
		if indent <= blockIndent {
			break
		}
		if !strings.HasPrefix(trimmed, "- ") {
			continue
		}
		item := strings.TrimSpace(strings.TrimPrefix(trimmed, "- "))
		if strings.HasPrefix(item, "name:") {
			item = strings.TrimSpace(strings.TrimPrefix(item, "name:"))
		}
		values = appendUnique(values, normalizeYAMLScalar(item))
	}
	return compactStrings(values)
}

func readHermesDashboardManifest(path string) *HermesDashboardInfo {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var payload struct {
		Name        string `json:"name"`
		Label       string `json:"label"`
		Description string `json:"description"`
		Bundle      string `json:"bundle"`
		CSS         string `json:"css"`
		API         string `json:"api"`
		Tab         struct {
			Path   string `json:"path"`
			Icon   string `json:"icon"`
			Hidden bool   `json:"hidden"`
		} `json:"tab"`
		Slots []string `json:"slots"`
	}
	if err := json.Unmarshal(content, &payload); err != nil {
		return &HermesDashboardInfo{ManifestPath: path}
	}
	return &HermesDashboardInfo{
		ManifestPath: path,
		Name:         payload.Name,
		Label:        payload.Label,
		Description:  payload.Description,
		Bundle:       payload.Bundle,
		CSS:          payload.CSS,
		API:          payload.API,
		TabPath:      payload.Tab.Path,
		TabIcon:      payload.Tab.Icon,
		TabHidden:    payload.Tab.Hidden,
		Slots:        payload.Slots,
	}
}

func hermesPluginKnownFiles(dir string, manifestPath string) []HermesPluginFile {
	files := []HermesPluginFile{{Kind: "manifest", Path: manifestPath, Exists: pathExists(manifestPath)}}
	for _, item := range []struct{ kind, name string }{
		{"init", "__init__.py"},
		{"readme", "README.md"},
		{"after-install", "after-install.md"},
		{"dashboard", filepath.Join("dashboard", "manifest.json")},
	} {
		path := filepath.Join(dir, item.name)
		files = append(files, HermesPluginFile{Kind: item.kind, Path: path, Exists: pathExists(path)})
	}
	return files
}

func hermesPluginNameMatches(plugin HermesPluginInfo, name string) bool {
	name = strings.TrimSpace(name)
	return plugin.Key == name || plugin.Name == name || plugin.DirName == name || plugin.DisplayName == name || filepath.Base(plugin.Path) == name
}

func readOptionalText(path string) string {
	return readOptionalLimitedText(path, 1024*1024)
}

func readOptionalLimitedText(path string, limit int64) string {
	if strings.TrimSpace(path) == "" {
		return ""
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	if int64(len(content)) > limit {
		content = content[:limit]
	}
	return string(content)
}

func readFirstExistingText(dir string, names ...string) string {
	for _, name := range names {
		if content := readOptionalText(filepath.Join(dir, name)); content != "" {
			return content
		}
	}
	return ""
}

func envTruthy(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
