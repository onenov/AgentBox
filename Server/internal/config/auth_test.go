package config

import (
	"path/filepath"
	"testing"
)

func TestReadOrCreateBackendAuthConfigUsesDefaultTokenOnlyOnCreate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auth.json")

	config, created, err := readOrCreateBackendAuthConfig(path, "http://127.0.0.1:8787", " initial-token ")
	if err != nil {
		t.Fatalf("create auth config: %v", err)
	}
	if !created {
		t.Fatal("created = false, want true")
	}
	if config.Token != "initial-token" {
		t.Fatalf("created token = %q, want initial-token", config.Token)
	}

	config.Token = "file-token"
	if err := writeBackendAuthConfig(path, config); err != nil {
		t.Fatalf("write auth config: %v", err)
	}

	reloaded, created, err := readOrCreateBackendAuthConfig(path, "http://127.0.0.1:8787", "ignored-token")
	if err != nil {
		t.Fatalf("reload auth config: %v", err)
	}
	if created {
		t.Fatal("created = true, want false")
	}
	if reloaded.Token != "file-token" {
		t.Fatalf("reloaded token = %q, want file-token", reloaded.Token)
	}
}
