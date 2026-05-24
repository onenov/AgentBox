package ccconnect

// CC-Connect 配置接口提供两层编辑能力：
// 1. 原始 config.toml 读写，用于高级配置和完整文件编辑。
// 2. 基础配置结构化读写，用于 Dashboard 表单编辑常用全局项；敏感 token 只返回是否存在。

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/danielgtaylor/huma/v2"
)

type CCConnectTextFileOutput struct {
	Body CCConnectTextFileResponse
}

type CCConnectTextFileInput struct {
	Body CCConnectTextFileRequest
}

type CCConnectTextFileResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-18T10:30:00Z" doc:"UTC response timestamp."`
	Path      string `json:"path" example:"/Users/one/.cc-connect/config.toml" doc:"File path."`
	Exists    bool   `json:"exists" example:"true" doc:"Whether the file exists."`
	Content   string `json:"content" doc:"Raw TOML file content."`
}

type CCConnectTextFileRequest struct {
	Content string `json:"content" doc:"Raw TOML file content to write."`
}

type CCConnectBasicConfigOutput struct {
	Body CCConnectBasicConfigResponse
}

type CCConnectBasicConfigInput struct {
	Body CCConnectBasicConfigRequest
}

type CCConnectModelsConfigOutput struct {
	Body CCConnectModelsConfigResponse
}

type CCConnectModelsConfigInput struct {
	Body CCConnectModelsConfigRequest
}

type CCConnectProjectsConfigOutput struct {
	Body CCConnectProjectsConfigResponse
}

type CCConnectProjectsConfigInput struct {
	Body CCConnectProjectsConfigRequest
}

type CCConnectBasicConfigRequest struct {
	Config CCConnectBasicConfig `json:"config" doc:"Basic CC-Connect config fields to write."`
}

type CCConnectModelsConfigRequest struct {
	Config CCConnectModelsConfig `json:"config" doc:"CC-Connect model provider config fields to write."`
}

type CCConnectProjectsConfigRequest struct {
	Config CCConnectProjectsConfig `json:"config" doc:"CC-Connect project config fields to write."`
}

type CCConnectBasicConfigResponse struct {
	Status    string                      `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                      `json:"timestamp" example:"2026-05-18T10:30:00Z" doc:"UTC response timestamp."`
	Path      string                      `json:"path" example:"/Users/one/.cc-connect/config.toml" doc:"Resolved config.toml path."`
	Exists    bool                        `json:"exists" example:"true" doc:"Whether config.toml exists."`
	Config    CCConnectBasicConfig        `json:"config" doc:"Editable basic config values."`
	Summary   CCConnectConfigBasicSummary `json:"summary" doc:"Config counts parsed from config.toml."`
}

type CCConnectBasicConfig struct {
	Language           string                       `json:"language" example:"zh" doc:"Top-level language."`
	DataDir            string                       `json:"dataDir" example:"~/.cc-connect" doc:"Top-level data_dir. Empty means cc-connect default."`
	AttachmentSend     string                       `json:"attachmentSend" example:"on" doc:"Top-level attachment_send mode: on or off."`
	IdleTimeoutMins    int                          `json:"idleTimeoutMins" example:"30" doc:"Top-level idle_timeout_mins."`
	ProviderPresetsURL string                       `json:"providerPresetsUrl,omitempty" doc:"Top-level provider_presets_url."`
	BannedWords        []string                     `json:"bannedWords,omitempty" doc:"Top-level banned_words."`
	LogLevel           string                       `json:"logLevel" example:"info" doc:"log.level."`
	Display            CCConnectDisplayBasicConfig  `json:"display" doc:"display section."`
	StreamPreview      CCConnectStreamPreviewConfig `json:"streamPreview" doc:"stream_preview section."`
	RateLimit          CCConnectRateLimitConfig     `json:"rateLimit" doc:"rate_limit section."`
	OutgoingRateLimit  CCConnectRateLimitConfig     `json:"outgoingRateLimit" doc:"outgoing_rate_limit section."`
	Cron               CCConnectCronConfig          `json:"cron" doc:"cron section."`
	Webhook            CCConnectEndpointBasicConfig `json:"webhook" doc:"webhook section."`
	Bridge             CCConnectEndpointBasicConfig `json:"bridge" doc:"bridge section."`
	Management         CCConnectEndpointBasicConfig `json:"management" doc:"management section."`
}

type CCConnectDisplayBasicConfig struct {
	Mode             string `json:"mode" example:"compact" doc:"display.mode."`
	CardMode         string `json:"cardMode" example:"local" doc:"display.card_mode."`
	ThinkingMessages bool   `json:"thinkingMessages" example:"true" doc:"display.thinking_messages."`
	ThinkingMaxLen   int    `json:"thinkingMaxLen" example:"4000" doc:"display.thinking_max_len."`
	ToolMessages     bool   `json:"toolMessages" example:"true" doc:"display.tool_messages."`
	ToolMaxLen       int    `json:"toolMaxLen" example:"2000" doc:"display.tool_max_len."`
}

type CCConnectStreamPreviewConfig struct {
	Enabled       bool `json:"enabled" example:"true" doc:"stream_preview.enabled."`
	IntervalMs    int  `json:"intervalMs" example:"1200" doc:"stream_preview.interval_ms."`
	MinDeltaChars int  `json:"minDeltaChars" example:"80" doc:"stream_preview.min_delta_chars."`
	MaxChars      int  `json:"maxChars" example:"6000" doc:"stream_preview.max_chars."`
}

type CCConnectRateLimitConfig struct {
	MaxMessages int `json:"maxMessages" example:"20" doc:"max_messages."`
	WindowSecs  int `json:"windowSecs" example:"60" doc:"window_secs."`
}

type CCConnectCronConfig struct {
	Silent      bool   `json:"silent" example:"false" doc:"cron.silent."`
	SessionMode string `json:"sessionMode" example:"new" doc:"cron.session_mode."`
}

type CCConnectEndpointBasicConfig struct {
	Enabled     bool     `json:"enabled" example:"true" doc:"Whether the endpoint is enabled."`
	Port        int      `json:"port" example:"9820" doc:"Endpoint port."`
	Path        string   `json:"path,omitempty" example:"/bridge/ws" doc:"Endpoint path when supported."`
	CORSOrigins []string `json:"corsOrigins,omitempty" doc:"cors_origins entries."`
	Insecure    bool     `json:"insecure,omitempty" example:"false" doc:"bridge.insecure when supported."`
	Token       string   `json:"token,omitempty" doc:"Endpoint token. This is returned because config file editing already exposes the same local config secret."`
	TokenSet    bool     `json:"tokenSet" example:"true" doc:"Whether token exists."`
}

type CCConnectConfigBasicSummary struct {
	ProjectCount    int `json:"projectCount" example:"2" doc:"Configured project count."`
	ProviderCount   int `json:"providerCount" example:"3" doc:"Configured provider count."`
	PlatformCount   int `json:"platformCount" example:"2" doc:"Configured project platform count."`
	CommandCount    int `json:"commandCount" example:"1" doc:"Configured command count."`
	AliasCount      int `json:"aliasCount" example:"0" doc:"Configured alias count."`
	HookCount       int `json:"hookCount" example:"0" doc:"Configured hook count."`
	BannedWordCount int `json:"bannedWordCount" example:"0" doc:"Configured banned word count."`
}

type CCConnectModelsConfigResponse struct {
	Status    string                       `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                       `json:"timestamp" example:"2026-05-18T10:30:00Z" doc:"UTC response timestamp."`
	Path      string                       `json:"path" example:"/Users/one/.cc-connect/config.toml" doc:"Resolved config.toml path."`
	Exists    bool                         `json:"exists" example:"true" doc:"Whether config.toml exists."`
	Config    CCConnectModelsConfig        `json:"config" doc:"Editable model/provider config values."`
	Summary   CCConnectModelsConfigSummary `json:"summary" doc:"Model/provider counts parsed from config.toml."`
}

type CCConnectModelsConfig struct {
	ProviderPresetsURL string                         `json:"providerPresetsUrl,omitempty" doc:"Top-level provider_presets_url."`
	Providers          []CCConnectModelProviderConfig `json:"providers" doc:"Global [[providers]] entries."`
	Projects           []CCConnectProjectModelConfig  `json:"projects" doc:"Project agent model/provider bindings."`
}

type CCConnectModelsConfigSummary struct {
	ProviderCount       int `json:"providerCount" example:"3" doc:"Global provider count."`
	ProjectCount        int `json:"projectCount" example:"2" doc:"Project count."`
	InlineProviderCount int `json:"inlineProviderCount" example:"1" doc:"Inline project provider count."`
	ModelAliasCount     int `json:"modelAliasCount" example:"8" doc:"Configured provider model alias count."`
	ReferencedCount     int `json:"referencedCount" example:"2" doc:"Total provider_refs entries across projects."`
}

type CCConnectModelProviderConfig struct {
	Name            string                                    `json:"name" example:"minimaxi" doc:"Provider name."`
	APIKey          string                                    `json:"apiKey,omitempty" doc:"Provider API key. Returned because local raw config editing exposes the same secret."`
	APIKeySet       bool                                      `json:"apiKeySet" example:"true" doc:"Whether provider API key exists."`
	BaseURL         string                                    `json:"baseUrl,omitempty" example:"https://api.example.com/v1" doc:"Provider base URL."`
	Model           string                                    `json:"model,omitempty" example:"claude-sonnet-4-20250514" doc:"Provider default model."`
	Thinking        string                                    `json:"thinking,omitempty" example:"disabled" doc:"Provider thinking mode override."`
	AgentTypes      []string                                  `json:"agentTypes,omitempty" doc:"Optional supported agent types."`
	Models          []CCConnectProviderModelConfig            `json:"models,omitempty" doc:"Selectable model aliases."`
	Env             map[string]string                         `json:"env,omitempty" doc:"Provider environment variables."`
	Endpoints       map[string]string                         `json:"endpoints,omitempty" doc:"Per-agent-type base URL overrides."`
	AgentModels     map[string]string                         `json:"agentModels,omitempty" doc:"Per-agent-type default model overrides."`
	AgentModelLists map[string][]CCConnectProviderModelConfig `json:"agentModelLists,omitempty" doc:"Per-agent-type model alias lists."`
	Codex           *CCConnectCodexProviderConfig             `json:"codex,omitempty" doc:"Codex-specific provider config."`
}

type CCConnectProviderModelConfig struct {
	Model string `json:"model" example:"gpt-5.4" doc:"Model id."`
	Alias string `json:"alias,omitempty" example:"gpt" doc:"Optional short alias used by /model."`
}

type CCConnectCodexProviderConfig struct {
	EnvKey      string            `json:"envKey,omitempty" doc:"Codex env_key."`
	WireAPI     string            `json:"wireApi,omitempty" doc:"Codex wire_api."`
	HTTPHeaders map[string]string `json:"httpHeaders,omitempty" doc:"Codex HTTP headers."`
}

type CCConnectProjectModelConfig struct {
	Name            string                         `json:"name" example:"my-project" doc:"Project name."`
	AgentType       string                         `json:"agentType" example:"claudecode" doc:"Project agent type."`
	AgentModel      string                         `json:"agentModel,omitempty" example:"claude-sonnet-4-20250514" doc:"projects.agent.options.model."`
	ActiveProvider  string                         `json:"activeProvider,omitempty" example:"minimaxi" doc:"projects.agent.options.provider."`
	ProviderRefs    []string                       `json:"providerRefs,omitempty" doc:"Global provider names referenced by this project."`
	InlineProviders []CCConnectModelProviderConfig `json:"inlineProviders,omitempty" doc:"Inline [[projects.agent.providers]] entries."`
}

type CCConnectProjectsConfigResponse struct {
	Status    string                         `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                         `json:"timestamp" example:"2026-05-18T10:30:00Z" doc:"UTC response timestamp."`
	Path      string                         `json:"path" example:"/Users/one/.cc-connect/config.toml" doc:"Resolved config.toml path."`
	Exists    bool                           `json:"exists" example:"true" doc:"Whether config.toml exists."`
	Config    CCConnectProjectsConfig        `json:"config" doc:"Editable project config values."`
	Summary   CCConnectProjectsConfigSummary `json:"summary" doc:"Project counts parsed from config.toml."`
}

type CCConnectProjectsConfig struct {
	Projects []CCConnectProjectConfig `json:"projects" doc:"Configured [[projects]] entries."`
}

type CCConnectProjectsConfigSummary struct {
	ProjectCount  int            `json:"projectCount" example:"2" doc:"Project count."`
	PlatformCount int            `json:"platformCount" example:"2" doc:"Total project platform count."`
	AgentTypes    map[string]int `json:"agentTypes" doc:"Project count by agent type."`
	PlatformTypes map[string]int `json:"platformTypes" doc:"Platform count by platform type."`
}

type CCConnectProjectConfig struct {
	Name                   string                           `json:"name" example:"my-project" doc:"Project name."`
	ResetOnIdleMins        int                              `json:"resetOnIdleMins,omitempty" example:"30" doc:"reset_on_idle_mins."`
	RunAsUser              string                           `json:"runAsUser,omitempty" doc:"run_as_user."`
	RunAsEnv               []string                         `json:"runAsEnv,omitempty" doc:"run_as_env passthrough environment variable names."`
	ShowContextIndicator   bool                             `json:"showContextIndicator,omitempty" doc:"show_context_indicator."`
	ReplyFooter            bool                             `json:"replyFooter,omitempty" doc:"reply_footer."`
	InjectSender           bool                             `json:"injectSender,omitempty" doc:"inject_sender."`
	FilterExternalSessions bool                             `json:"filterExternalSessions,omitempty" doc:"filter_external_sessions."`
	AdminFrom              string                           `json:"adminFrom,omitempty" doc:"admin_from."`
	DisabledCommands       []string                         `json:"disabledCommands,omitempty" doc:"disabled_commands."`
	Agent                  CCConnectProjectAgentConfig      `json:"agent" doc:"[projects.agent] config."`
	Platforms              []CCConnectProjectPlatformConfig `json:"platforms" doc:"[[projects.platforms]] entries."`
}

type CCConnectProjectAgentConfig struct {
	Type             string            `json:"type" example:"claudecode" doc:"Agent type."`
	WorkDir          string            `json:"workDir,omitempty" example:"/path/to/project" doc:"projects.agent.options.work_dir."`
	Mode             string            `json:"mode,omitempty" example:"default" doc:"projects.agent.options.mode."`
	Model            string            `json:"model,omitempty" doc:"projects.agent.options.model."`
	Provider         string            `json:"provider,omitempty" doc:"projects.agent.options.provider."`
	ReasoningEffort  string            `json:"reasoningEffort,omitempty" doc:"projects.agent.options.reasoning_effort."`
	AllowedTools     []string          `json:"allowedTools,omitempty" doc:"projects.agent.options.allowed_tools."`
	DisallowedTools  []string          `json:"disallowedTools,omitempty" doc:"projects.agent.options.disallowed_tools."`
	SystemPrompt     string            `json:"systemPrompt,omitempty" doc:"projects.agent.options.system_prompt."`
	ProviderRefs     []string          `json:"providerRefs,omitempty" doc:"projects.agent.provider_refs."`
	Env              map[string]string `json:"env,omitempty" doc:"projects.agent.options.env."`
	AdditionalOption map[string]string `json:"additionalOptions,omitempty" doc:"String-valued agent options not rendered as first-class fields."`
}

type CCConnectProjectPlatformConfig struct {
	Type    string            `json:"type" example:"feishu" doc:"Platform type."`
	Options map[string]string `json:"options,omitempty" doc:"projects.platforms.options."`
}

func GetCCConnectConfig(ctx context.Context, input *struct{}) (*CCConnectTextFileOutput, error) {
	path, _ := resolveCCConnectConfigPath()
	content, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &CCConnectTextFileOutput{Body: CCConnectTextFileResponse{
				Status:    "missing",
				Timestamp: time.Now().UTC().Format(time.RFC3339),
				Path:      path,
				Exists:    false,
				Content:   "",
			}}, nil
		}
		return nil, huma.Error500InternalServerError("read cc-connect config failed", err)
	}

	return &CCConnectTextFileOutput{Body: CCConnectTextFileResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Path:      path,
		Exists:    true,
		Content:   string(content),
	}}, nil
}

func UpdateCCConnectConfig(ctx context.Context, input *CCConnectTextFileInput) (*CCConnectTextFileOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("config content is required", nil)
	}
	if err := validateCCConnectTOML(input.Body.Content); err != nil {
		return nil, huma.Error400BadRequest("config.toml 不是合法 TOML", err)
	}

	path, _ := resolveCCConnectConfigPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, huma.Error500InternalServerError("create cc-connect config directory failed", err)
	}
	if err := os.WriteFile(path, []byte(input.Body.Content), 0o600); err != nil {
		return nil, huma.Error500InternalServerError("write cc-connect config failed", err)
	}

	invalidateCCConnectEnvironmentCache()
	return &CCConnectTextFileOutput{Body: CCConnectTextFileResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Path:      path,
		Exists:    true,
		Content:   input.Body.Content,
	}}, nil
}

func GetCCConnectModelsConfig(ctx context.Context, input *struct{}) (*CCConnectModelsConfigOutput, error) {
	path, _ := resolveCCConnectConfigPath()
	doc, exists, err := readCCConnectConfigDocument(path)
	if err != nil {
		return nil, huma.Error500InternalServerError("read cc-connect config failed", err)
	}

	config := parseCCConnectModelsConfig(doc)
	return &CCConnectModelsConfigOutput{Body: CCConnectModelsConfigResponse{
		Status:    statusFromExists(exists),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Path:      path,
		Exists:    exists,
		Config:    config,
		Summary:   summarizeCCConnectModelsConfig(config),
	}}, nil
}

func UpdateCCConnectModelsConfig(ctx context.Context, input *CCConnectModelsConfigInput) (*CCConnectModelsConfigOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("cc-connect model config is required", nil)
	}
	if err := validateCCConnectModelsConfig(input.Body.Config); err != nil {
		return nil, huma.Error400BadRequest("cc-connect model config is invalid", err)
	}

	path, _ := resolveCCConnectConfigPath()
	doc, _, err := readCCConnectConfigDocument(path)
	if err != nil {
		return nil, huma.Error500InternalServerError("read cc-connect config failed", err)
	}
	applyCCConnectModelsConfig(doc, input.Body.Config)

	content, err := encodeCCConnectConfigDocument(doc)
	if err != nil {
		return nil, huma.Error500InternalServerError("encode cc-connect config failed", err)
	}
	if err := validateCCConnectTOML(content); err != nil {
		return nil, huma.Error500InternalServerError("encoded cc-connect config is invalid", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, huma.Error500InternalServerError("create cc-connect config directory failed", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return nil, huma.Error500InternalServerError("write cc-connect config failed", err)
	}

	invalidateCCConnectEnvironmentCache()
	next := parseCCConnectModelsConfig(doc)
	return &CCConnectModelsConfigOutput{Body: CCConnectModelsConfigResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Path:      path,
		Exists:    true,
		Config:    next,
		Summary:   summarizeCCConnectModelsConfig(next),
	}}, nil
}

func GetCCConnectProjectsConfig(ctx context.Context, input *struct{}) (*CCConnectProjectsConfigOutput, error) {
	path, _ := resolveCCConnectConfigPath()
	doc, exists, err := readCCConnectConfigDocument(path)
	if err != nil {
		return nil, huma.Error500InternalServerError("read cc-connect config failed", err)
	}

	config := parseCCConnectProjectsConfig(doc)
	return &CCConnectProjectsConfigOutput{Body: CCConnectProjectsConfigResponse{
		Status:    statusFromExists(exists),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Path:      path,
		Exists:    exists,
		Config:    config,
		Summary:   summarizeCCConnectProjectsConfig(config),
	}}, nil
}

func UpdateCCConnectProjectsConfig(ctx context.Context, input *CCConnectProjectsConfigInput) (*CCConnectProjectsConfigOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("cc-connect project config is required", nil)
	}
	if err := validateCCConnectProjectsConfig(input.Body.Config); err != nil {
		return nil, huma.Error400BadRequest("cc-connect project config is invalid", err)
	}

	path, _ := resolveCCConnectConfigPath()
	doc, _, err := readCCConnectConfigDocument(path)
	if err != nil {
		return nil, huma.Error500InternalServerError("read cc-connect config failed", err)
	}
	applyCCConnectProjectsConfig(doc, input.Body.Config)

	content, err := encodeCCConnectConfigDocument(doc)
	if err != nil {
		return nil, huma.Error500InternalServerError("encode cc-connect config failed", err)
	}
	if err := validateCCConnectTOML(content); err != nil {
		return nil, huma.Error500InternalServerError("encoded cc-connect config is invalid", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, huma.Error500InternalServerError("create cc-connect config directory failed", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return nil, huma.Error500InternalServerError("write cc-connect config failed", err)
	}

	invalidateCCConnectEnvironmentCache()
	next := parseCCConnectProjectsConfig(doc)
	return &CCConnectProjectsConfigOutput{Body: CCConnectProjectsConfigResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Path:      path,
		Exists:    true,
		Config:    next,
		Summary:   summarizeCCConnectProjectsConfig(next),
	}}, nil
}

func GetCCConnectBasicConfig(ctx context.Context, input *struct{}) (*CCConnectBasicConfigOutput, error) {
	path, _ := resolveCCConnectConfigPath()
	doc, exists, err := readCCConnectConfigDocument(path)
	if err != nil {
		return nil, huma.Error500InternalServerError("read cc-connect config failed", err)
	}

	return &CCConnectBasicConfigOutput{Body: CCConnectBasicConfigResponse{
		Status:    statusFromExists(exists),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Path:      path,
		Exists:    exists,
		Config:    parseCCConnectBasicConfig(doc),
		Summary:   summarizeCCConnectBasicConfig(doc),
	}}, nil
}

func UpdateCCConnectBasicConfig(ctx context.Context, input *CCConnectBasicConfigInput) (*CCConnectBasicConfigOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("cc-connect basic config is required", nil)
	}
	if err := validateCCConnectBasicConfig(input.Body.Config); err != nil {
		return nil, huma.Error400BadRequest("cc-connect basic config is invalid", err)
	}

	path, _ := resolveCCConnectConfigPath()
	doc, _, err := readCCConnectConfigDocument(path)
	if err != nil {
		return nil, huma.Error500InternalServerError("read cc-connect config failed", err)
	}
	applyCCConnectBasicConfig(doc, input.Body.Config)

	content, err := encodeCCConnectConfigDocument(doc)
	if err != nil {
		return nil, huma.Error500InternalServerError("encode cc-connect config failed", err)
	}
	if err := validateCCConnectTOML(content); err != nil {
		return nil, huma.Error500InternalServerError("encoded cc-connect config is invalid", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, huma.Error500InternalServerError("create cc-connect config directory failed", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return nil, huma.Error500InternalServerError("write cc-connect config failed", err)
	}

	invalidateCCConnectEnvironmentCache()
	next := parseCCConnectBasicConfig(doc)
	return &CCConnectBasicConfigOutput{Body: CCConnectBasicConfigResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Path:      path,
		Exists:    true,
		Config:    next,
		Summary:   summarizeCCConnectBasicConfig(doc),
	}}, nil
}

func validateCCConnectTOML(content string) error {
	var decoded map[string]any
	_, err := toml.Decode(content, &decoded)
	return err
}

func readCCConnectConfigDocument(path string) (map[string]any, bool, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, false, nil
		}
		return nil, false, err
	}

	var doc map[string]any
	if _, err := toml.Decode(string(content), &doc); err != nil {
		return nil, true, err
	}
	if doc == nil {
		doc = map[string]any{}
	}
	return doc, true, nil
}

func encodeCCConnectConfigDocument(doc map[string]any) (string, error) {
	var buf bytes.Buffer
	encoder := toml.NewEncoder(&buf)
	if err := encoder.Encode(doc); err != nil {
		return "", err
	}
	return strings.TrimRight(buf.String(), "\n") + "\n", nil
}

func parseCCConnectBasicConfig(doc map[string]any) CCConnectBasicConfig {
	display := ccConnectConfigMap(doc, "display", false)
	streamPreview := ccConnectConfigMap(doc, "stream_preview", false)
	rateLimit := ccConnectConfigMap(doc, "rate_limit", false)
	outgoingRateLimit := ccConnectConfigMap(doc, "outgoing_rate_limit", false)
	cron := ccConnectConfigMap(doc, "cron", false)
	webhook := ccConnectConfigMap(doc, "webhook", false)
	bridge := ccConnectConfigMap(doc, "bridge", false)
	management := ccConnectConfigMap(doc, "management", false)

	return CCConnectBasicConfig{
		Language:           stringFromConfigMap(doc, "language"),
		DataDir:            stringFromConfigMap(doc, "data_dir"),
		AttachmentSend:     stringFromConfigMap(doc, "attachment_send"),
		IdleTimeoutMins:    intFromConfigMap(doc, "idle_timeout_mins", 0),
		ProviderPresetsURL: stringFromConfigMap(doc, "provider_presets_url"),
		BannedWords:        stringSliceFromConfigMap(doc, "banned_words"),
		LogLevel:           stringFromConfigMap(ccConnectConfigMap(doc, "log", false), "level"),
		Display: CCConnectDisplayBasicConfig{
			Mode:             stringFromConfigMap(display, "mode"),
			CardMode:         stringFromConfigMap(display, "card_mode"),
			ThinkingMessages: boolFromConfigMap(display, "thinking_messages", false),
			ThinkingMaxLen:   intFromConfigMap(display, "thinking_max_len", 0),
			ToolMessages:     boolFromConfigMap(display, "tool_messages", false),
			ToolMaxLen:       intFromConfigMap(display, "tool_max_len", 0),
		},
		StreamPreview: CCConnectStreamPreviewConfig{
			Enabled:       boolFromConfigMap(streamPreview, "enabled", false),
			IntervalMs:    intFromConfigMap(streamPreview, "interval_ms", 0),
			MinDeltaChars: intFromConfigMap(streamPreview, "min_delta_chars", 0),
			MaxChars:      intFromConfigMap(streamPreview, "max_chars", 0),
		},
		RateLimit: CCConnectRateLimitConfig{
			MaxMessages: intFromConfigMap(rateLimit, "max_messages", 0),
			WindowSecs:  intFromConfigMap(rateLimit, "window_secs", 0),
		},
		OutgoingRateLimit: CCConnectRateLimitConfig{
			MaxMessages: intFromConfigMap(outgoingRateLimit, "max_messages", 0),
			WindowSecs:  intFromConfigMap(outgoingRateLimit, "window_secs", 0),
		},
		Cron: CCConnectCronConfig{
			Silent:      boolFromConfigMap(cron, "silent", false),
			SessionMode: stringFromConfigMap(cron, "session_mode"),
		},
		Webhook: CCConnectEndpointBasicConfig{
			Enabled:  boolFromConfigMap(webhook, "enabled", false),
			Port:     intFromConfigMap(webhook, "port", 0),
			Path:     stringFromConfigMap(webhook, "path"),
			Token:    stringFromConfigMap(webhook, "token"),
			TokenSet: stringFromConfigMap(webhook, "token") != "",
		},
		Bridge: CCConnectEndpointBasicConfig{
			Enabled:     boolFromConfigMap(bridge, "enabled", false),
			Port:        intFromConfigMap(bridge, "port", 9810),
			Path:        stringFromConfigMapWithDefault(bridge, "path", "/bridge/ws"),
			CORSOrigins: stringSliceFromConfigMap(bridge, "cors_origins"),
			Insecure:    boolFromConfigMap(bridge, "insecure", false),
			Token:       stringFromConfigMap(bridge, "token"),
			TokenSet:    stringFromConfigMap(bridge, "token") != "",
		},
		Management: CCConnectEndpointBasicConfig{
			Enabled:     boolFromConfigMap(management, "enabled", false),
			Port:        intFromConfigMap(management, "port", 9820),
			CORSOrigins: stringSliceFromConfigMap(management, "cors_origins"),
			Token:       stringFromConfigMap(management, "token"),
			TokenSet:    stringFromConfigMap(management, "token") != "",
		},
	}
}

func applyCCConnectBasicConfig(doc map[string]any, cfg CCConnectBasicConfig) {
	setStringConfigValue(doc, "language", cfg.Language)
	setStringConfigValue(doc, "data_dir", cfg.DataDir)
	setStringConfigValue(doc, "attachment_send", cfg.AttachmentSend)
	setIntConfigValue(doc, "idle_timeout_mins", cfg.IdleTimeoutMins)
	setStringConfigValue(doc, "provider_presets_url", cfg.ProviderPresetsURL)
	setStringSliceConfigValue(doc, "banned_words", cfg.BannedWords)

	logSection := ccConnectConfigMap(doc, "log", true)
	setStringConfigValue(logSection, "level", cfg.LogLevel)

	display := ccConnectConfigMap(doc, "display", true)
	setStringConfigValue(display, "mode", cfg.Display.Mode)
	setStringConfigValue(display, "card_mode", cfg.Display.CardMode)
	display["thinking_messages"] = cfg.Display.ThinkingMessages
	setIntConfigValue(display, "thinking_max_len", cfg.Display.ThinkingMaxLen)
	display["tool_messages"] = cfg.Display.ToolMessages
	setIntConfigValue(display, "tool_max_len", cfg.Display.ToolMaxLen)

	streamPreview := ccConnectConfigMap(doc, "stream_preview", true)
	streamPreview["enabled"] = cfg.StreamPreview.Enabled
	setIntConfigValue(streamPreview, "interval_ms", cfg.StreamPreview.IntervalMs)
	setIntConfigValue(streamPreview, "min_delta_chars", cfg.StreamPreview.MinDeltaChars)
	setIntConfigValue(streamPreview, "max_chars", cfg.StreamPreview.MaxChars)

	rateLimit := ccConnectConfigMap(doc, "rate_limit", true)
	setIntConfigValue(rateLimit, "max_messages", cfg.RateLimit.MaxMessages)
	setIntConfigValue(rateLimit, "window_secs", cfg.RateLimit.WindowSecs)

	outgoingRateLimit := ccConnectConfigMap(doc, "outgoing_rate_limit", true)
	setIntConfigValue(outgoingRateLimit, "max_messages", cfg.OutgoingRateLimit.MaxMessages)
	setIntConfigValue(outgoingRateLimit, "window_secs", cfg.OutgoingRateLimit.WindowSecs)

	cron := ccConnectConfigMap(doc, "cron", true)
	cron["silent"] = cfg.Cron.Silent
	setStringConfigValue(cron, "session_mode", cfg.Cron.SessionMode)

	applyCCConnectEndpointConfig(ccConnectConfigMap(doc, "webhook", true), cfg.Webhook, ccConnectEndpointOptions{path: true})
	applyCCConnectEndpointConfig(ccConnectConfigMap(doc, "bridge", true), cfg.Bridge, ccConnectEndpointOptions{path: true, corsOrigins: true, insecure: true})
	applyCCConnectEndpointConfig(ccConnectConfigMap(doc, "management", true), cfg.Management, ccConnectEndpointOptions{corsOrigins: true})
}

func parseCCConnectModelsConfig(doc map[string]any) CCConnectModelsConfig {
	projects := configList(doc["projects"])
	out := CCConnectModelsConfig{
		ProviderPresetsURL: stringFromConfigMap(doc, "provider_presets_url"),
		Providers:          parseCCConnectModelProviders(configList(doc["providers"])),
		Projects:           make([]CCConnectProjectModelConfig, 0, len(projects)),
	}

	for _, item := range projects {
		projectMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		agent := ccConnectConfigMap(projectMap, "agent", false)
		options := ccConnectConfigMap(agent, "options", false)
		out.Projects = append(out.Projects, CCConnectProjectModelConfig{
			Name:            stringFromConfigMap(projectMap, "name"),
			AgentType:       stringFromConfigMap(agent, "type"),
			AgentModel:      stringFromConfigMap(options, "model"),
			ActiveProvider:  stringFromConfigMap(options, "provider"),
			ProviderRefs:    stringSliceFromConfigMap(agent, "provider_refs"),
			InlineProviders: parseCCConnectModelProviders(configList(agent["providers"])),
		})
	}

	return out
}

func parseCCConnectModelProviders(items []any) []CCConnectModelProviderConfig {
	providers := make([]CCConnectModelProviderConfig, 0, len(items))
	for _, item := range items {
		values, ok := item.(map[string]any)
		if !ok {
			continue
		}
		providers = append(providers, parseCCConnectModelProvider(values))
	}
	return providers
}

func parseCCConnectModelProvider(values map[string]any) CCConnectModelProviderConfig {
	apiKey := stringFromConfigMap(values, "api_key")
	return CCConnectModelProviderConfig{
		Name:            stringFromConfigMap(values, "name"),
		APIKey:          apiKey,
		APIKeySet:       strings.TrimSpace(apiKey) != "",
		BaseURL:         stringFromConfigMap(values, "base_url"),
		Model:           stringFromConfigMap(values, "model"),
		Thinking:        stringFromConfigMap(values, "thinking"),
		AgentTypes:      stringSliceFromConfigMap(values, "agent_types"),
		Models:          parseCCConnectProviderModels(configList(values["models"])),
		Env:             stringMapFromConfigValue(values["env"]),
		Endpoints:       stringMapFromConfigValue(values["endpoints"]),
		AgentModels:     stringMapFromConfigValue(values["agent_models"]),
		AgentModelLists: parseCCConnectAgentModelLists(values["agent_model_lists"]),
		Codex:           parseCCConnectCodexProvider(ccConnectConfigMap(values, "codex", false)),
	}
}

func parseCCConnectProviderModels(items []any) []CCConnectProviderModelConfig {
	models := make([]CCConnectProviderModelConfig, 0, len(items))
	for _, item := range items {
		switch typed := item.(type) {
		case map[string]any:
			model := strings.TrimSpace(stringFromConfigMap(typed, "model"))
			if model == "" {
				continue
			}
			models = append(models, CCConnectProviderModelConfig{
				Model: model,
				Alias: stringFromConfigMap(typed, "alias"),
			})
		case string:
			model := strings.TrimSpace(typed)
			if model != "" {
				models = append(models, CCConnectProviderModelConfig{Model: model})
			}
		}
	}
	return models
}

func parseCCConnectAgentModelLists(value any) map[string][]CCConnectProviderModelConfig {
	values, ok := value.(map[string]any)
	if !ok || len(values) == 0 {
		return nil
	}
	out := make(map[string][]CCConnectProviderModelConfig, len(values))
	for key, raw := range values {
		models := parseCCConnectProviderModels(configList(raw))
		if len(models) > 0 {
			out[key] = models
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func parseCCConnectCodexProvider(values map[string]any) *CCConnectCodexProviderConfig {
	if len(values) == 0 {
		return nil
	}
	codex := &CCConnectCodexProviderConfig{
		EnvKey:      stringFromConfigMap(values, "env_key"),
		WireAPI:     stringFromConfigMap(values, "wire_api"),
		HTTPHeaders: stringMapFromConfigValue(values["http_headers"]),
	}
	if codex.EnvKey == "" && codex.WireAPI == "" && len(codex.HTTPHeaders) == 0 {
		return nil
	}
	return codex
}

func applyCCConnectModelsConfig(doc map[string]any, cfg CCConnectModelsConfig) {
	setStringConfigValue(doc, "provider_presets_url", cfg.ProviderPresetsURL)
	if len(cfg.Providers) == 0 {
		delete(doc, "providers")
	} else {
		doc["providers"] = ccConnectModelProviderMaps(cfg.Providers)
	}

	projects := configList(doc["projects"])
	for index, item := range projects {
		projectMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		projectName := stringFromConfigMap(projectMap, "name")
		projectPatch, ok := findCCConnectProjectModelConfig(cfg.Projects, projectName)
		if !ok {
			continue
		}
		agent := ccConnectConfigMap(projectMap, "agent", true)
		options := ccConnectConfigMap(agent, "options", true)
		setStringConfigValue(options, "model", projectPatch.AgentModel)
		setStringConfigValue(options, "provider", projectPatch.ActiveProvider)
		setStringSliceConfigValue(agent, "provider_refs", projectPatch.ProviderRefs)
		if len(projectPatch.InlineProviders) == 0 {
			delete(agent, "providers")
		} else {
			agent["providers"] = ccConnectModelProviderMaps(projectPatch.InlineProviders)
		}
		projects[index] = projectMap
	}
	if len(projects) > 0 {
		doc["projects"] = projects
	}
}

func findCCConnectProjectModelConfig(projects []CCConnectProjectModelConfig, name string) (CCConnectProjectModelConfig, bool) {
	for _, project := range projects {
		if project.Name == name {
			return project, true
		}
	}
	return CCConnectProjectModelConfig{}, false
}

func ccConnectModelProviderMaps(providers []CCConnectModelProviderConfig) []map[string]any {
	items := make([]map[string]any, 0, len(providers))
	for _, provider := range providers {
		item := map[string]any{}
		setStringConfigValue(item, "name", provider.Name)
		setStringConfigValue(item, "api_key", provider.APIKey)
		setStringConfigValue(item, "base_url", provider.BaseURL)
		setStringConfigValue(item, "model", provider.Model)
		setStringConfigValue(item, "thinking", provider.Thinking)
		setStringSliceConfigValue(item, "agent_types", provider.AgentTypes)
		if len(provider.Models) > 0 {
			item["models"] = ccConnectProviderModelMaps(provider.Models)
		}
		setStringMapConfigValue(item, "env", provider.Env)
		setStringMapConfigValue(item, "endpoints", provider.Endpoints)
		setStringMapConfigValue(item, "agent_models", provider.AgentModels)
		if len(provider.AgentModelLists) > 0 {
			agentModelLists := make(map[string]any, len(provider.AgentModelLists))
			for key, models := range provider.AgentModelLists {
				if strings.TrimSpace(key) != "" && len(models) > 0 {
					agentModelLists[key] = ccConnectProviderModelMaps(models)
				}
			}
			if len(agentModelLists) > 0 {
				item["agent_model_lists"] = agentModelLists
			}
		}
		if provider.Codex != nil {
			codex := map[string]any{}
			setStringConfigValue(codex, "env_key", provider.Codex.EnvKey)
			setStringConfigValue(codex, "wire_api", provider.Codex.WireAPI)
			setStringMapConfigValue(codex, "http_headers", provider.Codex.HTTPHeaders)
			if len(codex) > 0 {
				item["codex"] = codex
			}
		}
		items = append(items, item)
	}
	return items
}

func ccConnectProviderModelMaps(models []CCConnectProviderModelConfig) []map[string]any {
	items := make([]map[string]any, 0, len(models))
	for _, model := range models {
		modelID := strings.TrimSpace(model.Model)
		if modelID == "" {
			continue
		}
		item := map[string]any{"model": modelID}
		setStringConfigValue(item, "alias", model.Alias)
		items = append(items, item)
	}
	return items
}

func validateCCConnectModelsConfig(cfg CCConnectModelsConfig) error {
	if err := validateCCConnectProviderList("providers", cfg.Providers); err != nil {
		return err
	}
	projectNames := make(map[string]bool, len(cfg.Projects))
	globalNames := make(map[string]bool, len(cfg.Providers))
	for _, provider := range cfg.Providers {
		globalNames[provider.Name] = true
	}
	for _, project := range cfg.Projects {
		projectName := strings.TrimSpace(project.Name)
		if projectName == "" {
			return fmt.Errorf("project name is required")
		}
		if projectNames[projectName] {
			return fmt.Errorf("duplicate project name %q", projectName)
		}
		projectNames[projectName] = true
		if err := validateCCConnectProviderList("project "+projectName+" inline providers", project.InlineProviders); err != nil {
			return err
		}
		for _, ref := range project.ProviderRefs {
			ref = strings.TrimSpace(ref)
			if ref == "" {
				continue
			}
			if !globalNames[ref] {
				return fmt.Errorf("project %q references missing provider %q", projectName, ref)
			}
		}
	}
	return nil
}

func validateCCConnectProviderList(label string, providers []CCConnectModelProviderConfig) error {
	names := make(map[string]bool, len(providers))
	for _, provider := range providers {
		name := strings.TrimSpace(provider.Name)
		if name == "" {
			return fmt.Errorf("%s provider name is required", label)
		}
		if names[name] {
			return fmt.Errorf("duplicate provider name %q", name)
		}
		names[name] = true
		for _, model := range provider.Models {
			if strings.TrimSpace(model.Model) == "" {
				return fmt.Errorf("provider %q has empty model id", name)
			}
		}
		for agentType, models := range provider.AgentModelLists {
			if strings.TrimSpace(agentType) == "" {
				return fmt.Errorf("provider %q has empty agent model list key", name)
			}
			for _, model := range models {
				if strings.TrimSpace(model.Model) == "" {
					return fmt.Errorf("provider %q agent_model_lists.%s has empty model id", name, agentType)
				}
			}
		}
	}
	return nil
}

func summarizeCCConnectModelsConfig(cfg CCConnectModelsConfig) CCConnectModelsConfigSummary {
	summary := CCConnectModelsConfigSummary{
		ProviderCount: len(cfg.Providers),
		ProjectCount:  len(cfg.Projects),
	}
	for _, provider := range cfg.Providers {
		summary.ModelAliasCount += len(provider.Models)
		for _, models := range provider.AgentModelLists {
			summary.ModelAliasCount += len(models)
		}
	}
	for _, project := range cfg.Projects {
		summary.ReferencedCount += len(project.ProviderRefs)
		summary.InlineProviderCount += len(project.InlineProviders)
		for _, provider := range project.InlineProviders {
			summary.ModelAliasCount += len(provider.Models)
		}
	}
	return summary
}

func parseCCConnectProjectsConfig(doc map[string]any) CCConnectProjectsConfig {
	projects := configList(doc["projects"])
	out := CCConnectProjectsConfig{
		Projects: make([]CCConnectProjectConfig, 0, len(projects)),
	}

	for _, item := range projects {
		projectMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		agent := ccConnectConfigMap(projectMap, "agent", false)
		options := ccConnectConfigMap(agent, "options", false)
		out.Projects = append(out.Projects, CCConnectProjectConfig{
			Name:                   stringFromConfigMap(projectMap, "name"),
			ResetOnIdleMins:        intFromConfigMap(projectMap, "reset_on_idle_mins", 0),
			RunAsUser:              stringFromConfigMap(projectMap, "run_as_user"),
			RunAsEnv:               stringSliceFromConfigMap(projectMap, "run_as_env"),
			ShowContextIndicator:   boolFromConfigMap(projectMap, "show_context_indicator", false),
			ReplyFooter:            boolFromConfigMap(projectMap, "reply_footer", false),
			InjectSender:           boolFromConfigMap(projectMap, "inject_sender", false),
			FilterExternalSessions: boolFromConfigMap(projectMap, "filter_external_sessions", false),
			AdminFrom:              stringFromConfigMap(projectMap, "admin_from"),
			DisabledCommands:       stringSliceFromConfigMap(projectMap, "disabled_commands"),
			Agent: CCConnectProjectAgentConfig{
				Type:             stringFromConfigMap(agent, "type"),
				WorkDir:          stringFromConfigMap(options, "work_dir"),
				Mode:             stringFromConfigMap(options, "mode"),
				Model:            stringFromConfigMap(options, "model"),
				Provider:         stringFromConfigMap(options, "provider"),
				ReasoningEffort:  stringFromConfigMap(options, "reasoning_effort"),
				AllowedTools:     stringSliceFromConfigMap(options, "allowed_tools"),
				DisallowedTools:  stringSliceFromConfigMap(options, "disallowed_tools"),
				SystemPrompt:     stringFromConfigMap(options, "system_prompt"),
				ProviderRefs:     stringSliceFromConfigMap(agent, "provider_refs"),
				Env:              stringMapFromConfigValue(options["env"]),
				AdditionalOption: parseCCConnectAgentAdditionalOptions(options),
			},
			Platforms: parseCCConnectProjectPlatforms(configList(projectMap["platforms"])),
		})
	}

	return out
}

func parseCCConnectAgentAdditionalOptions(options map[string]any) map[string]string {
	known := map[string]bool{
		"work_dir": true, "mode": true, "model": true, "provider": true, "reasoning_effort": true,
		"allowed_tools": true, "disallowed_tools": true, "system_prompt": true, "env": true,
	}
	out := map[string]string{}
	for key, value := range options {
		if known[key] || strings.TrimSpace(key) == "" || value == nil {
			continue
		}
		switch typed := value.(type) {
		case string:
			out[key] = typed
		case fmt.Stringer:
			out[key] = typed.String()
		case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64, bool:
			out[key] = fmt.Sprint(typed)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func parseCCConnectProjectPlatforms(items []any) []CCConnectProjectPlatformConfig {
	platforms := make([]CCConnectProjectPlatformConfig, 0, len(items))
	for _, item := range items {
		values, ok := item.(map[string]any)
		if !ok {
			continue
		}
		platforms = append(platforms, CCConnectProjectPlatformConfig{
			Type:    stringFromConfigMap(values, "type"),
			Options: stringMapFromConfigValue(values["options"]),
		})
	}
	return platforms
}

func applyCCConnectProjectsConfig(doc map[string]any, cfg CCConnectProjectsConfig) {
	existingProjects := map[string]map[string]any{}
	for _, item := range configList(doc["projects"]) {
		projectMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name := stringFromConfigMap(projectMap, "name")
		if strings.TrimSpace(name) != "" {
			existingProjects[name] = projectMap
		}
	}

	projects := make([]map[string]any, 0, len(cfg.Projects))
	for _, project := range cfg.Projects {
		projectMap := existingProjects[project.Name]
		if projectMap == nil {
			projectMap = map[string]any{}
		}
		setStringConfigValue(projectMap, "name", project.Name)
		setIntConfigValue(projectMap, "reset_on_idle_mins", project.ResetOnIdleMins)
		setStringConfigValue(projectMap, "run_as_user", project.RunAsUser)
		setStringSliceConfigValue(projectMap, "run_as_env", project.RunAsEnv)
		setBoolConfigValue(projectMap, "show_context_indicator", project.ShowContextIndicator)
		setBoolConfigValue(projectMap, "reply_footer", project.ReplyFooter)
		setBoolConfigValue(projectMap, "inject_sender", project.InjectSender)
		setBoolConfigValue(projectMap, "filter_external_sessions", project.FilterExternalSessions)
		setStringConfigValue(projectMap, "admin_from", project.AdminFrom)
		setStringSliceConfigValue(projectMap, "disabled_commands", project.DisabledCommands)

		agent := ccConnectConfigMap(projectMap, "agent", true)
		applyCCConnectProjectAgentConfig(agent, project.Agent)

		if len(project.Platforms) == 0 {
			delete(projectMap, "platforms")
		} else {
			projectMap["platforms"] = ccConnectProjectPlatformMaps(project.Platforms)
		}
		projects = append(projects, projectMap)
	}

	if len(projects) == 0 {
		delete(doc, "projects")
		return
	}
	doc["projects"] = projects
}

func applyCCConnectProjectAgentConfig(agent map[string]any, cfg CCConnectProjectAgentConfig) {
	setStringConfigValue(agent, "type", cfg.Type)
	setStringSliceConfigValue(agent, "provider_refs", cfg.ProviderRefs)
	options := ccConnectConfigMap(agent, "options", true)
	setStringConfigValue(options, "work_dir", cfg.WorkDir)
	setStringConfigValue(options, "mode", cfg.Mode)
	setStringConfigValue(options, "model", cfg.Model)
	setStringConfigValue(options, "provider", cfg.Provider)
	setStringConfigValue(options, "reasoning_effort", cfg.ReasoningEffort)
	setStringSliceConfigValue(options, "allowed_tools", cfg.AllowedTools)
	setStringSliceConfigValue(options, "disallowed_tools", cfg.DisallowedTools)
	setStringConfigValue(options, "system_prompt", cfg.SystemPrompt)
	setStringMapConfigValue(options, "env", cfg.Env)
	applyCCConnectAgentAdditionalOptions(options, cfg.AdditionalOption)
}

func applyCCConnectAgentAdditionalOptions(options map[string]any, values map[string]string) {
	known := map[string]bool{
		"work_dir": true, "mode": true, "model": true, "provider": true, "reasoning_effort": true,
		"allowed_tools": true, "disallowed_tools": true, "system_prompt": true, "env": true,
	}
	for key, value := range options {
		if known[key] {
			continue
		}
		switch value.(type) {
		case string, fmt.Stringer, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64, bool:
			delete(options, key)
		}
	}
	for key, value := range values {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		options[key] = value
	}
}

func ccConnectProjectPlatformMaps(platforms []CCConnectProjectPlatformConfig) []map[string]any {
	items := make([]map[string]any, 0, len(platforms))
	for _, platform := range platforms {
		item := map[string]any{}
		setStringConfigValue(item, "type", platform.Type)
		setStringMapConfigValue(item, "options", platform.Options)
		items = append(items, item)
	}
	return items
}

func validateCCConnectProjectsConfig(cfg CCConnectProjectsConfig) error {
	if len(cfg.Projects) == 0 {
		return fmt.Errorf("at least one project is required")
	}
	projectNames := make(map[string]bool, len(cfg.Projects))
	for _, project := range cfg.Projects {
		projectName := strings.TrimSpace(project.Name)
		if projectName == "" {
			return fmt.Errorf("project name is required")
		}
		if projectNames[projectName] {
			return fmt.Errorf("duplicate project name %q", projectName)
		}
		projectNames[projectName] = true
		if strings.TrimSpace(project.Agent.Type) == "" {
			return fmt.Errorf("project %q agent type is required", projectName)
		}
		for _, platform := range project.Platforms {
			if strings.TrimSpace(platform.Type) == "" {
				return fmt.Errorf("project %q has empty platform type", projectName)
			}
		}
	}
	return nil
}

func summarizeCCConnectProjectsConfig(cfg CCConnectProjectsConfig) CCConnectProjectsConfigSummary {
	summary := CCConnectProjectsConfigSummary{
		ProjectCount:  len(cfg.Projects),
		AgentTypes:    map[string]int{},
		PlatformTypes: map[string]int{},
	}
	for _, project := range cfg.Projects {
		agentType := strings.TrimSpace(project.Agent.Type)
		if agentType != "" {
			summary.AgentTypes[agentType]++
		}
		summary.PlatformCount += len(project.Platforms)
		for _, platform := range project.Platforms {
			platformType := strings.TrimSpace(platform.Type)
			if platformType != "" {
				summary.PlatformTypes[platformType]++
			}
		}
	}
	return summary
}

type ccConnectEndpointOptions struct {
	path        bool
	corsOrigins bool
	insecure    bool
}

func applyCCConnectEndpointConfig(section map[string]any, cfg CCConnectEndpointBasicConfig, options ccConnectEndpointOptions) {
	section["enabled"] = cfg.Enabled
	setPortConfigValue(section, "port", cfg.Port)
	setStringConfigValue(section, "token", cfg.Token)
	if options.path {
		setStringConfigValue(section, "path", cfg.Path)
	}
	if options.corsOrigins {
		setStringSliceConfigValue(section, "cors_origins", cfg.CORSOrigins)
	}
	if options.insecure {
		section["insecure"] = cfg.Insecure
	}
}

func validateCCConnectBasicConfig(cfg CCConnectBasicConfig) error {
	if err := validateOptionalPort("webhook.port", cfg.Webhook.Port); err != nil {
		return err
	}
	if err := validateOptionalPort("bridge.port", cfg.Bridge.Port); err != nil {
		return err
	}
	if err := validateOptionalPort("management.port", cfg.Management.Port); err != nil {
		return err
	}
	return nil
}

func validateOptionalPort(name string, value int) error {
	if value == 0 {
		return nil
	}
	if value < 1 || value > 65535 {
		return fmt.Errorf("%s must be between 1 and 65535", name)
	}
	return nil
}

func summarizeCCConnectBasicConfig(doc map[string]any) CCConnectConfigBasicSummary {
	projects := configList(doc["projects"])
	platformCount := 0
	for _, project := range projects {
		if projectMap, ok := project.(map[string]any); ok {
			platformCount += len(configList(projectMap["platforms"]))
		}
	}

	return CCConnectConfigBasicSummary{
		ProjectCount:    len(projects),
		ProviderCount:   len(configList(doc["providers"])),
		PlatformCount:   platformCount,
		CommandCount:    len(configList(doc["commands"])),
		AliasCount:      len(configList(doc["aliases"])),
		HookCount:       len(configList(doc["hooks"])),
		BannedWordCount: len(configList(doc["banned_words"])),
	}
}

func ccConnectConfigMap(parent map[string]any, key string, create bool) map[string]any {
	if parent == nil {
		return map[string]any{}
	}
	if value, ok := parent[key]; ok {
		if typed, ok := value.(map[string]any); ok {
			return typed
		}
	}
	if !create {
		return map[string]any{}
	}
	next := map[string]any{}
	parent[key] = next
	return next
}

func stringFromConfigMap(values map[string]any, key string) string {
	value, ok := values[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return fmt.Sprint(typed)
	}
}

func stringFromConfigMapWithDefault(values map[string]any, key string, fallback string) string {
	value := strings.TrimSpace(stringFromConfigMap(values, key))
	if value == "" {
		return fallback
	}
	return value
}

func intFromConfigMap(values map[string]any, key string, fallback int) int {
	value, ok := values[key]
	if !ok || value == nil {
		return fallback
	}
	switch typed := value.(type) {
	case int:
		return typed
	case int8:
		return int(typed)
	case int16:
		return int(typed)
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case uint:
		return int(typed)
	case uint8:
		return int(typed)
	case uint16:
		return int(typed)
	case uint32:
		return int(typed)
	case uint64:
		return int(typed)
	case float32:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(typed))
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func boolFromConfigMap(values map[string]any, key string, fallback bool) bool {
	value, ok := values[key]
	if !ok || value == nil {
		return fallback
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		parsed, err := strconv.ParseBool(strings.TrimSpace(typed))
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func stringSliceFromConfigMap(values map[string]any, key string) []string {
	items := configList(values[key])
	out := make([]string, 0, len(items))
	for _, item := range items {
		switch typed := item.(type) {
		case string:
			if trimmed := strings.TrimSpace(typed); trimmed != "" {
				out = append(out, trimmed)
			}
		case fmt.Stringer:
			if trimmed := strings.TrimSpace(typed.String()); trimmed != "" {
				out = append(out, trimmed)
			}
		}
	}
	return out
}

func stringMapFromConfigValue(value any) map[string]string {
	values, ok := value.(map[string]any)
	if !ok || len(values) == 0 {
		return nil
	}
	out := make(map[string]string, len(values))
	for key, raw := range values {
		if strings.TrimSpace(key) == "" || raw == nil {
			continue
		}
		switch typed := raw.(type) {
		case string:
			out[key] = typed
		case fmt.Stringer:
			out[key] = typed.String()
		default:
			out[key] = fmt.Sprint(typed)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func configList(value any) []any {
	switch typed := value.(type) {
	case []any:
		return typed
	case []map[string]any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, item)
		}
		return out
	case []string:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, item)
		}
		return out
	default:
		return nil
	}
}

func setStringConfigValue(values map[string]any, key string, value string) {
	value = strings.TrimSpace(value)
	if value == "" {
		delete(values, key)
		return
	}
	values[key] = value
}

func setIntConfigValue(values map[string]any, key string, value int) {
	if value == 0 {
		delete(values, key)
		return
	}
	values[key] = value
}

func setBoolConfigValue(values map[string]any, key string, value bool) {
	if !value {
		delete(values, key)
		return
	}
	values[key] = value
}

func setPortConfigValue(values map[string]any, key string, value int) {
	if value == 0 {
		delete(values, key)
		return
	}
	values[key] = value
}

func setStringSliceConfigValue(values map[string]any, key string, value []string) {
	cleaned := make([]string, 0, len(value))
	for _, item := range value {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			cleaned = append(cleaned, trimmed)
		}
	}
	if len(cleaned) == 0 {
		delete(values, key)
		return
	}
	values[key] = cleaned
}

func setStringMapConfigValue(values map[string]any, key string, value map[string]string) {
	cleaned := make(map[string]string, len(value))
	for itemKey, itemValue := range value {
		itemKey = strings.TrimSpace(itemKey)
		if itemKey == "" {
			continue
		}
		cleaned[itemKey] = itemValue
	}
	if len(cleaned) == 0 {
		delete(values, key)
		return
	}
	values[key] = cleaned
}

func statusFromExists(exists bool) string {
	if exists {
		return "ok"
	}
	return "missing"
}
