package hermes

import (
	"context"
	"os"
	"path/filepath"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

type HermesTextFileOutput struct {
	Body HermesTextFileResponse
}

type HermesTextFileInput struct {
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	Body    HermesTextFileRequest
}

type HermesTextFileReadInput struct {
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
}

type HermesTextFileResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Path      string `json:"path" example:"/Users/one/.hermes/config.yaml" doc:"File path."`
	Exists    bool   `json:"exists" example:"true" doc:"Whether the file exists."`
	Content   string `json:"content" doc:"Raw file content."`
}

type HermesTextFileRequest struct {
	Content string `json:"content" doc:"Raw file content to write."`
}

func GetHermesConfig(ctx context.Context, input *HermesTextFileReadInput) (*HermesTextFileOutput, error) {
	profile := ""
	if input != nil {
		profile = input.Profile
	}
	path, err := hermesConfigPathForProfile(profile)
	if err != nil {
		return nil, err
	}
	return readHermesTextFile(path, "config.yaml")
}

func UpdateHermesConfig(ctx context.Context, input *HermesTextFileInput) (*HermesTextFileOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("config content is required", nil)
	}
	path, err := hermesConfigPathForProfile(input.Profile)
	if err != nil {
		return nil, err
	}
	return writeHermesTextFile(path, input.Body.Content, "write hermes config failed")
}

func GetHermesEnv(ctx context.Context, input *HermesTextFileReadInput) (*HermesTextFileOutput, error) {
	profile := ""
	if input != nil {
		profile = input.Profile
	}
	path, err := hermesEnvPathForProfile(profile)
	if err != nil {
		return nil, err
	}
	return readHermesTextFile(path, ".env")
}

func UpdateHermesEnv(ctx context.Context, input *HermesTextFileInput) (*HermesTextFileOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("env content is required", nil)
	}
	path, err := hermesEnvPathForProfile(input.Profile)
	if err != nil {
		return nil, err
	}
	return writeHermesTextFile(path, input.Body.Content, "write hermes env failed")
}

func readHermesTextFile(path string, label string) (*HermesTextFileOutput, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &HermesTextFileOutput{Body: HermesTextFileResponse{
				Status:    "missing",
				Timestamp: time.Now().UTC().Format(time.RFC3339),
				Path:      path,
				Exists:    false,
				Content:   "",
			}}, nil
		}
		return nil, huma.Error500InternalServerError("read hermes "+label+" failed", err)
	}

	return &HermesTextFileOutput{Body: HermesTextFileResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Path:      path,
		Exists:    true,
		Content:   string(content),
	}}, nil
}

func writeHermesTextFile(path string, content string, errorMessage string) (*HermesTextFileOutput, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, huma.Error500InternalServerError("create hermes directory failed", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return nil, huma.Error500InternalServerError(errorMessage, err)
	}

	invalidateHermesEnvironmentCache()
	return &HermesTextFileOutput{Body: HermesTextFileResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Path:      path,
		Exists:    true,
		Content:   content,
	}}, nil
}

func hermesConfigPath() string {
	home, _ := defaultHermesHomeDir()
	return filepath.Join(home, "config.yaml")
}

func hermesEnvPath() string {
	home, _ := defaultHermesHomeDir()
	return filepath.Join(home, ".env")
}
