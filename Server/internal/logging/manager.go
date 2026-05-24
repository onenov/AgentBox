package logging

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	DefaultLevel = "info"
	logFileName  = "agent-box.log"
	settingsName = "settings.json"
)

type Manager struct {
	dir          string
	filePath     string
	settingsPath string
	level        slog.LevelVar
	logger       *slog.Logger
	writer       *fileWriter
	mu           sync.Mutex
}

type Settings struct {
	Level string `json:"level"`
}

type Snapshot struct {
	Level   string `json:"level"`
	LogDir  string `json:"logDir"`
	LogFile string `json:"logFile"`
}

func NewManager(dataDir, configuredLevel string) (*Manager, error) {
	dir := filepath.Join(dataDir, "logs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create logs dir: %w", err)
	}

	m := &Manager{
		dir:          dir,
		filePath:     filepath.Join(dir, logFileName),
		settingsPath: filepath.Join(dir, settingsName),
	}
	level := normalizeLevel(configuredLevel)
	if savedLevel, err := m.readSavedLevel(); err == nil && savedLevel != "" {
		level = savedLevel
	}
	m.level.Set(SlogLevel(level))

	m.writer = &fileWriter{path: m.filePath}
	if err := m.writer.open(); err != nil {
		return nil, err
	}
	m.logger = slog.New(slog.NewTextHandler(io.MultiWriter(os.Stdout, m.writer), &slog.HandlerOptions{
		Level: &m.level,
	}))
	return m, nil
}

func (m *Manager) Logger() *slog.Logger {
	if m == nil || m.logger == nil {
		return slog.Default()
	}
	return m.logger
}

func (m *Manager) Snapshot() Snapshot {
	if m == nil {
		return Snapshot{Level: DefaultLevel}
	}
	return Snapshot{
		Level:   LevelName(m.level.Level()),
		LogDir:  m.dir,
		LogFile: m.filePath,
	}
}

func (m *Manager) SetLevel(level string) (Snapshot, error) {
	if m == nil {
		return Snapshot{Level: DefaultLevel}, nil
	}
	normalized := normalizeLevel(level)
	m.level.Set(SlogLevel(normalized))
	if err := m.writeSettings(normalized); err != nil {
		return m.Snapshot(), err
	}
	return m.Snapshot(), nil
}

func (m *Manager) Clear() (Snapshot, error) {
	if m == nil {
		return Snapshot{Level: DefaultLevel}, nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if m.writer != nil {
		if err := m.writer.close(); err != nil {
			return m.Snapshot(), err
		}
	}

	entries, err := os.ReadDir(m.dir)
	if err != nil {
		return m.Snapshot(), fmt.Errorf("read logs dir: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || entry.Name() == settingsName {
			continue
		}
		if err := os.Remove(filepath.Join(m.dir, entry.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
			return m.Snapshot(), fmt.Errorf("remove log file %s: %w", entry.Name(), err)
		}
	}

	if err := m.writer.open(); err != nil {
		return m.Snapshot(), err
	}
	return m.Snapshot(), nil
}

func (m *Manager) Close() error {
	if m == nil || m.writer == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.writer.close()
}

func (m *Manager) readSavedLevel() (string, error) {
	data, err := os.ReadFile(m.settingsPath)
	if err != nil {
		return "", err
	}
	var settings Settings
	if err := json.Unmarshal(data, &settings); err != nil {
		return "", err
	}
	return normalizeLevel(settings.Level), nil
}

func (m *Manager) writeSettings(level string) error {
	data, err := json.MarshalIndent(Settings{Level: normalizeLevel(level)}, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal logging settings: %w", err)
	}
	if err := os.WriteFile(m.settingsPath, append(data, '\n'), 0o644); err != nil {
		return fmt.Errorf("write logging settings: %w", err)
	}
	return nil
}

func SlogLevel(level string) slog.Level {
	switch normalizeLevel(level) {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func LevelName(level slog.Level) string {
	switch {
	case level <= slog.LevelDebug:
		return "debug"
	case level >= slog.LevelError:
		return "error"
	case level >= slog.LevelWarn:
		return "warn"
	default:
		return "info"
	}
}

func normalizeLevel(level string) string {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "debug":
		return "debug"
	case "warn", "warning":
		return "warn"
	case "error":
		return "error"
	default:
		return DefaultLevel
	}
}

type fileWriter struct {
	path string
	file *os.File
	mu   sync.Mutex
}

func (w *fileWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file == nil {
		if err := w.openLocked(); err != nil {
			return 0, err
		}
	}
	return w.file.Write(p)
}

func (w *fileWriter) open() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.openLocked()
}

func (w *fileWriter) openLocked() error {
	file, err := os.OpenFile(w.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("open log file: %w", err)
	}
	w.file = file
	return nil
}

func (w *fileWriter) close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file == nil {
		return nil
	}
	err := w.file.Close()
	w.file = nil
	if err != nil {
		return fmt.Errorf("close log file: %w", err)
	}
	return nil
}
