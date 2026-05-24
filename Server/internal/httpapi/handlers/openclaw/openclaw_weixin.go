package openclaw

// OpenClaw channels handlers expose messaging-channel setup flows for the local OpenClaw install.
//
// Weixin operations are intentionally separate:
// install installs/enables the plugin, login runs QR login, and uninstall removes the plugin.
// Long-running command output is delivered with Server-Sent Events so the dashboard can show
// CLI output as it happens.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"agent-box-server/internal/httpapi/logfilter"
	"agent-box-server/internal/httpapi/toolenv"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/sse"
)

const (
	openClawWeixinChannelID  = "openclaw-weixin"
	openClawWeixinPackage    = "@tencent-weixin/openclaw-weixin"
	openClawWeixinCDNBaseURL = "https://novac2c.cdn.weixin.qq.com/c2c"
)

var openClawChannelTasks = newOpenClawChannelTaskStore()

type OpenClawWeixinStatusOutput struct {
	Body OpenClawWeixinStatusResponse
}

type OpenClawWeixinConfigOutput struct {
	Body OpenClawWeixinStatusResponse
}

type OpenClawWeixinConfigInput struct {
	Body OpenClawWeixinConfigRequest
}

type OpenClawWeixinAccountDeleteInput struct {
	AccountID string `path:"accountId" doc:"Weixin account id." example:"default"`
}

type OpenClawWeixinAccountConfigInput struct {
	AccountID string `path:"accountId" doc:"Weixin account id." example:"default"`
	Body      OpenClawWeixinAccountConfigRequest
}

type OpenClawWeixinAccountDeleteOutput struct {
	Body OpenClawWeixinAccountDeleteResponse
}

type OpenClawWeixinAccountConfigOutput struct {
	Body OpenClawWeixinStatusResponse
}

type OpenClawChannelTaskStartOutput struct {
	Body OpenClawChannelTaskStartResponse
}

type OpenClawChannelTaskInput struct {
	ID string `path:"id" doc:"Channel setup task id." example:"weixin-20260513-153000"`
}

type OpenClawChannelTaskOutput struct {
	Body OpenClawChannelTaskResponse
}

type OpenClawWeixinScopeInput struct {
	Body OpenClawWeixinScopeRequest
}

type OpenClawWeixinStatusResponse struct {
	Status        string                          `json:"status" example:"ok" doc:"Operation status."`
	PluginID      string                          `json:"pluginId" example:"openclaw-weixin" doc:"OpenClaw plugin entry id."`
	Package       string                          `json:"package" example:"@tencent-weixin/openclaw-weixin" doc:"Official npm package name."`
	Installed     bool                            `json:"installed" example:"true" doc:"Whether the plugin appears installed from local files or install records."`
	Enabled       bool                            `json:"enabled" example:"true" doc:"Whether plugins.entries.openclaw-weixin.enabled is true."`
	DMScope       string                          `json:"dmScope" example:"per-account-channel-peer" doc:"Current session.dmScope value."`
	Config        *OpenClawWeixinConfigResponse   `json:"config,omitempty" doc:"Weixin channel config from channels.openclaw-weixin."`
	Accounts      []OpenClawWeixinAccountResponse `json:"accounts" doc:"Logged-in Weixin accounts discovered from plugin state. Sensitive tokens are never returned."`
	ConfigPath    string                          `json:"configPath,omitempty" doc:"OpenClaw config file path. Only returned after the plugin is installed."`
	StatePath     string                          `json:"statePath,omitempty" doc:"Expected OpenClaw Weixin runtime state path. Only returned after the plugin is installed."`
	Version       string                          `json:"version,omitempty" doc:"Installed package version when package.json is readable."`
	OpenClawHome  string                          `json:"openClawHome,omitempty" doc:"OpenClaw home directory. Only returned after the plugin is installed."`
	OpenClawError string                          `json:"openClawError,omitempty" doc:"OpenClaw CLI detection error."`
}

type OpenClawWeixinConfigResponse struct {
	Name                   string `json:"name,omitempty" doc:"Channel display name."`
	Enabled                bool   `json:"enabled" doc:"Whether channels.openclaw-weixin.enabled is not false."`
	CDNBaseURL             string `json:"cdnBaseUrl" doc:"CDN base URL used for media upload and download."`
	RouteTag               string `json:"routeTag,omitempty" doc:"Global SKRouteTag value."`
	BotAgent               string `json:"botAgent,omitempty" doc:"bot_agent identity sent in Weixin base_info."`
	ChannelConfigUpdatedAt string `json:"channelConfigUpdatedAt,omitempty" doc:"Automatic reload timestamp written after login."`
}

type OpenClawWeixinAccountResponse struct {
	AccountID  string `json:"accountId" example:"default" doc:"OpenClaw Weixin account id."`
	UserID     string `json:"userId,omitempty" doc:"Weixin user id reported by the plugin after QR login."`
	BaseURL    string `json:"baseUrl,omitempty" doc:"Weixin API base URL saved by the plugin."`
	SavedAt    string `json:"savedAt,omitempty" doc:"Credential save timestamp."`
	Name       string `json:"name,omitempty" doc:"Account display name from channels.openclaw-weixin.accounts."`
	Enabled    bool   `json:"enabled" doc:"Whether the account config is not false."`
	CDNBaseURL string `json:"cdnBaseUrl,omitempty" doc:"Per-account CDN base URL override."`
	RouteTag   string `json:"routeTag,omitempty" doc:"Per-account SKRouteTag override."`
	AgentID    string `json:"agentId,omitempty" doc:"Agent routed to this account."`
}

type OpenClawWeixinScopeRequest struct {
	Scope string `json:"scope" doc:"session.dmScope value. Use per-account-channel-peer for multi-account isolation." example:"per-account-channel-peer"`
}

type OpenClawWeixinConfigRequest struct {
	Name       *string `json:"name,omitempty" doc:"Channel display name. Empty string removes it."`
	Enabled    *bool   `json:"enabled,omitempty" doc:"Channel enabled switch. Also mirrors plugins.entries.openclaw-weixin.enabled."`
	CDNBaseURL *string `json:"cdnBaseUrl,omitempty" doc:"CDN base URL. Empty string restores default."`
	RouteTag   *string `json:"routeTag,omitempty" doc:"Global numeric SKRouteTag. Empty string removes it."`
	BotAgent   *string `json:"botAgent,omitempty" doc:"bot_agent identity. Empty string removes it."`
}

type OpenClawWeixinAccountDeleteResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-14T09:00:00Z" doc:"UTC response timestamp."`
	AccountID string `json:"accountId" doc:"Deleted Weixin account id."`
}

type OpenClawWeixinAccountConfigRequest struct {
	Name    *string `json:"name,omitempty" doc:"Account display name. Empty string removes it."`
	Enabled *bool   `json:"enabled,omitempty" doc:"Account enabled switch."`
	AgentID *string `json:"agentId,omitempty" doc:"Agent id routed to this account. Empty string removes binding."`
}

type OpenClawChannelTaskStartResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-14T09:00:00Z" doc:"UTC response timestamp."`
	TaskID    string `json:"taskId" doc:"Task id to poll."`
}

type OpenClawChannelTaskResponse struct {
	ID        string   `json:"id" doc:"Task id."`
	Status    string   `json:"status" example:"running" doc:"Task status: pending, running, done, or error."`
	Progress  int      `json:"progress" example:"60" doc:"Best-effort progress percentage."`
	Logs      []string `json:"logs" doc:"Terminal output and management messages."`
	StartedAt string   `json:"startedAt" doc:"Task start time."`
	UpdatedAt string   `json:"updatedAt" doc:"Task last update time."`
	Error     string   `json:"error,omitempty" doc:"Error message when status is error."`
}

type OpenClawWeixinScopeStreamInput struct {
	Scope string `query:"scope" enum:"main,per-peer,per-channel-peer,per-account-channel-peer" example:"per-account-channel-peer" doc:"session.dmScope value."`
}

type OpenClawChannelStreamMetaEvent struct {
	ID        string `json:"id" doc:"Stream task id."`
	Kind      string `json:"kind" doc:"Stream task kind."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type OpenClawChannelStreamStatusEvent struct {
	ID        string `json:"id" doc:"Stream task id."`
	Status    string `json:"status" example:"running" doc:"Task status: running, done, or error."`
	Progress  int    `json:"progress" example:"60" doc:"Best-effort progress percentage."`
	Error     string `json:"error,omitempty" doc:"Error message when status is error."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

func (event OpenClawChannelStreamStatusEvent) MarshalJSON() ([]byte, error) {
	if event.Error != "" {
		return []byte(fmt.Sprintf(`{"id":%s,"status":%s,"progress":%d,"error":%s,"timestamp":%s}`,
			quoteJSONString(event.ID),
			quoteJSONString(event.Status),
			event.Progress,
			quoteJSONString(event.Error),
			quoteJSONString(event.Timestamp),
		)), nil
	}
	return []byte(fmt.Sprintf(`{"id":%s,"status":%s,"progress":%d,"timestamp":%s}`,
		quoteJSONString(event.ID),
		quoteJSONString(event.Status),
		event.Progress,
		quoteJSONString(event.Timestamp),
	)), nil
}

type OpenClawChannelStreamLogEvent struct {
	ID        string `json:"id" doc:"Stream task id."`
	Line      string `json:"line" doc:"One command output or management log line."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

func (event OpenClawChannelStreamLogEvent) MarshalJSON() ([]byte, error) {
	return []byte(fmt.Sprintf(`{"id":%s,"line":%s,"timestamp":%s}`,
		quoteJSONString(event.ID),
		quoteJSONString(event.Line),
		quoteJSONString(event.Timestamp),
	)), nil
}

type OpenClawChannelStreamErrorEvent struct {
	ID        string `json:"id" doc:"Stream task id."`
	Message   string `json:"message" doc:"Error message."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

func (event OpenClawChannelStreamErrorEvent) MarshalJSON() ([]byte, error) {
	return []byte(fmt.Sprintf(`{"id":%s,"message":%s,"timestamp":%s}`,
		quoteJSONString(event.ID),
		quoteJSONString(event.Message),
		quoteJSONString(event.Timestamp),
	)), nil
}

func quoteJSONString(value string) string {
	var builder strings.Builder
	builder.Grow(len(value) + 2)
	builder.WriteByte('"')
	for _, r := range value {
		switch r {
		case '\\':
			builder.WriteString(`\\`)
		case '"':
			builder.WriteString(`\"`)
		case '\b':
			builder.WriteString(`\b`)
		case '\f':
			builder.WriteString(`\f`)
		case '\n':
			builder.WriteString(`\n`)
		case '\r':
			builder.WriteString(`\r`)
		case '\t':
			builder.WriteString(`\t`)
		default:
			if r < 0x20 || r > 0x7e {
				if r <= 0xffff {
					builder.WriteString(fmt.Sprintf(`\u%04x`, r))
				} else {
					r -= 0x10000
					builder.WriteString(fmt.Sprintf(`\u%04x\u%04x`, 0xd800+(r>>10), 0xdc00+(r&0x3ff)))
				}
				continue
			}
			builder.WriteRune(r)
		}
	}
	builder.WriteByte('"')
	return builder.String()
}

type OpenClawChannelStreamDoneEvent struct {
	ID        string `json:"id" doc:"Stream task id."`
	Timestamp string `json:"timestamp" doc:"UTC event timestamp."`
}

type openClawChannelTaskStore struct {
	mu    sync.Mutex
	tasks map[string]*openClawChannelTask
}

type openClawChannelTask struct {
	mu        sync.Mutex
	id        string
	status    string
	progress  int
	logs      []string
	qrFilter  logfilter.TerminalQRFilter
	startedAt time.Time
	updatedAt time.Time
	err       string
}

type openClawChannelStep struct {
	ignoreMissing bool
	label         string
	progress      int
	timeout       time.Duration
	args          []string
	run           func(context.Context, openClawChannelLogger) error
}

type openClawChannelLogger interface {
	addLog(string)
}

func GetOpenClawWeixinStatus(ctx context.Context, input *struct{}) (*OpenClawWeixinStatusOutput, error) {
	return &OpenClawWeixinStatusOutput{Body: detectOpenClawWeixinStatus(ctx)}, nil
}

func UpdateOpenClawWeixinConfig(ctx context.Context, input *OpenClawWeixinConfigInput) (*OpenClawWeixinConfigOutput, error) {
	_ = ctx
	if input == nil {
		return nil, huma.Error400BadRequest("weixin config request is required", nil)
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
	section := objectMap(channels[openClawWeixinChannelID])
	patch := input.Body

	if patch.Enabled != nil {
		section["enabled"] = *patch.Enabled
		plugins := objectMap(content["plugins"])
		entries := objectMap(plugins["entries"])
		entry := objectMap(entries[openClawWeixinChannelID])
		entry["enabled"] = *patch.Enabled
		entries[openClawWeixinChannelID] = entry
		plugins["entries"] = entries
		content["plugins"] = plugins
	}
	applyStringConfigField(section, "name", patch.Name)
	applyStringConfigField(section, "botAgent", patch.BotAgent)
	if patch.CDNBaseURL != nil {
		value := strings.TrimSpace(*patch.CDNBaseURL)
		if value == "" || value == openClawWeixinCDNBaseURL {
			delete(section, "cdnBaseUrl")
		} else {
			section["cdnBaseUrl"] = value
		}
	}
	if patch.RouteTag != nil {
		value := strings.TrimSpace(*patch.RouteTag)
		if value == "" {
			delete(section, "routeTag")
		} else {
			routeTag, parseErr := strconv.Atoi(value)
			if parseErr != nil {
				return nil, huma.Error400BadRequest("routeTag must be a number", parseErr)
			}
			section["routeTag"] = routeTag
		}
	}

	channels[openClawWeixinChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return nil, huma.Error500InternalServerError("write openclaw config failed", err)
	}
	invalidateOpenClawPluginsStatusCache()
	invalidateOpenClawEnvironmentCache()
	return &OpenClawWeixinConfigOutput{Body: detectOpenClawWeixinStatus(context.Background())}, nil
}

func DeleteOpenClawWeixinAccount(ctx context.Context, input *OpenClawWeixinAccountDeleteInput) (*OpenClawWeixinAccountDeleteOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("account id is required", nil)
	}
	accountID := strings.TrimSpace(input.AccountID)
	home := defaultOpenClawHomeDir()
	accountsDir := filepath.Join(home, openClawWeixinChannelID, "accounts")
	for _, suffix := range []string{".json", ".sync.json", ".context-tokens.json"} {
		if err := os.Remove(filepath.Join(accountsDir, accountID+suffix)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, huma.Error500InternalServerError("delete weixin account file failed", err)
		}
	}
	if err := removeOpenClawWeixinAccountFromIndex(home, accountID); err != nil {
		return nil, huma.Error500InternalServerError("update weixin account index failed", err)
	}
	if err := removeOpenClawWeixinAccountConfig(accountID); err != nil {
		return nil, huma.Error500InternalServerError("update weixin account config failed", err)
	}
	if err := setOpenClawWeixinAccountBinding(accountID, ""); err != nil {
		return nil, huma.Error500InternalServerError("update weixin account binding failed", err)
	}
	return &OpenClawWeixinAccountDeleteOutput{Body: OpenClawWeixinAccountDeleteResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AccountID: accountID,
	}}, nil
}

func UpdateOpenClawWeixinAccountConfig(ctx context.Context, input *OpenClawWeixinAccountConfigInput) (*OpenClawWeixinAccountConfigOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("account id is required", nil)
	}
	accountID := strings.TrimSpace(input.AccountID)
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
	section := objectMap(channels[openClawWeixinChannelID])
	accounts := objectMap(section["accounts"])
	accountCfg := objectMap(accounts[accountID])
	patch := input.Body
	applyStringConfigField(accountCfg, "name", patch.Name)
	if patch.Enabled != nil {
		accountCfg["enabled"] = *patch.Enabled
	}
	accounts[accountID] = accountCfg
	section["accounts"] = accounts
	channels[openClawWeixinChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return nil, huma.Error500InternalServerError("write openclaw config failed", err)
	}
	if patch.AgentID != nil {
		if err := setOpenClawWeixinAccountBinding(accountID, strings.TrimSpace(*patch.AgentID)); err != nil {
			return nil, huma.Error500InternalServerError("update weixin account binding failed", err)
		}
	}
	return &OpenClawWeixinAccountConfigOutput{Body: detectOpenClawWeixinStatus(context.Background())}, nil
}

func InstallOpenClawWeixinStream(ctx context.Context, input *struct{}, send sse.Sender) {
	streamOpenClawChannelSteps(ctx, send, "weixin-install", "install", []openClawChannelStep{
		{label: "检查 OpenClaw CLI", progress: 5, timeout: 10 * time.Second, args: []string{"--version"}},
		{label: "安装微信插件", progress: 25, timeout: 10 * time.Minute, args: []string{"plugins", "install", openClawWeixinPackage}},
		{label: "启用微信插件", progress: 55, timeout: 30 * time.Second, args: []string{"config", "set", "plugins.entries.openclaw-weixin.enabled", "true"}},
		{label: "写入微信渠道目录", progress: 70, run: ensureOpenClawWeixinCatalog},
		{label: "刷新插件注册表", progress: 80, timeout: 2 * time.Minute, args: []string{"plugins", "registry", "--refresh"}},
		{label: "重启 Gateway 加载微信插件", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
}

func LoginOpenClawWeixinStream(ctx context.Context, input *struct{}, send sse.Sender) {
	streamOpenClawChannelSteps(ctx, send, "weixin-login", "login", []openClawChannelStep{
		{label: "检查 OpenClaw CLI", progress: 5, timeout: 10 * time.Second, args: []string{"--version"}},
		{label: "检查微信插件安装状态", progress: 15, run: requireOpenClawWeixinInstalled},
		{label: "准备微信渠道目录", progress: 25, run: ensureOpenClawWeixinCatalog},
		{label: "刷新插件注册表", progress: 35, timeout: 2 * time.Minute, args: []string{"plugins", "registry", "--refresh"}},
		{label: "扫码登录微信", progress: 45, timeout: 10 * time.Minute, args: []string{"channels", "login", "--channel", openClawWeixinChannelID}},
		{label: "重启 Gateway 应用微信登录状态", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
}

func SetOpenClawWeixinDMScopeStream(ctx context.Context, input *OpenClawWeixinScopeStreamInput, send sse.Sender) {
	scope := "per-account-channel-peer"
	if input != nil && strings.TrimSpace(input.Scope) != "" {
		scope = strings.TrimSpace(input.Scope)
	}
	if !allowedWeixinDMScope(scope) {
		streamOpenClawChannelError(send, "weixin-scope", "scope", fmt.Errorf("unsupported scope %q", scope))
		return
	}
	streamOpenClawChannelSteps(ctx, send, "weixin-scope", "scope", []openClawChannelStep{
		{label: "设置微信多账号上下文隔离", progress: 30, timeout: 30 * time.Second, args: []string{"config", "set", "session.dmScope", scope}},
		{label: "重启 Gateway", progress: 82, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
}

func UninstallOpenClawWeixinStream(ctx context.Context, input *struct{}, send sse.Sender) {
	streamOpenClawChannelSteps(ctx, send, "weixin-uninstall", "uninstall", []openClawChannelStep{
		{label: "卸载微信插件", progress: 35, timeout: 5 * time.Minute, args: []string{"plugins", "uninstall", openClawWeixinChannelID}, ignoreMissing: true},
		{label: "清理微信插件配置残留", progress: 75, run: cleanupOpenClawWeixinConfig},
		{label: "清理微信渠道目录", progress: 85, run: removeOpenClawWeixinCatalog},
		{label: "刷新插件注册表", progress: 92, timeout: 2 * time.Minute, args: []string{"plugins", "registry", "--refresh"}, ignoreMissing: true},
	})
}

func InstallOpenClawWeixin(ctx context.Context, input *struct{}) (*OpenClawChannelTaskStartOutput, error) {
	task := openClawChannelTasks.create("weixin")
	go runOpenClawChannelSteps(context.Background(), task, []openClawChannelStep{
		{label: "检查 OpenClaw CLI", progress: 5, timeout: 10 * time.Second, args: []string{"--version"}},
		{label: "安装微信插件", progress: 20, timeout: 10 * time.Minute, args: []string{"plugins", "install", openClawWeixinPackage}},
		{label: "启用微信插件", progress: 45, timeout: 30 * time.Second, args: []string{"config", "set", "plugins.entries.openclaw-weixin.enabled", "true"}},
		{label: "写入微信渠道目录", progress: 70, run: ensureOpenClawWeixinCatalog},
		{label: "刷新插件注册表", progress: 82, timeout: 2 * time.Minute, args: []string{"plugins", "registry", "--refresh"}},
		{label: "重启 Gateway 加载微信插件", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
	return openClawChannelTaskStarted(task.id), nil
}

func LoginOpenClawWeixin(ctx context.Context, input *struct{}) (*OpenClawChannelTaskStartOutput, error) {
	task := openClawChannelTasks.create("weixin-login")
	go runOpenClawChannelSteps(context.Background(), task, []openClawChannelStep{
		{label: "检查 OpenClaw CLI", progress: 5, timeout: 10 * time.Second, args: []string{"--version"}},
		{label: "重启 Gateway 加载微信插件", progress: 20, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
		{label: "扫码登录微信", progress: 45, timeout: 10 * time.Minute, args: []string{"channels", "login", "--channel", openClawWeixinChannelID}},
		{label: "重启 Gateway 应用微信登录状态", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
	return openClawChannelTaskStarted(task.id), nil
}

func SetOpenClawWeixinDMScope(ctx context.Context, input *OpenClawWeixinScopeInput) (*OpenClawChannelTaskStartOutput, error) {
	scope := "per-account-channel-peer"
	if input != nil && strings.TrimSpace(input.Body.Scope) != "" {
		scope = strings.TrimSpace(input.Body.Scope)
	}
	if !allowedWeixinDMScope(scope) {
		return nil, huma.Error400BadRequest("unsupported session dmScope", fmt.Errorf("unsupported scope %q", scope))
	}
	task := openClawChannelTasks.create("weixin-scope")
	go runOpenClawChannelSteps(context.Background(), task, []openClawChannelStep{
		{label: "设置微信多账号上下文隔离", progress: 20, timeout: 30 * time.Second, args: []string{"config", "set", "session.dmScope", scope}},
		{label: "重启 Gateway", progress: 80, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
	return openClawChannelTaskStarted(task.id), nil
}

func UninstallOpenClawWeixin(ctx context.Context, input *struct{}) (*OpenClawChannelTaskStartOutput, error) {
	task := openClawChannelTasks.create("weixin-uninstall")
	go runOpenClawChannelSteps(context.Background(), task, []openClawChannelStep{
		{label: "移除微信渠道账户", progress: 20, timeout: 2 * time.Minute, args: []string{"channels", "remove", "--channel", openClawWeixinChannelID, "--delete"}, ignoreMissing: true},
		{label: "卸载微信插件", progress: 70, timeout: 5 * time.Minute, args: []string{"plugins", "uninstall", openClawWeixinChannelID}, ignoreMissing: true},
		{label: "清理微信插件配置残留", progress: 90, run: cleanupOpenClawWeixinConfig},
	})
	return openClawChannelTaskStarted(task.id), nil
}

func GetOpenClawChannelTask(ctx context.Context, input *OpenClawChannelTaskInput) (*OpenClawChannelTaskOutput, error) {
	if input == nil || strings.TrimSpace(input.ID) == "" {
		return nil, huma.Error400BadRequest("task id is required", nil)
	}
	task := openClawChannelTasks.get(strings.TrimSpace(input.ID))
	if task == nil {
		return nil, huma.Error404NotFound("channel task does not exist", nil)
	}
	return &OpenClawChannelTaskOutput{Body: task.snapshot()}, nil
}

func detectOpenClawWeixinStatus(ctx context.Context) OpenClawWeixinStatusResponse {
	_ = ctx
	home := defaultOpenClawHomeDir()
	configPath := openClawConfigPath()
	content, _, configErr := readOpenClawConfigFile(configPath)
	pluginEntry := objectMap(objectMap(objectMap(content["plugins"])["entries"])[openClawWeixinChannelID])
	weixinSection := objectMap(objectMap(content["channels"])[openClawWeixinChannelID])
	dmScope, _ := objectMap(content["session"])["dmScope"].(string)
	if strings.TrimSpace(dmScope) == "" {
		dmScope = "main"
	}

	installed := false
	version := ""
	for _, pkgPath := range openClawWeixinPackagePaths(home) {
		pkgVersion, exists := readPackageVersion(pkgPath)
		if exists {
			installed = true
			if version == "" {
				version = pkgVersion
			}
		}
	}

	cliError := ""
	if configErr != nil && !errors.Is(configErr, os.ErrNotExist) {
		cliError = strings.TrimSpace(strings.Join([]string{cliError, "openclaw config read failed: " + configErr.Error()}, "\n"))
	}

	response := OpenClawWeixinStatusResponse{
		Status:        "ok",
		PluginID:      openClawWeixinChannelID,
		Package:       openClawWeixinPackage,
		Installed:     installed,
		Enabled:       installed && boolFromMap(pluginEntry, "enabled"),
		DMScope:       dmScope,
		Accounts:      []OpenClawWeixinAccountResponse{},
		OpenClawError: cliError,
	}
	if installed {
		response.Config = openClawWeixinConfigFromSection(weixinSection)
		response.Accounts = readOpenClawWeixinAccounts(home, objectMap(weixinSection["accounts"]), readOpenClawWeixinAccountBindings(content))
		response.ConfigPath = configPath
		response.StatePath = filepath.Join(home, openClawWeixinChannelID)
		response.Version = version
		response.OpenClawHome = home
	}
	return response
}

func openClawWeixinConfigFromSection(section map[string]any) *OpenClawWeixinConfigResponse {
	return &OpenClawWeixinConfigResponse{
		Name:                   stringFromMap(section, "name"),
		Enabled:                !hasExplicitFalse(section, "enabled"),
		CDNBaseURL:             firstNonEmptyWeixinString(stringFromMap(section, "cdnBaseUrl"), openClawWeixinCDNBaseURL),
		RouteTag:               stringFromMap(section, "routeTag"),
		BotAgent:               stringFromMap(section, "botAgent"),
		ChannelConfigUpdatedAt: stringFromMap(section, "channelConfigUpdatedAt"),
	}
}

type openClawChannelStreamRun struct {
	id       string
	kind     string
	send     sse.Sender
	qrFilter logfilter.TerminalQRFilter
}

func streamOpenClawChannelSteps(ctx context.Context, send sse.Sender, prefix string, kind string, steps []openClawChannelStep) {
	id := prefix + "-" + time.Now().UTC().Format("20060102-150405")
	run := openClawChannelStreamRun{id: id, kind: kind, send: send}
	if !run.emitMeta() {
		return
	}
	if !run.emitLog("任务已创建。") || !run.emitStatus("running", 1, "") {
		return
	}
	for _, step := range steps {
		if !run.emitLog("==> "+step.label) || !run.emitStatus("running", step.progress, "") {
			return
		}
		if step.run != nil {
			if err := step.run(ctx, streamTaskAdapter{run: &run, progress: step.progress}); err != nil {
				run.fail(err)
				return
			}
			continue
		}
		if openClawChannelStepIsGatewayRestart(step) && openClawRunningInContainer() {
			if err := restartOpenClawGatewayProcessForChannel(ctx, streamTaskAdapter{run: &run, progress: step.progress}); err != nil {
				run.fail(err)
				return
			}
			continue
		}
		stdout, stderr, err := runOpenClawStreamingCommandTo(ctx, step.timeout, run.emitCommandOutput, step.args...)
		if err != nil {
			if step.ignoreMissing && openClawChannelMissingOutput(stdout, stderr, err) {
				if !run.emitLog("目标不存在，视为已清理。") {
					return
				}
				continue
			}
			run.fail(err)
			return
		}
	}
	invalidateOpenClawPluginsStatusCache()
	invalidateOpenClawEnvironmentCache()
	_ = run.emitStatus("done", 100, "")
	_ = send.Data(OpenClawChannelStreamDoneEvent{ID: id, Timestamp: time.Now().UTC().Format(time.RFC3339)})
}

func streamOpenClawChannelError(send sse.Sender, prefix string, kind string, err error) {
	id := prefix + "-" + time.Now().UTC().Format("20060102-150405")
	run := openClawChannelStreamRun{id: id, kind: kind, send: send}
	if !run.emitMeta() {
		return
	}
	run.fail(err)
}

func (run *openClawChannelStreamRun) emitMeta() bool {
	return run.send.Data(OpenClawChannelStreamMetaEvent{
		ID:        run.id,
		Kind:      run.kind,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}) == nil
}

func (run *openClawChannelStreamRun) emitStatus(status string, progress int, errorMessage string) bool {
	return run.send.Data(OpenClawChannelStreamStatusEvent{
		ID:        run.id,
		Status:    status,
		Progress:  progress,
		Error:     errorMessage,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}) == nil
}

func (run *openClawChannelStreamRun) emitLog(value string) bool {
	for _, line := range strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n") {
		line = strings.TrimRight(line, "\r\n")
		if line == "" || !run.qrFilter.AllowLine(line) {
			continue
		}
		if err := run.send.Data(OpenClawChannelStreamLogEvent{
			ID:        run.id,
			Line:      line,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}); err != nil {
			return false
		}
	}
	return true
}

func (run *openClawChannelStreamRun) emitCommandOutput(value string) {
	_ = run.emitLog(value)
}

func (run *openClawChannelStreamRun) fail(err error) {
	message := err.Error()
	_ = run.emitLog("失败：" + message)
	_ = run.emitStatus("error", 100, message)
	_ = run.send.Data(OpenClawChannelStreamErrorEvent{
		ID:        run.id,
		Message:   message,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	})
}

type streamTaskAdapter struct {
	run      *openClawChannelStreamRun
	progress int
}

func (adapter streamTaskAdapter) addLog(value string) {
	if adapter.run != nil {
		adapter.run.emitLog(value)
	}
}

func runOpenClawChannelSteps(ctx context.Context, task *openClawChannelTask, steps []openClawChannelStep) {
	task.setStatus("running", 1)
	for _, step := range steps {
		task.addLog("==> " + step.label)
		task.setProgress(step.progress)
		if step.run != nil {
			if err := step.run(ctx, task); err != nil {
				task.fail(err)
				return
			}
			continue
		}
		if openClawChannelStepIsGatewayRestart(step) && openClawRunningInContainer() {
			if err := restartOpenClawGatewayProcessForChannel(ctx, task); err != nil {
				task.fail(err)
				return
			}
			continue
		}
		stdout, stderr, err := runOpenClawStreamingCommand(ctx, step.timeout, task, step.args...)
		if err != nil {
			if step.ignoreMissing && openClawChannelMissingOutput(stdout, stderr, err) {
				task.addLog("目标不存在，视为已清理。")
				continue
			}
			task.fail(err)
			return
		}
	}
	invalidateOpenClawPluginsStatusCache()
	invalidateOpenClawEnvironmentCache()
	task.done()
}

func runOpenClawStreamingCommand(ctx context.Context, timeout time.Duration, task *openClawChannelTask, args ...string) (string, string, error) {
	return runOpenClawStreamingCommandTo(ctx, timeout, task.addCommandOutput, args...)
}

func runOpenClawStreamingCommandTo(ctx context.Context, timeout time.Duration, writeOutput func(string), args ...string) (string, string, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	path := toolenv.ResolveToolPath("openclaw")
	if path == "" {
		path = "openclaw"
	}
	cmd := exec.CommandContext(cmdCtx, path, args...)
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
		return stdout.String(), stderr.String(), cmdCtx.Err()
	}
	return stdout.String(), stderr.String(), err
}

func openClawChannelStepIsGatewayRestart(step openClawChannelStep) bool {
	return len(step.args) == 2 && step.args[0] == "gateway" && step.args[1] == "restart"
}

func restartOpenClawGatewayProcessForChannel(ctx context.Context, task openClawChannelLogger) error {
	return restartOpenClawGatewayProcessInContainer(ctx, detectOpenClawEnvironment(ctx), task.addLog)
}

func openClawChannelMissingOutput(stdout string, stderr string, err error) bool {
	combined := strings.ToLower(strings.TrimSpace(strings.Join([]string{stdout, stderr, err.Error()}, "\n")))
	if openClawCommandBlockedByConfig(stdout, stderr, err) {
		return false
	}
	return strings.Contains(combined, "not found") ||
		strings.Contains(combined, "not installed") ||
		strings.Contains(combined, "unknown channel") ||
		strings.Contains(combined, "does not exist") ||
		strings.Contains(combined, "未找到") ||
		strings.Contains(combined, "未安装") ||
		strings.Contains(combined, "不存在")
}

func openClawCommandBlockedByConfig(stdout string, stderr string, err error) bool {
	combined := strings.ToLower(strings.TrimSpace(strings.Join([]string{stdout, stderr, err.Error()}, "\n")))
	return strings.Contains(combined, "config invalid") ||
		strings.Contains(combined, "validation failed") ||
		strings.Contains(combined, "run: openclaw doctor --fix")
}

func cleanupOpenClawWeixinConfig(ctx context.Context, task openClawChannelLogger) error {
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
	if _, ok := entries[openClawWeixinChannelID]; ok {
		delete(entries, openClawWeixinChannelID)
		plugins["entries"] = entries
		changed = true
	}
	installs := objectMap(plugins["installs"])
	if _, ok := installs[openClawWeixinChannelID]; ok {
		delete(installs, openClawWeixinChannelID)
		plugins["installs"] = installs
		changed = true
	}
	channels := objectMap(content["channels"])
	if _, ok := channels[openClawWeixinChannelID]; ok {
		delete(channels, openClawWeixinChannelID)
		content["channels"] = channels
		changed = true
	}
	if changed {
		content["plugins"] = plugins
		if writeErr := writeOpenClawConfigContent(configPath, content); writeErr != nil {
			return writeErr
		}
		task.addLog("已清理微信插件配置残留。")
	} else {
		task.addLog("没有发现微信插件配置残留。")
	}

	return nil
}

func writeOpenClawConfigContent(configPath string, content map[string]any) error {
	formatted, err := json.MarshalIndent(content, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		return err
	}
	return os.WriteFile(configPath, append(formatted, '\n'), 0o600)
}

func applyStringConfigField(section map[string]any, key string, value *string) {
	if value == nil {
		return
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		delete(section, key)
		return
	}
	section[key] = trimmed
}

func firstNonEmptyWeixinString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func hasExplicitFalse(values map[string]any, key string) bool {
	if values == nil {
		return false
	}
	value, ok := values[key]
	if !ok || value == nil {
		return false
	}
	if typed, ok := value.(bool); ok {
		return !typed
	}
	return strings.EqualFold(strings.TrimSpace(fmt.Sprint(value)), "false")
}

func removeOpenClawWeixinAccountFromIndex(home string, accountID string) error {
	indexPath := filepath.Join(home, openClawWeixinChannelID, "accounts.json")
	data, err := os.ReadFile(indexPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	var ids []string
	if err := json.Unmarshal(data, &ids); err != nil {
		return err
	}
	next := make([]string, 0, len(ids))
	for _, id := range ids {
		if strings.TrimSpace(id) != accountID {
			next = append(next, id)
		}
	}
	formatted, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(indexPath, append(formatted, '\n'), 0o600)
}

func removeOpenClawWeixinAccountConfig(accountID string) error {
	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawWeixinChannelID])
	accounts := objectMap(section["accounts"])
	if _, ok := accounts[accountID]; !ok {
		return nil
	}
	delete(accounts, accountID)
	if len(accounts) == 0 {
		delete(section, "accounts")
	} else {
		section["accounts"] = accounts
	}
	channels[openClawWeixinChannelID] = section
	content["channels"] = channels
	return writeOpenClawConfigContent(configPath, content)
}

func readOpenClawWeixinAccountBindings(content map[string]any) map[string]string {
	result := map[string]string{}
	raw, _ := content["bindings"].([]any)
	for _, value := range raw {
		item, ok := value.(map[string]any)
		if !ok {
			continue
		}
		match := objectMap(item["match"])
		if stringFromMap(match, "channel") != openClawWeixinChannelID {
			continue
		}
		accountID := stringFromMap(match, "accountId")
		if accountID == "" {
			continue
		}
		result[accountID] = normalizeOpenClawAgentID(stringFromMap(item, "agentId"))
	}
	return result
}

func setOpenClawWeixinAccountBinding(accountID string, agentID string) error {
	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			content = map[string]any{}
		} else {
			return err
		}
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
		if stringFromMap(match, "channel") == openClawWeixinChannelID && stringFromMap(match, "accountId") == accountID {
			continue
		}
		next = append(next, value)
	}
	if agentID != "" {
		next = append(next, map[string]any{
			"type":    "route",
			"agentId": agentID,
			"match": map[string]any{
				"channel":   openClawWeixinChannelID,
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

func requireOpenClawWeixinInstalled(ctx context.Context, task openClawChannelLogger) error {
	status := detectOpenClawWeixinStatus(ctx)
	if !status.Installed {
		return fmt.Errorf("微信插件未安装，请先执行安装插件")
	}
	if !status.Enabled {
		task.addLog("微信插件已安装但未启用，正在启用。")
		_, _, err := runOpenClawStreamingCommandTo(ctx, 30*time.Second, task.addLog, "config", "set", "plugins.entries.openclaw-weixin.enabled", "true")
		return err
	}
	task.addLog("微信插件已安装。")
	return nil
}

func ensureOpenClawWeixinCatalog(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	status := detectOpenClawWeixinStatus(context.Background())
	if !status.Installed {
		return fmt.Errorf("微信插件未安装，无法写入渠道目录")
	}
	catalogPath := openClawWeixinCatalogPath()
	if err := os.MkdirAll(filepath.Dir(catalogPath), 0o700); err != nil {
		return err
	}
	version := status.Version
	if strings.TrimSpace(version) == "" {
		version = "2.0.0"
	}
	payload := map[string]any{
		"entries": []any{
			map[string]any{
				"name":        openClawWeixinPackage,
				"version":     version,
				"description": "OpenClaw Weixin channel",
				"openclaw": map[string]any{
					"plugin": map[string]any{"id": openClawWeixinChannelID},
					"channel": map[string]any{
						"id":             openClawWeixinChannelID,
						"label":          "openclaw-weixin",
						"selectionLabel": "openclaw-weixin",
						"docsPath":       "/channels/openclaw-weixin",
						"docsLabel":      "openclaw-weixin",
						"blurb":          "Weixin channel",
						"order":          75,
					},
					"install": map[string]any{
						"npmSpec":        openClawWeixinPackage,
						"defaultChoice":  "npm",
						"minHostVersion": ">=2026.3.22",
					},
				},
			},
		},
	}
	formatted, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(catalogPath, append(formatted, '\n'), 0o600); err != nil {
		return err
	}
	task.addLog("已写入微信渠道目录：" + catalogPath)
	return nil
}

func removeOpenClawWeixinCatalog(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	catalogPath := openClawWeixinCatalogPath()
	err := os.Remove(catalogPath)
	if err == nil {
		task.addLog("已清理微信渠道目录：" + catalogPath)
		return nil
	}
	if errors.Is(err, os.ErrNotExist) {
		task.addLog("微信渠道目录不存在，无需清理。")
		return nil
	}
	return err
}

type taskWriter struct {
	write func(string)
}

func (writer taskWriter) Write(data []byte) (int, error) {
	if writer.write != nil {
		writer.write(string(data))
	}
	return len(data), nil
}

func newOpenClawChannelTaskStore() *openClawChannelTaskStore {
	return &openClawChannelTaskStore{tasks: map[string]*openClawChannelTask{}}
}

func (store *openClawChannelTaskStore) create(prefix string) *openClawChannelTask {
	now := time.Now().UTC()
	task := &openClawChannelTask{
		id:        prefix + "-" + now.Format("20060102-150405"),
		status:    "pending",
		progress:  0,
		logs:      []string{"任务已创建。"},
		startedAt: now,
		updatedAt: now,
	}
	store.mu.Lock()
	store.tasks[task.id] = task
	store.mu.Unlock()
	return task
}

func (store *openClawChannelTaskStore) get(id string) *openClawChannelTask {
	store.mu.Lock()
	defer store.mu.Unlock()
	return store.tasks[id]
}

func (task *openClawChannelTask) snapshot() OpenClawChannelTaskResponse {
	task.mu.Lock()
	defer task.mu.Unlock()
	logs := append([]string(nil), task.logs...)
	return OpenClawChannelTaskResponse{
		ID:        task.id,
		Status:    task.status,
		Progress:  task.progress,
		Logs:      logs,
		StartedAt: task.startedAt.Format(time.RFC3339),
		UpdatedAt: task.updatedAt.Format(time.RFC3339),
		Error:     task.err,
	}
}

func (task *openClawChannelTask) addCommandOutput(value string) {
	task.addLog(value)
}

func (task *openClawChannelTask) addLog(value string) {
	task.mu.Lock()
	defer task.mu.Unlock()
	changed := false
	for _, line := range strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n") {
		line = strings.TrimRight(line, "\r\n")
		if line == "" || !task.qrFilter.AllowLine(line) {
			continue
		}
		task.logs = append(task.logs, line)
		changed = true
	}
	if changed {
		if len(task.logs) > 240 {
			task.logs = task.logs[len(task.logs)-240:]
		}
		task.updatedAt = time.Now().UTC()
	}
}

func (task *openClawChannelTask) setStatus(status string, progress int) {
	task.mu.Lock()
	defer task.mu.Unlock()
	task.status = status
	task.progress = progress
	task.updatedAt = time.Now().UTC()
}

func (task *openClawChannelTask) setProgress(progress int) {
	task.mu.Lock()
	defer task.mu.Unlock()
	if progress > task.progress {
		task.progress = progress
	}
	task.updatedAt = time.Now().UTC()
}

func (task *openClawChannelTask) fail(err error) {
	task.mu.Lock()
	defer task.mu.Unlock()
	task.status = "error"
	task.err = err.Error()
	task.logs = append(task.logs, "失败："+err.Error())
	task.updatedAt = time.Now().UTC()
}

func (task *openClawChannelTask) done() {
	task.mu.Lock()
	defer task.mu.Unlock()
	task.status = "done"
	task.progress = 100
	task.logs = append(task.logs, "任务完成。")
	task.updatedAt = time.Now().UTC()
}

func openClawChannelTaskStarted(taskID string) *OpenClawChannelTaskStartOutput {
	return &OpenClawChannelTaskStartOutput{Body: OpenClawChannelTaskStartResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		TaskID:    taskID,
	}}
}

func openClawWeixinPackagePaths(home string) []string {
	paths := []string{
		filepath.Join(home, "extensions", openClawWeixinChannelID, "package.json"),
		filepath.Join(home, "node_modules", "@tencent-weixin", "openclaw-weixin", "package.json"),
		filepath.Join(home, "npm", "node_modules", "@tencent-weixin", "openclaw-weixin", "package.json"),
	}
	if installPath := openClawWeixinInstallRecordPath(home); installPath != "" {
		paths = append(paths, filepath.Join(installPath, "package.json"))
	}
	return paths
}

func readOpenClawWeixinAccounts(home string, accountConfigs map[string]any, bindings map[string]string) []OpenClawWeixinAccountResponse {
	ids := readOpenClawWeixinAccountIDs(home)
	seen := map[string]bool{}
	accounts := make([]OpenClawWeixinAccountResponse, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		account := readOpenClawWeixinAccount(home, id)
		if account.AccountID == "" {
			account.AccountID = id
		}
		applyOpenClawWeixinAccountConfig(&account, objectMap(accountConfigs[id]))
		account.AgentID = strings.TrimSpace(bindings[id])
		accounts = append(accounts, account)
	}
	return accounts
}

func readOpenClawWeixinAccountIDs(home string) []string {
	indexPath := filepath.Join(home, openClawWeixinChannelID, "accounts.json")
	data, err := os.ReadFile(indexPath)
	if err == nil {
		var ids []string
		if json.Unmarshal(data, &ids) == nil {
			return ids
		}
	}

	accountsDir := filepath.Join(home, openClawWeixinChannelID, "accounts")
	entries, err := os.ReadDir(accountsDir)
	if err != nil {
		return nil
	}
	ids := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".json") ||
			strings.HasSuffix(name, ".sync.json") ||
			strings.HasSuffix(name, ".context-tokens.json") {
			continue
		}
		ids = append(ids, strings.TrimSuffix(name, ".json"))
	}
	return ids
}

func readOpenClawWeixinAccount(home string, accountID string) OpenClawWeixinAccountResponse {
	data, err := os.ReadFile(filepath.Join(home, openClawWeixinChannelID, "accounts", accountID+".json"))
	if err != nil {
		return OpenClawWeixinAccountResponse{AccountID: accountID}
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		return OpenClawWeixinAccountResponse{AccountID: accountID}
	}
	return OpenClawWeixinAccountResponse{
		AccountID: accountID,
		UserID:    stringFromMap(payload, "userId"),
		BaseURL:   stringFromMap(payload, "baseUrl"),
		SavedAt:   stringFromMap(payload, "savedAt"),
		Enabled:   true,
	}
}

func applyOpenClawWeixinAccountConfig(account *OpenClawWeixinAccountResponse, cfg map[string]any) {
	if account == nil {
		return
	}
	account.Name = stringFromMap(cfg, "name")
	account.Enabled = !hasExplicitFalse(cfg, "enabled")
	account.CDNBaseURL = stringFromMap(cfg, "cdnBaseUrl")
	account.RouteTag = stringFromMap(cfg, "routeTag")
}

func openClawWeixinCatalogPath() string {
	return filepath.Join(defaultOpenClawHomeDir(), "plugins", "catalog.json")
}

func openClawWeixinInstallRecordPath(home string) string {
	data, err := os.ReadFile(filepath.Join(home, "plugins", "installs.json"))
	if err != nil {
		return ""
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		return ""
	}
	records := objectMap(payload["installRecords"])
	record := objectMap(records[openClawWeixinChannelID])
	return strings.TrimSpace(stringFromMap(record, "installPath"))
}

func readPackageVersion(path string) (string, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", false
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		return "", true
	}
	return stringFromMap(payload, "version"), true
}

func allowedWeixinDMScope(scope string) bool {
	switch scope {
	case "main", "per-peer", "per-channel-peer", "per-account-channel-peer":
		return true
	default:
		return false
	}
}
