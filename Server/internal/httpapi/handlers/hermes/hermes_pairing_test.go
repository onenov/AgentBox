package hermes

import "testing"

func TestParseHermesPairingListOutputUsesCLICode(t *testing.T) {
	rawOutput := `
  Pending Pairing Requests (1):
  Platform     Code       User ID              Name                 Age
  --------     ----       -------              ----                 ---
  feishu       53dc13e1   ou_28d417e6d994a42b321243a4c1a44cff                      1m ago

  No approved users.
`

	stored := []HermesPairingRequestSummary{{
		ID:        "ou_28d417e6d994a42b321243a4c1a44cff",
		Code:      "09452a85d9ca36fb",
		CreatedAt: "2026-05-22T19:15:43Z",
	}}

	requests := parseHermesPairingListOutput("feishu", rawOutput, stored)
	if len(requests) != 1 {
		t.Fatalf("expected 1 request, got %d", len(requests))
	}
	if requests[0].Code != "53dc13e1" {
		t.Fatalf("expected CLI code 53dc13e1, got %q", requests[0].Code)
	}
	if requests[0].CreatedAt != "2026-05-22T19:15:43Z" {
		t.Fatalf("expected stored createdAt to be preserved, got %q", requests[0].CreatedAt)
	}
}

func TestHermesPairingApproveOutputLooksFailed(t *testing.T) {
	rawOutput := "Code '09452A85D9CA36FB' not found or expired for platform 'feishu'."
	if !hermesPairingApproveOutputLooksFailed(rawOutput) {
		t.Fatal("expected not found output to be treated as approval failure")
	}
}
