package ccconnect

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

const ccConnectAutoStartSettingKey = "cc-connect.auto-start"

type CCConnectSettingsInput struct {
	Body CCConnectSettings
}

type CCConnectSettingsOutput struct {
	Body CCConnectSettingsResponse
}

type CCConnectSettingsResponse struct {
	Status    string            `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string            `json:"timestamp" example:"2026-05-18T10:30:00Z" doc:"UTC response timestamp."`
	Settings  CCConnectSettings `json:"settings" doc:"AgentBox-local CC-Connect preferences stored in backend SQLite."`
}

type CCConnectSettings struct {
	AutoStart bool `json:"autoStart" example:"true" doc:"Auto-start managed CC-Connect runtime when AgentBox backend starts."`
}

var ccConnectSettingsStore = struct {
	sync.RWMutex
	db *sql.DB
}{}

func ConfigureCCConnectSettingsStore(db *sql.DB) error {
	ccConnectSettingsStore.Lock()
	ccConnectSettingsStore.db = db
	ccConnectSettingsStore.Unlock()
	return ensureCCConnectSettingsSchema(db)
}

func RebuildCCConnectSettingsStore(db *sql.DB) error {
	return ConfigureCCConnectSettingsStore(db)
}

func GetCCConnectSettings(ctx context.Context, input *struct{}) (*CCConnectSettingsOutput, error) {
	return &CCConnectSettingsOutput{Body: CCConnectSettingsResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Settings:  CCConnectSettings{AutoStart: loadCCConnectAutoStart(ctx)},
	}}, nil
}

func UpdateCCConnectSettings(ctx context.Context, input *CCConnectSettingsInput) (*CCConnectSettingsOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("cc-connect settings are required", nil)
	}
	if err := saveCCConnectAutoStart(ctx, input.Body.AutoStart); err != nil {
		return nil, huma.Error500InternalServerError("write cc-connect settings failed", err)
	}
	return &CCConnectSettingsOutput{Body: CCConnectSettingsResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Settings:  CCConnectSettings{AutoStart: loadCCConnectAutoStart(ctx)},
	}}, nil
}

func AutoStartCCConnectRuntime(ctx context.Context, logger *slog.Logger) {
	if !loadCCConnectAutoStart(ctx) {
		return
	}
	go func() {
		startCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
		defer cancel()
		output, err := startManagedCCConnectRuntime(startCtx, "auto-start")
		if err != nil {
			if logger != nil {
				logger.Warn("auto-start cc-connect failed", slog.String("error", err.Error()))
			}
			return
		}
		if logger != nil {
			logger.Info("auto-started cc-connect", slog.Int("pid", output.Body.PID))
		}
	}()
}

func loadCCConnectAutoStart(ctx context.Context) bool {
	db := ccConnectSettingsDB()
	if db == nil {
		return false
	}
	if err := ensureCCConnectSettingsSchema(db); err != nil {
		return false
	}

	queryCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var value string
	err := db.QueryRowContext(queryCtx, `SELECT value FROM agent_box_settings WHERE key = ?`, ccConnectAutoStartSettingKey).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) || err != nil {
		return false
	}
	enabled, err := strconv.ParseBool(strings.TrimSpace(value))
	return err == nil && enabled
}

func saveCCConnectAutoStart(ctx context.Context, enabled bool) error {
	db := ccConnectSettingsDB()
	if db == nil {
		return nil
	}
	if err := ensureCCConnectSettingsSchema(db); err != nil {
		return err
	}

	queryCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	_, err := db.ExecContext(queryCtx, `
INSERT INTO agent_box_settings (key, value, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(key) DO UPDATE SET
	value = excluded.value,
	updated_at = excluded.updated_at`,
		ccConnectAutoStartSettingKey,
		strconv.FormatBool(enabled),
		time.Now().UTC().Format(time.RFC3339Nano),
	)
	return err
}

func ccConnectSettingsDB() *sql.DB {
	ccConnectSettingsStore.RLock()
	defer ccConnectSettingsStore.RUnlock()
	return ccConnectSettingsStore.db
}

func ensureCCConnectSettingsSchema(db *sql.DB) error {
	if db == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := db.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS agent_box_settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL,
	updated_at TEXT NOT NULL
)`)
	return err
}
