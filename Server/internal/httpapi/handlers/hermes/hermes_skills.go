package hermes

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"agent-box-server/internal/httpapi/toolenv"

	"github.com/danielgtaylor/huma/v2"
)

var hermesSkillsCache cacheMap[HermesSkillsResponse]

const hermesSkillHubHotShowcaseURL = "https://api.skillhub.cn/api/v1/showcase/hot"

type HermesSkillsInput struct {
	Refresh bool   `query:"refresh" doc:"Force refresh cached Hermes skill inventory." example:"false"`
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
}

type HermesSkillToggleInput struct {
	Name    string `path:"name" doc:"Hermes skill name to enable or disable." example:"apple-notes"`
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	Body    HermesSkillToggleRequest
}

type HermesSkillDetailInput struct {
	Name    string `path:"name" doc:"Hermes skill name to inspect." example:"apple-notes"`
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
}

type HermesSkillsSearchInput struct {
	Query  string `query:"query" doc:"Search query for Hermes Skills Hub." example:"react"`
	Source string `query:"source" doc:"Skill source filter: all, official, skills-sh, well-known, github, clawhub, claude-marketplace, lobehub." example:"official"`
	Limit  int    `query:"limit" minimum:"1" maximum:"100" doc:"Maximum number of search results." example:"20"`
}

type HermesSkillsDiscoverInput struct {
	Refresh bool   `query:"refresh" doc:"Force refresh cached Hermes Skills Hub discovery." example:"false"`
	Source  string `query:"source" doc:"Skill source filter for discovery." example:"official"`
	Limit   int    `query:"limit" minimum:"1" maximum:"100" doc:"Maximum number of discover results." example:"24"`
}

type HermesSkillInstallInput struct {
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	Body    HermesSkillInstallRequest
}

type HermesSkillsOutput struct {
	Body HermesSkillsResponse
}

type HermesSkillsSearchOutput struct {
	Body HermesSkillsSearchResponse
}

type HermesSkillsDiscoverOutput struct {
	Body HermesSkillsDiscoverResponse
}

type HermesSkillDetailOutput struct {
	Body HermesSkillDetailResponse
}

type HermesSkillInstallOutput struct {
	Body HermesSkillInstallResponse
}

type HermesSkillMutationOutput struct {
	Body HermesSkillMutationResponse
}

type HermesSkillsResponse struct {
	Status     string                    `json:"status" example:"ok" doc:"Operation status."`
	Timestamp  string                    `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Cache      HermesCacheInfo           `json:"cache" doc:"Cache behavior used for this response."`
	HomePath   string                    `json:"homePath" example:"/Users/one/.hermes" doc:"Hermes home directory."`
	SkillsDir  string                    `json:"skillsDir" example:"/Users/one/.hermes/skills" doc:"Primary Hermes skills directory."`
	Config     HermesSkillsConfig        `json:"config" doc:"Hermes skills config summary."`
	Summary    HermesSkillsSummary       `json:"summary" doc:"Skill inventory summary."`
	Categories []HermesSkillCategoryInfo `json:"categories" doc:"Skill category descriptions from DESCRIPTION.md."`
	Skills     []HermesSkillInfo         `json:"skills" doc:"Installed Hermes skills."`
	Errors     []string                  `json:"errors,omitempty" doc:"Non-fatal scan errors."`
}

type HermesSkillsConfig struct {
	Path                string   `json:"path" example:"/Users/one/.hermes/config.yaml" doc:"Hermes config.yaml path."`
	Exists              bool     `json:"exists" example:"true" doc:"Whether config.yaml exists."`
	Disabled            []string `json:"disabled" doc:"Globally disabled skill names."`
	ExternalDirs        []string `json:"externalDirs" doc:"Extra skill roots from skills.external_dirs."`
	PlatformDisabled    []string `json:"platformDisabled" doc:"Platform-specific disabled entries flattened as platform:name."`
	Toolsets            []string `json:"toolsets" doc:"Top-level CLI toolsets from config.yaml."`
	DisabledToolsets    []string `json:"disabledToolsets" doc:"Globally disabled toolsets from agent.disabled_toolsets."`
	SkillToolsetEnabled bool     `json:"skillToolsetEnabled" example:"true" doc:"Whether the configured CLI toolsets expose Hermes skill tools."`
	TemplateVars        bool     `json:"templateVars" example:"true" doc:"skills.template_vars when detected."`
	InlineShell         bool     `json:"inlineShell" example:"false" doc:"skills.inline_shell when detected."`
	InlineShellTimeout  string   `json:"inlineShellTimeout,omitempty" example:"10" doc:"skills.inline_shell_timeout when detected."`
	GuardAgentCreated   bool     `json:"guardAgentCreated" example:"false" doc:"skills.guard_agent_created when detected."`
	LiveReloadHint      string   `json:"liveReloadHint" doc:"How live Hermes sessions pick up changes."`
	Error               string   `json:"error,omitempty" doc:"Config read or parse error when any."`
}

type HermesSkillsSummary struct {
	Total          int            `json:"total" example:"87" doc:"Total scanned skills."`
	Enabled        int            `json:"enabled" example:"87" doc:"Enabled skills."`
	Disabled       int            `json:"disabled" example:"0" doc:"Disabled skills."`
	Bundled        int            `json:"bundled" example:"87" doc:"Skills listed in .bundled_manifest."`
	Custom         int            `json:"custom" example:"1" doc:"Skills not listed in bundled or hub manifests."`
	External       int            `json:"external" example:"0" doc:"Skills loaded from external_dirs."`
	Categories     map[string]int `json:"categories" doc:"Skill count by category."`
	SourceCounts   map[string]int `json:"sourceCounts" doc:"Skill count by source classification."`
	SupportingFile int            `json:"supportingFileCount" example:"12" doc:"Total supporting files found in common skill subfolders."`
}

type HermesSkillCategoryInfo struct {
	Name        string `json:"name" example:"apple" doc:"Category name."`
	Description string `json:"description,omitempty" doc:"Category description from DESCRIPTION.md."`
	Path        string `json:"path,omitempty" doc:"DESCRIPTION.md path."`
}

type HermesSkillInfo struct {
	Name                 string                    `json:"name" example:"apple-notes" doc:"Skill name."`
	Description          string                    `json:"description,omitempty" doc:"Skill frontmatter description."`
	Category             string                    `json:"category,omitempty" example:"apple" doc:"Category derived from metadata or directory."`
	Path                 string                    `json:"path" doc:"SKILL.md path."`
	SkillDir             string                    `json:"skillDir" doc:"Skill directory path."`
	RelativePath         string                    `json:"relativePath" example:"apple/apple-notes/SKILL.md" doc:"Path relative to the scanned skill root."`
	Root                 string                    `json:"root" doc:"Scanned root containing this skill."`
	Source               string                    `json:"source" example:"bundled" doc:"Source classification: bundled, hub, external, custom, or unknown."`
	Enabled              bool                      `json:"enabled" example:"true" doc:"Whether skill is enabled globally."`
	Disabled             bool                      `json:"disabled" example:"false" doc:"Whether skill is globally disabled."`
	Bundled              bool                      `json:"bundled" example:"true" doc:"Whether skill is listed in .bundled_manifest."`
	ToolsetEnabled       bool                      `json:"toolsetEnabled" example:"true" doc:"Whether configured CLI toolsets expose skill tools."`
	Platforms            []string                  `json:"platforms,omitempty" doc:"Supported platforms from frontmatter."`
	Tags                 []string                  `json:"tags,omitempty" doc:"Hermes tags from metadata.hermes.tags."`
	RelatedSkills        []string                  `json:"relatedSkills,omitempty" doc:"Related skills from metadata.hermes.related_skills."`
	ConfigKeys           []string                  `json:"configKeys,omitempty" doc:"Configuration keys detected under metadata.hermes.config."`
	PrerequisiteCommands []string                  `json:"prerequisiteCommands,omitempty" doc:"Commands detected under prerequisites.commands."`
	SupportingFiles      []HermesSkillSupportGroup `json:"supportingFiles" doc:"Common supporting files grouped by folder."`
}

type HermesSkillSupportGroup struct {
	Name  string   `json:"name" example:"references" doc:"Supporting folder name."`
	Count int      `json:"count" example:"2" doc:"Number of files."`
	Files []string `json:"files" doc:"Relative file names."`
}

type HermesSkillToggleRequest struct {
	Enabled bool `json:"enabled" doc:"Desired enabled state for the skill." example:"true"`
}

type HermesSkillInstallRequest struct {
	Identifier string `json:"identifier" doc:"Skills Hub identifier or direct SKILL.md URL." example:"official/security/1password"`
	Category   string `json:"category,omitempty" doc:"Optional target category folder." example:"security"`
	Name       string `json:"name,omitempty" doc:"Optional skill name override for direct URL installs." example:"my-skill"`
	Force      bool   `json:"force,omitempty" doc:"Pass --force to Hermes skills install." example:"false"`
	Source     string `json:"source,omitempty" doc:"Preferred install source: skillhub or hermes." example:"skillhub"`
}

type HermesSkillsSearchResponse struct {
	Status    string                 `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                 `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Query     string                 `json:"query" doc:"Search query."`
	Source    string                 `json:"source" example:"skillhub" doc:"Source used for search."`
	Results   []HermesSkillHubResult `json:"results" doc:"Search results from Hermes Skills Hub."`
}

type HermesSkillsDiscoverResponse struct {
	Status    string                 `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                 `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Cache     HermesCacheInfo        `json:"cache" doc:"Cache behavior used for this response."`
	Source    string                 `json:"source" example:"skillhub" doc:"Source used for discovery."`
	Skills    []HermesSkillHubResult `json:"skills" doc:"Discoverable skills from Hermes Skills Hub."`
}

type HermesSkillHubResult struct {
	Identifier  string         `json:"identifier" example:"official/security/1password" doc:"Install identifier for this skill."`
	Name        string         `json:"name" example:"1password" doc:"Skill name."`
	Description string         `json:"description,omitempty" doc:"Skill description."`
	Source      string         `json:"source" example:"skillhub" doc:"Source registry."`
	TrustLevel  string         `json:"trustLevel,omitempty" example:"builtin" doc:"Trust level returned by Hermes."`
	Repo        string         `json:"repo,omitempty" doc:"Repository when available."`
	Path        string         `json:"path,omitempty" doc:"Source path when available."`
	Tags        []string       `json:"tags,omitempty" doc:"Skill tags when available."`
	Extra       map[string]any `json:"extra,omitempty" doc:"Extra upstream metadata when available."`
}

type HermesSkillMutationResponse struct {
	Status    string          `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string          `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Skill     HermesSkillInfo `json:"skill" doc:"Updated skill snapshot."`
	Message   string          `json:"message" doc:"Human-readable mutation result."`
}

type HermesSkillDetailResponse struct {
	Status    string          `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string          `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Skill     HermesSkillInfo `json:"skill" doc:"Skill metadata."`
	Content   string          `json:"content" doc:"Raw SKILL.md content."`
}

type HermesSkillInstallResponse struct {
	Status     string           `json:"status" example:"ok" doc:"Operation status."`
	Timestamp  string           `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Identifier string           `json:"identifier" example:"official/security/1password" doc:"Installed identifier."`
	SkillName  string           `json:"skillName,omitempty" example:"1password" doc:"Installed skill name when detected."`
	Message    string           `json:"message" doc:"Human-readable operation result."`
	Stdout     string           `json:"stdout,omitempty" doc:"Hermes CLI stdout."`
	Stderr     string           `json:"stderr,omitempty" doc:"Hermes CLI stderr."`
	Skill      *HermesSkillInfo `json:"skill,omitempty" doc:"Installed skill snapshot when detected."`
}

func ListHermesSkills(ctx context.Context, input *HermesSkillsInput) (*HermesSkillsOutput, error) {
	if input == nil {
		input = &HermesSkillsInput{}
	}
	profile, err := resolveHermesProfileSelection(input.Profile)
	if err != nil {
		return nil, err
	}
	body := cachedByKey(&hermesSkillsCache, profile.Name, 10*time.Second, input.Refresh, func() HermesSkillsResponse {
		return scanHermesSkills(profile)
	})
	body.Timestamp = time.Now().UTC().Format(time.RFC3339)
	body.Cache = HermesCacheInfo{Refresh: input.Refresh}
	return &HermesSkillsOutput{Body: body}, nil
}

func GetHermesSkill(ctx context.Context, input *HermesSkillDetailInput) (*HermesSkillDetailOutput, error) {
	if input == nil || strings.TrimSpace(input.Name) == "" {
		return nil, huma.Error400BadRequest("skill name is required", nil)
	}
	name := strings.TrimSpace(input.Name)
	profile, err := resolveHermesProfileSelection(input.Profile)
	if err != nil {
		return nil, err
	}
	snapshot := scanHermesSkills(profile)
	for _, skill := range snapshot.Skills {
		if skill.Name != name {
			continue
		}
		content, err := os.ReadFile(skill.Path)
		if err != nil {
			return nil, huma.Error500InternalServerError("read hermes skill failed", err)
		}
		return &HermesSkillDetailOutput{Body: HermesSkillDetailResponse{
			Status:    "ok",
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Skill:     skill,
			Content:   string(content),
		}}, nil
	}
	return nil, huma.Error404NotFound("hermes skill not found", nil)
}

func ToggleHermesSkill(ctx context.Context, input *HermesSkillToggleInput) (*HermesSkillMutationOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("skill toggle payload is required", nil)
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return nil, huma.Error400BadRequest("skill name is required", nil)
	}

	profile, err := resolveHermesProfileSelection(input.Profile)
	if err != nil {
		return nil, err
	}
	current := scanHermesSkills(profile)
	found := false
	for _, skill := range current.Skills {
		if skill.Name == name {
			found = true
			break
		}
	}
	if !found {
		return nil, huma.Error404NotFound("hermes skill not found", nil)
	}

	configPath := filepath.Join(profile.Path, "config.yaml")
	contentBytes, err := os.ReadFile(configPath)
	if err != nil && !os.IsNotExist(err) {
		return nil, huma.Error500InternalServerError("read hermes config failed", err)
	}
	config := parseHermesSkillsConfig(string(contentBytes), configPath, !os.IsNotExist(err))
	disabled := stringSet(config.Disabled)
	if input.Body.Enabled {
		delete(disabled, name)
	} else {
		disabled[name] = true
	}

	updated := updateHermesDisabledSkills(string(contentBytes), sortedKeys(disabled))
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		return nil, huma.Error500InternalServerError("create hermes config directory failed", err)
	}
	if err := os.WriteFile(configPath, []byte(updated), 0o600); err != nil {
		return nil, huma.Error500InternalServerError("write hermes config failed", err)
	}

	invalidateHermesEnvironmentCache()
	invalidateHermesSkillsCache()
	snapshot := scanHermesSkills(profile)
	for _, skill := range snapshot.Skills {
		if skill.Name == name {
			return &HermesSkillMutationOutput{Body: HermesSkillMutationResponse{
				Status:    "ok",
				Timestamp: time.Now().UTC().Format(time.RFC3339),
				Skill:     skill,
				Message:   boolMessage(input.Body.Enabled, "Hermes skill enabled.", "Hermes skill disabled."),
			}}, nil
		}
	}

	return nil, huma.Error404NotFound("hermes skill not found", nil)
}

func ReloadHermesSkills(ctx context.Context, input *HermesProfileQueryInput) (*HermesSkillsOutput, error) {
	profile := ""
	if input != nil {
		profile = input.Profile
	}
	invalidateHermesSkillsCache()
	return ListHermesSkills(ctx, &HermesSkillsInput{Refresh: true, Profile: profile})
}

func SearchHermesSkills(ctx context.Context, input *HermesSkillsSearchInput) (*HermesSkillsSearchOutput, error) {
	query := ""
	source := "all"
	limit := 20
	if input != nil {
		query = strings.TrimSpace(input.Query)
		if strings.TrimSpace(input.Source) != "" {
			source = strings.TrimSpace(input.Source)
		}
		if input.Limit > 0 {
			limit = input.Limit
		}
	}
	if skillhubPath := toolenv.ResolveToolPath("skillhub"); skillhubPath != "" && hermesShouldUseSkillHub(source) {
		results, err := searchHermesSkillHubCLI(ctx, skillhubPath, query, limit)
		if err == nil {
			return &HermesSkillsSearchOutput{Body: HermesSkillsSearchResponse{
				Status:    "ok",
				Timestamp: time.Now().UTC().Format(time.RFC3339),
				Query:     query,
				Source:    "skillhub",
				Results:   results,
			}}, nil
		}
		if strings.TrimSpace(query) != "" {
			return nil, huma.Error500InternalServerError("skillhub skills search failed", err)
		}
	}
	results, err := runHermesSkillsHubSearch(ctx, query, source, limit)
	if err != nil {
		return nil, huma.Error500InternalServerError("hermes skills search failed", err)
	}
	return &HermesSkillsSearchOutput{Body: HermesSkillsSearchResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Query:     query,
		Source:    source,
		Results:   results,
	}}, nil
}

func DiscoverHermesSkills(ctx context.Context, input *HermesSkillsDiscoverInput) (*HermesSkillsDiscoverOutput, error) {
	source := "skillhub"
	limit := 24
	refresh := false
	if input != nil {
		refresh = input.Refresh
		if strings.TrimSpace(input.Source) != "" {
			source = strings.TrimSpace(input.Source)
		}
		if input.Limit > 0 {
			limit = input.Limit
		}
	}
	if skillhubPath := toolenv.ResolveToolPath("skillhub"); skillhubPath != "" && hermesShouldUseSkillHub(source) {
		results, err := loadHermesSkillHubHotShowcase(ctx, limit)
		if err == nil {
			return &HermesSkillsDiscoverOutput{Body: HermesSkillsDiscoverResponse{
				Status:    "ok",
				Timestamp: time.Now().UTC().Format(time.RFC3339),
				Cache:     HermesCacheInfo{Refresh: refresh},
				Source:    "skillhub",
				Skills:    results,
			}}, nil
		}
	}
	if strings.EqualFold(source, "skillhub") {
		source = "official"
	}
	results, err := runHermesSkillsHubSearch(ctx, "", source, limit)
	if err != nil {
		return nil, huma.Error500InternalServerError("hermes skills discover failed", err)
	}
	return &HermesSkillsDiscoverOutput{Body: HermesSkillsDiscoverResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Cache:     HermesCacheInfo{Refresh: refresh},
		Source:    source,
		Skills:    results,
	}}, nil
}

func InstallHermesSkill(ctx context.Context, input *HermesSkillInstallInput) (*HermesSkillInstallOutput, error) {
	if input == nil || strings.TrimSpace(input.Body.Identifier) == "" {
		return nil, huma.Error400BadRequest("skill identifier is required", nil)
	}
	identifier := strings.TrimSpace(input.Body.Identifier)
	profile, err := resolveHermesProfileSelection(input.Profile)
	if err != nil {
		return nil, err
	}
	if hermesInstallShouldUseSkillHub(input.Body.Source, identifier) {
		stdout, stderr, err := installHermesSkillHubCLI(ctx, profile, input.Body)
		if err != nil {
			return nil, huma.Error500InternalServerError("skillhub skill install failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
		invalidateHermesSkillsCache()
		snapshot := scanHermesSkills(profile)
		skill := findHermesInstalledSkill(snapshot.Skills, identifier, input.Body.Name, stdout)
		skillName := ""
		if skill != nil {
			skillName = skill.Name
		}
		return &HermesSkillInstallOutput{Body: HermesSkillInstallResponse{
			Status:     "ok",
			Timestamp:  time.Now().UTC().Format(time.RFC3339),
			Identifier: identifier,
			SkillName:  skillName,
			Message:    "Hermes skill installed from SkillHub. Running Hermes TUI sessions may need /reload-skills.",
			Stdout:     stdout,
			Stderr:     stderr,
			Skill:      skill,
		}}, nil
	}
	args := []string{"skills", "install", "--yes"}
	if strings.TrimSpace(input.Body.Category) != "" {
		args = append(args, "--category", strings.TrimSpace(input.Body.Category))
	}
	if strings.TrimSpace(input.Body.Name) != "" {
		args = append(args, "--name", strings.TrimSpace(input.Body.Name))
	}
	if input.Body.Force {
		args = append(args, "--force")
	}
	args = append(args, identifier)
	stdout, stderr, err := hermesCommandWithProfile(ctx, 3*time.Minute, profile.Name, args...)
	if err != nil {
		return nil, huma.Error500InternalServerError("hermes skill install failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
	}

	invalidateHermesSkillsCache()
	snapshot := scanHermesSkills(profile)
	skill := findHermesInstalledSkill(snapshot.Skills, identifier, input.Body.Name, stdout)
	skillName := ""
	if skill != nil {
		skillName = skill.Name
	}
	return &HermesSkillInstallOutput{Body: HermesSkillInstallResponse{
		Status:     "ok",
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		Identifier: identifier,
		SkillName:  skillName,
		Message:    "Hermes skill installed. Running Hermes TUI sessions may need /reload-skills.",
		Stdout:     stdout,
		Stderr:     stderr,
		Skill:      skill,
	}}, nil
}

func invalidateHermesSkillsCache() {
	invalidateCacheMap(&hermesSkillsCache)
	invalidateHermesEnvironmentCache()
}

func runHermesSkillsHubSearch(ctx context.Context, query string, source string, limit int) ([]HermesSkillHubResult, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	source = strings.TrimSpace(source)
	if source == "" {
		source = "all"
	}
	script := `
import json
import sys
from tools.skills_hub import GitHubAuth, create_source_router, unified_search

query = sys.argv[1]
source = sys.argv[2] or "all"
limit = int(sys.argv[3])
sources = create_source_router(GitHubAuth())
items = unified_search(query, sources, source_filter=source, limit=limit)
results = []
for item in items:
    results.append({
        "identifier": getattr(item, "identifier", "") or "",
        "name": getattr(item, "name", "") or "",
        "description": getattr(item, "description", "") or "",
        "source": getattr(item, "source", "") or "",
        "trustLevel": getattr(item, "trust_level", "") or "",
        "repo": getattr(item, "repo", "") or "",
        "path": getattr(item, "path", "") or "",
        "tags": list(getattr(item, "tags", []) or []),
        "extra": getattr(item, "extra", {}) or {},
    })
print(json.dumps({"results": results}, ensure_ascii=False))
`
	stdout, stderr, err := hermesPythonCommand(ctx, 45*time.Second, script, query, source, strconv.Itoa(limit))
	if err != nil {
		return nil, errors.New(strings.TrimSpace(stderr + "\n" + err.Error()))
	}
	var payload struct {
		Results []HermesSkillHubResult `json:"results"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(stdout)), &payload); err != nil {
		return nil, errors.New("hermes skills bridge did not return valid JSON: " + strings.TrimSpace(stderr))
	}
	if payload.Results == nil {
		payload.Results = []HermesSkillHubResult{}
	}
	return payload.Results, nil
}

func hermesShouldUseSkillHub(source string) bool {
	source = strings.ToLower(strings.TrimSpace(source))
	return source == "" || source == "all" || source == "skillhub"
}

func hermesInstallShouldUseSkillHub(source string, identifier string) bool {
	source = strings.ToLower(strings.TrimSpace(source))
	if source == "skillhub" {
		return toolenv.ResolveToolPath("skillhub") != ""
	}
	if source != "" && source != "all" {
		return false
	}
	identifier = strings.TrimSpace(identifier)
	if identifier == "" || strings.Contains(identifier, "/") || strings.HasPrefix(identifier, "http://") || strings.HasPrefix(identifier, "https://") {
		return false
	}
	return toolenv.ResolveToolPath("skillhub") != ""
}

func searchHermesSkillHubCLI(ctx context.Context, path string, query string, limit int) ([]HermesSkillHubResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []HermesSkillHubResult{}, nil
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	args := []string{"--skip-self-upgrade", "search", "--json", "--search-limit", strconv.Itoa(limit)}
	args = append(args, strings.Fields(query)...)
	stdout, stderr, err := runSkillHubCommand(ctx, 20*time.Second, path, args...)
	if err != nil {
		return nil, errors.New(strings.TrimSpace(stderr + "\n" + err.Error()))
	}
	var payload struct {
		Results []struct {
			Slug        string         `json:"slug"`
			Name        string         `json:"name"`
			Description string         `json:"description"`
			Summary     string         `json:"summary"`
			Version     string         `json:"version"`
			Extra       map[string]any `json:"-"`
		} `json:"results"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(stdout)), &payload); err != nil {
		return nil, errors.New("skillhub search did not return valid JSON: " + strings.TrimSpace(stderr))
	}
	results := make([]HermesSkillHubResult, 0, len(payload.Results))
	for _, item := range payload.Results {
		identifier := strings.TrimSpace(item.Slug)
		name := firstNonEmpty(item.Name, identifier)
		description := firstNonEmpty(item.Description, item.Summary)
		extra := map[string]any{}
		if item.Version != "" {
			extra["version"] = item.Version
		}
		results = append(results, HermesSkillHubResult{
			Identifier:  identifier,
			Name:        name,
			Description: description,
			Source:      "skillhub",
			TrustLevel:  "community",
			Extra:       extra,
		})
	}
	return results, nil
}

func loadHermesSkillHubHotShowcase(ctx context.Context, limit int) ([]HermesSkillHubResult, error) {
	if limit <= 0 {
		limit = 24
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, hermesSkillHubHotShowcaseURL, nil)
	if err != nil {
		return nil, err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, errors.New("skillhub showcase returned " + response.Status)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 2*1024*1024))
	if err != nil {
		return nil, err
	}
	var payload struct {
		Skills []struct {
			Slug          string            `json:"slug"`
			Name          string            `json:"name"`
			Description   string            `json:"description"`
			DescriptionZH string            `json:"descriptionZh"`
			Version       string            `json:"version"`
			OwnerName     string            `json:"ownerName"`
			Category      string            `json:"category"`
			Homepage      string            `json:"homepage"`
			Tags          []string          `json:"tags"`
			Labels        map[string]string `json:"labels"`
			Downloads     int64             `json:"downloads"`
			Installs      int64             `json:"installs"`
			Stars         int64             `json:"stars"`
			Score         float64           `json:"score"`
		} `json:"skills"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	results := make([]HermesSkillHubResult, 0, len(payload.Skills))
	for _, item := range payload.Skills {
		if len(results) >= limit {
			break
		}
		identifier := strings.TrimSpace(item.Slug)
		if identifier == "" {
			continue
		}
		extra := map[string]any{}
		if item.Version != "" {
			extra["version"] = item.Version
		}
		if item.OwnerName != "" {
			extra["ownerName"] = item.OwnerName
		}
		if item.Category != "" {
			extra["category"] = item.Category
		}
		if item.Downloads > 0 {
			extra["downloads"] = item.Downloads
		}
		if item.Installs > 0 {
			extra["installs"] = item.Installs
		}
		if item.Stars > 0 {
			extra["stars"] = item.Stars
		}
		if item.Score > 0 {
			extra["score"] = item.Score
		}
		if len(item.Labels) > 0 {
			extra["labels"] = item.Labels
		}
		results = append(results, HermesSkillHubResult{
			Identifier:  identifier,
			Name:        firstNonEmpty(item.Name, identifier),
			Description: firstNonEmpty(item.DescriptionZH, item.Description),
			Source:      "skillhub",
			TrustLevel:  "community",
			Repo:        item.Homepage,
			Tags:        item.Tags,
			Extra:       extra,
		})
	}
	return results, nil
}

func installHermesSkillHubCLI(ctx context.Context, profile HermesProfileSelection, request HermesSkillInstallRequest) (string, string, error) {
	path := toolenv.ResolveToolPath("skillhub")
	if path == "" {
		return "", "", errors.New("skillhub CLI is not installed")
	}
	installDir := filepath.Join(profile.Path, "skills")
	if err := os.MkdirAll(installDir, 0o755); err != nil {
		return "", "", err
	}
	args := []string{"--skip-self-upgrade", "--dir", installDir, "install"}
	if request.Force {
		args = append(args, "--force")
	}
	args = append(args, strings.TrimSpace(request.Identifier))
	return runSkillHubCommand(ctx, 2*time.Minute, path, args...)
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

func hermesPythonCommand(ctx context.Context, timeout time.Duration, script string, args ...string) (string, string, error) {
	return hermesPythonCommandWithEnv(ctx, timeout, toolenv.CommandEnv(), script, args...)
}

func hermesPythonCommandWithEnv(ctx context.Context, timeout time.Duration, env []string, script string, args ...string) (string, string, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	project := hermesProjectPath(ctx)
	python := filepath.Join(project, "venv", "bin", "python")
	if !pathExists(python) {
		python = filepath.Join(project, "venv", "bin", "python3")
	}
	if !pathExists(python) {
		python = toolenv.ResolveToolPath("python3")
	}
	if python == "" {
		python = "python3"
	}
	commandArgs := append([]string{"-c", "import sys; sys.path.insert(0, " + pythonStringLiteral(project) + ");\n" + script}, args...)
	cmd := exec.CommandContext(cmdCtx, python, commandArgs...)
	cmd.Dir = project
	cmd.Env = env
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

func hermesCommand(ctx context.Context, timeout time.Duration, args ...string) (string, string, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	path := toolenv.ResolveToolPath("hermes")
	if path == "" {
		path = "hermes"
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

func hermesProjectPath(ctx context.Context) string {
	home, _ := defaultHermesHomeDir()
	candidate := filepath.Join(home, "hermes-agent")
	if pathExists(candidate) {
		return candidate
	}
	cli, _ := detectHermesCLI(ctx)
	if strings.TrimSpace(cli.Project) != "" && pathExists(cli.Project) {
		return strings.TrimSpace(cli.Project)
	}
	return candidate
}

func pythonStringLiteral(value string) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return `""`
	}
	return string(encoded)
}

func findHermesInstalledSkill(skills []HermesSkillInfo, identifier string, nameOverride string, stdout string) *HermesSkillInfo {
	candidates := []string{}
	if strings.TrimSpace(nameOverride) != "" {
		candidates = append(candidates, strings.TrimSpace(nameOverride))
	}
	identifier = strings.Trim(strings.TrimSpace(identifier), "/")
	if identifier != "" {
		parts := strings.Split(identifier, "/")
		candidates = append(candidates, parts[len(parts)-1])
	}
	if match := regexp.MustCompile(`Installed:\]\s+([A-Za-z0-9_.@/+:-]+)`).FindStringSubmatch(stdout); len(match) == 2 {
		pathParts := strings.Split(strings.Trim(match[1], "/"), "/")
		if len(pathParts) > 0 {
			candidates = append(candidates, pathParts[len(pathParts)-1])
		}
	}
	seen := map[string]bool{}
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" || seen[candidate] {
			continue
		}
		seen[candidate] = true
		for index := range skills {
			if strings.EqualFold(skills[index].Name, candidate) {
				return &skills[index]
			}
		}
	}
	return nil
}

func scanHermesSkills(profile HermesProfileSelection) HermesSkillsResponse {
	home := profile.Path
	skillsDir := filepath.Join(home, "skills")
	configPath := filepath.Join(home, "config.yaml")
	configContent, configErr := os.ReadFile(configPath)
	config := parseHermesSkillsConfig(string(configContent), configPath, configErr == nil)
	if configErr != nil && !os.IsNotExist(configErr) {
		config.Error = configErr.Error()
	}

	bundled := readBundledManifest(filepath.Join(skillsDir, ".bundled_manifest"))
	hubInstalled := readHermesHubLock(filepath.Join(skillsDir, ".hub", "lock.json"))
	roots := normalizeHermesSkillRoots(home, skillsDir, config.ExternalDirs)

	disabled := stringSet(config.Disabled)
	seenNames := map[string]bool{}
	categoryDescriptions := map[string]HermesSkillCategoryInfo{}
	errors := make([]string, 0)
	skills := make([]HermesSkillInfo, 0)
	summary := HermesSkillsSummary{
		Categories:   map[string]int{},
		SourceCounts: map[string]int{},
	}

	for _, root := range roots {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		if !filepath.IsAbs(root) {
			root = filepath.Join(home, root)
		}
		root = filepath.Clean(root)
		if !pathExists(root) {
			continue
		}
		readHermesSkillCategoryDescriptions(root, categoryDescriptions)
		isExternal := root != filepath.Clean(skillsDir)
		found, scanErrors := scanHermesSkillRoot(root, disabled, bundled, hubInstalled, isExternal, config.SkillToolsetEnabled)
		errors = append(errors, scanErrors...)
		for _, skill := range found {
			if seenNames[skill.Name] {
				continue
			}
			seenNames[skill.Name] = true
			skills = append(skills, skill)
			summary.Total++
			if skill.Disabled {
				summary.Disabled++
			} else {
				summary.Enabled++
			}
			if skill.Bundled {
				summary.Bundled++
			}
			if skill.Source == "custom" {
				summary.Custom++
			}
			if skill.Source == "external" {
				summary.External++
			}
			category := firstNonEmpty(skill.Category, "uncategorized")
			summary.Categories[category]++
			summary.SourceCounts[skill.Source]++
			for _, group := range skill.SupportingFiles {
				summary.SupportingFile += group.Count
			}
		}
	}

	sort.Slice(skills, func(i, j int) bool {
		if skills[i].Category == skills[j].Category {
			return skills[i].Name < skills[j].Name
		}
		return skills[i].Category < skills[j].Category
	})

	categoryNames := make([]string, 0, len(categoryDescriptions))
	for name := range categoryDescriptions {
		categoryNames = append(categoryNames, name)
	}
	sort.Strings(categoryNames)
	categories := make([]HermesSkillCategoryInfo, 0, len(categoryNames))
	for _, name := range categoryNames {
		categories = append(categories, categoryDescriptions[name])
	}

	status := "ok"
	if len(errors) > 0 || config.Error != "" {
		status = "warning"
	}
	return HermesSkillsResponse{
		Status:     status,
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		HomePath:   home,
		SkillsDir:  skillsDir,
		Config:     config,
		Summary:    summary,
		Categories: categories,
		Skills:     skills,
		Errors:     errors,
	}
}

func readHermesSkillCategoryDescriptions(root string, categories map[string]HermesSkillCategoryInfo) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		if _, exists := categories[name]; exists {
			continue
		}
		path := filepath.Join(root, name, "DESCRIPTION.md")
		content, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		description := parseHermesCategoryDescription(string(content))
		if description == "" {
			continue
		}
		categories[name] = HermesSkillCategoryInfo{
			Name:        name,
			Description: description,
			Path:        path,
		}
	}
}

func parseHermesCategoryDescription(content string) string {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "---") {
		if description := parseSkillFrontmatter(trimmed).Description; description != "" {
			return description
		}
		lines := strings.Split(trimmed, "\n")
		for index := 1; index < len(lines); index++ {
			if strings.TrimSpace(lines[index]) == "---" {
				return strings.TrimSpace(strings.Join(lines[index+1:], "\n"))
			}
		}
	}
	return trimmed
}

func scanHermesSkillRoot(root string, disabled map[string]bool, bundled map[string]bool, hubInstalled map[string]bool, isExternal bool, skillToolsetEnabled bool) ([]HermesSkillInfo, []string) {
	skills := make([]HermesSkillInfo, 0)
	errors := make([]string, 0)
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			errors = append(errors, err.Error())
			if entry != nil && entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			name := entry.Name()
			if name == ".git" || name == ".github" || name == ".hub" || name == ".archive" {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Name() != "SKILL.md" {
			return nil
		}
		skill, readErr := readHermesSkill(path, root, disabled, bundled, hubInstalled, isExternal, skillToolsetEnabled)
		if readErr != nil {
			errors = append(errors, readErr.Error())
			return nil
		}
		if !skillSupportsCurrentPlatform(skill.Platforms) {
			return nil
		}
		skills = append(skills, skill)
		return nil
	})
	if err != nil {
		errors = append(errors, err.Error())
	}
	return skills, errors
}

func readHermesSkill(path string, root string, disabled map[string]bool, bundled map[string]bool, hubInstalled map[string]bool, isExternal bool, skillToolsetEnabled bool) (HermesSkillInfo, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return HermesSkillInfo{}, err
	}
	frontmatter := parseSkillFrontmatter(string(content))
	dir := filepath.Dir(path)
	relative, _ := filepath.Rel(root, path)
	if relative == "" {
		relative = filepath.Base(path)
	}
	name := firstNonEmpty(frontmatter.Name, filepath.Base(dir))
	category := categoryFromRelativePath(relative)
	source := "custom"
	if isExternal {
		source = "external"
	} else if hubInstalled[name] {
		source = "hub"
	} else if bundled[name] {
		source = "bundled"
	}
	return HermesSkillInfo{
		Name:                 name,
		Description:          frontmatter.Description,
		Category:             category,
		Path:                 path,
		SkillDir:             dir,
		RelativePath:         relative,
		Root:                 root,
		Source:               source,
		Enabled:              !disabled[name],
		Disabled:             disabled[name],
		Bundled:              bundled[name],
		ToolsetEnabled:       skillToolsetEnabled,
		Platforms:            frontmatter.Platforms,
		Tags:                 frontmatter.Tags,
		RelatedSkills:        frontmatter.RelatedSkills,
		ConfigKeys:           frontmatter.ConfigKeys,
		PrerequisiteCommands: frontmatter.PrerequisiteCommands,
		SupportingFiles:      scanSkillSupportFiles(dir),
	}, nil
}

type skillFrontmatter struct {
	Name                 string
	Description          string
	Category             string
	Platforms            []string
	Tags                 []string
	RelatedSkills        []string
	ConfigKeys           []string
	PrerequisiteCommands []string
}

func parseSkillFrontmatter(content string) skillFrontmatter {
	meta := skillFrontmatter{}
	lines := strings.Split(content, "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return meta
	}
	end := -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == "---" {
			end = i
			break
		}
	}
	if end == -1 {
		return meta
	}

	stack := map[int]string{}
	for i := 1; i < end; i++ {
		raw := stripYAMLComment(lines[i])
		if strings.TrimSpace(raw) == "" {
			continue
		}
		indent := leadingSpaces(raw)
		trimmed := strings.TrimSpace(raw)
		for knownIndent := range stack {
			if knownIndent >= indent {
				delete(stack, knownIndent)
			}
		}
		if strings.HasPrefix(trimmed, "- ") {
			continue
		}
		key, value, ok := strings.Cut(trimmed, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		stack[indent] = key
		path := yamlPath(stack)
		switch path {
		case "name":
			meta.Name = normalizeYAMLScalar(value)
		case "description":
			meta.Description = parseFrontmatterScalarOrBlock(lines, &i, end, indent, value)
		case "platforms":
			meta.Platforms = parseYAMLInlineOrBlockList(lines, &i, end, indent, value)
		case "metadata.hermes.tags":
			meta.Tags = parseYAMLInlineOrBlockList(lines, &i, end, indent, value)
		case "metadata.hermes.category":
			meta.Category = normalizeYAMLScalar(value)
		case "metadata.hermes.related_skills":
			meta.RelatedSkills = parseYAMLInlineOrBlockList(lines, &i, end, indent, value)
		case "prerequisites.commands":
			meta.PrerequisiteCommands = parseYAMLInlineOrBlockList(lines, &i, end, indent, value)
		default:
			if strings.HasPrefix(path, "metadata.hermes.config.") {
				parts := strings.Split(path, ".")
				if len(parts) >= 4 {
					meta.ConfigKeys = appendUnique(meta.ConfigKeys, parts[3])
				}
			}
		}
	}
	sort.Strings(meta.ConfigKeys)
	return meta
}

func parseFrontmatterScalarOrBlock(lines []string, index *int, end int, indent int, value string) string {
	value = strings.TrimSpace(value)
	if value != "|" && value != ">" {
		return normalizeYAMLScalar(value)
	}
	block := make([]string, 0)
	for next := *index + 1; next < end; next++ {
		line := lines[next]
		if strings.TrimSpace(line) == "" {
			block = append(block, "")
			*index = next
			continue
		}
		if leadingSpaces(line) <= indent {
			break
		}
		block = append(block, strings.TrimSpace(line))
		*index = next
	}
	return strings.TrimSpace(strings.Join(block, " "))
}

func parseYAMLInlineOrBlockList(lines []string, index *int, end int, indent int, value string) []string {
	if strings.TrimSpace(value) != "" {
		return parseYAMLListValue(value)
	}
	values := make([]string, 0)
	for next := *index + 1; next < end; next++ {
		line := stripYAMLComment(lines[next])
		if strings.TrimSpace(line) == "" {
			*index = next
			continue
		}
		if leadingSpaces(line) <= indent {
			break
		}
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "- ") {
			values = append(values, normalizeYAMLScalar(strings.TrimSpace(strings.TrimPrefix(trimmed, "- "))))
			*index = next
			continue
		}
		break
	}
	return compactStrings(values)
}

func skillSupportsCurrentPlatform(platforms []string) bool {
	if len(platforms) == 0 {
		return true
	}
	current := runtime.GOOS
	for _, platform := range platforms {
		normalized := strings.ToLower(strings.TrimSpace(platform))
		switch normalized {
		case "", "*", "all":
			return true
		case "macos":
			normalized = "darwin"
		}
		if normalized == current {
			return true
		}
	}
	return false
}

func parseHermesSkillsConfig(content string, configPath string, exists bool) HermesSkillsConfig {
	config := HermesSkillsConfig{
		Path:             configPath,
		Exists:           exists,
		Disabled:         []string{},
		ExternalDirs:     []string{},
		PlatformDisabled: []string{},
		Toolsets:         []string{},
		DisabledToolsets: []string{},
		TemplateVars:     true,
		LiveReloadHint:   "后台扫描已刷新；正在运行的 Hermes TUI 会话需要执行 /reload-skills 才会重新加载技能命令。",
	}
	stack := map[int]string{}
	lines := strings.Split(content, "\n")
	for i := 0; i < len(lines); i++ {
		raw := stripYAMLComment(lines[i])
		if strings.TrimSpace(raw) == "" {
			continue
		}
		indent := leadingSpaces(raw)
		trimmed := strings.TrimSpace(raw)
		for knownIndent := range stack {
			if knownIndent >= indent {
				delete(stack, knownIndent)
			}
		}
		if strings.HasPrefix(trimmed, "- ") {
			path := yamlPath(stack)
			value := normalizeYAMLScalar(strings.TrimSpace(strings.TrimPrefix(trimmed, "- ")))
			switch path {
			case "toolsets":
				config.Toolsets = appendUnique(config.Toolsets, value)
			case "agent.disabled_toolsets":
				config.DisabledToolsets = appendUnique(config.DisabledToolsets, value)
			case "skills.disabled":
				config.Disabled = appendUnique(config.Disabled, value)
			case "skills.external_dirs":
				config.ExternalDirs = appendUnique(config.ExternalDirs, value)
			default:
				if strings.HasPrefix(path, "skills.platform_disabled.") {
					platform := strings.TrimPrefix(path, "skills.platform_disabled.")
					config.PlatformDisabled = appendUnique(config.PlatformDisabled, platform+":"+value)
				}
			}
			continue
		}
		key, value, ok := strings.Cut(trimmed, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		stack[indent] = key
		path := yamlPath(stack)
		switch path {
		case "toolsets":
			values := parseYAMLListValue(value)
			if len(values) > 0 {
				config.Toolsets = values
			}
		case "agent.disabled_toolsets":
			config.DisabledToolsets = appendUnique(config.DisabledToolsets, parseYAMLListValue(value)...)
		case "skills.disabled":
			config.Disabled = appendUnique(config.Disabled, parseYAMLListValue(value)...)
		case "skills.external_dirs":
			config.ExternalDirs = appendUnique(config.ExternalDirs, parseYAMLListValue(value)...)
		case "skills.template_vars":
			config.TemplateVars = parseYAMLBool(value, config.TemplateVars)
		case "skills.inline_shell":
			config.InlineShell = parseYAMLBool(value, config.InlineShell)
		case "skills.inline_shell_timeout":
			config.InlineShellTimeout = normalizeYAMLScalar(value)
		case "skills.guard_agent_created":
			config.GuardAgentCreated = parseYAMLBool(value, config.GuardAgentCreated)
		default:
			if strings.HasPrefix(path, "skills.platform_disabled.") {
				platform := strings.TrimPrefix(path, "skills.platform_disabled.")
				for _, item := range parseYAMLListValue(value) {
					config.PlatformDisabled = appendUnique(config.PlatformDisabled, platform+":"+item)
				}
			}
		}
	}
	sort.Strings(config.Disabled)
	sort.Strings(config.ExternalDirs)
	sort.Strings(config.PlatformDisabled)
	config.Toolsets = compactStrings(config.Toolsets)
	if len(config.Toolsets) == 0 {
		config.Toolsets = []string{"hermes-cli"}
	}
	config.DisabledToolsets = compactStrings(config.DisabledToolsets)
	config.SkillToolsetEnabled = hermesSkillToolsetEnabled(config.Toolsets, config.DisabledToolsets)
	return config
}

func hermesSkillToolsetEnabled(toolsets []string, disabledToolsets []string) bool {
	disabled := stringSet(disabledToolsets)
	if disabled["skills"] || disabled["skills_tools"] {
		return false
	}
	if len(toolsets) == 0 {
		toolsets = []string{"hermes-cli"}
	}
	for _, toolset := range toolsets {
		toolset = strings.TrimSpace(toolset)
		switch toolset {
		case "all", "*", "skills", "skills_tools", "hermes-cli", "hermes-cron", "hermes-telegram", "hermes-discord", "hermes-slack", "hermes-whatsapp", "hermes-matrix", "hermes-mattermost", "hermes-webhook", "hermes-api":
			return true
		default:
			if strings.HasPrefix(toolset, "hermes-") {
				return true
			}
		}
	}
	return false
}

func updateHermesDisabledSkills(content string, disabled []string) string {
	disabled = compactStrings(disabled)
	sort.Strings(disabled)
	lines := strings.Split(content, "\n")
	if len(lines) == 1 && strings.TrimSpace(lines[0]) == "" {
		lines = nil
	}
	skillsStart := -1
	skillsEnd := len(lines)
	for i, line := range lines {
		if leadingSpaces(line) == 0 && strings.TrimSpace(stripYAMLComment(line)) == "skills:" {
			skillsStart = i
			for j := i + 1; j < len(lines); j++ {
				trimmed := strings.TrimSpace(stripYAMLComment(lines[j]))
				if trimmed == "" {
					continue
				}
				if leadingSpaces(lines[j]) == 0 {
					skillsEnd = j
					break
				}
			}
			break
		}
	}
	block := renderHermesDisabledBlock(disabled)
	if skillsStart == -1 {
		if len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) != "" {
			lines = append(lines, "")
		}
		lines = append(lines, "skills:")
		lines = append(lines, block...)
		return strings.TrimRight(strings.Join(lines, "\n"), "\n") + "\n"
	}

	disabledStart := -1
	disabledEnd := skillsEnd
	for i := skillsStart + 1; i < skillsEnd; i++ {
		trimmed := strings.TrimSpace(stripYAMLComment(lines[i]))
		if trimmed == "" {
			continue
		}
		if leadingSpaces(lines[i]) == 2 && strings.HasPrefix(trimmed, "disabled:") {
			disabledStart = i
			for j := i + 1; j < skillsEnd; j++ {
				nextTrimmed := strings.TrimSpace(stripYAMLComment(lines[j]))
				if nextTrimmed == "" {
					continue
				}
				if leadingSpaces(lines[j]) <= 2 {
					disabledEnd = j
					break
				}
			}
			break
		}
	}
	if disabledStart == -1 {
		updated := make([]string, 0, len(lines)+len(block))
		updated = append(updated, lines[:skillsStart+1]...)
		updated = append(updated, block...)
		updated = append(updated, lines[skillsStart+1:]...)
		return strings.TrimRight(strings.Join(updated, "\n"), "\n") + "\n"
	}
	updated := make([]string, 0, len(lines)+len(block))
	updated = append(updated, lines[:disabledStart]...)
	updated = append(updated, block...)
	updated = append(updated, lines[disabledEnd:]...)
	return strings.TrimRight(strings.Join(updated, "\n"), "\n") + "\n"
}

func renderHermesDisabledBlock(disabled []string) []string {
	if len(disabled) == 0 {
		return []string{"  disabled: []"}
	}
	lines := []string{"  disabled:"}
	for _, name := range disabled {
		lines = append(lines, "    - "+quoteYAMLListItem(name))
	}
	return lines
}

func readBundledManifest(path string) map[string]bool {
	manifest := map[string]bool{}
	content, err := os.ReadFile(path)
	if err != nil {
		return manifest
	}
	for _, raw := range strings.Split(string(content), "\n") {
		name, _, ok := strings.Cut(strings.TrimSpace(raw), ":")
		if ok && strings.TrimSpace(name) != "" {
			manifest[strings.TrimSpace(name)] = true
		}
	}
	return manifest
}

func readHermesHubLock(path string) map[string]bool {
	installed := map[string]bool{}
	content, err := os.ReadFile(path)
	if err != nil {
		return installed
	}
	var payload struct {
		Installed map[string]json.RawMessage `json:"installed"`
	}
	if err := json.Unmarshal(content, &payload); err != nil {
		return installed
	}
	for name := range payload.Installed {
		name = strings.TrimSpace(name)
		if name != "" {
			installed[name] = true
		}
	}
	return installed
}

func normalizeHermesSkillRoots(home string, primaryRoot string, externalDirs []string) []string {
	roots := make([]string, 0, len(externalDirs)+1)
	seen := map[string]bool{}
	addRoot := func(root string) {
		root = strings.TrimSpace(root)
		if root == "" {
			return
		}
		root = os.ExpandEnv(root)
		if strings.HasPrefix(root, "~") {
			if userHome, err := os.UserHomeDir(); err == nil {
				root = filepath.Join(userHome, strings.TrimPrefix(strings.TrimPrefix(root, "~/"), "~"))
			}
		}
		if !filepath.IsAbs(root) {
			root = filepath.Join(home, root)
		}
		cleaned, err := filepath.Abs(filepath.Clean(root))
		if err != nil {
			cleaned = filepath.Clean(root)
		}
		key := cleaned
		if evaluated, err := filepath.EvalSymlinks(cleaned); err == nil {
			key = evaluated
		}
		if seen[key] {
			return
		}
		seen[key] = true
		roots = append(roots, cleaned)
	}
	addRoot(primaryRoot)
	for _, root := range externalDirs {
		addRoot(root)
	}
	return roots
}

func scanSkillSupportFiles(skillDir string) []HermesSkillSupportGroup {
	names := []string{"references", "templates", "scripts", "assets", "examples"}
	groups := make([]HermesSkillSupportGroup, 0)
	for _, name := range names {
		dir := filepath.Join(skillDir, name)
		if !pathExists(dir) {
			continue
		}
		files := make([]string, 0)
		_ = filepath.WalkDir(dir, func(path string, entry os.DirEntry, err error) error {
			if err != nil || entry.IsDir() {
				return nil
			}
			relative, relErr := filepath.Rel(dir, path)
			if relErr == nil {
				files = append(files, relative)
			}
			return nil
		})
		sort.Strings(files)
		if len(files) > 0 {
			groups = append(groups, HermesSkillSupportGroup{Name: name, Count: len(files), Files: files})
		}
	}
	return groups
}

func categoryFromRelativePath(relative string) string {
	parts := strings.Split(filepath.ToSlash(relative), "/")
	if len(parts) >= 3 {
		return parts[0]
	}
	return "uncategorized"
}

func parseYAMLListValue(value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	if strings.HasPrefix(value, "[") && strings.HasSuffix(value, "]") {
		value = strings.TrimSuffix(strings.TrimPrefix(value, "["), "]")
		values := make([]string, 0)
		for _, item := range strings.Split(value, ",") {
			values = append(values, normalizeYAMLScalar(item))
		}
		return compactStrings(values)
	}
	normalized := normalizeYAMLScalar(value)
	if normalized == "" || normalized == "{}" || normalized == "[]" {
		return nil
	}
	return []string{normalized}
}

func parseYAMLBool(value string, fallback bool) bool {
	switch strings.ToLower(normalizeYAMLScalar(value)) {
	case "true", "yes", "on", "1":
		return true
	case "false", "no", "off", "0":
		return false
	default:
		return fallback
	}
}

func stringSet(values []string) map[string]bool {
	set := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			set[value] = true
		}
	}
	return set
}

func sortedKeys(set map[string]bool) []string {
	keys := make([]string, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func appendUnique(values []string, next ...string) []string {
	seen := stringSet(values)
	for _, value := range next {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			values = append(values, value)
			seen[value] = true
		}
	}
	return values
}

func compactStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			result = append(result, value)
		}
	}
	return result
}

var safeYAMLListItemPattern = regexp.MustCompile(`^[A-Za-z0-9_.@/+:-]+$`)

func quoteYAMLListItem(value string) string {
	if safeYAMLListItemPattern.MatchString(value) {
		return value
	}
	return `"` + strings.ReplaceAll(value, `"`, `\"`) + `"`
}
