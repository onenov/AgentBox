package hermes

import (
	"os"
	"path/filepath"
	"testing"
)

func TestApplyHermesGatewayPIDFileAcceptsNumericStartTime(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "gateway.pid")
	content := `{"pid":154767,"kind":"hermes-gateway","argv":["/usr/local/bin/hermes","gateway","restart"],"start_time":1779615314.12}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write pid file: %v", err)
	}

	info := HermesGatewayInfo{Manager: "unknown"}
	applyHermesGatewayPIDFile(&info, path)

	if info.PIDFileError != "" {
		t.Fatalf("expected pid file to parse, got error %q", info.PIDFileError)
	}
	if info.PID != 154767 {
		t.Fatalf("expected pid 154767, got %d", info.PID)
	}
	if info.Kind != "hermes-gateway" {
		t.Fatalf("expected kind hermes-gateway, got %q", info.Kind)
	}
	if info.Manager != "manual" {
		t.Fatalf("expected manager manual, got %q", info.Manager)
	}
}
