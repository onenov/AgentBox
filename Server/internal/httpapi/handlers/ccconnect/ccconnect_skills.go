package ccconnect

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"agent-box-server/internal/httpapi/toolenv"

	"github.com/danielgtaylor/huma/v2"
)

const ccConnectSkillHubHotShowcaseURL = "https://api.skillhub.cn/api/v1/showcase/hot"

type CCConnectSkillsOutput struct {
	Body CCConnectSkillsResponse
}

type CCConnectSkillPresetsOutput struct {
	Body CCConnectSkillPresetsResponse
}

type CCConnectSkillsShowcaseHotInput struct {
	Refresh bool `query:"refresh" doc:"Force refresh SkillHub hot showcase." example:"false"`
}

type CCConnectSkillsSearchInput struct {
	Query string `query:"query" doc:"Search query for Skills Hub." example:"react"`
	Limit int    `query:"limit" minimum:"1" maximum:"100" doc:"Maximum number of search results." example:"20"`
}

type CCConnectSkillDetailInput struct {
	Name string `path:"name" doc:"Local CC-Connect skill name to inspect." example:"find-skills"`
}

type CCConnectSkillInstallInput struct {
	Body CCConnectSkillInstallRequest
}

type CCConnectSkillsSearchOutput struct {
	Body CCConnectSkillsSearchResponse
}

type CCConnectSkillsShowcaseHotOutput struct {
	Body CCConnectSkillsShowcaseHotResponse
}

type CCConnectSkillDetailOutput struct {
	Body CCConnectSkillDetailResponse
}

type CCConnectSkillInstallOutput struct {
	Body CCConnectSkillInstallResponse
}

type CCConnectSkillsResponse struct {
	Status    string                   `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                   `json:"timestamp" example:"2026-05-18T12:30:00Z" doc:"UTC response timestamp."`
	Projects  []CCConnectProjectSkills `json:"projects" doc:"Per-project agent skills discovered by CC-Connect."`
	Summary   CCConnectSkillsSummary   `json:"summary" doc:"Skills inventory summary."`
}

type CCConnectProjectSkills struct {
	Project   string               `json:"project" example:"my-project" doc:"CC-Connect project name."`
	AgentType string               `json:"agentType" example:"codex" doc:"Project agent type."`
	Dirs      []string             `json:"dirs" doc:"Skill directories scanned by the project agent."`
	Skills    []CCConnectSkillInfo `json:"skills" doc:"Discovered SKILL.md skills."`
}

type CCConnectSkillInfo struct {
	Name        string `json:"name" example:"find-skills" doc:"Skill directory name and command name."`
	DisplayName string `json:"displayName,omitempty" example:"Find Skills" doc:"Optional display name from SKILL.md frontmatter."`
	Description string `json:"description,omitempty" doc:"Skill description from SKILL.md frontmatter or body."`
	Source      string `json:"source" doc:"Skill directory path."`
}

type CCConnectSkillsSummary struct {
	ProjectCount int            `json:"projectCount" example:"1" doc:"Number of projects returned."`
	SkillCount   int            `json:"skillCount" example:"8" doc:"Total discovered skills."`
	DirCount     int            `json:"dirCount" example:"4" doc:"Total configured skill directories."`
	AgentTypes   map[string]int `json:"agentTypes" doc:"Skill count grouped by agent type."`
}

type CCConnectSkillPresetsResponse struct {
	Status    string                 `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                 `json:"timestamp" example:"2026-05-18T12:30:00Z" doc:"UTC response timestamp."`
	Version   int                    `json:"version" example:"1" doc:"Skill presets schema version."`
	UpdatedAt string                 `json:"updatedAt,omitempty" doc:"Remote presets update timestamp."`
	Skills    []CCConnectSkillPreset `json:"skills" doc:"Recommended skill presets from CC-Connect."`
}

type CCConnectSkillPreset struct {
	Name          string                 `json:"name" example:"find-skills" doc:"Preset skill name."`
	DisplayName   string                 `json:"displayName,omitempty" example:"Find Skills" doc:"Preset display name."`
	Description   string                 `json:"description,omitempty" doc:"English description."`
	DescriptionZh string                 `json:"descriptionZh,omitempty" doc:"Chinese description."`
	Version       string                 `json:"version,omitempty" example:"1.0.0" doc:"Skill version."`
	Author        string                 `json:"author,omitempty" doc:"Skill author."`
	URL           string                 `json:"url,omitempty" doc:"Skill detail or download URL."`
	AgentTypes    []string               `json:"agentTypes,omitempty" doc:"Compatible agent types."`
	Tags          []string               `json:"tags,omitempty" doc:"Preset tags."`
	Featured      bool                   `json:"featured,omitempty" doc:"Whether the preset is featured."`
	Source        *CCConnectSkillSource  `json:"source,omitempty" doc:"Preset source."`
	Pricing       *CCConnectSkillPricing `json:"pricing,omitempty" doc:"Preset pricing."`
}

type CCConnectSkillSource struct {
	Provider string `json:"provider" example:"skills.sh" doc:"Source provider."`
	Name     string `json:"name,omitempty" example:"Skills.sh" doc:"Source display name."`
	URL      string `json:"url,omitempty" doc:"Source URL."`
}

type CCConnectSkillPricing struct {
	Type     string  `json:"type" example:"free" doc:"Pricing type: free, paid, or freemium."`
	Price    float64 `json:"price,omitempty" example:"0" doc:"Price when applicable."`
	Currency string  `json:"currency,omitempty" example:"USD" doc:"Price currency."`
}

type CCConnectSkillInstallRequest struct {
	Slug           string `json:"slug" doc:"Skills Hub slug to install." example:"find-skills"`
	Force          bool   `json:"force,omitempty" doc:"Overwrite an existing local skill directory." example:"false"`
	Source         string `json:"source,omitempty" doc:"Preferred install source." example:"skillhub"`
	RestartRuntime *bool  `json:"restartRuntime,omitempty" doc:"Restart the managed CC-Connect runtime after installation so running command caches pick up the new skill." example:"true"`
}

type CCConnectSkillsSearchResponse struct {
	Status    string                    `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                    `json:"timestamp" example:"2026-05-18T12:30:00Z" doc:"UTC response timestamp."`
	Query     string                    `json:"query" doc:"Search query."`
	Source    string                    `json:"source" example:"skillhub" doc:"Search source."`
	Results   []CCConnectSkillHubResult `json:"results" doc:"Search results from Skills Hub."`
}

type CCConnectSkillHubResult struct {
	Slug        string         `json:"slug,omitempty" doc:"Skills Hub install slug." example:"find-skills"`
	Name        string         `json:"name,omitempty" doc:"Skill display name." example:"Find Skills"`
	Description string         `json:"description,omitempty" doc:"Skill description."`
	Summary     string         `json:"summary,omitempty" doc:"Short skill summary."`
	Version     string         `json:"version,omitempty" example:"0.1.0" doc:"Skill version when available."`
	Author      string         `json:"author,omitempty" doc:"Skill author when available."`
	Homepage    string         `json:"homepage,omitempty" doc:"Skill homepage when available."`
	Source      string         `json:"source,omitempty" example:"skillhub" doc:"Source registry."`
	Extra       map[string]any `json:"extra,omitempty" doc:"Additional upstream metadata."`
}

type CCConnectSkillsShowcaseHotResponse struct {
	Section   string                      `json:"section" example:"hot_downloads" doc:"SkillHub showcase section."`
	Timestamp string                      `json:"timestamp" example:"2026-05-18T12:30:00Z" doc:"UTC response timestamp."`
	Cache     CCConnectCacheInfo          `json:"cache" doc:"Cache behavior used for this response."`
	Skills    []CCConnectShowcaseHotSkill `json:"skills" doc:"Hot SkillHub skills."`
}

type CCConnectShowcaseHotSkill struct {
	Slug          string            `json:"slug" example:"find-skills" doc:"SkillHub slug."`
	Name          string            `json:"name" example:"Find Skills" doc:"Skill display name."`
	Description   string            `json:"description,omitempty" doc:"English description."`
	DescriptionZH string            `json:"descriptionZh,omitempty" doc:"Chinese description."`
	Version       string            `json:"version,omitempty" doc:"Skill version."`
	OwnerName     string            `json:"ownerName,omitempty" doc:"Owner name."`
	Category      string            `json:"category,omitempty" doc:"Skill category."`
	Homepage      string            `json:"homepage,omitempty" doc:"Skill homepage."`
	IconURL       string            `json:"iconUrl,omitempty" doc:"Skill icon URL."`
	Source        string            `json:"source,omitempty" doc:"Source registry."`
	Downloads     int64             `json:"downloads,omitempty" doc:"Download count."`
	Installs      int64             `json:"installs,omitempty" doc:"Install count."`
	Stars         int64             `json:"stars,omitempty" doc:"Star count."`
	Score         float64           `json:"score,omitempty" doc:"Showcase score."`
	Tags          []string          `json:"tags,omitempty" doc:"Skill tags."`
	Labels        map[string]string `json:"labels,omitempty" doc:"Skill labels."`
	CreatedAt     int64             `json:"createdAt,omitempty" doc:"Created timestamp."`
	UpdatedAt     int64             `json:"updatedAt,omitempty" doc:"Updated timestamp."`
}

type CCConnectSkillInstallResponse struct {
	Status           string              `json:"status" example:"ok" doc:"Operation status."`
	Timestamp        string              `json:"timestamp" example:"2026-05-18T12:30:00Z" doc:"UTC response timestamp."`
	Slug             string              `json:"slug" example:"find-skills" doc:"Installed Skills Hub slug."`
	TargetDir        string              `json:"targetDir" doc:"Primary local skill library directory used for installation."`
	TargetDirs       []string            `json:"targetDirs,omitempty" doc:"All local skill library directories used for installation."`
	Message          string              `json:"message" doc:"Human-readable result."`
	Stdout           string              `json:"stdout,omitempty" doc:"skillhub stdout."`
	Stderr           string              `json:"stderr,omitempty" doc:"skillhub stderr."`
	RuntimeRestarted bool                `json:"runtimeRestarted,omitempty" doc:"Whether AgentBox restarted CC-Connect after installation."`
	RestartError     string              `json:"restartError,omitempty" doc:"Non-fatal runtime restart error when installation succeeded."`
	Skill            *CCConnectSkillInfo `json:"skill,omitempty" doc:"Installed skill snapshot when detected."`
}

type CCConnectSkillDetailResponse struct {
	Status      string             `json:"status" example:"ok" doc:"Operation status."`
	Timestamp   string             `json:"timestamp" example:"2026-05-18T12:30:00Z" doc:"UTC response timestamp."`
	Skill       CCConnectSkillInfo `json:"skill" doc:"Local skill metadata."`
	Command     string             `json:"command" example:"/find-skills" doc:"Slash command used to invoke this skill."`
	AgentTypes  []string           `json:"agentTypes" doc:"Agent types that can see this global skill."`
	Sources     []string           `json:"sources" doc:"Local skill directories where this skill was found."`
	ContentPath string             `json:"contentPath,omitempty" doc:"SKILL.md file path used for content."`
	Content     string             `json:"content" doc:"Raw SKILL.md content when readable."`
	Errors      []string           `json:"errors,omitempty" doc:"Non-fatal detail loading errors."`
}

type ccConnectManagementSkillsPayload struct {
	Projects []struct {
		Project   string   `json:"project"`
		AgentType string   `json:"agent_type"`
		Dirs      []string `json:"dirs"`
		Skills    []struct {
			Name        string `json:"name"`
			DisplayName string `json:"display_name"`
			Description string `json:"description"`
			Source      string `json:"source"`
		} `json:"skills"`
	} `json:"projects"`
}

type ccConnectManagementSkillPresetsPayload struct {
	Version   int    `json:"version"`
	UpdatedAt string `json:"updated_at"`
	Skills    []struct {
		Name          string                 `json:"name"`
		DisplayName   string                 `json:"display_name"`
		Description   string                 `json:"description"`
		DescriptionZh string                 `json:"description_zh"`
		Version       string                 `json:"version"`
		Author        string                 `json:"author"`
		URL           string                 `json:"url"`
		AgentTypes    []string               `json:"agent_types"`
		Tags          []string               `json:"tags"`
		Featured      bool                   `json:"featured"`
		Source        *CCConnectSkillSource  `json:"source"`
		Pricing       *CCConnectSkillPricing `json:"pricing"`
	} `json:"skills"`
}

type ccConnectManagementEnvelopeFor[T any] struct {
	OK    bool   `json:"ok"`
	Data  T      `json:"data"`
	Error string `json:"error"`
}

func GetCCConnectSkills(ctx context.Context, input *struct{}) (*CCConnectSkillsOutput, error) {
	projects, err := loadCCConnectSkillProjects(ctx)
	if err != nil {
		return nil, huma.Error503ServiceUnavailable("CC-Connect skills unavailable", err)
	}

	return &CCConnectSkillsOutput{Body: CCConnectSkillsResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Projects:  projects,
		Summary:   summarizeCCConnectSkillProjects(projects),
	}}, nil
}

func GetCCConnectSkillPresets(ctx context.Context, input *struct{}) (*CCConnectSkillPresetsOutput, error) {
	payload, err := requestCCConnectManagementAPI[ccConnectManagementSkillPresetsPayload](ctx, "/api/v1/skills/presets")
	if err != nil {
		return nil, huma.Error503ServiceUnavailable("CC-Connect skill presets unavailable", err)
	}

	skills := make([]CCConnectSkillPreset, 0, len(payload.Skills))
	for _, skill := range payload.Skills {
		skills = append(skills, CCConnectSkillPreset{
			Name:          skill.Name,
			DisplayName:   skill.DisplayName,
			Description:   skill.Description,
			DescriptionZh: skill.DescriptionZh,
			Version:       skill.Version,
			Author:        skill.Author,
			URL:           skill.URL,
			AgentTypes:    append([]string(nil), skill.AgentTypes...),
			Tags:          append([]string(nil), skill.Tags...),
			Featured:      skill.Featured,
			Source:        skill.Source,
			Pricing:       skill.Pricing,
		})
	}

	return &CCConnectSkillPresetsOutput{Body: CCConnectSkillPresetsResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Version:   payload.Version,
		UpdatedAt: payload.UpdatedAt,
		Skills:    skills,
	}}, nil
}

func GetCCConnectSkillsShowcaseHot(ctx context.Context, input *CCConnectSkillsShowcaseHotInput) (*CCConnectSkillsShowcaseHotOutput, error) {
	refresh := false
	if input != nil {
		refresh = input.Refresh
	}
	body, err := loadCCConnectSkillHubHotShowcase(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("skillhub hot showcase failed", err)
	}
	body.Timestamp = time.Now().UTC().Format(time.RFC3339)
	body.Cache = CCConnectCacheInfo{Refresh: refresh}
	return &CCConnectSkillsShowcaseHotOutput{Body: body}, nil
}

func SearchCCConnectSkills(ctx context.Context, input *CCConnectSkillsSearchInput) (*CCConnectSkillsSearchOutput, error) {
	query := ""
	limit := 20
	if input != nil {
		query = strings.TrimSpace(input.Query)
		if input.Limit > 0 {
			limit = input.Limit
		}
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if query == "" {
		return &CCConnectSkillsSearchOutput{Body: CCConnectSkillsSearchResponse{
			Status:    "ok",
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Query:     query,
			Source:    "skillhub",
			Results:   []CCConnectSkillHubResult{},
		}}, nil
	}

	path := toolenv.ResolveToolPath("skillhub")
	if path == "" {
		return nil, huma.Error409Conflict("未检测到 skillhub CLI，无法搜索 Skills Hub。")
	}
	results, err := searchCCConnectSkillHub(ctx, path, query, limit)
	if err != nil {
		return nil, huma.Error500InternalServerError("skillhub skills search failed", err)
	}
	return &CCConnectSkillsSearchOutput{Body: CCConnectSkillsSearchResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Query:     query,
		Source:    "skillhub",
		Results:   results,
	}}, nil
}

func GetCCConnectSkill(ctx context.Context, input *CCConnectSkillDetailInput) (*CCConnectSkillDetailOutput, error) {
	if input == nil || strings.TrimSpace(input.Name) == "" {
		return nil, huma.Error400BadRequest("skill name is required", nil)
	}
	name := strings.TrimSpace(input.Name)
	projects, err := loadCCConnectSkillProjects(ctx)
	if err != nil {
		return nil, huma.Error503ServiceUnavailable("CC-Connect skills unavailable", err)
	}
	body, err := buildCCConnectSkillDetail(projects, name)
	if err != nil {
		return nil, huma.Error404NotFound("CC-Connect skill not found", err)
	}
	return &CCConnectSkillDetailOutput{Body: body}, nil
}

func InstallCCConnectSkill(ctx context.Context, input *CCConnectSkillInstallInput) (*CCConnectSkillInstallOutput, error) {
	if input == nil || strings.TrimSpace(input.Body.Slug) == "" {
		return nil, huma.Error400BadRequest("skill slug is required", nil)
	}
	slug := strings.TrimSpace(input.Body.Slug)
	path := toolenv.ResolveToolPath("skillhub")
	if path == "" {
		return nil, huma.Error409Conflict("未检测到 skillhub CLI，无法安装 Skills Hub 技能。")
	}

	projects, err := ccConnectProjectsForSkillInstall(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("resolve cc-connect skill directories failed", err)
	}
	targetDirs, err := selectCCConnectGlobalSkillInstallDirs(projects)
	if err != nil {
		return nil, huma.Error500InternalServerError("resolve cc-connect global skill libraries failed", err)
	}
	var stdoutParts []string
	var stderrParts []string
	for _, targetDir := range targetDirs {
		if err := os.MkdirAll(targetDir, 0o755); err != nil {
			return nil, huma.Error500InternalServerError("create cc-connect skill directory failed", err)
		}
		stdout, stderr, err := installCCConnectSkillHubSkill(ctx, path, targetDir, slug, input.Body.Force)
		if stdout != "" {
			stdoutParts = append(stdoutParts, stdout)
		}
		if stderr != "" {
			stderrParts = append(stderrParts, stderr)
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("skillhub skill install failed", errors.New(strings.TrimSpace(stderr+"\n"+err.Error())))
		}
	}

	restartRuntime := input.Body.RestartRuntime != nil && *input.Body.RestartRuntime
	runtimeRestarted := false
	restartError := ""
	if restartRuntime {
		if _, err := runCCConnectRuntimeAction(ctx, "restart"); err != nil {
			restartError = err.Error()
		} else {
			runtimeRestarted = true
		}
	}

	refreshedProjects, _ := ccConnectProjectsForSkillInstall(ctx)
	if len(refreshedProjects) == 0 {
		refreshedProjects = projects
	}
	skill := findCCConnectInstalledSkill(refreshedProjects, "", slug)
	message := "Skill installed to CC-Connect local skill library."
	if runtimeRestarted {
		message = "Skill installed to CC-Connect local skill library and runtime restarted."
	} else if restartRuntime && restartError != "" {
		message = "Skill installed to CC-Connect local skill library, but runtime restart failed."
	}

	invalidateCCConnectEnvironmentCache()
	return &CCConnectSkillInstallOutput{Body: CCConnectSkillInstallResponse{
		Status:           "ok",
		Timestamp:        time.Now().UTC().Format(time.RFC3339),
		Slug:             slug,
		TargetDir:        targetDirs[0],
		TargetDirs:       targetDirs,
		Message:          message,
		Stdout:           strings.TrimSpace(strings.Join(stdoutParts, "\n")),
		Stderr:           strings.TrimSpace(strings.Join(stderrParts, "\n")),
		RuntimeRestarted: runtimeRestarted,
		RestartError:     restartError,
		Skill:            skill,
	}}, nil
}

func requestCCConnectManagementAPI[T any](ctx context.Context, path string) (T, error) {
	var zero T
	baseURL, token, err := ccConnectManagementCredentials()
	if err != nil {
		return zero, err
	}

	reqCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()

	url := strings.TrimRight(baseURL, "/") + path
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	if err != nil {
		return zero, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return zero, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return zero, fmt.Errorf("management endpoint %s returned HTTP %d", path, res.StatusCode)
	}

	var envelope ccConnectManagementEnvelopeFor[T]
	if err := json.NewDecoder(res.Body).Decode(&envelope); err != nil {
		return zero, err
	}
	if !envelope.OK {
		if envelope.Error != "" {
			return zero, errors.New(envelope.Error)
		}
		return zero, fmt.Errorf("management endpoint %s returned ok=false", path)
	}
	return envelope.Data, nil
}

func ccConnectManagementCredentials() (string, string, error) {
	config, _, parsed := detectCCConnectConfig()
	if parsed == nil {
		if config.Error != "" {
			return "", "", errors.New(config.Error)
		}
		return "", "", errors.New("config.toml is not parsed")
	}
	if !config.Management.Enabled {
		return "", "", errors.New("management API is disabled")
	}
	if !config.Management.TokenSet || strings.TrimSpace(parsed.Management.Token) == "" {
		return "", "", errors.New("management token is empty")
	}
	if strings.TrimSpace(config.Management.URL) == "" {
		return "", "", errors.New("management API URL is empty")
	}
	return config.Management.URL, parsed.Management.Token, nil
}

func searchCCConnectSkillHub(ctx context.Context, path string, query string, limit int) ([]CCConnectSkillHubResult, error) {
	args := []string{"--skip-self-upgrade", "search", "--json", "--search-limit", strconv.Itoa(limit)}
	args = append(args, strings.Fields(query)...)
	stdout, stderr, err := runCCConnectSkillHubCommand(ctx, 25*time.Second, path, args...)
	if err != nil {
		return nil, errors.New(strings.TrimSpace(stderr + "\n" + err.Error()))
	}

	var payload struct {
		Results []CCConnectSkillHubResult `json:"results"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(stdout)), &payload); err != nil {
		return nil, errors.New("skillhub search did not return valid JSON: " + strings.TrimSpace(stderr))
	}
	if payload.Results == nil {
		payload.Results = []CCConnectSkillHubResult{}
	}
	for index := range payload.Results {
		payload.Results[index].Source = "skillhub"
		if payload.Results[index].Summary == "" {
			payload.Results[index].Summary = payload.Results[index].Description
		}
	}
	return payload.Results, nil
}

func loadCCConnectSkillHubHotShowcase(ctx context.Context) (CCConnectSkillsShowcaseHotResponse, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, ccConnectSkillHubHotShowcaseURL, nil)
	if err != nil {
		return CCConnectSkillsShowcaseHotResponse{}, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return CCConnectSkillsShowcaseHotResponse{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return CCConnectSkillsShowcaseHotResponse{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return CCConnectSkillsShowcaseHotResponse{}, errors.New("skillhub showcase returned " + resp.Status)
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
		return CCConnectSkillsShowcaseHotResponse{}, err
	}

	skills := make([]CCConnectShowcaseHotSkill, 0, len(payload.Skills))
	for _, skill := range payload.Skills {
		slug := strings.TrimSpace(skill.Slug)
		if slug == "" {
			continue
		}
		skills = append(skills, CCConnectShowcaseHotSkill{
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
			Tags:          append([]string(nil), skill.Tags...),
			Labels:        skill.Labels,
			CreatedAt:     skill.CreatedAt,
			UpdatedAt:     skill.UpdatedAt,
		})
	}

	section := strings.TrimSpace(payload.Section)
	if section == "" {
		section = "hot_downloads"
	}
	return CCConnectSkillsShowcaseHotResponse{
		Section:   section,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Cache:     CCConnectCacheInfo{Refresh: true},
		Skills:    skills,
	}, nil
}

func installCCConnectSkillHubSkill(ctx context.Context, path string, targetDir string, slug string, force bool) (string, string, error) {
	args := []string{"--skip-self-upgrade", "--dir", targetDir, "install"}
	if force {
		args = append(args, "--force")
	}
	args = append(args, slug)
	return runCCConnectSkillHubCommand(ctx, 2*time.Minute, path, args...)
}

func runCCConnectSkillHubCommand(ctx context.Context, timeout time.Duration, path string, args ...string) (string, string, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, path, args...)
	cmd.Env = toolenv.CommandEnv()
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if cmdCtx.Err() != nil {
		return stdout.String(), stderr.String(), cmdCtx.Err()
	}
	return stdout.String(), stderr.String(), err
}

func ccConnectProjectsForSkillInstall(ctx context.Context) ([]CCConnectProjectSkills, error) {
	return loadCCConnectSkillProjects(ctx)
}

func loadCCConnectSkillProjects(ctx context.Context) ([]CCConnectProjectSkills, error) {
	payload, err := requestCCConnectManagementAPI[ccConnectManagementSkillsPayload](ctx, "/api/v1/skills")
	if err == nil {
		projects := make([]CCConnectProjectSkills, 0, len(payload.Projects))
		for _, project := range payload.Projects {
			skills := scanCCConnectSkillDirs(project.Dirs)
			if len(skills) == 0 {
				skills = make([]CCConnectSkillInfo, 0, len(project.Skills))
			}
			for _, skill := range project.Skills {
				if len(skills) > 0 && ccConnectSkillInfoExists(skills, skill.Name) {
					continue
				}
				skills = append(skills, CCConnectSkillInfo{
					Name:        strings.TrimSpace(skill.Name),
					DisplayName: strings.TrimSpace(skill.DisplayName),
					Description: strings.TrimSpace(skill.Description),
					Source:      strings.TrimSpace(skill.Source),
				})
			}
			projects = append(projects, CCConnectProjectSkills{
				Project:   strings.TrimSpace(project.Project),
				AgentType: strings.TrimSpace(project.AgentType),
				Dirs:      append([]string(nil), project.Dirs...),
				Skills:    skills,
			})
		}
		if len(projects) > 0 {
			return projects, nil
		}
	}

	return loadCCConnectSkillProjectsFromConfig()
}

func loadCCConnectSkillProjectsFromConfig() ([]CCConnectProjectSkills, error) {
	config, _, parsed := detectCCConnectConfig()
	if parsed == nil {
		if config.Error != "" {
			return nil, errors.New(config.Error)
		}
		return nil, errors.New("config.toml is not parsed")
	}
	projects := make([]CCConnectProjectSkills, 0, len(parsed.Projects))
	for _, project := range parsed.Projects {
		agentType := strings.TrimSpace(project.Agent.Type)
		dirs := deriveCCConnectSkillDirs(agentType, stringOption(project.Agent.Options, "work_dir"), stringOption(project.Agent.Options, "codex_home"))
		projects = append(projects, CCConnectProjectSkills{
			Project:   strings.TrimSpace(project.Name),
			AgentType: agentType,
			Dirs:      dirs,
			Skills:    scanCCConnectSkillDirs(dirs),
		})
	}
	if len(projects) == 0 {
		return nil, errors.New("cc-connect has no configured projects")
	}
	return projects, nil
}

func summarizeCCConnectSkillProjects(projects []CCConnectProjectSkills) CCConnectSkillsSummary {
	summary := CCConnectSkillsSummary{
		ProjectCount: len(projects),
		AgentTypes:   map[string]int{},
	}
	for _, project := range projects {
		summary.SkillCount += len(project.Skills)
		summary.DirCount += len(project.Dirs)
		if project.AgentType != "" {
			summary.AgentTypes[project.AgentType] += len(project.Skills)
		}
	}
	return summary
}

func buildCCConnectSkillDetail(projects []CCConnectProjectSkills, name string) (CCConnectSkillDetailResponse, error) {
	var skill *CCConnectSkillInfo
	agentTypes := make([]string, 0)
	sources := make([]string, 0)
	for _, project := range projects {
		for index := range project.Skills {
			candidate := project.Skills[index]
			if !sameCCConnectSkillName(candidate.Name, name) && !sameCCConnectSkillName(candidate.DisplayName, name) {
				continue
			}
			if skill == nil {
				skillCopy := candidate
				skill = &skillCopy
			}
			if project.AgentType != "" {
				agentTypes = append(agentTypes, project.AgentType)
			}
			if candidate.Source != "" {
				sources = append(sources, candidate.Source)
			}
		}
	}
	if skill == nil {
		return CCConnectSkillDetailResponse{}, fmt.Errorf("skill %q not found", name)
	}

	agentTypes = uniqueCCConnectStrings(agentTypes)
	sources = uniqueCCConnectStrings(sources)
	contentPath := ""
	content := ""
	detailErrors := make([]string, 0)
	for _, source := range sources {
		path := filepath.Join(source, "SKILL.md")
		data, err := os.ReadFile(path)
		if err != nil {
			detailErrors = append(detailErrors, path+": "+err.Error())
			continue
		}
		contentPath = path
		content = string(data)
		break
	}

	return CCConnectSkillDetailResponse{
		Status:      "ok",
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		Skill:       *skill,
		Command:     "/" + skill.Name,
		AgentTypes:  agentTypes,
		Sources:     sources,
		ContentPath: contentPath,
		Content:     content,
		Errors:      detailErrors,
	}, nil
}

func selectCCConnectGlobalSkillInstallDirs(projects []CCConnectProjectSkills) ([]string, error) {
	dirs := make([]string, 0)
	for _, project := range projects {
		projectDirs := cleanCCConnectSkillDirs(project.Dirs)
		candidates := ccConnectUserSkillDirCandidates(project.AgentType)
		selected := ""
		for _, candidate := range candidates {
			for _, dir := range projectDirs {
				if sameCCConnectPath(dir, candidate) {
					selected = dir
					break
				}
			}
			if selected != "" {
				break
			}
		}
		if selected == "" && len(candidates) > 0 {
			selected = candidates[0]
		}
		if selected != "" {
			dirs = append(dirs, selected)
		}
	}
	if len(dirs) == 0 {
		if home, err := os.UserHomeDir(); err == nil && home != "" {
			dirs = append(dirs, filepath.Join(home, ".agents", "skills"))
		}
	}
	dirs = uniqueCCConnectStrings(dirs)
	if len(dirs) == 0 {
		return nil, errors.New("global skill library directory is unavailable")
	}
	return dirs, nil
}

func selectCCConnectSkillInstallProject(projects []CCConnectProjectSkills, projectName string, agentType string) (CCConnectProjectSkills, error) {
	projectName = strings.TrimSpace(projectName)
	agentType = strings.ToLower(strings.TrimSpace(agentType))
	if projectName != "" {
		for _, project := range projects {
			if project.Project == projectName {
				return project, nil
			}
		}
		return CCConnectProjectSkills{}, fmt.Errorf("project %q not found", projectName)
	}
	if agentType != "" {
		for _, project := range projects {
			if strings.EqualFold(project.AgentType, agentType) {
				return project, nil
			}
		}
		return CCConnectProjectSkills{}, fmt.Errorf("agent type %q not found", agentType)
	}
	if len(projects) == 0 {
		return CCConnectProjectSkills{}, errors.New("cc-connect has no projects")
	}
	return projects[0], nil
}

func selectCCConnectSkillInstallDir(project CCConnectProjectSkills) (string, error) {
	dirs := cleanCCConnectSkillDirs(project.Dirs)
	if len(dirs) == 0 {
		return "", errors.New("project has no skill directories")
	}
	for _, candidate := range ccConnectUserSkillDirCandidates(project.AgentType) {
		for _, dir := range dirs {
			if sameCCConnectPath(dir, candidate) {
				return dir, nil
			}
		}
	}
	home, _ := os.UserHomeDir()
	if home != "" {
		home = filepath.Clean(home)
		for index := len(dirs) - 1; index >= 0; index-- {
			dir := filepath.Clean(dirs[index])
			if dir == home || strings.HasPrefix(dir, home+string(os.PathSeparator)) {
				return dirs[index], nil
			}
		}
	}
	return dirs[len(dirs)-1], nil
}

func ccConnectUserSkillDirCandidates(agentType string) []string {
	home, _ := os.UserHomeDir()
	candidates := make([]string, 0, 4)
	addHome := func(parts ...string) {
		if home != "" {
			candidates = append(candidates, filepath.Join(append([]string{home}, parts...)...))
		}
	}
	switch strings.ToLower(strings.TrimSpace(agentType)) {
	case "codex":
		if codexHome := strings.TrimSpace(os.Getenv("CODEX_HOME")); codexHome != "" {
			candidates = append(candidates, filepath.Join(expandCCConnectHomePath(codexHome), "skills"))
		}
		addHome(".agents", "skills")
		addHome(".codex", "skills")
	case "gemini":
		addHome(".gemini", "skills")
	case "kimi":
		addHome(".kimi", "skills")
	case "pi":
		addHome(".pi", "skills")
	case "claudecode", "claude", "cursor", "qoder":
		if claudeConfigDir := strings.TrimSpace(os.Getenv("CLAUDE_CONFIG_DIR")); claudeConfigDir != "" {
			candidates = append(candidates, filepath.Join(expandCCConnectHomePath(claudeConfigDir), "skills"))
		}
		addHome(".claude", "skills")
	default:
		addHome(".agents", "skills")
		addHome(".claude", "skills")
		addHome(".codex", "skills")
	}
	return uniqueCCConnectStrings(candidates)
}

func deriveCCConnectSkillDirs(agentType string, workDir string, codexHome string) []string {
	home, _ := os.UserHomeDir()
	workDir = strings.TrimSpace(workDir)
	if workDir == "" {
		workDir = "."
	}
	workDir = expandCCConnectHomePath(workDir)
	if abs, err := filepath.Abs(workDir); err == nil {
		workDir = abs
	}

	dirs := make([]string, 0, 4)
	switch strings.ToLower(strings.TrimSpace(agentType)) {
	case "codex":
		dirs = append(dirs, filepath.Join(workDir, ".agents", "skills"), filepath.Join(workDir, ".codex", "skills"))
		if codexHome = strings.TrimSpace(codexHome); codexHome != "" {
			dirs = append(dirs, filepath.Join(expandCCConnectHomePath(codexHome), "skills"))
		} else if envCodexHome := strings.TrimSpace(os.Getenv("CODEX_HOME")); envCodexHome != "" {
			dirs = append(dirs, filepath.Join(expandCCConnectHomePath(envCodexHome), "skills"))
		} else if home != "" {
			dirs = append(dirs, filepath.Join(home, ".codex", "skills"))
		}
		if home != "" {
			dirs = append(dirs, filepath.Join(home, ".agents", "skills"))
		}
	case "gemini":
		dirs = append(dirs, filepath.Join(workDir, ".gemini", "skills"))
		if home != "" {
			dirs = append(dirs, filepath.Join(home, ".gemini", "skills"))
		}
	case "kimi":
		dirs = append(dirs, filepath.Join(workDir, ".kimi", "skills"))
		if home != "" {
			dirs = append(dirs, filepath.Join(home, ".kimi", "skills"))
		}
	case "pi":
		dirs = append(dirs, filepath.Join(workDir, ".pi", "skills"))
		if home != "" {
			dirs = append(dirs, filepath.Join(home, ".pi", "skills"))
		}
	default:
		dirs = append(dirs, filepath.Join(workDir, ".claude", "skills"))
		if claudeConfigDir := strings.TrimSpace(os.Getenv("CLAUDE_CONFIG_DIR")); claudeConfigDir != "" {
			dirs = append(dirs, filepath.Join(expandCCConnectHomePath(claudeConfigDir), "skills"))
		} else if home != "" {
			dirs = append(dirs, filepath.Join(home, ".claude", "skills"))
		}
	}
	return uniqueCCConnectStrings(dirs)
}

func scanCCConnectSkillDirs(dirs []string) []CCConnectSkillInfo {
	seen := map[string]bool{}
	visited := map[string]bool{}
	skills := make([]CCConnectSkillInfo, 0)
	for _, dir := range cleanCCConnectSkillDirs(dirs) {
		skills = append(skills, scanCCConnectSkillDir(dir, dir, seen, visited)...)
	}
	sort.Slice(skills, func(i, j int) bool { return skills[i].Name < skills[j].Name })
	return skills
}

func scanCCConnectSkillDir(root string, current string, seen map[string]bool, visited map[string]bool) []CCConnectSkillInfo {
	real := realCCConnectPath(current)
	if visited[real] {
		return nil
	}
	visited[real] = true
	entries, err := os.ReadDir(current)
	if err != nil {
		return nil
	}
	result := make([]CCConnectSkillInfo, 0)
	for _, entry := range entries {
		fullPath := filepath.Join(current, entry.Name())
		if entry.Name() == "SKILL.md" {
			skillDir := filepath.Dir(fullPath)
			if sameCCConnectPath(skillDir, root) {
				continue
			}
			name := filepath.Base(skillDir)
			normalized := strings.ToLower(name)
			if seen[normalized] {
				continue
			}
			data, err := os.ReadFile(fullPath)
			if err != nil {
				continue
			}
			skill, ok := parseCCConnectSkillMD(name, string(data), skillDir)
			if !ok {
				continue
			}
			seen[normalized] = true
			result = append(result, skill)
			continue
		}
		if shouldDescendCCConnectSkillPath(fullPath, entry) {
			result = append(result, scanCCConnectSkillDir(root, fullPath, seen, visited)...)
		}
	}
	return result
}

func parseCCConnectSkillMD(name string, raw string, source string) (CCConnectSkillInfo, bool) {
	content := strings.TrimSpace(raw)
	if content == "" {
		return CCConnectSkillInfo{}, false
	}
	frontmatter := map[string]string{}
	body := content
	if strings.HasPrefix(content, "---") {
		rest := content[3:]
		if end := strings.Index(rest, "\n---"); end >= 0 {
			frontmatter = parseCCConnectSkillFrontmatter(rest[:end])
			body = strings.TrimSpace(rest[end+4:])
		}
	}
	if body == "" {
		return CCConnectSkillInfo{}, false
	}
	description := strings.TrimSpace(frontmatter["description"])
	if description == "" {
		description = firstNonEmptyLine(body)
		if len([]rune(description)) > 80 {
			description = string([]rune(description)[:80]) + "..."
		}
	}
	return CCConnectSkillInfo{
		Name:        name,
		DisplayName: strings.TrimSpace(frontmatter["name"]),
		Description: description,
		Source:      source,
	}, true
}

func parseCCConnectSkillFrontmatter(block string) map[string]string {
	values := map[string]string{}
	lines := strings.Split(block, "\n")
	for index := 0; index < len(lines); index++ {
		line := strings.TrimSpace(lines[index])
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if value == ">-" || value == "|-" || value == ">" || value == "|" {
			blockLines := make([]string, 0)
			for index+1 < len(lines) {
				next := lines[index+1]
				if len(next) > 0 && next[0] != ' ' && next[0] != '\t' {
					break
				}
				index++
				blockLines = append(blockLines, strings.TrimSpace(next))
			}
			value = strings.TrimSpace(strings.Join(blockLines, "\n"))
		}
		value = strings.Trim(value, `"'`)
		if key != "" {
			values[key] = value
		}
	}
	return values
}

func shouldDescendCCConnectSkillPath(path string, entry os.DirEntry) bool {
	if entry.IsDir() {
		return true
	}
	if entry.Type()&os.ModeSymlink == 0 {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func findCCConnectInstalledSkill(projects []CCConnectProjectSkills, projectName string, slug string) *CCConnectSkillInfo {
	candidates := []string{strings.Trim(strings.TrimSpace(slug), "/")}
	if candidates[0] != "" && strings.Contains(candidates[0], "/") {
		parts := strings.Split(candidates[0], "/")
		candidates = append(candidates, parts[len(parts)-1])
	}
	for _, project := range projects {
		if projectName != "" && project.Project != projectName {
			continue
		}
		for index := range project.Skills {
			for _, candidate := range candidates {
				if sameCCConnectSkillName(project.Skills[index].Name, candidate) {
					return &project.Skills[index]
				}
			}
		}
	}
	return nil
}

func ccConnectSkillInfoExists(skills []CCConnectSkillInfo, name string) bool {
	for _, skill := range skills {
		if sameCCConnectSkillName(skill.Name, name) {
			return true
		}
	}
	return false
}

func sameCCConnectSkillName(a string, b string) bool {
	return strings.EqualFold(strings.ReplaceAll(a, "-", "_"), strings.ReplaceAll(b, "-", "_"))
}

func cleanCCConnectSkillDirs(dirs []string) []string {
	result := make([]string, 0, len(dirs))
	for _, dir := range dirs {
		dir = strings.TrimSpace(dir)
		if dir == "" {
			continue
		}
		result = append(result, filepath.Clean(expandCCConnectHomePath(dir)))
	}
	return uniqueCCConnectStrings(result)
}

func expandCCConnectHomePath(path string) string {
	path = strings.TrimSpace(path)
	if strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil && home != "" {
			return filepath.Join(home, strings.TrimPrefix(path, "~/"))
		}
	}
	return path
}

func sameCCConnectPath(a string, b string) bool {
	return realCCConnectPath(a) == realCCConnectPath(b)
}

func realCCConnectPath(path string) string {
	path = filepath.Clean(expandCCConnectHomePath(path))
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		return filepath.Clean(resolved)
	}
	return path
}

func uniqueCCConnectStrings(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		key := filepath.Clean(value)
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, key)
	}
	return result
}
