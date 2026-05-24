# AgentBox Aliyun ACR Release

This document records how to build and publish the AgentBox Linux container to
Aliyun Container Registry.

## Repository

Public registry:

```text
crpi-k39e7iu8opdpbjdg.cn-hangzhou.personal.cr.aliyuncs.com/orence/agentbox
```

VPC registry:

```text
crpi-k39e7iu8opdpbjdg-vpc.cn-hangzhou.personal.cr.aliyuncs.com/orence/agentbox
```

Use the public registry from local development machines. Use the VPC registry
from ECS instances in the same VPC when pushing or pulling inside Aliyun.

## Login

```sh
docker login --username=XIYUEZE crpi-k39e7iu8opdpbjdg.cn-hangzhou.personal.cr.aliyuncs.com
```

For ECS in the same VPC:

```sh
docker login --username=XIYUEZE crpi-k39e7iu8opdpbjdg-vpc.cn-hangzhou.personal.cr.aliyuncs.com
```

## Build And Push

The build script defaults to `linux/amd64`, which is the expected architecture
for most Linux servers.

Publish the current release:

```sh
cd /Users/one/Development/AgentManager/AgentBox-Linux
AGENTBOX_IMAGE=crpi-k39e7iu8opdpbjdg.cn-hangzhou.personal.cr.aliyuncs.com/orence/agentbox:1.0.0 \
AGENTBOX_BUILD_OUTPUT=push \
./build-image.sh
```

Publish `latest`:

```sh
cd /Users/one/Development/AgentManager/AgentBox-Linux
AGENTBOX_IMAGE=crpi-k39e7iu8opdpbjdg.cn-hangzhou.personal.cr.aliyuncs.com/orence/agentbox:latest \
AGENTBOX_BUILD_OUTPUT=push \
./build-image.sh
```

Build only to the local Docker image store:

```sh
cd /Users/one/Development/AgentManager/AgentBox-Linux
./build-image.sh agentbox:local
```

Build another platform:

```sh
./build-image.sh agentbox:arm64 linux/arm64
```

## Pull

Public network:

```sh
docker pull crpi-k39e7iu8opdpbjdg.cn-hangzhou.personal.cr.aliyuncs.com/orence/agentbox:1.0.0
```

Aliyun VPC:

```sh
docker pull crpi-k39e7iu8opdpbjdg-vpc.cn-hangzhou.personal.cr.aliyuncs.com/orence/agentbox:1.0.0
```

## Runtime Ports

- `8787`: AgentBox
- `18789`: OpenClaw Gateway after OpenClaw is installed and started by AgentBox
- `80`: built-in WebDAV inside the container

## Important Environment Variables

- `AGENTBOX_PUBLIC_URL`: public AgentBox URL, added to OpenClaw Control UI
  allowed origins.
- `OPENCLAW_PUBLIC_GATEWAY_URL`: public OpenClaw Gateway URL used by browser
  clients.
- `AUTH_DEFAULT_TOKEN`: optional fixed AgentBox backend auth token. Public login
  links should wrap it as an `anex:...-aa` credential with
  `persistence=persistent`, instead of exposing it as `token=...`.
- `WEBDAV_USER` and `WEBDAV_PASS`: set both to enable WebDAV Basic Auth.
- `AGENTBOX_MANIFEST_URL`: AgentBox binary manifest. Default:
  `https://agent.orence.net/releases/latest.json`.
