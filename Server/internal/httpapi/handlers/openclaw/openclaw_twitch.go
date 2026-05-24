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
	openClawTwitchChannelID = "twitch"
	openClawTwitchPackage   = "@openclaw/twitch"
)

type OpenClawTwitchStatusOutput struct {
	Body OpenClawTwitchStatusResponse
}

type OpenClawTwitchConfigInput struct {
	Body OpenClawTwitchConfigRequest
}

type OpenClawTwitchConfigOutput struct {
	Body OpenClawTwitchStatusResponse
}

type OpenClawTwitchCredentialValidateInput struct {
	Body OpenClawTwitchCredentialValidateRequest
}

type OpenClawTwitchCredentialValidateOutput struct {
	Body OpenClawTwitchCredentialValidateResponse
}

type OpenClawTwitchAccountConfigInput struct {
	AccountID string `path:"accountId" doc:"Twitch account id." example:"default"`
	Body      OpenClawTwitchAccountConfigRequest
}

type OpenClawTwitchAccountConfigOutput struct {
	Body OpenClawTwitchStatusResponse
}

type OpenClawTwitchAccountDeleteInput struct {
	AccountID string `path:"accountId" doc:"Twitch account id." example:"default"`
}

type OpenClawTwitchAccountDeleteOutput struct {
	Body OpenClawTwitchAccountDeleteResponse
}

type OpenClawTwitchAddStreamInput struct {
	AccountID      string `query:"accountId" doc:"Twitch account id. Empty uses default." example:"default"`
	Username       string `query:"username" doc:"Twitch bot username."`
	AccessToken    string `query:"accessToken" doc:"Twitch OAuth access token."`
	ClientID       string `query:"clientId" doc:"Twitch application client id."`
	Channel        string `query:"channel" doc:"Twitch channel name to join."`
	ClientSecret   string `query:"clientSecret" doc:"Optional Twitch application client secret."`
	RefreshToken   string `query:"refreshToken" doc:"Optional OAuth refresh token."`
	AllowFrom      string `query:"allowFrom" doc:"Comma or newline separated Twitch user ids or logins."`
	AllowedRoles   string `query:"allowedRoles" doc:"Comma or newline separated Twitch roles."`
	Name           string `query:"name" doc:"Optional account display name."`
	AgentID        string `query:"agentId" doc:"Agent id routed to this account."`
	RequireMention bool   `query:"requireMention" doc:"Whether chat messages require mention."`
}

type OpenClawTwitchStatusResponse struct {
	Status       string                       `json:"status" example:"ok" doc:"Operation status."`
	ChannelID    string                       `json:"channelId" example:"twitch" doc:"OpenClaw channel id."`
	Package      string                       `json:"package" example:"@openclaw/twitch" doc:"OpenClaw Twitch package name."`
	Installed    bool                         `json:"installed" example:"true" doc:"Whether Twitch appears available from local install records or config."`
	Configured   bool                         `json:"configured" example:"true" doc:"Whether required Twitch credentials are configured."`
	Enabled      bool                         `json:"enabled" example:"true" doc:"Whether channels.twitch.enabled is true."`
	Config       OpenClawTwitchConfigResponse `json:"config" doc:"Twitch channel config summary without secrets."`
	Accounts     []OpenClawTwitchAccount      `json:"accounts" doc:"Configured Twitch accounts without tokens."`
	ConfigPath   string                       `json:"configPath,omitempty" doc:"OpenClaw config path."`
	OpenClawHome string                       `json:"openClawHome,omitempty" doc:"OpenClaw home directory."`
	Version      string                       `json:"version,omitempty" doc:"Installed package version when readable."`
	Error        string                       `json:"error,omitempty" doc:"Config read error."`
}

type OpenClawTwitchConfigResponse struct {
	Enabled            bool     `json:"enabled" doc:"Whether channels.twitch.enabled is true."`
	AccountCount       int      `json:"accountCount" doc:"Configured Twitch account count."`
	AllowFromCount     int      `json:"allowFromCount" doc:"Top-level allowFrom entry count."`
	AllowedRoles       []string `json:"allowedRoles,omitempty" doc:"Top-level allowed Twitch roles."`
	Username           string   `json:"username,omitempty" doc:"Top-level bot username when configured."`
	Channel            string   `json:"channel,omitempty" doc:"Top-level Twitch channel when configured."`
	TokenConfigured    bool     `json:"tokenConfigured" doc:"Whether top-level access token or env fallback is available."`
	TokenSource        string   `json:"tokenSource" doc:"Top-level token source without returning the token."`
	ClientIDConfigured bool     `json:"clientIdConfigured" doc:"Whether top-level client id is configured."`
	ClientSecretSet    bool     `json:"clientSecretConfigured" doc:"Whether top-level client secret is configured."`
	RefreshTokenSet    bool     `json:"refreshTokenConfigured" doc:"Whether top-level refresh token is configured."`
	RequireMention     bool     `json:"requireMention" doc:"Whether top-level chat messages require mention."`
}

type OpenClawTwitchAccount struct {
	AccountID              string   `json:"accountId" example:"default" doc:"Twitch account id."`
	Name                   string   `json:"name,omitempty" doc:"Account display name."`
	Enabled                bool     `json:"enabled" doc:"Whether this account is enabled."`
	Username               string   `json:"username,omitempty" doc:"Twitch bot username."`
	Channel                string   `json:"channel,omitempty" doc:"Twitch channel name."`
	ClientID               string   `json:"clientId,omitempty" doc:"Twitch application client id."`
	TokenConfigured        bool     `json:"tokenConfigured" doc:"Whether accessToken or env fallback is available."`
	TokenSource            string   `json:"tokenSource" doc:"Token source without returning the token."`
	ClientIDConfigured     bool     `json:"clientIdConfigured" doc:"Whether client id is configured."`
	ClientSecretConfigured bool     `json:"clientSecretConfigured" doc:"Whether client secret is configured."`
	RefreshTokenConfigured bool     `json:"refreshTokenConfigured" doc:"Whether refresh token is configured."`
	AllowFrom              []string `json:"allowFrom,omitempty" doc:"Allowed Twitch users."`
	AllowFromCount         int      `json:"allowFromCount" doc:"Allowed Twitch user count."`
	AllowedRoles           []string `json:"allowedRoles,omitempty" doc:"Allowed Twitch roles."`
	RequireMention         bool     `json:"requireMention" doc:"Whether chat messages require mention."`
	AgentID                string   `json:"agentId,omitempty" doc:"Agent routed to this account."`
}

type OpenClawTwitchConfigRequest struct {
	Enabled *bool `json:"enabled,omitempty" doc:"Twitch channel enabled switch."`
}

type OpenClawTwitchCredentialValidateRequest struct {
	AccessToken string `json:"accessToken" doc:"Twitch OAuth access token. Token is never returned."`
}

type OpenClawTwitchCredentialValidateResponse struct {
	Status      string   `json:"status" example:"ok" doc:"Operation status."`
	Timestamp   string   `json:"timestamp" example:"2026-05-14T09:00:00Z" doc:"UTC response timestamp."`
	Valid       bool     `json:"valid" doc:"Whether Twitch accepted the access token."`
	ClientID    string   `json:"clientId,omitempty" doc:"Twitch client id from token validation."`
	Login       string   `json:"login,omitempty" doc:"Twitch login from token validation."`
	UserID      string   `json:"userId,omitempty" doc:"Twitch user id from token validation."`
	Scopes      []string `json:"scopes,omitempty" doc:"OAuth scopes."`
	ExpiresIn   int      `json:"expiresIn,omitempty" doc:"Seconds until token expiry."`
	Error       string   `json:"error,omitempty" doc:"Validation error without exposing the token."`
	RawError    string   `json:"rawError,omitempty" doc:"Sanitized original transport error."`
	HTTPStatus  int      `json:"httpStatus,omitempty" doc:"Twitch HTTP status code."`
	RawResponse string   `json:"rawResponse,omitempty" doc:"Sanitized raw Twitch response body."`
}

type OpenClawTwitchAccountConfigRequest struct {
	AccessToken    *string  `json:"accessToken,omitempty" doc:"New Twitch OAuth access token. Empty string is ignored."`
	AgentID        *string  `json:"agentId,omitempty" doc:"Agent id routed to this account. Empty string removes binding."`
	AllowFrom      []string `json:"allowFrom,omitempty" doc:"Allowed Twitch users. Empty array clears override."`
	AllowedRoles   []string `json:"allowedRoles,omitempty" doc:"Allowed Twitch roles. Empty array clears override."`
	Channel        *string  `json:"channel,omitempty" doc:"Twitch channel name."`
	ClientID       *string  `json:"clientId,omitempty" doc:"Twitch application client id."`
	ClientSecret   *string  `json:"clientSecret,omitempty" doc:"Twitch application client secret. Empty clears it."`
	Enabled        *bool    `json:"enabled,omitempty" doc:"Account enabled switch."`
	Name           *string  `json:"name,omitempty" doc:"Account display name. Empty string clears it."`
	RefreshToken   *string  `json:"refreshToken,omitempty" doc:"Twitch OAuth refresh token. Empty clears it."`
	RequireMention *bool    `json:"requireMention,omitempty" doc:"Whether messages require mention."`
	Username       *string  `json:"username,omitempty" doc:"Twitch bot username."`
}

type OpenClawTwitchAccountDeleteResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-14T09:00:00Z" doc:"UTC response timestamp."`
	AccountID string `json:"accountId" doc:"Deleted Twitch account id."`
}

func GetOpenClawTwitchStatus(ctx context.Context, input *struct{}) (*OpenClawTwitchStatusOutput, error) {
	_ = ctx
	return &OpenClawTwitchStatusOutput{Body: detectOpenClawTwitchStatus()}, nil
}

func UpdateOpenClawTwitchConfig(ctx context.Context, input *OpenClawTwitchConfigInput) (*OpenClawTwitchConfigOutput, error) {
	_ = ctx
	if input == nil {
		return nil, huma.Error400BadRequest("twitch config request is required", nil)
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
	section := objectMap(channels[openClawTwitchChannelID])
	if input.Body.Enabled != nil {
		section["enabled"] = *input.Body.Enabled
	}
	channels[openClawTwitchChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return nil, huma.Error500InternalServerError("write openclaw config failed", err)
	}
	invalidateOpenClawEnvironmentCache()
	return &OpenClawTwitchConfigOutput{Body: detectOpenClawTwitchStatus()}, nil
}

func ValidateOpenClawTwitchCredential(ctx context.Context, input *OpenClawTwitchCredentialValidateInput) (*OpenClawTwitchCredentialValidateOutput, error) {
	if input == nil || strings.TrimSpace(input.Body.AccessToken) == "" {
		return nil, huma.Error400BadRequest("access token is required", nil)
	}
	result := validateOpenClawTwitchAccessToken(ctx, strings.TrimSpace(input.Body.AccessToken))
	return &OpenClawTwitchCredentialValidateOutput{Body: result}, nil
}

func UpdateOpenClawTwitchAccountConfig(ctx context.Context, input *OpenClawTwitchAccountConfigInput) (*OpenClawTwitchAccountConfigOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("account id is required", nil)
	}
	if err := patchOpenClawTwitchAccount(strings.TrimSpace(input.AccountID), input.Body); err != nil {
		return nil, huma.Error500InternalServerError("update twitch account config failed", err)
	}
	return &OpenClawTwitchAccountConfigOutput{Body: detectOpenClawTwitchStatus()}, nil
}

func DeleteOpenClawTwitchAccount(ctx context.Context, input *OpenClawTwitchAccountDeleteInput) (*OpenClawTwitchAccountDeleteOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("account id is required", nil)
	}
	accountID := strings.TrimSpace(input.AccountID)
	if err := removeOpenClawTwitchAccount(accountID); err != nil {
		return nil, huma.Error500InternalServerError("delete twitch account failed", err)
	}
	if err := setOpenClawChannelAccountBinding(openClawTwitchChannelID, accountID, ""); err != nil {
		return nil, huma.Error500InternalServerError("update twitch account binding failed", err)
	}
	return &OpenClawTwitchAccountDeleteOutput{Body: OpenClawTwitchAccountDeleteResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AccountID: accountID,
	}}, nil
}

func AddOpenClawTwitchAccountStream(ctx context.Context, input *OpenClawTwitchAddStreamInput, send sse.Sender) {
	if input == nil {
		streamOpenClawChannelError(send, "twitch-add", "add", fmt.Errorf("twitch account request is required"))
		return
	}
	accountID := strings.TrimSpace(input.AccountID)
	if accountID == "" {
		accountID = "default"
	}
	if strings.TrimSpace(input.Username) == "" || strings.TrimSpace(input.AccessToken) == "" || strings.TrimSpace(input.ClientID) == "" || strings.TrimSpace(input.Channel) == "" {
		streamOpenClawChannelError(send, "twitch-add", "add", fmt.Errorf("username、access token、client id 和 channel 都不能为空"))
		return
	}
	streamOpenClawChannelSteps(ctx, send, "twitch-add", "add", []openClawChannelStep{
		{label: "检查 OpenClaw CLI", progress: 5, timeout: 10 * time.Second, args: []string{"--version"}},
		{label: "写入 Twitch 账号配置", progress: 45, run: func(ctx context.Context, task openClawChannelLogger) error {
			_ = ctx
			if err := configureOpenClawTwitchAccount(accountID, OpenClawTwitchAddConfig{
				AccessToken:    input.AccessToken,
				AgentID:        input.AgentID,
				AllowFrom:      input.AllowFrom,
				AllowedRoles:   input.AllowedRoles,
				Channel:        input.Channel,
				ClientID:       input.ClientID,
				ClientSecret:   input.ClientSecret,
				Name:           input.Name,
				RefreshToken:   input.RefreshToken,
				RequireMention: input.RequireMention,
				Username:       input.Username,
			}); err != nil {
				return err
			}
			task.addLog("已写入 Twitch 账号配置。")
			return nil
		}},
		{label: "重启 Gateway 应用 Twitch 配置", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
}

type OpenClawTwitchAddConfig struct {
	AccessToken    string
	AgentID        string
	AllowFrom      string
	AllowedRoles   string
	Channel        string
	ClientID       string
	ClientSecret   string
	Name           string
	RefreshToken   string
	RequireMention bool
	Username       string
}

func detectOpenClawTwitchStatus() OpenClawTwitchStatusResponse {
	home := defaultOpenClawHomeDir()
	configPath := openClawConfigPath()
	content, exists, configErr := readOpenClawConfigFile(configPath)
	section := objectMap(objectMap(content["channels"])[openClawTwitchChannelID])
	configured := openClawTwitchConfigured(section)
	version := ""
	installed := configured
	for _, pkgPath := range openClawTwitchPackagePaths(home) {
		pkgVersion, ok := readPackageVersion(pkgPath)
		if ok {
			installed = true
			if version == "" {
				version = pkgVersion
			}
		}
	}
	enabled := configured && boolFromMap(section, "enabled")
	accounts := readOpenClawTwitchAccounts(section, readOpenClawChannelAccountBindings(content, openClawTwitchChannelID))
	response := OpenClawTwitchStatusResponse{
		Status:     "ok",
		ChannelID:  openClawTwitchChannelID,
		Package:    openClawTwitchPackage,
		Installed:  installed,
		Configured: configured,
		Enabled:    enabled,
		Config:     openClawTwitchConfigFromSection(section, len(accounts)),
		Accounts:   accounts,
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
	return response
}

func validateOpenClawTwitchAccessToken(ctx context.Context, accessToken string) OpenClawTwitchCredentialValidateResponse {
	response := OpenClawTwitchCredentialValidateResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Valid:     false,
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://id.twitch.tv/oauth2/validate", nil)
	if err != nil {
		response.Error = "Twitch 校验请求创建失败"
		response.RawError = sanitizeOpenClawTwitchValidationText(err.Error(), accessToken)
		return response
	}
	req.Header.Set("Authorization", "OAuth "+strings.TrimPrefix(accessToken, "oauth:"))
	client := &http.Client{Timeout: 10 * time.Second}
	httpResp, err := client.Do(req)
	if err != nil {
		response.Error = "无法连接 Twitch OAuth 校验接口"
		response.RawError = sanitizeOpenClawTwitchValidationText(err.Error(), accessToken)
		return response
	}
	defer httpResp.Body.Close()
	response.HTTPStatus = httpResp.StatusCode
	rawBody, err := io.ReadAll(io.LimitReader(httpResp.Body, 1<<20))
	if err != nil {
		response.Error = "Twitch 校验响应读取失败"
		response.RawError = sanitizeOpenClawTwitchValidationText(err.Error(), accessToken)
		return response
	}
	response.RawResponse = sanitizeOpenClawTwitchValidationText(strings.TrimSpace(string(rawBody)), accessToken)
	var payload struct {
		ClientID  string   `json:"client_id"`
		Login     string   `json:"login"`
		UserID    string   `json:"user_id"`
		Scopes    []string `json:"scopes"`
		ExpiresIn int      `json:"expires_in"`
		Message   string   `json:"message"`
		Status    int      `json:"status"`
	}
	if err := json.Unmarshal(rawBody, &payload); err != nil {
		response.Error = "Twitch 校验响应解析失败"
		response.RawError = sanitizeOpenClawTwitchValidationText(err.Error(), accessToken)
		return response
	}
	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
		response.Error = firstNonEmptyTwitchString(payload.Message, fmt.Sprintf("Twitch OAuth 返回 %d", httpResp.StatusCode))
		return response
	}
	response.Valid = true
	response.ClientID = strings.TrimSpace(payload.ClientID)
	response.Login = strings.TrimSpace(payload.Login)
	response.UserID = strings.TrimSpace(payload.UserID)
	response.Scopes = payload.Scopes
	response.ExpiresIn = payload.ExpiresIn
	return response
}

func sanitizeOpenClawTwitchValidationText(value string, token string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if token = strings.TrimSpace(token); token != "" {
		value = strings.ReplaceAll(value, token, "<access-token>")
		value = strings.ReplaceAll(value, strings.TrimPrefix(token, "oauth:"), "<access-token>")
	}
	return value
}

func openClawTwitchConfigFromSection(section map[string]any, accountCount int) OpenClawTwitchConfigResponse {
	tokenConfigured, tokenSource := openClawTwitchTokenSource("default", nil, section)
	return OpenClawTwitchConfigResponse{
		Enabled:            boolFromMap(section, "enabled"),
		AccountCount:       accountCount,
		AllowFromCount:     len(stringSliceFromValue(section["allowFrom"])),
		AllowedRoles:       stringSliceFromValue(section["allowedRoles"]),
		Username:           stringFromMap(section, "username"),
		Channel:            stringFromMap(section, "channel"),
		TokenConfigured:    tokenConfigured,
		TokenSource:        tokenSource,
		ClientIDConfigured: stringFromMap(section, "clientId") != "",
		ClientSecretSet:    stringFromMap(section, "clientSecret") != "",
		RefreshTokenSet:    stringFromMap(section, "refreshToken") != "",
		RequireMention:     boolFromMap(section, "requireMention"),
	}
}

func readOpenClawTwitchAccounts(section map[string]any, bindings map[string]string) []OpenClawTwitchAccount {
	accountsCfg := objectMap(section["accounts"])
	ids := make([]string, 0, len(accountsCfg)+1)
	if openClawTwitchTopLevelConfigured(section) || len(accountsCfg) == 0 {
		ids = append(ids, "default")
	}
	for id := range accountsCfg {
		if strings.TrimSpace(id) != "" {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	seen := map[string]bool{}
	accounts := make([]OpenClawTwitchAccount, 0, len(ids))
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		cfg := objectMap(accountsCfg[id])
		if id == "default" && !openClawTwitchAccountConfigured(cfg) {
			cfg = mergeOpenClawTwitchDefaultAccount(section, cfg)
		}
		if !openClawTwitchAccountConfigured(cfg) && id != "default" {
			continue
		}
		accounts = append(accounts, openClawTwitchAccountFromConfig(id, cfg, section, bindings[id]))
	}
	return accounts
}

func openClawTwitchAccountFromConfig(accountID string, cfg map[string]any, parent map[string]any, agentID string) OpenClawTwitchAccount {
	tokenConfigured, tokenSource := openClawTwitchTokenSource(accountID, cfg, parent)
	allowFrom := firstNonEmptyStringSlice(stringSliceFromValue(cfg["allowFrom"]), stringSliceFromValue(parent["allowFrom"]))
	allowedRoles := firstNonEmptyStringSlice(stringSliceFromValue(cfg["allowedRoles"]), stringSliceFromValue(parent["allowedRoles"]))
	return OpenClawTwitchAccount{
		AccountID:              accountID,
		Name:                   stringFromMap(cfg, "name"),
		Enabled:                !hasExplicitFalse(cfg, "enabled") && !hasExplicitFalse(parent, "enabled"),
		Username:               firstNonEmptyTwitchString(stringFromMap(cfg, "username"), stringFromMap(parent, "username")),
		Channel:                firstNonEmptyTwitchString(stringFromMap(cfg, "channel"), stringFromMap(parent, "channel")),
		ClientID:               firstNonEmptyTwitchString(stringFromMap(cfg, "clientId"), stringFromMap(parent, "clientId")),
		TokenConfigured:        tokenConfigured,
		TokenSource:            tokenSource,
		ClientIDConfigured:     firstNonEmptyTwitchString(stringFromMap(cfg, "clientId"), stringFromMap(parent, "clientId")) != "",
		ClientSecretConfigured: firstNonEmptyTwitchString(stringFromMap(cfg, "clientSecret"), stringFromMap(parent, "clientSecret")) != "",
		RefreshTokenConfigured: firstNonEmptyTwitchString(stringFromMap(cfg, "refreshToken"), stringFromMap(parent, "refreshToken")) != "",
		AllowFrom:              allowFrom,
		AllowFromCount:         len(allowFrom),
		AllowedRoles:           allowedRoles,
		RequireMention:         boolFromMap(cfg, "requireMention") || boolFromMap(parent, "requireMention"),
		AgentID:                strings.TrimSpace(agentID),
	}
}

func configureOpenClawTwitchAccount(accountID string, patch OpenClawTwitchAddConfig) error {
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
	section := objectMap(channels[openClawTwitchChannelID])
	section["enabled"] = true
	accounts := objectMap(section["accounts"])
	accountCfg := objectMap(accounts[accountID])
	accountCfg["enabled"] = true
	setOpenClawTwitchStringField(accountCfg, "name", patch.Name)
	setOpenClawTwitchStringField(accountCfg, "username", patch.Username)
	setOpenClawTwitchStringField(accountCfg, "accessToken", patch.AccessToken)
	setOpenClawTwitchStringField(accountCfg, "clientId", patch.ClientID)
	setOpenClawTwitchStringField(accountCfg, "channel", patch.Channel)
	setOpenClawTwitchStringField(accountCfg, "clientSecret", patch.ClientSecret)
	setOpenClawTwitchStringField(accountCfg, "refreshToken", patch.RefreshToken)
	setOpenClawTwitchStringSliceField(accountCfg, "allowFrom", splitOpenClawTwitchList(patch.AllowFrom))
	setOpenClawTwitchStringSliceField(accountCfg, "allowedRoles", splitOpenClawTwitchList(patch.AllowedRoles))
	accountCfg["requireMention"] = patch.RequireMention
	accounts[accountID] = accountCfg
	section["accounts"] = accounts
	channels[openClawTwitchChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return err
	}
	if strings.TrimSpace(patch.AgentID) != "" {
		return setOpenClawChannelAccountBinding(openClawTwitchChannelID, accountID, strings.TrimSpace(patch.AgentID))
	}
	return nil
}

func patchOpenClawTwitchAccount(accountID string, patch OpenClawTwitchAccountConfigRequest) error {
	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		return err
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawTwitchChannelID])
	accounts := objectMap(section["accounts"])
	accountCfg := objectMap(accounts[accountID])
	accountChanged := false
	if patch.Enabled != nil {
		accountCfg["enabled"] = *patch.Enabled
		accountChanged = true
	}
	if patch.Name != nil {
		setOpenClawTwitchStringField(accountCfg, "name", *patch.Name)
		accountChanged = true
	}
	if patch.Username != nil {
		setOpenClawTwitchStringField(accountCfg, "username", *patch.Username)
		accountChanged = true
	}
	if patch.AccessToken != nil && strings.TrimSpace(*patch.AccessToken) != "" {
		accountCfg["accessToken"] = strings.TrimSpace(*patch.AccessToken)
		accountChanged = true
	}
	if patch.ClientID != nil {
		setOpenClawTwitchStringField(accountCfg, "clientId", *patch.ClientID)
		accountChanged = true
	}
	if patch.Channel != nil {
		setOpenClawTwitchStringField(accountCfg, "channel", *patch.Channel)
		accountChanged = true
	}
	if patch.ClientSecret != nil {
		setOpenClawTwitchStringField(accountCfg, "clientSecret", *patch.ClientSecret)
		accountChanged = true
	}
	if patch.RefreshToken != nil {
		setOpenClawTwitchStringField(accountCfg, "refreshToken", *patch.RefreshToken)
		accountChanged = true
	}
	if patch.AllowFrom != nil {
		setOpenClawTwitchStringSliceField(accountCfg, "allowFrom", patch.AllowFrom)
		accountChanged = true
	}
	if patch.AllowedRoles != nil {
		setOpenClawTwitchStringSliceField(accountCfg, "allowedRoles", patch.AllowedRoles)
		accountChanged = true
	}
	if patch.RequireMention != nil {
		accountCfg["requireMention"] = *patch.RequireMention
		accountChanged = true
	}
	if accountChanged {
		accounts[accountID] = accountCfg
		section["accounts"] = accounts
		channels[openClawTwitchChannelID] = section
		content["channels"] = channels
		if err := writeOpenClawConfigContent(configPath, content); err != nil {
			return err
		}
	}
	if patch.AgentID != nil {
		return setOpenClawChannelAccountBinding(openClawTwitchChannelID, accountID, strings.TrimSpace(*patch.AgentID))
	}
	return nil
}

func removeOpenClawTwitchAccount(accountID string) error {
	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawTwitchChannelID])
	accounts := objectMap(section["accounts"])
	delete(accounts, accountID)
	if len(accounts) == 0 {
		delete(section, "accounts")
	} else {
		section["accounts"] = accounts
	}
	if accountID == "default" {
		for _, key := range []string{"username", "accessToken", "clientId", "clientSecret", "refreshToken", "channel"} {
			delete(section, key)
		}
	}
	if !openClawTwitchConfigured(section) {
		delete(channels, openClawTwitchChannelID)
	} else {
		channels[openClawTwitchChannelID] = section
	}
	content["channels"] = channels
	return writeOpenClawConfigContent(configPath, content)
}

func openClawTwitchConfigured(section map[string]any) bool {
	if openClawTwitchTopLevelConfigured(section) {
		return true
	}
	for _, value := range objectMap(section["accounts"]) {
		if openClawTwitchAccountConfigured(objectMap(value)) {
			return true
		}
	}
	return false
}

func openClawTwitchTopLevelConfigured(section map[string]any) bool {
	return firstNonEmptyTwitchString(stringFromMap(section, "username"), os.Getenv("TWITCH_USERNAME")) != "" &&
		firstNonEmptyTwitchString(stringFromMap(section, "accessToken"), os.Getenv("TWITCH_ACCESS_TOKEN")) != "" &&
		firstNonEmptyTwitchString(stringFromMap(section, "clientId"), os.Getenv("TWITCH_CLIENT_ID")) != "" &&
		firstNonEmptyTwitchString(stringFromMap(section, "channel"), os.Getenv("TWITCH_CHANNEL")) != ""
}

func openClawTwitchAccountConfigured(cfg map[string]any) bool {
	return stringFromMap(cfg, "username") != "" && stringFromMap(cfg, "accessToken") != "" && stringFromMap(cfg, "clientId") != "" && stringFromMap(cfg, "channel") != ""
}

func mergeOpenClawTwitchDefaultAccount(parent map[string]any, cfg map[string]any) map[string]any {
	merged := map[string]any{}
	for key, value := range parent {
		if key == "accounts" || key == "defaultAccount" {
			continue
		}
		merged[key] = value
	}
	for key, value := range cfg {
		merged[key] = value
	}
	return merged
}

func openClawTwitchTokenSource(accountID string, cfg map[string]any, parent map[string]any) (bool, string) {
	if cfg != nil && stringFromMap(cfg, "accessToken") != "" {
		return true, "config"
	}
	if accountID == "default" && stringFromMap(parent, "accessToken") != "" {
		return true, "config"
	}
	if accountID == "default" && strings.TrimSpace(os.Getenv("TWITCH_ACCESS_TOKEN")) != "" {
		return true, "env"
	}
	return false, "missing"
}

func openClawTwitchPackagePaths(home string) []string {
	paths := []string{
		filepath.Join(home, "extensions", openClawTwitchChannelID, "package.json"),
		filepath.Join(home, "node_modules", "@openclaw", "twitch", "package.json"),
		filepath.Join(home, "npm", "node_modules", "@openclaw", "twitch", "package.json"),
	}
	if installPath := openClawPluginInstallRecordPath(home, openClawTwitchChannelID); installPath != "" {
		paths = append(paths, filepath.Join(installPath, "package.json"))
	}
	return paths
}

func setOpenClawTwitchStringField(target map[string]any, key string, value string) {
	if strings.TrimSpace(value) == "" {
		delete(target, key)
		return
	}
	target[key] = strings.TrimSpace(value)
}

func setOpenClawTwitchStringSliceField(target map[string]any, key string, values []string) {
	clean := dedupeOpenClawTwitchStrings(values)
	if len(clean) == 0 {
		delete(target, key)
		return
	}
	target[key] = clean
}

func splitOpenClawTwitchList(value string) []string {
	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == '，' || r == '\n' || r == '\r' || r == ';' || r == '；'
	})
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if text := strings.TrimSpace(part); text != "" {
			out = append(out, text)
		}
	}
	return dedupeOpenClawTwitchStrings(out)
}

func dedupeOpenClawTwitchStrings(values []string) []string {
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

func firstNonEmptyTwitchString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
