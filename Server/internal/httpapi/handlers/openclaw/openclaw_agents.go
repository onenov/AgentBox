package openclaw

// OpenClaw agent handlers expose a structured, read-only view over the local OpenClaw agent config.
//
// The source of truth is ~/.openclaw/openclaw.json. These handlers intentionally avoid returning
// credentials or raw auth profile contents; they summarize agent identity, workspaces, model policy,
// route bindings, runtime selection, and session store locations for management UIs.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

const defaultOpenClawAgentID = "main"
const openClawWorkspaceStateDirName = ".openclaw"
const openClawWorkspaceStateFileName = "workspace-state.json"
const openClawWorkspaceStateVersion = 1

var openClawWorkspaceBootstrapFiles = []string{"AGENTS.md", "SOUL.md", "TOOLS.md", "IDENTITY.md", "USER.md", "HEARTBEAT.md", "BOOTSTRAP.md"}
var openClawOptionalWorkspaceBootstrapFiles = map[string]bool{"SOUL.md": true, "IDENTITY.md": true, "USER.md": true, "HEARTBEAT.md": true}
var openClawFallbackWorkspaceTemplates = map[string]string{
	"AGENTS.md": `# AGENTS.md - Your Workspace

This folder is home. Treat it that way.

## First Run

If ` + "`BOOTSTRAP.md`" + ` exists, follow it, figure out who you are, then delete it.
`,
	"SOUL.md": `# SOUL.md - Who You Are

You're not a chatbot. You're becoming someone.
`,
	"TOOLS.md": `# TOOLS.md - Local Notes

Skills define how tools work. This file is for your local notes.
`,
	"IDENTITY.md": `# IDENTITY.md - Who Am I?

- **Name:**
- **Creature:**
- **Vibe:**
- **Emoji:**
- **Avatar:**
`,
	"USER.md": `# USER.md - About Your Human

- **Name:**
- **What to call them:**
- **Pronouns:**
- **Timezone:**
- **Notes:**
`,
	"HEARTBEAT.md": `# Keep this file empty to skip heartbeat API calls.
`,
	"BOOTSTRAP.md": `# BOOTSTRAP.md - Hello, World

You just woke up. Time to figure out who you are.
`,
}

type OpenClawAgentsOutput struct {
	Body OpenClawAgentsResponse
}

type OpenClawAgentOutput struct {
	Body OpenClawAgentDetailResponse
}

type OpenClawAgentDeleteOutput struct {
	Body OpenClawAgentDeleteResponse
}

type OpenClawAgentPathInput struct {
	ID string `path:"id" doc:"OpenClaw agent id." example:"main"`
}

type OpenClawAgentFilePathInput struct {
	ID   string `path:"id" doc:"OpenClaw agent id." example:"main"`
	Name string `path:"name" doc:"Workspace bootstrap file name." example:"IDENTITY.md"`
}

type OpenClawAgentFileUpdateInput struct {
	ID   string `path:"id" doc:"OpenClaw agent id." example:"main"`
	Name string `path:"name" doc:"Workspace bootstrap file name." example:"IDENTITY.md"`
	Body OpenClawAgentFileUpdateRequest
}

type OpenClawAgentCreateInput struct {
	Body OpenClawAgentMutationRequest
}

type OpenClawAgentUpdateInput struct {
	ID   string `path:"id" doc:"OpenClaw agent id." example:"main"`
	Body OpenClawAgentMutationRequest
}

type OpenClawAgentsResponse struct {
	Status    string                 `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                 `json:"timestamp" example:"2026-05-12T02:40:00Z" doc:"UTC response timestamp."`
	Path      string                 `json:"path" example:"/Users/one/.openclaw/openclaw.json" doc:"OpenClaw config file path."`
	Exists    bool                   `json:"exists" example:"true" doc:"Whether openclaw.json exists."`
	Defaults  OpenClawAgentDefaults  `json:"defaults" doc:"Resolved global OpenClaw agent defaults."`
	Agents    []OpenClawAgentSummary `json:"agents" doc:"Configured OpenClaw agents."`
	Bindings  []OpenClawAgentBinding `json:"bindings" doc:"Configured route and ACP bindings."`
	Summary   OpenClawAgentsSummary  `json:"summary" doc:"Aggregate agent counts for management UI."`
}

type OpenClawAgentDetailResponse struct {
	Status    string                    `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                    `json:"timestamp" example:"2026-05-12T02:40:00Z" doc:"UTC response timestamp."`
	Path      string                    `json:"path" example:"/Users/one/.openclaw/openclaw.json" doc:"OpenClaw config file path."`
	Exists    bool                      `json:"exists" example:"true" doc:"Whether openclaw.json exists."`
	Agent     OpenClawAgentSummary      `json:"agent" doc:"Agent summary."`
	Files     []OpenClawAgentFileStatus `json:"files" doc:"Important workspace bootstrap file status."`
}

type OpenClawAgentDeleteResponse struct {
	Status                  string   `json:"status" example:"ok" doc:"Operation status."`
	Timestamp               string   `json:"timestamp" example:"2026-05-12T02:40:00Z" doc:"UTC response timestamp."`
	Path                    string   `json:"path" example:"/Users/one/.openclaw/openclaw.json" doc:"OpenClaw config file path."`
	AgentID                 string   `json:"agentId" example:"work" doc:"Deleted agent id."`
	Workspace               string   `json:"workspace,omitempty" doc:"Resolved workspace path before deletion."`
	WorkspaceRetained       bool     `json:"workspaceRetained,omitempty" doc:"Whether workspace was retained because another agent shares it."`
	WorkspaceRetainedReason string   `json:"workspaceRetainedReason,omitempty" example:"shared" doc:"Why workspace was retained."`
	WorkspaceSharedWith     []string `json:"workspaceSharedWith,omitempty" doc:"Agents sharing the same workspace."`
	AgentDir                string   `json:"agentDir,omitempty" doc:"Resolved agent state directory before deletion."`
	SessionStore            string   `json:"sessionStore,omitempty" doc:"Resolved session store path before deletion."`
	RemovedBindings         int      `json:"removedBindings" example:"2" doc:"Number of bindings removed for this agent."`
	RemovedAllow            int      `json:"removedAllow" example:"1" doc:"Number of agent-to-agent allow entries removed for this agent."`
}

type OpenClawAgentFileOutput struct {
	Body OpenClawAgentFileResponse
}

type OpenClawAgentFileResponse struct {
	Status    string                  `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                  `json:"timestamp" example:"2026-05-12T02:40:00Z" doc:"UTC response timestamp."`
	AgentID   string                  `json:"agentId" example:"main" doc:"Agent id."`
	File      OpenClawAgentFileStatus `json:"file" doc:"Workspace file status."`
	Content   string                  `json:"content" doc:"Plain text file content."`
}

type OpenClawAgentFileUpdateRequest struct {
	Content string `json:"content" doc:"Plain text file content to write."`
}

type OpenClawAgentMutationRequest struct {
	ID               string         `json:"id,omitempty" doc:"Agent id used when creating."`
	Name             string         `json:"name,omitempty" doc:"Agent display name."`
	Emoji            string         `json:"emoji,omitempty" doc:"Agent emoji."`
	Avatar           string         `json:"avatar,omitempty" doc:"Agent avatar path or URL."`
	Workspace        string         `json:"workspace,omitempty" doc:"Agent workspace path."`
	AgentDir         string         `json:"agentDir,omitempty" doc:"Agent state directory path."`
	Default          *bool          `json:"default,omitempty" doc:"Whether this agent should become the default fallback agent."`
	Model            string         `json:"model,omitempty" doc:"Primary model id."`
	ModelFallbacks   []string       `json:"modelFallbacks,omitempty" doc:"Fallback model ids."`
	ThinkingDefault  string         `json:"thinkingDefault,omitempty" doc:"Default thinking level for this agent." example:"medium"`
	ReasoningDefault string         `json:"reasoningDefault,omitempty" doc:"Default reasoning visibility for this agent." example:"stream"`
	VerboseDefault   string         `json:"verboseDefault,omitempty" doc:"Default verbose level for this agent." example:"on"`
	FastModeDefault  *bool          `json:"fastModeDefault,omitempty" doc:"Default fast-mode state for this agent."`
	Params           map[string]any `json:"params,omitempty" doc:"Per-agent model parameter overrides."`
	Tools            map[string]any `json:"tools,omitempty" doc:"Per-agent tool policy overrides."`
	Sandbox          map[string]any `json:"sandbox,omitempty" doc:"Per-agent sandbox overrides."`
	GroupChat        map[string]any `json:"groupChat,omitempty" doc:"Per-agent group chat overrides."`
	Subagents        map[string]any `json:"subagents,omitempty" doc:"Per-agent subagent overrides."`
	Skills           []string       `json:"skills,omitempty" doc:"Allowed skills."`
	SkillsMode       string         `json:"skillsMode,omitempty" doc:"Skill allowlist mode: explicit writes skills, inherit/unrestricted removes per-agent skills." example:"explicit"`
	Identity         map[string]any `json:"identity,omitempty" doc:"Raw identity object override."`
	Runtime          map[string]any `json:"runtime,omitempty" doc:"Runtime configuration override."`
	Config           map[string]any `json:"config,omitempty" doc:"Additional raw config entries."`
}

type OpenClawAgentsSummary struct {
	Total        int `json:"total" example:"2" doc:"Total configured or inferred agents."`
	DefaultCount int `json:"defaultCount" example:"1" doc:"Agents marked as default after resolution."`
	BoundCount   int `json:"boundCount" example:"1" doc:"Agents with at least one route or ACP binding."`
	RuntimeCount int `json:"runtimeCount" example:"1" doc:"Agents with explicit runtime configuration."`
}

type OpenClawAgentDefaults struct {
	DefaultAgentID string   `json:"defaultAgentId" example:"main" doc:"Resolved default agent id."`
	Workspace      string   `json:"workspace" example:"/Users/one/.openclaw/workspace" doc:"Resolved default workspace path."`
	AgentDirRoot   string   `json:"agentDirRoot" example:"/Users/one/.openclaw/agents" doc:"Default root used to infer agent state directories."`
	SessionStore   string   `json:"sessionStore" example:"/Users/one/.openclaw/agents/{agentId}/sessions/sessions.json" doc:"Configured or default session store template."`
	Model          string   `json:"model,omitempty" example:"anthropic/claude-opus-4-6" doc:"Resolved default primary model."`
	Skills         []string `json:"skills,omitempty" doc:"Default skill allowlist when configured."`
}

type OpenClawAgentSummary struct {
	ID                 string                 `json:"id" example:"main" doc:"Agent id."`
	Name               string                 `json:"name,omitempty" example:"Main Agent" doc:"Configured agent display name."`
	IsDefault          bool                   `json:"isDefault" example:"true" doc:"Whether this is the resolved default agent."`
	Workspace          string                 `json:"workspace" example:"/Users/one/.openclaw/workspace" doc:"Resolved agent workspace path."`
	WorkspaceExists    bool                   `json:"workspaceExists" example:"true" doc:"Whether the resolved workspace directory exists."`
	AgentDir           string                 `json:"agentDir" example:"/Users/one/.openclaw/agents/main/agent" doc:"Resolved agent state directory."`
	AgentDirExists     bool                   `json:"agentDirExists" example:"true" doc:"Whether the resolved agent directory exists."`
	SessionStore       string                 `json:"sessionStore" example:"/Users/one/.openclaw/agents/main/sessions/sessions.json" doc:"Resolved session store path."`
	SessionStoreExists bool                   `json:"sessionStoreExists" example:"true" doc:"Whether the session store file exists."`
	Model              string                 `json:"model,omitempty" example:"anthropic/claude-opus-4-6" doc:"Resolved primary model."`
	Runtime            OpenClawAgentRuntime   `json:"runtime" doc:"Resolved runtime summary."`
	Identity           OpenClawAgentIdentity  `json:"identity" doc:"Configured or workspace-derived identity summary."`
	Skills             []string               `json:"skills,omitempty" doc:"Effective configured skill allowlist when constrained."`
	SkillsInherited    bool                   `json:"skillsInherited" example:"true" doc:"Whether skills are inherited from defaults."`
	BindingsCount      int                    `json:"bindingsCount" example:"2" doc:"Number of bindings assigned to this agent."`
	Bindings           []OpenClawAgentBinding `json:"bindings,omitempty" doc:"Bindings assigned to this agent."`
	Config             map[string]any         `json:"config,omitempty" doc:"Sanitized raw per-agent config block."`
}

type OpenClawAgentRuntime struct {
	Type     string `json:"type" example:"embedded" doc:"Runtime type: embedded, acp, or auto."`
	ID       string `json:"id,omitempty" example:"codex" doc:"Legacy or model runtime id when present."`
	Backend  string `json:"backend,omitempty" example:"codex" doc:"ACP backend override when present."`
	Mode     string `json:"mode,omitempty" example:"persistent" doc:"Runtime session mode when present."`
	CWD      string `json:"cwd,omitempty" example:"/Users/one/project" doc:"Runtime working directory override when present."`
	Explicit bool   `json:"explicit" example:"false" doc:"Whether runtime was explicitly configured on this agent."`
}

type OpenClawAgentIdentity struct {
	Name               string `json:"name,omitempty" example:"OpenClaw" doc:"Agent display name from config or IDENTITY.md."`
	Theme              string `json:"theme,omitempty" example:"helpful operator" doc:"Agent theme from config or IDENTITY.md."`
	Emoji              string `json:"emoji,omitempty" example:"bot" doc:"Agent emoji from config or IDENTITY.md."`
	Avatar             string `json:"avatar,omitempty" example:"avatars/openclaw.png" doc:"Agent avatar from config."`
	Source             string `json:"source,omitempty" example:"config" doc:"Identity source: config or identity-file."`
	IdentityFilePath   string `json:"identityFilePath,omitempty" example:"/Users/one/.openclaw/workspace/IDENTITY.md" doc:"Workspace IDENTITY.md path."`
	IdentityFileExists bool   `json:"identityFileExists" example:"true" doc:"Whether IDENTITY.md exists in the workspace."`
}

type OpenClawAgentBinding struct {
	Type      string         `json:"type" example:"route" doc:"Binding type: route or acp."`
	AgentID   string         `json:"agentId" example:"main" doc:"Target agent id."`
	Channel   string         `json:"channel,omitempty" example:"telegram" doc:"Matched channel."`
	AccountID string         `json:"accountId,omitempty" example:"ops" doc:"Matched account id."`
	PeerKind  string         `json:"peerKind,omitempty" example:"direct" doc:"Matched peer kind."`
	PeerID    string         `json:"peerId,omitempty" example:"123" doc:"Matched peer id."`
	GuildID   string         `json:"guildId,omitempty" example:"guild" doc:"Matched guild id."`
	TeamID    string         `json:"teamId,omitempty" example:"team" doc:"Matched team id."`
	Roles     []string       `json:"roles,omitempty" doc:"Matched role ids."`
	Label     string         `json:"label" example:"telegram:ops" doc:"Human-readable binding label."`
	ACP       map[string]any `json:"acp,omitempty" doc:"Sanitized ACP binding options."`
}

type OpenClawAgentFileStatus struct {
	Name   string `json:"name" example:"IDENTITY.md" doc:"Workspace bootstrap file name."`
	Path   string `json:"path" example:"/Users/one/.openclaw/workspace/IDENTITY.md" doc:"Resolved file path."`
	Exists bool   `json:"exists" example:"true" doc:"Whether the file exists."`
	Size   int64  `json:"size,omitempty" example:"1024" doc:"File size in bytes."`
}

type openClawAgentsConfigShape struct {
	Agents struct {
		Defaults map[string]any   `json:"defaults"`
		List     []map[string]any `json:"list"`
	} `json:"agents"`
	Bindings []map[string]any `json:"bindings"`
	Session  map[string]any   `json:"session"`
}

func ListOpenClawAgents(ctx context.Context, input *struct{}) (*OpenClawAgentsOutput, error) {
	payload, err := buildOpenClawAgentsResponse()
	if err != nil {
		return nil, err
	}
	return &OpenClawAgentsOutput{Body: payload}, nil
}

func CreateOpenClawAgent(ctx context.Context, input *OpenClawAgentCreateInput) (*OpenClawAgentOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("agent payload is required", nil)
	}
	agent, err := mutateOpenClawAgent("", input.Body, true)
	if err != nil {
		return nil, err
	}
	return &OpenClawAgentOutput{Body: OpenClawAgentDetailResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Path:      openClawConfigPath(),
		Exists:    true,
		Agent:     agent,
		Files:     listOpenClawAgentWorkspaceFiles(agent.Workspace),
	}}, nil
}

func UpdateOpenClawAgent(ctx context.Context, input *OpenClawAgentUpdateInput) (*OpenClawAgentOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("agent payload is required", nil)
	}
	agent, err := mutateOpenClawAgent(input.ID, input.Body, false)
	if err != nil {
		return nil, err
	}
	return &OpenClawAgentOutput{Body: OpenClawAgentDetailResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Path:      openClawConfigPath(),
		Exists:    true,
		Agent:     agent,
		Files:     listOpenClawAgentWorkspaceFiles(agent.Workspace),
	}}, nil
}

func DeleteOpenClawAgent(ctx context.Context, input *OpenClawAgentPathInput) (*OpenClawAgentDeleteOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("agent id is required", nil)
	}
	payload, err := deleteOpenClawAgent(input.ID)
	if err != nil {
		return nil, err
	}
	return &OpenClawAgentDeleteOutput{Body: payload}, nil
}

func GetOpenClawAgent(ctx context.Context, input *OpenClawAgentPathInput) (*OpenClawAgentOutput, error) {
	payload, err := buildOpenClawAgentsResponse()
	if err != nil {
		return nil, err
	}
	requestedID := normalizeOpenClawAgentID(input.ID)
	for _, agent := range payload.Agents {
		if normalizeOpenClawAgentID(agent.ID) == requestedID {
			return &OpenClawAgentOutput{Body: OpenClawAgentDetailResponse{
				Status:    payload.Status,
				Timestamp: time.Now().UTC().Format(time.RFC3339),
				Path:      payload.Path,
				Exists:    payload.Exists,
				Agent:     agent,
				Files:     listOpenClawAgentWorkspaceFiles(agent.Workspace),
			}}, nil
		}
	}
	return nil, huma.Error404NotFound("openclaw agent not found", fmt.Errorf("agent %q not found", input.ID))
}

func GetOpenClawAgentFile(ctx context.Context, input *OpenClawAgentFilePathInput) (*OpenClawAgentFileOutput, error) {
	agent, err := findOpenClawAgentByID(input.ID)
	if err != nil {
		return nil, err
	}
	filePath, err := resolveOpenClawAgentWorkspaceFilePath(agent.Workspace, input.Name)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid openclaw agent file name", err)
	}
	content, err := os.ReadFile(filePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, huma.Error404NotFound("openclaw agent file does not exist", err)
		}
		return nil, huma.Error500InternalServerError("read openclaw agent file failed", err)
	}
	file, err := openClawAgentFileStatus(filePath)
	if err != nil {
		return nil, huma.Error500InternalServerError("stat openclaw agent file failed", err)
	}
	return &OpenClawAgentFileOutput{Body: OpenClawAgentFileResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AgentID:   agent.ID,
		File:      file,
		Content:   string(content),
	}}, nil
}

func UpdateOpenClawAgentFile(ctx context.Context, input *OpenClawAgentFileUpdateInput) (*OpenClawAgentFileOutput, error) {
	agent, err := findOpenClawAgentByID(input.ID)
	if err != nil {
		return nil, err
	}
	filePath, err := resolveOpenClawAgentWorkspaceFilePath(agent.Workspace, input.Name)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid openclaw agent file name", err)
	}
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		return nil, huma.Error500InternalServerError("create openclaw agent workspace directory failed", err)
	}
	if err := os.WriteFile(filePath, []byte(input.Body.Content), 0o600); err != nil {
		return nil, huma.Error500InternalServerError("write openclaw agent file failed", err)
	}
	file, err := openClawAgentFileStatus(filePath)
	if err != nil {
		return nil, huma.Error500InternalServerError("stat openclaw agent file failed", err)
	}
	return &OpenClawAgentFileOutput{Body: OpenClawAgentFileResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AgentID:   agent.ID,
		File:      file,
		Content:   input.Body.Content,
	}}, nil
}

func findOpenClawAgentByID(id string) (OpenClawAgentSummary, error) {
	payload, err := buildOpenClawAgentsResponse()
	if err != nil {
		return OpenClawAgentSummary{}, err
	}
	requestedID := normalizeOpenClawAgentID(id)
	for _, agent := range payload.Agents {
		if normalizeOpenClawAgentID(agent.ID) == requestedID {
			return agent, nil
		}
	}
	return OpenClawAgentSummary{}, huma.Error404NotFound("openclaw agent not found", fmt.Errorf("agent %q not found", id))
}

func deleteOpenClawAgent(rawID string) (OpenClawAgentDeleteResponse, error) {
	configPath := openClawConfigPath()
	content, exists, err := readOpenClawConfigFile(configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return OpenClawAgentDeleteResponse{}, huma.Error404NotFound("openclaw config does not exist", err)
		}
		return OpenClawAgentDeleteResponse{}, huma.Error500InternalServerError("read openclaw config failed", err)
	}
	if !exists || content == nil {
		return OpenClawAgentDeleteResponse{}, huma.Error404NotFound("openclaw config does not exist", nil)
	}

	id := normalizeOpenClawAgentID(rawID)
	if id == "" {
		return OpenClawAgentDeleteResponse{}, huma.Error400BadRequest("agent id is required", nil)
	}
	if id == defaultOpenClawAgentID {
		return OpenClawAgentDeleteResponse{}, huma.Error400BadRequest("main cannot be deleted", nil)
	}

	agentsMap := objectMap(content["agents"])
	list := mapSliceFromValue(agentsMap["list"])
	entryIndex := -1
	for index, item := range list {
		if normalizeOpenClawAgentID(stringFromMap(item, "id")) == id {
			entryIndex = index
			break
		}
	}
	if entryIndex < 0 {
		return OpenClawAgentDeleteResponse{}, huma.Error404NotFound("openclaw agent not found", fmt.Errorf("agent %q not found", id))
	}

	defaults := buildOpenClawAgentDefaultsFromContent(content)
	agent := buildOpenClawAgentSummary(id, list[entryIndex], defaults, nil, objectMap(agentsMap["defaults"]))
	workspaceSharedWith := findOpenClawWorkspaceSharedAgentIDs(id, agent.Workspace, list, defaults)
	workspaceRetained := len(workspaceSharedWith) > 0

	nextList := make([]map[string]any, 0, len(list)-1)
	for index, item := range list {
		if index != entryIndex {
			nextList = append(nextList, item)
		}
	}
	if len(nextList) > 0 {
		agentsMap["list"] = nextList
	} else {
		delete(agentsMap, "list")
	}
	if len(agentsMap) > 0 {
		content["agents"] = agentsMap
	} else {
		delete(content, "agents")
	}

	removedBindings := pruneOpenClawAgentBindings(content, id)
	removedAllow := pruneOpenClawAgentAllow(content, id)

	formatted, err := json.MarshalIndent(content, "", "  ")
	if err != nil {
		return OpenClawAgentDeleteResponse{}, huma.Error400BadRequest("openclaw config content must be valid JSON", err)
	}
	formatted = append(formatted, '\n')
	if err := os.WriteFile(configPath, formatted, 0o600); err != nil {
		return OpenClawAgentDeleteResponse{}, huma.Error500InternalServerError("write openclaw config failed", err)
	}

	if !workspaceRetained {
		removeOpenClawPathBestEffort(agent.Workspace)
	}
	removeOpenClawPathBestEffort(agent.AgentDir)
	removeOpenClawPathBestEffort(filepath.Dir(agent.SessionStore))

	response := OpenClawAgentDeleteResponse{
		Status:          "ok",
		Timestamp:       time.Now().UTC().Format(time.RFC3339),
		Path:            configPath,
		AgentID:         id,
		Workspace:       agent.Workspace,
		AgentDir:        agent.AgentDir,
		SessionStore:    agent.SessionStore,
		RemovedBindings: removedBindings,
		RemovedAllow:    removedAllow,
	}
	if workspaceRetained {
		response.WorkspaceRetained = true
		response.WorkspaceRetainedReason = "shared"
		response.WorkspaceSharedWith = workspaceSharedWith
	}
	return response, nil
}

func mutateOpenClawAgent(pathID string, request OpenClawAgentMutationRequest, create bool) (OpenClawAgentSummary, error) {
	configPath := openClawConfigPath()
	content, exists, err := readOpenClawConfigFile(configPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return OpenClawAgentSummary{}, huma.Error500InternalServerError("read openclaw config failed", err)
	}
	if !exists || content == nil {
		content = map[string]any{}
	}

	agentsMap := objectMap(content["agents"])
	list := mapSliceFromValue(agentsMap["list"])
	id := normalizeOpenClawAgentID(pathID)
	if create {
		id = normalizeOpenClawAgentID(pathID)
		if id == "" {
			id = normalizeOpenClawAgentID(request.ID)
		}
		if id == "" {
			id = normalizeOpenClawAgentID(stringFromMap(request.Config, "id"))
		}
		if id == "" {
			id = normalizeOpenClawAgentID(request.Name)
		}
		if id == "" {
			return OpenClawAgentSummary{}, huma.Error400BadRequest("agent id or name is required", nil)
		}
		if id == defaultOpenClawAgentID {
			return OpenClawAgentSummary{}, huma.Error400BadRequest("main is reserved", nil)
		}
	} else if id == "" {
		return OpenClawAgentSummary{}, huma.Error400BadRequest("agent id is required", nil)
	}

	entryIndex := -1
	for index, item := range list {
		if normalizeOpenClawAgentID(stringFromMap(item, "id")) == id {
			entryIndex = index
			break
		}
	}
	defaults := buildOpenClawAgentDefaultsFromContent(content)
	if create && entryIndex >= 0 {
		return OpenClawAgentSummary{}, huma.Error409Conflict("openclaw agent already exists", fmt.Errorf("agent %q already exists", id))
	}
	if !create && entryIndex < 0 {
		if id != defaults.DefaultAgentID {
			return OpenClawAgentSummary{}, huma.Error404NotFound("openclaw agent not found", fmt.Errorf("agent %q not found", id))
		}
	}

	entry := map[string]any{"id": id}
	if entryIndex >= 0 {
		entry = cloneStringAnyMap(list[entryIndex])
	}
	entry["id"] = id
	applyOpenClawAgentMutation(entry, request)
	if request.Default != nil && *request.Default {
		for index, item := range list {
			if index == entryIndex {
				continue
			}
			delete(item, "default")
		}
	}
	if stringFromMap(entry, "workspace") == "" {
		entry["workspace"] = resolveOpenClawAgentWorkspaceDir(id, entry, defaults)
	}

	if entryIndex >= 0 {
		list[entryIndex] = entry
	} else {
		list = append(list, entry)
	}
	agentsMap["list"] = list
	content["agents"] = agentsMap

	formatted, err := json.MarshalIndent(content, "", "  ")
	if err != nil {
		return OpenClawAgentSummary{}, huma.Error400BadRequest("openclaw config content must be valid JSON", err)
	}
	formatted = append(formatted, '\n')
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		return OpenClawAgentSummary{}, huma.Error500InternalServerError("create openclaw config directory failed", err)
	}
	if err := os.WriteFile(configPath, formatted, 0o600); err != nil {
		return OpenClawAgentSummary{}, huma.Error500InternalServerError("write openclaw config failed", err)
	}

	payload, err := buildOpenClawAgentsResponse()
	if err != nil {
		return OpenClawAgentSummary{}, err
	}
	var agent OpenClawAgentSummary
	for _, item := range payload.Agents {
		if normalizeOpenClawAgentID(item.ID) == id {
			agent = item
			break
		}
	}
	if agent.ID == "" {
		return OpenClawAgentSummary{}, huma.Error500InternalServerError("openclaw agent mutation did not produce an agent", fmt.Errorf("agent %q missing after write", id))
	}
	if err := ensureOpenClawAgentDirectories(agent); err != nil {
		return OpenClawAgentSummary{}, err
	}
	bootstrapOptions := openClawAgentBootstrapOptionsFromContent(content)
	if create && !bootstrapOptions.SkipBootstrap {
		if err := ensureOpenClawAgentWorkspaceBootstrap(agent.Workspace, bootstrapOptions.SkipOptionalBootstrapFiles); err != nil {
			return OpenClawAgentSummary{}, err
		}
	}
	return agent, nil
}

func applyOpenClawAgentMutation(entry map[string]any, request OpenClawAgentMutationRequest) {
	for key, value := range request.Config {
		if strings.EqualFold(key, "id") {
			continue
		}
		entry[key] = value
	}
	if request.Name != "" {
		entry["name"] = strings.TrimSpace(request.Name)
	}
	if request.Default != nil {
		if *request.Default {
			entry["default"] = true
		} else {
			delete(entry, "default")
		}
	}
	if request.Workspace != "" {
		entry["workspace"] = resolveOpenClawUserPath(request.Workspace)
	}
	if request.AgentDir != "" {
		entry["agentDir"] = resolveOpenClawUserPath(request.AgentDir)
	}
	if request.Model != "" || request.ModelFallbacks != nil {
		model := objectMap(entry["model"])
		if request.Model != "" {
			model["primary"] = strings.TrimSpace(request.Model)
		}
		if request.ModelFallbacks != nil {
			fallbacks := make([]string, 0, len(request.ModelFallbacks))
			for _, fallback := range request.ModelFallbacks {
				if trimmed := strings.TrimSpace(fallback); trimmed != "" {
					fallbacks = append(fallbacks, trimmed)
				}
			}
			if len(fallbacks) > 0 {
				model["fallbacks"] = fallbacks
			} else {
				delete(model, "fallbacks")
			}
		}
		if len(model) > 0 {
			entry["model"] = model
		} else {
			delete(entry, "model")
		}
	}
	setOpenClawOptionalString(entry, "thinkingDefault", request.ThinkingDefault)
	setOpenClawOptionalString(entry, "reasoningDefault", request.ReasoningDefault)
	setOpenClawOptionalString(entry, "verboseDefault", request.VerboseDefault)
	if request.FastModeDefault != nil {
		entry["fastModeDefault"] = *request.FastModeDefault
	}
	if request.Params != nil {
		setOpenClawOptionalObject(entry, "params", request.Params)
	}
	if request.Tools != nil {
		setOpenClawOptionalObject(entry, "tools", request.Tools)
	}
	if request.Sandbox != nil {
		setOpenClawOptionalObject(entry, "sandbox", request.Sandbox)
	}
	if request.GroupChat != nil {
		setOpenClawOptionalObject(entry, "groupChat", request.GroupChat)
	}
	if request.Subagents != nil {
		setOpenClawOptionalObject(entry, "subagents", request.Subagents)
	}
	skillsMode := strings.ToLower(strings.TrimSpace(request.SkillsMode))
	if skillsMode == "inherit" || skillsMode == "unrestricted" {
		delete(entry, "skills")
	} else if request.Skills != nil {
		entry["skills"] = request.Skills
	}
	identity := objectMap(entry["identity"])
	for key, value := range request.Identity {
		identity[key] = value
	}
	if request.Name != "" {
		identity["name"] = strings.TrimSpace(request.Name)
	}
	if request.Emoji != "" {
		identity["emoji"] = strings.TrimSpace(request.Emoji)
	}
	if request.Avatar != "" {
		identity["avatar"] = strings.TrimSpace(request.Avatar)
	}
	if len(identity) > 0 {
		entry["identity"] = identity
	}
	if request.Runtime != nil {
		entry["runtime"] = request.Runtime
	}
}

func mapSliceFromValue(value any) []map[string]any {
	switch typed := value.(type) {
	case []map[string]any:
		out := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, cloneStringAnyMap(item))
		}
		return out
	case []any:
		out := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			if itemMap, ok := item.(map[string]any); ok {
				out = append(out, cloneStringAnyMap(itemMap))
			}
		}
		return out
	default:
		return []map[string]any{}
	}
}

func cloneStringAnyMap(values map[string]any) map[string]any {
	out := make(map[string]any, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}

func setOpenClawOptionalString(entry map[string]any, key string, value string) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return
	}
	entry[key] = trimmed
}

func setOpenClawOptionalObject(entry map[string]any, key string, value map[string]any) {
	cleaned := make(map[string]any, len(value))
	for itemKey, itemValue := range value {
		if strings.TrimSpace(itemKey) == "" || itemValue == nil {
			continue
		}
		cleaned[itemKey] = itemValue
	}
	if len(cleaned) > 0 {
		entry[key] = cleaned
		return
	}
	delete(entry, key)
}

func ensureOpenClawAgentDirectories(agent OpenClawAgentSummary) error {
	for _, dir := range []string{agent.Workspace, agent.AgentDir, filepath.Dir(agent.SessionStore)} {
		if strings.TrimSpace(dir) == "" || dir == "." {
			continue
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return huma.Error500InternalServerError("create openclaw agent directory failed", err)
		}
	}
	return nil
}

type openClawAgentBootstrapOptions struct {
	SkipBootstrap              bool
	SkipOptionalBootstrapFiles []string
}

func openClawAgentBootstrapOptionsFromContent(content map[string]any) openClawAgentBootstrapOptions {
	agents := objectMap(content["agents"])
	defaults := objectMap(agents["defaults"])
	return openClawAgentBootstrapOptions{
		SkipBootstrap:              boolFromMap(defaults, "skipBootstrap"),
		SkipOptionalBootstrapFiles: stringSliceFromValue(defaults["skipOptionalBootstrapFiles"]),
	}
}

func ensureOpenClawAgentWorkspaceBootstrap(workspace string, skipOptionalFiles []string) error {
	workspace = strings.TrimSpace(workspace)
	if workspace == "" || workspace == "." {
		return nil
	}
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		return huma.Error500InternalServerError("create openclaw agent workspace directory failed", err)
	}

	skipOptional := make(map[string]bool, len(skipOptionalFiles))
	for _, name := range skipOptionalFiles {
		name = strings.TrimSpace(filepath.Base(name))
		if openClawOptionalWorkspaceBootstrapFiles[name] {
			skipOptional[name] = true
		}
	}

	templateDir, templateDirErr := resolveOpenClawWorkspaceTemplateDir()
	for _, name := range openClawWorkspaceBootstrapFiles {
		if openClawOptionalWorkspaceBootstrapFiles[name] && skipOptional[name] {
			continue
		}
		content, err := loadOpenClawWorkspaceTemplate(templateDir, name)
		if err != nil {
			if templateDirErr != nil {
				err = fmt.Errorf("%w: %v", err, templateDirErr)
			}
			return huma.Error500InternalServerError("load openclaw workspace template failed", err)
		}
		if _, err := writeOpenClawFileIfMissing(filepath.Join(workspace, name), content); err != nil {
			return huma.Error500InternalServerError("write openclaw workspace template failed", err)
		}
	}

	if err := ensureOpenClawWorkspaceState(workspace); err != nil {
		return err
	}
	return nil
}

func resolveOpenClawWorkspaceTemplateDir() (string, error) {
	if value := strings.TrimSpace(os.Getenv("OPENCLAW_WORKSPACE_TEMPLATE_DIR")); value != "" {
		if openClawWorkspaceTemplateDirExists(value) {
			return value, nil
		}
		return "", fmt.Errorf("OPENCLAW_WORKSPACE_TEMPLATE_DIR does not contain workspace templates: %s", value)
	}

	candidates := make([]string, 0)
	if cwd, err := os.Getwd(); err == nil {
		for dir := cwd; ; dir = filepath.Dir(dir) {
			candidates = append(candidates,
				filepath.Join(dir, "SourceCode", "openclaw", "docs", "docs", "reference", "templates"),
				filepath.Join(dir, "SourceCode", "openclaw", "openclaw", "docs", "reference", "templates"),
				filepath.Join(dir, "docs", "docs", "reference", "templates"),
				filepath.Join(dir, "docs", "reference", "templates"),
			)
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
		}
	}
	if _, file, _, ok := goruntime.Caller(0); ok {
		for dir := filepath.Dir(file); ; dir = filepath.Dir(dir) {
			candidates = append(candidates,
				filepath.Join(dir, "SourceCode", "openclaw", "docs", "docs", "reference", "templates"),
				filepath.Join(dir, "SourceCode", "openclaw", "openclaw", "docs", "reference", "templates"),
			)
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
		}
	}

	for _, candidate := range candidates {
		if openClawWorkspaceTemplateDirExists(candidate) {
			return candidate, nil
		}
	}
	return "", errors.New("openclaw workspace template directory not found")
}

func openClawWorkspaceTemplateDirExists(dir string) bool {
	if strings.TrimSpace(dir) == "" {
		return false
	}
	for _, name := range []string{"AGENTS.md", "SOUL.md", "TOOLS.md"} {
		info, err := os.Stat(filepath.Join(dir, name))
		if err != nil || info.IsDir() {
			return false
		}
	}
	return true
}

func loadOpenClawWorkspaceTemplate(templateDir string, name string) (string, error) {
	if strings.TrimSpace(templateDir) != "" {
		content, err := os.ReadFile(filepath.Join(templateDir, name))
		if err == nil {
			return stripOpenClawMarkdownFrontMatter(string(content)), nil
		}
	}
	if fallback, ok := openClawFallbackWorkspaceTemplates[name]; ok {
		return fallback, nil
	}
	return "", fmt.Errorf("missing openclaw workspace template %s", name)
}

func stripOpenClawMarkdownFrontMatter(content string) string {
	if !strings.HasPrefix(content, "---") {
		return content
	}
	end := strings.Index(content[3:], "\n---")
	if end < 0 {
		return content
	}
	trimmed := content[end+len("\n---")+3:]
	return strings.TrimLeft(trimmed, "\r\n\t ")
}

func writeOpenClawFileIfMissing(path string, content string) (bool, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return false, err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return false, nil
		}
		return false, err
	}
	defer file.Close()
	if _, err := file.WriteString(content); err != nil {
		return false, err
	}
	return true, nil
}

func ensureOpenClawWorkspaceState(workspace string) error {
	statePath := filepath.Join(workspace, openClawWorkspaceStateDirName, openClawWorkspaceStateFileName)
	if pathExists(statePath) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(statePath), 0o755); err != nil {
		return huma.Error500InternalServerError("create openclaw workspace state directory failed", err)
	}
	state := map[string]any{
		"version":           openClawWorkspaceStateVersion,
		"bootstrapSeededAt": time.Now().UTC().Format(time.RFC3339Nano),
	}
	formatted, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return huma.Error500InternalServerError("marshal openclaw workspace state failed", err)
	}
	formatted = append(formatted, '\n')
	if err := os.WriteFile(statePath, formatted, 0o600); err != nil {
		return huma.Error500InternalServerError("write openclaw workspace state failed", err)
	}
	return nil
}

func pruneOpenClawAgentBindings(content map[string]any, id string) int {
	rawBindings, ok := content["bindings"].([]any)
	if !ok {
		return 0
	}
	filtered := make([]any, 0, len(rawBindings))
	removed := 0
	for _, raw := range rawBindings {
		binding, ok := raw.(map[string]any)
		if ok && normalizeOpenClawAgentID(stringFromMap(binding, "agentId")) == id {
			removed++
			continue
		}
		filtered = append(filtered, raw)
	}
	if len(filtered) > 0 {
		content["bindings"] = filtered
	} else {
		delete(content, "bindings")
	}
	return removed
}

func pruneOpenClawAgentAllow(content map[string]any, id string) int {
	tools := objectMap(content["tools"])
	agentToAgent := objectMap(tools["agentToAgent"])
	rawAllow, ok := agentToAgent["allow"].([]any)
	if !ok {
		return 0
	}
	filtered := make([]any, 0, len(rawAllow))
	removed := 0
	for _, raw := range rawAllow {
		if normalizeOpenClawAgentID(fmt.Sprint(raw)) == id {
			removed++
			continue
		}
		filtered = append(filtered, raw)
	}
	if len(filtered) > 0 {
		agentToAgent["allow"] = filtered
	} else {
		delete(agentToAgent, "allow")
	}
	if len(agentToAgent) > 0 {
		tools["agentToAgent"] = agentToAgent
	} else {
		delete(tools, "agentToAgent")
	}
	if len(tools) > 0 {
		content["tools"] = tools
	} else {
		delete(content, "tools")
	}
	return removed
}

func findOpenClawWorkspaceSharedAgentIDs(id string, workspace string, list []map[string]any, defaults OpenClawAgentDefaults) []string {
	shared := make([]string, 0)
	cleanWorkspace := filepath.Clean(workspace)
	for _, entry := range list {
		entryID := normalizeOpenClawAgentID(stringFromMap(entry, "id"))
		if entryID == "" || entryID == id {
			continue
		}
		entryWorkspace := resolveOpenClawAgentWorkspaceDir(entryID, entry, defaults)
		if entryWorkspace != "" && filepath.Clean(entryWorkspace) == cleanWorkspace {
			shared = append(shared, entryID)
		}
	}
	return shared
}

func removeOpenClawPathBestEffort(pathValue string) {
	pathValue = strings.TrimSpace(pathValue)
	if pathValue == "" || pathValue == "." {
		return
	}
	_ = os.RemoveAll(pathValue)
}

func buildOpenClawAgentsResponse() (OpenClawAgentsResponse, error) {
	configPath := openClawConfigPath()
	content, exists, err := readOpenClawConfigFile(configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			defaults := buildOpenClawAgentDefaults(openClawAgentsConfigShape{})
			agent := buildOpenClawAgentSummary(defaultOpenClawAgentID, nil, defaults, nil, nil)
			return OpenClawAgentsResponse{
				Status:    "missing",
				Timestamp: time.Now().UTC().Format(time.RFC3339),
				Path:      configPath,
				Exists:    false,
				Defaults:  defaults,
				Agents:    []OpenClawAgentSummary{agent},
				Bindings:  []OpenClawAgentBinding{},
				Summary:   summarizeOpenClawAgents([]OpenClawAgentSummary{agent}),
			}, nil
		}
		return OpenClawAgentsResponse{}, huma.Error500InternalServerError("read openclaw agents failed", err)
	}

	var cfg openClawAgentsConfigShape
	encoded, err := json.Marshal(content)
	if err != nil {
		return OpenClawAgentsResponse{}, huma.Error500InternalServerError("marshal openclaw config failed", err)
	}
	if err := json.Unmarshal(encoded, &cfg); err != nil {
		return OpenClawAgentsResponse{}, huma.Error500InternalServerError("parse openclaw agents failed", err)
	}

	bindings := buildOpenClawBindings(cfg.Bindings)
	defaults := buildOpenClawAgentDefaults(cfg)
	agents := buildOpenClawAgentSummaries(cfg, defaults, bindings)

	return OpenClawAgentsResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Path:      configPath,
		Exists:    exists,
		Defaults:  defaults,
		Agents:    agents,
		Bindings:  bindings,
		Summary:   summarizeOpenClawAgents(agents),
	}, nil
}

func buildOpenClawAgentDefaultsFromContent(content map[string]any) OpenClawAgentDefaults {
	var cfg openClawAgentsConfigShape
	encoded, err := json.Marshal(content)
	if err != nil {
		return buildOpenClawAgentDefaults(openClawAgentsConfigShape{})
	}
	if err := json.Unmarshal(encoded, &cfg); err != nil {
		return buildOpenClawAgentDefaults(openClawAgentsConfigShape{})
	}
	return buildOpenClawAgentDefaults(cfg)
}

func buildOpenClawAgentDefaults(cfg openClawAgentsConfigShape) OpenClawAgentDefaults {
	defaultAgentID := defaultOpenClawAgentID
	for _, entry := range cfg.Agents.List {
		if boolFromMap(entry, "default") {
			if id := normalizeOpenClawAgentID(stringFromMap(entry, "id")); id != "" {
				defaultAgentID = id
				break
			}
		}
	}

	workspace := resolveOpenClawUserPath(stringFromMap(cfg.Agents.Defaults, "workspace"))
	if workspace == "" {
		workspace = filepath.Join(defaultOpenClawHomeDir(), "workspace")
	}

	sessionStore := stringFromMap(cfg.Session, "store")
	if strings.TrimSpace(sessionStore) == "" {
		sessionStore = filepath.Join(defaultOpenClawHomeDir(), "agents", "{agentId}", "sessions", "sessions.json")
	}

	return OpenClawAgentDefaults{
		DefaultAgentID: defaultAgentID,
		Workspace:      workspace,
		AgentDirRoot:   filepath.Join(defaultOpenClawHomeDir(), "agents"),
		SessionStore:   resolveOpenClawUserPath(sessionStore),
		Model:          primaryModelFromValue(cfg.Agents.Defaults["model"]),
		Skills:         stringSliceFromValue(cfg.Agents.Defaults["skills"]),
	}
}

func buildOpenClawAgentSummaries(cfg openClawAgentsConfigShape, defaults OpenClawAgentDefaults, bindings []OpenClawAgentBinding) []OpenClawAgentSummary {
	entries := cfg.Agents.List
	if len(entries) == 0 {
		return []OpenClawAgentSummary{buildOpenClawAgentSummary(defaults.DefaultAgentID, nil, defaults, bindings, cfg.Agents.Defaults)}
	}

	seen := make(map[string]bool)
	agents := make([]OpenClawAgentSummary, 0, len(entries)+1)
	for _, entry := range entries {
		id := normalizeOpenClawAgentID(stringFromMap(entry, "id"))
		if id == "" {
			continue
		}
		seen[id] = true
		agents = append(agents, buildOpenClawAgentSummary(id, entry, defaults, bindings, cfg.Agents.Defaults))
	}
	if len(agents) == 0 || !seen[defaults.DefaultAgentID] {
		agents = append([]OpenClawAgentSummary{buildOpenClawAgentSummary(defaults.DefaultAgentID, nil, defaults, bindings, cfg.Agents.Defaults)}, agents...)
	}
	return agents
}

func resolveOpenClawAgentWorkspaceDir(id string, entry map[string]any, defaults OpenClawAgentDefaults) string {
	workspace := resolveOpenClawUserPath(stringFromMap(entry, "workspace"))
	if workspace != "" {
		return workspace
	}
	if id == defaults.DefaultAgentID {
		return defaults.Workspace
	}
	if defaults.Workspace != "" {
		return filepath.Join(defaults.Workspace, id)
	}
	return filepath.Join(defaultOpenClawHomeDir(), "workspace-"+id)
}

func buildOpenClawAgentSummary(id string, entry map[string]any, defaults OpenClawAgentDefaults, bindings []OpenClawAgentBinding, defaultsMap map[string]any) OpenClawAgentSummary {
	workspace := resolveOpenClawAgentWorkspaceDir(id, entry, defaults)
	agentDir := resolveOpenClawUserPath(stringFromMap(entry, "agentDir"))
	if agentDir == "" {
		agentDir = filepath.Join(defaults.AgentDirRoot, id, "agent")
	}
	sessionStore := strings.ReplaceAll(defaults.SessionStore, "{agentId}", id)
	sessionStore = resolveOpenClawUserPath(sessionStore)

	agentBindings := make([]OpenClawAgentBinding, 0)
	for _, binding := range bindings {
		if normalizeOpenClawAgentID(binding.AgentID) == id {
			agentBindings = append(agentBindings, binding)
		}
	}

	identity := buildOpenClawAgentIdentity(entry, workspace)
	model := primaryModelFromValue(valueFromMaps("model", entry, defaultsMap))
	skills, inherited := resolveOpenClawAgentSkills(entry, defaults.Skills)

	return OpenClawAgentSummary{
		ID:                 id,
		Name:               stringFromMap(entry, "name"),
		IsDefault:          id == defaults.DefaultAgentID,
		Workspace:          workspace,
		WorkspaceExists:    pathExists(workspace),
		AgentDir:           agentDir,
		AgentDirExists:     pathExists(agentDir),
		SessionStore:       sessionStore,
		SessionStoreExists: pathExists(sessionStore),
		Model:              model,
		Runtime:            buildOpenClawAgentRuntime(entry),
		Identity:           identity,
		Skills:             skills,
		SkillsInherited:    inherited,
		BindingsCount:      len(agentBindings),
		Bindings:           agentBindings,
		Config:             sanitizeOpenClawAgentConfig(entry),
	}
}

func buildOpenClawAgentIdentity(entry map[string]any, workspace string) OpenClawAgentIdentity {
	identity := OpenClawAgentIdentity{}
	if rawIdentity, ok := entry["identity"].(map[string]any); ok {
		identity.Name = stringFromMap(rawIdentity, "name")
		identity.Theme = stringFromMap(rawIdentity, "theme")
		identity.Emoji = stringFromMap(rawIdentity, "emoji")
		identity.Avatar = stringFromMap(rawIdentity, "avatar")
		if identity.Name != "" || identity.Theme != "" || identity.Emoji != "" || identity.Avatar != "" {
			identity.Source = "config"
		}
	}

	identity.IdentityFilePath = filepath.Join(workspace, "IDENTITY.md")
	identity.IdentityFileExists = pathExists(identity.IdentityFilePath)
	if identity.Source == "" && identity.IdentityFileExists {
		if parsed := parseOpenClawIdentityFile(identity.IdentityFilePath); parsed.Name != "" || parsed.Theme != "" || parsed.Emoji != "" {
			parsed.IdentityFilePath = identity.IdentityFilePath
			parsed.IdentityFileExists = true
			parsed.Source = "identity-file"
			return parsed
		}
		identity.Source = "identity-file"
	}
	return identity
}

func parseOpenClawIdentityFile(path string) OpenClawAgentIdentity {
	content, err := os.ReadFile(path)
	if err != nil {
		return OpenClawAgentIdentity{}
	}
	identity := OpenClawAgentIdentity{}
	for _, line := range strings.Split(string(content), "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(key, "#")))
		value = strings.TrimSpace(value)
		value = strings.Trim(value, "\"'")
		switch key {
		case "name":
			identity.Name = value
		case "theme":
			identity.Theme = value
		case "emoji":
			identity.Emoji = value
		}
	}
	return identity
}

func buildOpenClawAgentRuntime(entry map[string]any) OpenClawAgentRuntime {
	if runtimeMap, ok := entry["runtime"].(map[string]any); ok {
		runtime := OpenClawAgentRuntime{Type: stringFromMap(runtimeMap, "type"), Explicit: true}
		if runtime.Type == "" {
			runtime.Type = "auto"
		}
		if acpMap, ok := runtimeMap["acp"].(map[string]any); ok {
			runtime.ID = stringFromMap(acpMap, "agent")
			runtime.Backend = stringFromMap(acpMap, "backend")
			runtime.Mode = stringFromMap(acpMap, "mode")
			runtime.CWD = resolveOpenClawUserPath(stringFromMap(acpMap, "cwd"))
		}
		return runtime
	}
	if runtimeMap, ok := entry["agentRuntime"].(map[string]any); ok {
		return OpenClawAgentRuntime{Type: "auto", ID: stringFromMap(runtimeMap, "id"), Explicit: true}
	}
	return OpenClawAgentRuntime{Type: "embedded", Explicit: false}
}

func buildOpenClawBindings(raw []map[string]any) []OpenClawAgentBinding {
	bindings := make([]OpenClawAgentBinding, 0, len(raw))
	for _, item := range raw {
		agentID := normalizeOpenClawAgentID(stringFromMap(item, "agentId"))
		if agentID == "" {
			agentID = defaultOpenClawAgentID
		}
		match, _ := item["match"].(map[string]any)
		peer, _ := match["peer"].(map[string]any)
		bindingType := stringFromMap(item, "type")
		if bindingType == "" {
			bindingType = "route"
		}
		binding := OpenClawAgentBinding{
			Type:      bindingType,
			AgentID:   agentID,
			Channel:   stringFromMap(match, "channel"),
			AccountID: stringFromMap(match, "accountId"),
			PeerKind:  stringFromMap(peer, "kind"),
			PeerID:    stringFromMap(peer, "id"),
			GuildID:   stringFromMap(match, "guildId"),
			TeamID:    stringFromMap(match, "teamId"),
			Roles:     stringSliceFromValue(match["roles"]),
			ACP:       sanitizeStringAnyMap(item["acp"]),
		}
		binding.Label = buildOpenClawBindingLabel(binding)
		bindings = append(bindings, binding)
	}
	return bindings
}

func buildOpenClawBindingLabel(binding OpenClawAgentBinding) string {
	parts := make([]string, 0, 4)
	if binding.Type == "acp" {
		parts = append(parts, "acp")
	}
	if binding.Channel != "" {
		parts = append(parts, binding.Channel)
	}
	if binding.AccountID != "" {
		parts = append(parts, binding.AccountID)
	}
	if binding.PeerID != "" {
		peer := binding.PeerID
		if binding.PeerKind != "" {
			peer = binding.PeerKind + ":" + peer
		}
		parts = append(parts, peer)
	}
	if len(parts) == 0 {
		return "default"
	}
	return strings.Join(parts, ":")
}

func listOpenClawAgentWorkspaceFiles(workspace string) []OpenClawAgentFileStatus {
	names := []string{"IDENTITY.md", "AGENTS.md", "SOUL.md", "TOOLS.md", "USER.md", "HEARTBEAT.md", "BOOTSTRAP.md"}
	files := make([]OpenClawAgentFileStatus, 0, len(names))
	for _, name := range names {
		path := filepath.Join(workspace, name)
		file, err := openClawAgentFileStatus(path)
		if err != nil {
			file = OpenClawAgentFileStatus{Name: name, Path: path, Exists: false}
		}
		files = append(files, file)
	}
	return files
}

func openClawAgentFileStatus(path string) (OpenClawAgentFileStatus, error) {
	file := OpenClawAgentFileStatus{Name: filepath.Base(path), Path: path, Exists: false}
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
	return file, nil
}

func resolveOpenClawAgentWorkspaceFilePath(workspace string, name string) (string, error) {
	name = strings.TrimSpace(filepath.Base(name))
	if name == "" || name == "." || name == string(filepath.Separator) {
		return "", errors.New("file name is required")
	}
	allowed := false
	for _, file := range listOpenClawAgentWorkspaceFiles(workspace) {
		if file.Name == name {
			allowed = true
			break
		}
	}
	if !allowed {
		return "", errors.New("file is not an allowed agent bootstrap file")
	}
	workspace = filepath.Clean(workspace)
	path := filepath.Clean(filepath.Join(workspace, name))
	if filepath.Dir(path) != workspace {
		return "", errors.New("file path escapes workspace")
	}
	return path, nil
}

func summarizeOpenClawAgents(agents []OpenClawAgentSummary) OpenClawAgentsSummary {
	summary := OpenClawAgentsSummary{Total: len(agents)}
	for _, agent := range agents {
		if agent.IsDefault {
			summary.DefaultCount++
		}
		if agent.BindingsCount > 0 {
			summary.BoundCount++
		}
		if agent.Runtime.Explicit {
			summary.RuntimeCount++
		}
	}
	return summary
}

func resolveOpenClawAgentSkills(entry map[string]any, defaults []string) ([]string, bool) {
	if _, ok := entry["skills"]; ok {
		return stringSliceFromValue(entry["skills"]), false
	}
	return defaults, len(defaults) > 0
}

func primaryModelFromValue(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case map[string]any:
		if primary := stringFromMap(typed, "primary"); primary != "" {
			return primary
		}
		if id := stringFromMap(typed, "id"); id != "" {
			return id
		}
	}
	return ""
}

func sanitizeOpenClawAgentConfig(entry map[string]any) map[string]any {
	if len(entry) == 0 {
		return nil
	}
	return sanitizeStringAnyMap(entry)
}

func sanitizeStringAnyMap(value any) map[string]any {
	source, ok := value.(map[string]any)
	if !ok || len(source) == 0 {
		return nil
	}
	out := make(map[string]any, len(source))
	for key, raw := range source {
		lower := strings.ToLower(key)
		if strings.Contains(lower, "token") || strings.Contains(lower, "password") || strings.Contains(lower, "secret") || strings.Contains(lower, "credential") || strings.Contains(lower, "key") {
			out[key] = "[redacted]"
			continue
		}
		switch typed := raw.(type) {
		case map[string]any:
			out[key] = sanitizeStringAnyMap(typed)
		case []any:
			items := make([]any, 0, len(typed))
			for _, item := range typed {
				if itemMap, ok := item.(map[string]any); ok {
					items = append(items, sanitizeStringAnyMap(itemMap))
				} else {
					items = append(items, item)
				}
			}
			out[key] = items
		default:
			out[key] = raw
		}
	}
	return out
}

func resolveOpenClawUserPath(pathValue string) string {
	pathValue = strings.TrimSpace(pathValue)
	if pathValue == "" {
		return ""
	}
	if pathValue == "~" || strings.HasPrefix(pathValue, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			if pathValue == "~" {
				return home
			}
			return filepath.Join(home, strings.TrimPrefix(pathValue, "~/"))
		}
	}
	return filepath.Clean(pathValue)
}

func normalizeOpenClawAgentID(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func stringFromMap(values map[string]any, key string) string {
	if values == nil {
		return ""
	}
	value, ok := values[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func boolFromMap(values map[string]any, key string) bool {
	value, ok := values[key]
	if !ok {
		return false
	}
	if typed, ok := value.(bool); ok {
		return typed
	}
	return strings.EqualFold(fmt.Sprint(value), "true")
}

func stringSliceFromValue(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			text := strings.TrimSpace(fmt.Sprint(item))
			if text != "" {
				out = append(out, text)
			}
		}
		return out
	default:
		return nil
	}
}

func valueFromMaps(key string, maps ...map[string]any) any {
	for _, values := range maps {
		if values == nil {
			continue
		}
		if value, ok := values[key]; ok {
			return value
		}
	}
	return nil
}
