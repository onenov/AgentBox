package openclaw

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

type OpenClawAgentMemoryOutput struct {
	Body OpenClawAgentMemoryResponse
}

type OpenClawAgentMemoryFileInput struct {
	ID   string `path:"id" doc:"OpenClaw agent id." example:"main"`
	Path string `query:"path" doc:"Memory file path relative to workspace." example:"memory/2026-05-13.md"`
}

type OpenClawAgentMemoryFileUpdateInput struct {
	ID   string `path:"id" doc:"OpenClaw agent id." example:"main"`
	Path string `query:"path" doc:"Memory file path relative to workspace." example:"memory/2026-05-13.md"`
	Body OpenClawAgentMemoryFileUpdateRequest
}

type OpenClawAgentMemorySearchInput struct {
	ID   string `path:"id" doc:"OpenClaw agent id." example:"main"`
	Body OpenClawAgentMemorySearchRequest
}

type OpenClawAgentMemoryIndexInput struct {
	ID   string `path:"id" doc:"OpenClaw agent id." example:"main"`
	Body OpenClawAgentMemoryIndexRequest
}

type OpenClawAgentMemoryFileOutput struct {
	Body OpenClawAgentMemoryFileResponse
}

type OpenClawAgentMemorySearchOutput struct {
	Body OpenClawAgentMemorySearchResponse
}

type OpenClawAgentMemoryIndexOutput struct {
	Body OpenClawAgentMemoryIndexResponse
}

type OpenClawAgentMemoryResponse struct {
	Status    string                         `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                         `json:"timestamp" example:"2026-05-13T02:40:00Z" doc:"UTC response timestamp."`
	AgentID   string                         `json:"agentId" example:"main" doc:"Agent id."`
	Workspace string                         `json:"workspace" doc:"Resolved agent workspace path."`
	MemoryDir string                         `json:"memoryDir" doc:"Resolved workspace memory directory."`
	Index     OpenClawAgentMemoryIndexStatus `json:"index" doc:"Best-effort memory index status."`
	CLI       OpenClawAgentMemoryCLIStatus   `json:"cli" doc:"Best-effort OpenClaw memory status command output."`
	Files     []OpenClawAgentMemoryFile      `json:"files" doc:"Root MEMORY.md and memory/*.md files."`
	Summary   OpenClawAgentMemorySummary     `json:"summary" doc:"Memory file and index summary."`
}

type OpenClawAgentMemoryIndexStatus struct {
	Path      string `json:"path" doc:"Expected per-agent SQLite memory index path."`
	Exists    bool   `json:"exists" doc:"Whether the SQLite memory index exists."`
	Size      int64  `json:"size,omitempty" doc:"Index file size in bytes."`
	UpdatedAt string `json:"updatedAt,omitempty" doc:"Index file modification time."`
	WALExists bool   `json:"walExists" doc:"Whether the SQLite WAL sidecar exists."`
	SHMExists bool   `json:"shmExists" doc:"Whether the SQLite SHM sidecar exists."`
}

type OpenClawAgentMemoryCLIStatus struct {
	Available bool   `json:"available" doc:"Whether openclaw memory status returned JSON."`
	Command   string `json:"command,omitempty" doc:"Command that was executed."`
	Error     string `json:"error,omitempty" doc:"Command error or stderr when any."`
	Raw       any    `json:"raw,omitempty" doc:"Raw JSON output from openclaw memory status --json."`
	Text      string `json:"text,omitempty" doc:"Non-JSON command output when parsing fails."`
}

type OpenClawAgentMemorySummary struct {
	RootExists bool   `json:"rootExists" doc:"Whether MEMORY.md exists."`
	FilesCount int    `json:"filesCount" doc:"Number of memory files returned."`
	TotalBytes int64  `json:"totalBytes" doc:"Total bytes across returned memory files."`
	UpdatedAt  string `json:"updatedAt,omitempty" doc:"Newest memory file modification time."`
}

type OpenClawAgentMemoryFile struct {
	Name         string `json:"name" doc:"File base name."`
	RelativePath string `json:"relativePath" doc:"Path relative to workspace."`
	Path         string `json:"path" doc:"Absolute file path."`
	Kind         string `json:"kind" example:"daily" doc:"Memory file kind: root or daily."`
	Exists       bool   `json:"exists" doc:"Whether the file exists."`
	Size         int64  `json:"size,omitempty" doc:"File size in bytes."`
	UpdatedAt    string `json:"updatedAt,omitempty" doc:"File modification time."`
	Title        string `json:"title,omitempty" doc:"Friendly file title."`
}

type OpenClawAgentMemoryFileResponse struct {
	Status    string                  `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                  `json:"timestamp" example:"2026-05-13T02:40:00Z" doc:"UTC response timestamp."`
	AgentID   string                  `json:"agentId" example:"main" doc:"Agent id."`
	File      OpenClawAgentMemoryFile `json:"file" doc:"Memory file status."`
	Content   string                  `json:"content" doc:"Plain text file content."`
}

type OpenClawAgentMemoryFileUpdateRequest struct {
	Content string `json:"content" doc:"Plain text file content to write."`
}

type OpenClawAgentMemorySearchRequest struct {
	Query      string `json:"query" doc:"Search query." example:"deployment notes"`
	MaxResults int    `json:"maxResults,omitempty" doc:"Maximum results to return." example:"12"`
}

type OpenClawAgentMemorySearchResponse struct {
	Status    string                         `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                         `json:"timestamp" example:"2026-05-13T02:40:00Z" doc:"UTC response timestamp."`
	AgentID   string                         `json:"agentId" example:"main" doc:"Agent id."`
	Query     string                         `json:"query" doc:"Search query."`
	Source    string                         `json:"source" example:"memory_search" doc:"Result source: memory_search or local."`
	Error     string                         `json:"error,omitempty" doc:"memory_search error when local fallback was used."`
	Raw       any                            `json:"raw,omitempty" doc:"Raw JSON output from openclaw memory search --json."`
	Results   []OpenClawAgentMemorySearchHit `json:"results" doc:"Search results."`
}

type OpenClawAgentMemorySearchHit struct {
	Path         string  `json:"path,omitempty" doc:"Absolute or source path."`
	RelativePath string  `json:"relativePath,omitempty" doc:"Workspace-relative file path when known."`
	Title        string  `json:"title,omitempty" doc:"Result title."`
	Snippet      string  `json:"snippet" doc:"Result snippet."`
	Score        float64 `json:"score,omitempty" doc:"Search score when available."`
	LineStart    int     `json:"lineStart,omitempty" doc:"Best-effort snippet start line."`
	LineEnd      int     `json:"lineEnd,omitempty" doc:"Best-effort snippet end line."`
}

type OpenClawAgentMemoryIndexRequest struct {
	Force bool `json:"force,omitempty" doc:"Force a full reindex." example:"true"`
}

type OpenClawAgentMemoryIndexResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-13T02:40:00Z" doc:"UTC response timestamp."`
	AgentID   string `json:"agentId" example:"main" doc:"Agent id."`
	Command   string `json:"command" doc:"Command that was executed."`
	Output    string `json:"output,omitempty" doc:"Command stdout."`
	Error     string `json:"error,omitempty" doc:"Command stderr when any."`
}

func GetOpenClawAgentMemory(ctx context.Context, input *OpenClawAgentPathInput) (*OpenClawAgentMemoryOutput, error) {
	agent, err := findOpenClawAgentByID(input.ID)
	if err != nil {
		return nil, err
	}
	files := listOpenClawAgentMemoryFiles(agent.Workspace)
	return &OpenClawAgentMemoryOutput{Body: OpenClawAgentMemoryResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AgentID:   agent.ID,
		Workspace: agent.Workspace,
		MemoryDir: filepath.Join(agent.Workspace, "memory"),
		Index:     openClawAgentMemoryIndexStatus(agent.ID),
		CLI:       openClawAgentMemoryCLIStatus(ctx, agent.ID),
		Files:     files,
		Summary:   summarizeOpenClawAgentMemoryFiles(files),
	}}, nil
}

func GetOpenClawAgentMemoryFile(ctx context.Context, input *OpenClawAgentMemoryFileInput) (*OpenClawAgentMemoryFileOutput, error) {
	agent, err := findOpenClawAgentByID(input.ID)
	if err != nil {
		return nil, err
	}
	filePath, relativePath, err := resolveOpenClawAgentMemoryFilePath(agent.Workspace, input.Path)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid openclaw memory file path", err)
	}
	content, err := os.ReadFile(filePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, huma.Error404NotFound("openclaw memory file does not exist", err)
		}
		return nil, huma.Error500InternalServerError("read openclaw memory file failed", err)
	}
	file, err := openClawAgentMemoryFileStatus(agent.Workspace, filePath, relativePath, memoryFileKind(relativePath))
	if err != nil {
		return nil, huma.Error500InternalServerError("stat openclaw memory file failed", err)
	}
	return &OpenClawAgentMemoryFileOutput{Body: OpenClawAgentMemoryFileResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AgentID:   agent.ID,
		File:      file,
		Content:   string(content),
	}}, nil
}

func UpdateOpenClawAgentMemoryFile(ctx context.Context, input *OpenClawAgentMemoryFileUpdateInput) (*OpenClawAgentMemoryFileOutput, error) {
	agent, err := findOpenClawAgentByID(input.ID)
	if err != nil {
		return nil, err
	}
	filePath, relativePath, err := resolveOpenClawAgentMemoryFilePath(agent.Workspace, input.Path)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid openclaw memory file path", err)
	}
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		return nil, huma.Error500InternalServerError("create openclaw memory directory failed", err)
	}
	if err := os.WriteFile(filePath, []byte(input.Body.Content), 0o600); err != nil {
		return nil, huma.Error500InternalServerError("write openclaw memory file failed", err)
	}
	file, err := openClawAgentMemoryFileStatus(agent.Workspace, filePath, relativePath, memoryFileKind(relativePath))
	if err != nil {
		return nil, huma.Error500InternalServerError("stat openclaw memory file failed", err)
	}
	return &OpenClawAgentMemoryFileOutput{Body: OpenClawAgentMemoryFileResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AgentID:   agent.ID,
		File:      file,
		Content:   input.Body.Content,
	}}, nil
}

func SearchOpenClawAgentMemory(ctx context.Context, input *OpenClawAgentMemorySearchInput) (*OpenClawAgentMemorySearchOutput, error) {
	agent, err := findOpenClawAgentByID(input.ID)
	if err != nil {
		return nil, err
	}
	query := strings.TrimSpace(input.Body.Query)
	if query == "" {
		return nil, huma.Error400BadRequest("memory search query is required", nil)
	}
	maxResults := input.Body.MaxResults
	if maxResults <= 0 || maxResults > 50 {
		maxResults = 12
	}

	results, raw, cliErr := openClawAgentMemorySearch(ctx, agent, query, maxResults)
	source := "memory_search"
	errorText := ""
	if cliErr != nil {
		source = "local"
		errorText = cliErr.Error()
		results = localOpenClawAgentMemorySearch(agent.Workspace, query, maxResults)
		raw = nil
	}

	return &OpenClawAgentMemorySearchOutput{Body: OpenClawAgentMemorySearchResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AgentID:   agent.ID,
		Query:     query,
		Source:    source,
		Error:     errorText,
		Raw:       raw,
		Results:   results,
	}}, nil
}

func IndexOpenClawAgentMemory(ctx context.Context, input *OpenClawAgentMemoryIndexInput) (*OpenClawAgentMemoryIndexOutput, error) {
	agent, err := findOpenClawAgentByID(input.ID)
	if err != nil {
		return nil, err
	}
	path, err := exec.LookPath("openclaw")
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw CLI is not available", err)
	}
	args := []string{"memory", "index", "--agent", agent.ID}
	if input.Body.Force {
		args = append(args, "--force")
	}
	stdout, stderr, err := runOpenClawMemoryCommand(ctx, path, args...)
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw memory index failed", fmt.Errorf("%w: %s", err, stderr))
	}
	return &OpenClawAgentMemoryIndexOutput{Body: OpenClawAgentMemoryIndexResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AgentID:   agent.ID,
		Command:   "openclaw " + strings.Join(args, " "),
		Output:    strings.TrimSpace(stdout),
		Error:     strings.TrimSpace(stderr),
	}}, nil
}

func listOpenClawAgentMemoryFiles(workspace string) []OpenClawAgentMemoryFile {
	files := make([]OpenClawAgentMemoryFile, 0)
	rootPath := filepath.Join(workspace, "MEMORY.md")
	root, err := openClawAgentMemoryFileStatus(workspace, rootPath, "MEMORY.md", "root")
	if err != nil {
		root = OpenClawAgentMemoryFile{Name: "MEMORY.md", RelativePath: "MEMORY.md", Path: rootPath, Kind: "root", Exists: false, Title: "长期记忆"}
	}
	files = append(files, root)

	matches, _ := filepath.Glob(filepath.Join(workspace, "memory", "*.md"))
	sort.Slice(matches, func(i, j int) bool {
		return filepath.Base(matches[i]) > filepath.Base(matches[j])
	})
	for _, path := range matches {
		relativePath := filepath.ToSlash(filepath.Join("memory", filepath.Base(path)))
		file, err := openClawAgentMemoryFileStatus(workspace, path, relativePath, "daily")
		if err == nil {
			files = append(files, file)
		}
	}
	return files
}

func openClawAgentMemoryFileStatus(workspace string, path string, relativePath string, kind string) (OpenClawAgentMemoryFile, error) {
	file := OpenClawAgentMemoryFile{
		Name:         filepath.Base(path),
		RelativePath: filepath.ToSlash(relativePath),
		Path:         path,
		Kind:         kind,
		Exists:       false,
		Title:        memoryFileTitle(relativePath),
	}
	stat, err := os.Stat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return file, nil
		}
		return file, err
	}
	if stat.IsDir() {
		return file, nil
	}
	file.Exists = true
	file.Size = stat.Size()
	file.UpdatedAt = stat.ModTime().UTC().Format(time.RFC3339)
	return file, nil
}

func summarizeOpenClawAgentMemoryFiles(files []OpenClawAgentMemoryFile) OpenClawAgentMemorySummary {
	summary := OpenClawAgentMemorySummary{FilesCount: len(files)}
	var latest time.Time
	for _, file := range files {
		if file.RelativePath == "MEMORY.md" {
			summary.RootExists = file.Exists
		}
		if !file.Exists {
			continue
		}
		summary.TotalBytes += file.Size
		if file.UpdatedAt != "" {
			if parsed, err := time.Parse(time.RFC3339, file.UpdatedAt); err == nil && parsed.After(latest) {
				latest = parsed
			}
		}
	}
	if !latest.IsZero() {
		summary.UpdatedAt = latest.UTC().Format(time.RFC3339)
	}
	return summary
}

func openClawAgentMemoryIndexStatus(agentID string) OpenClawAgentMemoryIndexStatus {
	path := filepath.Join(defaultOpenClawHomeDir(), "memory", normalizeOpenClawAgentID(agentID)+".sqlite")
	status := OpenClawAgentMemoryIndexStatus{
		Path:      path,
		Exists:    false,
		WALExists: pathExists(path + "-wal"),
		SHMExists: pathExists(path + "-shm"),
	}
	if stat, err := os.Stat(path); err == nil && !stat.IsDir() {
		status.Exists = true
		status.Size = stat.Size()
		status.UpdatedAt = stat.ModTime().UTC().Format(time.RFC3339)
	}
	return status
}

func openClawAgentMemoryCLIStatus(ctx context.Context, agentID string) OpenClawAgentMemoryCLIStatus {
	path, err := exec.LookPath("openclaw")
	args := []string{"memory", "status", "--json", "--agent", agentID}
	status := OpenClawAgentMemoryCLIStatus{Command: "openclaw " + strings.Join(args, " ")}
	if err != nil {
		status.Error = err.Error()
		return status
	}
	stdout, stderr, err := runOpenClawMemoryCommand(ctx, path, args...)
	if err != nil {
		status.Error = strings.TrimSpace(strings.Join([]string{err.Error(), stderr}, ": "))
		return status
	}
	var raw any
	if err := json.Unmarshal([]byte(stdout), &raw); err != nil {
		status.Error = err.Error()
		status.Text = strings.TrimSpace(stdout)
		return status
	}
	status.Available = true
	status.Raw = raw
	return status
}

func openClawAgentMemorySearch(ctx context.Context, agent OpenClawAgentSummary, query string, maxResults int) ([]OpenClawAgentMemorySearchHit, any, error) {
	path, err := exec.LookPath("openclaw")
	if err != nil {
		return nil, nil, err
	}
	args := []string{"memory", "search", "--json", "--agent", agent.ID, "--max-results", fmt.Sprint(maxResults), "--query", query}
	stdout, stderr, err := runOpenClawMemoryCommand(ctx, path, args...)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr))
	}
	var raw any
	if err := json.Unmarshal([]byte(stdout), &raw); err != nil {
		return nil, nil, err
	}
	return normalizeOpenClawMemorySearchHits(raw, agent.Workspace, maxResults), raw, nil
}

func runOpenClawMemoryCommand(ctx context.Context, path string, args ...string) (string, string, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, path, args...)
	var stdout strings.Builder
	var stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if cmdCtx.Err() != nil {
		return stdout.String(), stderr.String(), cmdCtx.Err()
	}
	return stdout.String(), stderr.String(), err
}

func resolveOpenClawAgentMemoryFilePath(workspace string, relativePath string) (string, string, error) {
	relativePath = filepath.ToSlash(strings.TrimSpace(relativePath))
	relativePath = strings.TrimPrefix(relativePath, "/")
	if relativePath == "" {
		return "", "", errors.New("memory file path is required")
	}
	cleanRelative := filepath.ToSlash(filepath.Clean(relativePath))
	if cleanRelative == "." || strings.HasPrefix(cleanRelative, "../") || strings.Contains(cleanRelative, "/../") {
		return "", "", errors.New("memory file path escapes workspace")
	}
	if cleanRelative != "MEMORY.md" && !(strings.HasPrefix(cleanRelative, "memory/") && strings.HasSuffix(strings.ToLower(cleanRelative), ".md")) {
		return "", "", errors.New("only MEMORY.md and memory/*.md files are allowed")
	}
	if strings.Count(cleanRelative, "/") > 1 {
		return "", "", errors.New("nested memory directories are not supported")
	}
	workspace = filepath.Clean(workspace)
	path := filepath.Clean(filepath.Join(workspace, filepath.FromSlash(cleanRelative)))
	rel, err := filepath.Rel(workspace, path)
	if err != nil || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return "", "", errors.New("memory file path escapes workspace")
	}
	return path, cleanRelative, nil
}

func memoryFileKind(relativePath string) string {
	if filepath.ToSlash(relativePath) == "MEMORY.md" {
		return "root"
	}
	return "daily"
}

func memoryFileTitle(relativePath string) string {
	relativePath = filepath.ToSlash(relativePath)
	if relativePath == "MEMORY.md" {
		return "长期记忆"
	}
	base := strings.TrimSuffix(filepath.Base(relativePath), filepath.Ext(relativePath))
	base = strings.ReplaceAll(base, "_", " ")
	base = strings.ReplaceAll(base, "-", " ")
	return strings.TrimSpace(base)
}

func normalizeOpenClawMemorySearchHits(raw any, workspace string, maxResults int) []OpenClawAgentMemorySearchHit {
	items := extractOpenClawMemorySearchItems(raw)
	hits := make([]OpenClawAgentMemorySearchHit, 0, len(items))
	for _, item := range items {
		hit := OpenClawAgentMemorySearchHit{
			Path:      firstStringFromMemoryItem(item, "path", "file", "filePath", "sourcePath", "uri", "source"),
			Title:     firstStringFromMemoryItem(item, "title", "name", "heading"),
			Snippet:   firstStringFromMemoryItem(item, "snippet", "text", "content", "preview", "chunk"),
			Score:     firstFloatFromMemoryItem(item, "score", "rank", "relevance", "similarity"),
			LineStart: firstIntFromMemoryItem(item, "lineStart", "startLine", "line"),
			LineEnd:   firstIntFromMemoryItem(item, "lineEnd", "endLine"),
		}
		if hit.Snippet == "" {
			if encoded, err := json.Marshal(item); err == nil {
				hit.Snippet = string(encoded)
			}
		}
		hit.RelativePath = workspaceRelativePath(workspace, hit.Path)
		if hit.Title == "" {
			hit.Title = memoryFileTitle(hit.RelativePath)
		}
		hits = append(hits, hit)
		if len(hits) >= maxResults {
			break
		}
	}
	return hits
}

func extractOpenClawMemorySearchItems(raw any) []map[string]any {
	switch typed := raw.(type) {
	case []any:
		return mapsFromAnySlice(typed)
	case map[string]any:
		for _, key := range []string{"results", "hits", "items", "matches", "memories"} {
			if values, ok := typed[key].([]any); ok {
				return mapsFromAnySlice(values)
			}
		}
		if result, ok := typed["result"].(map[string]any); ok {
			return extractOpenClawMemorySearchItems(result)
		}
		return []map[string]any{typed}
	default:
		return nil
	}
}

func mapsFromAnySlice(values []any) []map[string]any {
	out := make([]map[string]any, 0, len(values))
	for _, value := range values {
		if item, ok := value.(map[string]any); ok {
			out = append(out, item)
		}
	}
	return out
}

func localOpenClawAgentMemorySearch(workspace string, query string, maxResults int) []OpenClawAgentMemorySearchHit {
	files := listOpenClawAgentMemoryFiles(workspace)
	tokens := strings.Fields(strings.ToLower(query))
	if len(tokens) == 0 {
		return nil
	}
	hits := make([]OpenClawAgentMemorySearchHit, 0)
	for _, file := range files {
		if !file.Exists {
			continue
		}
		contentBytes, err := os.ReadFile(file.Path)
		if err != nil {
			continue
		}
		content := string(contentBytes)
		lower := strings.ToLower(content)
		score := 0
		firstIndex := -1
		for _, token := range tokens {
			index := strings.Index(lower, token)
			if index >= 0 {
				score += strings.Count(lower, token)
				if firstIndex < 0 || index < firstIndex {
					firstIndex = index
				}
			}
		}
		if score == 0 {
			continue
		}
		snippet, lineStart, lineEnd := memorySnippet(content, firstIndex)
		hits = append(hits, OpenClawAgentMemorySearchHit{
			Path:         file.Path,
			RelativePath: file.RelativePath,
			Title:        file.Title,
			Snippet:      snippet,
			Score:        float64(score),
			LineStart:    lineStart,
			LineEnd:      lineEnd,
		})
	}
	sort.Slice(hits, func(i, j int) bool {
		if hits[i].Score == hits[j].Score {
			return hits[i].RelativePath < hits[j].RelativePath
		}
		return hits[i].Score > hits[j].Score
	})
	if len(hits) > maxResults {
		return hits[:maxResults]
	}
	return hits
}

func memorySnippet(content string, index int) (string, int, int) {
	if index < 0 {
		index = 0
	}
	start := index - 180
	if start < 0 {
		start = 0
	}
	end := index + 360
	if end > len(content) {
		end = len(content)
	}
	lineStart := strings.Count(content[:start], "\n") + 1
	lineEnd := lineStart + strings.Count(content[start:end], "\n")
	snippet := strings.TrimSpace(content[start:end])
	if start > 0 {
		snippet = "..." + snippet
	}
	if end < len(content) {
		snippet += "..."
	}
	return snippet, lineStart, lineEnd
}

func workspaceRelativePath(workspace string, path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	workspace = filepath.Clean(workspace)
	cleanPath := filepath.Clean(path)
	if rel, err := filepath.Rel(workspace, cleanPath); err == nil && !strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel) {
		return filepath.ToSlash(rel)
	}
	if strings.Contains(path, "/memory/") {
		index := strings.LastIndex(path, "/memory/")
		return strings.TrimPrefix(filepath.ToSlash(path[index+1:]), "/")
	}
	if strings.HasSuffix(path, "MEMORY.md") {
		return "MEMORY.md"
	}
	return filepath.ToSlash(path)
}

func firstStringFromMemoryItem(item map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := item[key]; ok && value != nil {
			switch typed := value.(type) {
			case string:
				return strings.TrimSpace(typed)
			default:
				return strings.TrimSpace(fmt.Sprint(typed))
			}
		}
	}
	for _, value := range item {
		if child, ok := value.(map[string]any); ok {
			if nested := firstStringFromMemoryItem(child, keys...); nested != "" {
				return nested
			}
		}
	}
	return ""
}

func firstFloatFromMemoryItem(item map[string]any, keys ...string) float64 {
	for _, key := range keys {
		if value, ok := item[key]; ok && value != nil {
			switch typed := value.(type) {
			case float64:
				return typed
			case float32:
				return float64(typed)
			case int:
				return float64(typed)
			case int64:
				return float64(typed)
			case json.Number:
				parsed, _ := typed.Float64()
				return parsed
			}
		}
	}
	return 0
}

func firstIntFromMemoryItem(item map[string]any, keys ...string) int {
	for _, key := range keys {
		if value, ok := item[key]; ok && value != nil {
			switch typed := value.(type) {
			case float64:
				return int(typed)
			case int:
				return typed
			case int64:
				return int(typed)
			case json.Number:
				parsed, _ := typed.Int64()
				return int(parsed)
			}
		}
	}
	return 0
}
