package openclaw

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
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
)

type OpenClawInstallStreamInput struct{}

const openClawNPMFallbackRegistry = "https://registry.npmmirror.com/"

func InstallOpenClawStream(ctx context.Context, input *OpenClawInstallStreamInput, send sse.Sender) {
	steps := []openClawChannelStep{
		{label: "检查安装前置条件", progress: 8, timeout: 10 * time.Second, run: runOpenClawInstallPrerequisiteCheck},
		{label: "执行 OpenClaw 官方安装脚本（不运行新手引导）", progress: 42, timeout: 15 * time.Minute, run: runOpenClawOfficialInstallScript},
		{label: "验证 OpenClaw CLI", progress: 68, timeout: 20 * time.Second, run: runOpenClawInstallVersionCheck},
		{label: "初始化 OpenClaw 配置与 Gateway", progress: 78, timeout: 5 * time.Minute, run: runOpenClawInstallOnboardDaemon},
		{label: "自动配置 Control UI 本机白名单", progress: 80, timeout: 20 * time.Second, run: runOpenClawInstallAllowedOrigins},
		{label: "初始化 Device Key", progress: 82, timeout: 15 * time.Second, run: runOpenClawInstallDeviceKey},
		{label: "初始化基础模型配置", progress: 88, timeout: 45 * time.Second, run: runOpenClawInstallModelInitialization},
		{label: "启用跳过 Control UI 设备配对", progress: 90, timeout: 1 * time.Minute, run: runOpenClawInstallControlUIDeviceAuthBypass},
		{label: "运行 OpenClaw doctor", progress: 92, timeout: 2 * time.Minute, run: runOpenClawInstallDoctorCheck},
		{label: "检查 Gateway 状态", progress: 94, timeout: 30 * time.Second, run: runOpenClawInstallGatewayStatusCheck},
		{label: "自动审批 AgentBox 控制端设备", progress: 96, timeout: 30 * time.Second, run: runOpenClawInstallAutoApproveGatewayDevices},
		{label: "刷新本机服务状态缓存", progress: 98, timeout: 15 * time.Second, run: runOpenClawInstallCleanup},
	}
	streamOpenClawChannelSteps(ctx, send, "openclaw-install", "install", steps)
}

func runOpenClawInstallPrerequisiteCheck(ctx context.Context, task openClawChannelLogger) error {
	nodePath := toolenv.ResolveToolPath("node")
	npmPath := toolenv.ResolveToolPath("npm")
	gitPath := toolenv.ResolveToolPath("git")
	xcodeToolsReady := runtime.GOOS != "darwin" || openClawXcodeCommandLineToolsPath(ctx) != ""
	if nodePath == "" {
		task.addLog("未检测到 Node.js。建议安装 Node.js 24。")
	} else {
		task.addLog("Node.js: " + firstLine(commandOutput(ctx, nodePath, "--version")) + " (" + nodePath + ")")
	}
	if npmPath == "" {
		task.addLog("未检测到 npm。")
	} else {
		task.addLog("npm: " + firstLine(commandOutput(ctx, npmPath, "--version")) + " (" + npmPath + ")")
	}
	if gitPath == "" {
		task.addLog("未检测到 Git。部分安装和插件能力可能不可用。")
	} else if runtime.GOOS == "darwin" && openClawIsMacOSDeveloperToolStub(gitPath) && !xcodeToolsReady {
		task.addLog("Git 依赖 Xcode Command Line Tools，当前尚未安装。")
	} else {
		task.addLog("Git: " + firstLine(commandOutput(ctx, gitPath, "--version")) + " (" + gitPath + ")")
	}
	if runtime.GOOS == "windows" {
		if openClawWindowsElevated(ctx) {
			task.addLog("Windows 管理员权限：已启用。")
		} else {
			task.addLog("Windows 管理员权限：未启用，将跳过 Gateway daemon 安装。")
		}
	}
	if runtime.GOOS == "darwin" {
		if xcodeToolsReady {
			task.addLog("Xcode Command Line Tools: " + openClawXcodeCommandLineToolsPath(ctx))
		} else {
			task.addLog("未检测到 Xcode Command Line Tools（macOS 必需）。")
			return errors.New("macOS 安装 OpenClaw 需要先安装 Xcode Command Line Tools")
		}
		if brewPath := toolenv.ResolveHomebrewPath(); brewPath != "" {
			task.addLog("Homebrew: " + firstLine(commandOutput(ctx, brewPath, "--version")) + " (" + brewPath + ")")
		} else {
			task.addLog("未检测到 Homebrew（macOS 必需）。")
			return errors.New("macOS 安装 OpenClaw 需要先安装 Homebrew")
		}
	}
	if npmPath == "" && runtime.GOOS != "windows" {
		task.addLog("官方安装脚本会尝试处理依赖；如果你自行管理 Node，请先安装 Node.js 24 和 npm 11。")
	}
	return nil
}

func openClawXcodeCommandLineToolsPath(ctx context.Context) string {
	xcodePath := toolenv.ResolveToolPath("xcode-select")
	if xcodePath == "" {
		return ""
	}
	return strings.TrimSpace(commandOutput(ctx, xcodePath, "-p"))
}

func openClawIsMacOSDeveloperToolStub(path string) bool {
	return filepath.Clean(path) == "/usr/bin/git"
}

func runOpenClawOfficialInstallScript(ctx context.Context, task openClawChannelLogger) error {
	if err := ensureOpenClawNPMRegistryAvailable(ctx, task); err != nil {
		return err
	}
	if runtime.GOOS == "windows" {
		task.addLog("执行 Windows 官方安装脚本：install.ps1 -NoOnboard")
		return runOpenClawExternalStreamingCommand(ctx, 15*time.Minute, task.addLog, "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "& ([scriptblock]::Create((iwr -useb https://openclaw.ai/install.ps1))) -NoOnboard")
	}
	task.addLog("执行 curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard")
	return runOpenClawExternalStreamingCommand(ctx, 15*time.Minute, task.addLog, "bash", "-lc", "curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard")
}

func ensureOpenClawNPMRegistryAvailable(ctx context.Context, task openClawChannelLogger) error {
	npmPath := toolenv.ResolveToolPath("npm")
	if npmPath == "" {
		task.addLog("未检测到 npm，跳过 npm registry 预检。")
		return nil
	}

	currentRegistry := strings.TrimSpace(commandOutput(ctx, npmPath, "config", "get", "registry"))
	if currentRegistry == "" || currentRegistry == "undefined" || currentRegistry == "null" {
		currentRegistry = "https://registry.npmjs.org/"
	}
	task.addLog("检查 npm registry：" + currentRegistry)
	if version, err := openClawNPMViewVersion(ctx, npmPath, currentRegistry); err == nil {
		task.addLog("当前 npm registry 可用，openclaw 最新版本：" + firstLine(version))
		return nil
	} else {
		task.addLog("当前 npm registry 不可用，准备切换到淘宝源：" + err.Error())
	}

	if version, err := openClawNPMViewVersion(ctx, npmPath, openClawNPMFallbackRegistry); err != nil {
		return fmt.Errorf("淘宝 npm registry 也不可用: %w", err)
	} else {
		task.addLog("淘宝 npm registry 可用，openclaw 最新版本：" + firstLine(version))
	}

	if err := setOpenClawNPMRegistry(ctx, npmPath, openClawNPMFallbackRegistry, true); err == nil {
		task.addLog("已切换全局 npm registry：" + openClawNPMFallbackRegistry)
		return nil
	} else {
		task.addLog("切换全局 npm registry 失败，改写当前用户 npm 配置：" + err.Error())
	}

	if err := setOpenClawNPMRegistry(ctx, npmPath, openClawNPMFallbackRegistry, false); err != nil {
		return fmt.Errorf("切换 npm registry 失败: %w", err)
	}
	task.addLog("已切换当前用户 npm registry：" + openClawNPMFallbackRegistry)
	return nil
}

func openClawNPMViewVersion(ctx context.Context, npmPath string, registry string) (string, error) {
	stdout, stderr, err := runOpenClawCapturedCommand(ctx, 20*time.Second, npmPath, "view", "openclaw", "version", "--registry", registry, "--loglevel", "error", "--fetch-retries", "1", "--fetch-timeout", "10000")
	if err != nil {
		output := strings.TrimSpace(stderr)
		if output == "" {
			output = strings.TrimSpace(stdout)
		}
		if output == "" {
			output = err.Error()
		}
		return "", errors.New(output)
	}
	version := strings.TrimSpace(stdout)
	if version == "" {
		return "", errors.New("npm view openclaw version returned empty output")
	}
	return version, nil
}

func setOpenClawNPMRegistry(ctx context.Context, npmPath string, registry string, global bool) error {
	args := []string{"config", "set", "registry", registry}
	if global {
		args = append(args, "--global")
	}
	stdout, stderr, err := runOpenClawCapturedCommand(ctx, 20*time.Second, npmPath, args...)
	if err != nil {
		output := strings.TrimSpace(strings.Join([]string{stderr, stdout, err.Error()}, "\n"))
		return errors.New(output)
	}
	return nil
}

func runOpenClawCapturedCommand(ctx context.Context, timeout time.Duration, name string, args ...string) (string, string, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	path := toolenv.ResolveToolPath(name)
	if path == "" {
		path = name
	}
	cmd := exec.CommandContext(cmdCtx, path, args...)
	cmd.Env = toolenv.CommandEnv()
	var stdout strings.Builder
	var stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if cmdCtx.Err() != nil {
		return stdout.String(), stderr.String(), cmdCtx.Err()
	}
	return stdout.String(), stderr.String(), err
}

func runOpenClawInstallVersionCheck(ctx context.Context, task openClawChannelLogger) error {
	task.addLog("执行 openclaw --version")
	return runOpenClawStreamingCommandOnly(ctx, 20*time.Second, task.addLog, "--version")
}

func runOpenClawInstallOnboardDaemon(ctx context.Context, task openClawChannelLogger) error {
	args := []string{
		"onboard",
		"--non-interactive",
		"--accept-risk",
		"--mode",
		"local",
		"--auth-choice",
		"skip",
		"--skip-channels",
		"--skip-skills",
		"--skip-search",
		"--skip-ui",
	}
	if openClawGatewayDaemonInstallAvailable(ctx) {
		args = append(args[:7], append([]string{"--install-daemon"}, args[7:]...)...)
	} else {
		task.addLog(openClawGatewayDaemonUnavailableMessage())
		args = append(args, "--skip-health")
	}
	task.addLog("执行 openclaw " + strings.Join(args, " "))
	return runOpenClawStreamingCommandOnly(ctx, 5*time.Minute, task.addLog, args...)
}

type openClawDeviceIdentityFile struct {
	Version       int    `json:"version"`
	DeviceID      string `json:"deviceId"`
	PublicKeyPEM  string `json:"publicKeyPem"`
	PrivateKeyPEM string `json:"privateKeyPem"`
	CreatedAtMs   int64  `json:"createdAtMs"`
}

func openClawDeviceKeyPath() string {
	return filepath.Join(defaultOpenClawHomeDir(), "identity", "device.json")
}

func runOpenClawInstallAllowedOrigins(ctx context.Context, task openClawChannelLogger) error {
	task.addLog("自动写入 Control UI 本机白名单。")
	changed, origins, err := ensureOpenClawControlUIAllowedOrigins("", "")
	if err != nil {
		return err
	}
	if changed {
		task.addLog(fmt.Sprintf("已更新 Control UI 白名单，共 %d 条。", len(origins)))
	} else {
		task.addLog("Control UI 白名单已是最新。")
	}
	return nil
}

func runOpenClawInstallDeviceKey(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	deviceKeyPath := openClawDeviceKeyPath()
	if fileExists(deviceKeyPath) {
		task.addLog("Device Key 已存在：" + deviceKeyPath)
		return nil
	}

	identity, err := generateOpenClawDeviceIdentity(time.Now())
	if err != nil {
		return err
	}
	if err := writeOpenClawDeviceIdentityFile(deviceKeyPath, identity); err != nil {
		return err
	}
	task.addLog("已生成官方 Device Key：" + deviceKeyPath)
	task.addLog("Device ID：" + identity.DeviceID)
	return nil
}

func generateOpenClawDeviceIdentity(now time.Time) (openClawDeviceIdentityFile, error) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return openClawDeviceIdentityFile{}, fmt.Errorf("generate device key: %w", err)
	}
	publicDER, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		return openClawDeviceIdentityFile{}, fmt.Errorf("encode device public key: %w", err)
	}
	privateDER, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return openClawDeviceIdentityFile{}, fmt.Errorf("encode device private key: %w", err)
	}
	fingerprint := sha256.Sum256(publicKey)
	return openClawDeviceIdentityFile{
		Version:       1,
		DeviceID:      hex.EncodeToString(fingerprint[:]),
		PublicKeyPEM:  string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER})),
		PrivateKeyPEM: string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privateDER})),
		CreatedAtMs:   now.UnixMilli(),
	}, nil
}

func writeOpenClawDeviceIdentityFile(deviceKeyPath string, identity openClawDeviceIdentityFile) error {
	formatted, err := json.MarshalIndent(identity, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(deviceKeyPath), 0o700); err != nil {
		return err
	}
	return os.WriteFile(deviceKeyPath, append(formatted, '\n'), 0o600)
}

type openClawModelInitializationPayload struct {
	API            string                        `json:"api"`
	BaseURL        string                        `json:"baseUrl"`
	DefaultKey     string                        `json:"defaultKey"`
	DefaultModel   openClawInitializationModel   `json:"defaultModel"`
	FallbackModels []openClawInitializationModel `json:"fallbackModels"`
	ProviderKey    string                        `json:"providerKey"`
}

type openClawInitializationModel struct {
	ContextWindow int    `json:"contextWindow"`
	ID            string `json:"id"`
	MaxTokens     int    `json:"maxTokens"`
	Name          string `json:"name"`
	Reasoning     bool   `json:"reasoning"`
	Vision        bool   `json:"vision"`
}

func runOpenClawInstallModelInitialization(ctx context.Context, task openClawChannelLogger) error {
	sourceURL := config.Current().ModelInitializationURL
	task.addLog("获取基础模型配置：" + sourceURL)
	payload, err := fetchOpenClawModelInitialization(ctx, sourceURL)
	if err != nil {
		task.addLog("基础模型配置暂不可用，跳过模型初始化：" + err.Error())
		return nil
	}

	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			content = map[string]any{}
		} else {
			return fmt.Errorf("read openclaw config: %w", err)
		}
	}

	providerKey := strings.TrimSpace(payload.ProviderKey)
	if providerKey == "" {
		task.addLog("基础模型配置缺少 providerKey，跳过模型初始化。")
		return nil
	}
	defaultModelID := strings.TrimSpace(payload.DefaultModel.ID)
	if defaultModelID == "" {
		task.addLog("基础模型配置缺少 defaultModel.id，跳过模型初始化。")
		return nil
	}

	applyOpenClawModelInitialization(content, payload)
	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return fmt.Errorf("write openclaw config: %w", err)
	}

	modelCount := len(mergeOpenClawInitializationModels(payload.DefaultModel, payload.FallbackModels))
	task.addLog(fmt.Sprintf("已写入基础模型 Provider：%s（%d 个模型）", providerKey, modelCount))
	task.addLog("默认主模型：" + providerKey + "/" + defaultModelID)
	return nil
}

func runOpenClawInstallControlUIDeviceAuthBypass(ctx context.Context, task openClawChannelLogger) error {
	task.addLog("启用跳过 Control UI 设备配对。")
	changed, err := ensureOpenClawControlUIDeviceAuthDisabled()
	if err != nil {
		return fmt.Errorf("enable Control UI device auth bypass: %w", err)
	}
	if changed {
		task.addLog("已写入 gateway.controlUi.dangerouslyDisableDeviceAuth = true。")
	} else {
		task.addLog("Control UI 设备配对跳过配置已启用。")
	}

	task.addLog("重启 Gateway 让 Control UI 配对配置和模型配置立即生效。")
	if !openClawGatewayDaemonInstallAvailable(ctx) {
		if openClawRunningInContainer() {
			task.addLog("检测到容器环境，写入 gateway.bind = lan 并直接启动前台 Gateway 进程。")
			if changed, err := ensureOpenClawContainerGatewayConfig(); err != nil {
				return fmt.Errorf("update container gateway config: %w", err)
			} else if changed {
				task.addLog("已更新容器 Gateway 监听配置。")
			}
		}
		task.addLog("Gateway daemon 不可用，改用直接进程启动 Gateway。")
		return ensureOpenClawGatewayProcessForInstall(ctx, task)
	}
	output, err := RestartOpenClawGateway(ctx, nil)
	if err != nil {
		if !openClawGatewayDaemonInstallAvailable(ctx) {
			task.addLog("Gateway daemon 不可用，改用直接进程启动 Gateway：" + err.Error())
			return ensureOpenClawGatewayProcessForInstall(ctx, task)
		}
		return fmt.Errorf("restart gateway after enabling Control UI device auth bypass: %w", err)
	}
	if message := strings.TrimSpace(output.Body.Message); message != "" {
		task.addLog(message)
	}
	addOpenClawInstallOutputLines(task, output.Body.Stdout)
	addOpenClawInstallOutputLines(task, output.Body.Stderr)
	return nil
}

func addOpenClawInstallOutputLines(task openClawChannelLogger, value string) {
	for _, line := range strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			task.addLog(line)
		}
	}
}

func fetchOpenClawModelInitialization(ctx context.Context, sourceURL string) (openClawModelInitializationPayload, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return openClawModelInitializationPayload{}, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return openClawModelInitializationPayload{}, fmt.Errorf("fetch model initialization: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return openClawModelInitializationPayload{}, fmt.Errorf("model initialization endpoint returned %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return openClawModelInitializationPayload{}, fmt.Errorf("read model initialization response: %w", err)
	}

	var payload openClawModelInitializationPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return openClawModelInitializationPayload{}, fmt.Errorf("parse model initialization response: %w", err)
	}
	if strings.TrimSpace(payload.ProviderKey) == "" {
		return openClawModelInitializationPayload{}, errors.New("model initialization providerKey is empty")
	}
	if strings.TrimSpace(payload.BaseURL) == "" {
		return openClawModelInitializationPayload{}, errors.New("model initialization baseUrl is empty")
	}
	if strings.TrimSpace(payload.API) == "" {
		return openClawModelInitializationPayload{}, errors.New("model initialization api is empty")
	}
	if strings.TrimSpace(payload.DefaultModel.ID) == "" {
		return openClawModelInitializationPayload{}, errors.New("model initialization defaultModel.id is empty")
	}
	return payload, nil
}

func applyOpenClawModelInitialization(content map[string]any, payload openClawModelInitializationPayload) {
	models := objectMap(content["models"])
	if strings.TrimSpace(stringFromMap(models, "mode")) == "" {
		models["mode"] = "merge"
	}
	providers := objectMap(models["providers"])
	providerKey := strings.TrimSpace(payload.ProviderKey)
	providers[providerKey] = map[string]any{
		"api":     strings.TrimSpace(payload.API),
		"apiKey":  strings.TrimSpace(payload.DefaultKey),
		"baseUrl": strings.TrimSpace(payload.BaseURL),
		"models":  openClawInitializationModelMaps(mergeOpenClawInitializationModels(payload.DefaultModel, payload.FallbackModels)),
	}
	models["providers"] = providers
	content["models"] = models

	agents := objectMap(content["agents"])
	defaults := objectMap(agents["defaults"])
	defaults["model"] = map[string]any{
		"primary":   providerKey + "/" + strings.TrimSpace(payload.DefaultModel.ID),
		"fallbacks": openClawInitializationFallbackRefs(providerKey, payload.DefaultModel.ID, payload.FallbackModels),
	}
	agents["defaults"] = defaults
	content["agents"] = agents
}

func mergeOpenClawInitializationModels(defaultModel openClawInitializationModel, fallbackModels []openClawInitializationModel) []openClawInitializationModel {
	seen := map[string]bool{}
	models := make([]openClawInitializationModel, 0, 1+len(fallbackModels))
	for _, model := range append([]openClawInitializationModel{defaultModel}, fallbackModels...) {
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

func openClawInitializationModelMaps(models []openClawInitializationModel) []any {
	result := make([]any, 0, len(models))
	for _, model := range models {
		item := map[string]any{
			"id":    strings.TrimSpace(model.ID),
			"input": []string{"text"},
		}
		if strings.TrimSpace(model.Name) != "" {
			item["name"] = strings.TrimSpace(model.Name)
		}
		if model.ContextWindow > 0 {
			item["contextWindow"] = model.ContextWindow
		}
		if model.MaxTokens > 0 {
			item["maxTokens"] = model.MaxTokens
		}
		if model.Reasoning {
			item["reasoning"] = true
		}
		if model.Vision {
			item["input"] = []string{"text", "image"}
		}
		result = append(result, item)
	}
	return result
}

func openClawInitializationFallbackRefs(providerKey string, defaultModelID string, fallbackModels []openClawInitializationModel) []string {
	primary := strings.TrimSpace(defaultModelID)
	seen := map[string]bool{}
	result := make([]string, 0, len(fallbackModels))
	for _, model := range fallbackModels {
		id := strings.TrimSpace(model.ID)
		if id == "" || id == primary || seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, providerKey+"/"+id)
	}
	return result
}

func runOpenClawInstallDoctorCheck(ctx context.Context, task openClawChannelLogger) error {
	task.addLog("执行 openclaw doctor")
	return runOpenClawStreamingCommandOnly(ctx, 2*time.Minute, task.addLog, "doctor")
}

func runOpenClawInstallGatewayStatusCheck(ctx context.Context, task openClawChannelLogger) error {
	if openClawRunningInContainer() {
		task.addLog("容器环境跳过 systemd Gateway 状态检查，改用端口探测。")
		return ensureOpenClawGatewayProcessForInstall(ctx, task)
	}

	task.addLog("执行 openclaw gateway status")
	err := runOpenClawStreamingCommandOnly(ctx, 30*time.Second, task.addLog, "gateway", "status")
	if err != nil {
		task.addLog("Gateway 状态检查未通过，尝试修复 Gateway 服务。")
	} else {
		environment := detectOpenClawEnvironment(ctx)
		if environment.Gateway.TCPReachable {
			return nil
		}
		task.addLog("Gateway 服务已加载但端口尚未监听，尝试修复 Gateway 服务。")
	}
	return repairOpenClawGatewayForInstall(ctx, task)
}

func ensureOpenClawContainerGatewayConfig() (bool, error) {
	configPath := openClawConfigPath()
	content, exists, err := readOpenClawConfigFile(configPath)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return false, err
		}
		content = map[string]any{}
	}
	if !exists || content == nil {
		content = map[string]any{}
	}

	gateway := ensureMapValue(content, "gateway")
	changed := false
	if strings.TrimSpace(stringFromMap(gateway, "bind")) != "lan" {
		gateway["bind"] = "lan"
		changed = true
	}
	if portString := strings.TrimSpace(stringFromMap(gateway, "port")); portString == "" {
		gateway["port"] = 18789
		changed = true
	}
	if mode := strings.TrimSpace(stringFromMap(gateway, "mode")); mode == "" {
		gateway["mode"] = "local"
		changed = true
	}

	if !changed {
		return false, nil
	}
	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return false, err
	}
	invalidateOpenClawEnvironmentCache()
	return true, nil
}

func runOpenClawInstallAutoApproveGatewayDevices(ctx context.Context, task openClawChannelLogger) error {
	task.addLog("检查并自动审批 AgentBox 控制端 Gateway 设备。")
	result, err := autoApproveOpenClawGatewayDevices(ctx, task.addLog)
	if err != nil {
		task.addLog("Gateway 设备自动审批暂时不可用，安装继续完成：" + err.Error())
		task.addLog("稍后可在 OpenClaw 服务管理页刷新 Gateway 状态并重试自动审批。")
		return nil
	}
	if result.Approved > 0 {
		task.addLog(fmt.Sprintf("已自动审批 %d 个 Gateway 设备请求。", result.Approved))
	}
	if result.Skipped > 0 {
		task.addLog(fmt.Sprintf("已跳过 %d 个非自动审批范围的 Gateway 设备请求。", result.Skipped))
	}
	return nil
}

func repairOpenClawGatewayForInstall(ctx context.Context, task openClawChannelLogger) error {
	environment := detectOpenClawEnvironment(ctx)
	port := environment.Gateway.Port
	if port <= 0 {
		port = 18789
	}
	if waitGatewayReachable(ctx, port, 8*time.Second) {
		task.addLog("Gateway 已开始监听端口。")
		return nil
	}

	task.addLog("执行 openclaw gateway restart")
	restartErr := runOpenClawStreamingCommandOnly(ctx, 45*time.Second, task.addLog, "gateway", "restart")
	if restartErr == nil && waitGatewayReachable(ctx, port, 12*time.Second) {
		task.addLog("Gateway 重启后已开始监听端口。")
		return nil
	}
	if restartErr != nil {
		task.addLog("Gateway restart 未完成：" + restartErr.Error())
	}
	if !openClawGatewayDaemonInstallAvailable(ctx) {
		return ensureOpenClawGatewayProcessForInstall(ctx, task)
	}

	task.addLog("执行 openclaw gateway install --force")
	installErr := runOpenClawStreamingCommandOnly(ctx, 60*time.Second, task.addLog, "gateway", "install", "--force")
	if installErr == nil && waitGatewayReachable(ctx, port, 15*time.Second) {
		task.addLog("Gateway 服务重装后已开始监听端口。")
		return nil
	}
	if installErr != nil {
		task.addLog("Gateway install --force 未完成：" + installErr.Error())
	}
	if waitGatewayReachable(ctx, port, 3*time.Second) {
		task.addLog("Gateway 已开始监听端口。")
		return nil
	}
	return errors.New("Gateway 服务已安装但端口仍未监听，请稍后在服务管理页重启 Gateway")
}

func ensureOpenClawGatewayProcessForInstall(ctx context.Context, task openClawChannelLogger) error {
	environment := detectOpenClawEnvironment(ctx)
	port := environment.Gateway.Port
	if port <= 0 {
		port = 18789
	}
	if waitGatewayReachable(ctx, port, 3*time.Second) {
		task.addLog("Gateway 已开始监听端口。")
		return nil
	}
	logsDir := environment.Home.LogsDir
	if strings.TrimSpace(logsDir) == "" {
		logsDir = filepath.Join(defaultOpenClawHomeDir(), "logs")
	}
	task.addLog("执行 openclaw gateway run（后台进程）")
	if err := startDetachedOpenClawGateway(logsDir, port); err != nil {
		return fmt.Errorf("start gateway process: %w", err)
	}
	if waitGatewayReachable(ctx, port, 12*time.Second) {
		task.addLog("Gateway 进程已开始监听端口。")
		return nil
	}
	return errors.New("Gateway 进程启动后端口仍未监听，请稍后在服务管理页重试")
}

func openClawGatewayDaemonInstallAvailable(ctx context.Context) bool {
	switch runtime.GOOS {
	case "windows":
		return openClawWindowsElevated(ctx)
	case "linux":
		if openClawRunningInContainer() {
			return false
		}
	default:
		return true
	}

	systemctlPath := toolenv.ResolveToolPath("systemctl")
	if systemctlPath == "" {
		return false
	}
	cmdCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, systemctlPath, "--user", "show-environment")
	cmd.Env = toolenv.CommandEnv()
	return cmd.Run() == nil
}

func openClawGatewayDaemonUnavailableMessage() string {
	switch runtime.GOOS {
	case "windows":
		return "当前 Windows 进程不是管理员权限，跳过 Gateway daemon 安装，后续使用 AgentBox 直接进程启动 Gateway。"
	case "linux":
		return "当前 Linux 会话不支持 systemd user services，跳过 Gateway daemon 安装，后续使用直接进程启动 Gateway。"
	default:
		return "当前环境不支持 Gateway daemon 安装，后续使用直接进程启动 Gateway。"
	}
}

func openClawWindowsElevated(ctx context.Context) bool {
	if runtime.GOOS != "windows" {
		return false
	}
	cmdCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, "net", "session")
	cmd.Env = toolenv.CommandEnv()
	return cmd.Run() == nil
}

func openClawRunningInContainer() bool {
	if fileExists("/.dockerenv") || fileExists("/run/.containerenv") {
		return true
	}
	for _, path := range []string{"/proc/1/cgroup", "/proc/self/cgroup"} {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		lower := strings.ToLower(string(data))
		if strings.Contains(lower, "docker") ||
			strings.Contains(lower, "kubepods") ||
			strings.Contains(lower, "containerd") ||
			strings.Contains(lower, "podman") ||
			strings.Contains(lower, "libpod") {
			return true
		}
	}
	return false
}

func runOpenClawInstallCleanup(ctx context.Context, task openClawChannelLogger) error {
	invalidateOpenClawEnvironmentCache()
	invalidateOpenClawCLIVersionCache()
	invalidateOpenClawUpdateStatusCache()
	invalidateOpenClawPluginsStatusCache()
	task.addLog("已刷新 OpenClaw 环境、更新和插件缓存。")
	return nil
}
