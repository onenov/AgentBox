package ccconnect

import (
	"bufio"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/danielgtaylor/huma/v2"
	"nhooyr.io/websocket"
)

const (
	ccConnectTerminalScrollbackLimit = 400
	ccConnectTerminalDefaultCols     = 120
	ccConnectTerminalDefaultRows     = 32
)

const ccConnectTerminalSessionsSchema = `
CREATE TABLE IF NOT EXISTS cc_connect_terminal_sessions (
	id TEXT PRIMARY KEY,
	status TEXT NOT NULL,
	project_name TEXT NOT NULL,
	project_path TEXT NOT NULL,
	agent_type TEXT NOT NULL,
	argv_json TEXT NOT NULL DEFAULT '[]',
	command TEXT NOT NULL,
	kind TEXT NOT NULL,
	cwd TEXT NOT NULL,
	pid INTEGER NOT NULL DEFAULT 0,
	exit_code INTEGER,
	error TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	exited_at TEXT,
	cols INTEGER NOT NULL DEFAULT 120,
	rows INTEGER NOT NULL DEFAULT 32,
	resume_session_id TEXT NOT NULL DEFAULT '',
	scrollback_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_cc_connect_terminal_sessions_project_updated
	ON cc_connect_terminal_sessions(project_name, updated_at DESC);
`

var ccConnectTerminalOSC11Pattern = regexp.MustCompile(`\x1b\]11;[^\x07\x1b]*(?:\x07|\x1b\\)`)
var ccConnectTerminalOSC11LoosePattern = regexp.MustCompile(`\]11;rgb:[0-9A-Fa-f/]+`)

type CCConnectTerminalListInput struct {
	Project string `query:"project,omitempty" doc:"CC-Connect project name. Empty returns all terminal sessions." example:"my-project"`
}

type CCConnectTerminalCreateInput struct {
	Body CCConnectTerminalCreateRequest
}

type CCConnectAgentEnginesInput struct{}

type CCConnectTerminalGetInput struct {
	ID string `path:"id" doc:"Terminal session id."`
}

type CCConnectTerminalStopInput struct {
	ID string `path:"id" doc:"Terminal session id."`
}

type CCConnectTerminalDeleteRecordInput struct {
	ID string `path:"id" doc:"Terminal session id."`
}

type CCConnectTerminalCreateRequest struct {
	Project         string `json:"project,omitempty" doc:"CC-Connect project name. Empty uses the first configured non-default project." example:"project-2"`
	AgentType       string `json:"agentType,omitempty" enum:"claudecode,codex,gemini,opencode,qoder" doc:"Agent CLI to launch. Empty uses the project agent type." example:"codex"`
	Command         string `json:"command,omitempty" enum:"interactive,continue,resume,list-sessions" doc:"Allowed terminal command template." example:"interactive"`
	ResumeSessionID string `json:"resumeSessionId,omitempty" doc:"Agent session id to resume." example:"2a401c8b-7ee4-4749-84ef-2134e3201030"`
	CWD             string `json:"cwd,omitempty" doc:"Working directory for the agent process. Empty uses project work_dir."`
	Cols            int    `json:"cols,omitempty" minimum:"20" maximum:"400" example:"120"`
	Rows            int    `json:"rows,omitempty" minimum:"8" maximum:"120" example:"32"`
}

type CCConnectTerminalListOutput struct {
	Body CCConnectTerminalListResponse
}

type CCConnectTerminalOutput struct {
	Body CCConnectTerminalResponse
}

type CCConnectAgentEnginesOutput struct {
	Body CCConnectAgentEnginesResponse
}

type CCConnectAgentEnginesResponse struct {
	Status    string                      `json:"status" example:"ok"`
	Timestamp string                      `json:"timestamp" example:"2026-05-17T00:00:00Z"`
	Engines   []CCConnectAgentEngineInfo  `json:"engines"`
	Summary   CCConnectAgentEngineSummary `json:"summary"`
}

type CCConnectAgentEngineInfo struct {
	Type      string `json:"type" example:"codex" doc:"Agent engine type."`
	Label     string `json:"label" example:"Codex" doc:"Display label."`
	Command   string `json:"command" example:"codex" doc:"Primary executable command."`
	Installed bool   `json:"installed" example:"true" doc:"Whether the engine executable is available on this host."`
	Path      string `json:"path,omitempty" doc:"Resolved executable path."`
	Error     string `json:"error,omitempty" doc:"Detection error when not installed."`
}

type CCConnectAgentEngineSummary struct {
	Total     int `json:"total" example:"5"`
	Installed int `json:"installed" example:"3"`
	Missing   int `json:"missing" example:"2"`
}

type CCConnectTerminalListResponse struct {
	Status    string                      `json:"status" example:"ok"`
	Timestamp string                      `json:"timestamp" example:"2026-05-17T00:00:00Z"`
	Sessions  []CCConnectTerminalResponse `json:"sessions"`
	Summary   CCConnectTerminalSummary    `json:"summary"`
}

type CCConnectTerminalSummary struct {
	Total   int `json:"total" example:"2"`
	Running int `json:"running" example:"1"`
	Exited  int `json:"exited" example:"1"`
}

type CCConnectProjectSelection struct {
	Name      string `json:"name" example:"project-2"`
	Path      string `json:"path" doc:"Project working directory."`
	AgentType string `json:"agentType" example:"codex"`
}

type CCConnectTerminalResponse struct {
	ID         string                    `json:"id" example:"cc-term-abc123"`
	Status     string                    `json:"status" example:"running"`
	Project    CCConnectProjectSelection `json:"project"`
	AgentType  string                    `json:"agentType" example:"codex"`
	Command    string                    `json:"command" example:"codex"`
	Kind       string                    `json:"kind" example:"interactive"`
	CWD        string                    `json:"cwd"`
	PID        int                       `json:"pid,omitempty" example:"12345"`
	ExitCode   *int                      `json:"exitCode,omitempty" example:"0"`
	Error      string                    `json:"error,omitempty"`
	CreatedAt  string                    `json:"createdAt" example:"2026-05-17T00:00:00Z"`
	UpdatedAt  string                    `json:"updatedAt" example:"2026-05-17T00:00:00Z"`
	ExitedAt   string                    `json:"exitedAt,omitempty" example:"2026-05-17T00:05:00Z"`
	Cols       int                       `json:"cols" example:"120"`
	Rows       int                       `json:"rows" example:"32"`
	Attached   int                       `json:"attached" example:"1"`
	SessionID  string                    `json:"sessionId,omitempty" doc:"Agent conversation session id when known."`
	Scrollback []string                  `json:"scrollback,omitempty"`
}

type ccConnectTerminalSession struct {
	id              string
	status          string
	project         CCConnectProjectSelection
	agentType       string
	argv            []string
	command         string
	kind            string
	cwd             string
	pid             int
	exitCode        *int
	errText         string
	createdAt       time.Time
	updatedAt       time.Time
	exitedAt        *time.Time
	cols            int
	rows            int
	resumeSessionID string
	deleted         bool

	cmd        *exec.Cmd
	ptyFile    *os.File
	cancel     context.CancelFunc
	clients    map[*websocket.Conn]struct{}
	scrollback []string
	mu         sync.Mutex
	manager    *ccConnectTerminalManager
}

type ccConnectTerminalManager struct {
	mu       sync.Mutex
	sessions map[string]*ccConnectTerminalSession
	db       *sql.DB
}

type ccConnectTerminalSessionRecord struct {
	id              string
	status          string
	project         CCConnectProjectSelection
	agentType       string
	argv            []string
	command         string
	kind            string
	cwd             string
	pid             int
	exitCode        *int
	errText         string
	createdAt       time.Time
	updatedAt       time.Time
	exitedAt        *time.Time
	cols            int
	rows            int
	resumeSessionID string
	scrollback      []string
	argvJSON        string
	scrollbackJSON  string
}

var globalCCConnectTerminalManager = &ccConnectTerminalManager{sessions: map[string]*ccConnectTerminalSession{}}

func ConfigureCCConnectTerminalStore(db *sql.DB) error {
	return globalCCConnectTerminalManager.configureStore(db)
}

func RebuildCCConnectTerminalStore(db *sql.DB) error {
	globalCCConnectTerminalManager.clearAll()
	return globalCCConnectTerminalManager.configureStore(db)
}

func ListCCConnectTerminals(ctx context.Context, input *CCConnectTerminalListInput) (*CCConnectTerminalListOutput, error) {
	project := ""
	if input != nil {
		project = strings.TrimSpace(input.Project)
	}
	globalCCConnectTerminalManager.pruneMissingCCConnectSessionReferences(ctx, project)
	sessions := globalCCConnectTerminalManager.list(project)
	summary := CCConnectTerminalSummary{Total: len(sessions)}
	for _, session := range sessions {
		if session.Status == "running" {
			summary.Running++
		} else {
			summary.Exited++
		}
	}
	return &CCConnectTerminalListOutput{Body: CCConnectTerminalListResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Sessions:  sessions,
		Summary:   summary,
	}}, nil
}

func CreateCCConnectTerminal(ctx context.Context, input *CCConnectTerminalCreateInput) (*CCConnectTerminalOutput, error) {
	if runtime.GOOS == "windows" {
		return nil, huma.Error400BadRequest("CC-Connect Web Terminal is not supported on Windows yet", nil)
	}
	if input == nil {
		input = &CCConnectTerminalCreateInput{}
	}
	session, err := globalCCConnectTerminalManager.create(ctx, input.Body)
	if err != nil {
		return nil, err
	}
	return &CCConnectTerminalOutput{Body: session.response(true)}, nil
}

func GetCCConnectTerminal(ctx context.Context, input *CCConnectTerminalGetInput) (*CCConnectTerminalOutput, error) {
	session := globalCCConnectTerminalManager.get(input.ID)
	if session == nil {
		return nil, huma.Error404NotFound("CC-Connect terminal session not found", nil)
	}
	return &CCConnectTerminalOutput{Body: session.response(true)}, nil
}

func StopCCConnectTerminal(ctx context.Context, input *CCConnectTerminalStopInput) (*CCConnectTerminalOutput, error) {
	session := globalCCConnectTerminalManager.get(input.ID)
	if session == nil {
		return nil, huma.Error404NotFound("CC-Connect terminal session not found", nil)
	}
	session.stop()
	return &CCConnectTerminalOutput{Body: session.response(true)}, nil
}

func DeleteCCConnectTerminalRecord(ctx context.Context, input *CCConnectTerminalDeleteRecordInput) (*CCConnectTerminalOutput, error) {
	session := globalCCConnectTerminalManager.get(input.ID)
	if session == nil {
		return nil, huma.Error404NotFound("CC-Connect terminal session not found", nil)
	}
	if session.status == "running" {
		return nil, huma.Error409Conflict("CC-Connect terminal is still running", nil)
	}
	response := session.response(false)
	globalCCConnectTerminalManager.deleteTerminalSessions([]string{session.id})
	_ = ctx
	return &CCConnectTerminalOutput{Body: response}, nil
}

func ListCCConnectAgentEngines(ctx context.Context, input *CCConnectAgentEnginesInput) (*CCConnectAgentEnginesOutput, error) {
	_ = ctx
	_ = input
	engines := make([]CCConnectAgentEngineInfo, 0, len(ccConnectAgentEngineDefinitions()))
	summary := CCConnectAgentEngineSummary{Total: len(ccConnectAgentEngineDefinitions())}
	for _, definition := range ccConnectAgentEngineDefinitions() {
		engine := CCConnectAgentEngineInfo{
			Type:    definition.Type,
			Label:   definition.Label,
			Command: definition.Command,
		}
		if path, err := resolveCCConnectAgentBinary(definition.Type); err == nil && path != "" {
			engine.Installed = true
			engine.Path = path
			summary.Installed++
		} else if err != nil {
			engine.Error = err.Error()
			summary.Missing++
		} else {
			engine.Error = definition.Type + " CLI not found"
			summary.Missing++
		}
		engines = append(engines, engine)
	}
	status := "ok"
	if summary.Installed == 0 {
		status = "missing"
	}
	return &CCConnectAgentEnginesOutput{Body: CCConnectAgentEnginesResponse{
		Status:    status,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Engines:   engines,
		Summary:   summary,
	}}, nil
}

func HandleCCConnectTerminalWebSocket(w http.ResponseWriter, r *http.Request) {
	sessionID := strings.TrimSpace(r.URL.Query().Get("id"))
	if sessionID == "" {
		writeCCConnectAuthErrorLike(w, http.StatusBadRequest, "missing terminal session id")
		return
	}
	session := globalCCConnectTerminalManager.get(sessionID)
	if session == nil {
		writeCCConnectAuthErrorLike(w, http.StatusNotFound, "terminal session not found")
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "closed")

	session.attach(conn)
	defer session.detach(conn)

	ctx := r.Context()
	_ = session.writeFrame(ctx, conn, "snapshot", map[string]any{
		"session":    session.response(false),
		"scrollback": session.snapshotScrollback(),
	})

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		var frame ccConnectTerminalClientFrame
		if err := json.Unmarshal(data, &frame); err != nil {
			_ = session.writeFrame(ctx, conn, "error", map[string]any{"message": "invalid terminal frame"})
			continue
		}
		switch frame.Type {
		case "input":
			if frame.Data != "" {
				if err := session.writeInput(frame.Data); err != nil {
					_ = session.writeFrame(ctx, conn, "error", map[string]any{"message": err.Error()})
				}
			}
		case "resize":
			session.resize(frame.Cols, frame.Rows)
		case "kill":
			session.stop()
		case "ping":
			_ = session.writeFrame(ctx, conn, "pong", map[string]any{"timestamp": time.Now().UTC().Format(time.RFC3339Nano)})
		}
	}
}

type ccConnectTerminalClientFrame struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
}

func (m *ccConnectTerminalManager) configureStore(db *sql.DB) error {
	if db == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, ccConnectTerminalSessionsSchema); err != nil {
		return fmt.Errorf("create cc-connect terminal sessions table: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.ExecContext(ctx, `
UPDATE cc_connect_terminal_sessions
SET status = 'exited',
	updated_at = ?,
	exited_at = COALESCE(exited_at, ?),
	error = CASE WHEN error = '' THEN ? ELSE error END
WHERE status IN ('running', 'stopping')`,
		now,
		now,
		"CC-Connect terminal process was detached when AgentBox restarted",
	); err != nil {
		return fmt.Errorf("mark stale cc-connect terminal sessions exited: %w", err)
	}
	sessions, err := loadCCConnectTerminalSessions(ctx, db)
	if err != nil {
		return err
	}

	m.mu.Lock()
	m.db = db
	m.sessions = map[string]*ccConnectTerminalSession{}
	for _, session := range sessions {
		session.manager = m
		if session.clients == nil {
			session.clients = map[*websocket.Conn]struct{}{}
		}
		m.sessions[session.id] = session
	}
	m.mu.Unlock()
	return nil
}

func (m *ccConnectTerminalManager) list(project string) []CCConnectTerminalResponse {
	m.mu.Lock()
	sessions := make([]*ccConnectTerminalSession, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	m.mu.Unlock()

	sort.SliceStable(sessions, func(i, j int) bool {
		return sessions[i].updatedAt.After(sessions[j].updatedAt)
	})

	responses := make([]CCConnectTerminalResponse, 0, len(sessions))
	for _, session := range sessions {
		if project != "" && session.project.Name != project {
			continue
		}
		responses = append(responses, session.response(false))
	}
	return responses
}

func (m *ccConnectTerminalManager) activeCCConnectSessionRefs(project string, agentType string) map[string][]string {
	project = strings.TrimSpace(project)
	agentType = normalizeCCConnectAgentType(agentType)
	m.mu.Lock()
	sessions := make([]*ccConnectTerminalSession, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	m.mu.Unlock()

	refs := map[string][]string{}
	for _, session := range sessions {
		session.mu.Lock()
		if session.status != "running" ||
			(project != "" && session.project.Name != project) ||
			(agentType != "" && normalizeCCConnectAgentType(session.agentType) != agentType) {
			session.mu.Unlock()
			continue
		}
		sessionID := strings.TrimSpace(session.resumeSessionID)
		terminalID := session.id
		session.mu.Unlock()
		if terminalID != "" {
			refs[terminalID] = append(refs[terminalID], terminalID)
		}
		if sessionID == "" {
			continue
		}
		refs[sessionID] = append(refs[sessionID], terminalID)
	}
	return refs
}

func (m *ccConnectTerminalManager) get(id string) *ccConnectTerminalSession {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[id]
}

func (m *ccConnectTerminalManager) persistSession(session *ccConnectTerminalSession) {
	if session == nil {
		return
	}
	session.mu.Lock()
	deleted := session.deleted
	session.mu.Unlock()
	if deleted {
		return
	}
	m.mu.Lock()
	db := m.db
	m.mu.Unlock()
	if db == nil {
		return
	}
	record, err := session.persistenceRecord()
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, _ = db.ExecContext(ctx, `
INSERT INTO cc_connect_terminal_sessions (
	id, status, project_name, project_path, agent_type, argv_json, command, kind,
	cwd, pid, exit_code, error, created_at, updated_at, exited_at, cols, rows,
	resume_session_id, scrollback_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
	status = excluded.status,
	project_name = excluded.project_name,
	project_path = excluded.project_path,
	agent_type = excluded.agent_type,
	argv_json = excluded.argv_json,
	command = excluded.command,
	kind = excluded.kind,
	cwd = excluded.cwd,
	pid = excluded.pid,
	exit_code = excluded.exit_code,
	error = excluded.error,
	updated_at = excluded.updated_at,
	exited_at = excluded.exited_at,
	cols = excluded.cols,
	rows = excluded.rows,
	resume_session_id = excluded.resume_session_id,
	scrollback_json = excluded.scrollback_json`,
		record.id,
		record.status,
		record.project.Name,
		record.project.Path,
		record.agentType,
		record.argvJSON,
		record.command,
		record.kind,
		record.cwd,
		record.pid,
		ccConnectNullableInt(record.exitCode),
		record.errText,
		record.createdAt.Format(time.RFC3339Nano),
		record.updatedAt.Format(time.RFC3339Nano),
		ccConnectNullableTime(record.exitedAt),
		record.cols,
		record.rows,
		record.resumeSessionID,
		record.scrollbackJSON,
	)
}

func (m *ccConnectTerminalManager) deleteByCCConnectSession(project string, agentType string, sessionID string) int {
	project = strings.TrimSpace(project)
	agentType = normalizeCCConnectAgentType(agentType)
	sessionID = strings.TrimSpace(sessionID)
	if project == "" || sessionID == "" {
		return 0
	}
	m.mu.Lock()
	ids := make([]string, 0)
	for id, session := range m.sessions {
		resumeSessionID := strings.TrimSpace(session.resumeSessionID)
		if session.project.Name != project ||
			(agentType != "" && normalizeCCConnectAgentType(session.agentType) != agentType) ||
			session.status == "running" ||
			(id != sessionID && resumeSessionID != sessionID) {
			continue
		}
		ids = append(ids, id)
	}
	m.mu.Unlock()
	return m.deleteTerminalSessions(ids)
}

func (m *ccConnectTerminalManager) pruneMissingCCConnectSessionReferences(ctx context.Context, project string) {
	m.mu.Lock()
	sessions := make([]*ccConnectTerminalSession, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	m.mu.Unlock()

	ids := make([]string, 0)
	existsCache := map[string]bool{}
	for _, session := range sessions {
		if project != "" && session.project.Name != project {
			continue
		}
		if session.status == "running" || session.resumeSessionID == "" {
			continue
		}
		cacheKey := session.project.Name + "\x00" + session.agentType + "\x00" + session.resumeSessionID
		exists, ok := existsCache[cacheKey]
		if !ok {
			exists = ccConnectSessionExists(ctx, session.project.Name, session.agentType, session.resumeSessionID)
			existsCache[cacheKey] = exists
		}
		if !exists {
			ids = append(ids, session.id)
		}
	}
	m.deleteTerminalSessions(ids)
}

func (m *ccConnectTerminalManager) deleteTerminalSessions(ids []string) int {
	if len(ids) == 0 {
		return 0
	}
	m.mu.Lock()
	db := m.db
	removed := 0
	for _, id := range ids {
		if session, ok := m.sessions[id]; ok {
			session.mu.Lock()
			session.deleted = true
			session.mu.Unlock()
			delete(m.sessions, id)
			removed++
		}
	}
	m.mu.Unlock()

	if db != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		for _, id := range ids {
			_, _ = db.ExecContext(ctx, "DELETE FROM cc_connect_terminal_sessions WHERE id = ?", id)
		}
	}
	return removed
}

func (m *ccConnectTerminalManager) clearAll() int {
	m.mu.Lock()
	db := m.db
	sessions := make([]*ccConnectTerminalSession, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	removed := len(m.sessions)
	m.sessions = map[string]*ccConnectTerminalSession{}
	m.mu.Unlock()

	for _, session := range sessions {
		session.mu.Lock()
		session.deleted = true
		session.mu.Unlock()
		session.stop()
	}

	if db != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_, _ = db.ExecContext(ctx, "DELETE FROM cc_connect_terminal_sessions")
	}
	return removed
}

func (m *ccConnectTerminalManager) create(parent context.Context, request CCConnectTerminalCreateRequest) (*ccConnectTerminalSession, error) {
	project, projectConfig, err := resolveCCConnectProjectSelection(request.Project)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error(), err)
	}
	agentType := normalizeCCConnectAgentType(firstCCConnectString(request.AgentType, project.AgentType, projectConfig.Agent.Type))
	if agentType == "" {
		agentType = "claudecode"
	}
	project.AgentType = agentType
	kind := firstCCConnectString(strings.TrimSpace(request.Command), "interactive")
	resumeSessionID := strings.TrimSpace(request.ResumeSessionID)
	argv, err := ccConnectTerminalArgv(agentType, kind, resumeSessionID)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error(), err)
	}
	cwd := strings.TrimSpace(request.CWD)
	if cwd == "" {
		cwd = projectConfig.Agent.WorkDir
	}
	cwd = expandCCConnectHomePath(cwd)
	if cwd == "" || !pathIsUsableDir(cwd) {
		cwd = project.Path
	}
	if cwd == "" || !pathIsUsableDir(cwd) {
		if home, homeErr := os.UserHomeDir(); homeErr == nil {
			cwd = home
		}
	}
	cols := clampCCConnectInt(request.Cols, ccConnectTerminalDefaultCols, 20, 400)
	rows := clampCCConnectInt(request.Rows, ccConnectTerminalDefaultRows, 8, 120)

	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Dir = cwd
	cmd.Env = os.Environ()
	for key, value := range projectConfig.Agent.Env {
		key = strings.TrimSpace(key)
		if key != "" {
			cmd.Env = append(cmd.Env, key+"="+value)
		}
	}

	ptyFile, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	if err != nil {
		cancel()
		return nil, huma.Error500InternalServerError("start CC-Connect terminal failed", err)
	}

	now := time.Now().UTC()
	session := &ccConnectTerminalSession{
		id:              "cc-term-" + ccConnectRandomHex(8),
		status:          "running",
		project:         project,
		agentType:       agentType,
		argv:            argv,
		command:         strings.Join(argv, " "),
		kind:            kind,
		cwd:             cwd,
		pid:             cmd.Process.Pid,
		createdAt:       now,
		updatedAt:       now,
		cols:            cols,
		rows:            rows,
		resumeSessionID: resumeSessionID,
		cmd:             cmd,
		ptyFile:         ptyFile,
		cancel:          cancel,
		clients:         map[*websocket.Conn]struct{}{},
		manager:         m,
	}

	m.mu.Lock()
	m.sessions[session.id] = session
	m.mu.Unlock()
	m.persistSession(session)

	go session.readLoop()
	go session.waitLoop()

	_ = parent
	return session, nil
}

func loadCCConnectTerminalSessions(ctx context.Context, db *sql.DB) ([]*ccConnectTerminalSession, error) {
	rows, err := db.QueryContext(ctx, `
SELECT id, status, project_name, project_path, agent_type, argv_json, command, kind,
	cwd, pid, exit_code, error, created_at, updated_at, exited_at, cols, rows,
	resume_session_id, scrollback_json
FROM cc_connect_terminal_sessions
ORDER BY updated_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("load cc-connect terminal sessions: %w", err)
	}
	defer rows.Close()

	sessions := []*ccConnectTerminalSession{}
	for rows.Next() {
		var (
			id              string
			status          string
			projectName     string
			projectPath     string
			agentType       string
			argvJSON        string
			command         string
			kind            string
			cwd             string
			pid             int
			exitCode        sql.NullInt64
			errText         string
			createdAtRaw    string
			updatedAtRaw    string
			exitedAtRaw     sql.NullString
			cols            int
			rowsCount       int
			resumeSessionID string
			scrollbackJSON  string
		)
		if err := rows.Scan(
			&id, &status, &projectName, &projectPath, &agentType, &argvJSON, &command,
			&kind, &cwd, &pid, &exitCode, &errText, &createdAtRaw, &updatedAtRaw,
			&exitedAtRaw, &cols, &rowsCount, &resumeSessionID, &scrollbackJSON,
		); err != nil {
			return nil, fmt.Errorf("scan cc-connect terminal session: %w", err)
		}

		argv := []string{}
		_ = json.Unmarshal([]byte(argvJSON), &argv)
		scrollback := []string{}
		_ = json.Unmarshal([]byte(scrollbackJSON), &scrollback)
		createdAt := parseCCConnectTerminalTime(createdAtRaw, time.Now().UTC())
		updatedAt := parseCCConnectTerminalTime(updatedAtRaw, createdAt)
		var exitedAt *time.Time
		if exitedAtRaw.Valid && strings.TrimSpace(exitedAtRaw.String) != "" {
			parsed := parseCCConnectTerminalTime(exitedAtRaw.String, updatedAt)
			exitedAt = &parsed
		}
		var exitCodeValue *int
		if exitCode.Valid {
			code := int(exitCode.Int64)
			exitCodeValue = &code
		}

		sessions = append(sessions, &ccConnectTerminalSession{
			id:              id,
			status:          status,
			project:         CCConnectProjectSelection{Name: projectName, Path: projectPath, AgentType: agentType},
			agentType:       agentType,
			argv:            argv,
			command:         command,
			kind:            kind,
			cwd:             cwd,
			pid:             pid,
			exitCode:        exitCodeValue,
			errText:         errText,
			createdAt:       createdAt,
			updatedAt:       updatedAt,
			exitedAt:        exitedAt,
			cols:            clampCCConnectInt(cols, ccConnectTerminalDefaultCols, 20, 400),
			rows:            clampCCConnectInt(rowsCount, ccConnectTerminalDefaultRows, 8, 120),
			resumeSessionID: resumeSessionID,
			clients:         map[*websocket.Conn]struct{}{},
			scrollback:      scrollback,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate cc-connect terminal sessions: %w", err)
	}
	return sessions, nil
}

func ccConnectTerminalArgv(agentType string, kind string, resumeSessionID string) ([]string, error) {
	agentType = normalizeCCConnectAgentType(agentType)
	kind = strings.TrimSpace(kind)
	if kind == "" {
		kind = "interactive"
	}
	bin, err := resolveCCConnectAgentBinary(agentType)
	if err != nil {
		return nil, err
	}
	switch agentType {
	case "claudecode":
		if resumeSessionID != "" {
			return []string{bin, "--resume", resumeSessionID}, nil
		}
		if kind == "continue" {
			return []string{bin, "--continue"}, nil
		}
		if kind == "list-sessions" {
			return []string{bin, "--resume"}, nil
		}
		return []string{bin}, nil
	case "codex":
		if resumeSessionID != "" {
			return []string{bin, "resume", resumeSessionID}, nil
		}
		if kind == "continue" {
			return []string{bin, "resume", "--last"}, nil
		}
		return []string{bin}, nil
	case "gemini":
		if resumeSessionID != "" {
			return []string{bin, "--resume", resumeSessionID}, nil
		}
		if kind == "continue" {
			return []string{bin, "--resume", "latest"}, nil
		}
		if kind == "list-sessions" {
			return []string{bin, "--list-sessions"}, nil
		}
		return []string{bin}, nil
	case "opencode":
		if resumeSessionID != "" {
			return []string{bin, "--session", resumeSessionID}, nil
		}
		if kind == "continue" {
			return []string{bin, "--continue"}, nil
		}
		if kind == "list-sessions" {
			return []string{bin, "session", "list"}, nil
		}
		return []string{bin}, nil
	case "qoder":
		if resumeSessionID != "" {
			return []string{bin, "--resume", resumeSessionID}, nil
		}
		if kind == "continue" {
			return []string{bin, "--continue"}, nil
		}
		if kind == "list-sessions" {
			return []string{bin, "--list-sessions"}, nil
		}
		return []string{bin}, nil
	default:
		return nil, fmt.Errorf("unsupported CC-Connect agent type: %s", agentType)
	}
}

type ccConnectAgentEngineDefinition struct {
	Type    string
	Label   string
	Command string
}

func ccConnectAgentEngineDefinitions() []ccConnectAgentEngineDefinition {
	return []ccConnectAgentEngineDefinition{
		{Type: "claudecode", Label: "Claude Code", Command: "claude"},
		{Type: "codex", Label: "Codex", Command: "codex"},
		{Type: "gemini", Label: "Gemini", Command: "gemini"},
		{Type: "opencode", Label: "OpenCode", Command: "opencode"},
		{Type: "qoder", Label: "Qoder", Command: "qoder"},
	}
}

func isSupportedCCConnectAgentType(agentType string) bool {
	normalized := normalizeCCConnectAgentType(agentType)
	for _, definition := range ccConnectAgentEngineDefinitions() {
		if definition.Type == normalized {
			return true
		}
	}
	return false
}

func resolveCCConnectAgentBinary(agentType string) (string, error) {
	candidates := map[string][]string{
		"claudecode": {"claude"},
		"codex":      {"codex"},
		"gemini":     {"gemini"},
		"opencode":   {"opencode"},
		"qoder":      {"qoder", "qodercli"},
	}
	names := candidates[normalizeCCConnectAgentType(agentType)]
	if len(names) == 0 {
		return "", fmt.Errorf("unsupported CC-Connect agent type: %s", agentType)
	}
	for _, name := range names {
		if path, err := exec.LookPath(name); err == nil && path != "" {
			return path, nil
		}
	}
	if normalizeCCConnectAgentType(agentType) == "qoder" {
		if home, err := os.UserHomeDir(); err == nil {
			matches, _ := filepath.Glob(filepath.Join(home, ".qoder", "bin", "qodercli", "qodercli-*"))
			sort.Strings(matches)
			for i := len(matches) - 1; i >= 0; i-- {
				if info, err := os.Stat(matches[i]); err == nil && !info.IsDir() && info.Mode()&0o111 != 0 {
					return matches[i], nil
				}
			}
		}
	}
	return "", fmt.Errorf("%s CLI not found", agentType)
}

func (s *ccConnectTerminalSession) readLoop() {
	reader := bufio.NewReader(s.ptyFile)
	buffer := make([]byte, 4096)
	for {
		n, err := reader.Read(buffer)
		if n > 0 {
			chunk := sanitizeCCConnectTerminalChunk(string(buffer[:n]))
			if chunk != "" {
				s.appendScrollback(chunk)
				s.broadcast("output", map[string]any{"data": chunk})
			}
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				s.setError(err)
			}
			return
		}
	}
}

func (s *ccConnectTerminalSession) waitLoop() {
	err := s.cmd.Wait()
	now := time.Now().UTC()
	s.mu.Lock()
	if s.status == "running" || s.status == "stopping" {
		s.status = "exited"
	}
	s.updatedAt = now
	s.exitedAt = &now
	if err != nil {
		s.errText = err.Error()
	}
	if s.cmd.ProcessState != nil {
		code := s.cmd.ProcessState.ExitCode()
		s.exitCode = &code
	}
	s.mu.Unlock()
	s.persist()
	s.broadcast("exit", map[string]any{"session": s.response(false)})
	_ = s.ptyFile.Close()
}

func (s *ccConnectTerminalSession) persistenceRecord() (ccConnectTerminalSessionRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	argv := append([]string{}, s.argv...)
	scrollback := append([]string{}, s.scrollback...)
	argvJSON, err := json.Marshal(argv)
	if err != nil {
		return ccConnectTerminalSessionRecord{}, err
	}
	scrollbackJSON, err := json.Marshal(scrollback)
	if err != nil {
		return ccConnectTerminalSessionRecord{}, err
	}
	return ccConnectTerminalSessionRecord{
		id:              s.id,
		status:          s.status,
		project:         s.project,
		agentType:       s.agentType,
		argv:            argv,
		command:         s.command,
		kind:            s.kind,
		cwd:             s.cwd,
		pid:             s.pid,
		exitCode:        cloneCCConnectIntPointer(s.exitCode),
		errText:         s.errText,
		createdAt:       s.createdAt,
		updatedAt:       s.updatedAt,
		exitedAt:        cloneCCConnectTimePointer(s.exitedAt),
		cols:            s.cols,
		rows:            s.rows,
		resumeSessionID: s.resumeSessionID,
		scrollback:      scrollback,
		argvJSON:        string(argvJSON),
		scrollbackJSON:  string(scrollbackJSON),
	}, nil
}

func (s *ccConnectTerminalSession) persist() {
	manager := s.manager
	if manager == nil {
		manager = globalCCConnectTerminalManager
	}
	manager.persistSession(s)
}

func (s *ccConnectTerminalSession) response(includeScrollback bool) CCConnectTerminalResponse {
	s.mu.Lock()
	defer s.mu.Unlock()
	response := CCConnectTerminalResponse{
		ID:        s.id,
		Status:    s.status,
		Project:   s.project,
		AgentType: s.agentType,
		Command:   s.command,
		Kind:      s.kind,
		CWD:       s.cwd,
		PID:       s.pid,
		ExitCode:  s.exitCode,
		Error:     s.errText,
		CreatedAt: s.createdAt.Format(time.RFC3339Nano),
		UpdatedAt: s.updatedAt.Format(time.RFC3339Nano),
		Cols:      s.cols,
		Rows:      s.rows,
		Attached:  len(s.clients),
		SessionID: s.resumeSessionID,
	}
	if s.exitedAt != nil {
		response.ExitedAt = s.exitedAt.Format(time.RFC3339Nano)
	}
	if includeScrollback {
		response.Scrollback = append([]string{}, s.scrollback...)
	}
	return response
}

func (s *ccConnectTerminalSession) attach(conn *websocket.Conn) {
	s.mu.Lock()
	s.clients[conn] = struct{}{}
	s.updatedAt = time.Now().UTC()
	s.mu.Unlock()
	s.broadcast("status", map[string]any{"session": s.response(false)})
}

func (s *ccConnectTerminalSession) detach(conn *websocket.Conn) {
	s.mu.Lock()
	delete(s.clients, conn)
	s.updatedAt = time.Now().UTC()
	s.mu.Unlock()
	s.broadcast("status", map[string]any{"session": s.response(false)})
}

func (s *ccConnectTerminalSession) snapshotScrollback() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	scrollback := make([]string, 0, len(s.scrollback))
	for _, chunk := range s.scrollback {
		if cleaned := sanitizeCCConnectTerminalChunk(chunk); cleaned != "" {
			scrollback = append(scrollback, cleaned)
		}
	}
	return scrollback
}

func (s *ccConnectTerminalSession) appendScrollback(chunk string) {
	s.mu.Lock()
	s.scrollback = append(s.scrollback, chunk)
	if extra := len(s.scrollback) - ccConnectTerminalScrollbackLimit; extra > 0 {
		s.scrollback = append([]string{}, s.scrollback[extra:]...)
	}
	s.updatedAt = time.Now().UTC()
	s.mu.Unlock()
	s.persist()
}

func sanitizeCCConnectTerminalChunk(chunk string) string {
	chunk = ccConnectTerminalOSC11Pattern.ReplaceAllString(chunk, "")
	chunk = ccConnectTerminalOSC11LoosePattern.ReplaceAllString(chunk, "")
	return chunk
}

func (s *ccConnectTerminalSession) writeInput(data string) error {
	s.mu.Lock()
	status := s.status
	file := s.ptyFile
	s.mu.Unlock()
	if status != "running" {
		return errors.New("terminal session is not running")
	}
	if file == nil {
		return errors.New("terminal session process is not attached")
	}
	_, err := file.Write([]byte(data))
	return err
}

func (s *ccConnectTerminalSession) resize(cols int, rows int) {
	cols = clampCCConnectInt(cols, s.cols, 20, 400)
	rows = clampCCConnectInt(rows, s.rows, 8, 120)
	s.mu.Lock()
	s.cols = cols
	s.rows = rows
	file := s.ptyFile
	s.updatedAt = time.Now().UTC()
	s.mu.Unlock()
	if file != nil {
		_ = pty.Setsize(file, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	}
	s.persist()
	s.broadcast("status", map[string]any{"session": s.response(false)})
}

func (s *ccConnectTerminalSession) stop() {
	s.mu.Lock()
	if s.status != "running" {
		s.mu.Unlock()
		return
	}
	cancel := s.cancel
	var process *os.Process
	if s.cmd != nil {
		process = s.cmd.Process
	}
	s.status = "stopping"
	s.updatedAt = time.Now().UTC()
	s.mu.Unlock()
	s.persist()
	s.broadcast("status", map[string]any{"session": s.response(false)})
	if cancel != nil {
		cancel()
	}
	if process != nil {
		_ = process.Signal(os.Interrupt)
		go func() {
			time.Sleep(1200 * time.Millisecond)
			if s.response(false).Status == "stopping" {
				_ = process.Kill()
			}
		}()
	}
}

func (s *ccConnectTerminalSession) setError(err error) {
	s.mu.Lock()
	if s.errText == "" {
		s.errText = err.Error()
	}
	s.updatedAt = time.Now().UTC()
	s.mu.Unlock()
	s.persist()
}

func (s *ccConnectTerminalSession) broadcast(kind string, payload any) {
	s.mu.Lock()
	clients := make([]*websocket.Conn, 0, len(s.clients))
	for conn := range s.clients {
		clients = append(clients, conn)
	}
	s.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for _, conn := range clients {
		_ = s.writeFrame(ctx, conn, kind, payload)
	}
}

func (s *ccConnectTerminalSession) writeFrame(ctx context.Context, conn *websocket.Conn, kind string, payload any) error {
	frame := map[string]any{
		"type":      kind,
		"payload":   payload,
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	}
	data, err := json.Marshal(frame)
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageText, data)
}

func resolveCCConnectProjectSelection(projectName string) (CCConnectProjectSelection, CCConnectProjectConfig, error) {
	config, err := loadCCConnectProjectsForRuntime()
	if err != nil {
		return CCConnectProjectSelection{}, CCConnectProjectConfig{}, err
	}
	projectName = strings.TrimSpace(projectName)
	for _, project := range config.Projects {
		if project.Name == "default-project" {
			continue
		}
		if projectName == "" || project.Name == projectName {
			workDir := expandCCConnectHomePath(project.Agent.WorkDir)
			return CCConnectProjectSelection{Name: project.Name, Path: workDir, AgentType: normalizeCCConnectAgentType(project.Agent.Type)}, project, nil
		}
	}
	if projectName != "" {
		return CCConnectProjectSelection{}, CCConnectProjectConfig{}, fmt.Errorf("CC-Connect project not found: %s", projectName)
	}
	return CCConnectProjectSelection{}, CCConnectProjectConfig{}, errors.New("未找到可用的 CC-Connect 项目")
}

func loadCCConnectProjectsForRuntime() (CCConnectProjectsConfig, error) {
	path, _ := resolveCCConnectConfigPath()
	doc, exists, err := readCCConnectConfigDocument(path)
	if err != nil {
		return CCConnectProjectsConfig{}, err
	}
	if !exists {
		return CCConnectProjectsConfig{}, errors.New("CC-Connect config.toml 不存在")
	}
	return parseCCConnectProjectsConfig(doc), nil
}

func pathIsUsableDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func normalizeCCConnectAgentType(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "claude", "claude-code", "claudecode":
		return "claudecode"
	case "codex", "gemini", "opencode", "qoder":
		return value
	default:
		return value
	}
}

func firstCCConnectString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func clampCCConnectInt(value int, fallback int, min int, max int) int {
	if value == 0 {
		value = fallback
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func ccConnectNullableInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func ccConnectNullableTime(value *time.Time) any {
	if value == nil {
		return nil
	}
	return value.Format(time.RFC3339Nano)
}

func cloneCCConnectIntPointer(value *int) *int {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func cloneCCConnectTimePointer(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func parseCCConnectTerminalTime(value string, fallback time.Time) time.Time {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return fallback
	}
	return parsed
}

func ccConnectRandomHex(size int) string {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(data)
}

func writeCCConnectAuthErrorLike(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"message": message,
		"status":  status,
	})
}
