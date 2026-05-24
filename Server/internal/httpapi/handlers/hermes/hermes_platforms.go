package hermes

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"gopkg.in/yaml.v3"
)

type HermesPlatformsOutput struct {
	Body HermesPlatformsResponse
}

type HermesPlatformsReadInput struct {
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	Refresh bool   `query:"refresh" doc:"Force refresh cached Hermes platform data." example:"false"`
}

type HermesPlatformPatchInput struct {
	Name    string `path:"name" doc:"Hermes platform name." example:"telegram"`
	Profile string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	Body    HermesPlatformUpdateRequest
}

type HermesPlatformsResponse struct {
	Status    string                 `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                 `json:"timestamp" example:"2026-05-16T01:30:00Z" doc:"UTC response timestamp."`
	Profile   HermesProfileSelection `json:"profile" doc:"Resolved Hermes profile used for this response."`
	Config    HermesPlatformFileInfo `json:"config" doc:"Hermes config.yaml path and existence."`
	Env       HermesPlatformFileInfo `json:"env" doc:"Hermes .env path and existence."`
	Summary   HermesPlatformsSummary `json:"summary" doc:"Platform summary."`
	Platforms []HermesPlatformInfo   `json:"platforms" doc:"Messaging platform inventory."`
}

type HermesPlatformFileInfo struct {
	Path   string `json:"path" example:"/Users/one/.hermes/config.yaml" doc:"File path."`
	Exists bool   `json:"exists" example:"true" doc:"Whether the file exists."`
}

type HermesPlatformsSummary struct {
	Total      int `json:"total" example:"23" doc:"Total known platforms."`
	Enabled    int `json:"enabled" example:"2" doc:"Enabled platforms."`
	Configured int `json:"configured" example:"2" doc:"Platforms with required credentials or usable local mode."`
	Connected  int `json:"connected" example:"1" doc:"Runtime-connected platforms from gateway_state.json."`
}

type HermesPlatformInfo struct {
	Name                       string                   `json:"name" example:"telegram" doc:"Platform key."`
	Label                      string                   `json:"label" example:"Telegram" doc:"Display label."`
	Category                   string                   `json:"category" example:"common" doc:"UI category."`
	Icon                       string                   `json:"icon" example:"simple-icons:telegram" doc:"Iconify icon name."`
	Enabled                    bool                     `json:"enabled" example:"true" doc:"Whether platforms.<name>.enabled or <name>.enabled is true."`
	Configured                 bool                     `json:"configured" example:"true" doc:"Whether required env/config credentials are present."`
	Connected                  bool                     `json:"connected" example:"true" doc:"Whether gateway_state marks the platform connected."`
	RuntimeState               string                   `json:"runtimeState,omitempty" example:"connected" doc:"Runtime state from gateway_state.json."`
	RuntimeError               string                   `json:"runtimeError,omitempty" doc:"Runtime error from gateway_state.json."`
	UpdatedAt                  string                   `json:"updatedAt,omitempty" doc:"Runtime state updated_at."`
	RequiredEnv                []HermesPlatformEnvKey   `json:"requiredEnv" doc:"Important env/config keys and presence only."`
	HomeChannel                string                   `json:"homeChannel,omitempty" doc:"Configured home channel summary."`
	HomeChannelKey             string                   `json:"homeChannelKey,omitempty" example:"TELEGRAM_HOME_CHANNEL" doc:"Environment key for default delivery target."`
	ReplyToMode                string                   `json:"replyToMode,omitempty" example:"first" doc:"reply_to_mode."`
	GatewayRestartNotification bool                     `json:"gatewayRestartNotification" example:"true" doc:"gateway_restart_notification."`
	RequireMention             *bool                    `json:"requireMention,omitempty" doc:"require_mention behavior when present."`
	FreeResponse               string                   `json:"freeResponse,omitempty" doc:"Free-response allowlist as comma-separated text."`
	Allowed                    string                   `json:"allowed,omitempty" doc:"Allowed channel/user list as comma-separated text."`
	UnauthorizedDMBehavior     string                   `json:"unauthorizedDmBehavior,omitempty" example:"pair" doc:"unauthorized_dm_behavior."`
	NoticeDelivery             string                   `json:"noticeDelivery,omitempty" example:"public" doc:"notice_delivery."`
	Plugin                     bool                     `json:"plugin" example:"false" doc:"Whether this is a bundled plugin platform."`
	ConfigKeys                 HermesPlatformConfigKeys `json:"configKeys" doc:"Config keys used by this platform."`
}

type HermesPlatformEnvKey struct {
	Key     string `json:"key" example:"TELEGRAM_BOT_TOKEN" doc:"Environment/config key."`
	Present bool   `json:"present" example:"true" doc:"Whether the key appears in .env or config.yaml."`
	Source  string `json:"source,omitempty" example:"env" doc:"Best-effort source: env or config."`
}

type HermesPlatformConfigKeys struct {
	FreeResponse string `json:"freeResponse,omitempty" example:"free_response_channels" doc:"Top-level config key for free-response list."`
	Allowed      string `json:"allowed,omitempty" example:"allowed_channels" doc:"Top-level config key for allowlist."`
}

type HermesPlatformUpdateRequest struct {
	Enabled                    *bool             `json:"enabled,omitempty" doc:"Enable or disable the platform."`
	RequireMention             *bool             `json:"requireMention,omitempty" doc:"Require mentions in shared channels."`
	FreeResponse               string            `json:"freeResponse,omitempty" doc:"Free-response allowlist as comma/newline separated text."`
	Allowed                    string            `json:"allowed,omitempty" doc:"Allowed list as comma/newline separated text."`
	ReplyToMode                string            `json:"replyToMode,omitempty" enum:"off,first,all" doc:"Reply threading mode."`
	GatewayRestartNotification *bool             `json:"gatewayRestartNotification,omitempty" doc:"Send gateway restart notifications."`
	UnauthorizedDMBehavior     string            `json:"unauthorizedDmBehavior,omitempty" enum:"pair,ignore" doc:"Unauthorized DM behavior."`
	NoticeDelivery             string            `json:"noticeDelivery,omitempty" enum:"public,private" doc:"Notice delivery mode."`
	Env                        map[string]string `json:"env,omitempty" doc:"Environment values to write into .env. Only keys declared by this platform are accepted."`
}

type hermesPlatformDefinition struct {
	Name               string
	Label              string
	Category           string
	Icon               string
	RequiredEnv        []string
	RequiredConfigKeys []string
	HomeChannelEnv     string
	FreeResponseKey    string
	AllowedKey         string
	Plugin             bool
	Configless         bool
}

var hermesPlatformDefinitions = []hermesPlatformDefinition{
	{Name: "api_server", Label: "API Server", Category: "core", Icon: "lucide:server", Configless: true},
	{Name: "local", Label: "Local", Category: "core", Icon: "lucide:terminal", Configless: true},
	{Name: "webhook", Label: "Webhook", Category: "core", Icon: "lucide:webhook", Configless: true},
	{Name: "telegram", Label: "Telegram", Category: "common", Icon: "simple-icons:telegram", RequiredEnv: []string{"TELEGRAM_BOT_TOKEN"}, RequiredConfigKeys: []string{"token"}, HomeChannelEnv: "TELEGRAM_HOME_CHANNEL", FreeResponseKey: "free_response_chats", AllowedKey: "allowed_chats"},
	{Name: "discord", Label: "Discord", Category: "common", Icon: "simple-icons:discord", RequiredEnv: []string{"DISCORD_BOT_TOKEN"}, RequiredConfigKeys: []string{"token"}, HomeChannelEnv: "DISCORD_HOME_CHANNEL", FreeResponseKey: "free_response_channels", AllowedKey: "allowed_channels"},
	{Name: "slack", Label: "Slack", Category: "common", Icon: "simple-icons:slack", RequiredEnv: []string{"SLACK_BOT_TOKEN"}, RequiredConfigKeys: []string{"token"}, FreeResponseKey: "free_response_channels", AllowedKey: "allowed_channels"},
	{Name: "whatsapp", Label: "WhatsApp", Category: "common", Icon: "simple-icons:whatsapp", RequiredEnv: []string{"WHATSAPP_ENABLED"}, HomeChannelEnv: "WHATSAPP_HOME_CHANNEL", FreeResponseKey: "free_response_chats", AllowedKey: "allow_from"},
	{Name: "feishu", Label: "Feishu", Category: "common", Icon: "icon-park-outline:lark", RequiredEnv: []string{"FEISHU_APP_ID", "FEISHU_APP_SECRET"}, RequiredConfigKeys: []string{"app_id", "app_secret"}, HomeChannelEnv: "FEISHU_HOME_CHANNEL", FreeResponseKey: "free_response_chats", AllowedKey: "allowed_chats"},
	{Name: "dingtalk", Label: "DingTalk", Category: "common", Icon: "ant-design:dingtalk-circle-filled", RequiredEnv: []string{"DINGTALK_CLIENT_ID", "DINGTALK_CLIENT_SECRET"}, RequiredConfigKeys: []string{"client_id", "client_secret"}, HomeChannelEnv: "DINGTALK_HOME_CHANNEL", FreeResponseKey: "free_response_chats", AllowedKey: "allowed_chats"},
	{Name: "wecom", Label: "WeCom", Category: "common", Icon: "ant-design:wechat-work-outlined", RequiredEnv: []string{"WECOM_BOT_ID", "WECOM_SECRET"}, RequiredConfigKeys: []string{"bot_id", "secret"}, HomeChannelEnv: "WECOM_HOME_CHANNEL", FreeResponseKey: "free_response_chats", AllowedKey: "allow_from"},
	{Name: "wecom_callback", Label: "WeCom Callback", Category: "common", Icon: "lucide:message-circle-code", RequiredEnv: []string{"WECOM_CALLBACK_CORP_ID", "WECOM_CALLBACK_CORP_SECRET"}, RequiredConfigKeys: []string{"corp_id", "corp_secret"}},
	{Name: "weixin", Label: "Weixin", Category: "common", Icon: "simple-icons:wechat", RequiredEnv: []string{"WEIXIN_TOKEN", "WEIXIN_ACCOUNT_ID"}, RequiredConfigKeys: []string{"token", "account_id"}},
	{Name: "qqbot", Label: "QQBot", Category: "common", Icon: "simple-icons:tencentqq", RequiredEnv: []string{"QQ_APP_ID", "QQ_CLIENT_SECRET"}, RequiredConfigKeys: []string{"app_id", "client_secret"}, HomeChannelEnv: "QQBOT_HOME_CHANNEL", FreeResponseKey: "free_response_chats", AllowedKey: "allowed_chats"},
	{Name: "yuanbao", Label: "Yuanbao", Category: "common", Icon: "lucide:bot-message-square", RequiredEnv: []string{"YUANBAO_APP_ID", "YUANBAO_APP_SECRET"}, RequiredConfigKeys: []string{"app_id", "app_secret"}, HomeChannelEnv: "YUANBAO_HOME_CHANNEL", FreeResponseKey: "free_response_chats", AllowedKey: "allowed_chats"},
	{Name: "matrix", Label: "Matrix", Category: "more", Icon: "simple-icons:matrix", RequiredEnv: []string{"MATRIX_HOMESERVER", "MATRIX_ACCESS_TOKEN", "MATRIX_USER_ID"}, RequiredConfigKeys: []string{"homeserver", "access_token", "user_id"}, HomeChannelEnv: "MATRIX_HOME_ROOM", FreeResponseKey: "free_response_rooms", AllowedKey: "allowed_rooms"},
	{Name: "mattermost", Label: "Mattermost", Category: "more", Icon: "simple-icons:mattermost", RequiredEnv: []string{"MATTERMOST_URL", "MATTERMOST_TOKEN"}, RequiredConfigKeys: []string{"url", "token"}, HomeChannelEnv: "MATTERMOST_HOME_CHANNEL", FreeResponseKey: "free_response_channels", AllowedKey: "allowed_channels"},
	{Name: "signal", Label: "Signal", Category: "more", Icon: "simple-icons:signal", RequiredEnv: []string{"SIGNAL_HTTP_URL", "SIGNAL_ACCOUNT"}, RequiredConfigKeys: []string{"http_url", "account"}, HomeChannelEnv: "SIGNAL_HOME_CHANNEL"},
	{Name: "email", Label: "Email", Category: "more", Icon: "lucide:mail", RequiredEnv: []string{"EMAIL_ADDRESS", "EMAIL_PASSWORD", "EMAIL_IMAP_HOST", "EMAIL_SMTP_HOST"}, RequiredConfigKeys: []string{"address", "password", "imap_host", "smtp_host"}, HomeChannelEnv: "EMAIL_HOME_ADDRESS"},
	{Name: "sms", Label: "SMS", Category: "more", Icon: "lucide:message-square-text", RequiredEnv: []string{"TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"}, RequiredConfigKeys: []string{"account_sid", "auth_token", "phone_number"}, HomeChannelEnv: "SMS_HOME_CHANNEL"},
	{Name: "homeassistant", Label: "Home Assistant", Category: "more", Icon: "simple-icons:homeassistant", RequiredEnv: []string{"HASS_TOKEN"}, RequiredConfigKeys: []string{"token"}},
	{Name: "bluebubbles", Label: "BlueBubbles", Category: "more", Icon: "lucide:messages-square", RequiredEnv: []string{"BLUEBUBBLES_SERVER_URL", "BLUEBUBBLES_PASSWORD"}, RequiredConfigKeys: []string{"server_url", "password"}},
	{Name: "msgraph_webhook", Label: "MS Graph Webhook", Category: "more", Icon: "lucide:mails", RequiredEnv: []string{"MSGRAPH_WEBHOOK_ENABLED", "MSGRAPH_WEBHOOK_CLIENT_STATE"}, RequiredConfigKeys: []string{"enabled", "client_state"}},
	{Name: "google_chat", Label: "Google Chat", Category: "plugin", Icon: "simple-icons:googlechat", RequiredEnv: []string{"GOOGLE_CHAT_PROJECT_ID", "GOOGLE_CHAT_SUBSCRIPTION_NAME", "GOOGLE_CHAT_SERVICE_ACCOUNT_JSON"}, RequiredConfigKeys: []string{"project_id", "subscription_name", "service_account_json"}, HomeChannelEnv: "GOOGLE_CHAT_HOME_CHANNEL", Plugin: true},
	{Name: "irc", Label: "IRC", Category: "plugin", Icon: "lucide:hash", RequiredEnv: []string{"IRC_SERVER", "IRC_CHANNEL", "IRC_NICKNAME"}, RequiredConfigKeys: []string{"server", "channel", "nickname"}, HomeChannelEnv: "IRC_HOME_CHANNEL", Plugin: true, FreeResponseKey: "free_response_channels", AllowedKey: "allowed_channels"},
	{Name: "line", Label: "LINE", Category: "plugin", Icon: "simple-icons:line", RequiredEnv: []string{"LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET"}, RequiredConfigKeys: []string{"channel_access_token", "channel_secret"}, Plugin: true},
	{Name: "teams", Label: "Teams", Category: "plugin", Icon: "simple-icons:microsoftteams", RequiredEnv: []string{"TEAMS_CLIENT_ID", "TEAMS_CLIENT_SECRET"}, RequiredConfigKeys: []string{"client_id", "client_secret"}, HomeChannelEnv: "TEAMS_HOME_CHANNEL", Plugin: true},
}

func ListHermesPlatforms(ctx context.Context, input *HermesPlatformsReadInput) (*HermesPlatformsOutput, error) {
	if input == nil {
		input = &HermesPlatformsReadInput{}
	}
	profile, config, configExists, envKeys, envExists, err := loadHermesPlatformSources(input.Profile)
	if err != nil {
		return nil, err
	}

	homeInfo := HermesHomeInfo{
		Path:               profile.Path,
		GatewayPIDPath:     filepath.Join(profile.Path, "gateway.pid"),
		GatewayPIDExists:   pathExists(filepath.Join(profile.Path, "gateway.pid")),
		GatewayStatePath:   filepath.Join(profile.Path, "gateway_state.json"),
		GatewayStateExists: pathExists(filepath.Join(profile.Path, "gateway_state.json")),
	}
	gateway, _ := detectHermesGateway(ctx, homeInfo)
	body := buildHermesPlatformsResponse(profile, config, configExists, envKeys, envExists, gateway)

	return &HermesPlatformsOutput{Body: body}, nil
}

func UpdateHermesPlatform(ctx context.Context, input *HermesPlatformPatchInput) (*HermesPlatformsOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("platform update is required", nil)
	}
	def, ok := hermesPlatformDefinitionByName(input.Name)
	if !ok {
		return nil, huma.Error404NotFound("Hermes platform not found", nil)
	}

	profile, config, _, envKeys, envExists, err := loadHermesPlatformSources(input.Profile)
	if err != nil {
		return nil, err
	}
	applyHermesPlatformPatch(config, def, input.Body)
	envKeys, envChanged, err := writeHermesPlatformEnvPatch(profile, def, input.Body.Env)
	if err != nil {
		return nil, err
	}
	if envChanged {
		envExists = true
	}

	configPath := filepath.Join(profile.Path, "config.yaml")
	nextContent, err := yaml.Marshal(config)
	if err != nil {
		return nil, huma.Error500InternalServerError("serialize hermes config failed", err)
	}
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		return nil, huma.Error500InternalServerError("create hermes directory failed", err)
	}
	if err := os.WriteFile(configPath, nextContent, 0o600); err != nil {
		return nil, huma.Error500InternalServerError("write hermes platform config failed", err)
	}

	invalidateHermesEnvironmentCache()
	homeInfo := HermesHomeInfo{
		Path:               profile.Path,
		GatewayPIDPath:     filepath.Join(profile.Path, "gateway.pid"),
		GatewayPIDExists:   pathExists(filepath.Join(profile.Path, "gateway.pid")),
		GatewayStatePath:   filepath.Join(profile.Path, "gateway_state.json"),
		GatewayStateExists: pathExists(filepath.Join(profile.Path, "gateway_state.json")),
	}
	gateway, _ := detectHermesGateway(ctx, homeInfo)
	body := buildHermesPlatformsResponse(profile, config, true, envKeys, envExists, gateway)

	return &HermesPlatformsOutput{Body: body}, nil
}

func writeHermesPlatformEnvPatch(profile HermesProfileSelection, def hermesPlatformDefinition, updates map[string]string) (map[string]string, bool, error) {
	envPath := filepath.Join(profile.Path, ".env")
	content, err := os.ReadFile(envPath)
	if err != nil && !os.IsNotExist(err) {
		return nil, false, huma.Error500InternalServerError("read hermes env failed", err)
	}
	allowed := map[string]bool{}
	for _, key := range def.RequiredEnv {
		allowed[key] = true
	}
	cleanUpdates := map[string]string{}
	for key, value := range updates {
		normalizedKey := strings.TrimSpace(key)
		if normalizedKey == "" || !allowed[normalizedKey] {
			return nil, false, huma.Error400BadRequest("unsupported hermes platform env key", nil)
		}
		if strings.TrimSpace(value) == "" {
			continue
		}
		cleanUpdates[normalizedKey] = value
	}
	if len(cleanUpdates) == 0 {
		return parseHermesEnvKeyValues(string(content)), false, nil
	}

	nextContent := upsertHermesEnvContent(string(content), cleanUpdates)
	if err := os.MkdirAll(filepath.Dir(envPath), 0o755); err != nil {
		return nil, false, huma.Error500InternalServerError("create hermes env directory failed", err)
	}
	if err := os.WriteFile(envPath, []byte(nextContent), 0o600); err != nil {
		return nil, false, huma.Error500InternalServerError("write hermes env failed", err)
	}
	return parseHermesEnvKeyValues(nextContent), true, nil
}

func loadHermesPlatformSources(profileName string) (HermesProfileSelection, map[string]any, bool, map[string]string, bool, error) {
	profile, err := resolveHermesProfileSelection(profileName)
	if err != nil {
		return HermesProfileSelection{}, nil, false, nil, false, err
	}

	configPath := filepath.Join(profile.Path, "config.yaml")
	config := map[string]any{}
	configExists := false
	content, err := os.ReadFile(configPath)
	if err != nil {
		if !os.IsNotExist(err) {
			return profile, nil, false, nil, false, huma.Error500InternalServerError("read hermes config failed", err)
		}
	} else {
		configExists = true
		config, err = parseHermesYAMLConfig(content)
		if err != nil {
			return profile, nil, true, nil, false, huma.Error500InternalServerError("parse hermes config failed", err)
		}
	}

	envPath := filepath.Join(profile.Path, ".env")
	envKeys := map[string]string{}
	envExists := false
	envContent, err := os.ReadFile(envPath)
	if err != nil {
		if !os.IsNotExist(err) {
			return profile, nil, configExists, nil, false, huma.Error500InternalServerError("read hermes env failed", err)
		}
	} else {
		envExists = true
		envKeys = parseHermesEnvKeyValues(string(envContent))
	}

	return profile, config, configExists, envKeys, envExists, nil
}

func buildHermesPlatformsResponse(profile HermesProfileSelection, config map[string]any, configExists bool, envKeys map[string]string, envExists bool, gateway HermesGatewayInfo) HermesPlatformsResponse {
	runtime := map[string]HermesGatewayPlatform{}
	for _, platform := range gateway.Platforms {
		runtime[platform.Name] = platform
	}

	platforms := make([]HermesPlatformInfo, 0, len(hermesPlatformDefinitions))
	summary := HermesPlatformsSummary{Total: len(hermesPlatformDefinitions)}
	for _, def := range hermesPlatformDefinitions {
		info := buildHermesPlatformInfo(def, config, envKeys, runtime[def.Name])
		platforms = append(platforms, info)
		if info.Enabled {
			summary.Enabled++
		}
		if info.Configured {
			summary.Configured++
		}
		if info.Connected {
			summary.Connected++
		}
	}
	sort.SliceStable(platforms, func(i int, j int) bool {
		if platforms[i].Category != platforms[j].Category {
			return hermesPlatformCategoryWeight(platforms[i].Category) < hermesPlatformCategoryWeight(platforms[j].Category)
		}
		return platforms[i].Label < platforms[j].Label
	})

	return HermesPlatformsResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Profile:   profile,
		Config:    HermesPlatformFileInfo{Path: filepath.Join(profile.Path, "config.yaml"), Exists: configExists},
		Env:       HermesPlatformFileInfo{Path: filepath.Join(profile.Path, ".env"), Exists: envExists},
		Summary:   summary,
		Platforms: platforms,
	}
}

func buildHermesPlatformInfo(def hermesPlatformDefinition, config map[string]any, envKeys map[string]string, runtime HermesGatewayPlatform) HermesPlatformInfo {
	platforms := objectMap(config["platforms"])
	platformBlock := objectMap(platforms[def.Name])
	section := objectMap(config[def.Name])
	extra := objectMap(platformBlock["extra"])

	enabled := boolValue(platformBlock["enabled"]) || boolValue(section["enabled"])
	configured := def.Configless || hermesPlatformCredentialsPresent(def, platformBlock, section, extra, envKeys)
	runtimeState := strings.TrimSpace(runtime.State)
	connected := strings.EqualFold(runtimeState, "connected") || strings.EqualFold(runtimeState, "running") || strings.EqualFold(runtimeState, "ready")
	if runtimeState == "" && def.Name == "api_server" && enabled {
		connected = false
	}

	required := make([]HermesPlatformEnvKey, 0, len(def.RequiredEnv))
	for _, key := range def.RequiredEnv {
		source := ""
		present := false
		if value := strings.TrimSpace(envKeys[key]); value != "" {
			source = "env"
			present = true
		}
		required = append(required, HermesPlatformEnvKey{Key: key, Present: present, Source: source})
	}

	requireMention := optionalBool(section["require_mention"], extra["require_mention"])
	replyToMode := firstString(section["reply_to_mode"], platformBlock["reply_to_mode"], extra["reply_to_mode"])
	if replyToMode == "" {
		replyToMode = "first"
	}
	restartNotification := true
	if _, ok := platformBlock["gateway_restart_notification"]; ok {
		restartNotification = boolValue(platformBlock["gateway_restart_notification"])
	}

	return HermesPlatformInfo{
		Name:                       def.Name,
		Label:                      def.Label,
		Category:                   def.Category,
		Icon:                       def.Icon,
		Enabled:                    enabled,
		Configured:                 configured,
		Connected:                  connected,
		RuntimeState:               runtimeState,
		RuntimeError:               firstString(runtime.ErrorMessage, runtime.ErrorCode),
		UpdatedAt:                  runtime.UpdatedAt,
		RequiredEnv:                required,
		HomeChannel:                homeChannelSummary(def, platformBlock, section, extra, envKeys),
		HomeChannelKey:             def.HomeChannelEnv,
		ReplyToMode:                replyToMode,
		GatewayRestartNotification: restartNotification,
		RequireMention:             requireMention,
		FreeResponse:               configListAsText(firstDefined(section[def.FreeResponseKey], extra[def.FreeResponseKey])),
		Allowed:                    configListAsText(firstDefined(section[def.AllowedKey], extra[def.AllowedKey])),
		UnauthorizedDMBehavior:     firstString(section["unauthorized_dm_behavior"], extra["unauthorized_dm_behavior"]),
		NoticeDelivery:             firstString(section["notice_delivery"], extra["notice_delivery"]),
		Plugin:                     def.Plugin,
		ConfigKeys:                 HermesPlatformConfigKeys{FreeResponse: def.FreeResponseKey, Allowed: def.AllowedKey},
	}
}

func applyHermesPlatformPatch(config map[string]any, def hermesPlatformDefinition, patch HermesPlatformUpdateRequest) {
	platforms := objectMap(config["platforms"])
	config["platforms"] = platforms
	platformBlock := objectMap(platforms[def.Name])
	platforms[def.Name] = platformBlock
	extra := objectMap(platformBlock["extra"])
	platformBlock["extra"] = extra

	section := objectMap(config[def.Name])
	config[def.Name] = section

	if patch.Enabled != nil {
		platformBlock["enabled"] = *patch.Enabled
		section["enabled"] = *patch.Enabled
	}
	if patch.GatewayRestartNotification != nil {
		platformBlock["gateway_restart_notification"] = *patch.GatewayRestartNotification
	}
	if patch.RequireMention != nil {
		section["require_mention"] = *patch.RequireMention
		extra["require_mention"] = *patch.RequireMention
	}
	if def.FreeResponseKey != "" {
		setOrDeleteConfigList(section, def.FreeResponseKey, patch.FreeResponse)
		setOrDeleteConfigList(extra, def.FreeResponseKey, patch.FreeResponse)
	}
	if def.AllowedKey != "" {
		setOrDeleteConfigList(section, def.AllowedKey, patch.Allowed)
		setOrDeleteConfigList(extra, def.AllowedKey, patch.Allowed)
	}
	if value := normalizeReplyToMode(patch.ReplyToMode); value != "" {
		section["reply_to_mode"] = value
		platformBlock["reply_to_mode"] = value
		extra["reply_to_mode"] = value
	}
	if value := normalizePlatformEnum(patch.UnauthorizedDMBehavior, []string{"pair", "ignore"}); value != "" {
		section["unauthorized_dm_behavior"] = value
		extra["unauthorized_dm_behavior"] = value
	}
	if value := normalizePlatformEnum(patch.NoticeDelivery, []string{"public", "private"}); value != "" {
		section["notice_delivery"] = value
		extra["notice_delivery"] = value
	}
}

func hermesPlatformDefinitionByName(name string) (hermesPlatformDefinition, bool) {
	normalized := strings.ToLower(strings.TrimSpace(name))
	for _, def := range hermesPlatformDefinitions {
		if def.Name == normalized {
			return def, true
		}
	}
	return hermesPlatformDefinition{}, false
}

func hermesPlatformCredentialsPresent(def hermesPlatformDefinition, platformBlock map[string]any, section map[string]any, extra map[string]any, envKeys map[string]string) bool {
	if len(def.RequiredEnv) > 0 {
		for _, key := range def.RequiredEnv {
			if strings.TrimSpace(envKeys[key]) == "" {
				return false
			}
		}
		return true
	}
	if len(def.RequiredConfigKeys) > 0 {
		for _, key := range def.RequiredConfigKeys {
			if strings.TrimSpace(firstConfigString(platformBlock, section, extra, key)) == "" {
				return false
			}
		}
		return true
	}
	return true
}

func parseHermesEnvKeyValues(content string) map[string]string {
	keys := map[string]string{}
	for _, raw := range strings.Split(content, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {
			continue
		}
		key, value, _ := strings.Cut(line, "=")
		key = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(key), "export "))
		if key == "" {
			continue
		}
		keys[key] = normalizeYAMLScalar(strings.TrimSpace(value))
	}
	return keys
}

func upsertHermesEnvContent(content string, updates map[string]string) string {
	lines := strings.Split(content, "\n")
	seen := map[string]bool{}
	for index, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {
			continue
		}
		key, _, _ := strings.Cut(line, "=")
		prefix := ""
		key = strings.TrimSpace(key)
		if strings.HasPrefix(key, "export ") {
			prefix = "export "
			key = strings.TrimSpace(strings.TrimPrefix(key, "export "))
		}
		value, ok := updates[key]
		if !ok {
			continue
		}
		lines[index] = prefix + key + "=" + quoteHermesEnvValue(value)
		seen[key] = true
	}

	if strings.TrimSpace(content) != "" && (len(lines) == 0 || strings.TrimSpace(lines[len(lines)-1]) != "") {
		lines = append(lines, "")
	}
	for key, value := range updates {
		if seen[key] {
			continue
		}
		lines = append(lines, key+"="+quoteHermesEnvValue(value))
	}
	return strings.TrimRight(strings.Join(lines, "\n"), "\n") + "\n"
}

func quoteHermesEnvValue(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if strings.ContainsAny(value, " \t#\"'\\$`") {
		escaped := strings.ReplaceAll(value, "\\", "\\\\")
		escaped = strings.ReplaceAll(escaped, "\"", "\\\"")
		return "\"" + escaped + "\""
	}
	return value
}

func optionalBool(values ...any) *bool {
	for _, value := range values {
		switch typed := value.(type) {
		case bool:
			result := typed
			return &result
		case string:
			text := strings.TrimSpace(typed)
			if text == "" {
				continue
			}
			result := strings.EqualFold(text, "true") || text == "1" || strings.EqualFold(text, "yes") || strings.EqualFold(text, "on")
			return &result
		}
	}
	return nil
}

func firstDefined(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func configListAsText(value any) string {
	switch typed := value.(type) {
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			text := strings.TrimSpace(anyStringOrScalar(item))
			if text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, ", ")
	case []string:
		return strings.Join(typed, ", ")
	default:
		return strings.TrimSpace(anyStringOrScalar(value))
	}
}

func anyStringOrScalar(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case bool:
		if typed {
			return "true"
		}
		return "false"
	default:
		return ""
	}
}

func setOrDeleteConfigList(target map[string]any, key string, value string) {
	if key == "" {
		return
	}
	items := splitConfigList(value)
	if len(items) == 0 {
		delete(target, key)
		return
	}
	target[key] = items
}

func splitConfigList(value string) []string {
	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == '\n' || r == '\r' || r == '\t'
	})
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		text := strings.TrimSpace(part)
		if text == "" || seen[text] {
			continue
		}
		seen[text] = true
		out = append(out, text)
	}
	return out
}

func normalizeReplyToMode(value string) string {
	return normalizePlatformEnum(value, []string{"off", "first", "all"})
}

func normalizePlatformEnum(value string, allowed []string) string {
	text := strings.ToLower(strings.TrimSpace(value))
	if text == "" {
		return ""
	}
	for _, item := range allowed {
		if text == item {
			return text
		}
	}
	return ""
}

func homeChannelSummary(def hermesPlatformDefinition, platformBlock map[string]any, section map[string]any, extra map[string]any, envKeys map[string]string) string {
	if def.HomeChannelEnv != "" {
		if value := strings.TrimSpace(envKeys[def.HomeChannelEnv]); value != "" {
			return value
		}
	}
	if value := firstString(section["home_channel"], extra["home_channel"]); value != "" {
		return value
	}
	for _, value := range []any{platformBlock["home_channel"], section["homeChannel"], extra["homeChannel"]} {
		if text := strings.TrimSpace(anyStringOrScalar(value)); text != "" {
			return text
		}
		if item := objectMap(value); len(item) > 0 {
			if text := firstString(item["id"], item["channel"], item["chat_id"], item["room_id"], item["address"]); text != "" {
				return text
			}
		}
	}
	return ""
}

func firstConfigString(platformBlock map[string]any, section map[string]any, extra map[string]any, key string) string {
	switch key {
	case "token":
		return firstString(platformBlock["token"], section["token"], extra["token"])
	case "api_key":
		return firstString(platformBlock["api_key"], section["api_key"], extra["api_key"])
	default:
		return firstString(platformBlock[key], section[key], extra[key])
	}
}

func hermesPlatformCategoryWeight(category string) int {
	switch category {
	case "core":
		return 0
	case "common":
		return 1
	case "more":
		return 2
	case "plugin":
		return 3
	default:
		return 9
	}
}
