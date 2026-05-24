package ccconnect

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

const (
	ccConnectFeishuAccountsBaseURL = "https://accounts.feishu.cn"
	ccConnectLarkAccountsBaseURL   = "https://accounts.larksuite.com"
	ccConnectWeixinDefaultAPIURL   = "https://ilinkai.weixin.qq.com"
)

type CCConnectSetupFeishuBeginOutput struct {
	Body CCConnectSetupFeishuBeginResponse
}

type CCConnectSetupFeishuPollInput struct {
	Body CCConnectSetupFeishuPollRequest
}

type CCConnectSetupFeishuPollOutput struct {
	Body CCConnectSetupFeishuPollResponse
}

type CCConnectSetupFeishuSaveInput struct {
	Body CCConnectSetupFeishuSaveRequest
}

type CCConnectSetupWeixinBeginInput struct {
	Body CCConnectSetupWeixinBeginRequest
}

type CCConnectSetupWeixinBeginOutput struct {
	Body CCConnectSetupWeixinBeginResponse
}

type CCConnectSetupWeixinPollInput struct {
	Body CCConnectSetupWeixinPollRequest
}

type CCConnectSetupWeixinPollOutput struct {
	Body CCConnectSetupWeixinPollResponse
}

type CCConnectSetupWeixinSaveInput struct {
	Body CCConnectSetupWeixinSaveRequest
}

type CCConnectAddPlatformInput struct {
	Body CCConnectAddPlatformRequest
}

type CCConnectProjectSetupOutput struct {
	Body CCConnectProjectSetupResponse
}

type CCConnectSetupFeishuBeginResponse struct {
	Status     string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp  string `json:"timestamp" example:"2026-05-18T10:30:00Z" doc:"UTC response timestamp."`
	DeviceCode string `json:"deviceCode" doc:"Feishu device code for polling."`
	QrURL      string `json:"qrUrl" doc:"Verification URL to render as QR code."`
	Interval   int    `json:"interval" example:"5" doc:"Suggested polling interval in seconds."`
	ExpiresIn  int    `json:"expiresIn" example:"600" doc:"QR expiration in seconds."`
}

type CCConnectSetupFeishuPollRequest struct {
	DeviceCode string `json:"deviceCode" doc:"Device code returned by begin."`
	BaseURL    string `json:"baseUrl,omitempty" doc:"Optional accounts base URL for Lark retry."`
}

type CCConnectSetupFeishuPollResponse struct {
	Status      string `json:"status" example:"pending" doc:"pending, completed, denied, expired, or error."`
	Timestamp   string `json:"timestamp" example:"2026-05-18T10:30:00Z" doc:"UTC response timestamp."`
	BaseURL     string `json:"baseUrl,omitempty" doc:"Accounts base URL used for polling."`
	Platform    string `json:"platform,omitempty" example:"feishu" doc:"Resolved platform: feishu or lark."`
	AppID       string `json:"appId,omitempty" doc:"Client ID returned after QR authorization."`
	AppSecret   string `json:"appSecret,omitempty" doc:"Client secret returned after QR authorization."`
	OwnerOpenID string `json:"ownerOpenId,omitempty" doc:"Owner open_id returned after QR authorization."`
	SlowDown    bool   `json:"slowDown,omitempty" doc:"Whether client should slow down polling."`
	Error       string `json:"error,omitempty" doc:"Upstream error description."`
}

type CCConnectSetupFeishuSaveRequest struct {
	ProjectName  string `json:"projectName" doc:"Project name to create or update."`
	AppID        string `json:"appId" doc:"Feishu/Lark app ID."`
	AppSecret    string `json:"appSecret" doc:"Feishu/Lark app secret."`
	PlatformType string `json:"platformType,omitempty" example:"feishu" doc:"feishu or lark."`
	OwnerOpenID  string `json:"ownerOpenId,omitempty" doc:"Owner open_id to seed allow_from."`
	WorkDir      string `json:"workDir,omitempty" doc:"Agent work directory for new project."`
	AgentType    string `json:"agentType,omitempty" example:"claudecode" doc:"Agent type for new project."`
}

type CCConnectSetupWeixinBeginRequest struct {
	APIURL string `json:"apiUrl,omitempty" doc:"Optional iLink API base URL."`
}

type CCConnectSetupWeixinBeginResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-18T10:30:00Z" doc:"UTC response timestamp."`
	QRKey     string `json:"qrKey" doc:"Weixin QR polling key."`
	QrURL     string `json:"qrUrl" doc:"QR image URL/content returned by iLink."`
}

type CCConnectSetupWeixinPollRequest struct {
	QRKey  string `json:"qrKey" doc:"QR key returned by begin."`
	APIURL string `json:"apiUrl,omitempty" doc:"Optional iLink API base URL."`
}

type CCConnectSetupWeixinPollResponse struct {
	Status      string `json:"status" example:"wait" doc:"wait or confirmed."`
	Timestamp   string `json:"timestamp" example:"2026-05-18T10:30:00Z" doc:"UTC response timestamp."`
	BotToken    string `json:"botToken,omitempty" doc:"Weixin bot token returned after scan."`
	IlinkBotID  string `json:"ilinkBotId,omitempty" doc:"iLink bot ID."`
	BaseURL     string `json:"baseUrl,omitempty" doc:"Weixin base URL."`
	IlinkUserID string `json:"ilinkUserId,omitempty" doc:"Scanned user ID for allow_from."`
}

type CCConnectSetupWeixinSaveRequest struct {
	ProjectName string `json:"projectName" doc:"Project name to create or update."`
	Token       string `json:"token" doc:"Weixin bot token."`
	BaseURL     string `json:"baseUrl,omitempty" doc:"Weixin base URL."`
	IlinkBotID  string `json:"ilinkBotId,omitempty" doc:"iLink bot ID stored as account_id."`
	IlinkUserID string `json:"ilinkUserId,omitempty" doc:"Scanned user ID to seed allow_from."`
	WorkDir     string `json:"workDir,omitempty" doc:"Agent work directory for new project."`
	AgentType   string `json:"agentType,omitempty" example:"claudecode" doc:"Agent type for new project."`
}

type CCConnectAddPlatformRequest struct {
	ProjectName string            `json:"projectName" doc:"Project name to create or update."`
	Type        string            `json:"type" doc:"Platform type."`
	Options     map[string]string `json:"options,omitempty" doc:"Platform options."`
	WorkDir     string            `json:"workDir,omitempty" doc:"Agent work directory for new project."`
	AgentType   string            `json:"agentType,omitempty" example:"claudecode" doc:"Agent type for new project."`
}

type CCConnectProjectSetupResponse struct {
	Status          string                         `json:"status" example:"ok" doc:"Operation status."`
	Timestamp       string                         `json:"timestamp" example:"2026-05-18T10:30:00Z" doc:"UTC response timestamp."`
	Path            string                         `json:"path" doc:"Resolved config.toml path."`
	Project         CCConnectProjectConfig         `json:"project" doc:"Created or updated project."`
	Config          CCConnectProjectsConfig        `json:"config" doc:"Updated projects config."`
	Summary         CCConnectProjectsConfigSummary `json:"summary" doc:"Updated project summary."`
	RestartRequired bool                           `json:"restartRequired" example:"true" doc:"Whether cc-connect runtime should be restarted."`
}

func CCConnectSetupFeishuBegin(ctx context.Context, input *struct{}) (*CCConnectSetupFeishuBeginOutput, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	if _, err := ccConnectFeishuRegistrationCall(ctx, client, ccConnectFeishuAccountsBaseURL, "init", nil); err != nil {
		return nil, huma.Error502BadGateway("feishu init failed", err)
	}
	beginResp, err := ccConnectFeishuRegistrationCall(ctx, client, ccConnectFeishuAccountsBaseURL, "begin", map[string]string{
		"archetype":         "PersonalAgent",
		"auth_method":       "client_secret",
		"request_user_info": "open_id",
	})
	if err != nil {
		return nil, huma.Error502BadGateway("feishu begin failed", err)
	}
	if errMsg, _ := beginResp["error"].(string); errMsg != "" {
		desc, _ := beginResp["error_description"].(string)
		return nil, huma.Error502BadGateway(fmt.Sprintf("feishu begin: %s: %s", errMsg, desc), nil)
	}

	deviceCode, _ := beginResp["device_code"].(string)
	qrURL, _ := beginResp["verification_uri_complete"].(string)
	if deviceCode == "" || qrURL == "" {
		return nil, huma.Error502BadGateway("feishu begin returned incomplete response", nil)
	}

	return &CCConnectSetupFeishuBeginOutput{Body: CCConnectSetupFeishuBeginResponse{
		Status:     "ok",
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		DeviceCode: deviceCode,
		QrURL:      qrURL,
		Interval:   intFromAny(beginResp["interval"]),
		ExpiresIn:  intFromAny(beginResp["expire_in"]),
	}}, nil
}

func CCConnectSetupFeishuPoll(ctx context.Context, input *CCConnectSetupFeishuPollInput) (*CCConnectSetupFeishuPollOutput, error) {
	if input == nil || strings.TrimSpace(input.Body.DeviceCode) == "" {
		return nil, huma.Error400BadRequest("deviceCode is required", nil)
	}
	baseURL := strings.TrimSpace(input.Body.BaseURL)
	if baseURL == "" {
		baseURL = ccConnectFeishuAccountsBaseURL
	}
	client := &http.Client{Timeout: 15 * time.Second}

	for attempt := 0; attempt < 2; attempt++ {
		pollResp, err := ccConnectFeishuRegistrationCall(ctx, client, baseURL, "poll", map[string]string{"device_code": input.Body.DeviceCode})
		if err != nil {
			return nil, huma.Error502BadGateway("feishu poll failed", err)
		}
		if userInfo, ok := pollResp["user_info"].(map[string]any); ok {
			if brand, _ := userInfo["tenant_brand"].(string); strings.EqualFold(brand, "lark") && baseURL != ccConnectLarkAccountsBaseURL {
				baseURL = ccConnectLarkAccountsBaseURL
				continue
			}
		}

		body := CCConnectSetupFeishuPollResponse{Status: "pending", Timestamp: time.Now().UTC().Format(time.RFC3339), BaseURL: baseURL}
		clientID, _ := pollResp["client_id"].(string)
		clientSecret, _ := pollResp["client_secret"].(string)
		if clientID != "" && clientSecret != "" {
			body.Status = "completed"
			body.Platform = "feishu"
			body.AppID = clientID
			body.AppSecret = clientSecret
			if userInfo, ok := pollResp["user_info"].(map[string]any); ok {
				if brand, _ := userInfo["tenant_brand"].(string); strings.EqualFold(brand, "lark") {
					body.Platform = "lark"
				}
				if oid, _ := userInfo["open_id"].(string); oid != "" {
					body.OwnerOpenID = oid
				}
			}
			return &CCConnectSetupFeishuPollOutput{Body: body}, nil
		}

		if errCode, _ := pollResp["error"].(string); errCode != "" {
			switch errCode {
			case "authorization_pending":
			case "slow_down":
				body.SlowDown = true
			case "access_denied":
				body.Status = "denied"
			case "expired_token":
				body.Status = "expired"
			default:
				desc, _ := pollResp["error_description"].(string)
				body.Status = "error"
				body.Error = strings.TrimSpace(fmt.Sprintf("%s: %s", errCode, desc))
			}
		}
		return &CCConnectSetupFeishuPollOutput{Body: body}, nil
	}

	return &CCConnectSetupFeishuPollOutput{Body: CCConnectSetupFeishuPollResponse{Status: "pending", Timestamp: time.Now().UTC().Format(time.RFC3339), BaseURL: baseURL}}, nil
}

func CCConnectSetupFeishuSave(ctx context.Context, input *CCConnectSetupFeishuSaveInput) (*CCConnectProjectSetupOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("feishu setup payload is required", nil)
	}
	req := input.Body
	projectName := strings.TrimSpace(req.ProjectName)
	appID := strings.TrimSpace(req.AppID)
	appSecret := strings.TrimSpace(req.AppSecret)
	if projectName == "" || appID == "" || appSecret == "" {
		return nil, huma.Error400BadRequest("projectName, appId and appSecret are required", nil)
	}
	platformType := strings.ToLower(strings.TrimSpace(req.PlatformType))
	if platformType == "" {
		platformType = "feishu"
	}
	if platformType != "feishu" && platformType != "lark" {
		return nil, huma.Error400BadRequest("platformType must be feishu or lark", nil)
	}
	options := map[string]string{"app_id": appID, "app_secret": appSecret}
	if owner := strings.TrimSpace(req.OwnerOpenID); owner != "" {
		options["allow_from"] = owner
	}
	return saveCCConnectProjectPlatform(projectName, platformType, options, req.WorkDir, req.AgentType)
}

func CCConnectSetupWeixinBegin(ctx context.Context, input *CCConnectSetupWeixinBeginInput) (*CCConnectSetupWeixinBeginOutput, error) {
	apiBase := ccConnectWeixinDefaultAPIURL
	if input != nil && strings.TrimSpace(input.Body.APIURL) != "" {
		apiBase = strings.TrimRight(strings.TrimSpace(input.Body.APIURL), "/")
	}
	u, err := url.Parse(apiBase + "/")
	if err != nil {
		return nil, huma.Error400BadRequest("invalid apiUrl", err)
	}
	u = u.JoinPath("ilink", "bot", "get_bot_qrcode")
	q := u.Query()
	q.Set("bot_type", "3")
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, huma.Error500InternalServerError("build weixin request failed", err)
	}
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, huma.Error502BadGateway("weixin get_bot_qrcode failed", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, huma.Error502BadGateway(fmt.Sprintf("weixin get_bot_qrcode: http %d", resp.StatusCode), nil)
	}
	var qrResp struct {
		QRCode           string `json:"qrcode"`
		QRCodeImgContent string `json:"qrcode_img_content"`
	}
	if err := json.Unmarshal(body, &qrResp); err != nil {
		return nil, huma.Error502BadGateway("decode weixin QR response failed", err)
	}
	if strings.TrimSpace(qrResp.QRCodeImgContent) == "" {
		return nil, huma.Error502BadGateway("weixin returned empty QR content", nil)
	}
	return &CCConnectSetupWeixinBeginOutput{Body: CCConnectSetupWeixinBeginResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		QRKey:     qrResp.QRCode,
		QrURL:     strings.TrimSpace(qrResp.QRCodeImgContent),
	}}, nil
}

func CCConnectSetupWeixinPoll(ctx context.Context, input *CCConnectSetupWeixinPollInput) (*CCConnectSetupWeixinPollOutput, error) {
	if input == nil || strings.TrimSpace(input.Body.QRKey) == "" {
		return nil, huma.Error400BadRequest("qrKey is required", nil)
	}
	apiBase := ccConnectWeixinDefaultAPIURL
	if strings.TrimSpace(input.Body.APIURL) != "" {
		apiBase = strings.TrimRight(strings.TrimSpace(input.Body.APIURL), "/")
	}
	u, _ := url.Parse(apiBase + "/")
	u = u.JoinPath("ilink", "bot", "get_qrcode_status")
	q := u.Query()
	q.Set("qrcode", input.Body.QRKey)
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, huma.Error500InternalServerError("build weixin poll request failed", err)
	}
	req.Header.Set("iLink-App-ClientVersion", "1")
	resp, err := (&http.Client{Timeout: 40 * time.Second}).Do(req)
	if err != nil {
		return &CCConnectSetupWeixinPollOutput{Body: CCConnectSetupWeixinPollResponse{Status: "wait", Timestamp: time.Now().UTC().Format(time.RFC3339)}}, nil
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, huma.Error502BadGateway(fmt.Sprintf("weixin poll: http %d", resp.StatusCode), nil)
	}
	var status struct {
		Status      string `json:"status"`
		BotToken    string `json:"bot_token"`
		IlinkBotID  string `json:"ilink_bot_id"`
		BaseURL     string `json:"baseurl"`
		IlinkUserID string `json:"ilink_user_id"`
	}
	if err := json.Unmarshal(body, &status); err != nil {
		return nil, huma.Error502BadGateway("decode weixin poll response failed", err)
	}
	out := CCConnectSetupWeixinPollResponse{Status: strings.TrimSpace(status.Status), Timestamp: time.Now().UTC().Format(time.RFC3339)}
	if out.Status == "" {
		out.Status = "wait"
	}
	if out.Status == "confirmed" {
		out.BotToken = strings.TrimSpace(status.BotToken)
		out.IlinkBotID = strings.TrimSpace(status.IlinkBotID)
		out.BaseURL = strings.TrimSpace(status.BaseURL)
		out.IlinkUserID = strings.TrimSpace(status.IlinkUserID)
	}
	return &CCConnectSetupWeixinPollOutput{Body: out}, nil
}

func CCConnectSetupWeixinSave(ctx context.Context, input *CCConnectSetupWeixinSaveInput) (*CCConnectProjectSetupOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("weixin setup payload is required", nil)
	}
	req := input.Body
	projectName := strings.TrimSpace(req.ProjectName)
	token := strings.TrimSpace(req.Token)
	if projectName == "" || token == "" {
		return nil, huma.Error400BadRequest("projectName and token are required", nil)
	}
	options := map[string]string{"token": token}
	if baseURL := strings.TrimSpace(req.BaseURL); baseURL != "" {
		options["base_url"] = baseURL
	}
	if botID := strings.TrimSpace(req.IlinkBotID); botID != "" {
		options["account_id"] = botID
	}
	if userID := strings.TrimSpace(req.IlinkUserID); userID != "" {
		options["allow_from"] = userID
	}
	return saveCCConnectProjectPlatform(projectName, "weixin", options, req.WorkDir, req.AgentType)
}

func AddCCConnectProjectPlatform(ctx context.Context, input *CCConnectAddPlatformInput) (*CCConnectProjectSetupOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("platform payload is required", nil)
	}
	req := input.Body
	projectName := strings.TrimSpace(req.ProjectName)
	platformType := strings.TrimSpace(req.Type)
	if projectName == "" || platformType == "" {
		return nil, huma.Error400BadRequest("projectName and type are required", nil)
	}
	if err := validateManualPlatformOptions(platformType, req.Options); err != nil {
		return nil, huma.Error400BadRequest("platform options are invalid", err)
	}
	return saveCCConnectProjectPlatform(projectName, platformType, req.Options, req.WorkDir, req.AgentType)
}

func ccConnectFeishuRegistrationCall(ctx context.Context, client *http.Client, baseURL string, action string, params map[string]string) (map[string]any, error) {
	form := url.Values{}
	form.Set("action", action)
	for key, value := range params {
		form.Set(key, value)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(baseURL, "/")+"/oauth/v1/app/registration", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func saveCCConnectProjectPlatform(projectName string, platformType string, options map[string]string, workDir string, agentType string) (*CCConnectProjectSetupOutput, error) {
	projectName = strings.TrimSpace(projectName)
	platformType = strings.TrimSpace(platformType)
	path, _ := resolveCCConnectConfigPath()
	doc, _, err := readCCConnectConfigDocument(path)
	if err != nil {
		return nil, huma.Error500InternalServerError("read cc-connect config failed", err)
	}

	cfg := parseCCConnectProjectsConfig(doc)
	project := ensureCCConnectSetupProject(&cfg, projectName, workDir, agentType)
	upsertCCConnectProjectPlatform(project, platformType, cleanStringMap(options))
	if err := validateCCConnectProjectsConfig(cfg); err != nil {
		return nil, huma.Error400BadRequest("cc-connect project config is invalid", err)
	}
	applyCCConnectProjectsConfig(doc, cfg)
	content, err := encodeCCConnectConfigDocument(doc)
	if err != nil {
		return nil, huma.Error500InternalServerError("encode cc-connect config failed", err)
	}
	if err := validateCCConnectTOML(content); err != nil {
		return nil, huma.Error500InternalServerError("encoded cc-connect config is invalid", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, huma.Error500InternalServerError("create cc-connect config directory failed", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return nil, huma.Error500InternalServerError("write cc-connect config failed", err)
	}

	invalidateCCConnectEnvironmentCache()
	next := parseCCConnectProjectsConfig(doc)
	created := CCConnectProjectConfig{}
	for _, item := range next.Projects {
		if item.Name == projectName {
			created = item
			break
		}
	}
	return &CCConnectProjectSetupOutput{Body: CCConnectProjectSetupResponse{
		Status:          "ok",
		Timestamp:       time.Now().UTC().Format(time.RFC3339),
		Path:            path,
		Project:         created,
		Config:          next,
		Summary:         summarizeCCConnectProjectsConfig(next),
		RestartRequired: true,
	}}, nil
}

func ensureCCConnectSetupProject(cfg *CCConnectProjectsConfig, projectName string, workDir string, agentType string) *CCConnectProjectConfig {
	for i := range cfg.Projects {
		if cfg.Projects[i].Name == projectName {
			if strings.TrimSpace(workDir) != "" {
				cfg.Projects[i].Agent.WorkDir = strings.TrimSpace(workDir)
			}
			if strings.TrimSpace(agentType) != "" {
				cfg.Projects[i].Agent.Type = strings.TrimSpace(agentType)
			}
			return &cfg.Projects[i]
		}
	}
	agent := CCConnectProjectAgentConfig{Type: "claudecode", Mode: "default"}
	if strings.TrimSpace(agentType) != "" {
		agent.Type = strings.TrimSpace(agentType)
	}
	if strings.TrimSpace(workDir) != "" {
		agent.WorkDir = strings.TrimSpace(workDir)
	}
	cfg.Projects = append(cfg.Projects, CCConnectProjectConfig{
		Name:            projectName,
		ResetOnIdleMins: 30,
		Agent:           agent,
		Platforms:       []CCConnectProjectPlatformConfig{},
	})
	return &cfg.Projects[len(cfg.Projects)-1]
}

func upsertCCConnectProjectPlatform(project *CCConnectProjectConfig, platformType string, options map[string]string) {
	platformType = strings.TrimSpace(platformType)
	for i := range project.Platforms {
		if strings.EqualFold(project.Platforms[i].Type, platformType) || ccConnectPlatformSameFamily(project.Platforms[i].Type, platformType) {
			project.Platforms[i].Type = platformType
			project.Platforms[i].Options = options
			return
		}
	}
	project.Platforms = append(project.Platforms, CCConnectProjectPlatformConfig{Type: platformType, Options: options})
}

func ccConnectPlatformSameFamily(current string, next string) bool {
	current = strings.ToLower(strings.TrimSpace(current))
	next = strings.ToLower(strings.TrimSpace(next))
	return (current == "feishu" || current == "lark") && (next == "feishu" || next == "lark")
}

func validateManualPlatformOptions(platformType string, options map[string]string) error {
	options = cleanStringMap(options)
	required := requiredCCConnectPlatformFields(platformType)
	for _, field := range required {
		if strings.TrimSpace(options[field]) == "" {
			return fmt.Errorf("%s is required for %s", field, platformType)
		}
	}
	return nil
}

func requiredCCConnectPlatformFields(platformType string) []string {
	switch strings.ToLower(strings.TrimSpace(platformType)) {
	case "feishu", "lark":
		return []string{"app_id", "app_secret"}
	case "weixin":
		return []string{"token"}
	case "telegram":
		return []string{"bot_token"}
	case "slack":
		return []string{"bot_token", "app_token"}
	case "dingtalk":
		return []string{"client_id", "client_secret"}
	case "discord":
		return []string{"token"}
	case "line":
		return []string{"channel_secret", "channel_access_token"}
	case "wecom":
		return []string{"corp_id", "agent_id", "secret"}
	case "qq", "qqbot":
		return []string{"app_id", "token"}
	default:
		return []string{}
	}
}

func cleanStringMap(values map[string]string) map[string]string {
	out := map[string]string{}
	for key, value := range values {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		out[key] = strings.TrimSpace(value)
	}
	return out
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
		parsed, _ := typed.Int64()
		return int(parsed)
	default:
		return 0
	}
}
