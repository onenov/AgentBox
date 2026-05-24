package storage

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func Open(ctx context.Context, databaseURL string) (*Store, error) {
	if err := ensureSQLiteParentDir(databaseURL); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}

	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) DB() *sql.DB {
	return s.db
}

func ensureSQLiteParentDir(databaseURL string) error {
	path, ok := sqliteFilePath(databaseURL)
	if !ok || path == "" || path == ":memory:" {
		return nil
	}

	dir := filepath.Dir(path)
	if dir == "." || dir == "" {
		return nil
	}

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create sqlite parent directory: %w", err)
	}
	return nil
}

func sqliteFilePath(databaseURL string) (string, bool) {
	if strings.HasPrefix(databaseURL, "file:") {
		raw := strings.TrimPrefix(databaseURL, "file:")
		if parsed, err := url.Parse(databaseURL); err == nil && parsed.Path != "" {
			return parsed.Path, true
		}
		return strings.Split(raw, "?")[0], true
	}

	if strings.Contains(databaseURL, "://") {
		return "", false
	}

	return databaseURL, true
}
