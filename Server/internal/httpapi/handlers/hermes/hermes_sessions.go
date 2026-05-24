package hermes

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

type HermesSessionsInput struct {
	Profile         string `query:"profile,omitempty" doc:"Hermes profile name, all, or empty for all profiles." example:"all"`
	Query           string `query:"query,omitempty" doc:"Search query across session metadata and messages." example:"deploy"`
	Source          string `query:"source,omitempty" doc:"Optional source/platform filter." example:"cli"`
	Status          string `query:"status,omitempty" doc:"all, active, or ended." example:"all"`
	IncludeChildren bool   `query:"includeChildren,omitempty" doc:"Include child, branch, compression, and sub-agent sessions." example:"false"`
	Limit           int    `query:"limit,omitempty" minimum:"1" maximum:"500" doc:"Maximum sessions to return." example:"100"`
	Offset          int    `query:"offset,omitempty" minimum:"0" doc:"Number of matched sessions to skip after sorting." example:"0"`
	SortBy          string `query:"sortBy,omitempty" doc:"lastActive, startedAt, messages, cost, or tokens." example:"lastActive"`
	SortDir         string `query:"sortDir,omitempty" doc:"desc or asc." example:"desc"`
}

type HermesSessionDetailInput struct {
	Profile string `path:"profile" doc:"Hermes profile name." example:"default"`
	ID      string `path:"id" doc:"Hermes session id." example:"019e..."`
}

type HermesSessionsBulkDeleteInput struct {
	Body HermesSessionsBulkDeleteRequest
}

type HermesSessionEndInput struct {
	Profile string `path:"profile" doc:"Hermes profile name." example:"default"`
	ID      string `path:"id" doc:"Hermes session id." example:"019e..."`
	Body    HermesSessionEndRequest
}

type HermesSessionsOutput struct {
	Body HermesSessionsResponse
}

type HermesSessionDetailOutput struct {
	Body HermesSessionDetailResponse
}

type HermesSessionsBulkDeleteOutput struct {
	Body HermesSessionsBulkDeleteResponse
}

type HermesSessionEndOutput struct {
	Body HermesSessionEndResponse
}

type HermesSessionsResponse struct {
	Status    string                 `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                 `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Profiles  []HermesProfileSummary `json:"profiles" doc:"Profiles included in this query."`
	Summary   HermesSessionsSummary  `json:"summary" doc:"Aggregate session summary for matched sessions before pagination."`
	Sessions  []HermesManagedSession `json:"sessions" doc:"Matched Hermes sessions."`
	Limit     int                    `json:"limit" example:"100" doc:"Applied limit."`
	Offset    int                    `json:"offset" example:"0" doc:"Applied offset."`
	HasMore   bool                   `json:"hasMore" example:"false" doc:"Whether more matched sessions exist after this page."`
	Errors    []string               `json:"errors,omitempty" doc:"Non-fatal per-profile read errors."`
}

type HermesSessionDetailResponse struct {
	Status    string                 `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                 `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Profile   HermesProfileSummary   `json:"profile" doc:"Profile containing this session."`
	Session   HermesManagedSession   `json:"session" doc:"Session metadata."`
	Messages  []HermesSessionMessage `json:"messages" doc:"Session messages ordered by timestamp."`
	Errors    []string               `json:"errors,omitempty" doc:"Non-fatal read errors."`
}

type HermesSessionsBulkDeleteRequest struct {
	Sessions []HermesSessionRef `json:"sessions" doc:"Sessions to delete."`
}

type HermesSessionEndRequest struct {
	Reason string `json:"reason,omitempty" doc:"End reason written to state.db." example:"manual_close"`
}

type HermesSessionsBulkDeleteResponse struct {
	Status    string                          `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                          `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Summary   HermesSessionsBulkDeleteSummary `json:"summary" doc:"Bulk deletion summary."`
	Results   []HermesSessionDeleteResult     `json:"results" doc:"Per-session deletion results."`
}

type HermesSessionEndResponse struct {
	Status              string               `json:"status" example:"ok" doc:"Operation status."`
	Timestamp           string               `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Profile             HermesProfileSummary `json:"profile" doc:"Profile containing this session."`
	Session             HermesManagedSession `json:"session" doc:"Ended session metadata."`
	TerminatedProcesses int                  `json:"terminatedProcesses" doc:"Best-effort runtime processes signalled before marking the session ended."`
}

type HermesProfileSummary struct {
	Name        string `json:"name" example:"default" doc:"Profile name."`
	DisplayName string `json:"displayName" example:"Default" doc:"Display label."`
	Path        string `json:"path" doc:"Profile directory path."`
	IsDefault   bool   `json:"isDefault" example:"true" doc:"Whether this is the built-in default profile."`
	IsActive    bool   `json:"isActive" example:"true" doc:"Whether this is the sticky active profile."`
	StateDBPath string `json:"stateDbPath" doc:"Profile state.db path."`
}

type HermesSessionsSummary struct {
	TotalMatched   int     `json:"totalMatched" example:"42" doc:"Matched sessions before pagination."`
	Returned       int     `json:"returned" example:"25" doc:"Returned sessions after pagination."`
	Profiles       int     `json:"profiles" example:"3" doc:"Profile count included."`
	Active         int     `json:"active" example:"1" doc:"Matched active sessions."`
	Ended          int     `json:"ended" example:"36" doc:"Matched ended sessions."`
	TotalMessages  int64   `json:"totalMessages" example:"1024" doc:"Matched message count."`
	TotalToolCalls int64   `json:"totalToolCalls" example:"64" doc:"Matched tool call count."`
	TotalTokens    int64   `json:"totalTokens" example:"32000" doc:"Input + output + reasoning token count."`
	TotalCostUSD   float64 `json:"totalCostUsd" example:"0.87" doc:"Actual cost where available, otherwise estimated cost."`
}

type HermesManagedSession struct {
	HermesSessionInfo
	Profile             string   `json:"profile" example:"default" doc:"Profile name."`
	ProfileDisplayName  string   `json:"profileDisplayName" example:"Default" doc:"Profile display label."`
	ProfilePath         string   `json:"profilePath" doc:"Profile directory path."`
	StateDBPath         string   `json:"stateDbPath" doc:"Profile state.db path."`
	ParentSessionID     string   `json:"parentSessionId,omitempty" doc:"Parent session id."`
	Preview             string   `json:"preview,omitempty" doc:"First user message preview."`
	MatchSnippet        string   `json:"matchSnippet,omitempty" doc:"Best-effort message snippet for search query."`
	MatchedMessageCount int64    `json:"matchedMessageCount" doc:"Messages matching the query."`
	IsActive            bool     `json:"isActive" example:"false" doc:"Whether a local runtime process appears to reference this session."`
	ActiveProcessIDs    []string `json:"activeProcessIds,omitempty" doc:"Runtime process ids referencing this session."`
	TotalTokens         int64    `json:"totalTokens" doc:"Input + output + reasoning token count."`
	CostUSD             *float64 `json:"costUsd,omitempty" doc:"Actual cost where available, otherwise estimated cost."`
}

type HermesSessionMessage struct {
	ID               int64  `json:"id" example:"1" doc:"Message row id."`
	SessionID        string `json:"sessionId" doc:"Session id."`
	Role             string `json:"role" example:"user" doc:"Message role."`
	Content          any    `json:"content,omitempty" doc:"Decoded message content."`
	Text             string `json:"text,omitempty" doc:"Best-effort text representation for display/search."`
	ToolCallID       string `json:"toolCallId,omitempty" doc:"Tool call id."`
	ToolCalls        any    `json:"toolCalls,omitempty" doc:"Decoded tool calls when available."`
	ToolName         string `json:"toolName,omitempty" doc:"Tool name."`
	Timestamp        string `json:"timestamp,omitempty" doc:"Message timestamp."`
	TokenCount       int64  `json:"tokenCount,omitempty" doc:"Token count."`
	FinishReason     string `json:"finishReason,omitempty" doc:"Finish reason."`
	Reasoning        string `json:"reasoning,omitempty" doc:"Reasoning text."`
	ReasoningContent string `json:"reasoningContent,omitempty" doc:"Reasoning content."`
}

type HermesSessionRef struct {
	Profile string `json:"profile" example:"default" doc:"Profile name."`
	ID      string `json:"id" example:"019e..." doc:"Session id."`
}

type HermesSessionDeleteResult struct {
	Profile string `json:"profile" example:"default" doc:"Profile name."`
	ID      string `json:"id" example:"019e..." doc:"Session id."`
	Status  string `json:"status" example:"deleted" doc:"deleted, skipped, missing, or error."`
	Message string `json:"message,omitempty" doc:"Human-readable result."`
}

type HermesSessionsBulkDeleteSummary struct {
	Requested int `json:"requested" example:"3" doc:"Requested item count."`
	Deleted   int `json:"deleted" example:"2" doc:"Deleted item count."`
	Skipped   int `json:"skipped" example:"1" doc:"Skipped item count."`
	Missing   int `json:"missing" example:"0" doc:"Missing item count."`
	Errors    int `json:"errors" example:"0" doc:"Error item count."`
}

type hermesSessionProfileTarget struct {
	Summary HermesProfileSummary
	Home    string
}

const hermesContentJSONPrefix = "\x00json:"

func ListHermesSessions(ctx context.Context, input *HermesSessionsInput) (*HermesSessionsOutput, error) {
	if input == nil {
		input = &HermesSessionsInput{}
	}
	limit := input.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	offset := input.Offset
	if offset < 0 {
		offset = 0
	}

	targets, err := resolveHermesSessionProfileTargets(ctx, input.Profile)
	if err != nil {
		return nil, err
	}

	query := strings.TrimSpace(input.Query)
	source := strings.TrimSpace(input.Source)
	statusFilter := strings.ToLower(strings.TrimSpace(input.Status))
	if statusFilter == "" {
		statusFilter = "all"
	}
	if statusFilter != "all" && statusFilter != "active" && statusFilter != "ended" {
		return nil, huma.Error400BadRequest("status must be all, active, or ended", nil)
	}

	allSessions := make([]HermesManagedSession, 0, limit)
	errorsList := make([]string, 0)
	for _, target := range targets {
		activeRefs := readHermesActiveSessionRefs(ctx, filepath.Join(target.Home, "processes.json"))
		sessions, err := readHermesManagedSessions(target, hermesManagedSessionQuery{
			Query:           query,
			Source:          source,
			Status:          statusFilter,
			IncludeChildren: input.IncludeChildren,
			ActiveRefs:      activeRefs,
		})
		if err != nil {
			errorsList = append(errorsList, fmt.Sprintf("%s: %v", target.Summary.Name, err))
			continue
		}
		allSessions = append(allSessions, sessions...)
	}

	sortHermesManagedSessions(allSessions, input.SortBy, input.SortDir)
	summary := summarizeHermesSessions(allSessions, len(targets))
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
	return &HermesSessionsOutput{Body: HermesSessionsResponse{
		Status:    status,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Profiles:  hermesProfileTargetsToSummaries(targets),
		Summary:   summary,
		Sessions:  page,
		Limit:     limit,
		Offset:    offset,
		HasMore:   end < len(allSessions),
		Errors:    errorsList,
	}}, nil
}

func GetHermesSession(ctx context.Context, input *HermesSessionDetailInput) (*HermesSessionDetailOutput, error) {
	target, err := resolveHermesSessionProfileTarget(ctx, input.Profile)
	if err != nil {
		return nil, err
	}
	sessionID := strings.TrimSpace(input.ID)
	if sessionID == "" {
		return nil, huma.Error400BadRequest("session id is required", nil)
	}

	activeRefs := readHermesActiveSessionRefs(ctx, filepath.Join(target.Home, "processes.json"))
	sessions, err := readHermesManagedSessions(target, hermesManagedSessionQuery{
		IncludeChildren: true,
		ActiveRefs:      activeRefs,
		SpecificID:      sessionID,
	})
	if err != nil {
		return nil, huma.Error500InternalServerError("read hermes session failed", err)
	}
	if len(sessions) == 0 {
		return nil, huma.Error404NotFound("Hermes session not found", nil)
	}

	messages, err := readHermesSessionMessages(target.Summary.StateDBPath, sessionID)
	if err != nil {
		return nil, huma.Error500InternalServerError("read hermes session messages failed", err)
	}

	return &HermesSessionDetailOutput{Body: HermesSessionDetailResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Profile:   target.Summary,
		Session:   sessions[0],
		Messages:  messages,
	}}, nil
}

func EndHermesSession(ctx context.Context, input *HermesSessionEndInput) (*HermesSessionEndOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("session end input is required", nil)
	}
	target, err := resolveHermesSessionProfileTarget(ctx, input.Profile)
	if err != nil {
		return nil, err
	}
	sessionID := strings.TrimSpace(input.ID)
	if sessionID == "" {
		return nil, huma.Error400BadRequest("session id is required", nil)
	}
	reason := strings.TrimSpace(input.Body.Reason)
	if reason == "" {
		reason = "manual_close"
	}

	signalled := terminateHermesSessionProcesses(ctx, target, sessionID)
	ended, err := endHermesSessionInProfile(target, sessionID, reason)
	if err != nil {
		return nil, huma.Error500InternalServerError("end hermes session failed", err)
	}
	if !ended {
		return nil, huma.Error404NotFound("Hermes session not found", nil)
	}

	sessions, err := readHermesManagedSessions(target, hermesManagedSessionQuery{
		IncludeChildren: true,
		SpecificID:      sessionID,
	})
	if err != nil {
		return nil, huma.Error500InternalServerError("read ended hermes session failed", err)
	}
	if len(sessions) == 0 {
		return nil, huma.Error404NotFound("Hermes session not found", nil)
	}
	return &HermesSessionEndOutput{Body: HermesSessionEndResponse{
		Status:              "ok",
		Timestamp:           time.Now().UTC().Format(time.RFC3339),
		Profile:             target.Summary,
		Session:             sessions[0],
		TerminatedProcesses: signalled,
	}}, nil
}

func DeleteHermesSessions(ctx context.Context, input *HermesSessionsBulkDeleteInput) (*HermesSessionsBulkDeleteOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("sessions payload is required", nil)
	}
	results := make([]HermesSessionDeleteResult, 0, len(input.Body.Sessions))
	targetCache := map[string]hermesSessionProfileTarget{}

	for _, item := range input.Body.Sessions {
		profileName := strings.TrimSpace(item.Profile)
		sessionID := strings.TrimSpace(item.ID)
		result := HermesSessionDeleteResult{Profile: profileName, ID: sessionID}
		if profileName == "" || sessionID == "" {
			result.Status = "error"
			result.Message = "profile and id are required"
			results = append(results, result)
			continue
		}

		target, ok := targetCache[profileName]
		if !ok {
			resolved, err := resolveHermesSessionProfileTarget(ctx, profileName)
			if err != nil {
				result.Status = "error"
				result.Message = err.Error()
				results = append(results, result)
				continue
			}
			target = resolved
			targetCache[profileName] = target
		}
		result.Profile = target.Summary.Name

		activeRefs := readHermesActiveSessionRefs(ctx, filepath.Join(target.Home, "processes.json"))
		if refs := activeRefs[sessionID]; len(refs) > 0 {
			result.Status = "skipped"
			result.Message = "session appears active"
			results = append(results, result)
			continue
		}

		deleted, err := deleteHermesSessionFromProfile(target, sessionID)
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

	summary := HermesSessionsBulkDeleteSummary{Requested: len(input.Body.Sessions)}
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
	return &HermesSessionsBulkDeleteOutput{Body: HermesSessionsBulkDeleteResponse{
		Status:    status,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Summary:   summary,
		Results:   results,
	}}, nil
}

type hermesManagedSessionQuery struct {
	Query           string
	Source          string
	Status          string
	IncludeChildren bool
	ActiveRefs      map[string][]string
	SpecificID      string
}

func resolveHermesSessionProfileTargets(ctx context.Context, profile string) ([]hermesSessionProfileTarget, error) {
	requested := strings.ToLower(strings.TrimSpace(profile))
	if requested == "" || requested == "all" {
		profiles, _ := scanHermesProfiles(ctx)
		targets := make([]hermesSessionProfileTarget, 0, len(profiles))
		for _, profile := range profiles {
			targets = append(targets, hermesAgentInfoToSessionTarget(profile))
		}
		return targets, nil
	}
	target, err := resolveHermesSessionProfileTarget(ctx, profile)
	if err != nil {
		return nil, err
	}
	return []hermesSessionProfileTarget{target}, nil
}

func resolveHermesSessionProfileTarget(ctx context.Context, profile string) (hermesSessionProfileTarget, error) {
	info, err := getHermesProfile(ctx, profile)
	if err != nil {
		return hermesSessionProfileTarget{}, err
	}
	return hermesAgentInfoToSessionTarget(info), nil
}

func hermesAgentInfoToSessionTarget(profile HermesAgentInfo) hermesSessionProfileTarget {
	return hermesSessionProfileTarget{
		Home: profile.Path,
		Summary: HermesProfileSummary{
			Name:        profile.Name,
			DisplayName: profile.DisplayName,
			Path:        profile.Path,
			IsDefault:   profile.IsDefault,
			IsActive:    profile.IsActive,
			StateDBPath: filepath.Join(profile.Path, "state.db"),
		},
	}
}

func hermesProfileTargetsToSummaries(targets []hermesSessionProfileTarget) []HermesProfileSummary {
	summaries := make([]HermesProfileSummary, 0, len(targets))
	for _, target := range targets {
		summaries = append(summaries, target.Summary)
	}
	return summaries
}

func readHermesManagedSessions(target hermesSessionProfileTarget, options hermesManagedSessionQuery) ([]HermesManagedSession, error) {
	path := target.Summary.StateDBPath
	if !pathExists(path) {
		return []HermesManagedSession{}, nil
	}

	db, err := openHermesStateDBReadOnly(path)
	if err != nil {
		return []HermesManagedSession{}, err
	}
	defer db.Close()

	if ok, err := sqliteTableExists(db, "sessions"); err != nil {
		return []HermesManagedSession{}, err
	} else if !ok {
		return []HermesManagedSession{}, nil
	}

	hasMessages, err := sqliteTableExists(db, "messages")
	if err != nil {
		return []HermesManagedSession{}, err
	}
	matchedIDs := map[string]hermesMessageMatch{}
	query := strings.TrimSpace(options.Query)
	if query != "" && hasMessages {
		matchedIDs, err = searchHermesSessionMessages(db, query)
		if err != nil {
			return []HermesManagedSession{}, err
		}
	}

	clauses := []string{"1 = 1"}
	params := []any{}
	if !options.IncludeChildren {
		clauses = append(clauses, `(s.parent_session_id IS NULL OR EXISTS (
			SELECT 1 FROM sessions p
			WHERE p.id = s.parent_session_id
				AND p.end_reason = 'branched'
				AND s.started_at >= p.ended_at
		))`)
	}
	if options.SpecificID != "" {
		clauses = append(clauses, "s.id = ?")
		params = append(params, options.SpecificID)
	}
	if options.Source != "" {
		clauses = append(clauses, "(s.source = ? OR s.source LIKE ?)")
		params = append(params, options.Source, "%"+options.Source+"%")
	}
	if options.Status == "ended" {
		clauses = append(clauses, "s.ended_at IS NOT NULL")
	}
	if query != "" {
		like := "%" + escapeSQLLike(query) + "%"
		messageIDs := make([]string, 0, len(matchedIDs))
		for id := range matchedIDs {
			messageIDs = append(messageIDs, id)
		}
		sort.Strings(messageIDs)
		searchParts := []string{
			"s.id LIKE ? ESCAPE '\\'",
			"s.title LIKE ? ESCAPE '\\'",
			"s.model LIKE ? ESCAPE '\\'",
			"s.source LIKE ? ESCAPE '\\'",
			"s.user_id LIKE ? ESCAPE '\\'",
		}
		params = append(params, like, like, like, like, like)
		if len(messageIDs) > 0 {
			placeholders := make([]string, len(messageIDs))
			for i, id := range messageIDs {
				placeholders[i] = "?"
				params = append(params, id)
			}
			searchParts = append(searchParts, "s.id IN ("+strings.Join(placeholders, ",")+")")
		}
		clauses = append(clauses, "("+strings.Join(searchParts, " OR ")+")")
	}

	messageSelects := `
		s.message_count AS db_message_count,
		s.tool_call_count AS db_tool_call_count,
		0 AS derived_message_count,
		0 AS derived_tool_call_count,
		s.started_at AS last_active,
		'' AS preview`
	if hasMessages {
		messageSelects = `
			s.message_count AS db_message_count,
			s.tool_call_count AS db_tool_call_count,
			COUNT(m.id) AS derived_message_count,
			SUM(CASE WHEN m.tool_name IS NOT NULL AND TRIM(m.tool_name) != '' THEN 1 ELSE 0 END) AS derived_tool_call_count,
			COALESCE(MAX(m.timestamp), s.started_at) AS last_active,
			(
				SELECT content FROM messages pm
				WHERE pm.session_id = s.id
					AND pm.role = 'user'
					AND pm.content IS NOT NULL
					AND TRIM(pm.content) != ''
				ORDER BY pm.timestamp, pm.id
				LIMIT 1
			) AS preview`
	}
	messageJoin := ""
	if hasMessages {
		messageJoin = "LEFT JOIN messages m ON m.session_id = s.id"
	}

	rows, err := db.Query(`
		SELECT
			s.id,
			s.source,
			s.user_id,
			s.model,
			s.parent_session_id,
			s.title,
			s.started_at,
			s.ended_at,
			s.end_reason,
			`+messageSelects+`,
			s.input_tokens,
			s.output_tokens,
			s.reasoning_tokens,
			s.estimated_cost_usd,
			s.actual_cost_usd,
			s.cost_status,
			s.handoff_state,
			s.handoff_platform,
			s.handoff_error
		FROM sessions s
		`+messageJoin+`
		WHERE `+strings.Join(clauses, " AND ")+`
		GROUP BY s.id
		ORDER BY last_active DESC`, params...)
	if err != nil {
		return []HermesManagedSession{}, err
	}
	defer rows.Close()

	sessions := make([]HermesManagedSession, 0)
	for rows.Next() {
		var session HermesManagedSession
		var source, userID, model, parentID, title, endReason, costStatus sql.NullString
		var handoffState, handoffPlatform, handoffError sql.NullString
		var startedAt, endedAt, lastActive sql.NullFloat64
		var dbMessageCount, dbToolCallCount, derivedMessageCount, derivedToolCallCount sql.NullInt64
		var inputTokens, outputTokens, reasoningTokens sql.NullInt64
		var estimatedCost, actualCost sql.NullFloat64
		var preview sql.NullString
		if err := rows.Scan(
			&session.ID,
			&source,
			&userID,
			&model,
			&parentID,
			&title,
			&startedAt,
			&endedAt,
			&endReason,
			&dbMessageCount,
			&dbToolCallCount,
			&derivedMessageCount,
			&derivedToolCallCount,
			&lastActive,
			&preview,
			&inputTokens,
			&outputTokens,
			&reasoningTokens,
			&estimatedCost,
			&actualCost,
			&costStatus,
			&handoffState,
			&handoffPlatform,
			&handoffError,
		); err != nil {
			return []HermesManagedSession{}, err
		}

		session.Profile = target.Summary.Name
		session.ProfileDisplayName = target.Summary.DisplayName
		session.ProfilePath = target.Summary.Path
		session.StateDBPath = target.Summary.StateDBPath
		session.Source = source.String
		session.Platform = parseHermesSessionPlatform(source.String)
		session.UserID = userID.String
		session.Model = model.String
		session.ParentSessionID = parentID.String
		session.Title = title.String
		session.StartedAt = formatUnixFloat(startedAt)
		session.EndedAt = formatUnixFloat(endedAt)
		session.EndReason = endReason.String
		session.LastActiveAt = formatUnixFloat(lastActive)
		session.MessageCount = firstValidInt64(dbMessageCount, derivedMessageCount)
		session.ToolCallCount = firstValidInt64(dbToolCallCount, derivedToolCallCount)
		session.InputTokens = nullInt64Value(inputTokens)
		session.OutputTokens = nullInt64Value(outputTokens)
		session.ReasoningTokens = nullInt64Value(reasoningTokens)
		session.TotalTokens = session.InputTokens + session.OutputTokens + session.ReasoningTokens
		if estimatedCost.Valid {
			value := estimatedCost.Float64
			session.EstimatedCostUSD = &value
		}
		if actualCost.Valid {
			value := actualCost.Float64
			session.ActualCostUSD = &value
		}
		if session.ActualCostUSD != nil {
			value := *session.ActualCostUSD
			session.CostUSD = &value
		} else if session.EstimatedCostUSD != nil {
			value := *session.EstimatedCostUSD
			session.CostUSD = &value
		}
		session.CostStatus = costStatus.String
		session.HandoffState = handoffState.String
		session.HandoffPlatform = handoffPlatform.String
		session.HandoffError = handoffError.String
		session.Preview = truncateHermesText(contentToText(decodeHermesMessageContent(preview.String)), 220)
		if match := matchedIDs[session.ID]; match.Count > 0 {
			session.MatchedMessageCount = match.Count
			session.MatchSnippet = truncateHermesText(match.Snippet, 260)
		}
		if refs := options.ActiveRefs[session.ID]; len(refs) > 0 && session.EndedAt == "" {
			session.IsActive = true
			session.ActiveProcessIDs = refs
		}
		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		return []HermesManagedSession{}, err
	}

	if options.Status == "active" {
		sessions = filterHermesSessions(sessions, func(item HermesManagedSession) bool { return item.IsActive })
	} else if options.Status == "ended" {
		sessions = filterHermesSessions(sessions, func(item HermesManagedSession) bool { return !item.IsActive && item.EndedAt != "" })
	}
	return sessions, nil
}

type hermesMessageMatch struct {
	Count   int64
	Snippet string
}

func searchHermesSessionMessages(db *sql.DB, query string) (map[string]hermesMessageMatch, error) {
	result := map[string]hermesMessageMatch{}
	if strings.TrimSpace(query) == "" {
		return result, nil
	}

	if ok, err := sqliteTableExists(db, "messages_fts_trigram"); err == nil && ok {
		rows, err := db.Query(`
			SELECT m.session_id, COUNT(*) AS matched, MIN(m.content) AS snippet
			FROM messages_fts_trigram f
			JOIN messages m ON m.id = f.rowid
			WHERE messages_fts_trigram MATCH ?
			GROUP BY m.session_id`, query)
		if err == nil {
			defer rows.Close()
			return scanHermesMessageMatches(rows)
		}
	}
	if ok, err := sqliteTableExists(db, "messages_fts"); err == nil && ok {
		rows, err := db.Query(`
			SELECT m.session_id, COUNT(*) AS matched, MIN(m.content) AS snippet
			FROM messages_fts f
			JOIN messages m ON m.id = f.rowid
			WHERE messages_fts MATCH ?
			GROUP BY m.session_id`, query)
		if err == nil {
			defer rows.Close()
			return scanHermesMessageMatches(rows)
		}
	}

	like := "%" + escapeSQLLike(query) + "%"
	rows, err := db.Query(`
		SELECT session_id, COUNT(*) AS matched, MIN(content) AS snippet
		FROM messages
		WHERE content LIKE ? ESCAPE '\'
			OR tool_name LIKE ? ESCAPE '\'
			OR tool_calls LIKE ? ESCAPE '\'
		GROUP BY session_id`, like, like, like)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	return scanHermesMessageMatches(rows)
}

func scanHermesMessageMatches(rows *sql.Rows) (map[string]hermesMessageMatch, error) {
	result := map[string]hermesMessageMatch{}
	for rows.Next() {
		var sessionID string
		var count sql.NullInt64
		var snippet sql.NullString
		if err := rows.Scan(&sessionID, &count, &snippet); err != nil {
			return result, err
		}
		result[sessionID] = hermesMessageMatch{
			Count:   nullInt64Value(count),
			Snippet: contentToText(decodeHermesMessageContent(snippet.String)),
		}
	}
	return result, rows.Err()
}

func readHermesSessionMessages(path string, sessionID string) ([]HermesSessionMessage, error) {
	if !pathExists(path) {
		return []HermesSessionMessage{}, nil
	}
	db, err := openHermesStateDBReadOnly(path)
	if err != nil {
		return []HermesSessionMessage{}, err
	}
	defer db.Close()
	if ok, err := sqliteTableExists(db, "messages"); err != nil {
		return []HermesSessionMessage{}, err
	} else if !ok {
		return []HermesSessionMessage{}, nil
	}

	rows, err := db.Query(`
		SELECT id, session_id, role, content, tool_call_id, tool_calls, tool_name,
			timestamp, token_count, finish_reason, reasoning, reasoning_content
		FROM messages
		WHERE session_id = ?
		ORDER BY timestamp, id`, sessionID)
	if err != nil {
		return []HermesSessionMessage{}, err
	}
	defer rows.Close()

	messages := make([]HermesSessionMessage, 0)
	for rows.Next() {
		var message HermesSessionMessage
		var content, toolCallID, toolCalls, toolName, finishReason, reasoning, reasoningContent sql.NullString
		var timestamp sql.NullFloat64
		var tokenCount sql.NullInt64
		if err := rows.Scan(
			&message.ID,
			&message.SessionID,
			&message.Role,
			&content,
			&toolCallID,
			&toolCalls,
			&toolName,
			&timestamp,
			&tokenCount,
			&finishReason,
			&reasoning,
			&reasoningContent,
		); err != nil {
			return []HermesSessionMessage{}, err
		}
		decodedContent := decodeHermesMessageContent(content.String)
		message.Content = decodedContent
		message.Text = contentToText(decodedContent)
		message.ToolCallID = toolCallID.String
		message.ToolCalls = decodeHermesJSONField(toolCalls.String)
		message.ToolName = toolName.String
		message.Timestamp = formatUnixFloat(timestamp)
		message.TokenCount = nullInt64Value(tokenCount)
		message.FinishReason = finishReason.String
		message.Reasoning = reasoning.String
		message.ReasoningContent = reasoningContent.String
		messages = append(messages, message)
	}
	return messages, rows.Err()
}

func deleteHermesSessionFromProfile(target hermesSessionProfileTarget, sessionID string) (bool, error) {
	path := target.Summary.StateDBPath
	if !pathExists(path) {
		return false, nil
	}
	db, err := sql.Open("sqlite", "file:"+path+"?mode=rw")
	if err != nil {
		return false, err
	}
	defer db.Close()
	if _, err := db.Exec("PRAGMA foreign_keys=ON"); err != nil {
		return false, err
	}

	tx, err := db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	var count int
	if err := tx.QueryRow("SELECT COUNT(*) FROM sessions WHERE id = ?", sessionID).Scan(&count); err != nil {
		return false, err
	}
	if count == 0 {
		globalHermesTerminalManager.deleteByHermesSession(target.Summary.Name, sessionID)
		return false, nil
	}
	if _, err := tx.Exec("UPDATE sessions SET parent_session_id = NULL WHERE parent_session_id = ?", sessionID); err != nil {
		return false, err
	}
	if _, err := tx.Exec("DELETE FROM messages WHERE session_id = ?", sessionID); err != nil {
		return false, err
	}
	if _, err := tx.Exec("DELETE FROM sessions WHERE id = ?", sessionID); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	removeHermesSessionFiles(filepath.Join(target.Home, "sessions"), sessionID)
	globalHermesTerminalManager.deleteByHermesSession(target.Summary.Name, sessionID)
	return true, nil
}

func hermesSessionExistsInProfile(target hermesSessionProfileTarget, sessionID string) bool {
	path := target.Summary.StateDBPath
	if !pathExists(path) {
		return false
	}
	db, err := openHermesStateDBReadOnly(path)
	if err != nil {
		return true
	}
	defer db.Close()
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM sessions WHERE id = ?", sessionID).Scan(&count); err != nil {
		return true
	}
	return count > 0
}

func removeHermesSessionFiles(sessionsDir string, sessionID string) {
	if sessionsDir == "" || sessionID == "" {
		return
	}
	for _, suffix := range []string{".json", ".jsonl"} {
		_ = os.Remove(filepath.Join(sessionsDir, sessionID+suffix))
	}
	matches, err := filepath.Glob(filepath.Join(sessionsDir, "request_dump_"+sessionID+"_*.json"))
	if err != nil {
		return
	}
	for _, match := range matches {
		_ = os.Remove(match)
	}
}

func endHermesSessionInProfile(target hermesSessionProfileTarget, sessionID string, reason string) (bool, error) {
	path := target.Summary.StateDBPath
	if !pathExists(path) {
		return false, nil
	}
	db, err := sql.Open("sqlite", "file:"+path+"?mode=rw")
	if err != nil {
		return false, err
	}
	defer db.Close()

	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM sessions WHERE id = ?", sessionID).Scan(&count); err != nil {
		return false, err
	}
	if count == 0 {
		return false, nil
	}
	endedAt := float64(time.Now().UnixNano()) / 1_000_000_000
	_, err = db.Exec(
		"UPDATE sessions SET ended_at = COALESCE(ended_at, ?), end_reason = COALESCE(NULLIF(end_reason, ''), ?) WHERE id = ?",
		endedAt,
		reason,
		sessionID,
	)
	return true, err
}

func terminateHermesSessionProcesses(ctx context.Context, target hermesSessionProfileTarget, sessionID string) int {
	processes, err := readHermesRuntimeProcesses(ctx, filepath.Join(target.Home, "processes.json"))
	if err != nil {
		return 0
	}
	signalled := 0
	seen := map[int]bool{}
	for _, process := range processes {
		if process.Status != "running" || process.PID <= 0 || seen[process.PID] {
			continue
		}
		if sessionID != strings.TrimSpace(process.SessionID) && sessionID != strings.TrimSpace(process.SessionKey) && sessionID != strings.TrimSpace(process.TaskID) {
			continue
		}
		osProcess, err := os.FindProcess(process.PID)
		if err != nil {
			continue
		}
		seen[process.PID] = true
		if err := osProcess.Signal(os.Interrupt); err == nil {
			signalled++
		}
		go func(proc *os.Process) {
			time.Sleep(1200 * time.Millisecond)
			_ = proc.Kill()
		}(osProcess)
	}
	return signalled
}

func readHermesActiveSessionRefs(ctx context.Context, path string) map[string][]string {
	refs := map[string][]string{}
	processes, err := readHermesRuntimeProcesses(ctx, path)
	if err != nil {
		return refs
	}
	for _, process := range processes {
		if process.Status != "running" {
			continue
		}
		for _, id := range []string{process.SessionID, process.SessionKey, process.TaskID} {
			id = strings.TrimSpace(id)
			if id == "" {
				continue
			}
			refs[id] = append(refs[id], firstNonEmpty(process.SessionID, process.SessionKey, process.TaskID))
		}
	}
	for sessionID, terminalIDs := range globalHermesTerminalManager.activeHermesSessionRefs(path) {
		refs[sessionID] = append(refs[sessionID], terminalIDs...)
	}
	return refs
}

func sortHermesManagedSessions(sessions []HermesManagedSession, sortBy string, sortDir string) {
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
			compare = compareInt64(left.MessageCount, right.MessageCount)
		case "cost", "costusd":
			compare = compareFloat64(floatFromPtr(left.CostUSD), floatFromPtr(right.CostUSD))
		case "tokens", "totaltokens":
			compare = compareInt64(left.TotalTokens, right.TotalTokens)
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

func summarizeHermesSessions(sessions []HermesManagedSession, profileCount int) HermesSessionsSummary {
	summary := HermesSessionsSummary{TotalMatched: len(sessions), Profiles: profileCount}
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
		summary.TotalCostUSD += floatFromPtr(session.CostUSD)
	}
	return summary
}

func filterHermesSessions(sessions []HermesManagedSession, keep func(HermesManagedSession) bool) []HermesManagedSession {
	filtered := sessions[:0]
	for _, session := range sessions {
		if keep(session) {
			filtered = append(filtered, session)
		}
	}
	return filtered
}

func sqliteTableExists(db *sql.DB, name string) (bool, error) {
	var tableName string
	err := db.QueryRow("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?", name).Scan(&tableName)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func openHermesStateDBReadOnly(path string) (*sql.DB, error) {
	return sql.Open("sqlite", "file:"+path+"?mode=ro")
}

func decodeHermesMessageContent(content string) any {
	if strings.HasPrefix(content, hermesContentJSONPrefix) {
		var value any
		if err := json.Unmarshal([]byte(strings.TrimPrefix(content, hermesContentJSONPrefix)), &value); err == nil {
			return value
		}
	}
	return content
}

func decodeHermesJSONField(content string) any {
	if strings.TrimSpace(content) == "" {
		return nil
	}
	var value any
	if err := json.Unmarshal([]byte(content), &value); err == nil {
		return value
	}
	return content
}

func contentToText(content any) string {
	switch typed := content.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typed)
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := contentToText(item); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	case map[string]any:
		for _, key := range []string{"text", "content", "value", "input"} {
			if value, ok := typed[key]; ok {
				if text := contentToText(value); text != "" {
					return text
				}
			}
		}
		encoded, err := json.Marshal(typed)
		if err != nil {
			return ""
		}
		return string(encoded)
	default:
		return strings.TrimSpace(stringFromAny(typed))
	}
}

func truncateHermesText(text string, limit int) string {
	text = strings.Join(strings.Fields(strings.TrimSpace(text)), " ")
	if limit <= 0 || len([]rune(text)) <= limit {
		return text
	}
	runes := []rune(text)
	return string(runes[:limit]) + "..."
}

func escapeSQLLike(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `%`, `\%`)
	value = strings.ReplaceAll(value, `_`, `\_`)
	return value
}

func firstValidInt64(values ...sql.NullInt64) int64 {
	for _, value := range values {
		if value.Valid {
			return value.Int64
		}
	}
	return 0
}

func nullInt64Value(value sql.NullInt64) int64 {
	if value.Valid {
		return value.Int64
	}
	return 0
}

func floatFromPtr(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}

func compareInt64(left int64, right int64) int {
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func compareFloat64(left float64, right float64) int {
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}
