package app

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"agent-box-server/internal/config"
	"agent-box-server/internal/httpapi"
	"agent-box-server/internal/httpapi/handlers"
	ccconnecthandlers "agent-box-server/internal/httpapi/handlers/ccconnect"
	hermeshandlers "agent-box-server/internal/httpapi/handlers/hermes"
	openclawhandlers "agent-box-server/internal/httpapi/handlers/openclaw"
	"agent-box-server/internal/logging"
	"agent-box-server/internal/realtime"
	"agent-box-server/internal/storage"
)

type App struct {
	AuthConfig *config.BackendAuthStore
	Config     config.Config
	Logger     *slog.Logger
	LogManager *logging.Manager
	Store      *storage.Store
	Server     *http.Server
}

func New(ctx context.Context) (*App, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, fmt.Errorf("load config: %w", err)
	}

	logManager, err := logging.NewManager(config.DefaultDataDir(), cfg.LogLevel)
	if err != nil {
		return nil, fmt.Errorf("configure logging: %w", err)
	}
	logger := logManager.Logger()
	slog.SetDefault(logger)

	store, err := storage.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		_ = logManager.Close()
		return nil, err
	}

	authConfig, err := config.LoadBackendAuthConfig(cfg.AuthConfigPath, config.BackendAddress(cfg), cfg.AuthDefaultToken)
	if err != nil {
		_ = store.Close()
		_ = logManager.Close()
		return nil, fmt.Errorf("load auth config: %w", err)
	}
	if err := hermeshandlers.ConfigureHermesTerminalStore(store.DB()); err != nil {
		_ = store.Close()
		_ = logManager.Close()
		return nil, fmt.Errorf("configure hermes terminal store: %w", err)
	}
	if err := ccconnecthandlers.ConfigureCCConnectSettingsStore(store.DB()); err != nil {
		_ = store.Close()
		_ = logManager.Close()
		return nil, fmt.Errorf("configure cc-connect settings store: %w", err)
	}
	if err := ccconnecthandlers.ConfigureCCConnectTerminalStore(store.DB()); err != nil {
		_ = store.Close()
		_ = logManager.Close()
		return nil, fmt.Errorf("configure cc-connect terminal store: %w", err)
	}
	handlers.ConfigureMaintenanceStore(store.DB())
	handlers.ConfigureMaintenanceSQLiteRebuildHooks(hermeshandlers.RebuildHermesTerminalStore, ccconnecthandlers.RebuildCCConnectSettingsStore, ccconnecthandlers.RebuildCCConnectTerminalStore)
	handlers.ConfigureLogManager(logManager)

	hub := realtime.NewHub(logger)
	router := httpapi.NewRouter(httpapi.RouterOptions{AuthConfig: authConfig, RealtimeHub: hub})
	server := &http.Server{
		Addr:              cfg.Host + ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
	}
	ccconnecthandlers.AutoStartCCConnectRuntime(ctx, logger)
	openclawhandlers.EnsureOpenClawControlUIAllowedOrigins(ctx, cfg.Host, cfg.Port, logger)
	go openclawhandlers.EnsureOpenClawControlUIDeviceAuthDisabled(ctx, logger)

	return &App{
		AuthConfig: authConfig,
		Config:     cfg,
		Logger:     logger,
		LogManager: logManager,
		Store:      store,
		Server:     server,
	}, nil
}

func (a *App) Close() error {
	if a.AuthConfig != nil {
		_ = a.AuthConfig.Close()
	}
	if a.Store != nil {
		if err := a.Store.Close(); err != nil {
			if a.LogManager != nil {
				_ = a.LogManager.Close()
			}
			return err
		}
	}
	if a.LogManager != nil {
		return a.LogManager.Close()
	}
	return nil
}
