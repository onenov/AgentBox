package openclaw

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"agent-box-server/internal/httpapi/toolenv"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/sse"
)

const (
	openClawDingTalkChannelID = "dingtalk-connector"
	openClawDingTalkPackage   = "@dingtalk-real-ai/dingtalk-connector"
)

type OpenClawDingTalkStatusOutput struct {
	Body OpenClawDingTalkStatusResponse
}

type OpenClawDingTalkConfigInput struct {
	Body OpenClawDingTalkConfigRequest
}

type OpenClawDingTalkConfigOutput struct {
	Body OpenClawDingTalkStatusResponse
}

type OpenClawDingTalkAccountConfigInput struct {
	AccountID string `path:"accountId" doc:"DingTalk account id." example:"main-bot"`
	Body      OpenClawDingTalkAccountConfigRequest
}

type OpenClawDingTalkAccountConfigOutput struct {
	Body OpenClawDingTalkStatusResponse
}

type OpenClawDingTalkAccountDeleteInput struct {
	AccountID string `path:"accountId" doc:"DingTalk account id." example:"main-bot"`
}

type OpenClawDingTalkAccountDeleteOutput struct {
	Body OpenClawDingTalkAccountDeleteResponse
}

type OpenClawDingTalkAddStreamInput struct {
	AccountID                       string `query:"accountId" doc:"DingTalk account id. Empty uses default." example:"main-bot"`
	AckText                         string `query:"ackText" doc:"Async mode acknowledgement text."`
	AgentID                         string `query:"agentId" doc:"Agent id routed to this account."`
	AllowFrom                       string `query:"allowFrom" doc:"Comma or newline separated DingTalk user ids."`
	AsyncMode                       bool   `query:"asyncMode" doc:"Whether async mode is enabled."`
	ChatbotCorpID                   string `query:"chatbotCorpId" doc:"Bot corp id for multi-Agent collaboration."`
	ChatbotUserID                   string `query:"chatbotUserId" doc:"Bot chatbot user id for multi-Agent collaboration."`
	ClientID                        string `query:"clientId" doc:"DingTalk AppKey / Client ID."`
	ClientSecret                    string `query:"clientSecret" doc:"DingTalk AppSecret / Client Secret."`
	Debug                           bool   `query:"debug" doc:"Whether debug logging is enabled."`
	DMPolicy                        string `query:"dmPolicy" enum:"pairing,allowlist,open,disabled" example:"pairing" doc:"DingTalk DM access policy."`
	EnableMediaUpload               bool   `query:"enableMediaUpload" doc:"Whether media upload is enabled."`
	Endpoint                        string `query:"endpoint" doc:"Custom DingTalk gateway endpoint."`
	GroupAllowFrom                  string `query:"groupAllowFrom" doc:"Comma or newline separated DingTalk conversation ids."`
	GroupPolicy                     string `query:"groupPolicy" enum:"open,allowlist,disabled" example:"open" doc:"DingTalk group access policy."`
	GroupReplyMode                  string `query:"groupReplyMode" enum:"aicard,text,markdown" doc:"Group reply mode."`
	GroupSessionScope               string `query:"groupSessionScope" enum:"group,group_sender" doc:"Group session scope."`
	GroupsJSON                      string `query:"groupsJson" doc:"Raw groups override JSON object."`
	HistoryLimit                    string `query:"historyLimit" doc:"Conversation history limit."`
	MediaMaxMB                      string `query:"mediaMaxMb" doc:"Maximum media size in MB."`
	Name                            string `query:"name" doc:"Optional account display name."`
	RequireMention                  bool   `query:"requireMention" doc:"Whether group messages require @ bot."`
	ResolveSenderNames              bool   `query:"resolveSenderNames" doc:"Whether sender names are resolved."`
	SeparateSessionByConversation   bool   `query:"separateSessionByConversation" doc:"Whether sessions are separated by conversation."`
	SharedMemoryAcrossConversations bool   `query:"sharedMemoryAcrossConversations" doc:"Whether memory is shared across conversations."`
	SystemPrompt                    string `query:"systemPrompt" doc:"Account system prompt override."`
	TextChunkLimit                  string `query:"textChunkLimit" doc:"Text chunk limit."`
	ToolsDocs                       bool   `query:"toolsDocs" doc:"Whether docs tools are enabled."`
	ToolsMedia                      bool   `query:"toolsMedia" doc:"Whether media tools are enabled."`
	TypingIndicator                 bool   `query:"typingIndicator" doc:"Whether typing indicator is enabled."`
}

type OpenClawDingTalkStatusResponse struct {
	Status       string                           `json:"status" example:"ok" doc:"Operation status."`
	ChannelID    string                           `json:"channelId" example:"dingtalk-connector" doc:"OpenClaw channel id."`
	Package      string                           `json:"package" example:"@dingtalk-real-ai/dingtalk-connector" doc:"Official DingTalk package name."`
	Installed    bool                             `json:"installed" example:"true" doc:"Whether the plugin appears installed from local files, install records, or config."`
	Configured   bool                             `json:"configured" example:"true" doc:"Whether a clientId/clientSecret is configured."`
	Enabled      bool                             `json:"enabled" example:"true" doc:"Whether channels.dingtalk-connector.enabled is true."`
	Config       OpenClawDingTalkConfigResponse   `json:"config" doc:"DingTalk channel config summary without secrets."`
	Accounts     []OpenClawDingTalkAccountSummary `json:"accounts" doc:"Configured DingTalk accounts without secrets."`
	ConfigPath   string                           `json:"configPath,omitempty" doc:"OpenClaw config path."`
	OpenClawHome string                           `json:"openClawHome,omitempty" doc:"OpenClaw home directory."`
	Version      string                           `json:"version,omitempty" doc:"Installed package version when readable."`
	Error        string                           `json:"error,omitempty" doc:"Config read error."`
}

type OpenClawDingTalkConfigResponse struct {
	AccountCount           int    `json:"accountCount" doc:"Configured account count."`
	AllowFromCount         int    `json:"allowFromCount" doc:"Top-level allowFrom entry count."`
	AsyncMode              bool   `json:"asyncMode" doc:"Whether async mode is enabled."`
	ClientIDConfigured     bool   `json:"clientIdConfigured" doc:"Whether top-level clientId is configured."`
	ClientSecretConfigured bool   `json:"clientSecretConfigured" doc:"Whether top-level clientSecret is configured."`
	Debug                  bool   `json:"debug" doc:"Whether debug logging is enabled."`
	DMPolicy               string `json:"dmPolicy,omitempty" doc:"Default DM policy."`
	Enabled                bool   `json:"enabled" doc:"Whether channel is enabled."`
	GroupPolicy            string `json:"groupPolicy,omitempty" doc:"Default group policy."`
	GroupSessionScope      string `json:"groupSessionScope,omitempty" doc:"Group session scope."`
	RequireMention         bool   `json:"requireMention" doc:"Whether groups require mention by default."`
	SystemPrompt           string `json:"systemPrompt,omitempty" doc:"Default system prompt."`
}

type OpenClawDingTalkAccountSummary struct {
	AccountID                       string         `json:"accountId" example:"main-bot" doc:"DingTalk account id."`
	AckText                         string         `json:"ackText,omitempty" doc:"Async mode acknowledgement text."`
	AgentID                         string         `json:"agentId,omitempty" doc:"Agent routed to this account."`
	AllowFrom                       []string       `json:"allowFrom,omitempty" doc:"Effective account allowFrom entries."`
	AllowFromCount                  int            `json:"allowFromCount" doc:"Account allowFrom entry count."`
	AsyncMode                       bool           `json:"asyncMode" doc:"Whether async mode is enabled."`
	ChatbotCorpID                   string         `json:"chatbotCorpId,omitempty" doc:"Bot corp id for multi-Agent collaboration."`
	ChatbotUserID                   string         `json:"chatbotUserId,omitempty" doc:"Bot chatbot user id for multi-Agent collaboration."`
	ClientIDConfigured              bool           `json:"clientIdConfigured" doc:"Whether clientId is configured."`
	ClientSecretConfigured          bool           `json:"clientSecretConfigured" doc:"Whether clientSecret is configured."`
	Debug                           bool           `json:"debug" doc:"Whether debug logging is enabled."`
	DMPolicy                        string         `json:"dmPolicy,omitempty" doc:"Account DM policy override or inherited policy."`
	Enabled                         bool           `json:"enabled" doc:"Whether this account is enabled."`
	EnableMediaUpload               bool           `json:"enableMediaUpload" doc:"Whether media upload is enabled."`
	Endpoint                        string         `json:"endpoint,omitempty" doc:"Custom DingTalk gateway endpoint."`
	GroupAllowFrom                  []string       `json:"groupAllowFrom,omitempty" doc:"Effective group allowlist entries."`
	GroupAllowFromCount             int            `json:"groupAllowFromCount" doc:"Group allowlist entry count."`
	GroupCount                      int            `json:"groupCount" doc:"Configured group override count."`
	GroupPolicy                     string         `json:"groupPolicy,omitempty" doc:"Account group policy override or inherited policy."`
	GroupReplyMode                  string         `json:"groupReplyMode,omitempty" doc:"Group reply mode."`
	GroupSessionScope               string         `json:"groupSessionScope,omitempty" doc:"Group session scope."`
	Groups                          map[string]any `json:"groups,omitempty" doc:"Effective group overrides."`
	HistoryLimit                    int            `json:"historyLimit,omitempty" doc:"Conversation history limit."`
	MediaMaxMB                      float64        `json:"mediaMaxMb,omitempty" doc:"Maximum media size in MB."`
	Name                            string         `json:"name,omitempty" doc:"Account display name."`
	RequireMention                  bool           `json:"requireMention" doc:"Whether group messages require @ bot."`
	ResolveSenderNames              bool           `json:"resolveSenderNames" doc:"Whether sender names are resolved."`
	SeparateSessionByConversation   bool           `json:"separateSessionByConversation" doc:"Whether sessions are separated by conversation."`
	SharedMemoryAcrossConversations bool           `json:"sharedMemoryAcrossConversations" doc:"Whether memory is shared across conversations."`
	SystemPrompt                    string         `json:"systemPrompt,omitempty" doc:"Account system prompt override."`
	TextChunkLimit                  int            `json:"textChunkLimit,omitempty" doc:"Text chunk limit."`
	ToolsDocs                       bool           `json:"toolsDocs" doc:"Whether docs tools are enabled."`
	ToolsMedia                      bool           `json:"toolsMedia" doc:"Whether media tools are enabled."`
	TypingIndicator                 bool           `json:"typingIndicator" doc:"Whether typing indicator is enabled."`
}

type OpenClawDingTalkConfigRequest struct {
	Debug          *bool   `json:"debug,omitempty" doc:"Debug logging switch."`
	DMPolicy       *string `json:"dmPolicy,omitempty" enum:"pairing,allowlist,open,disabled" doc:"Default DingTalk DM policy."`
	Enabled        *bool   `json:"enabled,omitempty" doc:"Channel enabled switch."`
	GroupPolicy    *string `json:"groupPolicy,omitempty" enum:"open,allowlist,disabled" doc:"Default DingTalk group policy."`
	RequireMention *bool   `json:"requireMention,omitempty" doc:"Whether group messages require @ bot by default."`
}

type OpenClawDingTalkAccountConfigRequest struct {
	AckText                         *string        `json:"ackText,omitempty" doc:"Async mode acknowledgement text. Empty string clears it."`
	AgentID                         *string        `json:"agentId,omitempty" doc:"Agent id routed to this account. Empty string removes binding."`
	AllowFrom                       []string       `json:"allowFrom,omitempty" doc:"Account allowFrom entries. Empty array clears account override."`
	AsyncMode                       *bool          `json:"asyncMode,omitempty" doc:"Whether async mode is enabled."`
	ChatbotCorpID                   *string        `json:"chatbotCorpId,omitempty" doc:"Bot corp id for multi-Agent collaboration. Empty string clears it."`
	ChatbotUserID                   *string        `json:"chatbotUserId,omitempty" doc:"Bot chatbot user id for multi-Agent collaboration. Empty string clears it."`
	ClientID                        *string        `json:"clientId,omitempty" doc:"New DingTalk AppKey. Empty string is ignored."`
	ClientSecret                    *string        `json:"clientSecret,omitempty" doc:"New DingTalk AppSecret. Empty string is ignored."`
	Debug                           *bool          `json:"debug,omitempty" doc:"Whether debug logging is enabled."`
	DMPolicy                        *string        `json:"dmPolicy,omitempty" enum:"pairing,allowlist,open,disabled" doc:"Account DM access policy."`
	Enabled                         *bool          `json:"enabled,omitempty" doc:"Account enabled switch."`
	EnableMediaUpload               *bool          `json:"enableMediaUpload,omitempty" doc:"Whether media upload is enabled."`
	Endpoint                        *string        `json:"endpoint,omitempty" doc:"Custom DingTalk gateway endpoint. Empty string clears it."`
	GroupAllowFrom                  []string       `json:"groupAllowFrom,omitempty" doc:"Group allowlist entries. Empty array clears account override."`
	GroupPolicy                     *string        `json:"groupPolicy,omitempty" enum:"open,allowlist,disabled" doc:"Account group access policy."`
	GroupReplyMode                  *string        `json:"groupReplyMode,omitempty" enum:"aicard,text,markdown" doc:"Group reply mode."`
	GroupSessionScope               *string        `json:"groupSessionScope,omitempty" enum:"group,group_sender" doc:"Group session scope."`
	Groups                          map[string]any `json:"groups,omitempty" doc:"Group overrides. Empty object clears account override."`
	HistoryLimit                    *int           `json:"historyLimit,omitempty" doc:"Conversation history limit."`
	MediaMaxMB                      *float64       `json:"mediaMaxMb,omitempty" doc:"Maximum media size in MB."`
	Name                            *string        `json:"name,omitempty" doc:"Account display name. Empty string clears it."`
	RequireMention                  *bool          `json:"requireMention,omitempty" doc:"Whether groups require @ bot."`
	ResolveSenderNames              *bool          `json:"resolveSenderNames,omitempty" doc:"Whether sender names are resolved."`
	SeparateSessionByConversation   *bool          `json:"separateSessionByConversation,omitempty" doc:"Whether sessions are separated by conversation."`
	SharedMemoryAcrossConversations *bool          `json:"sharedMemoryAcrossConversations,omitempty" doc:"Whether memory is shared across conversations."`
	SystemPrompt                    *string        `json:"systemPrompt,omitempty" doc:"Account system prompt override. Empty string clears it."`
	TextChunkLimit                  *int           `json:"textChunkLimit,omitempty" doc:"Text chunk limit."`
	ToolsDocs                       *bool          `json:"toolsDocs,omitempty" doc:"Whether docs tools are enabled."`
	ToolsMedia                      *bool          `json:"toolsMedia,omitempty" doc:"Whether media tools are enabled."`
	TypingIndicator                 *bool          `json:"typingIndicator,omitempty" doc:"Whether typing indicator is enabled."`
}

type OpenClawDingTalkAccountDeleteResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-14T09:00:00Z" doc:"UTC response timestamp."`
	AccountID string `json:"accountId" doc:"Deleted DingTalk account id."`
}

func GetOpenClawDingTalkStatus(ctx context.Context, input *struct{}) (*OpenClawDingTalkStatusOutput, error) {
	_ = ctx
	return &OpenClawDingTalkStatusOutput{Body: detectOpenClawDingTalkStatus()}, nil
}

func UpdateOpenClawDingTalkConfig(ctx context.Context, input *OpenClawDingTalkConfigInput) (*OpenClawDingTalkConfigOutput, error) {
	_ = ctx
	if input == nil {
		return nil, huma.Error400BadRequest("dingtalk config request is required", nil)
	}
	content, err := readOrCreateOpenClawConfig()
	if err != nil {
		return nil, huma.Error500InternalServerError("read openclaw config failed", err)
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawDingTalkChannelID])
	if input.Body.Enabled != nil {
		section["enabled"] = *input.Body.Enabled
		plugins := objectMap(content["plugins"])
		entries := objectMap(plugins["entries"])
		entry := objectMap(entries[openClawDingTalkChannelID])
		entry["enabled"] = *input.Body.Enabled
		entries[openClawDingTalkChannelID] = entry
		plugins["entries"] = entries
		content["plugins"] = plugins
	}
	if input.Body.DMPolicy != nil {
		if err := setOpenClawDingTalkPolicy(section, "dmPolicy", *input.Body.DMPolicy, allowedOpenClawDingTalkDMPolicy); err != nil {
			return nil, huma.Error400BadRequest("unsupported dingtalk dmPolicy", err)
		}
	}
	if input.Body.GroupPolicy != nil {
		if err := setOpenClawDingTalkPolicy(section, "groupPolicy", *input.Body.GroupPolicy, allowedOpenClawDingTalkGroupPolicy); err != nil {
			return nil, huma.Error400BadRequest("unsupported dingtalk groupPolicy", err)
		}
	}
	if input.Body.RequireMention != nil {
		section["requireMention"] = *input.Body.RequireMention
	}
	if input.Body.Debug != nil {
		section["debug"] = *input.Body.Debug
	}
	channels[openClawDingTalkChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(openClawConfigPath(), content); err != nil {
		return nil, huma.Error500InternalServerError("write openclaw config failed", err)
	}
	invalidateOpenClawPluginsStatusCache()
	invalidateOpenClawEnvironmentCache()
	return &OpenClawDingTalkConfigOutput{Body: detectOpenClawDingTalkStatus()}, nil
}

func UpdateOpenClawDingTalkAccountConfig(ctx context.Context, input *OpenClawDingTalkAccountConfigInput) (*OpenClawDingTalkAccountConfigOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("account id is required", nil)
	}
	if err := patchOpenClawDingTalkAccount(strings.TrimSpace(input.AccountID), input.Body); err != nil {
		return nil, huma.Error500InternalServerError("update dingtalk account config failed", err)
	}
	return &OpenClawDingTalkAccountConfigOutput{Body: detectOpenClawDingTalkStatus()}, nil
}

func DeleteOpenClawDingTalkAccount(ctx context.Context, input *OpenClawDingTalkAccountDeleteInput) (*OpenClawDingTalkAccountDeleteOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("account id is required", nil)
	}
	accountID := strings.TrimSpace(input.AccountID)
	if err := removeOpenClawDingTalkAccount(accountID); err != nil {
		return nil, huma.Error500InternalServerError("delete dingtalk account failed", err)
	}
	if err := setOpenClawChannelAccountBinding(openClawDingTalkChannelID, accountID, ""); err != nil {
		return nil, huma.Error500InternalServerError("update dingtalk account binding failed", err)
	}
	return &OpenClawDingTalkAccountDeleteOutput{Body: OpenClawDingTalkAccountDeleteResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AccountID: accountID,
	}}, nil
}

func InstallOpenClawDingTalkStream(ctx context.Context, input *struct{}, send sse.Sender) {
	streamOpenClawChannelSteps(ctx, send, "dingtalk-install", "install", []openClawChannelStep{
		{label: "检查 OpenClaw CLI", progress: 5, timeout: 10 * time.Second, args: []string{"--version"}},
		{label: "安装钉钉官方插件", progress: 25, run: installOpenClawDingTalkPlugin},
		{label: "安装钉钉 Workspace CLI", progress: 60, run: installOpenClawDingTalkWorkspaceCLI},
		{label: "应用钉钉扫码暂存凭据", progress: 70, run: applyOpenClawDingTalkStagedCredentials},
		{label: "启用钉钉插件配置", progress: 76, run: enableOpenClawDingTalkPluginEntry},
		{label: "重启 Gateway 加载钉钉插件", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
}

func ScanAddOpenClawDingTalkStream(ctx context.Context, input *struct{}, send sse.Sender) {
	streamOpenClawChannelSteps(ctx, send, "dingtalk-scan-add", "scan", []openClawChannelStep{
		{label: "检查 OpenClaw CLI", progress: 5, timeout: 10 * time.Second, args: []string{"--version"}},
		{label: "检查钉钉插件安装状态", progress: 15, run: requireOpenClawDingTalkInstalled},
		{label: "运行钉钉官方扫码添加向导", progress: 25, timeout: 10 * time.Minute, run: runOpenClawDingTalkScanAuthorize},
		{label: "启用钉钉插件配置", progress: 76, run: enableOpenClawDingTalkPluginEntry},
		{label: "重启 Gateway 加载钉钉插件", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
}

func AddOpenClawDingTalkAccountStream(ctx context.Context, input *OpenClawDingTalkAddStreamInput, send sse.Sender) {
	if input == nil {
		streamOpenClawChannelError(send, "dingtalk-add", "add", fmt.Errorf("dingtalk account request is required"))
		return
	}
	accountID := strings.TrimSpace(input.AccountID)
	if accountID == "" {
		accountID = "default"
	}
	if strings.TrimSpace(input.ClientID) == "" || strings.TrimSpace(input.ClientSecret) == "" {
		streamOpenClawChannelError(send, "dingtalk-add", "add", fmt.Errorf("clientId 和 clientSecret 不能为空"))
		return
	}
	dmPolicy := firstNonEmptyDingTalkString(input.DMPolicy, "pairing")
	if !allowedOpenClawDingTalkDMPolicy(dmPolicy) {
		streamOpenClawChannelError(send, "dingtalk-add", "add", fmt.Errorf("unsupported dmPolicy %q", dmPolicy))
		return
	}
	groupPolicy := strings.TrimSpace(input.GroupPolicy)
	if groupPolicy != "" && !allowedOpenClawDingTalkGroupPolicy(groupPolicy) {
		streamOpenClawChannelError(send, "dingtalk-add", "add", fmt.Errorf("unsupported groupPolicy %q", groupPolicy))
		return
	}
	groupReplyMode := strings.TrimSpace(input.GroupReplyMode)
	if groupReplyMode != "" && !allowedOpenClawDingTalkGroupReplyMode(groupReplyMode) {
		streamOpenClawChannelError(send, "dingtalk-add", "add", fmt.Errorf("unsupported groupReplyMode %q", groupReplyMode))
		return
	}
	groupSessionScope := strings.TrimSpace(input.GroupSessionScope)
	if groupSessionScope != "" && !allowedOpenClawDingTalkGroupSessionScope(groupSessionScope) {
		streamOpenClawChannelError(send, "dingtalk-add", "add", fmt.Errorf("unsupported groupSessionScope %q", groupSessionScope))
		return
	}
	if dmPolicy == "allowlist" && len(splitOpenClawDingTalkList(input.AllowFrom)) == 0 {
		streamOpenClawChannelError(send, "dingtalk-add", "add", fmt.Errorf("allowlist 策略需要至少一个钉钉用户 ID"))
		return
	}
	if groupPolicy == "allowlist" && len(splitOpenClawDingTalkList(input.GroupAllowFrom)) == 0 {
		streamOpenClawChannelError(send, "dingtalk-add", "add", fmt.Errorf("群聊 allowlist 策略需要至少一个会话 ID"))
		return
	}
	historyLimit, err := parseOptionalOpenClawDingTalkInt(input.HistoryLimit, "historyLimit", 0)
	if err != nil {
		streamOpenClawChannelError(send, "dingtalk-add", "add", err)
		return
	}
	textChunkLimit, err := parseOptionalOpenClawDingTalkInt(input.TextChunkLimit, "textChunkLimit", 1)
	if err != nil {
		streamOpenClawChannelError(send, "dingtalk-add", "add", err)
		return
	}
	mediaMaxMB, err := parseOptionalOpenClawDingTalkFloat(input.MediaMaxMB, "mediaMaxMb")
	if err != nil {
		streamOpenClawChannelError(send, "dingtalk-add", "add", err)
		return
	}
	groups, err := parseOptionalOpenClawDingTalkObject(input.GroupsJSON, "groupsJson")
	if err != nil {
		streamOpenClawChannelError(send, "dingtalk-add", "add", err)
		return
	}
	patch := OpenClawDingTalkAccountConfigRequest{
		AckText:                         &input.AckText,
		AgentID:                         &input.AgentID,
		AllowFrom:                       splitOpenClawDingTalkList(input.AllowFrom),
		AsyncMode:                       &input.AsyncMode,
		ChatbotCorpID:                   &input.ChatbotCorpID,
		ChatbotUserID:                   &input.ChatbotUserID,
		ClientID:                        &input.ClientID,
		ClientSecret:                    &input.ClientSecret,
		Debug:                           &input.Debug,
		DMPolicy:                        &dmPolicy,
		Enabled:                         boolPtr(true),
		EnableMediaUpload:               &input.EnableMediaUpload,
		Endpoint:                        &input.Endpoint,
		GroupAllowFrom:                  splitOpenClawDingTalkList(input.GroupAllowFrom),
		GroupPolicy:                     &groupPolicy,
		GroupReplyMode:                  &groupReplyMode,
		GroupSessionScope:               &groupSessionScope,
		Groups:                          groups,
		HistoryLimit:                    historyLimit,
		MediaMaxMB:                      mediaMaxMB,
		Name:                            &input.Name,
		RequireMention:                  &input.RequireMention,
		ResolveSenderNames:              &input.ResolveSenderNames,
		SeparateSessionByConversation:   &input.SeparateSessionByConversation,
		SharedMemoryAcrossConversations: &input.SharedMemoryAcrossConversations,
		SystemPrompt:                    &input.SystemPrompt,
		TextChunkLimit:                  textChunkLimit,
		ToolsDocs:                       &input.ToolsDocs,
		ToolsMedia:                      &input.ToolsMedia,
		TypingIndicator:                 &input.TypingIndicator,
	}
	streamOpenClawChannelSteps(ctx, send, "dingtalk-add", "add", []openClawChannelStep{
		{label: "检查 OpenClaw CLI", progress: 5, timeout: 10 * time.Second, args: []string{"--version"}},
		{label: "写入钉钉机器人账号配置", progress: 40, run: func(ctx context.Context, task openClawChannelLogger) error {
			_ = ctx
			if err := patchOpenClawDingTalkAccount(accountID, patch); err != nil {
				return err
			}
			task.addLog("已写入 channels.dingtalk-connector.accounts." + accountID)
			return nil
		}},
		{label: "启用钉钉插件配置", progress: 72, run: enableOpenClawDingTalkPluginEntry},
		{label: "重启 Gateway 应用钉钉配置", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
}

func UninstallOpenClawDingTalkStream(ctx context.Context, input *struct{}, send sse.Sender) {
	streamOpenClawChannelSteps(ctx, send, "dingtalk-uninstall", "uninstall", []openClawChannelStep{
		{label: "卸载钉钉官方插件", progress: 35, timeout: 5 * time.Minute, args: []string{"plugins", "uninstall", openClawDingTalkChannelID, "--force"}, ignoreMissing: true},
		{label: "清理钉钉插件配置残留", progress: 70, run: cleanupOpenClawDingTalkConfig},
		{label: "清理钉钉插件安装残留", progress: 82, run: cleanupOpenClawDingTalkInstallArtifacts},
		{label: "刷新插件注册表", progress: 90, timeout: 2 * time.Minute, args: []string{"plugins", "registry", "--refresh"}, ignoreMissing: true},
	})
}

func detectOpenClawDingTalkStatus() OpenClawDingTalkStatusResponse {
	home := defaultOpenClawHomeDir()
	configPath := openClawConfigPath()
	content, exists, configErr := readOpenClawConfigFile(configPath)
	section := objectMap(objectMap(content["channels"])[openClawDingTalkChannelID])
	configured := openClawDingTalkConfigured(section)
	version := ""
	installed := configured
	for _, pkgPath := range openClawDingTalkPackagePaths(home) {
		pkgVersion, ok := readPackageVersion(pkgPath)
		if ok {
			installed = true
			if version == "" {
				version = pkgVersion
			}
		}
	}
	response := OpenClawDingTalkStatusResponse{
		Status:     "ok",
		ChannelID:  openClawDingTalkChannelID,
		Package:    openClawDingTalkPackage,
		Installed:  installed,
		Configured: configured,
		Enabled:    configured && boolFromMap(section, "enabled"),
		Config:     openClawDingTalkConfigFromSection(section),
		Accounts:   []OpenClawDingTalkAccountSummary{},
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
		response.Accounts = readOpenClawDingTalkAccounts(section, readOpenClawChannelAccountBindings(content, openClawDingTalkChannelID))
	}
	return response
}

func openClawDingTalkConfigFromSection(section map[string]any) OpenClawDingTalkConfigResponse {
	accounts := objectMap(section["accounts"])
	return OpenClawDingTalkConfigResponse{
		AccountCount:           len(accounts),
		AllowFromCount:         len(stringSliceFromValue(section["allowFrom"])),
		AsyncMode:              boolFromMap(section, "asyncMode"),
		ClientIDConfigured:     stringFromMap(section, "clientId") != "",
		ClientSecretConfigured: stringFromMap(section, "clientSecret") != "",
		Debug:                  boolFromMap(section, "debug"),
		DMPolicy:               firstNonEmptyDingTalkString(stringFromMap(section, "dmPolicy"), "pairing"),
		Enabled:                boolFromMap(section, "enabled"),
		GroupPolicy:            stringFromMap(section, "groupPolicy"),
		GroupSessionScope:      stringFromMap(section, "groupSessionScope"),
		RequireMention:         !hasExplicitFalse(section, "requireMention"),
		SystemPrompt:           stringFromMap(section, "systemPrompt"),
	}
}

func readOpenClawDingTalkAccounts(section map[string]any, bindings map[string]string) []OpenClawDingTalkAccountSummary {
	accountsCfg := objectMap(section["accounts"])
	ids := make([]string, 0, len(accountsCfg))
	for id := range accountsCfg {
		if strings.TrimSpace(id) != "" {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	accounts := make([]OpenClawDingTalkAccountSummary, 0, len(ids))
	for _, id := range ids {
		cfg := objectMap(accountsCfg[id])
		if !openClawDingTalkAccountConfigured(cfg) {
			continue
		}
		accounts = append(accounts, openClawDingTalkAccountFromConfig(id, cfg, section, bindings[id]))
	}
	return accounts
}

func openClawDingTalkAccountFromConfig(accountID string, cfg map[string]any, parent map[string]any, agentID string) OpenClawDingTalkAccountSummary {
	allowFrom := firstNonEmptyStringSlice(stringSliceFromValue(cfg["allowFrom"]), stringSliceFromValue(parent["allowFrom"]))
	groupAllowFrom := firstNonEmptyStringSlice(stringSliceFromValue(cfg["groupAllowFrom"]), stringSliceFromValue(parent["groupAllowFrom"]))
	groups := firstNonEmptyDingTalkObjectMap(objectMap(cfg["groups"]), objectMap(parent["groups"]))
	tools := objectMap(cfg["tools"])
	parentTools := objectMap(parent["tools"])
	return OpenClawDingTalkAccountSummary{
		AccountID:                       accountID,
		AckText:                         firstNonEmptyDingTalkString(stringFromMap(cfg, "ackText"), stringFromMap(parent, "ackText")),
		AgentID:                         strings.TrimSpace(agentID),
		AllowFrom:                       allowFrom,
		AllowFromCount:                  len(allowFrom),
		AsyncMode:                       boolFromDingTalkConfig(cfg, parent, "asyncMode", false),
		ChatbotCorpID:                   stringFromMap(cfg, "chatbotCorpId"),
		ChatbotUserID:                   stringFromMap(cfg, "chatbotUserId"),
		ClientIDConfigured:              firstNonEmptyDingTalkString(stringFromMap(cfg, "clientId"), stringFromMap(parent, "clientId")) != "",
		ClientSecretConfigured:          firstNonEmptyDingTalkString(stringFromMap(cfg, "clientSecret"), stringFromMap(parent, "clientSecret")) != "",
		Debug:                           boolFromDingTalkConfig(cfg, parent, "debug", false),
		DMPolicy:                        firstNonEmptyDingTalkString(stringFromMap(cfg, "dmPolicy"), stringFromMap(parent, "dmPolicy"), "pairing"),
		Enabled:                         !hasExplicitFalse(cfg, "enabled") && !hasExplicitFalse(parent, "enabled"),
		EnableMediaUpload:               boolFromDingTalkConfig(cfg, parent, "enableMediaUpload", true),
		Endpoint:                        firstNonEmptyDingTalkString(stringFromMap(cfg, "endpoint"), stringFromMap(parent, "endpoint")),
		GroupAllowFrom:                  groupAllowFrom,
		GroupAllowFromCount:             len(groupAllowFrom),
		GroupCount:                      len(groups),
		GroupPolicy:                     firstNonEmptyDingTalkString(stringFromMap(cfg, "groupPolicy"), stringFromMap(parent, "groupPolicy")),
		GroupReplyMode:                  firstNonEmptyDingTalkString(stringFromMap(cfg, "groupReplyMode"), stringFromMap(parent, "groupReplyMode"), "aicard"),
		GroupSessionScope:               firstNonEmptyDingTalkString(stringFromMap(cfg, "groupSessionScope"), stringFromMap(parent, "groupSessionScope"), "group"),
		Groups:                          groups,
		HistoryLimit:                    intFromDingTalkConfig(cfg, parent, "historyLimit", 0),
		MediaMaxMB:                      floatFromDingTalkConfig(cfg, parent, "mediaMaxMb", 0),
		Name:                            stringFromMap(cfg, "name"),
		RequireMention:                  !hasExplicitFalse(cfg, "requireMention") && !hasExplicitFalse(parent, "requireMention"),
		ResolveSenderNames:              boolFromDingTalkConfig(cfg, parent, "resolveSenderNames", false),
		SeparateSessionByConversation:   boolFromDingTalkConfig(cfg, parent, "separateSessionByConversation", true),
		SharedMemoryAcrossConversations: boolFromDingTalkConfig(cfg, parent, "sharedMemoryAcrossConversations", false),
		SystemPrompt:                    firstNonEmptyDingTalkString(stringFromMap(cfg, "systemPrompt"), stringFromMap(parent, "systemPrompt")),
		TextChunkLimit:                  intFromDingTalkConfig(cfg, parent, "textChunkLimit", 0),
		ToolsDocs:                       boolFromDingTalkConfig(tools, parentTools, "docs", true),
		ToolsMedia:                      boolFromDingTalkConfig(tools, parentTools, "media", true),
		TypingIndicator:                 boolFromDingTalkConfig(cfg, parent, "typingIndicator", false),
	}
}

func patchOpenClawDingTalkAccount(accountID string, patch OpenClawDingTalkAccountConfigRequest) error {
	content, err := readOrCreateOpenClawConfig()
	if err != nil {
		return err
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawDingTalkChannelID])
	section["enabled"] = true
	accounts := objectMap(section["accounts"])
	accountCfg := objectMap(accounts[accountID])
	if patch.Enabled != nil {
		accountCfg["enabled"] = *patch.Enabled
	}
	setOptionalDingTalkString(accountCfg, "name", patch.Name, true)
	setOptionalDingTalkString(accountCfg, "ackText", patch.AckText, true)
	setOptionalDingTalkString(accountCfg, "chatbotCorpId", patch.ChatbotCorpID, true)
	setOptionalDingTalkString(accountCfg, "chatbotUserId", patch.ChatbotUserID, true)
	setOptionalDingTalkString(accountCfg, "endpoint", patch.Endpoint, true)
	setOptionalDingTalkString(accountCfg, "systemPrompt", patch.SystemPrompt, true)
	setOptionalDingTalkString(accountCfg, "clientId", patch.ClientID, false)
	setOptionalDingTalkString(accountCfg, "clientSecret", patch.ClientSecret, false)
	if patch.DMPolicy != nil {
		if err := setOpenClawDingTalkPolicy(accountCfg, "dmPolicy", *patch.DMPolicy, allowedOpenClawDingTalkDMPolicy); err != nil {
			return err
		}
	}
	if patch.GroupPolicy != nil {
		if err := setOpenClawDingTalkPolicy(accountCfg, "groupPolicy", *patch.GroupPolicy, allowedOpenClawDingTalkGroupPolicy); err != nil {
			return err
		}
	}
	if patch.GroupReplyMode != nil {
		if err := setOpenClawDingTalkPolicy(accountCfg, "groupReplyMode", *patch.GroupReplyMode, allowedOpenClawDingTalkGroupReplyMode); err != nil {
			return err
		}
	}
	if patch.GroupSessionScope != nil {
		if err := setOpenClawDingTalkPolicy(accountCfg, "groupSessionScope", *patch.GroupSessionScope, allowedOpenClawDingTalkGroupSessionScope); err != nil {
			return err
		}
	}
	if patch.RequireMention != nil {
		accountCfg["requireMention"] = *patch.RequireMention
	}
	if patch.AsyncMode != nil {
		accountCfg["asyncMode"] = *patch.AsyncMode
	}
	if patch.Debug != nil {
		accountCfg["debug"] = *patch.Debug
	}
	if patch.EnableMediaUpload != nil {
		accountCfg["enableMediaUpload"] = *patch.EnableMediaUpload
	}
	if patch.ResolveSenderNames != nil {
		accountCfg["resolveSenderNames"] = *patch.ResolveSenderNames
	}
	if patch.SeparateSessionByConversation != nil {
		accountCfg["separateSessionByConversation"] = *patch.SeparateSessionByConversation
	}
	if patch.SharedMemoryAcrossConversations != nil {
		accountCfg["sharedMemoryAcrossConversations"] = *patch.SharedMemoryAcrossConversations
	}
	if patch.TypingIndicator != nil {
		accountCfg["typingIndicator"] = *patch.TypingIndicator
	}
	if patch.HistoryLimit != nil {
		accountCfg["historyLimit"] = *patch.HistoryLimit
	}
	if patch.TextChunkLimit != nil {
		accountCfg["textChunkLimit"] = *patch.TextChunkLimit
	}
	if patch.MediaMaxMB != nil {
		accountCfg["mediaMaxMb"] = *patch.MediaMaxMB
	}
	if patch.AllowFrom != nil {
		clean := dedupeOpenClawTelegramStrings(patch.AllowFrom)
		if len(clean) > 0 {
			accountCfg["allowFrom"] = clean
		} else {
			delete(accountCfg, "allowFrom")
		}
	}
	if patch.GroupAllowFrom != nil {
		clean := dedupeOpenClawTelegramStrings(patch.GroupAllowFrom)
		if len(clean) > 0 {
			accountCfg["groupAllowFrom"] = clean
		} else {
			delete(accountCfg, "groupAllowFrom")
		}
	}
	if patch.Groups != nil {
		if len(patch.Groups) > 0 {
			accountCfg["groups"] = patch.Groups
		} else {
			delete(accountCfg, "groups")
		}
	}
	if patch.ToolsDocs != nil || patch.ToolsMedia != nil {
		tools := objectMap(accountCfg["tools"])
		if patch.ToolsDocs != nil {
			tools["docs"] = *patch.ToolsDocs
		}
		if patch.ToolsMedia != nil {
			tools["media"] = *patch.ToolsMedia
		}
		accountCfg["tools"] = tools
	}
	accounts[accountID] = accountCfg
	section["accounts"] = accounts
	channels[openClawDingTalkChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(openClawConfigPath(), content); err != nil {
		return err
	}
	if patch.AgentID != nil {
		return setOpenClawChannelAccountBinding(openClawDingTalkChannelID, accountID, strings.TrimSpace(*patch.AgentID))
	}
	return nil
}

func removeOpenClawDingTalkAccount(accountID string) error {
	content, _, err := readOpenClawConfigFile(openClawConfigPath())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawDingTalkChannelID])
	accounts := objectMap(section["accounts"])
	delete(accounts, accountID)
	if len(accounts) == 0 {
		delete(section, "accounts")
	} else {
		section["accounts"] = accounts
	}
	if accountID == "default" {
		delete(section, "clientId")
		delete(section, "clientSecret")
	}
	if !openClawDingTalkConfigured(section) {
		delete(channels, openClawDingTalkChannelID)
	} else {
		channels[openClawDingTalkChannelID] = section
	}
	content["channels"] = channels
	return writeOpenClawConfigContent(openClawConfigPath(), content)
}

func cleanupOpenClawDingTalkConfig(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	content, exists, err := readOpenClawConfigFile(openClawConfigPath())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			task.addLog("openclaw.json 不存在，无需清理。")
			return nil
		}
		return err
	}
	if !exists {
		task.addLog("openclaw.json 不存在，无需清理。")
		return nil
	}
	changed := false
	channels := objectMap(content["channels"])
	if _, ok := channels[openClawDingTalkChannelID]; ok {
		delete(channels, openClawDingTalkChannelID)
		content["channels"] = channels
		changed = true
	}
	plugins := objectMap(content["plugins"])
	entries := objectMap(plugins["entries"])
	if _, ok := entries[openClawDingTalkChannelID]; ok {
		delete(entries, openClawDingTalkChannelID)
		plugins["entries"] = entries
		content["plugins"] = plugins
		changed = true
	}
	installs := objectMap(plugins["installs"])
	if _, ok := installs[openClawDingTalkChannelID]; ok {
		delete(installs, openClawDingTalkChannelID)
		plugins["installs"] = installs
		content["plugins"] = plugins
		changed = true
	}
	if raw, ok := content["bindings"].([]any); ok {
		next := make([]any, 0, len(raw))
		for _, value := range raw {
			item, ok := value.(map[string]any)
			if !ok || stringFromMap(objectMap(item["match"]), "channel") != openClawDingTalkChannelID {
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
		task.addLog("已清理钉钉插件配置残留。")
	} else {
		task.addLog("没有发现钉钉插件配置残留。")
	}
	return nil
}

func cleanupOpenClawDingTalkInstallArtifacts(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	home := defaultOpenClawHomeDir()
	removed := 0
	seenDirs := map[string]bool{}
	for _, pkgPath := range openClawDingTalkPackagePaths(home) {
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
	if err := removeOpenClawDingTalkInstallRecord(home); err != nil {
		return err
	}
	if removed > 0 {
		task.addLog(fmt.Sprintf("已清理 %d 个钉钉插件安装目录。", removed))
	} else {
		task.addLog("没有发现钉钉插件安装目录残留。")
	}
	return nil
}

func removeOpenClawDingTalkInstallRecord(home string) error {
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
	if _, ok := records[openClawDingTalkChannelID]; !ok {
		return nil
	}
	delete(records, openClawDingTalkChannelID)
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

func runOpenClawDingTalkScanAuthorize(ctx context.Context, task openClawChannelLogger) error {
	task.addLog("Starting DingTalk QR authorization (Device Flow)...")
	begin, err := beginOpenClawDingTalkDeviceAuthorization(ctx)
	if err != nil {
		return err
	}
	task.addLog("Authorization URL: " + begin.VerificationURL)
	task.addLog("Waiting for authorization result...")

	creds, err := pollOpenClawDingTalkDeviceAuthorization(ctx, begin)
	if err != nil {
		return err
	}
	task.addLog("Saving local configuration... (正在进行本地配置...)")
	accountID, err := saveOpenClawDingTalkAccountCredentials("", creds.ClientID, creds.ClientSecret)
	if err != nil {
		return err
	}
	task.addLog("Success! Bot configured. (机器人配置成功!)")
	task.addLog("已写入 channels.dingtalk-connector.accounts." + accountID)
	task.addLog("扫码授权已完成，未重复执行插件安装。")
	return nil
}

func installOpenClawDingTalkPlugin(ctx context.Context, task openClawChannelLogger) error {
	status := detectOpenClawDingTalkStatus()
	if status.Installed {
		task.addLog("钉钉官方插件已安装，跳过插件安装。")
		return nil
	}
	return runOpenClawStreamingCommandOnly(ctx, 10*time.Minute, task.addLog, "plugins", "install", openClawDingTalkPackage)
}

func installOpenClawDingTalkWorkspaceCLI(ctx context.Context, task openClawChannelLogger) error {
	if version := commandOutput(ctx, "dws", "--version"); strings.TrimSpace(version) != "" {
		task.addLog("dws CLI 已安装：" + version)
		return nil
	}
	return runOpenClawDingTalkCommand(ctx, 5*time.Minute, task.addLog, "npm", "install", "-g", "dingtalk-workspace-cli@1.0.13")
}

func applyOpenClawDingTalkStagedCredentials(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	stagingPath := openClawDingTalkStagingPath()
	data, err := os.ReadFile(stagingPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			task.addLog("没有发现钉钉扫码暂存凭据。")
			return nil
		}
		return err
	}
	var staged struct {
		ClientID     string `json:"clientId"`
		ClientSecret string `json:"clientSecret"`
	}
	if err := json.Unmarshal(data, &staged); err != nil {
		return err
	}
	clientID := strings.TrimSpace(staged.ClientID)
	clientSecret := strings.TrimSpace(staged.ClientSecret)
	if clientID == "" || clientSecret == "" {
		task.addLog("钉钉扫码暂存凭据不完整，已跳过。")
		return nil
	}
	accountID, err := saveOpenClawDingTalkAccountCredentials("", clientID, clientSecret)
	if err != nil {
		return err
	}
	if err := os.Remove(stagingPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	task.addLog("已应用钉钉扫码暂存凭据到 accounts." + accountID + "。")
	return nil
}

func requireOpenClawDingTalkInstalled(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	status := detectOpenClawDingTalkStatus()
	if !status.Installed {
		return fmt.Errorf("钉钉插件未安装，请先点击安装")
	}
	task.addLog("钉钉插件已安装。")
	return nil
}

type openClawDingTalkDeviceAuthorization struct {
	DeviceCode      string
	VerificationURL string
	Interval        time.Duration
	ExpiresIn       time.Duration
}

type openClawDingTalkDeviceCredentials struct {
	ClientID     string
	ClientSecret string
}

type openClawDingTalkRegistrationResponse struct {
	ErrCode                 int    `json:"errcode"`
	ErrMsg                  string `json:"errmsg"`
	Nonce                   string `json:"nonce"`
	DeviceCode              string `json:"device_code"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	Interval                int    `json:"interval"`
	ExpiresIn               int    `json:"expires_in"`
	Status                  string `json:"status"`
	ClientID                string `json:"client_id"`
	ClientSecret            string `json:"client_secret"`
	FailReason              string `json:"fail_reason"`
}

func beginOpenClawDingTalkDeviceAuthorization(ctx context.Context) (openClawDingTalkDeviceAuthorization, error) {
	var begin openClawDingTalkDeviceAuthorization
	initResp, err := postOpenClawDingTalkRegistration(ctx, "/app/registration/init", map[string]string{
		"source": openClawDingTalkRegistrationSource(),
	})
	if err != nil {
		return begin, err
	}
	nonce := strings.TrimSpace(initResp.Nonce)
	if nonce == "" {
		return begin, fmt.Errorf("钉钉授权初始化失败：missing nonce")
	}
	beginResp, err := postOpenClawDingTalkRegistration(ctx, "/app/registration/begin", map[string]string{
		"nonce": nonce,
	})
	if err != nil {
		return begin, err
	}
	deviceCode := strings.TrimSpace(beginResp.DeviceCode)
	verificationURL := strings.TrimSpace(beginResp.VerificationURIComplete)
	if deviceCode == "" || verificationURL == "" {
		return begin, fmt.Errorf("钉钉授权初始化失败：missing device_code or verification URL")
	}
	intervalSeconds := beginResp.Interval
	if intervalSeconds < 3 {
		intervalSeconds = 3
	}
	expiresSeconds := beginResp.ExpiresIn
	if expiresSeconds < 60 {
		expiresSeconds = 7200
	}
	return openClawDingTalkDeviceAuthorization{
		DeviceCode:      deviceCode,
		VerificationURL: verificationURL,
		Interval:        time.Duration(intervalSeconds) * time.Second,
		ExpiresIn:       time.Duration(expiresSeconds) * time.Second,
	}, nil
}

func pollOpenClawDingTalkDeviceAuthorization(ctx context.Context, auth openClawDingTalkDeviceAuthorization) (openClawDingTalkDeviceCredentials, error) {
	var creds openClawDingTalkDeviceCredentials
	deadline := time.Now().Add(auth.ExpiresIn)
	retryWindow := 2 * time.Minute
	var retryStarted time.Time
	var lastErr error
	for time.Now().Before(deadline) {
		timer := time.NewTimer(auth.Interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return creds, ctx.Err()
		case <-timer.C:
		}
		pollResp, err := postOpenClawDingTalkRegistration(ctx, "/app/registration/poll", map[string]string{
			"device_code": auth.DeviceCode,
		})
		if err != nil {
			if retryStarted.IsZero() {
				retryStarted = time.Now()
			}
			lastErr = err
			if time.Since(retryStarted) < retryWindow {
				continue
			}
			return creds, fmt.Errorf("钉钉授权轮询失败：%w", err)
		}
		status := strings.ToUpper(strings.TrimSpace(pollResp.Status))
		switch status {
		case "WAITING":
			retryStarted = time.Time{}
			continue
		case "SUCCESS":
			clientID := strings.TrimSpace(pollResp.ClientID)
			clientSecret := strings.TrimSpace(pollResp.ClientSecret)
			if clientID == "" || clientSecret == "" {
				return creds, fmt.Errorf("钉钉授权成功但缺少凭据")
			}
			return openClawDingTalkDeviceCredentials{ClientID: clientID, ClientSecret: clientSecret}, nil
		case "FAIL":
			if strings.TrimSpace(pollResp.FailReason) != "" {
				lastErr = errors.New(strings.TrimSpace(pollResp.FailReason))
			} else {
				lastErr = fmt.Errorf("authorization failed")
			}
		case "EXPIRED":
			return creds, fmt.Errorf("钉钉授权二维码已过期，请重新扫码")
		default:
			lastErr = fmt.Errorf("unexpected authorization status %q", status)
		}
		if retryStarted.IsZero() {
			retryStarted = time.Now()
		}
		if time.Since(retryStarted) >= retryWindow {
			return creds, lastErr
		}
	}
	if lastErr != nil {
		return creds, lastErr
	}
	return creds, fmt.Errorf("钉钉授权超时，请重新扫码")
}

func postOpenClawDingTalkRegistration(ctx context.Context, path string, body any) (openClawDingTalkRegistrationResponse, error) {
	var payload openClawDingTalkRegistrationResponse
	data, err := json.Marshal(body)
	if err != nil {
		return payload, err
	}
	baseURL := strings.TrimRight(openClawDingTalkRegistrationBaseURL(), "/")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+path, bytes.NewReader(data))
	if err != nil {
		return payload, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return payload, err
	}
	defer resp.Body.Close()
	respData, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return payload, err
	}
	if err := json.Unmarshal(respData, &payload); err != nil {
		return payload, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return payload, fmt.Errorf("钉钉授权接口返回 HTTP %d", resp.StatusCode)
	}
	if payload.ErrCode != 0 {
		message := strings.TrimSpace(payload.ErrMsg)
		if message == "" {
			message = "unknown error"
		}
		return payload, fmt.Errorf("钉钉授权接口失败：%s (errcode=%d)", message, payload.ErrCode)
	}
	return payload, nil
}

func openClawDingTalkRegistrationBaseURL() string {
	if value := strings.TrimSpace(os.Getenv("DINGTALK_REGISTRATION_BASE_URL")); value != "" {
		return value
	}
	return "https://oapi.dingtalk.com"
}

func openClawDingTalkRegistrationSource() string {
	if value := strings.TrimSpace(os.Getenv("DINGTALK_REGISTRATION_SOURCE")); value != "" {
		return value
	}
	return "DING_DWS_CLAW"
}

func enableOpenClawDingTalkPluginEntry(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	content, err := readOrCreateOpenClawConfig()
	if err != nil {
		return err
	}
	plugins := objectMap(content["plugins"])
	entries := objectMap(plugins["entries"])
	entry := objectMap(entries[openClawDingTalkChannelID])
	entry["enabled"] = true
	entries[openClawDingTalkChannelID] = entry
	plugins["entries"] = entries
	content["plugins"] = plugins
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawDingTalkChannelID])
	if _, ok := section["enabled"]; !ok {
		section["enabled"] = true
	}
	channels[openClawDingTalkChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(openClawConfigPath(), content); err != nil {
		return err
	}
	task.addLog("已启用 plugins.entries.dingtalk-connector。")
	return nil
}

func saveOpenClawDingTalkAccountCredentials(accountID string, clientID string, clientSecret string) (string, error) {
	content, err := readOrCreateOpenClawConfig()
	if err != nil {
		return "", err
	}
	accountID = strings.TrimSpace(accountID)
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawDingTalkChannelID])
	section["enabled"] = true
	accounts := objectMap(section["accounts"])
	if accountID == "" {
		accountID = uniqueOpenClawDingTalkAccountID(accounts, clientID)
	}
	accountCfg := objectMap(accounts[accountID])
	accountCfg["enabled"] = true
	if stringFromMap(accountCfg, "name") == "" {
		accountCfg["name"] = accountID
	}
	accountCfg["clientId"] = clientID
	accountCfg["clientSecret"] = clientSecret
	accounts[accountID] = accountCfg
	section["accounts"] = accounts
	delete(section, "clientId")
	delete(section, "clientSecret")
	channels[openClawDingTalkChannelID] = section
	content["channels"] = channels

	plugins := objectMap(content["plugins"])
	entries := objectMap(plugins["entries"])
	entry := objectMap(entries[openClawDingTalkChannelID])
	entry["enabled"] = true
	entries[openClawDingTalkChannelID] = entry
	plugins["entries"] = entries
	content["plugins"] = plugins

	gateway := objectMap(content["gateway"])
	httpCfg := objectMap(gateway["http"])
	endpoints := objectMap(httpCfg["endpoints"])
	chatCompletions := objectMap(endpoints["chatCompletions"])
	chatCompletions["enabled"] = true
	endpoints["chatCompletions"] = chatCompletions
	httpCfg["endpoints"] = endpoints
	gateway["http"] = httpCfg
	content["gateway"] = gateway

	if err := writeOpenClawConfigContent(openClawConfigPath(), content); err != nil {
		return "", err
	}
	return accountID, nil
}

func uniqueOpenClawDingTalkAccountID(accounts map[string]any, clientID string) string {
	base := openClawDingTalkAccountIDFromClientID(clientID)
	if base == "" {
		base = "dingtalk-bot"
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

func openClawDingTalkAccountIDFromClientID(clientID string) string {
	clean := strings.Builder{}
	lastDash := false
	for _, value := range strings.ToLower(strings.TrimSpace(clientID)) {
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

func hasOpenClawDingTalkMultiAgentConfig(content map[string]any) bool {
	section := objectMap(objectMap(content["channels"])[openClawDingTalkChannelID])
	if len(objectMap(section["accounts"])) > 0 {
		return true
	}
	bindings, _ := content["bindings"].([]any)
	for _, value := range bindings {
		item := objectMap(value)
		match := objectMap(item["match"])
		channel := stringFromMap(match, "channel")
		if channel == "" || channel == openClawDingTalkChannelID {
			return true
		}
	}
	return false
}

func runOpenClawStreamingCommandOnly(ctx context.Context, timeout time.Duration, writeOutput func(string), args ...string) error {
	_, _, err := runOpenClawStreamingCommandTo(ctx, timeout, writeOutput, args...)
	return err
}

func runOpenClawDingTalkCommand(ctx context.Context, timeout time.Duration, writeOutput func(string), name string, args ...string) error {
	return runOpenClawDingTalkCommandInDir(ctx, timeout, writeOutput, "", name, args...)
}

func runOpenClawDingTalkCommandInDir(ctx context.Context, timeout time.Duration, writeOutput func(string), dir string, name string, args ...string) error {
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	path := toolenv.ResolveToolPath(name)
	if path == "" {
		path = name
	}
	cmd := exec.CommandContext(cmdCtx, path, args...)
	if strings.TrimSpace(dir) != "" {
		cmd.Dir = dir
	}
	cmd.Env = toolenv.CommandEnv()
	cmd.Stdout = taskWriter{write: func(value string) {
		if writeOutput != nil {
			writeOutput(maskOpenClawDingTalkCommandOutput(value))
		}
	}}
	cmd.Stderr = taskWriter{write: func(value string) {
		if writeOutput != nil {
			writeOutput(maskOpenClawDingTalkCommandOutput(value))
		}
	}}
	if err := cmd.Run(); err != nil {
		if cmdCtx.Err() != nil {
			return cmdCtx.Err()
		}
		return err
	}
	return nil
}

func readOrCreateOpenClawConfig() (map[string]any, error) {
	content, _, err := readOpenClawConfigFile(openClawConfigPath())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	return content, nil
}

func openClawDingTalkPackagePaths(home string) []string {
	paths := []string{
		filepath.Join(home, "extensions", openClawDingTalkChannelID, "package.json"),
		filepath.Join(home, "node_modules", "@dingtalk-real-ai", "dingtalk-connector", "package.json"),
		filepath.Join(home, "npm", "node_modules", "@dingtalk-real-ai", "dingtalk-connector", "package.json"),
	}
	if installPath := openClawPluginInstallRecordPath(home, openClawDingTalkChannelID); installPath != "" {
		paths = append(paths, filepath.Join(installPath, "package.json"))
	}
	return paths
}

func openClawDingTalkInstalledBinPath(home string) string {
	for _, pkgPath := range openClawDingTalkPackagePaths(home) {
		if _, err := os.Stat(pkgPath); err != nil {
			continue
		}
		binPath := filepath.Join(filepath.Dir(pkgPath), "bin", "dingtalk-connector.js")
		if info, err := os.Stat(binPath); err == nil && !info.IsDir() {
			return binPath
		}
	}
	return ""
}

func openClawDingTalkStagingPath() string {
	return filepath.Join(defaultOpenClawHomeDir(), ".dingtalk-staging.json")
}

func cleanupOpenClawDingTalkLocalLoadPath(pathToRemove string) error {
	cleanPath := filepath.Clean(pathToRemove)
	content, exists, err := readOpenClawConfigFile(openClawConfigPath())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if !exists {
		return nil
	}
	plugins := objectMap(content["plugins"])
	load := objectMap(plugins["load"])
	paths, ok := load["paths"].([]any)
	if !ok || len(paths) == 0 {
		return nil
	}
	next := make([]any, 0, len(paths))
	changed := false
	for _, value := range paths {
		pathValue, ok := value.(string)
		if ok && filepath.Clean(pathValue) == cleanPath {
			changed = true
			continue
		}
		next = append(next, value)
	}
	if !changed {
		return nil
	}
	if len(next) == 0 {
		delete(load, "paths")
	} else {
		load["paths"] = next
	}
	if len(load) == 0 {
		delete(plugins, "load")
	} else {
		plugins["load"] = load
	}
	content["plugins"] = plugins
	return writeOpenClawConfigContent(openClawConfigPath(), content)
}

func openClawDingTalkConfigured(section map[string]any) bool {
	if openClawDingTalkTopLevelConfigured(section) {
		return true
	}
	for _, value := range objectMap(section["accounts"]) {
		if openClawDingTalkAccountConfigured(objectMap(value)) {
			return true
		}
	}
	return false
}

func openClawDingTalkTopLevelConfigured(section map[string]any) bool {
	return stringFromMap(section, "clientId") != "" && stringFromMap(section, "clientSecret") != ""
}

func openClawDingTalkAccountConfigured(cfg map[string]any) bool {
	return stringFromMap(cfg, "clientId") != "" && stringFromMap(cfg, "clientSecret") != ""
}

func mergeOpenClawDingTalkDefaultAccount(parent map[string]any, cfg map[string]any) map[string]any {
	merged := map[string]any{}
	for key, value := range parent {
		if key == "accounts" {
			continue
		}
		merged[key] = value
	}
	for key, value := range cfg {
		merged[key] = value
	}
	return merged
}

func parseOptionalOpenClawDingTalkInt(value string, field string, min int) (*int, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, nil
	}
	parsed, err := strconv.Atoi(trimmed)
	if err != nil || parsed < min {
		return nil, fmt.Errorf("%s 必须是大于等于 %d 的整数", field, min)
	}
	return &parsed, nil
}

func parseOptionalOpenClawDingTalkFloat(value string, field string) (*float64, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, nil
	}
	parsed, err := strconv.ParseFloat(trimmed, 64)
	if err != nil || parsed <= 0 {
		return nil, fmt.Errorf("%s 必须是大于 0 的数字", field)
	}
	return &parsed, nil
}

func parseOptionalOpenClawDingTalkObject(value string, field string) (map[string]any, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, nil
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(trimmed), &parsed); err != nil {
		return nil, fmt.Errorf("%s 必须是 JSON 对象: %w", field, err)
	}
	if parsed == nil {
		return nil, fmt.Errorf("%s 必须是 JSON 对象", field)
	}
	return parsed, nil
}

func firstNonEmptyDingTalkObjectMap(values ...map[string]any) map[string]any {
	for _, value := range values {
		if len(value) > 0 {
			return value
		}
	}
	return nil
}

func boolFromDingTalkConfig(cfg map[string]any, parent map[string]any, key string, fallback bool) bool {
	if value, ok := cfg[key]; ok {
		if parsed, ok := value.(bool); ok {
			return parsed
		}
	}
	if value, ok := parent[key]; ok {
		if parsed, ok := value.(bool); ok {
			return parsed
		}
	}
	return fallback
}

func intFromDingTalkConfig(cfg map[string]any, parent map[string]any, key string, fallback int) int {
	if value, ok := cfg[key]; ok {
		return intFromAny(value, fallback)
	}
	if value, ok := parent[key]; ok {
		return intFromAny(value, fallback)
	}
	return fallback
}

func floatFromDingTalkConfig(cfg map[string]any, parent map[string]any, key string, fallback float64) float64 {
	if value, ok := cfg[key]; ok {
		return floatFromAny(value, fallback)
	}
	if value, ok := parent[key]; ok {
		return floatFromAny(value, fallback)
	}
	return fallback
}

func setOptionalDingTalkString(target map[string]any, key string, value *string, clearOnEmpty bool) {
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

func setOpenClawDingTalkPolicy(target map[string]any, key string, value string, allowed func(string) bool) error {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || trimmed == "inherit" {
		delete(target, key)
		return nil
	}
	if !allowed(trimmed) {
		return fmt.Errorf("unsupported policy %q", trimmed)
	}
	target[key] = trimmed
	return nil
}

func allowedOpenClawDingTalkDMPolicy(value string) bool {
	switch value {
	case "pairing", "allowlist", "open", "disabled":
		return true
	default:
		return false
	}
}

func allowedOpenClawDingTalkGroupPolicy(value string) bool {
	switch value {
	case "open", "allowlist", "disabled":
		return true
	default:
		return false
	}
}

func allowedOpenClawDingTalkGroupReplyMode(value string) bool {
	switch value {
	case "aicard", "text", "markdown":
		return true
	default:
		return false
	}
}

func allowedOpenClawDingTalkGroupSessionScope(value string) bool {
	switch value {
	case "group", "group_sender":
		return true
	default:
		return false
	}
}

func splitOpenClawDingTalkList(value string) []string {
	return splitOpenClawTelegramList(value)
}

func firstNonEmptyDingTalkString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func maskOpenClawDingTalkCommandOutput(value string) string {
	lines := strings.Split(value, "\n")
	for index, line := range lines {
		lower := strings.ToLower(line)
		if strings.Contains(lower, "client secret") || strings.Contains(lower, "clientsecret") || strings.Contains(lower, "client_secret") {
			if colon := strings.Index(line, ":"); colon >= 0 {
				lines[index] = line[:colon+1] + " <client-secret>"
			} else {
				lines[index] = "<client-secret>"
			}
		}
	}
	return strings.Join(lines, "\n")
}
