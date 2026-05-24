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
	openClawYuanbaoChannelID = "yuanbao"
	openClawYuanbaoPluginID  = "openclaw-plugin-yuanbao"
	openClawYuanbaoPackage   = "openclaw-plugin-yuanbao@latest"
)

type OpenClawYuanbaoStatusOutput struct {
	Body OpenClawYuanbaoStatusResponse
}

type OpenClawYuanbaoConfigInput struct {
	Body OpenClawYuanbaoConfigRequest
}

type OpenClawYuanbaoConfigOutput struct {
	Body OpenClawYuanbaoStatusResponse
}

type OpenClawYuanbaoAccountConfigInput struct {
	AccountID string `path:"accountId" doc:"Yuanbao account id." example:"default"`
	Body      OpenClawYuanbaoAccountConfigRequest
}

type OpenClawYuanbaoAccountConfigOutput struct {
	Body OpenClawYuanbaoStatusResponse
}

type OpenClawYuanbaoAccountDeleteInput struct {
	AccountID string `path:"accountId" doc:"Yuanbao account id." example:"default"`
}

type OpenClawYuanbaoAccountDeleteOutput struct {
	Body OpenClawYuanbaoAccountDeleteResponse
}

type OpenClawYuanbaoAddStreamInput struct {
	AccountID    string `query:"accountId" doc:"Yuanbao account id. Empty uses default." example:"default"`
	Name         string `query:"name" doc:"Optional account display name."`
	AppID        string `query:"appId" doc:"Yuanbao AppID."`
	AppSecret    string `query:"appSecret" doc:"Yuanbao AppSecret."`
	AgentID      string `query:"agentId" doc:"Agent id routed to this account."`
	SystemPrompt string `query:"systemPrompt" doc:"Optional account system prompt."`
}

type OpenClawYuanbaoStatusResponse struct {
	Status       string                           `json:"status" example:"ok" doc:"Operation status."`
	ChannelID    string                           `json:"channelId" example:"yuanbao" doc:"OpenClaw channel id."`
	Package      string                           `json:"package" example:"openclaw-plugin-yuanbao@latest" doc:"Official npm package name."`
	Installed    bool                             `json:"installed" example:"true" doc:"Whether Yuanbao plugin appears available from local install records or config."`
	Configured   bool                             `json:"configured" example:"true" doc:"Whether Yuanbao credentials are configured."`
	Enabled      bool                             `json:"enabled" example:"true" doc:"Whether channels.yuanbao.enabled is true."`
	Config       OpenClawYuanbaoConfigResponse    `json:"config" doc:"Yuanbao channel config without secrets."`
	Accounts     []OpenClawYuanbaoAccountResponse `json:"accounts" doc:"Configured Yuanbao accounts without secrets."`
	ConfigPath   string                           `json:"configPath,omitempty" doc:"OpenClaw config path."`
	OpenClawHome string                           `json:"openClawHome,omitempty" doc:"OpenClaw home directory."`
	Version      string                           `json:"version,omitempty" doc:"Installed package version when readable."`
	Error        string                           `json:"error,omitempty" doc:"Config read error."`
}

type OpenClawYuanbaoConfigResponse struct {
	Enabled        bool   `json:"enabled" doc:"Whether channels.yuanbao.enabled is true."`
	Name           string `json:"name,omitempty" doc:"Channel display name."`
	AccountCount   int    `json:"accountCount" doc:"Configured account count."`
	SystemPrompt   string `json:"systemPrompt,omitempty" doc:"Top-level system prompt."`
	DefaultAccount string `json:"defaultAccount,omitempty" doc:"Default Yuanbao account id."`
}

type OpenClawYuanbaoAccountResponse struct {
	AccountID           string `json:"accountId" example:"default" doc:"Yuanbao account id."`
	Name                string `json:"name,omitempty" doc:"Account display name."`
	Enabled             bool   `json:"enabled" doc:"Whether this account is enabled."`
	AppIDConfigured     bool   `json:"appIdConfigured" doc:"Whether appId is configured."`
	AppSecretConfigured bool   `json:"appSecretConfigured" doc:"Whether appSecret is configured."`
	SystemPrompt        string `json:"systemPrompt,omitempty" doc:"Account system prompt."`
	AgentID             string `json:"agentId,omitempty" doc:"Agent routed to this account."`
}

type OpenClawYuanbaoConfigRequest struct {
	Enabled        *bool   `json:"enabled,omitempty" doc:"Yuanbao channel enabled switch."`
	Name           *string `json:"name,omitempty" doc:"Channel display name. Empty string removes it."`
	SystemPrompt   *string `json:"systemPrompt,omitempty" doc:"Top-level system prompt. Empty string removes it."`
	DefaultAccount *string `json:"defaultAccount,omitempty" doc:"Default Yuanbao account id. Empty string removes it."`
}

type OpenClawYuanbaoAccountConfigRequest struct {
	Enabled      *bool   `json:"enabled,omitempty" doc:"Account enabled switch."`
	Name         *string `json:"name,omitempty" doc:"Account display name. Empty string removes it."`
	AppID        *string `json:"appId,omitempty" doc:"New Yuanbao AppID. Empty string is ignored."`
	AppSecret    *string `json:"appSecret,omitempty" doc:"New Yuanbao AppSecret. Empty string is ignored."`
	SystemPrompt *string `json:"systemPrompt,omitempty" doc:"Account system prompt. Empty string removes it."`
	AgentID      *string `json:"agentId,omitempty" doc:"Agent id routed to this account. Empty string removes binding."`
}

type OpenClawYuanbaoAccountDeleteResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-14T09:00:00Z" doc:"UTC response timestamp."`
	AccountID string `json:"accountId" doc:"Deleted Yuanbao account id."`
}

func GetOpenClawYuanbaoStatus(ctx context.Context, input *struct{}) (*OpenClawYuanbaoStatusOutput, error) {
	_ = ctx
	return &OpenClawYuanbaoStatusOutput{Body: detectOpenClawYuanbaoStatus()}, nil
}

func UpdateOpenClawYuanbaoConfig(ctx context.Context, input *OpenClawYuanbaoConfigInput) (*OpenClawYuanbaoConfigOutput, error) {
	_ = ctx
	if input == nil {
		return nil, huma.Error400BadRequest("yuanbao config request is required", nil)
	}
	content, err := readOpenClawYuanbaoConfig()
	if err != nil {
		return nil, huma.Error500InternalServerError("read openclaw config failed", err)
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawYuanbaoChannelID])
	patch := input.Body
	if patch.Enabled != nil {
		section["enabled"] = *patch.Enabled
	}
	applyStringConfigField(section, "name", patch.Name)
	applyStringConfigField(section, "systemPrompt", patch.SystemPrompt)
	applyStringConfigField(section, "defaultAccount", patch.DefaultAccount)
	channels[openClawYuanbaoChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(openClawConfigPath(), content); err != nil {
		return nil, huma.Error500InternalServerError("write openclaw config failed", err)
	}
	invalidateOpenClawEnvironmentCache()
	return &OpenClawYuanbaoConfigOutput{Body: detectOpenClawYuanbaoStatus()}, nil
}

func UpdateOpenClawYuanbaoAccountConfig(ctx context.Context, input *OpenClawYuanbaoAccountConfigInput) (*OpenClawYuanbaoAccountConfigOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("account id is required", nil)
	}
	if err := patchOpenClawYuanbaoAccount(strings.TrimSpace(input.AccountID), input.Body); err != nil {
		return nil, huma.Error500InternalServerError("update yuanbao account config failed", err)
	}
	return &OpenClawYuanbaoAccountConfigOutput{Body: detectOpenClawYuanbaoStatus()}, nil
}

func DeleteOpenClawYuanbaoAccount(ctx context.Context, input *OpenClawYuanbaoAccountDeleteInput) (*OpenClawYuanbaoAccountDeleteOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("account id is required", nil)
	}
	accountID := strings.TrimSpace(input.AccountID)
	if err := removeOpenClawYuanbaoAccount(accountID); err != nil {
		return nil, huma.Error500InternalServerError("delete yuanbao account failed", err)
	}
	if err := setOpenClawChannelAccountBinding(openClawYuanbaoChannelID, accountID, ""); err != nil {
		return nil, huma.Error500InternalServerError("update yuanbao account binding failed", err)
	}
	return &OpenClawYuanbaoAccountDeleteOutput{Body: OpenClawYuanbaoAccountDeleteResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AccountID: accountID,
	}}, nil
}

func AddOpenClawYuanbaoAccountStream(ctx context.Context, input *OpenClawYuanbaoAddStreamInput, send sse.Sender) {
	if input == nil {
		streamOpenClawChannelError(send, "yuanbao-add", "add", fmt.Errorf("yuanbao account request is required"))
		return
	}
	accountID := strings.TrimSpace(input.AccountID)
	if accountID == "" {
		accountID = "default"
	}
	appID := strings.TrimSpace(input.AppID)
	appSecret := strings.TrimSpace(input.AppSecret)
	if appID == "" || appSecret == "" {
		streamOpenClawChannelError(send, "yuanbao-add", "add", fmt.Errorf("AppID 和 AppSecret 不能为空"))
		return
	}
	token := appID + ":" + appSecret
	streamOpenClawChannelSteps(ctx, send, "yuanbao-add", "add", []openClawChannelStep{
		{label: "检查 OpenClaw CLI", progress: 5, timeout: 10 * time.Second, args: []string{"--version"}},
		{label: "检查元宝插件安装状态", progress: 18, run: requireOpenClawYuanbaoInstalled},
		{label: "添加元宝账号", progress: 44, timeout: 5 * time.Minute, args: []string{"channels", "add", "--channel", openClawYuanbaoChannelID, "--account", accountID, "--token", token}},
		{label: "写入元宝账号配置", progress: 74, run: func(ctx context.Context, task openClawChannelLogger) error {
			_ = ctx
			err := patchOpenClawYuanbaoAccount(accountID, OpenClawYuanbaoAccountConfigRequest{
				Enabled:      boolPtr(true),
				Name:         stringPtr(input.Name),
				AppID:        stringPtr(appID),
				AppSecret:    stringPtr(appSecret),
				SystemPrompt: stringPtr(input.SystemPrompt),
				AgentID:      stringPtr(input.AgentID),
			})
			if err != nil {
				return err
			}
			task.addLog("已写入元宝账号配置。")
			return nil
		}},
		{label: "重启 Gateway 应用元宝配置", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
}

func InstallOpenClawYuanbaoStream(ctx context.Context, input *struct{}, send sse.Sender) {
	streamOpenClawChannelSteps(ctx, send, "yuanbao-install", "install", []openClawChannelStep{
		{label: "检查 OpenClaw CLI", progress: 5, timeout: 10 * time.Second, args: []string{"--version"}},
		{label: "安装元宝龙虾插件", progress: 35, timeout: 10 * time.Minute, run: installOpenClawYuanbaoPlugin},
		{label: "刷新插件注册表", progress: 78, timeout: 2 * time.Minute, args: []string{"plugins", "registry", "--refresh"}, ignoreMissing: true},
		{label: "重启 Gateway 加载元宝插件", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}, ignoreMissing: true},
	})
}

func UninstallOpenClawYuanbaoStream(ctx context.Context, input *struct{}, send sse.Sender) {
	streamOpenClawChannelSteps(ctx, send, "yuanbao-uninstall", "uninstall", []openClawChannelStep{
		{label: "清理元宝配置残留", progress: 20, run: cleanupOpenClawYuanbaoConfig},
		{label: "调用 OpenClaw 卸载元宝插件", progress: 46, run: uninstallOpenClawYuanbaoPluginBestEffort},
		{label: "清理元宝插件安装残留", progress: 78, run: cleanupOpenClawYuanbaoInstallArtifacts},
		{label: "刷新插件注册表", progress: 94, run: refreshOpenClawYuanbaoRegistryBestEffort},
	})
}

func requireOpenClawYuanbaoInstalled(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	if detectOpenClawYuanbaoStatus().Installed {
		task.addLog("元宝插件已安装。")
		return nil
	}
	return fmt.Errorf("元宝插件未安装，请先安装插件")
}

func detectOpenClawYuanbaoStatus() OpenClawYuanbaoStatusResponse {
	home := defaultOpenClawHomeDir()
	configPath := openClawConfigPath()
	content, exists, configErr := readOpenClawConfigFile(configPath)
	section := objectMap(objectMap(content["channels"])[openClawYuanbaoChannelID])
	configured := openClawYuanbaoConfigured(section)
	version := ""
	installed := configured
	for _, pkgPath := range openClawYuanbaoPackagePaths(home) {
		pkgVersion, ok := readPackageVersion(pkgPath)
		if ok {
			installed = true
			if version == "" {
				version = pkgVersion
			}
		}
	}
	enabled := configured && !hasExplicitFalse(section, "enabled")
	response := OpenClawYuanbaoStatusResponse{
		Status:     "ok",
		ChannelID:  openClawYuanbaoChannelID,
		Package:    openClawYuanbaoPackage,
		Installed:  installed,
		Configured: configured,
		Enabled:    enabled,
		Config:     openClawYuanbaoConfigFromSection(section),
		Accounts:   []OpenClawYuanbaoAccountResponse{},
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
		response.Accounts = readOpenClawYuanbaoAccounts(section, readOpenClawChannelAccountBindings(content, openClawYuanbaoChannelID))
	}
	return response
}

func openClawYuanbaoConfigFromSection(section map[string]any) OpenClawYuanbaoConfigResponse {
	return OpenClawYuanbaoConfigResponse{
		Enabled:        !hasExplicitFalse(section, "enabled"),
		Name:           stringFromMap(section, "name"),
		AccountCount:   len(objectMap(section["accounts"])),
		SystemPrompt:   stringFromMap(section, "systemPrompt"),
		DefaultAccount: stringFromMap(section, "defaultAccount"),
	}
}

func readOpenClawYuanbaoAccounts(section map[string]any, bindings map[string]string) []OpenClawYuanbaoAccountResponse {
	accountsCfg := objectMap(section["accounts"])
	ids := make([]string, 0, len(accountsCfg)+1)
	if openClawYuanbaoTopLevelConfigured(section) || len(accountsCfg) == 0 {
		ids = append(ids, "default")
	}
	for id := range accountsCfg {
		if strings.TrimSpace(id) != "" {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	seen := map[string]bool{}
	accounts := make([]OpenClawYuanbaoAccountResponse, 0, len(ids))
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		cfg := objectMap(accountsCfg[id])
		if id == "default" && !openClawYuanbaoAccountConfigured(cfg) {
			cfg = mergeOpenClawYuanbaoDefaultAccount(section, cfg)
		}
		if !openClawYuanbaoAccountConfigured(cfg) && id != "default" {
			continue
		}
		accounts = append(accounts, openClawYuanbaoAccountFromConfig(id, cfg, section, bindings[id]))
	}
	return accounts
}

func openClawYuanbaoAccountFromConfig(accountID string, cfg map[string]any, parent map[string]any, agentID string) OpenClawYuanbaoAccountResponse {
	appID := firstNonEmptyTelegramString(stringFromMap(cfg, "appId"), stringFromMap(cfg, "appID"), stringFromMap(parent, "appId"), stringFromMap(parent, "appID"))
	appSecret := firstNonEmptyTelegramString(stringFromMap(cfg, "appSecret"), stringFromMap(parent, "appSecret"), stringFromMap(cfg, "clientSecret"), stringFromMap(parent, "clientSecret"))
	return OpenClawYuanbaoAccountResponse{
		AccountID:           accountID,
		Name:                stringFromMap(cfg, "name"),
		Enabled:             !hasExplicitFalse(parent, "enabled") && !hasExplicitFalse(cfg, "enabled"),
		AppIDConfigured:     appID != "",
		AppSecretConfigured: appSecret != "",
		SystemPrompt:        firstNonEmptyTelegramString(stringFromMap(cfg, "systemPrompt"), stringFromMap(parent, "systemPrompt")),
		AgentID:             strings.TrimSpace(agentID),
	}
}

func patchOpenClawYuanbaoAccount(accountID string, patch OpenClawYuanbaoAccountConfigRequest) error {
	content, err := readOpenClawYuanbaoConfig()
	if err != nil {
		return err
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawYuanbaoChannelID])
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
	if patch.AppSecret != nil {
		if value := strings.TrimSpace(*patch.AppSecret); value != "" {
			accountCfg["appSecret"] = value
		}
	}
	applyStringConfigField(accountCfg, "systemPrompt", patch.SystemPrompt)
	accounts[accountID] = accountCfg
	section["accounts"] = accounts
	channels[openClawYuanbaoChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(openClawConfigPath(), content); err != nil {
		return err
	}
	if patch.AgentID != nil {
		return setOpenClawChannelAccountBinding(openClawYuanbaoChannelID, accountID, strings.TrimSpace(*patch.AgentID))
	}
	return nil
}

func removeOpenClawYuanbaoAccount(accountID string) error {
	content, err := readOpenClawYuanbaoConfig()
	if err != nil {
		return err
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawYuanbaoChannelID])
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
		delete(section, "appSecret")
		delete(section, "clientSecret")
	}
	if !openClawYuanbaoConfigured(section) {
		delete(channels, openClawYuanbaoChannelID)
	} else {
		channels[openClawYuanbaoChannelID] = section
	}
	content["channels"] = channels
	return writeOpenClawConfigContent(openClawConfigPath(), content)
}

func cleanupOpenClawYuanbaoConfig(ctx context.Context, task openClawChannelLogger) error {
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
	if _, ok := channels[openClawYuanbaoChannelID]; ok {
		delete(channels, openClawYuanbaoChannelID)
		content["channels"] = channels
		changed = true
	}
	plugins := objectMap(content["plugins"])
	entries := objectMap(plugins["entries"])
	for _, id := range []string{openClawYuanbaoChannelID, openClawYuanbaoPluginID} {
		if _, ok := entries[id]; ok {
			delete(entries, id)
			plugins["entries"] = entries
			content["plugins"] = plugins
			changed = true
		}
	}
	installs := objectMap(plugins["installs"])
	for _, id := range []string{openClawYuanbaoChannelID, openClawYuanbaoPluginID} {
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
			if !ok || stringFromMap(objectMap(item["match"]), "channel") != openClawYuanbaoChannelID {
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
		task.addLog("已清理元宝配置残留。")
	} else {
		task.addLog("没有发现元宝配置残留。")
	}
	return nil
}

func uninstallOpenClawYuanbaoPluginBestEffort(ctx context.Context, task openClawChannelLogger) error {
	for _, id := range []string{openClawYuanbaoPluginID, openClawYuanbaoChannelID} {
		stdout, stderr, err := runOpenClawStreamingCommandTo(ctx, 5*time.Minute, task.addLog, "plugins", "uninstall", id, "--force")
		if err == nil {
			continue
		}
		if openClawCommandBlockedByConfig(stdout, stderr, err) {
			task.addLog("OpenClaw CLI 因配置校验失败未完成卸载，继续清理元宝本地安装残留。")
			continue
		}
		if openClawChannelMissingOutput(stdout, stderr, err) {
			task.addLog("元宝插件目标不存在，继续清理本地安装残留。")
			continue
		}
		task.addLog("OpenClaw CLI 卸载未完成，继续清理元宝本地安装残留：" + err.Error())
	}
	return nil
}

func installOpenClawYuanbaoPlugin(ctx context.Context, task openClawChannelLogger) error {
	if detectOpenClawYuanbaoStatus().Installed {
		task.addLog("元宝插件已安装，跳过安装。")
		return nil
	}
	_, _, err := runOpenClawStreamingCommandTo(ctx, 10*time.Minute, task.addLog, "plugins", "install", openClawYuanbaoPackage)
	return err
}

func cleanupOpenClawYuanbaoInstallArtifacts(ctx context.Context, task openClawChannelLogger) error {
	_ = ctx
	home := defaultOpenClawHomeDir()
	removed := 0
	seenDirs := map[string]bool{}
	for _, pkgPath := range openClawYuanbaoPackagePaths(home) {
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
	if err := removeOpenClawYuanbaoInstallRecords(home); err != nil {
		return err
	}
	if removed > 0 {
		task.addLog(fmt.Sprintf("已清理 %d 个元宝插件安装目录。", removed))
	} else {
		task.addLog("没有发现元宝插件安装目录残留。")
	}
	return nil
}

func removeOpenClawYuanbaoInstallRecords(home string) error {
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
	for _, id := range []string{openClawYuanbaoChannelID, openClawYuanbaoPluginID} {
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

func refreshOpenClawYuanbaoRegistryBestEffort(ctx context.Context, task openClawChannelLogger) error {
	stdout, stderr, err := runOpenClawStreamingCommandTo(ctx, 2*time.Minute, task.addLog, "plugins", "registry", "--refresh")
	if err == nil {
		return nil
	}
	if openClawCommandBlockedByConfig(stdout, stderr, err) {
		task.addLog("OpenClaw CLI 因配置校验失败未能刷新插件注册表；元宝本地残留已清理。")
		return nil
	}
	task.addLog("插件注册表刷新未完成；元宝本地残留已清理：" + err.Error())
	return nil
}

func readOpenClawYuanbaoConfig() (map[string]any, error) {
	content, _, err := readOpenClawConfigFile(openClawConfigPath())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	return content, nil
}

func openClawYuanbaoConfigured(section map[string]any) bool {
	if openClawYuanbaoTopLevelConfigured(section) {
		return true
	}
	for _, value := range objectMap(section["accounts"]) {
		if openClawYuanbaoAccountConfigured(objectMap(value)) {
			return true
		}
	}
	return false
}

func openClawYuanbaoTopLevelConfigured(section map[string]any) bool {
	appID := firstNonEmptyTelegramString(stringFromMap(section, "appId"), stringFromMap(section, "appID"))
	appSecret := firstNonEmptyTelegramString(stringFromMap(section, "appSecret"), stringFromMap(section, "clientSecret"))
	return appID != "" && appSecret != ""
}

func openClawYuanbaoAccountConfigured(cfg map[string]any) bool {
	appID := firstNonEmptyTelegramString(stringFromMap(cfg, "appId"), stringFromMap(cfg, "appID"))
	appSecret := firstNonEmptyTelegramString(stringFromMap(cfg, "appSecret"), stringFromMap(cfg, "clientSecret"))
	return appID != "" && appSecret != ""
}

func mergeOpenClawYuanbaoDefaultAccount(parent map[string]any, cfg map[string]any) map[string]any {
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

func openClawYuanbaoPackagePaths(home string) []string {
	paths := []string{
		filepath.Join(home, "extensions", openClawYuanbaoChannelID, "package.json"),
		filepath.Join(home, "node_modules", "openclaw-plugin-yuanbao", "package.json"),
		filepath.Join(home, "npm", "node_modules", "openclaw-plugin-yuanbao", "package.json"),
	}
	if installPath := openClawPluginInstallRecordPath(home, openClawYuanbaoChannelID); installPath != "" {
		paths = append(paths, filepath.Join(installPath, "package.json"))
	}
	if installPath := openClawPluginInstallRecordPath(home, openClawYuanbaoPluginID); installPath != "" {
		paths = append(paths, filepath.Join(installPath, "package.json"))
	}
	return paths
}
