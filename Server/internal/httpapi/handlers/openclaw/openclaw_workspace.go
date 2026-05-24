package openclaw

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/danielgtaylor/huma/v2"
)

const openClawWorkspaceTreeDefaultDepth = 2
const openClawWorkspaceTreeMaxDepth = 6
const openClawWorkspaceTreeDefaultMaxEntries = 500
const openClawWorkspaceTreeMaxEntries = 2000
const openClawWorkspaceFileDefaultMaxBytes = 256 * 1024
const openClawWorkspaceFileMaxBytes = 10 * 1024 * 1024
const openClawWorkspaceUploadMaxBytes = 10 * 1024 * 1024

var openClawWorkspaceProtectedDeleteFiles = map[string]bool{
	"AGENTS.md":    true,
	"HEARTBEAT.md": true,
	"IDENTITY.md":  true,
	"SOUL.md":      true,
	"TOOLS.md":     true,
	"USER.md":      true,
}

var openClawWorkspaceIgnoredNames = map[string]bool{
	".DS_Store":     true,
	".git":          true,
	".hg":           true,
	".svn":          true,
	"node_modules":  true,
	"vendor":        true,
	"dist":          true,
	"build":         true,
	".next":         true,
	".nuxt":         true,
	".vite":         true,
	".turbo":        true,
	".cache":        true,
	"__pycache__":   true,
	"coverage":      true,
	".pytest_cache": true,
}

type OpenClawAgentWorkspaceTreeInput struct {
	ID            string `path:"id" doc:"OpenClaw agent id." example:"main"`
	Path          string `query:"path" doc:"Directory path relative to workspace." example:"memory"`
	Depth         int    `query:"depth" doc:"Maximum recursive depth." example:"2"`
	IncludeHidden bool   `query:"includeHidden" doc:"Include hidden files and directories." example:"false"`
	MaxEntries    int    `query:"maxEntries" doc:"Maximum entries returned." example:"500"`
}

type OpenClawAgentWorkspaceFileInput struct {
	ID       string `path:"id" doc:"OpenClaw agent id." example:"main"`
	Path     string `query:"path" doc:"File path relative to workspace." example:"AGENTS.md"`
	MaxBytes int    `query:"maxBytes" doc:"Maximum bytes to read for preview." example:"262144"`
}

type OpenClawAgentWorkspaceCreateInput struct {
	ID   string `path:"id" doc:"OpenClaw agent id." example:"main"`
	Body OpenClawAgentWorkspaceCreateRequest
}

type OpenClawAgentWorkspaceUpdateInput struct {
	ID   string `path:"id" doc:"OpenClaw agent id." example:"main"`
	Body OpenClawAgentWorkspaceUpdateRequest
}

type OpenClawAgentWorkspaceDeleteInput struct {
	ID   string `path:"id" doc:"OpenClaw agent id." example:"main"`
	Body OpenClawAgentWorkspaceDeleteRequest
}

type OpenClawAgentWorkspaceMoveInput struct {
	ID   string `path:"id" doc:"OpenClaw agent id." example:"main"`
	Body OpenClawAgentWorkspaceMoveRequest
}

type OpenClawAgentWorkspaceTreeOutput struct {
	Body OpenClawAgentWorkspaceTreeResponse
}

type OpenClawAgentWorkspaceFileOutput struct {
	Body OpenClawAgentWorkspaceFileResponse
}

type OpenClawAgentWorkspaceMutationOutput struct {
	Body OpenClawAgentWorkspaceMutationResponse
}

type OpenClawAgentWorkspaceCreateRequest struct {
	Path          string `json:"path" doc:"Path relative to workspace." example:"notes/today.md"`
	Type          string `json:"type" doc:"Entry type: file or directory." example:"file"`
	Content       string `json:"content,omitempty" doc:"Initial plain text file content."`
	ContentBase64 string `json:"contentBase64,omitempty" doc:"Initial file content encoded as base64."`
}

type OpenClawAgentWorkspaceUpdateRequest struct {
	Path    string `json:"path" doc:"File path relative to workspace." example:"notes/today.md"`
	Content string `json:"content" doc:"Plain text file content."`
}

type OpenClawAgentWorkspaceDeleteRequest struct {
	Path string `json:"path" doc:"Path relative to workspace." example:"notes/today.md"`
}

type OpenClawAgentWorkspaceMoveRequest struct {
	Path       string `json:"path" doc:"Source path relative to workspace." example:"notes/today.md"`
	TargetPath string `json:"targetPath" doc:"Target directory path relative to workspace." example:"archive"`
}

type OpenClawAgentWorkspaceTreeResponse struct {
	Status    string                            `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                            `json:"timestamp" example:"2026-05-15T02:40:00Z" doc:"UTC response timestamp."`
	AgentID   string                            `json:"agentId" example:"main" doc:"Agent id."`
	Workspace string                            `json:"workspace" doc:"Resolved agent workspace path."`
	Root      OpenClawAgentWorkspaceNode        `json:"root" doc:"Workspace tree root node."`
	Summary   OpenClawAgentWorkspaceTreeSummary `json:"summary" doc:"Tree summary."`
}

type OpenClawAgentWorkspaceFileResponse struct {
	Status    string                     `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                     `json:"timestamp" example:"2026-05-15T02:40:00Z" doc:"UTC response timestamp."`
	AgentID   string                     `json:"agentId" example:"main" doc:"Agent id."`
	Workspace string                     `json:"workspace" doc:"Resolved agent workspace path."`
	File      OpenClawAgentWorkspaceNode `json:"file" doc:"Workspace file metadata."`
	Content   string                     `json:"content,omitempty" doc:"Plain text preview content when available."`
	DataURL   string                     `json:"dataUrl,omitempty" doc:"Data URL preview content when available."`
}

type OpenClawAgentWorkspaceMutationResponse struct {
	Status    string                     `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                     `json:"timestamp" example:"2026-05-15T02:40:00Z" doc:"UTC response timestamp."`
	AgentID   string                     `json:"agentId" example:"main" doc:"Agent id."`
	Workspace string                     `json:"workspace" doc:"Resolved agent workspace path."`
	Action    string                     `json:"action" example:"create" doc:"Mutation action."`
	Node      OpenClawAgentWorkspaceNode `json:"node" doc:"Created or deleted node metadata."`
}

type OpenClawAgentWorkspaceTreeSummary struct {
	Directories int  `json:"directories" doc:"Number of directories returned."`
	Files       int  `json:"files" doc:"Number of files returned."`
	Truncated   bool `json:"truncated" doc:"Whether the tree was truncated due to limits."`
	MaxEntries  int  `json:"maxEntries" doc:"Effective maximum entries."`
	Depth       int  `json:"depth" doc:"Effective recursive depth."`
}

type OpenClawAgentWorkspaceNode struct {
	Name           string                       `json:"name" doc:"File or directory base name."`
	RelativePath   string                       `json:"relativePath" doc:"Path relative to workspace."`
	Path           string                       `json:"path" doc:"Absolute file path."`
	Type           string                       `json:"type" example:"file" doc:"Node type: file, directory, symlink, or other."`
	Exists         bool                         `json:"exists" doc:"Whether the path exists."`
	Size           int64                        `json:"size,omitempty" doc:"File size in bytes."`
	UpdatedAt      string                       `json:"updatedAt,omitempty" doc:"Modification time."`
	Children       []OpenClawAgentWorkspaceNode `json:"children,omitempty" doc:"Child nodes when this is an expanded directory."`
	ChildCount     int                          `json:"childCount,omitempty" doc:"Best-effort child count for directories."`
	Symlink        bool                         `json:"symlink" doc:"Whether this node is a symlink."`
	Target         string                       `json:"target,omitempty" doc:"Symlink target when available."`
	TargetInside   bool                         `json:"targetInside" doc:"Whether symlink target stays inside workspace."`
	Readable       bool                         `json:"readable" doc:"Whether content can be previewed."`
	Binary         bool                         `json:"binary" doc:"Whether file appears binary."`
	Truncated      bool                         `json:"truncated" doc:"Whether content or tree children were truncated."`
	Mime           string                       `json:"mime,omitempty" doc:"Best-effort MIME type."`
	Language       string                       `json:"language,omitempty" doc:"Best-effort editor language."`
	RedactedReason string                       `json:"redactedReason,omitempty" doc:"Reason content is not returned."`
}

func GetOpenClawAgentWorkspaceTree(ctx context.Context, input *OpenClawAgentWorkspaceTreeInput) (*OpenClawAgentWorkspaceTreeOutput, error) {
	agent, err := findOpenClawAgentByID(input.ID)
	if err != nil {
		return nil, err
	}
	workspace, targetPath, relativePath, err := resolveOpenClawAgentWorkspaceRelativePath(agent.Workspace, input.Path)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid openclaw workspace path", err)
	}
	stat, err := os.Lstat(targetPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, huma.Error404NotFound("openclaw workspace path does not exist", err)
		}
		return nil, huma.Error500InternalServerError("stat openclaw workspace path failed", err)
	}
	if !stat.IsDir() {
		return nil, huma.Error400BadRequest("openclaw workspace path is not a directory", nil)
	}

	depth := clampOpenClawWorkspaceDepth(input.Depth)
	maxEntries := clampOpenClawWorkspaceMaxEntries(input.MaxEntries)
	builder := &openClawWorkspaceTreeBuilder{
		workspace:      workspace,
		includeHidden:  input.IncludeHidden,
		maxDepth:       depth,
		maxEntries:     maxEntries,
		remainingCount: maxEntries,
	}
	root, err := builder.buildNode(targetPath, relativePath, 0)
	if err != nil {
		return nil, huma.Error500InternalServerError("read openclaw workspace tree failed", err)
	}
	return &OpenClawAgentWorkspaceTreeOutput{Body: OpenClawAgentWorkspaceTreeResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AgentID:   agent.ID,
		Workspace: workspace,
		Root:      root,
		Summary: OpenClawAgentWorkspaceTreeSummary{
			Directories: builder.directories,
			Files:       builder.files,
			Truncated:   builder.truncated,
			MaxEntries:  maxEntries,
			Depth:       depth,
		},
	}}, nil
}

func GetOpenClawAgentWorkspaceFile(ctx context.Context, input *OpenClawAgentWorkspaceFileInput) (*OpenClawAgentWorkspaceFileOutput, error) {
	agent, err := findOpenClawAgentByID(input.ID)
	if err != nil {
		return nil, err
	}
	workspace, filePath, relativePath, err := resolveOpenClawAgentWorkspaceRelativePath(agent.Workspace, input.Path)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid openclaw workspace file path", err)
	}
	stat, err := os.Lstat(filePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, huma.Error404NotFound("openclaw workspace file does not exist", err)
		}
		return nil, huma.Error500InternalServerError("stat openclaw workspace file failed", err)
	}
	if stat.IsDir() {
		return nil, huma.Error400BadRequest("openclaw workspace path is a directory", nil)
	}
	node, err := openClawWorkspaceNodeFromInfo(workspace, filePath, relativePath, stat)
	if err != nil {
		return nil, huma.Error500InternalServerError("stat openclaw workspace file failed", err)
	}
	maxBytes := clampOpenClawWorkspaceFileMaxBytes(input.MaxBytes)
	content, dataURL, updatedNode, err := readOpenClawWorkspaceFilePreview(node, maxBytes)
	if err != nil {
		return nil, huma.Error500InternalServerError("read openclaw workspace file failed", err)
	}
	return &OpenClawAgentWorkspaceFileOutput{Body: OpenClawAgentWorkspaceFileResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AgentID:   agent.ID,
		Workspace: workspace,
		File:      updatedNode,
		Content:   content,
		DataURL:   dataURL,
	}}, nil
}

func CreateOpenClawAgentWorkspaceEntry(ctx context.Context, input *OpenClawAgentWorkspaceCreateInput) (*OpenClawAgentWorkspaceMutationOutput, error) {
	agent, err := findOpenClawAgentByID(input.ID)
	if err != nil {
		return nil, err
	}
	workspace, targetPath, relativePath, err := resolveOpenClawAgentWorkspaceRelativePath(agent.Workspace, input.Body.Path)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid openclaw workspace path", err)
	}
	if relativePath == "." {
		return nil, huma.Error400BadRequest("workspace root cannot be created", nil)
	}
	if err := validateOpenClawWorkspaceMutationPath(relativePath); err != nil {
		return nil, huma.Error400BadRequest("invalid openclaw workspace path", err)
	}
	entryType := strings.ToLower(strings.TrimSpace(input.Body.Type))
	if entryType == "" {
		entryType = "file"
	}
	if entryType != "file" && entryType != "directory" {
		return nil, huma.Error400BadRequest("workspace entry type must be file or directory", nil)
	}
	if _, err := os.Lstat(targetPath); err == nil {
		return nil, huma.Error400BadRequest(fmt.Sprintf("工作区路径已存在：%s", relativePath), errors.New("openclaw workspace path already exists"))
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, huma.Error500InternalServerError("stat openclaw workspace path failed", err)
	}
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return nil, huma.Error500InternalServerError("create openclaw workspace parent directory failed", err)
	}
	if entryType == "directory" {
		if err := os.MkdirAll(targetPath, 0o755); err != nil {
			return nil, huma.Error500InternalServerError("create openclaw workspace directory failed", err)
		}
	} else {
		if filepath.Dir(filepath.ToSlash(relativePath)) == "." {
			return nil, huma.Error400BadRequest("workspace root does not allow direct file upload", errors.New("cannot upload file to workspace root"))
		}
		content := []byte(input.Body.Content)
		if input.Body.ContentBase64 != "" {
			decoded, err := base64.StdEncoding.DecodeString(input.Body.ContentBase64)
			if err != nil {
				return nil, huma.Error400BadRequest("invalid openclaw workspace file base64 content", err)
			}
			content = decoded
		}
		if len(content) > openClawWorkspaceUploadMaxBytes {
			return nil, huma.Error413RequestEntityTooLarge(fmt.Sprintf("openclaw workspace uploaded file is too large limit=%d bytes", openClawWorkspaceUploadMaxBytes), nil)
		}
		if err := os.WriteFile(targetPath, content, 0o600); err != nil {
			return nil, huma.Error500InternalServerError("create openclaw workspace file failed", err)
		}
	}
	stat, err := os.Lstat(targetPath)
	if err != nil {
		return nil, huma.Error500InternalServerError("stat openclaw workspace path failed", err)
	}
	node, err := openClawWorkspaceNodeFromInfo(workspace, targetPath, relativePath, stat)
	if err != nil {
		return nil, huma.Error500InternalServerError("stat openclaw workspace path failed", err)
	}
	return &OpenClawAgentWorkspaceMutationOutput{Body: OpenClawAgentWorkspaceMutationResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AgentID:   agent.ID,
		Workspace: workspace,
		Action:    "create",
		Node:      node,
	}}, nil
}

func UpdateOpenClawAgentWorkspaceFile(ctx context.Context, input *OpenClawAgentWorkspaceUpdateInput) (*OpenClawAgentWorkspaceMutationOutput, error) {
	agent, err := findOpenClawAgentByID(input.ID)
	if err != nil {
		return nil, err
	}
	workspace, targetPath, relativePath, err := resolveOpenClawAgentWorkspaceRelativePath(agent.Workspace, input.Body.Path)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid openclaw workspace file path", err)
	}
	if relativePath == "." {
		return nil, huma.Error400BadRequest("workspace root cannot be updated", nil)
	}
	if err := validateOpenClawWorkspaceMutationPath(relativePath); err != nil {
		return nil, huma.Error400BadRequest("invalid openclaw workspace file path", err)
	}
	if len([]byte(input.Body.Content)) > openClawWorkspaceUploadMaxBytes {
		return nil, huma.Error413RequestEntityTooLarge(fmt.Sprintf("openclaw workspace file content is too large limit=%d bytes", openClawWorkspaceUploadMaxBytes), nil)
	}
	stat, err := os.Lstat(targetPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, huma.Error404NotFound("openclaw workspace file does not exist", err)
		}
		return nil, huma.Error500InternalServerError("stat openclaw workspace file failed", err)
	}
	if stat.IsDir() {
		return nil, huma.Error400BadRequest("openclaw workspace path is a directory", nil)
	}
	if stat.Mode()&os.ModeSymlink != 0 {
		return nil, huma.Error400BadRequest("symlink workspace file cannot be updated", errors.New("symlink file"))
	}
	node, err := openClawWorkspaceNodeFromInfo(workspace, targetPath, relativePath, stat)
	if err != nil {
		return nil, huma.Error500InternalServerError("stat openclaw workspace file failed", err)
	}
	if node.Binary || node.RedactedReason != "" {
		return nil, huma.Error400BadRequest("openclaw workspace file is not editable", errors.New("file is not editable"))
	}
	if err := os.WriteFile(targetPath, []byte(input.Body.Content), stat.Mode().Perm()); err != nil {
		return nil, huma.Error500InternalServerError("update openclaw workspace file failed", err)
	}
	updatedStat, err := os.Lstat(targetPath)
	if err != nil {
		return nil, huma.Error500InternalServerError("stat openclaw workspace file failed", err)
	}
	updatedNode, err := openClawWorkspaceNodeFromInfo(workspace, targetPath, relativePath, updatedStat)
	if err != nil {
		return nil, huma.Error500InternalServerError("stat openclaw workspace file failed", err)
	}
	return &OpenClawAgentWorkspaceMutationOutput{Body: OpenClawAgentWorkspaceMutationResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AgentID:   agent.ID,
		Workspace: workspace,
		Action:    "update",
		Node:      updatedNode,
	}}, nil
}

func DeleteOpenClawAgentWorkspaceEntry(ctx context.Context, input *OpenClawAgentWorkspaceDeleteInput) (*OpenClawAgentWorkspaceMutationOutput, error) {
	agent, err := findOpenClawAgentByID(input.ID)
	if err != nil {
		return nil, err
	}
	workspace, targetPath, relativePath, err := resolveOpenClawAgentWorkspaceRelativePath(agent.Workspace, input.Body.Path)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid openclaw workspace path", err)
	}
	if relativePath == "." {
		return nil, huma.Error400BadRequest("workspace root cannot be deleted", nil)
	}
	if isOpenClawWorkspaceProtectedDeleteFile(relativePath) {
		return nil, huma.Error400BadRequest("protected openclaw workspace file cannot be deleted", nil)
	}
	stat, err := os.Lstat(targetPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, huma.Error404NotFound("openclaw workspace path does not exist", err)
		}
		return nil, huma.Error500InternalServerError("stat openclaw workspace path failed", err)
	}
	node, err := openClawWorkspaceNodeFromInfo(workspace, targetPath, relativePath, stat)
	if err != nil {
		return nil, huma.Error500InternalServerError("stat openclaw workspace path failed", err)
	}
	if err := os.RemoveAll(targetPath); err != nil {
		return nil, huma.Error500InternalServerError("delete openclaw workspace path failed", err)
	}
	return &OpenClawAgentWorkspaceMutationOutput{Body: OpenClawAgentWorkspaceMutationResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AgentID:   agent.ID,
		Workspace: workspace,
		Action:    "delete",
		Node:      node,
	}}, nil
}

func MoveOpenClawAgentWorkspaceEntry(ctx context.Context, input *OpenClawAgentWorkspaceMoveInput) (*OpenClawAgentWorkspaceMutationOutput, error) {
	agent, err := findOpenClawAgentByID(input.ID)
	if err != nil {
		return nil, err
	}
	workspace, sourcePath, relativePath, err := resolveOpenClawAgentWorkspaceRelativePath(agent.Workspace, input.Body.Path)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid openclaw workspace source path", err)
	}
	_, targetDirectoryPath, targetDirectoryRelativePath, err := resolveOpenClawAgentWorkspaceRelativePath(agent.Workspace, input.Body.TargetPath)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid openclaw workspace target path", err)
	}
	if relativePath == "." {
		return nil, huma.Error400BadRequest("workspace root cannot be moved", nil)
	}
	if isOpenClawWorkspaceProtectedDeleteFile(relativePath) {
		return nil, huma.Error400BadRequest("protected openclaw workspace file cannot be moved", errors.New("protected file"))
	}
	if err := validateOpenClawWorkspaceMutationPath(relativePath); err != nil {
		return nil, huma.Error400BadRequest("invalid openclaw workspace source path", err)
	}
	if targetDirectoryRelativePath != "." {
		if err := validateOpenClawWorkspaceMutationPath(targetDirectoryRelativePath); err != nil {
			return nil, huma.Error400BadRequest("invalid openclaw workspace target path", err)
		}
	}
	sourceStat, err := os.Lstat(sourcePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, huma.Error404NotFound("openclaw workspace source path does not exist", err)
		}
		return nil, huma.Error500InternalServerError("stat openclaw workspace source path failed", err)
	}
	targetStat, err := os.Lstat(targetDirectoryPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			if err := os.MkdirAll(targetDirectoryPath, 0o755); err != nil {
				return nil, huma.Error500InternalServerError("create openclaw workspace target directory failed", err)
			}
			targetStat, err = os.Lstat(targetDirectoryPath)
			if err != nil {
				return nil, huma.Error500InternalServerError("stat openclaw workspace target path failed", err)
			}
		} else {
			return nil, huma.Error500InternalServerError("stat openclaw workspace target path failed", err)
		}
	}
	if !targetStat.IsDir() {
		return nil, huma.Error400BadRequest("openclaw workspace target path is not a directory", errors.New("target is not directory"))
	}
	destinationRelativePath := joinOpenClawWorkspaceRelativePath(targetDirectoryRelativePath, filepath.Base(filepath.ToSlash(relativePath)))
	if sourceStat.IsDir() && (destinationRelativePath == relativePath || strings.HasPrefix(destinationRelativePath, relativePath+"/")) {
		return nil, huma.Error400BadRequest("workspace directory cannot be moved into itself", errors.New("target inside source"))
	}
	_, destinationPath, destinationRelativePath, err := resolveOpenClawAgentWorkspaceRelativePath(agent.Workspace, destinationRelativePath)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid openclaw workspace destination path", err)
	}
	if _, err := os.Lstat(destinationPath); err == nil {
		return nil, huma.Error400BadRequest(fmt.Sprintf("目标路径已存在：%s", destinationRelativePath), errors.New("openclaw workspace destination path already exists"))
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, huma.Error500InternalServerError("stat openclaw workspace destination path failed", err)
	}
	if err := os.Rename(sourcePath, destinationPath); err != nil {
		return nil, huma.Error500InternalServerError("move openclaw workspace path failed", err)
	}
	stat, err := os.Lstat(destinationPath)
	if err != nil {
		return nil, huma.Error500InternalServerError("stat openclaw workspace destination path failed", err)
	}
	node, err := openClawWorkspaceNodeFromInfo(workspace, destinationPath, destinationRelativePath, stat)
	if err != nil {
		return nil, huma.Error500InternalServerError("stat openclaw workspace destination path failed", err)
	}
	return &OpenClawAgentWorkspaceMutationOutput{Body: OpenClawAgentWorkspaceMutationResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AgentID:   agent.ID,
		Workspace: workspace,
		Action:    "move",
		Node:      node,
	}}, nil
}

type openClawWorkspaceTreeBuilder struct {
	workspace      string
	includeHidden  bool
	maxDepth       int
	maxEntries     int
	remainingCount int
	directories    int
	files          int
	truncated      bool
}

func (builder *openClawWorkspaceTreeBuilder) buildNode(path string, relativePath string, depth int) (OpenClawAgentWorkspaceNode, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return OpenClawAgentWorkspaceNode{}, err
	}
	node, err := openClawWorkspaceNodeFromInfo(builder.workspace, path, relativePath, info)
	if err != nil {
		return OpenClawAgentWorkspaceNode{}, err
	}
	if node.Type == "directory" {
		builder.directories++
		entries, err := os.ReadDir(path)
		if err != nil {
			node.Readable = false
			node.RedactedReason = "目录不可读取"
			return node, nil
		}
		node.ChildCount = len(entries)
		if depth >= builder.maxDepth {
			if len(entries) > 0 {
				node.Truncated = true
			}
			return node, nil
		}
		sort.Slice(entries, func(i, j int) bool {
			leftInfo, leftErr := entries[i].Info()
			rightInfo, rightErr := entries[j].Info()
			if leftErr == nil && rightErr == nil && leftInfo.IsDir() != rightInfo.IsDir() {
				return leftInfo.IsDir()
			}
			return strings.ToLower(entries[i].Name()) < strings.ToLower(entries[j].Name())
		})
		node.Children = make([]OpenClawAgentWorkspaceNode, 0, len(entries))
		for _, entry := range entries {
			if builder.remainingCount <= 0 {
				builder.truncated = true
				node.Truncated = true
				break
			}
			name := entry.Name()
			if shouldSkipOpenClawWorkspaceEntry(name, builder.includeHidden) {
				continue
			}
			childRelativePath := joinOpenClawWorkspaceRelativePath(relativePath, name)
			childPath, err := ensureOpenClawWorkspacePathInside(builder.workspace, filepath.Join(path, name))
			if err != nil {
				continue
			}
			builder.remainingCount--
			child, err := builder.buildNode(childPath, childRelativePath, depth+1)
			if err != nil {
				continue
			}
			node.Children = append(node.Children, child)
		}
	} else {
		builder.files++
	}
	return node, nil
}

func resolveOpenClawAgentWorkspaceRelativePath(workspace string, relativePath string) (string, string, string, error) {
	workspace = filepath.Clean(strings.TrimSpace(workspace))
	if workspace == "" || workspace == "." {
		return "", "", "", errors.New("workspace path is required")
	}
	cleanRelative := filepath.ToSlash(strings.TrimSpace(relativePath))
	cleanRelative = strings.TrimPrefix(cleanRelative, "/")
	if cleanRelative == "" {
		cleanRelative = "."
	}
	cleanRelative = filepath.ToSlash(filepath.Clean(cleanRelative))
	if cleanRelative == "" || cleanRelative == "." {
		cleanRelative = "."
	} else if strings.HasPrefix(cleanRelative, "../") || strings.Contains(cleanRelative, "/../") || cleanRelative == ".." || filepath.IsAbs(cleanRelative) {
		return "", "", "", errors.New("workspace path escapes workspace")
	}
	target := workspace
	if cleanRelative != "." {
		target = filepath.Join(workspace, filepath.FromSlash(cleanRelative))
	}
	insidePath, err := ensureOpenClawWorkspacePathInside(workspace, target)
	if err != nil {
		return "", "", "", err
	}
	return workspace, insidePath, cleanRelative, nil
}

func ensureOpenClawWorkspacePathInside(workspace string, path string) (string, error) {
	workspace = filepath.Clean(workspace)
	path = filepath.Clean(path)
	rel, err := filepath.Rel(workspace, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", errors.New("workspace path escapes workspace")
	}
	return path, nil
}

func openClawWorkspaceNodeFromInfo(workspace string, path string, relativePath string, info os.FileInfo) (OpenClawAgentWorkspaceNode, error) {
	nodeType := "file"
	mode := info.Mode()
	if mode.IsDir() {
		nodeType = "directory"
	} else if mode&os.ModeSymlink != 0 {
		nodeType = "symlink"
	} else if !mode.IsRegular() {
		nodeType = "other"
	}
	node := OpenClawAgentWorkspaceNode{
		Name:         info.Name(),
		RelativePath: filepath.ToSlash(relativePath),
		Path:         path,
		Type:         nodeType,
		Exists:       true,
		Size:         info.Size(),
		UpdatedAt:    info.ModTime().UTC().Format(time.RFC3339),
		Symlink:      mode&os.ModeSymlink != 0,
		Readable:     nodeType == "file",
		Language:     openClawWorkspaceLanguageForPath(path),
	}
	if node.RelativePath == "." {
		node.Name = filepath.Base(workspace)
	}
	if node.Symlink {
		target, err := os.Readlink(path)
		if err == nil {
			node.Target = target
			resolved := target
			if !filepath.IsAbs(resolved) {
				resolved = filepath.Join(filepath.Dir(path), target)
			}
			if _, err := ensureOpenClawWorkspacePathInside(workspace, resolved); err == nil {
				node.TargetInside = true
			}
		}
		node.Readable = false
		node.RedactedReason = "符号链接不预览"
	}
	if isOpenClawWorkspaceSensitivePath(node.RelativePath) {
		node.Readable = false
		node.RedactedReason = "敏感文件已屏蔽"
	}
	return node, nil
}

func readOpenClawWorkspaceFilePreview(node OpenClawAgentWorkspaceNode, maxBytes int) (string, string, OpenClawAgentWorkspaceNode, error) {
	if !node.Readable {
		return "", "", node, nil
	}
	data, err := os.ReadFile(node.Path)
	if err != nil {
		return "", "", node, err
	}
	node.Mime = openClawWorkspaceMimeForPath(node.Path, data)
	if isOpenClawWorkspaceDataURLPreviewMime(node.Mime) {
		if node.Size > int64(maxBytes) {
			node.Truncated = true
			node.Readable = false
			node.RedactedReason = fmt.Sprintf("文件超过预览上限 %d bytes", maxBytes)
			return "", "", node, nil
		}
		if !isOpenClawWorkspaceTextPreviewMime(node.Mime) {
			node.Binary = true
		}
		return "", "data:" + node.Mime + ";base64," + base64.StdEncoding.EncodeToString(data), node, nil
	}
	if node.Size > int64(maxBytes) {
		node.Truncated = true
		node.Readable = false
		node.RedactedReason = fmt.Sprintf("文件超过预览上限 %d bytes", maxBytes)
		return "", "", node, nil
	}
	if isOpenClawWorkspaceBinaryData(data) {
		node.Binary = true
		node.Readable = false
		node.RedactedReason = "二进制文件不预览"
		return "", "", node, nil
	}
	if !utf8.Valid(data) {
		node.Binary = true
		node.Readable = false
		node.RedactedReason = "非 UTF-8 文本不预览"
		return "", "", node, nil
	}
	return string(data), "", node, nil
}

func clampOpenClawWorkspaceDepth(depth int) int {
	if depth <= 0 {
		return openClawWorkspaceTreeDefaultDepth
	}
	if depth > openClawWorkspaceTreeMaxDepth {
		return openClawWorkspaceTreeMaxDepth
	}
	return depth
}

func clampOpenClawWorkspaceMaxEntries(maxEntries int) int {
	if maxEntries <= 0 {
		return openClawWorkspaceTreeDefaultMaxEntries
	}
	if maxEntries > openClawWorkspaceTreeMaxEntries {
		return openClawWorkspaceTreeMaxEntries
	}
	return maxEntries
}

func clampOpenClawWorkspaceFileMaxBytes(maxBytes int) int {
	if maxBytes <= 0 {
		return openClawWorkspaceFileDefaultMaxBytes
	}
	if maxBytes > openClawWorkspaceFileMaxBytes {
		return openClawWorkspaceFileMaxBytes
	}
	return maxBytes
}

func shouldSkipOpenClawWorkspaceEntry(name string, includeHidden bool) bool {
	if openClawWorkspaceIgnoredNames[name] {
		return true
	}
	if strings.HasPrefix(name, ".") {
		return true
	}
	return false
}

func joinOpenClawWorkspaceRelativePath(base string, name string) string {
	if base == "" || base == "." {
		return filepath.ToSlash(name)
	}
	return filepath.ToSlash(filepath.Join(filepath.FromSlash(base), name))
}

func validateOpenClawWorkspaceMutationPath(relativePath string) error {
	parts := strings.Split(filepath.ToSlash(relativePath), "/")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" || part == "." || part == ".." {
			return errors.New("workspace path contains invalid segment")
		}
		if strings.HasPrefix(part, ".") {
			return errors.New("hidden files and directories are not supported")
		}
		if openClawWorkspaceIgnoredNames[part] {
			return errors.New("workspace path is ignored")
		}
	}
	return nil
}

func isOpenClawWorkspaceProtectedDeleteFile(relativePath string) bool {
	return openClawWorkspaceProtectedDeleteFiles[filepath.Base(filepath.ToSlash(relativePath))]
}

func isOpenClawWorkspaceSensitivePath(relativePath string) bool {
	lower := strings.ToLower(filepath.ToSlash(relativePath))
	base := strings.ToLower(filepath.Base(lower))
	if strings.HasPrefix(base, ".env") {
		return true
	}
	sensitiveFragments := []string{"credential", "credentials", "secret", "token", "password", "passwd", "private_key", "id_rsa", "id_ed25519"}
	for _, fragment := range sensitiveFragments {
		if strings.Contains(lower, fragment) {
			return true
		}
	}
	return false
}

func isOpenClawWorkspaceDataURLPreviewMime(mimeType string) bool {
	if strings.HasPrefix(mimeType, "image/") || strings.HasPrefix(mimeType, "audio/") || strings.HasPrefix(mimeType, "video/") {
		return true
	}
	switch mimeType {
	case "application/pdf",
		"application/msword",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"application/vnd.ms-excel",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"application/vnd.ms-powerpoint",
		"application/vnd.openxmlformats-officedocument.presentationml.presentation":
		return true
	default:
		return false
	}
}

func isOpenClawWorkspaceTextPreviewMime(mimeType string) bool {
	return strings.HasPrefix(mimeType, "text/") || strings.Contains(mimeType, "json") || strings.Contains(mimeType, "xml") || strings.Contains(mimeType, "yaml")
}

func openClawWorkspaceMimeForPath(path string, data []byte) string {
	ext := strings.ToLower(filepath.Ext(path))
	if mimeType := mime.TypeByExtension(ext); mimeType != "" {
		return strings.Split(mimeType, ";")[0]
	}
	switch ext {
	case ".md", ".markdown":
		return "text/markdown"
	case ".json":
		return "application/json"
	case ".yaml", ".yml":
		return "application/yaml"
	case ".toml":
		return "application/toml"
	case ".doc":
		return "application/msword"
	case ".docx":
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case ".xls":
		return "application/vnd.ms-excel"
	case ".xlsx":
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case ".ppt":
		return "application/vnd.ms-powerpoint"
	case ".pptx":
		return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	case ".m4a":
		return "audio/mp4"
	case ".mov":
		return "video/quicktime"
	default:
		return http.DetectContentType(data)
	}
}

func isOpenClawWorkspaceBinaryData(data []byte) bool {
	if len(data) == 0 {
		return false
	}
	probe := data
	if len(probe) > 8000 {
		probe = probe[:8000]
	}
	if bytes.IndexByte(probe, 0) >= 0 {
		return true
	}
	return false
}

func openClawWorkspaceLanguageForPath(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".md", ".markdown":
		return "markdown"
	case ".json":
		return "json"
	case ".yaml", ".yml":
		return "yaml"
	case ".toml":
		return "toml"
	case ".go":
		return "go"
	case ".ts", ".tsx":
		return "typescript"
	case ".js", ".jsx", ".mjs", ".cjs":
		return "javascript"
	case ".css":
		return "css"
	case ".scss", ".sass":
		return "scss"
	case ".html", ".htm":
		return "html"
	case ".sh", ".bash", ".zsh":
		return "shell"
	case ".py":
		return "python"
	case ".rs":
		return "rust"
	case ".java":
		return "java"
	case ".xml":
		return "xml"
	case ".sql":
		return "sql"
	default:
		return "plaintext"
	}
}
