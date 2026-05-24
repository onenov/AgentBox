package toolenv

import (
	"path/filepath"
	"runtime"
	"testing"
)

func TestNodeBinPathCandidatesIncludesNManagerPaths(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("n version manager paths are Unix-specific")
	}

	home := t.TempDir()
	nPrefix := filepath.Join(t.TempDir(), "custom-n")
	t.Setenv("HOME", home)
	t.Setenv("N_PREFIX", nPrefix)

	candidates := NodeBinPathCandidates()
	for _, want := range []string{
		filepath.Join(home, "n", "bin"),
		filepath.Join(home, ".n", "bin"),
		filepath.Join(nPrefix, "bin"),
		"/root/n/bin",
		"/root/.n/bin",
		"/usr/local/n/bin",
		"/opt/n/bin",
	} {
		if !containsString(candidates, want) {
			t.Fatalf("NodeBinPathCandidates() missing %q in %v", want, candidates)
		}
	}
}

func TestDefaultProxySettingsTurnsOffAppProxyWhenContainerProxyExists(t *testing.T) {
	t.Setenv("AGENTBOX_CONTAINER", "1")
	t.Setenv("HTTP_PROXY", "http://docker-proxy.example:7890")
	t.Setenv("NO_PROXY", "localhost,127.0.0.1,example.internal")

	settings := defaultProxySettings()
	if settings.Mode != ProxyModeOff {
		t.Fatalf("expected app proxy mode off when container proxy env exists, got %q", settings.Mode)
	}
	if settings.NoProxy != "localhost,127.0.0.1,example.internal" {
		t.Fatalf("expected NO_PROXY to be preserved, got %q", settings.NoProxy)
	}
}

func TestNormalizeProxyExitIPRejectsNonIPBody(t *testing.T) {
	if got := normalizeProxyExitIP(`{"resources":{"core":{"limit":60}}}`); got != "" {
		t.Fatalf("expected non-IP body to be rejected, got %q", got)
	}
	if got := normalizeProxyExitIP(" 103.208.196.123\n"); got != "103.208.196.123" {
		t.Fatalf("expected IPv4 body to be preserved, got %q", got)
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
