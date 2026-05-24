#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLIENT_DIR="$ROOT_DIR/Client"
SERVER_DIR="$ROOT_DIR/Server"
EMBED_DIST_DIR="$SERVER_DIR/internal/web/dist"
OUTPUT_DIR="$ROOT_DIR/dist"
BINARY_NAME="${BINARY_NAME:-agentbox}"
TAURI_SIDECAR_DIR="$CLIENT_DIR/src-tauri/binaries"
TAURI_SIDECAR_NAME="agentbox-sidecar"
VERSION="$(node -e "const fs=require('fs'); const s=fs.readFileSync('$CLIENT_DIR/public/config.js','utf8'); const m=s.match(/\\bAPP_VERSION\\s*:\\s*(['\\\"])([^'\\\"]+)\\1/); if(!m) process.exit(1); console.log(m[2]);")"
GO_LDFLAGS="-s -w -X agent-box-server/internal/version.Version=$VERSION"

build_go_binary() {
  local target_triple="$1"
  local output_path="$2"
  local goos
  local goarch

  case "$target_triple" in
    aarch64-apple-darwin)
      goos="darwin"
      goarch="arm64"
      ;;
    x86_64-apple-darwin)
      goos="darwin"
      goarch="amd64"
      ;;
    aarch64-unknown-linux-gnu)
      goos="linux"
      goarch="arm64"
      ;;
    x86_64-unknown-linux-gnu)
      goos="linux"
      goarch="amd64"
      ;;
    x86_64-pc-windows-msvc)
      goos="windows"
      goarch="amd64"
      ;;
    x86_64-pc-windows-gnu)
      goos="windows"
      goarch="amd64"
      ;;
    aarch64-pc-windows-gnullvm)
      goos="windows"
      goarch="arm64"
      ;;
    aarch64-pc-windows-msvc)
      goos="windows"
      goarch="arm64"
      ;;
    *)
      goos="$(go env GOOS)"
      goarch="$(go env GOARCH)"
      ;;
  esac

  cd "$SERVER_DIR"
  GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=0 go build -trimpath -ldflags="$GO_LDFLAGS" -o "$output_path" ./cmd/agent-box
}

resolve_tauri_target_triple() {
  if [[ -n "${TAURI_TARGET_TRIPLE:-}" ]]; then
    printf '%s\n' "$TAURI_TARGET_TRIPLE"
    return
  fi

  if [[ -n "${TAURI_ENV_TARGET_TRIPLE:-}" ]]; then
    printf '%s\n' "$TAURI_ENV_TARGET_TRIPLE"
    return
  fi

  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) printf 'aarch64-apple-darwin\n' ;;
    Darwin-x86_64) printf 'x86_64-apple-darwin\n' ;;
    Linux-x86_64) printf 'x86_64-unknown-linux-gnu\n' ;;
    Linux-aarch64|Linux-arm64) printf 'aarch64-unknown-linux-gnu\n' ;;
    MINGW*|MSYS*|CYGWIN*) printf 'x86_64-pc-windows-msvc\n' ;;
    *) printf '%s-unknown-%s\n' "$(uname -m)" "$(uname -s | tr '[:upper:]' '[:lower:]')" ;;
  esac
}

prepare_tauri_sidecar() {
  local target_triple="$1"

  if [[ ! -d "$TAURI_SIDECAR_DIR" ]]; then
    return
  fi

  mkdir -p "$TAURI_SIDECAR_DIR"

  if [[ "$target_triple" == "universal-apple-darwin" ]]; then
    local arm64_binary="$OUTPUT_DIR/$TAURI_SIDECAR_NAME-aarch64-apple-darwin"
    local x64_binary="$OUTPUT_DIR/$TAURI_SIDECAR_NAME-x86_64-apple-darwin"
    local arm64_sidecar="$TAURI_SIDECAR_DIR/$TAURI_SIDECAR_NAME-aarch64-apple-darwin"
    local x64_sidecar="$TAURI_SIDECAR_DIR/$TAURI_SIDECAR_NAME-x86_64-apple-darwin"
    local universal_binary="$TAURI_SIDECAR_DIR/$TAURI_SIDECAR_NAME-universal-apple-darwin"

    build_go_binary "aarch64-apple-darwin" "$arm64_binary"
    build_go_binary "x86_64-apple-darwin" "$x64_binary"
    cp "$arm64_binary" "$arm64_sidecar"
    cp "$x64_binary" "$x64_sidecar"
    lipo -create -output "$universal_binary" "$arm64_binary" "$x64_binary"
    chmod +x "$arm64_sidecar" "$x64_sidecar" "$universal_binary"
    printf 'Prepared Tauri sidecar %s\n' "$arm64_sidecar"
    printf 'Prepared Tauri sidecar %s\n' "$x64_sidecar"
    printf 'Prepared Tauri universal sidecar %s\n' "$universal_binary"
    return
  fi

  local sidecar_path="$TAURI_SIDECAR_DIR/$TAURI_SIDECAR_NAME-$target_triple"
  if [[ "$target_triple" == *windows* ]]; then
    sidecar_path="$sidecar_path.exe"
  fi
  build_go_binary "$target_triple" "$sidecar_path"
  chmod +x "$sidecar_path"
  printf 'Prepared Tauri sidecar %s\n' "$sidecar_path"
}

mkdir -p "$OUTPUT_DIR"

cd "$CLIENT_DIR"
pnpm install --frozen-lockfile
pnpm build

rm -rf "$EMBED_DIST_DIR"
mkdir -p "$EMBED_DIST_DIR"
cp -R "$CLIENT_DIR/dist/." "$EMBED_DIST_DIR/"
python3 - <<'PY' "$EMBED_DIST_DIR/config.js"
from pathlib import Path
import re
import sys

config_path = Path(sys.argv[1])
content = config_path.read_text()
content = re.sub(r"API_URL:\s*(['\"]).*?\1", "API_URL: ''", content)
config_path.write_text(content)
PY

cd "$SERVER_DIR"
target_triple="$(resolve_tauri_target_triple)"
binary_path="$OUTPUT_DIR/$BINARY_NAME"
if [[ "$target_triple" == *windows* ]]; then
  binary_path="$binary_path.exe"
fi
build_go_binary "$target_triple" "$binary_path"
prepare_tauri_sidecar "$target_triple"

printf 'Built %s\n' "$binary_path"
