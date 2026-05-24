package openclaw

// OpenClaw skills handlers expose the local OpenClaw skill inventory and common management actions.
//
// The read/search/install paths intentionally delegate to the OpenClaw CLI so AgentBox mirrors the
// same workspace resolution, skill-store behavior, and status output that operators see in the terminal.
// Config-only updates patch ~/.openclaw/openclaw.json directly because OpenClaw stores per-skill
// enabled/env/apiKey overrides under skills.entries.<skillKey>.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"agent-box-server/internal/httpapi/toolenv"

	"github.com/danielgtaylor/huma/v2"
)

var (
	openClawSkillsStatusCache      persistentCache[json.RawMessage]
	openClawSkillsShowcaseHotCache persistentCache[OpenClawSkillsShowcaseHotResponse]
)

const skillHubHotShowcaseURL = "https://api.skillhub.cn/api/v1/showcase/hot"

type OpenClawSkillsStatusInput struct {
	AgentID string `query:"agentId" doc:"Optional OpenClaw agent id whose workspace and allowlist should be inspected." example:"main"`
	Refresh bool   `query:"refresh" doc:"Force refresh cached OpenClaw skills status." example:"false"`
}

type OpenClawSkillsSearchInput struct {
	Query string `query:"query" doc:"Optional remote skill search query." example:"calendar"`
	Limit int    `query:"limit" minimum:"1" maximum:"100" doc:"Maximum number of search results." example:"20"`
}

type OpenClawSkillInfoInput struct {
	Name    string `path:"name" doc:"Local skill name to inspect." example:"weather"`
	AgentID string `query:"agentId" doc:"Optional OpenClaw agent id whose workspace should be inspected." example:"main"`
}

type OpenClawSkillsShowcaseHotInput struct {
	Refresh bool `query:"refresh" doc:"Force refresh cached SkillHub hot showcase." example:"false"`
}

type OpenClawSkillInstallInput struct {
	Body OpenClawSkillInstallRequest
}

type OpenClawSkillDependencyInstallInput struct {
	Body OpenClawSkillDependencyInstallRequest
}

type OpenClawSkillUpdateInput struct {
	SkillKey string `path:"skillKey" doc:"Skill key or skill name to patch under skills.entries." example:"weather"`
	Body     OpenClawSkillUpdateRequest
}

type OpenClawSkillsRawOutput struct {
	Body json.RawMessage
}

type OpenClawSkillsShowcaseHotOutput struct {
	Body OpenClawSkillsShowcaseHotResponse
}

type OpenClawSkillMutationOutput struct {
	Body OpenClawSkillMutationResponse
}

type OpenClawSkillInstallRequest struct {
	Slug    string `json:"slug" doc:"Remote skill slug to install." example:"calendar"`
	Version string `json:"version,omitempty" doc:"Optional remote skill version/tag." example:"latest"`
	Force   bool   `json:"force,omitempty" doc:"Overwrite an existing workspace skill folder for this slug." example:"false"`
	AgentID string `json:"agentId,omitempty" doc:"Optional OpenClaw agent id to install into." example:"main"`
	Source  string `json:"source,omitempty" doc:"Preferred search source for this skill." example:"skillhub"`
}

type OpenClawSkillSearchResult struct {
	Slug        string  `json:"slug,omitempty"`
	Name        string  `json:"name,omitempty"`
	Title       string  `json:"title,omitempty"`
	DisplayName string  `json:"displayName,omitempty"`
	Description string  `json:"description,omitempty"`
	Summary     string  `json:"summary,omitempty"`
	Version     *string `json:"version,omitempty"`
	Author      string  `json:"author,omitempty"`
	Homepage    string  `json:"homepage,omitempty"`
	Source      string  `json:"source,omitempty"`
}

type OpenClawSkillsShowcaseHotResponse struct {
	Section   string                     `json:"section" example:"hot_downloads" doc:"SkillHub showcase section."`
	Timestamp string                     `json:"timestamp" example:"2026-05-14T02:40:00Z" doc:"UTC response timestamp."`
	Cache     OpenClawCacheInfo          `json:"cache" doc:"Cache behavior used for this response."`
	Skills    []OpenClawShowcaseHotSkill `json:"skills" doc:"Hot SkillHub skills."`
}

type OpenClawShowcaseHotSkill struct {
	Slug          string            `json:"slug" example:"summarize"`
	Name          string            `json:"name" example:"Summarize"`
	Description   string            `json:"description,omitempty"`
	DescriptionZH string            `json:"descriptionZh,omitempty"`
	Version       string            `json:"version,omitempty"`
	OwnerName     string            `json:"ownerName,omitempty"`
	Category      string            `json:"category,omitempty"`
	Homepage      string            `json:"homepage,omitempty"`
	IconURL       string            `json:"iconUrl,omitempty"`
	Source        string            `json:"source,omitempty"`
	Downloads     int64             `json:"downloads,omitempty"`
	Installs      int64             `json:"installs,omitempty"`
	Stars         int64             `json:"stars,omitempty"`
	Score         float64           `json:"score,omitempty"`
	Tags          []string          `json:"tags,omitempty"`
	Labels        map[string]string `json:"labels,omitempty"`
	CreatedAt     int64             `json:"createdAt,omitempty"`
	UpdatedAt     int64             `json:"updatedAt,omitempty"`
}

type OpenClawSkillDependencyInstallRequest struct {
	Name                          string `json:"name" doc:"Local skill name whose installer metadata should run." example:"gemini"`
	InstallID                     string `json:"installId" doc:"Installer id from skill metadata.openclaw.install." example:"brew"`
	DangerouslyForceUnsafeInstall bool   `json:"dangerouslyForceUnsafeInstall,omitempty" doc:"Allow critical dangerous-code scanner findings. Use only after manual review." example:"false"`
	TimeoutMs                     int    `json:"timeoutMs,omitempty" minimum:"1000" maximum:"900000" doc:"Optional installer timeout in milliseconds." example:"300000"`
}

type OpenClawSkillUpdateRequest struct {
	Enabled *bool             `json:"enabled,omitempty" doc:"Enable or disable this skill via skills.entries.<skillKey>.enabled." example:"true"`
	APIKey  *string           `json:"apiKey,omitempty" doc:"Optional primary API key override. Empty string removes the stored apiKey."`
	Env     map[string]string `json:"env,omitempty" doc:"Environment variable overrides. Empty values remove individual keys."`
}

type OpenClawSkillMutationResponse struct {
	Status    string         `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string         `json:"timestamp" example:"2026-05-12T02:40:00Z" doc:"UTC response timestamp."`
	SkillKey  string         `json:"skillKey,omitempty" example:"weather" doc:"Skill key affected by the mutation."`
	Message   string         `json:"message,omitempty" doc:"Human-readable operation summary."`
	Stdout    string         `json:"stdout,omitempty" doc:"Command stdout when the operation shells out to OpenClaw CLI."`
	Stderr    string         `json:"stderr,omitempty" doc:"Command stderr when the operation shells out to OpenClaw CLI."`
	Config    map[string]any `json:"config,omitempty" doc:"Redacted per-skill config after update."`
}

func GetOpenClawSkillsStatus(ctx context.Context, input *OpenClawSkillsStatusInput) (*OpenClawSkillsRawOutput, error) {
	agentID := ""
	refresh := false
	if input != nil {
		agentID = strings.TrimSpace(input.AgentID)
		refresh = input.Refresh
	}
	payload, err := cachedOpenClawSkillsStatus(ctx, agentID, refresh)
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw skills status failed", err)
	}
	return &OpenClawSkillsRawOutput{Body: payload}, nil
}

func cachedOpenClawSkillsStatus(ctx context.Context, agentID string, refresh bool) (json.RawMessage, error) {
	key := openClawSkillsStatusCacheKey(agentID)
	return cachedPersistent(&openClawSkillsStatusCache, key, refresh, func() (json.RawMessage, error) {
		return loadOpenClawSkillsStatus(ctx, agentID)
	})
}

func loadOpenClawSkillsStatus(ctx context.Context, agentID string) (json.RawMessage, error) {
	args := []string{"skills", "list", "--json"}
	if agentID != "" {
		args = append(args, "--agent", agentID)
	}
	return openClawJSONCommandWithGatewayApprovalRetry(ctx, 15*time.Second, args...)
}

func openClawSkillsStatusCacheKey(agentID string) string {
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		return "agent="
	}
	return "agent=" + agentID
}

func invalidateOpenClawSkillsStatusCache() {
	invalidatePersistentCache(&openClawSkillsStatusCache)
}

func rebuildOpenClawSkillsStatusCache(ctx context.Context) {
	_, _ = cachedOpenClawSkillsStatus(ctx, "", true)
}

func SearchOpenClawSkills(ctx context.Context, input *OpenClawSkillsSearchInput) (*OpenClawSkillsRawOutput, error) {
	query := ""
	limit := 20
	if input != nil {
		query = strings.TrimSpace(input.Query)
		if input.Limit > 0 {
			limit = input.Limit
		}
	}

	if skillhubPath := toolenv.ResolveToolPath("skillhub"); skillhubPath != "" {
		payload, err := searchSkillHubSkills(ctx, skillhubPath, query, limit)
		if err == nil {
			return &OpenClawSkillsRawOutput{Body: payload}, nil
		}
		return nil, huma.Error500InternalServerError("skillhub skills search failed", err)
	}

	args := []string{"skills", "search", "--json"}
	if limit > 0 {
		args = append(args, "--limit", intString(limit))
	}
	if query != "" {
		args = append(args, query)
	}
	payload, err := openClawJSONCommand(ctx, 20*time.Second, args...)
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw skills search failed", err)
	}
	return &OpenClawSkillsRawOutput{Body: payload}, nil
}

func GetOpenClawSkillsShowcaseHot(ctx context.Context, input *OpenClawSkillsShowcaseHotInput) (*OpenClawSkillsShowcaseHotOutput, error) {
	refresh := false
	if input != nil {
		refresh = input.Refresh
	}
	body, err := cachedPersistent(&openClawSkillsShowcaseHotCache, "hot", refresh, func() (OpenClawSkillsShowcaseHotResponse, error) {
		return loadSkillHubHotShowcase(ctx)
	})
	if err != nil {
		return nil, huma.Error500InternalServerError("skillhub hot showcase failed", err)
	}
	body.Timestamp = time.Now().UTC().Format(time.RFC3339)
	body.Cache = OpenClawCacheInfo{Refresh: refresh}
	return &OpenClawSkillsShowcaseHotOutput{Body: body}, nil
}

func GetOpenClawSkillInfo(ctx context.Context, input *OpenClawSkillInfoInput) (*OpenClawSkillsRawOutput, error) {
	if input == nil || strings.TrimSpace(input.Name) == "" {
		return nil, huma.Error400BadRequest("skill name is required", nil)
	}
	args := []string{"skills", "info", strings.TrimSpace(input.Name), "--json"}
	if strings.TrimSpace(input.AgentID) != "" {
		args = append(args, "--agent", strings.TrimSpace(input.AgentID))
	}
	payload, err := openClawJSONCommand(ctx, 15*time.Second, args...)
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw skill info failed", err)
	}
	payload = enrichOpenClawSkillInfoContent(payload)
	return &OpenClawSkillsRawOutput{Body: payload}, nil
}

func enrichOpenClawSkillInfoContent(payload json.RawMessage) json.RawMessage {
	var skill map[string]any
	if err := json.Unmarshal(payload, &skill); err != nil {
		return payload
	}
	filePath, _ := skill["filePath"].(string)
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		return payload
	}
	content, err := os.ReadFile(filePath)
	if err != nil {
		skill["skillContentError"] = err.Error()
	} else {
		skill["skillContent"] = string(content)
	}
	encoded, err := json.Marshal(skill)
	if err != nil {
		return payload
	}
	return json.RawMessage(encoded)
}

func InstallOpenClawSkill(ctx context.Context, input *OpenClawSkillInstallInput) (*OpenClawSkillMutationOutput, error) {
	if input == nil || strings.TrimSpace(input.Body.Slug) == "" {
		return nil, huma.Error400BadRequest("skill slug is required", nil)
	}
	slug := strings.TrimSpace(input.Body.Slug)
	useSkillHub := strings.EqualFold(strings.TrimSpace(input.Body.Source), "skillhub") || toolenv.ResolveToolPath("skillhub") != ""
	if useSkillHub {
		stdout, stderr, err := installSkillHubOpenClawSkill(ctx, input.Body)
		if err != nil {
			return nil, huma.Error500InternalServerError("skillhub skill install failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidateOpenClawSkillsStatusCache()
		rebuildOpenClawSkillsStatusCache(ctx)
		return &OpenClawSkillMutationOutput{Body: OpenClawSkillMutationResponse{
			Status:    "ok",
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			SkillKey:  slug,
			Message:   "Skill installed from SkillHub",
			Stdout:    stdout,
			Stderr:    stderr,
		}}, nil
	}

	args := []string{"skills", "install", slug}
	if strings.TrimSpace(input.Body.Version) != "" {
		args = append(args, "--version", strings.TrimSpace(input.Body.Version))
	}
	if input.Body.Force {
		args = append(args, "--force")
	}
	if strings.TrimSpace(input.Body.AgentID) != "" {
		args = append(args, "--agent", strings.TrimSpace(input.Body.AgentID))
	}
	stdout, stderr, err := openClawCommand(ctx, 2*time.Minute, args...)
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw skill install failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
	}
	invalidateOpenClawSkillsStatusCache()
	rebuildOpenClawSkillsStatusCache(ctx)
	return &OpenClawSkillMutationOutput{Body: OpenClawSkillMutationResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		SkillKey:  slug,
		Message:   "Skill installed",
		Stdout:    stdout,
		Stderr:    stderr,
	}}, nil
}

func InstallOpenClawSkillDependency(ctx context.Context, input *OpenClawSkillDependencyInstallInput) (*OpenClawSkillMutationOutput, error) {
	if input == nil || strings.TrimSpace(input.Body.Name) == "" {
		return nil, huma.Error400BadRequest("skill name is required", nil)
	}
	if strings.TrimSpace(input.Body.InstallID) == "" {
		return nil, huma.Error400BadRequest("install id is required", nil)
	}

	params := map[string]any{
		"name":      strings.TrimSpace(input.Body.Name),
		"installId": strings.TrimSpace(input.Body.InstallID),
	}
	if input.Body.DangerouslyForceUnsafeInstall {
		params["dangerouslyForceUnsafeInstall"] = true
	}
	timeoutMs := input.Body.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = int((15 * time.Minute).Milliseconds())
	}
	params["timeoutMs"] = timeoutMs
	encodedParams, err := json.Marshal(params)
	if err != nil {
		return nil, huma.Error400BadRequest("skill dependency install params must be valid JSON", err)
	}

	stdout, stderr, err := openClawCommand(ctx, time.Duration(timeoutMs)*time.Millisecond+30*time.Second, "gateway", "call", "skills.install", "--json", "--timeout", intString(timeoutMs), "--params", string(encodedParams))
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw skill dependency install failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
	}
	invalidateOpenClawSkillsStatusCache()
	rebuildOpenClawSkillsStatusCache(ctx)
	return &OpenClawSkillMutationOutput{Body: OpenClawSkillMutationResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		SkillKey:  strings.TrimSpace(input.Body.Name),
		Message:   "Skill dependency installer finished",
		Stdout:    stdout,
		Stderr:    stderr,
	}}, nil
}

func UpdateOpenClawSkill(ctx context.Context, input *OpenClawSkillUpdateInput) (*OpenClawSkillMutationOutput, error) {
	if input == nil || strings.TrimSpace(input.SkillKey) == "" {
		return nil, huma.Error400BadRequest("skill key is required", nil)
	}
	configPath := openClawConfigPath()
	content, exists, err := readOpenClawConfigFile(configPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, huma.Error500InternalServerError("read openclaw config failed", err)
	}
	if !exists || content == nil {
		content = map[string]any{}
	}

	skills := objectMap(content["skills"])
	entries := objectMap(skills["entries"])
	skillKey := strings.TrimSpace(input.SkillKey)
	current := objectMap(entries[skillKey])

	if input.Body.Enabled != nil {
		current["enabled"] = *input.Body.Enabled
	}
	if input.Body.APIKey != nil {
		apiKey := strings.TrimSpace(*input.Body.APIKey)
		if apiKey == "" {
			delete(current, "apiKey")
		} else {
			current["apiKey"] = apiKey
		}
	}
	if input.Body.Env != nil {
		env := stringObjectMap(current["env"])
		for key, value := range input.Body.Env {
			trimmedKey := strings.TrimSpace(key)
			if trimmedKey == "" {
				continue
			}
			trimmedValue := strings.TrimSpace(value)
			if trimmedValue == "" {
				delete(env, trimmedKey)
			} else {
				env[trimmedKey] = trimmedValue
			}
		}
		if len(env) == 0 {
			delete(current, "env")
		} else {
			current["env"] = env
		}
	}

	entries[skillKey] = current
	skills["entries"] = entries
	content["skills"] = skills

	formatted, err := json.MarshalIndent(content, "", "  ")
	if err != nil {
		return nil, huma.Error400BadRequest("openclaw config content must be valid JSON", err)
	}
	formatted = append(formatted, '\n')
	if err := os.WriteFile(configPath, formatted, 0o600); err != nil {
		return nil, huma.Error500InternalServerError("write openclaw config failed", err)
	}

	invalidateOpenClawSkillsStatusCache()
	rebuildOpenClawSkillsStatusCache(ctx)

	return &OpenClawSkillMutationOutput{Body: OpenClawSkillMutationResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		SkillKey:  skillKey,
		Message:   "Skill config updated",
		Config:    redactOpenClawSkillConfig(current),
	}}, nil
}

func openClawJSONCommand(ctx context.Context, timeout time.Duration, args ...string) (json.RawMessage, error) {
	stdout, stderr, err := openClawCommand(ctx, timeout, args...)
	if err != nil {
		return nil, errors.New(strings.TrimSpace(stderr + "\n" + err.Error()))
	}
	trimmedStdout := strings.TrimSpace(stdout)
	payload := json.RawMessage(trimmedStdout)
	if !json.Valid(payload) {
		diagnostic := strings.TrimSpace(strings.Join([]string{strings.TrimSpace(stderr), trimmedStdout}, "\n"))
		if diagnostic == "" {
			diagnostic = "empty stdout and stderr"
		}
		return nil, errors.New("openclaw command did not return valid JSON: " + diagnostic)
	}
	return payload, nil
}

func openClawJSONCommandWithGatewayApprovalRetry(ctx context.Context, timeout time.Duration, args ...string) (json.RawMessage, error) {
	payload, err := openClawJSONCommand(ctx, timeout, args...)
	if err == nil {
		return payload, nil
	}
	if !openClawGatewayDeviceApprovalLikelyNeeded(err) {
		return nil, err
	}
	result, approveErr := autoApproveOpenClawGatewayDevices(ctx, nil)
	if approveErr != nil || result.Approved == 0 {
		if approveErr != nil {
			return nil, errors.New(strings.TrimSpace(err.Error() + "\nGateway device auto-approval failed: " + approveErr.Error()))
		}
		return nil, err
	}
	return openClawJSONCommand(ctx, timeout, args...)
}

func openClawGatewayDeviceApprovalLikelyNeeded(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "scope upgrade pending approval") ||
		strings.Contains(message, "pairing required") ||
		strings.Contains(message, "pending approval") ||
		strings.Contains(message, "device is asking for more scopes")
}

func openClawCommand(ctx context.Context, timeout time.Duration, args ...string) (string, string, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	path := toolenv.ResolveToolPath("openclaw")
	if path == "" {
		path = "openclaw"
	}
	cmd := exec.CommandContext(cmdCtx, path, args...)
	cmd.Env = toolenv.CommandEnv()
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

func objectMap(value any) map[string]any {
	if existing, ok := value.(map[string]any); ok && existing != nil {
		return existing
	}
	return map[string]any{}
}

func stringObjectMap(value any) map[string]string {
	result := map[string]string{}
	if existing, ok := value.(map[string]any); ok {
		for key, value := range existing {
			if str, ok := value.(string); ok {
				result[key] = str
			}
		}
	}
	if existing, ok := value.(map[string]string); ok {
		for key, value := range existing {
			result[key] = value
		}
	}
	return result
}

func searchSkillHubSkills(ctx context.Context, path, query string, limit int) (json.RawMessage, error) {
	if strings.TrimSpace(query) == "" {
		encoded, err := json.Marshal(struct {
			Source  string                      `json:"source"`
			Results []OpenClawSkillSearchResult `json:"results"`
		}{
			Source:  "skillhub",
			Results: []OpenClawSkillSearchResult{},
		})
		if err != nil {
			return nil, err
		}
		return json.RawMessage(encoded), nil
	}

	args := []string{"--skip-self-upgrade", "search", "--json", "--search-limit", intString(limit)}
	if query != "" {
		args = append(args, strings.Fields(query)...)
	}
	stdout, stderr, err := runSkillHubCommand(ctx, 20*time.Second, path, args...)
	if err != nil {
		return nil, errors.New(strings.TrimSpace(stderr + "\n" + err.Error()))
	}

	var payload struct {
		Query   string                      `json:"query,omitempty"`
		Count   int                         `json:"count,omitempty"`
		Results []OpenClawSkillSearchResult `json:"results,omitempty"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(stdout)), &payload); err != nil {
		return nil, errors.New("skillhub search did not return valid JSON: " + strings.TrimSpace(stderr))
	}
	for index := range payload.Results {
		payload.Results[index].Source = "skillhub"
	}

	if payload.Results == nil {
		payload.Results = []OpenClawSkillSearchResult{}
	}
	output := struct {
		Source  string                      `json:"source"`
		Query   string                      `json:"query,omitempty"`
		Count   int                         `json:"count,omitempty"`
		Results []OpenClawSkillSearchResult `json:"results"`
	}{
		Source:  "skillhub",
		Query:   payload.Query,
		Count:   payload.Count,
		Results: payload.Results,
	}
	encoded, err := json.Marshal(output)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(encoded), nil
}

func installSkillHubOpenClawSkill(ctx context.Context, request OpenClawSkillInstallRequest) (string, string, error) {
	path := toolenv.ResolveToolPath("skillhub")
	if path == "" {
		return "", "", errors.New("skillhub CLI is not installed")
	}
	installDir, err := openClawSkillsInstallDir(ctx, request.AgentID)
	if err != nil {
		return "", "", err
	}
	args := []string{"--skip-self-upgrade", "--dir", installDir, "install"}
	if request.Force {
		args = append(args, "--force")
	}
	args = append(args, strings.TrimSpace(request.Slug))
	return runSkillHubCommand(ctx, 2*time.Minute, path, args...)
}

func openClawSkillsInstallDir(ctx context.Context, agentID string) (string, error) {
	statusPayload, err := cachedOpenClawSkillsStatus(ctx, strings.TrimSpace(agentID), false)
	if err != nil {
		return "", err
	}
	var status struct {
		ManagedSkillsDir string `json:"managedSkillsDir"`
		WorkspaceDir     string `json:"workspaceDir"`
	}
	if err := json.Unmarshal(statusPayload, &status); err != nil {
		return "", err
	}
	if dir := strings.TrimSpace(status.ManagedSkillsDir); dir != "" {
		return dir, nil
	}
	if dir := strings.TrimSpace(status.WorkspaceDir); dir != "" {
		return filepath.Join(dir, "skills"), nil
	}
	return "", errors.New("openclaw managed skills dir is unavailable")
}

func runSkillHubCommand(ctx context.Context, timeout time.Duration, path string, args ...string) (string, string, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, path, args...)
	cmd.Env = toolenv.CommandEnv()
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

func loadSkillHubHotShowcase(ctx context.Context) (OpenClawSkillsShowcaseHotResponse, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, skillHubHotShowcaseURL, nil)
	if err != nil {
		return OpenClawSkillsShowcaseHotResponse{}, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return OpenClawSkillsShowcaseHotResponse{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return OpenClawSkillsShowcaseHotResponse{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return OpenClawSkillsShowcaseHotResponse{}, errors.New("skillhub showcase returned " + resp.Status)
	}

	var payload struct {
		Section string `json:"section"`
		Skills  []struct {
			Slug          string            `json:"slug"`
			Name          string            `json:"name"`
			Description   string            `json:"description"`
			DescriptionZH string            `json:"description_zh"`
			Version       string            `json:"version"`
			OwnerName     string            `json:"ownerName"`
			Category      string            `json:"category"`
			Homepage      string            `json:"homepage"`
			IconURL       string            `json:"iconUrl"`
			Source        string            `json:"source"`
			Downloads     int64             `json:"downloads"`
			Installs      int64             `json:"installs"`
			Stars         int64             `json:"stars"`
			Score         float64           `json:"score"`
			Tags          []string          `json:"tags"`
			Labels        map[string]string `json:"labels"`
			CreatedAt     int64             `json:"created_at"`
			UpdatedAt     int64             `json:"updated_at"`
		} `json:"skills"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return OpenClawSkillsShowcaseHotResponse{}, err
	}

	skills := make([]OpenClawShowcaseHotSkill, 0, len(payload.Skills))
	for _, skill := range payload.Skills {
		slug := strings.TrimSpace(skill.Slug)
		if slug == "" {
			continue
		}
		skills = append(skills, OpenClawShowcaseHotSkill{
			Slug:          slug,
			Name:          strings.TrimSpace(skill.Name),
			Description:   strings.TrimSpace(skill.Description),
			DescriptionZH: strings.TrimSpace(skill.DescriptionZH),
			Version:       strings.TrimSpace(skill.Version),
			OwnerName:     strings.TrimSpace(skill.OwnerName),
			Category:      strings.TrimSpace(skill.Category),
			Homepage:      strings.TrimSpace(skill.Homepage),
			IconURL:       strings.TrimSpace(skill.IconURL),
			Source:        strings.TrimSpace(skill.Source),
			Downloads:     skill.Downloads,
			Installs:      skill.Installs,
			Stars:         skill.Stars,
			Score:         skill.Score,
			Tags:          skill.Tags,
			Labels:        skill.Labels,
			CreatedAt:     skill.CreatedAt,
			UpdatedAt:     skill.UpdatedAt,
		})
	}

	section := strings.TrimSpace(payload.Section)
	if section == "" {
		section = "hot_downloads"
	}
	return OpenClawSkillsShowcaseHotResponse{
		Section:   section,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Cache:     OpenClawCacheInfo{Refresh: true},
		Skills:    skills,
	}, nil
}

func redactOpenClawSkillConfig(config map[string]any) map[string]any {
	redacted := map[string]any{}
	for key, value := range config {
		if key == "apiKey" {
			redacted[key] = "********"
			continue
		}
		if key == "env" {
			redactedEnv := map[string]any{}
			for envKey := range stringObjectMap(value) {
				redactedEnv[envKey] = "********"
			}
			redacted[key] = redactedEnv
			continue
		}
		redacted[key] = value
	}
	return redacted
}

func intString(value int) string {
	return strings.TrimSpace(strings.ReplaceAll(jsonNumber(value), "\"", ""))
}

func jsonNumber(value int) string {
	data, _ := json.Marshal(value)
	return string(data)
}
