package ccconnect

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

type CCConnectFetchModelsInput struct {
	Body CCConnectFetchModelsRequest
}

type CCConnectFetchModelsOutput struct {
	Body CCConnectFetchModelsResponse
}

type CCConnectTestModelInput struct {
	Body CCConnectTestModelRequest
}

type CCConnectTestModelOutput struct {
	Body CCConnectTestModelResponse
}

type CCConnectFetchModelsRequest struct {
	APIKey        string `json:"apiKey,omitempty" doc:"Provider API key used only for this fetch request."`
	BaseURL       string `json:"baseUrl" example:"https://api.openai.com/v1" doc:"Provider base URL."`
	ContextLength int    `json:"contextLength,omitempty" example:"128000" doc:"Default context length when provider response does not include one."`
	MaxTokens     int    `json:"maxTokens,omitempty" example:"8192" doc:"Default max tokens when provider response does not include one."`
	WireAPI       string `json:"wireApi,omitempty" example:"responses" doc:"Codex wire_api override. Empty means OpenAI chat completions."`
}

type CCConnectFetchModelsResponse struct {
	Status    string                  `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                  `json:"timestamp" example:"2026-05-18T10:30:00Z" doc:"UTC response timestamp."`
	SourceURL string                  `json:"sourceUrl" doc:"Resolved provider models endpoint."`
	Models    []CCConnectFetchedModel `json:"models" doc:"Fetched model list."`
}

type CCConnectTestModelRequest struct {
	APIKey  string `json:"apiKey,omitempty" doc:"Provider API key used only for this test request."`
	BaseURL string `json:"baseUrl" example:"https://api.openai.com/v1" doc:"Provider base URL."`
	Model   string `json:"model" example:"gpt-5.5" doc:"Model id to test."`
	WireAPI string `json:"wireApi,omitempty" example:"responses" doc:"Codex wire_api override. Empty means OpenAI chat completions."`
}

type CCConnectTestModelResponse struct {
	Status     string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp  string `json:"timestamp" example:"2026-05-18T10:30:00Z" doc:"UTC response timestamp."`
	OK         bool   `json:"ok" example:"true" doc:"Whether the provider accepted the test request."`
	StatusCode int    `json:"statusCode,omitempty" example:"200" doc:"Provider HTTP status code."`
	DurationMs int64  `json:"durationMs" example:"328" doc:"Round trip duration in milliseconds."`
	Message    string `json:"message" example:"模型连通性正常" doc:"Human-readable test result."`
}

type CCConnectFetchedModel struct {
	ContextLength int            `json:"contextLength,omitempty" example:"128000" doc:"Context length when known."`
	ContextWindow int            `json:"contextWindow,omitempty" example:"128000" doc:"Context window when known."`
	ID            string         `json:"id" example:"gpt-5.5" doc:"Model id."`
	Input         []string       `json:"input,omitempty" doc:"Supported input modalities."`
	MaxTokens     int            `json:"maxTokens,omitempty" example:"8192" doc:"Max output tokens when known."`
	Name          string         `json:"name,omitempty" example:"GPT 5.5" doc:"Display name."`
	Raw           map[string]any `json:"raw,omitempty" doc:"Original model object."`
	Reasoning     bool           `json:"reasoning,omitempty" example:"true" doc:"Whether this looks like a reasoning model."`
}

var ccConnectModelIDContextPattern = regexp.MustCompile(`(?i)(^|[^a-z0-9])(\d+(?:\.\d+)?)([km])([^a-z0-9]|$)`)

func FetchCCConnectProviderModels(ctx context.Context, input *CCConnectFetchModelsInput) (*CCConnectFetchModelsOutput, error) {
	if input == nil || strings.TrimSpace(input.Body.BaseURL) == "" {
		return nil, huma.Error400BadRequest("baseUrl is required", nil)
	}

	endpoint, err := ccConnectProviderModelsEndpoint(input.Body.BaseURL)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid provider models endpoint", err)
	}

	reqCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid provider models endpoint", err)
	}
	req.Header.Set("Accept", "application/json")
	ccConnectApplyProviderHeaders(req, strings.TrimSpace(input.Body.APIKey))

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

	models, err := ccConnectParseProviderModelsResponse(body, input.Body.ContextLength, input.Body.MaxTokens)
	if err != nil {
		return nil, huma.Error502BadGateway("parse provider models response failed", err)
	}
	if len(models) == 0 {
		return nil, huma.Error502BadGateway("provider models endpoint returned no models", nil)
	}

	return &CCConnectFetchModelsOutput{Body: CCConnectFetchModelsResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		SourceURL: endpoint,
		Models:    models,
	}}, nil
}

func TestCCConnectProviderModel(ctx context.Context, input *CCConnectTestModelInput) (*CCConnectTestModelOutput, error) {
	if input == nil || strings.TrimSpace(input.Body.BaseURL) == "" {
		return nil, huma.Error400BadRequest("baseUrl is required", nil)
	}
	if strings.TrimSpace(input.Body.Model) == "" {
		return nil, huma.Error400BadRequest("model is required", nil)
	}

	endpoint, payload, err := ccConnectProviderModelTestRequest(input.Body.BaseURL, input.Body.Model, input.Body.WireAPI)
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
	ccConnectApplyProviderHeaders(req, strings.TrimSpace(input.Body.APIKey))

	resp, err := http.DefaultClient.Do(req)
	durationMs := time.Since(start).Milliseconds()
	if err != nil {
		return &CCConnectTestModelOutput{Body: CCConnectTestModelResponse{
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
		message = ccConnectProviderErrorMessage(resp.StatusCode, responseBody)
	}

	return &CCConnectTestModelOutput{Body: CCConnectTestModelResponse{
		Status:     "ok",
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		OK:         ok,
		StatusCode: resp.StatusCode,
		DurationMs: durationMs,
		Message:    message,
	}}, nil
}

func ccConnectProviderModelsEndpoint(baseURL string) (string, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("unsupported scheme %q", parsed.Scheme)
	}
	return trimmed + "/models", nil
}

func ccConnectProviderModelTestRequest(baseURL string, model string, wireAPI string) (string, map[string]any, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", nil, err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", nil, fmt.Errorf("unsupported scheme %q", parsed.Scheme)
	}

	modelID := strings.TrimSpace(model)
	if strings.TrimSpace(wireAPI) == "responses" {
		return trimmed + "/responses", map[string]any{
			"input":             "ping",
			"max_output_tokens": 1,
			"model":             modelID,
			"stream":            false,
		}, nil
	}
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

func ccConnectApplyProviderHeaders(req *http.Request, apiKey string) {
	if apiKey == "" {
		return
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
}

func ccConnectParseProviderModelsResponse(body []byte, defaultContextLength int, defaultMaxTokens int) ([]CCConnectFetchedModel, error) {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}

	rows, _ := payload["data"].([]any)
	if len(rows) == 0 {
		rows, _ = payload["models"].([]any)
	}

	models := make([]CCConnectFetchedModel, 0, len(rows))
	seen := map[string]bool{}
	for _, row := range rows {
		item, ok := row.(map[string]any)
		if !ok {
			continue
		}
		model := ccConnectModelFromProviderPayload(item, defaultContextLength, defaultMaxTokens)
		if model.ID == "" || seen[model.ID] {
			continue
		}
		seen[model.ID] = true
		models = append(models, model)
	}
	return models, nil
}

func ccConnectModelFromProviderPayload(item map[string]any, defaultContextLength int, defaultMaxTokens int) CCConnectFetchedModel {
	id := ccConnectFirstNonEmptyString(item["id"], item["name"], item["model"], item["key"])
	name := ccConnectFirstNonEmptyString(item["displayName"], item["display_name"], item["title"], item["name"], item["id"], item["model"])
	contextLength := ccConnectFirstPositiveInt(item["contextWindow"], item["context_window"], item["context_length"], item["max_context_length"], item["inputTokenLimit"], item["input_token_limit"])
	maxTokens := ccConnectFirstPositiveInt(
		item["maxTokens"],
		item["max_tokens"],
		item["outputTokenLimit"],
		item["output_token_limit"],
		ccConnectNestedValue(item, "top_provider", "max_completion_tokens"),
		ccConnectNestedValue(item, "topProvider", "maxCompletionTokens"),
	)
	if contextLength == 0 {
		contextLength = ccConnectInferContextWindowFromModelID(id)
	}
	if contextLength == 0 {
		contextLength = ccConnectInferContextWindowFromModelID(name)
	}
	if contextLength == 0 {
		contextLength = defaultContextLength
	}
	if maxTokens == 0 {
		maxTokens = defaultMaxTokens
	}

	input := []string{"text"}
	if ccConnectModelSupportsVision(item) {
		input = []string{"text", "image"}
	}

	return CCConnectFetchedModel{
		ContextLength: contextLength,
		ContextWindow: contextLength,
		ID:            strings.TrimSpace(id),
		Input:         input,
		MaxTokens:     maxTokens,
		Name:          strings.TrimSpace(name),
		Raw:           item,
		Reasoning:     ccConnectIsReasoningModelID(id),
	}
}

func ccConnectFirstNonEmptyString(values ...any) string {
	for _, value := range values {
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text)
		}
	}
	return ""
}

func ccConnectFirstPositiveInt(values ...any) int {
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
			parsed, err := strconv.Atoi(strings.TrimSpace(typed))
			if err == nil && parsed > 0 {
				return parsed
			}
		}
	}
	return 0
}

func ccConnectNestedValue(item map[string]any, keys ...string) any {
	current := any(item)
	for _, key := range keys {
		object, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = object[key]
	}
	return current
}

func ccConnectModelSupportsVision(item map[string]any) bool {
	for _, value := range []any{
		item["input"],
		item["modalities"],
		item["supported_input_modalities"],
		ccConnectNestedValue(item, "architecture", "input_modalities"),
		ccConnectNestedValue(item, "architecture", "inputModalities"),
	} {
		if ccConnectValueContainsVision(value) {
			return true
		}
	}
	return ccConnectValueContainsVision(item["modality"]) || ccConnectValueContainsVision(ccConnectNestedValue(item, "architecture", "modality"))
}

func ccConnectValueContainsVision(value any) bool {
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			if ccConnectValueContainsVision(item) {
				return true
			}
		}
	case []string:
		for _, item := range typed {
			if ccConnectValueContainsVision(item) {
				return true
			}
		}
	case string:
		lower := strings.ToLower(typed)
		return strings.Contains(lower, "image") || strings.Contains(lower, "vision")
	}
	return false
}

func ccConnectIsReasoningModelID(modelID string) bool {
	lower := strings.ToLower(modelID)
	return strings.Contains(lower, "reason") || strings.Contains(lower, "thinking") || strings.Contains(lower, "r1") || strings.Contains(lower, "o1") || strings.Contains(lower, "o3")
}

func ccConnectProviderErrorMessage(statusCode int, body []byte) string {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err == nil {
		if message := ccConnectNestedProviderErrorMessage(payload); message != "" {
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

func ccConnectNestedProviderErrorMessage(payload map[string]any) string {
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

func ccConnectInferContextWindowFromModelID(modelID string) int {
	match := ccConnectModelIDContextPattern.FindStringSubmatch(strings.ToLower(modelID))
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
