package openclaw

import (
	"context"
	"net/url"
	"strings"
	"time"

	"agent-box-server/internal/config"

	"github.com/danielgtaylor/huma/v2"
)

const openClawPublicGatewayURLKey = "OPENCLAW_PUBLIC_GATEWAY_URL"

type OpenClawPublicGatewayOutput struct {
	Body OpenClawPublicGatewayResponse
}

type OpenClawPublicGatewayInput struct {
	Body OpenClawPublicGatewayRequest
}

type OpenClawPublicGatewayRequest struct {
	PublicURL string `json:"publicUrl" example:"https://openclaw.example.com" doc:"Public OpenClaw Gateway URL. Empty clears OPENCLAW_PUBLIC_GATEWAY_URL."`
}

type OpenClawPublicGatewayResponse struct {
	Status             string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp          string `json:"timestamp" example:"2026-05-22T16:00:00Z" doc:"UTC response timestamp."`
	EnvKey             string `json:"envKey" example:"OPENCLAW_PUBLIC_GATEWAY_URL" doc:"Environment key used by AgentBox."`
	EnvPath            string `json:"envPath,omitempty" doc:"AgentBox executable-directory .env path when available."`
	PublicURL          string `json:"publicUrl,omitempty" example:"https://openclaw.example.com" doc:"Public Gateway HTTP URL for browser clients."`
	PublicWebSocketURL string `json:"publicWebSocketUrl,omitempty" example:"wss://openclaw.example.com" doc:"Public Gateway WebSocket URL for browser clients."`
}

func GetOpenClawPublicGateway(ctx context.Context, input *struct{}) (*OpenClawPublicGatewayOutput, error) {
	publicURL, publicWebSocketURL := currentOpenClawPublicGatewayURLs()
	envPath, _ := config.ExecutableDirDotEnvPath()
	return &OpenClawPublicGatewayOutput{Body: OpenClawPublicGatewayResponse{
		Status:             "ok",
		Timestamp:          time.Now().UTC().Format(time.RFC3339),
		EnvKey:             openClawPublicGatewayURLKey,
		EnvPath:            envPath,
		PublicURL:          publicURL,
		PublicWebSocketURL: publicWebSocketURL,
	}}, nil
}

func UpdateOpenClawPublicGateway(ctx context.Context, input *OpenClawPublicGatewayInput) (*OpenClawPublicGatewayOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("public gateway payload is required", nil)
	}
	publicURL, err := normalizeOpenClawPublicGatewayURL(input.Body.PublicURL)
	if err != nil {
		return nil, huma.Error400BadRequest("OPENCLAW_PUBLIC_GATEWAY_URL must be an http(s) URL", err)
	}
	envPath, err := config.UpdateExecutableDirDotEnvValue(openClawPublicGatewayURLKey, publicURL)
	if err != nil {
		return nil, huma.Error500InternalServerError("update OPENCLAW_PUBLIC_GATEWAY_URL failed", err)
	}
	invalidateOpenClawEnvironmentCache()

	publicWebSocketURL := openClawPublicWebSocketURL(publicURL)
	return &OpenClawPublicGatewayOutput{Body: OpenClawPublicGatewayResponse{
		Status:             "ok",
		Timestamp:          time.Now().UTC().Format(time.RFC3339),
		EnvKey:             openClawPublicGatewayURLKey,
		EnvPath:            envPath,
		PublicURL:          publicURL,
		PublicWebSocketURL: publicWebSocketURL,
	}}, nil
}

func currentOpenClawPublicGatewayURLs() (string, string) {
	publicURL, err := normalizeOpenClawPublicGatewayURL(config.Current().OpenClawPublicGatewayURL)
	if err != nil {
		return "", ""
	}
	return publicURL, openClawPublicWebSocketURL(publicURL)
}

func normalizeOpenClawPublicGatewayURL(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", nil
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", &url.Error{Op: "parse", URL: value, Err: errInvalidPublicGatewayScheme{}}
	}
	if parsed.Host == "" {
		return "", &url.Error{Op: "parse", URL: value, Err: errInvalidPublicGatewayHost{}}
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimRight(parsed.String(), "/"), nil
}

func openClawPublicWebSocketURL(publicURL string) string {
	if publicURL == "" {
		return ""
	}
	parsed, err := url.Parse(publicURL)
	if err != nil {
		return ""
	}
	switch parsed.Scheme {
	case "http":
		parsed.Scheme = "ws"
	case "https":
		parsed.Scheme = "wss"
	default:
		return ""
	}
	return parsed.String()
}

type errInvalidPublicGatewayScheme struct{}

func (errInvalidPublicGatewayScheme) Error() string {
	return "unsupported public gateway URL scheme"
}

type errInvalidPublicGatewayHost struct{}

func (errInvalidPublicGatewayHost) Error() string {
	return "public gateway URL host is required"
}
