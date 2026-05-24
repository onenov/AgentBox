package hermes

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

var hermesPairingPlatformPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)

type HermesPairingListInput struct {
	Platform string `path:"platform" doc:"Hermes platform id." example:"telegram"`
	Profile  string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
}

type HermesPairingListOutput struct {
	Body HermesPairingListResponse
}

type HermesPairingApproveInput struct {
	Platform string `path:"platform" doc:"Hermes platform id." example:"telegram"`
	Profile  string `query:"profile,omitempty" doc:"Hermes profile name. Empty uses the active profile." example:"default"`
	Body     HermesPairingApproveRequest
}

type HermesPairingApproveOutput struct {
	Body HermesPairingApproveResponse
}

type HermesPairingRequestSummary struct {
	ID         string         `json:"id" doc:"Platform sender id waiting for approval."`
	Code       string         `json:"code" doc:"Pairing code."`
	CreatedAt  string         `json:"createdAt" doc:"Pairing request creation time."`
	LastSeenAt string         `json:"lastSeenAt,omitempty" doc:"Pairing request last seen time."`
	Meta       map[string]any `json:"meta,omitempty" doc:"Pairing request metadata."`
}

type HermesPairingListResponse struct {
	Status    string                        `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                        `json:"timestamp" example:"2026-05-17T09:00:00Z" doc:"UTC response timestamp."`
	Profile   HermesProfileSelection        `json:"profile" doc:"Resolved Hermes profile used for this response."`
	Platform  string                        `json:"platform" example:"telegram" doc:"Hermes platform id."`
	Requests  []HermesPairingRequestSummary `json:"requests" doc:"Pending pairing requests."`
}

type HermesPairingApproveRequest struct {
	Code string `json:"code" doc:"Pairing code to approve." example:"XKGH5N7P"`
}

type HermesPairingApproveResponse struct {
	Status    string                 `json:"status" example:"ok" doc:"Operation status."`
	Timestamp string                 `json:"timestamp" example:"2026-05-17T09:00:00Z" doc:"UTC response timestamp."`
	Profile   HermesProfileSelection `json:"profile" doc:"Resolved Hermes profile used for this response."`
	Approved  bool                   `json:"approved" doc:"Whether approval command succeeded."`
	Platform  string                 `json:"platform" example:"telegram" doc:"Hermes platform id."`
	Code      string                 `json:"code" doc:"Approved pairing code."`
	Message   string                 `json:"message,omitempty" doc:"Human-readable approve output."`
	RawOutput string                 `json:"rawOutput,omitempty" doc:"Raw CLI output."`
}

func ListHermesPairingRequests(ctx context.Context, input *HermesPairingListInput) (*HermesPairingListOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("pairing list input is required", nil)
	}
	platform, err := normalizeHermesPairingPlatform(input.Platform)
	if err != nil {
		return nil, err
	}
	profile, err := resolveHermesProfileSelection(input.Profile)
	if err != nil {
		return nil, err
	}
	requests, err := listHermesPairingPendingRequests(ctx, profile, platform)
	if err != nil {
		return nil, err
	}
	return &HermesPairingListOutput{Body: HermesPairingListResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Profile:   profile,
		Platform:  platform,
		Requests:  requests,
	}}, nil
}

func ApproveHermesPairingRequest(ctx context.Context, input *HermesPairingApproveInput) (*HermesPairingApproveOutput, error) {
	if input == nil {
		return nil, huma.Error400BadRequest("pairing approve input is required", nil)
	}
	platform, err := normalizeHermesPairingPlatform(input.Platform)
	if err != nil {
		return nil, err
	}
	profile, err := resolveHermesProfileSelection(input.Profile)
	if err != nil {
		return nil, err
	}
	code := strings.TrimSpace(input.Body.Code)
	if code == "" {
		return nil, huma.Error400BadRequest("pairing code is required", nil)
	}

	stdout, stderr, runErr := hermesCommandWithProfile(ctx, 30*time.Second, profile.Name, "pairing", "approve", platform, code)
	rawOutput := strings.TrimSpace(strings.Join([]string{stdout, stderr}, "\n"))
	if runErr != nil {
		return nil, huma.Error500InternalServerError("approve hermes pairing request failed", fmt.Errorf("%w: %s", runErr, rawOutput))
	}
	if hermesPairingApproveOutputLooksFailed(rawOutput) {
		return nil, huma.Error404NotFound("hermes pairing code not found or expired", fmt.Errorf("%s", rawOutput))
	}
	invalidateHermesEnvironmentCache()
	return &HermesPairingApproveOutput{Body: HermesPairingApproveResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Profile:   profile,
		Approved:  true,
		Platform:  platform,
		Code:      code,
		Message:   firstNonEmptyHermesPairingString(lastNonEmptyHermesPairingLine(rawOutput), "配对请求已批准。"),
		RawOutput: rawOutput,
	}}, nil
}

func listHermesPairingPendingRequests(ctx context.Context, profile HermesProfileSelection, platform string) ([]HermesPairingRequestSummary, error) {
	storedRequests, err := readHermesPairingPendingRequests(profile, platform)
	if err != nil {
		return nil, err
	}

	stdout, stderr, runErr := hermesCommandWithProfile(ctx, 15*time.Second, profile.Name, "pairing", "list")
	rawOutput := strings.TrimSpace(strings.Join([]string{stdout, stderr}, "\n"))
	if runErr != nil {
		return storedRequests, nil
	}

	cliRequests := parseHermesPairingListOutput(platform, rawOutput, storedRequests)
	if len(cliRequests) > 0 || hermesPairingListOutputLooksEmpty(rawOutput) {
		return cliRequests, nil
	}
	return storedRequests, nil
}

func readHermesPairingPendingRequests(profile HermesProfileSelection, platform string) ([]HermesPairingRequestSummary, error) {
	path := filepath.Join(profile.Path, "pairing", platform+"-pending.json")
	content, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []HermesPairingRequestSummary{}, nil
		}
		return nil, huma.Error500InternalServerError("read hermes pairing requests failed", err)
	}
	var payload map[string]struct {
		UserID     string  `json:"user_id"`
		UserName   string  `json:"user_name"`
		CreatedAt  float64 `json:"created_at"`
		LastSeenAt float64 `json:"last_seen_at"`
	}
	if err := json.Unmarshal(content, &payload); err != nil {
		return nil, huma.Error500InternalServerError("parse hermes pairing requests failed", err)
	}

	codes := make([]string, 0, len(payload))
	for code := range payload {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	requests := make([]HermesPairingRequestSummary, 0, len(codes))
	for _, code := range codes {
		item := payload[code]
		meta := map[string]any{}
		if strings.TrimSpace(item.UserName) != "" {
			meta["userName"] = strings.TrimSpace(item.UserName)
		}
		requests = append(requests, HermesPairingRequestSummary{
			ID:         strings.TrimSpace(item.UserID),
			Code:       strings.TrimSpace(code),
			CreatedAt:  formatHermesPairingUnixTime(item.CreatedAt),
			LastSeenAt: formatHermesPairingUnixTime(item.LastSeenAt),
			Meta:       metaOrNil(meta),
		})
	}
	return requests, nil
}

func parseHermesPairingListOutput(platform string, rawOutput string, storedRequests []HermesPairingRequestSummary) []HermesPairingRequestSummary {
	storedByID := make(map[string]HermesPairingRequestSummary, len(storedRequests))
	for _, request := range storedRequests {
		if id := strings.TrimSpace(request.ID); id != "" {
			storedByID[id] = request
		}
	}

	requests := []HermesPairingRequestSummary{}
	seen := map[string]bool{}
	for _, line := range strings.Split(rawOutput, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 3 || fields[0] != platform || strings.EqualFold(fields[1], "Code") {
			continue
		}

		code := strings.TrimSpace(fields[1])
		id := strings.TrimSpace(fields[2])
		if code == "" || id == "" || seen[code] {
			continue
		}
		seen[code] = true

		request := HermesPairingRequestSummary{
			ID:   id,
			Code: code,
		}
		if stored, ok := storedByID[id]; ok {
			request.CreatedAt = stored.CreatedAt
			request.LastSeenAt = stored.LastSeenAt
			request.Meta = stored.Meta
		}
		requests = append(requests, request)
	}
	return requests
}

func normalizeHermesPairingPlatform(value string) (string, error) {
	platform := strings.TrimSpace(strings.ToLower(value))
	if !hermesPairingPlatformPattern.MatchString(platform) {
		return "", huma.Error400BadRequest("invalid hermes pairing platform", nil)
	}
	return platform, nil
}

func formatHermesPairingUnixTime(value float64) string {
	if value <= 0 {
		return ""
	}
	sec := int64(value)
	nsec := int64((value - float64(sec)) * 1_000_000_000)
	return time.Unix(sec, nsec).UTC().Format(time.RFC3339)
}

func metaOrNil(meta map[string]any) map[string]any {
	if len(meta) == 0 {
		return nil
	}
	return meta
}

func lastNonEmptyHermesPairingLine(value string) string {
	lines := strings.Split(value, "\n")
	for index := len(lines) - 1; index >= 0; index-- {
		if text := strings.TrimSpace(lines[index]); text != "" {
			return text
		}
	}
	return ""
}

func hermesPairingListOutputLooksEmpty(value string) bool {
	lower := strings.ToLower(value)
	return strings.Contains(lower, "no pending") ||
		strings.Contains(lower, "pending pairing requests (0)")
}

func hermesPairingApproveOutputLooksFailed(value string) bool {
	lower := strings.ToLower(value)
	return strings.Contains(lower, "not found or expired") ||
		strings.Contains(lower, "code not found") ||
		strings.Contains(lower, "not found")
}

func firstNonEmptyHermesPairingString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
