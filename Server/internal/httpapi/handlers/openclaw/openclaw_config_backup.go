package openclaw

// OpenClaw config backup handlers manage timestamped copies of the local OpenClaw config.
//
// Backups are stored under the OpenClaw home directory in config-backups using names like
// openclaw-20260512-102717.json. Only files matching that pattern are listed, restored, or deleted.

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

var openClawBackupNamePattern = regexp.MustCompile(`^openclaw-\d{8}-\d{6}\.json$`)

type OpenClawConfigBackupListOutput struct {
	Body OpenClawConfigBackupListResponse
}

type OpenClawConfigBackupOutput struct {
	Body OpenClawConfigBackupResponse
}

type OpenClawConfigBackupPathInput struct {
	Name string `path:"name" doc:"Backup file name to restore or delete." example:"openclaw-20260512-102717.json"`
}

type OpenClawConfigBackupListResponse struct {
	Status    string                     `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                     `json:"timestamp" example:"2026-05-12T02:27:17Z" doc:"UTC response timestamp."`
	Directory string                     `json:"directory" example:"/Users/one/.openclaw/config-backups" doc:"OpenClaw config backup directory."`
	Backups   []OpenClawConfigBackupInfo `json:"backups" doc:"Available OpenClaw config backups."`
}

type OpenClawConfigBackupResponse struct {
	Status    string                   `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                   `json:"timestamp" example:"2026-05-12T02:27:17Z" doc:"UTC response timestamp."`
	Backup    OpenClawConfigBackupInfo `json:"backup" doc:"Backup affected by this operation."`
}

type OpenClawConfigBackupDetailResponse struct {
	Status    string                   `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                   `json:"timestamp" example:"2026-05-12T02:27:17Z" doc:"UTC response timestamp."`
	Backup    OpenClawConfigBackupInfo `json:"backup" doc:"Backup file information."`
	Content   map[string]any           `json:"content" doc:"Parsed OpenClaw backup config JSON content."`
}

type OpenClawConfigBackupDetailOutput struct {
	Body OpenClawConfigBackupDetailResponse
}

type OpenClawConfigBackupInfo struct {
	Name      string `json:"name" example:"openclaw-20260512-102717.json" doc:"Backup file name."`
	Path      string `json:"path" example:"/Users/one/.openclaw/config-backups/openclaw-20260512-102717.json" doc:"Backup file path."`
	Size      int64  `json:"size" example:"1024" doc:"Backup file size in bytes."`
	CreatedAt string `json:"createdAt" example:"2026-05-12T02:27:17Z" doc:"Creation timestamp inferred from backup file name."`
	UpdatedAt string `json:"updatedAt" example:"2026-05-12T02:27:17Z" doc:"File modification timestamp."`
}

func ListOpenClawConfigBackups(ctx context.Context, input *struct{}) (*OpenClawConfigBackupListOutput, error) {
	backups, err := listOpenClawConfigBackups()
	if err != nil {
		return nil, huma.Error500InternalServerError("list openclaw config backups failed", err)
	}

	return &OpenClawConfigBackupListOutput{Body: OpenClawConfigBackupListResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Directory: openClawConfigBackupDir(),
		Backups:   backups,
	}}, nil
}

func CreateOpenClawConfigBackup(ctx context.Context, input *struct{}) (*OpenClawConfigBackupOutput, error) {
	configPath := openClawConfigPath()
	content, err := os.ReadFile(configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, huma.Error404NotFound("openclaw config does not exist", err)
		}
		return nil, huma.Error500InternalServerError("read openclaw config failed", err)
	}

	backupDir := openClawConfigBackupDir()
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		return nil, huma.Error500InternalServerError("create openclaw config backup directory failed", err)
	}

	name := "openclaw-" + time.Now().Format("20060102-150405") + ".json"
	backupPath := filepath.Join(backupDir, name)
	if err := os.WriteFile(backupPath, content, 0o600); err != nil {
		return nil, huma.Error500InternalServerError("write openclaw config backup failed", err)
	}

	backup, err := openClawConfigBackupInfo(backupPath)
	if err != nil {
		return nil, huma.Error500InternalServerError("stat openclaw config backup failed", err)
	}

	return &OpenClawConfigBackupOutput{Body: OpenClawConfigBackupResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Backup:    backup,
	}}, nil
}

func GetOpenClawConfigBackup(ctx context.Context, input *OpenClawConfigBackupPathInput) (*OpenClawConfigBackupDetailOutput, error) {
	backupPath, err := resolveOpenClawConfigBackupPath(input.Name)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid openclaw config backup name", err)
	}

	content, err := readOpenClawConfigBackupFile(backupPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, huma.Error404NotFound("openclaw config backup does not exist", err)
		}
		return nil, huma.Error500InternalServerError("read openclaw config backup failed", err)
	}

	backup, err := openClawConfigBackupInfo(backupPath)
	if err != nil {
		return nil, huma.Error500InternalServerError("stat openclaw config backup failed", err)
	}

	return &OpenClawConfigBackupDetailOutput{Body: OpenClawConfigBackupDetailResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Backup:    backup,
		Content:   content,
	}}, nil
}

func RestoreOpenClawConfigBackup(ctx context.Context, input *OpenClawConfigBackupPathInput) (*OpenClawConfigBackupOutput, error) {
	backupPath, err := resolveOpenClawConfigBackupPath(input.Name)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid openclaw config backup name", err)
	}

	content, err := os.ReadFile(backupPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, huma.Error404NotFound("openclaw config backup does not exist", err)
		}
		return nil, huma.Error500InternalServerError("read openclaw config backup failed", err)
	}

	configPath := openClawConfigPath()
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		return nil, huma.Error500InternalServerError("create openclaw config directory failed", err)
	}
	if err := os.WriteFile(configPath, content, 0o600); err != nil {
		return nil, huma.Error500InternalServerError("restore openclaw config backup failed", err)
	}

	backup, err := openClawConfigBackupInfo(backupPath)
	if err != nil {
		return nil, huma.Error500InternalServerError("stat openclaw config backup failed", err)
	}

	return &OpenClawConfigBackupOutput{Body: OpenClawConfigBackupResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Backup:    backup,
	}}, nil
}

func DeleteOpenClawConfigBackup(ctx context.Context, input *OpenClawConfigBackupPathInput) (*OpenClawConfigBackupOutput, error) {
	backupPath, err := resolveOpenClawConfigBackupPath(input.Name)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid openclaw config backup name", err)
	}

	backup, err := openClawConfigBackupInfo(backupPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, huma.Error404NotFound("openclaw config backup does not exist", err)
		}
		return nil, huma.Error500InternalServerError("stat openclaw config backup failed", err)
	}

	if err := os.Remove(backupPath); err != nil {
		return nil, huma.Error500InternalServerError("delete openclaw config backup failed", err)
	}

	return &OpenClawConfigBackupOutput{Body: OpenClawConfigBackupResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Backup:    backup,
	}}, nil
}

func openClawConfigBackupDir() string {
	return filepath.Join(defaultOpenClawHomeDir(), "config-backups")
}

func listOpenClawConfigBackups() ([]OpenClawConfigBackupInfo, error) {
	backupDir := openClawConfigBackupDir()
	entries, err := os.ReadDir(backupDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []OpenClawConfigBackupInfo{}, nil
		}
		return nil, err
	}

	backups := make([]OpenClawConfigBackupInfo, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !openClawBackupNamePattern.MatchString(entry.Name()) {
			continue
		}
		backup, err := openClawConfigBackupInfo(filepath.Join(backupDir, entry.Name()))
		if err != nil {
			continue
		}
		backups = append(backups, backup)
	}

	sort.Slice(backups, func(i, j int) bool {
		return backups[i].Name > backups[j].Name
	})
	return backups, nil
}

func readOpenClawConfigBackupFile(backupPath string) (map[string]any, error) {
	data, err := os.ReadFile(backupPath)
	if err != nil {
		return nil, err
	}

	var content map[string]any
	if err := json.Unmarshal(data, &content); err != nil {
		return nil, err
	}
	if content == nil {
		content = map[string]any{}
	}
	return content, nil
}

func resolveOpenClawConfigBackupPath(name string) (string, error) {
	name = filepath.Base(name)
	if !openClawBackupNamePattern.MatchString(name) {
		return "", errors.New("backup name must match openclaw-YYYYMMDD-HHMMSS.json")
	}
	backupDir := filepath.Clean(openClawConfigBackupDir())
	backupPath := filepath.Clean(filepath.Join(backupDir, name))
	if filepath.Dir(backupPath) != backupDir {
		return "", errors.New("backup path escapes backup directory")
	}
	return backupPath, nil
}

func openClawConfigBackupInfo(path string) (OpenClawConfigBackupInfo, error) {
	stat, err := os.Stat(path)
	if err != nil {
		return OpenClawConfigBackupInfo{}, err
	}
	name := filepath.Base(path)
	return OpenClawConfigBackupInfo{
		Name:      name,
		Path:      path,
		Size:      stat.Size(),
		CreatedAt: parseOpenClawBackupCreatedAt(name),
		UpdatedAt: stat.ModTime().UTC().Format(time.RFC3339),
	}, nil
}

func parseOpenClawBackupCreatedAt(name string) string {
	createdAt, err := time.Parse("20060102-150405", stringsTrimOpenClawBackupName(name))
	if err != nil {
		return ""
	}
	return createdAt.UTC().Format(time.RFC3339)
}

func stringsTrimOpenClawBackupName(name string) string {
	name = filepath.Base(name)
	name = name[len("openclaw-"):]
	return name[:len(name)-len(".json")]
}
