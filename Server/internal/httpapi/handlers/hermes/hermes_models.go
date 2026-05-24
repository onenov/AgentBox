package hermes

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"gopkg.in/yaml.v3"
)

type HermesModelsOutput struct {
	Body HermesModelsResponse
}

type HermesModelsInput struct {
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	Body    HermesModelsUpdateRequest
}

type HermesModelsReadInput struct {
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
}

type HermesFetchModelsInput struct {
	Body HermesFetchModelsRequest
}

type HermesFetchModelsOutput struct {
	Body HermesFetchModelsResponse
}

type HermesTestModelInput struct {
	Body HermesTestModelRequest
}

type HermesTestModelOutput struct {
	Body HermesTestModelResponse
}

type HermesModelsResponse struct {
	Status                   string                         `json:"status" example:"ok" doc:"Operation status."`
	Timestamp                string                         `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Path                     string                         `json:"path" example:"/Users/one/.hermes/config.yaml" doc:"Hermes config.yaml path."`
	Exists                   bool                           `json:"exists" example:"true" doc:"Whether config.yaml exists."`
	Agent                    HermesAgentModelSettings       `json:"agent" doc:"Agent model routing settings."`
	AuxiliaryVision          HermesAuxiliaryVisionConfig    `json:"auxiliaryVision" doc:"auxiliary.vision config used by vision_analyze and text image routing."`
	Model                    HermesModelConfig              `json:"model" doc:"Top-level model config."`
	Providers                map[string]HermesModelProvider `json:"providers" doc:"Top-level providers config normalized for editing."`
	FallbackProviders        []HermesFallbackProvider       `json:"fallbackProviders" doc:"Top-level fallback_providers config."`
	CredentialPoolStrategies map[string]any                 `json:"credentialPoolStrategies,omitempty" doc:"Top-level credential_pool_strategies config."`
	CustomProviders          []map[string]any               `json:"customProviders,omitempty" doc:"Legacy custom_providers entries when present."`
	Raw                      map[string]any                 `json:"raw,omitempty" doc:"Full parsed config object."`
}

type HermesModelsUpdateRequest struct {
	Agent                    HermesAgentModelSettings       `json:"agent" doc:"Agent model routing settings to write."`
	AuxiliaryVision          HermesAuxiliaryVisionConfig    `json:"auxiliaryVision" doc:"auxiliary.vision config to write."`
	Model                    HermesModelConfig              `json:"model" doc:"Top-level model config to write."`
	Providers                map[string]HermesModelProvider `json:"providers" doc:"Top-level providers config to write."`
	FallbackProviders        []HermesFallbackProvider       `json:"fallbackProviders" doc:"Top-level fallback_providers config to write."`
	CredentialPoolStrategies map[string]any                 `json:"credentialPoolStrategies,omitempty" doc:"Top-level credential_pool_strategies config to write."`
}

type HermesAgentModelSettings struct {
	ImageInputMode string `json:"imageInputMode,omitempty" example:"native" doc:"agent.image_input_mode: auto, native, or text."`
}

type HermesAuxiliaryVisionConfig struct {
	Provider        string         `json:"provider,omitempty" example:"openrouter" doc:"auxiliary.vision.provider."`
	Model           string         `json:"model,omitempty" example:"google/gemini-2.5-flash" doc:"auxiliary.vision.model."`
	BaseURL         string         `json:"baseUrl,omitempty" doc:"auxiliary.vision.base_url."`
	APIKey          string         `json:"apiKey,omitempty" doc:"auxiliary.vision.api_key."`
	APIMode         string         `json:"apiMode,omitempty" example:"chat_completions" doc:"auxiliary.vision.api_mode."`
	Timeout         int            `json:"timeout,omitempty" example:"120" doc:"auxiliary.vision.timeout."`
	DownloadTimeout int            `json:"downloadTimeout,omitempty" example:"30" doc:"auxiliary.vision.download_timeout."`
	ExtraBody       map[string]any `json:"extraBody,omitempty" doc:"auxiliary.vision.extra_body."`
}

type HermesModelConfig struct {
	Default  string `json:"default,omitempty" example:"gpt-5.5" doc:"model.default."`
	Provider string `json:"provider,omitempty" example:"openrouter" doc:"model.provider."`
	BaseURL  string `json:"baseUrl,omitempty" example:"https://openrouter.ai/api/v1" doc:"model.base_url."`
	APIKey   string `json:"apiKey,omitempty" doc:"model.api_key."`
	APIMode  string `json:"apiMode,omitempty" example:"chat_completions" doc:"model.api_mode."`
}

type HermesModelProvider struct {
	Key                   string                  `json:"key,omitempty" example:"local-ollama" doc:"Provider key from the providers map."`
	Name                  string                  `json:"name,omitempty" example:"Local Ollama" doc:"Provider display name."`
	BaseURL               string                  `json:"baseUrl,omitempty" example:"http://localhost:11434/v1" doc:"Provider base_url."`
	APIKey                string                  `json:"apiKey,omitempty" doc:"Provider api_key."`
	KeyEnv                string                  `json:"keyEnv,omitempty" example:"OPENAI_API_KEY" doc:"Provider key_env."`
	DefaultModel          string                  `json:"defaultModel,omitempty" example:"gpt-5.5" doc:"Provider default_model."`
	Model                 string                  `json:"model,omitempty" example:"gpt-5.5" doc:"Provider model alias when present."`
	APIMode               string                  `json:"apiMode,omitempty" example:"chat_completions" doc:"Provider api_mode."`
	RequestTimeoutSeconds int                     `json:"requestTimeoutSeconds,omitempty" example:"120" doc:"Provider request_timeout_seconds."`
	StaleTimeoutSeconds   int                     `json:"staleTimeoutSeconds,omitempty" example:"3600" doc:"Provider stale_timeout_seconds."`
	Models                []HermesModelDefinition `json:"models,omitempty" doc:"Provider models normalized as a list."`
	Raw                   map[string]any          `json:"raw,omitempty" doc:"Original provider object."`
	Extra                 map[string]any          `json:"extra,omitempty" doc:"Unrecognized provider fields preserved on write."`
}

type HermesModelDefinition struct {
	ID            string         `json:"id" example:"gpt-5.5" doc:"Model id."`
	Name          string         `json:"name,omitempty" example:"GPT 5.5" doc:"Display name."`
	ContextLength int            `json:"contextLength,omitempty" example:"196608" doc:"context_length."`
	ContextWindow int            `json:"contextWindow,omitempty" example:"196608" doc:"context_window or catalog context window."`
	MaxTokens     int            `json:"maxTokens,omitempty" example:"8192" doc:"Max output tokens when known."`
	Reasoning     bool           `json:"reasoning,omitempty" example:"true" doc:"Whether this looks like a reasoning model."`
	Input         []string       `json:"input,omitempty" doc:"Supported input modalities."`
	Raw           map[string]any `json:"raw,omitempty" doc:"Original model object."`
	Extra         map[string]any `json:"extra,omitempty" doc:"Unrecognized model fields preserved on write."`
}

type HermesFallbackProvider struct {
	Provider string `json:"provider,omitempty" example:"anthropic" doc:"Fallback provider."`
	Model    string `json:"model,omitempty" example:"claude-sonnet-4.5" doc:"Fallback model."`
	BaseURL  string `json:"baseUrl,omitempty" doc:"Fallback base_url override."`
	APIKey   string `json:"apiKey,omitempty" doc:"Fallback api_key override."`
	APIMode  string `json:"apiMode,omitempty" example:"anthropic_messages" doc:"Fallback api_mode override."`
}

type HermesFetchModelsRequest struct {
	APIMode       string `json:"apiMode,omitempty" example:"chat_completions" doc:"Hermes API mode."`
	APIKey        string `json:"apiKey,omitempty" doc:"Provider API key used only for this fetch request."`
	BaseURL       string `json:"baseUrl" example:"https://api.openai.com/v1" doc:"Provider base URL."`
	ContextLength int    `json:"contextLength,omitempty" example:"128000" doc:"Default context length when provider response does not include one."`
	MaxTokens     int    `json:"maxTokens,omitempty" example:"8192" doc:"Default max tokens when provider response does not include one."`
}

type HermesFetchModelsResponse struct {
	Status    string                  `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                  `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	SourceURL string                  `json:"sourceUrl" doc:"Resolved provider models endpoint."`
	Models    []HermesModelDefinition `json:"models" doc:"Fetched model list."`
}

type HermesTestModelRequest struct {
	APIMode string `json:"apiMode,omitempty" example:"chat_completions" doc:"Hermes API mode."`
	APIKey  string `json:"apiKey,omitempty" doc:"Provider API key used only for this test request."`
	BaseURL string `json:"baseUrl" example:"https://api.openai.com/v1" doc:"Provider base URL."`
	Model   string `json:"model" example:"gpt-5.5" doc:"Model id to test."`
}

type HermesTestModelResponse struct {
	Status     string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp  string `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	OK         bool   `json:"ok" example:"true" doc:"Whether the provider accepted the test request."`
	StatusCode int    `json:"statusCode,omitempty" example:"200" doc:"Provider HTTP status code."`
	DurationMs int64  `json:"durationMs" example:"328" doc:"Round trip duration in milliseconds."`
	Message    string `json:"message" example:"模型连通性正常" doc:"Human-readable test result."`
}

var hermesModelIDContextPattern = regexp.MustCompile(`(?i)(^|[^a-z0-9])(\d+(?:\.\d+)?)([km])([^a-z0-9]|$)`)

func GetHermesModels(ctx context.Context, input *HermesModelsReadInput) (*HermesModelsOutput, error) {
	profile := ""
	if input != nil {
		profile = input.Profile
	}
	path, err := hermesConfigPathForProfile(profile)
	if err != nil {
		return nil, err
	}
	content, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &HermesModelsOutput{Body: HermesModelsResponse{
				Status:                   "missing",
				Timestamp:                time.Now().UTC().Format(time.RFC3339),
				Path:                     path,
				Exists:                   false,
				Agent:                    HermesAgentModelSettings{ImageInputMode: "auto"},
				AuxiliaryVision:          defaultHermesAuxiliaryVisionConfig(),
				Providers:                map[string]HermesModelProvider{},
				FallbackProviders:        []HermesFallbackProvider{},
				CredentialPoolStrategies: map[string]any{},
				Raw:                      map[string]any{},
			}}, nil
		}
		return nil, huma.Error500InternalServerError("read hermes config failed", err)
	}

	config, err := parseHermesYAMLConfig(content)
	if err != nil {
		return nil, huma.Error500InternalServerError("parse hermes config failed", err)
	}

	return &HermesModelsOutput{Body: hermesModelsResponseFromConfig(path, true, config)}, nil
}

func UpdateHermesModels(ctx context.Context, input *HermesModelsInput) (*HermesModelsOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("models config is required", nil)
	}

	path, err := hermesConfigPathForProfile(input.Profile)
	if err != nil {
		return nil, err
	}
	content, err := os.ReadFile(path)
	config := map[string]any{}
	if err != nil {
		if !os.IsNotExist(err) {
			return nil, huma.Error500InternalServerError("read hermes config failed", err)
		}
	} else {
		config, err = parseHermesYAMLConfig(content)
		if err != nil {
			return nil, huma.Error500InternalServerError("parse hermes config failed", err)
		}
	}

	agent := objectMap(config["agent"])
	agent["image_input_mode"] = normalizeHermesImageInputMode(input.Body.Agent.ImageInputMode)
	config["agent"] = agent

	auxiliary := objectMap(config["auxiliary"])
	auxiliary["vision"] = hermesAuxiliaryVisionToYAML(input.Body.AuxiliaryVision)
	config["auxiliary"] = auxiliary

	config["model"] = hermesModelConfigToYAML(input.Body.Model)
	config["providers"] = hermesProvidersToYAML(input.Body.Providers)
	config["fallback_providers"] = hermesFallbackProvidersToYAML(input.Body.FallbackProviders)
	if input.Body.CredentialPoolStrategies != nil {
		config["credential_pool_strategies"] = input.Body.CredentialPoolStrategies
	}

	nextContent, err := yaml.Marshal(config)
	if err != nil {
		return nil, huma.Error500InternalServerError("serialize hermes config failed", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, huma.Error500InternalServerError("create hermes directory failed", err)
	}
	if err := os.WriteFile(path, nextContent, 0o600); err != nil {
		return nil, huma.Error500InternalServerError("write hermes config failed", err)
	}

	invalidateHermesEnvironmentCache()
	return &HermesModelsOutput{Body: hermesModelsResponseFromConfig(path, true, config)}, nil
}

func FetchHermesProviderModels(ctx context.Context, input *HermesFetchModelsInput) (*HermesFetchModelsOutput, error) {
	if input == nil || strings.TrimSpace(input.Body.BaseURL) == "" {
		return nil, huma.Error400BadRequest("baseUrl is required", nil)
	}

	endpoint, err := hermesProviderModelsEndpoint(input.Body.APIMode, input.Body.BaseURL)
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
	applyHermesProviderHeaders(req, input.Body.APIMode, strings.TrimSpace(input.Body.APIKey))

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

	models, err := parseHermesProviderModelsResponse(body, input.Body.ContextLength, input.Body.MaxTokens)
	if err != nil {
		return nil, huma.Error502BadGateway("parse provider models response failed", err)
	}
	if len(models) == 0 {
		return nil, huma.Error502BadGateway("provider models endpoint returned no models", nil)
	}

	return &HermesFetchModelsOutput{Body: HermesFetchModelsResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		SourceURL: endpoint,
		Models:    models,
	}}, nil
}

func TestHermesProviderModel(ctx context.Context, input *HermesTestModelInput) (*HermesTestModelOutput, error) {
	if input == nil || strings.TrimSpace(input.Body.BaseURL) == "" {
		return nil, huma.Error400BadRequest("baseUrl is required", nil)
	}
	if strings.TrimSpace(input.Body.Model) == "" {
		return nil, huma.Error400BadRequest("model is required", nil)
	}

	endpoint, payload, err := hermesProviderModelTestRequest(input.Body.APIMode, input.Body.BaseURL, input.Body.Model)
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
	applyHermesProviderHeaders(req, input.Body.APIMode, strings.TrimSpace(input.Body.APIKey))

	resp, err := http.DefaultClient.Do(req)
	durationMs := time.Since(start).Milliseconds()
	if err != nil {
		return &HermesTestModelOutput{Body: HermesTestModelResponse{
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
		message = hermesProviderErrorMessage(resp.StatusCode, responseBody)
	}

	return &HermesTestModelOutput{Body: HermesTestModelResponse{
		Status:     "ok",
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		OK:         ok,
		StatusCode: resp.StatusCode,
		DurationMs: durationMs,
		Message:    message,
	}}, nil
}

func parseHermesYAMLConfig(content []byte) (map[string]any, error) {
	var config map[string]any
	if err := yaml.Unmarshal(content, &config); err != nil {
		return nil, err
	}
	if config == nil {
		config = map[string]any{}
	}
	return normalizeYAMLMap(config), nil
}

func hermesModelsResponseFromConfig(path string, exists bool, config map[string]any) HermesModelsResponse {
	return HermesModelsResponse{
		Status:                   "ok",
		Timestamp:                time.Now().UTC().Format(time.RFC3339),
		Path:                     path,
		Exists:                   exists,
		Agent:                    parseHermesAgentModelSettings(config["agent"]),
		AuxiliaryVision:          parseHermesAuxiliaryVision(config["auxiliary"]),
		Model:                    parseHermesModelConfig(config["model"]),
		Providers:                parseHermesProviders(config["providers"]),
		FallbackProviders:        parseHermesFallbackProviders(config["fallback_providers"], config["fallback_model"]),
		CredentialPoolStrategies: objectMap(config["credential_pool_strategies"]),
		CustomProviders:          parseHermesCustomProviders(config["custom_providers"]),
		Raw:                      config,
	}
}

func parseHermesAgentModelSettings(value any) HermesAgentModelSettings {
	agent := objectMap(value)
	return HermesAgentModelSettings{
		ImageInputMode: normalizeHermesImageInputMode(firstString(agent["image_input_mode"], agent["imageInputMode"])),
	}
}

func parseHermesAuxiliaryVision(value any) HermesAuxiliaryVisionConfig {
	auxiliary := objectMap(value)
	vision := objectMap(auxiliary["vision"])
	if len(vision) == 0 {
		return defaultHermesAuxiliaryVisionConfig()
	}
	extraBody := objectMap(vision["extra_body"])
	if len(extraBody) == 0 {
		extraBody = objectMap(vision["extraBody"])
	}
	return HermesAuxiliaryVisionConfig{
		Provider:        firstString(vision["provider"]),
		Model:           firstString(vision["model"]),
		BaseURL:         firstString(vision["base_url"], vision["baseUrl"]),
		APIKey:          firstString(vision["api_key"], vision["apiKey"]),
		APIMode:         firstString(vision["api_mode"], vision["apiMode"]),
		Timeout:         firstPositiveInt(vision["timeout"]),
		DownloadTimeout: firstPositiveInt(vision["download_timeout"], vision["downloadTimeout"]),
		ExtraBody:       extraBody,
	}
}

func parseHermesModelConfig(value any) HermesModelConfig {
	if text := strings.TrimSpace(anyString(value)); text != "" {
		return HermesModelConfig{Default: text}
	}
	model := objectMap(value)
	return HermesModelConfig{
		Default:  firstString(model["default"], model["model"], model["name"]),
		Provider: firstString(model["provider"]),
		BaseURL:  firstString(model["base_url"], model["baseUrl"]),
		APIKey:   firstString(model["api_key"], model["apiKey"]),
		APIMode:  firstString(model["api_mode"], model["apiMode"]),
	}
}

func parseHermesProviders(value any) map[string]HermesModelProvider {
	rawProviders := objectMap(value)
	providers := make(map[string]HermesModelProvider, len(rawProviders))
	for key, value := range rawProviders {
		provider := parseHermesProvider(key, value)
		providers[key] = provider
	}
	return providers
}

func parseHermesProvider(key string, value any) HermesModelProvider {
	raw := objectMap(value)
	extra := copyStringMap(raw)
	delete(extra, "name")
	delete(extra, "base_url")
	delete(extra, "baseUrl")
	delete(extra, "api_key")
	delete(extra, "apiKey")
	delete(extra, "key_env")
	delete(extra, "keyEnv")
	delete(extra, "default_model")
	delete(extra, "defaultModel")
	delete(extra, "model")
	delete(extra, "api_mode")
	delete(extra, "apiMode")
	delete(extra, "request_timeout_seconds")
	delete(extra, "requestTimeoutSeconds")
	delete(extra, "stale_timeout_seconds")
	delete(extra, "staleTimeoutSeconds")
	delete(extra, "models")

	return HermesModelProvider{
		Key:                   key,
		Name:                  firstString(raw["name"]),
		BaseURL:               firstString(raw["base_url"], raw["baseUrl"]),
		APIKey:                firstString(raw["api_key"], raw["apiKey"]),
		KeyEnv:                firstString(raw["key_env"], raw["keyEnv"]),
		DefaultModel:          firstString(raw["default_model"], raw["defaultModel"]),
		Model:                 firstString(raw["model"]),
		APIMode:               firstString(raw["api_mode"], raw["apiMode"]),
		RequestTimeoutSeconds: firstPositiveInt(raw["request_timeout_seconds"], raw["requestTimeoutSeconds"]),
		StaleTimeoutSeconds:   firstPositiveInt(raw["stale_timeout_seconds"], raw["staleTimeoutSeconds"]),
		Models:                parseHermesModelDefinitions(raw["models"]),
		Raw:                   raw,
		Extra:                 extra,
	}
}

func parseHermesModelDefinitions(value any) []HermesModelDefinition {
	switch typed := value.(type) {
	case []any:
		models := make([]HermesModelDefinition, 0, len(typed))
		seen := map[string]bool{}
		for _, item := range typed {
			model := parseHermesModelDefinition("", item)
			if model.ID == "" || seen[model.ID] {
				continue
			}
			seen[model.ID] = true
			models = append(models, model)
		}
		return models
	default:
		rawModels := objectMap(value)
		models := make([]HermesModelDefinition, 0, len(rawModels))
		seen := map[string]bool{}
		for id, item := range rawModels {
			model := parseHermesModelDefinition(id, item)
			if model.ID == "" || seen[model.ID] {
				continue
			}
			seen[model.ID] = true
			models = append(models, model)
		}
		return models
	}
}

func parseHermesModelDefinition(id string, value any) HermesModelDefinition {
	if text := strings.TrimSpace(anyString(value)); text != "" {
		if id == "" {
			id = text
		}
		return HermesModelDefinition{ID: id, Name: text}
	}

	raw := objectMap(value)
	modelID := strings.TrimSpace(id)
	if modelID == "" {
		modelID = strings.TrimSpace(firstString(raw["id"], raw["model"]))
	}
	extra := copyStringMap(raw)
	for _, key := range []string{"id", "model", "name", "context_length", "contextLength", "context_window", "contextWindow", "max_tokens", "maxTokens", "reasoning", "input"} {
		delete(extra, key)
	}

	contextLength := firstPositiveInt(raw["context_length"], raw["contextLength"])
	contextWindow := firstPositiveInt(raw["context_window"], raw["contextWindow"])
	if contextLength == 0 {
		contextLength = contextWindow
	}
	if contextWindow == 0 {
		contextWindow = contextLength
	}
	if contextLength == 0 {
		contextLength = inferHermesContextLength(modelID)
	}

	return HermesModelDefinition{
		ID:            modelID,
		Name:          firstString(raw["name"]),
		ContextLength: contextLength,
		ContextWindow: contextWindow,
		MaxTokens:     firstPositiveInt(raw["max_tokens"], raw["maxTokens"]),
		Reasoning:     boolValue(raw["reasoning"]) || isHermesReasoningModelID(modelID),
		Input:         stringSlice(raw["input"]),
		Raw:           raw,
		Extra:         extra,
	}
}

func parseHermesFallbackProviders(values ...any) []HermesFallbackProvider {
	for _, value := range values {
		switch typed := value.(type) {
		case []any:
			fallbacks := make([]HermesFallbackProvider, 0, len(typed))
			for _, item := range typed {
				fallback := parseHermesFallbackProvider(item)
				if fallback.Provider != "" || fallback.Model != "" {
					fallbacks = append(fallbacks, fallback)
				}
			}
			return fallbacks
		case nil:
			continue
		default:
			fallback := parseHermesFallbackProvider(typed)
			if fallback.Provider != "" || fallback.Model != "" {
				return []HermesFallbackProvider{fallback}
			}
		}
	}
	return []HermesFallbackProvider{}
}

func parseHermesFallbackProvider(value any) HermesFallbackProvider {
	if text := strings.TrimSpace(anyString(value)); text != "" {
		parts := strings.SplitN(text, "/", 2)
		if len(parts) == 2 {
			return HermesFallbackProvider{Provider: strings.TrimSpace(parts[0]), Model: strings.TrimSpace(parts[1])}
		}
		return HermesFallbackProvider{Model: text}
	}
	raw := objectMap(value)
	return HermesFallbackProvider{
		Provider: firstString(raw["provider"]),
		Model:    firstString(raw["model"], raw["default"]),
		BaseURL:  firstString(raw["base_url"], raw["baseUrl"]),
		APIKey:   firstString(raw["api_key"], raw["apiKey"]),
		APIMode:  firstString(raw["api_mode"], raw["apiMode"]),
	}
}

func parseHermesCustomProviders(value any) []map[string]any {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	customProviders := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if mapped := objectMap(item); len(mapped) > 0 {
			customProviders = append(customProviders, mapped)
		}
	}
	return customProviders
}

func hermesModelConfigToYAML(model HermesModelConfig) map[string]any {
	out := map[string]any{}
	setIfNotEmpty(out, "default", model.Default)
	setIfNotEmpty(out, "provider", model.Provider)
	setIfNotEmpty(out, "base_url", model.BaseURL)
	setIfNotEmpty(out, "api_key", model.APIKey)
	setIfNotEmpty(out, "api_mode", model.APIMode)
	return out
}

func hermesAuxiliaryVisionToYAML(vision HermesAuxiliaryVisionConfig) map[string]any {
	if vision.Provider == "" && vision.Model == "" && vision.BaseURL == "" && vision.APIKey == "" && vision.APIMode == "" && vision.Timeout == 0 && vision.DownloadTimeout == 0 && vision.ExtraBody == nil {
		vision = defaultHermesAuxiliaryVisionConfig()
	}
	out := map[string]any{}
	setIfNotEmpty(out, "provider", defaultString(vision.Provider, "auto"))
	setIfNotEmpty(out, "model", vision.Model)
	setIfNotEmpty(out, "base_url", vision.BaseURL)
	setIfNotEmpty(out, "api_key", vision.APIKey)
	setIfNotEmpty(out, "api_mode", vision.APIMode)
	setIfPositive(out, "timeout", vision.Timeout)
	setIfPositive(out, "download_timeout", vision.DownloadTimeout)
	if vision.ExtraBody != nil {
		out["extra_body"] = vision.ExtraBody
	} else {
		out["extra_body"] = map[string]any{}
	}
	return out
}

func hermesProvidersToYAML(providers map[string]HermesModelProvider) map[string]any {
	out := map[string]any{}
	for key, provider := range providers {
		providerKey := strings.TrimSpace(key)
		if providerKey == "" {
			providerKey = strings.TrimSpace(provider.Key)
		}
		if providerKey == "" {
			continue
		}
		item := copyStringMap(provider.Extra)
		setIfNotEmpty(item, "name", provider.Name)
		setIfNotEmpty(item, "base_url", provider.BaseURL)
		setIfNotEmpty(item, "api_key", provider.APIKey)
		setIfNotEmpty(item, "key_env", provider.KeyEnv)
		setIfNotEmpty(item, "default_model", provider.DefaultModel)
		setIfNotEmpty(item, "model", provider.Model)
		setIfNotEmpty(item, "api_mode", provider.APIMode)
		setIfPositive(item, "request_timeout_seconds", provider.RequestTimeoutSeconds)
		setIfPositive(item, "stale_timeout_seconds", provider.StaleTimeoutSeconds)
		item["models"] = hermesModelsToYAML(provider.Models)
		out[providerKey] = item
	}
	return out
}

func hermesModelsToYAML(models []HermesModelDefinition) map[string]any {
	out := map[string]any{}
	for _, model := range models {
		id := strings.TrimSpace(model.ID)
		if id == "" {
			continue
		}
		item := copyStringMap(model.Extra)
		setIfNotEmpty(item, "name", model.Name)
		setIfPositive(item, "context_length", model.ContextLength)
		setIfPositive(item, "context_window", model.ContextWindow)
		setIfPositive(item, "max_tokens", model.MaxTokens)
		if model.Reasoning {
			item["reasoning"] = true
		}
		if len(model.Input) > 0 {
			item["input"] = model.Input
		}
		out[id] = item
	}
	return out
}

func hermesFallbackProvidersToYAML(fallbacks []HermesFallbackProvider) []map[string]any {
	out := make([]map[string]any, 0, len(fallbacks))
	for _, fallback := range fallbacks {
		item := map[string]any{}
		setIfNotEmpty(item, "provider", fallback.Provider)
		setIfNotEmpty(item, "model", fallback.Model)
		setIfNotEmpty(item, "base_url", fallback.BaseURL)
		setIfNotEmpty(item, "api_key", fallback.APIKey)
		setIfNotEmpty(item, "api_mode", fallback.APIMode)
		if len(item) > 0 {
			out = append(out, item)
		}
	}
	return out
}

func hermesProviderModelsEndpoint(apiMode string, baseURL string) (string, error) {
	if strings.TrimSpace(apiMode) == "bedrock_converse" {
		return "", fmt.Errorf("bedrock_converse does not expose an HTTP /models endpoint")
	}
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

func hermesProviderModelTestRequest(apiMode string, baseURL string, model string) (string, map[string]any, error) {
	mode := normalizeHermesAPIMode(apiMode)
	if mode == "bedrock_converse" {
		return "", nil, fmt.Errorf("bedrock_converse requires AWS SDK credentials and is not testable through this HTTP probe")
	}
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", nil, err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", nil, fmt.Errorf("unsupported scheme %q", parsed.Scheme)
	}

	modelID := strings.TrimSpace(model)
	switch mode {
	case "anthropic_messages":
		return trimmed + "/messages", map[string]any{
			"model":      modelID,
			"max_tokens": 1,
			"messages": []map[string]any{{
				"role":    "user",
				"content": "ping",
			}},
		}, nil
	case "codex_responses":
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

func applyHermesProviderHeaders(req *http.Request, apiMode string, apiKey string) {
	mode := normalizeHermesAPIMode(apiMode)
	if mode == "anthropic_messages" {
		req.Header.Set("anthropic-version", "2023-06-01")
	}
	if apiKey == "" {
		return
	}
	if mode == "anthropic_messages" {
		req.Header.Set("x-api-key", apiKey)
		return
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
}

func normalizeHermesAPIMode(apiMode string) string {
	switch strings.TrimSpace(apiMode) {
	case "anthropic_messages", "codex_responses", "bedrock_converse", "chat_completions":
		return strings.TrimSpace(apiMode)
	case "openai-responses", "openai-codex-responses":
		return "codex_responses"
	case "anthropic-messages":
		return "anthropic_messages"
	default:
		return "chat_completions"
	}
}

func parseHermesProviderModelsResponse(body []byte, defaultContextLength int, defaultMaxTokens int) ([]HermesModelDefinition, error) {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	rows, _ := payload["data"].([]any)
	if len(rows) == 0 {
		rows, _ = payload["models"].([]any)
	}

	models := make([]HermesModelDefinition, 0, len(rows))
	seen := map[string]bool{}
	for _, row := range rows {
		item, ok := row.(map[string]any)
		if !ok {
			continue
		}
		model := hermesModelFromProviderPayload(item, defaultContextLength, defaultMaxTokens)
		if model.ID == "" || seen[model.ID] {
			continue
		}
		seen[model.ID] = true
		models = append(models, model)
	}
	return models, nil
}

func hermesModelFromProviderPayload(item map[string]any, defaultContextLength int, defaultMaxTokens int) HermesModelDefinition {
	id := firstString(item["id"], item["name"], item["model"], item["key"])
	name := firstString(item["displayName"], item["display_name"], item["title"], item["name"], item["id"], item["model"])
	contextLength := firstPositiveInt(item["contextLength"], item["context_window"], item["context_length"], item["max_context_length"], item["inputTokenLimit"], item["input_token_limit"])
	if contextLength == 0 {
		contextLength = inferHermesContextLength(id)
	}
	if contextLength == 0 {
		contextLength = inferHermesContextLength(name)
	}
	if contextLength == 0 {
		contextLength = defaultContextLength
	}
	input := []string{"text"}
	if hermesModelSupportsVision(item) {
		input = []string{"text", "image"}
	}
	return HermesModelDefinition{
		ID:            strings.TrimSpace(id),
		Name:          strings.TrimSpace(name),
		ContextLength: contextLength,
		ContextWindow: contextLength,
		MaxTokens:     firstPositiveInt(item["maxTokens"], item["max_tokens"], item["outputTokenLimit"], item["output_token_limit"], defaultMaxTokens),
		Input:         input,
		Reasoning:     isHermesReasoningModelID(id),
	}
}

func hermesProviderErrorMessage(statusCode int, body []byte) string {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err == nil {
		if message := nestedHermesProviderErrorMessage(payload); message != "" {
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

func nestedHermesProviderErrorMessage(payload map[string]any) string {
	if value := firstString(payload["message"]); value != "" {
		return value
	}
	if value := firstString(payload["error"]); value != "" {
		return value
	}
	if errorObject := objectMap(payload["error"]); len(errorObject) > 0 {
		if value := firstString(errorObject["message"]); value != "" {
			return value
		}
		if value := firstString(errorObject["type"]); value != "" {
			return value
		}
	}
	return ""
}

func normalizeYAMLMap(value map[string]any) map[string]any {
	out := make(map[string]any, len(value))
	for key, item := range value {
		out[key] = normalizeYAMLValue(item)
	}
	return out
}

func normalizeYAMLValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return normalizeYAMLMap(typed)
	case map[any]any:
		out := make(map[string]any, len(typed))
		for key, item := range typed {
			out[fmt.Sprint(key)] = normalizeYAMLValue(item)
		}
		return out
	case []any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, normalizeYAMLValue(item))
		}
		return out
	default:
		return value
	}
}

func objectMap(value any) map[string]any {
	switch typed := value.(type) {
	case map[string]any:
		return typed
	case map[any]any:
		out := make(map[string]any, len(typed))
		for key, item := range typed {
			out[fmt.Sprint(key)] = normalizeYAMLValue(item)
		}
		return out
	default:
		return map[string]any{}
	}
}

func copyStringMap(value map[string]any) map[string]any {
	out := make(map[string]any, len(value))
	for key, item := range value {
		out[key] = item
	}
	return out
}

func anyString(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return text
}

func firstString(values ...any) string {
	for _, value := range values {
		if text := strings.TrimSpace(anyString(value)); text != "" {
			return text
		}
	}
	return ""
}

func firstPositiveInt(values ...any) int {
	for _, value := range values {
		switch typed := value.(type) {
		case int:
			if typed > 0 {
				return typed
			}
		case int64:
			if typed > 0 {
				return int(typed)
			}
		case float64:
			if typed > 0 {
				return int(typed)
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

func boolValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return strings.EqualFold(strings.TrimSpace(typed), "true") || strings.TrimSpace(typed) == "1"
	default:
		return false
	}
}

func stringSlice(value any) []string {
	items, ok := value.([]any)
	if !ok {
		if text := strings.TrimSpace(anyString(value)); text != "" {
			return []string{text}
		}
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if text := strings.TrimSpace(anyString(item)); text != "" {
			out = append(out, text)
		}
	}
	return out
}

func setIfNotEmpty(target map[string]any, key string, value string) {
	if strings.TrimSpace(value) != "" {
		target[key] = strings.TrimSpace(value)
	}
}

func setIfPositive(target map[string]any, key string, value int) {
	if value > 0 {
		target[key] = value
	}
}

func defaultString(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}

func normalizeHermesImageInputMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "native", "text":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "auto"
	}
}

func defaultHermesAuxiliaryVisionConfig() HermesAuxiliaryVisionConfig {
	return HermesAuxiliaryVisionConfig{
		Provider:        "auto",
		Timeout:         120,
		DownloadTimeout: 30,
		ExtraBody:       map[string]any{},
	}
}

func isHermesReasoningModelID(modelID string) bool {
	lower := strings.ToLower(modelID)
	return strings.Contains(lower, "reason") || strings.Contains(lower, "thinking") || strings.Contains(lower, "r1") || strings.Contains(lower, "o1") || strings.Contains(lower, "o3") || strings.Contains(lower, "o4")
}

func hermesModelSupportsVision(item map[string]any) bool {
	for _, key := range []string{"input", "modalities", "supported_input_modalities"} {
		for _, value := range stringSlice(item[key]) {
			lower := strings.ToLower(value)
			if strings.Contains(lower, "image") || strings.Contains(lower, "vision") {
				return true
			}
		}
	}
	return false
}

func inferHermesContextLength(modelID string) int {
	match := hermesModelIDContextPattern.FindStringSubmatch(strings.ToLower(modelID))
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
