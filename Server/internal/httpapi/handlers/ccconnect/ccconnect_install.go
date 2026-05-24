package ccconnect

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"agent-box-server/internal/config"
	"agent-box-server/internal/httpapi/toolenv"

	"github.com/danielgtaylor/huma/v2/sse"
)

const ccConnectNPMInstallPackage = "cc-connect@latest"
const ccConnectClaudeCodeNPMInstallPackage = "@anthropic-ai/claude-code"

func InstallCCConnectStream(ctx context.Context, input *struct{}, send sse.Sender) {
	_ = input
	streamCCConnectTaskSteps(ctx, send, "cc-connect-install", "install", []ccConnectTaskStep{
		{label: "检查安装前置条件", progress: 8, timeout: 10 * time.Second, run: runCCConnectInstallPrerequisiteCheck},
		{label: "安装 CC-Connect CLI", progress: 38, timeout: 10 * time.Minute, run: runCCConnectNPMInstall},
		{label: "验证 CC-Connect CLI", progress: 52, timeout: 20 * time.Second, run: runCCConnectInstallVersionCheck},
		{label: "安装 Claude Code CLI", progress: 60, timeout: 10 * time.Minute, run: runCCConnectInstallClaudeCode},
		{label: "初始化 config.toml 与管理接口", progress: 64, timeout: 30 * time.Second, run: runCCConnectInstallConfigBootstrap},
		{label: "初始化基础模型 Provider", progress: 76, timeout: 45 * time.Second, run: runCCConnectInstallModelInitialization},
		{label: "初始化默认项目", progress: 84, timeout: 30 * time.Second, run: runCCConnectInstallProjectInitialization},
		{label: "启用 AgentBox 托管自动启动", progress: 90, timeout: 10 * time.Second, run: runCCConnectInstallAutoStart},
		{label: "启动 CC-Connect 托管运行时", progress: 96, timeout: 60 * time.Second, run: runCCConnectInstallManagedRuntimeStart},
		{label: "刷新本机服务状态缓存", progress: 98, timeout: 15 * time.Second, run: cleanupCCConnectInstallCache},
	})
}

func runCCConnectInstallPrerequisiteCheck(ctx context.Context, task ccConnectTaskLogger) error {
	if runtime.GOOS == "windows" {
		task.addLog("当前安装向导暂未适配 Windows 全局 npm 安装。")
		return fmt.Errorf("CC-Connect install wizard is not supported on Windows yet")
	}

	if nodePath := toolenv.ResolveToolPath("node"); nodePath != "" {
		task.addLog("Node.js: " + ccConnectInstallCommandOutput(ctx, nodePath, "--version") + " (" + nodePath + ")")
	} else {
		return fmt.Errorf("未检测到 Node.js，请先安装 Node.js")
	}

	if npmPath := toolenv.ResolveToolPath("npm"); npmPath != "" {
		task.addLog("npm: " + ccConnectInstallCommandOutput(ctx, npmPath, "--version") + " (" + npmPath + ")")
	} else {
		return fmt.Errorf("未检测到 npm，无法安装 CC-Connect CLI")
	}

	if gitPath := toolenv.ResolveToolPath("git"); gitPath != "" {
		if runtime.GOOS == "darwin" && filepath.Clean(gitPath) == "/usr/bin/git" && ccConnectXcodeCommandLineToolsPath(ctx) == "" {
			task.addLog("Git 依赖 Xcode Command Line Tools，当前尚未安装。")
		} else {
			task.addLog("Git: " + ccConnectInstallCommandOutput(ctx, gitPath, "--version") + " (" + gitPath + ")")
		}
	} else {
		task.addLog("未检测到 Git。CC-Connect 核心安装可继续，部分开发工具能力可能受限。")
	}

	return nil
}

func ccConnectXcodeCommandLineToolsPath(ctx context.Context) string {
	xcodePath := toolenv.ResolveToolPath("xcode-select")
	if xcodePath == "" {
		return ""
	}
	stdout, _, err := runCCConnectCommand(ctx, xcodePath, 5*time.Second, "-p")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(stdout)
}

func runCCConnectNPMInstall(ctx context.Context, task ccConnectTaskLogger) error {
	if path := resolveCCConnectCLIPath(ctx); path != "" {
		task.addLog("已检测到 cc-connect CLI，跳过全局安装：" + path)
		return nil
	}
	if npmPath := toolenv.ResolveToolPath("npm"); npmPath == "" {
		return fmt.Errorf("未检测到 npm，无法安装 CC-Connect CLI")
	}
	task.addLog("执行 npm install -g " + ccConnectNPMInstallPackage)
	if err := runCCConnectExternalStreamingCommand(ctx, 10*time.Minute, task.addLog, "npm", "install", "-g", ccConnectNPMInstallPackage); err != nil {
		return err
	}
	return ensureCCConnectNPMBinLink(ctx, task)
}

func runCCConnectInstallVersionCheck(ctx context.Context, task ccConnectTaskLogger) error {
	path := resolveCCConnectCLIPath(ctx)
	if path == "" {
		return fmt.Errorf("安装后仍未检测到 cc-connect CLI")
	}
	task.addLog("cc-connect CLI: " + path)
	return runCCConnectExternalStreamingCommand(ctx, 20*time.Second, task.addLog, path, "--version")
}

func runCCConnectInstallClaudeCode(ctx context.Context, task ccConnectTaskLogger) error {
	if path := resolveCCConnectClaudeCodePath(); path != "" {
		task.addLog("已检测到 Claude Code CLI，跳过安装：" + path)
		return nil
	}

	command := ccConnectClaudeCodeInstallCommand()
	task.addLog("未检测到 Claude Code CLI，开始安装 claudecode 依赖。")
	task.addLog("执行 " + command)
	if runtime.GOOS == "windows" {
		if err := runCCConnectExternalStreamingCommand(ctx, 10*time.Minute, task.addLog, "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command); err != nil {
			return err
		}
	} else {
		if err := runCCConnectExternalStreamingCommand(ctx, 10*time.Minute, task.addLog, "bash", "-lc", command); err != nil {
			return err
		}
	}

	path := resolveCCConnectClaudeCodePath()
	if path == "" {
		return fmt.Errorf("Claude Code 安装后仍未检测到 claude CLI")
	}
	task.addLog("Claude Code CLI: " + path)
	return runCCConnectExternalStreamingCommand(ctx, 20*time.Second, task.addLog, path, "--version")
}

func ccConnectClaudeCodeInstallCommand() string {
	if runtime.GOOS == "windows" {
		return "if (Get-Command npm -ErrorAction SilentlyContinue) { npm install -g " + ccConnectClaudeCodeNPMInstallPackage + " }; if (!(Get-Command claude -ErrorAction SilentlyContinue)) { irm https://downloads.claude.ai/claude-code-releases/bootstrap.ps1 | iex }"
	}
	return "if command -v npm >/dev/null 2>&1; then npm install -g " + ccConnectClaudeCodeNPMInstallPackage + "; fi; if ! command -v claude >/dev/null 2>&1; then curl -fsSL https://downloads.claude.ai/claude-code-releases/bootstrap.sh | bash; fi"
}

func resolveCCConnectClaudeCodePath() string {
	return toolenv.ResolveToolPath("claude")
}

func ensureCCConnectNPMBinLink(ctx context.Context, task ccConnectTaskLogger) error {
	prefix := ccConnectNPMPrefix(ctx)
	if prefix == "" {
		return nil
	}
	binPath := filepath.Join(prefix, "bin", "cc-connect")
	targetPath := filepath.Join(prefix, "lib", "node_modules", "cc-connect", "run.js")
	if !pathExists(targetPath) {
		return nil
	}
	if pathExistsOrSymlink(binPath) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(binPath), 0o755); err != nil {
		return err
	}
	if err := os.Symlink(targetPath, binPath); err != nil {
		return err
	}
	task.addLog("已补齐 npm 全局 CLI 入口：" + binPath)
	return nil
}

func runCCConnectInstallConfigBootstrap(ctx context.Context, task ccConnectTaskLogger) error {
	_ = ctx
	path, source := resolveCCConnectConfigPath()
	if strings.TrimSpace(path) == "" {
		return fmt.Errorf("无法解析 CC-Connect config.toml 路径")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	doc, exists, err := readCCConnectConfigDocument(path)
	if err != nil {
		return fmt.Errorf("read cc-connect config: %w", err)
	}
	changed := ensureCCConnectInstallConfig(doc)
	content, err := encodeCCConnectConfigDocument(doc)
	if err != nil {
		return fmt.Errorf("encode cc-connect config: %w", err)
	}
	if err := validateCCConnectTOML(content); err != nil {
		return fmt.Errorf("encoded cc-connect config is invalid: %w", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return fmt.Errorf("write cc-connect config: %w", err)
	}

	switch {
	case !exists:
		task.addLog("已创建基础 config.toml：" + path)
	case changed:
		task.addLog("已补齐 AgentBox 托管所需配置：" + path)
	default:
		task.addLog("config.toml 已存在且托管配置完整：" + path)
	}
	if source != "" {
		task.addLog("配置来源：" + source)
	}
	return nil
}

type ccConnectModelInitializationPayload struct {
	API            string                         `json:"api"`
	BaseURL        string                         `json:"baseUrl"`
	DefaultKey     string                         `json:"defaultKey"`
	DefaultModel   ccConnectInitializationModel   `json:"defaultModel"`
	FallbackModels []ccConnectInitializationModel `json:"fallbackModels"`
	ProviderKey    string                         `json:"providerKey"`
}

type ccConnectInitializationModel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func runCCConnectInstallModelInitialization(ctx context.Context, task ccConnectTaskLogger) error {
	path, _ := resolveCCConnectConfigPath()
	doc, _, err := readCCConnectConfigDocument(path)
	if err != nil {
		return fmt.Errorf("read cc-connect config: %w", err)
	}
	if len(configList(doc["providers"])) > 0 {
		task.addLog("已存在模型 Provider，跳过模型初始化。")
		return nil
	}

	sourceURL := config.Current().ModelInitializationURL
	task.addLog("获取基础模型配置：" + sourceURL)
	payload, err := fetchCCConnectModelInitialization(ctx, sourceURL)
	if err != nil {
		task.addLog("基础模型配置获取失败，写入本地默认占位 Provider：" + err.Error())
		payload = fallbackCCConnectModelInitialization()
	}
	provider := ccConnectProviderFromInitialization(payload)
	if strings.TrimSpace(provider.Name) == "" {
		return fmt.Errorf("model initialization provider name is empty")
	}
	doc["providers"] = ccConnectModelProviderMaps([]CCConnectModelProviderConfig{provider})
	projects := configList(doc["projects"])
	for _, item := range projects {
		projectMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		agent := ccConnectConfigMap(projectMap, "agent", true)
		options := ccConnectConfigMap(agent, "options", true)
		setStringSliceConfigValue(agent, "provider_refs", []string{provider.Name})
		if strings.TrimSpace(stringFromConfigMap(options, "provider")) == "" {
			options["provider"] = provider.Name
		}
		if strings.TrimSpace(stringFromConfigMap(options, "model")) == "" && provider.Model != "" {
			options["model"] = provider.Model
		}
	}
	if len(projects) > 0 {
		doc["projects"] = projects
	}
	if err := writeCCConnectInstallDocument(path, doc); err != nil {
		return err
	}
	task.addLog(fmt.Sprintf("已写入基础模型 Provider：%s / %s", provider.Name, provider.Model))
	return nil
}

func runCCConnectInstallProjectInitialization(ctx context.Context, task ccConnectTaskLogger) error {
	path, _ := resolveCCConnectConfigPath()
	doc, _, err := readCCConnectConfigDocument(path)
	if err != nil {
		return fmt.Errorf("read cc-connect config: %w", err)
	}
	cfg := parseCCConnectProjectsConfig(doc)
	if len(cfg.Projects) > 0 {
		if repairCCConnectInstallPlaceholderPlatforms(&cfg) {
			applyCCConnectProjectsConfig(doc, cfg)
			if err := writeCCConnectInstallDocument(path, doc); err != nil {
				return err
			}
			task.addLog("已将默认项目占位消息平台修正为飞书。")
			return nil
		}
		task.addLog("已存在项目配置，跳过默认项目初始化。")
		return nil
	}
	workDir := ccConnectDefaultProjectWorkDir(ctx)
	providerName := firstCCConnectProviderName(doc)
	project := CCConnectProjectConfig{
		Name:            "default-project",
		ResetOnIdleMins: 30,
		Agent: CCConnectProjectAgentConfig{
			Type:         "claudecode",
			WorkDir:      workDir,
			Mode:         "default",
			Provider:     providerName,
			Model:        firstCCConnectProviderModel(doc, providerName),
			ProviderRefs: optionalCCConnectProviderRefs(providerName),
		},
		Platforms: []CCConnectProjectPlatformConfig{defaultCCConnectInstallProjectPlatform()},
	}
	cfg.Projects = append(cfg.Projects, project)
	applyCCConnectProjectsConfig(doc, cfg)
	if err := writeCCConnectInstallDocument(path, doc); err != nil {
		return err
	}
	return nil
}

func defaultCCConnectInstallProjectPlatform() CCConnectProjectPlatformConfig {
	return CCConnectProjectPlatformConfig{
		Type: "feishu",
		Options: map[string]string{
			"app_id":     "xxx",
			"app_secret": "xxx",
		},
	}
}

func repairCCConnectInstallPlaceholderPlatforms(cfg *CCConnectProjectsConfig) bool {
	if cfg == nil {
		return false
	}
	changed := false
	for projectIndex := range cfg.Projects {
		if cfg.Projects[projectIndex].Name != "default-project" {
			continue
		}
		for platformIndex := range cfg.Projects[projectIndex].Platforms {
			if isCCConnectInstallLinePlaceholder(cfg.Projects[projectIndex].Platforms[platformIndex]) {
				cfg.Projects[projectIndex].Platforms[platformIndex] = defaultCCConnectInstallProjectPlatform()
				changed = true
			}
		}
	}
	return changed
}

func isCCConnectInstallLinePlaceholder(platform CCConnectProjectPlatformConfig) bool {
	if !strings.EqualFold(strings.TrimSpace(platform.Type), "line") {
		return false
	}
	options := cleanStringMap(platform.Options)
	return isCCConnectInstallPlaceholderValue(options["channel_secret"]) &&
		(isCCConnectInstallPlaceholderValue(options["channel_access_token"]) || isCCConnectInstallPlaceholderValue(options["channel_token"]))
}

func isCCConnectInstallPlaceholderValue(value string) bool {
	value = strings.TrimSpace(value)
	return strings.EqualFold(value, "xxx")
}

func ccConnectDefaultProjectWorkDir(ctx context.Context) string {
	if cliPath := resolveCCConnectCLIPath(ctx); strings.TrimSpace(cliPath) != "" {
		if realPath, err := filepath.EvalSymlinks(cliPath); err == nil && strings.TrimSpace(realPath) != "" {
			return filepath.Dir(realPath)
		}
		return filepath.Dir(cliPath)
	}
	path, _ := resolveCCConnectConfigPath()
	if strings.TrimSpace(path) != "" {
		return filepath.Dir(path)
	}
	if workDir, err := os.Getwd(); err == nil && strings.TrimSpace(workDir) != "" {
		return workDir
	}
	return defaultCCConnectDataDir()
}

func runCCConnectInstallAutoStart(ctx context.Context, task ccConnectTaskLogger) error {
	if err := saveCCConnectAutoStart(ctx, true); err != nil {
		return err
	}
	task.addLog("已开启 AgentBox 后端启动时自动托管 CC-Connect。")
	return nil
}

func runCCConnectInstallManagedRuntimeStart(ctx context.Context, task ccConnectTaskLogger) error {
	config, _, parsed := detectCCConnectConfig()
	if parsed == nil || len(parsed.Projects) == 0 {
		task.addLog("config.toml 尚未配置项目，已完成安装与自动托管设置；创建项目后可在服务页启动运行时。")
		return nil
	}
	if cliPath := resolveCCConnectCLIPath(ctx); cliPath != "" {
		task.addLog("托管启动 CLI：" + cliPath)
	}
	if config.Path != "" {
		task.addLog("托管启动配置：" + config.Path)
	}
	logPath := ccConnectManagedLogPath(config, parsed)
	if logPath != "" {
		task.addLog("托管启动日志：" + logPath)
	}
	out, err := startManagedCCConnectRuntime(ctx, "install")
	if err != nil {
		if logPath != "" {
			if detail := strings.TrimSpace(tailFile(logPath, 8192)); detail != "" {
				task.addLog("托管启动失败日志：\n" + detail)
			}
		}
		return err
	}
	if out != nil {
		task.addLog(fmt.Sprintf("CC-Connect 托管运行时已启动：PID %d", out.Body.PID))
		if out.Body.LogPath != "" {
			task.addLog("运行日志：" + out.Body.LogPath)
		}
		return nil
	}
	task.addLog("CC-Connect 托管运行时启动请求已完成。")
	if config.Path != "" {
		task.addLog("配置文件：" + config.Path)
	}
	return nil
}

func cleanupCCConnectInstallCache(ctx context.Context, task ccConnectTaskLogger) error {
	_ = ctx
	invalidateCCConnectEnvironmentCache()
	task.addLog("已刷新 CC-Connect 环境缓存。")
	return nil
}

func fetchCCConnectModelInitialization(ctx context.Context, sourceURL string) (ccConnectModelInitializationPayload, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return ccConnectModelInitializationPayload{}, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return ccConnectModelInitializationPayload{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ccConnectModelInitializationPayload{}, fmt.Errorf("model initialization endpoint returned %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return ccConnectModelInitializationPayload{}, err
	}
	var payload ccConnectModelInitializationPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return ccConnectModelInitializationPayload{}, err
	}
	if strings.TrimSpace(payload.ProviderKey) == "" || strings.TrimSpace(payload.DefaultModel.ID) == "" {
		return ccConnectModelInitializationPayload{}, fmt.Errorf("model initialization payload is incomplete")
	}
	return payload, nil
}

func fallbackCCConnectModelInitialization() ccConnectModelInitializationPayload {
	return ccConnectModelInitializationPayload{
		API:         "chat_completions",
		BaseURL:     "https://openrouter.ai/api/v1",
		DefaultKey:  "",
		ProviderKey: "openrouter",
		DefaultModel: ccConnectInitializationModel{
			ID:   "openai/gpt-5.5",
			Name: "GPT-5.5",
		},
	}
}

func ccConnectProviderFromInitialization(payload ccConnectModelInitializationPayload) CCConnectModelProviderConfig {
	models := []CCConnectProviderModelConfig{{Model: payload.DefaultModel.ID}}
	for _, model := range payload.FallbackModels {
		if strings.TrimSpace(model.ID) != "" {
			models = append(models, CCConnectProviderModelConfig{Model: model.ID})
		}
	}
	return CCConnectModelProviderConfig{
		Name:    payload.ProviderKey,
		APIKey:  payload.DefaultKey,
		BaseURL: payload.BaseURL,
		Model:   payload.DefaultModel.ID,
		Models:  models,
	}
}

func writeCCConnectInstallDocument(path string, doc map[string]any) error {
	content, err := encodeCCConnectConfigDocument(doc)
	if err != nil {
		return fmt.Errorf("encode cc-connect config: %w", err)
	}
	if err := validateCCConnectTOML(content); err != nil {
		return fmt.Errorf("encoded cc-connect config is invalid: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return fmt.Errorf("write cc-connect config: %w", err)
	}
	return nil
}

func firstCCConnectProviderName(doc map[string]any) string {
	providers := parseCCConnectModelProviders(configList(doc["providers"]))
	if len(providers) == 0 {
		return ""
	}
	return providers[0].Name
}

func firstCCConnectProviderModel(doc map[string]any, providerName string) string {
	providers := parseCCConnectModelProviders(configList(doc["providers"]))
	for _, provider := range providers {
		if provider.Name == providerName {
			return provider.Model
		}
	}
	return ""
}

func optionalCCConnectProviderRefs(providerName string) []string {
	if strings.TrimSpace(providerName) == "" {
		return nil
	}
	return []string{providerName}
}

func ensureCCConnectInstallConfig(doc map[string]any) bool {
	changed := false
	if strings.TrimSpace(stringFromConfigMap(doc, "language")) == "" {
		doc["language"] = "zh"
		changed = true
	}
	if strings.TrimSpace(stringFromConfigMap(doc, "data_dir")) == "" {
		doc["data_dir"] = defaultCCConnectDataDir()
		changed = true
	}
	if strings.TrimSpace(stringFromConfigMap(doc, "attachment_send")) == "" {
		doc["attachment_send"] = "on"
		changed = true
	}

	logSection := ccConnectConfigMap(doc, "log", true)
	if strings.TrimSpace(stringFromConfigMap(logSection, "level")) == "" {
		logSection["level"] = "info"
		changed = true
	}

	management := ccConnectConfigMap(doc, "management", true)
	if !boolFromConfigMap(management, "enabled", false) {
		management["enabled"] = true
		changed = true
	}
	if intFromConfigMap(management, "port", 0) == 0 {
		management["port"] = 9820
		changed = true
	}
	if strings.TrimSpace(stringFromConfigMap(management, "token")) == "" {
		management["token"] = randomCCConnectToken()
		changed = true
	}
	if _, ok := management["cors_origins"]; !ok {
		management["cors_origins"] = []string{"http://127.0.0.1:*", "http://localhost:*"}
		changed = true
	}

	bridge := ccConnectConfigMap(doc, "bridge", true)
	if intFromConfigMap(bridge, "port", 0) == 0 {
		bridge["port"] = 9810
		changed = true
	}
	if strings.TrimSpace(stringFromConfigMap(bridge, "path")) == "" {
		bridge["path"] = "/bridge/ws"
		changed = true
	}
	if strings.TrimSpace(stringFromConfigMap(bridge, "token")) == "" {
		bridge["token"] = randomCCConnectToken()
		changed = true
	}

	return changed
}

func ccConnectInstallCommandOutput(ctx context.Context, path string, args ...string) string {
	stdout, stderr, err := runCCConnectCommand(ctx, path, 5*time.Second, args...)
	line := firstNonEmptyLine(stdout, stderr)
	if line != "" {
		return line
	}
	if err != nil {
		return err.Error()
	}
	return "detected"
}

func randomCCConnectToken() string {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("agent-box-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}
