package openclaw

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"agent-box-server/internal/httpapi/toolenv"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/sse"
)

const (
	openClawFeishuChannelID = "feishu"
	openClawFeishuPluginID  = "openclaw-lark"
	openClawFeishuPackage   = "@larksuite/openclaw-lark"
	openClawFeishuLatest    = "2026.5.13"
	openClawFeishuAuthURL   = "https://accounts.feishu.cn/oauth/v1/app/registration"
	openClawLarkAuthURL     = "https://accounts.larksuite.com/oauth/v1/app/registration"
)

type OpenClawFeishuStatusOutput struct {
	Body OpenClawFeishuStatusResponse
}

type OpenClawFeishuConfigInput struct {
	Body OpenClawFeishuConfigRequest
}

type OpenClawFeishuConfigOutput struct {
	Body OpenClawFeishuStatusResponse
}

type OpenClawFeishuAccountConfigInput struct {
	AccountID string `path:"accountId" doc:"Feishu account id." example:"default"`
	Body      OpenClawFeishuAccountConfigRequest
}

type OpenClawFeishuAccountConfigOutput struct {
	Body OpenClawFeishuStatusResponse
}

type OpenClawFeishuAccountDeleteInput struct {
	AccountID string `path:"accountId" doc:"Feishu account id." example:"default"`
}

type OpenClawFeishuAccountDeleteOutput struct {
	Body OpenClawFeishuAccountDeleteResponse
}

type OpenClawFeishuAddStreamInput struct {
	AccountID      string `query:"accountId" doc:"Feishu account id. Empty uses default." example:"default"`
	AgentID        string `query:"agentId" doc:"Agent id routed to this account."`
	AppID          string `query:"appId" doc:"Feishu/Lark App ID."`
	AppSecret      string `query:"appSecret" doc:"Feishu/Lark App Secret."`
	DMPolicy       string `query:"dmPolicy" enum:"pairing,allowlist,open,disabled" example:"pairing" doc:"Feishu DM access policy."`
	Domain         string `query:"domain" doc:"Feishu domain: feishu, lark, or custom HTTPS domain."`
	GroupPolicy    string `query:"groupPolicy" enum:"open,allowlist,disabled" example:"allowlist" doc:"Feishu group access policy."`
	Name           string `query:"name" doc:"Optional account display name."`
	RequireMention bool   `query:"requireMention" doc:"Whether group messages require @ bot."`
}

type OpenClawFeishuStatusResponse struct {
	Status       string                         `json:"status" example:"ok" doc:"Operation status."`
	ChannelID    string                         `json:"channelId" example:"feishu" doc:"OpenClaw channel id."`
	PluginID     string                         `json:"pluginId" example:"openclaw-lark" doc:"OpenClaw plugin entry id."`
	Package      string                         `json:"package" example:"@larksuite/openclaw-lark" doc:"Official npm package name."`
	Installed    bool                           `json:"installed" example:"true" doc:"Whether the Feishu plugin appears installed from local files or install records."`
	Configured   bool                           `json:"configured" example:"true" doc:"Whether at least one Feishu account has app credentials."`
	Enabled      bool                           `json:"enabled" example:"true" doc:"Whether channels.feishu and plugin entry are enabled."`
	Config       OpenClawFeishuConfigResponse   `json:"config" doc:"Feishu channel config summary without secrets."`
	Accounts     []OpenClawFeishuAccountSummary `json:"accounts" doc:"Configured Feishu accounts without app secrets."`
	ConfigPath   string                         `json:"configPath,omitempty" doc:"OpenClaw config path."`
	OpenClawHome string                         `json:"openClawHome,omitempty" doc:"OpenClaw home directory."`
	Version      string                         `json:"version,omitempty" doc:"Installed package version when readable."`
	Error        string                         `json:"error,omitempty" doc:"Config read error."`
}

type OpenClawFeishuConfigResponse struct {
	Enabled             bool   `json:"enabled" doc:"Whether channels.feishu.enabled is not false."`
	Streaming           bool   `json:"streaming" doc:"Whether channels.feishu.streaming is true."`
	ThreadSession       bool   `json:"threadSession" doc:"Whether channels.feishu.threadSession is true."`
	RequireMention      bool   `json:"requireMention" doc:"Whether groups require bot mention by default."`
	GroupPolicy         string `json:"groupPolicy,omitempty" example:"allowlist" doc:"Default Feishu group policy."`
	GroupAllowFromCount int    `json:"groupAllowFromCount" doc:"Top-level groupAllowFrom entry count."`
	AccountCount        int    `json:"accountCount" doc:"Configured account count."`
	FooterStatus        bool   `json:"footerStatus" doc:"Whether streaming footer status is enabled."`
	FooterElapsed       bool   `json:"footerElapsed" doc:"Whether streaming footer elapsed time is enabled."`
	ToolsProfile        string `json:"toolsProfile,omitempty" doc:"OpenClaw tools.profile value."`
}

type OpenClawFeishuAccountSummary struct {
	AccountID                   string   `json:"accountId" example:"default" doc:"Feishu account id."`
	Name                        string   `json:"name,omitempty" doc:"Account display name."`
	Enabled                     bool     `json:"enabled" doc:"Whether this account is enabled."`
	Configured                  bool     `json:"configured" doc:"Whether appId and appSecret are configured."`
	AppID                       string   `json:"appId,omitempty" doc:"Feishu/Lark app id. App secret is never returned."`
	AppSecretConfigured         bool     `json:"appSecretConfigured" doc:"Whether appSecret is configured."`
	EncryptKeyConfigured        bool     `json:"encryptKeyConfigured" doc:"Whether encryptKey is configured."`
	VerificationTokenConfigured bool     `json:"verificationTokenConfigured" doc:"Whether verificationToken is configured."`
	Domain                      string   `json:"domain,omitempty" doc:"feishu, lark, or custom HTTPS domain."`
	ConnectionMode              string   `json:"connectionMode,omitempty" doc:"websocket or webhook."`
	DMPolicy                    string   `json:"dmPolicy,omitempty" doc:"Direct message policy."`
	GroupPolicy                 string   `json:"groupPolicy,omitempty" doc:"Group policy."`
	RequireMention              bool     `json:"requireMention" doc:"Whether this account requires mention in groups."`
	AllowFrom                   []string `json:"allowFrom,omitempty" doc:"DM allowFrom entries."`
	GroupAllowFrom              []string `json:"groupAllowFrom,omitempty" doc:"Group allowFrom entries."`
	GroupCount                  int      `json:"groupCount" doc:"Configured per-group rule count."`
	AgentID                     string   `json:"agentId,omitempty" doc:"Agent routed to this account."`
}

type OpenClawFeishuConfigRequest struct {
	Enabled        *bool    `json:"enabled,omitempty" doc:"Feishu channel enabled switch. Also mirrors plugins.entries.openclaw-lark.enabled."`
	Streaming      *bool    `json:"streaming,omitempty" doc:"Enable streaming cards."`
	ThreadSession  *bool    `json:"threadSession,omitempty" doc:"Enable independent context per Feishu thread."`
	RequireMention *bool    `json:"requireMention,omitempty" doc:"Default requireMention value."`
	GroupPolicy    *string  `json:"groupPolicy,omitempty" enum:"open,allowlist,disabled" doc:"Default group policy."`
	GroupAllowFrom []string `json:"groupAllowFrom,omitempty" doc:"Open ids allowed by group allowlist. Empty array clears it."`
	FooterStatus   *bool    `json:"footerStatus,omitempty" doc:"Show status in streaming footer."`
	FooterElapsed  *bool    `json:"footerElapsed,omitempty" doc:"Show elapsed time in streaming footer."`
}

type OpenClawFeishuAccountConfigRequest struct {
	Name           *string  `json:"name,omitempty" doc:"Account display name. Empty string removes it."`
	Enabled        *bool    `json:"enabled,omitempty" doc:"Account enabled switch."`
	AgentID        *string  `json:"agentId,omitempty" doc:"Agent id routed to this account. Empty string removes binding."`
	AppID          *string  `json:"appId,omitempty" doc:"Feishu/Lark app id. Empty string removes it."`
	AppSecret      *string  `json:"appSecret,omitempty" doc:"Feishu/Lark app secret. Empty string removes it."`
	Domain         *string  `json:"domain,omitempty" doc:"feishu, lark, or custom HTTPS domain. Empty string removes it."`
	DMPolicy       *string  `json:"dmPolicy,omitempty" enum:"open,pairing,allowlist,disabled" doc:"Account DM policy."`
	GroupPolicy    *string  `json:"groupPolicy,omitempty" enum:"open,allowlist,disabled" doc:"Account group policy."`
	RequireMention *bool    `json:"requireMention,omitempty" doc:"Whether this account requires mention in groups."`
	AllowFrom      []string `json:"allowFrom,omitempty" doc:"DM allowFrom entries. Empty array clears account override."`
	GroupAllowFrom []string `json:"groupAllowFrom,omitempty" doc:"Group allowFrom entries. Empty array clears account override."`
}

type OpenClawFeishuAccountDeleteResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-14T09:00:00Z" doc:"UTC response timestamp."`
	AccountID string `json:"accountId" doc:"Deleted Feishu account id."`
}

type openClawFeishuRegistrationInitResponse struct {
	SupportedAuthMethods []string `json:"supported_auth_methods"`
}

type openClawFeishuRegistrationBeginResponse struct {
	DeviceCode              string `json:"device_code"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	Interval                int    `json:"interval"`
	ExpireIn                int    `json:"expire_in"`
}

type openClawFeishuRegistrationPollResponse struct {
	ClientID         string `json:"client_id"`
	ClientSecret     string `json:"client_secret"`
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
	UserInfo         struct {
		OpenID      string `json:"open_id"`
		TenantBrand string `json:"tenant_brand"`
	} `json:"user_info"`
}

func GetOpenClawFeishuStatus(ctx context.Context, input *struct{}) (*OpenClawFeishuStatusOutput, error) {
	_ = ctx
	return &OpenClawFeishuStatusOutput{Body: detectOpenClawFeishuStatus()}, nil
}

func UpdateOpenClawFeishuConfig(ctx context.Context, input *OpenClawFeishuConfigInput) (*OpenClawFeishuConfigOutput, error) {
	_ = ctx
	if input == nil {
		return nil, huma.Error400BadRequest("feishu config request is required", nil)
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
	section := objectMap(channels[openClawFeishuChannelID])
	patch := input.Body
	if patch.Enabled != nil {
		section["enabled"] = *patch.Enabled
		plugins := objectMap(content["plugins"])
		entries := objectMap(plugins["entries"])
		entry := objectMap(entries[openClawFeishuPluginID])
		entry["enabled"] = *patch.Enabled
		entries[openClawFeishuPluginID] = entry
		plugins["entries"] = entries
		content["plugins"] = plugins
	}
	if patch.Streaming != nil {
		section["streaming"] = *patch.Streaming
	}
	if patch.ThreadSession != nil {
		section["threadSession"] = *patch.ThreadSession
	}
	if patch.RequireMention != nil {
		section["requireMention"] = *patch.RequireMention
	}
	if patch.GroupPolicy != nil {
		groupPolicy := strings.TrimSpace(*patch.GroupPolicy)
		if groupPolicy != "" && !allowedOpenClawFeishuGroupPolicy(groupPolicy) {
			return nil, huma.Error400BadRequest("unsupported feishu groupPolicy", nil)
		}
		setOpenClawTelegramStringField(section, "groupPolicy", groupPolicy)
	}
	if patch.GroupAllowFrom != nil {
		setOpenClawTelegramStringSliceField(section, "groupAllowFrom", patch.GroupAllowFrom)
	}
	if patch.FooterStatus != nil || patch.FooterElapsed != nil {
		footer := objectMap(section["footer"])
		if patch.FooterStatus != nil {
			footer["status"] = *patch.FooterStatus
		}
		if patch.FooterElapsed != nil {
			footer["elapsed"] = *patch.FooterElapsed
		}
		setOpenClawTelegramObjectField(section, "footer", footer)
	}

	channels[openClawFeishuChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return nil, huma.Error500InternalServerError("write openclaw config failed", err)
	}
	invalidateOpenClawPluginsStatusCache()
	invalidateOpenClawEnvironmentCache()
	return &OpenClawFeishuConfigOutput{Body: detectOpenClawFeishuStatus()}, nil
}

func UpdateOpenClawFeishuAccountConfig(ctx context.Context, input *OpenClawFeishuAccountConfigInput) (*OpenClawFeishuAccountConfigOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("account id is required", nil)
	}
	accountID := strings.TrimSpace(input.AccountID)
	if err := patchOpenClawFeishuAccount(accountID, input.Body); err != nil {
		return nil, huma.Error500InternalServerError("update feishu account config failed", err)
	}
	return &OpenClawFeishuAccountConfigOutput{Body: detectOpenClawFeishuStatus()}, nil
}

func DeleteOpenClawFeishuAccount(ctx context.Context, input *OpenClawFeishuAccountDeleteInput) (*OpenClawFeishuAccountDeleteOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("account id is required", nil)
	}
	accountID := strings.TrimSpace(input.AccountID)
	if err := removeOpenClawFeishuAccount(accountID); err != nil {
		return nil, huma.Error500InternalServerError("delete feishu account failed", err)
	}
	if err := setOpenClawChannelAccountBinding(openClawFeishuChannelID, accountID, ""); err != nil {
		return nil, huma.Error500InternalServerError("update feishu account binding failed", err)
	}
	return &OpenClawFeishuAccountDeleteOutput{Body: OpenClawFeishuAccountDeleteResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AccountID: accountID,
	}}, nil
}

func InstallOpenClawFeishuStream(ctx context.Context, input *struct{}, send sse.Sender) {
	streamOpenClawChannelSteps(ctx, send, "feishu-install", "install", []openClawChannelStep{
		{label: "检查 OpenClaw CLI", progress: 5, timeout: 10 * time.Second, args: []string{"--version"}},
		{label: "安装飞书官方插件", progress: 25, timeout: 15 * time.Minute, run: runOpenClawFeishuInstallCommand},
		{label: "清理安装产生的空渠道配置", progress: 72, run: cleanupOpenClawFeishuInstallConfig},
		{label: "刷新插件注册表", progress: 86, timeout: 2 * time.Minute, args: []string{"plugins", "registry", "--refresh"}, ignoreMissing: true},
		{label: "重启 Gateway 加载飞书插件", progress: 96, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
}

func ScanAddOpenClawFeishuStream(ctx context.Context, input *struct{}, send sse.Sender) {
	streamOpenClawChannelSteps(ctx, send, "feishu-scan-add", "scan", []openClawChannelStep{
		{label: "检查飞书插件安装状态", progress: 10, run: requireOpenClawFeishuInstalled},
		{label: "运行飞书扫码添加向导", progress: 35, timeout: 10 * time.Minute, run: runOpenClawFeishuScanAddCommand},
		{label: "启用飞书渠道", progress: 82, run: enableOpenClawFeishuPluginEntry},
		{label: "重启 Gateway 应用飞书配置", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
}

func AddOpenClawFeishuAccountStream(ctx context.Context, input *OpenClawFeishuAddStreamInput, send sse.Sender) {
	if input == nil {
		streamOpenClawChannelError(send, "feishu-manual-add", "add", fmt.Errorf("feishu account request is required"))
		return
	}
	accountID := strings.TrimSpace(input.AccountID)
	if accountID == "" {
		accountID = "default"
	}
	appID := strings.TrimSpace(input.AppID)
	appSecret := strings.TrimSpace(input.AppSecret)
	if appID == "" || appSecret == "" {
		streamOpenClawChannelError(send, "feishu-manual-add", "add", fmt.Errorf("App ID 和 App Secret 不能为空"))
		return
	}
	dmPolicy := firstNonEmptyTelegramString(input.DMPolicy, "pairing")
	if !allowedOpenClawFeishuDMPolicy(dmPolicy) {
		streamOpenClawChannelError(send, "feishu-manual-add", "add", fmt.Errorf("unsupported dmPolicy %q", dmPolicy))
		return
	}
	groupPolicy := strings.TrimSpace(input.GroupPolicy)
	if groupPolicy != "" && !allowedOpenClawFeishuGroupPolicy(groupPolicy) {
		streamOpenClawChannelError(send, "feishu-manual-add", "add", fmt.Errorf("unsupported groupPolicy %q", groupPolicy))
		return
	}
	domain := strings.TrimSpace(input.Domain)
	patch := OpenClawFeishuAccountConfigRequest{
		AgentID:        &input.AgentID,
		AppID:          &appID,
		AppSecret:      &appSecret,
		DMPolicy:       &dmPolicy,
		Domain:         &domain,
		Enabled:        boolPtr(true),
		GroupPolicy:    &groupPolicy,
		Name:           &input.Name,
		RequireMention: &input.RequireMention,
	}
	streamOpenClawChannelSteps(ctx, send, "feishu-manual-add", "add", []openClawChannelStep{
		{label: "检查飞书插件安装状态", progress: 10, run: requireOpenClawFeishuInstalled},
		{label: "写入飞书机器人账号配置", progress: 45, run: func(ctx context.Context, task openClawChannelLogger) error {
			_ = ctx
			if err := patchOpenClawFeishuAccount(accountID, patch); err != nil {
				return err
			}
			task.addLog("已写入 channels.feishu.accounts." + accountID)
			return nil
		}},
		{label: "启用飞书渠道", progress: 72, run: enableOpenClawFeishuPluginEntry},
		{label: "重启 Gateway 应用飞书配置", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
}

func DoctorOpenClawFeishuStream(ctx context.Context, input *struct{}, send sse.Sender) {
	streamOpenClawChannelSteps(ctx, send, "feishu-doctor", "doctor", []openClawChannelStep{
		{label: "运行飞书插件诊断", progress: 20, timeout: 5 * time.Minute, run: runOpenClawFeishuDoctorCommand},
	})
}

func UninstallOpenClawFeishuStream(ctx context.Context, input *struct{}, send sse.Sender) {
	streamOpenClawChannelSteps(ctx, send, "feishu-uninstall", "uninstall", []openClawChannelStep{
		{label: "卸载飞书插件", progress: 30, timeout: 5 * time.Minute, args: []string{"plugins", "uninstall", openClawFeishuPluginID, "--force"}, ignoreMissing: true},
		{label: "清理飞书插件文件残留", progress: 62, run: cleanupOpenClawFeishuFiles},
		{label: "清理飞书插件配置残留", progress: 80, run: cleanupOpenClawFeishuConfig},
		{label: "刷新插件注册表", progress: 92, timeout: 2 * time.Minute, args: []string{"plugins", "registry", "--refresh"}, ignoreMissing: true},
	})
}

func detectOpenClawFeishuStatus() OpenClawFeishuStatusResponse {
	home := defaultOpenClawHomeDir()
	configPath := openClawConfigPath()
	content, _, configErr := readOpenClawConfigFile(configPath)
	pluginEntry := objectMap(objectMap(objectMap(content["plugins"])["entries"])[openClawFeishuPluginID])
	section := objectMap(objectMap(content["channels"])[openClawFeishuChannelID])

	installed := false
	version := ""
	for _, pkgPath := range openClawFeishuPackagePaths(home) {
		pkgVersion, exists := readPackageVersion(pkgPath)
		if exists {
			installed = true
			if version == "" {
				version = pkgVersion
			}
		}
	}
	if !installed && (len(pluginEntry) > 0 || openClawPluginInstallRecordPath(home, openClawFeishuPluginID) != "") {
		installed = true
	}

	config := openClawFeishuConfigFromSection(section, content)
	if !config.Enabled && len(pluginEntry) > 0 && boolFromMap(pluginEntry, "enabled") && !hasExplicitFalse(section, "enabled") {
		config.Enabled = true
	}
	if len(pluginEntry) > 0 && hasExplicitFalse(pluginEntry, "enabled") {
		config.Enabled = false
	}
	accounts := readOpenClawFeishuAccounts(section, readOpenClawChannelAccountBindings(content, openClawFeishuChannelID))
	config.AccountCount = len(accounts)
	if len(accounts) == 0 {
		config.Enabled = false
	}
	configured := false
	for _, account := range accounts {
		if account.Configured {
			configured = true
			break
		}
	}

	response := OpenClawFeishuStatusResponse{
		Status:       "ok",
		ChannelID:    openClawFeishuChannelID,
		PluginID:     openClawFeishuPluginID,
		Package:      openClawFeishuPackage,
		Installed:    installed,
		Configured:   configured,
		Enabled:      config.Enabled,
		Config:       config,
		Accounts:     accounts,
		ConfigPath:   configPath,
		OpenClawHome: home,
		Version:      version,
	}
	if configErr != nil && !errors.Is(configErr, os.ErrNotExist) {
		response.Error = "openclaw config read failed: " + configErr.Error()
	}
	return response
}

func openClawFeishuConfigFromSection(section map[string]any, content map[string]any) OpenClawFeishuConfigResponse {
	footer := objectMap(section["footer"])
	return OpenClawFeishuConfigResponse{
		Enabled:             len(section) > 0 && !hasExplicitFalse(section, "enabled"),
		Streaming:           boolFromMap(section, "streaming"),
		ThreadSession:       boolFromMap(section, "threadSession"),
		RequireMention:      boolFromMap(section, "requireMention"),
		GroupPolicy:         stringFromMap(section, "groupPolicy"),
		GroupAllowFromCount: len(stringListFromValue(section["groupAllowFrom"])),
		FooterStatus:        boolFromMap(footer, "status"),
		FooterElapsed:       boolFromMap(footer, "elapsed"),
		ToolsProfile:        stringFromMap(objectMap(content["tools"]), "profile"),
	}
}

func readOpenClawFeishuAccounts(section map[string]any, bindings map[string]string) []OpenClawFeishuAccountSummary {
	accountsCfg := objectMap(section["accounts"])
	ids := make([]string, 0, len(accountsCfg)+1)
	if openClawFeishuAccountConfigured(section) {
		ids = append(ids, "default")
	}
	for id := range accountsCfg {
		if strings.TrimSpace(id) != "" {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	seen := map[string]bool{}
	accounts := make([]OpenClawFeishuAccountSummary, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		cfg := objectMap(accountsCfg[id])
		if id == "default" {
			cfg = mergeOpenClawFeishuDefaultAccount(section, cfg)
		}
		if !openClawFeishuAccountConfigured(cfg) {
			continue
		}
		accounts = append(accounts, openClawFeishuAccountFromConfig(id, cfg, section, bindings[id]))
	}
	return accounts
}

func openClawFeishuAccountFromConfig(accountID string, cfg map[string]any, parent map[string]any, agentID string) OpenClawFeishuAccountSummary {
	appID := firstNonEmptyTelegramString(stringFromMap(cfg, "appId"), stringFromMap(cfg, "appID"))
	appSecret := stringFromMap(cfg, "appSecret")
	groups := objectMap(cfg["groups"])
	return OpenClawFeishuAccountSummary{
		AccountID:                   accountID,
		Name:                        stringFromMap(cfg, "name"),
		Enabled:                     !hasExplicitFalse(cfg, "enabled"),
		Configured:                  appID != "" && appSecret != "",
		AppID:                       appID,
		AppSecretConfigured:         appSecret != "",
		EncryptKeyConfigured:        stringFromMap(cfg, "encryptKey") != "",
		VerificationTokenConfigured: stringFromMap(cfg, "verificationToken") != "",
		Domain:                      firstNonEmptyTelegramString(stringFromMap(cfg, "domain"), "feishu"),
		ConnectionMode:              firstNonEmptyTelegramString(stringFromMap(cfg, "connectionMode"), stringFromMap(parent, "connectionMode")),
		DMPolicy:                    firstNonEmptyTelegramString(stringFromMap(cfg, "dmPolicy"), stringFromMap(parent, "dmPolicy"), "pairing"),
		GroupPolicy:                 firstNonEmptyTelegramString(stringFromMap(cfg, "groupPolicy"), stringFromMap(parent, "groupPolicy")),
		RequireMention:              boolFromMap(cfg, "requireMention") || (!hasExplicitFalse(cfg, "requireMention") && boolFromMap(parent, "requireMention")),
		AllowFrom:                   stringListFromValue(cfg["allowFrom"]),
		GroupAllowFrom:              stringListFromValue(cfg["groupAllowFrom"]),
		GroupCount:                  len(groups),
		AgentID:                     strings.TrimSpace(agentID),
	}
}

func patchOpenClawFeishuAccount(accountID string, patch OpenClawFeishuAccountConfigRequest) error {
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
	section := objectMap(channels[openClawFeishuChannelID])
	accounts := objectMap(section["accounts"])
	accountCfg := objectMap(accounts[accountID])
	if accountID == "default" && len(accountCfg) == 0 && openClawFeishuAccountConfigured(section) {
		accountCfg = mergeOpenClawFeishuDefaultAccount(section, accountCfg)
	}

	applyStringConfigField(accountCfg, "name", patch.Name)
	applyStringConfigField(accountCfg, "appId", patch.AppID)
	applyStringConfigField(accountCfg, "appSecret", patch.AppSecret)
	applyStringConfigField(accountCfg, "domain", patch.Domain)
	if patch.Enabled != nil {
		accountCfg["enabled"] = *patch.Enabled
	}
	if patch.DMPolicy != nil {
		dmPolicy := strings.TrimSpace(*patch.DMPolicy)
		if dmPolicy != "" && !allowedOpenClawFeishuDMPolicy(dmPolicy) {
			return fmt.Errorf("unsupported feishu dmPolicy %q", dmPolicy)
		}
		setOpenClawTelegramStringField(accountCfg, "dmPolicy", dmPolicy)
	}
	if patch.GroupPolicy != nil {
		groupPolicy := strings.TrimSpace(*patch.GroupPolicy)
		if groupPolicy != "" && !allowedOpenClawFeishuGroupPolicy(groupPolicy) {
			return fmt.Errorf("unsupported feishu groupPolicy %q", groupPolicy)
		}
		setOpenClawTelegramStringField(accountCfg, "groupPolicy", groupPolicy)
	}
	if patch.RequireMention != nil {
		accountCfg["requireMention"] = *patch.RequireMention
	}
	if patch.AllowFrom != nil {
		setOpenClawTelegramStringSliceField(accountCfg, "allowFrom", patch.AllowFrom)
	}
	if patch.GroupAllowFrom != nil {
		setOpenClawTelegramStringSliceField(accountCfg, "groupAllowFrom", patch.GroupAllowFrom)
	}

	accounts[accountID] = accountCfg
	section["accounts"] = accounts
	channels[openClawFeishuChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return err
	}
	if patch.AgentID != nil {
		return setOpenClawChannelAccountBinding(openClawFeishuChannelID, accountID, strings.TrimSpace(*patch.AgentID))
	}
	return nil
}

func removeOpenClawFeishuAccount(accountID string) error {
	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawFeishuChannelID])
	accounts := objectMap(section["accounts"])
	delete(accounts, accountID)
	if accountID == "default" {
		for _, key := range []string{"appId", "appID", "appSecret", "encryptKey", "verificationToken"} {
			delete(section, key)
		}
	}
	if len(accounts) == 0 {
		delete(section, "accounts")
	} else {
		section["accounts"] = accounts
	}
	if openClawFeishuAccountConfigured(section) || len(accounts) > 0 {
		channels[openClawFeishuChannelID] = section
	} else {
		delete(channels, openClawFeishuChannelID)
	}
	content["channels"] = channels
	return writeOpenClawConfigContent(configPath, content)
}

func cleanupOpenClawFeishuConfig(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	configPath := openClawConfigPath()
	content, exists, err := readOpenClawConfigFile(configPath)
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
	plugins := objectMap(content["plugins"])
	entries := objectMap(plugins["entries"])
	for _, id := range []string{openClawFeishuPluginID, openClawFeishuChannelID} {
		if _, ok := entries[id]; ok {
			delete(entries, id)
			plugins["entries"] = entries
			changed = true
		}
	}
	installs := objectMap(plugins["installs"])
	if _, ok := installs[openClawFeishuPluginID]; ok {
		delete(installs, openClawFeishuPluginID)
		plugins["installs"] = installs
		changed = true
	}
	channels := objectMap(content["channels"])
	if _, ok := channels[openClawFeishuChannelID]; ok {
		delete(channels, openClawFeishuChannelID)
		content["channels"] = channels
		changed = true
	}
	if changed {
		content["plugins"] = plugins
		if err := writeOpenClawConfigContent(configPath, content); err != nil {
			return err
		}
		task.addLog("已清理飞书插件配置残留。")
	} else {
		task.addLog("没有发现飞书插件配置残留。")
	}
	return nil
}

func cleanupOpenClawFeishuInstallConfig(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	configPath := openClawConfigPath()
	content, exists, err := readOpenClawConfigFile(configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if !exists {
		return nil
	}

	changed := false
	channels := objectMap(content["channels"])
	if _, ok := channels[openClawFeishuChannelID]; ok {
		delete(channels, openClawFeishuChannelID)
		content["channels"] = channels
		changed = true
	}

	plugins := objectMap(content["plugins"])
	entries := objectMap(plugins["entries"])
	if _, ok := entries[openClawFeishuChannelID]; ok {
		delete(entries, openClawFeishuChannelID)
		plugins["entries"] = entries
		content["plugins"] = plugins
		changed = true
	}
	if entry, ok := entries[openClawFeishuPluginID]; ok {
		pluginEntry := objectMap(entry)
		if !hasExplicitFalse(pluginEntry, "enabled") {
			pluginEntry["enabled"] = false
			entries[openClawFeishuPluginID] = pluginEntry
			plugins["entries"] = entries
			content["plugins"] = plugins
			changed = true
		}
	}

	if !changed {
		task.addLog("安装未产生空渠道配置。")
		return nil
	}
	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return err
	}
	task.addLog("已清理安装产生的空 channels.feishu 配置。")
	return nil
}

func cleanupOpenClawFeishuFiles(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	home := defaultOpenClawHomeDir()
	removed := 0
	seenDirs := map[string]bool{}
	for _, pkgPath := range openClawFeishuPackagePaths(home) {
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
	if err := removeOpenClawFeishuInstallRecord(home); err != nil {
		return err
	}
	if removed > 0 {
		task.addLog(fmt.Sprintf("已清理 %d 个飞书插件安装目录。", removed))
	} else {
		task.addLog("没有发现飞书插件安装目录残留。")
	}
	return nil
}

func removeOpenClawFeishuInstallRecord(home string) error {
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
	for _, id := range []string{openClawFeishuPluginID, openClawFeishuChannelID} {
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

func requireOpenClawFeishuInstalled(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	status := detectOpenClawFeishuStatus()
	if !status.Installed {
		return fmt.Errorf("飞书插件未安装，请先执行安装")
	}
	task.addLog("飞书插件已安装。")
	return nil
}

func enableOpenClawFeishuPluginEntry(ctx context.Context, task openClawChannelLogger) error {
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
	section := objectMap(channels[openClawFeishuChannelID])
	section["enabled"] = true
	channels[openClawFeishuChannelID] = section
	content["channels"] = channels

	plugins := objectMap(content["plugins"])
	entries := objectMap(plugins["entries"])
	entry := objectMap(entries[openClawFeishuPluginID])
	entry["enabled"] = true
	entries[openClawFeishuPluginID] = entry
	plugins["entries"] = entries
	content["plugins"] = plugins

	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return err
	}
	task.addLog("已启用 plugins.entries.openclaw-lark 和 channels.feishu。")
	return nil
}

func runOpenClawFeishuInstallCommand(ctx context.Context, task openClawChannelLogger) error {
	_, _, err := runOpenClawStreamingCommandTo(
		ctx,
		15*time.Minute,
		task.addLog,
		"plugins",
		"install",
		openClawFeishuPackage+"@"+openClawFeishuLatest,
		"--force",
		"--dangerously-force-unsafe-install",
	)
	return err
}

type openClawFeishuRegistrationResult struct {
	appID     string
	appSecret string
	domain    string
	openID    string
}

func runOpenClawFeishuScanAddCommand(ctx context.Context, task openClawChannelLogger) error {
	result, err := runOpenClawFeishuRegistrationFlow(ctx, task)
	if err != nil {
		return err
	}
	accountID := uniqueOpenClawFeishuAccountID(result.appID)
	patch := OpenClawFeishuAccountConfigRequest{
		AppID:          &result.appID,
		AppSecret:      &result.appSecret,
		DMPolicy:       stringPtr("allowlist"),
		Domain:         &result.domain,
		Enabled:        boolPtr(true),
		GroupPolicy:    stringPtr("allowlist"),
		Name:           &accountID,
		RequireMention: boolPtr(true),
	}
	if result.openID != "" {
		patch.AllowFrom = []string{result.openID}
		patch.GroupAllowFrom = []string{result.openID}
	}
	if err := patchOpenClawFeishuAccount(accountID, patch); err != nil {
		return err
	}
	task.addLog("已写入 channels.feishu.accounts." + accountID)
	return nil
}

func runOpenClawFeishuRegistrationFlow(ctx context.Context, task openClawChannelLogger) (openClawFeishuRegistrationResult, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	baseURL := openClawFeishuAuthURL
	if err := postOpenClawFeishuRegistrationForm(ctx, client, baseURL, url.Values{"action": {"init"}}, &openClawFeishuRegistrationInitResponse{}); err != nil {
		return openClawFeishuRegistrationResult{}, err
	}

	var begin openClawFeishuRegistrationBeginResponse
	if err := postOpenClawFeishuRegistrationForm(ctx, client, baseURL, url.Values{
		"action":            {"begin"},
		"archetype":         {"PersonalAgent"},
		"auth_method":       {"client_secret"},
		"request_user_info": {"open_id"},
	}, &begin); err != nil {
		return openClawFeishuRegistrationResult{}, err
	}
	if strings.TrimSpace(begin.DeviceCode) == "" || strings.TrimSpace(begin.VerificationURIComplete) == "" {
		return openClawFeishuRegistrationResult{}, fmt.Errorf("飞书扫码授权初始化失败：缺少 device_code 或授权 URL")
	}

	qrURL, err := url.Parse(begin.VerificationURIComplete)
	if err != nil {
		return openClawFeishuRegistrationResult{}, err
	}
	qrURL.Query().Encode()
	query := qrURL.Query()
	query.Set("from", "onboard")
	qrURL.RawQuery = query.Encode()
	task.addLog("飞书网页授权 URL: " + qrURL.String())
	task.addLog("请使用飞书扫码，或点击弹窗中的网页授权按钮选择 / 创建机器人。")

	interval := begin.Interval
	if interval <= 0 {
		interval = 5
	}
	expireIn := begin.ExpireIn
	if expireIn <= 0 {
		expireIn = 600
	}
	deadline := time.Now().Add(time.Duration(expireIn) * time.Second)
	domain := "feishu"
	switchedDomain := false
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return openClawFeishuRegistrationResult{}, ctx.Err()
		case <-time.After(time.Duration(interval) * time.Second):
		}

		var poll openClawFeishuRegistrationPollResponse
		if err := postOpenClawFeishuRegistrationForm(ctx, client, baseURL, url.Values{
			"action":      {"poll"},
			"device_code": {begin.DeviceCode},
		}, &poll); err != nil {
			return openClawFeishuRegistrationResult{}, err
		}

		if poll.UserInfo.TenantBrand == "lark" && !switchedDomain {
			baseURL = openClawLarkAuthURL
			domain = "lark"
			switchedDomain = true
			continue
		}
		if poll.ClientID != "" && poll.ClientSecret != "" {
			task.addLog("飞书机器人配置成功：" + poll.ClientID)
			return openClawFeishuRegistrationResult{
				appID:     strings.TrimSpace(poll.ClientID),
				appSecret: strings.TrimSpace(poll.ClientSecret),
				domain:    domain,
				openID:    strings.TrimSpace(poll.UserInfo.OpenID),
			}, nil
		}
		switch poll.Error {
		case "", "authorization_pending":
			continue
		case "slow_down":
			interval += 5
			continue
		case "access_denied":
			return openClawFeishuRegistrationResult{}, fmt.Errorf("用户取消了飞书授权")
		case "expired_token":
			return openClawFeishuRegistrationResult{}, fmt.Errorf("飞书授权二维码已过期，请重新扫码添加")
		default:
			if poll.ErrorDescription != "" {
				return openClawFeishuRegistrationResult{}, fmt.Errorf("飞书授权失败：%s - %s", poll.Error, poll.ErrorDescription)
			}
			return openClawFeishuRegistrationResult{}, fmt.Errorf("飞书授权失败：%s", poll.Error)
		}
	}
	return openClawFeishuRegistrationResult{}, fmt.Errorf("飞书授权超时，请重新扫码添加")
}

func postOpenClawFeishuRegistrationForm(ctx context.Context, client *http.Client, endpoint string, values url.Values, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if err := json.NewDecoder(res.Body).Decode(target); err != nil {
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			return fmt.Errorf("飞书授权请求失败：HTTP %d", res.StatusCode)
		}
		return err
	}
	return nil
}

func uniqueOpenClawFeishuAccountID(appID string) string {
	base := strings.TrimSpace(appID)
	if base == "" {
		base = "feishu"
	}
	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		return base
	}
	section := objectMap(objectMap(content["channels"])[openClawFeishuChannelID])
	accounts := objectMap(section["accounts"])
	if _, ok := accounts[base]; !ok && !openClawFeishuDefaultAccountUsesAppID(section, base) {
		return base
	}
	for index := 2; ; index++ {
		candidate := fmt.Sprintf("%s-%d", base, index)
		if _, ok := accounts[candidate]; !ok {
			return candidate
		}
	}
}

func openClawFeishuDefaultAccountUsesAppID(section map[string]any, appID string) bool {
	return appID != "" && firstNonEmptyTelegramString(stringFromMap(section, "appId"), stringFromMap(section, "appID")) == appID
}

func runOpenClawFeishuDoctorCommand(ctx context.Context, task openClawChannelLogger) error {
	return runOpenClawFeishuNpxCommand(ctx, 5*time.Minute, task.addLog, "-y", openClawFeishuPackage, "doctor")
}

func runOpenClawFeishuNpxCommand(ctx context.Context, timeout time.Duration, writeOutput func(string), args ...string) error {
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, "npx", args...)
	cmd.Env = toolenv.CommandEnv()
	var stdout strings.Builder
	var stderr strings.Builder
	cmd.Stdout = taskWriter{write: func(value string) {
		stdout.WriteString(value)
		if writeOutput != nil {
			writeOutput(value)
		}
	}}
	cmd.Stderr = taskWriter{write: func(value string) {
		stderr.WriteString(value)
		if writeOutput != nil {
			writeOutput(value)
		}
	}}
	err := cmd.Run()
	if cmdCtx.Err() != nil {
		return cmdCtx.Err()
	}
	if err != nil {
		combined := strings.TrimSpace(strings.Join([]string{stdout.String(), stderr.String(), err.Error()}, "\n"))
		return errors.New(combined)
	}
	return nil
}

func openClawFeishuPackagePaths(home string) []string {
	paths := []string{
		filepath.Join(home, "extensions", "feishu", "package.json"),
		filepath.Join(home, "extensions", openClawFeishuPluginID, "package.json"),
		filepath.Join(home, "node_modules", "@larksuite", "openclaw-lark", "package.json"),
		filepath.Join(home, "npm", "node_modules", "@larksuite", "openclaw-lark", "package.json"),
	}
	if installPath := openClawPluginInstallRecordPath(home, openClawFeishuPluginID); installPath != "" {
		paths = append(paths, filepath.Join(installPath, "package.json"))
	}
	return paths
}

func mergeOpenClawFeishuDefaultAccount(parent map[string]any, cfg map[string]any) map[string]any {
	merged := map[string]any{}
	for _, key := range []string{
		"appId", "appID", "appSecret", "encryptKey", "verificationToken", "name", "enabled",
		"domain", "connectionMode", "dmPolicy", "allowFrom", "groupPolicy", "groupAllowFrom",
		"requireMention", "groups",
	} {
		if value, ok := parent[key]; ok {
			merged[key] = value
		}
	}
	for key, value := range cfg {
		merged[key] = value
	}
	return merged
}

func openClawFeishuAccountConfigured(cfg map[string]any) bool {
	return firstNonEmptyTelegramString(stringFromMap(cfg, "appId"), stringFromMap(cfg, "appID")) != "" || stringFromMap(cfg, "appSecret") != ""
}

func allowedOpenClawFeishuDMPolicy(value string) bool {
	switch value {
	case "open", "pairing", "allowlist", "disabled":
		return true
	default:
		return false
	}
}

func allowedOpenClawFeishuGroupPolicy(value string) bool {
	switch value {
	case "open", "allowlist", "disabled":
		return true
	default:
		return false
	}
}

func stringListFromValue(value any) []string {
	switch typed := value.(type) {
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := strings.TrimSpace(fmt.Sprint(item)); text != "" {
				result = append(result, text)
			}
		}
		return result
	case []string:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := strings.TrimSpace(item); text != "" {
				result = append(result, text)
			}
		}
		return result
	case string:
		if text := strings.TrimSpace(typed); text != "" {
			return []string{text}
		}
	}
	return []string{}
}
