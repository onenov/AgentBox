package openclaw

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
	"github.com/danielgtaylor/huma/v2/sse"
)

const (
	openClawQQBotChannelID = "qqbot"
	openClawQQBotPluginID  = "openclaw-qqbot"
	openClawQQBotPackage   = "@tencent-connect/openclaw-qqbot"
)

type OpenClawQQBotStatusOutput struct {
	Body OpenClawQQBotStatusResponse
}

type OpenClawQQBotConfigInput struct {
	Body OpenClawQQBotConfigRequest
}

type OpenClawQQBotConfigOutput struct {
	Body OpenClawQQBotStatusResponse
}

type OpenClawQQBotAccountConfigInput struct {
	AccountID string `path:"accountId" doc:"QQBot account id." example:"default"`
	Body      OpenClawQQBotAccountConfigRequest
}

type OpenClawQQBotAccountConfigOutput struct {
	Body OpenClawQQBotStatusResponse
}

type OpenClawQQBotAccountDeleteInput struct {
	AccountID string `path:"accountId" doc:"QQBot account id." example:"default"`
}

type OpenClawQQBotAccountDeleteOutput struct {
	Body OpenClawQQBotAccountDeleteResponse
}

type OpenClawQQBotAddStreamInput struct {
	AccountID       string `query:"accountId" doc:"QQBot account id. Empty uses default." example:"default"`
	Name            string `query:"name" doc:"Optional account display name."`
	AppID           string `query:"appId" doc:"QQBot AppID."`
	ClientSecret    string `query:"clientSecret" doc:"QQBot Client Secret."`
	AgentID         string `query:"agentId" doc:"Agent id routed to this account."`
	AllowFrom       string `query:"allowFrom" doc:"Comma or newline separated allowed QQ targets."`
	SystemPrompt    string `query:"systemPrompt" doc:"Optional account system prompt."`
	STTEnabled      bool   `query:"sttEnabled" doc:"Whether STT is enabled."`
	STTAPIKey       string `query:"sttApiKey" doc:"STT API key."`
	STTBaseURL      string `query:"sttBaseUrl" doc:"STT API base URL."`
	STTProvider     string `query:"sttProvider" doc:"STT provider key from models.providers."`
	STTModel        string `query:"sttModel" doc:"STT model."`
	TTSEnabled      bool   `query:"ttsEnabled" doc:"Whether TTS is enabled."`
	TTSAPIKey       string `query:"ttsApiKey" doc:"TTS API key."`
	TTSBaseURL      string `query:"ttsBaseUrl" doc:"TTS API base URL."`
	TTSProvider     string `query:"ttsProvider" doc:"TTS provider key from models.providers."`
	TTSModel        string `query:"ttsModel" doc:"TTS model."`
	TTSVoice        string `query:"ttsVoice" doc:"TTS voice."`
	TTSResponseType string `query:"ttsResponseType" doc:"TTS response type."`
}

type OpenClawQQBotStatusResponse struct {
	Status       string                         `json:"status" example:"ok" doc:"Operation status."`
	ChannelID    string                         `json:"channelId" example:"qqbot" doc:"OpenClaw channel id."`
	Package      string                         `json:"package" example:"@tencent-connect/openclaw-qqbot" doc:"Official npm package name."`
	Installed    bool                           `json:"installed" example:"true" doc:"Whether QQBot appears available from local install records or config."`
	Configured   bool                           `json:"configured" example:"true" doc:"Whether QQBot credentials are configured."`
	Enabled      bool                           `json:"enabled" example:"true" doc:"Whether channels.qqbot.enabled is true."`
	Config       OpenClawQQBotConfigResponse    `json:"config" doc:"QQBot channel config without secrets."`
	Accounts     []OpenClawQQBotAccountResponse `json:"accounts" doc:"Configured QQBot accounts without secrets."`
	ConfigPath   string                         `json:"configPath,omitempty" doc:"OpenClaw config path. Returned after config exists or QQBot is configured."`
	OpenClawHome string                         `json:"openClawHome,omitempty" doc:"OpenClaw home directory."`
	Version      string                         `json:"version,omitempty" doc:"Installed package version when readable."`
	Error        string                         `json:"error,omitempty" doc:"Config read error."`
}

type OpenClawQQBotConfigResponse struct {
	Enabled        bool                      `json:"enabled" doc:"Whether channels.qqbot.enabled is true."`
	Name           string                    `json:"name,omitempty" doc:"Channel display name."`
	AllowFrom      []string                  `json:"allowFrom,omitempty" doc:"Top-level allowFrom entries."`
	AllowFromCount int                       `json:"allowFromCount" doc:"Top-level allowFrom count."`
	AccountCount   int                       `json:"accountCount" doc:"Configured account count."`
	SystemPrompt   string                    `json:"systemPrompt,omitempty" doc:"Top-level system prompt."`
	STT            OpenClawQQBotSpeechConfig `json:"stt" doc:"Top-level speech-to-text config without secrets."`
	TTS            OpenClawQQBotSpeechConfig `json:"tts" doc:"Top-level text-to-speech config without secrets."`
	DefaultAccount string                    `json:"defaultAccount,omitempty" doc:"Default QQBot account id."`
}

type OpenClawQQBotAccountResponse struct {
	AccountID              string                             `json:"accountId" example:"default" doc:"QQBot account id."`
	Name                   string                             `json:"name,omitempty" doc:"Account display name."`
	Enabled                bool                               `json:"enabled" doc:"Whether this account is enabled."`
	AppIDConfigured        bool                               `json:"appIdConfigured" doc:"Whether appId is configured."`
	ClientSecretConfigured bool                               `json:"clientSecretConfigured" doc:"Whether clientSecret is configured."`
	AllowFrom              []string                           `json:"allowFrom,omitempty" doc:"Effective account allowFrom entries."`
	AllowFromCount         int                                `json:"allowFromCount" doc:"Account allowFrom count."`
	AudioFormatPolicy      OpenClawQQBotAudioFormatPolicy     `json:"audioFormatPolicy" doc:"Account audio format policy."`
	DeliverDebounce        OpenClawQQBotDeliverDebounceConfig `json:"deliverDebounce" doc:"Account outbound debounce config."`
	DMPolicy               string                             `json:"dmPolicy,omitempty" doc:"Direct-message access policy."`
	ExecApprovals          OpenClawQQBotExecApprovalsConfig   `json:"execApprovals" doc:"Account exec approval config."`
	GroupAllowFrom         []string                           `json:"groupAllowFrom,omitempty" doc:"Group allowlist entries."`
	GroupPolicy            string                             `json:"groupPolicy,omitempty" doc:"Group access policy."`
	MarkdownSupport        bool                               `json:"markdownSupport" doc:"Whether QQ markdown delivery is enabled."`
	Streaming              OpenClawQQBotStreamingConfig       `json:"streaming" doc:"Account streaming config."`
	SystemPrompt           string                             `json:"systemPrompt,omitempty" doc:"Account system prompt."`
	STT                    OpenClawQQBotSpeechConfig          `json:"stt" doc:"Account speech-to-text config without secrets."`
	TTS                    OpenClawQQBotSpeechConfig          `json:"tts" doc:"Account text-to-speech config without secrets."`
	UpgradeMode            string                             `json:"upgradeMode,omitempty" doc:"/bot-upgrade behavior mode."`
	UpgradePkg             string                             `json:"upgradePkg,omitempty" doc:"Hot reload npm package."`
	UpgradeURL             string                             `json:"upgradeUrl,omitempty" doc:"/bot-upgrade guide URL."`
	URLDirectUpload        bool                               `json:"urlDirectUpload" doc:"Whether public URLs are sent directly to QQ first."`
	AgentID                string                             `json:"agentId,omitempty" doc:"Agent routed to this account."`
}

type OpenClawQQBotSpeechConfig struct {
	Enabled      bool   `json:"enabled" doc:"Whether this speech feature is enabled."`
	APIKey       bool   `json:"apiKeyConfigured" doc:"Whether an API key is configured."`
	BaseURL      string `json:"baseUrl,omitempty" doc:"API base URL."`
	Provider     string `json:"provider,omitempty" doc:"Provider key from models.providers."`
	Model        string `json:"model,omitempty" doc:"Model name."`
	Voice        string `json:"voice,omitempty" doc:"Voice name for TTS."`
	ResponseType string `json:"responseType,omitempty" doc:"Response type for TTS."`
}

type OpenClawQQBotAudioFormatPolicy struct {
	STTDirectFormats    []string `json:"sttDirectFormats,omitempty" doc:"Inbound audio formats that can skip STT conversion."`
	TranscodeEnabled    bool     `json:"transcodeEnabled" doc:"Whether audio transcode is enabled."`
	UploadDirectFormats []string `json:"uploadDirectFormats,omitempty" doc:"Outbound audio formats that can skip SILK conversion."`
}

type OpenClawQQBotDeliverDebounceConfig struct {
	Enabled   bool   `json:"enabled" doc:"Whether outbound deliver debounce is enabled."`
	MaxWaitMs int    `json:"maxWaitMs" doc:"Maximum debounce wait in milliseconds."`
	Separator string `json:"separator,omitempty" doc:"Separator used when merging messages."`
	WindowMs  int    `json:"windowMs" doc:"Debounce window in milliseconds."`
}

type OpenClawQQBotExecApprovalsConfig struct {
	AgentFilter   []string `json:"agentFilter,omitempty" doc:"Agent ids that can use QQBot native approvals."`
	Approvers     []string `json:"approvers,omitempty" doc:"QQ openids allowed to approve exec requests."`
	Enabled       string   `json:"enabled,omitempty" doc:"auto, true, or false."`
	SessionFilter []string `json:"sessionFilter,omitempty" doc:"Session ids allowed to use QQBot native approvals."`
	Target        string   `json:"target,omitempty" doc:"Approval prompt target: dm, channel, or both."`
}

type OpenClawQQBotStreamingConfig struct {
	C2CStreamAPI bool   `json:"c2cStreamApi" doc:"Whether legacy C2C stream API is enabled."`
	Enabled      bool   `json:"enabled" doc:"Whether QQBot streaming delivery is enabled."`
	Mode         string `json:"mode,omitempty" doc:"Streaming mode: off or partial."`
}

type OpenClawQQBotConfigRequest struct {
	Enabled        *bool                       `json:"enabled,omitempty" doc:"QQBot channel enabled switch."`
	Name           *string                     `json:"name,omitempty" doc:"Channel display name. Empty string removes it."`
	AllowFrom      []string                    `json:"allowFrom,omitempty" doc:"Top-level allowFrom entries. Empty array clears override."`
	SystemPrompt   *string                     `json:"systemPrompt,omitempty" doc:"Top-level system prompt. Empty string removes it."`
	DefaultAccount *string                     `json:"defaultAccount,omitempty" doc:"Default QQBot account id. Empty string removes it."`
	STT            *OpenClawQQBotSpeechRequest `json:"stt,omitempty" doc:"Top-level STT config."`
	TTS            *OpenClawQQBotSpeechRequest `json:"tts,omitempty" doc:"Top-level TTS config."`
}

type OpenClawQQBotAccountConfigRequest struct {
	Enabled           *bool                                  `json:"enabled,omitempty" doc:"Account enabled switch."`
	Name              *string                                `json:"name,omitempty" doc:"Account display name. Empty string removes it."`
	AppID             *string                                `json:"appId,omitempty" doc:"New QQBot AppID. Empty string is ignored."`
	ClientSecret      *string                                `json:"clientSecret,omitempty" doc:"New QQBot Client Secret. Empty string is ignored."`
	AllowFrom         []string                               `json:"allowFrom,omitempty" doc:"Account allowFrom entries. Empty array clears override."`
	AudioFormatPolicy *OpenClawQQBotAudioFormatPolicyRequest `json:"audioFormatPolicy,omitempty" doc:"Account audio format policy."`
	DeliverDebounce   *OpenClawQQBotDeliverDebounceRequest   `json:"deliverDebounce,omitempty" doc:"Account outbound debounce config."`
	DMPolicy          *string                                `json:"dmPolicy,omitempty" doc:"Direct-message access policy. Empty string removes it."`
	ExecApprovals     *OpenClawQQBotExecApprovalsRequest     `json:"execApprovals,omitempty" doc:"Account exec approval config."`
	GroupAllowFrom    []string                               `json:"groupAllowFrom,omitempty" doc:"Group allowlist entries. Empty array clears override."`
	GroupPolicy       *string                                `json:"groupPolicy,omitempty" doc:"Group access policy. Empty string removes it."`
	MarkdownSupport   *bool                                  `json:"markdownSupport,omitempty" doc:"Whether QQ markdown delivery is enabled."`
	Streaming         *OpenClawQQBotStreamingRequest         `json:"streaming,omitempty" doc:"Account streaming config."`
	SystemPrompt      *string                                `json:"systemPrompt,omitempty" doc:"Account system prompt. Empty string removes it."`
	STT               *OpenClawQQBotSpeechRequest            `json:"stt,omitempty" doc:"Account STT config."`
	TTS               *OpenClawQQBotSpeechRequest            `json:"tts,omitempty" doc:"Account TTS config."`
	UpgradeMode       *string                                `json:"upgradeMode,omitempty" doc:"/bot-upgrade behavior mode. Empty string removes it."`
	UpgradePkg        *string                                `json:"upgradePkg,omitempty" doc:"Hot reload npm package. Empty string removes it."`
	UpgradeURL        *string                                `json:"upgradeUrl,omitempty" doc:"/bot-upgrade guide URL. Empty string removes it."`
	URLDirectUpload   *bool                                  `json:"urlDirectUpload,omitempty" doc:"Whether public URLs are sent directly to QQ first."`
	AgentID           *string                                `json:"agentId,omitempty" doc:"Agent id routed to this account. Empty string removes binding."`
}

type OpenClawQQBotSpeechRequest struct {
	Enabled      *bool   `json:"enabled,omitempty" doc:"Whether this speech feature is enabled."`
	APIKey       *string `json:"apiKey,omitempty" doc:"API key. Empty string removes it."`
	BaseURL      *string `json:"baseUrl,omitempty" doc:"API base URL. Empty string removes it."`
	Provider     *string `json:"provider,omitempty" doc:"Provider key from models.providers. Empty string removes it."`
	Model        *string `json:"model,omitempty" doc:"Model name. Empty string removes it."`
	Voice        *string `json:"voice,omitempty" doc:"Voice name for TTS. Empty string removes it."`
	ResponseType *string `json:"responseType,omitempty" doc:"Response type for TTS. Empty string removes it."`
}

type OpenClawQQBotAudioFormatPolicyRequest struct {
	STTDirectFormats    []string `json:"sttDirectFormats,omitempty" doc:"Inbound audio formats that can skip STT conversion."`
	TranscodeEnabled    *bool    `json:"transcodeEnabled,omitempty" doc:"Whether audio transcode is enabled."`
	UploadDirectFormats []string `json:"uploadDirectFormats,omitempty" doc:"Outbound audio formats that can skip SILK conversion."`
}

type OpenClawQQBotDeliverDebounceRequest struct {
	Enabled   *bool   `json:"enabled,omitempty" doc:"Whether outbound deliver debounce is enabled."`
	MaxWaitMs *int    `json:"maxWaitMs,omitempty" doc:"Maximum debounce wait in milliseconds."`
	Separator *string `json:"separator,omitempty" doc:"Separator used when merging messages. Empty string removes it."`
	WindowMs  *int    `json:"windowMs,omitempty" doc:"Debounce window in milliseconds."`
}

type OpenClawQQBotExecApprovalsRequest struct {
	AgentFilter   []string `json:"agentFilter,omitempty" doc:"Agent ids that can use QQBot native approvals."`
	Approvers     []string `json:"approvers,omitempty" doc:"QQ openids allowed to approve exec requests."`
	Enabled       *string  `json:"enabled,omitempty" doc:"auto, true, false, or empty to remove."`
	SessionFilter []string `json:"sessionFilter,omitempty" doc:"Session ids allowed to use QQBot native approvals."`
	Target        *string  `json:"target,omitempty" doc:"Approval prompt target: dm, channel, or both. Empty string removes it."`
}

type OpenClawQQBotStreamingRequest struct {
	C2CStreamAPI *bool   `json:"c2cStreamApi,omitempty" doc:"Whether legacy C2C stream API is enabled."`
	Enabled      *bool   `json:"enabled,omitempty" doc:"Whether QQBot streaming delivery is enabled."`
	Mode         *string `json:"mode,omitempty" doc:"Streaming mode: off or partial. Empty string removes it."`
}

type OpenClawQQBotAccountDeleteResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-14T09:00:00Z" doc:"UTC response timestamp."`
	AccountID string `json:"accountId" doc:"Deleted QQBot account id."`
}

func GetOpenClawQQBotStatus(ctx context.Context, input *struct{}) (*OpenClawQQBotStatusOutput, error) {
	_ = ctx
	return &OpenClawQQBotStatusOutput{Body: detectOpenClawQQBotStatus()}, nil
}

func UpdateOpenClawQQBotConfig(ctx context.Context, input *OpenClawQQBotConfigInput) (*OpenClawQQBotConfigOutput, error) {
	_ = ctx
	if input == nil {
		return nil, huma.Error400BadRequest("qqbot config request is required", nil)
	}
	content, err := readOpenClawQQBotConfig()
	if err != nil {
		return nil, huma.Error500InternalServerError("read openclaw config failed", err)
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawQQBotChannelID])
	patch := input.Body
	if patch.Enabled != nil {
		section["enabled"] = *patch.Enabled
	}
	applyStringConfigField(section, "name", patch.Name)
	applyStringConfigField(section, "systemPrompt", patch.SystemPrompt)
	applyStringConfigField(section, "defaultAccount", patch.DefaultAccount)
	if patch.AllowFrom != nil {
		setOpenClawTelegramStringSliceField(section, "allowFrom", patch.AllowFrom)
	}
	if patch.STT != nil {
		patchOpenClawQQBotSpeech(section, "stt", patch.STT)
	}
	if patch.TTS != nil {
		patchOpenClawQQBotSpeech(section, "tts", patch.TTS)
	}
	channels[openClawQQBotChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(openClawConfigPath(), content); err != nil {
		return nil, huma.Error500InternalServerError("write openclaw config failed", err)
	}
	invalidateOpenClawEnvironmentCache()
	return &OpenClawQQBotConfigOutput{Body: detectOpenClawQQBotStatus()}, nil
}

func UpdateOpenClawQQBotAccountConfig(ctx context.Context, input *OpenClawQQBotAccountConfigInput) (*OpenClawQQBotAccountConfigOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("account id is required", nil)
	}
	if err := patchOpenClawQQBotAccount(strings.TrimSpace(input.AccountID), input.Body); err != nil {
		return nil, huma.Error500InternalServerError("update qqbot account config failed", err)
	}
	return &OpenClawQQBotAccountConfigOutput{Body: detectOpenClawQQBotStatus()}, nil
}

func DeleteOpenClawQQBotAccount(ctx context.Context, input *OpenClawQQBotAccountDeleteInput) (*OpenClawQQBotAccountDeleteOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("account id is required", nil)
	}
	accountID := strings.TrimSpace(input.AccountID)
	if err := removeOpenClawQQBotAccount(accountID); err != nil {
		return nil, huma.Error500InternalServerError("delete qqbot account failed", err)
	}
	if err := setOpenClawChannelAccountBinding(openClawQQBotChannelID, accountID, ""); err != nil {
		return nil, huma.Error500InternalServerError("update qqbot account binding failed", err)
	}
	return &OpenClawQQBotAccountDeleteOutput{Body: OpenClawQQBotAccountDeleteResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AccountID: accountID,
	}}, nil
}

func AddOpenClawQQBotAccountStream(ctx context.Context, input *OpenClawQQBotAddStreamInput, send sse.Sender) {
	if input == nil {
		streamOpenClawChannelError(send, "qqbot-add", "add", fmt.Errorf("qqbot account request is required"))
		return
	}
	accountID := strings.TrimSpace(input.AccountID)
	if accountID == "" {
		accountID = "default"
	}
	appID := strings.TrimSpace(input.AppID)
	clientSecret := strings.TrimSpace(input.ClientSecret)
	if appID == "" || clientSecret == "" {
		streamOpenClawChannelError(send, "qqbot-add", "add", fmt.Errorf("AppID 和 Client Secret 不能为空"))
		return
	}
	token := appID + ":" + clientSecret
	streamOpenClawChannelSteps(ctx, send, "qqbot-add", "add", []openClawChannelStep{
		{label: "检查 OpenClaw CLI", progress: 5, timeout: 10 * time.Second, args: []string{"--version"}},
		{label: "检查 QQBot 插件安装状态", progress: 18, run: requireOpenClawQQBotInstalled},
		{label: "添加 QQBot 账号", progress: 42, timeout: 5 * time.Minute, args: []string{"channels", "add", "--channel", openClawQQBotChannelID, "--account", accountID, "--token", token}},
		{label: "写入 QQBot 配置", progress: 72, run: func(ctx context.Context, task openClawChannelLogger) error {
			_ = ctx
			err := patchOpenClawQQBotAccount(accountID, OpenClawQQBotAccountConfigRequest{
				Enabled:      boolPtr(true),
				Name:         stringPtr(input.Name),
				AppID:        stringPtr(appID),
				ClientSecret: stringPtr(clientSecret),
				AllowFrom:    splitOpenClawTelegramList(input.AllowFrom),
				SystemPrompt: stringPtr(input.SystemPrompt),
				STT:          speechRequestFromAddInput(input, true),
				TTS:          speechRequestFromAddInput(input, false),
				AgentID:      stringPtr(input.AgentID),
			})
			if err != nil {
				return err
			}
			task.addLog("已写入 QQBot 账号配置。")
			return nil
		}},
		{label: "重启 Gateway 应用 QQBot 配置", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
}

func InstallOpenClawQQBotStream(ctx context.Context, input *struct{}, send sse.Sender) {
	streamOpenClawChannelSteps(ctx, send, "qqbot-install", "install", []openClawChannelStep{
		{label: "检查 OpenClaw CLI", progress: 5, timeout: 10 * time.Second, args: []string{"--version"}},
		{label: "安装 QQBot 插件", progress: 35, timeout: 10 * time.Minute, run: installOpenClawQQBotPlugin},
		{label: "刷新插件注册表", progress: 78, timeout: 2 * time.Minute, args: []string{"plugins", "registry", "--refresh"}, ignoreMissing: true},
		{label: "重启 Gateway 加载 QQBot 插件", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}, ignoreMissing: true},
	})
}

func UninstallOpenClawQQBotStream(ctx context.Context, input *struct{}, send sse.Sender) {
	streamOpenClawChannelSteps(ctx, send, "qqbot-uninstall", "uninstall", []openClawChannelStep{
		{label: "清理 QQBot 配置残留", progress: 20, run: cleanupOpenClawQQBotConfig},
		{label: "调用 OpenClaw 卸载 QQBot 插件", progress: 46, run: uninstallOpenClawQQBotPluginBestEffort},
		{label: "清理 QQBot 插件安装残留", progress: 78, run: cleanupOpenClawQQBotInstallArtifacts},
		{label: "刷新插件注册表", progress: 94, run: refreshOpenClawQQBotRegistryBestEffort},
	})
}

func requireOpenClawQQBotInstalled(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	if detectOpenClawQQBotStatus().Installed {
		task.addLog("QQBot 插件已安装。")
		return nil
	}
	return fmt.Errorf("QQBot 插件未安装，请先安装插件")
}

func detectOpenClawQQBotStatus() OpenClawQQBotStatusResponse {
	home := defaultOpenClawHomeDir()
	configPath := openClawConfigPath()
	content, exists, configErr := readOpenClawConfigFile(configPath)
	section := objectMap(objectMap(content["channels"])[openClawQQBotChannelID])
	configured := openClawQQBotConfigured(section)
	version := ""
	installed := configured
	for _, pkgPath := range openClawQQBotPackagePaths(home) {
		pkgVersion, ok := readPackageVersion(pkgPath)
		if ok {
			installed = true
			if version == "" {
				version = pkgVersion
			}
		}
	}
	enabled := configured && !hasExplicitFalse(section, "enabled")
	response := OpenClawQQBotStatusResponse{
		Status:     "ok",
		ChannelID:  openClawQQBotChannelID,
		Package:    openClawQQBotPackage,
		Installed:  installed,
		Configured: configured,
		Enabled:    enabled,
		Config:     openClawQQBotConfigFromSection(section),
		Accounts:   []OpenClawQQBotAccountResponse{},
		Version:    version,
	}
	if exists || configured || installed {
		response.ConfigPath = configPath
		response.OpenClawHome = home
	}
	if configErr != nil && !errors.Is(configErr, os.ErrNotExist) {
		response.Status = "error"
		response.Error = configErr.Error()
	}
	if configured {
		response.Accounts = readOpenClawQQBotAccounts(section, readOpenClawChannelAccountBindings(content, openClawQQBotChannelID))
	}
	return response
}

func openClawQQBotConfigFromSection(section map[string]any) OpenClawQQBotConfigResponse {
	allowFrom := stringSliceFromValue(section["allowFrom"])
	return OpenClawQQBotConfigResponse{
		Enabled:        !hasExplicitFalse(section, "enabled"),
		Name:           stringFromMap(section, "name"),
		AllowFrom:      allowFrom,
		AllowFromCount: len(allowFrom),
		AccountCount:   len(objectMap(section["accounts"])),
		SystemPrompt:   stringFromMap(section, "systemPrompt"),
		STT:            openClawQQBotSpeechFromValue(section["stt"]),
		TTS:            openClawQQBotSpeechFromValue(section["tts"]),
		DefaultAccount: stringFromMap(section, "defaultAccount"),
	}
}

func readOpenClawQQBotAccounts(section map[string]any, bindings map[string]string) []OpenClawQQBotAccountResponse {
	accountsCfg := objectMap(section["accounts"])
	ids := make([]string, 0, len(accountsCfg)+1)
	if openClawQQBotTopLevelConfigured(section) || len(accountsCfg) == 0 {
		ids = append(ids, "default")
	}
	for id := range accountsCfg {
		if strings.TrimSpace(id) != "" {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	seen := map[string]bool{}
	accounts := make([]OpenClawQQBotAccountResponse, 0, len(ids))
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		cfg := objectMap(accountsCfg[id])
		if id == "default" && !openClawQQBotAccountConfigured(cfg) {
			cfg = mergeOpenClawQQBotDefaultAccount(section, cfg)
		}
		if !openClawQQBotAccountConfigured(cfg) && id != "default" {
			continue
		}
		accounts = append(accounts, openClawQQBotAccountFromConfig(id, cfg, section, bindings[id]))
	}
	return accounts
}

func openClawQQBotAccountFromConfig(accountID string, cfg map[string]any, parent map[string]any, agentID string) OpenClawQQBotAccountResponse {
	allowFrom := firstNonEmptyStringSlice(stringSliceFromValue(cfg["allowFrom"]), stringSliceFromValue(parent["allowFrom"]))
	groupAllowFrom := firstNonEmptyStringSlice(stringSliceFromValue(cfg["groupAllowFrom"]), stringSliceFromValue(parent["groupAllowFrom"]))
	appID := firstNonEmptyTelegramString(stringFromMap(cfg, "appId"), stringFromMap(cfg, "appID"), stringFromMap(parent, "appId"), stringFromMap(parent, "appID"))
	clientSecret := firstNonEmptyTelegramString(stringFromMap(cfg, "clientSecret"), stringFromMap(parent, "clientSecret"))
	return OpenClawQQBotAccountResponse{
		AccountID:              accountID,
		Name:                   stringFromMap(cfg, "name"),
		Enabled:                !hasExplicitFalse(parent, "enabled") && !hasExplicitFalse(cfg, "enabled"),
		AppIDConfigured:        appID != "",
		ClientSecretConfigured: clientSecret != "",
		AllowFrom:              allowFrom,
		AllowFromCount:         len(allowFrom),
		AudioFormatPolicy:      openClawQQBotAudioFormatPolicyFromValue(firstNonNil(cfg["audioFormatPolicy"], parent["audioFormatPolicy"])),
		DeliverDebounce:        openClawQQBotDeliverDebounceFromValue(firstNonNil(cfg["deliverDebounce"], parent["deliverDebounce"])),
		DMPolicy:               firstNonEmptyTelegramString(stringFromMap(cfg, "dmPolicy"), stringFromMap(parent, "dmPolicy")),
		ExecApprovals:          openClawQQBotExecApprovalsFromValue(firstNonNil(cfg["execApprovals"], parent["execApprovals"])),
		GroupAllowFrom:         groupAllowFrom,
		GroupPolicy:            firstNonEmptyTelegramString(stringFromMap(cfg, "groupPolicy"), stringFromMap(parent, "groupPolicy")),
		MarkdownSupport:        boolFromValueDefault(firstNonNil(cfg["markdownSupport"], parent["markdownSupport"]), true),
		Streaming:              openClawQQBotStreamingFromValue(firstNonNil(cfg["streaming"], parent["streaming"])),
		SystemPrompt:           firstNonEmptyTelegramString(stringFromMap(cfg, "systemPrompt"), stringFromMap(parent, "systemPrompt")),
		STT:                    openClawQQBotSpeechFromValue(firstNonNil(cfg["stt"], parent["stt"])),
		TTS:                    openClawQQBotSpeechFromValue(firstNonNil(cfg["tts"], parent["tts"])),
		UpgradeMode:            firstNonEmptyTelegramString(stringFromMap(cfg, "upgradeMode"), stringFromMap(parent, "upgradeMode")),
		UpgradePkg:             firstNonEmptyTelegramString(stringFromMap(cfg, "upgradePkg"), stringFromMap(parent, "upgradePkg")),
		UpgradeURL:             firstNonEmptyTelegramString(stringFromMap(cfg, "upgradeUrl"), stringFromMap(parent, "upgradeUrl")),
		URLDirectUpload:        boolFromValueDefault(firstNonNil(cfg["urlDirectUpload"], parent["urlDirectUpload"]), true),
		AgentID:                strings.TrimSpace(agentID),
	}
}

func patchOpenClawQQBotAccount(accountID string, patch OpenClawQQBotAccountConfigRequest) error {
	content, err := readOpenClawQQBotConfig()
	if err != nil {
		return err
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawQQBotChannelID])
	section["enabled"] = true
	accounts := objectMap(section["accounts"])
	accountCfg := objectMap(accounts[accountID])
	if patch.Enabled != nil {
		accountCfg["enabled"] = *patch.Enabled
	}
	applyStringConfigField(accountCfg, "name", patch.Name)
	if patch.AppID != nil {
		if value := strings.TrimSpace(*patch.AppID); value != "" {
			accountCfg["appId"] = value
		}
	}
	if patch.ClientSecret != nil {
		if value := strings.TrimSpace(*patch.ClientSecret); value != "" {
			accountCfg["clientSecret"] = value
		}
	}
	applyStringConfigField(accountCfg, "systemPrompt", patch.SystemPrompt)
	if patch.AllowFrom != nil {
		setOpenClawTelegramStringSliceField(accountCfg, "allowFrom", patch.AllowFrom)
	}
	if patch.AudioFormatPolicy != nil {
		patchOpenClawQQBotAudioFormatPolicy(accountCfg, patch.AudioFormatPolicy)
	}
	if patch.DeliverDebounce != nil {
		patchOpenClawQQBotDeliverDebounce(accountCfg, patch.DeliverDebounce)
	}
	applyStringConfigField(accountCfg, "dmPolicy", patch.DMPolicy)
	if patch.ExecApprovals != nil {
		patchOpenClawQQBotExecApprovals(accountCfg, patch.ExecApprovals)
	}
	if patch.GroupAllowFrom != nil {
		setOpenClawTelegramStringSliceField(accountCfg, "groupAllowFrom", patch.GroupAllowFrom)
	}
	applyStringConfigField(accountCfg, "groupPolicy", patch.GroupPolicy)
	if patch.MarkdownSupport != nil {
		accountCfg["markdownSupport"] = *patch.MarkdownSupport
	}
	if patch.Streaming != nil {
		patchOpenClawQQBotStreaming(accountCfg, patch.Streaming)
	}
	if patch.STT != nil {
		patchOpenClawQQBotSpeech(accountCfg, "stt", patch.STT)
	}
	if patch.TTS != nil {
		patchOpenClawQQBotSpeech(accountCfg, "tts", patch.TTS)
	}
	applyStringConfigField(accountCfg, "upgradeMode", patch.UpgradeMode)
	applyStringConfigField(accountCfg, "upgradePkg", patch.UpgradePkg)
	applyStringConfigField(accountCfg, "upgradeUrl", patch.UpgradeURL)
	if patch.URLDirectUpload != nil {
		accountCfg["urlDirectUpload"] = *patch.URLDirectUpload
	}
	accounts[accountID] = accountCfg
	section["accounts"] = accounts
	channels[openClawQQBotChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(openClawConfigPath(), content); err != nil {
		return err
	}
	if patch.AgentID != nil {
		return setOpenClawChannelAccountBinding(openClawQQBotChannelID, accountID, strings.TrimSpace(*patch.AgentID))
	}
	return nil
}

func removeOpenClawQQBotAccount(accountID string) error {
	content, err := readOpenClawQQBotConfig()
	if err != nil {
		return err
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawQQBotChannelID])
	accounts := objectMap(section["accounts"])
	if _, ok := accounts[accountID]; ok {
		delete(accounts, accountID)
		if len(accounts) == 0 {
			delete(section, "accounts")
		} else {
			section["accounts"] = accounts
		}
	}
	if accountID == "default" {
		delete(section, "appId")
		delete(section, "appID")
		delete(section, "clientSecret")
	}
	if !openClawQQBotConfigured(section) {
		delete(channels, openClawQQBotChannelID)
	} else {
		channels[openClawQQBotChannelID] = section
	}
	content["channels"] = channels
	return writeOpenClawConfigContent(openClawConfigPath(), content)
}

func cleanupOpenClawQQBotConfig(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	content, err := readOpenClawConfigForWrite()
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			task.addLog("openclaw.json 不存在，无需清理。")
			return nil
		}
		return err
	}
	changed := false
	channels := objectMap(content["channels"])
	if _, ok := channels[openClawQQBotChannelID]; ok {
		delete(channels, openClawQQBotChannelID)
		content["channels"] = channels
		changed = true
	}
	plugins := objectMap(content["plugins"])
	entries := objectMap(plugins["entries"])
	for _, id := range []string{openClawQQBotChannelID, openClawQQBotPluginID} {
		if _, ok := entries[id]; ok {
			delete(entries, id)
			plugins["entries"] = entries
			content["plugins"] = plugins
			changed = true
		}
	}
	installs := objectMap(plugins["installs"])
	for _, id := range []string{openClawQQBotChannelID, openClawQQBotPluginID} {
		if _, ok := installs[id]; ok {
			delete(installs, id)
			plugins["installs"] = installs
			content["plugins"] = plugins
			changed = true
		}
	}
	if raw, ok := content["bindings"].([]any); ok {
		next := make([]any, 0, len(raw))
		for _, value := range raw {
			item, ok := value.(map[string]any)
			if !ok || stringFromMap(objectMap(item["match"]), "channel") != openClawQQBotChannelID {
				next = append(next, value)
			}
		}
		if len(next) != len(raw) {
			if len(next) == 0 {
				delete(content, "bindings")
			} else {
				content["bindings"] = next
			}
			changed = true
		}
	}
	if changed {
		if err := writeOpenClawConfigContent(openClawConfigPath(), content); err != nil {
			return err
		}
		task.addLog("已清理 QQBot 配置残留。")
	} else {
		task.addLog("没有发现 QQBot 配置残留。")
	}
	return nil
}

func uninstallOpenClawQQBotPluginBestEffort(ctx context.Context, task openClawChannelLogger) error {
	for _, id := range []string{openClawQQBotPluginID, openClawQQBotChannelID} {
		stdout, stderr, err := runOpenClawStreamingCommandTo(ctx, 5*time.Minute, task.addLog, "plugins", "uninstall", id, "--force")
		if err == nil {
			continue
		}
		if openClawCommandBlockedByConfig(stdout, stderr, err) {
			task.addLog("OpenClaw CLI 因配置校验失败未完成卸载，继续清理 QQBot 本地安装残留。")
			continue
		}
		if openClawChannelMissingOutput(stdout, stderr, err) {
			task.addLog("QQBot 插件目标不存在，继续清理本地安装残留。")
			continue
		}
		task.addLog("OpenClaw CLI 卸载未完成，继续清理 QQBot 本地安装残留：" + err.Error())
	}
	return nil
}

func installOpenClawQQBotPlugin(ctx context.Context, task openClawChannelLogger) error {
	if detectOpenClawQQBotStatus().Installed {
		task.addLog("QQBot 插件已安装，跳过安装。")
		return nil
	}
	task.addLog("QQBot 插件包含 child_process 用于音频转换、热更新和命令审批，安装时使用 OpenClaw 官方 unsafe override。")
	_, _, err := runOpenClawStreamingCommandTo(ctx, 10*time.Minute, task.addLog, "plugins", "install", openClawQQBotPackage, "--dangerously-force-unsafe-install")
	return err
}

func cleanupOpenClawQQBotInstallArtifacts(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	home := defaultOpenClawHomeDir()
	removed := 0
	seenDirs := map[string]bool{}
	for _, pkgPath := range openClawQQBotPackagePaths(home) {
		dir := filepath.Dir(pkgPath)
		if dir == "." || dir == "/" || seenDirs[dir] {
			continue
		}
		seenDirs[dir] = true
		if _, err := os.Stat(dir); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return err
		}
		if err := os.RemoveAll(dir); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		removed++
	}
	if err := removeOpenClawQQBotInstallRecords(home); err != nil {
		return err
	}
	if removed > 0 {
		task.addLog(fmt.Sprintf("已清理 %d 个 QQBot 插件安装目录。", removed))
	} else {
		task.addLog("没有发现 QQBot 插件安装目录残留。")
	}
	return nil
}

func removeOpenClawQQBotInstallRecords(home string) error {
	path := filepath.Join(home, "plugins", "installs.json")
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		return err
	}
	records := objectMap(payload["installRecords"])
	changed := false
	for _, id := range []string{openClawQQBotChannelID, openClawQQBotPluginID} {
		if _, ok := records[id]; ok {
			delete(records, id)
			changed = true
		}
	}
	if !changed {
		return nil
	}
	if len(records) == 0 {
		delete(payload, "installRecords")
	} else {
		payload["installRecords"] = records
	}
	formatted, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(formatted, '\n'), 0o600)
}

func refreshOpenClawQQBotRegistryBestEffort(ctx context.Context, task openClawChannelLogger) error {
	stdout, stderr, err := runOpenClawStreamingCommandTo(ctx, 2*time.Minute, task.addLog, "plugins", "registry", "--refresh")
	if err == nil {
		return nil
	}
	if openClawCommandBlockedByConfig(stdout, stderr, err) {
		task.addLog("OpenClaw CLI 因配置校验失败未能刷新插件注册表；QQBot 本地残留已清理。")
		return nil
	}
	task.addLog("插件注册表刷新未完成；QQBot 本地残留已清理：" + err.Error())
	return nil
}

func readOpenClawQQBotConfig() (map[string]any, error) {
	content, _, err := readOpenClawConfigFile(openClawConfigPath())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	return content, nil
}

func openClawQQBotConfigured(section map[string]any) bool {
	if openClawQQBotTopLevelConfigured(section) {
		return true
	}
	for _, value := range objectMap(section["accounts"]) {
		if openClawQQBotAccountConfigured(objectMap(value)) {
			return true
		}
	}
	return false
}

func openClawQQBotTopLevelConfigured(section map[string]any) bool {
	return firstNonEmptyTelegramString(stringFromMap(section, "appId"), stringFromMap(section, "appID")) != "" && stringFromMap(section, "clientSecret") != ""
}

func openClawQQBotAccountConfigured(cfg map[string]any) bool {
	return firstNonEmptyTelegramString(stringFromMap(cfg, "appId"), stringFromMap(cfg, "appID")) != "" && stringFromMap(cfg, "clientSecret") != ""
}

func mergeOpenClawQQBotDefaultAccount(parent map[string]any, cfg map[string]any) map[string]any {
	merged := map[string]any{}
	for key, value := range parent {
		switch key {
		case "accounts", "defaultAccount":
			continue
		default:
			merged[key] = value
		}
	}
	for key, value := range cfg {
		merged[key] = value
	}
	return merged
}

func openClawQQBotPackagePaths(home string) []string {
	paths := []string{
		filepath.Join(home, "extensions", openClawQQBotChannelID, "package.json"),
		filepath.Join(home, "node_modules", "@tencent-connect", "openclaw-qqbot", "package.json"),
		filepath.Join(home, "npm", "node_modules", "@tencent-connect", "openclaw-qqbot", "package.json"),
	}
	if installPath := openClawPluginInstallRecordPath(home, openClawQQBotChannelID); installPath != "" {
		paths = append(paths, filepath.Join(installPath, "package.json"))
	}
	if installPath := openClawPluginInstallRecordPath(home, openClawQQBotPluginID); installPath != "" {
		paths = append(paths, filepath.Join(installPath, "package.json"))
	}
	return paths
}

func openClawQQBotSpeechFromValue(value any) OpenClawQQBotSpeechConfig {
	cfg := objectMap(value)
	return OpenClawQQBotSpeechConfig{
		Enabled:      boolFromMap(cfg, "enabled"),
		APIKey:       stringFromMap(cfg, "apiKey") != "",
		BaseURL:      stringFromMap(cfg, "baseUrl"),
		Provider:     stringFromMap(cfg, "provider"),
		Model:        stringFromMap(cfg, "model"),
		Voice:        stringFromMap(cfg, "voice"),
		ResponseType: stringFromMap(cfg, "responseType"),
	}
}

func openClawQQBotAudioFormatPolicyFromValue(value any) OpenClawQQBotAudioFormatPolicy {
	cfg := objectMap(value)
	return OpenClawQQBotAudioFormatPolicy{
		STTDirectFormats:    stringSliceFromValue(cfg["sttDirectFormats"]),
		TranscodeEnabled:    boolFromValueDefault(cfg["transcodeEnabled"], true),
		UploadDirectFormats: stringSliceFromValue(cfg["uploadDirectFormats"]),
	}
}

func openClawQQBotDeliverDebounceFromValue(value any) OpenClawQQBotDeliverDebounceConfig {
	cfg := objectMap(value)
	return OpenClawQQBotDeliverDebounceConfig{
		Enabled:   boolFromValueDefault(cfg["enabled"], true),
		MaxWaitMs: intFromAny(cfg["maxWaitMs"], 8000),
		Separator: stringFromMap(cfg, "separator"),
		WindowMs:  intFromAny(cfg["windowMs"], 1500),
	}
}

func openClawQQBotExecApprovalsFromValue(value any) OpenClawQQBotExecApprovalsConfig {
	cfg := objectMap(value)
	return OpenClawQQBotExecApprovalsConfig{
		AgentFilter:   stringSliceFromValue(cfg["agentFilter"]),
		Approvers:     stringSliceFromValue(cfg["approvers"]),
		Enabled:       stringFromBoolLike(cfg["enabled"]),
		SessionFilter: stringSliceFromValue(cfg["sessionFilter"]),
		Target:        stringFromMap(cfg, "target"),
	}
}

func openClawQQBotStreamingFromValue(value any) OpenClawQQBotStreamingConfig {
	switch typed := value.(type) {
	case bool:
		if typed {
			return OpenClawQQBotStreamingConfig{C2CStreamAPI: true, Enabled: true, Mode: "partial"}
		}
		return OpenClawQQBotStreamingConfig{Enabled: false, Mode: "off"}
	case string:
		if strings.EqualFold(strings.TrimSpace(typed), "true") {
			return OpenClawQQBotStreamingConfig{C2CStreamAPI: true, Enabled: true, Mode: "partial"}
		}
		if strings.EqualFold(strings.TrimSpace(typed), "partial") {
			return OpenClawQQBotStreamingConfig{C2CStreamAPI: true, Enabled: true, Mode: "partial"}
		}
		return OpenClawQQBotStreamingConfig{Enabled: false, Mode: "off"}
	default:
		cfg := objectMap(value)
		mode := stringFromMap(cfg, "mode")
		enabled := boolFromValueDefault(cfg["enabled"], false)
		if mode == "" && boolFromValueDefault(cfg["c2cStreamApi"], false) {
			mode = "partial"
			enabled = true
		}
		if mode == "" {
			mode = "off"
		}
		if mode == "partial" {
			enabled = true
		}
		if mode == "off" {
			enabled = false
		}
		return OpenClawQQBotStreamingConfig{
			C2CStreamAPI: boolFromValueDefault(cfg["c2cStreamApi"], false),
			Enabled:      enabled,
			Mode:         mode,
		}
	}
}

func patchOpenClawQQBotAudioFormatPolicy(target map[string]any, patch *OpenClawQQBotAudioFormatPolicyRequest) {
	cfg := objectMap(target["audioFormatPolicy"])
	if patch.STTDirectFormats != nil {
		setOpenClawTelegramStringSliceField(cfg, "sttDirectFormats", patch.STTDirectFormats)
	}
	if patch.TranscodeEnabled != nil {
		cfg["transcodeEnabled"] = *patch.TranscodeEnabled
	}
	if patch.UploadDirectFormats != nil {
		setOpenClawTelegramStringSliceField(cfg, "uploadDirectFormats", patch.UploadDirectFormats)
	}
	setOpenClawTelegramObjectField(target, "audioFormatPolicy", cfg)
}

func patchOpenClawQQBotDeliverDebounce(target map[string]any, patch *OpenClawQQBotDeliverDebounceRequest) {
	cfg := objectMap(target["deliverDebounce"])
	if patch.Enabled != nil {
		cfg["enabled"] = *patch.Enabled
	}
	if patch.MaxWaitMs != nil {
		cfg["maxWaitMs"] = *patch.MaxWaitMs
	}
	applyStringConfigField(cfg, "separator", patch.Separator)
	if patch.WindowMs != nil {
		cfg["windowMs"] = *patch.WindowMs
	}
	setOpenClawTelegramObjectField(target, "deliverDebounce", cfg)
}

func patchOpenClawQQBotExecApprovals(target map[string]any, patch *OpenClawQQBotExecApprovalsRequest) {
	cfg := objectMap(target["execApprovals"])
	if patch.AgentFilter != nil {
		setOpenClawTelegramStringSliceField(cfg, "agentFilter", patch.AgentFilter)
	}
	if patch.Approvers != nil {
		setOpenClawTelegramStringSliceField(cfg, "approvers", patch.Approvers)
	}
	if patch.Enabled != nil {
		switch strings.ToLower(strings.TrimSpace(*patch.Enabled)) {
		case "":
			delete(cfg, "enabled")
		case "auto":
			cfg["enabled"] = "auto"
		case "true":
			cfg["enabled"] = true
		case "false":
			cfg["enabled"] = false
		default:
			cfg["enabled"] = strings.TrimSpace(*patch.Enabled)
		}
	}
	if patch.SessionFilter != nil {
		setOpenClawTelegramStringSliceField(cfg, "sessionFilter", patch.SessionFilter)
	}
	applyStringConfigField(cfg, "target", patch.Target)
	setOpenClawTelegramObjectField(target, "execApprovals", cfg)
}

func patchOpenClawQQBotStreaming(target map[string]any, patch *OpenClawQQBotStreamingRequest) {
	cfg := objectMap(target["streaming"])
	if patch.C2CStreamAPI != nil {
		cfg["c2cStreamApi"] = *patch.C2CStreamAPI
	}
	if patch.Enabled != nil {
		cfg["enabled"] = *patch.Enabled
	}
	applyStringConfigField(cfg, "mode", patch.Mode)
	setOpenClawTelegramObjectField(target, "streaming", cfg)
}

func patchOpenClawQQBotSpeech(target map[string]any, key string, patch *OpenClawQQBotSpeechRequest) {
	cfg := objectMap(target[key])
	if patch.Enabled != nil {
		cfg["enabled"] = *patch.Enabled
	}
	applyStringConfigField(cfg, "apiKey", patch.APIKey)
	applyStringConfigField(cfg, "baseUrl", patch.BaseURL)
	applyStringConfigField(cfg, "provider", patch.Provider)
	applyStringConfigField(cfg, "model", patch.Model)
	applyStringConfigField(cfg, "voice", patch.Voice)
	applyStringConfigField(cfg, "responseType", patch.ResponseType)
	setOpenClawTelegramObjectField(target, key, cfg)
}

func speechRequestFromAddInput(input *OpenClawQQBotAddStreamInput, stt bool) *OpenClawQQBotSpeechRequest {
	if input == nil {
		return nil
	}
	if stt {
		return &OpenClawQQBotSpeechRequest{
			Enabled:  boolPtr(input.STTEnabled),
			APIKey:   stringPtr(input.STTAPIKey),
			BaseURL:  stringPtr(input.STTBaseURL),
			Provider: stringPtr(input.STTProvider),
			Model:    stringPtr(input.STTModel),
		}
	}
	return &OpenClawQQBotSpeechRequest{
		Enabled:      boolPtr(input.TTSEnabled),
		APIKey:       stringPtr(input.TTSAPIKey),
		BaseURL:      stringPtr(input.TTSBaseURL),
		Provider:     stringPtr(input.TTSProvider),
		Model:        stringPtr(input.TTSModel),
		Voice:        stringPtr(input.TTSVoice),
		ResponseType: stringPtr(input.TTSResponseType),
	}
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func boolFromValueDefault(value any, fallback bool) bool {
	switch typed := value.(type) {
	case nil:
		return fallback
	case bool:
		return typed
	case string:
		if strings.EqualFold(strings.TrimSpace(typed), "true") {
			return true
		}
		if strings.EqualFold(strings.TrimSpace(typed), "false") {
			return false
		}
		return fallback
	default:
		text := strings.TrimSpace(fmt.Sprint(typed))
		if strings.EqualFold(text, "true") {
			return true
		}
		if strings.EqualFold(text, "false") {
			return false
		}
		return fallback
	}
}

func boolPtr(value bool) *bool {
	return &value
}

func stringPtr(value string) *string {
	return &value
}
