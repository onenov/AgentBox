package openclaw

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestOpenClawNPMGlobalPrefixFromCLIPathNVMStyleSymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink permissions vary on Windows")
	}

	prefix := t.TempDir()
	binDir := filepath.Join(prefix, "bin")
	packageDir := filepath.Join(prefix, "lib", "node_modules", "openclaw")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(packageDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(packageDir, "openclaw.mjs"), []byte("#!/usr/bin/env node\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	cliPath := filepath.Join(binDir, "openclaw")
	if err := os.Symlink(filepath.Join("..", "lib", "node_modules", "openclaw", "openclaw.mjs"), cliPath); err != nil {
		t.Fatal(err)
	}

	if got := openClawNPMGlobalPrefixFromCLIPath(cliPath); got != prefix {
		t.Fatalf("expected prefix %q, got %q", prefix, got)
	}
}

func TestOpenClawNPMGlobalPrefixFromPackagePath(t *testing.T) {
	path := filepath.Join(string(filepath.Separator), "Users", "one", ".nvm", "versions", "node", "v24.15.0", "lib", "node_modules", "openclaw", "openclaw.mjs")
	want := filepath.Join(string(filepath.Separator), "Users", "one", ".nvm", "versions", "node", "v24.15.0")

	if got := openClawNPMGlobalPrefixFromPackagePath(path); got != want {
		t.Fatalf("expected prefix %q, got %q", want, got)
	}
}
