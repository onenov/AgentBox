package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

type BackendAuthConfig struct {
	BackendAddress string `json:"backendAddress"`
	Token          string `json:"token"`
	UpdatedAt      string `json:"updatedAt,omitempty"`
}

type BackendAuthStore struct {
	backendAddress string
	done           chan struct{}
	mu             sync.RWMutex
	path           string
	watcher        *fsnotify.Watcher
	data           BackendAuthConfig
}

func LoadBackendAuthConfig(path string, backendAddress string, defaultToken string) (*BackendAuthStore, error) {
	if path == "" {
		path = defaultAuthConfigPath()
	}
	if backendAddress == "" {
		backendAddress = "http://127.0.0.1:8787"
	}

	store := &BackendAuthStore{
		backendAddress: backendAddress,
		done:           make(chan struct{}),
		path:           path,
	}
	config, created, err := readOrCreateBackendAuthConfig(path, backendAddress, defaultToken)
	if err != nil {
		return nil, err
	}

	if config.BackendAddress != backendAddress {
		config.BackendAddress = backendAddress
		if !created {
			config.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		}
		if err := writeBackendAuthConfig(path, config); err != nil {
			return nil, err
		}
	}

	store.data = config
	if err := store.watch(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *BackendAuthStore) Close() error {
	if s == nil {
		return nil
	}
	select {
	case <-s.done:
	default:
		close(s.done)
	}
	if s.watcher != nil {
		return s.watcher.Close()
	}
	return nil
}

func (s *BackendAuthStore) Path() string {
	if s == nil {
		return ""
	}
	return s.path
}

func (s *BackendAuthStore) Snapshot() BackendAuthConfig {
	if s == nil {
		return BackendAuthConfig{}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data
}

func (s *BackendAuthStore) Token() string {
	if s == nil {
		return ""
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data.Token
}

func (s *BackendAuthStore) UpdateToken(token string) (BackendAuthConfig, error) {
	if s == nil {
		return BackendAuthConfig{}, fmt.Errorf("auth config store is not initialized")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.data.Token = token
	s.data.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err := writeBackendAuthConfig(s.path, s.data); err != nil {
		return BackendAuthConfig{}, err
	}
	return s.data, nil
}

func (s *BackendAuthStore) watch() error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("create auth config watcher: %w", err)
	}

	dir := filepath.Dir(s.path)
	if dir == "" || dir == "." {
		dir = "."
	}
	if err := watcher.Add(dir); err != nil {
		_ = watcher.Close()
		return fmt.Errorf("watch auth config directory: %w", err)
	}

	s.watcher = watcher
	go s.watchLoop()
	return nil
}

func (s *BackendAuthStore) watchLoop() {
	var reloadTimer *time.Timer
	var reloadC <-chan time.Time
	defer func() {
		if reloadTimer != nil {
			reloadTimer.Stop()
		}
	}()

	for {
		select {
		case <-s.done:
			return
		case event, ok := <-s.watcher.Events:
			if !ok {
				return
			}
			if !s.isAuthConfigEvent(event) {
				continue
			}
			if reloadTimer == nil {
				reloadTimer = time.NewTimer(80 * time.Millisecond)
				reloadC = reloadTimer.C
				continue
			}
			if !reloadTimer.Stop() {
				select {
				case <-reloadTimer.C:
				default:
				}
			}
			reloadTimer.Reset(80 * time.Millisecond)
		case _, ok := <-s.watcher.Errors:
			if !ok {
				return
			}
		case <-reloadC:
			reloadC = nil
			if err := s.Reload(); err != nil && errors.Is(err, os.ErrNotExist) {
				continue
			}
		}
	}
}

func (s *BackendAuthStore) isAuthConfigEvent(event fsnotify.Event) bool {
	if event.Name == "" {
		return false
	}
	if filepath.Clean(event.Name) != filepath.Clean(s.path) {
		return false
	}
	return event.Has(fsnotify.Write) ||
		event.Has(fsnotify.Create) ||
		event.Has(fsnotify.Rename) ||
		event.Has(fsnotify.Remove)
}

func (s *BackendAuthStore) Reload() error {
	if s == nil {
		return fmt.Errorf("auth config store is not initialized")
	}

	config, err := readBackendAuthConfig(s.path, s.backendAddress)
	if err != nil {
		return err
	}

	s.mu.Lock()
	s.data = config
	s.mu.Unlock()
	return nil
}

func readOrCreateBackendAuthConfig(path string, backendAddress string, defaultToken string) (BackendAuthConfig, bool, error) {
	config, err := readBackendAuthConfig(path, backendAddress)
	if err == nil {
		return config, false, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return BackendAuthConfig{}, false, fmt.Errorf("read auth config: %w", err)
	}

	config = BackendAuthConfig{
		BackendAddress: backendAddress,
		Token:          strings.TrimSpace(defaultToken),
		UpdatedAt:      time.Now().UTC().Format(time.RFC3339Nano),
	}
	if err := writeBackendAuthConfig(path, config); err != nil {
		return BackendAuthConfig{}, false, err
	}
	return config, true, nil
}

func readBackendAuthConfig(path string, backendAddress string) (BackendAuthConfig, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return BackendAuthConfig{}, fmt.Errorf("read auth config: %w", err)
	}

	var config BackendAuthConfig
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &config); err != nil {
			return BackendAuthConfig{}, fmt.Errorf("parse auth config: %w", err)
		}
	}
	if config.BackendAddress == "" {
		config.BackendAddress = backendAddress
	}
	return config, nil
}

func writeBackendAuthConfig(path string, config BackendAuthConfig) error {
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create auth config directory: %w", err)
		}
	}

	raw, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("encode auth config: %w", err)
	}
	raw = append(raw, '\n')
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return fmt.Errorf("write auth config: %w", err)
	}
	return nil
}
