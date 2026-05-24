package handlers

import (
	"context"
	"net/url"
	"strings"
	"time"

	"agent-box-server/internal/httpapi/toolenv"

	"github.com/danielgtaylor/huma/v2"
)

type ProxySettingsInput struct {
	Body toolenv.ProxySettings
}

type ProxyCheckInput struct {
	Body *toolenv.ProxySettings
}

type ProxySettingsOutput struct {
	Body ProxySettingsResponse
}

type ProxyCheckOutput struct {
	Body toolenv.ProxyCheckResult
}

type ProxySettingsResponse struct {
	Status    string                         `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                         `json:"timestamp" example:"2026-05-21T10:30:00Z" doc:"UTC response timestamp."`
	Settings  toolenv.ProxySettings          `json:"settings" doc:"Persisted proxy settings."`
	Effective toolenv.ProxyEffectiveSettings `json:"effective" doc:"Effective proxy values used by backend fallback."`
}

func GetProxySettings(ctx context.Context, input *struct{}) (*ProxySettingsOutput, error) {
	return proxySettingsOutput(toolenv.ProxySettingsSnapshot()), nil
}

func UpdateProxySettings(ctx context.Context, input *ProxySettingsInput) (*ProxySettingsOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("proxy settings are required", nil)
	}
	settings, err := toolenv.SaveProxySettings(input.Body)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid proxy settings", err)
	}
	return proxySettingsOutput(settings), nil
}

func CheckProxySettings(ctx context.Context, input *ProxyCheckInput) (*ProxyCheckOutput, error) {
	var settings *toolenv.ProxySettings
	if input != nil {
		settings = input.Body
	}
	return &ProxyCheckOutput{Body: toolenv.CheckProxy(ctx, settings)}, nil
}

func proxySettingsOutput(settings toolenv.ProxySettings) *ProxySettingsOutput {
	effective, ok := toolenv.EffectiveProxySettings()
	if !ok {
		effective = toolenv.ProxyEffectiveSettings{
			Mode:    settings.Mode,
			NoProxy: settings.NoProxy,
			Enabled: false,
		}
	}
	return &ProxySettingsOutput{Body: ProxySettingsResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Settings:  settings,
		Effective: redactProxyEffectiveSettings(effective),
	}}
}

func redactProxyEffectiveSettings(settings toolenv.ProxyEffectiveSettings) toolenv.ProxyEffectiveSettings {
	settings.HTTPProxy = redactProxyURL(settings.HTTPProxy)
	settings.HTTPSProxy = redactProxyURL(settings.HTTPSProxy)
	settings.AllProxy = redactProxyURL(settings.AllProxy)
	return settings
}

func redactProxyURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.User == nil {
		return value
	}
	username := parsed.User.Username()
	if username == "" {
		parsed.User = url.UserPassword("******", "******")
	} else {
		parsed.User = url.UserPassword(username, "******")
	}
	return parsed.String()
}
