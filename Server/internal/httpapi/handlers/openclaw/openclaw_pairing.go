package openclaw

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

var openClawPairingChannelPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)

type OpenClawPairingListInput struct {
	Channel   string `path:"channel" doc:"OpenClaw channel id." example:"telegram"`
	AccountID string `query:"accountId" doc:"Optional account id for multi-account channels."`
}

type OpenClawPairingListOutput struct {
	Body OpenClawPairingListResponse
}

type OpenClawPairingApproveInput struct {
	Channel string `path:"channel" doc:"OpenClaw channel id." example:"telegram"`
	Body    OpenClawPairingApproveRequest
}

type OpenClawPairingApproveOutput struct {
	Body OpenClawPairingApproveResponse
}

type OpenClawPairingRequestSummary struct {
	ID         string         `json:"id" doc:"Channel sender id waiting for approval."`
	Code       string         `json:"code" doc:"Pairing code."`
	AccountID  string         `json:"accountId,omitempty" doc:"Account id from request metadata."`
	CreatedAt  string         `json:"createdAt" doc:"Pairing request creation time."`
	LastSeenAt string         `json:"lastSeenAt,omitempty" doc:"Pairing request last seen time."`
	Meta       map[string]any `json:"meta,omitempty" doc:"Pairing request metadata."`
}

type OpenClawPairingListResponse struct {
	Status    string                          `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                          `json:"timestamp" example:"2026-05-14T09:00:00Z" doc:"UTC response timestamp."`
	Channel   string                          `json:"channel" example:"telegram" doc:"Pairing channel."`
	Requests  []OpenClawPairingRequestSummary `json:"requests" doc:"Pending pairing requests."`
	RawOutput string                          `json:"rawOutput,omitempty" doc:"Raw CLI output when useful for diagnostics."`
}

type OpenClawPairingApproveRequest struct {
	Code      string `json:"code" doc:"Pairing code to approve." example:"LV8A6QQK"`
	AccountID string `json:"accountId,omitempty" doc:"Optional account id for multi-account channels."`
	Notify    bool   `json:"notify,omitempty" doc:"Notify requester on the same channel."`
}

type OpenClawPairingApproveResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-14T09:00:00Z" doc:"UTC response timestamp."`
	Approved  bool   `json:"approved" doc:"Whether approval command succeeded."`
	Channel   string `json:"channel" example:"telegram" doc:"Pairing channel."`
	Code      string `json:"code" doc:"Approved pairing code."`
	Message   string `json:"message,omitempty" doc:"Human-readable approve output."`
	RawOutput string `json:"rawOutput,omitempty" doc:"Raw CLI output."`
}

func ListOpenClawPairingRequests(ctx context.Context, input *OpenClawPairingListInput) (*OpenClawPairingListOutput, error) {
	channel, err := normalizeOpenClawPairingChannel(input)
	if err != nil {
		return nil, err
	}
	args := []string{"pairing", "list", "--channel", channel, "--json"}
	if accountID := strings.TrimSpace(input.AccountID); accountID != "" {
		args = append(args, "--account", accountID)
	}
	stdout, stderr, runErr := runOpenClawStreamingCommandTo(ctx, 30*time.Second, nil, args...)
	if runErr != nil {
		return nil, huma.Error500InternalServerError("list pairing requests failed", fmt.Errorf("%w: %s%s", runErr, stdout, stderr))
	}
	response, parseErr := parseOpenClawPairingListOutput(stdout)
	if parseErr != nil {
		return nil, huma.Error500InternalServerError("parse pairing requests failed", fmt.Errorf("%w: %s", parseErr, stdout))
	}
	if response.Channel == "" {
		response.Channel = channel
	}
	return &OpenClawPairingListOutput{Body: response}, nil
}

func ApproveOpenClawPairingRequest(ctx context.Context, input *OpenClawPairingApproveInput) (*OpenClawPairingApproveOutput, error) {
	channel, err := normalizeOpenClawPairingChannel(input)
	if err != nil {
		return nil, err
	}
	if input == nil || strings.TrimSpace(input.Body.Code) == "" {
		return nil, huma.Error400BadRequest("pairing code is required", nil)
	}
	code := strings.TrimSpace(input.Body.Code)
	args := []string{"pairing", "approve", "--channel", channel}
	if accountID := strings.TrimSpace(input.Body.AccountID); accountID != "" {
		args = append(args, "--account", accountID)
	}
	if input.Body.Notify {
		args = append(args, "--notify")
	}
	args = append(args, code)
	stdout, stderr, runErr := runOpenClawStreamingCommandTo(ctx, 30*time.Second, nil, args...)
	rawOutput := strings.TrimSpace(strings.Join([]string{stdout, stderr}, "\n"))
	if runErr != nil {
		return nil, huma.Error500InternalServerError("approve pairing request failed", fmt.Errorf("%w: %s", runErr, rawOutput))
	}
	invalidateOpenClawEnvironmentCache()
	return &OpenClawPairingApproveOutput{Body: OpenClawPairingApproveResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Approved:  true,
		Channel:   channel,
		Code:      code,
		Message:   firstNonEmptyPairingString(lastNonEmptyLine(rawOutput), "配对请求已批准。"),
		RawOutput: rawOutput,
	}}, nil
}

func parseOpenClawPairingListOutput(value string) (OpenClawPairingListResponse, error) {
	var payload struct {
		Channel  string `json:"channel"`
		Requests []struct {
			ID         string         `json:"id"`
			Code       string         `json:"code"`
			CreatedAt  string         `json:"createdAt"`
			LastSeenAt string         `json:"lastSeenAt"`
			Meta       map[string]any `json:"meta"`
		} `json:"requests"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(value)), &payload); err != nil {
		return OpenClawPairingListResponse{}, err
	}
	requests := make([]OpenClawPairingRequestSummary, 0, len(payload.Requests))
	for _, item := range payload.Requests {
		meta := item.Meta
		if meta == nil {
			meta = map[string]any{}
		}
		requests = append(requests, OpenClawPairingRequestSummary{
			ID:         strings.TrimSpace(item.ID),
			Code:       strings.TrimSpace(item.Code),
			AccountID:  stringFromMap(meta, "accountId"),
			CreatedAt:  strings.TrimSpace(item.CreatedAt),
			LastSeenAt: strings.TrimSpace(item.LastSeenAt),
			Meta:       sortedCopyOpenClawPairingMeta(meta),
		})
	}
	return OpenClawPairingListResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Channel:   strings.TrimSpace(payload.Channel),
		Requests:  requests,
	}, nil
}

func normalizeOpenClawPairingChannel(input any) (string, error) {
	var channel string
	switch typed := input.(type) {
	case *OpenClawPairingListInput:
		if typed != nil {
			channel = typed.Channel
		}
	case *OpenClawPairingApproveInput:
		if typed != nil {
			channel = typed.Channel
		}
	}
	channel = strings.TrimSpace(strings.ToLower(channel))
	if !openClawPairingChannelPattern.MatchString(channel) {
		return "", huma.Error400BadRequest("invalid pairing channel", nil)
	}
	return channel, nil
}

func sortedCopyOpenClawPairingMeta(meta map[string]any) map[string]any {
	if len(meta) == 0 {
		return nil
	}
	keys := make([]string, 0, len(meta))
	for key := range meta {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	next := make(map[string]any, len(meta))
	for _, key := range keys {
		next[key] = meta[key]
	}
	return next
}

func lastNonEmptyLine(value string) string {
	lines := strings.Split(value, "\n")
	for index := len(lines) - 1; index >= 0; index-- {
		if text := strings.TrimSpace(lines[index]); text != "" {
			return text
		}
	}
	return ""
}

func firstNonEmptyPairingString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
