package openclaw

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/sse"
)

const (
	openClawTelegramChannelID = "telegram"
	openClawTelegramPackage   = "@openclaw/telegram"
)

type OpenClawTelegramStatusOutput struct {
	Body OpenClawTelegramStatusResponse
}

type OpenClawTelegramConfigInput struct {
	Body OpenClawTelegramConfigRequest
}

type OpenClawTelegramConfigOutput struct {
	Body OpenClawTelegramStatusResponse
}

type OpenClawTelegramCredentialValidateInput struct {
	Body OpenClawTelegramCredentialValidateRequest
}

type OpenClawTelegramCredentialValidateOutput struct {
	Body OpenClawTelegramCredentialValidateResponse
}

type OpenClawTelegramAccountConfigInput struct {
	AccountID string `path:"accountId" doc:"Telegram account id." example:"default"`
	Body      OpenClawTelegramAccountConfigRequest
}

type OpenClawTelegramAccountConfigOutput struct {
	Body OpenClawTelegramStatusResponse
}

type OpenClawTelegramAccountDeleteInput struct {
	AccountID string `path:"accountId" doc:"Telegram account id." example:"default"`
}

type OpenClawTelegramAccountDeleteOutput struct {
	Body OpenClawTelegramAccountDeleteResponse
}

type OpenClawTelegramAddStreamInput struct {
	AccountID      string `query:"accountId" doc:"Telegram account id. Empty uses default." example:"default"`
	BotToken       string `query:"botToken" doc:"Telegram BotFather token."`
	DMPolicy       string `query:"dmPolicy" enum:"pairing,allowlist,open,disabled" example:"pairing" doc:"Telegram DM access policy."`
	AllowFrom      string `query:"allowFrom" doc:"Comma or newline separated Telegram user ids."`
	Name           string `query:"name" doc:"Optional account display name."`
	AgentID        string `query:"agentId" doc:"Agent id routed to this account."`
	GroupPolicy    string `query:"groupPolicy" doc:"Telegram group access policy. Empty inherits channel default."`
	RequireMention bool   `query:"requireMention" doc:"Whether wildcard groups require bot mention."`
}

type OpenClawTelegramStatusResponse struct {
	Status       string                           `json:"status" example:"ok" doc:"Operation status."`
	ChannelID    string                           `json:"channelId" example:"telegram" doc:"OpenClaw channel id."`
	Package      string                           `json:"package" example:"@openclaw/telegram" doc:"OpenClaw Telegram package name."`
	Installed    bool                             `json:"installed" example:"true" doc:"Whether Telegram appears available from local install records or config."`
	Configured   bool                             `json:"configured" example:"true" doc:"Whether a bot token/tokenFile is configured."`
	Enabled      bool                             `json:"enabled" example:"true" doc:"Whether channels.telegram.enabled is true."`
	Config       OpenClawTelegramConfigResponse   `json:"config" doc:"Telegram channel config summary without secrets."`
	Accounts     []OpenClawTelegramAccountSummary `json:"accounts" doc:"Configured Telegram accounts without bot tokens."`
	ConfigPath   string                           `json:"configPath,omitempty" doc:"OpenClaw config path. Returned after config exists or Telegram is configured."`
	OpenClawHome string                           `json:"openClawHome,omitempty" doc:"OpenClaw home directory. Returned after config exists or Telegram is configured."`
	Version      string                           `json:"version,omitempty" doc:"Installed package version when readable."`
	Error        string                           `json:"error,omitempty" doc:"Config read error."`
}

type OpenClawTelegramConfigResponse struct {
	Enabled            bool                                `json:"enabled" doc:"Whether channels.telegram.enabled is true."`
	DMPolicy           string                              `json:"dmPolicy" example:"pairing" doc:"Direct message policy."`
	GroupPolicy        string                              `json:"groupPolicy,omitempty" example:"allowlist" doc:"Group sender policy."`
	AllowFromCount     int                                 `json:"allowFromCount" doc:"Top-level allowFrom entry count."`
	GroupCount         int                                 `json:"groupCount" doc:"Configured Telegram group count."`
	CustomCommandCount int                                 `json:"customCommandCount" doc:"Configured custom command count."`
	HistoryLimit       string                              `json:"historyLimit,omitempty" doc:"Telegram history limit as configured."`
	ReplyToMode        string                              `json:"replyToMode,omitempty" doc:"Telegram reply-to mode."`
	Streaming          string                              `json:"streaming,omitempty" doc:"Telegram streaming mode."`
	LinkPreview        bool                                `json:"linkPreview" doc:"Whether link preview is enabled."`
	APIRoot            string                              `json:"apiRoot,omitempty" doc:"Telegram Bot API root."`
	ProxyConfigured    bool                                `json:"proxyConfigured" doc:"Whether proxy is configured."`
	ExecApprovals      OpenClawTelegramExecApprovalsConfig `json:"execApprovals" doc:"Telegram exec approval settings."`
	Commands           OpenClawTelegramCommandsConfig      `json:"commands" doc:"Telegram native command settings."`
	CustomCommands     []OpenClawTelegramCustomCommand     `json:"customCommands,omitempty" doc:"Telegram custom command menu entries."`
	StreamingConfig    OpenClawTelegramStreamingConfig     `json:"streamingConfig" doc:"Telegram live preview streaming settings."`
	Webhook            OpenClawTelegramWebhookConfig       `json:"webhook" doc:"Telegram webhook settings without exposing secrets."`
	Capabilities       OpenClawTelegramCapabilitiesConfig  `json:"capabilities" doc:"Telegram capability settings."`
	Actions            OpenClawTelegramActionsConfig       `json:"actions" doc:"Telegram action gate settings."`
}

type OpenClawTelegramAccountSummary struct {
	AccountID       string                              `json:"accountId" example:"default" doc:"Telegram account id."`
	Name            string                              `json:"name,omitempty" doc:"Account display name."`
	Enabled         bool                                `json:"enabled" doc:"Whether this account is enabled."`
	TokenConfigured bool                                `json:"tokenConfigured" doc:"Whether botToken, tokenFile, or env fallback is available."`
	TokenSource     string                              `json:"tokenSource" doc:"Token source without returning the token."`
	DMPolicy        string                              `json:"dmPolicy,omitempty" doc:"Account DM policy override or inherited policy."`
	AllowFrom       []string                            `json:"allowFrom,omitempty" doc:"Effective account allowFrom entries."`
	AllowFromCount  int                                 `json:"allowFromCount" doc:"Account allowFrom entry count."`
	GroupPolicy     string                              `json:"groupPolicy,omitempty" doc:"Account group policy override or inherited policy."`
	GroupCount      int                                 `json:"groupCount" doc:"Account group count."`
	RequireMention  bool                                `json:"requireMention" doc:"Whether wildcard group requires mention."`
	AgentID         string                              `json:"agentId,omitempty" doc:"Agent routed to this account."`
	ExecApprovals   OpenClawTelegramExecApprovalsConfig `json:"execApprovals" doc:"Account exec approval settings."`
	Capabilities    OpenClawTelegramCapabilitiesConfig  `json:"capabilities" doc:"Account capability settings."`
	Actions         OpenClawTelegramActionsConfig       `json:"actions" doc:"Account action gate settings."`
}

type OpenClawTelegramConfigRequest struct {
	Actions        *OpenClawTelegramActionsConfigRequest       `json:"actions,omitempty" doc:"Telegram action gate settings."`
	BlockStreaming *bool                                       `json:"blockStreaming,omitempty" doc:"Whether to enable legacy blockStreaming."`
	Capabilities   *OpenClawTelegramCapabilitiesConfigRequest  `json:"capabilities,omitempty" doc:"Telegram capability settings."`
	Commands       *OpenClawTelegramCommandsConfigRequest      `json:"commands,omitempty" doc:"Telegram native command settings."`
	CustomCommands []OpenClawTelegramCustomCommand             `json:"customCommands,omitempty" doc:"Telegram custom command menu entries."`
	DMPolicy       *string                                     `json:"dmPolicy,omitempty" enum:"pairing,allowlist,open,disabled" doc:"Default Telegram DM access policy."`
	Enabled        *bool                                       `json:"enabled,omitempty" doc:"Telegram channel enabled switch."`
	ExecApprovals  *OpenClawTelegramExecApprovalsConfigRequest `json:"execApprovals,omitempty" doc:"Telegram exec approval settings."`
	Streaming      *OpenClawTelegramStreamingConfigRequest     `json:"streaming,omitempty" doc:"Telegram live preview streaming settings."`
	WebhookHost    *string                                     `json:"webhookHost,omitempty" doc:"Telegram webhook host."`
	WebhookPath    *string                                     `json:"webhookPath,omitempty" doc:"Telegram webhook path."`
	WebhookSecret  *string                                     `json:"webhookSecret,omitempty" doc:"Telegram webhook secret. Empty clears it."`
	WebhookURL     *string                                     `json:"webhookUrl,omitempty" doc:"Telegram webhook URL. Empty clears it."`
}

type OpenClawTelegramCredentialValidateRequest struct {
	BotToken string `json:"botToken" doc:"Telegram BotFather token to validate. Token is never returned."`
}

type OpenClawTelegramCredentialValidateResponse struct {
	Status              string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp           string `json:"timestamp" example:"2026-05-14T09:00:00Z" doc:"UTC response timestamp."`
	Valid               bool   `json:"valid" doc:"Whether Telegram accepted the bot token."`
	BotID               int64  `json:"botId,omitempty" doc:"Telegram bot id."`
	Username            string `json:"username,omitempty" doc:"Telegram bot username."`
	FirstName           string `json:"firstName,omitempty" doc:"Telegram bot first name."`
	Error               string `json:"error,omitempty" doc:"Validation error without exposing the token."`
	RawError            string `json:"rawError,omitempty" doc:"Sanitized original transport error."`
	HTTPStatus          int    `json:"httpStatus,omitempty" doc:"Telegram HTTP status code."`
	TelegramErrorCode   int    `json:"telegramErrorCode,omitempty" doc:"Telegram JSON error_code."`
	TelegramDescription string `json:"telegramDescription,omitempty" doc:"Telegram JSON description."`
	RawResponse         string `json:"rawResponse,omitempty" doc:"Sanitized raw Telegram response body."`
}

type OpenClawTelegramAccountConfigRequest struct {
	AllowFrom      []string                                    `json:"allowFrom,omitempty" doc:"Account allowFrom entries. Empty array clears account override."`
	Actions        *OpenClawTelegramActionsConfigRequest       `json:"actions,omitempty" doc:"Account action gate settings."`
	Capabilities   *OpenClawTelegramCapabilitiesConfigRequest  `json:"capabilities,omitempty" doc:"Account capability settings."`
	BotToken       *string                                     `json:"botToken,omitempty" doc:"New Telegram BotFather token. Empty string is ignored."`
	DMPolicy       *string                                     `json:"dmPolicy,omitempty" enum:"pairing,allowlist,open,disabled" doc:"Account DM access policy."`
	Enabled        *bool                                       `json:"enabled,omitempty" doc:"Account enabled switch."`
	ExecApprovals  *OpenClawTelegramExecApprovalsConfigRequest `json:"execApprovals,omitempty" doc:"Account exec approval settings."`
	GroupPolicy    *string                                     `json:"groupPolicy,omitempty" doc:"Account group access policy. Empty string clears account override."`
	Name           *string                                     `json:"name,omitempty" doc:"Account display name. Empty string clears it."`
	RequireMention *bool                                       `json:"requireMention,omitempty" doc:"Whether wildcard groups require bot mention."`
	AgentID        *string                                     `json:"agentId,omitempty" doc:"Agent id routed to this account. Empty string removes binding."`
}

type OpenClawTelegramExecApprovalsConfig struct {
	Enabled       string   `json:"enabled,omitempty" doc:"Exec approval enabled state: inherit, auto, true, or false."`
	Approvers     []string `json:"approvers,omitempty" doc:"Telegram user ids allowed to approve exec requests."`
	Target        string   `json:"target,omitempty" doc:"Exec approval delivery target: dm, channel, or both."`
	AgentFilter   []string `json:"agentFilter,omitempty" doc:"Optional agent filter."`
	SessionFilter []string `json:"sessionFilter,omitempty" doc:"Optional session filter."`
}

type OpenClawTelegramExecApprovalsConfigRequest struct {
	Enabled       *string  `json:"enabled,omitempty" doc:"Exec approval enabled state: inherit, auto, true, or false."`
	Approvers     []string `json:"approvers,omitempty" doc:"Telegram user ids allowed to approve exec requests."`
	Target        *string  `json:"target,omitempty" doc:"Exec approval delivery target: dm, channel, or both."`
	AgentFilter   []string `json:"agentFilter,omitempty" doc:"Optional agent filter."`
	SessionFilter []string `json:"sessionFilter,omitempty" doc:"Optional session filter."`
}

type OpenClawTelegramCommandsConfig struct {
	Native       string `json:"native,omitempty" doc:"Native command menu state: auto, true, or false."`
	NativeSkills string `json:"nativeSkills,omitempty" doc:"Native skill command menu state: auto, true, or false."`
}

type OpenClawTelegramCommandsConfigRequest struct {
	Native       *string `json:"native,omitempty" doc:"Native command menu state: auto, true, or false."`
	NativeSkills *string `json:"nativeSkills,omitempty" doc:"Native skill command menu state: auto, true, or false."`
}

type OpenClawTelegramCustomCommand struct {
	Command     string `json:"command" doc:"Telegram command without slash."`
	Description string `json:"description" doc:"Command menu description."`
}

type OpenClawTelegramStreamingConfig struct {
	Mode                 string `json:"mode,omitempty" doc:"Streaming mode: off, partial, block, or progress."`
	PreviewToolProgress  bool   `json:"previewToolProgress" doc:"Whether preview streaming includes tool progress."`
	PreviewCommandText   string `json:"previewCommandText,omitempty" doc:"Preview command text mode: raw or status."`
	ProgressToolProgress bool   `json:"progressToolProgress" doc:"Whether progress mode includes tool progress."`
	ProgressCommandText  string `json:"progressCommandText,omitempty" doc:"Progress command text mode: raw or status."`
	BlockStreaming       bool   `json:"blockStreaming" doc:"Legacy blockStreaming flag."`
}

type OpenClawTelegramStreamingConfigRequest struct {
	Mode                 *string `json:"mode,omitempty" doc:"Streaming mode: off, partial, block, or progress."`
	PreviewToolProgress  *bool   `json:"previewToolProgress,omitempty" doc:"Whether preview streaming includes tool progress."`
	PreviewCommandText   *string `json:"previewCommandText,omitempty" doc:"Preview command text mode: raw or status."`
	ProgressToolProgress *bool   `json:"progressToolProgress,omitempty" doc:"Whether progress mode includes tool progress."`
	ProgressCommandText  *string `json:"progressCommandText,omitempty" doc:"Progress command text mode: raw or status."`
}

type OpenClawTelegramWebhookConfig struct {
	URL              string `json:"url,omitempty" doc:"Telegram webhook URL."`
	SecretConfigured bool   `json:"secretConfigured" doc:"Whether webhookSecret is configured."`
	Path             string `json:"path,omitempty" doc:"Telegram webhook path."`
	Host             string `json:"host,omitempty" doc:"Telegram webhook host."`
}

type OpenClawTelegramCapabilitiesConfig struct {
	InlineButtons string `json:"inlineButtons,omitempty" doc:"Inline button capability: off, dm, group, all, or allowlist."`
}

type OpenClawTelegramCapabilitiesConfigRequest struct {
	InlineButtons *string `json:"inlineButtons,omitempty" doc:"Inline button capability: off, dm, group, all, or allowlist."`
}

type OpenClawTelegramActionsConfig struct {
	SendMessage   *bool `json:"sendMessage,omitempty" doc:"Whether sendMessage action is enabled."`
	EditMessage   *bool `json:"editMessage,omitempty" doc:"Whether editMessage action is enabled."`
	DeleteMessage *bool `json:"deleteMessage,omitempty" doc:"Whether deleteMessage action is enabled."`
	Reactions     *bool `json:"reactions,omitempty" doc:"Whether reactions action is enabled."`
	Sticker       *bool `json:"sticker,omitempty" doc:"Whether sticker action is enabled."`
}

type OpenClawTelegramActionsConfigRequest struct {
	SendMessage   *bool `json:"sendMessage,omitempty" doc:"Whether sendMessage action is enabled."`
	EditMessage   *bool `json:"editMessage,omitempty" doc:"Whether editMessage action is enabled."`
	DeleteMessage *bool `json:"deleteMessage,omitempty" doc:"Whether deleteMessage action is enabled."`
	Reactions     *bool `json:"reactions,omitempty" doc:"Whether reactions action is enabled."`
	Sticker       *bool `json:"sticker,omitempty" doc:"Whether sticker action is enabled."`
}

type OpenClawTelegramAccountDeleteResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-14T09:00:00Z" doc:"UTC response timestamp."`
	AccountID string `json:"accountId" doc:"Deleted Telegram account id."`
}

func GetOpenClawTelegramStatus(ctx context.Context, input *struct{}) (*OpenClawTelegramStatusOutput, error) {
	_ = ctx
	return &OpenClawTelegramStatusOutput{Body: detectOpenClawTelegramStatus()}, nil
}

func UpdateOpenClawTelegramConfig(ctx context.Context, input *OpenClawTelegramConfigInput) (*OpenClawTelegramConfigOutput, error) {
	_ = ctx
	if input == nil {
		return nil, huma.Error400BadRequest("telegram config request is required", nil)
	}
	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			content = map[string]any{}
		} else {
			return nil, huma.Error500InternalServerError("read openclaw config failed", err)
		}
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawTelegramChannelID])
	if input.Body.Enabled != nil {
		section["enabled"] = *input.Body.Enabled
	}
	if input.Body.DMPolicy != nil {
		dmPolicy := strings.TrimSpace(*input.Body.DMPolicy)
		if !allowedOpenClawTelegramDMPolicy(dmPolicy) {
			return nil, huma.Error400BadRequest("unsupported telegram dmPolicy", nil)
		}
		section["dmPolicy"] = dmPolicy
	}
	if input.Body.ExecApprovals != nil {
		patchOpenClawTelegramExecApprovals(section, input.Body.ExecApprovals)
	}
	if input.Body.Commands != nil {
		patchOpenClawTelegramCommands(section, input.Body.Commands)
	}
	if input.Body.CustomCommands != nil {
		section["customCommands"] = normalizeOpenClawTelegramCustomCommands(input.Body.CustomCommands)
	}
	if input.Body.Streaming != nil {
		patchOpenClawTelegramStreaming(section, input.Body.Streaming)
	}
	if input.Body.BlockStreaming != nil {
		section["blockStreaming"] = *input.Body.BlockStreaming
	}
	if input.Body.WebhookURL != nil {
		setOpenClawTelegramStringField(section, "webhookUrl", *input.Body.WebhookURL)
	}
	if input.Body.WebhookSecret != nil {
		setOpenClawTelegramStringField(section, "webhookSecret", *input.Body.WebhookSecret)
	}
	if input.Body.WebhookPath != nil {
		setOpenClawTelegramStringField(section, "webhookPath", *input.Body.WebhookPath)
	}
	if input.Body.WebhookHost != nil {
		setOpenClawTelegramStringField(section, "webhookHost", *input.Body.WebhookHost)
	}
	if input.Body.Capabilities != nil {
		patchOpenClawTelegramCapabilities(section, input.Body.Capabilities)
	}
	if input.Body.Actions != nil {
		patchOpenClawTelegramActions(section, input.Body.Actions)
	}
	channels[openClawTelegramChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return nil, huma.Error500InternalServerError("write openclaw config failed", err)
	}
	invalidateOpenClawEnvironmentCache()
	return &OpenClawTelegramConfigOutput{Body: detectOpenClawTelegramStatus()}, nil
}

func ValidateOpenClawTelegramCredential(ctx context.Context, input *OpenClawTelegramCredentialValidateInput) (*OpenClawTelegramCredentialValidateOutput, error) {
	if input == nil || strings.TrimSpace(input.Body.BotToken) == "" {
		return nil, huma.Error400BadRequest("bot token is required", nil)
	}
	result := validateOpenClawTelegramBotToken(ctx, strings.TrimSpace(input.Body.BotToken))
	return &OpenClawTelegramCredentialValidateOutput{Body: result}, nil
}

func UpdateOpenClawTelegramAccountConfig(ctx context.Context, input *OpenClawTelegramAccountConfigInput) (*OpenClawTelegramAccountConfigOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("account id is required", nil)
	}
	if err := patchOpenClawTelegramAccount(strings.TrimSpace(input.AccountID), input.Body); err != nil {
		return nil, huma.Error500InternalServerError("update telegram account config failed", err)
	}
	return &OpenClawTelegramAccountConfigOutput{Body: detectOpenClawTelegramStatus()}, nil
}

func DeleteOpenClawTelegramAccount(ctx context.Context, input *OpenClawTelegramAccountDeleteInput) (*OpenClawTelegramAccountDeleteOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("account id is required", nil)
	}
	accountID := strings.TrimSpace(input.AccountID)
	if err := removeOpenClawTelegramAccount(accountID); err != nil {
		return nil, huma.Error500InternalServerError("delete telegram account failed", err)
	}
	if err := setOpenClawChannelAccountBinding(openClawTelegramChannelID, accountID, ""); err != nil {
		return nil, huma.Error500InternalServerError("update telegram account binding failed", err)
	}
	return &OpenClawTelegramAccountDeleteOutput{Body: OpenClawTelegramAccountDeleteResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AccountID: accountID,
	}}, nil
}

func AddOpenClawTelegramAccountStream(ctx context.Context, input *OpenClawTelegramAddStreamInput, send sse.Sender) {
	if input == nil {
		streamOpenClawChannelError(send, "telegram-add", "add", fmt.Errorf("telegram account request is required"))
		return
	}
	accountID := strings.TrimSpace(input.AccountID)
	if accountID == "" {
		accountID = "default"
	}
	botToken := strings.TrimSpace(input.BotToken)
	if botToken == "" {
		streamOpenClawChannelError(send, "telegram-add", "add", fmt.Errorf("Bot Token 不能为空"))
		return
	}
	dmPolicy := strings.TrimSpace(input.DMPolicy)
	if dmPolicy == "" {
		dmPolicy = "pairing"
	}
	if !allowedOpenClawTelegramDMPolicy(dmPolicy) {
		streamOpenClawChannelError(send, "telegram-add", "add", fmt.Errorf("unsupported dmPolicy %q", dmPolicy))
		return
	}
	groupPolicy := strings.TrimSpace(input.GroupPolicy)
	if groupPolicy != "" && !allowedOpenClawTelegramGroupPolicy(groupPolicy) {
		streamOpenClawChannelError(send, "telegram-add", "add", fmt.Errorf("unsupported groupPolicy %q", groupPolicy))
		return
	}
	if dmPolicy == "allowlist" && len(splitOpenClawTelegramList(input.AllowFrom)) == 0 {
		streamOpenClawChannelError(send, "telegram-add", "add", fmt.Errorf("allowlist 策略需要至少一个 Telegram 用户 ID"))
		return
	}
	args := []string{"channels", "add", "--channel", openClawTelegramChannelID, "--account", accountID, "--token", botToken}
	streamOpenClawChannelSteps(ctx, send, "telegram-add", "add", []openClawChannelStep{
		{label: "检查 OpenClaw CLI", progress: 5, timeout: 10 * time.Second, args: []string{"--version"}},
		{label: "添加 Telegram 账号", progress: 25, timeout: 5 * time.Minute, args: args},
		{label: "写入 Telegram 访问策略", progress: 72, run: func(ctx context.Context, task openClawChannelLogger) error {
			_ = ctx
			if err := configureOpenClawTelegramAccount(accountID, OpenClawTelegramAddConfig{
				AgentID:        input.AgentID,
				AllowFrom:      input.AllowFrom,
				DMPolicy:       dmPolicy,
				GroupPolicy:    groupPolicy,
				Name:           input.Name,
				RequireMention: input.RequireMention,
			}); err != nil {
				return err
			}
			task.addLog("已写入 Telegram 账号配置。")
			return nil
		}},
		{label: "重启 Gateway 应用 Telegram 配置", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
}

type OpenClawTelegramAddConfig struct {
	AgentID        string
	AllowFrom      string
	DMPolicy       string
	GroupPolicy    string
	Name           string
	RequireMention bool
}

func detectOpenClawTelegramStatus() OpenClawTelegramStatusResponse {
	home := defaultOpenClawHomeDir()
	configPath := openClawConfigPath()
	content, exists, configErr := readOpenClawConfigFile(configPath)
	section := objectMap(objectMap(content["channels"])[openClawTelegramChannelID])
	configured := openClawTelegramConfigured(section)
	version := ""
	installed := configured
	for _, pkgPath := range openClawTelegramPackagePaths(home) {
		pkgVersion, ok := readPackageVersion(pkgPath)
		if ok {
			installed = true
			if version == "" {
				version = pkgVersion
			}
		}
	}
	enabled := configured && boolFromMap(section, "enabled")
	response := OpenClawTelegramStatusResponse{
		Status:     "ok",
		ChannelID:  openClawTelegramChannelID,
		Package:    openClawTelegramPackage,
		Installed:  installed,
		Configured: configured,
		Enabled:    enabled,
		Config:     openClawTelegramConfigFromSection(section),
		Accounts:   []OpenClawTelegramAccountSummary{},
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
		response.Accounts = readOpenClawTelegramAccounts(section, readOpenClawChannelAccountBindings(content, openClawTelegramChannelID))
	}
	return response
}

func validateOpenClawTelegramBotToken(ctx context.Context, botToken string) OpenClawTelegramCredentialValidateResponse {
	response := OpenClawTelegramCredentialValidateResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Valid:     false,
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.telegram.org/bot"+botToken+"/getMe", nil)
	if err != nil {
		response.Error = "Telegram 校验请求创建失败"
		response.RawError = sanitizeOpenClawTelegramValidationText(err.Error(), botToken)
		return response
	}
	client := &http.Client{Timeout: 10 * time.Second}
	httpResp, err := client.Do(req)
	if err != nil {
		response.Error = "无法连接 Telegram Bot API"
		response.RawError = sanitizeOpenClawTelegramValidationText(err.Error(), botToken)
		return response
	}
	defer httpResp.Body.Close()
	response.HTTPStatus = httpResp.StatusCode
	rawBody, err := io.ReadAll(io.LimitReader(httpResp.Body, 1<<20))
	if err != nil {
		response.Error = "Telegram 校验响应读取失败"
		response.RawError = sanitizeOpenClawTelegramValidationText(err.Error(), botToken)
		return response
	}
	response.RawResponse = sanitizeOpenClawTelegramValidationText(strings.TrimSpace(string(rawBody)), botToken)

	var payload struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
		ErrorCode   int    `json:"error_code"`
		Result      struct {
			ID        int64  `json:"id"`
			IsBot     bool   `json:"is_bot"`
			FirstName string `json:"first_name"`
			Username  string `json:"username"`
		} `json:"result"`
	}
	if err := json.Unmarshal(rawBody, &payload); err != nil {
		response.Error = "Telegram 校验响应解析失败"
		response.RawError = sanitizeOpenClawTelegramValidationText(err.Error(), botToken)
		return response
	}
	response.TelegramErrorCode = payload.ErrorCode
	response.TelegramDescription = strings.TrimSpace(payload.Description)
	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 || !payload.OK {
		if strings.TrimSpace(payload.Description) != "" {
			response.Error = payload.Description
		} else {
			response.Error = fmt.Sprintf("Telegram Bot API 返回 %d", httpResp.StatusCode)
		}
		return response
	}
	if !payload.Result.IsBot {
		response.Error = "Telegram 返回的账号不是 Bot"
		return response
	}
	response.Valid = true
	response.BotID = payload.Result.ID
	response.Username = strings.TrimSpace(payload.Result.Username)
	response.FirstName = strings.TrimSpace(payload.Result.FirstName)
	return response
}

func sanitizeOpenClawTelegramValidationText(value string, botToken string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	token := strings.TrimSpace(botToken)
	if token != "" {
		value = strings.ReplaceAll(value, token, "<bot-token>")
	}
	return value
}

func openClawTelegramConfigFromSection(section map[string]any) OpenClawTelegramConfigResponse {
	customCommands := customCommandsFromValue(section["customCommands"])
	return OpenClawTelegramConfigResponse{
		Enabled:            boolFromMap(section, "enabled"),
		DMPolicy:           firstNonEmptyTelegramString(stringFromMap(section, "dmPolicy"), "pairing"),
		GroupPolicy:        stringFromMap(section, "groupPolicy"),
		AllowFromCount:     len(stringSliceFromValue(section["allowFrom"])),
		GroupCount:         len(objectMap(section["groups"])),
		CustomCommandCount: len(customCommands),
		HistoryLimit:       stringFromMap(section, "historyLimit"),
		ReplyToMode:        stringFromMap(section, "replyToMode"),
		Streaming:          telegramStreamingMode(section),
		LinkPreview:        !hasExplicitFalse(section, "linkPreview"),
		APIRoot:            stringFromMap(section, "apiRoot"),
		ProxyConfigured:    stringFromMap(section, "proxy") != "",
		ExecApprovals:      openClawTelegramExecApprovalsFromValue(section["execApprovals"]),
		Commands:           openClawTelegramCommandsFromValue(section["commands"]),
		CustomCommands:     customCommands,
		StreamingConfig:    openClawTelegramStreamingFromSection(section),
		Webhook:            openClawTelegramWebhookFromSection(section),
		Capabilities:       openClawTelegramCapabilitiesFromValue(section["capabilities"]),
		Actions:            openClawTelegramActionsFromValue(section["actions"]),
	}
}

func readOpenClawTelegramAccounts(section map[string]any, bindings map[string]string) []OpenClawTelegramAccountSummary {
	accountsCfg := objectMap(section["accounts"])
	ids := make([]string, 0, len(accountsCfg)+1)
	if openClawTelegramTopLevelTokenConfigured(section) || len(accountsCfg) == 0 {
		ids = append(ids, "default")
	}
	for id := range accountsCfg {
		if strings.TrimSpace(id) != "" {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	seen := map[string]bool{}
	accounts := make([]OpenClawTelegramAccountSummary, 0, len(ids))
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		cfg := objectMap(accountsCfg[id])
		if id == "default" && !openClawTelegramAccountConfigured(cfg) {
			cfg = mergeOpenClawTelegramDefaultAccount(section, cfg)
		}
		if !openClawTelegramAccountConfigured(cfg) && id != "default" {
			continue
		}
		accounts = append(accounts, openClawTelegramAccountFromConfig(id, cfg, section, bindings[id]))
	}
	return accounts
}

func openClawTelegramAccountFromConfig(accountID string, cfg map[string]any, parent map[string]any, agentID string) OpenClawTelegramAccountSummary {
	tokenConfigured, tokenSource := openClawTelegramTokenSource(accountID, cfg, parent)
	groupCfg := objectMap(cfg["groups"])
	if len(groupCfg) == 0 {
		groupCfg = objectMap(parent["groups"])
	}
	wildcardGroup := objectMap(groupCfg["*"])
	allowFrom := firstNonEmptyStringSlice(stringSliceFromValue(cfg["allowFrom"]), stringSliceFromValue(parent["allowFrom"]))
	return OpenClawTelegramAccountSummary{
		AccountID:       accountID,
		Name:            stringFromMap(cfg, "name"),
		Enabled:         !hasExplicitFalse(cfg, "enabled") && !hasExplicitFalse(parent, "enabled"),
		TokenConfigured: tokenConfigured,
		TokenSource:     tokenSource,
		DMPolicy:        firstNonEmptyTelegramString(stringFromMap(cfg, "dmPolicy"), stringFromMap(parent, "dmPolicy"), "pairing"),
		AllowFrom:       allowFrom,
		AllowFromCount:  len(allowFrom),
		GroupPolicy:     firstNonEmptyTelegramString(stringFromMap(cfg, "groupPolicy"), stringFromMap(parent, "groupPolicy")),
		GroupCount:      len(groupCfg),
		RequireMention:  boolFromMap(wildcardGroup, "requireMention"),
		AgentID:         strings.TrimSpace(agentID),
		ExecApprovals:   openClawTelegramExecApprovalsFromValue(cfg["execApprovals"]),
		Capabilities:    openClawTelegramCapabilitiesFromValue(cfg["capabilities"]),
		Actions:         openClawTelegramActionsFromValue(cfg["actions"]),
	}
}

func configureOpenClawTelegramAccount(accountID string, patch OpenClawTelegramAddConfig) error {
	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			content = map[string]any{}
		} else {
			return err
		}
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawTelegramChannelID])
	section["enabled"] = true
	accounts := objectMap(section["accounts"])
	accountCfg := objectMap(accounts[accountID])
	accountCfg["enabled"] = true
	if name := strings.TrimSpace(patch.Name); name != "" {
		accountCfg["name"] = name
	}
	accountCfg["dmPolicy"] = patch.DMPolicy
	if patch.GroupPolicy != "" {
		accountCfg["groupPolicy"] = patch.GroupPolicy
	}
	allowFrom := splitOpenClawTelegramList(patch.AllowFrom)
	if patch.DMPolicy == "open" && len(allowFrom) == 0 {
		allowFrom = []string{"*"}
	}
	if len(allowFrom) > 0 {
		accountCfg["allowFrom"] = allowFrom
	} else {
		delete(accountCfg, "allowFrom")
	}
	groups := objectMap(accountCfg["groups"])
	wildcard := objectMap(groups["*"])
	wildcard["requireMention"] = patch.RequireMention
	groups["*"] = wildcard
	accountCfg["groups"] = groups
	accounts[accountID] = accountCfg
	section["accounts"] = accounts
	channels[openClawTelegramChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return err
	}
	if strings.TrimSpace(patch.AgentID) != "" {
		return setOpenClawChannelAccountBinding(openClawTelegramChannelID, accountID, strings.TrimSpace(patch.AgentID))
	}
	return nil
}

func patchOpenClawTelegramAccount(accountID string, patch OpenClawTelegramAccountConfigRequest) error {
	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		return err
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawTelegramChannelID])
	accounts := objectMap(section["accounts"])
	accountCfg := objectMap(accounts[accountID])
	accountChanged := false
	if patch.Enabled != nil {
		if accountID == "default" && !openClawTelegramAccountConfigured(accountCfg) && openClawTelegramTopLevelTokenConfigured(section) {
			section["enabled"] = *patch.Enabled
		} else {
			accountCfg["enabled"] = *patch.Enabled
			accountChanged = true
		}
	}
	if patch.Name != nil {
		if name := strings.TrimSpace(*patch.Name); name != "" {
			accountCfg["name"] = name
		} else {
			delete(accountCfg, "name")
		}
		accountChanged = true
	}
	if patch.BotToken != nil {
		if botToken := strings.TrimSpace(*patch.BotToken); botToken != "" {
			accountCfg["botToken"] = botToken
			delete(accountCfg, "tokenFile")
			accountChanged = true
		}
	}
	if patch.DMPolicy != nil {
		dmPolicy := strings.TrimSpace(*patch.DMPolicy)
		if !allowedOpenClawTelegramDMPolicy(dmPolicy) {
			return huma.Error400BadRequest("unsupported telegram dmPolicy", nil)
		}
		accountCfg["dmPolicy"] = dmPolicy
		accountChanged = true
	}
	if patch.GroupPolicy != nil {
		groupPolicy := strings.TrimSpace(*patch.GroupPolicy)
		if groupPolicy == "" {
			delete(accountCfg, "groupPolicy")
		} else {
			if !allowedOpenClawTelegramGroupPolicy(groupPolicy) {
				return huma.Error400BadRequest("unsupported telegram groupPolicy", nil)
			}
			accountCfg["groupPolicy"] = groupPolicy
		}
		accountChanged = true
	}
	if patch.AllowFrom != nil {
		if len(patch.AllowFrom) > 0 {
			accountCfg["allowFrom"] = dedupeOpenClawTelegramStrings(patch.AllowFrom)
		} else {
			delete(accountCfg, "allowFrom")
		}
		accountChanged = true
	}
	if patch.ExecApprovals != nil {
		patchOpenClawTelegramExecApprovals(accountCfg, patch.ExecApprovals)
		accountChanged = true
	}
	if patch.Capabilities != nil {
		patchOpenClawTelegramCapabilities(accountCfg, patch.Capabilities)
		accountChanged = true
	}
	if patch.Actions != nil {
		patchOpenClawTelegramActions(accountCfg, patch.Actions)
		accountChanged = true
	}
	if patch.RequireMention != nil {
		groups := objectMap(accountCfg["groups"])
		wildcard := objectMap(groups["*"])
		wildcard["requireMention"] = *patch.RequireMention
		groups["*"] = wildcard
		accountCfg["groups"] = groups
		accountChanged = true
	}
	if accountChanged {
		accounts[accountID] = accountCfg
		section["accounts"] = accounts
	}
	channels[openClawTelegramChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return err
	}
	if patch.AgentID != nil {
		return setOpenClawChannelAccountBinding(openClawTelegramChannelID, accountID, strings.TrimSpace(*patch.AgentID))
	}
	return nil
}

func removeOpenClawTelegramAccount(accountID string) error {
	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawTelegramChannelID])
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
		delete(section, "botToken")
		delete(section, "tokenFile")
	}
	if !openClawTelegramConfigured(section) {
		delete(channels, openClawTelegramChannelID)
	} else {
		channels[openClawTelegramChannelID] = section
	}
	content["channels"] = channels
	return writeOpenClawConfigContent(configPath, content)
}

func readOpenClawChannelAccountBindings(content map[string]any, channelID string) map[string]string {
	result := map[string]string{}
	raw, _ := content["bindings"].([]any)
	for _, value := range raw {
		item, ok := value.(map[string]any)
		if !ok {
			continue
		}
		match := objectMap(item["match"])
		if stringFromMap(match, "channel") != channelID {
			continue
		}
		accountID := stringFromMap(match, "accountId")
		if accountID == "" {
			accountID = "default"
		}
		result[accountID] = normalizeOpenClawAgentID(stringFromMap(item, "agentId"))
	}
	return result
}

func setOpenClawChannelAccountBinding(channelID string, accountID string, agentID string) error {
	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			content = map[string]any{}
		} else {
			return err
		}
	}
	accountID = strings.TrimSpace(accountID)
	if accountID == "" {
		accountID = "default"
	}
	agentID = normalizeOpenClawAgentID(agentID)
	raw, _ := content["bindings"].([]any)
	next := make([]any, 0, len(raw)+1)
	for _, value := range raw {
		item, ok := value.(map[string]any)
		if !ok {
			next = append(next, value)
			continue
		}
		match := objectMap(item["match"])
		if stringFromMap(match, "channel") == channelID && firstNonEmptyTelegramString(stringFromMap(match, "accountId"), "default") == accountID {
			continue
		}
		next = append(next, value)
	}
	if agentID != "" {
		next = append(next, map[string]any{
			"type":    "route",
			"agentId": agentID,
			"match": map[string]any{
				"channel":   channelID,
				"accountId": accountID,
			},
		})
	}
	if len(next) == 0 {
		delete(content, "bindings")
	} else {
		content["bindings"] = next
	}
	return writeOpenClawConfigContent(configPath, content)
}

func openClawTelegramConfigured(section map[string]any) bool {
	if openClawTelegramTopLevelTokenConfigured(section) {
		return true
	}
	for _, value := range objectMap(section["accounts"]) {
		if openClawTelegramAccountConfigured(objectMap(value)) {
			return true
		}
	}
	return false
}

func openClawTelegramTopLevelTokenConfigured(section map[string]any) bool {
	return stringFromMap(section, "botToken") != "" || stringFromMap(section, "tokenFile") != "" || strings.TrimSpace(os.Getenv("TELEGRAM_BOT_TOKEN")) != ""
}

func openClawTelegramAccountConfigured(cfg map[string]any) bool {
	return stringFromMap(cfg, "botToken") != "" || stringFromMap(cfg, "tokenFile") != ""
}

func mergeOpenClawTelegramDefaultAccount(parent map[string]any, cfg map[string]any) map[string]any {
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

func openClawTelegramTokenSource(accountID string, cfg map[string]any, parent map[string]any) (bool, string) {
	if stringFromMap(cfg, "botToken") != "" {
		return true, "config"
	}
	if stringFromMap(cfg, "tokenFile") != "" {
		return true, "tokenFile"
	}
	if accountID == "default" {
		if stringFromMap(parent, "botToken") != "" {
			return true, "config"
		}
		if stringFromMap(parent, "tokenFile") != "" {
			return true, "tokenFile"
		}
		if strings.TrimSpace(os.Getenv("TELEGRAM_BOT_TOKEN")) != "" {
			return true, "env"
		}
	}
	return false, "missing"
}

func openClawTelegramPackagePaths(home string) []string {
	paths := []string{
		filepath.Join(home, "extensions", openClawTelegramChannelID, "package.json"),
		filepath.Join(home, "node_modules", "@openclaw", "telegram", "package.json"),
		filepath.Join(home, "npm", "node_modules", "@openclaw", "telegram", "package.json"),
	}
	if installPath := openClawPluginInstallRecordPath(home, openClawTelegramChannelID); installPath != "" {
		paths = append(paths, filepath.Join(installPath, "package.json"))
	}
	return paths
}

func openClawPluginInstallRecordPath(home string, pluginID string) string {
	data, err := os.ReadFile(filepath.Join(home, "plugins", "installs.json"))
	if err != nil {
		return ""
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		return ""
	}
	records := objectMap(payload["installRecords"])
	record := objectMap(records[pluginID])
	return strings.TrimSpace(stringFromMap(record, "installPath"))
}

func openClawTelegramExecApprovalsFromValue(value any) OpenClawTelegramExecApprovalsConfig {
	cfg := objectMap(value)
	return OpenClawTelegramExecApprovalsConfig{
		Enabled:       stringFromBoolLike(cfg["enabled"]),
		Approvers:     stringSliceFromValue(cfg["approvers"]),
		Target:        stringFromMap(cfg, "target"),
		AgentFilter:   stringSliceFromValue(cfg["agentFilter"]),
		SessionFilter: stringSliceFromValue(cfg["sessionFilter"]),
	}
}

func openClawTelegramCommandsFromValue(value any) OpenClawTelegramCommandsConfig {
	cfg := objectMap(value)
	return OpenClawTelegramCommandsConfig{
		Native:       stringFromBoolLike(cfg["native"]),
		NativeSkills: stringFromBoolLike(cfg["nativeSkills"]),
	}
}

func customCommandsFromValue(value any) []OpenClawTelegramCustomCommand {
	raw := anySliceFromValue(value)
	out := make([]OpenClawTelegramCustomCommand, 0, len(raw))
	for _, item := range raw {
		cfg := objectMap(item)
		command := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(stringFromMap(cfg, "command"))), "/")
		description := strings.TrimSpace(stringFromMap(cfg, "description"))
		if command == "" && description == "" {
			continue
		}
		out = append(out, OpenClawTelegramCustomCommand{Command: command, Description: description})
	}
	return out
}

func telegramStreamingMode(section map[string]any) string {
	if mode := stringFromMap(section, "streaming"); mode != "" {
		return mode
	}
	streaming := objectMap(section["streaming"])
	return stringFromMap(streaming, "mode")
}

func openClawTelegramStreamingFromSection(section map[string]any) OpenClawTelegramStreamingConfig {
	streaming := objectMap(section["streaming"])
	preview := objectMap(streaming["preview"])
	progress := objectMap(streaming["progress"])
	return OpenClawTelegramStreamingConfig{
		Mode:                 firstNonEmptyTelegramString(stringFromMap(streaming, "mode"), stringFromMap(section, "streaming"), "partial"),
		PreviewToolProgress:  !hasExplicitFalse(preview, "toolProgress"),
		PreviewCommandText:   firstNonEmptyTelegramString(stringFromMap(preview, "commandText"), "raw"),
		ProgressToolProgress: !hasExplicitFalse(progress, "toolProgress"),
		ProgressCommandText:  firstNonEmptyTelegramString(stringFromMap(progress, "commandText"), "raw"),
		BlockStreaming:       boolFromMap(section, "blockStreaming"),
	}
}

func openClawTelegramWebhookFromSection(section map[string]any) OpenClawTelegramWebhookConfig {
	return OpenClawTelegramWebhookConfig{
		URL:              stringFromMap(section, "webhookUrl"),
		SecretConfigured: stringFromMap(section, "webhookSecret") != "",
		Path:             stringFromMap(section, "webhookPath"),
		Host:             stringFromMap(section, "webhookHost"),
	}
}

func openClawTelegramCapabilitiesFromValue(value any) OpenClawTelegramCapabilitiesConfig {
	cfg := objectMap(value)
	return OpenClawTelegramCapabilitiesConfig{
		InlineButtons: stringFromMap(cfg, "inlineButtons"),
	}
}

func openClawTelegramActionsFromValue(value any) OpenClawTelegramActionsConfig {
	cfg := objectMap(value)
	return OpenClawTelegramActionsConfig{
		SendMessage:   boolPointerFromMap(cfg, "sendMessage"),
		EditMessage:   boolPointerFromMap(cfg, "editMessage"),
		DeleteMessage: boolPointerFromMap(cfg, "deleteMessage"),
		Reactions:     boolPointerFromMap(cfg, "reactions"),
		Sticker:       boolPointerFromMap(cfg, "sticker"),
	}
}

func patchOpenClawTelegramExecApprovals(target map[string]any, patch *OpenClawTelegramExecApprovalsConfigRequest) {
	cfg := objectMap(target["execApprovals"])
	if patch.Enabled != nil {
		setOpenClawTelegramChoiceField(cfg, "enabled", *patch.Enabled)
	}
	if patch.Approvers != nil {
		setOpenClawTelegramStringSliceField(cfg, "approvers", patch.Approvers)
	}
	if patch.Target != nil {
		setOpenClawTelegramStringField(cfg, "target", *patch.Target)
	}
	if patch.AgentFilter != nil {
		setOpenClawTelegramStringSliceField(cfg, "agentFilter", patch.AgentFilter)
	}
	if patch.SessionFilter != nil {
		setOpenClawTelegramStringSliceField(cfg, "sessionFilter", patch.SessionFilter)
	}
	setOpenClawTelegramObjectField(target, "execApprovals", cfg)
}

func patchOpenClawTelegramCommands(target map[string]any, patch *OpenClawTelegramCommandsConfigRequest) {
	cfg := objectMap(target["commands"])
	if patch.Native != nil {
		setOpenClawTelegramChoiceField(cfg, "native", *patch.Native)
	}
	if patch.NativeSkills != nil {
		setOpenClawTelegramChoiceField(cfg, "nativeSkills", *patch.NativeSkills)
	}
	setOpenClawTelegramObjectField(target, "commands", cfg)
}

func patchOpenClawTelegramStreaming(target map[string]any, patch *OpenClawTelegramStreamingConfigRequest) {
	cfg := objectMap(target["streaming"])
	if patch.Mode != nil {
		setOpenClawTelegramStringField(cfg, "mode", *patch.Mode)
	}
	if patch.PreviewToolProgress != nil || patch.PreviewCommandText != nil {
		preview := objectMap(cfg["preview"])
		if patch.PreviewToolProgress != nil {
			preview["toolProgress"] = *patch.PreviewToolProgress
		}
		if patch.PreviewCommandText != nil {
			setOpenClawTelegramStringField(preview, "commandText", *patch.PreviewCommandText)
		}
		setOpenClawTelegramObjectField(cfg, "preview", preview)
	}
	if patch.ProgressToolProgress != nil || patch.ProgressCommandText != nil {
		progress := objectMap(cfg["progress"])
		if patch.ProgressToolProgress != nil {
			progress["toolProgress"] = *patch.ProgressToolProgress
		}
		if patch.ProgressCommandText != nil {
			setOpenClawTelegramStringField(progress, "commandText", *patch.ProgressCommandText)
		}
		setOpenClawTelegramObjectField(cfg, "progress", progress)
	}
	setOpenClawTelegramObjectField(target, "streaming", cfg)
}

func patchOpenClawTelegramCapabilities(target map[string]any, patch *OpenClawTelegramCapabilitiesConfigRequest) {
	cfg := objectMap(target["capabilities"])
	if patch.InlineButtons != nil {
		setOpenClawTelegramStringField(cfg, "inlineButtons", *patch.InlineButtons)
	}
	setOpenClawTelegramObjectField(target, "capabilities", cfg)
}

func patchOpenClawTelegramActions(target map[string]any, patch *OpenClawTelegramActionsConfigRequest) {
	cfg := objectMap(target["actions"])
	setOpenClawTelegramBoolPointerField(cfg, "sendMessage", patch.SendMessage)
	setOpenClawTelegramBoolPointerField(cfg, "editMessage", patch.EditMessage)
	setOpenClawTelegramBoolPointerField(cfg, "deleteMessage", patch.DeleteMessage)
	setOpenClawTelegramBoolPointerField(cfg, "reactions", patch.Reactions)
	setOpenClawTelegramBoolPointerField(cfg, "sticker", patch.Sticker)
	setOpenClawTelegramObjectField(target, "actions", cfg)
}

func normalizeOpenClawTelegramCustomCommands(values []OpenClawTelegramCustomCommand) []any {
	out := make([]any, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		command := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(value.Command)), "/")
		description := strings.TrimSpace(value.Description)
		if command == "" || description == "" || seen[command] {
			continue
		}
		seen[command] = true
		out = append(out, map[string]any{"command": command, "description": description})
	}
	return out
}

func setOpenClawTelegramStringField(target map[string]any, key string, value string) {
	if strings.TrimSpace(value) == "" {
		delete(target, key)
		return
	}
	target[key] = strings.TrimSpace(value)
}

func setOpenClawTelegramChoiceField(target map[string]any, key string, value string) {
	switch strings.TrimSpace(value) {
	case "", "inherit":
		delete(target, key)
	case "true":
		target[key] = true
	case "false":
		target[key] = false
	default:
		target[key] = strings.TrimSpace(value)
	}
}

func setOpenClawTelegramBoolPointerField(target map[string]any, key string, value *bool) {
	if value == nil {
		return
	}
	target[key] = *value
}

func setOpenClawTelegramStringSliceField(target map[string]any, key string, values []string) {
	clean := dedupeOpenClawTelegramStrings(values)
	if len(clean) == 0 {
		delete(target, key)
		return
	}
	target[key] = clean
}

func setOpenClawTelegramObjectField(target map[string]any, key string, value map[string]any) {
	if len(value) == 0 {
		delete(target, key)
		return
	}
	target[key] = value
}

func stringFromBoolLike(value any) string {
	switch typed := value.(type) {
	case bool:
		if typed {
			return "true"
		}
		return "false"
	case string:
		return strings.TrimSpace(typed)
	default:
		return ""
	}
}

func boolPointerFromMap(values map[string]any, key string) *bool {
	value, ok := values[key]
	if !ok {
		return nil
	}
	if typed, ok := value.(bool); ok {
		return &typed
	}
	return nil
}

func splitOpenClawTelegramList(value string) []string {
	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == '，' || r == '\n' || r == '\r' || r == ';' || r == '；'
	})
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		text := strings.TrimSpace(part)
		if text == "" || seen[text] {
			continue
		}
		seen[text] = true
		out = append(out, text)
	}
	return out
}

func allowedOpenClawTelegramDMPolicy(value string) bool {
	switch value {
	case "pairing", "allowlist", "open", "disabled":
		return true
	default:
		return false
	}
}

func allowedOpenClawTelegramGroupPolicy(value string) bool {
	switch value {
	case "open", "allowlist", "disabled":
		return true
	default:
		return false
	}
}

func dedupeOpenClawTelegramStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		text := strings.TrimSpace(value)
		if text == "" || seen[text] {
			continue
		}
		seen[text] = true
		out = append(out, text)
	}
	return out
}

func anySliceFromValue(value any) []any {
	if existing, ok := value.([]any); ok {
		return existing
	}
	return nil
}

func firstNonEmptyTelegramString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstNonEmptyStringSlice(values ...[]string) []string {
	for _, value := range values {
		if len(value) > 0 {
			return value
		}
	}
	return nil
}
