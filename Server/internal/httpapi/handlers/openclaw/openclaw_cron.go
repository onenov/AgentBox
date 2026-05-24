package openclaw

// OpenClaw cron handlers expose Gateway-owned scheduled task management.
//
// 该接口固定使用 /openclaw/cron 前缀，将管理中心的 REST 请求代理到 OpenClaw
// Gateway 的 cron.* RPC 方法。这样前端可以使用官方 CronJob/CronJobCreate/CronJobPatch
// 数据结构，同时由 Gateway 继续负责计划校验、运行态持久化、权限边界和投递预览。

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

type OpenClawCronRawOutput struct {
	Body json.RawMessage
}

type OpenClawCronListInput struct {
	IncludeDisabled bool   `query:"includeDisabled" doc:"Include disabled cron jobs." example:"false"`
	Limit           int    `query:"limit" minimum:"1" maximum:"200" doc:"Maximum number of jobs to return." example:"50"`
	Offset          int    `query:"offset" minimum:"0" doc:"Pagination offset." example:"0"`
	Query           string `query:"query" doc:"Search text matched against job name, description, and agent id." example:"daily"`
	Enabled         string `query:"enabled" enum:"all,enabled,disabled" doc:"Enabled filter." example:"enabled"`
	SortBy          string `query:"sortBy" enum:"nextRunAtMs,updatedAtMs,name" doc:"Sort field." example:"nextRunAtMs"`
	SortDir         string `query:"sortDir" enum:"asc,desc" doc:"Sort direction." example:"asc"`
	AgentID         string `query:"agentId" doc:"Optional OpenClaw agent id filter." example:"main"`
}

type OpenClawCronJobInput struct {
	ID string `path:"id" doc:"Cron job id." example:"job-abc123"`
}

type OpenClawCronRunsInput struct {
	ID             string `query:"id" doc:"Optional cron job id filter. When omitted, returns all run history." example:"job-abc123"`
	Limit          int    `query:"limit" minimum:"1" maximum:"200" doc:"Maximum number of run log entries." example:"50"`
	Offset         int    `query:"offset" minimum:"0" doc:"Pagination offset." example:"0"`
	Status         string `query:"status" enum:"all,ok,error,skipped" doc:"Run status filter." example:"all"`
	DeliveryStatus string `query:"deliveryStatus" enum:"delivered,not-delivered,unknown,not-requested" doc:"Delivery status filter." example:"delivered"`
	Query          string `query:"query" doc:"Search text for run history." example:"timeout"`
	SortDir        string `query:"sortDir" enum:"asc,desc" doc:"Sort direction." example:"desc"`
}

type OpenClawCronCreateInput struct {
	Body map[string]any
}

type OpenClawCronPatchInput struct {
	ID   string `path:"id" doc:"Cron job id." example:"job-abc123"`
	Body map[string]any
}

type OpenClawCronRunInput struct {
	ID   string `path:"id" doc:"Cron job id." example:"job-abc123"`
	Body OpenClawCronRunRequest
}

type OpenClawCronRunRequest struct {
	Mode string `json:"mode,omitempty" enum:"due,force" doc:"Manual run mode. force runs immediately; due only runs when the job is due." example:"force"`
}

func GetOpenClawCronStatus(ctx context.Context, input *struct{}) (*OpenClawCronRawOutput, error) {
	payload, err := openClawGatewayCallJSON(ctx, 15*time.Second, "cron.status", map[string]any{})
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw cron status failed", err)
	}
	return &OpenClawCronRawOutput{Body: payload}, nil
}

func ListOpenClawCronJobs(ctx context.Context, input *OpenClawCronListInput) (*OpenClawCronRawOutput, error) {
	params := map[string]any{}
	if input != nil {
		if input.IncludeDisabled {
			params["includeDisabled"] = true
		}
		if input.Limit > 0 {
			params["limit"] = input.Limit
		}
		if input.Offset > 0 {
			params["offset"] = input.Offset
		}
		setTrimmedParam(params, "query", input.Query)
		setTrimmedParam(params, "enabled", input.Enabled)
		setTrimmedParam(params, "sortBy", input.SortBy)
		setTrimmedParam(params, "sortDir", input.SortDir)
		setTrimmedParam(params, "agentId", input.AgentID)
	}
	payload, err := openClawGatewayCallJSON(ctx, 20*time.Second, "cron.list", params)
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw cron list failed", err)
	}
	return &OpenClawCronRawOutput{Body: payload}, nil
}

func CreateOpenClawCronJob(ctx context.Context, input *OpenClawCronCreateInput) (*OpenClawCronRawOutput, error) {
	if input == nil || input.Body == nil {
		return nil, huma.Error400BadRequest("cron job body is required", nil)
	}
	payload, err := openClawGatewayCallJSON(ctx, 30*time.Second, "cron.add", input.Body)
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw cron add failed", err)
	}
	return &OpenClawCronRawOutput{Body: payload}, nil
}

func UpdateOpenClawCronJob(ctx context.Context, input *OpenClawCronPatchInput) (*OpenClawCronRawOutput, error) {
	if input == nil || strings.TrimSpace(input.ID) == "" {
		return nil, huma.Error400BadRequest("cron job id is required", nil)
	}
	if input.Body == nil {
		return nil, huma.Error400BadRequest("cron patch body is required", nil)
	}
	params := map[string]any{
		"id":    strings.TrimSpace(input.ID),
		"patch": input.Body,
	}
	payload, err := openClawGatewayCallJSON(ctx, 30*time.Second, "cron.update", params)
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw cron update failed", err)
	}
	return &OpenClawCronRawOutput{Body: payload}, nil
}

func DeleteOpenClawCronJob(ctx context.Context, input *OpenClawCronJobInput) (*OpenClawCronRawOutput, error) {
	id, err := requireCronJobID(input)
	if err != nil {
		return nil, err
	}
	payload, cmdErr := openClawGatewayCallJSON(ctx, 20*time.Second, "cron.remove", map[string]any{"id": id})
	if cmdErr != nil {
		return nil, huma.Error500InternalServerError("openclaw cron remove failed", cmdErr)
	}
	return &OpenClawCronRawOutput{Body: payload}, nil
}

func RunOpenClawCronJob(ctx context.Context, input *OpenClawCronRunInput) (*OpenClawCronRawOutput, error) {
	if input == nil || strings.TrimSpace(input.ID) == "" {
		return nil, huma.Error400BadRequest("cron job id is required", nil)
	}
	params := map[string]any{"id": strings.TrimSpace(input.ID)}
	if mode := strings.TrimSpace(input.Body.Mode); mode != "" {
		params["mode"] = mode
	}
	payload, err := openClawGatewayCallJSON(ctx, 30*time.Second, "cron.run", params)
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw cron run failed", err)
	}
	return &OpenClawCronRawOutput{Body: payload}, nil
}

func ListOpenClawCronRuns(ctx context.Context, input *OpenClawCronRunsInput) (*OpenClawCronRawOutput, error) {
	params := map[string]any{}
	if input == nil {
		input = &OpenClawCronRunsInput{}
	}
	setTrimmedParam(params, "id", input.ID)
	if input.Limit > 0 {
		params["limit"] = input.Limit
	}
	if input.Offset > 0 {
		params["offset"] = input.Offset
	}
	setTrimmedParam(params, "status", input.Status)
	setTrimmedParam(params, "deliveryStatus", input.DeliveryStatus)
	setTrimmedParam(params, "query", input.Query)
	setTrimmedParam(params, "sortDir", input.SortDir)

	payload, err := openClawGatewayCallJSON(ctx, 20*time.Second, "cron.runs", params)
	if err != nil {
		return nil, huma.Error500InternalServerError("openclaw cron runs failed", err)
	}
	return &OpenClawCronRawOutput{Body: payload}, nil
}

func openClawGatewayCallJSON(ctx context.Context, timeout time.Duration, method string, params map[string]any) (json.RawMessage, error) {
	encodedParams, err := json.Marshal(params)
	if err != nil {
		return nil, err
	}
	return openClawJSONCommandWithGatewayApprovalRetry(ctx, timeout, "gateway", "call", method, "--json", "--params", string(encodedParams))
}

func requireCronJobID(input *OpenClawCronJobInput) (string, error) {
	id := ""
	if input != nil {
		id = strings.TrimSpace(input.ID)
	}
	if id == "" {
		return "", huma.Error400BadRequest("cron job id is required", nil)
	}
	return id, nil
}

func setTrimmedParam(params map[string]any, key string, value string) {
	if trimmed := strings.TrimSpace(value); trimmed != "" {
		params[key] = trimmed
	}
}
