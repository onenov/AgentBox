package hermes

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

type HermesCronRawOutput struct {
	Body json.RawMessage
}

type HermesCronListInput struct {
	Profile         string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	IncludeDisabled bool   `query:"includeDisabled" doc:"Include disabled cron jobs." example:"true"`
	Limit           int    `query:"limit" minimum:"1" maximum:"200" doc:"Maximum number of jobs to return." example:"100"`
	Offset          int    `query:"offset" minimum:"0" doc:"Pagination offset." example:"0"`
	Query           string `query:"query" doc:"Search text matched against job name, prompt, skills, script, and workdir." example:"daily"`
	Enabled         string `query:"enabled" enum:"all,enabled,disabled" doc:"Enabled filter." example:"all"`
	SortBy          string `query:"sortBy" enum:"name,nextRunAt,createdAt,updatedAt,lastRunAt" doc:"Sort field." example:"nextRunAt"`
	SortDir         string `query:"sortDir" enum:"asc,desc" doc:"Sort direction." example:"asc"`
}

type HermesCronRunsInput struct {
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	ID      string `query:"id" doc:"Optional cron job id filter." example:"abc123"`
	Limit   int    `query:"limit" minimum:"1" maximum:"200" doc:"Maximum number of run output entries." example:"100"`
	Offset  int    `query:"offset" minimum:"0" doc:"Pagination offset." example:"0"`
	Query   string `query:"query" doc:"Search output text or job name." example:"timeout"`
	Status  string `query:"status" enum:"all,ok,error" doc:"Run status filter." example:"all"`
	SortDir string `query:"sortDir" enum:"asc,desc" doc:"Sort direction." example:"desc"`
}

type HermesCronJobInput struct {
	ID      string `path:"id" doc:"Hermes cron job id." example:"abc123"`
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
}

type HermesCronCreateInput struct {
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	Body    map[string]any
}

type HermesCronPatchInput struct {
	ID      string `path:"id" doc:"Hermes cron job id." example:"abc123"`
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	Body    map[string]any
}

type HermesCronRunInput struct {
	ID      string `path:"id" doc:"Hermes cron job id." example:"abc123"`
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
}

func GetHermesCronStatus(ctx context.Context, input *HermesProfileQueryInput) (*HermesCronRawOutput, error) {
	profileName := ""
	if input != nil {
		profileName = input.Profile
	}
	profile, err := resolveHermesProfileSelection(profileName)
	if err != nil {
		return nil, err
	}
	home := profile.Path
	cronDir := filepath.Join(home, "cron")
	jobsFile := filepath.Join(cronDir, "jobs.json")
	outputDir := filepath.Join(cronDir, "output")
	jobs, readErr := readHermesCronJobs(jobsFile)
	if readErr != nil && !os.IsNotExist(readErr) {
		return nil, huma.Error500InternalServerError("read hermes cron jobs failed", readErr)
	}
	homeInfo := HermesHomeInfo{
		Path:               home,
		GatewayPIDPath:     filepath.Join(home, "gateway.pid"),
		GatewayPIDExists:   pathExists(filepath.Join(home, "gateway.pid")),
		GatewayStatePath:   filepath.Join(home, "gateway_state.json"),
		GatewayStateExists: pathExists(filepath.Join(home, "gateway_state.json")),
	}
	gateway, _ := detectHermesGateway(ctx, homeInfo)
	nextRunAt := ""
	enabledCount := 0
	for _, job := range jobs {
		if !boolFromAny(job["enabled"], true) {
			continue
		}
		enabledCount++
		value := strings.TrimSpace(stringFromAny(job["next_run_at"]))
		if value != "" && (nextRunAt == "" || value < nextRunAt) {
			nextRunAt = value
		}
	}
	body := map[string]any{
		"status":          "ok",
		"timestamp":       time.Now().UTC().Format(time.RFC3339),
		"enabled":         gateway.Running,
		"gatewayRunning":  gateway.Running,
		"jobs":            len(jobs),
		"enabledJobs":     enabledCount,
		"pausedJobs":      len(jobs) - enabledCount,
		"nextRunAt":       nullableString(nextRunAt),
		"cronDir":         cronDir,
		"jobsPath":        jobsFile,
		"outputDir":       outputDir,
		"jobsPathExists":  pathExists(jobsFile),
		"outputDirExists": pathExists(outputDir),
	}
	return rawJSONOutput(body)
}

func ListHermesCronJobs(ctx context.Context, input *HermesCronListInput) (*HermesCronRawOutput, error) {
	if input == nil {
		input = &HermesCronListInput{}
	}
	profile, err := resolveHermesProfileSelection(input.Profile)
	if err != nil {
		return nil, err
	}
	home := profile.Path
	jobs, err := readHermesCronJobs(filepath.Join(home, "cron", "jobs.json"))
	if err != nil && !os.IsNotExist(err) {
		return nil, huma.Error500InternalServerError("read hermes cron jobs failed", err)
	}
	normalized := make([]map[string]any, 0, len(jobs))
	for _, job := range jobs {
		item := normalizeHermesCronJob(job)
		if !input.IncludeDisabled && input.Enabled == "" && !boolFromAny(item["enabled"], true) {
			continue
		}
		switch input.Enabled {
		case "enabled":
			if !boolFromAny(item["enabled"], true) {
				continue
			}
		case "disabled":
			if boolFromAny(item["enabled"], true) {
				continue
			}
		}
		if !hermesCronJobMatches(item, input.Query) {
			continue
		}
		normalized = append(normalized, item)
	}
	sortHermesCronJobs(normalized, input.SortBy, input.SortDir)
	total := len(normalized)
	limit := input.Limit
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	offset := input.Offset
	if offset < 0 {
		offset = 0
	}
	end := offset + limit
	if offset > total {
		offset = total
	}
	if end > total {
		end = total
	}
	nextOffset := any(nil)
	if end < total {
		nextOffset = end
	}
	return rawJSONOutput(map[string]any{
		"jobs":       normalized[offset:end],
		"total":      total,
		"limit":      limit,
		"offset":     offset,
		"nextOffset": nextOffset,
		"hasMore":    end < total,
	})
}

func CreateHermesCronJob(ctx context.Context, input *HermesCronCreateInput) (*HermesCronRawOutput, error) {
	if input == nil || input.Body == nil {
		return nil, huma.Error400BadRequest("cron job body is required", nil)
	}
	payload, err := runHermesCronPython(ctx, input.Profile, "create", "", input.Body)
	if err != nil {
		return nil, hermesCronHumaError("hermes cron create failed", err)
	}
	return &HermesCronRawOutput{Body: payload}, nil
}

func UpdateHermesCronJob(ctx context.Context, input *HermesCronPatchInput) (*HermesCronRawOutput, error) {
	if input == nil || strings.TrimSpace(input.ID) == "" {
		return nil, huma.Error400BadRequest("cron job id is required", nil)
	}
	if input.Body == nil {
		return nil, huma.Error400BadRequest("cron patch body is required", nil)
	}
	payload, err := runHermesCronPython(ctx, input.Profile, "update", strings.TrimSpace(input.ID), input.Body)
	if err != nil {
		return nil, hermesCronHumaError("hermes cron update failed", err)
	}
	return &HermesCronRawOutput{Body: payload}, nil
}

func DeleteHermesCronJob(ctx context.Context, input *HermesCronJobInput) (*HermesCronRawOutput, error) {
	id, err := requireHermesCronJobID(input)
	if err != nil {
		return nil, err
	}
	profile := ""
	if input != nil {
		profile = input.Profile
	}
	payload, runErr := runHermesCronPython(ctx, profile, "remove", id, nil)
	if runErr != nil {
		return nil, hermesCronHumaError("hermes cron remove failed", runErr)
	}
	return &HermesCronRawOutput{Body: payload}, nil
}

func RunHermesCronJob(ctx context.Context, input *HermesCronRunInput) (*HermesCronRawOutput, error) {
	if input == nil || strings.TrimSpace(input.ID) == "" {
		return nil, huma.Error400BadRequest("cron job id is required", nil)
	}
	payload, err := runHermesCronPython(ctx, input.Profile, "run", strings.TrimSpace(input.ID), nil)
	if err != nil {
		return nil, hermesCronHumaError("hermes cron run failed", err)
	}
	return &HermesCronRawOutput{Body: payload}, nil
}

func ListHermesCronRuns(ctx context.Context, input *HermesCronRunsInput) (*HermesCronRawOutput, error) {
	if input == nil {
		input = &HermesCronRunsInput{}
	}
	profile, err := resolveHermesProfileSelection(input.Profile)
	if err != nil {
		return nil, err
	}
	home := profile.Path
	jobs, _ := readHermesCronJobs(filepath.Join(home, "cron", "jobs.json"))
	jobNames := map[string]string{}
	for _, job := range jobs {
		id := stringFromAny(job["id"])
		if id != "" {
			jobNames[id] = firstNonEmpty(stringFromAny(job["name"]), id)
		}
	}
	entries := readHermesCronOutputEntries(filepath.Join(home, "cron", "output"), strings.TrimSpace(input.ID), jobNames)
	if status := strings.TrimSpace(input.Status); status != "" && status != "all" {
		filtered := entries[:0]
		for _, entry := range entries {
			if stringFromAny(entry["status"]) == status {
				filtered = append(filtered, entry)
			}
		}
		entries = filtered
	}
	if query := normalizeSearchText(input.Query); query != "" {
		filtered := entries[:0]
		for _, entry := range entries {
			haystack := normalizeSearchText(strings.Join([]string{
				stringFromAny(entry["jobId"]),
				stringFromAny(entry["jobName"]),
				stringFromAny(entry["file"]),
				stringFromAny(entry["summary"]),
				stringFromAny(entry["content"]),
			}, " "))
			if strings.Contains(haystack, query) {
				filtered = append(filtered, entry)
			}
		}
		entries = filtered
	}
	sort.Slice(entries, func(i, j int) bool {
		left := stringFromAny(entries[i]["ts"])
		right := stringFromAny(entries[j]["ts"])
		if input.SortDir == "asc" {
			return left < right
		}
		return left > right
	})
	total := len(entries)
	limit := input.Limit
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	offset := input.Offset
	if offset < 0 {
		offset = 0
	}
	end := offset + limit
	if offset > total {
		offset = total
	}
	if end > total {
		end = total
	}
	nextOffset := any(nil)
	if end < total {
		nextOffset = end
	}
	return rawJSONOutput(map[string]any{
		"entries":    entries[offset:end],
		"total":      total,
		"limit":      limit,
		"offset":     offset,
		"nextOffset": nextOffset,
		"hasMore":    end < total,
	})
}

func readHermesCronJobs(path string) ([]map[string]any, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return []map[string]any{}, err
	}
	var payload struct {
		Jobs []map[string]any `json:"jobs"`
	}
	if err := json.Unmarshal(content, &payload); err != nil {
		return []map[string]any{}, err
	}
	if payload.Jobs == nil {
		payload.Jobs = []map[string]any{}
	}
	return payload.Jobs, nil
}

func normalizeHermesCronJob(job map[string]any) map[string]any {
	item := map[string]any{}
	for key, value := range job {
		item[key] = value
	}
	id := firstNonEmpty(stringFromAny(item["id"]), "unknown")
	prompt := stringFromAny(item["prompt"])
	name := strings.TrimSpace(stringFromAny(item["name"]))
	if name == "" {
		name = firstNonEmpty(truncateString(prompt, 50), firstStringFromAnySlice(item["skills"]), stringFromAny(item["script"]), id)
	}
	item["id"] = id
	item["name"] = name
	item["prompt"] = prompt
	item["promptPreview"] = truncateString(prompt, 120)
	item["enabled"] = boolFromAny(item["enabled"], true)
	item["state"] = firstNonEmpty(stringFromAny(item["state"]), boolMessage(boolFromAny(item["enabled"], true), "scheduled", "paused"))
	item["scheduleDisplay"] = firstNonEmpty(stringFromAny(item["schedule_display"]), displayHermesCronSchedule(item["schedule"]))
	item["skills"] = stringsFromAny(item["skills"])
	if len(stringsFromAny(item["skills"])) == 0 && stringFromAny(item["skill"]) != "" {
		item["skills"] = []string{stringFromAny(item["skill"])}
	}
	item["repeatLabel"] = hermesCronRepeatLabel(item["repeat"])
	return item
}

func displayHermesCronSchedule(value any) string {
	schedule, ok := value.(map[string]any)
	if !ok {
		return stringFromAny(value)
	}
	return firstNonEmpty(
		stringFromAny(schedule["display"]),
		stringFromAny(schedule["expr"]),
		stringFromAny(schedule["run_at"]),
	)
}

func hermesCronRepeatLabel(value any) string {
	repeat, ok := value.(map[string]any)
	if !ok {
		return "forever"
	}
	timesRaw, hasTimes := repeat["times"]
	completed := intFromAny(repeat["completed"])
	if !hasTimes || timesRaw == nil {
		return "forever"
	}
	times := intFromAny(timesRaw)
	if times == 1 && completed == 0 {
		return "once"
	}
	return strconv.Itoa(completed) + "/" + strconv.Itoa(times)
}

func hermesCronJobMatches(job map[string]any, query string) bool {
	query = normalizeSearchText(query)
	if query == "" {
		return true
	}
	values := []string{
		stringFromAny(job["id"]),
		stringFromAny(job["name"]),
		stringFromAny(job["prompt"]),
		stringFromAny(job["scheduleDisplay"]),
		stringFromAny(job["deliver"]),
		stringFromAny(job["script"]),
		stringFromAny(job["workdir"]),
		stringFromAny(job["model"]),
		stringFromAny(job["provider"]),
	}
	values = append(values, stringsFromAny(job["skills"])...)
	values = append(values, stringsFromAny(job["enabled_toolsets"])...)
	return strings.Contains(normalizeSearchText(strings.Join(values, " ")), query)
}

func sortHermesCronJobs(jobs []map[string]any, sortBy string, sortDir string) {
	if sortBy == "" {
		sortBy = "nextRunAt"
	}
	sort.Slice(jobs, func(i, j int) bool {
		left := hermesCronSortValue(jobs[i], sortBy)
		right := hermesCronSortValue(jobs[j], sortBy)
		if sortDir == "desc" {
			return left > right
		}
		if left == "" {
			return false
		}
		if right == "" {
			return true
		}
		return left < right
	})
}

func hermesCronSortValue(job map[string]any, sortBy string) string {
	switch sortBy {
	case "name":
		return strings.ToLower(stringFromAny(job["name"]))
	case "createdAt":
		return stringFromAny(job["created_at"])
	case "updatedAt":
		return stringFromAny(job["updated_at"])
	case "lastRunAt":
		return stringFromAny(job["last_run_at"])
	default:
		return stringFromAny(job["next_run_at"])
	}
}

func runHermesCronPython(ctx context.Context, profileName string, action string, id string, body map[string]any) (json.RawMessage, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	script := `
import json
import sys
from tools.cronjob_tools import cronjob

action = sys.argv[1]
job_id = sys.argv[2]
body = json.loads(sys.argv[3] or "{}")

def compact(value):
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return value

def emit(payload):
    if isinstance(payload, str):
        print(payload)
    else:
        print(json.dumps(payload, ensure_ascii=False))

def as_int(value):
    if value is None or value == "":
        return None
    return int(value)

if action == "create":
    emit(cronjob(
        action="create",
        prompt=body.get("prompt") or "",
        schedule=body.get("schedule") or "",
        name=compact(body.get("name")),
        repeat=as_int(body.get("repeat")),
        deliver=compact(body.get("deliver")),
        skills=compact(body.get("skills")) or None,
        model=compact(body.get("model")),
        provider=compact(body.get("provider")),
        base_url=compact(body.get("baseUrl")),
        script=compact(body.get("script")),
        context_from=compact(body.get("contextFrom")),
        enabled_toolsets=compact(body.get("enabledToolsets")) or None,
        workdir=compact(body.get("workdir")),
        no_agent=bool(body.get("noAgent") or False),
    ))
elif action == "update":
    if "enabled" in body and len(body) == 1:
        emit(cronjob(action="resume" if bool(body.get("enabled")) else "pause", job_id=job_id))
    else:
        kwargs = {"action": "update", "job_id": job_id}
        mapping = {
            "prompt": "prompt",
            "name": "name",
            "schedule": "schedule",
            "repeat": "repeat",
            "deliver": "deliver",
            "skills": "skills",
            "model": "model",
            "provider": "provider",
            "baseUrl": "base_url",
            "script": "script",
            "contextFrom": "context_from",
            "enabledToolsets": "enabled_toolsets",
            "workdir": "workdir",
            "noAgent": "no_agent",
        }
        for src, dst in mapping.items():
            if src not in body:
                continue
            value = body.get(src)
            if src == "repeat":
                value = as_int(value)
            else:
                value = compact(value)
            kwargs[dst] = value
        emit(cronjob(**kwargs))
elif action == "remove":
    emit(cronjob(action="remove", job_id=job_id))
elif action == "run":
    emit(cronjob(action="run", job_id=job_id))
else:
    raise SystemExit("unknown action")
`
	profile, err := resolveHermesProfileSelection(profileName)
	if err != nil {
		return nil, err
	}
	stdout, stderr, runErr := hermesPythonCommandForProfile(ctx, 30*time.Second, profile, script, action, id, string(encoded))
	if runErr != nil {
		return nil, errors.New(strings.TrimSpace(stderr + "\n" + runErr.Error()))
	}
	trimmed := strings.TrimSpace(stdout)
	if trimmed == "" {
		return nil, errors.New("hermes cron bridge returned empty output")
	}
	if !json.Valid([]byte(trimmed)) {
		return nil, errors.New("hermes cron bridge did not return valid JSON: " + strings.TrimSpace(stderr))
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(trimmed), &payload); err == nil {
		if success, ok := payload["success"].(bool); ok && !success {
			message := firstNonEmpty(stringFromAny(payload["error"]), stringFromAny(payload["message"]), "hermes cron operation failed")
			return nil, hermesCronValidationError{message: message}
		}
	}
	return json.RawMessage(trimmed), nil
}

type hermesCronValidationError struct {
	message string
}

func (err hermesCronValidationError) Error() string {
	return err.message
}

func hermesCronHumaError(message string, err error) error {
	var validationErr hermesCronValidationError
	if errors.As(err, &validationErr) {
		return huma.Error400BadRequest(validationErr.Error(), err)
	}
	return huma.Error500InternalServerError(message, err)
}

func readHermesCronOutputEntries(outputDir string, filterJobID string, jobNames map[string]string) []map[string]any {
	entries := make([]map[string]any, 0)
	jobDirs, err := os.ReadDir(outputDir)
	if err != nil {
		return entries
	}
	for _, jobDir := range jobDirs {
		if !jobDir.IsDir() {
			continue
		}
		jobID := jobDir.Name()
		if filterJobID != "" && jobID != filterJobID {
			continue
		}
		files, err := os.ReadDir(filepath.Join(outputDir, jobID))
		if err != nil {
			continue
		}
		for _, file := range files {
			if file.IsDir() || !strings.HasSuffix(file.Name(), ".md") {
				continue
			}
			path := filepath.Join(outputDir, jobID, file.Name())
			info, statErr := file.Info()
			if statErr != nil {
				continue
			}
			contentBytes, readErr := os.ReadFile(path)
			content := ""
			if readErr == nil {
				content = string(contentBytes)
			}
			entries = append(entries, map[string]any{
				"jobId":   jobID,
				"jobName": firstNonEmpty(jobNames[jobID], jobID),
				"file":    file.Name(),
				"path":    path,
				"ts":      info.ModTime().UTC().Format(time.RFC3339),
				"status":  "ok",
				"summary": truncateString(strings.TrimSpace(content), 180),
				"content": content,
				"size":    info.Size(),
			})
		}
	}
	return entries
}

func requireHermesCronJobID(input *HermesCronJobInput) (string, error) {
	id := ""
	if input != nil {
		id = strings.TrimSpace(input.ID)
	}
	if id == "" {
		return "", huma.Error400BadRequest("cron job id is required", nil)
	}
	return id, nil
}

func rawJSONOutput(value any) (*HermesCronRawOutput, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, huma.Error500InternalServerError("encode hermes cron response failed", err)
	}
	return &HermesCronRawOutput{Body: encoded}, nil
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func stringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case bool:
		if typed {
			return "true"
		}
		return "false"
	case nil:
		return ""
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return ""
		}
		return string(encoded)
	}
}

func boolFromAny(value any, fallback bool) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "true", "1", "yes", "on":
			return true
		case "false", "0", "no", "off":
			return false
		}
	}
	return fallback
}

func intFromAny(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		number, _ := typed.Int64()
		return int(number)
	case string:
		number, _ := strconv.Atoi(strings.TrimSpace(typed))
		return number
	default:
		return 0
	}
}

func stringsFromAny(value any) []string {
	switch typed := value.(type) {
	case []string:
		return compactStrings(typed)
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := stringFromAny(item); text != "" {
				result = append(result, text)
			}
		}
		return result
	case string:
		if strings.TrimSpace(typed) == "" {
			return nil
		}
		return []string{strings.TrimSpace(typed)}
	default:
		return nil
	}
}

func firstStringFromAnySlice(value any) string {
	values := stringsFromAny(value)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func truncateString(value string, limit int) string {
	value = strings.TrimSpace(value)
	if limit <= 0 || len([]rune(value)) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit]) + "..."
}

func normalizeSearchText(value string) string {
	return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(value), "-", " "))
}
