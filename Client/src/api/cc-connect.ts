import { apiRequest, buildAPIURL } from './client'

export type CCConnectEnvironmentResponse = {
  status: string
  timestamp: string
  cache?: {
    refresh: boolean
  }
  cli: CCConnectCLIInfo
  home: CCConnectHomeInfo
  config: CCConnectConfigInfo
  daemon: CCConnectDaemonInfo
  runtime: CCConnectRuntimeInfo
  management: CCConnectManagementInfo
  checks: CCConnectCheck[]
  summary: string
}

export type CCConnectCLIInfo = {
  available: boolean
  path?: string
  version?: string
  source?: string
  error?: string
}

export type CCConnectHomeInfo = {
  path: string
  exists: boolean
  configPath: string
  configExists: boolean
  dataDir: string
  dataDirExists: boolean
  logPath?: string
  logExists: boolean
  logBytes?: number
  daemonMetaPath: string
  daemonMetaExists: boolean
}

export type CCConnectConfigInfo = {
  path: string
  exists: boolean
  readable: boolean
  parsed: boolean
  error?: string
  dataDir?: string
  language?: string
  logLevel?: string
  projectCount: number
  projects?: CCConnectProjectConfigInfo[]
  management: CCConnectManagementConfigShape
  bridge: CCConnectBridgeConfigShape
  providerCount: number
  commandCount: number
  hookCount: number
  bannedWordCount: number
  configSourceLabel?: string
}

export type CCConnectProjectConfigInfo = {
  name: string
  agentType: string
  workDir?: string
  mode?: string
  platformTypes: string[]
  providerRefs?: string[]
}

export type CCConnectManagementConfigShape = {
  enabled: boolean
  port: number
  url?: string
  tokenSet: boolean
}

export type CCConnectBridgeConfigShape = {
  enabled: boolean
  port: number
  path?: string
  tokenSet: boolean
}

export type CCConnectDaemonInfo = {
  installed: boolean
  running: boolean
  pid?: number
  platform?: string
  logPath?: string
  workDir?: string
  raw?: string
  error?: string
}

export type CCConnectRuntimeInfo = {
  running: boolean
  managed: boolean
  mode: 'agent-box' | 'daemon' | 'external' | 'stopped' | string
  label: string
  pid?: number
  rssBytes?: number
  logPath?: string
}

export type CCConnectManagementInfo = {
  enabled: boolean
  reachable: boolean
  url?: string
  version?: string
  uptimeSeconds?: number
  connectedPlatforms?: string[]
  projectsCount?: number
  bridgeAdapters?: CCConnectBridgeAdapter[]
  error?: string
}

export type CCConnectBridgeAdapter = {
  platform?: string
  project?: string
  capabilities?: string[]
}

export type CCConnectCheck = {
  name: string
  ok: boolean
  message: string
  durationMs: number
}

export type CCConnectTaskStatus = 'pending' | 'running' | 'done' | 'error'

export type CCConnectTaskResponse = {
  id: string
  status: CCConnectTaskStatus
  progress: number
  logs: string[]
  startedAt: string
  updatedAt: string
  error?: string
}

export type CCConnectTaskStreamMeta = {
  id: string
  kind: string
  timestamp: string
}

export type CCConnectTaskStreamStatus = {
  id: string
  status: CCConnectTaskStatus
  progress: number
  error?: string
  timestamp: string
}

export type CCConnectTaskStreamLog = {
  id: string
  line: string
  timestamp: string
}

export type CCConnectTaskStreamError = {
  id: string
  message: string
  timestamp: string
}

export type CCConnectDaemonActionResponse = {
  status: string
  timestamp: string
  action: 'install' | 'start' | 'stop' | 'restart' | string
  message: string
  pid?: number
  logPath?: string
  stdout?: string
  stderr?: string
}

export type CCConnectLogStreamMeta = {
  kind: string
  path: string
  file: string
  tail: number
  follow: boolean
  filter?: string
  levels?: string
  size: number
  timestamp: string
}

export type CCConnectLogStreamLine = {
  line: string
  level?: string
  message?: string
  subsystem?: string
  time?: string
  timestamp: string
}

export type CCConnectLogStreamError = {
  message: string
  timestamp: string
}

export type CCConnectLogStreamOptions = {
  kind?: 'runtime' | 'main'
  file?: string
  tail?: number
  follow?: boolean
  filter?: string
  levels?: string
}

export type CCConnectSkillsResponse = {
  status: string
  timestamp: string
  projects: CCConnectProjectSkills[]
  summary: CCConnectSkillsSummary
}

export type CCConnectProjectSkills = {
  project: string
  agentType: string
  dirs: string[]
  skills: CCConnectSkillInfo[]
}

export type CCConnectSkillInfo = {
  name: string
  displayName?: string
  description?: string
  source: string
}

export type CCConnectSkillsSummary = {
  projectCount: number
  skillCount: number
  dirCount: number
  agentTypes: Record<string, number>
}

export type CCConnectSkillPresetsResponse = {
  status: string
  timestamp: string
  version: number
  updatedAt?: string
  skills: CCConnectSkillPreset[]
}

export type CCConnectSkillPreset = {
  name: string
  displayName?: string
  description?: string
  descriptionZh?: string
  version?: string
  author?: string
  url?: string
  agentTypes?: string[]
  tags?: string[]
  featured?: boolean
  source?: CCConnectSkillSource
  pricing?: CCConnectSkillPricing
}

export type CCConnectSkillSource = {
  provider: string
  name?: string
  url?: string
}

export type CCConnectSkillPricing = {
  type: 'free' | 'paid' | 'freemium' | string
  price?: number
  currency?: string
}

export type CCConnectSkillsSearchResponse = {
  status: string
  timestamp: string
  query: string
  source: string
  results: CCConnectSkillHubResult[]
}

export type CCConnectSkillHubResult = {
  slug?: string
  name?: string
  description?: string
  summary?: string
  version?: string
  author?: string
  homepage?: string
  source?: string
  extra?: Record<string, unknown>
}

export type CCConnectSkillInstallRequest = {
  slug: string
  force?: boolean
  source?: string
  restartRuntime?: boolean
}

export type CCConnectSkillInstallResponse = {
  status: string
  timestamp: string
  slug: string
  targetDir: string
  targetDirs?: string[]
  message: string
  stdout?: string
  stderr?: string
  runtimeRestarted?: boolean
  restartError?: string
  skill?: CCConnectSkillInfo
}

export type CCConnectSkillDetailResponse = {
  status: string
  timestamp: string
  skill: CCConnectSkillInfo
  command: string
  agentTypes: string[]
  sources: string[]
  contentPath?: string
  content: string
  errors?: string[]
}

export type CCConnectSkillsShowcaseHotResponse = {
  section: string
  timestamp: string
  cache?: {
    refresh: boolean
  }
  skills: CCConnectShowcaseHotSkill[]
}

export type CCConnectShowcaseHotSkill = {
  slug: string
  name: string
  description?: string
  descriptionZh?: string
  version?: string
  ownerName?: string
  category?: string
  homepage?: string
  iconUrl?: string
  source?: string
  downloads?: number
  installs?: number
  stars?: number
  score?: number
  tags?: string[]
  labels?: Record<string, string>
  createdAt?: number
  updatedAt?: number
}

export type CCConnectTextFileResponse = {
  status: string
  timestamp: string
  path: string
  exists: boolean
  content: string
}

export type CCConnectBasicConfigResponse = {
  status: string
  timestamp: string
  path: string
  exists: boolean
  config: CCConnectBasicConfig
  summary: CCConnectBasicConfigSummary
}

export type CCConnectBasicConfig = {
  language: string
  dataDir: string
  attachmentSend: string
  idleTimeoutMins: number
  providerPresetsUrl?: string
  bannedWords?: string[]
  logLevel: string
  display: CCConnectDisplayBasicConfig
  streamPreview: CCConnectStreamPreviewConfig
  rateLimit: CCConnectRateLimitConfig
  outgoingRateLimit: CCConnectRateLimitConfig
  cron: CCConnectCronConfig
  webhook: CCConnectEndpointBasicConfig
  bridge: CCConnectEndpointBasicConfig
  management: CCConnectEndpointBasicConfig
}

export type CCConnectDisplayBasicConfig = {
  mode: string
  cardMode: string
  thinkingMessages: boolean
  thinkingMaxLen: number
  toolMessages: boolean
  toolMaxLen: number
}

export type CCConnectStreamPreviewConfig = {
  enabled: boolean
  intervalMs: number
  minDeltaChars: number
  maxChars: number
}

export type CCConnectRateLimitConfig = {
  maxMessages: number
  windowSecs: number
}

export type CCConnectCronConfig = {
  silent: boolean
  sessionMode: string
}

export type CCConnectEndpointBasicConfig = {
  enabled: boolean
  port: number
  path?: string
  corsOrigins?: string[]
  insecure?: boolean
  token?: string
  tokenSet: boolean
}

export type CCConnectSettingsResponse = {
  status: string
  timestamp: string
  settings: CCConnectSettings
}

export type CCConnectSettings = {
  autoStart: boolean
}

export type CCConnectBasicConfigSummary = {
  projectCount: number
  providerCount: number
  platformCount: number
  commandCount: number
  aliasCount: number
  hookCount: number
  bannedWordCount: number
}

export type CCConnectModelsConfigResponse = {
  status: string
  timestamp: string
  path: string
  exists: boolean
  config: CCConnectModelsConfig
  summary: CCConnectModelsConfigSummary
}

export type CCConnectModelsConfig = {
  providerPresetsUrl?: string
  providers: CCConnectModelProviderConfig[]
  projects: CCConnectProjectModelConfig[]
}

export type CCConnectModelsConfigSummary = {
  providerCount: number
  projectCount: number
  inlineProviderCount: number
  modelAliasCount: number
  referencedCount: number
}

export type CCConnectModelProviderConfig = {
  name: string
  apiKey?: string
  apiKeySet: boolean
  baseUrl?: string
  model?: string
  thinking?: string
  agentTypes?: string[]
  models?: CCConnectProviderModelConfig[]
  env?: Record<string, string>
  endpoints?: Record<string, string>
  agentModels?: Record<string, string>
  agentModelLists?: Record<string, CCConnectProviderModelConfig[]>
  codex?: CCConnectCodexProviderConfig
}

export type CCConnectProviderModelConfig = {
  model: string
  alias?: string
}

export type CCConnectCodexProviderConfig = {
  envKey?: string
  wireApi?: string
  httpHeaders?: Record<string, string>
}

export type CCConnectProjectModelConfig = {
  name: string
  agentType: string
  agentModel?: string
  activeProvider?: string
  providerRefs?: string[]
  inlineProviders?: CCConnectModelProviderConfig[]
}

export type CCConnectProjectsConfigResponse = {
  status: string
  timestamp: string
  path: string
  exists: boolean
  config: CCConnectProjectsConfig
  summary: CCConnectProjectsConfigSummary
}

export type CCConnectProjectsConfig = {
  projects: CCConnectProjectConfig[]
}

export type CCConnectProjectsConfigSummary = {
  projectCount: number
  platformCount: number
  agentTypes: Record<string, number>
  platformTypes: Record<string, number>
}

export type CCConnectProjectConfig = {
  name: string
  resetOnIdleMins?: number
  runAsUser?: string
  runAsEnv?: string[]
  showContextIndicator?: boolean
  replyFooter?: boolean
  injectSender?: boolean
  filterExternalSessions?: boolean
  adminFrom?: string
  disabledCommands?: string[]
  agent: CCConnectProjectAgentConfig
  platforms: CCConnectProjectPlatformConfig[]
}

export type CCConnectProjectAgentConfig = {
  type: string
  workDir?: string
  mode?: string
  model?: string
  provider?: string
  reasoningEffort?: string
  allowedTools?: string[]
  disallowedTools?: string[]
  systemPrompt?: string
  providerRefs?: string[]
  env?: Record<string, string>
  additionalOptions?: Record<string, string>
}

export type CCConnectProjectPlatformConfig = {
  type: string
  options?: Record<string, string>
}

export type CCConnectTerminalStatus = 'exited' | 'running' | 'stopping' | string

export type CCConnectTerminalCommand = 'continue' | 'interactive' | 'list-sessions' | 'resume' | string

export type CCConnectProjectSelection = {
  name: string
  path: string
  agentType: string
}

export type CCConnectTerminalSession = {
  id: string
  status: CCConnectTerminalStatus
  project: CCConnectProjectSelection
  agentType: string
  command: string
  kind: CCConnectTerminalCommand
  cwd: string
  pid?: number
  exitCode?: number
  error?: string
  createdAt: string
  updatedAt: string
  exitedAt?: string
  cols: number
  rows: number
  attached: number
  sessionId?: string
  scrollback?: string[]
}

export type CCConnectTerminalSummary = {
  total: number
  running: number
  exited: number
}

export type CCConnectTerminalsResponse = {
  status: string
  timestamp: string
  sessions: CCConnectTerminalSession[]
  summary: CCConnectTerminalSummary
}

export type CCConnectTerminalCreateRequest = {
  project?: string
  agentType?: string
  command?: CCConnectTerminalCommand
  resumeSessionId?: string
  cwd?: string
  cols?: number
  rows?: number
}

export type CCConnectAgentEngineInfo = {
  type: string
  label: string
  command: string
  installed: boolean
  path?: string
  error?: string
}

export type CCConnectAgentEngineSummary = {
  total: number
  installed: number
  missing: number
}

export type CCConnectAgentEnginesResponse = {
  status: string
  timestamp: string
  engines: CCConnectAgentEngineInfo[]
  summary: CCConnectAgentEngineSummary
}

export type CCConnectProjectSummary = {
  name: string
  path: string
  agentType: string
  model?: string
  provider?: string
}

export type CCConnectSessionsSummary = {
  totalMatched: number
  returned: number
  projects: number
  active: number
  ended: number
  totalMessages: number
  totalToolCalls: number
  totalTokens: number
  totalCostUsd: number
}

export type CCConnectManagedSession = {
  id: string
  project: string
  projectDisplayName: string
  projectPath: string
  agentType: string
  source?: string
  platform?: string
  userId?: string
  model?: string
  title?: string
  startedAt?: string
  lastActiveAt?: string
  endedAt?: string
  endReason?: string
  path?: string
  parentSessionId?: string
  preview?: string
  matchSnippet?: string
  matchedMessageCount: number
  isActive: boolean
  activeProcessIds?: string[]
  messageCount: number
  toolCallCount: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  costUsd?: number
}

export type CCConnectSessionsResponse = {
  status: string
  timestamp: string
  projects: CCConnectProjectSummary[]
  summary: CCConnectSessionsSummary
  sessions: CCConnectManagedSession[]
  limit: number
  offset: number
  hasMore: boolean
  errors?: string[]
}

export type CCConnectSessionMessage = {
  id: string
  sessionId: string
  role: string
  content?: unknown
  reasoning?: string
  reasoningContent?: string
  text?: string
  toolName?: string
  timestamp?: string
  raw?: unknown
}

export type CCConnectSessionDetailResponse = {
  status: string
  timestamp: string
  project: CCConnectProjectSummary
  session: CCConnectManagedSession
  messages: CCConnectSessionMessage[]
  errors?: string[]
}

export type CCConnectSessionEndResponse = {
  status: string
  timestamp: string
  project: CCConnectProjectSummary
  session: CCConnectManagedSession
  terminatedProcesses: number
}

export type CCConnectSessionsBulkDeleteResponse = {
  status: string
  timestamp: string
  summary: {
    requested: number
    deleted: number
    skipped: number
    missing: number
    errors: number
  }
  results: Array<{
    project: string
    agentType?: string
    id: string
    status: 'deleted' | 'error' | 'missing' | 'skipped' | string
    message?: string
  }>
}

export type CCConnectSetupFeishuBeginResponse = {
  status: string
  timestamp: string
  deviceCode: string
  qrUrl: string
  interval: number
  expiresIn: number
}

export type CCConnectSetupFeishuPollRequest = {
  deviceCode: string
  baseUrl?: string
}

export type CCConnectSetupFeishuPollResponse = {
  status: string
  timestamp: string
  baseUrl?: string
  platform?: string
  appId?: string
  appSecret?: string
  ownerOpenId?: string
  slowDown?: boolean
  error?: string
}

export type CCConnectSetupFeishuSaveRequest = {
  projectName: string
  appId: string
  appSecret: string
  platformType?: string
  ownerOpenId?: string
  workDir?: string
  agentType?: string
}

export type CCConnectSetupWeixinBeginRequest = {
  apiUrl?: string
}

export type CCConnectSetupWeixinBeginResponse = {
  status: string
  timestamp: string
  qrKey: string
  qrUrl: string
}

export type CCConnectSetupWeixinPollRequest = {
  qrKey: string
  apiUrl?: string
}

export type CCConnectSetupWeixinPollResponse = {
  status: string
  timestamp: string
  botToken?: string
  ilinkBotId?: string
  baseUrl?: string
  ilinkUserId?: string
}

export type CCConnectSetupWeixinSaveRequest = {
  projectName: string
  token: string
  baseUrl?: string
  ilinkBotId?: string
  ilinkUserId?: string
  workDir?: string
  agentType?: string
}

export type CCConnectAddPlatformRequest = {
  projectName: string
  type: string
  options?: Record<string, string>
  workDir?: string
  agentType?: string
}

export type CCConnectProjectSetupResponse = {
  status: string
  timestamp: string
  path: string
  project: CCConnectProjectConfig
  config: CCConnectProjectsConfig
  summary: CCConnectProjectsConfigSummary
  restartRequired: boolean
}

export type CCConnectFetchProviderModelsRequest = {
  apiKey?: string
  baseUrl: string
  contextLength?: number
  maxTokens?: number
  wireApi?: string
}

export type CCConnectFetchedModel = {
  contextLength?: number
  contextWindow?: number
  id: string
  input?: string[]
  maxTokens?: number
  name?: string
  raw?: Record<string, unknown>
  reasoning?: boolean
}

export type CCConnectFetchProviderModelsResponse = {
  models: CCConnectFetchedModel[]
  sourceUrl: string
  status: string
  timestamp: string
}

export type CCConnectTestProviderModelRequest = {
  apiKey?: string
  baseUrl: string
  model: string
  wireApi?: string
}

export type CCConnectTestProviderModelResponse = {
  durationMs: number
  message: string
  ok: boolean
  status: string
  statusCode?: number
  timestamp: string
}

export function getCCConnectEnvironment(refresh = false) {
  return apiRequest<CCConnectEnvironmentResponse>('/cc-connect/environment', {
    query: refresh ? { refresh: true } : undefined,
  })
}

export function getCCConnectBasicConfig() {
  return apiRequest<CCConnectBasicConfigResponse>('/cc-connect/config/basic')
}

export function updateCCConnectBasicConfig(config: CCConnectBasicConfig) {
  return apiRequest<CCConnectBasicConfigResponse>('/cc-connect/config/basic', {
    body: JSON.stringify({ config }),
    headers: { 'Content-Type': 'application/json' },
    method: 'PUT',
  })
}

export function getCCConnectSettings() {
  return apiRequest<CCConnectSettingsResponse>('/cc-connect/settings')
}

export function updateCCConnectSettings(settings: CCConnectSettings) {
  return apiRequest<CCConnectSettingsResponse>('/cc-connect/settings', {
    body: JSON.stringify(settings),
    headers: { 'Content-Type': 'application/json' },
    method: 'PUT',
  })
}

export function getCCConnectModelsConfig() {
  return apiRequest<CCConnectModelsConfigResponse>('/cc-connect/config/models')
}

export function updateCCConnectModelsConfig(config: CCConnectModelsConfig) {
  return apiRequest<CCConnectModelsConfigResponse>('/cc-connect/config/models', {
    body: JSON.stringify({ config }),
    headers: { 'Content-Type': 'application/json' },
    method: 'PUT',
  })
}

export function fetchCCConnectProviderModels(body: CCConnectFetchProviderModelsRequest) {
  return apiRequest<CCConnectFetchProviderModelsResponse>('/cc-connect/models/fetch', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

export function testCCConnectProviderModel(body: CCConnectTestProviderModelRequest) {
  return apiRequest<CCConnectTestProviderModelResponse>('/cc-connect/models/test', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

export function getCCConnectProjectsConfig() {
  return apiRequest<CCConnectProjectsConfigResponse>('/cc-connect/config/projects')
}

export function updateCCConnectProjectsConfig(config: CCConnectProjectsConfig) {
  return apiRequest<CCConnectProjectsConfigResponse>('/cc-connect/config/projects', {
    body: JSON.stringify({ config }),
    headers: { 'Content-Type': 'application/json' },
    method: 'PUT',
  })
}

export function beginCCConnectFeishuSetup() {
  return apiRequest<CCConnectSetupFeishuBeginResponse>('/cc-connect/setup/feishu/begin', {
    method: 'POST',
  })
}

export function pollCCConnectFeishuSetup(body: CCConnectSetupFeishuPollRequest) {
  return apiRequest<CCConnectSetupFeishuPollResponse>('/cc-connect/setup/feishu/poll', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

export function saveCCConnectFeishuSetup(body: CCConnectSetupFeishuSaveRequest) {
  return apiRequest<CCConnectProjectSetupResponse>('/cc-connect/setup/feishu/save', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

export function beginCCConnectWeixinSetup(body: CCConnectSetupWeixinBeginRequest = {}) {
  return apiRequest<CCConnectSetupWeixinBeginResponse>('/cc-connect/setup/weixin/begin', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

export function pollCCConnectWeixinSetup(body: CCConnectSetupWeixinPollRequest) {
  return apiRequest<CCConnectSetupWeixinPollResponse>('/cc-connect/setup/weixin/poll', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

export function saveCCConnectWeixinSetup(body: CCConnectSetupWeixinSaveRequest) {
  return apiRequest<CCConnectProjectSetupResponse>('/cc-connect/setup/weixin/save', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

export function addCCConnectProjectPlatform(body: CCConnectAddPlatformRequest) {
  return apiRequest<CCConnectProjectSetupResponse>('/cc-connect/projects/platforms', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

export function getCCConnectConfig() {
  return apiRequest<CCConnectTextFileResponse>('/cc-connect/config')
}

export function updateCCConnectConfig(content: string) {
  return apiRequest<CCConnectTextFileResponse>('/cc-connect/config', {
    body: JSON.stringify({ content }),
    headers: { 'Content-Type': 'application/json' },
    method: 'PUT',
  })
}

export function startCCConnectDaemon() {
  return apiRequest<CCConnectDaemonActionResponse>('/cc-connect/daemon/start', {
    method: 'POST',
  })
}

export function installCCConnectDaemon() {
  return apiRequest<CCConnectDaemonActionResponse>('/cc-connect/daemon/install', {
    method: 'POST',
  })
}

export function stopCCConnectDaemon() {
  return apiRequest<CCConnectDaemonActionResponse>('/cc-connect/daemon/stop', {
    method: 'POST',
  })
}

export function restartCCConnectDaemon() {
  return apiRequest<CCConnectDaemonActionResponse>('/cc-connect/daemon/restart', {
    method: 'POST',
  })
}

export function getCCConnectInstallStreamURL() {
  return buildAPIURL('/cc-connect/install')
}

export function getCCConnectUninstallStreamURL() {
  return buildAPIURL('/cc-connect/uninstall')
}

export function getCCConnectLogStreamURL(options: CCConnectLogStreamOptions = {}) {
  const query: Record<string, boolean | number | string | undefined> = {
    kind: options.kind,
    file: options.file,
    tail: options.tail,
    follow: options.follow,
    filter: options.filter,
    levels: options.levels,
  }
  return buildAPIURL('/cc-connect/log', query)
}

export function listCCConnectTerminals(project?: string) {
  return apiRequest<CCConnectTerminalsResponse>('/cc-connect/terminals', {
    query: project?.trim() ? { project } : undefined,
  })
}

export function createCCConnectTerminal(body: CCConnectTerminalCreateRequest) {
  return apiRequest<CCConnectTerminalSession>('/cc-connect/terminals', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

export function getCCConnectTerminal(id: string) {
  return apiRequest<CCConnectTerminalSession>(`/cc-connect/terminals/${encodeURIComponent(id)}`)
}

export function stopCCConnectTerminal(id: string) {
  return apiRequest<CCConnectTerminalSession>(`/cc-connect/terminals/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function deleteCCConnectTerminalRecord(id: string) {
  return apiRequest<CCConnectTerminalSession>(`/cc-connect/terminals/${encodeURIComponent(id)}/record`, {
    method: 'DELETE',
  })
}

export function getCCConnectTerminalWebSocketURL(id: string) {
  return buildAPIURL('/cc-connect/terminal/ws', { id })
}

export function getCCConnectAgentEngines() {
  return apiRequest<CCConnectAgentEnginesResponse>('/cc-connect/agent-engines')
}

export function listCCConnectSessions(options: {
  agentType?: string
  includeChildren?: boolean
  limit?: number
  offset?: number
  project?: string
  query?: string
  sortBy?: 'lastActive' | 'startedAt' | 'messages' | 'cost' | 'tokens' | string
  sortDir?: 'asc' | 'desc' | string
  status?: 'all' | 'active' | 'ended' | string
} = {}) {
  return apiRequest<CCConnectSessionsResponse>('/cc-connect/sessions', {
    query: {
      agentType: options.agentType?.trim() || undefined,
      includeChildren: options.includeChildren ? true : undefined,
      limit: options.limit,
      offset: options.offset,
      project: options.project?.trim() || undefined,
      query: options.query?.trim() || undefined,
      sortBy: options.sortBy,
      sortDir: options.sortDir,
      status: options.status,
    },
  })
}

export function getCCConnectSession(project: string, id: string, agentType?: string) {
  return apiRequest<CCConnectSessionDetailResponse>(`/cc-connect/sessions/${encodeURIComponent(project)}/${encodeURIComponent(id)}`, {
    query: agentType?.trim() ? { agentType } : undefined,
  })
}

export function endCCConnectSession(project: string, id: string, reason = 'manual_close', agentType?: string) {
  return apiRequest<CCConnectSessionEndResponse>(`/cc-connect/sessions/${encodeURIComponent(project)}/${encodeURIComponent(id)}/end`, {
    body: JSON.stringify({ reason }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    query: agentType?.trim() ? { agentType } : undefined,
  })
}

export function deleteCCConnectSessions(sessions: Array<{ agentType?: string; id: string; project: string }>) {
  return apiRequest<CCConnectSessionsBulkDeleteResponse>('/cc-connect/sessions/bulk-delete', {
    body: JSON.stringify({ sessions }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

export function getCCConnectSkills() {
  return apiRequest<CCConnectSkillsResponse>('/cc-connect/skills')
}

export function getCCConnectSkillPresets() {
  return apiRequest<CCConnectSkillPresetsResponse>('/cc-connect/skills/presets')
}

export function getCCConnectSkillsShowcaseHot(refresh = false) {
  return apiRequest<CCConnectSkillsShowcaseHotResponse>('/cc-connect/skills/showcase/hot', {
    query: refresh ? { refresh: true } : undefined,
  })
}

export function searchCCConnectSkills(query: string, limit = 20) {
  return apiRequest<CCConnectSkillsSearchResponse>('/cc-connect/skills/search', {
    query: { query, limit },
  })
}

export function getCCConnectSkill(name: string) {
  return apiRequest<CCConnectSkillDetailResponse>(`/cc-connect/skills/${encodeURIComponent(name)}`)
}

export function installCCConnectSkill(payload: CCConnectSkillInstallRequest) {
  return apiRequest<CCConnectSkillInstallResponse>('/cc-connect/skills/install', {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}
