package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseDotEnvLine(t *testing.T) {
	tests := []struct {
		name  string
		line  string
		key   string
		value string
		ok    bool
	}{
		{name: "empty", line: "", ok: false},
		{name: "comment", line: "# comment", ok: false},
		{name: "basic", line: "SERVER_PORT=8787", key: "SERVER_PORT", value: "8787", ok: true},
		{name: "export", line: "export APP_ENV=production", key: "APP_ENV", value: "production", ok: true},
		{name: "unquoted comment", line: "LOG_LEVEL=debug # local", key: "LOG_LEVEL", value: "debug", ok: true},
		{name: "double quoted comment", line: `DATABASE_URL="file:/opt/Agent Box/data.db" # local`, key: "DATABASE_URL", value: "file:/opt/Agent Box/data.db", ok: true},
		{name: "single quoted", line: "AUTH_CONFIG_PATH='/opt/agent-box/auth.json'", key: "AUTH_CONFIG_PATH", value: "/opt/agent-box/auth.json", ok: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			key, value, ok, err := parseDotEnvLine(test.line)
			if err != nil {
				t.Fatalf("parseDotEnvLine returned error: %v", err)
			}
			if ok != test.ok {
				t.Fatalf("ok = %v, want %v", ok, test.ok)
			}
			if key != test.key || value != test.value {
				t.Fatalf("got %q=%q, want %q=%q", key, value, test.key, test.value)
			}
		})
	}
}

func TestLoadDotEnvFileDoesNotOverrideExistingEnv(t *testing.T) {
	t.Setenv("APP_ENV", "shell")
	const loadedKey = "DOTENV_TEST_PORT"
	if err := os.Unsetenv(loadedKey); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = os.Unsetenv(loadedKey)
	})
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	if err := os.WriteFile(path, []byte("APP_ENV=production\n"+loadedKey+"=8787\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := loadDotEnvFile(path); err != nil {
		t.Fatalf("loadDotEnvFile returned error: %v", err)
	}
	if got := os.Getenv("APP_ENV"); got != "shell" {
		t.Fatalf("APP_ENV = %q, want shell", got)
	}
	if got := os.Getenv(loadedKey); got != "8787" {
		t.Fatalf("%s = %q, want 8787", loadedKey, got)
	}
}
