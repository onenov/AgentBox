#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER_DIR="$ROOT_DIR/Server"
CLIENT_DIR="$ROOT_DIR/Client"
EMBED_DIST_DIR="$SERVER_DIR/internal/web/dist"
OUTPUT_ROOT="${OUTPUT_ROOT:-$ROOT_DIR/Build/output}"
BINARY_NAME="${BINARY_NAME:-agentbox}"
TARGETS="${TARGETS:-linux/amd64 linux/arm64}"

VERSION="$(node -e "const fs=require('fs'); const s=fs.readFileSync('$CLIENT_DIR/public/config.js','utf8'); const m=s.match(/\\bAPP_VERSION\\s*:\\s*(['\\\"])([^'\\\"]+)\\1/); if(!m) process.exit(1); console.log(m[2]);")"
GO_LDFLAGS="-s -w -X agent-box-server/internal/version.Version=$VERSION"

normalize_arch() {
  case "$1" in
    amd64|x86_64) printf 'x64\n' ;;
    arm64|aarch64) printf 'arm64\n' ;;
    *) printf '%s\n' "$1" ;;
  esac
}

prepare_frontend_embed() {
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
}

prepare_frontend_embed

cd "$SERVER_DIR"

for target in $TARGETS; do
  goos="${target%%/*}"
  goarch="${target##*/}"
  arch="$(normalize_arch "$goarch")"
  ext=""

  if [[ "$goos" == "windows" ]]; then
    ext=".exe"
  fi

  output_dir="$OUTPUT_ROOT/$VERSION/$goos/$arch/backend"
  output_path="$output_dir/${BINARY_NAME}${ext}"

  echo "==> Building $target"
  rm -rf "$output_dir"
  mkdir -p "$output_dir"
  GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=0 \
    go build -trimpath -ldflags="$GO_LDFLAGS" -o "$output_path" ./cmd/agent-box
  chmod +x "$output_path"
  echo "Built $output_path"
done

echo
echo "Backend binaries:"
find "$OUTPUT_ROOT/$VERSION" -path '*/backend/*' -type f -print
