package hermes

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

var hermesProfileNamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

var hermesReservedProfileNames = map[string]bool{
	"hermes": true,
	"test":   true,
	"tmp":    true,
	"root":   true,
	"sudo":   true,
}

var hermesProfileSubcommands = map[string]bool{
	"chat": true, "model": true, "gateway": true, "setup": true, "whatsapp": true,
	"login": true, "logout": true, "status": true, "cron": true, "doctor": true,
	"dump": true, "config": true, "pairing": true, "skills": true, "tools": true,
	"mcp": true, "sessions": true, "insights": true, "version": true, "update": true,
	"uninstall": true, "profile": true, "plugins": true, "honcho": true, "acp": true,
}

type HermesAgentsOutput struct {
	Body HermesAgentsResponse
}

type HermesAgentOutput struct {
	Body HermesAgentDetailResponse
}

type HermesAgentMutationOutput struct {
	Body HermesAgentMutationResponse
}

type HermesAgentPathInput struct {
	Name string `path:"name" doc:"Hermes profile name." example:"default"`
}

type HermesAgentFileInput struct {
	Name string `path:"name" doc:"Hermes profile name." example:"default"`
	File string `path:"file" doc:"Managed profile file: config, env, soul, memory, or user." example:"memory"`
}

type HermesAgentCreateInput struct {
	Body HermesAgentCreateRequest
}

type HermesAgentRenameInput struct {
	Name string `path:"name" doc:"Hermes profile name." example:"coder"`
	Body HermesAgentRenameRequest
}

type HermesAgentFileUpdateInput struct {
	Name string `path:"name" doc:"Hermes profile name." example:"default"`
	File string `path:"file" doc:"Managed profile file: config, env, soul, memory, or user." example:"memory"`
	Body HermesTextFileRequest
}

type HermesAgentsResponse struct {
	Status    string              `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string              `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Root      string              `json:"root" example:"/Users/one/.hermes" doc:"Hermes default root used for profile management."`
	Profiles  []HermesAgentInfo   `json:"profiles" doc:"Hermes profiles. Dashboard presents them as Hermes agents."`
	Summary   HermesAgentsSummary `json:"summary" doc:"Aggregate profile counts."`
}

type HermesAgentDetailResponse struct {
	Status    string              `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string              `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Profile   HermesAgentInfo     `json:"profile" doc:"Hermes profile summary."`
	Files     []HermesProfileFile `json:"files" doc:"Managed profile files."`
	Memory    []HermesProfileFile `json:"memory" doc:"Managed Hermes memory files."`
}

type HermesAgentMutationResponse struct {
	Status    string          `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string          `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Message   string          `json:"message" doc:"Human-readable action result."`
	Name      string          `json:"name" example:"coder" doc:"Affected profile name."`
	Profile   HermesAgentInfo `json:"profile,omitempty" doc:"Updated profile summary when available."`
	Stdout    string          `json:"stdout,omitempty" doc:"Hermes CLI stdout."`
	Stderr    string          `json:"stderr,omitempty" doc:"Hermes CLI stderr."`
}

type HermesAgentCreateRequest struct {
	Name      string `json:"name" doc:"Profile name." example:"coder"`
	CloneMode string `json:"cloneMode,omitempty" doc:"fresh, clone, or clone-all." example:"clone"`
	CloneFrom string `json:"cloneFrom,omitempty" doc:"Source profile for clone modes." example:"default"`
	NoSkills  bool   `json:"noSkills,omitempty" doc:"Create an empty profile without bundled skill seeding." example:"false"`
}

type HermesAgentRenameRequest struct {
	NewName string `json:"newName" doc:"New profile name." example:"research"`
}

type HermesAgentsSummary struct {
	Total        int `json:"total" example:"2" doc:"Total profiles."`
	Active       int `json:"active" example:"1" doc:"Sticky active profile count."`
	Default      int `json:"default" example:"1" doc:"Built-in default profiles."`
	Running      int `json:"running" example:"1" doc:"Profiles with running Gateway."`
	WithEnv      int `json:"withEnv" example:"2" doc:"Profiles with .env file."`
	WithSoul     int `json:"withSoul" example:"2" doc:"Profiles with SOUL.md file."`
	SkillCount   int `json:"skillCount" example:"87" doc:"Total skill count across profiles."`
	SessionCount int `json:"sessionCount" example:"12" doc:"Total session file count across profiles."`
}

type HermesAgentInfo struct {
	Name               string                 `json:"name" example:"default" doc:"Profile name."`
	DisplayName        string                 `json:"displayName" example:"Default" doc:"Display label."`
	Path               string                 `json:"path" doc:"Profile directory path."`
	IsDefault          bool                   `json:"isDefault" example:"true" doc:"Whether this is the built-in default profile."`
	IsActive           bool                   `json:"isActive" example:"true" doc:"Whether this profile is the sticky active profile."`
	Exists             bool                   `json:"exists" example:"true" doc:"Whether profile directory exists."`
	GatewayRunning     bool                   `json:"gatewayRunning" example:"false" doc:"Whether the profile Gateway process is running."`
	Gateway            HermesGatewayInfo      `json:"gateway" doc:"Gateway summary for this profile."`
	Config             HermesProfileFile      `json:"config" doc:"config.yaml file summary."`
	Env                HermesProfileFile      `json:"env" doc:".env file summary."`
	Soul               HermesProfileFile      `json:"soul" doc:"SOUL.md file summary."`
	Memory             HermesProfileFile      `json:"memory" doc:"memories/MEMORY.md file summary."`
	User               HermesProfileFile      `json:"user" doc:"memories/USER.md file summary."`
	SkillsDir          string                 `json:"skillsDir" doc:"Skills directory."`
	SessionsDir        string                 `json:"sessionsDir" doc:"Sessions directory."`
	LogsDir            string                 `json:"logsDir" doc:"Logs directory."`
	WorkspaceDir       string                 `json:"workspaceDir" doc:"Workspace directory."`
	HomeDir            string                 `json:"homeDir" doc:"Per-profile HOME directory."`
	MemoryDir          string                 `json:"memoryDir" doc:"Memory directory."`
	CronDir            string                 `json:"cronDir" doc:"Cron directory."`
	SkillCount         int                    `json:"skillCount" example:"87" doc:"Installed skill count."`
	SessionCount       int                    `json:"sessionCount" example:"4" doc:"Session file count."`
	LogCount           int                    `json:"logCount" example:"8" doc:"Log file count."`
	MemoryFileCount    int                    `json:"memoryFileCount" example:"2" doc:"Markdown memory file count."`
	CronJobCount       int                    `json:"cronJobCount" example:"3" doc:"Cron job file count."`
	Model              string                 `json:"model,omitempty" example:"gpt-5.5" doc:"Default model from config.yaml."`
	Provider           string                 `json:"provider,omitempty" example:"openai" doc:"Provider from config.yaml."`
	DisplayLanguage    string                 `json:"displayLanguage,omitempty" doc:"Display language from config.yaml."`
	DisplayPersonality string                 `json:"displayPersonality,omitempty" doc:"Display personality from config.yaml."`
	Toolsets           []string               `json:"toolsets,omitempty" doc:"Configured toolsets."`
	APIServerEnabled   bool                   `json:"apiServerEnabled" example:"true" doc:"Whether API server is enabled in config."`
	SetupCommand       string                 `json:"setupCommand" example:"hermes setup" doc:"Command to enter setup for this profile."`
	ChatCommand        string                 `json:"chatCommand" example:"hermes -p coder chat" doc:"Command to start chat for this profile."`
	Distribution       HermesDistributionInfo `json:"distribution" doc:"Profile distribution metadata, if present."`
	NoBundledSkills    bool                   `json:"noBundledSkills" example:"false" doc:"Whether bundled skill seeding is disabled."`
}

type HermesProfileFile struct {
	Key    string `json:"key" example:"config" doc:"Managed file key."`
	Label  string `json:"label" example:"config.yaml" doc:"Display label."`
	Path   string `json:"path" doc:"Absolute path."`
	Exists bool   `json:"exists" example:"true" doc:"Whether file exists."`
	Bytes  int64  `json:"bytes,omitempty" example:"4096" doc:"File size in bytes."`
}

type HermesDistributionInfo struct {
	Name    string `json:"name,omitempty" doc:"Distribution name."`
	Version string `json:"version,omitempty" doc:"Distribution version."`
	Source  string `json:"source,omitempty" doc:"Distribution source."`
}

func ListHermesAgents(ctx context.Context, input *struct{}) (*HermesAgentsOutput, error) {
	profiles, summary := scanHermesProfiles(ctx)
	return &HermesAgentsOutput{Body: HermesAgentsResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Root:      hermesDefaultRootDir(),
		Profiles:  profiles,
		Summary:   summary,
	}}, nil
}

func GetHermesAgent(ctx context.Context, input *HermesAgentPathInput) (*HermesAgentOutput, error) {
	profile, err := getHermesProfile(ctx, input.Name)
	if err != nil {
		return nil, err
	}
	return &HermesAgentOutput{Body: HermesAgentDetailResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Profile:   profile,
		Files:     []HermesProfileFile{profile.Config, profile.Env, profile.Soul},
		Memory:    []HermesProfileFile{profile.Memory, profile.Soul, profile.User},
	}}, nil
}

func CreateHermesAgent(ctx context.Context, input *HermesAgentCreateInput) (*HermesAgentMutationOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("profile payload is required", nil)
	}
	name, err := normalizeHermesProfileName(input.Body.Name)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error(), err)
	}
	if name == "default" {
		return nil, huma.Error400BadRequest("default profile already exists", nil)
	}
	if err := validateHermesProfileName(name, false); err != nil {
		return nil, huma.Error400BadRequest(err.Error(), err)
	}
	if input.Body.NoSkills && (input.Body.CloneMode == "clone" || input.Body.CloneMode == "clone-all") {
		return nil, huma.Error400BadRequest("noSkills cannot be combined with clone modes", nil)
	}

	args := []string{"profile", "create", name}
	switch strings.TrimSpace(input.Body.CloneMode) {
	case "", "fresh":
	case "clone":
		args = append(args, "--clone")
	case "clone-all":
		args = append(args, "--clone-all")
	default:
		return nil, huma.Error400BadRequest("cloneMode must be fresh, clone, or clone-all", nil)
	}
	if input.Body.CloneFrom != "" && input.Body.CloneMode != "" && input.Body.CloneMode != "fresh" {
		source, err := normalizeHermesProfileName(input.Body.CloneFrom)
		if err != nil {
			return nil, huma.Error400BadRequest(err.Error(), err)
		}
		if err := validateHermesProfileName(source, true); err != nil {
			return nil, huma.Error400BadRequest(err.Error(), err)
		}
		args = append(args, "--clone-from", source)
	}
	if input.Body.NoSkills {
		args = append(args, "--no-skills")
	}

	stdout, stderr, runErr := hermesCommand(ctx, 3*time.Minute, args...)
	if runErr != nil {
		return nil, huma.Error500InternalServerError("create hermes profile failed: "+strings.TrimSpace(stderr+stdout), runErr)
	}
	invalidateHermesEnvironmentCache()
	invalidateHermesSkillsCache()
	profile, _ := getHermesProfile(ctx, name)
	return &HermesAgentMutationOutput{Body: HermesAgentMutationResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Message:   "Hermes profile created.",
		Name:      name,
		Profile:   profile,
		Stdout:    stdout,
		Stderr:    stderr,
	}}, nil
}

func RenameHermesAgent(ctx context.Context, input *HermesAgentRenameInput) (*HermesAgentMutationOutput, error) {
	oldName, err := normalizeHermesProfileName(input.Name)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error(), err)
	}
	newName, err := normalizeHermesProfileName(input.Body.NewName)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error(), err)
	}
	if err := validateHermesProfileName(oldName, true); err != nil {
		return nil, huma.Error400BadRequest(err.Error(), err)
	}
	if err := validateHermesProfileName(newName, false); err != nil {
		return nil, huma.Error400BadRequest(err.Error(), err)
	}

	stdout, stderr, runErr := hermesCommand(ctx, time.Minute, "profile", "rename", oldName, newName)
	if runErr != nil {
		return nil, huma.Error500InternalServerError("rename hermes profile failed: "+strings.TrimSpace(stderr+stdout), runErr)
	}
	invalidateHermesEnvironmentCache()
	profile, _ := getHermesProfile(ctx, newName)
	return &HermesAgentMutationOutput{Body: HermesAgentMutationResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Message:   "Hermes profile renamed.",
		Name:      newName,
		Profile:   profile,
		Stdout:    stdout,
		Stderr:    stderr,
	}}, nil
}

func DeleteHermesAgent(ctx context.Context, input *HermesAgentPathInput) (*HermesAgentMutationOutput, error) {
	name, err := normalizeHermesProfileName(input.Name)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error(), err)
	}
	if name == "default" {
		return nil, huma.Error400BadRequest("default profile cannot be deleted", nil)
	}
	if err := validateHermesProfileName(name, false); err != nil {
		return nil, huma.Error400BadRequest(err.Error(), err)
	}
	stdout, stderr, runErr := hermesCommand(ctx, 2*time.Minute, "profile", "delete", name, "--yes")
	if runErr != nil {
		return nil, huma.Error500InternalServerError("delete hermes profile failed: "+strings.TrimSpace(stderr+stdout), runErr)
	}
	invalidateHermesEnvironmentCache()
	invalidateHermesSkillsCache()
	return &HermesAgentMutationOutput{Body: HermesAgentMutationResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Message:   "Hermes profile deleted.",
		Name:      name,
		Stdout:    stdout,
		Stderr:    stderr,
	}}, nil
}

func UseHermesAgent(ctx context.Context, input *HermesAgentPathInput) (*HermesAgentMutationOutput, error) {
	name, err := normalizeHermesProfileName(input.Name)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error(), err)
	}
	if err := validateHermesProfileName(name, true); err != nil {
		return nil, huma.Error400BadRequest(err.Error(), err)
	}
	stdout, stderr, runErr := hermesCommand(ctx, time.Minute, "profile", "use", name)
	if runErr != nil {
		return nil, huma.Error500InternalServerError("set active hermes profile failed: "+strings.TrimSpace(stderr+stdout), runErr)
	}
	invalidateHermesEnvironmentCache()
	profile, _ := getHermesProfile(ctx, name)
	return &HermesAgentMutationOutput{Body: HermesAgentMutationResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Message:   "Hermes active profile updated.",
		Name:      name,
		Profile:   profile,
		Stdout:    stdout,
		Stderr:    stderr,
	}}, nil
}

func GetHermesAgentFile(ctx context.Context, input *HermesAgentFileInput) (*HermesTextFileOutput, error) {
	path, label, err := hermesProfileManagedFilePath(input.Name, input.File)
	if err != nil {
		return nil, err
	}
	return readHermesTextFile(path, label)
}

func UpdateHermesAgentFile(ctx context.Context, input *HermesAgentFileUpdateInput) (*HermesTextFileOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("file content is required", nil)
	}
	path, _, err := hermesProfileManagedFilePath(input.Name, input.File)
	if err != nil {
		return nil, err
	}
	output, err := writeHermesTextFile(path, input.Body.Content, "write hermes profile file failed")
	if err == nil {
		invalidateHermesSkillsCache()
	}
	return output, err
}

func scanHermesProfiles(ctx context.Context) ([]HermesAgentInfo, HermesAgentsSummary) {
	root := hermesDefaultRootDir()
	active := readHermesActiveProfileName(root)
	profiles := make([]HermesAgentInfo, 0, 4)

	defaultPath := root
	if pathExists(defaultPath) {
		profiles = append(profiles, buildHermesProfileInfo(ctx, "default", defaultPath, true, active == "default"))
	}

	profilesRoot := filepath.Join(root, "profiles")
	entries, err := os.ReadDir(profilesRoot)
	if err == nil {
		for _, entry := range entries {
			if !entry.IsDir() || !hermesProfileNamePattern.MatchString(entry.Name()) {
				continue
			}
			name := entry.Name()
			profiles = append(profiles, buildHermesProfileInfo(ctx, name, filepath.Join(profilesRoot, name), false, active == name))
		}
	}

	sort.SliceStable(profiles, func(i, j int) bool {
		if profiles[i].IsDefault != profiles[j].IsDefault {
			return profiles[i].IsDefault
		}
		return profiles[i].Name < profiles[j].Name
	})

	summary := HermesAgentsSummary{Total: len(profiles)}
	for _, profile := range profiles {
		if profile.IsActive {
			summary.Active++
		}
		if profile.IsDefault {
			summary.Default++
		}
		if profile.GatewayRunning {
			summary.Running++
		}
		if profile.Env.Exists {
			summary.WithEnv++
		}
		if profile.Soul.Exists {
			summary.WithSoul++
		}
		summary.SkillCount += profile.SkillCount
		summary.SessionCount += profile.SessionCount
	}
	return profiles, summary
}

func getHermesProfile(ctx context.Context, name string) (HermesAgentInfo, error) {
	canon, err := normalizeHermesProfileName(name)
	if err != nil {
		return HermesAgentInfo{}, huma.Error400BadRequest(err.Error(), err)
	}
	if err := validateHermesProfileName(canon, true); err != nil {
		return HermesAgentInfo{}, huma.Error400BadRequest(err.Error(), err)
	}
	path := hermesProfileDir(canon)
	if !pathExists(path) {
		return HermesAgentInfo{}, huma.Error404NotFound("Hermes profile not found", nil)
	}
	return buildHermesProfileInfo(ctx, canon, path, canon == "default", readHermesActiveProfileName(hermesDefaultRootDir()) == canon), nil
}

func buildHermesProfileInfo(ctx context.Context, name string, path string, isDefault bool, isActive bool) HermesAgentInfo {
	config := hermesProfileFile(path, "config", "config.yaml")
	env := hermesProfileFile(path, "env", ".env")
	soul := hermesProfileFile(path, "soul", "SOUL.md")
	memory := hermesProfileFile(path, "memory", filepath.Join("memories", "MEMORY.md"))
	user := hermesProfileFile(path, "user", filepath.Join("memories", "USER.md"))
	configSummary := configSummary{Scalars: map[string]string{}}
	if content, err := os.ReadFile(config.Path); err == nil {
		configSummary = parseHermesConfigSummary(string(content))
	}
	gatewayHome := HermesHomeInfo{
		Path:             path,
		GatewayPIDPath:   filepath.Join(path, "gateway.pid"),
		GatewayStatePath: filepath.Join(path, "gateway_state.json"),
	}
	gateway, _ := detectHermesGateway(ctx, gatewayHome)
	display := strings.ToUpper(name[:1]) + name[1:]
	if name == "default" {
		display = "Default"
	}

	profile := HermesAgentInfo{
		Name:               name,
		DisplayName:        display,
		Path:               path,
		IsDefault:          isDefault,
		IsActive:           isActive,
		Exists:             pathExists(path),
		GatewayRunning:     gateway.Running,
		Gateway:            gateway,
		Config:             config,
		Env:                env,
		Soul:               soul,
		Memory:             memory,
		User:               user,
		SkillsDir:          filepath.Join(path, "skills"),
		SessionsDir:        filepath.Join(path, "sessions"),
		LogsDir:            filepath.Join(path, "logs"),
		WorkspaceDir:       filepath.Join(path, "workspace"),
		HomeDir:            filepath.Join(path, "home"),
		MemoryDir:          filepath.Join(path, "memories"),
		CronDir:            filepath.Join(path, "cron"),
		Model:              configSummary.Scalars["model.default"],
		Provider:           configSummary.Scalars["model.provider"],
		DisplayLanguage:    configSummary.Scalars["display.language"],
		DisplayPersonality: configSummary.Scalars["display.personality"],
		Toolsets:           configSummary.Toolsets,
		APIServerEnabled:   configSummary.APIServerEnabled,
		SetupCommand:       hermesProfileSetupCommand(name),
		ChatCommand:        hermesProfileChatCommand(name),
		Distribution:       readHermesDistributionInfo(filepath.Join(path, "distribution.yaml")),
		NoBundledSkills:    pathExists(filepath.Join(path, ".no-bundled-skills")),
	}
	profile.SkillCount = countHermesSkillFiles(profile.SkillsDir)
	profile.SessionCount = countFilesWithExt(profile.SessionsDir, ".jsonl", ".json")
	profile.LogCount = countFilesWithExt(profile.LogsDir, ".log", ".jsonl", ".txt")
	profile.MemoryFileCount = countHermesProfileMemoryFiles(profile)
	profile.CronJobCount = countFilesWithExt(profile.CronDir, ".toml", ".json", ".yaml", ".yml")
	return profile
}

func hermesProfileManagedFilePath(name string, file string) (string, string, error) {
	canon, err := normalizeHermesProfileName(name)
	if err != nil {
		return "", "", huma.Error400BadRequest(err.Error(), err)
	}
	if err := validateHermesProfileName(canon, true); err != nil {
		return "", "", huma.Error400BadRequest(err.Error(), err)
	}
	dir := hermesProfileDir(canon)
	if !pathExists(dir) {
		return "", "", huma.Error404NotFound("Hermes profile not found", nil)
	}
	switch strings.TrimSpace(strings.ToLower(file)) {
	case "config", "config.yaml":
		return filepath.Join(dir, "config.yaml"), "config.yaml", nil
	case "env", ".env":
		return filepath.Join(dir, ".env"), ".env", nil
	case "soul", "soul.md":
		return filepath.Join(dir, "SOUL.md"), "SOUL.md", nil
	case "memory", "memory.md", "memories/memory.md":
		return filepath.Join(dir, "memories", "MEMORY.md"), "MEMORY.md", nil
	case "user", "user.md", "memories/user.md":
		return filepath.Join(dir, "memories", "USER.md"), "USER.md", nil
	default:
		return "", "", huma.Error400BadRequest("file must be config, env, soul, memory, or user", nil)
	}
}

func hermesProfileFile(root string, key string, label string) HermesProfileFile {
	path := filepath.Join(root, label)
	file := HermesProfileFile{Key: key, Label: label, Path: path, Exists: pathExists(path)}
	if stat, err := os.Stat(path); err == nil {
		file.Bytes = stat.Size()
	}
	return file
}

func hermesDefaultRootDir() string {
	nativeHome := filepath.Join(userHomeDirFallback(), ".hermes")
	envHome := strings.TrimSpace(os.Getenv("HERMES_HOME"))
	if envHome == "" {
		return nativeHome
	}
	envHome = filepath.Clean(envHome)
	if rel, err := filepath.Rel(nativeHome, envHome); err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return nativeHome
	}
	if filepath.Base(filepath.Dir(envHome)) == "profiles" {
		return filepath.Dir(filepath.Dir(envHome))
	}
	return envHome
}

func hermesProfileDir(name string) string {
	if name == "default" {
		return hermesDefaultRootDir()
	}
	return filepath.Join(hermesDefaultRootDir(), "profiles", name)
}

func readHermesActiveProfileName(root string) string {
	content, err := os.ReadFile(filepath.Join(root, "active_profile"))
	if err != nil {
		return "default"
	}
	name := strings.TrimSpace(string(content))
	if name == "" {
		return "default"
	}
	return name
}

func hermesProfileSetupCommand(name string) string {
	if name == "default" {
		return "hermes setup"
	}
	return name + " setup"
}

func hermesProfileChatCommand(name string) string {
	if name == "default" {
		return "hermes chat"
	}
	return "hermes -p " + name + " chat"
}

func normalizeHermesProfileName(name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", huma.Error400BadRequest("profile name cannot be empty", nil)
	}
	if strings.EqualFold(trimmed, "default") {
		return "default", nil
	}
	return strings.ToLower(trimmed), nil
}

func validateHermesProfileName(name string, allowDefault bool) error {
	if name == "default" {
		if allowDefault {
			return nil
		}
		return huma.Error400BadRequest("default profile is reserved", nil)
	}
	if !hermesProfileNamePattern.MatchString(name) {
		return huma.Error400BadRequest("profile name must match [a-z0-9][a-z0-9_-]{0,63}", nil)
	}
	if hermesReservedProfileNames[name] {
		return huma.Error400BadRequest("profile name is reserved", nil)
	}
	if hermesProfileSubcommands[name] {
		return huma.Error400BadRequest("profile name conflicts with a hermes subcommand", nil)
	}
	return nil
}

func countHermesSkillFiles(root string) int {
	count := 0
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			name := entry.Name()
			if name == ".git" || name == ".hub" || name == "node_modules" || name == "__pycache__" {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Name() == "SKILL.md" {
			count++
		}
		return nil
	})
	return count
}

func countFilesWithExt(root string, exts ...string) int {
	allowed := map[string]bool{}
	for _, ext := range exts {
		allowed[strings.ToLower(ext)] = true
	}
	count := 0
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			name := entry.Name()
			if name == ".git" || name == "node_modules" || name == "__pycache__" {
				return filepath.SkipDir
			}
			return nil
		}
		if allowed[strings.ToLower(filepath.Ext(entry.Name()))] {
			count++
		}
		return nil
	})
	return count
}

func countHermesProfileMemoryFiles(profile HermesAgentInfo) int {
	count := 0
	for _, file := range []HermesProfileFile{profile.Memory, profile.Soul, profile.User} {
		if file.Exists {
			count++
		}
	}
	return count
}

func readHermesDistributionInfo(path string) HermesDistributionInfo {
	content, err := os.ReadFile(path)
	if err != nil {
		return HermesDistributionInfo{}
	}
	summary := parseHermesConfigSummary(string(content))
	return HermesDistributionInfo{
		Name:    summary.Scalars["name"],
		Version: summary.Scalars["version"],
		Source:  summary.Scalars["source"],
	}
}

func userHomeDirFallback() string {
	home, err := os.UserHomeDir()
	if err == nil && home != "" {
		return home
	}
	return "."
}
