#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/workspace"
CLIENT_DIR="$ROOT_DIR/Client"
TARGET="aarch64-pc-windows-gnullvm"

cd "$CLIENT_DIR"

node scripts/sync-tauri-version.mjs
VERSION="$(node -e "const c=require('./src-tauri/tauri.conf.json'); console.log(c.version)")"
PRODUCT_NAME="$(node -e "const c=require('./src-tauri/tauri.conf.json'); console.log(c.productName || 'AgentBox')")"
pnpm install --frozen-lockfile

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" && -f "$TAURI_SIGNING_PRIVATE_KEY_PATH" && -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$TAURI_SIGNING_PRIVATE_KEY_PATH")"
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" && -n "${TAURI_UPDATER_PRIVATE_KEY_PASSWORD_FILE:-}" && -f "$TAURI_UPDATER_PRIVATE_KEY_PASSWORD_FILE" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$TAURI_UPDATER_PRIVATE_KEY_PASSWORD_FILE")"
fi

if [[ ! -f node_modules/@heroui-pro/react/dist/index.d.ts ]]; then
  if [[ -z "${HEROUI_AUTH_TOKEN:-}" ]]; then
    echo "HeroUI Pro artifacts are missing. Set HEROUI_AUTH_TOKEN or create AgentBox-Apple/heroui.env." >&2
    exit 1
  fi

  echo "HeroUI Pro artifacts are missing; rebuilding @heroui-pro/react with CI auth..."
  pnpm rebuild @heroui-pro/react
fi

if [[ ! -f node_modules/@heroui-pro/react/dist/index.d.ts ]]; then
  echo "HeroUI Pro artifacts are still missing after rebuild." >&2
  exit 1
fi

echo
echo "==> Building Windows ARM64 target: $TARGET"
rm -rf "$CLIENT_DIR/src-tauri/target/$TARGET/release/bundle/nsis"
TAURI_TARGET_TRIPLE="$TARGET" pnpm tauri build --target "$TARGET" --bundles nsis

source_dir="$CLIENT_DIR/src-tauri/target/$TARGET/release/bundle/nsis"
output_dir="$ROOT_DIR/Build/output/$VERSION/windows/arm64/nsis"
setup_name="${PRODUCT_NAME}_${VERSION}_arm64-setup.exe"
setup_path="$source_dir/$setup_name"
signature_path="$setup_path.sig"

if [[ ! -f "$setup_path" || ! -f "$signature_path" ]]; then
  echo "Missing current Windows ARM64 NSIS artifacts:" >&2
  echo "  $setup_path" >&2
  echo "  $signature_path" >&2
  echo "Available NSIS artifacts:" >&2
  find "$source_dir" -maxdepth 1 -type f \( -name '*.exe' -o -name '*.exe.sig' \) -print >&2 2>/dev/null || true
  exit 1
fi

rm -rf "$output_dir"
mkdir -p "$output_dir"
cp "$setup_path" "$signature_path" "$output_dir/"

echo
echo "Windows ARM64 NSIS installers copied to Build/output:"
find "$output_dir" -maxdepth 1 -type f \( -name '*.exe' -o -name '*.exe.sig' \) -print | sort

if [[ -n "${HOST_UID:-}" && -n "${HOST_GID:-}" ]]; then
  chown -R "$HOST_UID:$HOST_GID" \
    "$ROOT_DIR/dist" \
    "$ROOT_DIR/Build/output" \
    "$ROOT_DIR/Server/internal/web/dist" \
    "$CLIENT_DIR/dist" \
    "$CLIENT_DIR/src-tauri/binaries" \
    "$CLIENT_DIR/src-tauri/target/$TARGET" \
    2>/dev/null || true
fi
