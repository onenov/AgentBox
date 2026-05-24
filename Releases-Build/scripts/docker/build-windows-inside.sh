#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/workspace"
CLIENT_DIR="$ROOT_DIR/Client"
WINDOWS_TARGETS="${WINDOWS_TARGETS:-x86_64-pc-windows-gnu}"

windows_arch_for_target() {
  case "$1" in
    x86_64-*) printf 'x64\n' ;;
    aarch64-*|arm64-*) printf 'arm64\n' ;;
    *) printf '%s\n' "$1" ;;
  esac
}

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

copy_current_nsis_artifacts() {
  local target="$1"
  local arch="$2"
  local source_dir="$CLIENT_DIR/src-tauri/target/$target/release/bundle/nsis"
  local output_dir="$ROOT_DIR/Build/output/$VERSION/windows/$arch/nsis"
  local setup_name="${PRODUCT_NAME}_${VERSION}_${arch}-setup.exe"
  local setup_path="$source_dir/$setup_name"
  local signature_path="$setup_path.sig"

  if [[ ! -f "$setup_path" || ! -f "$signature_path" ]]; then
    echo "Missing current Windows NSIS artifacts for $target:" >&2
    echo "  $setup_path" >&2
    echo "  $signature_path" >&2
    echo "Available NSIS artifacts:" >&2
    find "$source_dir" -maxdepth 1 -type f \( -name '*.exe' -o -name '*.exe.sig' \) -print >&2 2>/dev/null || true
    exit 1
  fi

  rm -rf "$output_dir"
  mkdir -p "$output_dir"
  cp "$setup_path" "$signature_path" "$output_dir/"
}

for target in $WINDOWS_TARGETS; do
  echo
  echo "==> Building Windows target: $target"
  rm -rf "$CLIENT_DIR/src-tauri/target/$target/release/bundle/nsis"
  TAURI_TARGET_TRIPLE="$target" pnpm tauri build --target "$target" --bundles nsis

  arch="$(windows_arch_for_target "$target")"
  copy_current_nsis_artifacts "$target" "$arch"
done

echo
echo "Windows NSIS installers copied to Build/output:"
for target in $WINDOWS_TARGETS; do
  arch="$(windows_arch_for_target "$target")"
  find "$ROOT_DIR/Build/output/$VERSION/windows/$arch/nsis" -maxdepth 1 -type f \( -name '*.exe' -o -name '*.exe.sig' \) -print | sort
done

if [[ -n "${HOST_UID:-}" && -n "${HOST_GID:-}" ]]; then
  chown_targets=(
    "$ROOT_DIR/dist"
    "$ROOT_DIR/Build/output"
    "$ROOT_DIR/Server/internal/web/dist"
    "$CLIENT_DIR/dist"
    "$CLIENT_DIR/src-tauri/binaries"
  )
  for target in $WINDOWS_TARGETS; do
    chown_targets+=("$CLIENT_DIR/src-tauri/target/$target")
  done

  chown -R "$HOST_UID:$HOST_GID" \
    "${chown_targets[@]}" \
    2>/dev/null || true
fi
