package handlers

import (
	"context"
	"time"

	"agent-box-server/internal/logging"

	"github.com/danielgtaylor/huma/v2"
)

type LoggingSettingsInput struct {
	Body LoggingSettingsRequest
}

type LoggingSettingsOutput struct {
	Body LoggingSettingsResponse
}

type LoggingClearOutput struct {
	Body LoggingClearResponse
}

type LoggingSettingsRequest struct {
	Level string `json:"level" example:"info" doc:"Log level: debug, info, warn, or error."`
}

type LoggingSettingsResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-21T10:30:00Z" doc:"UTC response timestamp."`
	Level     string `json:"level" example:"info" doc:"Current log level."`
	LogDir    string `json:"logDir" example:"/Users/example/.agent-box/logs" doc:"Directory containing AgentBox logs."`
	LogFile   string `json:"logFile" example:"/Users/example/.agent-box/logs/agent-box.log" doc:"Current AgentBox log file."`
}

type LoggingClearResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-21T10:30:00Z" doc:"UTC response timestamp."`
	Level     string `json:"level" example:"info" doc:"Current log level after cleanup."`
	LogDir    string `json:"logDir" example:"/Users/example/.agent-box/logs" doc:"Directory containing AgentBox logs."`
	LogFile   string `json:"logFile" example:"/Users/example/.agent-box/logs/agent-box.log" doc:"Current AgentBox log file."`
	Message   string `json:"message" example:"Logs cleared." doc:"Human-readable result."`
}

var logManager *logging.Manager

func ConfigureLogManager(manager *logging.Manager) {
	logManager = manager
}

func GetLoggingSettings(ctx context.Context, input *struct{}) (*LoggingSettingsOutput, error) {
	return &LoggingSettingsOutput{Body: loggingSettingsResponse(loggingSnapshot())}, nil
}

func UpdateLoggingSettings(ctx context.Context, input *LoggingSettingsInput) (*LoggingSettingsOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("logging settings are required", nil)
	}
	if logManager == nil {
		return nil, huma.Error500InternalServerError("logging manager is not configured", nil)
	}
	snapshot, err := logManager.SetLevel(input.Body.Level)
	if err != nil {
		return nil, err
	}
	logManager.Logger().Info("log level updated", "level", snapshot.Level)
	return &LoggingSettingsOutput{Body: loggingSettingsResponse(snapshot)}, nil
}

func ClearLogs(ctx context.Context, input *struct{}) (*LoggingClearOutput, error) {
	if logManager == nil {
		return nil, huma.Error500InternalServerError("logging manager is not configured", nil)
	}
	snapshot, err := logManager.Clear()
	if err != nil {
		return nil, err
	}
	logManager.Logger().Info("logs cleared", "level", snapshot.Level)
	return &LoggingClearOutput{Body: LoggingClearResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Level:     snapshot.Level,
		LogDir:    snapshot.LogDir,
		LogFile:   snapshot.LogFile,
		Message:   "Logs cleared.",
	}}, nil
}

func loggingSnapshot() logging.Snapshot {
	if logManager == nil {
		return logging.Snapshot{Level: logging.DefaultLevel}
	}
	return logManager.Snapshot()
}

func loggingSettingsResponse(snapshot logging.Snapshot) LoggingSettingsResponse {
	return LoggingSettingsResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Level:     snapshot.Level,
		LogDir:    snapshot.LogDir,
		LogFile:   snapshot.LogFile,
	}
}
