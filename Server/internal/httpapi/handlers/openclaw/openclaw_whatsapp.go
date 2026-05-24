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
	openClawWhatsAppChannelID = "whatsapp"
	openClawWhatsAppPackage   = "@openclaw/whatsapp"
)

type OpenClawWhatsAppStatusOutput struct {
	Body OpenClawWhatsAppStatusResponse
}

type OpenClawWhatsAppConfigInput struct {
	Body OpenClawWhatsAppConfigRequest
}

type OpenClawWhatsAppConfigOutput struct {
	Body OpenClawWhatsAppStatusResponse
}

type OpenClawWhatsAppAccountConfigInput struct {
	AccountID string `path:"accountId" doc:"WhatsApp account id." example:"default"`
	Body      OpenClawWhatsAppAccountConfigRequest
}

type OpenClawWhatsAppAccountConfigOutput struct {
	Body OpenClawWhatsAppStatusResponse
}

type OpenClawWhatsAppAccountDeleteInput struct {
	AccountID string `path:"accountId" doc:"WhatsApp account id." example:"default"`
}

type OpenClawWhatsAppAccountDeleteOutput struct {
	Body OpenClawWhatsAppAccountDeleteResponse
}

type OpenClawWhatsAppAccountAddStreamInput struct {
	AccountID      string `query:"accountId" doc:"WhatsApp account id. Empty uses default." example:"default"`
	Name           string `query:"name" doc:"Optional account display name."`
	AgentID        string `query:"agentId" doc:"Agent id routed to this account."`
	AuthDir        string `query:"authDir" doc:"Optional WhatsApp Web auth directory."`
	DMPolicy       string `query:"dmPolicy" enum:"pairing,allowlist,open,disabled" example:"pairing" doc:"Direct message access policy."`
	AllowFrom      string `query:"allowFrom" doc:"Comma or newline separated E.164 numbers."`
	GroupPolicy    string `query:"groupPolicy" enum:"open,allowlist,disabled" example:"allowlist" doc:"Group sender policy."`
	GroupAllowFrom string `query:"groupAllowFrom" doc:"Comma or newline separated E.164 numbers allowed in groups."`
	SelfChatMode   bool   `query:"selfChatMode" doc:"Enable self-chat friendly mode."`
}

type OpenClawWhatsAppAccountLoginStreamInput struct {
	AccountID string `query:"accountId" doc:"WhatsApp account id. Empty uses default." example:"default"`
}

type OpenClawWhatsAppStatusResponse struct {
	Status       string                           `json:"status" example:"ok" doc:"Operation status."`
	ChannelID    string                           `json:"channelId" example:"whatsapp" doc:"OpenClaw channel id."`
	Package      string                           `json:"package" example:"@openclaw/whatsapp" doc:"OpenClaw WhatsApp package name."`
	Installed    bool                             `json:"installed" example:"true" doc:"Whether WhatsApp appears installed from local install records or config."`
	Configured   bool                             `json:"configured" example:"true" doc:"Whether channels.whatsapp exists or auth is present."`
	Linked       bool                             `json:"linked" example:"true" doc:"Whether any WhatsApp account has a creds.json auth state."`
	Enabled      bool                             `json:"enabled" example:"true" doc:"Whether channels.whatsapp.enabled is not false."`
	Config       OpenClawWhatsAppConfigResponse   `json:"config" doc:"WhatsApp channel config summary."`
	Accounts     []OpenClawWhatsAppAccountSummary `json:"accounts" doc:"Configured or linked WhatsApp accounts."`
	ConfigPath   string                           `json:"configPath,omitempty" doc:"OpenClaw config path."`
	OpenClawHome string                           `json:"openClawHome,omitempty" doc:"OpenClaw home directory."`
	Version      string                           `json:"version,omitempty" doc:"Installed package version when readable."`
	Error        string                           `json:"error,omitempty" doc:"Config read error."`
}

type OpenClawWhatsAppConfigResponse struct {
	Enabled          bool                          `json:"enabled" doc:"Whether channels.whatsapp.enabled is not false."`
	DMPolicy         string                        `json:"dmPolicy" example:"pairing" doc:"Direct message policy."`
	AllowFromCount   int                           `json:"allowFromCount" doc:"Top-level allowFrom entry count."`
	GroupPolicy      string                        `json:"groupPolicy,omitempty" example:"allowlist" doc:"Group sender policy."`
	GroupAllowCount  int                           `json:"groupAllowFromCount" doc:"Top-level groupAllowFrom entry count."`
	GroupCount       int                           `json:"groupCount" doc:"Configured group allowlist count."`
	HistoryLimit     string                        `json:"historyLimit,omitempty" doc:"Configured history limit."`
	TextChunkLimit   string                        `json:"textChunkLimit,omitempty" doc:"Configured text chunk limit."`
	ChunkMode        string                        `json:"chunkMode,omitempty" doc:"Chunk mode: length or newline."`
	MediaMaxMb       string                        `json:"mediaMaxMb,omitempty" doc:"Media size limit in MB."`
	ReplyToMode      string                        `json:"replyToMode,omitempty" doc:"Reply quoting mode."`
	ReactionLevel    string                        `json:"reactionLevel,omitempty" doc:"Reaction level."`
	SendReadReceipts bool                          `json:"sendReadReceipts" doc:"Whether accepted inbound messages send read receipts."`
	SelfChatMode     bool                          `json:"selfChatMode" doc:"Whether self-chat friendly mode is enabled."`
	ConfigWrites     bool                          `json:"configWrites" doc:"Whether channel-initiated config writes are enabled."`
	Actions          OpenClawWhatsAppActionsConfig `json:"actions" doc:"WhatsApp action gate settings."`
}

type OpenClawWhatsAppAccountSummary struct {
	AccountID           string   `json:"accountId" example:"default" doc:"WhatsApp account id."`
	Name                string   `json:"name,omitempty" doc:"Account display name."`
	Enabled             bool     `json:"enabled" doc:"Whether this account is enabled."`
	Linked              bool     `json:"linked" doc:"Whether this account has creds.json auth state."`
	AuthDir             string   `json:"authDir" doc:"Resolved auth directory."`
	AuthDirConfigured   bool     `json:"authDirConfigured" doc:"Whether authDir is explicitly configured."`
	LegacyAuthDir       bool     `json:"legacyAuthDir" doc:"Whether legacy OAuth directory is being used."`
	SelfID              string   `json:"selfId,omitempty" doc:"Linked WhatsApp self id when readable."`
	SelfPhone           string   `json:"selfPhone,omitempty" doc:"Linked phone number when readable."`
	CredsUpdatedAt      string   `json:"credsUpdatedAt,omitempty" doc:"creds.json modification time."`
	DMPolicy            string   `json:"dmPolicy,omitempty" doc:"Effective DM policy."`
	AllowFrom           []string `json:"allowFrom,omitempty" doc:"Effective allowFrom entries."`
	AllowFromCount      int      `json:"allowFromCount" doc:"Account allowFrom entry count."`
	GroupPolicy         string   `json:"groupPolicy,omitempty" doc:"Effective group sender policy."`
	GroupAllowFrom      []string `json:"groupAllowFrom,omitempty" doc:"Effective groupAllowFrom entries."`
	GroupAllowFromCount int      `json:"groupAllowFromCount" doc:"Account groupAllowFrom entry count."`
	GroupCount          int      `json:"groupCount" doc:"Configured group allowlist count."`
	SelfChatMode        bool     `json:"selfChatMode" doc:"Whether self-chat mode is enabled."`
	SendReadReceipts    bool     `json:"sendReadReceipts" doc:"Whether read receipts are enabled."`
	AgentID             string   `json:"agentId,omitempty" doc:"Agent routed to this account."`
}

type OpenClawWhatsAppConfigRequest struct {
	Actions          *OpenClawWhatsAppActionsConfigRequest `json:"actions,omitempty" doc:"WhatsApp action gate settings."`
	AllowFrom        []string                              `json:"allowFrom,omitempty" doc:"Channel default DM allowlist. Empty array clears it."`
	ConfigWrites     *bool                                 `json:"configWrites,omitempty" doc:"Enable channel initiated config writes."`
	DMPolicy         *string                               `json:"dmPolicy,omitempty" enum:"pairing,allowlist,open,disabled" doc:"Default DM access policy."`
	Enabled          *bool                                 `json:"enabled,omitempty" doc:"WhatsApp channel enabled switch."`
	GroupAllowFrom   []string                              `json:"groupAllowFrom,omitempty" doc:"Channel group sender allowlist. Empty array clears it."`
	GroupPolicy      *string                               `json:"groupPolicy,omitempty" enum:"open,allowlist,disabled" doc:"Default group sender policy."`
	HistoryLimit     *string                               `json:"historyLimit,omitempty" doc:"History injection limit. Empty clears it."`
	MediaMaxMb       *string                               `json:"mediaMaxMb,omitempty" doc:"Media size cap in MB. Empty clears it."`
	ReactionLevel    *string                               `json:"reactionLevel,omitempty" enum:"off,ack,minimal,extensive" doc:"Reaction behavior level."`
	ReplyToMode      *string                               `json:"replyToMode,omitempty" enum:"off,first,all,batched" doc:"Reply quote behavior."`
	SelfChatMode     *bool                                 `json:"selfChatMode,omitempty" doc:"Enable self-chat friendly mode."`
	SendReadReceipts *bool                                 `json:"sendReadReceipts,omitempty" doc:"Send read receipts for accepted inbound messages."`
	TextChunkLimit   *string                               `json:"textChunkLimit,omitempty" doc:"Text chunk limit. Empty clears it."`
	ChunkMode        *string                               `json:"chunkMode,omitempty" enum:"length,newline" doc:"Text chunking mode."`
}

type OpenClawWhatsAppAccountConfigRequest struct {
	AllowFrom        []string `json:"allowFrom,omitempty" doc:"Account allowFrom entries. Empty array clears account override."`
	AgentID          *string  `json:"agentId,omitempty" doc:"Agent id routed to this account. Empty string removes binding."`
	AuthDir          *string  `json:"authDir,omitempty" doc:"Custom auth directory. Empty string clears it."`
	DMPolicy         *string  `json:"dmPolicy,omitempty" enum:"pairing,allowlist,open,disabled" doc:"Account DM policy."`
	Enabled          *bool    `json:"enabled,omitempty" doc:"Account enabled switch."`
	GroupAllowFrom   []string `json:"groupAllowFrom,omitempty" doc:"Account group sender allowlist. Empty array clears account override."`
	GroupPolicy      *string  `json:"groupPolicy,omitempty" enum:"open,allowlist,disabled" doc:"Account group sender policy. Empty clears override."`
	Name             *string  `json:"name,omitempty" doc:"Account display name. Empty string clears it."`
	SelfChatMode     *bool    `json:"selfChatMode,omitempty" doc:"Enable self-chat friendly mode."`
	SendReadReceipts *bool    `json:"sendReadReceipts,omitempty" doc:"Send read receipts for this account."`
}

type OpenClawWhatsAppActionsConfig struct {
	Reactions *bool `json:"reactions,omitempty" doc:"Whether WhatsApp reaction action is enabled."`
	Polls     *bool `json:"polls,omitempty" doc:"Whether WhatsApp poll action is enabled."`
}

type OpenClawWhatsAppActionsConfigRequest struct {
	Reactions *bool `json:"reactions,omitempty" doc:"Whether WhatsApp reaction action is enabled."`
	Polls     *bool `json:"polls,omitempty" doc:"Whether WhatsApp poll action is enabled."`
}

type OpenClawWhatsAppAccountDeleteResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-14T09:00:00Z" doc:"UTC response timestamp."`
	AccountID string `json:"accountId" doc:"Deleted WhatsApp account id."`
}

func GetOpenClawWhatsAppStatus(ctx context.Context, input *struct{}) (*OpenClawWhatsAppStatusOutput, error) {
	_ = ctx
	return &OpenClawWhatsAppStatusOutput{Body: detectOpenClawWhatsAppStatus()}, nil
}

func UpdateOpenClawWhatsAppConfig(ctx context.Context, input *OpenClawWhatsAppConfigInput) (*OpenClawWhatsAppConfigOutput, error) {
	_ = ctx
	if input == nil {
		return nil, huma.Error400BadRequest("whatsapp config request is required", nil)
	}
	if err := patchOpenClawWhatsAppConfig(input.Body); err != nil {
		return nil, err
	}
	invalidateOpenClawPluginsStatusCache()
	invalidateOpenClawEnvironmentCache()
	return &OpenClawWhatsAppConfigOutput{Body: detectOpenClawWhatsAppStatus()}, nil
}

func UpdateOpenClawWhatsAppAccountConfig(ctx context.Context, input *OpenClawWhatsAppAccountConfigInput) (*OpenClawWhatsAppAccountConfigOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("account id is required", nil)
	}
	if err := patchOpenClawWhatsAppAccount(strings.TrimSpace(input.AccountID), input.Body); err != nil {
		return nil, err
	}
	return &OpenClawWhatsAppAccountConfigOutput{Body: detectOpenClawWhatsAppStatus()}, nil
}

func DeleteOpenClawWhatsAppAccount(ctx context.Context, input *OpenClawWhatsAppAccountDeleteInput) (*OpenClawWhatsAppAccountDeleteOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("account id is required", nil)
	}
	accountID := strings.TrimSpace(input.AccountID)
	if err := removeOpenClawWhatsAppAccount(accountID); err != nil {
		return nil, huma.Error500InternalServerError("delete whatsapp account failed", err)
	}
	if err := setOpenClawChannelAccountBinding(openClawWhatsAppChannelID, accountID, ""); err != nil {
		return nil, huma.Error500InternalServerError("update whatsapp account binding failed", err)
	}
	return &OpenClawWhatsAppAccountDeleteOutput{Body: OpenClawWhatsAppAccountDeleteResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AccountID: accountID,
	}}, nil
}

func AddOpenClawWhatsAppAccountStream(ctx context.Context, input *OpenClawWhatsAppAccountAddStreamInput, send sse.Sender) {
	if input == nil {
		streamOpenClawChannelError(send, "whatsapp-add", "add", fmt.Errorf("whatsapp account request is required"))
		return
	}
	accountID := strings.TrimSpace(input.AccountID)
	if accountID == "" {
		accountID = "default"
	}
	dmPolicy := firstNonEmptyTelegramString(strings.TrimSpace(input.DMPolicy), "pairing")
	groupPolicy := strings.TrimSpace(input.GroupPolicy)
	if !allowedOpenClawTelegramDMPolicy(dmPolicy) {
		streamOpenClawChannelError(send, "whatsapp-add", "add", fmt.Errorf("unsupported dmPolicy %q", dmPolicy))
		return
	}
	if groupPolicy != "" && !allowedOpenClawTelegramGroupPolicy(groupPolicy) {
		streamOpenClawChannelError(send, "whatsapp-add", "add", fmt.Errorf("unsupported groupPolicy %q", groupPolicy))
		return
	}
	if dmPolicy == "allowlist" && len(splitOpenClawTelegramList(input.AllowFrom)) == 0 {
		streamOpenClawChannelError(send, "whatsapp-add", "add", fmt.Errorf("allowlist 策略需要至少一个 WhatsApp 号码"))
		return
	}

	addArgs := []string{"channels", "add", "--channel", openClawWhatsAppChannelID, "--account", accountID}
	if authDir := strings.TrimSpace(input.AuthDir); authDir != "" {
		addArgs = append(addArgs, "--auth-dir", authDir)
	}
	loginArgs := []string{"channels", "login", "--channel", openClawWhatsAppChannelID, "--account", accountID}
	streamOpenClawChannelSteps(ctx, send, "whatsapp-add", "add", []openClawChannelStep{
		{label: "检查 OpenClaw CLI", progress: 5, timeout: 10 * time.Second, args: []string{"--version"}},
		{label: "确保 WhatsApp 插件已安装", progress: 14, run: ensureOpenClawWhatsAppInstalled},
		{label: "添加 WhatsApp 账号配置", progress: 28, timeout: 5 * time.Minute, args: addArgs},
		{label: "写入 WhatsApp 访问策略", progress: 48, run: func(ctx context.Context, task openClawChannelLogger) error {
			_ = ctx
			if err := configureOpenClawWhatsAppAccount(accountID, OpenClawWhatsAppAddConfig{
				AgentID:        input.AgentID,
				AllowFrom:      input.AllowFrom,
				AuthDir:        input.AuthDir,
				DMPolicy:       dmPolicy,
				GroupAllowFrom: input.GroupAllowFrom,
				GroupPolicy:    groupPolicy,
				Name:           input.Name,
				SelfChatMode:   input.SelfChatMode,
			}); err != nil {
				return err
			}
			task.addLog("已写入 WhatsApp 账号配置。")
			return nil
		}},
		{label: "扫码登录 WhatsApp", progress: 58, timeout: 10 * time.Minute, args: loginArgs},
		{label: "重启 Gateway 应用 WhatsApp 配置", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
}

func LoginOpenClawWhatsAppAccountStream(ctx context.Context, input *OpenClawWhatsAppAccountLoginStreamInput, send sse.Sender) {
	accountID := "default"
	if input != nil && strings.TrimSpace(input.AccountID) != "" {
		accountID = strings.TrimSpace(input.AccountID)
	}
	streamOpenClawChannelSteps(ctx, send, "whatsapp-login", "login", []openClawChannelStep{
		{label: "检查 OpenClaw CLI", progress: 5, timeout: 10 * time.Second, args: []string{"--version"}},
		{label: "确保 WhatsApp 插件已安装", progress: 16, run: ensureOpenClawWhatsAppInstalled},
		{label: "扫码登录 WhatsApp", progress: 35, timeout: 10 * time.Minute, args: []string{"channels", "login", "--channel", openClawWhatsAppChannelID, "--account", accountID}},
		{label: "重启 Gateway 应用 WhatsApp 登录状态", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
}

func LogoutOpenClawWhatsAppAccountStream(ctx context.Context, input *OpenClawWhatsAppAccountLoginStreamInput, send sse.Sender) {
	accountID := "default"
	if input != nil && strings.TrimSpace(input.AccountID) != "" {
		accountID = strings.TrimSpace(input.AccountID)
	}
	streamOpenClawChannelSteps(ctx, send, "whatsapp-logout", "logout", []openClawChannelStep{
		{label: "登出 WhatsApp 账号", progress: 35, timeout: 2 * time.Minute, args: []string{"channels", "logout", "--channel", openClawWhatsAppChannelID, "--account", accountID}, ignoreMissing: true},
		{label: "重启 Gateway 应用 WhatsApp 登出状态", progress: 82, timeout: 60 * time.Second, args: []string{"gateway", "restart"}, ignoreMissing: true},
	})
}

func UninstallOpenClawWhatsAppStream(ctx context.Context, input *struct{}, send sse.Sender) {
	streamOpenClawChannelSteps(ctx, send, "whatsapp-uninstall", "uninstall", []openClawChannelStep{
		{label: "禁用并删除 WhatsApp 渠道配置", progress: 30, timeout: 2 * time.Minute, args: []string{"channels", "remove", "--channel", openClawWhatsAppChannelID, "--delete"}, ignoreMissing: true},
		{label: "卸载 WhatsApp 插件", progress: 72, timeout: 5 * time.Minute, args: []string{"plugins", "uninstall", openClawWhatsAppChannelID}, ignoreMissing: true},
		{label: "清理 WhatsApp 配置残留", progress: 90, run: cleanupOpenClawWhatsAppConfig},
		{label: "刷新插件注册表", progress: 96, timeout: 2 * time.Minute, args: []string{"plugins", "registry", "--refresh"}, ignoreMissing: true},
	})
}

type OpenClawWhatsAppAddConfig struct {
	AgentID        string
	AllowFrom      string
	AuthDir        string
	DMPolicy       string
	GroupAllowFrom string
	GroupPolicy    string
	Name           string
	SelfChatMode   bool
}

func detectOpenClawWhatsAppStatus() OpenClawWhatsAppStatusResponse {
	home := defaultOpenClawHomeDir()
	configPath := openClawConfigPath()
	content, exists, configErr := readOpenClawConfigFile(configPath)
	section := objectMap(objectMap(content["channels"])[openClawWhatsAppChannelID])
	configured := len(section) > 0
	version := ""
	installed := configured
	for _, pkgPath := range openClawWhatsAppPackagePaths(home) {
		pkgVersion, ok := readPackageVersion(pkgPath)
		if ok {
			installed = true
			if version == "" {
				version = pkgVersion
			}
		}
	}
	accounts := readOpenClawWhatsAppAccounts(section, readOpenClawChannelAccountBindings(content, openClawWhatsAppChannelID))
	linked := false
	for _, account := range accounts {
		if account.Linked {
			linked = true
			break
		}
	}
	response := OpenClawWhatsAppStatusResponse{
		Status:     "ok",
		ChannelID:  openClawWhatsAppChannelID,
		Package:    openClawWhatsAppPackage,
		Installed:  installed,
		Configured: configured || linked,
		Linked:     linked,
		Enabled:    installed && !hasExplicitFalse(section, "enabled"),
		Config:     openClawWhatsAppConfigFromSection(section),
		Accounts:   accounts,
		Version:    version,
	}
	if exists || configured || installed || linked {
		response.ConfigPath = configPath
		response.OpenClawHome = home
	}
	if configErr != nil && !errors.Is(configErr, os.ErrNotExist) {
		response.Status = "error"
		response.Error = configErr.Error()
	}
	return response
}

func openClawWhatsAppConfigFromSection(section map[string]any) OpenClawWhatsAppConfigResponse {
	return OpenClawWhatsAppConfigResponse{
		Enabled:          !hasExplicitFalse(section, "enabled"),
		DMPolicy:         firstNonEmptyTelegramString(stringFromMap(section, "dmPolicy"), "pairing"),
		AllowFromCount:   len(stringSliceFromValue(section["allowFrom"])),
		GroupPolicy:      stringFromMap(section, "groupPolicy"),
		GroupAllowCount:  len(stringSliceFromValue(section["groupAllowFrom"])),
		GroupCount:       len(objectMap(section["groups"])),
		HistoryLimit:     whatsappStringFromAny(section["historyLimit"]),
		TextChunkLimit:   whatsappStringFromAny(section["textChunkLimit"]),
		ChunkMode:        stringFromMap(section, "chunkMode"),
		MediaMaxMb:       whatsappStringFromAny(section["mediaMaxMb"]),
		ReplyToMode:      stringFromMap(section, "replyToMode"),
		ReactionLevel:    firstNonEmptyTelegramString(stringFromMap(section, "reactionLevel"), "minimal"),
		SendReadReceipts: !hasExplicitFalse(section, "sendReadReceipts"),
		SelfChatMode:     boolFromMap(section, "selfChatMode"),
		ConfigWrites:     !hasExplicitFalse(section, "configWrites"),
		Actions:          openClawWhatsAppActionsFromValue(section["actions"]),
	}
}

func readOpenClawWhatsAppAccounts(section map[string]any, bindings map[string]string) []OpenClawWhatsAppAccountSummary {
	ids := map[string]bool{}
	for id := range objectMap(section["accounts"]) {
		if strings.TrimSpace(id) != "" {
			ids[id] = true
		}
	}
	for _, id := range discoverOpenClawWhatsAppAuthAccountIDs(defaultOpenClawHomeDir()) {
		ids[id] = true
	}
	ordered := make([]string, 0, len(ids))
	for id := range ids {
		ordered = append(ordered, id)
	}
	sort.Strings(ordered)
	accountsCfg := objectMap(section["accounts"])
	accounts := make([]OpenClawWhatsAppAccountSummary, 0, len(ordered))
	for _, id := range ordered {
		cfg := objectMap(accountsCfg[id])
		account := openClawWhatsAppAccountFromConfig(id, cfg, section, bindings[id])
		if !account.Linked && !openClawWhatsAppAccountConfigHasSignal(cfg) {
			continue
		}
		accounts = append(accounts, account)
	}
	return accounts
}

func openClawWhatsAppAccountFromConfig(accountID string, cfg map[string]any, parent map[string]any, agentID string) OpenClawWhatsAppAccountSummary {
	authDir, legacy := openClawWhatsAppAuthDir(accountID, cfg)
	linked, updatedAt, selfID, selfPhone := openClawWhatsAppAuthState(authDir)
	allowFrom := firstNonEmptyStringSlice(stringSliceFromValue(cfg["allowFrom"]), stringSliceFromValue(parent["allowFrom"]))
	groupAllowFrom := firstNonEmptyStringSlice(stringSliceFromValue(cfg["groupAllowFrom"]), stringSliceFromValue(parent["groupAllowFrom"]))
	return OpenClawWhatsAppAccountSummary{
		AccountID:           accountID,
		Name:                stringFromMap(cfg, "name"),
		Enabled:             !hasExplicitFalse(cfg, "enabled") && !hasExplicitFalse(parent, "enabled"),
		Linked:              linked,
		AuthDir:             authDir,
		AuthDirConfigured:   strings.TrimSpace(stringFromMap(cfg, "authDir")) != "",
		LegacyAuthDir:       legacy,
		SelfID:              selfID,
		SelfPhone:           selfPhone,
		CredsUpdatedAt:      updatedAt,
		DMPolicy:            firstNonEmptyTelegramString(stringFromMap(cfg, "dmPolicy"), stringFromMap(parent, "dmPolicy"), "pairing"),
		AllowFrom:           allowFrom,
		AllowFromCount:      len(allowFrom),
		GroupPolicy:         firstNonEmptyTelegramString(stringFromMap(cfg, "groupPolicy"), stringFromMap(parent, "groupPolicy")),
		GroupAllowFrom:      groupAllowFrom,
		GroupAllowFromCount: len(groupAllowFrom),
		GroupCount:          len(firstNonEmptyObjectMap(objectMap(cfg["groups"]), objectMap(parent["groups"]))),
		SelfChatMode:        boolDefaultFromMaps("selfChatMode", cfg, parent),
		SendReadReceipts:    !hasExplicitFalse(firstNonEmptyObjectMap(cfg, parent), "sendReadReceipts"),
		AgentID:             strings.TrimSpace(agentID),
	}
}

func configureOpenClawWhatsAppAccount(accountID string, patch OpenClawWhatsAppAddConfig) error {
	return patchOpenClawWhatsAppAccount(accountID, OpenClawWhatsAppAccountConfigRequest{
		AgentID:        whatsappStringPtr(strings.TrimSpace(patch.AgentID)),
		AllowFrom:      splitOpenClawTelegramList(patch.AllowFrom),
		AuthDir:        whatsappStringPtr(strings.TrimSpace(patch.AuthDir)),
		DMPolicy:       whatsappStringPtr(patch.DMPolicy),
		Enabled:        whatsappBoolPtr(true),
		GroupAllowFrom: splitOpenClawTelegramList(patch.GroupAllowFrom),
		GroupPolicy:    whatsappStringPtr(patch.GroupPolicy),
		Name:           whatsappStringPtr(strings.TrimSpace(patch.Name)),
		SelfChatMode:   whatsappBoolPtr(patch.SelfChatMode),
	})
}

func patchOpenClawWhatsAppConfig(patch OpenClawWhatsAppConfigRequest) error {
	content, err := readOpenClawConfigForWrite()
	if err != nil {
		return huma.Error500InternalServerError("read openclaw config failed", err)
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawWhatsAppChannelID])
	if patch.Enabled != nil {
		section["enabled"] = *patch.Enabled
	}
	if patch.DMPolicy != nil {
		if err := setWhatsAppPolicy(section, "dmPolicy", *patch.DMPolicy, allowedOpenClawTelegramDMPolicy); err != nil {
			return err
		}
	}
	if patch.GroupPolicy != nil {
		if err := setWhatsAppPolicy(section, "groupPolicy", *patch.GroupPolicy, allowedOpenClawTelegramGroupPolicy); err != nil {
			return err
		}
	}
	if patch.AllowFrom != nil {
		setOpenClawTelegramStringSliceField(section, "allowFrom", patch.AllowFrom)
	}
	if patch.DMPolicy != nil && strings.TrimSpace(*patch.DMPolicy) == "open" {
		ensureWhatsAppWildcardAllowFrom(section, "allowFrom")
	}
	if patch.GroupAllowFrom != nil {
		setOpenClawTelegramStringSliceField(section, "groupAllowFrom", patch.GroupAllowFrom)
	}
	setWhatsAppOptionalBool(section, "sendReadReceipts", patch.SendReadReceipts)
	setWhatsAppOptionalBool(section, "selfChatMode", patch.SelfChatMode)
	setWhatsAppOptionalBool(section, "configWrites", patch.ConfigWrites)
	setWhatsAppOptionalString(section, "historyLimit", patch.HistoryLimit)
	setWhatsAppOptionalString(section, "textChunkLimit", patch.TextChunkLimit)
	setWhatsAppOptionalString(section, "mediaMaxMb", patch.MediaMaxMb)
	if patch.ChunkMode != nil {
		if err := setWhatsAppChoice(section, "chunkMode", *patch.ChunkMode, []string{"length", "newline"}); err != nil {
			return err
		}
	}
	if patch.ReplyToMode != nil {
		if err := setWhatsAppChoice(section, "replyToMode", *patch.ReplyToMode, []string{"off", "first", "all", "batched"}); err != nil {
			return err
		}
	}
	if patch.ReactionLevel != nil {
		if err := setWhatsAppChoice(section, "reactionLevel", *patch.ReactionLevel, []string{"off", "ack", "minimal", "extensive"}); err != nil {
			return err
		}
	}
	if patch.Actions != nil {
		patchOpenClawWhatsAppActions(section, patch.Actions)
	}
	channels[openClawWhatsAppChannelID] = section
	content["channels"] = channels
	return writeOpenClawConfigContent(openClawConfigPath(), content)
}

func patchOpenClawWhatsAppAccount(accountID string, patch OpenClawWhatsAppAccountConfigRequest) error {
	content, err := readOpenClawConfigForWrite()
	if err != nil {
		return huma.Error500InternalServerError("read openclaw config failed", err)
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawWhatsAppChannelID])
	accounts := objectMap(section["accounts"])
	accountCfg := objectMap(accounts[accountID])
	if patch.Enabled != nil {
		accountCfg["enabled"] = *patch.Enabled
	}
	applyStringConfigField(accountCfg, "name", patch.Name)
	applyStringConfigField(accountCfg, "authDir", patch.AuthDir)
	if patch.DMPolicy != nil {
		if err := setWhatsAppPolicy(accountCfg, "dmPolicy", *patch.DMPolicy, allowedOpenClawTelegramDMPolicy); err != nil {
			return err
		}
	}
	if patch.GroupPolicy != nil {
		if err := setWhatsAppPolicy(accountCfg, "groupPolicy", *patch.GroupPolicy, allowedOpenClawTelegramGroupPolicy); err != nil {
			return err
		}
	}
	if patch.AllowFrom != nil {
		setOpenClawTelegramStringSliceField(accountCfg, "allowFrom", patch.AllowFrom)
	}
	if patch.DMPolicy != nil && strings.TrimSpace(*patch.DMPolicy) == "open" {
		ensureWhatsAppWildcardAllowFrom(accountCfg, "allowFrom")
	}
	if patch.GroupAllowFrom != nil {
		setOpenClawTelegramStringSliceField(accountCfg, "groupAllowFrom", patch.GroupAllowFrom)
	}
	setWhatsAppOptionalBool(accountCfg, "sendReadReceipts", patch.SendReadReceipts)
	setWhatsAppOptionalBool(accountCfg, "selfChatMode", patch.SelfChatMode)
	accounts[accountID] = accountCfg
	section["accounts"] = accounts
	channels[openClawWhatsAppChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(openClawConfigPath(), content); err != nil {
		return huma.Error500InternalServerError("write openclaw config failed", err)
	}
	if patch.AgentID != nil {
		return setOpenClawChannelAccountBinding(openClawWhatsAppChannelID, accountID, strings.TrimSpace(*patch.AgentID))
	}
	return nil
}

func removeOpenClawWhatsAppAccount(accountID string) error {
	content, err := readOpenClawConfigForWrite()
	if err != nil {
		return err
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawWhatsAppChannelID])
	accounts := objectMap(section["accounts"])
	delete(accounts, accountID)
	if len(accounts) == 0 {
		delete(section, "accounts")
	} else {
		section["accounts"] = accounts
	}
	if len(section) == 0 {
		delete(channels, openClawWhatsAppChannelID)
	} else {
		channels[openClawWhatsAppChannelID] = section
	}
	content["channels"] = channels
	return writeOpenClawConfigContent(openClawConfigPath(), content)
}

func cleanupOpenClawWhatsAppConfig(ctx context.Context, task openClawChannelLogger) error {
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
	if _, ok := channels[openClawWhatsAppChannelID]; ok {
		delete(channels, openClawWhatsAppChannelID)
		content["channels"] = channels
		changed = true
	}
	plugins := objectMap(content["plugins"])
	entries := objectMap(plugins["entries"])
	if _, ok := entries[openClawWhatsAppChannelID]; ok {
		delete(entries, openClawWhatsAppChannelID)
		plugins["entries"] = entries
		content["plugins"] = plugins
		changed = true
	}
	if changed {
		if err := writeOpenClawConfigContent(openClawConfigPath(), content); err != nil {
			return err
		}
		task.addLog("已清理 WhatsApp 配置残留。")
	} else {
		task.addLog("没有发现 WhatsApp 配置残留。")
	}
	return nil
}

func ensureOpenClawWhatsAppInstalled(ctx context.Context, task openClawChannelLogger) error {
	status := detectOpenClawWhatsAppStatus()
	if status.Installed {
		task.addLog("WhatsApp 插件已安装。")
		return nil
	}
	task.addLog("WhatsApp 插件未安装，正在安装 " + openClawWhatsAppPackage + "。")
	if _, _, err := runOpenClawStreamingCommandTo(ctx, 15*time.Minute, task.addLog, "plugins", "install", openClawWhatsAppPackage); err != nil {
		return err
	}
	if _, _, err := runOpenClawStreamingCommandTo(ctx, 2*time.Minute, task.addLog, "plugins", "registry", "--refresh"); err != nil {
		return err
	}
	return nil
}

func readOpenClawConfigForWrite() (map[string]any, error) {
	content, _, err := readOpenClawConfigFile(openClawConfigPath())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	if content == nil {
		content = map[string]any{}
	}
	return content, nil
}

func openClawWhatsAppPackagePaths(home string) []string {
	paths := []string{
		filepath.Join(home, "extensions", openClawWhatsAppChannelID, "package.json"),
		filepath.Join(home, "node_modules", "@openclaw", "whatsapp", "package.json"),
		filepath.Join(home, "npm", "node_modules", "@openclaw", "whatsapp", "package.json"),
	}
	if installPath := openClawPluginInstallRecordPath(home, openClawWhatsAppChannelID); installPath != "" {
		paths = append(paths, filepath.Join(installPath, "package.json"))
	}
	return paths
}

func discoverOpenClawWhatsAppAuthAccountIDs(home string) []string {
	root := filepath.Join(home, "credentials", "whatsapp")
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	ids := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			ids = append(ids, entry.Name())
		}
	}
	return ids
}

func openClawWhatsAppAuthDir(accountID string, cfg map[string]any) (string, bool) {
	if authDir := strings.TrimSpace(stringFromMap(cfg, "authDir")); authDir != "" {
		return expandHomePath(authDir), false
	}
	home := defaultOpenClawHomeDir()
	defaultDir := filepath.Join(home, "credentials", "whatsapp", accountID)
	if accountID == "default" {
		legacyDir := filepath.Join(home, "credentials")
		if fileExists(filepath.Join(legacyDir, "creds.json")) && !fileExists(filepath.Join(defaultDir, "creds.json")) {
			return legacyDir, true
		}
	}
	return defaultDir, false
}

func openClawWhatsAppAuthState(authDir string) (bool, string, string, string) {
	credsPath := filepath.Join(authDir, "creds.json")
	info, err := os.Stat(credsPath)
	if err != nil || info.IsDir() || info.Size() <= 1 {
		return false, "", "", ""
	}
	selfID, selfPhone := readOpenClawWhatsAppSelfID(credsPath)
	return true, info.ModTime().UTC().Format(time.RFC3339), selfID, selfPhone
}

func readOpenClawWhatsAppSelfID(credsPath string) (string, string) {
	data, err := os.ReadFile(credsPath)
	if err != nil {
		return "", ""
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		return "", ""
	}
	me := objectMap(payload["me"])
	id := strings.TrimSpace(stringFromMap(me, "id"))
	if id == "" {
		return "", ""
	}
	phone := strings.TrimPrefix(strings.Split(id, ":")[0], "+")
	if phone != "" {
		phone = "+" + phone
	}
	return id, phone
}

func openClawWhatsAppAccountConfigHasSignal(cfg map[string]any) bool {
	return len(cfg) > 0
}

func openClawWhatsAppActionsFromValue(value any) OpenClawWhatsAppActionsConfig {
	cfg := objectMap(value)
	return OpenClawWhatsAppActionsConfig{
		Reactions: boolPointerFromMap(cfg, "reactions"),
		Polls:     boolPointerFromMap(cfg, "polls"),
	}
}

func patchOpenClawWhatsAppActions(target map[string]any, patch *OpenClawWhatsAppActionsConfigRequest) {
	cfg := objectMap(target["actions"])
	setOpenClawTelegramBoolPointerField(cfg, "reactions", patch.Reactions)
	setOpenClawTelegramBoolPointerField(cfg, "polls", patch.Polls)
	setOpenClawTelegramObjectField(target, "actions", cfg)
}

func setWhatsAppPolicy(target map[string]any, key string, value string, allowed func(string) bool) error {
	value = strings.TrimSpace(value)
	if value == "" || value == "inherit" {
		delete(target, key)
		return nil
	}
	if !allowed(value) {
		return huma.Error400BadRequest("unsupported whatsapp "+key, nil)
	}
	target[key] = value
	return nil
}

func ensureWhatsAppWildcardAllowFrom(target map[string]any, key string) {
	entries := stringSliceFromValue(target[key])
	for _, entry := range entries {
		if strings.TrimSpace(entry) == "*" {
			return
		}
	}
	target[key] = append([]string{"*"}, entries...)
}

func setWhatsAppOptionalString(target map[string]any, key string, value *string) {
	if value == nil {
		return
	}
	setOpenClawTelegramStringField(target, key, *value)
}

func setWhatsAppOptionalBool(target map[string]any, key string, value *bool) {
	if value == nil {
		return
	}
	target[key] = *value
}

func setWhatsAppChoice(target map[string]any, key string, value string, allowed []string) error {
	value = strings.TrimSpace(value)
	if value == "" || value == "inherit" {
		delete(target, key)
		return nil
	}
	for _, candidate := range allowed {
		if value == candidate {
			target[key] = value
			return nil
		}
	}
	return huma.Error400BadRequest("unsupported whatsapp "+key, nil)
}

func firstNonEmptyObjectMap(values ...map[string]any) map[string]any {
	for _, value := range values {
		if len(value) > 0 {
			return value
		}
	}
	return nil
}

func boolDefaultFromMaps(key string, values ...map[string]any) bool {
	for _, value := range values {
		if _, ok := value[key]; ok {
			return boolFromMap(value, key)
		}
	}
	return false
}

func whatsappStringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case float64, int, int64, json.Number:
		return strings.TrimSpace(fmt.Sprint(typed))
	default:
		return ""
	}
}

func expandHomePath(value string) string {
	value = strings.TrimSpace(value)
	if value == "~" {
		return defaultOpenClawHomeDir()
	}
	if strings.HasPrefix(value, "~/") {
		home, err := os.UserHomeDir()
		if err == nil && home != "" {
			return filepath.Join(home, strings.TrimPrefix(value, "~/"))
		}
	}
	return value
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func whatsappStringPtr(value string) *string {
	return &value
}

func whatsappBoolPtr(value bool) *bool {
	return &value
}
