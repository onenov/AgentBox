package ccconnect

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	_ "modernc.org/sqlite"
)

type CCConnectSessionsInput struct {
	Project         string `query:"project,omitempty" doc:"CC-Connect project name, all, or empty for all projects." example:"all"`
	AgentType       string `query:"agentType,omitempty" doc:"Optional agent type filter." example:"codex"`
	Query           string `query:"query,omitempty" doc:"Search query across session metadata and messages." example:"deploy"`
	Status          string `query:"status,omitempty" doc:"all, active, or ended." example:"all"`
	IncludeChildren bool   `query:"includeChildren,omitempty" doc:"Reserved for agent session formats that expose child sessions." example:"false"`
	Limit           int    `query:"limit,omitempty" minimum:"1" maximum:"500" doc:"Maximum sessions to return." example:"100"`
	Offset          int    `query:"offset,omitempty" minimum:"0" doc:"Number of matched sessions to skip after sorting." example:"0"`
	SortBy          string `query:"sortBy,omitempty" doc:"lastActive, startedAt, messages, tokens, or cost." example:"lastActive"`
	SortDir         string `query:"sortDir,omitempty" doc:"desc or asc." example:"desc"`
}

type CCConnectSessionDetailInput struct {
	Project   string `path:"project" doc:"CC-Connect project name." example:"project-2"`
	ID        string `path:"id" doc:"Session id." example:"2a401c8b-7ee4-4749-84ef-2134e3201030"`
	AgentType string `query:"agentType,omitempty" doc:"Agent type containing this session. Empty uses the project configured agent type." example:"codex"`
}

type CCConnectSessionsBulkDeleteInput struct {
	Body CCConnectSessionsBulkDeleteRequest
}

type CCConnectSessionEndInput struct {
	Project   string `path:"project" doc:"CC-Connect project name." example:"project-2"`
	ID        string `path:"id" doc:"Session id." example:"2a401c8b-7ee4-4749-84ef-2134e3201030"`
	AgentType string `query:"agentType,omitempty" doc:"Agent type containing this session. Empty uses the project configured agent type." example:"codex"`
	Body      CCConnectSessionEndRequest
}

type CCConnectSessionsOutput struct {
	Body CCConnectSessionsResponse
}

type CCConnectSessionDetailOutput struct {
	Body CCConnectSessionDetailResponse
}

type CCConnectSessionsBulkDeleteOutput struct {
	Body CCConnectSessionsBulkDeleteResponse
}

type CCConnectSessionEndOutput struct {
	Body CCConnectSessionEndResponse
}

type CCConnectSessionsResponse struct {
	Status    string                    `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                    `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Projects  []CCConnectProjectSummary `json:"projects" doc:"Projects included in this query."`
	Summary   CCConnectSessionsSummary  `json:"summary" doc:"Aggregate session summary for matched sessions before pagination."`
	Sessions  []CCConnectManagedSession `json:"sessions" doc:"Matched sessions."`
	Limit     int                       `json:"limit" example:"100" doc:"Applied limit."`
	Offset    int                       `json:"offset" example:"0" doc:"Applied offset."`
	HasMore   bool                      `json:"hasMore" example:"false" doc:"Whether more matched sessions exist after this page."`
	Errors    []string                  `json:"errors,omitempty" doc:"Non-fatal per-project read errors."`
}

type CCConnectSessionDetailResponse struct {
	Status    string                    `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                    `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Project   CCConnectProjectSummary   `json:"project" doc:"Project containing this session."`
	Session   CCConnectManagedSession   `json:"session" doc:"Session metadata."`
	Messages  []CCConnectSessionMessage `json:"messages" doc:"Session messages ordered by timestamp."`
	Errors    []string                  `json:"errors,omitempty" doc:"Non-fatal read errors."`
}

type CCConnectSessionsBulkDeleteRequest struct {
	Sessions []CCConnectSessionRef `json:"sessions" doc:"Sessions to delete."`
}

type CCConnectSessionEndRequest struct {
	Reason string `json:"reason,omitempty" doc:"End reason." example:"manual_close"`
}

type CCConnectSessionsBulkDeleteResponse struct {
	Status    string                             `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                             `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Summary   CCConnectSessionsBulkDeleteSummary `json:"summary" doc:"Bulk deletion summary."`
	Results   []CCConnectSessionDeleteResult     `json:"results" doc:"Per-session deletion results."`
}

type CCConnectSessionEndResponse struct {
	Status              string                  `json:"status" example:"ok" doc:"Operation status."`
	Timestamp           string                  `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Project             CCConnectProjectSummary `json:"project" doc:"Project containing this session."`
	Session             CCConnectManagedSession `json:"session" doc:"Ended session metadata."`
	TerminatedProcesses int                     `json:"terminatedProcesses" doc:"Best-effort terminal processes stopped before marking the session ended."`
}

type CCConnectProjectSummary struct {
	Name      string `json:"name" example:"project-2" doc:"Project name."`
	Path      string `json:"path" doc:"Project working directory."`
	AgentType string `json:"agentType" example:"codex" doc:"Configured agent type."`
	Model     string `json:"model,omitempty" doc:"Configured model."`
	Provider  string `json:"provider,omitempty" doc:"Configured provider."`
}

type CCConnectSessionsSummary struct {
	TotalMatched   int     `json:"totalMatched" example:"42" doc:"Matched sessions before pagination."`
	Returned       int     `json:"returned" example:"25" doc:"Returned sessions after pagination."`
	Projects       int     `json:"projects" example:"3" doc:"Project count included."`
	Active         int     `json:"active" example:"1" doc:"Matched active sessions."`
	Ended          int     `json:"ended" example:"36" doc:"Matched ended sessions."`
	TotalMessages  int64   `json:"totalMessages" example:"1024" doc:"Matched message count."`
	TotalToolCalls int64   `json:"totalToolCalls" example:"64" doc:"Matched tool call count."`
	TotalTokens    int64   `json:"totalTokens" example:"32000" doc:"Input + output + reasoning token count."`
	TotalCostUSD   float64 `json:"totalCostUsd" example:"0.87" doc:"Actual cost where available, otherwise estimated cost."`
}

type CCConnectManagedSession struct {
	ID                  string   `json:"id" example:"019e..." doc:"Agent session id."`
	Project             string   `json:"project" example:"project-2" doc:"CC-Connect project name."`
	ProjectDisplayName  string   `json:"projectDisplayName" example:"project-2" doc:"Project display label."`
	ProjectPath         string   `json:"projectPath" doc:"Project working directory."`
	AgentType           string   `json:"agentType" example:"codex" doc:"Agent type."`
	Source              string   `json:"source,omitempty" doc:"Session source."`
	Platform            string   `json:"platform,omitempty" doc:"Messaging platform if known."`
	UserID              string   `json:"userId,omitempty" doc:"User id if known."`
	Model               string   `json:"model,omitempty" doc:"Model if known."`
	Title               string   `json:"title,omitempty" doc:"Session title."`
	StartedAt           string   `json:"startedAt,omitempty" doc:"Start time."`
	LastActiveAt        string   `json:"lastActiveAt,omitempty" doc:"Last active time."`
	EndedAt             string   `json:"endedAt,omitempty" doc:"End time when known."`
	EndReason           string   `json:"endReason,omitempty" doc:"End reason when known."`
	Path                string   `json:"path,omitempty" doc:"Backing file or database path."`
	Preview             string   `json:"preview,omitempty" doc:"First user message preview."`
	MatchSnippet        string   `json:"matchSnippet,omitempty" doc:"Best-effort message snippet for search query."`
	MatchedMessageCount int64    `json:"matchedMessageCount" doc:"Messages matching the query."`
	IsActive            bool     `json:"isActive" example:"false" doc:"Whether a local terminal process appears to reference this session."`
	ActiveProcessIDs    []string `json:"activeProcessIds,omitempty" doc:"Runtime process ids referencing this session."`
	MessageCount        int64    `json:"messageCount" doc:"Message count."`
	ToolCallCount       int64    `json:"toolCallCount" doc:"Tool call count."`
	InputTokens         int64    `json:"inputTokens" doc:"Input token count."`
	OutputTokens        int64    `json:"outputTokens" doc:"Output token count."`
	ReasoningTokens     int64    `json:"reasoningTokens" doc:"Reasoning token count."`
	TotalTokens         int64    `json:"totalTokens" doc:"Input + output + reasoning token count."`
	CostUSD             *float64 `json:"costUsd,omitempty" doc:"Actual cost where available."`
}

type CCConnectSessionMessage struct {
	ID        string `json:"id" example:"1" doc:"Message id."`
	SessionID string `json:"sessionId" doc:"Session id."`
	Role      string `json:"role" example:"user" doc:"Message role."`
	Content   any    `json:"content,omitempty" doc:"Decoded message content."`
	Text      string `json:"text,omitempty" doc:"Best-effort text representation for display/search."`
	ToolName  string `json:"toolName,omitempty" doc:"Tool name."`
	Timestamp string `json:"timestamp,omitempty" doc:"Message timestamp."`
	Raw       any    `json:"raw,omitempty" doc:"Raw decoded record."`
}

type CCConnectSessionRef struct {
	Project   string `json:"project" example:"project-2" doc:"Project name."`
	AgentType string `json:"agentType,omitempty" example:"codex" doc:"Agent type containing this session. Empty uses the project configured agent type."`
	ID        string `json:"id" example:"019e..." doc:"Session id."`
}

type CCConnectSessionDeleteResult struct {
	Project   string `json:"project" example:"project-2" doc:"Project name."`
	AgentType string `json:"agentType,omitempty" example:"codex" doc:"Agent type containing the session."`
	ID        string `json:"id" example:"019e..." doc:"Session id."`
	Status    string `json:"status" example:"deleted" doc:"deleted, skipped, missing, or error."`
	Message   string `json:"message,omitempty" doc:"Human-readable result."`
}

type CCConnectSessionsBulkDeleteSummary struct {
	Requested int `json:"requested" example:"3" doc:"Requested item count."`
	Deleted   int `json:"deleted" example:"2" doc:"Deleted item count."`
	Skipped   int `json:"skipped" example:"1" doc:"Skipped item count."`
	Missing   int `json:"missing" example:"0" doc:"Missing item count."`
	Errors    int `json:"errors" example:"0" doc:"Error item count."`
}

type ccConnectSessionProjectTarget struct {
	Summary CCConnectProjectSummary
	Config  CCConnectProjectConfig
}

func ListCCConnectSessions(ctx context.Context, input *CCConnectSessionsInput) (*CCConnectSessionsOutput, error) {
	if input == nil {
		input = &CCConnectSessionsInput{}
	}
	limit := clampCCConnectInt(input.Limit, 100, 1, 500)
	offset := input.Offset
	if offset < 0 {
		offset = 0
	}

	targets, err := resolveCCConnectSessionProjectTargetsForList(input.Project, input.AgentType)
	if err != nil {
		return nil, err
	}
	statusFilter := strings.ToLower(strings.TrimSpace(input.Status))
	if statusFilter == "" {
		statusFilter = "all"
	}
	if statusFilter != "all" && statusFilter != "active" && statusFilter != "ended" {
		return nil, huma.Error400BadRequest("status must be all, active, or ended", nil)
	}

	allSessions := make([]CCConnectManagedSession, 0, limit)
	errorsList := make([]string, 0)
	for _, target := range targets {
		activeRefs := globalCCConnectTerminalManager.activeCCConnectSessionRefs(target.Summary.Name, target.Summary.AgentType)
		sessions, err := readCCConnectManagedSessions(ctx, target, ccConnectSessionQuery{
			Query:      strings.TrimSpace(input.Query),
			Status:     statusFilter,
			ActiveRefs: activeRefs,
		})
		if err != nil {
			errorsList = append(errorsList, fmt.Sprintf("%s: %v", target.Summary.Name, err))
			continue
		}
		allSessions = append(allSessions, sessions...)
	}

	sortCCConnectManagedSessions(allSessions, input.SortBy, input.SortDir)
	summary := summarizeCCConnectSessions(allSessions, countUniqueCCConnectTargetProjects(targets))
	end := offset + limit
	if offset > len(allSessions) {
		offset = len(allSessions)
	}
	if end > len(allSessions) {
		end = len(allSessions)
	}
	page := allSessions[offset:end]
	summary.Returned = len(page)

	status := "ok"
	if len(errorsList) > 0 {
		status = "partial"
	}
	return &CCConnectSessionsOutput{Body: CCConnectSessionsResponse{
		Status:    status,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Projects:  ccConnectSessionTargetsToSummaries(targets),
		Summary:   summary,
		Sessions:  page,
		Limit:     limit,
		Offset:    offset,
		HasMore:   end < len(allSessions),
		Errors:    errorsList,
	}}, nil
}

func GetCCConnectSession(ctx context.Context, input *CCConnectSessionDetailInput) (*CCConnectSessionDetailOutput, error) {
	target, err := resolveCCConnectSessionProjectTarget(input.Project, input.AgentType)
	if err != nil {
		return nil, err
	}
	sessionID := strings.TrimSpace(input.ID)
	if sessionID == "" {
		return nil, huma.Error400BadRequest("session id is required", nil)
	}

	activeRefs := globalCCConnectTerminalManager.activeCCConnectSessionRefs(target.Summary.Name, target.Summary.AgentType)
	sessions, err := readCCConnectManagedSessions(ctx, target, ccConnectSessionQuery{
		ActiveRefs: activeRefs,
		SpecificID: sessionID,
	})
	if err != nil {
		return nil, huma.Error500InternalServerError("read cc-connect session failed", err)
	}
	if len(sessions) == 0 {
		return nil, huma.Error404NotFound("CC-Connect session not found", nil)
	}
	messages, err := readCCConnectSessionMessages(target, sessions[0])
	if err != nil {
		return nil, huma.Error500InternalServerError("read cc-connect session messages failed", err)
	}
	return &CCConnectSessionDetailOutput{Body: CCConnectSessionDetailResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Project:   target.Summary,
		Session:   sessions[0],
		Messages:  messages,
	}}, nil
}

func EndCCConnectSession(ctx context.Context, input *CCConnectSessionEndInput) (*CCConnectSessionEndOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("session end input is required", nil)
	}
	target, err := resolveCCConnectSessionProjectTarget(input.Project, input.AgentType)
	if err != nil {
		return nil, err
	}
	sessionID := strings.TrimSpace(input.ID)
	if sessionID == "" {
		return nil, huma.Error400BadRequest("session id is required", nil)
	}
	activeRefs := globalCCConnectTerminalManager.activeCCConnectSessionRefs(target.Summary.Name, target.Summary.AgentType)
	sessions, err := readCCConnectManagedSessions(ctx, target, ccConnectSessionQuery{
		ActiveRefs: activeRefs,
		SpecificID: sessionID,
	})
	if err != nil {
		return nil, huma.Error500InternalServerError("read ended cc-connect session failed", err)
	}
	if len(sessions) == 0 {
		return nil, huma.Error404NotFound("CC-Connect session not found", nil)
	}
	terminated := stopCCConnectTerminalSessionsReferencing(target.Summary.Name, target.Summary.AgentType, sessionID)
	session := sessions[0]
	if session.EndedAt == "" {
		session.EndedAt = time.Now().UTC().Format(time.RFC3339)
		session.EndReason = firstCCConnectString(input.Body.Reason, "manual_close")
	}
	if terminated > 0 {
		session.IsActive = false
		session.ActiveProcessIDs = nil
	}
	return &CCConnectSessionEndOutput{Body: CCConnectSessionEndResponse{
		Status:              "ok",
		Timestamp:           time.Now().UTC().Format(time.RFC3339),
		Project:             target.Summary,
		Session:             session,
		TerminatedProcesses: terminated,
	}}, nil
}

func DeleteCCConnectSessions(ctx context.Context, input *CCConnectSessionsBulkDeleteInput) (*CCConnectSessionsBulkDeleteOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("sessions payload is required", nil)
	}
	results := make([]CCConnectSessionDeleteResult, 0, len(input.Body.Sessions))
	targetCache := map[string]ccConnectSessionProjectTarget{}

	for _, item := range input.Body.Sessions {
		projectName := strings.TrimSpace(item.Project)
		agentType := normalizeCCConnectAgentType(item.AgentType)
		sessionID := strings.TrimSpace(item.ID)
		result := CCConnectSessionDeleteResult{Project: projectName, AgentType: agentType, ID: sessionID}
		if projectName == "" || sessionID == "" {
			result.Status = "error"
			result.Message = "project and id are required"
			results = append(results, result)
			continue
		}

		cacheKey := projectName + "\x00" + agentType
		target, ok := targetCache[cacheKey]
		if !ok {
			resolved, err := resolveCCConnectSessionProjectTarget(projectName, agentType)
			if err != nil {
				result.Status = "error"
				result.Message = err.Error()
				results = append(results, result)
				continue
			}
			target = resolved
			targetCache[cacheKey] = target
		}
		result.Project = target.Summary.Name
		result.AgentType = target.Summary.AgentType

		if refs := globalCCConnectTerminalManager.activeCCConnectSessionRefs(target.Summary.Name, target.Summary.AgentType)[sessionID]; len(refs) > 0 {
			result.Status = "skipped"
			result.Message = "session appears active"
			results = append(results, result)
			continue
		}

		deleted, err := deleteCCConnectSessionFromProject(ctx, target, sessionID)
		if err != nil {
			result.Status = "error"
			result.Message = err.Error()
		} else if !deleted {
			result.Status = "missing"
			result.Message = "session not found"
		} else {
			result.Status = "deleted"
			result.Message = "session deleted"
		}
		results = append(results, result)
	}

	summary := CCConnectSessionsBulkDeleteSummary{Requested: len(input.Body.Sessions)}
	for _, result := range results {
		switch result.Status {
		case "deleted":
			summary.Deleted++
		case "skipped":
			summary.Skipped++
		case "missing":
			summary.Missing++
		default:
			summary.Errors++
		}
	}
	status := "ok"
	if summary.Errors > 0 {
		status = "partial"
	}
	return &CCConnectSessionsBulkDeleteOutput{Body: CCConnectSessionsBulkDeleteResponse{
		Status:    status,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Summary:   summary,
		Results:   results,
	}}, nil
}

type ccConnectSessionQuery struct {
	Query      string
	Status     string
	ActiveRefs map[string][]string
	SpecificID string
}

func resolveCCConnectSessionProjectTargetsForList(project string, agentType string) ([]ccConnectSessionProjectTarget, error) {
	return resolveCCConnectSessionProjectTargetsWithMode(project, agentType, true)
}

func resolveCCConnectSessionProjectTargets(project string, agentType string) ([]ccConnectSessionProjectTarget, error) {
	return resolveCCConnectSessionProjectTargetsWithMode(project, agentType, false)
}

func resolveCCConnectSessionProjectTargetsWithMode(project string, agentType string, expandInstalledAgents bool) ([]ccConnectSessionProjectTarget, error) {
	requested := strings.ToLower(strings.TrimSpace(project))
	requestedAgentType := normalizeCCConnectAgentType(agentType)
	if requestedAgentType != "" && !isSupportedCCConnectAgentType(requestedAgentType) {
		return nil, huma.Error400BadRequest("unsupported CC-Connect agent type: "+requestedAgentType, nil)
	}
	config, configErr := loadCCConnectProjectsForRuntime()
	targets := make([]ccConnectSessionProjectTarget, 0)
	seen := map[string]int{}
	addTarget := func(target ccConnectSessionProjectTarget) {
		target.Summary.Name = strings.TrimSpace(target.Summary.Name)
		target.Summary.AgentType = normalizeCCConnectAgentType(target.Summary.AgentType)
		if target.Summary.Name == "" || target.Summary.Name == "default-project" || target.Summary.AgentType == "" {
			return
		}
		key := strings.ToLower(target.Summary.Name) + "\x00" + target.Summary.AgentType
		if index, ok := seen[key]; ok {
			if targets[index].Summary.Path == "" && target.Summary.Path != "" {
				targets[index].Summary.Path = target.Summary.Path
				targets[index].Config.Agent.WorkDir = target.Summary.Path
			}
			return
		}
		seen[key] = len(targets)
		targets = append(targets, target)
	}

	if configErr == nil {
		for _, project := range config.Projects {
			if project.Name == "default-project" || strings.TrimSpace(project.Name) == "" {
				continue
			}
			if requested != "" && requested != "all" && !strings.EqualFold(project.Name, requested) {
				continue
			}
			for _, projectAgentType := range ccConnectSessionProjectAgentTypes(project.Agent.Type, requestedAgentType, expandInstalledAgents) {
				target := ccConnectProjectConfigToSessionTarget(project)
				target.Summary.AgentType = projectAgentType
				target.Config.Agent.Type = projectAgentType
				addTarget(target)
			}
		}
	}

	for _, target := range ccConnectTerminalProjectSessionTargets(requested, requestedAgentType, expandInstalledAgents) {
		addTarget(target)
	}

	if len(targets) == 0 && configErr != nil {
		return nil, configErr
	}
	if requested != "" && requested != "all" && len(targets) == 0 {
		return nil, huma.Error404NotFound("CC-Connect project not found", nil)
	}
	return targets, nil
}

func ccConnectSessionProjectAgentTypes(configuredAgentType string, requestedAgentType string, expandInstalledAgents bool) []string {
	seen := map[string]bool{}
	agentTypes := make([]string, 0, len(ccConnectAgentEngineDefinitions()))
	add := func(agentType string) {
		agentType = normalizeCCConnectAgentType(agentType)
		if agentType == "" || seen[agentType] || !isSupportedCCConnectAgentType(agentType) {
			return
		}
		seen[agentType] = true
		agentTypes = append(agentTypes, agentType)
	}

	if requestedAgentType != "" {
		add(requestedAgentType)
		return agentTypes
	}
	add(configuredAgentType)
	if expandInstalledAgents {
		for _, definition := range ccConnectAgentEngineDefinitions() {
			if _, err := resolveCCConnectAgentBinary(definition.Type); err == nil {
				add(definition.Type)
			}
		}
	}
	return agentTypes
}

func ccConnectTerminalProjectSessionTargets(requested string, requestedAgentType string, expandInstalledAgents bool) []ccConnectSessionProjectTarget {
	globalCCConnectTerminalManager.mu.Lock()
	sessions := make([]*ccConnectTerminalSession, 0, len(globalCCConnectTerminalManager.sessions))
	for _, session := range globalCCConnectTerminalManager.sessions {
		sessions = append(sessions, session)
	}
	globalCCConnectTerminalManager.mu.Unlock()

	targets := make([]ccConnectSessionProjectTarget, 0)
	seen := map[string]bool{}
	for _, session := range sessions {
		session.mu.Lock()
		project := session.project
		sessionAgentType := normalizeCCConnectAgentType(firstCCConnectString(session.agentType, project.AgentType))
		cwd := session.cwd
		session.mu.Unlock()

		project.Name = strings.TrimSpace(project.Name)
		if project.Name == "" || project.Name == "default-project" {
			continue
		}
		if requested != "" && requested != "all" && !strings.EqualFold(project.Name, requested) {
			continue
		}

		agentTypes := []string{sessionAgentType}
		if requestedAgentType != "" {
			agentTypes = []string{requestedAgentType}
		} else if expandInstalledAgents {
			agentTypes = ccConnectSessionProjectAgentTypes(sessionAgentType, "", true)
		}
		projectPath := firstCCConnectString(project.Path, cwd)
		for _, agentType := range agentTypes {
			agentType = normalizeCCConnectAgentType(agentType)
			if agentType == "" || !isSupportedCCConnectAgentType(agentType) {
				continue
			}
			key := strings.ToLower(project.Name) + "\x00" + agentType
			if seen[key] {
				continue
			}
			seen[key] = true
			targets = append(targets, ccConnectSessionProjectTarget{
				Config: CCConnectProjectConfig{
					Name: project.Name,
					Agent: CCConnectProjectAgentConfig{
						Type:    agentType,
						WorkDir: projectPath,
					},
				},
				Summary: CCConnectProjectSummary{
					Name:      project.Name,
					Path:      projectPath,
					AgentType: agentType,
				},
			})
		}
	}
	return targets
}

func resolveCCConnectSessionProjectTarget(project string, agentType string) (ccConnectSessionProjectTarget, error) {
	targets, err := resolveCCConnectSessionProjectTargets(project, agentType)
	if err != nil {
		return ccConnectSessionProjectTarget{}, err
	}
	if len(targets) == 0 {
		return ccConnectSessionProjectTarget{}, huma.Error404NotFound("CC-Connect project not found", nil)
	}
	return targets[0], nil
}

func ccConnectProjectConfigToSessionTarget(project CCConnectProjectConfig) ccConnectSessionProjectTarget {
	agentType := normalizeCCConnectAgentType(project.Agent.Type)
	return ccConnectSessionProjectTarget{
		Config: project,
		Summary: CCConnectProjectSummary{
			Name:      project.Name,
			Path:      expandCCConnectHomePath(project.Agent.WorkDir),
			AgentType: agentType,
			Model:     project.Agent.Model,
			Provider:  project.Agent.Provider,
		},
	}
}

func ccConnectSessionTargetsToSummaries(targets []ccConnectSessionProjectTarget) []CCConnectProjectSummary {
	summaries := make([]CCConnectProjectSummary, 0, len(targets))
	for _, target := range targets {
		summaries = append(summaries, target.Summary)
	}
	return summaries
}

func countUniqueCCConnectTargetProjects(targets []ccConnectSessionProjectTarget) int {
	seen := map[string]bool{}
	for _, target := range targets {
		name := strings.ToLower(strings.TrimSpace(target.Summary.Name))
		if name == "" {
			continue
		}
		seen[name] = true
	}
	return len(seen)
}

func readCCConnectManagedSessions(ctx context.Context, target ccConnectSessionProjectTarget, options ccConnectSessionQuery) ([]CCConnectManagedSession, error) {
	var sessions []CCConnectManagedSession
	var err error
	switch target.Summary.AgentType {
	case "claudecode":
		sessions, err = readClaudeCodeSessions(target)
	case "codex":
		sessions, err = readCodexSessions(target)
	case "gemini":
		sessions, err = readGeminiSessions(target)
	case "opencode":
		sessions, err = readOpenCodeSessions(target)
	case "qoder":
		sessions, err = readQoderSessions(target)
	default:
		sessions = []CCConnectManagedSession{}
	}
	if err != nil {
		return nil, err
	}
	sessions = appendCCConnectTerminalBackedSessions(target, sessions)
	query := strings.ToLower(strings.TrimSpace(options.Query))
	filtered := sessions[:0]
	for _, session := range sessions {
		if options.SpecificID != "" && session.ID != options.SpecificID {
			continue
		}
		if refs := options.ActiveRefs[session.ID]; len(refs) > 0 && session.EndedAt == "" {
			session.IsActive = true
			session.ActiveProcessIDs = refs
		}
		if query != "" && !ccConnectSessionMatches(session, query) {
			continue
		}
		if options.Status == "active" && !session.IsActive {
			continue
		}
		if options.Status == "ended" && (session.IsActive || session.EndedAt == "") {
			continue
		}
		filtered = append(filtered, session)
	}
	_ = ctx
	return filtered, nil
}

func appendCCConnectTerminalBackedSessions(target ccConnectSessionProjectTarget, sessions []CCConnectManagedSession) []CCConnectManagedSession {
	known := map[string]bool{}
	for _, session := range sessions {
		if strings.TrimSpace(session.ID) != "" {
			known[session.ID] = true
		}
	}

	projectName := strings.TrimSpace(target.Summary.Name)
	agentType := normalizeCCConnectAgentType(target.Summary.AgentType)
	globalCCConnectTerminalManager.mu.Lock()
	terminals := make([]*ccConnectTerminalSession, 0, len(globalCCConnectTerminalManager.sessions))
	for _, terminal := range globalCCConnectTerminalManager.sessions {
		terminals = append(terminals, terminal)
	}
	globalCCConnectTerminalManager.mu.Unlock()

	for _, terminal := range terminals {
		terminal.mu.Lock()
		status := terminal.status
		terminalProject := terminal.project
		terminalAgentType := normalizeCCConnectAgentType(firstCCConnectString(terminal.agentType, terminalProject.AgentType))
		terminalID := terminal.id
		resumeSessionID := strings.TrimSpace(terminal.resumeSessionID)
		cwd := terminal.cwd
		command := terminal.command
		kind := terminal.kind
		createdAt := terminal.createdAt
		updatedAt := terminal.updatedAt
		var exitedAt *time.Time
		if terminal.exitedAt != nil {
			exitedAtValue := *terminal.exitedAt
			exitedAt = &exitedAtValue
		}
		errText := terminal.errText
		terminal.mu.Unlock()

		if projectName == "" ||
			terminalProject.Name != projectName ||
			agentType == "" ||
			terminalAgentType != agentType {
			continue
		}

		sessionID := firstCCConnectString(resumeSessionID, terminalID)
		if sessionID == "" || known[sessionID] {
			continue
		}
		projectPath := firstCCConnectString(cwd, terminalProject.Path, target.Summary.Path)
		session := baseCCConnectSession(target, sessionID, terminalAgentType, "")
		session.ProjectPath = projectPath
		session.Source = "agentbox-terminal"
		session.Title = ccConnectTerminalBackedSessionTitle(terminalAgentType, status)
		session.Preview = firstCCConnectString(command, kind, "终端进程正在运行")
		session.StartedAt = createdAt.Format(time.RFC3339Nano)
		session.LastActiveAt = updatedAt.Format(time.RFC3339Nano)
		if status == "running" {
			session.IsActive = true
			session.ActiveProcessIDs = []string{terminalID}
		} else {
			endedAt := updatedAt
			if exitedAt != nil {
				endedAt = *exitedAt
			}
			session.EndedAt = endedAt.Format(time.RFC3339Nano)
			session.EndReason = ccConnectTerminalBackedEndReason(status, errText)
		}
		sessions = append(sessions, session)
		known[sessionID] = true
	}
	return sessions
}

func ccConnectTerminalBackedSessionTitle(agentType string, status string) string {
	label := ccConnectAgentSessionLabel(agentType)
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "running":
		return "运行中的 " + label + " 终端"
	case "stopping":
		return "停止中的 " + label + " 终端"
	default:
		return "已停止的 " + label + " 终端"
	}
}

func ccConnectTerminalBackedEndReason(status string, errText string) string {
	status = strings.ToLower(strings.TrimSpace(status))
	errText = strings.TrimSpace(errText)
	loweredErr := strings.ToLower(errText)
	if status == "stopping" {
		return "terminal_stopping"
	}
	if errText == "" ||
		strings.Contains(loweredErr, "signal: killed") ||
		strings.Contains(loweredErr, "interrupt") ||
		strings.Contains(loweredErr, "context canceled") {
		return "terminal_stopped"
	}
	return errText
}

func ccConnectAgentSessionLabel(agentType string) string {
	switch normalizeCCConnectAgentType(agentType) {
	case "claudecode":
		return "Claude Code"
	case "codex":
		return "Codex"
	case "gemini":
		return "Gemini"
	case "opencode":
		return "OpenCode"
	case "qoder":
		return "Qoder"
	default:
		return firstCCConnectString(agentType, "Agent")
	}
}

func readClaudeCodeSessions(target ccConnectSessionProjectTarget) ([]CCConnectManagedSession, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	projectDir := filepath.Join(home, ".claude", "projects", claudeCodeProjectKey(target.Summary.Path))
	paths := []string{}
	if entries, err := os.ReadDir(projectDir); err == nil {
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".jsonl") {
				paths = append(paths, filepath.Join(projectDir, entry.Name()))
			}
		}
	}
	if len(paths) == 0 {
		matches, _ := filepath.Glob(filepath.Join(home, ".claude", "projects", "*", "*.jsonl"))
		paths = append(paths, matches...)
	}
	sort.Strings(paths)
	sessions := make([]CCConnectManagedSession, 0, len(paths))
	for _, path := range paths {
		session, messages, err := parseCCConnectJSONLSession(path, target, "claudecode")
		if err != nil || session.ID == "" {
			continue
		}
		if target.Summary.Path != "" && !sameCCConnectPath(session.ProjectPath, target.Summary.Path) && !messagesContainCWD(messages, target.Summary.Path) {
			continue
		}
		sessions = append(sessions, session)
	}
	return sessions, nil
}

func readCodexSessions(target ccConnectSessionProjectTarget) ([]CCConnectManagedSession, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	paths := []string{}
	root := filepath.Join(home, ".codex", "sessions")
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry == nil || entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			return nil
		}
		paths = append(paths, path)
		return nil
	})
	sort.Strings(paths)
	sessions := make([]CCConnectManagedSession, 0, len(paths))
	for _, path := range paths {
		session, _, err := parseCCConnectJSONLSession(path, target, "codex")
		if err != nil || session.ID == "" {
			continue
		}
		if target.Summary.Path != "" && !sameCCConnectPath(session.ProjectPath, target.Summary.Path) {
			continue
		}
		sessions = append(sessions, session)
	}
	return sessions, nil
}

func readGeminiSessions(target ccConnectSessionProjectTarget) ([]CCConnectManagedSession, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	path := filepath.Join(home, ".gemini", "projects.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []CCConnectManagedSession{}, nil
		}
		return nil, err
	}
	var data any
	if err := json.Unmarshal(raw, &data); err != nil {
		return []CCConnectManagedSession{}, nil
	}
	sessions := []CCConnectManagedSession{}
	collectGenericJSONSessions(data, target, path, &sessions)
	return sessions, nil
}

func readOpenCodeSessions(target ccConnectSessionProjectTarget) ([]CCConnectManagedSession, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	dbPath := filepath.Join(home, ".local", "share", "opencode", "opencode.db")
	if !pathExists(dbPath) {
		return []CCConnectManagedSession{}, nil
	}
	db, err := sql.Open("sqlite", "file:"+dbPath+"?mode=ro")
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query(`
SELECT id, directory, title, time_created, time_updated, model, cost,
	tokens_input, tokens_output, tokens_reasoning, agent
FROM session
ORDER BY time_updated DESC`)
	if err != nil {
		return []CCConnectManagedSession{}, nil
	}
	defer rows.Close()
	sessions := []CCConnectManagedSession{}
	for rows.Next() {
		var session CCConnectManagedSession
		var directory, title, model, agent sql.NullString
		var created, updated sql.NullInt64
		var cost sql.NullFloat64
		var inputTokens, outputTokens, reasoningTokens sql.NullInt64
		if err := rows.Scan(&session.ID, &directory, &title, &created, &updated, &model, &cost, &inputTokens, &outputTokens, &reasoningTokens, &agent); err != nil {
			continue
		}
		projectPath := firstCCConnectString(directory.String, target.Summary.Path)
		if target.Summary.Path != "" && !sameCCConnectPath(projectPath, target.Summary.Path) {
			continue
		}
		session.Project = target.Summary.Name
		session.ProjectDisplayName = target.Summary.Name
		session.ProjectPath = projectPath
		session.AgentType = "opencode"
		session.Source = "opencode.db"
		session.Model = model.String
		session.Title = title.String
		session.StartedAt = formatCCConnectUnixMillis(created.Int64)
		session.LastActiveAt = formatCCConnectUnixMillis(updated.Int64)
		session.Path = dbPath
		session.MessageCount = countOpenCodeSessionMessages(db, session.ID)
		session.InputTokens = inputTokens.Int64
		session.OutputTokens = outputTokens.Int64
		session.ReasoningTokens = reasoningTokens.Int64
		session.TotalTokens = session.InputTokens + session.OutputTokens + session.ReasoningTokens
		if cost.Valid {
			value := cost.Float64
			session.CostUSD = &value
		}
		if agent.String != "" && session.Title == "" {
			session.Title = agent.String
		}
		sessions = append(sessions, session)
	}
	return sessions, rows.Err()
}

func readQoderSessions(target ccConnectSessionProjectTarget) ([]CCConnectManagedSession, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	root := filepath.Join(home, ".qoder", "logs", "runs")
	paths := []string{}
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry == nil || entry.IsDir() || entry.Name() != "manifest.json" {
			return nil
		}
		paths = append(paths, path)
		return nil
	})
	sort.Strings(paths)
	sessions := []CCConnectManagedSession{}
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var manifest map[string]any
		if err := json.Unmarshal(raw, &manifest); err != nil {
			continue
		}
		cwd := stringFromAny(manifest["cwd"])
		if target.Summary.Path != "" && !sameCCConnectPath(cwd, target.Summary.Path) {
			continue
		}
		id := firstCCConnectString(stringFromAny(manifest["session_id"]), stringFromAny(manifest["run_id"]), filepath.Base(filepath.Dir(path)))
		started := firstCCConnectString(stringFromAny(manifest["started_at"]), fileModTime(path))
		session := baseCCConnectSession(target, id, "qoder", path)
		session.ProjectPath = cwd
		session.Source = "qoder-logs"
		session.Model = stringFromAny(manifest["model"])
		session.StartedAt = started
		session.LastActiveAt = started
		session.Title = "Qoder Run"
		session.Preview = previewQoderLog(filepath.Join(filepath.Dir(path), "qodercli.log"))
		session.MessageCount = 1
		sessions = append(sessions, session)
	}
	return sessions, nil
}

func parseCCConnectJSONLSession(path string, target ccConnectSessionProjectTarget, agentType string) (CCConnectManagedSession, []CCConnectSessionMessage, error) {
	file, err := os.Open(path)
	if err != nil {
		return CCConnectManagedSession{}, nil, err
	}
	defer file.Close()
	session := baseCCConnectSession(target, strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)), agentType, path)
	messages := []CCConnectSessionMessage{}
	scanner := bufio.NewScanner(file)
	buffer := make([]byte, 0, 1024*1024)
	scanner.Buffer(buffer, 8*1024*1024)
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var item map[string]any
		if err := json.Unmarshal([]byte(line), &item); err != nil {
			continue
		}
		mergeJSONLSessionMeta(&session, item, agentType)
		message := ccConnectJSONLineToMessage(session.ID, lineNumber, item, agentType)
		if message.Text != "" || message.Role != "" {
			messages = append(messages, message)
			if message.Role == "user" && session.Preview == "" {
				session.Preview = truncateCCConnectText(message.Text, 220)
			}
			if message.Role != "" {
				session.MessageCount++
			}
			if message.ToolName != "" || strings.Contains(strings.ToLower(message.Role), "tool") {
				session.ToolCallCount++
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return session, messages, err
	}
	if session.LastActiveAt == "" {
		session.LastActiveAt = fileModTime(path)
	}
	if session.StartedAt == "" {
		session.StartedAt = session.LastActiveAt
	}
	if session.Title == "" {
		session.Title = session.Preview
	}
	return session, messages, nil
}

func baseCCConnectSession(target ccConnectSessionProjectTarget, id string, agentType string, path string) CCConnectManagedSession {
	return CCConnectManagedSession{
		ID:                 id,
		Project:            target.Summary.Name,
		ProjectDisplayName: target.Summary.Name,
		ProjectPath:        target.Summary.Path,
		AgentType:          agentType,
		Model:              target.Summary.Model,
		Path:               path,
	}
}

func mergeJSONLSessionMeta(session *CCConnectManagedSession, item map[string]any, agentType string) {
	if session.ID == "" {
		session.ID = firstCCConnectString(stringFromAny(item["sessionId"]), stringFromAny(item["session_id"]), stringFromAny(item["id"]))
	}
	if agentType == "codex" {
		if payload, ok := item["payload"].(map[string]any); ok {
			if id := stringFromAny(payload["id"]); id != "" {
				session.ID = id
			}
			if cwd := stringFromAny(payload["cwd"]); cwd != "" {
				session.ProjectPath = cwd
			}
			if model := stringFromAny(payload["model"]); model != "" {
				session.Model = model
			}
			if provider := stringFromAny(payload["model_provider"]); provider != "" {
				session.Source = provider
			}
		}
	}
	if cwd := stringFromAny(item["cwd"]); cwd != "" {
		session.ProjectPath = cwd
	}
	if model := stringFromAny(item["model"]); model != "" {
		session.Model = model
	}
	timestamp := firstCCConnectString(stringFromAny(item["timestamp"]), stringFromAny(item["createdAt"]))
	if timestamp != "" {
		if session.StartedAt == "" {
			session.StartedAt = timestamp
		}
		session.LastActiveAt = timestamp
	}
	if version := stringFromAny(item["version"]); version != "" && session.Source == "" {
		session.Source = version
	}
}

func ccConnectJSONLineToMessage(sessionID string, lineNumber int, item map[string]any, agentType string) CCConnectSessionMessage {
	message := CCConnectSessionMessage{
		ID:        fmt.Sprintf("%d", lineNumber),
		SessionID: sessionID,
		Raw:       item,
		Timestamp: firstCCConnectString(stringFromAny(item["timestamp"]), stringFromAny(item["createdAt"])),
	}
	if agentType == "codex" {
		if itemType := stringFromAny(item["type"]); itemType != "response_item" && itemType != "message" {
			return message
		}
		payload, _ := item["payload"].(map[string]any)
		if payload == nil {
			payload = item
		}
		message.Role = stringFromAny(payload["role"])
		message.Content = payload["content"]
		message.Text = contentToCCConnectText(payload["content"])
		return message
	}
	message.Role = firstCCConnectString(stringFromAny(item["type"]), stringFromAny(item["role"]))
	if msg, ok := item["message"].(map[string]any); ok {
		message.Role = firstCCConnectString(stringFromAny(msg["role"]), message.Role)
		message.Content = msg["content"]
		message.Text = contentToCCConnectText(msg["content"])
	} else {
		message.Content = firstAny(item["content"], item["text"], item["message"])
		message.Text = contentToCCConnectText(message.Content)
	}
	message.ToolName = firstCCConnectString(stringFromAny(item["toolName"]), stringFromAny(item["tool_name"]))
	return message
}

func readCCConnectSessionMessages(target ccConnectSessionProjectTarget, session CCConnectManagedSession) ([]CCConnectSessionMessage, error) {
	if target.Summary.AgentType == "opencode" {
		return readOpenCodeSessionMessages(session.Path, session.ID)
	}
	if target.Summary.AgentType == "qoder" {
		return readQoderSessionMessages(session)
	}
	if session.Path == "" || !pathExists(session.Path) {
		return []CCConnectSessionMessage{}, nil
	}
	_, messages, err := parseCCConnectJSONLSession(session.Path, target, target.Summary.AgentType)
	if err != nil {
		return []CCConnectSessionMessage{}, err
	}
	return messages, nil
}

func deleteCCConnectSessionFromProject(ctx context.Context, target ccConnectSessionProjectTarget, sessionID string) (bool, error) {
	sessions, err := readCCConnectManagedSessions(ctx, target, ccConnectSessionQuery{SpecificID: sessionID})
	if err != nil {
		return false, err
	}
	if len(sessions) == 0 {
		return globalCCConnectTerminalManager.deleteByCCConnectSession(target.Summary.Name, target.Summary.AgentType, sessionID) > 0, nil
	}
	session := sessions[0]
	if session.Source == "agentbox-terminal" {
		return globalCCConnectTerminalManager.deleteByCCConnectSession(target.Summary.Name, target.Summary.AgentType, sessionID) > 0, nil
	}
	switch target.Summary.AgentType {
	case "opencode":
		if err := deleteOpenCodeSession(session.Path, sessionID); err != nil {
			return false, err
		}
	case "qoder":
		if strings.Contains(session.Path, string(filepath.Separator)+".qoder"+string(filepath.Separator)+"logs"+string(filepath.Separator)+"runs"+string(filepath.Separator)) {
			if err := os.RemoveAll(filepath.Dir(session.Path)); err != nil {
				return false, err
			}
		}
	default:
		if session.Path == "" || !pathExists(session.Path) {
			return globalCCConnectTerminalManager.deleteByCCConnectSession(target.Summary.Name, target.Summary.AgentType, sessionID) > 0, nil
		}
		if err := os.Remove(session.Path); err != nil {
			return false, err
		}
	}
	globalCCConnectTerminalManager.deleteByCCConnectSession(target.Summary.Name, target.Summary.AgentType, sessionID)
	return true, nil
}

func ccConnectSessionExists(ctx context.Context, project string, agentType string, sessionID string) bool {
	target, err := resolveCCConnectSessionProjectTarget(project, agentType)
	if err != nil {
		return false
	}
	sessions, err := readCCConnectManagedSessions(ctx, target, ccConnectSessionQuery{SpecificID: sessionID})
	return err == nil && len(sessions) > 0
}

func stopCCConnectTerminalSessionsReferencing(project string, agentType string, sessionID string) int {
	project = strings.TrimSpace(project)
	agentType = normalizeCCConnectAgentType(agentType)
	sessionID = strings.TrimSpace(sessionID)
	if project == "" || sessionID == "" {
		return 0
	}
	globalCCConnectTerminalManager.mu.Lock()
	sessions := make([]*ccConnectTerminalSession, 0)
	for _, session := range globalCCConnectTerminalManager.sessions {
		if session.project.Name == project &&
			(agentType == "" || normalizeCCConnectAgentType(session.agentType) == agentType) &&
			session.status == "running" &&
			(session.id == sessionID || strings.TrimSpace(session.resumeSessionID) == sessionID) {
			sessions = append(sessions, session)
		}
	}
	globalCCConnectTerminalManager.mu.Unlock()
	for _, session := range sessions {
		session.stop()
	}
	return len(sessions)
}

func sortCCConnectManagedSessions(sessions []CCConnectManagedSession, sortBy string, sortDir string) {
	key := strings.ToLower(strings.TrimSpace(sortBy))
	if key == "" {
		key = "lastactive"
	}
	ascending := strings.EqualFold(strings.TrimSpace(sortDir), "asc")
	sort.SliceStable(sessions, func(i, j int) bool {
		left := sessions[i]
		right := sessions[j]
		compare := 0
		switch key {
		case "startedat", "started":
			compare = strings.Compare(left.StartedAt, right.StartedAt)
		case "messages", "messagecount":
			compare = compareCCConnectInt64(left.MessageCount, right.MessageCount)
		case "cost", "costusd":
			compare = compareCCConnectFloat64(floatFromCCConnectPtr(left.CostUSD), floatFromCCConnectPtr(right.CostUSD))
		case "tokens", "totaltokens":
			compare = compareCCConnectInt64(left.TotalTokens, right.TotalTokens)
		default:
			compare = strings.Compare(left.LastActiveAt, right.LastActiveAt)
		}
		if compare == 0 {
			compare = strings.Compare(left.ID, right.ID)
		}
		if ascending {
			return compare < 0
		}
		return compare > 0
	})
}

func summarizeCCConnectSessions(sessions []CCConnectManagedSession, projectCount int) CCConnectSessionsSummary {
	summary := CCConnectSessionsSummary{TotalMatched: len(sessions), Projects: projectCount}
	for _, session := range sessions {
		if session.IsActive {
			summary.Active++
		}
		if session.EndedAt != "" {
			summary.Ended++
		}
		summary.TotalMessages += session.MessageCount
		summary.TotalToolCalls += session.ToolCallCount
		summary.TotalTokens += session.TotalTokens
		summary.TotalCostUSD += floatFromCCConnectPtr(session.CostUSD)
	}
	return summary
}

func ccConnectSessionMatches(session CCConnectManagedSession, query string) bool {
	haystack := strings.ToLower(strings.Join([]string{
		session.ID, session.Project, session.ProjectPath, session.AgentType, session.Source,
		session.Platform, session.UserID, session.Model, session.Title, session.Preview,
		session.MatchSnippet,
	}, " "))
	return strings.Contains(haystack, query)
}

func claudeCodeProjectKey(path string) string {
	path = filepath.Clean(expandCCConnectHomePath(path))
	if path == "." || path == string(filepath.Separator) {
		return "-"
	}
	return strings.ReplaceAll(path, string(filepath.Separator), "-")
}

func messagesContainCWD(messages []CCConnectSessionMessage, cwd string) bool {
	for _, message := range messages {
		if raw, ok := message.Raw.(map[string]any); ok {
			if sameCCConnectPath(stringFromAny(raw["cwd"]), cwd) {
				return true
			}
		}
	}
	return false
}

func collectGenericJSONSessions(value any, target ccConnectSessionProjectTarget, path string, out *[]CCConnectManagedSession) {
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			collectGenericJSONSessions(item, target, path, out)
		}
	case map[string]any:
		id := firstCCConnectString(stringFromAny(typed["id"]), stringFromAny(typed["sessionId"]), stringFromAny(typed["session_id"]))
		cwd := firstCCConnectString(stringFromAny(typed["cwd"]), stringFromAny(typed["path"]), stringFromAny(typed["directory"]))
		if id != "" {
			if target.Summary.Path == "" || cwd == "" || sameCCConnectPath(cwd, target.Summary.Path) {
				session := baseCCConnectSession(target, id, "gemini", path)
				session.ProjectPath = firstCCConnectString(cwd, target.Summary.Path)
				session.Title = firstCCConnectString(stringFromAny(typed["title"]), id)
				session.Preview = contentToCCConnectText(firstAny(typed["preview"], typed["summary"], typed["prompt"]))
				session.StartedAt = firstCCConnectString(stringFromAny(typed["createdAt"]), stringFromAny(typed["created_at"]), stringFromAny(typed["timestamp"]))
				session.LastActiveAt = firstCCConnectString(stringFromAny(typed["updatedAt"]), stringFromAny(typed["updated_at"]), session.StartedAt)
				session.MessageCount = int64(len(arrayFromAny(typed["messages"])))
				*out = append(*out, session)
			}
		}
		for _, nested := range typed {
			collectGenericJSONSessions(nested, target, path, out)
		}
	}
}

func countOpenCodeSessionMessages(db *sql.DB, sessionID string) int64 {
	var count int64
	_ = db.QueryRow("SELECT COUNT(*) FROM message WHERE session_id = ?", sessionID).Scan(&count)
	return count
}

func readOpenCodeSessionMessages(dbPath string, sessionID string) ([]CCConnectSessionMessage, error) {
	if dbPath == "" || !pathExists(dbPath) {
		return []CCConnectSessionMessage{}, nil
	}
	db, err := sql.Open("sqlite", "file:"+dbPath+"?mode=ro")
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query("SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id", sessionID)
	if err != nil {
		return []CCConnectSessionMessage{}, nil
	}
	defer rows.Close()
	messages := []CCConnectSessionMessage{}
	for rows.Next() {
		var id, data string
		var created int64
		if err := rows.Scan(&id, &created, &data); err != nil {
			continue
		}
		var decoded any
		_ = json.Unmarshal([]byte(data), &decoded)
		msg := CCConnectSessionMessage{
			ID:        id,
			SessionID: sessionID,
			Content:   decoded,
			Text:      contentToCCConnectText(decoded),
			Timestamp: formatCCConnectUnixMillis(created),
			Raw:       decoded,
		}
		if obj, ok := decoded.(map[string]any); ok {
			msg.Role = firstCCConnectString(stringFromAny(obj["role"]), stringFromAny(obj["type"]))
		}
		messages = append(messages, msg)
	}
	return messages, rows.Err()
}

func deleteOpenCodeSession(dbPath string, sessionID string) error {
	if dbPath == "" || !pathExists(dbPath) {
		return nil
	}
	db, err := sql.Open("sqlite", "file:"+dbPath+"?mode=rw")
	if err != nil {
		return err
	}
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, statement := range []string{
		"DELETE FROM part WHERE session_id = ?",
		"DELETE FROM message WHERE session_id = ?",
		"DELETE FROM session_message WHERE session_id = ?",
		"DELETE FROM todo WHERE session_id = ?",
		"DELETE FROM session WHERE id = ?",
	} {
		if _, err := tx.Exec(statement, sessionID); err != nil {
			continue
		}
	}
	return tx.Commit()
}

func readQoderSessionMessages(session CCConnectManagedSession) ([]CCConnectSessionMessage, error) {
	logPath := filepath.Join(filepath.Dir(session.Path), "qodercli.log")
	file, err := os.Open(logPath)
	if err != nil {
		return []CCConnectSessionMessage{}, nil
	}
	defer file.Close()
	messages := []CCConnectSessionMessage{}
	scanner := bufio.NewScanner(file)
	line := 0
	for scanner.Scan() {
		line++
		text := scanner.Text()
		if strings.TrimSpace(text) == "" {
			continue
		}
		messages = append(messages, CCConnectSessionMessage{
			ID:        fmt.Sprintf("%d", line),
			SessionID: session.ID,
			Role:      "log",
			Text:      text,
			Timestamp: firstCCConnectString(firstField(text), session.StartedAt),
		})
		if len(messages) >= 300 {
			break
		}
	}
	return messages, scanner.Err()
}

func previewQoderLog(path string) string {
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" {
			return truncateCCConnectText(line, 220)
		}
	}
	return ""
}

func stringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	case float64, float32, int, int64, int32, uint, uint64, bool:
		return fmt.Sprint(typed)
	default:
		return ""
	}
}

func firstAny(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func arrayFromAny(value any) []any {
	if items, ok := value.([]any); ok {
		return items
	}
	return nil
}

func contentToCCConnectText(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			text := contentToCCConnectText(item)
			if text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	case map[string]any:
		for _, key := range []string{"text", "content", "message", "summary"} {
			if text := contentToCCConnectText(typed[key]); text != "" {
				return text
			}
		}
		data, _ := json.Marshal(typed)
		return string(data)
	default:
		return fmt.Sprint(typed)
	}
}

func truncateCCConnectText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len([]rune(value)) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit]) + "..."
}

func fileModTime(path string) string {
	info, err := os.Stat(path)
	if err != nil {
		return ""
	}
	return info.ModTime().UTC().Format(time.RFC3339)
}

func formatCCConnectUnixMillis(value int64) string {
	if value <= 0 {
		return ""
	}
	if value > 1_000_000_000_000 {
		return time.UnixMilli(value).UTC().Format(time.RFC3339)
	}
	return time.Unix(value, 0).UTC().Format(time.RFC3339)
}

func compareCCConnectInt64(left int64, right int64) int {
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func compareCCConnectFloat64(left float64, right float64) int {
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func floatFromCCConnectPtr(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}

func firstField(value string) string {
	fields := strings.Fields(value)
	if len(fields) == 0 {
		return ""
	}
	return fields[0]
}
