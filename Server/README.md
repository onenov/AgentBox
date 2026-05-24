# AgentBox Server

`Server/` 是 AgentBox 的 Go 后端服务，负责提供本机 Agent 管理 API、认证、环境检测、日志、代理配置、插件管理，以及 OpenClaw、Hermes、CC-Connect 的安装、配置、运行、终端、会话、技能、插件和任务管理能力。

后端默认作为本地服务运行，也可以被打包到桌面端、Docker 镜像或 Linux 单二进制发布中。

## 技术栈

- Go 1.26
- chi HTTP Router
- Huma OpenAPI
- Scalar API 文档
- nhooyr websocket
- Server-Sent Events
- modernc SQLite
- slog
- Air 热重载

## 目录结构

```text
Server/
├── api/openapi/                  # OpenAPI 相关预留目录
├── cmd/agent-box/main.go          # 服务入口
├── internal/
│   ├── app/                       # 应用组装：配置、日志、存储、HTTP Server
│   ├── config/                    # 环境变量、认证配置、dotenv
│   ├── gateway/                   # Gateway 客户端能力
│   ├── httpapi/                   # 路由、中间件、handler、OpenAPI 注册
│   ├── logging/                   # 日志管理
│   ├── realtime/                  # WebSocket Hub
│   ├── storage/                   # SQLite 存储初始化
│   ├── version/                   # 版本信息
│   └── web/                       # 内嵌前端静态资源 handler
├── web/scalar/                    # Scalar 文档静态资源
├── .air.toml                      # Air 热重载配置
├── .env.example                   # 生产环境变量示例
├── go.mod
└── go.sum
```

## 本地开发

进入后端目录：

```bash
cd Server
```

推荐使用 Air 热重载：

```bash
go run github.com/air-verse/air@latest
```

也可以直接运行：

```bash
go run ./cmd/agent-box
```

默认监听：

```text
http://127.0.0.1:8787
```

前端开发服务通常运行在：

```text
http://127.0.0.1:5173
```

后端 CORS 默认允许：

- `http://localhost:*`
- `http://127.0.0.1:*`
- `tauri://localhost`

## Air 配置

Air 配置文件：

```text
.air.toml
```

当前行为：

- 监听 `cmd/` 和 `internal/`
- 监听扩展名：`go`、`tpl`、`tmpl`、`html`
- 排除目录：`tmp`、`vendor`、`data`
- 排除测试文件：`_test.go`
- 构建命令：`go build -o ./tmp/agent-box ./cmd/agent-box`
- 运行文件：`./tmp/agent-box`
- 构建错误日志：`tmp/build-errors.log`

`tmp/` 是开发产物目录，不提交。

## 配置

配置读取顺序：

1. 系统环境变量
2. 后端可执行文件同级目录的 `.env`
3. 代码默认值

示例配置：

```text
.env.example
```

常用变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_ENV` | `development` | 运行环境 |
| `SERVER_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `SERVER_PORT` | `8787` | HTTP 监听端口 |
| `SERVER_READ_TIMEOUT` | `15s` | 请求读取超时 |
| `SERVER_WRITE_TIMEOUT` | `20m` | 响应写入超时，长任务/SSE 需要较长时间 |
| `SERVER_SHUTDOWN_TIMEOUT` | `10s` | 优雅退出超时 |
| `DATABASE_URL` | `file:~/.agent-box/data.db` | SQLite 数据库 |
| `AUTH_CONFIG_PATH` | `~/.agent-box/auth.json` | 认证配置文件 |
| `AUTH_DEFAULT_TOKEN` | 空 | 首次生成认证配置时使用的默认 token |
| `LOG_LEVEL` | `info` | `debug`、`info`、`warn`、`error` |
| `MODEL_CATALOG_URL` | 官方发布地址 | 模型目录 |
| `MODEL_INITIALIZATION_URL` | 官方发布地址 | 模型初始化配置 |
| `HERMES_HOME` | `~/.hermes` | Hermes 配置目录 |
| `HERMES_ENABLE_PROJECT_PLUGINS` | `false` | 是否展示项目级 Hermes 插件 |
| `CC_CONNECT_CONFIG` | 默认配置路径 | CC-Connect 配置文件 |
| `OPENCLAW_HOME` | `~/.openclaw` | OpenClaw 配置目录 |
| `OPENCLAW_PUBLIC_GATEWAY_URL` | 空 | OpenClaw Gateway 公网 HTTP 地址 |
| `OPENCLAW_WORKSPACE_TEMPLATE_DIR` | 空 | OpenClaw 工作区模板目录 |
| `CODEX_HOME` | 默认用户目录 | Codex 配置目录 |
| `CLAUDE_CONFIG_DIR` | 默认用户目录 | Claude 配置目录 |
| `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` | 空 | 后端安装命令和 HTTP 请求使用的代理变量 |

开发环境通常直接使用系统环境变量即可。生产环境可把 `.env` 放到后端二进制同级目录。

## 数据目录

默认数据目录：

```text
~/.agent-box
```

默认文件：

```text
~/.agent-box/data.db
~/.agent-box/auth.json
```

可以通过 `DATABASE_URL` 和 `AUTH_CONFIG_PATH` 改写。

## 认证

后端使用认证配置文件管理访问 token。前端默认通过：

```text
Authorization: Bearer <token>
```

发送认证信息。

`AUTH_DEFAULT_TOKEN` 只在认证配置文件不存在、首次生成时生效。认证配置文件已经存在后，实际鉴权以 `AUTH_CONFIG_PATH` 指向的文件为准。

本地开发如果遇到 401：

1. 查看 `AUTH_CONFIG_PATH` 指向的文件。
2. 确认前端登录页输入的 token 正确。
3. 如果需要重置，先停止服务，再处理本地认证配置文件。

## API 文档

后端启动后访问：

```text
http://127.0.0.1:8787/docs
```

OpenAPI 文件：

```text
http://127.0.0.1:8787/openapi.json
http://127.0.0.1:8787/openapi.yaml
http://127.0.0.1:8787/openapi-3.0.json
```

Huma 会根据注册的 operation 和 Go 类型自动生成 OpenAPI，不需要手写 `openapi.json`。

## 路由概览

### System

- `GET /api/health`
- `GET /api/environment`
- `GET /api/network-check`
- `GET /api/proxy-settings`
- `PUT /api/proxy-settings`
- `POST /api/proxy-settings/check`
- `GET /api/logging`
- `PUT /api/logging`
- `POST /api/logging/clear`
- `POST /api/maintenance/sqlite/clear`

### AgentBox Plugins

- `GET /api/plugins/status`
- `GET /api/plugins/updates`
- `POST /api/plugins/{id}/install`
- `GET /api/plugins/{id}/install/stream`
- `POST /api/plugins/{id}/update`
- `DELETE /api/plugins/{id}`

### OpenClaw

能力范围：

- 环境检测
- 安装、卸载、更新
- Gateway 启停
- 日志读取
- Agent 管理
- workspace 文件管理
- memory 文件和索引
- openclaw.json 读写
- config 备份与恢复
- public gateway 配置
- 渠道配置和账号管理
- pairing 审批
- Dreaming 模式
- Cron 任务
- 模型拉取和测试
- 技能搜索、安装、依赖安装、配置
- 插件搜索、安装、启停、更新、卸载、registry 和 doctor

主要前缀：

```text
/openclaw/*
```

常用入口：

- `GET /openclaw/environment`
- `POST /openclaw/install`
- `POST /openclaw/uninstall`
- `GET /openclaw/log`
- `GET /openclaw/config`
- `PUT /openclaw/config`
- `GET /openclaw/agents`
- `POST /openclaw/agents`
- `GET /openclaw/channels/{channel}`
- `PUT /openclaw/channels/{channel}/config`
- `GET /openclaw/skills/status`
- `GET /openclaw/plugins/status`
- `GET /openclaw/cron/jobs`

### Hermes

能力范围：

- 环境检测
- 安装、卸载、更新、doctor
- Gateway 启停
- 终端和终端录制
- 会话管理
- Agent 管理和文件管理
- 技能搜索、发现、安装、配置
- 模型配置、拉取和测试
- 平台配置、二维码 setup、pairing 审批
- 插件安装、启停、更新、删除
- Cron 任务
- Kanban 看板、任务、评论、dispatch
- 消息统计和最近消息

主要前缀：

```text
/hermes/*
```

常用入口：

- `GET /hermes/environment`
- `POST /hermes/install`
- `GET /hermes/doctor`
- `GET /hermes/instances`
- `GET /hermes/terminals`
- `GET /hermes/sessions`
- `GET /hermes/agents`
- `GET /hermes/skills`
- `GET /hermes/models`
- `GET /hermes/platforms`
- `GET /hermes/cron/jobs`
- `GET /hermes/kanban/boards`

### CC-Connect

能力范围：

- 环境检测
- 基础配置、settings、完整配置读写
- 模型配置、拉取和测试
- 项目配置
- 飞书/微信 setup
- daemon 安装、启停、重启
- 安装、卸载
- 技能搜索、预设、安装、删除
- agent engines
- 终端、终端录制
- 会话管理
- 日志读取

主要前缀：

```text
/cc-connect/*
```

常用入口：

- `GET /cc-connect/environment`
- `GET /cc-connect/config`
- `PUT /cc-connect/config`
- `GET /cc-connect/config/models`
- `PUT /cc-connect/config/models`
- `GET /cc-connect/config/projects`
- `PUT /cc-connect/config/projects`
- `POST /cc-connect/daemon/install`
- `POST /cc-connect/daemon/start`
- `POST /cc-connect/daemon/stop`
- `GET /cc-connect/skills`
- `GET /cc-connect/terminals`
- `GET /cc-connect/sessions`
- `GET /cc-connect/log`

## WebSocket 与 SSE

WebSocket：

- `GET /ws`
- `GET /hermes/terminal/ws`
- `GET /cc-connect/terminal/ws`

SSE 常用于安装、更新、渠道安装、插件安装等长任务。新增长任务接口时优先复用已有 stream event 结构：

- `meta`
- `status`
- `log`
- `error`
- `done`

## 静态前端托管

后端会尝试通过 `internal/web` 提供内嵌前端静态资源。开发阶段通常由 `Client/` 的 Vite 服务直接提供前端；发布阶段可以将构建产物嵌入后端或由 Docker/安装流程提供。

`Server/internal/web/dist/placeholder.txt` 是占位文件，真实 `dist` 构建产物不提交。

## 日志

后端使用 `slog`。请求日志只记录这些前缀：

- `/ws`
- `/api/`
- `/openclaw/`
- `/hermes/`
- `/cc-connect/`

日志级别通过 `LOG_LEVEL` 控制。

## 测试

运行后端测试：

```bash
go test ./...
```

推荐在修改这些模块后至少运行相关测试：

- `internal/config`
- `internal/httpapi/toolenv`
- `internal/httpapi/handlers/hermes`
- `internal/httpapi/handlers/openclaw`
- `internal/httpapi/handlers/ccconnect`

## 构建

构建单二进制：

```bash
go build -o bin/agent-box ./cmd/agent-box
```

`bin/` 是构建产物目录，不提交。

Linux 发布构建脚本在：

```text
../Releases-Build/scripts/build-linux-backend.sh
```

## 编码约定

- 后端 Go 文件如果包含主要业务逻辑或 handler，应在文件开头使用中文注释说明文件职责、接口用途、关键查询参数或缓存策略。
- 文件开头注释只描述当前文件的设计意图和使用约束，不写参考来源或“参考了某某实现”。
- 注释解释为什么和边界条件，避免重复描述代码本身已经表达清楚的实现细节。
- 新增 HTTP API 优先通过 Huma 注册，补齐 `OperationID`、`Summary`、`Description`、`Tags`。
- 新增长任务优先提供 SSE stream 接口，避免前端只能轮询。
- handler 保持按业务域拆分：`openclaw/`、`hermes/`、`ccconnect/`。
- 和本机文件系统、外部 CLI、配置文件交互时，要明确路径来源、默认值和错误提示。

## 安全边界

不要提交：

- `.env`
- `tmp/`
- `bin/`
- `*.db`
- `*.sqlite`
- 真实 token、私钥、证书、cookie、平台凭据

生产环境建议：

- 使用 HTTPS 反代暴露服务。
- 设置固定且足够长的 `AUTH_DEFAULT_TOKEN`，并妥善保存生成后的认证配置。
- 不把登录 token 放在 URL query 里传播。
- 如果后端需要访问 GitHub、npm、OpenAI 等海外服务，优先通过应用内代理设置或环境变量配置代理。

## 排查清单

### 后端启动失败

检查：

- Go 版本是否满足 `go.mod`
- `SERVER_PORT` 是否被占用
- `.env` 是否存在非法行
- `DATABASE_URL` 目录是否可写
- `AUTH_CONFIG_PATH` 目录是否可写

### 前端请求 401

检查：

- `AUTH_CONFIG_PATH` 中的 token
- 前端登录页输入的 token
- 浏览器 localStorage/sessionStorage 中的旧 token

### 安装命令访问外网失败

检查：

- 应用内代理设置
- `HTTP_PROXY`
- `HTTPS_PROXY`
- `ALL_PROXY`
- `NO_PROXY`

### OpenClaw/Hermes/CC-Connect 检测异常

检查：

- `OPENCLAW_HOME`
- `HERMES_HOME`
- `CC_CONNECT_CONFIG`
- `CODEX_HOME`
- `CLAUDE_CONFIG_DIR`
- 对应 CLI 是否安装
- 后端运行用户是否有目录读写权限
