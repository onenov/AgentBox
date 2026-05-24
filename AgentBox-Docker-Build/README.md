# AgentBox Container

This image runs AgentBox as root, includes WebDAV, and downloads the current
Linux AgentBox binary from `https://agent.orence.net/releases/latest.json`.
The entrypoint keeps AgentBox as a child process and runs a lightweight update
loop. When a new Linux binary appears in the manifest, the loop downloads it,
verifies sha256, atomically replaces `/opt/agentbox/bin/agentbox`, and restarts
only the AgentBox child process.

The image also includes Python 3, pip, uv, FFmpeg, and Homebrew on Linux.
pip/uv use the Alibaba PyPI mirror by default. The container process runs as
root; `brew` is wrapped so Homebrew commands execute as the `linuxbrew` user
because Homebrew refuses to run directly as root. SkillHub is installed or
updated quietly by the entrypoint at container startup so it is not pinned to
the image build time. Set `SKILLHUB_AUTO_INSTALL=0` to skip that runtime step,
or override `SKILLHUB_INSTALL_URL` to use another install script.

OpenClaw container defaults include `OPENCLAW_GATEWAY_BIND=lan`,
`OPENCLAW_NO_RESPAWN=1`, and
`NODE_COMPILE_CACHE=/var/cache/agentbox/node-compile-cache`.
The entrypoint also starts a small Gateway supervisor. After OpenClaw is
installed from AgentBox, it patches container config to `gateway.bind=lan` and
keeps `openclaw gateway run` listening on port `18789`.

Set `AGENTBOX_PUBLIC_URL` to the URL users open AgentBox from, for example
`https://openclaw-1001-agentbox.example.com`. This exact origin is added to
OpenClaw Control UI allowed origins.

## Build

```sh
./build-image.sh
```

Aliyun Container Registry release notes live in [ALIYUN_ACR.md](ALIYUN_ACR.md).

The build script targets `linux/amd64` by default, so Apple Silicon Macs build
the x64 Linux image used by most servers. To choose another platform:

```sh
./build-image.sh agentbox:arm64 linux/arm64
AGENTBOX_PLATFORM=linux/arm64 ./build-image.sh
```

By default the image tag is the Aliyun public registry repository:

```text
crpi-k39e7iu8opdpbjdg.cn-hangzhou.personal.cr.aliyuncs.com/orence/agentbox:latest
```

Build and push to Aliyun:

```sh
./build-image.sh crpi-k39e7iu8opdpbjdg.cn-hangzhou.personal.cr.aliyuncs.com/orence/agentbox:latest linux/amd64 push
```

Or use environment variables:

```sh
AGENTBOX_BUILD_OUTPUT=push ./build-image.sh
AGENTBOX_IMAGE=crpi-k39e7iu8opdpbjdg.cn-hangzhou.personal.cr.aliyuncs.com/orence/agentbox:1.0.0 AGENTBOX_BUILD_OUTPUT=push ./build-image.sh
```

## Run

```sh
cp .env.example .env
docker compose up -d --build
```

Ports:

- `8787`: AgentBox
- `18789`: OpenClaw Gateway, after OpenClaw is installed and started in AgentBox
- `8080`: built-in WebDAV, mapped to container port `80`

State:

- `./data` -> `/root/.AgentBox-Data`

The entrypoint creates compatibility symlinks:

- `/root/.openclaw` -> `/root/.AgentBox-Data/openclaw`
- `/root/.hermes` -> `/root/.AgentBox-Data/hermes`
- `/root/.cc-connect` -> `/root/.AgentBox-Data/cc-connect`
- `/root/.codex` -> `/root/.AgentBox-Data/codex`
- `/root/.claude` -> `/root/.AgentBox-Data/claude`
- `/root/.cache` -> `/var/cache/agentbox/root-cache`

WebDAV serves `/root/.AgentBox-Data`, so the WebDAV root maps to `./data` on the host.

## Auto Update

The container checks the release manifest every hour by default:

```text
AGENTBOX_AUTO_UPDATE=1
AGENTBOX_UPDATE_INTERVAL_SECONDS=3600
AGENTBOX_MANIFEST_URL=https://agent.orence.net/releases/latest.json
```

Set `AGENTBOX_AUTO_UPDATE=0` to disable the in-container update loop. Updating
the base image itself still requires rebuilding or pulling a newer image.
