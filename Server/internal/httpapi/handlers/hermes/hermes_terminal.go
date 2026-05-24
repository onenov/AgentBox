package hermes

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
	"strconv"
	"strings"
	"sync"
	"time"

	"agent-box-server/internal/httpapi/toolenv"

	"github.com/creack/pty"
	"github.com/danielgtaylor/huma/v2"
	"nhooyr.io/websocket"
)

const (
	terminalScrollbackLimit = 400
	terminalDefaultCols     = 120
	terminalDefaultRows     = 32
)

const hermesTerminalSessionsSchema = `
CREATE TABLE IF NOT EXISTS hermes_terminal_sessions (
	id TEXT PRIMARY KEY,
	status TEXT NOT NULL,
	profile_name TEXT NOT NULL,
	profile_path TEXT NOT NULL,
	profile_is_default INTEGER NOT NULL DEFAULT 0,
	profile_is_active INTEGER NOT NULL DEFAULT 0,
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
	scrollback_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_hermes_terminal_sessions_profile_updated
	ON hermes_terminal_sessions(profile_name, updated_at DESC);
`

var terminalOSC11Pattern = regexp.MustCompile(`\x1b\]11;[^\x07\x1b]*(?:\x07|\x1b\\)`)
var terminalOSC11LoosePattern = regexp.MustCompile(`\]11;rgb:[0-9A-Fa-f/]+`)

type HermesTerminalListInput struct {
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty returns all terminal sessions." example:"default"`
}

type HermesTerminalCreateInput struct {
	Body HermesTerminalCreateRequest
}

type HermesTerminalGetInput struct {
	ID string `path:"id" doc:"Terminal session id."`
}

type HermesTerminalStopInput struct {
	ID string `path:"id" doc:"Terminal session id."`
}

type HermesTerminalDeleteRecordInput struct {
	ID string `path:"id" doc:"Terminal session id."`
}

type HermesTerminalCreateRequest struct {
	Profile         string `json:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"code"`
	Command         string `json:"command,omitempty" enum:"chat,chat-tui,continue,setup" doc:"Allowed Hermes command template." example:"chat"`
	ResumeSessionID string `json:"resumeSessionId,omitempty" doc:"Hermes session id to resume in TUI mode." example:"019e..."`
	CWD             string `json:"cwd,omitempty" doc:"Working directory for the Hermes process. Empty uses profile workspace/home."`
	Cols            int    `json:"cols,omitempty" minimum:"20" maximum:"400" example:"120"`
	Rows            int    `json:"rows,omitempty" minimum:"8" maximum:"120" example:"32"`
}

type HermesTerminalListOutput struct {
	Body HermesTerminalListResponse
}

type HermesTerminalOutput struct {
	Body HermesTerminalResponse
}

type HermesTerminalListResponse struct {
	Status    string                   `json:"status" example:"ok"`
	Timestamp string                   `json:"timestamp" example:"2026-05-17T00:00:00Z"`
	Sessions  []HermesTerminalResponse `json:"sessions"`
	Summary   HermesTerminalSummary    `json:"summary"`
}

type HermesTerminalSummary struct {
	Total   int `json:"total" example:"2"`
	Running int `json:"running" example:"1"`
	Exited  int `json:"exited" example:"1"`
}

type HermesTerminalResponse struct {
	ID         string                 `json:"id" example:"term-abc123"`
	Status     string                 `json:"status" example:"running"`
	Profile    HermesProfileSelection `json:"profile"`
	Command    string                 `json:"command" example:"hermes -p code chat"`
	Kind       string                 `json:"kind" example:"chat"`
	CWD        string                 `json:"cwd"`
	PID        int                    `json:"pid,omitempty" example:"12345"`
	ExitCode   *int                   `json:"exitCode,omitempty" example:"0"`
	Error      string                 `json:"error,omitempty"`
	CreatedAt  string                 `json:"createdAt" example:"2026-05-17T00:00:00Z"`
	UpdatedAt  string                 `json:"updatedAt" example:"2026-05-17T00:00:00Z"`
	ExitedAt   string                 `json:"exitedAt,omitempty" example:"2026-05-17T00:05:00Z"`
	Cols       int                    `json:"cols" example:"120"`
	Rows       int                    `json:"rows" example:"32"`
	Attached   int                    `json:"attached" example:"1"`
	SessionID  string                 `json:"sessionId,omitempty" doc:"Best-effort Hermes conversation session id for this terminal." example:"20260518_021024_d7fed3"`
	Scrollback []string               `json:"scrollback,omitempty"`
}

type terminalSession struct {
	id        string
	status    string
	profile   HermesProfileSelection
	argv      []string
	command   string
	kind      string
	cwd       string
	pid       int
	exitCode  *int
	errText   string
	createdAt time.Time
	updatedAt time.Time
	exitedAt  *time.Time
	cols      int
	rows      int
	deleted   bool

	cmd        *exec.Cmd
	ptyFile    *os.File
	cancel     context.CancelFunc
	clients    map[*websocket.Conn]struct{}
	scrollback []string
	mu         sync.Mutex
	manager    *hermesTerminalManager
}

type hermesTerminalManager struct {
	mu       sync.Mutex
	sessions map[string]*terminalSession
	db       *sql.DB
}

var globalHermesTerminalManager = &hermesTerminalManager{sessions: map[string]*terminalSession{}}

func ConfigureHermesTerminalStore(db *sql.DB) error {
	return globalHermesTerminalManager.configureStore(db)
}

func RebuildHermesTerminalStore(db *sql.DB) error {
	globalHermesTerminalManager.clearAll()
	return globalHermesTerminalManager.configureStore(db)
}

type hermesTerminalSessionRecord struct {
	id               string
	status           string
	profile          HermesProfileSelection
	argv             []string
	command          string
	kind             string
	cwd              string
	pid              int
	exitCode         *int
	errText          string
	createdAt        time.Time
	updatedAt        time.Time
	exitedAt         *time.Time
	cols             int
	rows             int
	scrollback       []string
	argvJSON         string
	scrollbackJSON   string
	profileIsDefault int
	profileIsActive  int
}

func (m *hermesTerminalManager) configureStore(db *sql.DB) error {
	if db == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, hermesTerminalSessionsSchema); err != nil {
		return fmt.Errorf("create hermes terminal sessions table: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.ExecContext(ctx, `
UPDATE hermes_terminal_sessions
SET status = 'exited',
	updated_at = ?,
	exited_at = COALESCE(exited_at, ?),
	error = CASE WHEN error = '' THEN ? ELSE error END
WHERE status IN ('running', 'stopping')`,
		now,
		now,
		"Hermes terminal process was detached when AgentBox restarted",
	); err != nil {
		return fmt.Errorf("mark stale hermes terminal sessions exited: %w", err)
	}
	sessions, err := loadHermesTerminalSessions(ctx, db)
	if err != nil {
		return err
	}

	m.mu.Lock()
	m.db = db
	m.sessions = map[string]*terminalSession{}
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

func ListHermesTerminals(ctx context.Context, input *HermesTerminalListInput) (*HermesTerminalListOutput, error) {
	profile := ""
	if input != nil {
		profile = strings.TrimSpace(input.Profile)
	}
	globalHermesTerminalManager.pruneMissingHermesSessionReferences(ctx, profile)
	sessions := globalHermesTerminalManager.list(profile)
	summary := HermesTerminalSummary{Total: len(sessions)}
	for _, session := range sessions {
		if session.Status == "running" {
			summary.Running++
		} else {
			summary.Exited++
		}
	}
	return &HermesTerminalListOutput{Body: HermesTerminalListResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Sessions:  sessions,
		Summary:   summary,
	}}, nil
}

func CreateHermesTerminal(ctx context.Context, input *HermesTerminalCreateInput) (*HermesTerminalOutput, error) {
	if runtime.GOOS == "windows" {
		return nil, huma.Error400BadRequest("Hermes Web Terminal is not supported on Windows yet", nil)
	}
	if input == nil {
		input = &HermesTerminalCreateInput{}
	}
	session, err := globalHermesTerminalManager.create(ctx, input.Body)
	if err != nil {
		return nil, err
	}
	return &HermesTerminalOutput{Body: session.response(true)}, nil
}

func GetHermesTerminal(ctx context.Context, input *HermesTerminalGetInput) (*HermesTerminalOutput, error) {
	session := globalHermesTerminalManager.get(input.ID)
	if session == nil {
		return nil, huma.Error404NotFound("Hermes terminal session not found", nil)
	}
	return &HermesTerminalOutput{Body: session.response(true)}, nil
}

func StopHermesTerminal(ctx context.Context, input *HermesTerminalStopInput) (*HermesTerminalOutput, error) {
	session := globalHermesTerminalManager.get(input.ID)
	if session == nil {
		return nil, huma.Error404NotFound("Hermes terminal session not found", nil)
	}
	session.stop()
	return &HermesTerminalOutput{Body: session.response(true)}, nil
}

func DeleteHermesTerminalRecord(ctx context.Context, input *HermesTerminalDeleteRecordInput) (*HermesTerminalOutput, error) {
	session := globalHermesTerminalManager.get(input.ID)
	if session == nil {
		return nil, huma.Error404NotFound("Hermes terminal session not found", nil)
	}
	if session.status == "running" {
		return nil, huma.Error409Conflict("Hermes terminal is still running", nil)
	}
	response := session.response(false)
	globalHermesTerminalManager.deleteTerminalSessions([]string{session.id})
	_ = ctx
	return &HermesTerminalOutput{Body: response}, nil
}

func HandleHermesTerminalWebSocket(w http.ResponseWriter, r *http.Request) {
	sessionID := strings.TrimSpace(r.URL.Query().Get("id"))
	if sessionID == "" {
		writeAuthErrorLike(w, http.StatusBadRequest, "missing terminal session id")
		return
	}
	session := globalHermesTerminalManager.get(sessionID)
	if session == nil {
		writeAuthErrorLike(w, http.StatusNotFound, "terminal session not found")
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
		var frame hermesTerminalClientFrame
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

type hermesTerminalClientFrame struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
}

func (m *hermesTerminalManager) list(profile string) []HermesTerminalResponse {
	m.mu.Lock()
	sessions := make([]*terminalSession, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	m.mu.Unlock()

	responses := make([]HermesTerminalResponse, 0, len(sessions))
	for _, session := range sessions {
		if profile != "" && session.profile.Name != profile {
			continue
		}
		responses = append(responses, session.response(false))
	}
	return responses
}

func (m *hermesTerminalManager) activeHermesSessionRefs(processesPath string) map[string][]string {
	profilePath := filepath.Dir(processesPath)
	m.mu.Lock()
	sessions := make([]*terminalSession, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	m.mu.Unlock()

	refs := map[string][]string{}
	for _, session := range sessions {
		session.mu.Lock()
		if session.status != "running" || session.profile.Path != profilePath {
			session.mu.Unlock()
			continue
		}
		sessionID := session.hermesSessionIDLocked()
		terminalID := session.id
		session.mu.Unlock()
		if sessionID == "" {
			continue
		}
		refs[sessionID] = append(refs[sessionID], terminalID)
	}
	return refs
}

func (m *hermesTerminalManager) get(id string) *terminalSession {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[id]
}

func (m *hermesTerminalManager) persistSession(session *terminalSession) {
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
INSERT INTO hermes_terminal_sessions (
	id, status, profile_name, profile_path, profile_is_default, profile_is_active,
	argv_json, command, kind, cwd, pid, exit_code, error, created_at, updated_at,
	exited_at, cols, rows, scrollback_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
	status = excluded.status,
	profile_name = excluded.profile_name,
	profile_path = excluded.profile_path,
	profile_is_default = excluded.profile_is_default,
	profile_is_active = excluded.profile_is_active,
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
	scrollback_json = excluded.scrollback_json`,
		record.id,
		record.status,
		record.profile.Name,
		record.profile.Path,
		record.profileIsDefault,
		record.profileIsActive,
		record.argvJSON,
		record.command,
		record.kind,
		record.cwd,
		record.pid,
		nullableInt(record.exitCode),
		record.errText,
		record.createdAt.Format(time.RFC3339Nano),
		record.updatedAt.Format(time.RFC3339Nano),
		nullableTime(record.exitedAt),
		record.cols,
		record.rows,
		record.scrollbackJSON,
	)
}

func (m *hermesTerminalManager) deleteByHermesSession(profile string, sessionID string) int {
	profile = strings.TrimSpace(profile)
	sessionID = strings.TrimSpace(sessionID)
	if profile == "" || sessionID == "" {
		return 0
	}
	m.mu.Lock()
	ids := make([]string, 0)
	for id, session := range m.sessions {
		if session.profile.Name != profile || session.status == "running" || !terminalSessionReferencesHermesSession(session, sessionID) {
			continue
		}
		ids = append(ids, id)
	}
	m.mu.Unlock()
	return m.deleteTerminalSessions(ids)
}

func (m *hermesTerminalManager) pruneMissingHermesSessionReferences(ctx context.Context, profile string) {
	m.mu.Lock()
	sessions := make([]*terminalSession, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	m.mu.Unlock()

	ids := make([]string, 0)
	existsCache := map[string]bool{}
	for _, session := range sessions {
		if profile != "" && session.profile.Name != profile {
			continue
		}
		if session.status == "running" {
			continue
		}
		resumeID := terminalSessionResumeID(session)
		if resumeID == "" {
			continue
		}
		cacheKey := session.profile.Name + "\x00" + resumeID
		exists, ok := existsCache[cacheKey]
		if !ok {
			target, err := resolveHermesSessionProfileTarget(ctx, session.profile.Name)
			if err != nil {
				continue
			}
			exists = hermesSessionExistsInProfile(target, resumeID)
			existsCache[cacheKey] = exists
		}
		if !exists {
			ids = append(ids, session.id)
		}
	}
	m.deleteTerminalSessions(ids)
}

func (m *hermesTerminalManager) deleteTerminalSessions(ids []string) int {
	if len(ids) == 0 {
		return 0
	}
	m.mu.Lock()
	db := m.db
	removed := 0
	for _, id := range ids {
		if _, ok := m.sessions[id]; ok {
			delete(m.sessions, id)
			removed++
		}
	}
	m.mu.Unlock()

	if db != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		for _, id := range ids {
			_, _ = db.ExecContext(ctx, "DELETE FROM hermes_terminal_sessions WHERE id = ?", id)
		}
	}
	return removed
}

func (m *hermesTerminalManager) clearAll() int {
	m.mu.Lock()
	db := m.db
	sessions := make([]*terminalSession, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	removed := len(m.sessions)
	m.sessions = map[string]*terminalSession{}
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
		_, _ = db.ExecContext(ctx, "DELETE FROM hermes_terminal_sessions")
	}
	return removed
}

func loadHermesTerminalSessions(ctx context.Context, db *sql.DB) ([]*terminalSession, error) {
	rows, err := db.QueryContext(ctx, `
SELECT id, status, profile_name, profile_path, profile_is_default, profile_is_active,
	argv_json, command, kind, cwd, pid, exit_code, error, created_at, updated_at,
	exited_at, cols, rows, scrollback_json
FROM hermes_terminal_sessions
ORDER BY updated_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("load hermes terminal sessions: %w", err)
	}
	defer rows.Close()

	sessions := []*terminalSession{}
	for rows.Next() {
		var (
			id               string
			status           string
			profileName      string
			profilePath      string
			profileIsDefault int
			profileIsActive  int
			argvJSON         string
			command          string
			kind             string
			cwd              string
			pid              int
			exitCode         sql.NullInt64
			errText          string
			createdAtRaw     string
			updatedAtRaw     string
			exitedAtRaw      sql.NullString
			cols             int
			rowsCount        int
			scrollbackJSON   string
		)
		if err := rows.Scan(
			&id,
			&status,
			&profileName,
			&profilePath,
			&profileIsDefault,
			&profileIsActive,
			&argvJSON,
			&command,
			&kind,
			&cwd,
			&pid,
			&exitCode,
			&errText,
			&createdAtRaw,
			&updatedAtRaw,
			&exitedAtRaw,
			&cols,
			&rowsCount,
			&scrollbackJSON,
		); err != nil {
			return nil, fmt.Errorf("scan hermes terminal session: %w", err)
		}

		argv := []string{}
		_ = json.Unmarshal([]byte(argvJSON), &argv)
		scrollback := []string{}
		_ = json.Unmarshal([]byte(scrollbackJSON), &scrollback)
		createdAt := parseTerminalTime(createdAtRaw, time.Now().UTC())
		updatedAt := parseTerminalTime(updatedAtRaw, createdAt)
		var exitedAt *time.Time
		if exitedAtRaw.Valid && strings.TrimSpace(exitedAtRaw.String) != "" {
			parsed := parseTerminalTime(exitedAtRaw.String, updatedAt)
			exitedAt = &parsed
		}
		var exitCodeValue *int
		if exitCode.Valid {
			code := int(exitCode.Int64)
			exitCodeValue = &code
		}

		sessions = append(sessions, &terminalSession{
			id:         id,
			status:     status,
			profile:    HermesProfileSelection{Name: profileName, Path: profilePath, IsDefault: profileIsDefault != 0, IsActive: profileIsActive != 0},
			argv:       argv,
			command:    command,
			kind:       kind,
			cwd:        cwd,
			pid:        pid,
			exitCode:   exitCodeValue,
			errText:    errText,
			createdAt:  createdAt,
			updatedAt:  updatedAt,
			exitedAt:   exitedAt,
			cols:       clampInt(cols, terminalDefaultCols, 20, 400),
			rows:       clampInt(rowsCount, terminalDefaultRows, 8, 120),
			clients:    map[*websocket.Conn]struct{}{},
			scrollback: scrollback,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate hermes terminal sessions: %w", err)
	}
	return sessions, nil
}

func (m *hermesTerminalManager) create(parent context.Context, request HermesTerminalCreateRequest) (*terminalSession, error) {
	profile, err := resolveHermesProfileSelection(request.Profile)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error(), err)
	}
	kind := firstNonEmpty(strings.TrimSpace(request.Command), "chat")
	resumeSessionID := strings.TrimSpace(request.ResumeSessionID)
	argv, err := hermesTerminalArgv(profile.Name, kind, resumeSessionID)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error(), err)
	}
	hermesPath := toolenv.ResolveToolPath("hermes")
	if hermesPath == "" {
		return nil, huma.Error400BadRequest("Hermes CLI not found. Please install Hermes or make sure hermes is available in PATH.", nil)
	}
	argv[0] = hermesPath
	cwd := strings.TrimSpace(request.CWD)
	if cwd == "" {
		cwd = firstNonEmpty(filepath.Join(profile.Path, "workspace"), profile.Path)
	}
	if stat, err := os.Stat(cwd); err != nil || !stat.IsDir() {
		cwd = profile.Path
	}
	cols := clampInt(request.Cols, terminalDefaultCols, 20, 400)
	rows := clampInt(request.Rows, terminalDefaultRows, 8, 120)

	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Dir = cwd
	cmd.Env = toolenv.CommandEnv()
	if profile.Name != "default" {
		cmd.Env = append(cmd.Env, "HERMES_PROFILE="+profile.Name)
	}

	ptyFile, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	if err != nil {
		cancel()
		return nil, huma.Error500InternalServerError("start Hermes terminal failed", err)
	}

	now := time.Now().UTC()
	session := &terminalSession{
		id:        "term-" + randomHex(8),
		status:    "running",
		profile:   profile,
		argv:      argv,
		command:   strings.Join(argv, " "),
		kind:      kind,
		cwd:       cwd,
		pid:       cmd.Process.Pid,
		createdAt: now,
		updatedAt: now,
		cols:      cols,
		rows:      rows,
		cmd:       cmd,
		ptyFile:   ptyFile,
		cancel:    cancel,
		clients:   map[*websocket.Conn]struct{}{},
		manager:   m,
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

func hermesTerminalArgv(profile string, kind string, resumeSessionID string) ([]string, error) {
	base := []string{"hermes"}
	if profile != "default" {
		base = append(base, "-p", profile)
	}
	if resumeSessionID != "" {
		return append(base, "chat", "--resume", resumeSessionID, "--tui"), nil
	}
	switch kind {
	case "", "chat":
		return append(base, "chat"), nil
	case "chat-tui":
		return append(base, "chat", "--tui"), nil
	case "continue":
		return append(base, "chat", "--continue"), nil
	case "setup":
		return append(base, "setup"), nil
	default:
		return nil, fmt.Errorf("unsupported Hermes terminal command: %s", kind)
	}
}

func (s *terminalSession) readLoop() {
	reader := bufio.NewReader(s.ptyFile)
	buffer := make([]byte, 4096)
	for {
		n, err := reader.Read(buffer)
		if n > 0 {
			chunk := sanitizeTerminalChunk(string(buffer[:n]))
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

func (s *terminalSession) waitLoop() {
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

func (s *terminalSession) persistenceRecord() (hermesTerminalSessionRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	argv := append([]string{}, s.argv...)
	scrollback := append([]string{}, s.scrollback...)
	argvJSON, err := json.Marshal(argv)
	if err != nil {
		return hermesTerminalSessionRecord{}, err
	}
	scrollbackJSON, err := json.Marshal(scrollback)
	if err != nil {
		return hermesTerminalSessionRecord{}, err
	}
	return hermesTerminalSessionRecord{
		id:               s.id,
		status:           s.status,
		profile:          s.profile,
		argv:             argv,
		command:          s.command,
		kind:             s.kind,
		cwd:              s.cwd,
		pid:              s.pid,
		exitCode:         cloneIntPointer(s.exitCode),
		errText:          s.errText,
		createdAt:        s.createdAt,
		updatedAt:        s.updatedAt,
		exitedAt:         cloneTimePointer(s.exitedAt),
		cols:             s.cols,
		rows:             s.rows,
		scrollback:       scrollback,
		argvJSON:         string(argvJSON),
		scrollbackJSON:   string(scrollbackJSON),
		profileIsDefault: boolToInt(s.profile.IsDefault),
		profileIsActive:  boolToInt(s.profile.IsActive),
	}, nil
}

func terminalSessionReferencesHermesSession(session *terminalSession, sessionID string) bool {
	return terminalSessionResumeID(session) == strings.TrimSpace(sessionID)
}

func terminalSessionResumeID(session *terminalSession) string {
	if session == nil {
		return ""
	}
	session.mu.Lock()
	argv := append([]string{}, session.argv...)
	command := session.command
	session.mu.Unlock()

	return terminalSessionResumeIDFromArgs(argv, command)
}

func terminalSessionResumeIDFromArgs(argv []string, command string) string {
	for index, arg := range argv {
		if (arg == "--resume" || arg == "-r") && index+1 < len(argv) {
			return strings.TrimSpace(argv[index+1])
		}
	}
	fields := strings.Fields(command)
	for index, arg := range fields {
		if (arg == "--resume" || arg == "-r") && index+1 < len(fields) {
			return strings.TrimSpace(fields[index+1])
		}
	}
	return ""
}

func (s *terminalSession) hermesSessionIDLocked() string {
	resumeID := terminalSessionResumeIDFromArgs(s.argv, s.command)
	if resumeID != "" {
		return resumeID
	}
	if s.status != "running" {
		return ""
	}
	return findHermesSessionFileForTerminal(s.profile.Path, s.createdAt)
}

func findHermesSessionFileForTerminal(profilePath string, createdAt time.Time) string {
	entries, err := os.ReadDir(filepath.Join(profilePath, "sessions"))
	if err != nil {
		return ""
	}
	var bestID string
	var bestDelta time.Duration
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasPrefix(name, "session_") || !strings.HasSuffix(name, ".json") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		modTime := info.ModTime()
		if modTime.Before(createdAt.Add(-10*time.Second)) || modTime.After(time.Now().Add(2*time.Minute)) {
			continue
		}
		delta := modTime.Sub(createdAt)
		if delta < 0 {
			delta = -delta
		}
		if bestID == "" || delta < bestDelta {
			bestDelta = delta
			bestID = strings.TrimSuffix(strings.TrimPrefix(name, "session_"), ".json")
		}
	}
	return bestID
}

func (s *terminalSession) persist() {
	manager := s.manager
	if manager == nil {
		manager = globalHermesTerminalManager
	}
	manager.persistSession(s)
}

func (s *terminalSession) response(includeScrollback bool) HermesTerminalResponse {
	s.mu.Lock()
	defer s.mu.Unlock()
	response := HermesTerminalResponse{
		ID:        s.id,
		Status:    s.status,
		Profile:   s.profile,
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
		SessionID: s.hermesSessionIDLocked(),
	}
	if s.exitedAt != nil {
		response.ExitedAt = s.exitedAt.Format(time.RFC3339Nano)
	}
	if includeScrollback {
		response.Scrollback = append([]string{}, s.scrollback...)
	}
	return response
}

func (s *terminalSession) attach(conn *websocket.Conn) {
	s.mu.Lock()
	s.clients[conn] = struct{}{}
	s.updatedAt = time.Now().UTC()
	s.mu.Unlock()
	s.broadcast("status", map[string]any{"session": s.response(false)})
}

func (s *terminalSession) detach(conn *websocket.Conn) {
	s.mu.Lock()
	delete(s.clients, conn)
	s.updatedAt = time.Now().UTC()
	s.mu.Unlock()
	s.broadcast("status", map[string]any{"session": s.response(false)})
}

func (s *terminalSession) snapshotScrollback() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	scrollback := make([]string, 0, len(s.scrollback))
	for _, chunk := range s.scrollback {
		if cleaned := sanitizeTerminalChunk(chunk); cleaned != "" {
			scrollback = append(scrollback, cleaned)
		}
	}
	return scrollback
}

func (s *terminalSession) appendScrollback(chunk string) {
	s.mu.Lock()
	s.scrollback = append(s.scrollback, chunk)
	if extra := len(s.scrollback) - terminalScrollbackLimit; extra > 0 {
		s.scrollback = append([]string{}, s.scrollback[extra:]...)
	}
	s.updatedAt = time.Now().UTC()
	s.mu.Unlock()
	s.persist()
}

func sanitizeTerminalChunk(chunk string) string {
	chunk = terminalOSC11Pattern.ReplaceAllString(chunk, "")
	chunk = terminalOSC11LoosePattern.ReplaceAllString(chunk, "")
	return chunk
}

func (s *terminalSession) writeInput(data string) error {
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

func (s *terminalSession) resize(cols int, rows int) {
	cols = clampInt(cols, s.cols, 20, 400)
	rows = clampInt(rows, s.rows, 8, 120)
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

func (s *terminalSession) stop() {
	s.mu.Lock()
	if s.status != "running" {
		s.mu.Unlock()
		return
	}
	cancel := s.cancel
	process := s.cmd.Process
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

func (s *terminalSession) setError(err error) {
	s.mu.Lock()
	if s.errText == "" {
		s.errText = err.Error()
	}
	s.updatedAt = time.Now().UTC()
	s.mu.Unlock()
	s.persist()
}

func (s *terminalSession) broadcast(kind string, payload any) {
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

func (s *terminalSession) writeFrame(ctx context.Context, conn *websocket.Conn, kind string, payload any) error {
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

func clampInt(value int, fallback int, min int, max int) int {
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

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func nullableInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullableTime(value *time.Time) any {
	if value == nil {
		return nil
	}
	return value.Format(time.RFC3339Nano)
}

func cloneIntPointer(value *int) *int {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func cloneTimePointer(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func parseTerminalTime(value string, fallback time.Time) time.Time {
	parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(value))
	if err != nil {
		return fallback
	}
	return parsed
}

func randomHex(size int) string {
	buf := make([]byte, size)
	if _, err := rand.Read(buf); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return hex.EncodeToString(buf)
}

func writeAuthErrorLike(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":    status,
		"title":     http.StatusText(status),
		"detail":    message,
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	})
}
