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
	openClawDiscordChannelID = "discord"
	openClawDiscordPackage   = "@openclaw/discord"
)

type OpenClawDiscordStatusOutput struct {
	Body OpenClawDiscordStatusResponse
}

type OpenClawDiscordConfigInput struct {
	Body OpenClawDiscordConfigRequest
}

type OpenClawDiscordConfigOutput struct {
	Body OpenClawDiscordStatusResponse
}

type OpenClawDiscordCredentialValidateInput struct {
	Body OpenClawDiscordCredentialValidateRequest
}

type OpenClawDiscordCredentialValidateOutput struct {
	Body OpenClawDiscordCredentialValidateResponse
}

type OpenClawDiscordAccountConfigInput struct {
	AccountID string `path:"accountId" doc:"Discord account id." example:"default"`
	Body      OpenClawDiscordAccountConfigRequest
}

type OpenClawDiscordAccountConfigOutput struct {
	Body OpenClawDiscordStatusResponse
}

type OpenClawDiscordAccountDeleteInput struct {
	AccountID string `path:"accountId" doc:"Discord account id." example:"default"`
}

type OpenClawDiscordAccountDeleteOutput struct {
	Body OpenClawDiscordAccountDeleteResponse
}

type OpenClawDiscordAddStreamInput struct {
	AccountID      string `query:"accountId" doc:"Discord account id. Empty uses default." example:"default"`
	ApplicationID  string `query:"applicationId" doc:"Optional Discord application/client id."`
	BotToken       string `query:"botToken" doc:"Discord Developer Portal token."`
	DMPolicy       string `query:"dmPolicy" enum:"pairing,allowlist,open,disabled" example:"pairing" doc:"Discord DM access policy."`
	AllowFrom      string `query:"allowFrom" doc:"Comma or newline separated Discord user ids."`
	Name           string `query:"name" doc:"Optional account display name."`
	AgentID        string `query:"agentId" doc:"Agent id routed to this account."`
	GuildIDs       string `query:"guildIds" doc:"Comma or newline separated Discord guild ids allowed for guild channels."`
	GroupPolicy    string `query:"groupPolicy" doc:"Discord group access policy. Empty inherits channel default."`
	RequireMention bool   `query:"requireMention" doc:"Whether wildcard groups require bot mention."`
}

type OpenClawDiscordStatusResponse struct {
	Status       string                          `json:"status" example:"ok" doc:"Operation status."`
	ChannelID    string                          `json:"channelId" example:"discord" doc:"OpenClaw channel id."`
	Package      string                          `json:"package" example:"@openclaw/discord" doc:"OpenClaw Discord package name."`
	Installed    bool                            `json:"installed" example:"true" doc:"Whether Discord appears available from local install records or config."`
	Configured   bool                            `json:"configured" example:"true" doc:"Whether a bot token or DISCORD_BOT_TOKEN fallback is configured."`
	Enabled      bool                            `json:"enabled" example:"true" doc:"Whether channels.discord.enabled is true."`
	Config       OpenClawDiscordConfigResponse   `json:"config" doc:"Discord channel config summary without secrets."`
	Accounts     []OpenClawDiscordAccountSummary `json:"accounts" doc:"Configured Discord accounts without bot tokens."`
	ConfigPath   string                          `json:"configPath,omitempty" doc:"OpenClaw config path. Returned after config exists or Discord is configured."`
	OpenClawHome string                          `json:"openClawHome,omitempty" doc:"OpenClaw home directory. Returned after config exists or Discord is configured."`
	Version      string                          `json:"version,omitempty" doc:"Installed package version when readable."`
	Error        string                          `json:"error,omitempty" doc:"Config read error."`
}

type OpenClawDiscordConfigResponse struct {
	Enabled         bool                               `json:"enabled" doc:"Whether channels.discord.enabled is true."`
	DMPolicy        string                             `json:"dmPolicy" example:"pairing" doc:"Direct message policy."`
	GroupPolicy     string                             `json:"groupPolicy,omitempty" example:"allowlist" doc:"Group sender policy."`
	AllowFromCount  int                                `json:"allowFromCount" doc:"Top-level allowFrom entry count."`
	GroupCount      int                                `json:"groupCount" doc:"Configured Discord group count."`
	HistoryLimit    string                             `json:"historyLimit,omitempty" doc:"Discord history limit as configured."`
	ReplyToMode     string                             `json:"replyToMode,omitempty" doc:"Discord reply-to mode."`
	Streaming       string                             `json:"streaming,omitempty" doc:"Discord streaming mode."`
	ProxyConfigured bool                               `json:"proxyConfigured" doc:"Whether proxy is configured."`
	ExecApprovals   OpenClawDiscordExecApprovalsConfig `json:"execApprovals" doc:"Discord exec approval settings."`
	Commands        OpenClawDiscordCommandsConfig      `json:"commands" doc:"Discord native command settings."`
	StreamingConfig OpenClawDiscordStreamingConfig     `json:"streamingConfig" doc:"Discord live preview streaming settings."`
	Actions         OpenClawDiscordActionsConfig       `json:"actions" doc:"Discord action gate settings."`
}

type OpenClawDiscordAccountSummary struct {
	AccountID       string                             `json:"accountId" example:"default" doc:"Discord account id."`
	ApplicationID   string                             `json:"applicationId,omitempty" doc:"Discord application/client id."`
	Name            string                             `json:"name,omitempty" doc:"Account display name."`
	Enabled         bool                               `json:"enabled" doc:"Whether this account is enabled."`
	TokenConfigured bool                               `json:"tokenConfigured" doc:"Whether token or env fallback is available."`
	TokenSource     string                             `json:"tokenSource" doc:"Token source without returning the token."`
	DMPolicy        string                             `json:"dmPolicy,omitempty" doc:"Account DM policy override or inherited policy."`
	AllowFrom       []string                           `json:"allowFrom,omitempty" doc:"Effective account allowFrom entries."`
	AllowFromCount  int                                `json:"allowFromCount" doc:"Account allowFrom entry count."`
	GroupPolicy     string                             `json:"groupPolicy,omitempty" doc:"Account group policy override or inherited policy."`
	GroupCount      int                                `json:"groupCount" doc:"Account group count."`
	GuildIDs        []string                           `json:"guildIds,omitempty" doc:"Configured Discord guild ids or slugs."`
	RequireMention  bool                               `json:"requireMention" doc:"Whether wildcard group requires mention."`
	AgentID         string                             `json:"agentId,omitempty" doc:"Agent routed to this account."`
	ExecApprovals   OpenClawDiscordExecApprovalsConfig `json:"execApprovals" doc:"Account exec approval settings."`
	Actions         OpenClawDiscordActionsConfig       `json:"actions" doc:"Account action gate settings."`
}

type OpenClawDiscordConfigRequest struct {
	Actions       *OpenClawDiscordActionsConfigRequest       `json:"actions,omitempty" doc:"Discord action gate settings."`
	Commands      *OpenClawDiscordCommandsConfigRequest      `json:"commands,omitempty" doc:"Discord native command settings."`
	DMPolicy      *string                                    `json:"dmPolicy,omitempty" enum:"pairing,allowlist,open,disabled" doc:"Default Discord DM access policy."`
	Enabled       *bool                                      `json:"enabled,omitempty" doc:"Discord channel enabled switch."`
	ExecApprovals *OpenClawDiscordExecApprovalsConfigRequest `json:"execApprovals,omitempty" doc:"Discord exec approval settings."`
	GroupPolicy   *string                                    `json:"groupPolicy,omitempty" enum:"open,allowlist,disabled" doc:"Default Discord guild access policy."`
	Streaming     *OpenClawDiscordStreamingConfigRequest     `json:"streaming,omitempty" doc:"Discord live preview streaming settings."`
}

type OpenClawDiscordCredentialValidateRequest struct {
	BotToken string `json:"botToken" doc:"Discord Developer Portal token to validate. Token is never returned."`
}

type OpenClawDiscordCredentialValidateResponse struct {
	Status             string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp          string `json:"timestamp" example:"2026-05-14T09:00:00Z" doc:"UTC response timestamp."`
	Valid              bool   `json:"valid" doc:"Whether Discord accepted the bot token."`
	BotID              string `json:"botId,omitempty" doc:"Discord bot id."`
	Username           string `json:"username,omitempty" doc:"Discord bot username."`
	Error              string `json:"error,omitempty" doc:"Validation error without exposing the token."`
	RawError           string `json:"rawError,omitempty" doc:"Sanitized original transport error."`
	HTTPStatus         int    `json:"httpStatus,omitempty" doc:"Discord HTTP status code."`
	DiscordErrorCode   int    `json:"discordErrorCode,omitempty" doc:"Discord JSON error code."`
	DiscordDescription string `json:"discordDescription,omitempty" doc:"Discord JSON error message."`
	RawResponse        string `json:"rawResponse,omitempty" doc:"Sanitized raw Discord response body."`
}

type OpenClawDiscordAccountConfigRequest struct {
	AllowFrom      []string                                   `json:"allowFrom,omitempty" doc:"Account allowFrom entries. Empty array clears account override."`
	Actions        *OpenClawDiscordActionsConfigRequest       `json:"actions,omitempty" doc:"Account action gate settings."`
	ApplicationID  *string                                    `json:"applicationId,omitempty" doc:"Discord application/client id. Empty string clears it."`
	BotToken       *string                                    `json:"botToken,omitempty" doc:"New Discord Developer Portal token. Empty string is ignored."`
	DMPolicy       *string                                    `json:"dmPolicy,omitempty" enum:"pairing,allowlist,open,disabled" doc:"Account DM access policy."`
	Enabled        *bool                                      `json:"enabled,omitempty" doc:"Account enabled switch."`
	ExecApprovals  *OpenClawDiscordExecApprovalsConfigRequest `json:"execApprovals,omitempty" doc:"Account exec approval settings."`
	GuildIDs       []string                                   `json:"guildIds,omitempty" doc:"Discord guild ids or slugs allowed for this account."`
	GroupPolicy    *string                                    `json:"groupPolicy,omitempty" doc:"Account group access policy. Empty string clears account override."`
	Name           *string                                    `json:"name,omitempty" doc:"Account display name. Empty string clears it."`
	RequireMention *bool                                      `json:"requireMention,omitempty" doc:"Whether wildcard groups require bot mention."`
	AgentID        *string                                    `json:"agentId,omitempty" doc:"Agent id routed to this account. Empty string removes binding."`
}

type OpenClawDiscordExecApprovalsConfig struct {
	Enabled       string   `json:"enabled,omitempty" doc:"Exec approval enabled state: inherit, auto, true, or false."`
	Approvers     []string `json:"approvers,omitempty" doc:"Discord user ids allowed to approve exec requests."`
	Target        string   `json:"target,omitempty" doc:"Exec approval delivery target: dm, channel, or both."`
	AgentFilter   []string `json:"agentFilter,omitempty" doc:"Optional agent filter."`
	SessionFilter []string `json:"sessionFilter,omitempty" doc:"Optional session filter."`
}

type OpenClawDiscordExecApprovalsConfigRequest struct {
	Enabled       *string  `json:"enabled,omitempty" doc:"Exec approval enabled state: inherit, auto, true, or false."`
	Approvers     []string `json:"approvers,omitempty" doc:"Discord user ids allowed to approve exec requests."`
	Target        *string  `json:"target,omitempty" doc:"Exec approval delivery target: dm, channel, or both."`
	AgentFilter   []string `json:"agentFilter,omitempty" doc:"Optional agent filter."`
	SessionFilter []string `json:"sessionFilter,omitempty" doc:"Optional session filter."`
}

type OpenClawDiscordCommandsConfig struct {
	Native       string `json:"native,omitempty" doc:"Native command menu state: auto, true, or false."`
	NativeSkills string `json:"nativeSkills,omitempty" doc:"Native skill command menu state: auto, true, or false."`
}

type OpenClawDiscordCommandsConfigRequest struct {
	Native       *string `json:"native,omitempty" doc:"Native command menu state: auto, true, or false."`
	NativeSkills *string `json:"nativeSkills,omitempty" doc:"Native skill command menu state: auto, true, or false."`
}

type OpenClawDiscordStreamingConfig struct {
	Mode                 string `json:"mode,omitempty" doc:"Streaming mode: off, partial, block, or progress."`
	PreviewToolProgress  bool   `json:"previewToolProgress" doc:"Whether preview streaming includes tool progress."`
	PreviewCommandText   string `json:"previewCommandText,omitempty" doc:"Preview command text mode: raw or status."`
	ProgressToolProgress bool   `json:"progressToolProgress" doc:"Whether progress mode includes tool progress."`
	ProgressCommandText  string `json:"progressCommandText,omitempty" doc:"Progress command text mode: raw or status."`
	BlockStreaming       bool   `json:"blockStreaming" doc:"Legacy blockStreaming flag."`
}

type OpenClawDiscordStreamingConfigRequest struct {
	Mode                 *string `json:"mode,omitempty" doc:"Streaming mode: off, partial, block, or progress."`
	PreviewToolProgress  *bool   `json:"previewToolProgress,omitempty" doc:"Whether preview streaming includes tool progress."`
	PreviewCommandText   *string `json:"previewCommandText,omitempty" doc:"Preview command text mode: raw or status."`
	ProgressToolProgress *bool   `json:"progressToolProgress,omitempty" doc:"Whether progress mode includes tool progress."`
	ProgressCommandText  *string `json:"progressCommandText,omitempty" doc:"Progress command text mode: raw or status."`
}

type OpenClawDiscordActionsConfig struct {
	Messages    *bool `json:"messages,omitempty" doc:"Whether Discord message actions are enabled."`
	Reactions   *bool `json:"reactions,omitempty" doc:"Whether Discord reaction actions are enabled."`
	Stickers    *bool `json:"stickers,omitempty" doc:"Whether Discord sticker actions are enabled."`
	Polls       *bool `json:"polls,omitempty" doc:"Whether Discord poll actions are enabled."`
	Threads     *bool `json:"threads,omitempty" doc:"Whether Discord thread actions are enabled."`
	Pins        *bool `json:"pins,omitempty" doc:"Whether Discord pin actions are enabled."`
	Moderation  *bool `json:"moderation,omitempty" doc:"Whether Discord moderation actions are enabled."`
	Permissions *bool `json:"permissions,omitempty" doc:"Whether Discord permission actions are enabled."`
}

type OpenClawDiscordActionsConfigRequest struct {
	Messages    *bool `json:"messages,omitempty" doc:"Whether Discord message actions are enabled."`
	Reactions   *bool `json:"reactions,omitempty" doc:"Whether Discord reaction actions are enabled."`
	Stickers    *bool `json:"stickers,omitempty" doc:"Whether Discord sticker actions are enabled."`
	Polls       *bool `json:"polls,omitempty" doc:"Whether Discord poll actions are enabled."`
	Threads     *bool `json:"threads,omitempty" doc:"Whether Discord thread actions are enabled."`
	Pins        *bool `json:"pins,omitempty" doc:"Whether Discord pin actions are enabled."`
	Moderation  *bool `json:"moderation,omitempty" doc:"Whether Discord moderation actions are enabled."`
	Permissions *bool `json:"permissions,omitempty" doc:"Whether Discord permission actions are enabled."`
}

type OpenClawDiscordAccountDeleteResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-14T09:00:00Z" doc:"UTC response timestamp."`
	AccountID string `json:"accountId" doc:"Deleted Discord account id."`
}

func GetOpenClawDiscordStatus(ctx context.Context, input *struct{}) (*OpenClawDiscordStatusOutput, error) {
	_ = ctx
	return &OpenClawDiscordStatusOutput{Body: detectOpenClawDiscordStatus()}, nil
}

func UpdateOpenClawDiscordConfig(ctx context.Context, input *OpenClawDiscordConfigInput) (*OpenClawDiscordConfigOutput, error) {
	_ = ctx
	if input == nil {
		return nil, huma.Error400BadRequest("discord config request is required", nil)
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
	section := objectMap(channels[openClawDiscordChannelID])
	if input.Body.Enabled != nil {
		section["enabled"] = *input.Body.Enabled
	}
	if input.Body.DMPolicy != nil {
		dmPolicy := strings.TrimSpace(*input.Body.DMPolicy)
		if !allowedOpenClawDiscordDMPolicy(dmPolicy) {
			return nil, huma.Error400BadRequest("unsupported discord dmPolicy", nil)
		}
		section["dmPolicy"] = dmPolicy
	}
	if input.Body.GroupPolicy != nil {
		groupPolicy := strings.TrimSpace(*input.Body.GroupPolicy)
		if groupPolicy == "" {
			delete(section, "groupPolicy")
		} else {
			if !allowedOpenClawDiscordGroupPolicy(groupPolicy) {
				return nil, huma.Error400BadRequest("unsupported discord groupPolicy", nil)
			}
			section["groupPolicy"] = groupPolicy
		}
	}
	if input.Body.ExecApprovals != nil {
		patchOpenClawDiscordExecApprovals(section, input.Body.ExecApprovals)
	}
	if input.Body.Commands != nil {
		patchOpenClawDiscordCommands(section, input.Body.Commands)
	}
	if input.Body.Streaming != nil {
		patchOpenClawDiscordStreaming(section, input.Body.Streaming)
	}
	if input.Body.Actions != nil {
		patchOpenClawDiscordActions(section, input.Body.Actions)
	}
	channels[openClawDiscordChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return nil, huma.Error500InternalServerError("write openclaw config failed", err)
	}
	invalidateOpenClawEnvironmentCache()
	return &OpenClawDiscordConfigOutput{Body: detectOpenClawDiscordStatus()}, nil
}

func ValidateOpenClawDiscordCredential(ctx context.Context, input *OpenClawDiscordCredentialValidateInput) (*OpenClawDiscordCredentialValidateOutput, error) {
	if input == nil || strings.TrimSpace(input.Body.BotToken) == "" {
		return nil, huma.Error400BadRequest("bot token is required", nil)
	}
	result := validateOpenClawDiscordBotToken(ctx, strings.TrimSpace(input.Body.BotToken))
	return &OpenClawDiscordCredentialValidateOutput{Body: result}, nil
}

func UpdateOpenClawDiscordAccountConfig(ctx context.Context, input *OpenClawDiscordAccountConfigInput) (*OpenClawDiscordAccountConfigOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("account id is required", nil)
	}
	if err := patchOpenClawDiscordAccount(strings.TrimSpace(input.AccountID), input.Body); err != nil {
		return nil, huma.Error500InternalServerError("update discord account config failed", err)
	}
	return &OpenClawDiscordAccountConfigOutput{Body: detectOpenClawDiscordStatus()}, nil
}

func DeleteOpenClawDiscordAccount(ctx context.Context, input *OpenClawDiscordAccountDeleteInput) (*OpenClawDiscordAccountDeleteOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("account id is required", nil)
	}
	accountID := strings.TrimSpace(input.AccountID)
	if err := removeOpenClawDiscordAccount(accountID); err != nil {
		return nil, huma.Error500InternalServerError("delete discord account failed", err)
	}
	if err := setOpenClawChannelAccountBinding(openClawDiscordChannelID, accountID, ""); err != nil {
		return nil, huma.Error500InternalServerError("update discord account binding failed", err)
	}
	return &OpenClawDiscordAccountDeleteOutput{Body: OpenClawDiscordAccountDeleteResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AccountID: accountID,
	}}, nil
}

func AddOpenClawDiscordAccountStream(ctx context.Context, input *OpenClawDiscordAddStreamInput, send sse.Sender) {
	if input == nil {
		streamOpenClawChannelError(send, "discord-add", "add", fmt.Errorf("discord account request is required"))
		return
	}
	accountID := strings.TrimSpace(input.AccountID)
	if accountID == "" {
		accountID = "default"
	}
	botToken := strings.TrimSpace(input.BotToken)
	if botToken == "" {
		streamOpenClawChannelError(send, "discord-add", "add", fmt.Errorf("Bot Token 不能为空"))
		return
	}
	dmPolicy := strings.TrimSpace(input.DMPolicy)
	if dmPolicy == "" {
		dmPolicy = "pairing"
	}
	if !allowedOpenClawDiscordDMPolicy(dmPolicy) {
		streamOpenClawChannelError(send, "discord-add", "add", fmt.Errorf("unsupported dmPolicy %q", dmPolicy))
		return
	}
	groupPolicy := strings.TrimSpace(input.GroupPolicy)
	if groupPolicy != "" && !allowedOpenClawDiscordGroupPolicy(groupPolicy) {
		streamOpenClawChannelError(send, "discord-add", "add", fmt.Errorf("unsupported groupPolicy %q", groupPolicy))
		return
	}
	if dmPolicy == "allowlist" && len(splitOpenClawDiscordList(input.AllowFrom)) == 0 {
		streamOpenClawChannelError(send, "discord-add", "add", fmt.Errorf("allowlist 策略需要至少一个 Discord 用户 ID"))
		return
	}
	args := []string{"channels", "add", "--channel", openClawDiscordChannelID, "--account", accountID, "--token", botToken}
	streamOpenClawChannelSteps(ctx, send, "discord-add", "add", []openClawChannelStep{
		{label: "检查 OpenClaw CLI", progress: 5, timeout: 10 * time.Second, args: []string{"--version"}},
		{label: "添加 Discord 账号", progress: 25, timeout: 5 * time.Minute, args: args},
		{label: "写入 Discord 访问策略", progress: 72, run: func(ctx context.Context, task openClawChannelLogger) error {
			_ = ctx
			if err := configureOpenClawDiscordAccount(accountID, OpenClawDiscordAddConfig{
				AgentID:        input.AgentID,
				AllowFrom:      input.AllowFrom,
				ApplicationID:  input.ApplicationID,
				DMPolicy:       dmPolicy,
				GuildIDs:       input.GuildIDs,
				GroupPolicy:    groupPolicy,
				Name:           input.Name,
				RequireMention: input.RequireMention,
			}); err != nil {
				return err
			}
			task.addLog("已写入 Discord 账号配置。")
			return nil
		}},
		{label: "重启 Gateway 应用 Discord 配置", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
}

type OpenClawDiscordAddConfig struct {
	AgentID        string
	AllowFrom      string
	ApplicationID  string
	DMPolicy       string
	GuildIDs       string
	GroupPolicy    string
	Name           string
	RequireMention bool
}

func detectOpenClawDiscordStatus() OpenClawDiscordStatusResponse {
	home := defaultOpenClawHomeDir()
	configPath := openClawConfigPath()
	content, exists, configErr := readOpenClawConfigFile(configPath)
	section := objectMap(objectMap(content["channels"])[openClawDiscordChannelID])
	configured := openClawDiscordConfigured(section)
	version := ""
	installed := configured
	for _, pkgPath := range openClawDiscordPackagePaths(home) {
		pkgVersion, ok := readPackageVersion(pkgPath)
		if ok {
			installed = true
			if version == "" {
				version = pkgVersion
			}
		}
	}
	enabled := configured && boolFromMap(section, "enabled")
	response := OpenClawDiscordStatusResponse{
		Status:     "ok",
		ChannelID:  openClawDiscordChannelID,
		Package:    openClawDiscordPackage,
		Installed:  installed,
		Configured: configured,
		Enabled:    enabled,
		Config:     openClawDiscordConfigFromSection(section),
		Accounts:   []OpenClawDiscordAccountSummary{},
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
		response.Accounts = readOpenClawDiscordAccounts(section, readOpenClawChannelAccountBindings(content, openClawDiscordChannelID))
	}
	return response
}

func validateOpenClawDiscordBotToken(ctx context.Context, botToken string) OpenClawDiscordCredentialValidateResponse {
	response := OpenClawDiscordCredentialValidateResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Valid:     false,
	}
	cleanToken := strings.TrimPrefix(strings.TrimSpace(botToken), "Bot ")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://discord.com/api/v10/users/@me", nil)
	if err != nil {
		response.Error = "Discord 校验请求创建失败"
		response.RawError = sanitizeOpenClawDiscordValidationText(err.Error(), botToken)
		return response
	}
	req.Header.Set("Authorization", "Bot "+cleanToken)
	req.Header.Set("User-Agent", "AgentBox/OpenClaw")
	client := &http.Client{Timeout: 10 * time.Second}
	httpResp, err := client.Do(req)
	if err != nil {
		response.Error = "无法连接 Discord Bot API"
		response.RawError = sanitizeOpenClawDiscordValidationText(err.Error(), botToken)
		return response
	}
	defer httpResp.Body.Close()
	response.HTTPStatus = httpResp.StatusCode
	rawBody, err := io.ReadAll(io.LimitReader(httpResp.Body, 1<<20))
	if err != nil {
		response.Error = "Discord 校验响应读取失败"
		response.RawError = sanitizeOpenClawDiscordValidationText(err.Error(), botToken)
		return response
	}
	response.RawResponse = sanitizeOpenClawDiscordValidationText(strings.TrimSpace(string(rawBody)), botToken)

	var payload struct {
		ID       string `json:"id"`
		Username string `json:"username"`
		Bot      bool   `json:"bot"`
		Code     int    `json:"code"`
		Message  string `json:"message"`
	}
	if err := json.Unmarshal(rawBody, &payload); err != nil {
		response.Error = "Discord 校验响应解析失败"
		response.RawError = sanitizeOpenClawDiscordValidationText(err.Error(), botToken)
		return response
	}
	response.DiscordErrorCode = payload.Code
	response.DiscordDescription = strings.TrimSpace(payload.Message)
	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
		if strings.TrimSpace(payload.Message) != "" {
			response.Error = payload.Message
		} else {
			response.Error = fmt.Sprintf("Discord API 返回 %d", httpResp.StatusCode)
		}
		return response
	}
	if !payload.Bot {
		response.Error = "Discord 返回的账号不是 Bot"
		return response
	}
	response.Valid = true
	response.BotID = strings.TrimSpace(payload.ID)
	response.Username = strings.TrimSpace(payload.Username)
	return response
}

func sanitizeOpenClawDiscordValidationText(value string, botToken string) string {
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

func openClawDiscordConfigFromSection(section map[string]any) OpenClawDiscordConfigResponse {
	return OpenClawDiscordConfigResponse{
		Enabled:         boolFromMap(section, "enabled"),
		DMPolicy:        firstNonEmptyDiscordString(stringFromMap(section, "dmPolicy"), "pairing"),
		GroupPolicy:     firstNonEmptyDiscordString(stringFromMap(section, "groupPolicy"), "allowlist"),
		AllowFromCount:  len(stringSliceFromValue(section["allowFrom"])),
		GroupCount:      len(objectMap(section["guilds"])),
		HistoryLimit:    stringFromMap(section, "historyLimit"),
		ReplyToMode:     stringFromMap(section, "replyToMode"),
		Streaming:       discordStreamingMode(section),
		ProxyConfigured: stringFromMap(section, "proxy") != "",
		ExecApprovals:   openClawDiscordExecApprovalsFromValue(section["execApprovals"]),
		Commands:        openClawDiscordCommandsFromValue(section["commands"]),
		StreamingConfig: openClawDiscordStreamingFromSection(section),
		Actions:         openClawDiscordActionsFromValue(section["actions"]),
	}
}

func readOpenClawDiscordAccounts(section map[string]any, bindings map[string]string) []OpenClawDiscordAccountSummary {
	accountsCfg := objectMap(section["accounts"])
	ids := make([]string, 0, len(accountsCfg)+1)
	if openClawDiscordTopLevelTokenConfigured(section) || len(accountsCfg) == 0 {
		ids = append(ids, "default")
	}
	for id := range accountsCfg {
		if strings.TrimSpace(id) != "" {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	seen := map[string]bool{}
	accounts := make([]OpenClawDiscordAccountSummary, 0, len(ids))
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		cfg := objectMap(accountsCfg[id])
		if id == "default" && !openClawDiscordAccountConfigured(cfg) {
			cfg = mergeOpenClawDiscordDefaultAccount(section, cfg)
		}
		if !openClawDiscordAccountConfigured(cfg) && id != "default" {
			continue
		}
		accounts = append(accounts, openClawDiscordAccountFromConfig(id, cfg, section, bindings[id]))
	}
	return accounts
}

func openClawDiscordAccountFromConfig(accountID string, cfg map[string]any, parent map[string]any, agentID string) OpenClawDiscordAccountSummary {
	tokenConfigured, tokenSource := openClawDiscordTokenSource(accountID, cfg, parent)
	groupCfg := objectMap(cfg["guilds"])
	if len(groupCfg) == 0 {
		groupCfg = objectMap(parent["guilds"])
	}
	firstGuild := firstOpenClawDiscordGuildConfig(groupCfg)
	allowFrom := firstNonEmptyStringSlice(stringSliceFromValue(cfg["allowFrom"]), stringSliceFromValue(parent["allowFrom"]))
	return OpenClawDiscordAccountSummary{
		AccountID:       accountID,
		ApplicationID:   firstNonEmptyDiscordString(stringFromMap(cfg, "applicationId"), stringFromMap(parent, "applicationId")),
		Name:            stringFromMap(cfg, "name"),
		Enabled:         !hasExplicitFalse(cfg, "enabled") && !hasExplicitFalse(parent, "enabled"),
		TokenConfigured: tokenConfigured,
		TokenSource:     tokenSource,
		DMPolicy:        firstNonEmptyDiscordString(stringFromMap(cfg, "dmPolicy"), stringFromMap(parent, "dmPolicy"), "pairing"),
		AllowFrom:       allowFrom,
		AllowFromCount:  len(allowFrom),
		GroupPolicy:     firstNonEmptyDiscordString(stringFromMap(cfg, "groupPolicy"), stringFromMap(parent, "groupPolicy"), "allowlist"),
		GroupCount:      len(groupCfg),
		GuildIDs:        openClawDiscordGuildIDs(groupCfg),
		RequireMention:  boolFromMap(firstGuild, "requireMention"),
		AgentID:         strings.TrimSpace(agentID),
		ExecApprovals:   openClawDiscordExecApprovalsFromValue(cfg["execApprovals"]),
		Actions:         openClawDiscordActionsFromValue(cfg["actions"]),
	}
}

func firstOpenClawDiscordGuildConfig(guilds map[string]any) map[string]any {
	if len(guilds) == 0 {
		return nil
	}
	keys := make([]string, 0, len(guilds))
	for key := range guilds {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return objectMap(guilds[keys[0]])
}

func openClawDiscordGuildIDs(guilds map[string]any) []string {
	if len(guilds) == 0 {
		return nil
	}
	ids := make([]string, 0, len(guilds))
	for id := range guilds {
		if strings.TrimSpace(id) != "" {
			ids = append(ids, strings.TrimSpace(id))
		}
	}
	sort.Strings(ids)
	return ids
}

func configureOpenClawDiscordAccount(accountID string, patch OpenClawDiscordAddConfig) error {
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
	section := objectMap(channels[openClawDiscordChannelID])
	section["enabled"] = true
	accounts := objectMap(section["accounts"])
	accountCfg := objectMap(accounts[accountID])
	accountCfg["enabled"] = true
	if name := strings.TrimSpace(patch.Name); name != "" {
		accountCfg["name"] = name
	}
	if applicationID := strings.TrimSpace(patch.ApplicationID); applicationID != "" {
		accountCfg["applicationId"] = applicationID
	}
	accountCfg["dmPolicy"] = patch.DMPolicy
	if patch.GroupPolicy != "" {
		accountCfg["groupPolicy"] = patch.GroupPolicy
	}
	allowFrom := splitOpenClawDiscordList(patch.AllowFrom)
	if patch.DMPolicy == "open" && len(allowFrom) == 0 {
		allowFrom = []string{"*"}
	}
	if len(allowFrom) > 0 {
		accountCfg["allowFrom"] = allowFrom
	} else {
		delete(accountCfg, "allowFrom")
	}
	if guildIDs := splitOpenClawDiscordList(patch.GuildIDs); len(guildIDs) > 0 {
		guilds := objectMap(accountCfg["guilds"])
		for _, guildID := range guildIDs {
			entry := objectMap(guilds[guildID])
			entry["requireMention"] = patch.RequireMention
			guilds[guildID] = entry
		}
		accountCfg["guilds"] = guilds
	}
	accounts[accountID] = accountCfg
	section["accounts"] = accounts
	channels[openClawDiscordChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return err
	}
	if strings.TrimSpace(patch.AgentID) != "" {
		return setOpenClawChannelAccountBinding(openClawDiscordChannelID, accountID, strings.TrimSpace(patch.AgentID))
	}
	return nil
}

func patchOpenClawDiscordAccount(accountID string, patch OpenClawDiscordAccountConfigRequest) error {
	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		return err
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawDiscordChannelID])
	accounts := objectMap(section["accounts"])
	accountCfg := objectMap(accounts[accountID])
	accountChanged := false
	if patch.Enabled != nil {
		if accountID == "default" && !openClawDiscordAccountConfigured(accountCfg) && openClawDiscordTopLevelTokenConfigured(section) {
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
			accountCfg["token"] = strings.TrimPrefix(botToken, "Bot ")
			delete(accountCfg, "tokenFile")
			accountChanged = true
		}
	}
	if patch.ApplicationID != nil {
		if applicationID := strings.TrimSpace(*patch.ApplicationID); applicationID != "" {
			accountCfg["applicationId"] = applicationID
		} else {
			delete(accountCfg, "applicationId")
		}
		accountChanged = true
	}
	if patch.DMPolicy != nil {
		dmPolicy := strings.TrimSpace(*patch.DMPolicy)
		if !allowedOpenClawDiscordDMPolicy(dmPolicy) {
			return huma.Error400BadRequest("unsupported discord dmPolicy", nil)
		}
		accountCfg["dmPolicy"] = dmPolicy
		accountChanged = true
	}
	if patch.GroupPolicy != nil {
		groupPolicy := strings.TrimSpace(*patch.GroupPolicy)
		if groupPolicy == "" {
			delete(accountCfg, "groupPolicy")
		} else {
			if !allowedOpenClawDiscordGroupPolicy(groupPolicy) {
				return huma.Error400BadRequest("unsupported discord groupPolicy", nil)
			}
			accountCfg["groupPolicy"] = groupPolicy
		}
		accountChanged = true
	}
	if patch.AllowFrom != nil {
		if len(patch.AllowFrom) > 0 {
			accountCfg["allowFrom"] = dedupeOpenClawDiscordStrings(patch.AllowFrom)
		} else {
			delete(accountCfg, "allowFrom")
		}
		accountChanged = true
	}
	if patch.ExecApprovals != nil {
		patchOpenClawDiscordExecApprovals(accountCfg, patch.ExecApprovals)
		accountChanged = true
	}
	if patch.Actions != nil {
		patchOpenClawDiscordActions(accountCfg, patch.Actions)
		accountChanged = true
	}
	if patch.GuildIDs != nil {
		guilds := objectMap(accountCfg["guilds"])
		nextGuilds := map[string]any{}
		for _, guildID := range dedupeOpenClawDiscordStrings(patch.GuildIDs) {
			nextGuilds[guildID] = objectMap(guilds[guildID])
		}
		if len(nextGuilds) > 0 {
			accountCfg["guilds"] = nextGuilds
		} else {
			delete(accountCfg, "guilds")
		}
		accountChanged = true
	}
	if patch.RequireMention != nil {
		guilds := objectMap(accountCfg["guilds"])
		if len(guilds) > 0 {
			for guildID, value := range guilds {
				entry := objectMap(value)
				entry["requireMention"] = *patch.RequireMention
				guilds[guildID] = entry
			}
			accountCfg["guilds"] = guilds
		} else {
			delete(accountCfg, "requireMention")
		}
		accountChanged = true
	}
	if accountChanged {
		accounts[accountID] = accountCfg
		section["accounts"] = accounts
	}
	channels[openClawDiscordChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return err
	}
	if patch.AgentID != nil {
		return setOpenClawChannelAccountBinding(openClawDiscordChannelID, accountID, strings.TrimSpace(*patch.AgentID))
	}
	return nil
}

func removeOpenClawDiscordAccount(accountID string) error {
	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawDiscordChannelID])
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
		delete(section, "token")
		delete(section, "botToken")
		delete(section, "tokenFile")
	}
	if !openClawDiscordConfigured(section) {
		delete(channels, openClawDiscordChannelID)
	} else {
		channels[openClawDiscordChannelID] = section
	}
	content["channels"] = channels
	return writeOpenClawConfigContent(configPath, content)
}

func openClawDiscordConfigured(section map[string]any) bool {
	if openClawDiscordTopLevelTokenConfigured(section) {
		return true
	}
	for _, value := range objectMap(section["accounts"]) {
		if openClawDiscordAccountConfigured(objectMap(value)) {
			return true
		}
	}
	return false
}

func openClawDiscordTopLevelTokenConfigured(section map[string]any) bool {
	return stringFromMap(section, "token") != "" || stringFromMap(section, "botToken") != "" || strings.TrimSpace(os.Getenv("DISCORD_BOT_TOKEN")) != ""
}

func openClawDiscordAccountConfigured(cfg map[string]any) bool {
	return stringFromMap(cfg, "token") != "" || stringFromMap(cfg, "botToken") != ""
}

func mergeOpenClawDiscordDefaultAccount(parent map[string]any, cfg map[string]any) map[string]any {
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

func openClawDiscordTokenSource(accountID string, cfg map[string]any, parent map[string]any) (bool, string) {
	if stringFromMap(cfg, "token") != "" {
		return true, "config"
	}
	if stringFromMap(cfg, "botToken") != "" {
		return true, "config"
	}
	if accountID == "default" {
		if stringFromMap(parent, "token") != "" {
			return true, "config"
		}
		if stringFromMap(parent, "botToken") != "" {
			return true, "config"
		}
		if strings.TrimSpace(os.Getenv("DISCORD_BOT_TOKEN")) != "" {
			return true, "env"
		}
	}
	return false, "missing"
}

func openClawDiscordPackagePaths(home string) []string {
	paths := []string{
		filepath.Join(home, "extensions", openClawDiscordChannelID, "package.json"),
		filepath.Join(home, "node_modules", "@openclaw", "discord", "package.json"),
		filepath.Join(home, "npm", "node_modules", "@openclaw", "discord", "package.json"),
	}
	if installPath := openClawPluginInstallRecordPath(home, openClawDiscordChannelID); installPath != "" {
		paths = append(paths, filepath.Join(installPath, "package.json"))
	}
	return paths
}

func openClawDiscordExecApprovalsFromValue(value any) OpenClawDiscordExecApprovalsConfig {
	cfg := objectMap(value)
	return OpenClawDiscordExecApprovalsConfig{
		Enabled:       stringFromBoolLike(cfg["enabled"]),
		Approvers:     stringSliceFromValue(cfg["approvers"]),
		Target:        stringFromMap(cfg, "target"),
		AgentFilter:   stringSliceFromValue(cfg["agentFilter"]),
		SessionFilter: stringSliceFromValue(cfg["sessionFilter"]),
	}
}

func openClawDiscordCommandsFromValue(value any) OpenClawDiscordCommandsConfig {
	cfg := objectMap(value)
	return OpenClawDiscordCommandsConfig{
		Native:       stringFromBoolLike(cfg["native"]),
		NativeSkills: stringFromBoolLike(cfg["nativeSkills"]),
	}
}

func discordStreamingMode(section map[string]any) string {
	if mode := stringFromMap(section, "streaming"); mode != "" {
		return mode
	}
	streaming := objectMap(section["streaming"])
	return stringFromMap(streaming, "mode")
}

func openClawDiscordStreamingFromSection(section map[string]any) OpenClawDiscordStreamingConfig {
	streaming := objectMap(section["streaming"])
	preview := objectMap(streaming["preview"])
	progress := objectMap(streaming["progress"])
	return OpenClawDiscordStreamingConfig{
		Mode:                 firstNonEmptyDiscordString(stringFromMap(streaming, "mode"), stringFromMap(section, "streaming"), "partial"),
		PreviewToolProgress:  !hasExplicitFalse(preview, "toolProgress"),
		PreviewCommandText:   firstNonEmptyDiscordString(stringFromMap(preview, "commandText"), "raw"),
		ProgressToolProgress: !hasExplicitFalse(progress, "toolProgress"),
		ProgressCommandText:  firstNonEmptyDiscordString(stringFromMap(progress, "commandText"), "raw"),
		BlockStreaming:       boolFromMap(section, "blockStreaming"),
	}
}

func openClawDiscordActionsFromValue(value any) OpenClawDiscordActionsConfig {
	cfg := objectMap(value)
	return OpenClawDiscordActionsConfig{
		Messages:    boolPointerFromMap(cfg, "messages"),
		Reactions:   boolPointerFromMap(cfg, "reactions"),
		Stickers:    boolPointerFromMap(cfg, "stickers"),
		Polls:       boolPointerFromMap(cfg, "polls"),
		Threads:     boolPointerFromMap(cfg, "threads"),
		Pins:        boolPointerFromMap(cfg, "pins"),
		Moderation:  boolPointerFromMap(cfg, "moderation"),
		Permissions: boolPointerFromMap(cfg, "permissions"),
	}
}

func patchOpenClawDiscordExecApprovals(target map[string]any, patch *OpenClawDiscordExecApprovalsConfigRequest) {
	cfg := objectMap(target["execApprovals"])
	if patch.Enabled != nil {
		setOpenClawDiscordChoiceField(cfg, "enabled", *patch.Enabled)
	}
	if patch.Approvers != nil {
		setOpenClawDiscordStringSliceField(cfg, "approvers", patch.Approvers)
	}
	if patch.Target != nil {
		setOpenClawDiscordStringField(cfg, "target", *patch.Target)
	}
	if patch.AgentFilter != nil {
		setOpenClawDiscordStringSliceField(cfg, "agentFilter", patch.AgentFilter)
	}
	if patch.SessionFilter != nil {
		setOpenClawDiscordStringSliceField(cfg, "sessionFilter", patch.SessionFilter)
	}
	setOpenClawDiscordObjectField(target, "execApprovals", cfg)
}

func patchOpenClawDiscordCommands(target map[string]any, patch *OpenClawDiscordCommandsConfigRequest) {
	cfg := objectMap(target["commands"])
	if patch.Native != nil {
		setOpenClawDiscordChoiceField(cfg, "native", *patch.Native)
	}
	if patch.NativeSkills != nil {
		setOpenClawDiscordChoiceField(cfg, "nativeSkills", *patch.NativeSkills)
	}
	setOpenClawDiscordObjectField(target, "commands", cfg)
}

func patchOpenClawDiscordStreaming(target map[string]any, patch *OpenClawDiscordStreamingConfigRequest) {
	cfg := objectMap(target["streaming"])
	if patch.Mode != nil {
		setOpenClawDiscordStringField(cfg, "mode", *patch.Mode)
	}
	if patch.PreviewToolProgress != nil || patch.PreviewCommandText != nil {
		preview := objectMap(cfg["preview"])
		if patch.PreviewToolProgress != nil {
			preview["toolProgress"] = *patch.PreviewToolProgress
		}
		if patch.PreviewCommandText != nil {
			setOpenClawDiscordStringField(preview, "commandText", *patch.PreviewCommandText)
		}
		setOpenClawDiscordObjectField(cfg, "preview", preview)
	}
	if patch.ProgressToolProgress != nil || patch.ProgressCommandText != nil {
		progress := objectMap(cfg["progress"])
		if patch.ProgressToolProgress != nil {
			progress["toolProgress"] = *patch.ProgressToolProgress
		}
		if patch.ProgressCommandText != nil {
			setOpenClawDiscordStringField(progress, "commandText", *patch.ProgressCommandText)
		}
		setOpenClawDiscordObjectField(cfg, "progress", progress)
	}
	setOpenClawDiscordObjectField(target, "streaming", cfg)
}

func patchOpenClawDiscordActions(target map[string]any, patch *OpenClawDiscordActionsConfigRequest) {
	cfg := objectMap(target["actions"])
	setOpenClawDiscordBoolPointerField(cfg, "messages", patch.Messages)
	setOpenClawDiscordBoolPointerField(cfg, "reactions", patch.Reactions)
	setOpenClawDiscordBoolPointerField(cfg, "stickers", patch.Stickers)
	setOpenClawDiscordBoolPointerField(cfg, "polls", patch.Polls)
	setOpenClawDiscordBoolPointerField(cfg, "threads", patch.Threads)
	setOpenClawDiscordBoolPointerField(cfg, "pins", patch.Pins)
	setOpenClawDiscordBoolPointerField(cfg, "moderation", patch.Moderation)
	setOpenClawDiscordBoolPointerField(cfg, "permissions", patch.Permissions)
	setOpenClawDiscordObjectField(target, "actions", cfg)
}

func setOpenClawDiscordStringField(target map[string]any, key string, value string) {
	if strings.TrimSpace(value) == "" {
		delete(target, key)
		return
	}
	target[key] = strings.TrimSpace(value)
}

func setOpenClawDiscordChoiceField(target map[string]any, key string, value string) {
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

func setOpenClawDiscordBoolPointerField(target map[string]any, key string, value *bool) {
	if value == nil {
		return
	}
	target[key] = *value
}

func setOpenClawDiscordStringSliceField(target map[string]any, key string, values []string) {
	clean := dedupeOpenClawDiscordStrings(values)
	if len(clean) == 0 {
		delete(target, key)
		return
	}
	target[key] = clean
}

func setOpenClawDiscordObjectField(target map[string]any, key string, value map[string]any) {
	if len(value) == 0 {
		delete(target, key)
		return
	}
	target[key] = value
}

func splitOpenClawDiscordList(value string) []string {
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

func allowedOpenClawDiscordDMPolicy(value string) bool {
	switch value {
	case "pairing", "allowlist", "open", "disabled":
		return true
	default:
		return false
	}
}

func allowedOpenClawDiscordGroupPolicy(value string) bool {
	switch value {
	case "open", "allowlist", "disabled":
		return true
	default:
		return false
	}
}

func dedupeOpenClawDiscordStrings(values []string) []string {
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

func firstNonEmptyDiscordString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
