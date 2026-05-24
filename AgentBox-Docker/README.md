# AgentBox Docker 独立部署

这个目录提供一份独立的 `docker-compose.yml`，用于直接运行已经发布到阿里云 ACR 的 AgentBox Linux 镜像。

默认镜像：

```text
crpi-k39e7iu8opdpbjdg.cn-hangzhou.personal.cr.aliyuncs.com/orence/agentbox:1.0.0
```

镜像内置：

- AgentBox 服务
- OpenClaw Gateway 运行环境
- WebDAV
- Node.js
- Python、pip、uv
- FFmpeg、ffprobe
- Homebrew Linux

## 快速启动

```sh
cd /Users/one/Development/AgentManager/AgentBox-Docker
cp .env.example .env
docker compose up -d
```

查看日志：

```sh
docker compose logs -f agentbox
```

停止服务：

```sh
docker compose down
```

## 默认端口

| 宿主机端口 | 容器端口 | 用途 |
| --- | --- | --- |
| `8787` | `8787` | AgentBox Web 控制台 |
| `18789` | `18789` | OpenClaw Gateway |
| `8080` | `80` | WebDAV |

启动后访问：

```text
http://127.0.0.1:8787
```

OpenClaw Gateway 会在用户进入 AgentBox 并完成 OpenClaw 安装/启动后可用。

## 持久化目录

| 宿主机目录 | 容器目录 | 用途 |
| --- | --- | --- |
| `./data` | `/root/.AgentBox-Data` | 实例全部持久化数据 |

宿主机不再区分 `Data` 和 `Workspace`，也不再为 OpenClaw、Hermes、CC-Connect 分别挂载多个目录。容器启动时会自动创建兼容软链接：

| 兼容路径 | 实际目录 |
| --- | --- |
| `/root/.openclaw` | `/root/.AgentBox-Data/openclaw` |
| `/root/.hermes` | `/root/.AgentBox-Data/hermes` |
| `/root/.cc-connect` | `/root/.AgentBox-Data/cc-connect` |
| `/root/.codex` | `/root/.AgentBox-Data/codex` |
| `/root/.claude` | `/root/.AgentBox-Data/claude` |
| `/root/.cache` | `/var/cache/agentbox/root-cache` |

统一数据目录内部大致是：

```text
./data/
├── agentbox/      # AgentBox 数据库和认证配置
├── openclaw/      # OpenClaw 配置、identity、logs、agents、sessions
├── hermes/        # Hermes 配置、profiles、logs、sessions、skills、plugins、cron
├── cc-connect/    # CC-Connect config.toml、daemon、logs
├── codex/         # Codex 配置、skills、运行数据
└── claude/        # Claude Code 配置
```

## WebDAV 文件视图

WebDAV 暴露的是：

```text
/root/.AgentBox-Data
```

所以用户挂载 WebDAV 后看到的 `/`，对应宿主机：

```text
./data
```

OpenClaw 和 Hermes 都可以在这个根目录下使用多个项目目录，不再预设 `Workspace`、`workspaces` 或 `workspace-template`。注意 WebDAV 会直接看到 `agentbox`、`openclaw`、`hermes` 等持久化目录；运行缓存留在容器内 `/var/cache/agentbox`，不通过 WebDAV 暴露。

## Hermes 与 CC-Connect 目录约定

AgentBox 后端的 Hermes 服务页会读取：

```text
HERMES_HOME=/root/.hermes
```

因此 Hermes 的主要文件实际会落在：

```text
/root/.AgentBox-Data/hermes/config.yaml
/root/.AgentBox-Data/hermes/.env
/root/.AgentBox-Data/hermes/logs
/root/.AgentBox-Data/hermes/sessions
/root/.AgentBox-Data/hermes/skills
/root/.AgentBox-Data/hermes/plugins
/root/.AgentBox-Data/hermes/cron
```

CC-Connect 服务页会优先读取：

```text
CC_CONNECT_CONFIG=/root/.cc-connect/config.toml
```

因此 CC-Connect 的主要文件实际会落在：

```text
/root/.AgentBox-Data/cc-connect/config.toml
/root/.AgentBox-Data/cc-connect/daemon.json
/root/.AgentBox-Data/cc-connect/logs/cc-connect.log
/root/.AgentBox-Data/cc-connect/logs/agent-box-cc-connect.log
```

CC-Connect 的 coding-agent/skills 还会使用：

```text
CODEX_HOME=/root/.codex
CLAUDE_CONFIG_DIR=/root/.claude
```

所以这两个兼容路径也会通过软链接落到 `/root/.AgentBox-Data/codex` 和 `/root/.AgentBox-Data/claude`，避免 Codex/Claude Code 的配置和凭据写进容器可写层。

## 公网反代配置

如果部署在 HTTPS 域名后面，至少需要配置：

```text
AGENTBOX_PUBLIC_URL=https://openclaw-1001-agentbox.example.com
OPENCLAW_PUBLIC_GATEWAY_URL=https://openclaw-1001.example.com
```

含义：

- `AGENTBOX_PUBLIC_URL`：用户实际打开 AgentBox 的地址，会加入 OpenClaw Control UI allowedOrigins。
- `OPENCLAW_PUBLIC_GATEWAY_URL`：浏览器前端连接 OpenClaw Gateway 时使用的公网地址。

如果你还需要额外允许多个来源访问 Control UI，可以配置：

```text
AGENTBOX_CONTROL_UI_ORIGINS=https://a.example.com,https://b.example.com
```

## 固定登录凭据

默认情况下，AgentBox 会自动生成认证配置。如果你希望登录凭据稳定，可以在 `.env` 里配置：

```text
AUTH_DEFAULT_TOKEN=换成一个足够长的随机字符串
```

对外访问 AgentBox 时不要再把密钥放到 `token=` 参数里，统一使用 anex 凭据：

```text
anex:<base64url(AgentBox访问地址 + "\n" + AUTH_DEFAULT_TOKEN)>-aa
```

登录链接格式：

```text
http://127.0.0.1:8787/login?credential=anex%3A...-aa&persistence=persistent
```

可以用仓库根目录的 `anex-credential.html` 生成；目标选择“全部 -aa”，持久化选择“持久化”。

## WebDAV 认证

默认启用 WebDAV，但不设置账号密码。如果需要 Basic Auth：

```text
WEBDAV_ENABLED=1
WEBDAV_USER=agentbox
WEBDAV_PASS=换成强密码
```

WebDAV 地址：

```text
http://127.0.0.1:8080
```

## 更新镜像

AgentBox 后端二进制会在容器内自动检查更新。默认每小时读取一次：

```text
AGENTBOX_MANIFEST_URL=https://agent.orence.net/releases/latest.json
AGENTBOX_AUTO_UPDATE=1
AGENTBOX_UPDATE_INTERVAL_SECONDS=3600
```

发现新版本后，容器内入口脚本会下载 `downloads.linux.x64/arm64` 对应的二进制、校验 `sha256`、原子替换 `/opt/agentbox/bin/agentbox`，然后只重启 AgentBox 子进程，不重启整个容器。

如果你只发布了新的 AgentBox 后端二进制，通常不需要执行 `docker compose restart`。如果镜像里的系统依赖、入口脚本、Node/Python/Homebrew 环境有变化，仍然需要拉取新镜像：

拉取新镜像：

```sh
docker compose pull
docker compose up -d
```

指定新版本时，修改 `.env`：

```text
AGENTBOX_IMAGE=crpi-k39e7iu8opdpbjdg.cn-hangzhou.personal.cr.aliyuncs.com/orence/agentbox:1.0.1
```

再执行：

```sh
docker compose pull
docker compose up -d
```

## 常用排查命令

查看容器状态：

```sh
docker compose ps
```

查看资源占用：

```sh
docker stats agentbox
docker ps -s | grep agentbox
```

查看容器内磁盘占用：

```sh
docker exec agentbox du -h -d 2 /root /opt /tmp /var 2>/dev/null | sort -h | tail -40
```

查看主要进程：

```sh
docker exec agentbox ps aux --sort=-%mem | head -20
docker exec agentbox ps aux --sort=-%cpu | head -20
```
