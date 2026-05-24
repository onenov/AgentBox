#!/bin/sh
set -eu

AGENTBOX_MANIFEST_URL="${AGENTBOX_MANIFEST_URL:-https://agent.orence.net/releases/latest.json}"
AGENTBOX_INSTALL_DIR="${AGENTBOX_INSTALL_DIR:-/opt/agentbox}"
AGENTBOX_BIN="${AGENTBOX_BIN:-$AGENTBOX_INSTALL_DIR/bin/agentbox}"
if [ -n "${AGENTBOX_DATA_ROOT:-}" ]; then
  AGENTBOX_DATA_ROOT_EXPLICIT=1
else
  AGENTBOX_DATA_ROOT="$AGENTBOX_INSTALL_DIR/data"
  AGENTBOX_DATA_ROOT_EXPLICIT=0
fi
AGENTBOX_CONFIG_DIR="${AGENTBOX_CONFIG_DIR:-/etc/agentbox}"
AGENTBOX_SERVICE_NAME="${AGENTBOX_SERVICE_NAME:-agentbox}"
AGENTBOX_USER="${AGENTBOX_USER:-root}"
AGENTBOX_GROUP="${AGENTBOX_GROUP:-root}"
AGENTBOX_SERVER_HOST="${AGENTBOX_SERVER_HOST:-0.0.0.0}"
AGENTBOX_SERVER_PORT="${AGENTBOX_SERVER_PORT:-8787}"
AGENTBOX_LOG_LEVEL="${AGENTBOX_LOG_LEVEL:-info}"
AGENTBOX_STRICT_SHA256="${AGENTBOX_STRICT_SHA256:-1}"
AGENTBOX_START_SERVICE="${AGENTBOX_START_SERVICE:-1}"
AGENTBOX_AUTO_UPDATE="${AGENTBOX_AUTO_UPDATE:-1}"
AGENTBOX_UPDATE_ON_BOOT_SEC="${AGENTBOX_UPDATE_ON_BOOT_SEC:-2min}"
AGENTBOX_UPDATE_INTERVAL="${AGENTBOX_UPDATE_INTERVAL:-1h}"
AGENTBOX_PUBLIC_URL="${AGENTBOX_PUBLIC_URL:-}"
AGENTBOX_AUTH_TOKEN="${AGENTBOX_AUTH_TOKEN:-${AUTH_DEFAULT_TOKEN:-}}"
AGENTBOX_MACOS_APP_DIR="${AGENTBOX_MACOS_APP_DIR:-/Applications}"
AGENTBOX_MACOS_APP_NAME="${AGENTBOX_MACOS_APP_NAME:-AgentBox.app}"
AGENTBOX_ACTION=install
AGENTBOX_DRY_RUN=0
AGENTBOX_PURGE=0
AGENTBOX_FORCE_INSTALL="${AGENTBOX_FORCE_INSTALL:-0}"

usage() {
  cat <<EOF
AgentBox 非 Docker 安装器

用法：
  sh Install/install.sh [options]

选项：
  --manifest-url URL   使用自定义更新清单。
  --install-dir DIR    Linux 安装目录。默认：/opt/agentbox
  --data-root DIR      Linux 数据目录。默认：/opt/agentbox/data
  --service-name NAME  Linux systemd 服务名。默认：agentbox
  --user USER          Linux 服务用户。默认：root
  --group GROUP        Linux 服务用户组。默认：root
  --port PORT          Linux AgentBox 监听端口。默认：8787
  --no-start           安装或更新后不启动 systemd 服务。
  --no-auto-update     不启用 Linux systemd 自动更新定时器。
  --update-interval X  Linux 自动更新检查间隔。默认：1h
  --public-url URL     输出登录链接时使用的公网地址。
  --token TOKEN        设置后端访问 token；不传则自动生成。
  --force              即使版本一致也重新下载并覆盖安装。
  --restart            安装或覆盖后自动重启服务。默认启用。
  --no-restart         安装或覆盖后不自动重启服务。
  --macos-app-dir DIR  macOS 应用安装目录。默认：/Applications
  --macos-app-name APP macOS 应用名称。默认：AgentBox.app
  --cat                查看当前 Linux 安装、服务、更新器和访问状态。
  --uninstall          停止服务并移除 AgentBox 程序文件。
  --purge              配合 --uninstall 使用，同时删除配置和数据。
  --dry-run            只获取清单并打印计划执行的操作。
  -h, --help           显示帮助。

也可以通过 AGENTBOX_ 前缀的环境变量覆盖默认值。
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest-url)
      AGENTBOX_MANIFEST_URL="${2:-}"
      shift 2
      ;;
    --install-dir)
      AGENTBOX_INSTALL_DIR="${2:-}"
      AGENTBOX_BIN="$AGENTBOX_INSTALL_DIR/bin/agentbox"
      if [ "$AGENTBOX_DATA_ROOT_EXPLICIT" = "0" ]; then
        AGENTBOX_DATA_ROOT="$AGENTBOX_INSTALL_DIR/data"
      fi
      shift 2
      ;;
    --data-root)
      AGENTBOX_DATA_ROOT="${2:-}"
      AGENTBOX_DATA_ROOT_EXPLICIT=1
      shift 2
      ;;
    --service-name)
      AGENTBOX_SERVICE_NAME="${2:-}"
      shift 2
      ;;
    --user)
      AGENTBOX_USER="${2:-}"
      shift 2
      ;;
    --group)
      AGENTBOX_GROUP="${2:-}"
      shift 2
      ;;
    --port)
      AGENTBOX_SERVER_PORT="${2:-}"
      shift 2
      ;;
    --no-start)
      AGENTBOX_START_SERVICE=0
      shift
      ;;
    --no-auto-update)
      AGENTBOX_AUTO_UPDATE=0
      shift
      ;;
    --update-interval)
      AGENTBOX_UPDATE_INTERVAL="${2:-}"
      shift 2
      ;;
    --public-url)
      AGENTBOX_PUBLIC_URL="${2:-}"
      shift 2
      ;;
    --token)
      AGENTBOX_AUTH_TOKEN="${2:-}"
      shift 2
      ;;
    --force|--force-install)
      AGENTBOX_FORCE_INSTALL=1
      shift
      ;;
    --restart)
      AGENTBOX_START_SERVICE=1
      shift
      ;;
    --no-restart)
      AGENTBOX_START_SERVICE=0
      shift
      ;;
    --macos-app-dir)
      AGENTBOX_MACOS_APP_DIR="${2:-}"
      shift 2
      ;;
    --macos-app-name)
      AGENTBOX_MACOS_APP_NAME="${2:-}"
      shift 2
      ;;
    --cat|--status)
      AGENTBOX_ACTION=cat
      shift
      ;;
    --uninstall)
      AGENTBOX_ACTION=uninstall
      shift
      ;;
    --purge)
      AGENTBOX_PURGE=1
      shift
      ;;
    --dry-run)
      AGENTBOX_DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知选项：$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$AGENTBOX_MANIFEST_URL" ] || [ -z "$AGENTBOX_INSTALL_DIR" ] || [ -z "$AGENTBOX_DATA_ROOT" ]; then
  echo "更新清单地址、安装目录和数据目录不能为空。" >&2
  exit 2
fi

log() {
  printf '%s\n' "$*"
}

title() {
  log ""
  log "============================================================"
  log "$*"
  log "============================================================"
}

section() {
  log ""
  log "$*"
  log "------------------------------------------------------------"
}

step() {
  log ""
  log "==> $*"
}

ok() {
  log "完成：$*"
}

info() {
  log "  - $*"
}

warn() {
  printf '警告：%s\n' "$*" >&2
}

fail() {
  echo "错误：$*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

make_tmp_dir() {
  if command_exists mktemp; then
    mktemp -d 2>/dev/null || mktemp -d -t agentbox
  else
    dir="${TMPDIR:-/tmp}/agentbox-install.$$"
    mkdir -p "$dir"
    printf '%s\n' "$dir"
  fi
}

TMP_DIR="$(make_tmp_dir)"
MANIFEST_FILE="$TMP_DIR/latest.json"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

ps_escape() {
  printf '%s' "$1" | sed "s/'/''/g"
}

download_file() {
  url="$1"
  dest="$2"

  if command_exists curl; then
    curl -fsSL --retry 3 --connect-timeout 20 "$url" -o "$dest"
    return
  fi

  if command_exists wget; then
    wget -q -O "$dest" "$url"
    return
  fi

  case "$(uname -s 2>/dev/null || printf unknown)" in
    MINGW*|MSYS*|CYGWIN*)
      if command_exists powershell.exe; then
        win_dest="$dest"
        if command_exists cygpath; then
          win_dest="$(cygpath -w "$dest")"
        fi
        ps_url="$(ps_escape "$url")"
        ps_dest="$(ps_escape "$win_dest")"
        powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '$ps_url' -OutFile '$ps_dest'"
        return
      fi
      ;;
  esac

  fail "需要安装 curl 或 wget 才能下载文件。"
}

json_get_with_python() {
  python3 - "$MANIFEST_FILE" "$1" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    value = json.load(handle)

for part in sys.argv[2].split("."):
    if isinstance(value, dict) and part in value:
        value = value[part]
    else:
        sys.exit(1)

if value is None:
    sys.exit(1)
if isinstance(value, (dict, list)):
    print(json.dumps(value, separators=(",", ":")))
else:
    print(value)
PY
}

json_get_with_node() {
  node - "$MANIFEST_FILE" "$1" <<'NODE'
const fs = require('fs')
let value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
for (const part of process.argv[3].split('.')) {
  if (!value || typeof value !== 'object' || !(part in value)) process.exit(1)
  value = value[part]
}
if (value === null || value === undefined) process.exit(1)
if (typeof value === 'object') console.log(JSON.stringify(value))
else console.log(String(value))
NODE
}

json_get_with_jq() {
  jq -er --arg path "$1" 'getpath($path | split(".")) as $value | if $value == null then empty else $value end' "$MANIFEST_FILE"
}

json_get_fallback() {
  path="$1"
  compact="$(tr -d '\n\r\t ' < "$MANIFEST_FILE")"
  case "$path" in
    version)
      printf '%s\n' "$compact" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p'
      ;;
    downloads.linux.*.url)
      arch="${path#downloads.linux.}"
      arch="${arch%.url}"
      printf '%s\n' "$compact" | sed -n "s/.*\"downloads\":{\"linux\":{.*\"$arch\":{[^}]*\"url\":\"\\([^\"]*\\)\".*/\\1/p"
      ;;
    downloads.linux.*.sha256)
      arch="${path#downloads.linux.}"
      arch="${arch%.sha256}"
      printf '%s\n' "$compact" | sed -n "s/.*\"downloads\":{\"linux\":{.*\"$arch\":{[^}]*\"sha256\":\"\\([^\"]*\\)\".*/\\1/p"
      ;;
    platforms.*.url)
      platform="${path#platforms.}"
      platform="${platform%.url}"
      printf '%s\n' "$compact" | sed -n "s/.*\"$platform\":{[^}]*\"url\":\"\\([^\"]*\\)\".*/\\1/p"
      ;;
    platforms.*.appTarGzUrl)
      platform="${path#platforms.}"
      platform="${platform%.appTarGzUrl}"
      printf '%s\n' "$compact" | sed -n "s/.*\"$platform\":{[^}]*\"appTarGzUrl\":\"\\([^\"]*\\)\".*/\\1/p"
      ;;
    platforms.*.tarGzUrl)
      platform="${path#platforms.}"
      platform="${platform%.tarGzUrl}"
      printf '%s\n' "$compact" | sed -n "s/.*\"$platform\":{[^}]*\"tarGzUrl\":\"\\([^\"]*\\)\".*/\\1/p"
      ;;
    platforms.*.dmgurl)
      platform="${path#platforms.}"
      platform="${platform%.dmgurl}"
      printf '%s\n' "$compact" | sed -n "s/.*\"$platform\":{[^}]*\"dmgurl\":\"\\([^\"]*\\)\".*/\\1/p"
      ;;
    platforms.*.sha256)
      platform="${path#platforms.}"
      platform="${platform%.sha256}"
      printf '%s\n' "$compact" | sed -n "s/.*\"$platform\":{[^}]*\"sha256\":\"\\([^\"]*\\)\".*/\\1/p"
      ;;
  esac
}

json_get() {
  key="$1"
  if command_exists python3; then
    json_get_with_python "$key" && return 0
  fi
  if command_exists node; then
    json_get_with_node "$key" && return 0
  fi
  if command_exists jq; then
    json_get_with_jq "$key" && return 0
  fi
  value="$(json_get_fallback "$key" || true)"
  if [ -n "$value" ]; then
    printf '%s\n' "$value"
    return 0
  fi
  return 1
}

detect_os() {
  case "$(uname -s 2>/dev/null || printf unknown)" in
    Linux) printf '%s\n' linux ;;
    Darwin) printf '%s\n' macos ;;
    MINGW*|MSYS*|CYGWIN*) printf '%s\n' windows ;;
    *) fail "不支持的操作系统：$(uname -s 2>/dev/null || printf unknown)" ;;
  esac
}

detect_agentbox_arch() {
  case "$(uname -m 2>/dev/null || printf unknown)" in
    x86_64|amd64) printf '%s\n' x64 ;;
    aarch64|arm64) printf '%s\n' arm64 ;;
    *) fail "不支持的架构：$(uname -m 2>/dev/null || printf unknown)" ;;
  esac
}

desktop_platform_key() {
  os="$1"
  arch="$2"
  case "$os:$arch" in
    macos:x64) printf '%s\n' darwin-x86_64 ;;
    macos:arm64) printf '%s\n' darwin-aarch64 ;;
    windows:x64) printf '%s\n' windows-x86_64 ;;
    windows:arm64) printf '%s\n' windows-aarch64 ;;
    *) fail "不支持的桌面目标：$os/$arch" ;;
  esac
}

verify_sha256() {
  expected="$1"
  file="$2"

  [ -n "$expected" ] || return 0

  if command_exists sha256sum; then
    printf '%s  %s\n' "$expected" "$file" | sha256sum -c - >/dev/null
    return
  fi

  if command_exists shasum; then
    actual="$(shasum -a 256 "$file" | awk '{print $1}')"
    [ "$actual" = "$expected" ]
    return
  fi

  if command_exists openssl; then
    actual="$(openssl dgst -sha256 "$file" | awk '{print $NF}')"
    [ "$actual" = "$expected" ]
    return
  fi

  if [ "$AGENTBOX_STRICT_SHA256" = "1" ]; then
    fail "未找到 sha256 校验工具，请安装 sha256sum、shasum 或 openssl。"
  fi

  warn "未找到 sha256 校验工具，已跳过校验。"
}

ensure_linux_root() {
  if [ "$(id -u)" -eq 0 ]; then
    return
  fi

  if ! command_exists sudo; then
    fail "Linux 安装需要 root 权限，请使用 sudo 重新执行。"
  fi

  step "正在使用 sudo 重新执行 Linux 安装器"
  exec sudo env \
    AGENTBOX_MANIFEST_URL="$AGENTBOX_MANIFEST_URL" \
    AGENTBOX_INSTALL_DIR="$AGENTBOX_INSTALL_DIR" \
    AGENTBOX_BIN="$AGENTBOX_BIN" \
    AGENTBOX_DATA_ROOT="$AGENTBOX_DATA_ROOT" \
    AGENTBOX_CONFIG_DIR="$AGENTBOX_CONFIG_DIR" \
    AGENTBOX_SERVICE_NAME="$AGENTBOX_SERVICE_NAME" \
    AGENTBOX_USER="$AGENTBOX_USER" \
    AGENTBOX_GROUP="$AGENTBOX_GROUP" \
    AGENTBOX_SERVER_HOST="$AGENTBOX_SERVER_HOST" \
    AGENTBOX_SERVER_PORT="$AGENTBOX_SERVER_PORT" \
    AGENTBOX_LOG_LEVEL="$AGENTBOX_LOG_LEVEL" \
    AGENTBOX_STRICT_SHA256="$AGENTBOX_STRICT_SHA256" \
    AGENTBOX_START_SERVICE="$AGENTBOX_START_SERVICE" \
    AGENTBOX_AUTO_UPDATE="$AGENTBOX_AUTO_UPDATE" \
    AGENTBOX_UPDATE_ON_BOOT_SEC="$AGENTBOX_UPDATE_ON_BOOT_SEC" \
    AGENTBOX_UPDATE_INTERVAL="$AGENTBOX_UPDATE_INTERVAL" \
    AGENTBOX_PUBLIC_URL="$AGENTBOX_PUBLIC_URL" \
    AGENTBOX_AUTH_TOKEN="$AGENTBOX_AUTH_TOKEN" \
    AGENTBOX_ACTION="$AGENTBOX_ACTION" \
    AGENTBOX_PURGE="$AGENTBOX_PURGE" \
    AGENTBOX_FORCE_INSTALL="$AGENTBOX_FORCE_INSTALL" \
    sh "$0" "$@"
}

ensure_linux_account() {
  if [ "$AGENTBOX_USER" = "root" ] && [ "$AGENTBOX_GROUP" = "root" ]; then
    return
  fi

  if ! getent group "$AGENTBOX_GROUP" >/dev/null 2>&1; then
    groupadd --system "$AGENTBOX_GROUP"
  fi

  if ! id "$AGENTBOX_USER" >/dev/null 2>&1; then
    useradd --system \
      --gid "$AGENTBOX_GROUP" \
      --home-dir "$AGENTBOX_DATA_ROOT" \
      --create-home \
      --shell /usr/sbin/nologin \
      "$AGENTBOX_USER"
  fi
}

ensure_systemd_available() {
  if ! command_exists systemctl; then
    fail "未找到 systemctl。Linux 非 Docker 安装需要 systemd。"
  fi

  if ! systemctl list-unit-files >/dev/null 2>&1; then
    fail "当前 Linux 主机未运行 systemd，或 systemd 不可用。"
  fi
}

generate_auth_token() {
  if [ -n "$AGENTBOX_AUTH_TOKEN" ]; then
    printf '%s\n' "$AGENTBOX_AUTH_TOKEN"
    return
  fi

  if command_exists openssl; then
    openssl rand -hex 32
    return
  fi

  if [ -r /dev/urandom ]; then
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
    printf '\n'
    return
  fi

  fail "无法生成访问 token。请安装 openssl，或通过 --token TOKEN 指定。"
}

read_auth_token_from_file() {
  auth_file="$1"
  [ -f "$auth_file" ] || return 1

  if command_exists python3; then
    python3 - "$auth_file" <<'PY' && return 0
import json
import sys
try:
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        print((json.load(handle).get("token") or "").strip())
except Exception:
    sys.exit(1)
PY
  fi

  if command_exists node; then
    node - "$auth_file" <<'NODE' && return 0
const fs = require('fs')
try {
  const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  console.log(String(data.token || '').trim())
} catch {
  process.exit(1)
}
NODE
  fi

  sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$auth_file" | head -n 1
}

write_auth_config_file() {
  auth_file="$1"
  backend_address="$2"
  token="$3"
  updated_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

  mkdir -p "$(dirname "$auth_file")"
  cat > "$auth_file" <<EOF
{
  "backendAddress": "$backend_address",
  "token": "$token",
  "updatedAt": "$updated_at"
}
EOF
  chmod 0600 "$auth_file"
}

normalize_url_base() {
  printf '%s\n' "$1" | sed 's#/*$##'
}

login_url() {
  base="$(normalize_url_base "$1")"
  token="$2"
  printf '%s/login?token=%s&persistence=persistent\n' "$base" "$token"
}

detect_private_ip() {
  if command_exists ip; then
    ip route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") {print $(i + 1); exit}}'
    return
  fi

  if command_exists hostname; then
    hostname -I 2>/dev/null | awk '{print $1}'
  fi
}

detect_public_ip() {
  if ! command_exists curl; then
    return 0
  fi

  curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null ||
    curl -fsS --max-time 3 https://ifconfig.me 2>/dev/null ||
    true
}

print_linux_access_links() {
  token="$1"
  private_ip="$(detect_private_ip || true)"
  public_ip=""

  section "AgentBox 访问地址"
  info "本机：$(login_url "http://127.0.0.1:$AGENTBOX_SERVER_PORT" "$token")"

  if [ -n "$private_ip" ]; then
    info "内网：$(login_url "http://$private_ip:$AGENTBOX_SERVER_PORT" "$token")"
  fi

  if [ -n "$AGENTBOX_PUBLIC_URL" ]; then
    info "公网：$(login_url "$AGENTBOX_PUBLIC_URL" "$token")"
  else
    public_ip="$(detect_public_ip || true)"
    if [ -n "$public_ip" ]; then
      info "公网：$(login_url "http://$public_ip:$AGENTBOX_SERVER_PORT" "$token")"
    else
      info "公网：设置 AGENTBOX_PUBLIC_URL 或传入 --public-url 后可输出公网登录链接。"
    fi
  fi

  section "后端访问 token"
  info "$token"
}

read_linux_env_value() {
  env_file="$1"
  key="$2"
  [ -f "$env_file" ] || return 1
  sed -n "s/^$key=//p" "$env_file" | tail -n 1
}

read_unit_value() {
  unit_file="$1"
  key="$2"
  [ -f "$unit_file" ] || return 1
  sed -n "s/^$key=//p" "$unit_file" | tail -n 1
}

print_kv() {
  key="$1"
  value="$2"
  [ -n "$value" ] || value="未检测到"
  printf '  %-18s %s\n' "$key" "$value"
}

linux_service_value() {
  key="$1"
  systemctl show "$AGENTBOX_SERVICE_NAME" -p "$key" --value 2>/dev/null || true
}

detect_node_with_path() {
  env_path="$1"
  [ -n "$env_path" ] || return 1
  PATH="$env_path" sh -c 'node_path="$(command -v node 2>/dev/null || true)"; [ -n "$node_path" ] || exit 1; node_version="$("$node_path" -v 2>/dev/null || true)"; printf "%s %s\n" "$node_path" "$node_version"'
}

cat_linux_status() {
  env_file="$AGENTBOX_CONFIG_DIR/agentbox.env"
  service_file="/etc/systemd/system/$AGENTBOX_SERVICE_NAME.service"
  updater_service_file="/etc/systemd/system/${AGENTBOX_SERVICE_NAME}-updater.service"
  updater_timer_file="/etc/systemd/system/${AGENTBOX_SERVICE_NAME}-updater.timer"
  marker="$AGENTBOX_BIN.version"
  env_data_root="$(read_linux_env_value "$env_file" AGENTBOX_DATA_ROOT 2>/dev/null || true)"
  env_port="$(read_linux_env_value "$env_file" SERVER_PORT 2>/dev/null || true)"
  env_public_url="$(read_linux_env_value "$env_file" AGENTBOX_PUBLIC_URL 2>/dev/null || true)"
  env_auth_path="$(read_linux_env_value "$env_file" AUTH_CONFIG_PATH 2>/dev/null || true)"
  env_manifest_url="$(read_linux_env_value "$env_file" AGENTBOX_MANIFEST_URL 2>/dev/null || true)"
  env_path="$(read_linux_env_value "$env_file" PATH 2>/dev/null || true)"
  timer_interval="$(read_unit_value "$updater_timer_file" OnUnitActiveSec 2>/dev/null || true)"
  timer_boot_sec="$(read_unit_value "$updater_timer_file" OnBootSec 2>/dev/null || true)"

  [ -n "$env_data_root" ] && AGENTBOX_DATA_ROOT="$env_data_root"
  [ -n "$env_port" ] && AGENTBOX_SERVER_PORT="$env_port"
  [ -n "$env_public_url" ] && AGENTBOX_PUBLIC_URL="$env_public_url"
  [ -n "$env_manifest_url" ] && AGENTBOX_MANIFEST_URL="$env_manifest_url"
  [ -n "$env_auth_path" ] || env_auth_path="$AGENTBOX_DATA_ROOT/agentbox/auth.json"
  [ -n "$timer_interval" ] && AGENTBOX_UPDATE_INTERVAL="$timer_interval"

  title "AgentBox 当前状态"

  section "安装信息"
  print_kv "服务名" "$AGENTBOX_SERVICE_NAME"
  print_kv "更新清单" "$AGENTBOX_MANIFEST_URL"
  print_kv "程序路径" "$AGENTBOX_BIN"
  if [ -x "$AGENTBOX_BIN" ]; then
    print_kv "程序文件" "存在，且可执行"
  elif [ -f "$AGENTBOX_BIN" ]; then
    print_kv "程序文件" "存在，但不可执行"
  else
    print_kv "程序文件" "未安装"
  fi
  if [ -f "$marker" ]; then
    print_kv "安装版本" "$(cat "$marker" 2>/dev/null || true)"
  else
    print_kv "安装版本" "未找到版本标记"
  fi
  print_kv "数据目录" "$AGENTBOX_DATA_ROOT"
  print_kv "配置文件" "$env_file"

  section "systemd 服务"
  if command_exists systemctl; then
    print_kv "服务状态" "$(systemctl is-active "$AGENTBOX_SERVICE_NAME" 2>/dev/null || printf unknown)"
    print_kv "开机自启" "$(systemctl is-enabled "$AGENTBOX_SERVICE_NAME" 2>/dev/null || printf disabled)"
    print_kv "主进程 PID" "$(linux_service_value MainPID)"
    print_kv "服务用户" "$(linux_service_value User)"
    print_kv "服务用户组" "$(linux_service_value Group)"
  else
    print_kv "服务状态" "未找到 systemctl"
  fi
  print_kv "服务文件" "$service_file"

  section "自动更新"
  if command_exists systemctl; then
    print_kv "Timer 状态" "$(systemctl is-active "${AGENTBOX_SERVICE_NAME}-updater.timer" 2>/dev/null || printf unknown)"
    print_kv "Timer 自启" "$(systemctl is-enabled "${AGENTBOX_SERVICE_NAME}-updater.timer" 2>/dev/null || printf disabled)"
  else
    print_kv "Timer 状态" "未找到 systemctl"
  fi
  print_kv "更新任务" "$updater_service_file"
  print_kv "更新定时器" "$updater_timer_file"
  print_kv "开机延迟" "$timer_boot_sec"
  print_kv "检查间隔" "$AGENTBOX_UPDATE_INTERVAL"

  section "Node 环境"
  shell_node="$(command -v node 2>/dev/null || true)"
  if [ -n "$shell_node" ]; then
    print_kv "当前 shell" "$shell_node $(node -v 2>/dev/null || true)"
  else
    print_kv "当前 shell" "未检测到 node"
  fi
  service_node="$(detect_node_with_path "$env_path" 2>/dev/null || true)"
  if [ -n "$service_node" ]; then
    print_kv "服务 PATH" "$service_node"
  else
    print_kv "服务 PATH" "未检测到 node"
  fi

  token="$(read_auth_token_from_file "$env_auth_path" 2>/dev/null || true)"
  if [ -n "$token" ]; then
    print_linux_access_links "$token"
  else
    section "AgentBox 访问地址"
    info "未能读取 token：$env_auth_path"
    info "如果当前用户不是 root，请使用 sudo 重新执行 --cat。"
  fi
}

write_linux_env_file() {
  env_file="$AGENTBOX_CONFIG_DIR/agentbox.env"
  state_dir="$AGENTBOX_DATA_ROOT/agentbox"
  auth_token="$1"

  mkdir -p "$AGENTBOX_CONFIG_DIR" "$state_dir" \
    "$AGENTBOX_DATA_ROOT/.openclaw" \
    "$AGENTBOX_DATA_ROOT/.hermes" \
    "$AGENTBOX_DATA_ROOT/.cc-connect" \
    "$AGENTBOX_DATA_ROOT/.codex" \
    "$AGENTBOX_DATA_ROOT/.claude" \
    /var/cache/agentbox/node-compile-cache

  cat > "$env_file" <<EOF
APP_ENV=production
SERVER_HOST=$AGENTBOX_SERVER_HOST
SERVER_PORT=$AGENTBOX_SERVER_PORT
DATABASE_URL=file:$state_dir/data.db
AUTH_CONFIG_PATH=$state_dir/auth.json
AUTH_DEFAULT_TOKEN=$auth_token
AGENTBOX_DATA_ROOT=$AGENTBOX_DATA_ROOT
AGENTBOX_MANIFEST_URL=$AGENTBOX_MANIFEST_URL
AGENTBOX_PUBLIC_URL=$AGENTBOX_PUBLIC_URL
LOG_LEVEL=$AGENTBOX_LOG_LEVEL
HOME=$AGENTBOX_DATA_ROOT
OPENCLAW_HOME=$AGENTBOX_DATA_ROOT
OPENCLAW_NO_RESPAWN=1
OPENCLAW_GATEWAY_BIND=lan
NODE_COMPILE_CACHE=/var/cache/agentbox/node-compile-cache
HERMES_HOME=$AGENTBOX_DATA_ROOT/.hermes
CC_CONNECT_CONFIG=$AGENTBOX_DATA_ROOT/.cc-connect/config.toml
CODEX_HOME=$AGENTBOX_DATA_ROOT/.codex
CLAUDE_CONFIG_DIR=$AGENTBOX_DATA_ROOT/.claude
NO_PROXY=127.0.0.1,localhost,::1
PATH=/root/n/bin:/root/.n/bin:/usr/local/n/bin:/opt/n/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin
EOF

  chmod 0644 "$env_file"
}

write_linux_service() {
  service_file="/etc/systemd/system/$AGENTBOX_SERVICE_NAME.service"
  env_file="$AGENTBOX_CONFIG_DIR/agentbox.env"

  cat > "$service_file" <<EOF
[Unit]
Description=AgentBox
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=$AGENTBOX_USER
Group=$AGENTBOX_GROUP
WorkingDirectory=$AGENTBOX_DATA_ROOT
EnvironmentFile=$env_file
ExecStart=$AGENTBOX_BIN
Restart=always
RestartSec=3
KillSignal=SIGINT
TimeoutStopSec=30
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
}

write_linux_updater_script() {
  updater_path="$AGENTBOX_INSTALL_DIR/bin/agentbox-update-self"

  cat > "$updater_path" <<'EOF'
#!/bin/sh
set -eu

AGENTBOX_MANIFEST_URL="${AGENTBOX_MANIFEST_URL:-https://agent.orence.net/releases/latest.json}"
AGENTBOX_BIN="${AGENTBOX_BIN:-/opt/agentbox/bin/agentbox}"
AGENTBOX_SERVICE_NAME="${AGENTBOX_SERVICE_NAME:-agentbox}"
AGENTBOX_STRICT_SHA256="${AGENTBOX_STRICT_SHA256:-1}"
AGENTBOX_RESTART_AFTER_UPDATE="${AGENTBOX_RESTART_AFTER_UPDATE:-1}"

log() {
  printf '%s\n' "$*"
}

fail() {
  echo "错误：$*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

download_file() {
  url="$1"
  dest="$2"

  if command_exists curl; then
    curl -fsSL --retry 3 --connect-timeout 20 "$url" -o "$dest"
    return
  fi

  if command_exists wget; then
    wget -q -O "$dest" "$url"
    return
  fi

  fail "需要安装 curl 或 wget 才能下载文件。"
}

json_get() {
  file="$1"
  key="$2"

  if command_exists python3; then
    python3 - "$file" "$key" <<'PY' && return 0
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    value = json.load(handle)

for part in sys.argv[2].split("."):
    if isinstance(value, dict) and part in value:
        value = value[part]
    else:
        sys.exit(1)

if value is None:
    sys.exit(1)
print(value if not isinstance(value, (dict, list)) else json.dumps(value, separators=(",", ":")))
PY
  fi

  if command_exists node; then
    node - "$file" "$key" <<'NODE' && return 0
const fs = require('fs')
let value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
for (const part of process.argv[3].split('.')) {
  if (!value || typeof value !== 'object' || !(part in value)) process.exit(1)
  value = value[part]
}
if (value === null || value === undefined) process.exit(1)
console.log(typeof value === 'object' ? JSON.stringify(value) : String(value))
NODE
  fi

  fail "无法从 AgentBox 更新清单读取 '$key'。请确认已安装 python3 或 node，且清单包含该字段。"
}

detect_agentbox_arch() {
  case "$(uname -m)" in
    x86_64|amd64) printf '%s\n' x64 ;;
    aarch64|arm64) printf '%s\n' arm64 ;;
    *) fail "不支持的 AgentBox Linux 架构：$(uname -m)" ;;
  esac
}

verify_sha256() {
  expected="$1"
  file="$2"

  [ -n "$expected" ] || return 0

  if command_exists sha256sum; then
    printf '%s  %s\n' "$expected" "$file" | sha256sum -c - >/dev/null
    return
  fi

  if command_exists shasum; then
    actual="$(shasum -a 256 "$file" | awk '{print $1}')"
    [ "$actual" = "$expected" ]
    return
  fi

  if command_exists openssl; then
    actual="$(openssl dgst -sha256 "$file" | awk '{print $NF}')"
    [ "$actual" = "$expected" ]
    return
  fi

  [ "$AGENTBOX_STRICT_SHA256" != "1" ] || fail "未找到 sha256 校验工具。"
  log "警告：未找到 sha256 校验工具，已跳过校验。"
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

arch="$(detect_agentbox_arch)"
manifest_file="$tmp_dir/latest.json"
tmp_bin="$tmp_dir/agentbox"
marker="${AGENTBOX_BIN}.version"

log "正在检查 AgentBox 更新清单：$AGENTBOX_MANIFEST_URL"
download_file "$AGENTBOX_MANIFEST_URL" "$manifest_file"

version="$(json_get "$manifest_file" version || printf latest)"
url="$(json_get "$manifest_file" "downloads.linux.$arch.url")"
sha256="$(json_get "$manifest_file" "downloads.linux.$arch.sha256" || true)"
next_marker="$version $sha256"

if [ -x "$AGENTBOX_BIN" ] && [ -f "$marker" ] && [ "$(cat "$marker")" = "$next_marker" ]; then
  log "AgentBox 已是最新版本：$version"
  exit 0
fi

log "正在下载 linux/$arch 的 AgentBox $version..."
download_file "$url" "$tmp_bin"

if [ -n "$sha256" ]; then
  log "正在校验 sha256..."
  verify_sha256 "$sha256" "$tmp_bin" || fail "sha256 校验失败。"
fi

install_dir="$(dirname "$AGENTBOX_BIN")"
mkdir -p "$install_dir"
chmod 0755 "$tmp_bin"
cp "$tmp_bin" "$AGENTBOX_BIN.new"
mv -f "$AGENTBOX_BIN.new" "$AGENTBOX_BIN"
printf '%s\n' "$next_marker" > "$marker"
chmod 0755 "$AGENTBOX_BIN"
chmod 0644 "$marker"

log "AgentBox 已更新：$AGENTBOX_BIN -> $version"

if [ "$AGENTBOX_RESTART_AFTER_UPDATE" = "1" ] && command_exists systemctl; then
  log "正在重启 systemd 服务：$AGENTBOX_SERVICE_NAME"
  systemctl restart "$AGENTBOX_SERVICE_NAME"
fi
EOF

  chmod 0755 "$updater_path"
}

write_linux_updater_units() {
  updater_service_file="/etc/systemd/system/${AGENTBOX_SERVICE_NAME}-updater.service"
  updater_timer_file="/etc/systemd/system/${AGENTBOX_SERVICE_NAME}-updater.timer"
  env_file="$AGENTBOX_CONFIG_DIR/agentbox.env"
  updater_path="$AGENTBOX_INSTALL_DIR/bin/agentbox-update-self"

  cat > "$updater_service_file" <<EOF
[Unit]
Description=AgentBox 自更新任务
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
EnvironmentFile=$env_file
Environment=AGENTBOX_BIN=$AGENTBOX_BIN
Environment=AGENTBOX_SERVICE_NAME=$AGENTBOX_SERVICE_NAME
Environment=AGENTBOX_STRICT_SHA256=$AGENTBOX_STRICT_SHA256
ExecStart=$updater_path
EOF

  cat > "$updater_timer_file" <<EOF
[Unit]
Description=定时运行 AgentBox 自更新任务

[Timer]
OnBootSec=$AGENTBOX_UPDATE_ON_BOOT_SEC
OnUnitActiveSec=$AGENTBOX_UPDATE_INTERVAL
RandomizedDelaySec=60s
Persistent=true

[Install]
WantedBy=timers.target
EOF
}

install_linux_binary() {
  arch="$(detect_agentbox_arch)"
  version="$(json_get version || printf latest)"
  url="$(json_get "downloads.linux.$arch.url" || true)"
  sha256="$(json_get "downloads.linux.$arch.sha256" || true)"
  state_dir="$AGENTBOX_DATA_ROOT/agentbox"
  auth_config_path="$state_dir/auth.json"

  [ -n "$url" ] || fail "更新清单缺少 downloads.linux.$arch.url"

  section "安装计划"
  info "Linux 目标架构：$arch"
  info "最新版本：$version"
  info "下载地址：$url"
  info "安装路径：$AGENTBOX_BIN"
  info "数据目录：$AGENTBOX_DATA_ROOT"
  info "服务名：$AGENTBOX_SERVICE_NAME"

  if [ "$AGENTBOX_DRY_RUN" = "1" ]; then
    if [ "$AGENTBOX_FORCE_INSTALL" = "1" ]; then
      log "演练模式：将强制覆盖安装 ${AGENTBOX_BIN}。"
    else
      log "演练模式：将安装或更新 ${AGENTBOX_BIN}。"
    fi
    log "演练模式：将配置 systemd 服务 ${AGENTBOX_SERVICE_NAME}，并配置更新定时器 ${AGENTBOX_SERVICE_NAME}-updater.timer。"
    if [ "$AGENTBOX_START_SERVICE" = "1" ]; then
      log "演练模式：安装完成后将自动重启 ${AGENTBOX_SERVICE_NAME}。"
    else
      log "演练模式：安装完成后不会自动重启 ${AGENTBOX_SERVICE_NAME}。"
    fi
    return
  fi

  ensure_linux_root "$@"
  ensure_systemd_available
  ensure_linux_account

  mkdir -p "$AGENTBOX_INSTALL_DIR/bin" "$AGENTBOX_DATA_ROOT" "$state_dir"
  chown -R "$AGENTBOX_USER:$AGENTBOX_GROUP" "$AGENTBOX_DATA_ROOT"

  existing_auth_token="$(read_auth_token_from_file "$auth_config_path" 2>/dev/null || true)"
  if [ -n "$AGENTBOX_AUTH_TOKEN" ]; then
    auth_token="$AGENTBOX_AUTH_TOKEN"
  elif [ -n "$existing_auth_token" ]; then
    auth_token="$existing_auth_token"
  else
    auth_token="$(generate_auth_token)"
  fi

  tmp_bin="$TMP_DIR/agentbox"
  new_bin="$AGENTBOX_BIN.new"
  marker="$AGENTBOX_BIN.version"
  expected_marker="$version $sha256"

  if [ "$AGENTBOX_FORCE_INSTALL" != "1" ] && [ -x "$AGENTBOX_BIN" ] && [ -f "$marker" ] && [ "$(cat "$marker")" = "$expected_marker" ]; then
    log "AgentBox 二进制已是最新版本：$version"
  else
    if [ "$AGENTBOX_FORCE_INSTALL" = "1" ]; then
      step "强制覆盖安装 AgentBox $version"
    else
      step "下载 AgentBox $version"
    fi
    download_file "$url" "$tmp_bin"

    if [ -n "$sha256" ]; then
      step "校验 sha256"
      if ! verify_sha256 "$sha256" "$tmp_bin"; then
        fail "下载的 AgentBox 二进制 sha256 校验失败。"
      fi
    fi

    cp "$tmp_bin" "$new_bin"
    chmod 0755 "$new_bin"
    mv -f "$new_bin" "$AGENTBOX_BIN"
    printf '%s\n' "$expected_marker" > "$marker"
    chmod 0644 "$marker"
    ok "已安装 AgentBox 二进制：$AGENTBOX_BIN"
  fi

  step "写入配置和 systemd 单元"
  write_auth_config_file "$auth_config_path" "http://127.0.0.1:$AGENTBOX_SERVER_PORT" "$auth_token"
  write_linux_env_file "$auth_token"
  write_linux_service
  write_linux_updater_script
  write_linux_updater_units
  chown -R "$AGENTBOX_USER:$AGENTBOX_GROUP" "$AGENTBOX_DATA_ROOT"

  systemctl daemon-reload
  systemctl enable "$AGENTBOX_SERVICE_NAME" >/dev/null
  if [ "$AGENTBOX_AUTO_UPDATE" = "1" ]; then
    systemctl enable --now "${AGENTBOX_SERVICE_NAME}-updater.timer" >/dev/null
    ok "AgentBox 更新定时器已启用：${AGENTBOX_SERVICE_NAME}-updater.timer"
  else
    systemctl disable --now "${AGENTBOX_SERVICE_NAME}-updater.timer" >/dev/null 2>&1 || true
    ok "AgentBox 更新定时器已禁用。"
  fi

  if [ "$AGENTBOX_START_SERVICE" = "1" ]; then
    step "重启 AgentBox 服务"
    systemctl restart "$AGENTBOX_SERVICE_NAME"
    ok "AgentBox 服务已重启：$AGENTBOX_SERVICE_NAME"
    print_linux_access_links "$auth_token"
  else
    ok "AgentBox 服务已安装但未启动：$AGENTBOX_SERVICE_NAME"
    print_linux_access_links "$auth_token"
  fi
}

uninstall_linux() {
  if [ "$AGENTBOX_DRY_RUN" = "1" ]; then
    log "演练模式：将停止并移除 $AGENTBOX_SERVICE_NAME 服务，以及 $AGENTBOX_INSTALL_DIR/bin 下的程序文件。"
    if [ "$AGENTBOX_PURGE" = "1" ]; then
      log "演练模式：还将删除 ${AGENTBOX_CONFIG_DIR} 和 ${AGENTBOX_DATA_ROOT}。"
    else
      log "演练模式：将保留 ${AGENTBOX_CONFIG_DIR} 和 ${AGENTBOX_DATA_ROOT}。"
    fi
    return
  fi

  ensure_linux_root "$@"
  ensure_systemd_available

  log "正在卸载 AgentBox 服务：$AGENTBOX_SERVICE_NAME"
  systemctl disable --now "${AGENTBOX_SERVICE_NAME}-updater.timer" >/dev/null 2>&1 || true
  systemctl stop "${AGENTBOX_SERVICE_NAME}-updater.service" >/dev/null 2>&1 || true
  systemctl disable --now "$AGENTBOX_SERVICE_NAME" >/dev/null 2>&1 || true

  rm -f \
    "/etc/systemd/system/$AGENTBOX_SERVICE_NAME.service" \
    "/etc/systemd/system/${AGENTBOX_SERVICE_NAME}-updater.service" \
    "/etc/systemd/system/${AGENTBOX_SERVICE_NAME}-updater.timer"
  systemctl daemon-reload
  systemctl reset-failed "$AGENTBOX_SERVICE_NAME" "${AGENTBOX_SERVICE_NAME}-updater.service" "${AGENTBOX_SERVICE_NAME}-updater.timer" >/dev/null 2>&1 || true

  if [ "$AGENTBOX_PURGE" = "1" ]; then
    rm -rf "$AGENTBOX_CONFIG_DIR" "$AGENTBOX_DATA_ROOT" "$AGENTBOX_INSTALL_DIR"
    if [ "$AGENTBOX_USER" != "root" ] && id "$AGENTBOX_USER" >/dev/null 2>&1; then
      userdel "$AGENTBOX_USER" >/dev/null 2>&1 || true
    fi
    if [ "$AGENTBOX_GROUP" != "root" ] && getent group "$AGENTBOX_GROUP" >/dev/null 2>&1; then
      groupdel "$AGENTBOX_GROUP" >/dev/null 2>&1 || true
    fi
    log "已彻底删除程序、配置和数据：$AGENTBOX_INSTALL_DIR, $AGENTBOX_CONFIG_DIR, $AGENTBOX_DATA_ROOT"
  else
    rm -rf "$AGENTBOX_INSTALL_DIR/bin"
    log "已移除程序文件：$AGENTBOX_INSTALL_DIR/bin"
    log "已保留配置和数据：$AGENTBOX_CONFIG_DIR, $AGENTBOX_DATA_ROOT"
    log "如需同时删除它们，请使用 --uninstall --purge。"
  fi

  log "AgentBox 已卸载。"
}

install_macos_package() {
  arch="$(detect_agentbox_arch)"
  platform="$(desktop_platform_key macos "$arch")"
  version="$(json_get version || printf latest)"
  url="$(json_get "platforms.$platform.appTarGzUrl" || json_get "platforms.$platform.tarGzUrl" || json_get "platforms.$platform.url" || true)"
  sha256="$(json_get "platforms.$platform.sha256" || true)"

  [ -n "$url" ] || fail "更新清单缺少 macOS .app.tar.gz 安装包：$platform"
  case "$url" in
    *.app.tar.gz|*.app.tar.gz\?*|*.app.tar.gz\#*|*.tar.gz|*.tar.gz\?*|*.tar.gz\#*) ;;
    *) fail "macOS 安装包必须是 .app.tar.gz：$url" ;;
  esac
  [ -n "$AGENTBOX_MACOS_APP_DIR" ] || fail "macOS 应用安装目录不能为空。"
  [ -n "$AGENTBOX_MACOS_APP_NAME" ] || fail "macOS 应用名称不能为空。"
  case "$AGENTBOX_MACOS_APP_NAME" in
    *.app) ;;
    *) AGENTBOX_MACOS_APP_NAME="$AGENTBOX_MACOS_APP_NAME.app" ;;
  esac

  log "AgentBox macOS 目标平台：$platform"
  log "最新版本：$version"
  log "应用目录：$AGENTBOX_MACOS_APP_DIR"
  log "目标应用：$AGENTBOX_MACOS_APP_DIR/$AGENTBOX_MACOS_APP_NAME"
  log "压缩包地址：$url"

  if [ "$AGENTBOX_DRY_RUN" = "1" ]; then
    log "演练模式：将下载 .app.tar.gz、解压并覆盖目标应用，然后打开应用。"
    return
  fi

  command_exists tar || fail "需要 tar 才能解压 macOS .app.tar.gz。"

  package="$TMP_DIR/AgentBox-$version.app.tar.gz"
  extract_dir="$TMP_DIR/macos-app"
  mkdir -p "$extract_dir"

  step "下载 macOS 应用压缩包"
  download_file "$url" "$package"
  if [ -n "$sha256" ]; then
    step "校验 sha256"
    verify_sha256 "$sha256" "$package" || fail "下载的 macOS 应用压缩包 sha256 校验失败。"
  fi

  step "解压 macOS 应用"
  tar -xzf "$package" -C "$extract_dir"
  app_path="$(find "$extract_dir" -maxdepth 2 -type d -name '*.app' -print | head -n 1)"
  [ -n "$app_path" ] && [ -d "$app_path" ] || fail "压缩包中未找到 .app 应用。"

  install_macos_app_bundle "$app_path" "$AGENTBOX_MACOS_APP_DIR/$AGENTBOX_MACOS_APP_NAME"

  step "打开 AgentBox"
  open "$AGENTBOX_MACOS_APP_DIR/$AGENTBOX_MACOS_APP_NAME"
  ok "AgentBox macOS 应用已安装并打开。"
}

install_macos_app_bundle() {
  source_app="$1"
  target_app="$2"
  target_dir="$(dirname "$target_app")"
  staging_app="$target_app.installing.$$"
  app_display="$(basename "$target_app" .app)"

  if command_exists osascript; then
    osascript -e "tell application \"$app_display\" to quit" >/dev/null 2>&1 || true
    sleep 1
  fi

  if [ "$(id -u)" -eq 0 ] || { [ -d "$target_dir" ] && [ -w "$target_dir" ]; }; then
    mkdir -p "$target_dir"
    rm -rf "$staging_app"
    copy_macos_app_bundle "$source_app" "$staging_app"
    rm -rf "$target_app"
    mv "$staging_app" "$target_app"
    return
  fi

  command_exists sudo || fail "写入 $target_dir 需要管理员权限，请安装 sudo 或用可写目录设置 --macos-app-dir。"
  sudo mkdir -p "$target_dir"
  sudo rm -rf "$staging_app"
  if command_exists ditto; then
    sudo ditto "$source_app" "$staging_app"
  else
    sudo cp -R "$source_app" "$staging_app"
  fi
  sudo rm -rf "$target_app"
  sudo mv "$staging_app" "$target_app"
}

copy_macos_app_bundle() {
  source_app="$1"
  target_app="$2"
  if command_exists ditto; then
    ditto "$source_app" "$target_app"
  else
    cp -R "$source_app" "$target_app"
  fi
}

install_windows_package() {
  arch="$(detect_agentbox_arch)"
  platform="$(desktop_platform_key windows "$arch")"
  version="$(json_get version || printf latest)"
  url="$(json_get "platforms.$platform.url" || true)"

  [ -n "$url" ] || fail "更新清单缺少 Windows 安装器：$platform"

  log "AgentBox Windows 目标平台：$platform"
  log "最新版本：$version"
  log "安装器地址：$url"

  if [ "$AGENTBOX_DRY_RUN" = "1" ]; then
    log "演练模式：将下载并启动 Windows 安装器。"
    return
  fi

  package="$TMP_DIR/AgentBox-$version-setup.exe"
  download_file "$url" "$package"

  win_package="$package"
  if command_exists cygpath; then
    win_package="$(cygpath -w "$package")"
  fi

  log "正在启动安装器：$win_package"
  if command_exists powershell.exe; then
    ps_package="$(ps_escape "$win_package")"
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '$ps_package'"
  else
    cmd.exe /C start "" "$win_package"
  fi
}

main() {
  os="$(detect_os)"

  if [ "$AGENTBOX_ACTION" = "cat" ]; then
    case "$os" in
      linux) cat_linux_status ;;
      *) fail "--cat 目前仅支持 Linux。" ;;
    esac
    return
  fi

  if [ "$AGENTBOX_ACTION" = "uninstall" ]; then
    case "$os" in
      linux) uninstall_linux "$@" ;;
      *) fail "--uninstall 目前仅支持 Linux。" ;;
    esac
    return
  fi

  title "AgentBox 安装器"
  step "获取更新清单"
  info "$AGENTBOX_MANIFEST_URL"
  download_file "$AGENTBOX_MANIFEST_URL" "$MANIFEST_FILE"

  case "$os" in
    linux) install_linux_binary "$@" ;;
    macos) install_macos_package ;;
    windows) install_windows_package ;;
    *) fail "不支持的操作系统：$os" ;;
  esac
}

main "$@"
