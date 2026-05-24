package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"agent-box-server/internal/config"

	"github.com/danielgtaylor/huma/v2"
)

type AuthConfigPatchInput struct {
	Body AuthConfigPatchRequest
}

type AuthConfigPatchRequest struct {
	Token *string `json:"token,omitempty" doc:"Backend auth token. Empty string disables auth." example:"my-secret-token"`
}

type AuthConfigOutput struct {
	Body AuthConfigResponse
}

type AuthConfigResponse struct {
	BackendAddress  string `json:"backendAddress" example:"http://127.0.0.1:8787" doc:"Current backend address saved in the auth config file."`
	Path            string `json:"path" doc:"Auth config file path."`
	Status          string `json:"status" example:"ok"`
	Timestamp       string `json:"timestamp" example:"2026-05-16T00:00:00Z"`
	TokenConfigured bool   `json:"tokenConfigured" example:"true" doc:"Whether backend auth is enabled."`
}

func registerAuthRoutes(api huma.API, store *config.BackendAuthStore) {
	huma.Register(api, huma.Operation{
		OperationID: "get-backend-auth-config",
		Method:      http.MethodGet,
		Path:        "/api/auth/config",
		Summary:     "Get backend auth config",
		Description: "读取 AgentBox 后端鉴权配置状态。该接口同样受鉴权保护；当未携带 Token 也能访问时，表示当前已关闭访问保护。",
		Tags:        []string{"System"},
	}, func(ctx context.Context, input *struct{}) (*AuthConfigOutput, error) {
		if store == nil {
			return nil, huma.Error500InternalServerError("auth config is not initialized")
		}

		return &AuthConfigOutput{Body: authConfigResponse(store, store.Snapshot())}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "update-backend-auth-config",
		Method:      http.MethodPatch,
		Path:        "/api/auth/config",
		Summary:     "Update backend auth config",
		Description: "更新 AgentBox 后端鉴权 Token。Token 为空字符串时关闭鉴权；Token 非空时，除 /api/health 外其它接口都需要鉴权。",
		Tags:        []string{"System"},
	}, func(ctx context.Context, input *AuthConfigPatchInput) (*AuthConfigOutput, error) {
		if store == nil {
			return nil, huma.Error500InternalServerError("auth config is not initialized")
		}

		snapshot := store.Snapshot()
		if input != nil && input.Body.Token != nil {
			var err error
			snapshot, err = store.UpdateToken(*input.Body.Token)
			if err != nil {
				return nil, huma.Error500InternalServerError("update auth config failed", err)
			}
		}

		return &AuthConfigOutput{Body: authConfigResponse(store, snapshot)}, nil
	})
}

func authMiddleware(store *config.BackendAuthStore) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if isAuthExemptRequest(r) {
				next.ServeHTTP(w, r)
				return
			}

			expected := ""
			if store != nil {
				expected = strings.TrimSpace(store.Token())
			}
			if expected == "" {
				next.ServeHTTP(w, r)
				return
			}

			if tokenMatches(expected, requestAuthToken(r)) {
				next.ServeHTTP(w, r)
				return
			}

			writeAuthError(w, http.StatusUnauthorized, "unauthorized")
		})
	}
}

func isAuthExemptRequest(r *http.Request) bool {
	if r.Method == http.MethodOptions {
		return true
	}
	return r.URL.Path == "/api/health" || isFrontendAssetRequest(r)
}

func isFrontendAssetRequest(r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/openclaw/") || strings.HasPrefix(r.URL.Path, "/hermes/") || strings.HasPrefix(r.URL.Path, "/cc-connect/") {
		return false
	}
	return true
}

func requestAuthToken(r *http.Request) string {
	if header := strings.TrimSpace(r.Header.Get("Authorization")); header != "" {
		if strings.HasPrefix(strings.ToLower(header), "bearer ") {
			return strings.TrimSpace(header[len("Bearer "):])
		}
		return header
	}
	if header := strings.TrimSpace(r.Header.Get("X-Agent-Box-Token")); header != "" {
		return header
	}
	if token := strings.TrimSpace(r.URL.Query().Get("token")); token != "" {
		return token
	}
	return strings.TrimSpace(r.URL.Query().Get("authToken"))
}

func tokenMatches(expected string, actual string) bool {
	if expected == "" || actual == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(actual)) == 1
}

func writeAuthError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":    status,
		"title":     http.StatusText(status),
		"detail":    message,
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	})
}

func authConfigResponse(store *config.BackendAuthStore, snapshot config.BackendAuthConfig) AuthConfigResponse {
	return AuthConfigResponse{
		BackendAddress:  snapshot.BackendAddress,
		Path:            store.Path(),
		Status:          "ok",
		Timestamp:       time.Now().UTC().Format(time.RFC3339Nano),
		TokenConfigured: strings.TrimSpace(snapshot.Token) != "",
	}
}
