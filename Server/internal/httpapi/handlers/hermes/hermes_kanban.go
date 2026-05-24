package hermes

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

type HermesKanbanBoardInput struct {
	Profile         string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	Board           string `query:"board,omitempty" doc:"Kanban board slug. Use default to avoid falling through to the CLI current board." example:"default"`
	Tenant          string `query:"tenant,omitempty" doc:"Optional tenant filter." example:"client-a"`
	IncludeArchived bool   `query:"includeArchived" doc:"Include archived tasks as a visible column." example:"false"`
}

type HermesKanbanBoardsInput struct {
	Profile         string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	IncludeArchived bool   `query:"includeArchived" doc:"Include archived board metadata." example:"true"`
}

type HermesKanbanTaskInput struct {
	ID      string `path:"id" doc:"Kanban task id." example:"t_1234abcd"`
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	Board   string `query:"board,omitempty" doc:"Kanban board slug." example:"default"`
}

type HermesKanbanTaskCreateInput struct {
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	Board   string `query:"board,omitempty" doc:"Kanban board slug." example:"default"`
	Body    map[string]any
}

type HermesKanbanTaskPatchInput struct {
	ID      string `path:"id" doc:"Kanban task id." example:"t_1234abcd"`
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	Board   string `query:"board,omitempty" doc:"Kanban board slug." example:"default"`
	Body    map[string]any
}

type HermesKanbanCommentInput struct {
	ID      string `path:"id" doc:"Kanban task id." example:"t_1234abcd"`
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	Board   string `query:"board,omitempty" doc:"Kanban board slug." example:"default"`
	Body    map[string]any
}

type HermesKanbanDispatchInput struct {
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	Board   string `query:"board,omitempty" doc:"Kanban board slug." example:"default"`
	DryRun  bool   `query:"dryRun" doc:"Run dispatcher without spawning workers." example:"false"`
	Max     int    `query:"max" minimum:"1" maximum:"32" doc:"Maximum number of workers to spawn." example:"8"`
}

func ListHermesKanbanBoards(ctx context.Context, input *HermesKanbanBoardsInput) (*HermesCronRawOutput, error) {
	if input == nil {
		input = &HermesKanbanBoardsInput{}
	}
	payload, err := runHermesKanbanPython(ctx, input.Profile, "boards", "default", map[string]any{
		"include_archived": input.IncludeArchived,
	})
	if err != nil {
		return nil, hermesKanbanHumaError("list hermes kanban boards failed", err)
	}
	return &HermesCronRawOutput{Body: payload}, nil
}

func GetHermesKanbanBoard(ctx context.Context, input *HermesKanbanBoardInput) (*HermesCronRawOutput, error) {
	if input == nil {
		input = &HermesKanbanBoardInput{}
	}
	payload, err := runHermesKanbanPython(ctx, input.Profile, "board", firstNonEmpty(input.Board, "default"), map[string]any{
		"tenant":           strings.TrimSpace(input.Tenant),
		"include_archived": input.IncludeArchived,
	})
	if err != nil {
		return nil, hermesKanbanHumaError("read hermes kanban board failed", err)
	}
	return &HermesCronRawOutput{Body: payload}, nil
}

func GetHermesKanbanTask(ctx context.Context, input *HermesKanbanTaskInput) (*HermesCronRawOutput, error) {
	if input == nil || strings.TrimSpace(input.ID) == "" {
		return nil, huma.Error400BadRequest("kanban task id is required", nil)
	}
	payload, err := runHermesKanbanPython(ctx, input.Profile, "task", firstNonEmpty(input.Board, "default"), map[string]any{
		"id": strings.TrimSpace(input.ID),
	})
	if err != nil {
		return nil, hermesKanbanHumaError("read hermes kanban task failed", err)
	}
	return &HermesCronRawOutput{Body: payload}, nil
}

func CreateHermesKanbanTask(ctx context.Context, input *HermesKanbanTaskCreateInput) (*HermesCronRawOutput, error) {
	if input == nil || input.Body == nil {
		return nil, huma.Error400BadRequest("kanban task body is required", nil)
	}
	payload, err := runHermesKanbanPython(ctx, input.Profile, "create", firstNonEmpty(input.Board, "default"), input.Body)
	if err != nil {
		return nil, hermesKanbanHumaError("create hermes kanban task failed", err)
	}
	return &HermesCronRawOutput{Body: payload}, nil
}

func UpdateHermesKanbanTask(ctx context.Context, input *HermesKanbanTaskPatchInput) (*HermesCronRawOutput, error) {
	if input == nil || strings.TrimSpace(input.ID) == "" {
		return nil, huma.Error400BadRequest("kanban task id is required", nil)
	}
	if input.Body == nil {
		return nil, huma.Error400BadRequest("kanban task patch body is required", nil)
	}
	body := map[string]any{}
	for key, value := range input.Body {
		body[key] = value
	}
	body["id"] = strings.TrimSpace(input.ID)
	payload, err := runHermesKanbanPython(ctx, input.Profile, "patch", firstNonEmpty(input.Board, "default"), body)
	if err != nil {
		return nil, hermesKanbanHumaError("update hermes kanban task failed", err)
	}
	return &HermesCronRawOutput{Body: payload}, nil
}

func AddHermesKanbanComment(ctx context.Context, input *HermesKanbanCommentInput) (*HermesCronRawOutput, error) {
	if input == nil || strings.TrimSpace(input.ID) == "" {
		return nil, huma.Error400BadRequest("kanban task id is required", nil)
	}
	if input.Body == nil {
		return nil, huma.Error400BadRequest("kanban comment body is required", nil)
	}
	body := map[string]any{}
	for key, value := range input.Body {
		body[key] = value
	}
	body["id"] = strings.TrimSpace(input.ID)
	payload, err := runHermesKanbanPython(ctx, input.Profile, "comment", firstNonEmpty(input.Board, "default"), body)
	if err != nil {
		return nil, hermesKanbanHumaError("add hermes kanban comment failed", err)
	}
	return &HermesCronRawOutput{Body: payload}, nil
}

func DispatchHermesKanban(ctx context.Context, input *HermesKanbanDispatchInput) (*HermesCronRawOutput, error) {
	if input == nil {
		input = &HermesKanbanDispatchInput{}
	}
	maxSpawn := input.Max
	if maxSpawn <= 0 || maxSpawn > 32 {
		maxSpawn = 8
	}
	payload, err := runHermesKanbanPython(ctx, input.Profile, "dispatch", firstNonEmpty(input.Board, "default"), map[string]any{
		"dry_run": input.DryRun,
		"max":     maxSpawn,
	})
	if err != nil {
		return nil, hermesKanbanHumaError("dispatch hermes kanban failed", err)
	}
	return &HermesCronRawOutput{Body: payload}, nil
}

func hermesKanbanHumaError(message string, err error) error {
	var validationErr hermesKanbanValidationError
	if errors.As(err, &validationErr) {
		return huma.Error400BadRequest(validationErr.Error(), err)
	}
	var notFoundErr hermesKanbanNotFoundError
	if errors.As(err, &notFoundErr) {
		return huma.Error404NotFound(notFoundErr.Error(), err)
	}
	var conflictErr hermesKanbanConflictError
	if errors.As(err, &conflictErr) {
		return huma.Error409Conflict(conflictErr.Error(), err)
	}
	return huma.Error500InternalServerError(message, err)
}

type hermesKanbanValidationError struct{ message string }
type hermesKanbanNotFoundError struct{ message string }
type hermesKanbanConflictError struct{ message string }

func (err hermesKanbanValidationError) Error() string { return err.message }
func (err hermesKanbanNotFoundError) Error() string   { return err.message }
func (err hermesKanbanConflictError) Error() string   { return err.message }

func runHermesKanbanPython(ctx context.Context, profileName string, action string, board string, body map[string]any) (json.RawMessage, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	profile, err := resolveHermesProfileSelection(profileName)
	if err != nil {
		return nil, err
	}
	stdout, stderr, runErr := hermesPythonCommandForProfile(ctx, 45*time.Second, profile, hermesKanbanPythonBridge, action, board, string(encoded))
	if runErr != nil {
		return nil, errors.New(strings.TrimSpace(stderr + "\n" + runErr.Error()))
	}
	trimmed := strings.TrimSpace(stdout)
	if trimmed == "" {
		return nil, errors.New("hermes kanban bridge returned empty output")
	}
	var envelope struct {
		OK      bool            `json:"ok"`
		Code    string          `json:"code"`
		Error   string          `json:"error"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal([]byte(trimmed), &envelope); err != nil {
		return nil, errors.New("hermes kanban bridge did not return valid JSON: " + strings.TrimSpace(stderr))
	}
	if !envelope.OK {
		message := firstNonEmpty(envelope.Error, "hermes kanban operation failed")
		switch envelope.Code {
		case "not_found":
			return nil, hermesKanbanNotFoundError{message: message}
		case "conflict":
			return nil, hermesKanbanConflictError{message: message}
		default:
			return nil, hermesKanbanValidationError{message: message}
		}
	}
	if len(envelope.Payload) == 0 || string(envelope.Payload) == "null" {
		return json.RawMessage(`{"status":"ok"}`), nil
	}
	return envelope.Payload, nil
}

const hermesKanbanPythonBridge = `
import json
import sys
import time
from dataclasses import asdict
from hermes_cli import kanban_db as kb

BOARD_COLUMNS = ["triage", "todo", "ready", "running", "blocked", "done"]
VALID_DIRECT_STATUSES = {"triage", "todo", "ready"}

action = sys.argv[1]
board_arg = sys.argv[2] or "default"
body = json.loads(sys.argv[3] or "{}")

def emit(payload=None, ok=True, code="", error=""):
    print(json.dumps({"ok": ok, "code": code, "error": error, "payload": payload}, ensure_ascii=False))

def fail(code, message):
    emit(None, False, code, str(message))

def resolve_board(slug):
    try:
        normed = kb._normalize_board_slug(slug or "default") or "default"
    except Exception as exc:
        raise ValueError(str(exc))
    if normed != kb.DEFAULT_BOARD and not kb.board_exists(normed):
        raise FileNotFoundError(f"board {normed!r} does not exist")
    return normed

def event_dict(event):
    return {
        "id": event.id,
        "task_id": event.task_id,
        "taskId": event.task_id,
        "kind": event.kind,
        "payload": event.payload,
        "created_at": event.created_at,
        "createdAt": event.created_at,
        "run_id": event.run_id,
        "runId": event.run_id,
    }

def comment_dict(comment):
    return {
        "id": comment.id,
        "task_id": comment.task_id,
        "taskId": comment.task_id,
        "author": comment.author,
        "body": comment.body,
        "created_at": comment.created_at,
        "createdAt": comment.created_at,
    }

def run_dict(run):
    return {
        "id": run.id,
        "task_id": run.task_id,
        "taskId": run.task_id,
        "profile": run.profile,
        "step_key": run.step_key,
        "stepKey": run.step_key,
        "status": run.status,
        "claim_lock": run.claim_lock,
        "claimLock": run.claim_lock,
        "claim_expires": run.claim_expires,
        "claimExpires": run.claim_expires,
        "worker_pid": run.worker_pid,
        "workerPid": run.worker_pid,
        "max_runtime_seconds": run.max_runtime_seconds,
        "maxRuntimeSeconds": run.max_runtime_seconds,
        "last_heartbeat_at": run.last_heartbeat_at,
        "lastHeartbeatAt": run.last_heartbeat_at,
        "started_at": run.started_at,
        "startedAt": run.started_at,
        "ended_at": run.ended_at,
        "endedAt": run.ended_at,
        "outcome": run.outcome,
        "summary": run.summary,
        "metadata": run.metadata,
        "error": run.error,
    }

def task_dict(task, conn=None, latest_summary=None):
    data = asdict(task)
    data["createdAt"] = data.get("created_at")
    data["startedAt"] = data.get("started_at")
    data["completedAt"] = data.get("completed_at")
    data["workspaceKind"] = data.get("workspace_kind")
    data["workspacePath"] = data.get("workspace_path")
    data["claimLock"] = data.get("claim_lock")
    data["claimExpires"] = data.get("claim_expires")
    data["consecutiveFailures"] = data.get("consecutive_failures")
    data["workerPid"] = data.get("worker_pid")
    data["lastFailureError"] = data.get("last_failure_error")
    data["maxRuntimeSeconds"] = data.get("max_runtime_seconds")
    data["lastHeartbeatAt"] = data.get("last_heartbeat_at")
    data["currentRunId"] = data.get("current_run_id")
    data["workflowTemplateId"] = data.get("workflow_template_id")
    data["currentStepKey"] = data.get("current_step_key")
    data["maxRetries"] = data.get("max_retries")
    try:
        data["age"] = kb.task_age(task)
    except Exception:
        data["age"] = {}
    if latest_summary is not None:
        data["latest_summary"] = latest_summary
        data["latestSummary"] = latest_summary
    if conn is not None:
        data["links"] = links_for(conn, task.id)
    return data

def links_for(conn, task_id):
    parents = [row["parent_id"] for row in conn.execute("SELECT parent_id FROM task_links WHERE child_id = ? ORDER BY parent_id", (task_id,)).fetchall()]
    children = [row["child_id"] for row in conn.execute("SELECT child_id FROM task_links WHERE parent_id = ? ORDER BY child_id", (task_id,)).fetchall()]
    return {"parents": parents, "children": children}

def set_status_direct(conn, task_id, new_status):
    with kb.write_txn(conn):
        prev = conn.execute("SELECT status, current_run_id FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if prev is None:
            return False
        if new_status == "ready":
            parent_statuses = conn.execute(
                "SELECT t.status FROM tasks t JOIN task_links l ON l.parent_id = t.id WHERE l.child_id = ?",
                (task_id,),
            ).fetchall()
            if parent_statuses and not all(row["status"] == "done" for row in parent_statuses):
                return False
        was_running = prev["status"] == "running"
        cur = conn.execute(
            "UPDATE tasks SET status = ?, "
            "claim_lock = CASE WHEN ? = 'running' THEN claim_lock ELSE NULL END, "
            "claim_expires = CASE WHEN ? = 'running' THEN claim_expires ELSE NULL END, "
            "worker_pid = CASE WHEN ? = 'running' THEN worker_pid ELSE NULL END "
            "WHERE id = ?",
            (new_status, new_status, new_status, new_status, task_id),
        )
        if cur.rowcount != 1:
            return False
        run_id = None
        if was_running and new_status != "running" and prev["current_run_id"]:
            run_id = kb._end_run(conn, task_id, outcome="reclaimed", status="reclaimed", summary=f"status changed to {new_status} (dashboard/direct)")
        kb._append_event(conn, task_id, "status", {"status": new_status}, run_id=run_id)
    if new_status in ("done", "ready"):
        kb.recompute_ready(conn)
    return True

def board_payload(conn, board, include_archived=False, tenant=None):
    tasks = kb.list_tasks(conn, tenant=(tenant or None), include_archived=include_archived)
    link_counts = {}
    for row in conn.execute("SELECT parent_id, child_id FROM task_links").fetchall():
        link_counts.setdefault(row["parent_id"], {"parents": 0, "children": 0})["children"] += 1
        link_counts.setdefault(row["child_id"], {"parents": 0, "children": 0})["parents"] += 1
    comment_counts = {row["task_id"]: row["n"] for row in conn.execute("SELECT task_id, COUNT(*) AS n FROM task_comments GROUP BY task_id").fetchall()}
    progress = {}
    for row in conn.execute("SELECT l.parent_id AS pid, t.status AS cstatus FROM task_links l JOIN tasks t ON t.id = l.child_id").fetchall():
        p = progress.setdefault(row["pid"], {"done": 0, "total": 0})
        p["total"] += 1
        if row["cstatus"] == "done":
            p["done"] += 1
    latest = kb.latest_summaries(conn, [task.id for task in tasks])
    columns = {name: [] for name in BOARD_COLUMNS}
    if include_archived:
        columns["archived"] = []
    for task in tasks:
        summary = latest.get(task.id)
        item = task_dict(task, latest_summary=(summary[:200] if summary else None))
        item["link_counts"] = link_counts.get(task.id, {"parents": 0, "children": 0})
        item["linkCounts"] = item["link_counts"]
        item["comment_count"] = comment_counts.get(task.id, 0)
        item["commentCount"] = item["comment_count"]
        item["progress"] = progress.get(task.id)
        col = task.status if task.status in columns else "todo"
        columns[col].append(item)
    tenants = [row["tenant"] for row in conn.execute("SELECT DISTINCT tenant FROM tasks WHERE tenant IS NOT NULL AND tenant != '' ORDER BY tenant").fetchall()]
    assignees = [row["assignee"] for row in conn.execute("SELECT DISTINCT assignee FROM tasks WHERE assignee IS NOT NULL AND assignee != '' AND status != 'archived' ORDER BY assignee").fetchall()]
    latest_event = conn.execute("SELECT COALESCE(MAX(id), 0) AS m FROM task_events").fetchone()["m"]
    return {
        "status": "ok",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "board": board,
        "columns": [{"name": name, "tasks": columns[name]} for name in columns.keys()],
        "tenants": tenants,
        "assignees": assignees,
        "latest_event_id": int(latest_event or 0),
        "latestEventId": int(latest_event or 0),
        "now": int(time.time()),
        "stats": kb.board_stats(conn),
    }

try:
    board = resolve_board(board_arg)
    if action == "boards":
        include = bool(body.get("include_archived", True))
        boards = kb.list_boards(include_archived=include)
        current = kb.get_current_board()
        for entry in boards:
            slug = entry.get("slug") or "default"
            entry["is_current"] = slug == current
            entry["isCurrent"] = entry["is_current"]
            try:
                path = kb.kanban_db_path(board=slug)
                if path.exists():
                    with kb.connect(board=slug) as conn:
                        rows = conn.execute("SELECT status, COUNT(*) AS n FROM tasks GROUP BY status").fetchall()
                    entry["counts"] = {row["status"]: int(row["n"]) for row in rows}
                else:
                    entry["counts"] = {}
            except Exception:
                entry["counts"] = {}
            entry["total"] = sum(entry["counts"].values())
        emit({"status": "ok", "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "boards": boards, "current": current})
    elif action == "board":
        kb.init_db(board=board)
        with kb.connect(board=board) as conn:
            emit(board_payload(conn, board, include_archived=bool(body.get("include_archived")), tenant=(body.get("tenant") or "")))
    elif action == "task":
        task_id = str(body.get("id") or "").strip()
        if not task_id:
            raise ValueError("task id is required")
        kb.init_db(board=board)
        with kb.connect(board=board) as conn:
            task = kb.get_task(conn, task_id)
            if task is None:
                raise FileNotFoundError(f"task {task_id} not found")
            item = task_dict(task, conn=conn, latest_summary=kb.latest_summary(conn, task_id))
            emit({
                "status": "ok",
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "task": item,
                "comments": [comment_dict(c) for c in kb.list_comments(conn, task_id)],
                "events": [event_dict(e) for e in kb.list_events(conn, task_id)],
                "links": links_for(conn, task_id),
                "runs": [run_dict(r) for r in kb.list_runs(conn, task_id)],
            })
    elif action == "create":
        title = str(body.get("title") or "").strip()
        if not title:
            raise ValueError("title is required")
        kb.init_db(board=board)
        with kb.connect(board=board) as conn:
            task_id = kb.create_task(
                conn,
                title=title,
                body=body.get("body"),
                assignee=body.get("assignee") or None,
                created_by="dashboard",
                workspace_kind=body.get("workspace_kind") or body.get("workspaceKind") or "scratch",
                workspace_path=body.get("workspace_path") or body.get("workspacePath") or None,
                tenant=body.get("tenant") or None,
                priority=int(body.get("priority") or 0),
                parents=body.get("parents") or [],
                triage=bool(body.get("triage") or False),
                idempotency_key=body.get("idempotency_key") or body.get("idempotencyKey") or None,
                max_runtime_seconds=body.get("max_runtime_seconds") or body.get("maxRuntimeSeconds") or None,
                skills=body.get("skills"),
                max_retries=body.get("max_retries") or body.get("maxRetries") or None,
            )
            task = kb.get_task(conn, task_id)
            emit({"status": "ok", "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "task": task_dict(task) if task else None})
    elif action == "patch":
        task_id = str(body.get("id") or "").strip()
        if not task_id:
            raise ValueError("task id is required")
        kb.init_db(board=board)
        with kb.connect(board=board) as conn:
            task = kb.get_task(conn, task_id)
            if task is None:
                raise FileNotFoundError(f"task {task_id} not found")
            if "assignee" in body:
                if not kb.assign_task(conn, task_id, body.get("assignee") or None):
                    raise FileNotFoundError("task not found")
            if "status" in body and body.get("status") is not None:
                status = str(body.get("status"))
                if status == "done":
                    ok = kb.complete_task(conn, task_id, result=body.get("result"), summary=body.get("summary"), metadata=body.get("metadata"))
                elif status == "blocked":
                    ok = kb.block_task(conn, task_id, reason=body.get("block_reason") or body.get("blockReason"))
                elif status == "archived":
                    ok = kb.archive_task(conn, task_id)
                elif status == "running":
                    raise ValueError("Cannot set status to 'running' directly; use the dispatcher/claim path")
                elif status in VALID_DIRECT_STATUSES:
                    current = kb.get_task(conn, task_id)
                    if status == "ready" and current and current.status == "blocked":
                        ok = kb.unblock_task(conn, task_id)
                    else:
                        ok = set_status_direct(conn, task_id, status)
                else:
                    raise ValueError(f"unknown status: {status}")
                if not ok:
                    raise RuntimeError(f"status transition to {status!r} not valid from current state")
            if "priority" in body and body.get("priority") is not None:
                with kb.write_txn(conn):
                    conn.execute("UPDATE tasks SET priority = ? WHERE id = ?", (int(body.get("priority")), task_id))
                    kb._append_event(conn, task_id, "reprioritized", {"priority": int(body.get("priority"))})
            if "title" in body or "body" in body:
                sets = []
                vals = []
                if "title" in body:
                    title = str(body.get("title") or "").strip()
                    if not title:
                        raise ValueError("title cannot be empty")
                    sets.append("title = ?")
                    vals.append(title)
                if "body" in body:
                    sets.append("body = ?")
                    vals.append(body.get("body"))
                vals.append(task_id)
                with kb.write_txn(conn):
                    conn.execute("UPDATE tasks SET " + ", ".join(sets) + " WHERE id = ?", vals)
                    kb._append_event(conn, task_id, "edited", None)
            updated = kb.get_task(conn, task_id)
            emit({"status": "ok", "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "task": task_dict(updated) if updated else None})
    elif action == "comment":
        task_id = str(body.get("id") or "").strip()
        text = str(body.get("body") or "").strip()
        if not task_id:
            raise ValueError("task id is required")
        if not text:
            raise ValueError("comment body is required")
        kb.init_db(board=board)
        with kb.connect(board=board) as conn:
            if kb.get_task(conn, task_id) is None:
                raise FileNotFoundError(f"task {task_id} not found")
            kb.add_comment(conn, task_id, author=body.get("author") or "dashboard", body=text)
            emit({"status": "ok", "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "ok": True})
    elif action == "dispatch":
        kb.init_db(board=board)
        with kb.connect(board=board) as conn:
            result = kb.dispatch_once(conn, dry_run=bool(body.get("dry_run")), max_spawn=int(body.get("max") or 8))
        emit({
            "status": "ok",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "reclaimed": result.reclaimed,
            "crashed": result.crashed,
            "timed_out": result.timed_out,
            "timedOut": result.timed_out,
            "auto_blocked": result.auto_blocked,
            "autoBlocked": result.auto_blocked,
            "promoted": result.promoted,
            "spawned": [{"task_id": tid, "taskId": tid, "assignee": who, "workspace": ws} for (tid, who, ws) in result.spawned],
            "skipped_unassigned": result.skipped_unassigned,
            "skippedUnassigned": result.skipped_unassigned,
            "skipped_nonspawnable": result.skipped_nonspawnable,
            "skippedNonspawnable": result.skipped_nonspawnable,
        })
    else:
        raise ValueError("unknown action")
except FileNotFoundError as exc:
    fail("not_found", exc)
except RuntimeError as exc:
    fail("conflict", exc)
except Exception as exc:
    fail("validation", exc)
`
