package openclaw

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

type OpenClawGatewayDevicePairingListInput struct{}

type OpenClawGatewayDevicePairingListOutput struct {
	Body OpenClawGatewayDevicePairingListResponse
}

type OpenClawGatewayDevicePairingApproveInput struct {
	Body OpenClawGatewayDevicePairingApproveRequest
}

type OpenClawGatewayDevicePairingApproveOutput struct {
	Body OpenClawGatewayDevicePairingApproveResponse
}

type OpenClawGatewayDevicePairingRequest struct {
	RequestID  string   `json:"requestId" doc:"Gateway device request id."`
	DeviceID   string   `json:"deviceId,omitempty" doc:"Device id."`
	ClientID   string   `json:"clientId,omitempty" doc:"Client id."`
	ClientMode string   `json:"clientMode,omitempty" doc:"Client mode."`
	Platform   string   `json:"platform,omitempty" doc:"Client platform."`
	Role       string   `json:"role,omitempty" doc:"Client role."`
	Scopes     []string `json:"scopes,omitempty" doc:"Requested scopes."`
}

type OpenClawGatewayDevicePairingListResponse struct {
	Status    string                                `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                                `json:"timestamp" example:"2026-05-20T06:00:00Z" doc:"UTC response timestamp."`
	Pending   []OpenClawGatewayDevicePairingRequest `json:"pending" doc:"Pending Gateway device requests."`
	RawOutput string                                `json:"rawOutput,omitempty" doc:"Raw CLI output when useful for diagnostics."`
}

type OpenClawGatewayDevicePairingApproveRequest struct {
	RequestID string `json:"requestId" doc:"Gateway device request id to approve." example:"2cb88c9b-b5cd-4aa2-a864-1482d89c871b"`
}

type OpenClawGatewayDevicePairingApproveResponse struct {
	Status    string `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string `json:"timestamp" example:"2026-05-20T06:00:00Z" doc:"UTC response timestamp."`
	Approved  bool   `json:"approved" doc:"Whether approval command succeeded."`
	RequestID string `json:"requestId" doc:"Approved Gateway device request id."`
	Message   string `json:"message,omitempty" doc:"Human-readable approve output."`
	RawOutput string `json:"rawOutput,omitempty" doc:"Raw CLI output."`
}

func ListOpenClawGatewayDevicePairingRequests(ctx context.Context, input *OpenClawGatewayDevicePairingListInput) (*OpenClawGatewayDevicePairingListOutput, error) {
	stdout, stderr, err := openClawCommand(ctx, 15*time.Second, "devices", "list", "--json")
	if err != nil {
		return nil, huma.Error500InternalServerError("list gateway device pairing requests failed", fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr)))
	}

	var payload openClawGatewayDeviceList
	if err := json.Unmarshal([]byte(strings.TrimSpace(stdout)), &payload); err != nil {
		return nil, huma.Error500InternalServerError("parse gateway device pairing requests failed", err)
	}

	pending := make([]OpenClawGatewayDevicePairingRequest, 0, len(payload.Pending))
	for _, request := range payload.Pending {
		pending = append(pending, OpenClawGatewayDevicePairingRequest{
			RequestID:  strings.TrimSpace(request.RequestID),
			DeviceID:   strings.TrimSpace(request.DeviceID),
			ClientID:   strings.TrimSpace(request.ClientID),
			ClientMode: strings.TrimSpace(request.ClientMode),
			Platform:   strings.TrimSpace(request.Platform),
			Role:       strings.TrimSpace(request.Role),
			Scopes:     append([]string(nil), request.Scopes...),
		})
	}

	return &OpenClawGatewayDevicePairingListOutput{Body: OpenClawGatewayDevicePairingListResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Pending:   pending,
		RawOutput: strings.TrimSpace(stdout),
	}}, nil
}

func ApproveOpenClawGatewayDevicePairingRequest(ctx context.Context, input *OpenClawGatewayDevicePairingApproveInput) (*OpenClawGatewayDevicePairingApproveOutput, error) {
	if input == nil || strings.TrimSpace(input.Body.RequestID) == "" {
		return nil, huma.Error400BadRequest("request id is required", nil)
	}
	requestID := strings.TrimSpace(input.Body.RequestID)
	stdout, stderr, err := openClawCommand(ctx, 15*time.Second, "devices", "approve", requestID, "--json")
	rawOutput := strings.TrimSpace(strings.Join([]string{stdout, stderr}, "\n"))
	if err != nil {
		if openClawGatewayUnknownRequestID(rawOutput) {
			return nil, huma.Error409Conflict("gateway device pairing request is no longer pending", fmt.Errorf("%w: %s", err, rawOutput))
		}
		return nil, huma.Error500InternalServerError("approve gateway device pairing request failed", fmt.Errorf("%w: %s", err, rawOutput))
	}
	invalidateOpenClawEnvironmentCache()
	return &OpenClawGatewayDevicePairingApproveOutput{Body: OpenClawGatewayDevicePairingApproveResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Approved:  true,
		RequestID: requestID,
		Message:   lastNonEmptyLine(rawOutput),
		RawOutput: rawOutput,
	}}, nil
}

func openClawGatewayUnknownRequestID(value string) bool {
	return strings.Contains(strings.ToLower(value), "unknown requestid")
}
