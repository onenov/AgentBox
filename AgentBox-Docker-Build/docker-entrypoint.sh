#!/bin/sh
set -eu
cd /

AGENTBOX_MANIFEST_URL="${AGENTBOX_MANIFEST_URL:-https://agent.orence.net/releases/latest.json}"
AGENTBOX_BIN="${AGENTBOX_BIN:-/opt/agentbox/bin/agentbox}"
AGENTBOX_STRICT_SHA256="${AGENTBOX_STRICT_SHA256:-0}"
AGENTBOX_AUTO_UPDATE="${AGENTBOX_AUTO_UPDATE:-1}"
AGENTBOX_UPDATE_INTERVAL_SECONDS="${AGENTBOX_UPDATE_INTERVAL_SECONDS:-3600}"
AGENTBOX_PID_FILE="${AGENTBOX_PID_FILE:-/tmp/agentbox.pid}"
AGENTBOX_DATA_ROOT="${AGENTBOX_DATA_ROOT:-/root/.AgentBox-Data}"
AGENTBOX_STATE_DIR="${AGENTBOX_STATE_DIR:-$AGENTBOX_DATA_ROOT/agentbox}"
OPENCLAW_DATA_DIR="${OPENCLAW_DATA_DIR:-$AGENTBOX_DATA_ROOT/openclaw}"
HERMES_DATA_DIR="${HERMES_DATA_DIR:-$AGENTBOX_DATA_ROOT/hermes}"
CC_CONNECT_DATA_DIR="${CC_CONNECT_DATA_DIR:-$AGENTBOX_DATA_ROOT/cc-connect}"
CODEX_DATA_DIR="${CODEX_DATA_DIR:-$AGENTBOX_DATA_ROOT/codex}"
CLAUDE_DATA_DIR="${CLAUDE_DATA_DIR:-$AGENTBOX_DATA_ROOT/claude}"
CACHE_DATA_DIR="${CACHE_DATA_DIR:-/var/cache/agentbox/root-cache}"
WEBDAV_ROOT="${WEBDAV_ROOT:-$AGENTBOX_DATA_ROOT}"
WEBDAV_ENABLED="${WEBDAV_ENABLED:-1}"
WEBDAV_ADDR="${WEBDAV_ADDR:-:80}"
WEBDAV_USER="${WEBDAV_USER:-}"
WEBDAV_PASS="${WEBDAV_PASS:-}"
OPENCLAW_GATEWAY_AUTOSTART="${OPENCLAW_GATEWAY_AUTOSTART:-1}"
OPENCLAW_GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
AGENTBOX_PUBLIC_URL="${AGENTBOX_PUBLIC_URL:-}"
AGENTBOX_CONTROL_UI_ORIGINS="${AGENTBOX_CONTROL_UI_ORIGINS:-}"
SKILLHUB_AUTO_INSTALL="${SKILLHUB_AUTO_INSTALL:-1}"
SKILLHUB_INSTALL_URL="${SKILLHUB_INSTALL_URL:-https://skillhub.cn/install/install.sh}"

ensure_data_link() {
  link_path="$1"
  target_path="$2"
  mkdir -p "$target_path"
  if [ -L "$link_path" ]; then
    current="$(readlink "$link_path")"
    if [ "$current" = "$target_path" ]; then
      return 0
    fi
    rm -f "$link_path"
  elif [ -e "$link_path" ]; then
    if [ -d "$link_path" ]; then
      cp -a "$link_path/." "$target_path/" 2>/dev/null || true
    fi
    rm -rf "$link_path"
  fi
  ln -s "$target_path" "$link_path"
}

mkdir -p \
  /opt/agentbox/bin \
  "$AGENTBOX_DATA_ROOT" \
  "$AGENTBOX_STATE_DIR" \
  "$OPENCLAW_DATA_DIR" \
  "$HERMES_DATA_DIR" \
  "$CC_CONNECT_DATA_DIR" \
  "$CODEX_DATA_DIR" \
  "$CLAUDE_DATA_DIR" \
  "$CACHE_DATA_DIR" \
  "$WEBDAV_ROOT" \
  /root/.npm-global

ensure_data_link /root/.openclaw "$OPENCLAW_DATA_DIR"
ensure_data_link /root/.hermes "$HERMES_DATA_DIR"
ensure_data_link /root/.cc-connect "$CC_CONNECT_DATA_DIR"
ensure_data_link /root/.codex "$CODEX_DATA_DIR"
ensure_data_link /root/.claude "$CLAUDE_DATA_DIR"
ensure_data_link /root/.cache "$CACHE_DATA_DIR"

export HOME="${HOME:-/root}"
export OPENCLAW_HOME="${OPENCLAW_HOME:-/root}"
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-/root/.npm-global}"
export HOMEBREW_PREFIX="${HOMEBREW_PREFIX:-/home/linuxbrew/.linuxbrew}"
export HOMEBREW_NO_ENV_HINTS="${HOMEBREW_NO_ENV_HINTS:-1}"
export NODE_COMPILE_CACHE="${NODE_COMPILE_CACHE:-/var/cache/agentbox/node-compile-cache}"
export AGENTBOX_CONTAINER="${AGENTBOX_CONTAINER:-1}"
export OPENCLAW_NO_RESPAWN="${OPENCLAW_NO_RESPAWN:-1}"
export OPENCLAW_GATEWAY_BIND="${OPENCLAW_GATEWAY_BIND:-lan}"
export OPENCLAW_GATEWAY_AUTOSTART
export PATH="/root/.local/bin:/root/.npm-global/bin:/opt/agentbox/bin:$PATH:$HOMEBREW_PREFIX/bin:$HOMEBREW_PREFIX/sbin"

download_file() {
  url="$1"
  dest="$2"
  curl -fsSL "$url" -o "$dest"
}

ensure_skillhub() {
  if [ "$SKILLHUB_AUTO_INSTALL" != "1" ]; then
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "Warning: curl is not available; skipping SkillHub runtime install." >&2
    return 0
  fi

  tmp_dir="$(mktemp -d)"
  script_path="$tmp_dir/install-skillhub.sh"
  log_path="$tmp_dir/install-skillhub.log"
  if download_file "$SKILLHUB_INSTALL_URL" "$script_path" && bash "$script_path" >"$log_path" 2>&1; then
    if command -v skillhub >/dev/null 2>&1; then
      version="$(skillhub --version 2>/dev/null | head -n 1 || true)"
      echo "SkillHub ready${version:+: $version}"
    else
      echo "SkillHub runtime install finished."
    fi
    rm -rf "$tmp_dir"
    return 0
  fi

  echo "Warning: SkillHub runtime install failed; continuing container startup." >&2
  tail -n 20 "$log_path" >&2 2>/dev/null || true
  rm -rf "$tmp_dir"
  return 0
}

detect_agentbox_arch() {
  case "$(uname -m)" in
    x86_64|amd64) printf '%s\n' x64 ;;
    aarch64|arm64) printf '%s\n' arm64 ;;
    *) echo "Unsupported AgentBox Linux architecture: $(uname -m)" >&2; exit 1 ;;
  esac
}

ensure_agentbox() {
  set +e
  update_agentbox_binary
  result="$?"
  set -e
  if [ "$result" = "0" ] || [ "$result" = "10" ]; then
    return 0
  fi
  return "$result"
}

update_agentbox_binary() {
  arch="$(detect_agentbox_arch)"
  tmp_dir="$(mktemp -d)"
  tmp_json="$tmp_dir/latest.json"
  tmp_bin="$tmp_dir/agentbox"
  next_bin="${AGENTBOX_BIN}.new"

  if ! download_file "$AGENTBOX_MANIFEST_URL" "$tmp_json"; then
    rm -rf "$tmp_dir"
    return 1
  fi

  manifest="$(node - "$arch" "$tmp_json" <<'NODE'
const fs = require('fs')
const arch = process.argv[2]
const file = process.argv[3]
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
const item = manifest.downloads?.linux?.[arch]
if (!item?.url) {
  console.error(`missing linux ${arch} AgentBox download in manifest`)
  process.exit(1)
}
console.log(JSON.stringify({
  version: manifest.version || '',
  url: item.url,
  sha256: item.sha256 || '',
}))
NODE
)" || {
    rm -rf "$tmp_dir"
    return 1
  }

  version="$(node -e 'console.log(JSON.parse(process.argv[1]).version)' "$manifest")"
  url="$(node -e 'console.log(JSON.parse(process.argv[1]).url)' "$manifest")"
  sha256="$(node -e 'console.log(JSON.parse(process.argv[1]).sha256)' "$manifest")"
  marker="${AGENTBOX_BIN}.version"

  if [ -x "$AGENTBOX_BIN" ] && [ -f "$marker" ] && [ "$(cat "$marker")" = "$version $sha256" ]; then
    echo "AgentBox is up to date: ${version:-unknown}"
    rm -rf "$tmp_dir"
    return 0
  fi

  echo "Installing AgentBox ${version:-latest} from $url"
  if ! download_file "$url" "$tmp_bin"; then
    rm -rf "$tmp_dir"
    return 1
  fi
  if [ -n "$sha256" ]; then
    if ! printf '%s  %s\n' "$sha256" "$tmp_bin" | sha256sum -c -; then
      if [ "$AGENTBOX_STRICT_SHA256" = "1" ]; then
        echo "AgentBox sha256 verification failed" >&2
        rm -rf "$tmp_dir"
        return 1
      fi
      echo "Warning: AgentBox sha256 verification failed, continuing because AGENTBOX_STRICT_SHA256 is not enabled" >&2
    fi
  fi
  chmod 755 "$tmp_bin"
  cp "$tmp_bin" "$next_bin"
  chmod 755 "$next_bin"
  mv -f "$next_bin" "$AGENTBOX_BIN"
  printf '%s %s\n' "$version" "$sha256" > "$marker"
  echo "AgentBox installed: $AGENTBOX_BIN"
  rm -rf "$tmp_dir"
  return 10
}

start_webdav() {
  if [ "$WEBDAV_ENABLED" != "1" ]; then
    return 0
  fi

  args="serve webdav $WEBDAV_ROOT --addr $WEBDAV_ADDR --vfs-cache-mode off"
  if [ -n "$WEBDAV_USER" ] || [ -n "$WEBDAV_PASS" ]; then
    args="$args --user $WEBDAV_USER --pass $WEBDAV_PASS"
  fi

  echo "Starting WebDAV on $WEBDAV_ADDR for $WEBDAV_ROOT"
  # shellcheck disable=SC2086
  rclone $args &
  WEBDAV_PID="$!"
}

openclaw_gateway_pid() {
  lsof -tiTCP:"$OPENCLAW_GATEWAY_PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

patch_openclaw_container_config() {
  config_path="/root/.openclaw/openclaw.json"
  [ -f "$config_path" ] || return 1
  node - "$config_path" "$OPENCLAW_GATEWAY_PORT" <<'NODE'
const fs = require('fs')
const file = process.argv[2]
const port = Number(process.argv[3]) || 18789
const rawOrigins = [
  process.env.AGENTBOX_PUBLIC_URL || '',
  process.env.AGENTBOX_PUBLIC_ORIGIN || '',
  process.env.OPENCLAW_PUBLIC_GATEWAY_URL || '',
  process.env.AGENTBOX_CONTROL_UI_ORIGINS || '',
]
let data = {}
try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'))
} catch {
  data = {}
}
data.gateway = data.gateway && typeof data.gateway === 'object' && !Array.isArray(data.gateway) ? data.gateway : {}
let changed = false
if (data.gateway.bind !== 'lan') {
  data.gateway.bind = 'lan'
  changed = true
}
if (data.gateway.port !== port) {
  data.gateway.port = port
  changed = true
}
if (!data.gateway.mode) {
  data.gateway.mode = 'local'
  changed = true
}
data.gateway.controlUi = data.gateway.controlUi && typeof data.gateway.controlUi === 'object' && !Array.isArray(data.gateway.controlUi) ? data.gateway.controlUi : {}
const currentOrigins = Array.isArray(data.gateway.controlUi.allowedOrigins) ? data.gateway.controlUi.allowedOrigins : []
const origins = new Set(currentOrigins)
for (const value of rawOrigins.flatMap((item) => item.split(','))) {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) continue
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'tauri:') continue
    const origin = `${parsed.protocol}//${parsed.host}`
    if (!origins.has(origin)) {
      origins.add(origin)
      changed = true
    }
  } catch {}
}
if (data.gateway.controlUi.allowedOrigins?.length !== origins.size) {
  data.gateway.controlUi.allowedOrigins = [...origins]
  changed = true
}
if (changed) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
}
NODE
}

start_openclaw_gateway_process() {
  mkdir -p /root/.openclaw/logs "$NODE_COMPILE_CACHE"
  echo "Starting OpenClaw Gateway on port $OPENCLAW_GATEWAY_PORT"
  (
    export NODE_COMPILE_CACHE OPENCLAW_NO_RESPAWN OPENCLAW_GATEWAY_BIND OPENCLAW_GATEWAY_PORT
    exec openclaw gateway run
  ) >> /root/.openclaw/logs/gateway.err.log 2>&1 &
  date +%s > /tmp/openclaw-gateway-started-at
}

start_openclaw_gateway_supervisor() {
  if [ "$OPENCLAW_GATEWAY_AUTOSTART" != "1" ]; then
    return 0
  fi

  (
    last_config_mtime=0
    while true; do
      if command -v openclaw >/dev/null 2>&1 && [ -f /root/.openclaw/openclaw.json ]; then
        patch_openclaw_container_config || true
        config_mtime="$(stat -c %Y /root/.openclaw/openclaw.json 2>/dev/null || echo 0)"
        pid="$(openclaw_gateway_pid)"
        if [ -z "$pid" ]; then
          start_openclaw_gateway_process
          last_config_mtime="$config_mtime"
        elif [ "$config_mtime" != "0" ] && [ "$last_config_mtime" != "0" ] && [ "$config_mtime" -gt "$last_config_mtime" ]; then
          echo "OpenClaw config changed; restarting Gateway process"
          kill "$pid" >/dev/null 2>&1 || true
          sleep 1
          start_openclaw_gateway_process
          last_config_mtime="$config_mtime"
        elif [ "$last_config_mtime" = "0" ]; then
          last_config_mtime="$config_mtime"
        fi
      fi
      sleep 2
    done
  ) &
  OPENCLAW_GATEWAY_SUPERVISOR_PID="$!"
}

stop_children() {
  if [ -n "${AGENTBOX_UPDATE_TIMER_PID:-}" ]; then
    kill "$AGENTBOX_UPDATE_TIMER_PID" >/dev/null 2>&1 || true
  fi
  current_agentbox_pid="${AGENTBOX_PID:-}"
  if [ -z "$current_agentbox_pid" ] && [ -f "$AGENTBOX_PID_FILE" ]; then
    current_agentbox_pid="$(cat "$AGENTBOX_PID_FILE" 2>/dev/null || true)"
  fi
  if [ -n "$current_agentbox_pid" ]; then
    kill "$current_agentbox_pid" >/dev/null 2>&1 || true
  fi
  if [ -n "${WEBDAV_PID:-}" ]; then
    kill "$WEBDAV_PID" >/dev/null 2>&1 || true
  fi
  if [ -n "${OPENCLAW_GATEWAY_SUPERVISOR_PID:-}" ]; then
    kill "$OPENCLAW_GATEWAY_SUPERVISOR_PID" >/dev/null 2>&1 || true
  fi
}

start_agentbox_update_timer() {
  if [ "$AGENTBOX_AUTO_UPDATE" != "1" ]; then
    echo "AgentBox auto update timer disabled."
    return 0
  fi

  (
    while true; do
      sleep "$AGENTBOX_UPDATE_INTERVAL_SECONDS"
      echo "Checking AgentBox update from timer..."
      set +e
      update_agentbox_binary
      result="$?"
      set -e
      if [ "$result" = "10" ]; then
        echo "AgentBox binary updated; restarting AgentBox process."
        current_agentbox_pid="$(cat "$AGENTBOX_PID_FILE" 2>/dev/null || true)"
        if [ -n "$current_agentbox_pid" ]; then
          kill -INT "$current_agentbox_pid" >/dev/null 2>&1 || true
        fi
      elif [ "$result" != "0" ]; then
        echo "AgentBox update check failed with status $result" >&2
      fi
    done
  ) &
  AGENTBOX_UPDATE_TIMER_PID="$!"
}

start_agentbox_process() {
  echo "Starting AgentBox: $AGENTBOX_BIN"
  "$AGENTBOX_BIN" "$@" &
  AGENTBOX_PID="$!"
  printf '%s\n' "$AGENTBOX_PID" > "$AGENTBOX_PID_FILE"
}

STOP_REQUESTED=0

handle_stop() {
  STOP_REQUESTED=1
  stop_children
}

trap handle_stop INT TERM EXIT

ensure_skillhub
ensure_agentbox
start_webdav
start_openclaw_gateway_supervisor
start_agentbox_update_timer

while true; do
  start_agentbox_process "$@"
  AGENTBOX_STATUS=0
  wait "$AGENTBOX_PID" || AGENTBOX_STATUS="$?"
  AGENTBOX_PID=""
  rm -f "$AGENTBOX_PID_FILE"

  if [ "$STOP_REQUESTED" = "1" ]; then
    exit "$AGENTBOX_STATUS"
  fi

  echo "AgentBox process exited with status $AGENTBOX_STATUS; restarting."
  sleep 1
done
