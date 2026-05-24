#!/usr/bin/env bash
set -euo pipefail

export HOMEBREW_PREFIX="${HOMEBREW_PREFIX:-/home/linuxbrew/.linuxbrew}"
export HOMEBREW_NO_ENV_HINTS="${HOMEBREW_NO_ENV_HINTS:-1}"
export PATH="$HOMEBREW_PREFIX/bin:$HOMEBREW_PREFIX/sbin:$PATH"

if [[ "$(id -u)" == "0" ]]; then
  quoted=()
  for arg in "$@"; do
    printf -v item '%q' "$arg"
    quoted+=("$item")
  done
  exec su - linuxbrew -c "export HOMEBREW_PREFIX='$HOMEBREW_PREFIX'; export HOMEBREW_NO_ENV_HINTS='$HOMEBREW_NO_ENV_HINTS'; export PATH='$HOMEBREW_PREFIX/bin:$HOMEBREW_PREFIX/sbin':\$PATH; exec '$HOMEBREW_PREFIX/bin/brew' ${quoted[*]}"
fi

exec "$HOMEBREW_PREFIX/bin/brew" "$@"
