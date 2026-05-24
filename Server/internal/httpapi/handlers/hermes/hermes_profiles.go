package hermes

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"time"

	"agent-box-server/internal/httpapi/toolenv"

	"github.com/danielgtaylor/huma/v2"
)

type HermesProfileQueryInput struct {
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile from ~/.hermes/active_profile." example:"default"`
}

type HermesProfileSelection struct {
	Name      string `json:"name" example:"default" doc:"Resolved Hermes profile name."`
	Path      string `json:"path" example:"/Users/one/.hermes" doc:"Resolved Hermes home path for this profile."`
	IsDefault bool   `json:"isDefault" example:"true" doc:"Whether this is the root default profile."`
	IsActive  bool   `json:"isActive" example:"true" doc:"Whether this profile is the sticky active profile."`
}

func resolveHermesProfileSelection(profile string) (HermesProfileSelection, error) {
	selection, err := resolveHermesProfileCandidate(profile)
	if err != nil {
		return HermesProfileSelection{}, err
	}
	if !pathExists(selection.Path) {
		return HermesProfileSelection{}, huma.Error404NotFound("Hermes profile not found", nil)
	}

	return selection, nil
}

func resolveHermesProfileCandidate(profile string) (HermesProfileSelection, error) {
	root := hermesDefaultRootDir()
	active := readHermesActiveProfileName(root)
	requested := strings.TrimSpace(profile)
	if requested == "" {
		requested = active
	}
	name, err := normalizeHermesProfileName(requested)
	if err != nil {
		return HermesProfileSelection{}, err
	}
	if err := validateHermesProfileName(name, true); err != nil {
		return HermesProfileSelection{}, err
	}

	path := hermesProfileDir(name)
	return HermesProfileSelection{
		Name:      name,
		Path:      path,
		IsDefault: name == "default",
		IsActive:  name == active,
	}, nil
}

func hermesConfigPathForProfile(profile string) (string, error) {
	selection, err := resolveHermesProfileSelection(profile)
	if err != nil {
		return "", err
	}
	return filepath.Join(selection.Path, "config.yaml"), nil
}

func hermesEnvPathForProfile(profile string) (string, error) {
	selection, err := resolveHermesProfileSelection(profile)
	if err != nil {
		return "", err
	}
	return filepath.Join(selection.Path, ".env"), nil
}

func hermesCommandWithProfile(ctx context.Context, timeout time.Duration, profile string, args ...string) (string, string, error) {
	selection, err := resolveHermesProfileSelection(profile)
	if err != nil {
		return "", "", err
	}
	if selection.Name != "default" {
		args = append([]string{"-p", selection.Name}, args...)
	}

	return hermesCommand(ctx, timeout, args...)
}

func hermesCommandEnvForProfile(profile HermesProfileSelection) []string {
	env := toolenv.CommandEnv()
	env = append(env, "HERMES_HOME="+profile.Path)
	if profile.Name != "default" {
		env = append(env, "HERMES_PROFILE="+profile.Name)
	}
	return env
}

func hermesPythonCommandForProfile(ctx context.Context, timeout time.Duration, profile HermesProfileSelection, script string, args ...string) (string, string, error) {
	return hermesPythonCommandWithEnv(ctx, timeout, hermesCommandEnvForProfile(profile), script, args...)
}

func ensureHermesProfileDir(path string) error {
	return os.MkdirAll(path, 0o755)
}
