package hermes

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"agent-box-server/internal/config"
	"agent-box-server/internal/httpapi/toolenv"

	"github.com/danielgtaylor/huma/v2/sse"
	"gopkg.in/yaml.v3"
)

const hermesInstallScriptURL = "https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh"

type HermesInstallStreamInput struct{}

func InstallHermesStream(ctx context.Context, input *HermesInstallStreamInput, send sse.Sender) {
	_ = input
	streamHermesTaskSteps(ctx, send, "hermes-install", "install", []hermesTaskStep{
		{label: "检查安装前置条件", progress: 8, timeout: 10 * time.Second, run: runHermesInstallPrerequisiteCheck},
		{label: "执行 Hermes 官方安装脚本", progress: 52, timeout: 15 * time.Minute, run: runHermesOfficialInstallScript},
		{label: "验证 Hermes CLI", progress: 72, timeout: 20 * time.Second, run: runHermesInstallVersionCheck},
		{label: "补齐 Hermes 命令软链", progress: 78, timeout: 10 * time.Second, run: runHermesInstallLocalBinLink},
		{label: "初始化 Hermes Home 与基础配置", progress: 86, timeout: 30 * time.Second, run: runHermesInstallConfigBootstrap},
		{label: "初始化基础模型配置", progress: 90, timeout: 45 * time.Second, run: runHermesInstallModelInitialization},
		{label: "启动 Hermes Gateway", progress: 94, timeout: 5 * time.Minute, run: runHermesInstallGatewayStart},
		{label: "刷新本机服务状态缓存", progress: 98, timeout: 15 * time.Second, run: cleanupHermesInstallCache},
	})
}

func runHermesInstallPrerequisiteCheck(ctx context.Context, task hermesTaskLogger) error {
	if runtime.GOOS == "windows" {
		task.addLog("当前安装向导暂未适配 Windows Hermes 官方脚本。")
		return fmt.Errorf("Hermes install wizard is not supported on Windows yet")
	}

	pythonPath := toolenv.ResolveToolPath("python3")
	if pythonPath == "" {
		pythonPath = toolenv.ResolveToolPath("python")
	}
	if pythonPath == "" {
		return fmt.Errorf("未检测到 Python，请先安装 Python 3.11+")
	}
	task.addLog("Python: " + firstLine(commandOutput(ctx, 5*time.Second, pythonPath, "--version")) + " (" + pythonPath + ")")

	if gitPath := toolenv.ResolveToolPath("git"); gitPath != "" {
		if runtime.GOOS == "darwin" && filepath.Clean(gitPath) == "/usr/bin/git" && hermesXcodeCommandLineToolsPath(ctx) == "" {
			task.addLog("Git 依赖 Xcode Command Line Tools，当前尚未安装。")
		} else {
			task.addLog("Git: " + firstLine(commandOutput(ctx, 5*time.Second, gitPath, "--version")) + " (" + gitPath + ")")
		}
	} else {
		task.addLog("未检测到 Git。官方安装脚本会尝试继续，但插件和源码更新能力可能受限。")
	}

	if runtime.GOOS == "darwin" {
		if xcodePath := hermesXcodeCommandLineToolsPath(ctx); xcodePath != "" {
			task.addLog("Xcode Command Line Tools: " + xcodePath)
		} else {
			task.addLog("未检测到 Xcode Command Line Tools（macOS Python 前置依赖）。")
			return fmt.Errorf("macOS 安装 Hermes 需要先安装 Xcode Command Line Tools")
		}
	}

	if uvPath := toolenv.ResolveToolPath("uv"); uvPath != "" {
		task.addLog("uv: " + firstLine(commandOutput(ctx, 5*time.Second, uvPath, "--version")) + " (" + uvPath + ")")
	} else {
		task.addLog("未检测到 uv。官方安装脚本会创建虚拟环境并安装依赖。")
	}

	return nil
}

func hermesXcodeCommandLineToolsPath(ctx context.Context) string {
	xcodePath := toolenv.ResolveToolPath("xcode-select")
	if xcodePath == "" {
		return ""
	}
	cmdCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, xcodePath, "-p")
	cmd.Env = toolenv.CommandEnv()
	output, err := cmd.CombinedOutput()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

func runHermesOfficialInstallScript(ctx context.Context, task hermesTaskLogger) error {
	task.addLog("执行 curl -fsSL " + hermesInstallScriptURL + " | bash -s -- --skip-setup")
	return runHermesExternalStreamingCommand(ctx, 15*time.Minute, task.addLog, "bash", "-lc", "curl -fsSL "+hermesInstallScriptURL+" | bash -s -- --skip-setup")
}

func runHermesInstallVersionCheck(ctx context.Context, task hermesTaskLogger) error {
	task.addLog("执行 hermes --version")
	return runHermesExternalStreamingCommand(ctx, 20*time.Second, task.addLog, "hermes", "--version")
}

func runHermesInstallLocalBinLink(ctx context.Context, task hermesTaskLogger) error {
	_ = ctx
	if runtime.GOOS == "windows" {
		return nil
	}
	source := toolenv.ResolveToolPath("hermes")
	if source == "" {
		task.addLog("hermes CLI 不可用，跳过 ~/.local/bin/hermes 软链。")
		return nil
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		task.addLog("无法解析用户 Home，跳过 ~/.local/bin/hermes 软链。")
		return nil
	}
	target := filepath.Join(home, ".local", "bin", "hermes")
	if filepath.Clean(source) == filepath.Clean(target) {
		task.addLog("~/.local/bin/hermes 已可用。")
		return nil
	}
	if existing, err := os.Readlink(target); err == nil {
		if filepath.Clean(existing) == filepath.Clean(source) {
			task.addLog("~/.local/bin/hermes 软链已存在。")
			return nil
		}
		if err := os.Remove(target); err != nil {
			return fmt.Errorf("replace hermes symlink: %w", err)
		}
	} else if !os.IsNotExist(err) {
		if info, statErr := os.Lstat(target); statErr == nil {
			if info.Mode().IsRegular() {
				task.addLog("~/.local/bin/hermes 已存在，跳过软链创建。")
				return nil
			}
		} else {
			return fmt.Errorf("inspect hermes symlink: %w", err)
		}
		if removeErr := os.Remove(target); removeErr != nil {
			return fmt.Errorf("replace hermes path: %w", removeErr)
		}
	} else if info, statErr := os.Lstat(target); statErr == nil {
		if info.Mode().IsRegular() {
			task.addLog("~/.local/bin/hermes 已存在，跳过软链创建。")
			return nil
		}
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	if err := os.Symlink(source, target); err != nil {
		return fmt.Errorf("create hermes symlink: %w", err)
	}
	task.addLog("已创建 ~/.local/bin/hermes -> " + source)
	return nil
}

func runHermesInstallConfigBootstrap(ctx context.Context, task hermesTaskLogger) error {
	_ = ctx
	home, envOverride := defaultHermesHomeDir()
	if envOverride != "" {
		task.addLog("检测到 HERMES_HOME: " + envOverride)
	}
	if err := os.MkdirAll(home, 0o755); err != nil {
		return err
	}

	configPath := filepath.Join(home, "config.yaml")
	if pathExists(configPath) {
		changed, err := ensureHermesInstallConfig(configPath)
		if err != nil {
			return err
		}
		if changed {
			task.addLog("已补齐 Dashboard 所需 Hermes 配置：" + configPath)
		} else {
			task.addLog("config.yaml 已存在且配置完整：" + configPath)
		}
		return nil
	}

	content := []byte(`_config_version: 1
model:
  default: gpt-5.5
platforms:
  api_server:
    enabled: true
dashboard:
  theme: default-large
`)
	if err := os.WriteFile(configPath, content, 0o600); err != nil {
		return err
	}
	task.addLog("已写入基础 config.yaml：" + configPath)
	return nil
}

type hermesModelInitializationPayload struct {
	API            string                      `json:"api"`
	BaseURL        string                      `json:"baseUrl"`
	DefaultKey     string                      `json:"defaultKey"`
	DefaultModel   hermesInitializationModel   `json:"defaultModel"`
	FallbackModels []hermesInitializationModel `json:"fallbackModels"`
	ProviderKey    string                      `json:"providerKey"`
	I18N           map[string]string           `json:"i18n"`
}

type hermesInitializationModel struct {
	ContextWindow int    `json:"contextWindow"`
	ID            string `json:"id"`
	MaxTokens     int    `json:"maxTokens"`
	Name          string `json:"name"`
	Reasoning     bool   `json:"reasoning"`
	Vision        bool   `json:"vision"`
}

func runHermesInstallModelInitialization(ctx context.Context, task hermesTaskLogger) error {
	sourceURL := config.Current().ModelInitializationURL
	task.addLog("获取基础模型配置：" + sourceURL)
	payload, err := fetchHermesModelInitialization(ctx, sourceURL)
	if err != nil {
		return err
	}

	home, _ := defaultHermesHomeDir()
	configPath := filepath.Join(home, "config.yaml")
	content, err := os.ReadFile(configPath)
	config := map[string]any{}
	if err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("read hermes config: %w", err)
		}
	} else {
		config, err = parseHermesYAMLConfig(content)
		if err != nil {
			return fmt.Errorf("parse hermes config: %w", err)
		}
	}

	providerKey := normalizeHermesProviderKey(payload.ProviderKey)
	if providerKey == "" {
		return fmt.Errorf("model initialization providerKey is empty")
	}
	defaultModelID := strings.TrimSpace(payload.DefaultModel.ID)
	if defaultModelID == "" {
		return fmt.Errorf("model initialization defaultModel.id is empty")
	}

	applyHermesModelInitialization(config, payload)
	nextContent, err := yaml.Marshal(config)
	if err != nil {
		return fmt.Errorf("serialize hermes config: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(configPath, nextContent, 0o600); err != nil {
		return fmt.Errorf("write hermes config: %w", err)
	}

	modelCount := len(mergeHermesInitializationModels(payload.DefaultModel, payload.FallbackModels))
	task.addLog(fmt.Sprintf("已写入基础模型 Provider：%s（%d 个模型）", providerKey, modelCount))
	task.addLog("默认主模型：" + providerKey + "/" + defaultModelID)
	return nil
}

func fetchHermesModelInitialization(ctx context.Context, sourceURL string) (hermesModelInitializationPayload, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return hermesModelInitializationPayload{}, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return hermesModelInitializationPayload{}, fmt.Errorf("fetch model initialization: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return hermesModelInitializationPayload{}, fmt.Errorf("model initialization endpoint returned %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return hermesModelInitializationPayload{}, fmt.Errorf("read model initialization response: %w", err)
	}

	var payload hermesModelInitializationPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return hermesModelInitializationPayload{}, fmt.Errorf("parse model initialization response: %w", err)
	}
	if strings.TrimSpace(payload.ProviderKey) == "" {
		return hermesModelInitializationPayload{}, fmt.Errorf("model initialization providerKey is empty")
	}
	if strings.TrimSpace(payload.BaseURL) == "" {
		return hermesModelInitializationPayload{}, fmt.Errorf("model initialization baseUrl is empty")
	}
	if strings.TrimSpace(payload.API) == "" {
		return hermesModelInitializationPayload{}, fmt.Errorf("model initialization api is empty")
	}
	if strings.TrimSpace(payload.DefaultModel.ID) == "" {
		return hermesModelInitializationPayload{}, fmt.Errorf("model initialization defaultModel.id is empty")
	}
	return payload, nil
}

func applyHermesModelInitialization(content map[string]any, payload hermesModelInitializationPayload) {
	providerKey := normalizeHermesProviderKey(payload.ProviderKey)
	defaultModelID := strings.TrimSpace(payload.DefaultModel.ID)
	apiMode := hermesInitializationAPIMode(payload.API)
	modelConfig := objectMap(content["model"])
	modelConfig["default"] = defaultModelID
	modelConfig["provider"] = providerKey
	modelConfig["base_url"] = strings.TrimSpace(payload.BaseURL)
	modelConfig["api_key"] = strings.TrimSpace(payload.DefaultKey)
	modelConfig["api_mode"] = apiMode
	content["model"] = modelConfig

	providers := objectMap(content["providers"])
	providers[providerKey] = map[string]any{
		"name":          hermesInitializationProviderName(payload),
		"base_url":      strings.TrimSpace(payload.BaseURL),
		"api_key":       strings.TrimSpace(payload.DefaultKey),
		"default_model": defaultModelID,
		"api_mode":      apiMode,
		"models":        hermesInitializationModelMap(mergeHermesInitializationModels(payload.DefaultModel, payload.FallbackModels)),
	}
	content["providers"] = providers

	content["fallback_providers"] = hermesInitializationFallbackProviders(providerKey, defaultModelID, payload.FallbackModels)

	agent := objectMap(content["agent"])
	if payload.DefaultModel.Vision {
		agent["image_input_mode"] = "native"
	} else if firstHermesInitializationVisionModel(payload) != "" {
		agent["image_input_mode"] = "text"
	} else if _, ok := agent["image_input_mode"]; !ok {
		agent["image_input_mode"] = "auto"
	}
	content["agent"] = agent

	if visionModelID := firstHermesInitializationVisionModel(payload); visionModelID != "" {
		auxiliary := objectMap(content["auxiliary"])
		vision := objectMap(auxiliary["vision"])
		vision["provider"] = providerKey
		vision["model"] = visionModelID
		vision["api_mode"] = apiMode
		if _, ok := vision["timeout"]; !ok {
			vision["timeout"] = 120
		}
		if _, ok := vision["download_timeout"]; !ok {
			vision["download_timeout"] = 30
		}
		if _, ok := vision["extra_body"]; !ok {
			vision["extra_body"] = map[string]any{}
		}
		auxiliary["vision"] = vision
		content["auxiliary"] = auxiliary
	}
}

func firstHermesInitializationVisionModel(payload hermesModelInitializationPayload) string {
	for _, model := range mergeHermesInitializationModels(payload.DefaultModel, payload.FallbackModels) {
		if model.Vision {
			return strings.TrimSpace(model.ID)
		}
	}
	return ""
}

func hermesInitializationProviderName(payload hermesModelInitializationPayload) string {
	if name := strings.TrimSpace(payload.I18N["Title"]); name != "" {
		return name
	}
	return strings.TrimSpace(payload.ProviderKey)
}

func hermesInitializationAPIMode(api string) string {
	switch strings.ToLower(strings.TrimSpace(api)) {
	case "anthropic-messages", "anthropic_messages":
		return "anthropic_messages"
	case "openai-responses", "openai-codex-responses", "codex_responses":
		return "codex_responses"
	case "bedrock-converse-stream", "bedrock-converse", "bedrock_converse":
		return "bedrock_converse"
	default:
		return "chat_completions"
	}
}

func mergeHermesInitializationModels(defaultModel hermesInitializationModel, fallbackModels []hermesInitializationModel) []hermesInitializationModel {
	seen := map[string]bool{}
	models := make([]hermesInitializationModel, 0, 1+len(fallbackModels))
	for _, model := range append([]hermesInitializationModel{defaultModel}, fallbackModels...) {
		id := strings.TrimSpace(model.ID)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		model.ID = id
		model.Name = strings.TrimSpace(model.Name)
		models = append(models, model)
	}
	return models
}

func hermesInitializationModelMap(models []hermesInitializationModel) map[string]any {
	result := make(map[string]any, len(models))
	for _, model := range models {
		id := strings.TrimSpace(model.ID)
		if id == "" {
			continue
		}
		item := map[string]any{
			"name":  strings.TrimSpace(model.Name),
			"input": []string{"text"},
		}
		if item["name"] == "" {
			delete(item, "name")
		}
		if model.ContextWindow > 0 {
			item["context_length"] = model.ContextWindow
			item["context_window"] = model.ContextWindow
		}
		if model.MaxTokens > 0 {
			item["max_tokens"] = model.MaxTokens
		}
		if model.Reasoning {
			item["reasoning"] = true
		}
		if model.Vision {
			item["input"] = []string{"text", "image"}
		}
		result[id] = item
	}
	return result
}

func hermesInitializationFallbackProviders(providerKey string, defaultModelID string, fallbackModels []hermesInitializationModel) []map[string]any {
	providerKey = normalizeHermesProviderKey(providerKey)
	primary := strings.TrimSpace(defaultModelID)
	seen := map[string]bool{}
	result := make([]map[string]any, 0, len(fallbackModels))
	for _, model := range fallbackModels {
		id := strings.TrimSpace(model.ID)
		if id == "" || id == primary || seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, map[string]any{
			"provider": strings.TrimSpace(providerKey),
			"model":    id,
		})
	}
	return result
}

func runHermesInstallGatewayStart(ctx context.Context, task hermesTaskLogger) error {
	path := toolenv.ResolveToolPath("hermes")
	if path == "" {
		task.addLog("hermes CLI 不可用，跳过 Gateway 启动。")
		return nil
	}
	task.addLog("执行 hermes gateway restart，等待 Gateway 上报运行态")
	profile, resolveErr := resolveHermesProfileSelection("")
	if resolveErr != nil {
		return resolveErr
	}
	_, err := runHermesGatewayRestartAndWait(ctx, path, profile, 5*time.Minute, task.addLog)
	if err != nil {
		task.addLog("Gateway 启动未完成，安装已完成但运行态需要稍后在服务管理页手动重启：" + err.Error())
		return nil
	}
	task.addLog("Hermes Gateway 已启动。")
	return nil
}

func ensureHermesInstallConfig(configPath string) (bool, error) {
	content, err := os.ReadFile(configPath)
	if err != nil {
		return false, err
	}
	config, err := parseHermesYAMLConfig(content)
	if err != nil {
		return false, err
	}

	changed := false
	if normalizeHermesConfigProviderAliases(config) {
		changed = true
	}
	platforms := objectMap(config["platforms"])
	apiServer := objectMap(platforms["api_server"])
	if apiServer["enabled"] != true {
		apiServer["enabled"] = true
		platforms["api_server"] = apiServer
		config["platforms"] = platforms
		changed = true
	}

	dashboard := objectMap(config["dashboard"])
	if _, ok := dashboard["theme"]; !ok {
		dashboard["theme"] = "default-large"
		config["dashboard"] = dashboard
		changed = true
	}

	if !changed {
		return false, nil
	}
	nextContent, err := yaml.Marshal(config)
	if err != nil {
		return false, err
	}
	if err := os.WriteFile(configPath, nextContent, 0o600); err != nil {
		return false, err
	}
	return true, nil
}

func normalizeHermesProviderKey(providerKey string) string {
	trimmed := strings.TrimSpace(providerKey)
	switch strings.ToLower(strings.ReplaceAll(trimmed, "_", "-")) {
	case "nex-llm":
		return "nex-llm"
	default:
		return trimmed
	}
}

func normalizeHermesConfigProviderAliases(config map[string]any) bool {
	changed := false
	model := objectMap(config["model"])
	if provider, ok := model["provider"].(string); ok {
		normalized := normalizeHermesProviderKey(provider)
		if normalized != provider {
			model["provider"] = normalized
			config["model"] = model
			changed = true
		}
	}

	providers := objectMap(config["providers"])
	for key, value := range providers {
		normalized := normalizeHermesProviderKey(key)
		if normalized != key {
			if _, exists := providers[normalized]; !exists {
				providers[normalized] = value
			}
			delete(providers, key)
			config["providers"] = providers
			changed = true
		}
	}

	auxiliary := objectMap(config["auxiliary"])
	vision := objectMap(auxiliary["vision"])
	if provider, ok := vision["provider"].(string); ok {
		normalized := normalizeHermesProviderKey(provider)
		if normalized != provider {
			vision["provider"] = normalized
			auxiliary["vision"] = vision
			config["auxiliary"] = auxiliary
			changed = true
		}
	}

	if fallbacks, ok := config["fallback_providers"].([]any); ok {
		for _, item := range fallbacks {
			fallback := objectMap(item)
			if provider, ok := fallback["provider"].(string); ok {
				normalized := normalizeHermesProviderKey(provider)
				if normalized != provider {
					fallback["provider"] = normalized
					changed = true
				}
			}
		}
	}
	return changed
}

func cleanupHermesInstallCache(ctx context.Context, task hermesTaskLogger) error {
	_ = ctx
	invalidateHermesEnvironmentCache()
	invalidateHermesUpdateStatusCache()
	task.addLog("已刷新 Hermes 环境状态缓存。")
	return nil
}
