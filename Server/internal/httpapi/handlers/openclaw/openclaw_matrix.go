package openclaw

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/sse"
)

const (
	openClawMatrixChannelID = "matrix"
	openClawMatrixPackage   = "@openclaw/matrix"
)

type OpenClawMatrixStatusOutput struct {
	Body OpenClawMatrixStatusResponse
}

type OpenClawMatrixConfigInput struct {
	Body OpenClawMatrixConfigRequest
}

type OpenClawMatrixConfigOutput struct {
	Body OpenClawMatrixStatusResponse
}

type OpenClawMatrixAccountConfigInput struct {
	AccountID string `path:"accountId" doc:"Matrix account id." example:"default"`
	Body      OpenClawMatrixAccountConfigRequest
}

type OpenClawMatrixAccountConfigOutput struct {
	Body OpenClawMatrixStatusResponse
}

type OpenClawMatrixAccountDeleteInput struct {
	AccountID string `path:"accountId" doc:"Matrix account id." example:"default"`
}

type OpenClawMatrixAccountDeleteOutput struct {
	Body OpenClawMatrixAccountDeleteResponse
}

type OpenClawMatrixAddStreamInput struct {
	AccountID           string `query:"accountId" doc:"Matrix account id. Empty uses default." example:"default"`
	Name                string `query:"name" doc:"Optional account display name."`
	Homeserver          string `query:"homeserver" doc:"Matrix homeserver URL." example:"https://matrix.example.org"`
	AccessToken         string `query:"accessToken" doc:"Matrix access token. Required for token auth."`
	UserID              string `query:"userId" doc:"Matrix user id. Required for password auth." example:"@bot:example.org"`
	Password            string `query:"password" doc:"Matrix password. Required for password auth."`
	DeviceName          string `query:"deviceName" doc:"Matrix device display name."`
	InitialSyncLimit    string `query:"initialSyncLimit" doc:"Initial sync event limit."`
	AllowPrivateNetwork bool   `query:"allowPrivateNetwork" doc:"Allow private/LAN homeserver targets for this account."`
	Encryption          bool   `query:"encryption" doc:"Enable Matrix E2EE during account setup."`
	AgentID             string `query:"agentId" doc:"Agent id routed to this account."`
	DMPolicy            string `query:"dmPolicy" enum:"pairing,allowlist,open,disabled" example:"pairing" doc:"Matrix DM access policy."`
	DMAllowFrom         string `query:"dmAllowFrom" doc:"Comma or newline separated Matrix user ids for DM allowlist."`
	GroupPolicy         string `query:"groupPolicy" enum:"open,allowlist,disabled" doc:"Matrix room access policy."`
	GroupAllowFrom      string `query:"groupAllowFrom" doc:"Comma or newline separated Matrix user ids for room allowlist."`
	AutoJoin            string `query:"autoJoin" enum:"off,allowlist,always" doc:"Matrix invite auto-join policy."`
	AutoJoinAllowlist   string `query:"autoJoinAllowlist" doc:"Comma or newline separated Matrix room ids or aliases."`
}

type OpenClawMatrixStatusResponse struct {
	Status       string                         `json:"status" example:"ok" doc:"Operation status."`
	ChannelID    string                         `json:"channelId" example:"matrix" doc:"OpenClaw channel id."`
	Package      string                         `json:"package" example:"@openclaw/matrix" doc:"OpenClaw Matrix package name."`
	Installed    bool                           `json:"installed" example:"true" doc:"Whether Matrix appears available from local install records or config."`
	Configured   bool                           `json:"configured" example:"true" doc:"Whether at least one Matrix account has usable auth or cached credentials."`
	Enabled      bool                           `json:"enabled" example:"true" doc:"Whether channels.matrix.enabled is true."`
	Config       OpenClawMatrixConfigResponse   `json:"config" doc:"Matrix channel config summary without secrets."`
	Accounts     []OpenClawMatrixAccountSummary `json:"accounts" doc:"Configured Matrix accounts without secrets."`
	ConfigPath   string                         `json:"configPath,omitempty" doc:"OpenClaw config path."`
	OpenClawHome string                         `json:"openClawHome,omitempty" doc:"OpenClaw home directory."`
	Version      string                         `json:"version,omitempty" doc:"Installed package version when readable."`
	Error        string                         `json:"error,omitempty" doc:"Config read error."`
}

type OpenClawMatrixConfigResponse struct {
	Enabled                bool                        `json:"enabled" doc:"Whether channels.matrix.enabled is true."`
	DefaultAccount         string                      `json:"defaultAccount,omitempty" doc:"Preferred Matrix account id."`
	DMPolicy               string                      `json:"dmPolicy" example:"pairing" doc:"Default DM policy."`
	DMEnabled              bool                        `json:"dmEnabled" doc:"Whether Matrix DM handling is enabled."`
	DMAllowFromCount       int                         `json:"dmAllowFromCount" doc:"Top-level DM allowFrom entry count."`
	GroupPolicy            string                      `json:"groupPolicy,omitempty" example:"allowlist" doc:"Room sender policy."`
	GroupAllowFromCount    int                         `json:"groupAllowFromCount" doc:"Top-level groupAllowFrom entry count."`
	GroupCount             int                         `json:"groupCount" doc:"Configured Matrix room/group override count."`
	AutoJoin               string                      `json:"autoJoin,omitempty" doc:"Invite auto-join policy."`
	AutoJoinAllowlistCount int                         `json:"autoJoinAllowlistCount" doc:"Auto-join allowlist count."`
	Streaming              string                      `json:"streaming,omitempty" doc:"Matrix streaming mode."`
	ReplyToMode            string                      `json:"replyToMode,omitempty" doc:"Matrix reply-to mode."`
	ThreadReplies          string                      `json:"threadReplies,omitempty" doc:"Matrix thread reply mode."`
	AllowPrivateNetwork    bool                        `json:"allowPrivateNetwork" doc:"Whether top-level private network opt-in is enabled."`
	Encryption             bool                        `json:"encryption" doc:"Whether top-level E2EE is enabled."`
	ExecApprovals          OpenClawMatrixExecApprovals `json:"execApprovals" doc:"Matrix exec approval settings."`
	Actions                OpenClawMatrixActionsConfig `json:"actions" doc:"Matrix action gate settings."`
}

type OpenClawMatrixAccountSummary struct {
	AccountID              string                      `json:"accountId" example:"default" doc:"Matrix account id."`
	Name                   string                      `json:"name,omitempty" doc:"Account display name."`
	Enabled                bool                        `json:"enabled" doc:"Whether this account is enabled."`
	Homeserver             string                      `json:"homeserver,omitempty" doc:"Matrix homeserver URL."`
	UserID                 string                      `json:"userId,omitempty" doc:"Matrix user id."`
	DeviceName             string                      `json:"deviceName,omitempty" doc:"Matrix device display name."`
	AuthConfigured         bool                        `json:"authConfigured" doc:"Whether credentials are available."`
	AuthSource             string                      `json:"authSource" doc:"Credential source without returning secrets."`
	AllowPrivateNetwork    bool                        `json:"allowPrivateNetwork" doc:"Whether private network opt-in is enabled."`
	Encryption             bool                        `json:"encryption" doc:"Whether E2EE is enabled for this account."`
	DMPolicy               string                      `json:"dmPolicy,omitempty" doc:"Account DM policy override or inherited policy."`
	DMEnabled              bool                        `json:"dmEnabled" doc:"Whether account DM handling is enabled."`
	DMAllowFrom            []string                    `json:"dmAllowFrom,omitempty" doc:"Effective DM allowlist."`
	DMAllowFromCount       int                         `json:"dmAllowFromCount" doc:"Effective DM allowlist count."`
	DMSessionScope         string                      `json:"dmSessionScope,omitempty" doc:"DM session scope."`
	DMThreadReplies        string                      `json:"dmThreadReplies,omitempty" doc:"DM thread reply override."`
	GroupPolicy            string                      `json:"groupPolicy,omitempty" doc:"Account room policy override or inherited policy."`
	GroupAllowFrom         []string                    `json:"groupAllowFrom,omitempty" doc:"Effective room sender allowlist."`
	GroupAllowFromCount    int                         `json:"groupAllowFromCount" doc:"Effective room sender allowlist count."`
	GroupCount             int                         `json:"groupCount" doc:"Configured Matrix room/group override count."`
	AutoJoin               string                      `json:"autoJoin,omitempty" doc:"Invite auto-join policy."`
	AutoJoinAllowlist      []string                    `json:"autoJoinAllowlist,omitempty" doc:"Auto-join room allowlist."`
	AutoJoinAllowlistCount int                         `json:"autoJoinAllowlistCount" doc:"Auto-join allowlist count."`
	ThreadReplies          string                      `json:"threadReplies,omitempty" doc:"Thread reply mode."`
	Streaming              string                      `json:"streaming,omitempty" doc:"Streaming mode."`
	AgentID                string                      `json:"agentId,omitempty" doc:"Agent routed to this account."`
	ExecApprovals          OpenClawMatrixExecApprovals `json:"execApprovals" doc:"Account exec approval settings."`
	Actions                OpenClawMatrixActionsConfig `json:"actions" doc:"Account action gate settings."`
}

type OpenClawMatrixConfigRequest struct {
	Actions       *OpenClawMatrixActionsConfigRequest       `json:"actions,omitempty" doc:"Matrix action gate settings."`
	DMPolicy      *string                                   `json:"dmPolicy,omitempty" enum:"pairing,allowlist,open,disabled" doc:"Default Matrix DM access policy."`
	Enabled       *bool                                     `json:"enabled,omitempty" doc:"Matrix channel enabled switch."`
	ExecApprovals *OpenClawMatrixExecApprovalsConfigRequest `json:"execApprovals,omitempty" doc:"Matrix exec approval settings."`
	GroupPolicy   *string                                   `json:"groupPolicy,omitempty" enum:"open,allowlist,disabled" doc:"Default Matrix room access policy."`
	Streaming     *OpenClawMatrixStreamingConfigRequest     `json:"streaming,omitempty" doc:"Matrix streaming settings."`
	ThreadReplies *string                                   `json:"threadReplies,omitempty" enum:"off,inbound,always" doc:"Default Matrix thread reply behavior."`
	ReplyToMode   *string                                   `json:"replyToMode,omitempty" enum:"off,first,all,batched" doc:"Default Matrix reply-to mode."`
}

type OpenClawMatrixAccountConfigRequest struct {
	AccessToken         *string                                   `json:"accessToken,omitempty" doc:"New Matrix access token. Empty string is ignored."`
	Actions             *OpenClawMatrixActionsConfigRequest       `json:"actions,omitempty" doc:"Account action gate settings."`
	AgentID             *string                                   `json:"agentId,omitempty" doc:"Agent id routed to this account. Empty string removes binding."`
	AllowPrivateNetwork *bool                                     `json:"allowPrivateNetwork,omitempty" doc:"Allow private/LAN homeserver targets."`
	AutoJoin            *string                                   `json:"autoJoin,omitempty" enum:"off,allowlist,always" doc:"Invite auto-join policy."`
	AutoJoinAllowlist   []string                                  `json:"autoJoinAllowlist,omitempty" doc:"Room ids or aliases accepted for autoJoin allowlist."`
	DeviceName          *string                                   `json:"deviceName,omitempty" doc:"Matrix device display name. Empty string clears it."`
	DMAllowFrom         []string                                  `json:"dmAllowFrom,omitempty" doc:"DM allowlist. Empty array clears account override."`
	DMEnabled           *bool                                     `json:"dmEnabled,omitempty" doc:"Whether DM handling is enabled for this account."`
	DMPolicy            *string                                   `json:"dmPolicy,omitempty" enum:"pairing,allowlist,open,disabled" doc:"Account DM policy."`
	DMSessionScope      *string                                   `json:"dmSessionScope,omitempty" enum:"per-user,per-room" doc:"DM session scope."`
	DMThreadReplies     *string                                   `json:"dmThreadReplies,omitempty" enum:"off,inbound,always" doc:"DM thread reply override."`
	Enabled             *bool                                     `json:"enabled,omitempty" doc:"Account enabled switch."`
	Encryption          *bool                                     `json:"encryption,omitempty" doc:"Enable Matrix E2EE for this account."`
	ExecApprovals       *OpenClawMatrixExecApprovalsConfigRequest `json:"execApprovals,omitempty" doc:"Account exec approval settings."`
	GroupAllowFrom      []string                                  `json:"groupAllowFrom,omitempty" doc:"Room sender allowlist. Empty array clears account override."`
	GroupPolicy         *string                                   `json:"groupPolicy,omitempty" enum:"open,allowlist,disabled" doc:"Account room policy."`
	Groups              []string                                  `json:"groups,omitempty" doc:"Matrix room ids or aliases to configure. Empty array clears account override."`
	Homeserver          *string                                   `json:"homeserver,omitempty" doc:"Matrix homeserver URL. Empty string clears it."`
	Name                *string                                   `json:"name,omitempty" doc:"Account display name. Empty string clears it."`
	Password            *string                                   `json:"password,omitempty" doc:"New Matrix password. Empty string is ignored."`
	Streaming           *string                                   `json:"streaming,omitempty" enum:"off,partial,quiet,progress" doc:"Streaming mode."`
	ThreadReplies       *string                                   `json:"threadReplies,omitempty" enum:"off,inbound,always" doc:"Thread reply mode."`
	UserID              *string                                   `json:"userId,omitempty" doc:"Matrix user id. Empty string clears it."`
}

type OpenClawMatrixExecApprovals struct {
	Enabled       string   `json:"enabled,omitempty" doc:"Exec approval enabled state: inherit, auto, true, or false."`
	Approvers     []string `json:"approvers,omitempty" doc:"Matrix user ids allowed to approve exec requests."`
	Target        string   `json:"target,omitempty" doc:"Exec approval delivery target: dm, channel, or both."`
	AgentFilter   []string `json:"agentFilter,omitempty" doc:"Optional agent filter."`
	SessionFilter []string `json:"sessionFilter,omitempty" doc:"Optional session filter."`
}

type OpenClawMatrixExecApprovalsConfigRequest struct {
	Enabled       *string  `json:"enabled,omitempty" doc:"Exec approval enabled state: inherit, auto, true, or false."`
	Approvers     []string `json:"approvers,omitempty" doc:"Matrix user ids allowed to approve exec requests."`
	Target        *string  `json:"target,omitempty" doc:"Exec approval delivery target: dm, channel, or both."`
	AgentFilter   []string `json:"agentFilter,omitempty" doc:"Optional agent filter."`
	SessionFilter []string `json:"sessionFilter,omitempty" doc:"Optional session filter."`
}

type OpenClawMatrixStreamingConfigRequest struct {
	Mode                 *string `json:"mode,omitempty" enum:"off,partial,quiet,progress" doc:"Streaming mode."`
	PreviewToolProgress  *bool   `json:"previewToolProgress,omitempty" doc:"Whether preview streaming includes tool progress."`
	ProgressToolProgress *bool   `json:"progressToolProgress,omitempty" doc:"Whether progress mode includes tool progress."`
}

type OpenClawMatrixActionsConfig struct {
	Messages     *bool `json:"messages,omitempty" doc:"Whether message send/edit actions are enabled."`
	Reactions    *bool `json:"reactions,omitempty" doc:"Whether reaction actions are enabled."`
	Pins         *bool `json:"pins,omitempty" doc:"Whether pin actions are enabled."`
	Profile      *bool `json:"profile,omitempty" doc:"Whether profile actions are enabled."`
	MemberInfo   *bool `json:"memberInfo,omitempty" doc:"Whether member info actions are enabled."`
	ChannelInfo  *bool `json:"channelInfo,omitempty" doc:"Whether room info actions are enabled."`
	Verification *bool `json:"verification,omitempty" doc:"Whether verification actions are enabled."`
}

type OpenClawMatrixActionsConfigRequest struct {
	Messages     *bool `json:"messages,omitempty" doc:"Whether message send/edit actions are enabled."`
	Reactions    *bool `json:"reactions,omitempty" doc:"Whether reaction actions are enabled."`
	Pins         *bool `json:"pins,omitempty" doc:"Whether pin actions are enabled."`
	Profile      *bool `json:"profile,omitempty" doc:"Whether profile actions are enabled."`
	MemberInfo   *bool `json:"memberInfo,omitempty" doc:"Whether member info actions are enabled."`
	ChannelInfo  *bool `json:"channelInfo,omitempty" doc:"Whether room info actions are enabled."`
	Verification *bool `json:"verification,omitempty" doc:"Whether verification actions are enabled."`
}

type OpenClawMatrixAccountDeleteResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-14T09:00:00Z" doc:"UTC response timestamp."`
	AccountID string `json:"accountId" doc:"Deleted Matrix account id."`
}

func GetOpenClawMatrixStatus(ctx context.Context, input *struct{}) (*OpenClawMatrixStatusOutput, error) {
	_ = ctx
	return &OpenClawMatrixStatusOutput{Body: detectOpenClawMatrixStatus()}, nil
}

func UpdateOpenClawMatrixConfig(ctx context.Context, input *OpenClawMatrixConfigInput) (*OpenClawMatrixConfigOutput, error) {
	_ = ctx
	if input == nil {
		return nil, huma.Error400BadRequest("matrix config request is required", nil)
	}
	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			content = map[string]any{}
		} else {
			return nil, huma.Error500InternalServerError("read openclaw config failed", err)
		}
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawMatrixChannelID])
	if input.Body.Enabled != nil {
		section["enabled"] = *input.Body.Enabled
	}
	if input.Body.DMPolicy != nil {
		dmPolicy := strings.TrimSpace(*input.Body.DMPolicy)
		if !allowedOpenClawMatrixDMPolicy(dmPolicy) {
			return nil, huma.Error400BadRequest("unsupported matrix dmPolicy", nil)
		}
		dm := objectMap(section["dm"])
		dm["policy"] = dmPolicy
		section["dm"] = dm
	}
	if input.Body.GroupPolicy != nil {
		groupPolicy := strings.TrimSpace(*input.Body.GroupPolicy)
		if groupPolicy == "" {
			delete(section, "groupPolicy")
		} else {
			if !allowedOpenClawMatrixGroupPolicy(groupPolicy) {
				return nil, huma.Error400BadRequest("unsupported matrix groupPolicy", nil)
			}
			section["groupPolicy"] = groupPolicy
		}
	}
	if input.Body.ThreadReplies != nil {
		if err := setOpenClawMatrixChoice(section, "threadReplies", *input.Body.ThreadReplies, allowedOpenClawMatrixThreadReplies); err != nil {
			return nil, err
		}
	}
	if input.Body.ReplyToMode != nil {
		if err := setOpenClawMatrixChoice(section, "replyToMode", *input.Body.ReplyToMode, allowedOpenClawMatrixReplyToMode); err != nil {
			return nil, err
		}
	}
	if input.Body.Streaming != nil {
		if err := patchOpenClawMatrixStreaming(section, input.Body.Streaming); err != nil {
			return nil, err
		}
	}
	if input.Body.ExecApprovals != nil {
		patchOpenClawMatrixExecApprovals(section, input.Body.ExecApprovals)
	}
	if input.Body.Actions != nil {
		patchOpenClawMatrixActions(section, input.Body.Actions)
	}
	channels[openClawMatrixChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return nil, huma.Error500InternalServerError("write openclaw config failed", err)
	}
	invalidateOpenClawEnvironmentCache()
	return &OpenClawMatrixConfigOutput{Body: detectOpenClawMatrixStatus()}, nil
}

func UpdateOpenClawMatrixAccountConfig(ctx context.Context, input *OpenClawMatrixAccountConfigInput) (*OpenClawMatrixAccountConfigOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("account id is required", nil)
	}
	if err := patchOpenClawMatrixAccount(strings.TrimSpace(input.AccountID), input.Body); err != nil {
		return nil, huma.Error500InternalServerError("update matrix account config failed", err)
	}
	return &OpenClawMatrixAccountConfigOutput{Body: detectOpenClawMatrixStatus()}, nil
}

func DeleteOpenClawMatrixAccount(ctx context.Context, input *OpenClawMatrixAccountDeleteInput) (*OpenClawMatrixAccountDeleteOutput, error) {
	_ = ctx
	if input == nil || strings.TrimSpace(input.AccountID) == "" {
		return nil, huma.Error400BadRequest("account id is required", nil)
	}
	accountID := strings.TrimSpace(input.AccountID)
	if err := removeOpenClawMatrixAccount(accountID); err != nil {
		return nil, huma.Error500InternalServerError("delete matrix account failed", err)
	}
	if err := setOpenClawChannelAccountBinding(openClawMatrixChannelID, accountID, ""); err != nil {
		return nil, huma.Error500InternalServerError("update matrix account binding failed", err)
	}
	return &OpenClawMatrixAccountDeleteOutput{Body: OpenClawMatrixAccountDeleteResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AccountID: accountID,
	}}, nil
}

func AddOpenClawMatrixAccountStream(ctx context.Context, input *OpenClawMatrixAddStreamInput, send sse.Sender) {
	if input == nil {
		streamOpenClawChannelError(send, "matrix-add", "add", fmt.Errorf("matrix account request is required"))
		return
	}
	accountID := strings.TrimSpace(input.AccountID)
	if accountID == "" {
		accountID = "default"
	}
	homeserver := strings.TrimSpace(input.Homeserver)
	accessToken := strings.TrimSpace(input.AccessToken)
	userID := strings.TrimSpace(input.UserID)
	password := strings.TrimSpace(input.Password)
	if homeserver == "" {
		streamOpenClawChannelError(send, "matrix-add", "add", fmt.Errorf("Homeserver 不能为空"))
		return
	}
	if accessToken == "" && password == "" {
		streamOpenClawChannelError(send, "matrix-add", "add", fmt.Errorf("Matrix 需要 accessToken 或 password"))
		return
	}
	if accessToken == "" && userID == "" {
		streamOpenClawChannelError(send, "matrix-add", "add", fmt.Errorf("密码登录需要填写 Matrix userId"))
		return
	}
	dmPolicy := firstNonEmptyTelegramString(strings.TrimSpace(input.DMPolicy), "pairing")
	if !allowedOpenClawMatrixDMPolicy(dmPolicy) {
		streamOpenClawChannelError(send, "matrix-add", "add", fmt.Errorf("unsupported dmPolicy %q", dmPolicy))
		return
	}
	groupPolicy := strings.TrimSpace(input.GroupPolicy)
	if groupPolicy != "" && !allowedOpenClawMatrixGroupPolicy(groupPolicy) {
		streamOpenClawChannelError(send, "matrix-add", "add", fmt.Errorf("unsupported groupPolicy %q", groupPolicy))
		return
	}
	autoJoin := strings.TrimSpace(input.AutoJoin)
	if autoJoin != "" && !allowedOpenClawMatrixAutoJoin(autoJoin) {
		streamOpenClawChannelError(send, "matrix-add", "add", fmt.Errorf("unsupported autoJoin %q", autoJoin))
		return
	}
	if dmPolicy == "allowlist" && len(splitOpenClawMatrixList(input.DMAllowFrom)) == 0 {
		streamOpenClawChannelError(send, "matrix-add", "add", fmt.Errorf("allowlist 策略需要至少一个 Matrix 用户 ID"))
		return
	}
	args := []string{"matrix", "account", "add", "--account", accountID, "--homeserver", homeserver}
	if name := strings.TrimSpace(input.Name); name != "" {
		args = append(args, "--name", name)
	}
	if accessToken != "" {
		args = append(args, "--access-token", accessToken)
	} else {
		args = append(args, "--user-id", userID, "--password", password)
	}
	if deviceName := strings.TrimSpace(input.DeviceName); deviceName != "" {
		args = append(args, "--device-name", deviceName)
	}
	if limit := strings.TrimSpace(input.InitialSyncLimit); limit != "" {
		if _, err := strconv.Atoi(limit); err != nil {
			streamOpenClawChannelError(send, "matrix-add", "add", fmt.Errorf("initialSyncLimit 必须是数字"))
			return
		}
		args = append(args, "--initial-sync-limit", limit)
	}
	if input.AllowPrivateNetwork {
		args = append(args, "--allow-private-network")
	}
	if input.Encryption {
		args = append(args, "--enable-e2ee")
	}
	streamOpenClawChannelSteps(ctx, send, "matrix-add", "add", []openClawChannelStep{
		{label: "检查 OpenClaw CLI", progress: 5, timeout: 10 * time.Second, args: []string{"--version"}},
		{label: "添加 Matrix 账号", progress: 25, timeout: 8 * time.Minute, args: args},
		{label: "写入 Matrix 访问策略", progress: 74, run: func(ctx context.Context, task openClawChannelLogger) error {
			_ = ctx
			if err := configureOpenClawMatrixAccount(accountID, OpenClawMatrixAddConfig{
				AgentID:             input.AgentID,
				AutoJoin:            autoJoin,
				AutoJoinAllowlist:   input.AutoJoinAllowlist,
				DMAllowFrom:         input.DMAllowFrom,
				DMPolicy:            dmPolicy,
				GroupAllowFrom:      input.GroupAllowFrom,
				GroupPolicy:         groupPolicy,
				AllowPrivateNetwork: input.AllowPrivateNetwork,
				Encryption:          input.Encryption,
			}); err != nil {
				return err
			}
			task.addLog("已写入 Matrix 账号策略。")
			return nil
		}},
		{label: "重启 Gateway 应用 Matrix 配置", progress: 92, timeout: 60 * time.Second, args: []string{"gateway", "restart"}},
	})
}

type OpenClawMatrixAddConfig struct {
	AgentID             string
	AutoJoin            string
	AutoJoinAllowlist   string
	DMAllowFrom         string
	DMPolicy            string
	GroupAllowFrom      string
	GroupPolicy         string
	AllowPrivateNetwork bool
	Encryption          bool
}

func detectOpenClawMatrixStatus() OpenClawMatrixStatusResponse {
	home := defaultOpenClawHomeDir()
	configPath := openClawConfigPath()
	content, exists, configErr := readOpenClawConfigFile(configPath)
	section := objectMap(objectMap(content["channels"])[openClawMatrixChannelID])
	configured := openClawMatrixConfigured(home, section)
	version := ""
	installed := configured
	for _, pkgPath := range openClawMatrixPackagePaths(home) {
		pkgVersion, ok := readPackageVersion(pkgPath)
		if ok {
			installed = true
			if version == "" {
				version = pkgVersion
			}
		}
	}
	enabled := configured && !hasExplicitFalse(section, "enabled")
	response := OpenClawMatrixStatusResponse{
		Status:     "ok",
		ChannelID:  openClawMatrixChannelID,
		Package:    openClawMatrixPackage,
		Installed:  installed,
		Configured: configured,
		Enabled:    enabled,
		Config:     openClawMatrixConfigFromSection(section),
		Accounts:   []OpenClawMatrixAccountSummary{},
		Version:    version,
	}
	if exists || configured || installed {
		response.ConfigPath = configPath
		response.OpenClawHome = home
	}
	if configErr != nil && !errors.Is(configErr, os.ErrNotExist) {
		response.Status = "error"
		response.Error = configErr.Error()
	}
	if configured {
		response.Accounts = readOpenClawMatrixAccounts(home, section, readOpenClawChannelAccountBindings(content, openClawMatrixChannelID))
	}
	return response
}

func openClawMatrixConfigFromSection(section map[string]any) OpenClawMatrixConfigResponse {
	dm := objectMap(section["dm"])
	return OpenClawMatrixConfigResponse{
		Enabled:                !hasExplicitFalse(section, "enabled"),
		DefaultAccount:         stringFromMap(section, "defaultAccount"),
		DMPolicy:               firstNonEmptyTelegramString(stringFromMap(dm, "policy"), "pairing"),
		DMEnabled:              !hasExplicitFalse(dm, "enabled"),
		DMAllowFromCount:       len(stringSliceFromValue(dm["allowFrom"])),
		GroupPolicy:            firstNonEmptyTelegramString(stringFromMap(section, "groupPolicy"), "allowlist"),
		GroupAllowFromCount:    len(stringSliceFromValue(section["groupAllowFrom"])),
		GroupCount:             len(firstNonEmptyOpenClawMatrixObjectMap(objectMap(section["groups"]), objectMap(section["rooms"]))),
		AutoJoin:               firstNonEmptyTelegramString(stringFromMap(section, "autoJoin"), "off"),
		AutoJoinAllowlistCount: len(stringSliceFromValue(section["autoJoinAllowlist"])),
		Streaming:              openClawMatrixStreamingMode(section),
		ReplyToMode:            stringFromMap(section, "replyToMode"),
		ThreadReplies:          stringFromMap(section, "threadReplies"),
		AllowPrivateNetwork:    openClawMatrixAllowPrivateNetwork(section),
		Encryption:             boolFromMap(section, "encryption"),
		ExecApprovals:          openClawMatrixExecApprovalsFromValue(section["execApprovals"]),
		Actions:                openClawMatrixActionsFromValue(section["actions"]),
	}
}

func readOpenClawMatrixAccounts(home string, section map[string]any, bindings map[string]string) []OpenClawMatrixAccountSummary {
	accountsCfg := objectMap(section["accounts"])
	ids := make([]string, 0, len(accountsCfg)+1)
	if openClawMatrixTopLevelConfigured(home, section) || len(accountsCfg) == 0 {
		ids = append(ids, "default")
	}
	for id := range accountsCfg {
		if strings.TrimSpace(id) != "" {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	seen := map[string]bool{}
	accounts := make([]OpenClawMatrixAccountSummary, 0, len(ids))
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		cfg := objectMap(accountsCfg[id])
		if id == "default" && !openClawMatrixAccountConfigured(home, id, cfg) {
			cfg = mergeOpenClawMatrixDefaultAccount(section, cfg)
		}
		if !openClawMatrixAccountConfigured(home, id, cfg) && id != "default" {
			continue
		}
		accounts = append(accounts, openClawMatrixAccountFromConfig(home, id, cfg, section, bindings[id]))
	}
	return accounts
}

func openClawMatrixAccountFromConfig(home string, accountID string, cfg map[string]any, parent map[string]any, agentID string) OpenClawMatrixAccountSummary {
	authConfigured, authSource := openClawMatrixAuthSource(home, accountID, cfg, parent)
	dm := objectMap(firstNonNilOpenClawMatrixValue(cfg["dm"], parent["dm"]))
	groupMap := firstNonEmptyOpenClawMatrixObjectMap(objectMap(cfg["groups"]), objectMap(cfg["rooms"]), objectMap(parent["groups"]), objectMap(parent["rooms"]))
	dmAllowFrom := firstNonEmptyStringSlice(stringSliceFromValue(dm["allowFrom"]), stringSliceFromValue(objectMap(parent["dm"])["allowFrom"]))
	groupAllowFrom := firstNonEmptyStringSlice(stringSliceFromValue(cfg["groupAllowFrom"]), stringSliceFromValue(parent["groupAllowFrom"]))
	autoJoinAllowlist := firstNonEmptyStringSlice(stringSliceFromValue(cfg["autoJoinAllowlist"]), stringSliceFromValue(parent["autoJoinAllowlist"]))
	return OpenClawMatrixAccountSummary{
		AccountID:              accountID,
		Name:                   stringFromMap(cfg, "name"),
		Enabled:                !hasExplicitFalse(cfg, "enabled") && !hasExplicitFalse(parent, "enabled"),
		Homeserver:             firstNonEmptyTelegramString(stringFromMap(cfg, "homeserver"), stringFromMap(parent, "homeserver")),
		UserID:                 firstNonEmptyTelegramString(stringFromMap(cfg, "userId"), stringFromMap(parent, "userId")),
		DeviceName:             firstNonEmptyTelegramString(stringFromMap(cfg, "deviceName"), stringFromMap(parent, "deviceName")),
		AuthConfigured:         authConfigured,
		AuthSource:             authSource,
		AllowPrivateNetwork:    openClawMatrixAllowPrivateNetwork(cfg) || openClawMatrixAllowPrivateNetwork(parent),
		Encryption:             boolFromMap(cfg, "encryption") || boolFromMap(parent, "encryption"),
		DMPolicy:               firstNonEmptyTelegramString(stringFromMap(dm, "policy"), "pairing"),
		DMEnabled:              !hasExplicitFalse(dm, "enabled"),
		DMAllowFrom:            dmAllowFrom,
		DMAllowFromCount:       len(dmAllowFrom),
		DMSessionScope:         stringFromMap(dm, "sessionScope"),
		DMThreadReplies:        stringFromMap(dm, "threadReplies"),
		GroupPolicy:            firstNonEmptyTelegramString(stringFromMap(cfg, "groupPolicy"), stringFromMap(parent, "groupPolicy"), "allowlist"),
		GroupAllowFrom:         groupAllowFrom,
		GroupAllowFromCount:    len(groupAllowFrom),
		GroupCount:             len(groupMap),
		AutoJoin:               firstNonEmptyTelegramString(stringFromMap(cfg, "autoJoin"), stringFromMap(parent, "autoJoin"), "off"),
		AutoJoinAllowlist:      autoJoinAllowlist,
		AutoJoinAllowlistCount: len(autoJoinAllowlist),
		ThreadReplies:          firstNonEmptyTelegramString(stringFromMap(cfg, "threadReplies"), stringFromMap(parent, "threadReplies")),
		Streaming:              firstNonEmptyTelegramString(openClawMatrixStreamingMode(cfg), openClawMatrixStreamingMode(parent)),
		AgentID:                strings.TrimSpace(agentID),
		ExecApprovals:          openClawMatrixExecApprovalsFromValue(firstNonNilOpenClawMatrixValue(cfg["execApprovals"], parent["execApprovals"])),
		Actions:                openClawMatrixActionsFromValue(firstNonNilOpenClawMatrixValue(cfg["actions"], parent["actions"])),
	}
}

func configureOpenClawMatrixAccount(accountID string, patch OpenClawMatrixAddConfig) error {
	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			content = map[string]any{}
		} else {
			return err
		}
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawMatrixChannelID])
	section["enabled"] = true
	accountCfg, save := openClawMatrixEditableAccount(section, accountID)
	accountCfg["enabled"] = true
	if patch.DMPolicy != "" || patch.DMAllowFrom != "" {
		dm := objectMap(accountCfg["dm"])
		if patch.DMPolicy != "" {
			dm["policy"] = patch.DMPolicy
		}
		setOpenClawMatrixStringSliceField(dm, "allowFrom", splitOpenClawMatrixList(patch.DMAllowFrom))
		accountCfg["dm"] = dm
	}
	if patch.GroupPolicy != "" {
		accountCfg["groupPolicy"] = patch.GroupPolicy
	}
	setOpenClawMatrixStringSliceField(accountCfg, "groupAllowFrom", splitOpenClawMatrixList(patch.GroupAllowFrom))
	if patch.AutoJoin != "" {
		accountCfg["autoJoin"] = patch.AutoJoin
	}
	setOpenClawMatrixStringSliceField(accountCfg, "autoJoinAllowlist", splitOpenClawMatrixList(patch.AutoJoinAllowlist))
	if patch.AllowPrivateNetwork {
		network := objectMap(accountCfg["network"])
		network["dangerouslyAllowPrivateNetwork"] = true
		accountCfg["network"] = network
	}
	if patch.Encryption {
		accountCfg["encryption"] = true
	}
	save(accountCfg)
	channels[openClawMatrixChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return err
	}
	if strings.TrimSpace(patch.AgentID) != "" {
		return setOpenClawChannelAccountBinding(openClawMatrixChannelID, accountID, strings.TrimSpace(patch.AgentID))
	}
	return nil
}

func patchOpenClawMatrixAccount(accountID string, patch OpenClawMatrixAccountConfigRequest) error {
	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		return err
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawMatrixChannelID])
	accountCfg, save := openClawMatrixEditableAccount(section, accountID)
	if patch.Enabled != nil {
		accountCfg["enabled"] = *patch.Enabled
	}
	if patch.Name != nil {
		setOpenClawMatrixStringField(accountCfg, "name", *patch.Name)
	}
	if patch.Homeserver != nil {
		setOpenClawMatrixStringField(accountCfg, "homeserver", *patch.Homeserver)
	}
	if patch.UserID != nil {
		setOpenClawMatrixStringField(accountCfg, "userId", *patch.UserID)
	}
	if patch.AccessToken != nil {
		if accessToken := strings.TrimSpace(*patch.AccessToken); accessToken != "" {
			accountCfg["accessToken"] = accessToken
			delete(accountCfg, "password")
		}
	}
	if patch.Password != nil {
		if password := strings.TrimSpace(*patch.Password); password != "" {
			accountCfg["password"] = password
			delete(accountCfg, "accessToken")
		}
	}
	if patch.DeviceName != nil {
		setOpenClawMatrixStringField(accountCfg, "deviceName", *patch.DeviceName)
	}
	if patch.AllowPrivateNetwork != nil {
		network := objectMap(accountCfg["network"])
		if *patch.AllowPrivateNetwork {
			network["dangerouslyAllowPrivateNetwork"] = true
		} else {
			delete(network, "dangerouslyAllowPrivateNetwork")
		}
		setOpenClawMatrixObjectField(accountCfg, "network", network)
	}
	if patch.Encryption != nil {
		accountCfg["encryption"] = *patch.Encryption
	}
	if patch.DMPolicy != nil || patch.DMEnabled != nil || patch.DMAllowFrom != nil || patch.DMSessionScope != nil || patch.DMThreadReplies != nil {
		dm := objectMap(accountCfg["dm"])
		if patch.DMPolicy != nil {
			dmPolicy := strings.TrimSpace(*patch.DMPolicy)
			if !allowedOpenClawMatrixDMPolicy(dmPolicy) {
				return huma.Error400BadRequest("unsupported matrix dmPolicy", nil)
			}
			dm["policy"] = dmPolicy
		}
		if patch.DMEnabled != nil {
			dm["enabled"] = *patch.DMEnabled
		}
		if patch.DMAllowFrom != nil {
			setOpenClawMatrixStringSliceField(dm, "allowFrom", patch.DMAllowFrom)
		}
		if patch.DMSessionScope != nil {
			if err := setOpenClawMatrixChoice(dm, "sessionScope", *patch.DMSessionScope, allowedOpenClawMatrixDMSessionScope); err != nil {
				return err
			}
		}
		if patch.DMThreadReplies != nil {
			if err := setOpenClawMatrixChoice(dm, "threadReplies", *patch.DMThreadReplies, allowedOpenClawMatrixThreadReplies); err != nil {
				return err
			}
		}
		setOpenClawMatrixObjectField(accountCfg, "dm", dm)
	}
	if patch.GroupPolicy != nil {
		groupPolicy := strings.TrimSpace(*patch.GroupPolicy)
		if groupPolicy == "" {
			delete(accountCfg, "groupPolicy")
		} else {
			if !allowedOpenClawMatrixGroupPolicy(groupPolicy) {
				return huma.Error400BadRequest("unsupported matrix groupPolicy", nil)
			}
			accountCfg["groupPolicy"] = groupPolicy
		}
	}
	if patch.GroupAllowFrom != nil {
		setOpenClawMatrixStringSliceField(accountCfg, "groupAllowFrom", patch.GroupAllowFrom)
	}
	if patch.AutoJoin != nil {
		autoJoin := strings.TrimSpace(*patch.AutoJoin)
		if autoJoin == "" {
			delete(accountCfg, "autoJoin")
		} else {
			if !allowedOpenClawMatrixAutoJoin(autoJoin) {
				return huma.Error400BadRequest("unsupported matrix autoJoin", nil)
			}
			accountCfg["autoJoin"] = autoJoin
		}
	}
	if patch.AutoJoinAllowlist != nil {
		setOpenClawMatrixStringSliceField(accountCfg, "autoJoinAllowlist", patch.AutoJoinAllowlist)
	}
	if patch.Groups != nil {
		groups := map[string]any{}
		for _, group := range dedupeOpenClawMatrixStrings(patch.Groups) {
			groups[group] = map[string]any{}
		}
		setOpenClawMatrixObjectField(accountCfg, "groups", groups)
	}
	if patch.ThreadReplies != nil {
		if err := setOpenClawMatrixChoice(accountCfg, "threadReplies", *patch.ThreadReplies, allowedOpenClawMatrixThreadReplies); err != nil {
			return err
		}
	}
	if patch.Streaming != nil {
		if err := setOpenClawMatrixChoice(accountCfg, "streaming", *patch.Streaming, allowedOpenClawMatrixStreaming); err != nil {
			return err
		}
	}
	if patch.ExecApprovals != nil {
		patchOpenClawMatrixExecApprovals(accountCfg, patch.ExecApprovals)
	}
	if patch.Actions != nil {
		patchOpenClawMatrixActions(accountCfg, patch.Actions)
	}
	save(accountCfg)
	channels[openClawMatrixChannelID] = section
	content["channels"] = channels
	if err := writeOpenClawConfigContent(configPath, content); err != nil {
		return err
	}
	if patch.AgentID != nil {
		return setOpenClawChannelAccountBinding(openClawMatrixChannelID, accountID, strings.TrimSpace(*patch.AgentID))
	}
	return nil
}

func removeOpenClawMatrixAccount(accountID string) error {
	configPath := openClawConfigPath()
	content, _, err := readOpenClawConfigFile(configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	channels := objectMap(content["channels"])
	section := objectMap(channels[openClawMatrixChannelID])
	accounts := objectMap(section["accounts"])
	if _, ok := accounts[accountID]; ok {
		delete(accounts, accountID)
		if len(accounts) == 0 {
			delete(section, "accounts")
		} else {
			section["accounts"] = accounts
		}
	}
	if accountID == "default" {
		for _, key := range []string{"homeserver", "accessToken", "password", "userId", "deviceId", "deviceName"} {
			delete(section, key)
		}
	}
	if !openClawMatrixConfigured(defaultOpenClawHomeDir(), section) {
		delete(channels, openClawMatrixChannelID)
	} else {
		channels[openClawMatrixChannelID] = section
	}
	content["channels"] = channels
	return writeOpenClawConfigContent(configPath, content)
}

func openClawMatrixEditableAccount(section map[string]any, accountID string) (map[string]any, func(map[string]any)) {
	accountID = strings.TrimSpace(accountID)
	if accountID == "" {
		accountID = "default"
	}
	accounts := objectMap(section["accounts"])
	if accountID == "default" && len(accounts) == 0 {
		cfg := objectMap(section)
		return cfg, func(next map[string]any) {
			for key := range section {
				delete(section, key)
			}
			for key, value := range next {
				if key != "accounts" {
					section[key] = value
				}
			}
		}
	}
	cfg := objectMap(accounts[accountID])
	return cfg, func(next map[string]any) {
		accounts[accountID] = next
		section["accounts"] = accounts
	}
}

func openClawMatrixConfigured(home string, section map[string]any) bool {
	if openClawMatrixTopLevelConfigured(home, section) {
		return true
	}
	for id, value := range objectMap(section["accounts"]) {
		if openClawMatrixAccountConfigured(home, id, objectMap(value)) {
			return true
		}
	}
	return false
}

func openClawMatrixTopLevelConfigured(home string, section map[string]any) bool {
	return openClawMatrixAuthComplete(section) || openClawMatrixEnvConfigured("default") || openClawMatrixCredentialsCached(home, "default")
}

func openClawMatrixAccountConfigured(home string, accountID string, cfg map[string]any) bool {
	return openClawMatrixAuthComplete(cfg) || openClawMatrixEnvConfigured(accountID) || openClawMatrixCredentialsCached(home, accountID)
}

func openClawMatrixAuthComplete(cfg map[string]any) bool {
	homeserver := stringFromMap(cfg, "homeserver")
	if homeserver == "" {
		return false
	}
	if stringFromMap(cfg, "accessToken") != "" {
		return true
	}
	return stringFromMap(cfg, "userId") != "" && stringFromMap(cfg, "password") != ""
}

func openClawMatrixEnvConfigured(accountID string) bool {
	prefix := openClawMatrixEnvPrefix(accountID)
	homeserver := strings.TrimSpace(os.Getenv(prefix + "HOMESERVER"))
	token := strings.TrimSpace(os.Getenv(prefix + "ACCESS_TOKEN"))
	userID := strings.TrimSpace(os.Getenv(prefix + "USER_ID"))
	password := strings.TrimSpace(os.Getenv(prefix + "PASSWORD"))
	return homeserver != "" && (token != "" || (userID != "" && password != ""))
}

func openClawMatrixAuthSource(home string, accountID string, cfg map[string]any, parent map[string]any) (bool, string) {
	merged := mergeOpenClawMatrixDefaultAccount(parent, cfg)
	if openClawMatrixAuthComplete(merged) {
		if stringFromMap(merged, "accessToken") != "" {
			return true, "accessToken"
		}
		return true, "password"
	}
	if openClawMatrixCredentialsCached(home, accountID) {
		return true, "cached"
	}
	if openClawMatrixEnvConfigured(accountID) {
		return true, "env"
	}
	return false, "missing"
}

func openClawMatrixCredentialsCached(home string, accountID string) bool {
	_, err := os.Stat(openClawMatrixCredentialPath(home, accountID))
	return err == nil
}

func openClawMatrixCredentialPath(home string, accountID string) string {
	if strings.TrimSpace(accountID) == "" || accountID == "default" {
		return filepath.Join(home, "credentials", "matrix", "credentials.json")
	}
	return filepath.Join(home, "credentials", "matrix", "credentials-"+accountID+".json")
}

func openClawMatrixEnvPrefix(accountID string) string {
	if strings.TrimSpace(accountID) == "" || accountID == "default" {
		return "MATRIX_"
	}
	return "MATRIX_" + openClawMatrixEnvAccountSegment(accountID) + "_"
}

func openClawMatrixEnvAccountSegment(accountID string) string {
	var builder strings.Builder
	for _, r := range strings.ToUpper(strings.TrimSpace(accountID)) {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' {
			builder.WriteRune(r)
			continue
		}
		builder.WriteString(fmt.Sprintf("_X%X_", r))
	}
	return builder.String()
}

func mergeOpenClawMatrixDefaultAccount(parent map[string]any, cfg map[string]any) map[string]any {
	merged := map[string]any{}
	for key, value := range parent {
		switch key {
		case "accounts", "defaultAccount":
			continue
		default:
			merged[key] = value
		}
	}
	for key, value := range cfg {
		merged[key] = value
	}
	return merged
}

func openClawMatrixPackagePaths(home string) []string {
	paths := []string{
		filepath.Join(home, "extensions", openClawMatrixChannelID, "package.json"),
		filepath.Join(home, "node_modules", "@openclaw", "matrix", "package.json"),
		filepath.Join(home, "npm", "node_modules", "@openclaw", "matrix", "package.json"),
	}
	if installPath := openClawPluginInstallRecordPath(home, openClawMatrixChannelID); installPath != "" {
		paths = append(paths, filepath.Join(installPath, "package.json"))
	}
	return paths
}

func openClawMatrixAllowPrivateNetwork(cfg map[string]any) bool {
	return boolFromMap(objectMap(cfg["network"]), "dangerouslyAllowPrivateNetwork")
}

func openClawMatrixExecApprovalsFromValue(value any) OpenClawMatrixExecApprovals {
	cfg := objectMap(value)
	return OpenClawMatrixExecApprovals{
		Enabled:       stringFromBoolLike(cfg["enabled"]),
		Approvers:     stringSliceFromValue(cfg["approvers"]),
		Target:        stringFromMap(cfg, "target"),
		AgentFilter:   stringSliceFromValue(cfg["agentFilter"]),
		SessionFilter: stringSliceFromValue(cfg["sessionFilter"]),
	}
}

func openClawMatrixActionsFromValue(value any) OpenClawMatrixActionsConfig {
	cfg := objectMap(value)
	return OpenClawMatrixActionsConfig{
		Messages:     boolPointerFromMap(cfg, "messages"),
		Reactions:    boolPointerFromMap(cfg, "reactions"),
		Pins:         boolPointerFromMap(cfg, "pins"),
		Profile:      boolPointerFromMap(cfg, "profile"),
		MemberInfo:   boolPointerFromMap(cfg, "memberInfo"),
		ChannelInfo:  boolPointerFromMap(cfg, "channelInfo"),
		Verification: boolPointerFromMap(cfg, "verification"),
	}
}

func patchOpenClawMatrixExecApprovals(target map[string]any, patch *OpenClawMatrixExecApprovalsConfigRequest) {
	cfg := objectMap(target["execApprovals"])
	if patch.Enabled != nil {
		setOpenClawTelegramChoiceField(cfg, "enabled", *patch.Enabled)
	}
	if patch.Approvers != nil {
		setOpenClawMatrixStringSliceField(cfg, "approvers", patch.Approvers)
	}
	if patch.Target != nil {
		setOpenClawMatrixStringField(cfg, "target", *patch.Target)
	}
	if patch.AgentFilter != nil {
		setOpenClawMatrixStringSliceField(cfg, "agentFilter", patch.AgentFilter)
	}
	if patch.SessionFilter != nil {
		setOpenClawMatrixStringSliceField(cfg, "sessionFilter", patch.SessionFilter)
	}
	setOpenClawMatrixObjectField(target, "execApprovals", cfg)
}

func patchOpenClawMatrixActions(target map[string]any, patch *OpenClawMatrixActionsConfigRequest) {
	cfg := objectMap(target["actions"])
	setOpenClawTelegramBoolPointerField(cfg, "messages", patch.Messages)
	setOpenClawTelegramBoolPointerField(cfg, "reactions", patch.Reactions)
	setOpenClawTelegramBoolPointerField(cfg, "pins", patch.Pins)
	setOpenClawTelegramBoolPointerField(cfg, "profile", patch.Profile)
	setOpenClawTelegramBoolPointerField(cfg, "memberInfo", patch.MemberInfo)
	setOpenClawTelegramBoolPointerField(cfg, "channelInfo", patch.ChannelInfo)
	setOpenClawTelegramBoolPointerField(cfg, "verification", patch.Verification)
	setOpenClawMatrixObjectField(target, "actions", cfg)
}

func patchOpenClawMatrixStreaming(target map[string]any, patch *OpenClawMatrixStreamingConfigRequest) error {
	cfg := objectMap(target["streaming"])
	if patch.Mode != nil {
		if err := setOpenClawMatrixChoice(cfg, "mode", *patch.Mode, allowedOpenClawMatrixStreaming); err != nil {
			return err
		}
	}
	if patch.PreviewToolProgress != nil {
		preview := objectMap(cfg["preview"])
		preview["toolProgress"] = *patch.PreviewToolProgress
		setOpenClawMatrixObjectField(cfg, "preview", preview)
	}
	if patch.ProgressToolProgress != nil {
		progress := objectMap(cfg["progress"])
		progress["toolProgress"] = *patch.ProgressToolProgress
		setOpenClawMatrixObjectField(cfg, "progress", progress)
	}
	setOpenClawMatrixObjectField(target, "streaming", cfg)
	return nil
}

func openClawMatrixStreamingMode(section map[string]any) string {
	if mode := stringFromBoolLike(section["streaming"]); mode != "" {
		switch mode {
		case "true":
			return "partial"
		case "false":
			return "off"
		default:
			return mode
		}
	}
	return stringFromMap(objectMap(section["streaming"]), "mode")
}

func setOpenClawMatrixStringField(target map[string]any, key string, value string) {
	if strings.TrimSpace(value) == "" {
		delete(target, key)
		return
	}
	target[key] = strings.TrimSpace(value)
}

func setOpenClawMatrixStringSliceField(target map[string]any, key string, values []string) {
	clean := dedupeOpenClawMatrixStrings(values)
	if len(clean) == 0 {
		delete(target, key)
		return
	}
	target[key] = clean
}

func setOpenClawMatrixObjectField(target map[string]any, key string, value map[string]any) {
	if len(value) == 0 {
		delete(target, key)
		return
	}
	target[key] = value
}

func setOpenClawMatrixChoice(target map[string]any, key string, value string, allowed func(string) bool) error {
	value = strings.TrimSpace(value)
	if value == "" || value == "inherit" {
		delete(target, key)
		return nil
	}
	if !allowed(value) {
		return huma.Error400BadRequest("unsupported matrix "+key, nil)
	}
	target[key] = value
	return nil
}

func splitOpenClawMatrixList(value string) []string {
	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == '，' || r == '\n' || r == '\r' || r == ';' || r == '；'
	})
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if text := strings.TrimSpace(part); text != "" {
			out = append(out, text)
		}
	}
	return dedupeOpenClawMatrixStrings(out)
}

func dedupeOpenClawMatrixStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		text := strings.TrimSpace(value)
		if text == "" || seen[text] {
			continue
		}
		seen[text] = true
		out = append(out, text)
	}
	return out
}

func firstNonNilOpenClawMatrixValue(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func firstNonEmptyOpenClawMatrixObjectMap(values ...map[string]any) map[string]any {
	for _, value := range values {
		if len(value) > 0 {
			return value
		}
	}
	return nil
}

func allowedOpenClawMatrixDMPolicy(value string) bool {
	switch value {
	case "pairing", "allowlist", "open", "disabled":
		return true
	default:
		return false
	}
}

func allowedOpenClawMatrixGroupPolicy(value string) bool {
	switch value {
	case "open", "allowlist", "disabled":
		return true
	default:
		return false
	}
}

func allowedOpenClawMatrixAutoJoin(value string) bool {
	switch value {
	case "off", "allowlist", "always":
		return true
	default:
		return false
	}
}

func allowedOpenClawMatrixThreadReplies(value string) bool {
	switch value {
	case "off", "inbound", "always":
		return true
	default:
		return false
	}
}

func allowedOpenClawMatrixDMSessionScope(value string) bool {
	switch value {
	case "per-user", "per-room":
		return true
	default:
		return false
	}
}

func allowedOpenClawMatrixReplyToMode(value string) bool {
	switch value {
	case "off", "first", "all", "batched":
		return true
	default:
		return false
	}
}

func allowedOpenClawMatrixStreaming(value string) bool {
	switch value {
	case "off", "partial", "quiet", "progress":
		return true
	default:
		return false
	}
}
