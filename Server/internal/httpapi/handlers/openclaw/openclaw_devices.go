package openclaw

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type openClawGatewayDeviceList struct {
	Pending []openClawGatewayPendingDevice `json:"pending"`
}

type openClawGatewayPendingDevice struct {
	RequestID  string   `json:"requestId"`
	DeviceID   string   `json:"deviceId"`
	ClientID   string   `json:"clientId"`
	ClientMode string   `json:"clientMode"`
	Platform   string   `json:"platform"`
	Role       string   `json:"role"`
	Scopes     []string `json:"scopes"`
}

type openClawGatewayDeviceAutoApproveResult struct {
	Approved int
	Skipped  int
	Messages []string
}

func autoApproveOpenClawGatewayDevices(ctx context.Context, log func(string)) (openClawGatewayDeviceAutoApproveResult, error) {
	var result openClawGatewayDeviceAutoApproveResult
	stdout, stderr, err := openClawCommand(ctx, 15*time.Second, "devices", "list", "--json")
	if err != nil {
		return result, fmt.Errorf("list gateway devices: %w: %s", err, strings.TrimSpace(stderr))
	}

	var payload openClawGatewayDeviceList
	if err := json.Unmarshal([]byte(strings.TrimSpace(stdout)), &payload); err != nil {
		return result, fmt.Errorf("parse gateway devices list: %w", err)
	}
	if len(payload.Pending) == 0 {
		if log != nil {
			log("未发现待审批 Gateway 设备。")
		}
		return result, nil
	}

	for _, request := range payload.Pending {
		requestID := strings.TrimSpace(request.RequestID)
		if requestID == "" {
			result.Skipped++
			continue
		}
		if !shouldAutoApproveOpenClawGatewayDevice(request) {
			result.Skipped++
			if log != nil {
				log("跳过非本机控制端 Gateway 设备请求：" + openClawGatewayDeviceLabel(request))
			}
			continue
		}

		approveStdout, approveStderr, approveErr := openClawCommand(ctx, 15*time.Second, "devices", "approve", requestID, "--json")
		if approveErr != nil {
			return result, fmt.Errorf("approve gateway device %s: %w: %s", requestID, approveErr, strings.TrimSpace(strings.Join([]string{approveStdout, approveStderr}, "\n")))
		}
		result.Approved++
		message := "已自动审批 Gateway 设备：" + openClawGatewayDeviceLabel(request)
		result.Messages = append(result.Messages, message)
		if log != nil {
			log(message)
		}
	}

	return result, nil
}

func shouldAutoApproveOpenClawGatewayDevice(request openClawGatewayPendingDevice) bool {
	clientID := strings.TrimSpace(request.ClientID)
	clientMode := strings.TrimSpace(request.ClientMode)
	if clientID == "openclaw-control-ui" && clientMode == "webchat" {
		return true
	}
	if clientID == "cli" && clientMode == "cli" && hasOpenClawGatewayScope(request.Scopes, "operator.pairing") {
		return true
	}
	return false
}

func hasOpenClawGatewayScope(scopes []string, target string) bool {
	for _, scope := range scopes {
		if strings.TrimSpace(scope) == target {
			return true
		}
	}
	return false
}

func openClawGatewayDeviceLabel(request openClawGatewayPendingDevice) string {
	parts := []string{}
	if value := strings.TrimSpace(request.ClientID); value != "" {
		parts = append(parts, "client="+value)
	}
	if value := strings.TrimSpace(request.ClientMode); value != "" {
		parts = append(parts, "mode="+value)
	}
	if value := strings.TrimSpace(request.DeviceID); value != "" {
		parts = append(parts, "device="+value)
	}
	if value := strings.TrimSpace(request.RequestID); value != "" {
		parts = append(parts, "request="+value)
	}
	if len(parts) == 0 {
		return "unknown"
	}
	return strings.Join(parts, ", ")
}
