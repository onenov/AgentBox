package httpapi

import (
	"log/slog"
	"net/http"
	"strings"
	"time"

	"agent-box-server/internal/config"
	"agent-box-server/internal/httpapi/handlers"
	ccconnecthandlers "agent-box-server/internal/httpapi/handlers/ccconnect"
	hermeshandlers "agent-box-server/internal/httpapi/handlers/hermes"
	openclawhandlers "agent-box-server/internal/httpapi/handlers/openclaw"
	"agent-box-server/internal/realtime"
	"agent-box-server/internal/version"
	"agent-box-server/internal/web"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/danielgtaylor/huma/v2/sse"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

type RouterOptions struct {
	AuthConfig  *config.BackendAuthStore
	RealtimeHub *realtime.Hub
}

const maxRequestBodyBytes = 16 * 1024 * 1024

func NewRouter(options RouterOptions) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(requestLogMiddleware(slog.Default()))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:*", "http://127.0.0.1:*", "tauri://localhost"},
		AllowedMethods:   []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Agent-Box-Token"},
		AllowCredentials: true,
	}))
	r.Use(maxRequestBodyMiddleware(maxRequestBodyBytes))
	r.Use(authMiddleware(options.AuthConfig))
	r.Use(openClawControlUIOriginMiddleware(slog.Default()))

	apiConfig := huma.DefaultConfig("AgentBox Server API", version.Current())
	apiConfig.OpenAPI.OpenAPI = "3.1.0"
	apiConfig.OpenAPI.Info.Description = "AgentBox Server 提供本机 Agent 管理与 OpenClaw 运维 API。当前已支持系统健康检查、主机环境与网络检测，以及 OpenClaw 环境诊断、Agent 配置管理、workspace bootstrap 文件管理、openclaw.json 配置读写与备份恢复、技能状态/搜索/安装/配置更新、插件清单/搜索/安装/启停/检查/更新/卸载、运行日志 SSE 流式读取。"
	apiConfig.DocsPath = "/docs"
	apiConfig.DocsRenderer = huma.DocsRendererScalar

	api := humachi.New(r, apiConfig)

	registerRoutes(api, options.AuthConfig)

	if options.RealtimeHub != nil {
		r.Get("/ws", options.RealtimeHub.Handle)
	}
	r.Get("/hermes/terminal/ws", hermeshandlers.HandleHermesTerminalWebSocket)
	r.Get("/cc-connect/terminal/ws", ccconnecthandlers.HandleCCConnectTerminalWebSocket)

	if webHandler, err := web.Handler(); err == nil {
		r.NotFound(webHandler.ServeHTTP)
	}

	return r
}

func openClawControlUIOriginMiddleware(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if origin := requestControlUIOrigin(r); origin != "" {
				openclawhandlers.EnsureOpenClawControlUIAllowedOrigin(r.Context(), origin, logger)
			}
			next.ServeHTTP(w, r)
		})
	}
}

func requestControlUIOrigin(r *http.Request) string {
	if r == nil {
		return ""
	}
	for _, value := range []string{
		r.Header.Get("Origin"),
		r.Header.Get("X-Forwarded-Origin"),
		r.Header.Get("Referer"),
	} {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func requestLogMiddleware(logger *slog.Logger) func(http.Handler) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !shouldLogRequestPath(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}

			startedAt := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)

			attrs := []slog.Attr{
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", ww.Status()),
				slog.Int("bytes", ww.BytesWritten()),
				slog.Int64("duration_ms", time.Since(startedAt).Milliseconds()),
				slog.String("remote_addr", r.RemoteAddr),
				slog.String("user_agent", r.UserAgent()),
			}
			if requestID := middleware.GetReqID(r.Context()); requestID != "" {
				attrs = append(attrs, slog.String("request_id", requestID))
			}

			message := "http request"
			switch {
			case ww.Status() >= 500:
				logger.LogAttrs(r.Context(), slog.LevelError, message, attrs...)
			case ww.Status() >= 400:
				logger.LogAttrs(r.Context(), slog.LevelWarn, message, attrs...)
			default:
				logger.LogAttrs(r.Context(), slog.LevelInfo, message, attrs...)
			}
		})
	}
}

func shouldLogRequestPath(path string) bool {
	return path == "/ws" ||
		strings.HasPrefix(path, "/api/") ||
		strings.HasPrefix(path, "/openclaw/") ||
		strings.HasPrefix(path, "/hermes/") ||
		strings.HasPrefix(path, "/cc-connect/")
}

func maxRequestBodyMiddleware(limit int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, limit)
			next.ServeHTTP(w, r)
		})
	}
}

func ccConnectTaskStreamEvents() map[string]any {
	return map[string]any{
		"meta":   ccconnecthandlers.CCConnectTaskStreamMetaEvent{},
		"status": ccconnecthandlers.CCConnectTaskStreamStatusEvent{},
		"log":    ccconnecthandlers.CCConnectTaskStreamLogEvent{},
		"error":  ccconnecthandlers.CCConnectTaskStreamErrorEvent{},
		"done":   ccconnecthandlers.CCConnectTaskStreamDoneEvent{},
	}
}

func pluginInstallStreamEvents() map[string]any {
	return map[string]any{
		"meta":   handlers.PluginActionStreamMetaEvent{},
		"status": handlers.PluginActionStreamStatusEvent{},
		"log":    handlers.PluginActionStreamLogEvent{},
		"error":  handlers.PluginActionStreamErrorEvent{},
		"done":   handlers.PluginActionStreamDoneEvent{},
	}
}

func openClawChannelStreamEvents() map[string]any {
	return map[string]any{
		"meta":   openclawhandlers.OpenClawChannelStreamMetaEvent{},
		"status": openclawhandlers.OpenClawChannelStreamStatusEvent{},
		"log":    openclawhandlers.OpenClawChannelStreamLogEvent{},
		"error":  openclawhandlers.OpenClawChannelStreamErrorEvent{},
		"done":   openclawhandlers.OpenClawChannelStreamDoneEvent{},
	}
}

func hermesTaskStreamEvents() map[string]any {
	return map[string]any{
		"meta":   hermeshandlers.HermesTaskStreamMetaEvent{},
		"status": hermeshandlers.HermesTaskStreamStatusEvent{},
		"log":    hermeshandlers.HermesTaskStreamLogEvent{},
		"error":  hermeshandlers.HermesTaskStreamErrorEvent{},
		"done":   hermeshandlers.HermesTaskStreamDoneEvent{},
	}
}

func registerRoutes(api huma.API, authConfig *config.BackendAuthStore) {
	// huma.Register(api, huma.Operation{
	// 	OperationID: "get-service-info",
	// 	Method:      http.MethodGet,
	// 	Path:        "/",
	// 	Summary:     "Service info",
	// 	Description: "返回管理中心服务基本信息。",
	// 	Tags:        []string{"System"},
	// }, handlers.Health)

	huma.Register(api, huma.Operation{
		OperationID: "get-api-health",
		Method:      http.MethodGet,
		Path:        "/api/health",
		Summary:     "API health check",
		Description: "返回管理中心服务健康状态，保留在 /api 命名空间下便于前端统一调用。",
		Tags:        []string{"System"},
	}, handlers.Health)

	registerAuthRoutes(api, authConfig)

	huma.Register(api, huma.Operation{
		OperationID: "get-environment",
		Method:      http.MethodGet,
		Path:        "/api/environment",
		Summary:     "Host environment detection",
		Description: "检测后端当前运行主机的操作系统、架构、CPU、内存、负载、运行时间、磁盘、网络、进程、Go Runtime、Git、Node.js、npm、Python、uv、Docker，macOS 下额外检测 Homebrew。支持 refresh=true 刷新缓存，section 参数单独查询分组。",
		Tags:        []string{"System"},
	}, handlers.Environment)

	huma.Register(api, huma.Operation{
		OperationID: "get-network-check",
		Method:      http.MethodGet,
		Path:        "/api/network-check",
		Summary:     "Network latency check",
		Description: "从后端主机检测百度、Google 和 GitHub 的访问延迟、状态码和可达性。支持 refresh=true 刷新缓存。",
		Tags:        []string{"System"},
	}, handlers.NetworkCheck)

	huma.Register(api, huma.Operation{
		OperationID: "get-proxy-settings",
		Method:      http.MethodGet,
		Path:        "/api/proxy-settings",
		Summary:     "Read backend proxy settings",
		Description: "读取 AgentBox 后端代理策略。安装命令和后端 HTTP 请求会在直连不可用时按该策略尝试代理。",
		Tags:        []string{"System"},
	}, handlers.GetProxySettings)

	huma.Register(api, huma.Operation{
		OperationID: "update-proxy-settings",
		Method:      http.MethodPut,
		Path:        "/api/proxy-settings",
		Summary:     "Update backend proxy settings",
		Description: "更新 AgentBox 后端代理策略，支持关闭、内置代理和自定义代理。",
		Tags:        []string{"System"},
	}, handlers.UpdateProxySettings)

	huma.Register(api, huma.Operation{
		OperationID: "check-proxy-settings",
		Method:      http.MethodPost,
		Path:        "/api/proxy-settings/check",
		Summary:     "Check backend proxy availability",
		Description: "使用当前或临时代理配置检测公网出口、npm Registry 和 GitHub Raw 可达性。",
		Tags:        []string{"System"},
	}, handlers.CheckProxySettings)

	huma.Register(api, huma.Operation{
		OperationID: "get-logging-settings",
		Method:      http.MethodGet,
		Path:        "/api/logging",
		Summary:     "Read backend logging settings",
		Description: "读取 AgentBox 后端日志级别、日志目录和当前日志文件。",
		Tags:        []string{"System"},
	}, handlers.GetLoggingSettings)

	huma.Register(api, huma.Operation{
		OperationID: "update-logging-settings",
		Method:      http.MethodPut,
		Path:        "/api/logging",
		Summary:     "Update backend logging settings",
		Description: "更新 AgentBox 后端日志级别。支持 debug、info、warn、error，默认 info。",
		Tags:        []string{"System"},
	}, handlers.UpdateLoggingSettings)

	huma.Register(api, huma.Operation{
		OperationID: "clear-logs",
		Method:      http.MethodPost,
		Path:        "/api/logging/clear",
		Summary:     "Clear backend logs",
		Description: "清空 DefaultDataDir/logs 目录中的后端日志文件，并重新打开当前日志文件。",
		Tags:        []string{"System"},
	}, handlers.ClearLogs)

	huma.Register(api, huma.Operation{
		OperationID: "clear-maintenance-sqlite-data",
		Method:      http.MethodPost,
		Path:        "/api/maintenance/sqlite/clear",
		Summary:     "Clear AgentBox SQLite data",
		Description: "清空 AgentBox 后端 SQLite 用户表数据，保留数据库 schema 和内部 sqlite_* 表。",
		Tags:        []string{"System"},
	}, handlers.ClearSQLiteData)

	huma.Register(api, huma.Operation{
		OperationID: "list-plugin-apps",
		Method:      http.MethodGet,
		Path:        "/api/plugins/status",
		Summary:     "List extension applications",
		Description: "读取 AgentBox 管理的第三方扩展应用状态。该接口只检测是否存在与版本信息，慢速更新检查请调用 /api/plugins/updates。支持 refresh=true 强制刷新内存缓存。",
		Tags:        []string{"Plugins"},
	}, handlers.ListPlugins)

	huma.Register(api, huma.Operation{
		OperationID: "list-plugin-app-updates",
		Method:      http.MethodGet,
		Path:        "/api/plugins/updates",
		Summary:     "Check extension application updates",
		Description: "延迟检测第三方扩展应用是否有更新。该接口可能较慢，前端应静默调用；支持 refresh=true 强制刷新内存缓存。",
		Tags:        []string{"Plugins"},
	}, handlers.ListPluginUpdates)

	huma.Register(api, huma.Operation{
		OperationID: "install-plugin-app",
		Method:      http.MethodPost,
		Path:        "/api/plugins/{id}/install",
		Summary:     "Install extension application",
		Description: "安装指定第三方扩展应用。",
		Tags:        []string{"Plugins"},
	}, handlers.InstallPlugin)

	sse.Register(api, huma.Operation{
		OperationID: "stream-install-plugin-app",
		Method:      http.MethodGet,
		Path:        "/api/plugins/{id}/install/stream",
		Summary:     "Stream extension application install",
		Description: "以 Server-Sent Events 安装指定第三方扩展应用，并实时返回安装日志。",
		Tags:        []string{"Plugins"},
	}, pluginInstallStreamEvents(), handlers.InstallPluginStream)

	huma.Register(api, huma.Operation{
		OperationID: "update-plugin-app",
		Method:      http.MethodPost,
		Path:        "/api/plugins/{id}/update",
		Summary:     "Update extension application",
		Description: "更新指定第三方扩展应用。",
		Tags:        []string{"Plugins"},
	}, handlers.UpdatePlugin)

	huma.Register(api, huma.Operation{
		OperationID: "uninstall-plugin-app",
		Method:      http.MethodDelete,
		Path:        "/api/plugins/{id}",
		Summary:     "Uninstall extension application",
		Description: "卸载指定第三方扩展应用。",
		Tags:        []string{"Plugins"},
	}, handlers.UninstallPlugin)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-environment",
		Method:      http.MethodGet,
		Path:        "/openclaw/environment",
		Summary:     "OpenClaw environment detection",
		Description: "检测当前主机上的 OpenClaw CLI、~/.openclaw 配置目录、openclaw.json、Gateway 端口、/health、/healthz、/readyz、设备密钥、owner 记录和错误日志。该接口遵循 OpenClaw 管理命名空间 /openclaw。支持 refresh=true 刷新缓存。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.OpenClawEnvironment)

	huma.Register(api, huma.Operation{
		OperationID: "get-hermes-environment",
		Method:      http.MethodGet,
		Path:        "/hermes/environment",
		Summary:     "Hermes environment detection",
		Description: "检测当前主机上的 Hermes CLI、HERMES_HOME/~/.hermes、config.yaml、.env key 数量、Gateway PID/状态文件、Gateway 进程与监听端口。支持 refresh=true 刷新缓存。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.HermesEnvironment)

	huma.Register(api, huma.Operation{
		OperationID: "get-cc-connect-environment",
		Method:      http.MethodGet,
		Path:        "/cc-connect/environment",
		Summary:     "CC-Connect environment detection",
		Description: "检测当前主机上的 cc-connect CLI、~/.cc-connect/config.toml、daemon 元数据、daemon 运行状态和 Management API 可达性。支持 refresh=true 刷新缓存。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.CCConnectEnvironment)

	huma.Register(api, huma.Operation{
		OperationID: "get-cc-connect-basic-config",
		Method:      http.MethodGet,
		Path:        "/cc-connect/config/basic",
		Summary:     "Read CC-Connect basic config",
		Description: "读取本机 CC-Connect config.toml 的常用基础配置并返回脱敏后的结构化字段，token 只返回是否已设置。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.GetCCConnectBasicConfig)

	huma.Register(api, huma.Operation{
		OperationID: "update-cc-connect-basic-config",
		Method:      http.MethodPut,
		Path:        "/cc-connect/config/basic",
		Summary:     "Update CC-Connect basic config",
		Description: "更新本机 CC-Connect config.toml 的常用基础配置字段，保留 token 等未暴露字段。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.UpdateCCConnectBasicConfig)

	huma.Register(api, huma.Operation{
		OperationID: "get-cc-connect-settings",
		Method:      http.MethodGet,
		Path:        "/cc-connect/settings",
		Summary:     "Read CC-Connect AgentBox settings",
		Description: "读取 AgentBox 后端 SQLite 中的 CC-Connect 本地运行偏好，例如后端启动时自动拉起托管运行时。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.GetCCConnectSettings)

	huma.Register(api, huma.Operation{
		OperationID: "update-cc-connect-settings",
		Method:      http.MethodPut,
		Path:        "/cc-connect/settings",
		Summary:     "Update CC-Connect AgentBox settings",
		Description: "更新 AgentBox 后端 SQLite 中的 CC-Connect 本地运行偏好。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.UpdateCCConnectSettings)

	huma.Register(api, huma.Operation{
		OperationID: "get-cc-connect-models-config",
		Method:      http.MethodGet,
		Path:        "/cc-connect/config/models",
		Summary:     "Read CC-Connect model config",
		Description: "读取本机 CC-Connect config.toml 的全局 providers、项目 provider_refs、agent model 与 active provider 配置。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.GetCCConnectModelsConfig)

	huma.Register(api, huma.Operation{
		OperationID: "update-cc-connect-models-config",
		Method:      http.MethodPut,
		Path:        "/cc-connect/config/models",
		Summary:     "Update CC-Connect model config",
		Description: "更新本机 CC-Connect config.toml 的全局 providers、项目 provider_refs、agent model 与 active provider 配置。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.UpdateCCConnectModelsConfig)

	huma.Register(api, huma.Operation{
		OperationID: "fetch-cc-connect-provider-models",
		Method:      http.MethodPost,
		Path:        "/cc-connect/models/fetch",
		Summary:     "Fetch CC-Connect provider models",
		Description: "从指定 OpenAI-compatible 模型服务商的 /models endpoint 拉取模型清单，用于 CC-Connect 模型配置页面导入模型列表。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.FetchCCConnectProviderModels)

	huma.Register(api, huma.Operation{
		OperationID: "test-cc-connect-provider-model",
		Method:      http.MethodPost,
		Path:        "/cc-connect/models/test",
		Summary:     "Test CC-Connect provider model connectivity",
		Description: "对指定 Base URL、API Key 和模型 ID 发起最小请求，验证 OpenAI-compatible 或 Codex responses 连通性。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.TestCCConnectProviderModel)

	huma.Register(api, huma.Operation{
		OperationID: "get-cc-connect-projects-config",
		Method:      http.MethodGet,
		Path:        "/cc-connect/config/projects",
		Summary:     "Read CC-Connect project config",
		Description: "读取本机 CC-Connect config.toml 的项目、Agent 运行参数和消息平台配置。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.GetCCConnectProjectsConfig)

	huma.Register(api, huma.Operation{
		OperationID: "update-cc-connect-projects-config",
		Method:      http.MethodPut,
		Path:        "/cc-connect/config/projects",
		Summary:     "Update CC-Connect project config",
		Description: "更新本机 CC-Connect config.toml 的项目、Agent 运行参数和消息平台配置。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.UpdateCCConnectProjectsConfig)

	huma.Register(api, huma.Operation{
		OperationID: "begin-cc-connect-feishu-setup",
		Method:      http.MethodPost,
		Path:        "/cc-connect/setup/feishu/begin",
		Summary:     "Begin CC-Connect Feishu QR setup",
		Description: "调用飞书/Lark 设备授权接口生成二维码，用于完整创建项目并连接消息平台。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.CCConnectSetupFeishuBegin)

	huma.Register(api, huma.Operation{
		OperationID: "poll-cc-connect-feishu-setup",
		Method:      http.MethodPost,
		Path:        "/cc-connect/setup/feishu/poll",
		Summary:     "Poll CC-Connect Feishu QR setup",
		Description: "轮询飞书/Lark 设备授权结果，完成后返回 app_id、app_secret 和 owner open_id。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.CCConnectSetupFeishuPoll)

	huma.Register(api, huma.Operation{
		OperationID: "save-cc-connect-feishu-setup",
		Method:      http.MethodPost,
		Path:        "/cc-connect/setup/feishu/save",
		Summary:     "Save CC-Connect Feishu platform setup",
		Description: "保存飞书/Lark 平台凭据；项目不存在时创建项目，确保新增项目完成平台连接后才写入。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.CCConnectSetupFeishuSave)

	huma.Register(api, huma.Operation{
		OperationID: "begin-cc-connect-weixin-setup",
		Method:      http.MethodPost,
		Path:        "/cc-connect/setup/weixin/begin",
		Summary:     "Begin CC-Connect Weixin QR setup",
		Description: "调用 iLink 获取微信机器人二维码，用于完整创建项目并连接消息平台。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.CCConnectSetupWeixinBegin)

	huma.Register(api, huma.Operation{
		OperationID: "poll-cc-connect-weixin-setup",
		Method:      http.MethodPost,
		Path:        "/cc-connect/setup/weixin/poll",
		Summary:     "Poll CC-Connect Weixin QR setup",
		Description: "轮询微信机器人扫码结果，完成后返回 bot token 和账号信息。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.CCConnectSetupWeixinPoll)

	huma.Register(api, huma.Operation{
		OperationID: "save-cc-connect-weixin-setup",
		Method:      http.MethodPost,
		Path:        "/cc-connect/setup/weixin/save",
		Summary:     "Save CC-Connect Weixin platform setup",
		Description: "保存微信平台凭据；项目不存在时创建项目，确保新增项目完成平台连接后才写入。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.CCConnectSetupWeixinSave)

	huma.Register(api, huma.Operation{
		OperationID: "add-cc-connect-project-platform",
		Method:      http.MethodPost,
		Path:        "/cc-connect/projects/platforms",
		Summary:     "Add CC-Connect project platform",
		Description: "手动添加消息平台；项目不存在时创建项目，必须提交该平台必填凭据，不提供跳过流程。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.AddCCConnectProjectPlatform)

	huma.Register(api, huma.Operation{
		OperationID: "get-cc-connect-config",
		Method:      http.MethodGet,
		Path:        "/cc-connect/config",
		Summary:     "Read CC-Connect config file",
		Description: "读取本机 CC-Connect config.toml 原始 TOML 内容。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.GetCCConnectConfig)

	huma.Register(api, huma.Operation{
		OperationID: "update-cc-connect-config",
		Method:      http.MethodPut,
		Path:        "/cc-connect/config",
		Summary:     "Update CC-Connect config file",
		Description: "更新本机 CC-Connect config.toml 原始 TOML 内容，写入前会校验 TOML 语法。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.UpdateCCConnectConfig)

	huma.Register(api, huma.Operation{
		OperationID: "install-cc-connect-daemon",
		Method:      http.MethodPost,
		Path:        "/cc-connect/daemon/install",
		Summary:     "Start CC-Connect runtime",
		Description: "由 AgentBox 后端创建 cc-connect 子进程并后台运行；启动时使用 --force 接管同配置的既有实例，并清理服务信息缓存。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.InstallCCConnectDaemon)

	huma.Register(api, huma.Operation{
		OperationID: "start-cc-connect-daemon",
		Method:      http.MethodPost,
		Path:        "/cc-connect/daemon/start",
		Summary:     "Start CC-Connect runtime",
		Description: "由 AgentBox 后端创建 cc-connect 子进程并后台运行；启动时使用 --force 接管同配置的既有实例，并清理服务信息缓存。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.StartCCConnectDaemon)

	huma.Register(api, huma.Operation{
		OperationID: "stop-cc-connect-daemon",
		Method:      http.MethodPost,
		Path:        "/cc-connect/daemon/stop",
		Summary:     "Stop CC-Connect runtime",
		Description: "停止 AgentBox 管理的 cc-connect 子进程；若未记录子进程，则按 Management API 端口监听进程兜底停止，并清理服务信息缓存。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.StopCCConnectDaemon)

	huma.Register(api, huma.Operation{
		OperationID: "restart-cc-connect-daemon",
		Method:      http.MethodPost,
		Path:        "/cc-connect/daemon/restart",
		Summary:     "Restart CC-Connect runtime",
		Description: "由 AgentBox 后端以 --force 重新拉起 cc-connect 子进程，自动接管同配置既有实例，并清理服务信息缓存。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.RestartCCConnectDaemon)

	sse.Register(api, huma.Operation{
		OperationID: "stream-install-cc-connect",
		Method:      http.MethodGet,
		Path:        "/cc-connect/install",
		Summary:     "Stream CC-Connect install",
		Description: "以 Server-Sent Events 安装 CC-Connect CLI、初始化 config.toml、启用 AgentBox 托管自动启动并尝试拉起运行时。",
		Tags:        []string{"CC-Connect"},
	}, ccConnectTaskStreamEvents(), ccconnecthandlers.InstallCCConnectStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-uninstall-cc-connect",
		Method:      http.MethodGet,
		Path:        "/cc-connect/uninstall",
		Summary:     "Stream CC-Connect uninstall",
		Description: "以 Server-Sent Events 停止 CC-Connect 运行时、移除 Home、本机数据和 CLI，并实时返回终端日志。",
		Tags:        []string{"CC-Connect"},
	}, ccConnectTaskStreamEvents(), ccconnecthandlers.UninstallCCConnectStream)

	huma.Register(api, huma.Operation{
		OperationID: "list-cc-connect-skills",
		Method:      http.MethodGet,
		Path:        "/cc-connect/skills",
		Summary:     "List CC-Connect skills",
		Description: "通过 CC-Connect Management API 读取各项目 Agent 从 SKILL.md 自动发现的本地技能清单。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.GetCCConnectSkills)

	huma.Register(api, huma.Operation{
		OperationID: "list-cc-connect-skill-presets",
		Method:      http.MethodGet,
		Path:        "/cc-connect/skills/presets",
		Summary:     "List CC-Connect skill presets",
		Description: "通过 CC-Connect Management API 读取推荐技能预设，用于技能中心发现页。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.GetCCConnectSkillPresets)

	huma.Register(api, huma.Operation{
		OperationID: "search-cc-connect-skills",
		Method:      http.MethodGet,
		Path:        "/cc-connect/skills/search",
		Summary:     "Search CC-Connect Skills Hub",
		Description: "通过 skillhub CLI 搜索 Skills Hub，可用于安装到 CC-Connect 本机技能库。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.SearchCCConnectSkills)

	huma.Register(api, huma.Operation{
		OperationID: "get-cc-connect-skills-showcase-hot",
		Method:      http.MethodGet,
		Path:        "/cc-connect/skills/showcase/hot",
		Summary:     "Get CC-Connect SkillHub hot showcase",
		Description: "读取 SkillHub 热门技能列表，用于 CC-Connect 技能中心的发现页面。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.GetCCConnectSkillsShowcaseHot)

	huma.Register(api, huma.Operation{
		OperationID: "install-cc-connect-skill",
		Method:      http.MethodPost,
		Path:        "/cc-connect/skills/install",
		Summary:     "Install CC-Connect skill",
		Description: "通过 skillhub CLI 将 Skills Hub 技能安装到 CC-Connect 可用的全局本机技能库；可选重启托管运行时以立即生效。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.InstallCCConnectSkill)

	huma.Register(api, huma.Operation{
		OperationID: "get-cc-connect-skill",
		Method:      http.MethodGet,
		Path:        "/cc-connect/skills/{name}",
		Summary:     "Get CC-Connect skill detail",
		Description: "读取 CC-Connect 本机全局技能详情，并返回可读取的 SKILL.md 内容。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.GetCCConnectSkill)

	huma.Register(api, huma.Operation{
		OperationID: "list-cc-connect-agent-engines",
		Method:      http.MethodGet,
		Path:        "/cc-connect/agent-engines",
		Summary:     "List CC-Connect agent engines",
		Description: "检测 claudecode/codex/gemini/opencode/qoder CLI 是否已安装，供终端启动前选择可用引擎。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.ListCCConnectAgentEngines)

	huma.Register(api, huma.Operation{
		OperationID: "list-cc-connect-terminals",
		Method:      http.MethodGet,
		Path:        "/cc-connect/terminals",
		Summary:     "List CC-Connect terminal sessions",
		Description: "列出 AgentBox 后端托管的 CC-Connect Web Terminal 会话；支持按项目筛选。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.ListCCConnectTerminals)

	huma.Register(api, huma.Operation{
		OperationID: "create-cc-connect-terminal",
		Method:      http.MethodPost,
		Path:        "/cc-connect/terminals",
		Summary:     "Create CC-Connect terminal session",
		Description: "按 CC-Connect 项目 work_dir 启动 claudecode/codex/gemini/opencode/qoder 终端会话。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.CreateCCConnectTerminal)

	huma.Register(api, huma.Operation{
		OperationID: "get-cc-connect-terminal",
		Method:      http.MethodGet,
		Path:        "/cc-connect/terminals/{id}",
		Summary:     "Get CC-Connect terminal session",
		Description: "读取 CC-Connect Web Terminal 会话状态和后端保留的 scrollback。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.GetCCConnectTerminal)

	huma.Register(api, huma.Operation{
		OperationID: "stop-cc-connect-terminal",
		Method:      http.MethodDelete,
		Path:        "/cc-connect/terminals/{id}",
		Summary:     "Stop CC-Connect terminal session",
		Description: "停止指定 CC-Connect Web Terminal 会话中的 PTY 进程。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.StopCCConnectTerminal)

	huma.Register(api, huma.Operation{
		OperationID: "delete-cc-connect-terminal-record",
		Method:      http.MethodDelete,
		Path:        "/cc-connect/terminals/{id}/record",
		Summary:     "Delete CC-Connect terminal session record",
		Description: "删除已退出 CC-Connect Web Terminal 会话的 SQLite 记录；运行中的终端不会被删除。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.DeleteCCConnectTerminalRecord)

	huma.Register(api, huma.Operation{
		OperationID: "list-cc-connect-sessions",
		Method:      http.MethodGet,
		Path:        "/cc-connect/sessions",
		Summary:     "List CC-Connect agent sessions",
		Description: "跨 CC-Connect 项目读取 claudecode/codex/gemini/opencode/qoder 本机会话，支持搜索、状态筛选、分页和批量管理。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.ListCCConnectSessions)

	huma.Register(api, huma.Operation{
		OperationID: "get-cc-connect-session",
		Method:      http.MethodGet,
		Path:        "/cc-connect/sessions/{project}/{id}",
		Summary:     "Get CC-Connect session",
		Description: "读取指定 CC-Connect 项目的单个 Agent 会话详情与消息时间线。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.GetCCConnectSession)

	huma.Register(api, huma.Operation{
		OperationID: "end-cc-connect-session",
		Method:      http.MethodPost,
		Path:        "/cc-connect/sessions/{project}/{id}/end",
		Summary:     "End CC-Connect session",
		Description: "结束指定 CC-Connect 会话：尽力停止本机引用该 session 的 Web Terminal 进程。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.EndCCConnectSession)

	huma.Register(api, huma.Operation{
		OperationID: "delete-cc-connect-sessions",
		Method:      http.MethodPost,
		Path:        "/cc-connect/sessions/bulk-delete",
		Summary:     "Delete CC-Connect sessions",
		Description: "批量删除指定 CC-Connect 项目中的本机会话，跳过仍被 Web Terminal 引用的会话。",
		Tags:        []string{"CC-Connect"},
	}, ccconnecthandlers.DeleteCCConnectSessions)

	sse.Register(api, huma.Operation{
		OperationID: "stream-cc-connect-log",
		Method:      http.MethodGet,
		Path:        "/cc-connect/log",
		Summary:     "Stream CC-Connect log",
		Description: "以 Server-Sent Events 流式读取当前主机 CC-Connect data_dir/logs 下的运行日志。支持 kind=runtime、main；支持 file、tail、follow、filter、levels 查询参数。",
		Tags:        []string{"CC-Connect"},
	}, map[string]any{
		"meta":  ccconnecthandlers.CCConnectLogMetaEvent{},
		"log":   ccconnecthandlers.CCConnectLogLineEvent{},
		"error": ccconnecthandlers.CCConnectLogErrorEvent{},
		"done":  ccconnecthandlers.CCConnectLogDoneEvent{},
	}, ccconnecthandlers.CCConnectLogStream)

	huma.Register(api, huma.Operation{
		OperationID: "get-hermes-instances",
		Method:      http.MethodGet,
		Path:        "/hermes/instances",
		Summary:     "Hermes instances",
		Description: "读取 Hermes Gateway 状态、后台进程注册表和 state.db 最近会话，用于展示本机 Hermes 实例与运行任务。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.HermesInstances)

	huma.Register(api, huma.Operation{
		OperationID: "list-hermes-terminals",
		Method:      http.MethodGet,
		Path:        "/hermes/terminals",
		Summary:     "List Hermes terminal sessions",
		Description: "列出 AgentBox 后端托管的 Hermes Web Terminal 会话；这些会话可在浏览器断开后继续后台运行。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.ListHermesTerminals)

	huma.Register(api, huma.Operation{
		OperationID: "create-hermes-terminal",
		Method:      http.MethodPost,
		Path:        "/hermes/terminals",
		Summary:     "Create Hermes terminal session",
		Description: "启动一个受限 Hermes 终端会话，默认运行 hermes chat，支持指定 Profile、命令模板和 PTY 尺寸。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.CreateHermesTerminal)

	huma.Register(api, huma.Operation{
		OperationID: "get-hermes-terminal",
		Method:      http.MethodGet,
		Path:        "/hermes/terminals/{id}",
		Summary:     "Get Hermes terminal session",
		Description: "读取 Hermes Web Terminal 会话状态和后端保留的 scrollback。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.GetHermesTerminal)

	huma.Register(api, huma.Operation{
		OperationID: "stop-hermes-terminal",
		Method:      http.MethodDelete,
		Path:        "/hermes/terminals/{id}",
		Summary:     "Stop Hermes terminal session",
		Description: "停止指定 Hermes Web Terminal 会话中的 PTY 进程。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.StopHermesTerminal)

	huma.Register(api, huma.Operation{
		OperationID: "delete-hermes-terminal-record",
		Method:      http.MethodDelete,
		Path:        "/hermes/terminals/{id}/record",
		Summary:     "Delete Hermes terminal session record",
		Description: "删除已退出 Hermes Web Terminal 会话的 SQLite 记录；运行中的终端不会被删除。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.DeleteHermesTerminalRecord)

	huma.Register(api, huma.Operation{
		OperationID: "list-hermes-sessions",
		Method:      http.MethodGet,
		Path:        "/hermes/sessions",
		Summary:     "List Hermes sessions",
		Description: "跨 Hermes Profiles 读取 state.db 会话，支持全文搜索、状态筛选、分页和批量管理。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.ListHermesSessions)

	huma.Register(api, huma.Operation{
		OperationID: "get-hermes-session",
		Method:      http.MethodGet,
		Path:        "/hermes/sessions/{profile}/{id}",
		Summary:     "Get Hermes session",
		Description: "读取指定 Hermes Profile 的单个会话详情与消息时间线。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.GetHermesSession)

	huma.Register(api, huma.Operation{
		OperationID: "end-hermes-session",
		Method:      http.MethodPost,
		Path:        "/hermes/sessions/{profile}/{id}/end",
		Summary:     "End Hermes session",
		Description: "结束指定 Hermes 会话：尽力中断本机引用该 session 的运行进程，并写入 state.db ended_at/end_reason。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.EndHermesSession)

	huma.Register(api, huma.Operation{
		OperationID: "delete-hermes-sessions",
		Method:      http.MethodPost,
		Path:        "/hermes/sessions/bulk-delete",
		Summary:     "Delete Hermes sessions",
		Description: "批量删除指定 Hermes Profile 中的会话，跳过仍被本机运行进程引用的会话。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.DeleteHermesSessions)

	huma.Register(api, huma.Operation{
		OperationID: "list-hermes-agents",
		Method:      http.MethodGet,
		Path:        "/hermes/agents",
		Summary:     "List Hermes agents",
		Description: "读取本机 Hermes Profiles 多 Agent 配置，返回 default 与 ~/.hermes/profiles/* 的配置文件、SOUL、.env、技能、会话、日志和 Gateway 摘要。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.ListHermesAgents)

	huma.Register(api, huma.Operation{
		OperationID: "create-hermes-agent",
		Method:      http.MethodPost,
		Path:        "/hermes/agents",
		Summary:     "Create Hermes agent",
		Description: "通过 Hermes profile create 创建新的隔离 Profile，可选择 fresh、clone 或 clone-all。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.CreateHermesAgent)

	huma.Register(api, huma.Operation{
		OperationID: "get-hermes-agent",
		Method:      http.MethodGet,
		Path:        "/hermes/agents/{name}",
		Summary:     "Get Hermes agent",
		Description: "读取指定 Hermes Profile 的详情和可管理文件状态。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.GetHermesAgent)

	huma.Register(api, huma.Operation{
		OperationID: "rename-hermes-agent",
		Method:      http.MethodPatch,
		Path:        "/hermes/agents/{name}",
		Summary:     "Rename Hermes agent",
		Description: "通过 Hermes profile rename 重命名指定 Profile。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.RenameHermesAgent)

	huma.Register(api, huma.Operation{
		OperationID: "delete-hermes-agent",
		Method:      http.MethodDelete,
		Path:        "/hermes/agents/{name}",
		Summary:     "Delete Hermes agent",
		Description: "通过 Hermes profile delete --yes 删除指定 Profile。default 不可删除。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.DeleteHermesAgent)

	huma.Register(api, huma.Operation{
		OperationID: "use-hermes-agent",
		Method:      http.MethodPost,
		Path:        "/hermes/agents/{name}/use",
		Summary:     "Use Hermes agent",
		Description: "通过 Hermes profile use 将指定 Profile 设为 sticky active profile。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.UseHermesAgent)

	huma.Register(api, huma.Operation{
		OperationID: "get-hermes-agent-file",
		Method:      http.MethodGet,
		Path:        "/hermes/agents/{name}/files/{file}",
		Summary:     "Read Hermes agent file",
		Description: "读取指定 Hermes Profile 的 config.yaml、.env、SOUL.md、memories/MEMORY.md 或 memories/USER.md 原文。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.GetHermesAgentFile)

	huma.Register(api, huma.Operation{
		OperationID: "update-hermes-agent-file",
		Method:      http.MethodPut,
		Path:        "/hermes/agents/{name}/files/{file}",
		Summary:     "Update Hermes agent file",
		Description: "更新指定 Hermes Profile 的 config.yaml、.env、SOUL.md、memories/MEMORY.md 或 memories/USER.md 原文。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.UpdateHermesAgentFile)

	huma.Register(api, huma.Operation{
		OperationID: "list-hermes-skills",
		Method:      http.MethodGet,
		Path:        "/hermes/skills",
		Summary:     "Hermes skills",
		Description: "扫描当前主机 Hermes skills 目录和 skills.external_dirs，返回本地已安装技能、分类、启停状态、来源和辅助文件摘要。支持 refresh=true 刷新缓存。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.ListHermesSkills)

	huma.Register(api, huma.Operation{
		OperationID: "reload-hermes-skills",
		Method:      http.MethodPost,
		Path:        "/hermes/skills/reload",
		Summary:     "Reload Hermes skills inventory",
		Description: "清理后端 Hermes 技能缓存并重新扫描本机技能目录；运行中的 Hermes TUI 会话仍需使用 /reload-skills 重新加载命令。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.ReloadHermesSkills)

	huma.Register(api, huma.Operation{
		OperationID: "search-hermes-skills",
		Method:      http.MethodGet,
		Path:        "/hermes/skills/search",
		Summary:     "Search Hermes skills hub",
		Description: "通过 Hermes Skills Hub 搜索可安装技能，返回结构化结果用于 Dashboard 搜索安装。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.SearchHermesSkills)

	huma.Register(api, huma.Operation{
		OperationID: "discover-hermes-skills",
		Method:      http.MethodGet,
		Path:        "/hermes/skills/discover",
		Summary:     "Discover Hermes skills",
		Description: "浏览 Hermes Skills Hub 可安装技能，默认展示 official optional skills。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.DiscoverHermesSkills)

	huma.Register(api, huma.Operation{
		OperationID: "install-hermes-skill",
		Method:      http.MethodPost,
		Path:        "/hermes/skills/install",
		Summary:     "Install Hermes skill",
		Description: "通过 Hermes CLI 安装 Skills Hub 技能，保留官方安全扫描与 .hub/lock.json 来源记录；安装后刷新 Dashboard 技能扫描缓存。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.InstallHermesSkill)

	huma.Register(api, huma.Operation{
		OperationID: "get-hermes-skill",
		Method:      http.MethodGet,
		Path:        "/hermes/skills/{name}",
		Summary:     "Get Hermes skill",
		Description: "读取指定 Hermes 技能的元数据与 SKILL.md 原文。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.GetHermesSkill)

	huma.Register(api, huma.Operation{
		OperationID: "toggle-hermes-skill",
		Method:      http.MethodPut,
		Path:        "/hermes/skills/{name}",
		Summary:     "Toggle Hermes skill",
		Description: "通过更新 config.yaml 的 skills.disabled 启用或停用指定 Hermes 技能。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.ToggleHermesSkill)

	huma.Register(api, huma.Operation{
		OperationID: "get-hermes-models",
		Method:      http.MethodGet,
		Path:        "/hermes/models",
		Summary:     "Read Hermes model config",
		Description: "读取当前主机 Hermes config.yaml 中的 model、providers、fallback_providers 和 credential_pool_strategies，并归一化为 Dashboard 可编辑结构。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.GetHermesModels)

	huma.Register(api, huma.Operation{
		OperationID: "update-hermes-models",
		Method:      http.MethodPut,
		Path:        "/hermes/models",
		Summary:     "Update Hermes model config",
		Description: "更新当前主机 Hermes config.yaml 中的模型配置字段，同时保留其他配置段。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.UpdateHermesModels)

	huma.Register(api, huma.Operation{
		OperationID: "fetch-hermes-provider-models",
		Method:      http.MethodPost,
		Path:        "/hermes/models/fetch",
		Summary:     "Fetch Hermes provider models",
		Description: "按 Hermes api_mode 从指定服务商的 models endpoint 拉取模型清单，用于 Hermes 模型配置页面导入模型列表。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.FetchHermesProviderModels)

	huma.Register(api, huma.Operation{
		OperationID: "test-hermes-provider-model",
		Method:      http.MethodPost,
		Path:        "/hermes/models/test",
		Summary:     "Test Hermes provider model connectivity",
		Description: "对指定 Hermes api_mode、Base URL、API Key 和模型 ID 发起最小请求，验证连通性。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.TestHermesProviderModel)

	huma.Register(api, huma.Operation{
		OperationID: "list-hermes-platforms",
		Method:      http.MethodGet,
		Path:        "/hermes/platforms",
		Summary:     "List Hermes messaging platforms",
		Description: "聚合 Hermes config.yaml、.env 和 gateway_state.json，返回当前 Profile 的消息平台启用状态、凭据存在性、运行状态和基础策略配置。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.ListHermesPlatforms)

	huma.Register(api, huma.Operation{
		OperationID: "update-hermes-platform",
		Method:      http.MethodPatch,
		Path:        "/hermes/platforms/{name}",
		Summary:     "Update Hermes messaging platform",
		Description: "更新指定 Hermes 消息平台的启用状态和基础行为策略，写入当前 Profile 的 config.yaml。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.UpdateHermesPlatform)

	huma.Register(api, huma.Operation{
		OperationID: "list-hermes-pairing-requests",
		Method:      http.MethodGet,
		Path:        "/hermes/pairing/{platform}",
		Summary:     "List Hermes pairing requests",
		Description: "列出指定 Hermes Profile 与消息平台的待审批 pairing 请求。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.ListHermesPairingRequests)

	huma.Register(api, huma.Operation{
		OperationID: "approve-hermes-pairing-request",
		Method:      http.MethodPost,
		Path:        "/hermes/pairing/{platform}/approve",
		Summary:     "Approve Hermes pairing request",
		Description: "通过 Hermes CLI 批准指定消息平台的 pairing code。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.ApproveHermesPairingRequest)

	huma.Register(api, huma.Operation{
		OperationID: "restart-hermes-gateway",
		Method:      http.MethodPost,
		Path:        "/hermes/gateway/restart",
		Summary:     "Restart Hermes Gateway",
		Description: "通过 Hermes CLI 重启 Gateway 服务，并清理服务信息缓存。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.RestartHermesGateway)

	huma.Register(api, huma.Operation{
		OperationID: "stop-hermes-gateway",
		Method:      http.MethodPost,
		Path:        "/hermes/gateway/stop",
		Summary:     "Stop Hermes Gateway",
		Description: "通过 Hermes CLI 停止 Gateway 服务，并清理服务信息缓存。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.StopHermesGateway)

	huma.Register(api, huma.Operation{
		OperationID: "get-hermes-update-status",
		Method:      http.MethodGet,
		Path:        "/hermes/update/status",
		Summary:     "Check Hermes update status",
		Description: "通过官方 `hermes update status --json` 检测当前 Hermes CLI 是否存在可用更新。支持 refresh=true 刷新缓存。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.HermesUpdateStatus)

	huma.Register(api, huma.Operation{
		OperationID: "update-hermes",
		Method:      http.MethodPost,
		Path:        "/hermes/update",
		Summary:     "Update Hermes",
		Description: "通过官方 `hermes update --json` 执行 Hermes 更新，并清理本地环境与更新状态缓存。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.UpdateHermes)

	sse.Register(api, huma.Operation{
		OperationID: "stream-update-hermes",
		Method:      http.MethodGet,
		Path:        "/hermes/update/stream",
		Summary:     "Stream Hermes update",
		Description: "以 Server-Sent Events 执行官方 `hermes update --json` 更新流程，并实时返回终端日志。",
		Tags:        []string{"Hermes"},
	}, hermesTaskStreamEvents(), hermeshandlers.UpdateHermesStream)

	huma.Register(api, huma.Operation{
		OperationID: "get-hermes-config",
		Method:      http.MethodGet,
		Path:        "/hermes/config",
		Summary:     "Read Hermes config",
		Description: "读取当前主机 Hermes home 下的 config.yaml 原文。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.GetHermesConfig)

	huma.Register(api, huma.Operation{
		OperationID: "update-hermes-config",
		Method:      http.MethodPut,
		Path:        "/hermes/config",
		Summary:     "Update Hermes config",
		Description: "更新当前主机 Hermes home 下的 config.yaml 原文。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.UpdateHermesConfig)

	huma.Register(api, huma.Operation{
		OperationID: "get-hermes-env",
		Method:      http.MethodGet,
		Path:        "/hermes/env",
		Summary:     "Read Hermes env",
		Description: "读取当前主机 Hermes home 下的 .env 原文。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.GetHermesEnv)

	huma.Register(api, huma.Operation{
		OperationID: "update-hermes-env",
		Method:      http.MethodPut,
		Path:        "/hermes/env",
		Summary:     "Update Hermes env",
		Description: "更新当前主机 Hermes home 下的 .env 原文。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.UpdateHermesEnv)

	huma.Register(api, huma.Operation{
		OperationID: "list-hermes-plugins",
		Method:      http.MethodGet,
		Path:        "/hermes/plugins",
		Summary:     "Hermes plugins",
		Description: "扫描 Hermes bundled/user/project 插件目录，读取 plugin.yaml、dashboard manifest 和 config.yaml 中的 plugins.enabled/disabled。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.ListHermesPlugins)

	huma.Register(api, huma.Operation{
		OperationID: "install-hermes-plugin",
		Method:      http.MethodPost,
		Path:        "/hermes/plugins/install",
		Summary:     "Install Hermes plugin",
		Description: "通过 hermes plugins install 从 Git URL 或 owner/repo shorthand 安装插件，可选择安装后启用。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.InstallHermesPlugin)

	huma.Register(api, huma.Operation{
		OperationID: "get-hermes-plugin",
		Method:      http.MethodGet,
		Path:        "/hermes/plugins/{name}",
		Summary:     "Get Hermes plugin",
		Description: "读取指定 Hermes 插件的 manifest、README、after-install、dashboard manifest 和 __init__.py 预览。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.GetHermesPlugin)

	huma.Register(api, huma.Operation{
		OperationID: "enable-hermes-plugin",
		Method:      http.MethodPost,
		Path:        "/hermes/plugins/{name}/enable",
		Summary:     "Enable Hermes plugin",
		Description: "调用 hermes plugins enable 将插件加入 plugins.enabled，并从 plugins.disabled 移除。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.EnableHermesPlugin)

	huma.Register(api, huma.Operation{
		OperationID: "disable-hermes-plugin",
		Method:      http.MethodPost,
		Path:        "/hermes/plugins/{name}/disable",
		Summary:     "Disable Hermes plugin",
		Description: "调用 hermes plugins disable 从 plugins.enabled 移除插件并加入 plugins.disabled。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.DisableHermesPlugin)

	huma.Register(api, huma.Operation{
		OperationID: "update-hermes-plugin",
		Method:      http.MethodPost,
		Path:        "/hermes/plugins/{name}/update",
		Summary:     "Update Hermes plugin",
		Description: "调用 hermes plugins update 对 Git 安装的插件执行 git pull。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.UpdateHermesPlugin)

	huma.Register(api, huma.Operation{
		OperationID: "delete-hermes-plugin",
		Method:      http.MethodDelete,
		Path:        "/hermes/plugins/{name}",
		Summary:     "Remove Hermes plugin",
		Description: "调用 hermes plugins remove 删除用户安装插件。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.UninstallHermesPlugin)

	huma.Register(api, huma.Operation{
		OperationID: "get-hermes-cron-status",
		Method:      http.MethodGet,
		Path:        "/hermes/cron/status",
		Summary:     "Hermes cron status",
		Description: "读取 Hermes cron 存储、Gateway 运行状态、任务数量和下一次运行时间。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.GetHermesCronStatus)

	huma.Register(api, huma.Operation{
		OperationID: "list-hermes-cron-jobs",
		Method:      http.MethodGet,
		Path:        "/hermes/cron/jobs",
		Summary:     "List Hermes cron jobs",
		Description: "读取 ~/.hermes/cron/jobs.json，支持分页、搜索、启用状态和排序。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.ListHermesCronJobs)

	huma.Register(api, huma.Operation{
		OperationID: "create-hermes-cron-job",
		Method:      http.MethodPost,
		Path:        "/hermes/cron/jobs",
		Summary:     "Create Hermes cron job",
		Description: "通过 Hermes cron.jobs 模块创建定时任务，保留 Hermes 的 schedule 校验、repeat、script/no-agent、workdir 等语义。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.CreateHermesCronJob)

	huma.Register(api, huma.Operation{
		OperationID: "update-hermes-cron-job",
		Method:      http.MethodPatch,
		Path:        "/hermes/cron/jobs/{id}",
		Summary:     "Update Hermes cron job",
		Description: "通过 Hermes cron.jobs 模块更新定时任务。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.UpdateHermesCronJob)

	huma.Register(api, huma.Operation{
		OperationID: "delete-hermes-cron-job",
		Method:      http.MethodDelete,
		Path:        "/hermes/cron/jobs/{id}",
		Summary:     "Delete Hermes cron job",
		Description: "删除 Hermes 定时任务并清理对应输出目录。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.DeleteHermesCronJob)

	huma.Register(api, huma.Operation{
		OperationID: "run-hermes-cron-job",
		Method:      http.MethodPost,
		Path:        "/hermes/cron/jobs/{id}/run",
		Summary:     "Run Hermes cron job",
		Description: "将 Hermes 定时任务标记为下一次 scheduler tick 立即运行。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.RunHermesCronJob)

	huma.Register(api, huma.Operation{
		OperationID: "list-hermes-cron-runs",
		Method:      http.MethodGet,
		Path:        "/hermes/cron/runs",
		Summary:     "List Hermes cron run output",
		Description: "读取 ~/.hermes/cron/output 下的定时任务输出 markdown 文件作为运行历史。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.ListHermesCronRuns)

	huma.Register(api, huma.Operation{
		OperationID: "list-hermes-kanban-boards",
		Method:      http.MethodGet,
		Path:        "/hermes/kanban/boards",
		Summary:     "List Hermes Kanban boards",
		Description: "读取 Hermes Kanban 多 Board 元数据和任务计数。支持 profile 参数切换 Hermes Agent。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.ListHermesKanbanBoards)

	huma.Register(api, huma.Operation{
		OperationID: "get-hermes-kanban-board",
		Method:      http.MethodGet,
		Path:        "/hermes/kanban/board",
		Summary:     "Get Hermes Kanban board",
		Description: "读取 Hermes Kanban 看板任务，按 triage/todo/ready/running/blocked/done 分组，写操作与 Hermes CLI/Gateway 共享 kanban_db 逻辑。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.GetHermesKanbanBoard)

	huma.Register(api, huma.Operation{
		OperationID: "create-hermes-kanban-task",
		Method:      http.MethodPost,
		Path:        "/hermes/kanban/tasks",
		Summary:     "Create Hermes Kanban task",
		Description: "通过 Hermes kanban_db 创建任务，保留父任务、triage、skills、runtime cap 等语义。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.CreateHermesKanbanTask)

	huma.Register(api, huma.Operation{
		OperationID: "get-hermes-kanban-task",
		Method:      http.MethodGet,
		Path:        "/hermes/kanban/tasks/{id}",
		Summary:     "Get Hermes Kanban task detail",
		Description: "读取 Hermes Kanban 任务详情、评论、事件、依赖链接和运行历史。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.GetHermesKanbanTask)

	huma.Register(api, huma.Operation{
		OperationID: "update-hermes-kanban-task",
		Method:      http.MethodPatch,
		Path:        "/hermes/kanban/tasks/{id}",
		Summary:     "Update Hermes Kanban task",
		Description: "更新 Hermes Kanban 任务状态、标题、正文、优先级或 assignee。running 只能由 dispatcher claim path 设置。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.UpdateHermesKanbanTask)

	huma.Register(api, huma.Operation{
		OperationID: "add-hermes-kanban-comment",
		Method:      http.MethodPost,
		Path:        "/hermes/kanban/tasks/{id}/comments",
		Summary:     "Add Hermes Kanban task comment",
		Description: "向 Hermes Kanban 任务添加评论并记录事件。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.AddHermesKanbanComment)

	huma.Register(api, huma.Operation{
		OperationID: "dispatch-hermes-kanban",
		Method:      http.MethodPost,
		Path:        "/hermes/kanban/dispatch",
		Summary:     "Dispatch Hermes Kanban",
		Description: "执行一次 Hermes Kanban dispatcher tick，用于立即认领 Ready 任务。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.DispatchHermesKanban)

	huma.Register(api, huma.Operation{
		OperationID: "get-hermes-message-stats",
		Method:      http.MethodGet,
		Path:        "/hermes/messages/stats",
		Summary:     "Hermes message statistics",
		Description: "扫描本机 Hermes Profile 的 sessions/*.jsonl，并结合 sessions/sessions.json 解析平台会话信息，按小时桶汇总 user、assistant、tool 等消息数量。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.HermesMessageStats)

	huma.Register(api, huma.Operation{
		OperationID: "get-hermes-recent-messages",
		Method:      http.MethodGet,
		Path:        "/hermes/messages/recent",
		Summary:     "Hermes recent messages",
		Description: "扫描本机 Hermes Profile 的 sessions/*.jsonl，并结合 sessions/sessions.json 返回最近用户和助手消息列表。",
		Tags:        []string{"Hermes"},
	}, hermeshandlers.HermesRecentMessages)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-message-stats",
		Method:      http.MethodGet,
		Path:        "/openclaw/messages/stats",
		Summary:     "OpenClaw message statistics",
		Description: "扫描本机 ~/.openclaw/agents/*/sessions/*.jsonl 中的结构化消息记录，按 Agent 和小时桶汇总 user、assistant、toolResult 等消息数量。支持 agentId 和 hours 查询参数。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.OpenClawMessageStats)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-recent-messages",
		Method:      http.MethodGet,
		Path:        "/openclaw/messages/recent",
		Summary:     "OpenClaw recent channel messages",
		Description: "扫描本机 ~/.openclaw/agents/*/sessions/*.jsonl 中的结构化用户消息和 assistant 回复，过滤 heartbeat 轮询并解析 Conversation info 元数据，返回最近渠道收发消息。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.OpenClawRecentMessages)

	huma.Register(api, huma.Operation{
		OperationID: "restart-openclaw-gateway",
		Method:      http.MethodPost,
		Path:        "/openclaw/gateway/restart",
		Summary:     "Restart OpenClaw Gateway",
		Description: "通过 OpenClaw CLI 重启 Gateway 服务，并清理服务信息缓存。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.RestartOpenClawGateway)

	huma.Register(api, huma.Operation{
		OperationID: "stop-openclaw-gateway",
		Method:      http.MethodPost,
		Path:        "/openclaw/gateway/stop",
		Summary:     "Stop OpenClaw Gateway",
		Description: "通过 OpenClaw CLI 停止 Gateway 服务，并清理服务信息缓存。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.StopOpenClawGateway)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-update-status",
		Method:      http.MethodGet,
		Path:        "/openclaw/update/status",
		Summary:     "Check OpenClaw update status",
		Description: "通过官方 `openclaw update status --json` 检测当前 OpenClaw CLI 是否存在可用更新。支持 refresh=true 刷新缓存。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.OpenClawUpdateStatus)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw",
		Method:      http.MethodPost,
		Path:        "/openclaw/update",
		Summary:     "Update OpenClaw",
		Description: "通过官方 `openclaw update --json` 执行 OpenClaw 更新，并清理本地环境与更新状态缓存。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClaw)

	sse.Register(api, huma.Operation{
		OperationID: "stream-update-openclaw",
		Method:      http.MethodGet,
		Path:        "/openclaw/update/stream",
		Summary:     "Stream OpenClaw update",
		Description: "以 Server-Sent Events 执行官方 `openclaw update --json` 更新流程，并实时返回终端日志。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.UpdateOpenClawStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-install-openclaw",
		Method:      http.MethodGet,
		Path:        "/openclaw/install",
		Summary:     "Stream OpenClaw install",
		Description: "以 Server-Sent Events 执行 OpenClaw 官方安装脚本或 npm 安装流程，并实时返回终端日志。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.InstallOpenClawStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-uninstall-openclaw",
		Method:      http.MethodGet,
		Path:        "/openclaw/uninstall",
		Summary:     "Stream OpenClaw uninstall",
		Description: "以 Server-Sent Events 执行官方 `openclaw uninstall --all --yes --non-interactive` 卸载流程，并实时返回终端日志。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.UninstallOpenClawStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-openclaw-log",
		Method:      http.MethodGet,
		Path:        "/openclaw/log",
		Summary:     "Stream OpenClaw log",
		Description: "以 Server-Sent Events 流式读取当前主机 ~/.openclaw/logs 下的 OpenClaw 日志。支持 kind=gateway、gateway-err、guardian、config-audit，不暴露备份日志；支持 file、tail、follow、filter、levels 查询参数。",
		Tags:        []string{"OpenClaw"},
	}, map[string]any{
		"meta":  openclawhandlers.OpenClawLogMetaEvent{},
		"log":   openclawhandlers.OpenClawLogLineEvent{},
		"error": openclawhandlers.OpenClawLogErrorEvent{},
		"done":  openclawhandlers.OpenClawLogDoneEvent{},
	}, openclawhandlers.OpenClawLogStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-install-hermes",
		Method:      http.MethodGet,
		Path:        "/hermes/install",
		Summary:     "Stream Hermes install",
		Description: "以 Server-Sent Events 执行 Hermes 官方安装脚本、验证 CLI、初始化基础配置，并实时返回终端日志。",
		Tags:        []string{"Hermes"},
	}, hermesTaskStreamEvents(), hermeshandlers.InstallHermesStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-hermes-platform-qr-setup",
		Method:      http.MethodGet,
		Path:        "/hermes/platforms/{name}/qr-setup",
		Summary:     "Stream Hermes platform QR setup",
		Description: "以 Server-Sent Events 执行 Hermes 内置消息平台扫码登录或扫码配置，并实时返回终端日志。",
		Tags:        []string{"Hermes"},
	}, hermesTaskStreamEvents(), hermeshandlers.SetupHermesPlatformQRStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-hermes-log",
		Method:      http.MethodGet,
		Path:        "/hermes/log",
		Summary:     "Stream Hermes log",
		Description: "以 Server-Sent Events 流式读取当前主机 ~/.hermes 下的 Hermes 日志。支持 kind=gateway、gateway-run、gateway-exit、errors、agent；支持 file、tail、follow、filter、levels 查询参数。",
		Tags:        []string{"Hermes"},
	}, map[string]any{
		"meta":  hermeshandlers.HermesLogMetaEvent{},
		"log":   hermeshandlers.HermesLogLineEvent{},
		"error": hermeshandlers.HermesLogErrorEvent{},
		"done":  hermeshandlers.HermesLogDoneEvent{},
	}, hermeshandlers.HermesLogStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-uninstall-hermes",
		Method:      http.MethodGet,
		Path:        "/hermes/uninstall",
		Summary:     "Stream Hermes uninstall",
		Description: "以 Server-Sent Events 停止 Hermes Gateway、移除 Hermes Home、本机数据和 CLI，并实时返回终端日志。",
		Tags:        []string{"Hermes"},
	}, hermesTaskStreamEvents(), hermeshandlers.UninstallHermesStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-hermes-doctor",
		Method:      http.MethodGet,
		Path:        "/hermes/doctor",
		Summary:     "Stream Hermes doctor",
		Description: "以 Server-Sent Events 执行 hermes doctor，并实时返回终端日志。",
		Tags:        []string{"Hermes"},
	}, hermesTaskStreamEvents(), hermeshandlers.DoctorHermesStream)

	huma.Register(api, huma.Operation{
		OperationID: "list-openclaw-agents",
		Method:      http.MethodGet,
		Path:        "/openclaw/agents",
		Summary:     "List OpenClaw agents",
		Description: "结构化读取当前主机 openclaw.json 中的 agents、bindings、session store 和 workspace 状态，返回脱敏后的 Agent 管理摘要。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.ListOpenClawAgents)

	huma.Register(api, huma.Operation{
		OperationID: "create-openclaw-agent",
		Method:      http.MethodPost,
		Path:        "/openclaw/agents",
		Summary:     "Create OpenClaw agent",
		Description: "在 openclaw.json 的 agents.list 中创建 Agent 配置，并确保 workspace、agentDir 和 session 目录存在。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.CreateOpenClawAgent)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-agent",
		Method:      http.MethodGet,
		Path:        "/openclaw/agents/{id}",
		Summary:     "Get OpenClaw agent detail",
		Description: "读取指定 OpenClaw Agent 的结构化详情，包括 workspace、agentDir、session store、identity、bindings 和关键 bootstrap 文件状态。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawAgent)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-agent",
		Method:      http.MethodPut,
		Path:        "/openclaw/agents/{id}",
		Summary:     "Update OpenClaw agent",
		Description: "更新指定 OpenClaw Agent 的基础配置，包括 identity、workspace、model、skills 和 runtime。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawAgent)

	huma.Register(api, huma.Operation{
		OperationID: "delete-openclaw-agent",
		Method:      http.MethodDelete,
		Path:        "/openclaw/agents/{id}",
		Summary:     "Delete OpenClaw agent",
		Description: "从 openclaw.json 中删除指定 OpenClaw Agent，清理绑定和 agent-to-agent allow 引用，并移除 workspace、agentDir 和 session 目录。默认智能体 main 不能删除。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.DeleteOpenClawAgent)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-agent-file",
		Method:      http.MethodGet,
		Path:        "/openclaw/agents/{id}/files/{name}",
		Summary:     "Read OpenClaw agent workspace file",
		Description: "读取指定 OpenClaw Agent workspace 下允许管理的 bootstrap Markdown 文件内容。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawAgentFile)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-agent-file",
		Method:      http.MethodPut,
		Path:        "/openclaw/agents/{id}/files/{name}",
		Summary:     "Update OpenClaw agent workspace file",
		Description: "写入指定 OpenClaw Agent workspace 下允许管理的 bootstrap Markdown 文件内容。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawAgentFile)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-agent-workspace-tree",
		Method:      http.MethodGet,
		Path:        "/openclaw/agents/{id}/workspace/tree",
		Summary:     "List OpenClaw agent workspace tree",
		Description: "读取指定 OpenClaw Agent workspace 下的安全文件树，路径限制在 workspace 内，并默认排除隐藏文件、缓存目录和大型依赖目录。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawAgentWorkspaceTree)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-agent-workspace-file",
		Method:      http.MethodGet,
		Path:        "/openclaw/agents/{id}/workspace/file",
		Summary:     "Read OpenClaw agent workspace file",
		Description: "读取指定 OpenClaw Agent workspace 下的文本文件预览，敏感文件、二进制文件和超大文件只返回元数据与不可预览原因。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawAgentWorkspaceFile)

	huma.Register(api, huma.Operation{
		OperationID:  "create-openclaw-agent-workspace-entry",
		Method:       http.MethodPost,
		Path:         "/openclaw/agents/{id}/workspace/entries",
		Summary:      "Create OpenClaw agent workspace entry",
		Description:  "在指定 OpenClaw Agent workspace 下创建文件或文件夹。路径限制在 workspace 内，并禁止创建隐藏文件或隐藏文件夹。",
		Tags:         []string{"OpenClaw"},
		MaxBodyBytes: maxRequestBodyBytes,
	}, openclawhandlers.CreateOpenClawAgentWorkspaceEntry)

	huma.Register(api, huma.Operation{
		OperationID:  "update-openclaw-agent-workspace-file",
		Method:       http.MethodPut,
		Path:         "/openclaw/agents/{id}/workspace/file",
		Summary:      "Update OpenClaw agent workspace file",
		Description:  "写入指定 OpenClaw Agent workspace 下的可编辑文本文件内容。路径限制在 workspace 内，并禁止写入隐藏文件、二进制文件和敏感文件。",
		Tags:         []string{"OpenClaw"},
		MaxBodyBytes: maxRequestBodyBytes,
	}, openclawhandlers.UpdateOpenClawAgentWorkspaceFile)

	huma.Register(api, huma.Operation{
		OperationID: "delete-openclaw-agent-workspace-entry",
		Method:      http.MethodDelete,
		Path:        "/openclaw/agents/{id}/workspace/entries",
		Summary:     "Delete OpenClaw agent workspace entry",
		Description: "删除指定 OpenClaw Agent workspace 下的文件或文件夹。路径限制在 workspace 内，且 AGENTS.md、HEARTBEAT.md、IDENTITY.md、SOUL.md、TOOLS.md、USER.md 不可删除。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.DeleteOpenClawAgentWorkspaceEntry)

	huma.Register(api, huma.Operation{
		OperationID: "move-openclaw-agent-workspace-entry",
		Method:      http.MethodPatch,
		Path:        "/openclaw/agents/{id}/workspace/entries/move",
		Summary:     "Move OpenClaw agent workspace entry",
		Description: "移动指定 OpenClaw Agent workspace 下的文件或文件夹到目标文件夹。路径限制在 workspace 内，且核心文件不可移动。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.MoveOpenClawAgentWorkspaceEntry)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-agent-memory",
		Method:      http.MethodGet,
		Path:        "/openclaw/agents/{id}/memory",
		Summary:     "Get OpenClaw agent memory overview",
		Description: "读取指定 OpenClaw Agent workspace 下 MEMORY.md、memory/*.md 文件状态，并返回内置 memory index 的只读状态摘要。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawAgentMemory)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-agent-memory-file",
		Method:      http.MethodGet,
		Path:        "/openclaw/agents/{id}/memory/file",
		Summary:     "Read OpenClaw agent memory file",
		Description: "读取指定 OpenClaw Agent workspace 下允许管理的 MEMORY.md 或 memory/*.md 文件内容。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawAgentMemoryFile)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-agent-memory-file",
		Method:      http.MethodPut,
		Path:        "/openclaw/agents/{id}/memory/file",
		Summary:     "Update OpenClaw agent memory file",
		Description: "写入指定 OpenClaw Agent workspace 下允许管理的 MEMORY.md 或 memory/*.md 文件内容。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawAgentMemoryFile)

	huma.Register(api, huma.Operation{
		OperationID: "search-openclaw-agent-memory",
		Method:      http.MethodPost,
		Path:        "/openclaw/agents/{id}/memory/search",
		Summary:     "Search OpenClaw agent memory",
		Description: "优先调用 openclaw memory search --json 返回 memory_search 结果；CLI 不可用时降级为本地 Markdown 搜索。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.SearchOpenClawAgentMemory)

	huma.Register(api, huma.Operation{
		OperationID: "index-openclaw-agent-memory",
		Method:      http.MethodPost,
		Path:        "/openclaw/agents/{id}/memory/index",
		Summary:     "Index OpenClaw agent memory",
		Description: "调用 openclaw memory index，为指定 Agent 触发记忆索引更新。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.IndexOpenClawAgentMemory)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-config",
		Method:      http.MethodGet,
		Path:        "/openclaw/config",
		Summary:     "Read OpenClaw config",
		Description: "读取当前主机 OpenClaw home 下的 openclaw.json 配置文件，返回解析后的 JSON 内容。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawConfig)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/config",
		Summary:     "Update OpenClaw config",
		Description: "更新当前主机 OpenClaw home 下的 openclaw.json 配置文件。请求体必须提供完整 JSON 配置内容，后端会校验并格式化写回。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawConfig)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-public-gateway",
		Method:      http.MethodGet,
		Path:        "/openclaw/public-gateway",
		Summary:     "Read AgentBox OpenClaw public Gateway URL",
		Description: "读取 AgentBox 当前用于浏览器连接 OpenClaw Gateway 的 OPENCLAW_PUBLIC_GATEWAY_URL。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawPublicGateway)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-public-gateway",
		Method:      http.MethodPut,
		Path:        "/openclaw/public-gateway",
		Summary:     "Update AgentBox OpenClaw public Gateway URL",
		Description: "更新 AgentBox 可运行时生效的 OPENCLAW_PUBLIC_GATEWAY_URL，用于前端优先连接远程 wss Gateway。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawPublicGateway)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-weixin-status",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/weixin",
		Summary:     "Get OpenClaw Weixin channel status",
		Description: "读取 OpenClaw 微信渠道插件安装、启用和 session.dmScope 状态。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawWeixinStatus)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-weixin-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/weixin/config",
		Summary:     "Update OpenClaw Weixin channel config",
		Description: "更新 channels.openclaw-weixin 的小范围配置，包括 enabled、name、cdnBaseUrl、routeTag 和 botAgent。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawWeixinConfig)

	huma.Register(api, huma.Operation{
		OperationID: "delete-openclaw-weixin-account",
		Method:      http.MethodDelete,
		Path:        "/openclaw/channels/weixin/accounts/{accountId}",
		Summary:     "Delete OpenClaw Weixin account",
		Description: "删除本地微信账号凭据文件和该账号在 channels.openclaw-weixin.accounts 下的配置，不返回 token。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.DeleteOpenClawWeixinAccount)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-weixin-account-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/weixin/accounts/{accountId}/config",
		Summary:     "Update OpenClaw Weixin account config",
		Description: "更新单个微信账号的名称、启用状态以及绑定的 Agent 路由。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawWeixinAccountConfig)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-feishu-status",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/feishu",
		Summary:     "Get OpenClaw Feishu channel status",
		Description: "读取 OpenClaw 飞书官方插件安装、配置、账号和高级开关状态，不返回 App Secret。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawFeishuStatus)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-feishu-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/feishu/config",
		Summary:     "Update OpenClaw Feishu channel config",
		Description: "更新 channels.feishu 的小范围配置，包括 enabled、streaming、threadSession、requireMention、groupPolicy 和 footer。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawFeishuConfig)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-telegram-status",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/telegram",
		Summary:     "Get OpenClaw Telegram channel status",
		Description: "读取 OpenClaw Telegram 渠道配置与账号状态，不返回 bot token。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawTelegramStatus)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-telegram-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/telegram/config",
		Summary:     "Update OpenClaw Telegram channel config",
		Description: "更新 channels.telegram.enabled 和全局默认 dmPolicy。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawTelegramConfig)

	huma.Register(api, huma.Operation{
		OperationID: "validate-openclaw-telegram-credential",
		Method:      http.MethodPost,
		Path:        "/openclaw/channels/telegram/credential/validate",
		Summary:     "Validate OpenClaw Telegram bot token",
		Description: "调用 Telegram getMe 校验 Bot Token，不返回 token。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.ValidateOpenClawTelegramCredential)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-discord-status",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/discord",
		Summary:     "Get OpenClaw Discord channel status",
		Description: "读取 OpenClaw Discord 渠道配置与账号状态，不返回 bot token。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawDiscordStatus)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-discord-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/discord/config",
		Summary:     "Update OpenClaw Discord channel config",
		Description: "更新 channels.discord.enabled、dmPolicy 和 groupPolicy 等小范围配置。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawDiscordConfig)

	huma.Register(api, huma.Operation{
		OperationID: "validate-openclaw-discord-credential",
		Method:      http.MethodPost,
		Path:        "/openclaw/channels/discord/credential/validate",
		Summary:     "Validate OpenClaw Discord bot token",
		Description: "调用 Discord /users/@me 校验 Bot Token，不返回 token。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.ValidateOpenClawDiscordCredential)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-dingtalk-status",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/dingtalk",
		Summary:     "Get OpenClaw DingTalk channel status",
		Description: "读取 OpenClaw 钉钉官方插件安装状态、渠道配置与多账号状态，不返回 AppSecret。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawDingTalkStatus)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-dingtalk-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/dingtalk/config",
		Summary:     "Update OpenClaw DingTalk channel config",
		Description: "更新 channels.dingtalk-connector 的启用状态、访问策略和调试开关。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawDingTalkConfig)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-wecom-status",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/wecom",
		Summary:     "Get OpenClaw WeCom channel status",
		Description: "读取 OpenClaw 企业微信官方插件安装状态、渠道配置与多账号状态，不返回 Secret。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawWeComStatus)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-wecom-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/wecom/config",
		Summary:     "Update OpenClaw WeCom channel config",
		Description: "更新 channels.wecom 的启用状态、默认账号和访问策略。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawWeComConfig)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-matrix-status",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/matrix",
		Summary:     "Get OpenClaw Matrix channel status",
		Description: "读取 OpenClaw Matrix 渠道配置与账号状态，不返回 access token 或 password。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawMatrixStatus)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-matrix-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/matrix/config",
		Summary:     "Update OpenClaw Matrix channel config",
		Description: "更新 channels.matrix.enabled、默认 DM/房间策略、线程和流式预览等全局配置。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawMatrixConfig)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-qqbot-status",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/qqbot",
		Summary:     "Get OpenClaw QQBot channel status",
		Description: "读取 OpenClaw QQBot 插件安装状态、渠道配置与账号状态，不返回 App Secret。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawQQBotStatus)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-qqbot-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/qqbot/config",
		Summary:     "Update OpenClaw QQBot channel config",
		Description: "更新 channels.qqbot 全局开关、准入、提示词和语音配置。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawQQBotConfig)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-yuanbao-status",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/yuanbao",
		Summary:     "Get OpenClaw Yuanbao channel status",
		Description: "读取 OpenClaw 元宝插件安装状态、渠道配置与账号状态，不返回 App Secret 或 bot token。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawYuanbaoStatus)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-yuanbao-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/yuanbao/config",
		Summary:     "Update OpenClaw Yuanbao channel config",
		Description: "更新 channels.yuanbao 全局开关、提示词和默认账号配置。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawYuanbaoConfig)

	huma.Register(api, huma.Operation{
		OperationID: "list-openclaw-gateway-device-pairing-requests",
		Method:      http.MethodGet,
		Path:        "/openclaw/gateway-devices/pairing",
		Summary:     "List OpenClaw Gateway device pairing requests",
		Description: "列出 OpenClaw Gateway 待审批的设备配对请求。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.ListOpenClawGatewayDevicePairingRequests)

	huma.Register(api, huma.Operation{
		OperationID: "approve-openclaw-gateway-device-pairing-request",
		Method:      http.MethodPost,
		Path:        "/openclaw/gateway-devices/pairing/approve",
		Summary:     "Approve OpenClaw Gateway device pairing request",
		Description: "批准 OpenClaw Gateway 待审批的设备配对请求。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.ApproveOpenClawGatewayDevicePairingRequest)

	huma.Register(api, huma.Operation{
		OperationID: "approve-openclaw-pairing-request",
		Method:      http.MethodPost,
		Path:        "/openclaw/pairing/{channel}/approve",
		Summary:     "Approve OpenClaw pairing request",
		Description: "批准任意支持 pairing 的 OpenClaw 渠道请求。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.ApproveOpenClawPairingRequest)

	huma.Register(api, huma.Operation{
		OperationID: "delete-openclaw-telegram-account",
		Method:      http.MethodDelete,
		Path:        "/openclaw/channels/telegram/accounts/{accountId}",
		Summary:     "Delete OpenClaw Telegram account",
		Description: "删除本地 Telegram 账号配置和路由绑定，不返回 bot token。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.DeleteOpenClawTelegramAccount)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-telegram-account-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/telegram/accounts/{accountId}/config",
		Summary:     "Update OpenClaw Telegram account config",
		Description: "更新单个 Telegram 账号的启用状态和 Agent 路由。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawTelegramAccountConfig)

	huma.Register(api, huma.Operation{
		OperationID: "delete-openclaw-feishu-account",
		Method:      http.MethodDelete,
		Path:        "/openclaw/channels/feishu/accounts/{accountId}",
		Summary:     "Delete OpenClaw Feishu account",
		Description: "删除本地飞书账号配置和 Agent 路由绑定，不返回 App Secret。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.DeleteOpenClawFeishuAccount)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-feishu-account-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/feishu/accounts/{accountId}/config",
		Summary:     "Update OpenClaw Feishu account config",
		Description: "更新单个飞书账号的名称、启用状态、访问策略以及绑定的 Agent 路由。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawFeishuAccountConfig)

	huma.Register(api, huma.Operation{
		OperationID: "delete-openclaw-discord-account",
		Method:      http.MethodDelete,
		Path:        "/openclaw/channels/discord/accounts/{accountId}",
		Summary:     "Delete OpenClaw Discord account",
		Description: "删除本地 Discord 账号配置和路由绑定，不返回 bot token。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.DeleteOpenClawDiscordAccount)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-discord-account-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/discord/accounts/{accountId}/config",
		Summary:     "Update OpenClaw Discord account config",
		Description: "更新单个 Discord 账号的启用状态、Application ID、Guild allowlist 和 Agent 路由。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawDiscordAccountConfig)

	huma.Register(api, huma.Operation{
		OperationID: "delete-openclaw-dingtalk-account",
		Method:      http.MethodDelete,
		Path:        "/openclaw/channels/dingtalk/accounts/{accountId}",
		Summary:     "Delete OpenClaw DingTalk account",
		Description: "删除本地钉钉账号配置和路由绑定，不返回 AppSecret。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.DeleteOpenClawDingTalkAccount)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-dingtalk-account-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/dingtalk/accounts/{accountId}/config",
		Summary:     "Update OpenClaw DingTalk account config",
		Description: "更新单个钉钉机器人账号的启用状态、访问策略、凭据和 Agent 路由。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawDingTalkAccountConfig)

	huma.Register(api, huma.Operation{
		OperationID: "delete-openclaw-wecom-account",
		Method:      http.MethodDelete,
		Path:        "/openclaw/channels/wecom/accounts/{accountId}",
		Summary:     "Delete OpenClaw WeCom account",
		Description: "删除本地企业微信账号配置和 Agent 路由绑定，不返回 Secret。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.DeleteOpenClawWeComAccount)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-wecom-account-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/wecom/accounts/{accountId}/config",
		Summary:     "Update OpenClaw WeCom account config",
		Description: "更新单个企业微信账号的启用状态、Bot/Agent 凭据、访问策略和 Agent 路由。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawWeComAccountConfig)

	huma.Register(api, huma.Operation{
		OperationID: "delete-openclaw-matrix-account",
		Method:      http.MethodDelete,
		Path:        "/openclaw/channels/matrix/accounts/{accountId}",
		Summary:     "Delete OpenClaw Matrix account",
		Description: "删除本地 Matrix 账号配置和路由绑定，不返回凭据。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.DeleteOpenClawMatrixAccount)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-matrix-account-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/matrix/accounts/{accountId}/config",
		Summary:     "Update OpenClaw Matrix account config",
		Description: "更新单个 Matrix 账号的认证、访问策略、E2EE、线程和 Agent 路由配置。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawMatrixAccountConfig)

	huma.Register(api, huma.Operation{
		OperationID: "delete-openclaw-qqbot-account",
		Method:      http.MethodDelete,
		Path:        "/openclaw/channels/qqbot/accounts/{accountId}",
		Summary:     "Delete OpenClaw QQBot account",
		Description: "删除本地 QQBot 账号配置和路由绑定，不返回凭据。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.DeleteOpenClawQQBotAccount)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-qqbot-account-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/qqbot/accounts/{accountId}/config",
		Summary:     "Update OpenClaw QQBot account config",
		Description: "更新单个 QQBot 账号的启用状态、凭据、准入、语音配置和 Agent 路由。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawQQBotAccountConfig)

	huma.Register(api, huma.Operation{
		OperationID: "delete-openclaw-yuanbao-account",
		Method:      http.MethodDelete,
		Path:        "/openclaw/channels/yuanbao/accounts/{accountId}",
		Summary:     "Delete OpenClaw Yuanbao account",
		Description: "删除本地元宝账号配置和路由绑定，不返回凭据。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.DeleteOpenClawYuanbaoAccount)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-yuanbao-account-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/yuanbao/accounts/{accountId}/config",
		Summary:     "Update OpenClaw Yuanbao account config",
		Description: "更新单个元宝账号的启用状态、凭据、提示词和 Agent 路由。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawYuanbaoAccountConfig)

	sse.Register(api, huma.Operation{
		OperationID: "stream-add-openclaw-telegram-account",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/telegram/add",
		Summary:     "Stream OpenClaw Telegram account add",
		Description: "以 Server-Sent Events 执行 openclaw channels add --channel telegram 并写入 Telegram 账号配置。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.AddOpenClawTelegramAccountStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-add-openclaw-discord-account",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/discord/add",
		Summary:     "Stream OpenClaw Discord account add",
		Description: "以 Server-Sent Events 执行 openclaw channels add --channel discord 并写入 Discord 账号配置。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.AddOpenClawDiscordAccountStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-install-openclaw-dingtalk",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/dingtalk/install",
		Summary:     "Stream OpenClaw DingTalk plugin install",
		Description: "以 Server-Sent Events 安装钉钉官方插件和 dws CLI，不触发扫码授权。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.InstallOpenClawDingTalkStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-scan-add-openclaw-dingtalk",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/dingtalk/scan-add",
		Summary:     "Stream OpenClaw DingTalk scan add",
		Description: "以 Server-Sent Events 运行钉钉官方扫码添加向导，并重启 Gateway。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.ScanAddOpenClawDingTalkStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-add-openclaw-dingtalk-account",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/dingtalk/add",
		Summary:     "Stream OpenClaw DingTalk account add",
		Description: "以 Server-Sent Events 写入 channels.dingtalk-connector 账号配置并重启 Gateway。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.AddOpenClawDingTalkAccountStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-uninstall-openclaw-dingtalk",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/dingtalk/uninstall",
		Summary:     "Stream OpenClaw DingTalk plugin uninstall",
		Description: "以 Server-Sent Events 卸载钉钉官方插件并清理配置残留。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.UninstallOpenClawDingTalkStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-install-openclaw-wecom",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/wecom/install",
		Summary:     "Stream OpenClaw WeCom plugin install",
		Description: "以 Server-Sent Events 安装企业微信官方插件并重启 Gateway，不执行交互式向导。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.InstallOpenClawWeComStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-add-openclaw-wecom-account",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/wecom/add",
		Summary:     "Stream OpenClaw WeCom account add",
		Description: "以 Server-Sent Events 写入 channels.wecom 账号配置并重启 Gateway。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.AddOpenClawWeComAccountStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-scan-add-openclaw-wecom",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/wecom/scan-add",
		Summary:     "Stream OpenClaw WeCom scan add",
		Description: "以 Server-Sent Events 执行企业微信扫码添加机器人流程。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.ScanAddOpenClawWeComStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-uninstall-openclaw-wecom",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/wecom/uninstall",
		Summary:     "Stream OpenClaw WeCom plugin uninstall",
		Description: "以 Server-Sent Events 卸载企业微信官方插件并清理配置残留。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.UninstallOpenClawWeComStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-add-openclaw-matrix-account",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/matrix/add",
		Summary:     "Stream OpenClaw Matrix account add",
		Description: "以 Server-Sent Events 执行 openclaw matrix account add 并写入 Matrix 访问策略。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.AddOpenClawMatrixAccountStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-add-openclaw-qqbot-account",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/qqbot/add",
		Summary:     "Stream OpenClaw QQBot account add",
		Description: "以 Server-Sent Events 添加 QQBot 账号、写入配置并重启 Gateway。插件未安装时请先调用安装流。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.AddOpenClawQQBotAccountStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-install-openclaw-qqbot",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/qqbot/install",
		Summary:     "Stream OpenClaw QQBot plugin install",
		Description: "以 Server-Sent Events 安装 QQBot 插件并重启 Gateway，不添加账号。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.InstallOpenClawQQBotStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-uninstall-openclaw-qqbot",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/qqbot/uninstall",
		Summary:     "Stream OpenClaw QQBot plugin uninstall",
		Description: "以 Server-Sent Events 卸载 QQBot 插件并清理渠道配置残留。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.UninstallOpenClawQQBotStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-add-openclaw-yuanbao-account",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/yuanbao/add",
		Summary:     "Stream OpenClaw Yuanbao account add",
		Description: "以 Server-Sent Events 添加元宝账号、写入配置并重启 Gateway。插件未安装时请先调用安装流。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.AddOpenClawYuanbaoAccountStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-install-openclaw-yuanbao",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/yuanbao/install",
		Summary:     "Stream OpenClaw Yuanbao plugin install",
		Description: "以 Server-Sent Events 安装元宝插件并重启 Gateway，不添加账号。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.InstallOpenClawYuanbaoStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-uninstall-openclaw-yuanbao",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/yuanbao/uninstall",
		Summary:     "Stream OpenClaw Yuanbao plugin uninstall",
		Description: "以 Server-Sent Events 卸载元宝插件并清理渠道配置残留。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.UninstallOpenClawYuanbaoStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-install-openclaw-feishu",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/feishu/install",
		Summary:     "Stream OpenClaw Feishu plugin install",
		Description: "以 Server-Sent Events 安装飞书官方插件，不执行机器人扫码配置。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.InstallOpenClawFeishuStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-scan-add-openclaw-feishu",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/feishu/scan-add",
		Summary:     "Stream OpenClaw Feishu scan add",
		Description: "以 Server-Sent Events 执行飞书扫码添加机器人流程。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.ScanAddOpenClawFeishuStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-manual-add-openclaw-feishu",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/feishu/manual-add",
		Summary:     "Stream OpenClaw Feishu manual add",
		Description: "以 Server-Sent Events 写入飞书机器人 App ID / App Secret 并重启 Gateway。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.AddOpenClawFeishuAccountStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-doctor-openclaw-feishu",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/feishu/doctor",
		Summary:     "Stream OpenClaw Feishu doctor",
		Description: "以 Server-Sent Events 执行 npx @larksuite/openclaw-lark doctor。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.DoctorOpenClawFeishuStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-uninstall-openclaw-feishu",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/feishu/uninstall",
		Summary:     "Stream OpenClaw Feishu uninstall",
		Description: "以 Server-Sent Events 卸载飞书插件并清理配置残留。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.UninstallOpenClawFeishuStream)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-twitch-status",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/twitch",
		Summary:     "Get OpenClaw Twitch channel status",
		Description: "读取 OpenClaw Twitch 渠道配置与账号状态，不返回 access token。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawTwitchStatus)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-twitch-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/twitch/config",
		Summary:     "Update OpenClaw Twitch channel config",
		Description: "更新 channels.twitch.enabled。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawTwitchConfig)

	huma.Register(api, huma.Operation{
		OperationID: "validate-openclaw-twitch-credential",
		Method:      http.MethodPost,
		Path:        "/openclaw/channels/twitch/credential/validate",
		Summary:     "Validate OpenClaw Twitch access token",
		Description: "调用 Twitch OAuth validate 校验 access token，不返回 token。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.ValidateOpenClawTwitchCredential)

	huma.Register(api, huma.Operation{
		OperationID: "delete-openclaw-twitch-account",
		Method:      http.MethodDelete,
		Path:        "/openclaw/channels/twitch/accounts/{accountId}",
		Summary:     "Delete OpenClaw Twitch account",
		Description: "删除本地 Twitch 账号配置和路由绑定，不返回 access token。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.DeleteOpenClawTwitchAccount)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-twitch-account-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/twitch/accounts/{accountId}/config",
		Summary:     "Update OpenClaw Twitch account config",
		Description: "更新单个 Twitch 账号的启用状态、频道、访问控制和 Agent 路由。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawTwitchAccountConfig)

	sse.Register(api, huma.Operation{
		OperationID: "stream-add-openclaw-twitch-account",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/twitch/add",
		Summary:     "Stream OpenClaw Twitch account add",
		Description: "以 Server-Sent Events 写入 channels.twitch 账号配置并重启 Gateway。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.AddOpenClawTwitchAccountStream)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-whatsapp-status",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/whatsapp",
		Summary:     "Get OpenClaw WhatsApp channel status",
		Description: "读取 OpenClaw WhatsApp 渠道配置、插件安装状态和账号登录状态，不返回敏感凭据。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawWhatsAppStatus)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-whatsapp-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/whatsapp/config",
		Summary:     "Update OpenClaw WhatsApp channel config",
		Description: "更新 channels.whatsapp 的小范围配置，包括 enabled、dmPolicy、allowFrom、groupPolicy 和投递行为。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawWhatsAppConfig)

	huma.Register(api, huma.Operation{
		OperationID: "delete-openclaw-whatsapp-account",
		Method:      http.MethodDelete,
		Path:        "/openclaw/channels/whatsapp/accounts/{accountId}",
		Summary:     "Delete OpenClaw WhatsApp account",
		Description: "删除 WhatsApp 账号配置和路由绑定，不删除 authDir 内的 Baileys 凭据；登出请使用 logout 流。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.DeleteOpenClawWhatsAppAccount)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-whatsapp-account-config",
		Method:      http.MethodPut,
		Path:        "/openclaw/channels/whatsapp/accounts/{accountId}/config",
		Summary:     "Update OpenClaw WhatsApp account config",
		Description: "更新单个 WhatsApp 账号的名称、启用状态、访问策略和 Agent 路由。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawWhatsAppAccountConfig)

	sse.Register(api, huma.Operation{
		OperationID: "stream-add-openclaw-whatsapp-account",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/whatsapp/add",
		Summary:     "Stream OpenClaw WhatsApp account add",
		Description: "以 Server-Sent Events 执行 openclaw channels add/login --channel whatsapp，并写入 WhatsApp 账号策略。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.AddOpenClawWhatsAppAccountStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-login-openclaw-whatsapp-account",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/whatsapp/login",
		Summary:     "Stream OpenClaw WhatsApp account login",
		Description: "以 Server-Sent Events 执行 openclaw channels login --channel whatsapp，用终端 QR 登录指定账号。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.LoginOpenClawWhatsAppAccountStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-logout-openclaw-whatsapp-account",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/whatsapp/logout",
		Summary:     "Stream OpenClaw WhatsApp account logout",
		Description: "以 Server-Sent Events 执行 openclaw channels logout --channel whatsapp，清理指定账号登录态。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.LogoutOpenClawWhatsAppAccountStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-uninstall-openclaw-whatsapp",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/whatsapp/uninstall",
		Summary:     "Stream OpenClaw WhatsApp plugin uninstall",
		Description: "以 Server-Sent Events 禁用并删除 WhatsApp 渠道配置、卸载插件并清理残留。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.UninstallOpenClawWhatsAppStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-install-openclaw-weixin",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/weixin/install",
		Summary:     "Stream OpenClaw Weixin plugin install",
		Description: "以 Server-Sent Events 执行微信插件安装、启用和 Gateway 重启。该接口只安装，不执行扫码登录。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.InstallOpenClawWeixinStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-login-openclaw-weixin",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/weixin/login",
		Summary:     "Stream OpenClaw Weixin account login",
		Description: "以 Server-Sent Events 执行 openclaw channels login --channel openclaw-weixin。该接口只登录，不安装或卸载插件。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.LoginOpenClawWeixinStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-set-openclaw-weixin-dm-scope",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/weixin/dm-scope",
		Summary:     "Stream OpenClaw Weixin DM scope update",
		Description: "以 Server-Sent Events 执行 openclaw config set session.dmScope 并重启 Gateway。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.SetOpenClawWeixinDMScopeStream)

	sse.Register(api, huma.Operation{
		OperationID: "stream-uninstall-openclaw-weixin",
		Method:      http.MethodGet,
		Path:        "/openclaw/channels/weixin/uninstall",
		Summary:     "Stream OpenClaw Weixin plugin uninstall",
		Description: "以 Server-Sent Events 执行微信插件卸载和残留清理。该接口只卸载，不执行账号登录。",
		Tags:        []string{"OpenClaw"},
	}, openClawChannelStreamEvents(), openclawhandlers.UninstallOpenClawWeixinStream)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-dreaming",
		Method:      http.MethodGet,
		Path:        "/openclaw/dreaming",
		Summary:     "Get OpenClaw Dreaming status",
		Description: "聚合 OpenClaw Dreaming 配置、选中 Agent 的 memory/.dreams 状态、Dream Diary、阶段报告和 memory status 摘要。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawDreaming)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-dream-diary",
		Method:      http.MethodGet,
		Path:        "/openclaw/dreaming/diary",
		Summary:     "Read OpenClaw Dream Diary",
		Description: "读取选中 Agent workspace 下的 DREAMS.md 或 dreams.md，供梦境模式页面展示。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawDreamDiary)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-dreaming-config",
		Method:      http.MethodPatch,
		Path:        "/openclaw/dreaming/config",
		Summary:     "Update OpenClaw Dreaming config",
		Description: "只更新 Dreaming 的 enabled、frequency、timezone、model 小范围配置，避免前端提交完整 openclaw.json。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawDreamingConfig)

	huma.Register(api, huma.Operation{
		OperationID: "backfill-openclaw-dream-diary",
		Method:      http.MethodPost,
		Path:        "/openclaw/dreaming/diary/backfill",
		Summary:     "Backfill OpenClaw Dream Diary",
		Description: "扫描选中 Agent workspace/memory 下的历史 YYYY-MM-DD.md，调用 OpenClaw grounded REM 回填流程写入可回滚的 Dream Diary 条目。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.BackfillOpenClawDreamDiary)

	huma.Register(api, huma.Operation{
		OperationID: "reset-openclaw-dream-diary",
		Method:      http.MethodPost,
		Path:        "/openclaw/dreaming/diary/reset",
		Summary:     "Reset OpenClaw Dream Diary backfill entries",
		Description: "只移除 DREAMS.md 中带 openclaw:dreaming:backfill-entry 标记的回填条目，不删除普通梦境日记。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.ResetOpenClawDreamDiary)

	huma.Register(api, huma.Operation{
		OperationID: "clear-openclaw-dreaming-grounded-short-term",
		Method:      http.MethodPost,
		Path:        "/openclaw/dreaming/grounded/clear",
		Summary:     "Clear OpenClaw grounded short-term memory",
		Description: "清理选中 Agent 的 grounded-only staged 短期记忆条目，不修改 MEMORY.md 或普通日记。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.ClearOpenClawDreamingGroundedShortTerm)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-cron-status",
		Method:      http.MethodGet,
		Path:        "/openclaw/cron/status",
		Summary:     "Get OpenClaw cron scheduler status",
		Description: "通过 OpenClaw Gateway cron.status 读取定时任务调度器状态、任务数量、存储路径和下次唤醒时间。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawCronStatus)

	huma.Register(api, huma.Operation{
		OperationID: "list-openclaw-cron-jobs",
		Method:      http.MethodGet,
		Path:        "/openclaw/cron/jobs",
		Summary:     "List OpenClaw cron jobs",
		Description: "通过 OpenClaw Gateway cron.list 列出定时任务，支持分页、搜索、启用状态、排序和 Agent 过滤。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.ListOpenClawCronJobs)

	huma.Register(api, huma.Operation{
		OperationID: "create-openclaw-cron-job",
		Method:      http.MethodPost,
		Path:        "/openclaw/cron/jobs",
		Summary:     "Create OpenClaw cron job",
		Description: "通过 OpenClaw Gateway cron.add 创建定时任务。请求体使用官方 CronJobCreate 结构，由 Gateway 负责校验计划、会话目标和投递配置。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.CreateOpenClawCronJob)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-cron-job",
		Method:      http.MethodPatch,
		Path:        "/openclaw/cron/jobs/{id}",
		Summary:     "Update OpenClaw cron job",
		Description: "通过 OpenClaw Gateway cron.update 修改定时任务。请求体使用官方 CronJobPatch 结构。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawCronJob)

	huma.Register(api, huma.Operation{
		OperationID: "delete-openclaw-cron-job",
		Method:      http.MethodDelete,
		Path:        "/openclaw/cron/jobs/{id}",
		Summary:     "Delete OpenClaw cron job",
		Description: "通过 OpenClaw Gateway cron.remove 删除指定定时任务。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.DeleteOpenClawCronJob)

	huma.Register(api, huma.Operation{
		OperationID: "run-openclaw-cron-job",
		Method:      http.MethodPost,
		Path:        "/openclaw/cron/jobs/{id}/run",
		Summary:     "Run OpenClaw cron job",
		Description: "通过 OpenClaw Gateway cron.run 手动触发指定定时任务，默认使用 force 模式立即入队。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.RunOpenClawCronJob)

	huma.Register(api, huma.Operation{
		OperationID: "list-openclaw-cron-runs",
		Method:      http.MethodGet,
		Path:        "/openclaw/cron/runs",
		Summary:     "List OpenClaw cron run history",
		Description: "通过 OpenClaw Gateway cron.runs 读取全部定时任务的 JSONL 运行历史。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.ListOpenClawCronRuns)

	huma.Register(api, huma.Operation{
		OperationID: "fetch-openclaw-provider-models",
		Method:      http.MethodPost,
		Path:        "/openclaw/models/fetch",
		Summary:     "Fetch provider models",
		Description: "从指定模型服务商的 models endpoint 拉取模型清单，用于 OpenClaw 模型配置页面导入模型列表。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.FetchOpenClawProviderModels)

	huma.Register(api, huma.Operation{
		OperationID: "test-openclaw-provider-model",
		Method:      http.MethodPost,
		Path:        "/openclaw/models/test",
		Summary:     "Test provider model connectivity",
		Description: "对指定模型发起最小请求，测试当前 API 类型、Base URL、API Key 和模型 ID 是否可连通。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.TestOpenClawProviderModel)

	huma.Register(api, huma.Operation{
		OperationID: "list-openclaw-config-backups",
		Method:      http.MethodGet,
		Path:        "/openclaw/config/backups",
		Summary:     "List OpenClaw config backups",
		Description: "列出当前主机 OpenClaw home/config-backups 下符合 openclaw-YYYYMMDD-HHMMSS.json 命名规则的配置备份。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.ListOpenClawConfigBackups)

	huma.Register(api, huma.Operation{
		OperationID: "create-openclaw-config-backup",
		Method:      http.MethodPost,
		Path:        "/openclaw/config/backups",
		Summary:     "Create OpenClaw config backup",
		Description: "将当前 openclaw.json 复制到 OpenClaw home/config-backups，文件名格式为 openclaw-YYYYMMDD-HHMMSS.json。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.CreateOpenClawConfigBackup)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-config-backup",
		Method:      http.MethodGet,
		Path:        "/openclaw/config/backups/{name}",
		Summary:     "Read OpenClaw config backup",
		Description: "读取指定 OpenClaw 配置备份文件，返回解析后的 JSON 内容。只允许读取 config-backups 目录下符合命名规则的备份。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawConfigBackup)

	huma.Register(api, huma.Operation{
		OperationID: "restore-openclaw-config-backup",
		Method:      http.MethodPost,
		Path:        "/openclaw/config/backups/{name}/restore",
		Summary:     "Restore OpenClaw config backup",
		Description: "用指定备份文件覆盖当前 OpenClaw openclaw.json。只允许恢复 config-backups 目录下符合命名规则的备份。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.RestoreOpenClawConfigBackup)

	huma.Register(api, huma.Operation{
		OperationID: "delete-openclaw-config-backup",
		Method:      http.MethodDelete,
		Path:        "/openclaw/config/backups/{name}",
		Summary:     "Delete OpenClaw config backup",
		Description: "删除指定 OpenClaw 配置备份。只允许删除 config-backups 目录下符合命名规则的备份。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.DeleteOpenClawConfigBackup)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-skills-status",
		Method:      http.MethodGet,
		Path:        "/openclaw/skills/status",
		Summary:     "List OpenClaw skills status",
		Description: "通过 OpenClaw CLI 获取当前工作区可见技能清单，包含启用状态、依赖缺失、模型可见性、命令可见性和来源信息。结果会持续缓存在进程内，支持 refresh=true 强制刷新。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawSkillsStatus)

	huma.Register(api, huma.Operation{
		OperationID: "search-openclaw-skills",
		Method:      http.MethodGet,
		Path:        "/openclaw/skills/search",
		Summary:     "Search OpenClaw skills",
		Description: "搜索远程技能注册表。若本机已安装 SkillHub，则优先通过 SkillHub 查询。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.SearchOpenClawSkills)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-skills-showcase-hot",
		Method:      http.MethodGet,
		Path:        "/openclaw/skills/showcase/hot",
		Summary:     "List SkillHub hot skills",
		Description: "代理读取 SkillHub 下载热榜技能，用于技能中心发现页。支持 refresh=true 强制刷新缓存。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawSkillsShowcaseHot)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-skill-info",
		Method:      http.MethodGet,
		Path:        "/openclaw/skills/{name}",
		Summary:     "Read OpenClaw skill info",
		Description: "通过 OpenClaw CLI 查看本地技能详情。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawSkillInfo)

	huma.Register(api, huma.Operation{
		OperationID: "install-openclaw-skill",
		Method:      http.MethodPost,
		Path:        "/openclaw/skills/install",
		Summary:     "Install OpenClaw skill",
		Description: "通过 OpenClaw CLI 从 ClawHub 安装技能到当前或指定 Agent 工作区。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.InstallOpenClawSkill)

	huma.Register(api, huma.Operation{
		OperationID: "install-openclaw-skill-dependency",
		Method:      http.MethodPost,
		Path:        "/openclaw/skills/install-dependency",
		Summary:     "Install OpenClaw skill dependency",
		Description: "通过 OpenClaw Gateway skills.install 执行技能 metadata.openclaw.install 中声明的依赖安装器。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.InstallOpenClawSkillDependency)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-skill",
		Method:      http.MethodPatch,
		Path:        "/openclaw/skills/{skillKey}",
		Summary:     "Update OpenClaw skill config",
		Description: "更新 openclaw.json 中 skills.entries.<skillKey> 的 enabled、apiKey 和 env 覆盖配置。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawSkill)

	huma.Register(api, huma.Operation{
		OperationID: "list-openclaw-plugins",
		Method:      http.MethodGet,
		Path:        "/openclaw/plugins/status",
		Summary:     "List OpenClaw plugins",
		Description: "通过 OpenClaw CLI 获取当前可发现插件清单、registry 来源、诊断信息和启用状态。结果会持续缓存在进程内，支持 refresh=true 强制刷新。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.ListOpenClawPlugins)

	huma.Register(api, huma.Operation{
		OperationID: "search-openclaw-plugins",
		Method:      http.MethodGet,
		Path:        "/openclaw/plugins/search",
		Summary:     "Search OpenClaw plugins",
		Description: "通过 OpenClaw CLI 搜索 ClawHub 插件包。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.SearchOpenClawPlugins)

	huma.Register(api, huma.Operation{
		OperationID: "install-openclaw-plugin",
		Method:      http.MethodPost,
		Path:        "/openclaw/plugins/install",
		Summary:     "Install OpenClaw plugin",
		Description: "通过 OpenClaw CLI 安装插件，支持 ClawHub、npm、git、本地路径、归档和 marketplace spec。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.InstallOpenClawPlugin)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-plugin-info",
		Method:      http.MethodGet,
		Path:        "/openclaw/plugins/{id}",
		Summary:     "Inspect OpenClaw plugin",
		Description: "通过 OpenClaw CLI 静态检查指定插件详情，不加载运行时。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawPluginInfo)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-plugin-runtime-info",
		Method:      http.MethodGet,
		Path:        "/openclaw/plugins/{id}/runtime",
		Summary:     "Runtime inspect OpenClaw plugin",
		Description: "通过 OpenClaw CLI 加载运行时检查指定插件暴露的 hooks、tools、services、gateway methods 等能力。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawPluginRuntimeInfo)

	huma.Register(api, huma.Operation{
		OperationID: "enable-openclaw-plugin",
		Method:      http.MethodPost,
		Path:        "/openclaw/plugins/{id}/enable",
		Summary:     "Enable OpenClaw plugin",
		Description: "通过 OpenClaw CLI 启用指定插件配置。通常需要重启 Gateway 才能应用。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.EnableOpenClawPlugin)

	huma.Register(api, huma.Operation{
		OperationID: "disable-openclaw-plugin",
		Method:      http.MethodPost,
		Path:        "/openclaw/plugins/{id}/disable",
		Summary:     "Disable OpenClaw plugin",
		Description: "通过 OpenClaw CLI 禁用指定插件配置。通常需要重启 Gateway 才能应用。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.DisableOpenClawPlugin)

	huma.Register(api, huma.Operation{
		OperationID: "update-openclaw-plugin",
		Method:      http.MethodPost,
		Path:        "/openclaw/plugins/{id}/update",
		Summary:     "Update OpenClaw plugin",
		Description: "通过 OpenClaw CLI 更新指定 tracked 插件。通常需要重启 Gateway 才能应用。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UpdateOpenClawPlugin)

	huma.Register(api, huma.Operation{
		OperationID: "uninstall-openclaw-plugin",
		Method:      http.MethodDelete,
		Path:        "/openclaw/plugins/{id}",
		Summary:     "Uninstall OpenClaw plugin",
		Description: "通过 OpenClaw CLI 卸载指定插件，清理配置与 install record；可通过 keepFiles=true 保留托管文件。通常需要重启 Gateway 才能应用。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.UninstallOpenClawPlugin)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-plugins-registry",
		Method:      http.MethodGet,
		Path:        "/openclaw/plugins/registry",
		Summary:     "Inspect OpenClaw plugin registry",
		Description: "通过 OpenClaw CLI 查看持久化插件 registry 与当前 registry 状态差异。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawPluginsRegistry)

	huma.Register(api, huma.Operation{
		OperationID: "refresh-openclaw-plugins-registry",
		Method:      http.MethodPost,
		Path:        "/openclaw/plugins/registry/refresh",
		Summary:     "Refresh OpenClaw plugin registry",
		Description: "通过 OpenClaw CLI 重建持久化插件 registry。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.RefreshOpenClawPluginsRegistry)

	huma.Register(api, huma.Operation{
		OperationID: "get-openclaw-plugins-doctor",
		Method:      http.MethodGet,
		Path:        "/openclaw/plugins/doctor",
		Summary:     "Run OpenClaw plugin doctor",
		Description: "通过 OpenClaw CLI 检查插件加载、registry、兼容性和 source shadowing 问题。",
		Tags:        []string{"OpenClaw"},
	}, openclawhandlers.GetOpenClawPluginsDoctor)
}
