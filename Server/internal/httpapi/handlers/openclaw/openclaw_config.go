package openclaw

// OpenClawConfig handler 用于读取和更新当前主机上的 OpenClaw 配置文件。
//
// 该接口固定使用 /openclaw/config 路径，读取默认 OpenClaw home 下的 openclaw.json，
// 更新时会先校验请求体必须是合法 JSON，再以格式化后的内容写回配置文件。
//
// 接口面向本地管理中心使用，不负责生成默认配置，也不返回或单独解析敏感字段。

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

type OpenClawConfigOutput struct {
	Body OpenClawConfigResponse
}

type OpenClawConfigInput struct {
	Body OpenClawConfigRequest
}

type OpenClawConfigResponse struct {
	Status    string         `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string         `json:"timestamp" example:"2026-05-11T15:59:00Z" doc:"UTC response timestamp."`
	Path      string         `json:"path" example:"/Users/one/.openclaw/openclaw.json" doc:"OpenClaw config file path."`
	Exists    bool           `json:"exists" example:"true" doc:"Whether the config file exists."`
	Content   map[string]any `json:"content,omitempty" doc:"Parsed OpenClaw config JSON content."`
}

type OpenClawConfigRequest struct {
	Content map[string]any `json:"content" doc:"Full OpenClaw config JSON content to write."`
}

func GetOpenClawConfig(ctx context.Context, input *struct{}) (*OpenClawConfigOutput, error) {
	configPath := openClawConfigPath()
	content, exists, err := readOpenClawConfigFile(configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &OpenClawConfigOutput{Body: OpenClawConfigResponse{
				Status:    "missing",
				Timestamp: time.Now().UTC().Format(time.RFC3339),
				Path:      configPath,
				Exists:    false,
			}}, nil
		}
		return nil, huma.Error500InternalServerError("read openclaw config failed", err)
	}

	return &OpenClawConfigOutput{Body: OpenClawConfigResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Path:      configPath,
		Exists:    exists,
		Content:   content,
	}}, nil
}

func UpdateOpenClawConfig(ctx context.Context, input *OpenClawConfigInput) (*OpenClawConfigOutput, error) {
	if input == nil || input.Body.Content == nil {
		return nil, huma.Error400BadRequest("config content is required", nil)
	}

	configPath := openClawConfigPath()
	formatted, err := json.MarshalIndent(input.Body.Content, "", "  ")
	if err != nil {
		return nil, huma.Error400BadRequest("config content must be valid JSON", err)
	}
	formatted = append(formatted, '\n')

	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		return nil, huma.Error500InternalServerError("create openclaw config directory failed", err)
	}
	if err := os.WriteFile(configPath, formatted, 0o600); err != nil {
		return nil, huma.Error500InternalServerError("write openclaw config failed", err)
	}

	return &OpenClawConfigOutput{Body: OpenClawConfigResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Path:      configPath,
		Exists:    true,
		Content:   input.Body.Content,
	}}, nil
}

func openClawConfigPath() string {
	return filepath.Join(defaultOpenClawHomeDir(), "openclaw.json")
}

func readOpenClawConfigFile(configPath string) (map[string]any, bool, error) {
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, false, err
	}

	var content map[string]any
	if err := json.Unmarshal(data, &content); err != nil {
		return nil, true, err
	}
	if content == nil {
		content = map[string]any{}
	}
	return content, true, nil
}
