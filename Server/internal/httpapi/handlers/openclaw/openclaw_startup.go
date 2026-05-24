package openclaw

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/exec"
	"strings"

	"agent-box-server/internal/httpapi/toolenv"
)

func EnsureOpenClawControlUIDeviceAuthDisabled(ctx context.Context, logger *slog.Logger) {
	changed, err := ensureOpenClawControlUIDeviceAuthDisabled()
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) && logger != nil {
			logger.WarnContext(ctx, "enable OpenClaw Control UI device auth bypass", slog.String("error", err.Error()))
		}
		return
	}
	if !changed {
		return
	}

	if logger != nil {
		logger.InfoContext(ctx, "enabled OpenClaw Control UI device auth bypass")
	}

	output, err := RestartOpenClawGateway(ctx, nil)
	if err != nil {
		if logger != nil {
			logger.WarnContext(ctx, "restart OpenClaw Gateway after enabling device auth bypass", slog.String("error", err.Error()))
		}
		return
	}
	if logger != nil {
		logger.InfoContext(ctx, "restarted OpenClaw Gateway after enabling device auth bypass", slog.String("message", output.Body.Message))
	}
}

func ensureOpenClawControlUIDeviceAuthDisabled() (bool, error) {
	if !openClawCLIAvailableForStartup() {
		return false, os.ErrNotExist
	}

	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		return false, err
	}

	gateway := ensureMapValue(content, "gateway")
	controlUI := ensureMapValue(gateway, "controlUi")
	if boolFromValueDefault(controlUI["dangerouslyDisableDeviceAuth"], false) {
		return false, nil
	}

	controlUI["dangerouslyDisableDeviceAuth"] = true
	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return false, err
	}
	invalidateOpenClawEnvironmentCache()
	return true, nil
}

func openClawCLIAvailableForStartup() bool {
	if strings.TrimSpace(toolenv.ResolveToolPath("openclaw")) != "" {
		return true
	}
	_, err := exec.LookPath("openclaw")
	return err == nil
}
