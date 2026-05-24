package openclaw

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/sse"
)

const (
	openClawWeComChannelID  = "wecom"
	openClawWeComPluginID   = "wecom-openclaw-plugin"
	openClawWeComPackage    = "@wecom/wecom-openclaw-plugin"
	openClawWeComQRQueryURL = "https://work.weixin.qq.com/ai/qc/query_result"
)

type OpenClawWeComStatusOutput struct {
	Body OpenClawWeComStatusResponse
}

type OpenClawWeComConfigInput struct {
	Body OpenClawWeComConfigRequest
}

type OpenClawWeComConfigOutput struct {
	Body OpenClawWeComStatusResponse
}

type OpenClawWeComAccountConfigInput struct {
	AccountID string `path:"accountId" doc:"WeCom account id." example:"main"`
	Body      OpenClawWeComAccountConfigRequest
}

type OpenClawWeComAccountConfigOutput struct {
	Body OpenClawWeComStatusResponse
}

type OpenClawWeComAccountDeleteInput struct {
	AccountID string `path:"accountId" doc:"WeCom account id." example:"main"`
}

type OpenClawWeComAccountDeleteOutput struct {
	Body OpenClawWeComAccountDeleteResponse
}

type OpenClawWeComAddStreamInput struct {
	AccountID                string `query:"accountId" doc:"WeCom account id. Empty uses default." example:"default"`
	AgentID                  string `query:"agentId" doc:"Agent id routed to this account."`
	AllowFrom                string `query:"allowFrom" doc:"Comma or newline separated WeCom user ids."`
	BotID                    string `query:"botId" doc:"WeCom bot id for websocket mode."`
	ConnectionMode           string `query:"connectionMode" enum:"websocket,webhook" doc:"Bot connection mode."`
	EncodingAESKey           string `query:"encodingAESKey" doc:"Bot webhook EncodingAESKey."`
	GroupAllowFrom           string `query:"groupAllowFrom" doc:"Comma or newline separated WeCom group ids."`
	GroupPolicy              string `query:"groupPolicy" enum:"open,allowlist,disabled" doc:"Group access policy."`
	Name                     string `query:"name" doc:"Account display name."`
	ReceiveID                string `query:"receiveId" doc:"Webhook receive id."`
	Secret                   string `query:"secret" doc:"WeCom bot secret for websocket mode."`
	SendThinkingMessage      bool   `query:"sendThinkingMessage" doc:"Whether thinking placeholder messages are sent."`
	Token                    string `query:"token" doc:"Bot webhook token."`
	WebsocketURL             string `query:"websocketUrl" doc:"Custom websocket endpoint."`
	WelcomeText              string `query:"welcomeText" doc:"Webhook welcome text."`
	StreamPlaceholderContent string `query:"streamPlaceholderContent" doc:"Streaming placeholder content."`

	AgentCorpID         string `query:"agentCorpId" doc:"WeCom enterprise CorpID."`
	AgentCorpSecret     string `query:"agentCorpSecret" doc:"WeCom app CorpSecret."`
	AgentAgentID        string `query:"agentAgentId" doc:"WeCom app AgentId."`
	AgentToken          string `query:"agentToken" doc:"Agent callback token."`
	AgentEncodingAESKey string `query:"agentEncodingAESKey" doc:"Agent callback EncodingAESKey."`
	AgentWelcomeText    string `query:"agentWelcomeText" doc:"Agent welcome text."`
	AgentDMPolicy       string `query:"agentDmPolicy" enum:"inherit,open,pairing,allowlist,disabled" doc:"Agent DM policy override."`
	AgentAllowFrom      string `query:"agentAllowFrom" doc:"Agent DM allowlist."`

	DMPolicy              string `query:"dmPolicy" enum:"open,pairing,allowlist,disabled" doc:"DM access policy."`
	DynamicAdminUsers     string `query:"dynamicAdminUsers" doc:"Dynamic Agent admin users."`
	DynamicAgentsEnabled  bool   `query:"dynamicAgentsEnabled" doc:"Whether dynamic Agent routing is enabled."`
	DynamicDMCreateAgent  bool   `query:"dynamicDmCreateAgent" doc:"Whether DM creates isolated agents."`
	DynamicGroupEnabled   bool   `query:"dynamicGroupEnabled" doc:"Whether group dynamic Agent routing is enabled."`
	GroupsJSON            string `query:"groupsJson" doc:"Raw groups override JSON object."`
	MediaCleanupOnStart   bool   `query:"mediaCleanupOnStart" doc:"Whether media temp cleanup runs on start."`
	MediaLocalRoots       string `query:"mediaLocalRoots" doc:"Comma or newline separated local media roots."`
	MediaMaxBytes         string `query:"mediaMaxBytes" doc:"Max media bytes."`
	MediaRetentionHours   string `query:"mediaRetentionHours" doc:"Media retention hours."`
	MediaTempDir          string `query:"mediaTempDir" doc:"Media temp directory."`
	NetworkEgressProxyURL string `query:"networkEgressProxyUrl" doc:"Network egress proxy URL."`
	NetworkRetries        string `query:"networkRetries" doc:"Network retry count."`
	NetworkRetryDelayMs   string `query:"networkRetryDelayMs" doc:"Network retry delay in ms."`
	NetworkTimeoutMs      string `query:"networkTimeoutMs" doc:"Network timeout in ms."`
}

type OpenClawWeComStatusResponse struct {
	Status       string                         `json:"status" example:"ok" doc:"Operation status."`
	ChannelID    string                         `json:"channelId" example:"wecom" doc:"OpenClaw channel id."`
	Package      string                         `json:"package" example:"@wecom/wecom-openclaw-plugin" doc:"Official npm package name."`
	Installed    bool                           `json:"installed" example:"true" doc:"Whether WeCom appears installed from local files, install records, or config."`
	Configured   bool                           `json:"configured" example:"true" doc:"Whether WeCom credentials are configured."`
	Enabled      bool                           `json:"enabled" example:"true" doc:"Whether channels.wecom.enabled is true."`
	Config       OpenClawWeComConfigResponse    `json:"config" doc:"WeCom channel config without secrets."`
	Accounts     []OpenClawWeComAccountResponse `json:"accounts" doc:"Configured WeCom accounts without secrets."`
	ConfigPath   string                         `json:"configPath,omitempty" doc:"OpenClaw config path."`
	OpenClawHome string                         `json:"openClawHome,omitempty" doc:"OpenClaw home directory."`
	Version      string                         `json:"version,omitempty" doc:"Installed package version when readable."`
	Error        string                         `json:"error,omitempty" doc:"Config read error."`
}

type OpenClawWeComConfigResponse struct {
	AccountCount         int    `json:"accountCount" doc:"Configured account count."`
	AllowFromCount       int    `json:"allowFromCount" doc:"Top-level allowFrom count."`
	BotConfigured        bool   `json:"botConfigured" doc:"Whether top-level bot credentials or webhook credentials are configured."`
	ConnectionMode       string `json:"connectionMode,omitempty" doc:"Bot connection mode."`
	DefaultAccount       string `json:"defaultAccount,omitempty" doc:"Default account id."`
	DMPolicy             string `json:"dmPolicy,omitempty" doc:"Default DM policy."`
	DynamicAgentsEnabled bool   `json:"dynamicAgentsEnabled" doc:"Whether dynamic Agent routing is enabled."`
	Enabled              bool   `json:"enabled" doc:"Whether channel is enabled."`
	GroupAllowFromCount  int    `json:"groupAllowFromCount" doc:"Top-level group allowlist count."`
	GroupPolicy          string `json:"groupPolicy,omitempty" doc:"Default group policy."`
	Name                 string `json:"name,omitempty" doc:"Channel display name."`
}

type OpenClawWeComAccountResponse struct {
	AccountID                string                                   `json:"accountId" example:"main" doc:"WeCom account id."`
	Agent                    OpenClawWeComAgentConfigResponse         `json:"agent" doc:"Agent mode config without secrets."`
	AgentID                  string                                   `json:"agentId,omitempty" doc:"Agent routed to this account."`
	AllowFrom                []string                                 `json:"allowFrom,omitempty" doc:"Effective DM allowlist."`
	AllowFromCount           int                                      `json:"allowFromCount" doc:"DM allowlist count."`
	BotIDConfigured          bool                                     `json:"botIdConfigured" doc:"Whether botId is configured."`
	ConnectionMode           string                                   `json:"connectionMode,omitempty" doc:"Connection mode."`
	DMPolicy                 string                                   `json:"dmPolicy,omitempty" doc:"DM policy."`
	Enabled                  bool                                     `json:"enabled" doc:"Whether account is enabled."`
	EncodingAESKeyConfigured bool                                     `json:"encodingAESKeyConfigured" doc:"Whether webhook EncodingAESKey is configured."`
	GroupAllowFrom           []string                                 `json:"groupAllowFrom,omitempty" doc:"Effective group allowlist."`
	GroupAllowFromCount      int                                      `json:"groupAllowFromCount" doc:"Group allowlist count."`
	GroupCount               int                                      `json:"groupCount" doc:"Group override count."`
	GroupPolicy              string                                   `json:"groupPolicy,omitempty" doc:"Group policy."`
	Groups                   map[string]any                           `json:"groups,omitempty" doc:"Group overrides."`
	Media                    OpenClawWeComMediaConfigResponse         `json:"media" doc:"Media config."`
	MediaLocalRoots          []string                                 `json:"mediaLocalRoots,omitempty" doc:"Allowed local media roots."`
	Name                     string                                   `json:"name,omitempty" doc:"Display name."`
	Network                  OpenClawWeComNetworkConfigResponse       `json:"network" doc:"Network config."`
	ReceiveID                string                                   `json:"receiveId,omitempty" doc:"Webhook receive id."`
	SecretConfigured         bool                                     `json:"secretConfigured" doc:"Whether bot secret is configured."`
	SendThinkingMessage      bool                                     `json:"sendThinkingMessage" doc:"Whether thinking placeholder messages are sent."`
	StreamPlaceholderContent string                                   `json:"streamPlaceholderContent,omitempty" doc:"Streaming placeholder content."`
	TokenConfigured          bool                                     `json:"tokenConfigured" doc:"Whether webhook token is configured."`
	WebsocketURL             string                                   `json:"websocketUrl,omitempty" doc:"WebSocket endpoint."`
	WelcomeText              string                                   `json:"welcomeText,omitempty" doc:"Webhook welcome text."`
	DynamicAgents            OpenClawWeComDynamicAgentsConfigResponse `json:"dynamicAgents" doc:"Dynamic Agent config."`
}

type OpenClawWeComAgentConfigResponse struct {
	AgentID                  string   `json:"agentId,omitempty" doc:"WeCom AgentId."`
	AllowFrom                []string `json:"allowFrom,omitempty" doc:"Agent DM allowlist."`
	AllowFromCount           int      `json:"allowFromCount" doc:"Agent DM allowlist count."`
	Configured               bool     `json:"configured" doc:"Whether agent mode credentials are configured."`
	CorpIDConfigured         bool     `json:"corpIdConfigured" doc:"Whether CorpID is configured."`
	CorpSecretConfigured     bool     `json:"corpSecretConfigured" doc:"Whether CorpSecret is configured."`
	DMPolicy                 string   `json:"dmPolicy,omitempty" doc:"Agent DM policy."`
	EncodingAESKeyConfigured bool     `json:"encodingAESKeyConfigured" doc:"Whether callback EncodingAESKey is configured."`
	TokenConfigured          bool     `json:"tokenConfigured" doc:"Whether callback token is configured."`
	WelcomeText              string   `json:"welcomeText,omitempty" doc:"Agent welcome text."`
}

type OpenClawWeComMediaConfigResponse struct {
	CleanupOnStart bool   `json:"cleanupOnStart" doc:"Whether cleanup runs on start."`
	MaxBytes       int    `json:"maxBytes,omitempty" doc:"Maximum media bytes."`
	RetentionHours int    `json:"retentionHours,omitempty" doc:"Media retention hours."`
	TempDir        string `json:"tempDir,omitempty" doc:"Media temp directory."`
}

type OpenClawWeComNetworkConfigResponse struct {
	EgressProxyURL string `json:"egressProxyUrl,omitempty" doc:"Egress proxy URL."`
	Retries        int    `json:"retries,omitempty" doc:"Retry count."`
	RetryDelayMs   int    `json:"retryDelayMs,omitempty" doc:"Retry delay in ms."`
	TimeoutMs      int    `json:"timeoutMs,omitempty" doc:"Timeout in ms."`
}

type OpenClawWeComDynamicAgentsConfigResponse struct {
	AdminUsers    []string `json:"adminUsers,omitempty" doc:"Admin users bypassing dynamic routing."`
	Enabled       bool     `json:"enabled" doc:"Whether dynamic Agent routing is enabled."`
	DMCreateAgent bool     `json:"dmCreateAgent" doc:"Whether DM creates isolated agents."`
	GroupEnabled  bool     `json:"groupEnabled" doc:"Whether group dynamic routing is enabled."`
}

type OpenClawWeComConfigRequest struct {
	DefaultAccount *string `json:"defaultAccount,omitempty" doc:"Default account id. Empty string clears it."`
	DMPolicy       *string `json:"dmPolicy,omitempty" enum:"open,pairing,allowlist,disabled" doc:"Default DM policy."`
	Enabled        *bool   `json:"enabled,omitempty" doc:"Channel enabled switch."`
	GroupPolicy    *string `json:"groupPolicy,omitempty" enum:"open,allowlist,disabled" doc:"Default group policy."`
	Name           *string `json:"name,omitempty" doc:"Channel display name. Empty string clears it."`
}

type OpenClawWeComAccountConfigRequest struct {
	AgentID                  *string        `json:"agentId,omitempty" doc:"Agent id routed to this account. Empty string removes binding."`
	AllowFrom                []string       `json:"allowFrom,omitempty" doc:"DM allowlist. Empty array clears it."`
	BotID                    *string        `json:"botId,omitempty" doc:"Bot id. Empty string clears it."`
	ConnectionMode           *string        `json:"connectionMode,omitempty" enum:"websocket,webhook" doc:"Connection mode."`
	EncodingAESKey           *string        `json:"encodingAESKey,omitempty" doc:"Bot webhook EncodingAESKey. Empty string clears it."`
	Enabled                  *bool          `json:"enabled,omitempty" doc:"Account enabled switch."`
	GroupAllowFrom           []string       `json:"groupAllowFrom,omitempty" doc:"Group allowlist. Empty array clears it."`
	GroupPolicy              *string        `json:"groupPolicy,omitempty" enum:"open,allowlist,disabled" doc:"Group policy."`
	Groups                   map[string]any `json:"groups,omitempty" doc:"Group overrides. Empty object clears it."`
	Name                     *string        `json:"name,omitempty" doc:"Display name. Empty string clears it."`
	ReceiveID                *string        `json:"receiveId,omitempty" doc:"Webhook receive id. Empty string clears it."`
	Secret                   *string        `json:"secret,omitempty" doc:"Bot secret. Empty string clears it."`
	SendThinkingMessage      *bool          `json:"sendThinkingMessage,omitempty" doc:"Whether thinking placeholder messages are sent."`
	StreamPlaceholderContent *string        `json:"streamPlaceholderContent,omitempty" doc:"Streaming placeholder content. Empty string clears it."`
	Token                    *string        `json:"token,omitempty" doc:"Bot webhook token. Empty string clears it."`
	WebsocketURL             *string        `json:"websocketUrl,omitempty" doc:"WebSocket endpoint. Empty string clears it."`
	WelcomeText              *string        `json:"welcomeText,omitempty" doc:"Webhook welcome text. Empty string clears it."`

	Agent           *OpenClawWeComAgentConfigRequest         `json:"agent,omitempty" doc:"Agent mode config."`
	DMPolicy        *string                                  `json:"dmPolicy,omitempty" enum:"open,pairing,allowlist,disabled" doc:"DM policy."`
	DynamicAgents   *OpenClawWeComDynamicAgentsConfigRequest `json:"dynamicAgents,omitempty" doc:"Dynamic Agent config."`
	Media           *OpenClawWeComMediaConfigRequest         `json:"media,omitempty" doc:"Media config."`
	MediaLocalRoots []string                                 `json:"mediaLocalRoots,omitempty" doc:"Allowed local media roots. Empty array clears it."`
	Network         *OpenClawWeComNetworkConfigRequest       `json:"network,omitempty" doc:"Network config."`
}

type OpenClawWeComAgentConfigRequest struct {
	AgentID        *string  `json:"agentId,omitempty" doc:"WeCom AgentId. Empty string clears it."`
	AllowFrom      []string `json:"allowFrom,omitempty" doc:"Agent DM allowlist. Empty array clears it."`
	CorpID         *string  `json:"corpId,omitempty" doc:"CorpID. Empty string clears it."`
	CorpSecret     *string  `json:"corpSecret,omitempty" doc:"CorpSecret. Empty string clears it."`
	DMPolicy       *string  `json:"dmPolicy,omitempty" enum:"inherit,open,pairing,allowlist,disabled" doc:"Agent DM policy."`
	EncodingAESKey *string  `json:"encodingAESKey,omitempty" doc:"Callback EncodingAESKey. Empty string clears it."`
	Token          *string  `json:"token,omitempty" doc:"Callback token. Empty string clears it."`
	WelcomeText    *string  `json:"welcomeText,omitempty" doc:"Welcome text. Empty string clears it."`
}

type OpenClawWeComMediaConfigRequest struct {
	CleanupOnStart *bool   `json:"cleanupOnStart,omitempty" doc:"Whether cleanup runs on start."`
	MaxBytes       *int    `json:"maxBytes,omitempty" doc:"Maximum media bytes."`
	RetentionHours *int    `json:"retentionHours,omitempty" doc:"Media retention hours."`
	TempDir        *string `json:"tempDir,omitempty" doc:"Media temp directory. Empty string clears it."`
}

type OpenClawWeComNetworkConfigRequest struct {
	EgressProxyURL *string `json:"egressProxyUrl,omitempty" doc:"Egress proxy URL. Empty string clears it."`
	Retries        *int    `json:"retries,omitempty" doc:"Retry count."`
	RetryDelayMs   *int    `json:"retryDelayMs,omitempty" doc:"Retry delay in ms."`
	TimeoutMs      *int    `json:"timeoutMs,omitempty" doc:"Timeout in ms."`
}

type OpenClawWeComDynamicAgentsConfigRequest struct {
	AdminUsers    []string `json:"adminUsers,omitempty" doc:"Admin users. Empty array clears it."`
	Enabled       *bool    `json:"enabled,omitempty" doc:"Whether dynamic Agent routing is enabled."`
	DMCreateAgent *bool    `json:"dmCreateAgent,omitempty" doc:"Whether DM creates isolated agents."`
	GroupEnabled  *bool    `json:"groupEnabled,omitempty" doc:"Whether group dynamic routing is enabled."`
}

type OpenClawWeComAccountDeleteResponse struct {
	AccountID string `json:"accountId" doc:"Deleted WeCom account id."`
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-15T09:00:00Z" doc:"UTC response timestamp."`
}

func GetOpenClawWeComStatus(ctx context.Context, input *struct{}) (*OpenClawWeComStatusOutput, error) {
	_ = ctx
	return &OpenClawWeComStatusOutput{Body: detectOpenClawWeComStatus()}, nil
}

func UpdateOpenClawWeComConfig(ctx context.Context, input *OpenClawWeComConfigInput) (*OpenClawWeComConfigOutput, error) {
	_ = ctx
	if input == nil {
		return nil, huma.Error400BadRequest("wecom config request is required", nil)
	}
	content, err := readOrCreateOpenClawConfig()
	if err != nil {
		return nil, huma.Error500InternalServerError("read openclaw config failed", err)
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawWeComChannelID])
	if input.Body.Enabled != nil {
		section["enabled"] = *input.Body.Enabled
		plugins := objectMap(content["plugins"])
		entries := objectMap(plugins["entries"])
		entry := objectMap(entries[openClawWeComPluginID])
		if len(entry) > 0 {
			entry["enabled"] = *input.Body.Enabled
			entries[openClawWeComPluginID] = entry
			plugins["entries"] = entries
			content["plugins"] = plugins
		}
	}
	setOptionalWeComString(section, "name", input.Body.Name, true)
	setOptionalWeComString(section, "defaultAccount", input.Body.DefaultAccount, true)
	if input.Body.DMPolicy != nil {
		if err := setOpenClawWeComPolicy(section, "dmPolicy", *input.Body.DMPolicy, allowedOpenClawWeComDMPolicy); err != nil {
			return nil, huma.Error400BadRequest(err.Error(), err)
		}
	}
	if input.Body.GroupPolicy != nil {
		if err := setOpenClawWeComPolicy(section, "groupPolicy", *input.Body.GroupPolicy, allowedOpenClawWeComGroupPolicy); err != nil {
			return nil, huma.Error400BadRequest(err.Error(), err)
		}
	}
	channels[openClawWeComChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(openClawConfigPath(), content); err != nil {
		return nil, huma.Error500InternalServerError("write openclaw config failed", err)
	}
	return &OpenClawWeComConfigOutput{Body: detectOpenClawWeComStatus()}, nil
}

func UpdateOpenClawWeComAccountConfig(ctx context.Context, input *OpenClawWeComAccountConfigInput) (*OpenClawWeComAccountConfigOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("wecom account id is required", nil)
	}
	if err := patchOpenClawWeComAccount(strings.TrimSpace(input.AccountID), input.Body); err != nil {
		return nil, huma.Error400BadRequest(err.Error(), err)
	}
	return &OpenClawWeComAccountConfigOutput{Body: detectOpenClawWeComStatus()}, nil
}

func DeleteOpenClawWeComAccount(ctx context.Context, input *OpenClawWeComAccountDeleteInput) (*OpenClawWeComAccountDeleteOutput, error) {
	_ = ctx
	accountID := strings.TrimSpace(input.AccountID)
	if accountID == "" {
		return nil, huma.Error400BadRequest("wecom account id is required", nil)
	}
	if err := removeOpenClawWeComAccount(accountID); err != nil {
		return nil, huma.Error500InternalServerError("delete wecom account failed", err)
	}
	return &OpenClawWeComAccountDeleteOutput{Body: OpenClawWeComAccountDeleteResponse{
		AccountID: accountID,
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}}, nil
}

func InstallOpenClawWeComStream(ctx context.Context, input *struct{}, send sse.Sender) {
	streamOpenClawChannelSteps(ctx, send, "wecom-install", "install", []openClawChannelStep{
		{label: "安装企业微信官方插件", progress: 35, timeout: 5 * time.Minute, args: []string{"plugins", "install", openClawWeComPackage}},
		{label: "启用企业微信插件配置", progress: 72, run: enableOpenClawWeComPluginEntry},
		{label: "重启 Gateway 加载企业微信插件", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
}

func AddOpenClawWeComAccountStream(ctx context.Context, input *OpenClawWeComAddStreamInput, send sse.Sender) {
	if input == nil {
		streamOpenClawChannelError(send, "wecom-add", "add", fmt.Errorf("wecom account request is required"))
		return
	}
	accountID := strings.TrimSpace(input.AccountID)
	if accountID == "" {
		accountID = "default"
	}
	patch, err := buildOpenClawWeComPatchFromAddInput(input)
	if err != nil {
		streamOpenClawChannelError(send, "wecom-add", "add", err)
		return
	}
	streamOpenClawChannelSteps(ctx, send, "wecom-add", "add", []openClawChannelStep{
		{label: "检查 OpenClaw CLI", progress: 5, timeout: 10 * time.Second, args: []string{"--version"}},
		{label: "写入企业微信账号配置", progress: 45, run: func(ctx context.Context, task openClawChannelLogger) error {
			_ = ctx
			if err := patchOpenClawWeComAccount(accountID, patch); err != nil {
				return err
			}
			task.addLog("已写入 channels.wecom.accounts." + accountID)
			return nil
		}},
		{label: "启用企业微信插件配置", progress: 72, run: enableOpenClawWeComPluginEntry},
		{label: "重启 Gateway 应用企业微信配置", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
}

func ScanAddOpenClawWeComStream(ctx context.Context, input *struct{}, send sse.Sender) {
	streamOpenClawChannelSteps(ctx, send, "wecom-scan-add", "scan", []openClawChannelStep{
		{label: "检查企业微信插件安装状态", progress: 10, run: requireOpenClawWeComInstalled},
		{label: "扫码添加企业微信机器人", progress: 35, timeout: 6 * time.Minute, run: runOpenClawWeComScanAdd},
		{label: "启用企业微信插件配置", progress: 82, run: enableOpenClawWeComPluginEntry},
		{label: "重启 Gateway 应用企业微信配置", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
}

func UninstallOpenClawWeComStream(ctx context.Context, input *struct{}, send sse.Sender) {
	streamOpenClawChannelSteps(ctx, send, "wecom-uninstall", "uninstall", []openClawChannelStep{
		{label: "卸载企业微信官方插件", progress: 35, timeout: 5 * time.Minute, args: []string{"plugins", "uninstall", openClawWeComPluginID, "--force"}, ignoreMissing: true},
		{label: "清理企业微信插件配置残留", progress: 70, run: cleanupOpenClawWeComConfig},
		{label: "清理企业微信插件安装残留", progress: 82, run: cleanupOpenClawWeComInstallArtifacts},
		{label: "刷新插件注册表", progress: 90, timeout: 2 * time.Minute, args: []string{"plugins", "registry", "--refresh"}, ignoreMissing: true},
	})
}

func detectOpenClawWeComStatus() OpenClawWeComStatusResponse {
	home := defaultOpenClawHomeDir()
	configPath := openClawConfigPath()
	content, exists, configErr := readOpenClawConfigFile(configPath)
	section := objectMap(objectMap(content["channels"])[openClawWeComChannelID])
	configured := openClawWeComConfigured(section)
	version := ""
	installed := configured
	for _, pkgPath := range openClawWeComPackagePaths(home) {
		pkgVersion, ok := readPackageVersion(pkgPath)
		if ok {
			installed = true
			if version == "" {
				version = pkgVersion
			}
		}
	}
	response := OpenClawWeComStatusResponse{
		Status:     "ok",
		ChannelID:  openClawWeComChannelID,
		Package:    openClawWeComPackage,
		Installed:  installed,
		Configured: configured,
		Enabled:    configured && boolFromMap(section, "enabled"),
		Config:     openClawWeComConfigFromSection(section),
		Accounts:   []OpenClawWeComAccountResponse{},
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
		response.Accounts = readOpenClawWeComAccounts(section, readOpenClawChannelAccountBindings(content, openClawWeComChannelID))
	}
	return response
}

func openClawWeComConfigFromSection(section map[string]any) OpenClawWeComConfigResponse {
	dynamicAgents := objectMap(section["dynamicAgents"])
	return OpenClawWeComConfigResponse{
		AccountCount:         len(objectMap(section["accounts"])),
		AllowFromCount:       len(stringSliceFromValue(section["allowFrom"])),
		BotConfigured:        openClawWeComBotConfigured(section),
		ConnectionMode:       firstNonEmptyWeComString(stringFromMap(section, "connectionMode"), "websocket"),
		DefaultAccount:       stringFromMap(section, "defaultAccount"),
		DMPolicy:             firstNonEmptyWeComString(stringFromMap(section, "dmPolicy"), "open"),
		DynamicAgentsEnabled: boolFromMap(dynamicAgents, "enabled"),
		Enabled:              boolFromMap(section, "enabled"),
		GroupAllowFromCount:  len(stringSliceFromValue(section["groupAllowFrom"])),
		GroupPolicy:          firstNonEmptyWeComString(stringFromMap(section, "groupPolicy"), "open"),
		Name:                 stringFromMap(section, "name"),
	}
}

func readOpenClawWeComAccounts(section map[string]any, bindings map[string]string) []OpenClawWeComAccountResponse {
	accountsCfg := objectMap(section["accounts"])
	if len(accountsCfg) == 0 && openClawWeComConfigured(section) {
		return []OpenClawWeComAccountResponse{openClawWeComAccountFromConfig("default", section, section, bindings["default"])}
	}
	ids := make([]string, 0, len(accountsCfg))
	for id := range accountsCfg {
		if strings.TrimSpace(id) != "" {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	accounts := make([]OpenClawWeComAccountResponse, 0, len(ids))
	for _, id := range ids {
		cfg := objectMap(accountsCfg[id])
		if !openClawWeComConfigured(cfg) && len(cfg) == 0 {
			continue
		}
		accounts = append(accounts, openClawWeComAccountFromConfig(id, cfg, section, bindings[id]))
	}
	return accounts
}

func openClawWeComAccountFromConfig(accountID string, cfg map[string]any, parent map[string]any, agentID string) OpenClawWeComAccountResponse {
	allowFrom := firstNonEmptyStringSlice(stringSliceFromValue(cfg["allowFrom"]), stringSliceFromValue(parent["allowFrom"]))
	groupAllowFrom := firstNonEmptyStringSlice(stringSliceFromValue(cfg["groupAllowFrom"]), stringSliceFromValue(parent["groupAllowFrom"]))
	groups := firstNonEmptyWeComObjectMap(objectMap(cfg["groups"]), objectMap(parent["groups"]))
	agentCfg := firstNonEmptyWeComObjectMap(objectMap(cfg["agent"]), objectMap(parent["agent"]))
	mediaCfg := firstNonEmptyWeComObjectMap(objectMap(cfg["media"]), objectMap(parent["media"]))
	networkCfg := firstNonEmptyWeComObjectMap(objectMap(cfg["network"]), objectMap(parent["network"]))
	dynamicCfg := firstNonEmptyWeComObjectMap(objectMap(cfg["dynamicAgents"]), objectMap(parent["dynamicAgents"]))
	agentAllowFrom := stringSliceFromValue(agentCfg["allowFrom"])
	return OpenClawWeComAccountResponse{
		AccountID:                accountID,
		Agent:                    openClawWeComAgentConfigFromMap(agentCfg, agentAllowFrom),
		AgentID:                  strings.TrimSpace(agentID),
		AllowFrom:                allowFrom,
		AllowFromCount:           len(allowFrom),
		BotIDConfigured:          firstNonEmptyWeComString(stringFromMap(cfg, "botId"), stringFromMap(parent, "botId")) != "",
		ConnectionMode:           firstNonEmptyWeComString(stringFromMap(cfg, "connectionMode"), stringFromMap(parent, "connectionMode"), "websocket"),
		DMPolicy:                 firstNonEmptyWeComString(stringFromMap(cfg, "dmPolicy"), stringFromMap(parent, "dmPolicy"), "open"),
		Enabled:                  !hasExplicitFalse(cfg, "enabled") && !hasExplicitFalse(parent, "enabled"),
		EncodingAESKeyConfigured: firstNonEmptyWeComString(stringFromMap(cfg, "encodingAESKey"), stringFromMap(parent, "encodingAESKey")) != "",
		GroupAllowFrom:           groupAllowFrom,
		GroupAllowFromCount:      len(groupAllowFrom),
		GroupCount:               len(groups),
		GroupPolicy:              firstNonEmptyWeComString(stringFromMap(cfg, "groupPolicy"), stringFromMap(parent, "groupPolicy"), "open"),
		Groups:                   groups,
		Media:                    openClawWeComMediaFromMap(mediaCfg),
		MediaLocalRoots:          firstNonEmptyStringSlice(stringSliceFromValue(cfg["mediaLocalRoots"]), stringSliceFromValue(parent["mediaLocalRoots"])),
		Name:                     firstNonEmptyWeComString(stringFromMap(cfg, "name"), stringFromMap(parent, "name")),
		Network:                  openClawWeComNetworkFromMap(networkCfg),
		ReceiveID:                firstNonEmptyWeComString(stringFromMap(cfg, "receiveId"), stringFromMap(parent, "receiveId")),
		SecretConfigured:         firstNonEmptyWeComString(stringFromMap(cfg, "secret"), stringFromMap(parent, "secret")) != "",
		SendThinkingMessage:      !hasExplicitFalse(firstNonEmptyWeComObjectMap(cfg, parent), "sendThinkingMessage"),
		StreamPlaceholderContent: firstNonEmptyWeComString(stringFromMap(cfg, "streamPlaceholderContent"), stringFromMap(parent, "streamPlaceholderContent")),
		TokenConfigured:          firstNonEmptyWeComString(stringFromMap(cfg, "token"), stringFromMap(parent, "token")) != "",
		WebsocketURL:             firstNonEmptyWeComString(stringFromMap(cfg, "websocketUrl"), stringFromMap(parent, "websocketUrl"), "wss://openws.work.weixin.qq.com"),
		WelcomeText:              firstNonEmptyWeComString(stringFromMap(cfg, "welcomeText"), stringFromMap(parent, "welcomeText")),
		DynamicAgents:            openClawWeComDynamicAgentsFromMap(dynamicCfg),
	}
}

func openClawWeComAgentConfigFromMap(agentCfg map[string]any, allowFrom []string) OpenClawWeComAgentConfigResponse {
	return OpenClawWeComAgentConfigResponse{
		AgentID:                  stringFromMap(agentCfg, "agentId"),
		AllowFrom:                allowFrom,
		AllowFromCount:           len(allowFrom),
		Configured:               openClawWeComAgentConfigured(agentCfg),
		CorpIDConfigured:         stringFromMap(agentCfg, "corpId") != "",
		CorpSecretConfigured:     stringFromMap(agentCfg, "corpSecret") != "",
		DMPolicy:                 stringFromMap(agentCfg, "dmPolicy"),
		EncodingAESKeyConfigured: stringFromMap(agentCfg, "encodingAESKey") != "",
		TokenConfigured:          stringFromMap(agentCfg, "token") != "",
		WelcomeText:              stringFromMap(agentCfg, "welcomeText"),
	}
}

func openClawWeComMediaFromMap(media map[string]any) OpenClawWeComMediaConfigResponse {
	return OpenClawWeComMediaConfigResponse{
		CleanupOnStart: boolFromMap(media, "cleanupOnStart"),
		MaxBytes:       intFromAny(media["maxBytes"], 0),
		RetentionHours: intFromAny(media["retentionHours"], 0),
		TempDir:        stringFromMap(media, "tempDir"),
	}
}

func openClawWeComNetworkFromMap(network map[string]any) OpenClawWeComNetworkConfigResponse {
	return OpenClawWeComNetworkConfigResponse{
		EgressProxyURL: stringFromMap(network, "egressProxyUrl"),
		Retries:        intFromAny(network["retries"], 0),
		RetryDelayMs:   intFromAny(network["retryDelayMs"], 0),
		TimeoutMs:      intFromAny(network["timeoutMs"], 0),
	}
}

func openClawWeComDynamicAgentsFromMap(dynamic map[string]any) OpenClawWeComDynamicAgentsConfigResponse {
	return OpenClawWeComDynamicAgentsConfigResponse{
		AdminUsers:    stringSliceFromValue(dynamic["adminUsers"]),
		Enabled:       boolFromMap(dynamic, "enabled"),
		DMCreateAgent: !hasExplicitFalse(dynamic, "dmCreateAgent"),
		GroupEnabled:  !hasExplicitFalse(dynamic, "groupEnabled"),
	}
}

func buildOpenClawWeComPatchFromAddInput(input *OpenClawWeComAddStreamInput) (OpenClawWeComAccountConfigRequest, error) {
	connectionMode := firstNonEmptyWeComString(input.ConnectionMode, "websocket")
	if !allowedOpenClawWeComConnectionMode(connectionMode) {
		return OpenClawWeComAccountConfigRequest{}, fmt.Errorf("unsupported connectionMode %q", connectionMode)
	}
	dmPolicy := firstNonEmptyWeComString(input.DMPolicy, "open")
	if !allowedOpenClawWeComDMPolicy(dmPolicy) {
		return OpenClawWeComAccountConfigRequest{}, fmt.Errorf("unsupported dmPolicy %q", dmPolicy)
	}
	groupPolicy := firstNonEmptyWeComString(input.GroupPolicy, "open")
	if !allowedOpenClawWeComGroupPolicy(groupPolicy) {
		return OpenClawWeComAccountConfigRequest{}, fmt.Errorf("unsupported groupPolicy %q", groupPolicy)
	}
	if dmPolicy == "allowlist" && len(splitOpenClawWeComList(input.AllowFrom)) == 0 {
		return OpenClawWeComAccountConfigRequest{}, fmt.Errorf("allowlist 策略需要至少一个企业微信用户 ID")
	}
	if groupPolicy == "allowlist" && len(splitOpenClawWeComList(input.GroupAllowFrom)) == 0 {
		return OpenClawWeComAccountConfigRequest{}, fmt.Errorf("群聊 allowlist 策略需要至少一个群 ID")
	}
	if connectionMode == "websocket" && strings.TrimSpace(input.BotID) == "" && strings.TrimSpace(input.Secret) == "" && !hasOpenClawWeComAgentInput(input) {
		return OpenClawWeComAccountConfigRequest{}, fmt.Errorf("WebSocket 模式至少需要 botId/secret，或同时配置 Agent 模式")
	}
	if connectionMode == "webhook" && strings.TrimSpace(input.Token) == "" && strings.TrimSpace(input.EncodingAESKey) == "" && !hasOpenClawWeComAgentInput(input) {
		return OpenClawWeComAccountConfigRequest{}, fmt.Errorf("Webhook 模式至少需要 token/encodingAESKey，或同时配置 Agent 模式")
	}
	groups, err := parseOptionalOpenClawDingTalkObject(input.GroupsJSON, "groupsJson")
	if err != nil {
		return OpenClawWeComAccountConfigRequest{}, err
	}
	mediaMaxBytes, err := parseOptionalOpenClawDingTalkInt(input.MediaMaxBytes, "mediaMaxBytes", 1)
	if err != nil {
		return OpenClawWeComAccountConfigRequest{}, err
	}
	mediaRetentionHours, err := parseOptionalOpenClawDingTalkInt(input.MediaRetentionHours, "mediaRetentionHours", 1)
	if err != nil {
		return OpenClawWeComAccountConfigRequest{}, err
	}
	networkTimeoutMs, err := parseOptionalOpenClawDingTalkInt(input.NetworkTimeoutMs, "networkTimeoutMs", 1)
	if err != nil {
		return OpenClawWeComAccountConfigRequest{}, err
	}
	networkRetries, err := parseOptionalOpenClawDingTalkInt(input.NetworkRetries, "networkRetries", 0)
	if err != nil {
		return OpenClawWeComAccountConfigRequest{}, err
	}
	networkRetryDelayMs, err := parseOptionalOpenClawDingTalkInt(input.NetworkRetryDelayMs, "networkRetryDelayMs", 0)
	if err != nil {
		return OpenClawWeComAccountConfigRequest{}, err
	}
	return OpenClawWeComAccountConfigRequest{
		AgentID:                  &input.AgentID,
		AllowFrom:                splitOpenClawWeComList(input.AllowFrom),
		BotID:                    &input.BotID,
		ConnectionMode:           &connectionMode,
		EncodingAESKey:           &input.EncodingAESKey,
		Enabled:                  boolPtr(true),
		GroupAllowFrom:           splitOpenClawWeComList(input.GroupAllowFrom),
		GroupPolicy:              &groupPolicy,
		Groups:                   groups,
		Name:                     &input.Name,
		ReceiveID:                &input.ReceiveID,
		Secret:                   &input.Secret,
		SendThinkingMessage:      &input.SendThinkingMessage,
		StreamPlaceholderContent: &input.StreamPlaceholderContent,
		Token:                    &input.Token,
		WebsocketURL:             &input.WebsocketURL,
		WelcomeText:              &input.WelcomeText,
		Agent: &OpenClawWeComAgentConfigRequest{
			AgentID:        &input.AgentAgentID,
			AllowFrom:      splitOpenClawWeComList(input.AgentAllowFrom),
			CorpID:         &input.AgentCorpID,
			CorpSecret:     &input.AgentCorpSecret,
			DMPolicy:       &input.AgentDMPolicy,
			EncodingAESKey: &input.AgentEncodingAESKey,
			Token:          &input.AgentToken,
			WelcomeText:    &input.AgentWelcomeText,
		},
		DMPolicy: &dmPolicy,
		DynamicAgents: &OpenClawWeComDynamicAgentsConfigRequest{
			AdminUsers:    splitOpenClawWeComList(input.DynamicAdminUsers),
			Enabled:       &input.DynamicAgentsEnabled,
			DMCreateAgent: &input.DynamicDMCreateAgent,
			GroupEnabled:  &input.DynamicGroupEnabled,
		},
		Media: &OpenClawWeComMediaConfigRequest{
			CleanupOnStart: &input.MediaCleanupOnStart,
			MaxBytes:       mediaMaxBytes,
			RetentionHours: mediaRetentionHours,
			TempDir:        &input.MediaTempDir,
		},
		MediaLocalRoots: splitOpenClawWeComList(input.MediaLocalRoots),
		Network: &OpenClawWeComNetworkConfigRequest{
			EgressProxyURL: &input.NetworkEgressProxyURL,
			Retries:        networkRetries,
			RetryDelayMs:   networkRetryDelayMs,
			TimeoutMs:      networkTimeoutMs,
		},
	}, nil
}

func patchOpenClawWeComAccount(accountID string, patch OpenClawWeComAccountConfigRequest) error {
	content, err := readOrCreateOpenClawConfig()
	if err != nil {
		return err
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawWeComChannelID])
	section["enabled"] = true
	accounts := objectMap(section["accounts"])
	accountCfg := objectMap(accounts[accountID])
	if patch.Enabled != nil {
		accountCfg["enabled"] = *patch.Enabled
	}
	setOptionalWeComString(accountCfg, "name", patch.Name, true)
	setOptionalWeComString(accountCfg, "botId", patch.BotID, true)
	setOptionalWeComString(accountCfg, "secret", patch.Secret, true)
	setOptionalWeComString(accountCfg, "token", patch.Token, true)
	setOptionalWeComString(accountCfg, "encodingAESKey", patch.EncodingAESKey, true)
	setOptionalWeComString(accountCfg, "receiveId", patch.ReceiveID, true)
	setOptionalWeComString(accountCfg, "websocketUrl", patch.WebsocketURL, true)
	setOptionalWeComString(accountCfg, "welcomeText", patch.WelcomeText, true)
	setOptionalWeComString(accountCfg, "streamPlaceholderContent", patch.StreamPlaceholderContent, true)
	if patch.ConnectionMode != nil {
		if err := setOpenClawWeComPolicy(accountCfg, "connectionMode", *patch.ConnectionMode, allowedOpenClawWeComConnectionMode); err != nil {
			return err
		}
	}
	if patch.DMPolicy != nil {
		if err := setOpenClawWeComPolicy(accountCfg, "dmPolicy", *patch.DMPolicy, allowedOpenClawWeComDMPolicy); err != nil {
			return err
		}
	}
	if patch.GroupPolicy != nil {
		if err := setOpenClawWeComPolicy(accountCfg, "groupPolicy", *patch.GroupPolicy, allowedOpenClawWeComGroupPolicy); err != nil {
			return err
		}
	}
	if patch.SendThinkingMessage != nil {
		accountCfg["sendThinkingMessage"] = *patch.SendThinkingMessage
	}
	if patch.AllowFrom != nil {
		setOpenClawWeComStringList(accountCfg, "allowFrom", patch.AllowFrom)
	}
	if patch.GroupAllowFrom != nil {
		setOpenClawWeComStringList(accountCfg, "groupAllowFrom", patch.GroupAllowFrom)
	}
	if patch.Groups != nil {
		if len(patch.Groups) > 0 {
			accountCfg["groups"] = patch.Groups
		} else {
			delete(accountCfg, "groups")
		}
	}
	if patch.Agent != nil {
		if err := patchOpenClawWeComAgent(accountCfg, *patch.Agent); err != nil {
			return err
		}
	}
	if patch.Media != nil {
		media := objectMap(accountCfg["media"])
		if patch.Media.CleanupOnStart != nil {
			media["cleanupOnStart"] = *patch.Media.CleanupOnStart
		}
		if patch.Media.MaxBytes != nil {
			media["maxBytes"] = *patch.Media.MaxBytes
		}
		if patch.Media.RetentionHours != nil {
			media["retentionHours"] = *patch.Media.RetentionHours
		}
		setOptionalWeComString(media, "tempDir", patch.Media.TempDir, true)
		if len(media) > 0 {
			accountCfg["media"] = media
		}
	}
	if patch.Network != nil {
		network := objectMap(accountCfg["network"])
		setOptionalWeComString(network, "egressProxyUrl", patch.Network.EgressProxyURL, true)
		if patch.Network.Retries != nil {
			network["retries"] = *patch.Network.Retries
		}
		if patch.Network.RetryDelayMs != nil {
			network["retryDelayMs"] = *patch.Network.RetryDelayMs
		}
		if patch.Network.TimeoutMs != nil {
			network["timeoutMs"] = *patch.Network.TimeoutMs
		}
		if len(network) > 0 {
			accountCfg["network"] = network
		}
	}
	if patch.DynamicAgents != nil {
		dynamicAgents := objectMap(accountCfg["dynamicAgents"])
		if patch.DynamicAgents.Enabled != nil {
			dynamicAgents["enabled"] = *patch.DynamicAgents.Enabled
		}
		if patch.DynamicAgents.DMCreateAgent != nil {
			dynamicAgents["dmCreateAgent"] = *patch.DynamicAgents.DMCreateAgent
		}
		if patch.DynamicAgents.GroupEnabled != nil {
			dynamicAgents["groupEnabled"] = *patch.DynamicAgents.GroupEnabled
		}
		if patch.DynamicAgents.AdminUsers != nil {
			setOpenClawWeComStringList(dynamicAgents, "adminUsers", patch.DynamicAgents.AdminUsers)
		}
		if len(dynamicAgents) > 0 {
			accountCfg["dynamicAgents"] = dynamicAgents
		}
	}
	if patch.MediaLocalRoots != nil {
		setOpenClawWeComStringList(accountCfg, "mediaLocalRoots", patch.MediaLocalRoots)
	}
	accounts[accountID] = accountCfg
	section["accounts"] = accounts
	channels[openClawWeComChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(openClawConfigPath(), content); err != nil {
		return err
	}
	if patch.AgentID != nil {
		return setOpenClawChannelAccountBinding(openClawWeComChannelID, accountID, strings.TrimSpace(*patch.AgentID))
	}
	return nil
}

func patchOpenClawWeComAgent(accountCfg map[string]any, patch OpenClawWeComAgentConfigRequest) error {
	agent := objectMap(accountCfg["agent"])
	setOptionalWeComString(agent, "corpId", patch.CorpID, true)
	setOptionalWeComString(agent, "corpSecret", patch.CorpSecret, true)
	setOptionalWeComString(agent, "agentId", patch.AgentID, true)
	setOptionalWeComString(agent, "token", patch.Token, true)
	setOptionalWeComString(agent, "encodingAESKey", patch.EncodingAESKey, true)
	setOptionalWeComString(agent, "welcomeText", patch.WelcomeText, true)
	if patch.DMPolicy != nil {
		if err := setOpenClawWeComPolicy(agent, "dmPolicy", *patch.DMPolicy, allowedOpenClawWeComDMPolicy); err != nil {
			return err
		}
	}
	if patch.AllowFrom != nil {
		setOpenClawWeComStringList(agent, "allowFrom", patch.AllowFrom)
	}
	if len(agent) > 0 {
		accountCfg["agent"] = agent
	} else {
		delete(accountCfg, "agent")
	}
	return nil
}

func removeOpenClawWeComAccount(accountID string) error {
	content, _, err := readOpenClawConfigFile(openClawConfigPath())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawWeComChannelID])
	accounts := objectMap(section["accounts"])
	delete(accounts, accountID)
	section["accounts"] = accounts
	channels[openClawWeComChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(openClawConfigPath(), content); err != nil {
		return err
	}
	return setOpenClawChannelAccountBinding(openClawWeComChannelID, accountID, "")
}

func enableOpenClawWeComPluginEntry(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	content, err := readOrCreateOpenClawConfig()
	if err != nil {
		return err
	}
	plugins := objectMap(content["plugins"])
	entries := objectMap(plugins["entries"])
	entry := objectMap(entries[openClawWeComPluginID])
	entry["enabled"] = true
	entries[openClawWeComPluginID] = entry
	plugins["entries"] = entries
	content["plugins"] = plugins
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawWeComChannelID])
	section["enabled"] = true
	channels[openClawWeComChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(openClawConfigPath(), content); err != nil {
		return err
	}
	task.addLog("已启用 plugins.entries." + openClawWeComPluginID + " 和 channels.wecom。")
	return nil
}

func requireOpenClawWeComInstalled(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	status := detectOpenClawWeComStatus()
	if !status.Installed {
		return fmt.Errorf("企业微信插件未安装，请先执行安装")
	}
	task.addLog("企业微信插件已安装。")
	return nil
}

type openClawWeComQRGenerateResponse struct {
	Data struct {
		AuthURL string `json:"auth_url"`
		SCode   string `json:"scode"`
	} `json:"data"`
}

type openClawWeComQRQueryResponse struct {
	Data struct {
		Status  string `json:"status"`
		BotInfo struct {
			BotID  string `json:"botid"`
			Secret string `json:"secret"`
		} `json:"bot_info"`
	} `json:"data"`
}

type openClawWeComScanCredentials struct {
	BotID  string
	Secret string
}

func runOpenClawWeComScanAdd(ctx context.Context, task openClawChannelLogger) error {
	qr, err := fetchOpenClawWeComQRCode(ctx)
	if err != nil {
		return err
	}
	task.addLog("企业微信扫码授权 URL: " + qr.Data.AuthURL)
	task.addLog("企业微信二维码页面: " + openClawWeComQRCodePage(qr.Data.SCode))
	task.addLog("请使用企业微信扫描二维码，选择或创建机器人。")

	creds, err := pollOpenClawWeComQRCode(ctx, qr.Data.SCode)
	if err != nil {
		return err
	}
	accountID, err := saveOpenClawWeComBotCredentials("", creds.BotID, creds.Secret)
	if err != nil {
		return err
	}
	task.addLog("企业微信机器人配置成功：" + maskOpenClawWeComCredential(creds.BotID))
	task.addLog("已写入 channels.wecom.accounts." + accountID)
	task.addLog("扫码授权已完成，未重复执行插件安装。")
	return nil
}

func fetchOpenClawWeComQRCode(ctx context.Context) (openClawWeComQRGenerateResponse, error) {
	var payload openClawWeComQRGenerateResponse
	if err := getOpenClawWeComJSON(ctx, openClawWeComQRGenerateURL(), &payload); err != nil {
		return payload, err
	}
	if strings.TrimSpace(payload.Data.SCode) == "" || strings.TrimSpace(payload.Data.AuthURL) == "" {
		return payload, fmt.Errorf("企业微信扫码初始化失败：缺少 scode 或二维码 URL")
	}
	return payload, nil
}

func pollOpenClawWeComQRCode(ctx context.Context, scode string) (openClawWeComScanCredentials, error) {
	const pollInterval = 3 * time.Second
	deadline := time.Now().Add(5 * time.Minute)
	queryURL := openClawWeComQRQueryURL + "?scode=" + url.QueryEscape(strings.TrimSpace(scode))
	var lastStatus string
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return openClawWeComScanCredentials{}, ctx.Err()
		case <-time.After(pollInterval):
		}
		var payload openClawWeComQRQueryResponse
		if err := getOpenClawWeComJSON(ctx, queryURL, &payload); err != nil {
			return openClawWeComScanCredentials{}, err
		}
		lastStatus = strings.TrimSpace(payload.Data.Status)
		if lastStatus == "success" {
			botID := strings.TrimSpace(payload.Data.BotInfo.BotID)
			secret := strings.TrimSpace(payload.Data.BotInfo.Secret)
			if botID == "" || secret == "" {
				return openClawWeComScanCredentials{}, fmt.Errorf("企业微信扫码成功但未返回 Bot ID 或 Secret")
			}
			return openClawWeComScanCredentials{BotID: botID, Secret: secret}, nil
		}
	}
	if lastStatus != "" {
		return openClawWeComScanCredentials{}, fmt.Errorf("企业微信扫码超时，请重新扫码（最后状态：%s）", lastStatus)
	}
	return openClawWeComScanCredentials{}, fmt.Errorf("企业微信扫码超时，请重新扫码")
}

func saveOpenClawWeComBotCredentials(accountID string, botID string, secret string) (string, error) {
	content, err := readOrCreateOpenClawConfig()
	if err != nil {
		return "", err
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawWeComChannelID])
	section["enabled"] = true
	accounts := objectMap(section["accounts"])
	if strings.TrimSpace(accountID) == "" {
		accountID = uniqueOpenClawWeComAccountID(accounts, botID)
	}
	accountCfg := objectMap(accounts[accountID])
	accountCfg["enabled"] = true
	accountCfg["connectionMode"] = "websocket"
	if stringFromMap(accountCfg, "name") == "" {
		accountCfg["name"] = accountID
	}
	accountCfg["botId"] = strings.TrimSpace(botID)
	accountCfg["secret"] = strings.TrimSpace(secret)
	accounts[accountID] = accountCfg
	section["accounts"] = accounts
	delete(section, "botId")
	delete(section, "secret")
	channels[openClawWeComChannelID] = section
	content["channels"] = channels

	plugins := objectMap(content["plugins"])
	entries := objectMap(plugins["entries"])
	entry := objectMap(entries[openClawWeComPluginID])
	entry["enabled"] = true
	entries[openClawWeComPluginID] = entry
	plugins["entries"] = entries
	content["plugins"] = plugins

	if err := writeOpenClawConfigContent(openClawConfigPath(), content); err != nil {
		return "", err
	}
	return accountID, nil
}

func getOpenClawWeComJSON(ctx context.Context, requestURL string, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("企业微信扫码接口返回 HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	if err := json.Unmarshal(data, target); err != nil {
		return err
	}
	return nil
}

func openClawWeComQRGenerateURL() string {
	return fmt.Sprintf("https://work.weixin.qq.com/ai/qc/generate?source=wecom-dashboard&plat=%d", openClawWeComPlatformCode())
}

func openClawWeComQRCodePage(scode string) string {
	return "https://work.weixin.qq.com/ai/qc/gen?source=wecom-dashboard&scode=" + url.QueryEscape(strings.TrimSpace(scode))
}

func openClawWeComPlatformCode() int {
	switch runtime.GOOS {
	case "darwin":
		return 1
	case "windows":
		return 2
	case "linux":
		return 3
	default:
		return 0
	}
}

func uniqueOpenClawWeComAccountID(accounts map[string]any, botID string) string {
	base := openClawWeComAccountIDFromBotID(botID)
	if base == "" {
		base = "wecom-bot"
	}
	if _, exists := accounts[base]; !exists {
		return base
	}
	for index := 2; index < 1000; index++ {
		candidate := fmt.Sprintf("%s-%d", base, index)
		if _, exists := accounts[candidate]; !exists {
			return candidate
		}
	}
	return fmt.Sprintf("%s-%d", base, time.Now().Unix())
}

func openClawWeComAccountIDFromBotID(botID string) string {
	clean := strings.Builder{}
	lastDash := false
	for _, value := range strings.ToLower(strings.TrimSpace(botID)) {
		if (value >= 'a' && value <= 'z') || (value >= '0' && value <= '9') {
			clean.WriteRune(value)
			lastDash = false
			continue
		}
		if clean.Len() > 0 && !lastDash {
			clean.WriteRune('-')
			lastDash = true
		}
	}
	result := strings.Trim(clean.String(), "-")
	if result == "" {
		return ""
	}
	if len(result) > 18 {
		result = result[len(result)-18:]
		result = strings.TrimLeft(result, "-")
	}
	return "bot-" + result
}

func maskOpenClawWeComCredential(value string) string {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) <= 8 {
		return "<hidden>"
	}
	return trimmed[:4] + "..." + trimmed[len(trimmed)-4:]
}

func cleanupOpenClawWeComConfig(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	content, exists, err := readOpenClawConfigFile(openClawConfigPath())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			task.addLog("没有发现 openclaw.json。")
			return nil
		}
		return err
	}
	if !exists {
		task.addLog("没有发现 openclaw.json。")
		return nil
	}
	changed := false
	channels := objectMap(content["channels"])
	if _, ok := channels[openClawWeComChannelID]; ok {
		delete(channels, openClawWeComChannelID)
		content["channels"] = channels
		changed = true
		task.addLog("已移除 channels.wecom。")
	}
	plugins := objectMap(content["plugins"])
	entries := objectMap(plugins["entries"])
	if _, ok := entries[openClawWeComPluginID]; ok {
		delete(entries, openClawWeComPluginID)
		plugins["entries"] = entries
		content["plugins"] = plugins
		changed = true
		task.addLog("已移除 plugins.entries." + openClawWeComPluginID + "。")
	}
	installs := objectMap(plugins["installs"])
	if _, ok := installs[openClawWeComPluginID]; ok {
		delete(installs, openClawWeComPluginID)
		plugins["installs"] = installs
		content["plugins"] = plugins
		changed = true
		task.addLog("已移除 plugins.installs." + openClawWeComPluginID + "。")
	}
	bindings, ok := content["bindings"].([]any)
	if ok {
		filtered := make([]any, 0, len(bindings))
		for _, value := range bindings {
			item := objectMap(value)
			if stringFromMap(objectMap(item["match"]), "channel") == openClawWeComChannelID {
				changed = true
				continue
			}
			filtered = append(filtered, value)
		}
		if changed {
			content["bindings"] = filtered
		}
	}
	if !changed {
		task.addLog("没有发现企业微信插件配置残留。")
		return nil
	}
	return writeOpenClawConfigContent(openClawConfigPath(), content)
}

func cleanupOpenClawWeComInstallArtifacts(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	home := defaultOpenClawHomeDir()
	removed := 0
	for _, path := range []string{
		filepath.Join(home, "extensions", openClawWeComPluginID),
		filepath.Join(home, "node_modules", "@wecom", "wecom-openclaw-plugin"),
		filepath.Join(home, "npm", "node_modules", "@wecom", "wecom-openclaw-plugin"),
	} {
		if _, err := os.Stat(path); err != nil {
			continue
		}
		if err := os.RemoveAll(path); err != nil {
			return err
		}
		removed++
		task.addLog("已删除 " + path)
	}
	if err := removeOpenClawWeComInstallRecord(home); err != nil {
		return err
	}
	if removed == 0 {
		task.addLog("没有发现企业微信插件安装目录残留。")
	}
	return nil
}

func removeOpenClawWeComInstallRecord(home string) error {
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
	if _, ok := records[openClawWeComPluginID]; !ok {
		return nil
	}
	delete(records, openClawWeComPluginID)
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

func openClawWeComPackagePaths(home string) []string {
	paths := []string{
		filepath.Join(home, "extensions", openClawWeComPluginID, "package.json"),
		filepath.Join(home, "node_modules", "@wecom", "wecom-openclaw-plugin", "package.json"),
		filepath.Join(home, "npm", "node_modules", "@wecom", "wecom-openclaw-plugin", "package.json"),
	}
	if installPath := openClawPluginInstallRecordPath(home, openClawWeComPluginID); installPath != "" {
		paths = append(paths, filepath.Join(installPath, "package.json"))
	}
	return paths
}

func openClawWeComConfigured(section map[string]any) bool {
	if len(objectMap(section["accounts"])) > 0 {
		return true
	}
	return openClawWeComBotConfigured(section) || openClawWeComAgentConfigured(objectMap(section["agent"]))
}

func openClawWeComBotConfigured(section map[string]any) bool {
	return (stringFromMap(section, "botId") != "" && stringFromMap(section, "secret") != "") ||
		(stringFromMap(section, "token") != "" && stringFromMap(section, "encodingAESKey") != "")
}

func openClawWeComAgentConfigured(agent map[string]any) bool {
	return stringFromMap(agent, "corpId") != "" &&
		stringFromMap(agent, "corpSecret") != "" &&
		stringFromMap(agent, "token") != "" &&
		stringFromMap(agent, "encodingAESKey") != ""
}

func hasOpenClawWeComAgentInput(input *OpenClawWeComAddStreamInput) bool {
	return strings.TrimSpace(input.AgentCorpID) != "" ||
		strings.TrimSpace(input.AgentCorpSecret) != "" ||
		strings.TrimSpace(input.AgentToken) != "" ||
		strings.TrimSpace(input.AgentEncodingAESKey) != ""
}

func setOptionalWeComString(target map[string]any, key string, value *string, clearOnEmpty bool) {
	if value == nil {
		return
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		if clearOnEmpty {
			delete(target, key)
		}
		return
	}
	target[key] = trimmed
}

func setOpenClawWeComPolicy(target map[string]any, key string, value string, allowed func(string) bool) error {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || trimmed == "inherit" {
		delete(target, key)
		return nil
	}
	if !allowed(trimmed) {
		return fmt.Errorf("unsupported %s %q", key, trimmed)
	}
	target[key] = trimmed
	return nil
}

func setOpenClawWeComStringList(target map[string]any, key string, values []string) {
	clean := dedupeOpenClawTelegramStrings(values)
	if len(clean) > 0 {
		target[key] = clean
	} else {
		delete(target, key)
	}
}

func splitOpenClawWeComList(value string) []string {
	return splitOpenClawTelegramList(value)
}

func firstNonEmptyWeComString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstNonEmptyWeComObjectMap(values ...map[string]any) map[string]any {
	for _, value := range values {
		if len(value) > 0 {
			return value
		}
	}
	return nil
}

func allowedOpenClawWeComConnectionMode(value string) bool {
	switch value {
	case "websocket", "webhook":
		return true
	default:
		return false
	}
}

func allowedOpenClawWeComDMPolicy(value string) bool {
	switch value {
	case "open", "pairing", "allowlist", "disabled":
		return true
	default:
		return false
	}
}

func allowedOpenClawWeComGroupPolicy(value string) bool {
	switch value {
	case "open", "allowlist", "disabled":
		return true
	default:
		return false
	}
}
