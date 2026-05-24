package hermes

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type HermesInstancesInput struct {
	Limit   int    `query:"limit" minimum:"1" maximum:"200" doc:"Maximum number of recent sessions to return." example:"50"`
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
}

type HermesInstancesOutput struct {
	Body HermesInstancesResponse
}

type HermesInstancesResponse struct {
	Status              string                 `json:"status" example:"ok" doc:"Operation status."`
	Timestamp           string                 `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	HomePath            string                 `json:"homePath" example:"/Users/one/.hermes" doc:"Hermes home directory used for instance discovery."`
	GatewayStatePath    string                 `json:"gatewayStatePath" example:"/Users/one/.hermes/gateway_state.json" doc:"Gateway state file path."`
	ProcessRegistryPath string                 `json:"processRegistryPath" example:"/Users/one/.hermes/processes.json" doc:"Background process checkpoint path."`
	StateDBPath         string                 `json:"stateDbPath" example:"/Users/one/.hermes/state.db" doc:"Hermes state database path."`
	Summary             HermesInstancesSummary `json:"summary" doc:"Aggregated instance counts."`
	Active              HermesActiveAgentsInfo `json:"active" doc:"Active agent count reported by gateway_state.json."`
	Processes           []HermesRuntimeProcess `json:"processes" doc:"Background processes recovered from Hermes processes.json."`
	Sessions            []HermesSessionInfo    `json:"sessions" doc:"Recent top-level Hermes sessions from state.db."`
	SourceNote          string                 `json:"sourceNote" doc:"Data source limitation note."`
	Errors              []string               `json:"errors,omitempty" doc:"Non-fatal discovery errors."`
}

type HermesInstancesSummary struct {
	ActiveAgents     int `json:"activeAgents" example:"1" doc:"Active agent count from gateway_state.json."`
	RunningProcesses int `json:"runningProcesses" example:"2" doc:"Running background process count."`
	TotalProcesses   int `json:"totalProcesses" example:"3" doc:"Total process records returned."`
	RecentSessions   int `json:"recentSessions" example:"12" doc:"Recent session count returned."`
}

type HermesActiveAgentsInfo struct {
	Count        int    `json:"count" example:"1" doc:"Active agent count from gateway_state.json."`
	GatewayState string `json:"gatewayState,omitempty" example:"running" doc:"Gateway state from gateway_state.json."`
	UpdatedAt    string `json:"updatedAt,omitempty" example:"2026-05-16T01:30:00Z" doc:"Gateway state update time."`
	Source       string `json:"source" example:"gateway_state" doc:"Source of active agent information."`
}

type HermesRuntimeProcess struct {
	SessionID        string             `json:"sessionId" example:"proc_abc123" doc:"Hermes process registry session id."`
	Command          string             `json:"command" example:"npm run dev" doc:"Tracked command."`
	PID              int                `json:"pid,omitempty" example:"12345" doc:"Host process id when available."`
	PIDScope         string             `json:"pidScope,omitempty" example:"host" doc:"PID scope from checkpoint."`
	CWD              string             `json:"cwd,omitempty" example:"/Users/one/project" doc:"Working directory."`
	StartedAt        string             `json:"startedAt,omitempty" example:"2026-05-16T01:30:00Z" doc:"Process start time."`
	UptimeSeconds    int64              `json:"uptimeSeconds,omitempty" example:"120" doc:"Process uptime in seconds."`
	Status           string             `json:"status" example:"running" doc:"Best-effort runtime status."`
	TaskID           string             `json:"taskId,omitempty" doc:"Hermes task id."`
	SessionKey       string             `json:"sessionKey,omitempty" doc:"Gateway session key."`
	WatcherPlatform  string             `json:"watcherPlatform,omitempty" doc:"Watcher platform when configured."`
	WatcherThreadID  string             `json:"watcherThreadId,omitempty" doc:"Watcher thread id when configured."`
	WatcherInterval  int                `json:"watcherInterval,omitempty" doc:"Watcher interval when configured."`
	NotifyOnComplete bool               `json:"notifyOnComplete" doc:"Whether Hermes should notify when the process completes."`
	WatchPatterns    []string           `json:"watchPatterns,omitempty" doc:"Configured watch patterns."`
	Process          *HermesProcessInfo `json:"process,omitempty" doc:"Host process snapshot when PID is available."`
}

type HermesSessionInfo struct {
	ID               string   `json:"id" example:"019e..." doc:"Hermes session id."`
	Source           string   `json:"source,omitempty" doc:"Session source."`
	Platform         string   `json:"platform,omitempty" doc:"Best-effort platform parsed from source."`
	UserID           string   `json:"userId,omitempty" doc:"User id when recorded."`
	Model            string   `json:"model,omitempty" doc:"Model name."`
	Title            string   `json:"title,omitempty" doc:"Session title."`
	StartedAt        string   `json:"startedAt,omitempty" doc:"Session start time."`
	EndedAt          string   `json:"endedAt,omitempty" doc:"Session end time."`
	EndReason        string   `json:"endReason,omitempty" doc:"Session end reason."`
	LastActiveAt     string   `json:"lastActiveAt,omitempty" doc:"Last message timestamp or started_at."`
	MessageCount     int64    `json:"messageCount" doc:"Message count."`
	ToolCallCount    int64    `json:"toolCallCount" doc:"Tool call count."`
	InputTokens      int64    `json:"inputTokens" doc:"Input token count."`
	OutputTokens     int64    `json:"outputTokens" doc:"Output token count."`
	ReasoningTokens  int64    `json:"reasoningTokens" doc:"Reasoning token count."`
	EstimatedCostUSD *float64 `json:"estimatedCostUsd,omitempty" doc:"Estimated cost in USD."`
	ActualCostUSD    *float64 `json:"actualCostUsd,omitempty" doc:"Actual cost in USD."`
	CostStatus       string   `json:"costStatus,omitempty" doc:"Cost status."`
	HandoffState     string   `json:"handoffState,omitempty" doc:"Handoff state."`
	HandoffPlatform  string   `json:"handoffPlatform,omitempty" doc:"Handoff platform."`
	HandoffError     string   `json:"handoffError,omitempty" doc:"Handoff error."`
}

type hermesProcessCheckpoint struct {
	SessionID        string   `json:"session_id"`
	Command          string   `json:"command"`
	PID              int      `json:"pid"`
	PIDScope         string   `json:"pid_scope"`
	CWD              string   `json:"cwd"`
	StartedAt        float64  `json:"started_at"`
	TaskID           string   `json:"task_id"`
	SessionKey       string   `json:"session_key"`
	WatcherPlatform  string   `json:"watcher_platform"`
	WatcherThreadID  string   `json:"watcher_thread_id"`
	WatcherInterval  int      `json:"watcher_interval"`
	NotifyOnComplete bool     `json:"notify_on_complete"`
	WatchPatterns    []string `json:"watch_patterns"`
}

func HermesInstances(ctx context.Context, input *HermesInstancesInput) (*HermesInstancesOutput, error) {
	if input == nil {
		input = &HermesInstancesInput{}
	}
	limit := input.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	profile, err := resolveHermesProfileSelection(input.Profile)
	if err != nil {
		return nil, err
	}
	home := profile.Path
	gatewayStatePath := filepath.Join(home, "gateway_state.json")
	processRegistryPath := filepath.Join(home, "processes.json")
	stateDBPath := filepath.Join(home, "state.db")
	errorsList := make([]string, 0, 3)

	active, err := readHermesActiveAgents(gatewayStatePath)
	if err != nil {
		errorsList = append(errorsList, "gateway_state.json: "+err.Error())
	}

	processes, err := readHermesRuntimeProcesses(ctx, processRegistryPath)
	if err != nil {
		errorsList = append(errorsList, "processes.json: "+err.Error())
	}

	sessions, err := readHermesRecentSessions(stateDBPath, limit)
	if err != nil {
		errorsList = append(errorsList, "state.db: "+err.Error())
	}

	runningProcesses := 0
	for _, process := range processes {
		if process.Status == "running" {
			runningProcesses++
		}
	}

	status := "ok"
	if len(errorsList) > 0 {
		status = "partial"
	}

	return &HermesInstancesOutput{Body: HermesInstancesResponse{
		Status:              status,
		Timestamp:           time.Now().UTC().Format(time.RFC3339),
		HomePath:            home,
		GatewayStatePath:    gatewayStatePath,
		ProcessRegistryPath: processRegistryPath,
		StateDBPath:         stateDBPath,
		Summary: HermesInstancesSummary{
			ActiveAgents:     active.Count,
			RunningProcesses: runningProcesses,
			TotalProcesses:   len(processes),
			RecentSessions:   len(sessions),
		},
		Active:     active,
		Processes:  processes,
		Sessions:   sessions,
		SourceNote: "active agent details are limited to gateway_state.json until Hermes exposes a runtime agent API",
		Errors:     errorsList,
	}}, nil
}

func readHermesActiveAgents(path string) (HermesActiveAgentsInfo, error) {
	info := HermesActiveAgentsInfo{Source: "gateway_state"}
	content, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return info, nil
		}
		return info, err
	}

	var state hermesGatewayStateFile
	if err := json.Unmarshal(content, &state); err != nil {
		return info, err
	}
	info.Count = state.ActiveAgents
	info.GatewayState = state.GatewayState
	info.UpdatedAt = state.UpdatedAt
	return info, nil
}

func readHermesRuntimeProcesses(ctx context.Context, path string) ([]HermesRuntimeProcess, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []HermesRuntimeProcess{}, nil
		}
		return []HermesRuntimeProcess{}, err
	}
	if len(strings.TrimSpace(string(content))) == 0 {
		return []HermesRuntimeProcess{}, nil
	}

	var entries []hermesProcessCheckpoint
	if err := json.Unmarshal(content, &entries); err != nil {
		return []HermesRuntimeProcess{}, err
	}

	processes := make([]HermesRuntimeProcess, 0, len(entries))
	now := time.Now()
	for _, entry := range entries {
		startedAt := unixFloatToTime(entry.StartedAt)
		process := HermesRuntimeProcess{
			SessionID:        entry.SessionID,
			Command:          entry.Command,
			PID:              entry.PID,
			PIDScope:         entry.PIDScope,
			CWD:              entry.CWD,
			TaskID:           entry.TaskID,
			SessionKey:       entry.SessionKey,
			WatcherPlatform:  entry.WatcherPlatform,
			WatcherThreadID:  entry.WatcherThreadID,
			WatcherInterval:  entry.WatcherInterval,
			NotifyOnComplete: entry.NotifyOnComplete,
			WatchPatterns:    entry.WatchPatterns,
			Status:           "unknown",
		}
		if !startedAt.IsZero() {
			process.StartedAt = startedAt.Format(time.RFC3339)
			process.UptimeSeconds = int64(now.Sub(startedAt).Seconds())
		}
		if entry.PID > 0 && firstNonEmpty(entry.PIDScope, "host") == "host" {
			process.Process = detectHermesProcess(ctx, entry.PID)
			if process.Process.Detected {
				process.Status = "running"
			} else {
				process.Status = "missing"
			}
		}
		processes = append(processes, process)
	}

	sort.SliceStable(processes, func(i, j int) bool {
		return processes[i].StartedAt > processes[j].StartedAt
	})
	return processes, nil
}

func readHermesRecentSessions(path string, limit int) ([]HermesSessionInfo, error) {
	if !pathExists(path) {
		return []HermesSessionInfo{}, nil
	}

	db, err := openHermesStateDBReadOnly(path)
	if err != nil {
		return []HermesSessionInfo{}, err
	}
	defer db.Close()

	var tableName string
	if err := db.QueryRow("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").Scan(&tableName); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return []HermesSessionInfo{}, nil
		}
		return []HermesSessionInfo{}, err
	}

	rows, err := db.Query(`
		SELECT
			s.id,
			s.source,
			s.user_id,
			s.model,
			s.title,
			s.started_at,
			s.ended_at,
			s.end_reason,
			s.message_count,
			s.tool_call_count,
			s.input_tokens,
			s.output_tokens,
			s.reasoning_tokens,
			s.estimated_cost_usd,
			s.actual_cost_usd,
			s.cost_status,
			s.handoff_state,
			s.handoff_platform,
			s.handoff_error,
			COALESCE(MAX(m.timestamp), s.started_at) AS last_active
		FROM sessions s
		LEFT JOIN messages m ON m.session_id = s.id
		WHERE s.parent_session_id IS NULL
		GROUP BY s.id
		ORDER BY last_active DESC
		LIMIT ?`, limit)
	if err != nil {
		return []HermesSessionInfo{}, err
	}
	defer rows.Close()

	sessions := make([]HermesSessionInfo, 0, limit)
	for rows.Next() {
		var session HermesSessionInfo
		var source, userID, model, title, endReason, costStatus sql.NullString
		var handoffState, handoffPlatform, handoffError sql.NullString
		var startedAt, endedAt, lastActive sql.NullFloat64
		var estimatedCost, actualCost sql.NullFloat64

		if err := rows.Scan(
			&session.ID,
			&source,
			&userID,
			&model,
			&title,
			&startedAt,
			&endedAt,
			&endReason,
			&session.MessageCount,
			&session.ToolCallCount,
			&session.InputTokens,
			&session.OutputTokens,
			&session.ReasoningTokens,
			&estimatedCost,
			&actualCost,
			&costStatus,
			&handoffState,
			&handoffPlatform,
			&handoffError,
			&lastActive,
		); err != nil {
			return []HermesSessionInfo{}, err
		}

		session.Source = source.String
		session.Platform = parseHermesSessionPlatform(source.String)
		session.UserID = userID.String
		session.Model = model.String
		session.Title = title.String
		session.StartedAt = formatUnixFloat(startedAt)
		session.EndedAt = formatUnixFloat(endedAt)
		session.EndReason = endReason.String
		session.LastActiveAt = formatUnixFloat(lastActive)
		if estimatedCost.Valid {
			value := estimatedCost.Float64
			session.EstimatedCostUSD = &value
		}
		if actualCost.Valid {
			value := actualCost.Float64
			session.ActualCostUSD = &value
		}
		session.CostStatus = costStatus.String
		session.HandoffState = handoffState.String
		session.HandoffPlatform = handoffPlatform.String
		session.HandoffError = handoffError.String

		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		return []HermesSessionInfo{}, err
	}
	return sessions, nil
}

func formatUnixFloat(value sql.NullFloat64) string {
	if !value.Valid {
		return ""
	}
	parsed := unixFloatToTime(value.Float64)
	if parsed.IsZero() {
		return ""
	}
	return parsed.Format(time.RFC3339)
}

func unixFloatToTime(value float64) time.Time {
	if value <= 0 || math.IsNaN(value) || math.IsInf(value, 0) {
		return time.Time{}
	}
	seconds, fraction := math.Modf(value)
	return time.Unix(int64(seconds), int64(fraction*1_000_000_000)).UTC()
}

func parseHermesSessionPlatform(source string) string {
	source = strings.TrimSpace(source)
	if source == "" {
		return ""
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(source), &payload); err == nil {
		for _, key := range []string{"platform", "type", "source"} {
			if value, ok := payload[key].(string); ok && strings.TrimSpace(value) != "" {
				return strings.TrimSpace(value)
			}
		}
	}
	if before, _, ok := strings.Cut(source, ":"); ok {
		return strings.TrimSpace(before)
	}
	return source
}
