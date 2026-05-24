#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE_NAME="${IMAGE_NAME:-agentbox-windows-builder}"
DOCKERFILE="$ROOT_DIR/Build/docker/windows/Dockerfile"
HEROUI_ENV_FILE="$ROOT_DIR/AgentBox-Apple/heroui.env"
UPDATER_KEY_FILE="$ROOT_DIR/AgentBox-Apple/tauri-updater.key"
UPDATER_PASSWORD_FILE="$ROOT_DIR/AgentBox-Apple/tauri-updater.password"

docker_env_args=(-e CI=true)

if [[ -f "$HEROUI_ENV_FILE" ]]; then
  docker_env_args+=(--env-file "$HEROUI_ENV_FILE")
fi

if [[ -n "${HEROUI_AUTH_TOKEN:-}" ]]; then
  docker_env_args+=(-e HEROUI_AUTH_TOKEN)
fi

if [[ -n "${WINDOWS_TARGETS:-}" ]]; then
  docker_env_args+=(-e WINDOWS_TARGETS)
fi

if [[ -f "$UPDATER_KEY_FILE" ]]; then
  docker_env_args+=(-e TAURI_SIGNING_PRIVATE_KEY_PATH=/workspace/AgentBox-Apple/tauri-updater.key)
  if [[ -f "$UPDATER_PASSWORD_FILE" ]]; then
    docker_env_args+=(-e TAURI_UPDATER_PRIVATE_KEY_PASSWORD_FILE=/workspace/AgentBox-Apple/tauri-updater.password)
  fi
elif [[ -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
  docker_env_args+=(-e TAURI_SIGNING_PRIVATE_KEY_PATH)
fi

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  docker_env_args+=(-e TAURI_SIGNING_PRIVATE_KEY)
fi

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
  docker_env_args+=(-e TAURI_SIGNING_PRIVATE_KEY_PASSWORD)
fi

if [[ ! -f "$UPDATER_KEY_FILE" && -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" && -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  echo "未找到 Tauri updater 私钥。请创建 $UPDATER_KEY_FILE，或传入 TAURI_SIGNING_PRIVATE_KEY_PATH/TAURI_SIGNING_PRIVATE_KEY。" >&2
  exit 1
fi

if [[ "${SKIP_IMAGE_BUILD:-0}" != "1" ]]; then
  docker build -f "$DOCKERFILE" -t "$IMAGE_NAME" "$ROOT_DIR"
fi

docker run --rm \
  "${docker_env_args[@]}" \
  -e HOST_UID="$(id -u)" \
  -e HOST_GID="$(id -g)" \
  -v "$ROOT_DIR:/workspace" \
  -v agentbox-windows-client-node-modules:/workspace/Client/node_modules \
  -w /workspace \
  "$IMAGE_NAME"
