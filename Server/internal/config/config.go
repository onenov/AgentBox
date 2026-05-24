package config

import (
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/caarlos0/env/v11"
)

const (
	DefaultModelCatalogURL        = "https://agent.orence.net/releases/models.json"
	DefaultModelInitializationURL = "https://agent.orence.net/releases/model-initialization.json"
)

type Config struct {
	Env                      string        `env:"APP_ENV" envDefault:"development"`
	Host                     string        `env:"SERVER_HOST" envDefault:"127.0.0.1"`
	Port                     string        `env:"SERVER_PORT" envDefault:"8787"`
	ReadTimeout              time.Duration `env:"SERVER_READ_TIMEOUT" envDefault:"15s"`
	WriteTimeout             time.Duration `env:"SERVER_WRITE_TIMEOUT" envDefault:"20m"`
	ShutdownTimeout          time.Duration `env:"SERVER_SHUTDOWN_TIMEOUT" envDefault:"10s"`
	DatabaseURL              string        `env:"DATABASE_URL"`
	AuthConfigPath           string        `env:"AUTH_CONFIG_PATH"`
	AuthDefaultToken         string        `env:"AUTH_DEFAULT_TOKEN"`
	OpenClawPublicGatewayURL string        `env:"OPENCLAW_PUBLIC_GATEWAY_URL"`
	AgentBoxPublicURL        string        `env:"AGENTBOX_PUBLIC_URL"`
	LogLevel                 string        `env:"LOG_LEVEL" envDefault:"info"`
	ModelCatalogURL          string        `env:"MODEL_CATALOG_URL" envDefault:"https://agent.orence.net/releases/models.json"`
	ModelInitializationURL   string        `env:"MODEL_INITIALIZATION_URL" envDefault:"https://agent.orence.net/releases/model-initialization.json"`
}

var (
	currentConfigMu     sync.RWMutex
	currentConfig       Config
	currentConfigLoaded bool
)

func Load() (Config, error) {
	if err := loadExecutableDirDotEnv(); err != nil {
		return Config{}, err
	}
	cfg, err := env.ParseAs[Config]()
	if err != nil {
		return cfg, err
	}
	if cfg.DatabaseURL == "" {
		cfg.DatabaseURL = defaultDatabaseURL()
	}
	if cfg.AuthConfigPath == "" {
		cfg.AuthConfigPath = defaultAuthConfigPath()
	}
	if cfg.ModelCatalogURL == "" {
		cfg.ModelCatalogURL = DefaultModelCatalogURL
	}
	if cfg.ModelInitializationURL == "" {
		cfg.ModelInitializationURL = DefaultModelInitializationURL
	}
	setCurrent(cfg)
	return cfg, nil
}

func Current() Config {
	currentConfigMu.RLock()
	if currentConfigLoaded {
		cfg := currentConfig
		currentConfigMu.RUnlock()
		return cfg
	}
	currentConfigMu.RUnlock()

	return Config{
		ModelCatalogURL:          envOrDefault("MODEL_CATALOG_URL", DefaultModelCatalogURL),
		ModelInitializationURL:   envOrDefault("MODEL_INITIALIZATION_URL", DefaultModelInitializationURL),
		OpenClawPublicGatewayURL: strings.TrimSpace(os.Getenv("OPENCLAW_PUBLIC_GATEWAY_URL")),
		AgentBoxPublicURL:        strings.TrimSpace(os.Getenv("AGENTBOX_PUBLIC_URL")),
	}
}

func setCurrent(cfg Config) {
	currentConfigMu.Lock()
	defer currentConfigMu.Unlock()
	currentConfig = cfg
	currentConfigLoaded = true
}

func envOrDefault(key string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func defaultDatabaseURL() string {
	return "file:" + filepath.ToSlash(filepath.Join(DefaultDataDir(), "data.db"))
}

func defaultAuthConfigPath() string {
	return filepath.Join(DefaultDataDir(), "auth.json")
}

func DefaultDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return filepath.Join("data")
	}
	return filepath.Join(home, ".agent-box")
}

func BackendAddress(cfg Config) string {
	host := cfg.Host
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, cfg.Port)
}

func SlogLevel(level string) slog.Level {
	switch level {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
