package openclaw

// 该文件负责为管理界面暴露 OpenClaw memory-core Dreaming 状态。
//
// 它聚合 openclaw.json 中的 Dreaming 配置、Agent workspace 下的
// memory/.dreams 状态、Dream Diary 文件和只读 CLI 状态。配置更新接口只允许修改
// Dreaming 的小范围用户设置，避免前端为了开关功能提交完整 openclaw.json。

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

const (
	defaultDreamingFrequency = "0 3 * * *"
	defaultDreamingPluginID  = "memory-core"
	dreamDiaryStartMarker    = "<!-- openclaw:dreaming:diary:start -->"
	dreamDiaryEndMarker      = "<!-- openclaw:dreaming:diary:end -->"
	backfillEntryMarker      = "openclaw:dreaming:backfill-entry"
)

type OpenClawDreamingInput struct {
	AgentID string `query:"agentId" doc:"Selected OpenClaw agent id." example:"main"`
}

type OpenClawDreamingDiaryInput struct {
	AgentID string `query:"agentId" doc:"Selected OpenClaw agent id." example:"main"`
}

type OpenClawDreamingConfigInput struct {
	Body OpenClawDreamingConfigPatch
}

type OpenClawDreamingActionInput struct {
	AgentID string `query:"agentId" doc:"Selected OpenClaw agent id." example:"main"`
}

type OpenClawDreamingOutput struct {
	Body OpenClawDreamingResponse
}

type OpenClawDreamingDiaryOutput struct {
	Body OpenClawDreamDiaryResponse
}

type OpenClawDreamingConfigOutput struct {
	Body OpenClawDreamingConfigResponse
}

type OpenClawDreamingActionOutput struct {
	Body OpenClawDreamingActionResponse
}

type OpenClawDreamingResponse struct {
	Status    string                       `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                       `json:"timestamp" example:"2026-05-13T02:40:00Z" doc:"UTC response timestamp."`
	Path      string                       `json:"path" doc:"OpenClaw config path."`
	Exists    bool                         `json:"exists" doc:"Whether openclaw.json exists."`
	Config    OpenClawDreamingConfigStatus `json:"config" doc:"Resolved Dreaming config."`
	Agents    []OpenClawDreamingAgent      `json:"agents" doc:"Available agents for Dreaming inspection."`
	Selected  OpenClawDreamingAgent        `json:"selected" doc:"Selected agent Dreaming workspace status."`
	Summary   OpenClawDreamingSummary      `json:"summary" doc:"Aggregated Dreaming counters for the selected agent."`
	CLI       OpenClawAgentMemoryCLIStatus `json:"cli" doc:"Best-effort openclaw memory status --json output for the selected agent."`
}

type OpenClawDreamingConfigResponse struct {
	Status    string                       `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                       `json:"timestamp" example:"2026-05-13T02:40:00Z" doc:"UTC response timestamp."`
	Path      string                       `json:"path" doc:"OpenClaw config path."`
	Exists    bool                         `json:"exists" doc:"Whether openclaw.json exists after update."`
	Config    OpenClawDreamingConfigStatus `json:"config" doc:"Resolved Dreaming config after update."`
}

type OpenClawDreamingConfigPatch struct {
	Enabled   *bool   `json:"enabled,omitempty" doc:"Enable or disable Dreaming." example:"true"`
	Frequency *string `json:"frequency,omitempty" doc:"Cron cadence for the full Dreaming sweep." example:"0 3 * * *"`
	Timezone  *string `json:"timezone,omitempty" doc:"Optional Dreaming timezone." example:"Asia/Shanghai"`
	Model     *string `json:"model,omitempty" doc:"Optional Dream Diary subagent model override." example:"anthropic/claude-sonnet-4-6"`
}

type OpenClawDreamingConfigStatus struct {
	PluginID        string `json:"pluginId" example:"memory-core" doc:"Plugin entry that owns Dreaming config."`
	Enabled         bool   `json:"enabled" example:"false" doc:"Whether Dreaming is enabled."`
	Frequency       string `json:"frequency" example:"0 3 * * *" doc:"Full sweep cron cadence."`
	Timezone        string `json:"timezone,omitempty" doc:"Resolved Dreaming timezone when configured."`
	Model           string `json:"model,omitempty" doc:"Dream Diary model override when configured."`
	StorageMode     string `json:"storageMode" example:"separate" doc:"Dreaming report storage mode."`
	SeparateReports bool   `json:"separateReports" doc:"Whether separate phase reports are enabled."`
	Phases          struct {
		Light OpenClawDreamingPhaseConfig `json:"light"`
		REM   OpenClawDreamingPhaseConfig `json:"rem"`
		Deep  OpenClawDreamingPhaseConfig `json:"deep"`
	} `json:"phases" doc:"Resolved phase configuration summary."`
}

type OpenClawDreamingPhaseConfig struct {
	Enabled             bool    `json:"enabled" doc:"Whether the phase is enabled under the master switch."`
	Limit               int     `json:"limit,omitempty" doc:"Maximum candidates for this phase."`
	LookbackDays        int     `json:"lookbackDays,omitempty" doc:"Lookback window for light/REM."`
	MinScore            float64 `json:"minScore,omitempty" doc:"Deep promotion minimum score."`
	MinRecallCount      int     `json:"minRecallCount,omitempty" doc:"Deep promotion minimum signal count."`
	MinUniqueQueries    int     `json:"minUniqueQueries,omitempty" doc:"Deep promotion minimum context diversity."`
	RecencyHalfLifeDays int     `json:"recencyHalfLifeDays,omitempty" doc:"Deep recency half-life in days."`
	MaxAgeDays          int     `json:"maxAgeDays,omitempty" doc:"Deep maximum candidate age in days."`
	MinPatternStrength  float64 `json:"minPatternStrength,omitempty" doc:"REM minimum pattern strength."`
}

type OpenClawDreamingAgent struct {
	ID        string                 `json:"id" example:"main" doc:"Agent id."`
	Name      string                 `json:"name,omitempty" doc:"Agent display name."`
	Workspace string                 `json:"workspace" doc:"Agent workspace path."`
	IsDefault bool                   `json:"isDefault" doc:"Whether this is the default agent."`
	Diary     OpenClawDreamDiaryInfo `json:"diary" doc:"Dream Diary file status."`
	Store     OpenClawDreamStoreInfo `json:"store" doc:"Dreaming machine-state file status."`
	Reports   []OpenClawDreamReport  `json:"reports" doc:"Recent phase reports."`
}

type OpenClawDreamingSummary struct {
	ShortTermCount      int `json:"shortTermCount" doc:"Number of live short-term Dreaming entries."`
	RecallSignalCount   int `json:"recallSignalCount" doc:"Total recall signals."`
	DailySignalCount    int `json:"dailySignalCount" doc:"Total daily/session ingestion signals."`
	GroundedSignalCount int `json:"groundedSignalCount" doc:"Total grounded backfill signals."`
	TotalSignalCount    int `json:"totalSignalCount" doc:"Total promotion signals."`
	PromotedCount       int `json:"promotedCount" doc:"Entries already promoted to MEMORY.md."`
	PhaseSignalCount    int `json:"phaseSignalCount" doc:"Entries with Light or REM phase hits."`
	LightPhaseHitCount  int `json:"lightPhaseHitCount" doc:"Total Light hits."`
	REMPhaseHitCount    int `json:"remPhaseHitCount" doc:"Total REM hits."`
}

type OpenClawDreamDiaryInfo struct {
	Path         string `json:"path" doc:"Absolute Dream Diary path."`
	RelativePath string `json:"relativePath" doc:"Workspace-relative diary path."`
	Exists       bool   `json:"exists" doc:"Whether the diary exists."`
	Size         int64  `json:"size,omitempty" doc:"Diary file size in bytes."`
	UpdatedAt    string `json:"updatedAt,omitempty" doc:"Diary modification time."`
}

type OpenClawDreamDiaryResponse struct {
	Status    string                 `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                 `json:"timestamp" example:"2026-05-13T02:40:00Z" doc:"UTC response timestamp."`
	AgentID   string                 `json:"agentId" example:"main" doc:"Agent id."`
	Diary     OpenClawDreamDiaryInfo `json:"diary" doc:"Dream Diary file status."`
	Content   string                 `json:"content" doc:"Dream Diary markdown content."`
}

type OpenClawDreamingActionResponse struct {
	Status                  string                 `json:"status" example:"ok" doc:"Operation status."`
	Timestamp               string                 `json:"timestamp" example:"2026-05-13T02:40:00Z" doc:"UTC response timestamp."`
	AgentID                 string                 `json:"agentId" example:"main" doc:"Agent id."`
	Action                  string                 `json:"action" example:"backfill" doc:"Dreaming action name."`
	Diary                   OpenClawDreamDiaryInfo `json:"diary" doc:"Dream Diary file status after action."`
	Path                    string                 `json:"path,omitempty" doc:"Dream Diary path touched by the action."`
	Found                   bool                   `json:"found" doc:"Whether Dream Diary exists after the action."`
	SourcePath              string                 `json:"sourcePath,omitempty" doc:"Historical memory source path used for backfill."`
	ScannedFiles            int                    `json:"scannedFiles,omitempty" doc:"Historical daily files scanned."`
	GroundedFiles           int                    `json:"groundedFiles,omitempty" doc:"Grounded REM files produced by backfill."`
	Written                 int                    `json:"written,omitempty" doc:"Backfill diary entries written."`
	Replaced                int                    `json:"replaced,omitempty" doc:"Existing backfill diary entries replaced."`
	RemovedEntries          int                    `json:"removedEntries,omitempty" doc:"Backfill diary entries removed."`
	ShortTermStorePath      string                 `json:"shortTermStorePath,omitempty" doc:"Grounded short-term recall store path."`
	RemovedShortTermEntries int                    `json:"removedShortTermEntries,omitempty" doc:"Grounded-only short-term entries removed."`
}

type OpenClawDreamStoreInfo struct {
	Dir                   string `json:"dir" doc:"Absolute memory/.dreams directory."`
	Exists                bool   `json:"exists" doc:"Whether memory/.dreams exists."`
	ShortTermRecallPath   string `json:"shortTermRecallPath" doc:"short-term-recall.json path."`
	ShortTermRecallExists bool   `json:"shortTermRecallExists" doc:"Whether short-term recall store exists."`
	PhaseSignalsPath      string `json:"phaseSignalsPath" doc:"phase-signals.json path."`
	PhaseSignalsExists    bool   `json:"phaseSignalsExists" doc:"Whether phase signal store exists."`
	SessionCorpusDir      string `json:"sessionCorpusDir" doc:"Dreaming session corpus directory."`
	SessionCorpusExists   bool   `json:"sessionCorpusExists" doc:"Whether session corpus exists."`
	Error                 string `json:"error,omitempty" doc:"Store read error when any."`
}

type OpenClawDreamReport struct {
	Phase        string `json:"phase" example:"light" doc:"Dreaming phase."`
	RelativePath string `json:"relativePath" doc:"Workspace-relative report path."`
	Path         string `json:"path" doc:"Absolute report path."`
	Size         int64  `json:"size,omitempty" doc:"Report size in bytes."`
	UpdatedAt    string `json:"updatedAt,omitempty" doc:"Report modification time."`
}

func GetOpenClawDreaming(ctx context.Context, input *OpenClawDreamingInput) (*OpenClawDreamingOutput, error) {
	payload, content, err := loadDreamingAgentsAndConfig()
	if err != nil {
		return nil, err
	}
	selected := selectDreamingAgent(payload.Agents, inputAgentID(input))
	config := resolveOpenClawDreamingConfig(content)
	summary := summarizeDreamingWorkspace(selected.Workspace)
	selected.Store = dreamingStoreInfo(selected.Workspace)
	selected.Diary = dreamingDiaryInfo(selected.Workspace)
	selected.Reports = listDreamingReports(selected.Workspace)

	cliStatus := openClawAgentMemoryCLIStatus(ctx, selected.ID)
	return &OpenClawDreamingOutput{Body: OpenClawDreamingResponse{
		Status:    payload.Status,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Path:      payload.Path,
		Exists:    payload.Exists,
		Config:    config,
		Agents:    payload.Agents,
		Selected:  selected,
		Summary:   summary,
		CLI:       cliStatus,
	}}, nil
}

func GetOpenClawDreamDiary(ctx context.Context, input *OpenClawDreamingDiaryInput) (*OpenClawDreamingDiaryOutput, error) {
	payload, _, err := loadDreamingAgentsAndConfig()
	if err != nil {
		return nil, err
	}
	agent := selectDreamingAgent(payload.Agents, inputDiaryAgentID(input))
	diary, content, err := readDreamDiaryFile(agent.Workspace)
	if err != nil {
		return nil, err
	}
	return &OpenClawDreamingDiaryOutput{Body: OpenClawDreamDiaryResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AgentID:   agent.ID,
		Diary:     diary,
		Content:   content,
	}}, nil
}

func UpdateOpenClawDreamingConfig(ctx context.Context, input *OpenClawDreamingConfigInput) (*OpenClawDreamingConfigOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("dreaming config patch is required", nil)
	}
	configPath := openClawConfigPath()
	content, exists, err := readOpenClawConfigFile(configPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, huma.Error500InternalServerError("read openclaw config failed", err)
	}
	if !exists || content == nil {
		content = map[string]any{}
	}
	pluginID := resolveDreamingPluginID(content)
	plugins := objectMap(content["plugins"])
	entries := objectMap(plugins["entries"])
	entry := objectMap(entries[pluginID])
	pluginConfig := objectMap(entry["config"])
	dreaming := objectMap(pluginConfig["dreaming"])

	if input.Body.Enabled != nil {
		dreaming["enabled"] = *input.Body.Enabled
	}
	if input.Body.Frequency != nil {
		if frequency := strings.TrimSpace(*input.Body.Frequency); frequency != "" {
			dreaming["frequency"] = frequency
		} else {
			delete(dreaming, "frequency")
		}
	}
	if input.Body.Timezone != nil {
		if timezone := strings.TrimSpace(*input.Body.Timezone); timezone != "" {
			dreaming["timezone"] = timezone
		} else {
			delete(dreaming, "timezone")
		}
	}
	if input.Body.Model != nil {
		if model := strings.TrimSpace(*input.Body.Model); model != "" {
			dreaming["model"] = model
		} else {
			delete(dreaming, "model")
		}
	}

	pluginConfig["dreaming"] = dreaming
	entry["config"] = pluginConfig
	entries[pluginID] = entry
	plugins["entries"] = entries
	content["plugins"] = plugins

	formatted, err := json.MarshalIndent(content, "", "  ")
	if err != nil {
		return nil, huma.Error400BadRequest("openclaw config content must be valid JSON", err)
	}
	formatted = append(formatted, '\n')
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		return nil, huma.Error500InternalServerError("create openclaw config directory failed", err)
	}
	if err := os.WriteFile(configPath, formatted, 0o600); err != nil {
		return nil, huma.Error500InternalServerError("write openclaw config failed", err)
	}

	return &OpenClawDreamingConfigOutput{Body: OpenClawDreamingConfigResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Path:      configPath,
		Exists:    true,
		Config:    resolveOpenClawDreamingConfig(content),
	}}, nil
}

func BackfillOpenClawDreamDiary(ctx context.Context, input *OpenClawDreamingActionInput) (*OpenClawDreamingActionOutput, error) {
	agent, err := selectDreamingActionAgent(input)
	if err != nil {
		return nil, err
	}
	sourcePath := filepath.Join(agent.Workspace, "memory")
	sourceFiles, err := listWorkspaceDailyMemoryFiles(sourcePath)
	if err != nil {
		return nil, huma.Error500InternalServerError("scan dream diary backfill source failed", err)
	}
	if len(sourceFiles) == 0 {
		diary := dreamingDiaryInfo(agent.Workspace)
		return &OpenClawDreamingActionOutput{Body: OpenClawDreamingActionResponse{
			Status:       "ok",
			Timestamp:    time.Now().UTC().Format(time.RFC3339),
			AgentID:      agent.ID,
			Action:       "backfill",
			Diary:        diary,
			Path:         diary.Path,
			Found:        diary.Exists,
			SourcePath:   sourcePath,
			ScannedFiles: 0,
			Written:      0,
			Replaced:     0,
		}}, nil
	}

	raw, err := openClawJSONCommand(ctx, 3*time.Minute, "memory", "rem-backfill", "--json", "--agent", agent.ID, "--path", sourcePath)
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw memory rem-backfill failed", err)
	}
	var cli struct {
		SourceFiles     []string `json:"sourceFiles"`
		GroundedFiles   int      `json:"groundedFiles"`
		WrittenEntries  int      `json:"writtenEntries"`
		ReplacedEntries int      `json:"replacedEntries"`
		DreamsPath      string   `json:"dreamsPath"`
		SourcePath      string   `json:"sourcePath"`
	}
	if err := json.Unmarshal(raw, &cli); err != nil {
		return nil, huma.Error500InternalServerError("parse openclaw rem-backfill output failed", err)
	}
	diary := dreamingDiaryInfo(agent.Workspace)
	return &OpenClawDreamingActionOutput{Body: OpenClawDreamingActionResponse{
		Status:        "ok",
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
		AgentID:       agent.ID,
		Action:        "backfill",
		Diary:         diary,
		Path:          stringDefault(cli.DreamsPath, diary.Path),
		Found:         diary.Exists,
		SourcePath:    stringDefault(cli.SourcePath, sourcePath),
		ScannedFiles:  len(cli.SourceFiles),
		GroundedFiles: cli.GroundedFiles,
		Written:       cli.WrittenEntries,
		Replaced:      cli.ReplacedEntries,
	}}, nil
}

func ResetOpenClawDreamDiary(_ context.Context, input *OpenClawDreamingActionInput) (*OpenClawDreamingActionOutput, error) {
	agent, err := selectDreamingActionAgent(input)
	if err != nil {
		return nil, err
	}
	path, removed, err := removeBackfillDreamDiaryEntries(agent.Workspace)
	if err != nil {
		return nil, huma.Error500InternalServerError("reset dream diary failed", err)
	}
	diary := dreamingDiaryInfo(agent.Workspace)
	return &OpenClawDreamingActionOutput{Body: OpenClawDreamingActionResponse{
		Status:         "ok",
		Timestamp:      time.Now().UTC().Format(time.RFC3339),
		AgentID:        agent.ID,
		Action:         "reset",
		Diary:          diary,
		Path:           stringDefault(path, diary.Path),
		Found:          diary.Exists,
		RemovedEntries: removed,
	}}, nil
}

func ClearOpenClawDreamingGroundedShortTerm(_ context.Context, input *OpenClawDreamingActionInput) (*OpenClawDreamingActionOutput, error) {
	agent, err := selectDreamingActionAgent(input)
	if err != nil {
		return nil, err
	}
	storePath, removed, err := removeGroundedShortTermEntries(agent.Workspace)
	if err != nil {
		return nil, huma.Error500InternalServerError("clear grounded short-term memory failed", err)
	}
	diary := dreamingDiaryInfo(agent.Workspace)
	return &OpenClawDreamingActionOutput{Body: OpenClawDreamingActionResponse{
		Status:                  "ok",
		Timestamp:               time.Now().UTC().Format(time.RFC3339),
		AgentID:                 agent.ID,
		Action:                  "resetGroundedShortTerm",
		Diary:                   diary,
		Path:                    diary.Path,
		Found:                   diary.Exists,
		ShortTermStorePath:      storePath,
		RemovedShortTermEntries: removed,
	}}, nil
}

func loadDreamingAgentsAndConfig() (OpenClawDreamingResponse, map[string]any, error) {
	agentsPayload, err := buildOpenClawAgentsResponse()
	if err != nil {
		return OpenClawDreamingResponse{}, nil, err
	}
	content, _, readErr := readOpenClawConfigFile(openClawConfigPath())
	if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
		return OpenClawDreamingResponse{}, nil, huma.Error500InternalServerError("read openclaw config failed", readErr)
	}
	if content == nil {
		content = map[string]any{}
	}
	agents := make([]OpenClawDreamingAgent, 0, len(agentsPayload.Agents))
	for _, agent := range agentsPayload.Agents {
		agents = append(agents, OpenClawDreamingAgent{
			ID:        agent.ID,
			Name:      agent.Identity.Name,
			Workspace: agent.Workspace,
			IsDefault: agent.IsDefault,
			Diary:     dreamingDiaryInfo(agent.Workspace),
			Store:     dreamingStoreInfo(agent.Workspace),
			Reports:   listDreamingReports(agent.Workspace),
		})
	}
	return OpenClawDreamingResponse{
		Status:    agentsPayload.Status,
		Timestamp: agentsPayload.Timestamp,
		Path:      agentsPayload.Path,
		Exists:    agentsPayload.Exists,
		Agents:    agents,
	}, content, nil
}

func inputAgentID(input *OpenClawDreamingInput) string {
	if input == nil {
		return ""
	}
	return input.AgentID
}

func inputDiaryAgentID(input *OpenClawDreamingDiaryInput) string {
	if input == nil {
		return ""
	}
	return input.AgentID
}

func selectDreamingActionAgent(input *OpenClawDreamingActionInput) (OpenClawDreamingAgent, error) {
	payload, _, err := loadDreamingAgentsAndConfig()
	if err != nil {
		return OpenClawDreamingAgent{}, err
	}
	agent := selectDreamingAgent(payload.Agents, "")
	if input != nil && strings.TrimSpace(input.AgentID) != "" {
		agent = selectDreamingAgent(payload.Agents, input.AgentID)
	}
	return agent, nil
}

func selectDreamingAgent(agents []OpenClawDreamingAgent, rawID string) OpenClawDreamingAgent {
	id := normalizeOpenClawAgentID(rawID)
	for _, agent := range agents {
		if id != "" && normalizeOpenClawAgentID(agent.ID) == id {
			return agent
		}
	}
	for _, agent := range agents {
		if agent.IsDefault {
			return agent
		}
	}
	if len(agents) > 0 {
		return agents[0]
	}
	return OpenClawDreamingAgent{ID: defaultOpenClawAgentID, Workspace: filepath.Join(defaultOpenClawHomeDir(), "workspace"), IsDefault: true}
}

func listWorkspaceDailyMemoryFiles(memoryDir string) ([]string, error) {
	entries, err := os.ReadDir(memoryDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if matched := fileIsIsoDayDiary(entry.Name()); matched {
			files = append(files, filepath.Join(memoryDir, entry.Name()))
		}
	}
	sort.Strings(files)
	return files, nil
}

func fileIsIsoDayDiary(name string) bool {
	return regexp.MustCompile(`(?i)^\d{4}-\d{2}-\d{2}\.md$`).MatchString(name)
}

func removeBackfillDreamDiaryEntries(workspace string) (string, int, error) {
	info, content, err := readDreamDiaryFile(workspace)
	if err != nil {
		return info.Path, 0, err
	}
	if strings.TrimSpace(content) == "" {
		return info.Path, 0, nil
	}
	next, removed := stripBackfillDiaryBlocks(content)
	if removed == 0 {
		return info.Path, 0, nil
	}
	if err := writeDreamDiaryContent(info.Path, next); err != nil {
		return info.Path, 0, err
	}
	return info.Path, removed, nil
}

func writeDreamDiaryContent(path string, content string) error {
	if err := assertSafeDreamDiaryPath(path); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(path, []byte(ensureTrailingNewline(content)), 0o600); err != nil {
		return err
	}
	return nil
}

func ensureTrailingNewline(content string) string {
	if strings.HasSuffix(content, "\n") {
		return content
	}
	return content + "\n"
}

func assertSafeDreamDiaryPath(path string) error {
	stat, err := os.Lstat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if stat.Mode()&os.ModeSymlink != 0 {
		return errors.New("refusing to write symlinked DREAMS.md")
	}
	if !stat.Mode().IsRegular() {
		return errors.New("refusing to write non-file DREAMS.md")
	}
	return nil
}

func stripBackfillDiaryBlocks(existing string) (string, int) {
	ensured := ensureDreamDiarySection(existing)
	startIdx := strings.Index(ensured, dreamDiaryStartMarker)
	endIdx := strings.Index(ensured, dreamDiaryEndMarker)
	if startIdx < 0 || endIdx < 0 || endIdx < startIdx {
		return ensured, 0
	}
	inner := ensured[startIdx+len(dreamDiaryStartMarker) : endIdx]
	kept := make([]string, 0)
	removed := 0
	for _, block := range splitDreamDiaryBlocks(inner) {
		if strings.Contains(block, backfillEntryMarker) {
			removed++
			continue
		}
		kept = append(kept, block)
	}
	return replaceDreamDiaryContent(ensured, joinDreamDiaryBlocks(kept)), removed
}

func ensureDreamDiarySection(existing string) string {
	if strings.Contains(existing, dreamDiaryStartMarker) && strings.Contains(existing, dreamDiaryEndMarker) {
		return existing
	}
	diarySection := "# Dream Diary\n\n" + dreamDiaryStartMarker + "\n" + dreamDiaryEndMarker + "\n"
	if strings.TrimSpace(existing) == "" {
		return diarySection
	}
	return diarySection + "\n" + existing
}

func replaceDreamDiaryContent(existing string, diaryContent string) string {
	ensured := ensureDreamDiarySection(existing)
	startIdx := strings.Index(ensured, dreamDiaryStartMarker)
	endIdx := strings.Index(ensured, dreamDiaryEndMarker)
	if startIdx < 0 || endIdx < 0 || endIdx < startIdx {
		return ensured
	}
	before := ensured[:startIdx+len(dreamDiaryStartMarker)]
	after := ensured[endIdx:]
	normalized := "\n"
	if strings.TrimSpace(diaryContent) != "" {
		normalized = "\n" + strings.TrimSpace(diaryContent) + "\n"
	}
	return before + normalized + after
}

func splitDreamDiaryBlocks(content string) []string {
	parts := regexp.MustCompile(`\n---\n`).Split(content, -1)
	blocks := make([]string, 0, len(parts))
	for _, part := range parts {
		if block := strings.TrimSpace(part); block != "" {
			blocks = append(blocks, block)
		}
	}
	return blocks
}

func joinDreamDiaryBlocks(blocks []string) string {
	if len(blocks) == 0 {
		return ""
	}
	joined := make([]string, 0, len(blocks))
	for _, block := range blocks {
		joined = append(joined, "---\n\n"+strings.TrimSpace(block)+"\n")
	}
	return strings.Join(joined, "\n")
}

func removeGroundedShortTermEntries(workspace string) (string, int, error) {
	dreamsDir := filepath.Join(workspace, "memory", ".dreams")
	storePath := filepath.Join(dreamsDir, "short-term-recall.json")
	phasePath := filepath.Join(dreamsDir, "phase-signals.json")
	storeData, err := os.ReadFile(storePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return storePath, 0, nil
		}
		return storePath, 0, err
	}
	phaseData, err := os.ReadFile(phasePath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return storePath, 0, err
	}

	var store map[string]any
	if err := json.Unmarshal(storeData, &store); err != nil {
		return storePath, 0, err
	}
	if store == nil {
		store = map[string]any{}
	}
	storeEntries := nestedObjectMap(store["entries"])
	store["entries"] = storeEntries
	var phaseStore map[string]any
	if len(phaseData) > 0 {
		if err := json.Unmarshal(phaseData, &phaseStore); err != nil {
			return storePath, 0, err
		}
		if phaseStore == nil {
			phaseStore = map[string]any{}
		}
	}
	phaseEntries := nestedObjectMap(phaseStore["entries"])
	removed := 0
	for key, entry := range storeEntries {
		if intFromAny(entry["groundedCount"], 0) > 0 && intFromAny(entry["recallCount"], 0) == 0 && intFromAny(entry["dailyCount"], 0) == 0 {
			delete(storeEntries, key)
			removed++
		}
	}
	if removed == 0 {
		return storePath, 0, nil
	}
	if len(phaseData) > 0 {
		phaseStore["entries"] = phaseEntries
		for key := range phaseEntries {
			if _, ok := storeEntries[key]; !ok {
				delete(phaseEntries, key)
			}
		}
	}
	nowIso := time.Now().UTC().Format(time.RFC3339)
	store["updatedAt"] = nowIso
	updatedStore, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return storePath, 0, err
	}
	updatedStore = append(updatedStore, '\n')
	if err := os.MkdirAll(dreamsDir, 0o755); err != nil {
		return storePath, 0, err
	}
	if err := os.WriteFile(storePath, updatedStore, 0o600); err != nil {
		return storePath, 0, err
	}
	if len(phaseData) > 0 {
		phaseStore["updatedAt"] = nowIso
		updatedPhase, err := json.MarshalIndent(phaseStore, "", "  ")
		if err != nil {
			return storePath, 0, err
		}
		updatedPhase = append(updatedPhase, '\n')
		if err := os.WriteFile(phasePath, updatedPhase, 0o600); err != nil {
			return storePath, 0, err
		}
	}
	return storePath, removed, nil
}

func nestedObjectMap(value any) map[string]map[string]any {
	result := map[string]map[string]any{}
	raw, ok := value.(map[string]any)
	if !ok {
		return result
	}
	for key, entry := range raw {
		result[key] = objectMap(entry)
	}
	return result
}

func resolveOpenClawDreamingConfig(content map[string]any) OpenClawDreamingConfigStatus {
	pluginID := resolveDreamingPluginID(content)
	plugins := objectMap(content["plugins"])
	entries := objectMap(plugins["entries"])
	entry := objectMap(entries[pluginID])
	pluginConfig := objectMap(entry["config"])
	dreaming := objectMap(pluginConfig["dreaming"])
	storage := objectMap(dreaming["storage"])
	phases := objectMap(dreaming["phases"])
	light := objectMap(phases["light"])
	rem := objectMap(phases["rem"])
	deep := objectMap(phases["deep"])

	status := OpenClawDreamingConfigStatus{
		PluginID:        pluginID,
		Enabled:         boolFromAny(dreaming["enabled"], false),
		Frequency:       stringDefault(dreaming["frequency"], defaultDreamingFrequency),
		Timezone:        stringDefault(dreaming["timezone"], defaultDreamingTimezone(content)),
		Model:           stringDefault(dreaming["model"], ""),
		StorageMode:     stringDefault(storage["mode"], "separate"),
		SeparateReports: boolFromAny(storage["separateReports"], false),
	}
	status.Phases.Light = OpenClawDreamingPhaseConfig{
		Enabled:      status.Enabled && boolFromAny(light["enabled"], true),
		Limit:        intFromAny(light["limit"], 100),
		LookbackDays: intFromAny(light["lookbackDays"], 2),
	}
	status.Phases.REM = OpenClawDreamingPhaseConfig{
		Enabled:            status.Enabled && boolFromAny(rem["enabled"], true),
		Limit:              intFromAny(rem["limit"], 10),
		LookbackDays:       intFromAny(rem["lookbackDays"], 7),
		MinPatternStrength: floatFromAny(rem["minPatternStrength"], 0.75),
	}
	status.Phases.Deep = OpenClawDreamingPhaseConfig{
		Enabled:             status.Enabled && boolFromAny(deep["enabled"], true),
		Limit:               intFromAny(deep["limit"], 10),
		MinScore:            floatFromAny(deep["minScore"], 0.8),
		MinRecallCount:      intFromAny(deep["minRecallCount"], 3),
		MinUniqueQueries:    intFromAny(deep["minUniqueQueries"], 3),
		RecencyHalfLifeDays: intFromAny(deep["recencyHalfLifeDays"], 14),
		MaxAgeDays:          intFromAny(deep["maxAgeDays"], 30),
	}
	return status
}

func resolveDreamingPluginID(content map[string]any) string {
	plugins := objectMap(content["plugins"])
	slots := objectMap(plugins["slots"])
	if slot := strings.TrimSpace(stringFromMap(slots, "memory")); slot != "" && !strings.EqualFold(slot, "none") {
		return slot
	}
	return defaultDreamingPluginID
}

func defaultDreamingTimezone(content map[string]any) string {
	agents := objectMap(content["agents"])
	defaults := objectMap(agents["defaults"])
	return stringFromMap(defaults, "userTimezone")
}

func dreamingDiaryInfo(workspace string) OpenClawDreamDiaryInfo {
	info, _, _ := readDreamDiaryFile(workspace)
	return info
}

func readDreamDiaryFile(workspace string) (OpenClawDreamDiaryInfo, string, error) {
	for _, name := range []string{"DREAMS.md", "dreams.md"} {
		filePath := filepath.Join(workspace, name)
		stat, err := os.Lstat(filePath)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return OpenClawDreamDiaryInfo{Path: filePath, RelativePath: name}, "", huma.Error500InternalServerError("stat dream diary failed", err)
		}
		if stat.IsDir() || stat.Mode()&os.ModeSymlink != 0 {
			continue
		}
		content, err := os.ReadFile(filePath)
		if err != nil {
			return OpenClawDreamDiaryInfo{Path: filePath, RelativePath: name}, "", huma.Error500InternalServerError("read dream diary failed", err)
		}
		return OpenClawDreamDiaryInfo{
			Path:         filePath,
			RelativePath: name,
			Exists:       true,
			Size:         stat.Size(),
			UpdatedAt:    stat.ModTime().UTC().Format(time.RFC3339),
		}, string(content), nil
	}
	defaultPath := filepath.Join(workspace, "DREAMS.md")
	return OpenClawDreamDiaryInfo{Path: defaultPath, RelativePath: "DREAMS.md"}, "", nil
}

func dreamingStoreInfo(workspace string) OpenClawDreamStoreInfo {
	dreamsDir := filepath.Join(workspace, "memory", ".dreams")
	recallPath := filepath.Join(dreamsDir, "short-term-recall.json")
	phasePath := filepath.Join(dreamsDir, "phase-signals.json")
	sessionCorpusDir := filepath.Join(dreamsDir, "session-corpus")
	return OpenClawDreamStoreInfo{
		Dir:                   dreamsDir,
		Exists:                pathExists(dreamsDir),
		ShortTermRecallPath:   recallPath,
		ShortTermRecallExists: pathExists(recallPath),
		PhaseSignalsPath:      phasePath,
		PhaseSignalsExists:    pathExists(phasePath),
		SessionCorpusDir:      sessionCorpusDir,
		SessionCorpusExists:   pathExists(sessionCorpusDir),
	}
}

func summarizeDreamingWorkspace(workspace string) OpenClawDreamingSummary {
	summary := OpenClawDreamingSummary{}
	recallPath := filepath.Join(workspace, "memory", ".dreams", "short-term-recall.json")
	phasePath := filepath.Join(workspace, "memory", ".dreams", "phase-signals.json")
	var recallStore struct {
		Entries map[string]map[string]any `json:"entries"`
	}
	if data, err := os.ReadFile(recallPath); err == nil {
		if err := json.Unmarshal(data, &recallStore); err == nil {
			for _, entry := range recallStore.Entries {
				signalCount := intFromAny(entry["recallCount"], 0) + intFromAny(entry["dailyCount"], 0) + intFromAny(entry["groundedCount"], 0)
				if signalCount > 0 {
					summary.ShortTermCount++
				}
				summary.RecallSignalCount += intFromAny(entry["recallCount"], 0)
				summary.DailySignalCount += intFromAny(entry["dailyCount"], 0)
				summary.GroundedSignalCount += intFromAny(entry["groundedCount"], 0)
				summary.TotalSignalCount += signalCount
				if strings.TrimSpace(fmt.Sprint(entry["promotedAt"])) != "" && entry["promotedAt"] != nil {
					summary.PromotedCount++
				}
			}
		}
	}
	var phaseStore struct {
		Entries map[string]map[string]any `json:"entries"`
	}
	if data, err := os.ReadFile(phasePath); err == nil {
		if err := json.Unmarshal(data, &phaseStore); err == nil {
			for _, entry := range phaseStore.Entries {
				lightHits := intFromAny(entry["lightHits"], 0)
				remHits := intFromAny(entry["remHits"], 0)
				if lightHits > 0 || remHits > 0 {
					summary.PhaseSignalCount++
				}
				summary.LightPhaseHitCount += lightHits
				summary.REMPhaseHitCount += remHits
			}
		}
	}
	return summary
}

func listDreamingReports(workspace string) []OpenClawDreamReport {
	reports := make([]OpenClawDreamReport, 0)
	for _, phase := range []string{"light", "rem", "deep"} {
		pattern := filepath.Join(workspace, "memory", "dreaming", phase, "*.md")
		matches, _ := filepath.Glob(pattern)
		sort.Slice(matches, func(i, j int) bool {
			return filepath.Base(matches[i]) > filepath.Base(matches[j])
		})
		if len(matches) > 3 {
			matches = matches[:3]
		}
		for _, filePath := range matches {
			stat, err := os.Stat(filePath)
			if err != nil || stat.IsDir() {
				continue
			}
			relative, _ := filepath.Rel(workspace, filePath)
			reports = append(reports, OpenClawDreamReport{
				Phase:        phase,
				RelativePath: filepath.ToSlash(relative),
				Path:         filePath,
				Size:         stat.Size(),
				UpdatedAt:    stat.ModTime().UTC().Format(time.RFC3339),
			})
		}
	}
	return reports
}

func stringDefault(value any, fallback string) string {
	if value == nil {
		return fallback
	}
	trimmed := strings.TrimSpace(fmt.Sprint(value))
	if trimmed == "" {
		return fallback
	}
	return trimmed
}

func boolFromAny(value any, fallback bool) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		if strings.EqualFold(strings.TrimSpace(typed), "true") {
			return true
		}
		if strings.EqualFold(strings.TrimSpace(typed), "false") {
			return false
		}
	}
	return fallback
}

func intFromAny(value any, fallback int) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		parsed, err := typed.Int64()
		if err == nil {
			return int(parsed)
		}
	case string:
		var parsed int
		if _, err := fmt.Sscan(strings.TrimSpace(typed), &parsed); err == nil {
			return parsed
		}
	}
	return fallback
}

func floatFromAny(value any, fallback float64) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		parsed, err := typed.Float64()
		if err == nil {
			return parsed
		}
	case string:
		var parsed float64
		if _, err := fmt.Sscan(strings.TrimSpace(typed), &parsed); err == nil {
			return parsed
		}
	}
	return fallback
}
