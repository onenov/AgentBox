#!/usr/bin/env sh
set -eu

IMAGE="${1:-${AGENTBOX_IMAGE:-crpi-k39e7iu8opdpbjdg.cn-hangzhou.personal.cr.aliyuncs.com/orence/agentbox:latest}}"
PLATFORM="${2:-${AGENTBOX_PLATFORM:-linux/amd64}}"
OUTPUT="${3:-${AGENTBOX_BUILD_OUTPUT:-load}}"

case "$OUTPUT" in
  load)
    docker buildx build --platform "$PLATFORM" --load -t "$IMAGE" .
    ;;
  push)
    docker buildx build --platform "$PLATFORM" --push -t "$IMAGE" .
    ;;
  *)
    echo "Unsupported output mode: $OUTPUT" >&2
    echo "Use: load or push" >&2
    exit 1
    ;;
esac

echo "Built $IMAGE for $PLATFORM ($OUTPUT)"
