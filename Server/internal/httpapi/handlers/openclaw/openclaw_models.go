package openclaw

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

type OpenClawFetchModelsInput struct {
	Body OpenClawFetchModelsRequest
}

type OpenClawFetchModelsOutput struct {
	Body OpenClawFetchModelsResponse
}

type OpenClawTestModelInput struct {
	Body OpenClawTestModelRequest
}

type OpenClawTestModelOutput struct {
	Body OpenClawTestModelResponse
}

type OpenClawFetchModelsRequest struct {
	API           string `json:"api,omitempty" doc:"OpenClaw provider API type." example:"openai-completions"`
	APIKey        string `json:"apiKey,omitempty" doc:"Provider API key used only for this fetch request."`
	BaseURL       string `json:"baseUrl" doc:"Provider base URL." example:"https://api.openai.com/v1"`
	ContextWindow int    `json:"contextWindow,omitempty" doc:"Default context window applied when the provider response does not include one." example:"128000"`
	MaxTokens     int    `json:"maxTokens,omitempty" doc:"Default max tokens applied when the provider response does not include one." example:"8192"`
}

type OpenClawTestModelRequest struct {
	API     string `json:"api,omitempty" doc:"OpenClaw provider API type." example:"openai-completions"`
	APIKey  string `json:"apiKey,omitempty" doc:"Provider API key used only for this test request."`
	BaseURL string `json:"baseUrl" doc:"Provider base URL." example:"https://api.openai.com/v1"`
	Model   string `json:"model" doc:"Model id to test." example:"gpt-4.1-mini"`
}

type OpenClawFetchedModel struct {
	ID            string   `json:"id" doc:"Model id." example:"gpt-4.1"`
	Name          string   `json:"name,omitempty" doc:"Display name." example:"GPT 4.1"`
	Input         []string `json:"input,omitempty" doc:"Supported input modalities." example:"text"`
	Reasoning     bool     `json:"reasoning,omitempty" doc:"Whether this looks like a reasoning model." example:"true"`
	ContextWindow int      `json:"contextWindow,omitempty" doc:"Context window when known." example:"128000"`
	MaxTokens     int      `json:"maxTokens,omitempty" doc:"Max output tokens when known." example:"8192"`
}

type OpenClawFetchModelsResponse struct {
	Status    string                 `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                 `json:"timestamp" example:"2026-05-13T15:30:00Z" doc:"UTC response timestamp."`
	SourceURL string                 `json:"sourceUrl" doc:"Resolved provider models endpoint."`
	Models    []OpenClawFetchedModel `json:"models" doc:"Fetched model list."`
}

type OpenClawTestModelResponse struct {
	Status     string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp  string `json:"timestamp" example:"2026-05-13T15:30:00Z" doc:"UTC response timestamp."`
	OK         bool   `json:"ok" example:"true" doc:"Whether the provider accepted the test request."`
	StatusCode int    `json:"statusCode,omitempty" example:"200" doc:"Provider HTTP status code."`
	DurationMs int64  `json:"durationMs" example:"328" doc:"Round trip duration in milliseconds."`
	Message    string `json:"message" example:"模型连通性正常" doc:"Human-readable test result."`
}

var modelIDContextPattern = regexp.MustCompile(`(?i)(^|[^a-z0-9])(\d+(?:\.\d+)?)([km])([^a-z0-9]|$)`)

func FetchOpenClawProviderModels(ctx context.Context, input *OpenClawFetchModelsInput) (*OpenClawFetchModelsOutput, error) {
	if input == nil || strings.TrimSpace(input.Body.BaseURL) == "" {
		return nil, huma.Error400BadRequest("baseUrl is required", nil)
	}

	endpoint, err := providerModelsEndpoint(input.Body.API, input.Body.BaseURL)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid provider baseUrl", err)
	}

	reqCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid provider models endpoint", err)
	}
	req.Header.Set("Accept", "application/json")
	applyProviderModelFetchHeaders(req, input.Body.API, strings.TrimSpace(input.Body.APIKey))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, huma.Error502BadGateway("fetch provider models failed", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, huma.Error502BadGateway("read provider models response failed", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, huma.Error502BadGateway(fmt.Sprintf("provider models endpoint returned %d", resp.StatusCode), nil)
	}

	models, err := parseProviderModelsResponse(input.Body.API, body, input.Body.ContextWindow, input.Body.MaxTokens)
	if err != nil {
		return nil, huma.Error502BadGateway("parse provider models response failed", err)
	}
	if len(models) == 0 {
		return nil, huma.Error502BadGateway("provider models endpoint returned no models", nil)
	}

	return &OpenClawFetchModelsOutput{Body: OpenClawFetchModelsResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		SourceURL: endpoint,
		Models:    models,
	}}, nil
}

func TestOpenClawProviderModel(ctx context.Context, input *OpenClawTestModelInput) (*OpenClawTestModelOutput, error) {
	if input == nil || strings.TrimSpace(input.Body.BaseURL) == "" {
		return nil, huma.Error400BadRequest("baseUrl is required", nil)
	}
	if strings.TrimSpace(input.Body.Model) == "" {
		return nil, huma.Error400BadRequest("model is required", nil)
	}

	endpoint, payload, err := providerModelTestRequest(input.Body.API, input.Body.BaseURL, input.Body.Model)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid provider test request", err)
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid provider test payload", err)
	}

	reqCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	start := time.Now()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, huma.Error400BadRequest("invalid provider test endpoint", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	applyProviderModelFetchHeaders(req, input.Body.API, strings.TrimSpace(input.Body.APIKey))

	resp, err := http.DefaultClient.Do(req)
	durationMs := time.Since(start).Milliseconds()
	if err != nil {
		return &OpenClawTestModelOutput{Body: OpenClawTestModelResponse{
			Status:     "ok",
			Timestamp:  time.Now().UTC().Format(time.RFC3339),
			OK:         false,
			DurationMs: durationMs,
			Message:    err.Error(),
		}}, nil
	}
	defer resp.Body.Close()

	responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	ok := resp.StatusCode >= 200 && resp.StatusCode < 300
	message := "模型连通性正常"
	if !ok {
		message = providerErrorMessage(resp.StatusCode, responseBody)
	}

	return &OpenClawTestModelOutput{Body: OpenClawTestModelResponse{
		Status:     "ok",
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		OK:         ok,
		StatusCode: resp.StatusCode,
		DurationMs: durationMs,
		Message:    message,
	}}, nil
}

func providerModelsEndpoint(apiType string, baseURL string) (string, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.TrimSpace(apiType) == "google-generative-ai" {
		trimmed = strings.TrimSuffix(trimmed, "/openai")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("unsupported scheme %q", parsed.Scheme)
	}

	switch strings.TrimSpace(apiType) {
	case "ollama":
		return trimmed + "/api/tags", nil
	default:
		return trimmed + "/models", nil
	}
}

func providerModelTestRequest(apiType string, baseURL string, model string) (string, map[string]any, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", nil, err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", nil, fmt.Errorf("unsupported scheme %q", parsed.Scheme)
	}

	modelID := strings.TrimSpace(model)
	switch strings.TrimSpace(apiType) {
	case "ollama":
		return trimmed + "/api/generate", map[string]any{
			"model":  modelID,
			"prompt": "ping",
			"stream": false,
			"options": map[string]any{
				"num_predict": 1,
			},
		}, nil
	case "anthropic-messages":
		return trimmed + "/messages", map[string]any{
			"model":      modelID,
			"max_tokens": 1,
			"messages": []map[string]any{{
				"role":    "user",
				"content": "ping",
			}},
		}, nil
	case "google-generative-ai":
		modelPath := strings.TrimPrefix(modelID, "models/")
		return trimmed + "/models/" + url.PathEscape(modelPath) + ":generateContent", map[string]any{
			"contents": []map[string]any{{
				"role": "user",
				"parts": []map[string]any{{
					"text": "ping",
				}},
			}},
			"generationConfig": map[string]any{
				"maxOutputTokens": 1,
			},
		}, nil
	case "openai-responses", "openai-codex-responses", "azure-openai-responses":
		return trimmed + "/responses", map[string]any{
			"model":             modelID,
			"input":             "ping",
			"max_output_tokens": 1,
			"stream":            false,
		}, nil
	default:
		return trimmed + "/chat/completions", map[string]any{
			"model": modelID,
			"messages": []map[string]any{{
				"role":    "user",
				"content": "ping",
			}},
			"max_tokens": 1,
			"stream":     false,
		}, nil
	}
}

func applyProviderModelFetchHeaders(req *http.Request, apiType string, apiKey string) {
	if apiKey == "" {
		return
	}
	switch strings.TrimSpace(apiType) {
	case "anthropic-messages":
		req.Header.Set("x-api-key", apiKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	case "google-generative-ai":
		req.Header.Set("x-goog-api-key", apiKey)
	default:
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
}

func parseProviderModelsResponse(apiType string, body []byte, defaultContextWindow int, defaultMaxTokens int) ([]OpenClawFetchedModel, error) {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}

	var rows []any
	switch strings.TrimSpace(apiType) {
	case "google-generative-ai", "ollama":
		rows, _ = payload["models"].([]any)
	default:
		rows, _ = payload["data"].([]any)
		if len(rows) == 0 {
			rows, _ = payload["models"].([]any)
		}
	}

	models := make([]OpenClawFetchedModel, 0, len(rows))
	seen := map[string]bool{}
	for _, row := range rows {
		item, ok := row.(map[string]any)
		if !ok {
			continue
		}
		model := modelFromProviderPayload(apiType, item, defaultContextWindow, defaultMaxTokens)
		if model.ID == "" || seen[model.ID] {
			continue
		}
		seen[model.ID] = true
		models = append(models, model)
	}
	return models, nil
}

func modelFromProviderPayload(apiType string, item map[string]any, defaultContextWindow int, defaultMaxTokens int) OpenClawFetchedModel {
	id := firstNonEmptyString(item["id"], item["name"], item["model"], item["key"])
	name := firstNonEmptyString(item["displayName"], item["display_name"], item["title"], item["name"], item["id"], item["model"])
	if strings.TrimSpace(apiType) == "google-generative-ai" {
		id = strings.TrimPrefix(id, "models/")
		if name == "" || strings.HasPrefix(name, "models/") {
			name = id
		}
	}
	contextWindow := firstPositiveInt(item["contextWindow"], item["context_window"], item["context_length"], item["max_context_length"], item["inputTokenLimit"], item["input_token_limit"])
	maxTokens := firstPositiveInt(item["maxTokens"], item["max_tokens"], item["outputTokenLimit"], item["output_token_limit"])
	if contextWindow == 0 {
		contextWindow = inferContextWindowFromModelID(id)
	}
	if contextWindow == 0 {
		contextWindow = inferContextWindowFromModelID(name)
	}
	if contextWindow == 0 {
		contextWindow = defaultContextWindow
	}
	if maxTokens == 0 {
		maxTokens = defaultMaxTokens
	}

	input := []string{"text"}
	if modelSupportsVision(item) {
		input = []string{"text", "image"}
	}

	return OpenClawFetchedModel{
		ID:            strings.TrimSpace(id),
		Name:          strings.TrimSpace(name),
		Input:         input,
		Reasoning:     isReasoningModelID(id),
		ContextWindow: contextWindow,
		MaxTokens:     maxTokens,
	}
}

func firstNonEmptyString(values ...any) string {
	for _, value := range values {
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text)
		}
	}
	return ""
}

func firstPositiveInt(values ...any) int {
	for _, value := range values {
		switch typed := value.(type) {
		case float64:
			if typed > 0 {
				return int(typed)
			}
		case int:
			if typed > 0 {
				return typed
			}
		case string:
			var parsed int
			if _, err := fmt.Sscanf(typed, "%d", &parsed); err == nil && parsed > 0 {
				return parsed
			}
		}
	}
	return 0
}

func modelSupportsVision(item map[string]any) bool {
	for _, key := range []string{"input", "modalities", "supported_input_modalities"} {
		if values, ok := item[key].([]any); ok {
			for _, value := range values {
				if text, ok := value.(string); ok && (strings.Contains(strings.ToLower(text), "image") || strings.Contains(strings.ToLower(text), "vision")) {
					return true
				}
			}
		}
	}
	if methods, ok := item["supportedGenerationMethods"].([]any); ok {
		for _, method := range methods {
			if text, ok := method.(string); ok && strings.Contains(strings.ToLower(text), "vision") {
				return true
			}
		}
	}
	return false
}

func isReasoningModelID(modelID string) bool {
	lower := strings.ToLower(modelID)
	return strings.Contains(lower, "reason") || strings.Contains(lower, "thinking") || strings.Contains(lower, "r1") || strings.Contains(lower, "o1") || strings.Contains(lower, "o3")
}

func providerErrorMessage(statusCode int, body []byte) string {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err == nil {
		if message := nestedProviderErrorMessage(payload); message != "" {
			return fmt.Sprintf("服务商返回 %d：%s", statusCode, message)
		}
	}
	text := strings.TrimSpace(string(body))
	if text == "" {
		return fmt.Sprintf("服务商返回 %d", statusCode)
	}
	if len(text) > 240 {
		text = text[:240] + "..."
	}
	return fmt.Sprintf("服务商返回 %d：%s", statusCode, text)
}

func nestedProviderErrorMessage(payload map[string]any) string {
	if value, ok := payload["message"].(string); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	if errorValue, ok := payload["error"].(string); ok && strings.TrimSpace(errorValue) != "" {
		return strings.TrimSpace(errorValue)
	}
	if errorObject, ok := payload["error"].(map[string]any); ok {
		if value, ok := errorObject["message"].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
		if value, ok := errorObject["type"].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func inferContextWindowFromModelID(modelID string) int {
	match := modelIDContextPattern.FindStringSubmatch(strings.ToLower(modelID))
	if len(match) < 4 {
		return 0
	}

	value, err := strconv.ParseFloat(match[2], 64)
	if err != nil || value <= 0 {
		return 0
	}

	multiplier := 1000.0
	if match[3] == "m" {
		multiplier = 1000000.0
	}
	return int(value*multiplier + 0.5)
}
