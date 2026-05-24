// OpenClaw 前端 API 统一入口。
//
// - `/openclaw/environment`：OpenClaw 本地环境检测
// - `/openclaw/agents`：OpenClaw 智能体结构化读取
// - `/openclaw/config`：OpenClaw 配置文件读取与更新
// - `/openclaw/log`：OpenClaw 日志流（SSE）
// - `/openclaw/cron/*`：OpenClaw Gateway 定时任务管理
// - `/openclaw/skills/*`：OpenClaw 技能状态、搜索、安装与配置
// - `/openclaw/plugins/*`：OpenClaw 插件清单、搜索、安装、启停、更新、卸载与诊断
//

import { apiRequest, buildAPIURL } from './client'

export type OpenClawEnvironmentResponse = {
  status: string
  timestamp: string
  cache?: {
    refresh: boolean
  }
  cli: OpenClawCLIInfo
  home: OpenClawHomeInfo
  gateway: OpenClawGatewayInfo
  checks: OpenClawCheck[]
  summary: string
}

export type OpenClawGatewayActionResponse = {
  status: string
  timestamp: string
  action: 'restart' | 'stop' | string
  message: string
  stdout?: string
  stderr?: string
}

export type OpenClawMessageRoleCounts = {
  user: number
  assistant: number
  toolResult: number
  other: number
}

export type OpenClawMessageStatsRange = {
  hours: number
  bucket: 'hour' | string
  preset: 'hour' | 'week' | 'month' | 'all' | string
  start: string
  end: string
  timezone: string
}

export type OpenClawMessageStatsAgent = {
  agentId: string
  total: number
  roles: OpenClawMessageRoleCounts
}

export type OpenClawMessageStatsBucket = {
  time: string
  label: string
  total: number
  roles: OpenClawMessageRoleCounts
}

export type OpenClawMessageStatsResponse = {
  status: string
  timestamp: string
  home: string
  agentId: string
  range: OpenClawMessageStatsRange
  total: number
  roles: OpenClawMessageRoleCounts
  agents: OpenClawMessageStatsAgent[]
  buckets: OpenClawMessageStatsBucket[]
  scanned: {
    agentDirs: number
    files: number
    errors?: string[]
  }
}

export type OpenClawUpdateStatusResponse = {
  status: string
  timestamp: string
  cache?: {
    refresh: boolean
  }
  available: boolean
  currentVersion?: string
  latestVersion?: string
  channel?: string
  channelLabel?: string
  installKind?: string
  packageManager?: string
  root?: string
  hasGitUpdate: boolean
  hasRegistryUpdate: boolean
  gitBehind?: number
  error?: string
  stderr?: string
}

export type OpenClawUpdateActionResponse = {
  status: string
  timestamp: string
  message: string
  stdout?: string
  stderr?: string
}

export type OpenClawCLIInfo = {
  available: boolean
  path?: string
  version?: string
  source?: string
  error?: string
}

export type OpenClawHomeInfo = {
  path: string
  exists: boolean
  configPath: string
  configExists: boolean
  configValid: boolean
  configError?: string
  deviceKeyPath: string
  deviceKeyExists: boolean
  ownerPath: string
  ownerExists: boolean
  logsDir: string
  logsDirExists: boolean
  errLogPath: string
  errLogExists: boolean
  errLogBytes?: number
  errLogHasFatal: boolean
}

export type OpenClawGatewayInfo = {
  port: number
  url: string
  webSocketUrl: string
  publicUrl?: string
  publicWebSocketUrl?: string
  bind?: string
  authMode: string
  allowedOrigins?: string[]
  tcpReachable: boolean
  httpHealthOk: boolean
  httpHealthStatus?: number
  healthzOk: boolean
  readyzOk: boolean
  ownerPid?: number
  ownerStartedBy?: string
  ownerMatchesPort: boolean
  ownerMatchesHome: boolean
  ownerMatchesCli: boolean
  ownerRecordStatus?: string
  ownerProcess?: OpenClawProcessInfo
}

export type OpenClawPublicGatewayResponse = {
  status: string
  timestamp: string
  envKey: string
  envPath?: string
  publicUrl?: string
  publicWebSocketUrl?: string
}

export type OpenClawProcessInfo = {
  pid: number
  detected: boolean
  state?: string
  startedAt?: string
  uptime?: string
  uptimeSeconds?: number
  cpuPercent?: number
  memoryPercent?: number
  rssBytes?: number
  rssMb?: number
  command?: string
  error?: string
}

export type OpenClawCheck = {
  name: string
  ok: boolean
  message: string
  durationMs: number
}

export type OpenClawConfigResponse = {
  status: string
  timestamp: string
  path: string
  exists: boolean
  content?: Record<string, unknown>
}

export type OpenClawConfigRequest = {
  content: Record<string, unknown>
}

export type OpenClawGatewayDevicePairingRequest = {
  clientId?: string
  clientMode?: string
  deviceId?: string
  meta?: Record<string, unknown>
  platform?: string
  requestId: string
  role?: string
  scopes?: string[]
}

export type OpenClawGatewayDevicePairingListResponse = {
  pending: OpenClawGatewayDevicePairingRequest[]
  rawOutput?: string
  status: string
  timestamp: string
}

export type OpenClawGatewayDevicePairingApproveRequest = {
  requestId: string
}

export type OpenClawGatewayDevicePairingApproveResponse = {
  approved: boolean
  message?: string
  rawOutput?: string
  requestId: string
  status: string
  timestamp: string
}

export type OpenClawDreamingPhaseConfig = {
  enabled: boolean
  limit?: number
  lookbackDays?: number
  maxAgeDays?: number
  minPatternStrength?: number
  minRecallCount?: number
  minScore?: number
  minUniqueQueries?: number
  recencyHalfLifeDays?: number
}

export type OpenClawDreamingConfigStatus = {
  enabled: boolean
  frequency: string
  model?: string
  phases: {
    deep: OpenClawDreamingPhaseConfig
    light: OpenClawDreamingPhaseConfig
    rem: OpenClawDreamingPhaseConfig
  }
  pluginId: string
  separateReports: boolean
  storageMode: string
  timezone?: string
}

export type OpenClawDreamingConfigPatch = {
  enabled?: boolean
  frequency?: string
  model?: string
  timezone?: string
}

export type OpenClawDreamDiaryInfo = {
  exists: boolean
  path: string
  relativePath: string
  size?: number
  updatedAt?: string
}

export type OpenClawDreamStoreInfo = {
  dir: string
  error?: string
  exists: boolean
  phaseSignalsExists: boolean
  phaseSignalsPath: string
  sessionCorpusDir: string
  sessionCorpusExists: boolean
  shortTermRecallExists: boolean
  shortTermRecallPath: string
}

export type OpenClawDreamReport = {
  path: string
  phase: 'deep' | 'light' | 'rem' | string
  relativePath: string
  size?: number
  updatedAt?: string
}

export type OpenClawDreamingAgent = {
  diary: OpenClawDreamDiaryInfo
  id: string
  isDefault: boolean
  name?: string
  reports: OpenClawDreamReport[]
  store: OpenClawDreamStoreInfo
  workspace: string
}

export type OpenClawDreamingSummary = {
  dailySignalCount: number
  groundedSignalCount: number
  lightPhaseHitCount: number
  phaseSignalCount: number
  promotedCount: number
  recallSignalCount: number
  remPhaseHitCount: number
  shortTermCount: number
  totalSignalCount: number
}

export type OpenClawDreamingResponse = {
  agents: OpenClawDreamingAgent[]
  cli: OpenClawAgentMemoryCLIStatus
  config: OpenClawDreamingConfigStatus
  exists: boolean
  path: string
  selected: OpenClawDreamingAgent
  status: string
  summary: OpenClawDreamingSummary
  timestamp: string
}

export type OpenClawDreamingConfigResponse = {
  config: OpenClawDreamingConfigStatus
  exists: boolean
  path: string
  status: string
  timestamp: string
}

export type OpenClawDreamDiaryResponse = {
  agentId: string
  content: string
  diary: OpenClawDreamDiaryInfo
  status: string
  timestamp: string
}

export type OpenClawDreamingActionResponse = {
  action: string
  agentId: string
  diary: OpenClawDreamDiaryInfo
  found: boolean
  groundedFiles?: number
  path?: string
  removedEntries?: number
  removedShortTermEntries?: number
  replaced?: number
  scannedFiles?: number
  sourcePath?: string
  shortTermStorePath?: string
  status: string
  timestamp: string
  written?: number
}

export type OpenClawCronSchedule =
  | { kind: 'at', at: string }
  | { anchorMs?: number, everyMs: number, kind: 'every' }
  | { expr: string, kind: 'cron', staggerMs?: number, tz?: string }

export type OpenClawCronSessionTarget = 'main' | 'isolated' | 'current' | `session:${string}`
export type OpenClawCronWakeMode = 'next-heartbeat' | 'now'
export type OpenClawCronDeliveryMode = 'none' | 'announce' | 'webhook'
export type OpenClawCronRunStatus = 'error' | 'ok' | 'skipped'
export type OpenClawCronDeliveryStatus = 'delivered' | 'not-delivered' | 'not-requested' | 'unknown'

export type OpenClawCronPayload =
  | { kind: 'systemEvent', text: string }
  | {
      allowUnsafeExternalContent?: boolean
      fallbacks?: string[]
      kind: 'agentTurn'
      lightContext?: boolean
      message: string
      model?: string
      thinking?: string
      timeoutSeconds?: number
      toolsAllow?: string[]
    }

export type OpenClawCronDelivery = {
  accountId?: string
  bestEffort?: boolean
  channel?: string
  failureDestination?: {
    accountId?: string
    channel?: string
    mode?: 'announce' | 'webhook'
    to?: string
  }
  mode: OpenClawCronDeliveryMode
  threadId?: number | string
  to?: string
}

export type OpenClawCronFailureAlert = false | {
  accountId?: string
  after?: number
  channel?: string
  cooldownMs?: number
  includeSkipped?: boolean
  mode?: 'announce' | 'webhook'
  to?: string
}

export type OpenClawCronJobCreate = {
  agentId?: string
  deleteAfterRun?: boolean
  delivery?: OpenClawCronDelivery
  description?: string
  enabled?: boolean
  failureAlert?: OpenClawCronFailureAlert
  name?: string
  payload: OpenClawCronPayload
  schedule: OpenClawCronSchedule
  sessionKey?: string
  sessionTarget?: OpenClawCronSessionTarget
  wakeMode?: OpenClawCronWakeMode
}

export type OpenClawCronJobPatch = Partial<Omit<OpenClawCronJobCreate, 'payload'>> & {
  payload?: Partial<Extract<OpenClawCronPayload, { kind: 'agentTurn' }>> | Partial<Extract<OpenClawCronPayload, { kind: 'systemEvent' }>>
}

export type OpenClawCronJob = OpenClawCronJobCreate & {
  createdAtMs?: number
  id: string
  state: {
    consecutiveErrors?: number
    consecutiveSkipped?: number
    lastDeliveryError?: string
    lastDeliveryStatus?: OpenClawCronDeliveryStatus
    lastDiagnosticSummary?: string
    lastDurationMs?: number
    lastError?: string
    lastRunAtMs?: number
    lastRunStatus?: OpenClawCronRunStatus
    nextRunAtMs?: number
    runningAtMs?: number
  }
  updatedAtMs?: number
}

export type OpenClawCronStatusResponse = {
  enabled: boolean
  jobs: number
  nextWakeAtMs: number | null
  storePath: string
}

export type OpenClawCronDeliveryPreview = {
  detail: string
  label: string
}

export type OpenClawCronListResponse = {
  deliveryPreviews?: Record<string, OpenClawCronDeliveryPreview>
  hasMore: boolean
  jobs: OpenClawCronJob[]
  limit: number
  nextOffset: null | number
  offset: number
  total: number
}

export type OpenClawCronRunEntry = {
  deliveryError?: string
  deliveryStatus?: OpenClawCronDeliveryStatus
  durationMs?: number
  error?: string
  jobId: string
  nextRunAtMs?: number
  runAtMs?: number
  runId?: string
  sessionId?: string
  sessionKey?: string
  status?: OpenClawCronRunStatus
  summary?: string
  ts: number
}

export type OpenClawCronRunsResponse = {
  entries: OpenClawCronRunEntry[]
  hasMore: boolean
  limit: number
  nextOffset: null | number
  offset: number
  total: number
}

export type OpenClawCronRunResponse =
  | { ok: true, ran: true }
  | { enqueued: true, ok: true, runId: string }
  | { ok: true, ran: false, reason: string }
  | { ok: false }

export type OpenClawModelApiType =
  | 'openai-completions'
  | 'openai-responses'
  | 'openai-codex-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'github-copilot'
  | 'bedrock-converse-stream'
  | 'ollama'
  | 'azure-openai-responses'

export type OpenClawModelDefinition = {
  id: string
  name?: string
  api?: OpenClawModelApiType | string
  baseUrl?: string
  reasoning?: boolean
  input?: Array<'text' | 'image' | 'video' | 'audio'>
  contextWindow?: number
  contextTokens?: number
  maxTokens?: number
  params?: Record<string, unknown>
  agentRuntime?: Record<string, unknown>
  headers?: Record<string, string>
  compat?: Record<string, unknown>
  cost?: Record<string, unknown>
  metadataSource?: string
}

export type OpenClawModelProvider = {
  baseUrl?: string
  apiKey?: string | Record<string, unknown>
  auth?: string
  api?: OpenClawModelApiType | string
  contextWindow?: number
  contextTokens?: number
  maxTokens?: number
  timeoutSeconds?: number
  injectNumCtxForOpenAICompat?: boolean
  params?: Record<string, unknown>
  agentRuntime?: Record<string, unknown>
  localService?: Record<string, unknown>
  headers?: Record<string, unknown>
  authHeader?: boolean
  request?: Record<string, unknown>
  models?: OpenClawModelDefinition[]
}

export type OpenClawModelsConfig = {
  mode?: 'merge' | 'replace' | string
  providers?: Record<string, OpenClawModelProvider>
  pricing?: Record<string, unknown>
}

export type OpenClawDefaultModelConfig = {
  primary?: string
  fallbacks?: string[]
}

export type OpenClawFetchProviderModelsRequest = {
  api?: OpenClawModelApiType | string
  apiKey?: string
  baseUrl: string
  contextWindow?: number
  maxTokens?: number
}

export type OpenClawFetchProviderModelsResponse = {
  status: string
  timestamp: string
  sourceUrl: string
  models: OpenClawModelDefinition[]
}

export type OpenClawTestProviderModelRequest = {
  api?: OpenClawModelApiType | string
  apiKey?: string
  baseUrl: string
  model: string
}

export type OpenClawTestProviderModelResponse = {
  status: string
  timestamp: string
  ok: boolean
  statusCode?: number
  durationMs: number
  message: string
}

export type OpenClawAgentsResponse = {
  status: string
  timestamp: string
  path: string
  exists: boolean
  defaults: OpenClawAgentDefaults
  agents: OpenClawAgentSummary[]
  bindings: OpenClawAgentBinding[]
  summary: OpenClawAgentsSummary
}

export type OpenClawAgentDetailResponse = {
  status: string
  timestamp: string
  path: string
  exists: boolean
  agent: OpenClawAgentSummary
  files: OpenClawAgentFileStatus[]
}

export type OpenClawAgentsSummary = {
  total: number
  defaultCount: number
  boundCount: number
  runtimeCount: number
}

export type OpenClawAgentDefaults = {
  defaultAgentId: string
  workspace: string
  agentDirRoot: string
  sessionStore: string
  model?: string
  skills?: string[]
}

export type OpenClawAgentSummary = {
  id: string
  name?: string
  isDefault: boolean
  workspace: string
  workspaceExists: boolean
  agentDir: string
  agentDirExists: boolean
  sessionStore: string
  sessionStoreExists: boolean
  model?: string
  runtime: OpenClawAgentRuntime
  identity: OpenClawAgentIdentity
  skills?: string[]
  skillsInherited: boolean
  bindingsCount: number
  bindings?: OpenClawAgentBinding[]
  config?: Record<string, unknown>
}

export type OpenClawAgentRuntime = {
  type: string
  id?: string
  backend?: string
  mode?: string
  cwd?: string
  explicit: boolean
}

export type OpenClawAgentIdentity = {
  name?: string
  theme?: string
  emoji?: string
  avatar?: string
  source?: string
  identityFilePath?: string
  identityFileExists: boolean
}

export type OpenClawAgentBinding = {
  type: string
  agentId: string
  channel?: string
  accountId?: string
  peerKind?: string
  peerId?: string
  guildId?: string
  teamId?: string
  roles?: string[]
  label: string
  acp?: Record<string, unknown>
}

export type OpenClawAgentFileStatus = {
  name: string
  path: string
  exists: boolean
  size?: number
}

export type OpenClawAgentFileResponse = {
  status: string
  timestamp: string
  agentId: string
  file: OpenClawAgentFileStatus
  content: string
}

export type OpenClawAgentFileUpdateRequest = {
  content: string
}

export type OpenClawWorkspaceNode = {
  name: string
  relativePath: string
  path: string
  type: 'file' | 'directory' | 'symlink' | 'other' | string
  exists: boolean
  size?: number
  updatedAt?: string
  children?: OpenClawWorkspaceNode[]
  childCount?: number
  symlink: boolean
  target?: string
  targetInside: boolean
  readable: boolean
  binary: boolean
  truncated: boolean
  mime?: string
  language?: string
  redactedReason?: string
}

export type OpenClawWorkspaceTreeSummary = {
  directories: number
  files: number
  truncated: boolean
  maxEntries: number
  depth: number
}

export type OpenClawWorkspaceTreeResponse = {
  status: string
  timestamp: string
  agentId: string
  workspace: string
  root: OpenClawWorkspaceNode
  summary: OpenClawWorkspaceTreeSummary
}

export type OpenClawWorkspaceFileResponse = {
  status: string
  timestamp: string
  agentId: string
  workspace: string
  file: OpenClawWorkspaceNode
  content?: string
  dataUrl?: string
}

export type OpenClawWorkspaceCreateRequest = {
  path: string
  type: 'file' | 'directory'
  content?: string
  contentBase64?: string
}

export type OpenClawWorkspaceUpdateRequest = {
  path: string
  content: string
}

export type OpenClawWorkspaceDeleteRequest = {
  path: string
}

export type OpenClawWorkspaceMoveRequest = {
  path: string
  targetPath: string
}

export type OpenClawWorkspaceMutationResponse = {
  status: string
  timestamp: string
  agentId: string
  workspace: string
  action: 'create' | 'delete' | string
  node: OpenClawWorkspaceNode
}

export type OpenClawWorkspaceTreeOptions = {
  depth?: number
  includeHidden?: boolean
  maxEntries?: number
  path?: string
}

export type OpenClawWorkspaceFileOptions = {
  maxBytes?: number
}

export type OpenClawAgentMemoryIndexStatus = {
  path: string
  exists: boolean
  size?: number
  updatedAt?: string
  walExists: boolean
  shmExists: boolean
}

export type OpenClawAgentMemoryCLIStatus = {
  available: boolean
  command?: string
  error?: string
  raw?: unknown
  text?: string
}

export type OpenClawAgentMemorySummary = {
  rootExists: boolean
  filesCount: number
  totalBytes: number
  updatedAt?: string
}

export type OpenClawAgentMemoryFile = {
  name: string
  relativePath: string
  path: string
  kind: 'root' | 'daily' | string
  exists: boolean
  size?: number
  updatedAt?: string
  title?: string
}

export type OpenClawAgentMemoryResponse = {
  status: string
  timestamp: string
  agentId: string
  workspace: string
  memoryDir: string
  index: OpenClawAgentMemoryIndexStatus
  cli: OpenClawAgentMemoryCLIStatus
  files: OpenClawAgentMemoryFile[]
  summary: OpenClawAgentMemorySummary
}

export type OpenClawAgentMemoryFileResponse = {
  status: string
  timestamp: string
  agentId: string
  file: OpenClawAgentMemoryFile
  content: string
}

export type OpenClawAgentMemoryFileUpdateRequest = {
  content: string
}

export type OpenClawAgentMemorySearchRequest = {
  query: string
  maxResults?: number
}

export type OpenClawAgentMemorySearchHit = {
  path?: string
  relativePath?: string
  title?: string
  snippet: string
  score?: number
  lineStart?: number
  lineEnd?: number
}

export type OpenClawAgentMemorySearchResponse = {
  status: string
  timestamp: string
  agentId: string
  query: string
  source: 'memory_search' | 'local' | string
  error?: string
  raw?: unknown
  results: OpenClawAgentMemorySearchHit[]
}

export type OpenClawAgentMemoryIndexRequest = {
  force?: boolean
}

export type OpenClawAgentMemoryIndexResponse = {
  status: string
  timestamp: string
  agentId: string
  command: string
  output?: string
  error?: string
}

export type OpenClawAgentAdvancedSettingsForm = {
  default: boolean
  model: string
  modelFallbacks: string
  thinkingDefault: string
  reasoningDefault: string
  verboseDefault: string
  fastModeDefault: boolean
  temperature: string
  topP: string
  maxTokens: string
  toolsProfile: string
  toolsAllow: string
  toolsDeny: string
  sandboxMode: string
  sandboxScope: string
  workspaceAccess: string
  allowAgents: string
}

export type OpenClawAgentMutationRequest = {
  id?: string
  name?: string
  emoji?: string
  avatar?: string
  workspace?: string
  agentDir?: string
  default?: boolean
  model?: string
  modelFallbacks?: string[]
  thinkingDefault?: string
  reasoningDefault?: string
  verboseDefault?: string
  fastModeDefault?: boolean
  params?: Record<string, unknown>
  tools?: Record<string, unknown>
  sandbox?: Record<string, unknown>
  groupChat?: Record<string, unknown>
  subagents?: Record<string, unknown>
  skills?: string[]
  skillsMode?: 'explicit' | 'inherit' | 'unrestricted'
  identity?: Record<string, unknown>
  runtime?: Record<string, unknown>
  config?: Record<string, unknown>
}

export type OpenClawAgentDeleteResponse = {
  status: string
  timestamp: string
  path: string
  agentId: string
  workspace?: string
  workspaceRetained?: boolean
  workspaceRetainedReason?: string
  workspaceSharedWith?: string[]
  agentDir?: string
  sessionStore?: string
  removedBindings: number
  removedAllow: number
}

export type OpenClawConfigBackup = {
  name: string
  path: string
  size: number
  createdAt?: string
  updatedAt: string
}

export type OpenClawConfigBackupListResponse = {
  status: string
  timestamp: string
  directory: string
  backups: OpenClawConfigBackup[]
}

export type OpenClawConfigBackupResponse = {
  status: string
  timestamp: string
  backup: OpenClawConfigBackup
}

export type OpenClawConfigBackupDetailResponse = {
  status: string
  timestamp: string
  backup: OpenClawConfigBackup
  content: Record<string, unknown>
}

export type OpenClawLogStreamMeta = {
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

export type OpenClawLogStreamLine = {
  line: string
  level?: string
  message?: string
  subsystem?: string
  time?: string
  timestamp: string
}

export type OpenClawLogStreamError = {
  message: string
  timestamp: string
}

export type OpenClawLogStreamOptions = {
  kind?: 'gateway' | 'gateway-err' | 'guardian' | 'config-audit'
  file?: string
  tail?: number
  follow?: boolean
  filter?: string
  levels?: string
}

export type OpenClawSkillsStatusResponse = {
  workspaceDir?: string
  managedSkillsDir?: string
  agentId?: string
  skills: OpenClawSkillStatus[]
}

export type OpenClawSkillStatus = {
  name: string
  description?: string
  emoji?: string
  eligible: boolean
  disabled: boolean
  blockedByAllowlist: boolean
  blockedByAgentFilter: boolean
  modelVisible: boolean
  userInvocable: boolean
  commandVisible: boolean
  source?: string
  bundled?: boolean
  homepage?: string
  filePath?: string
  baseDir?: string
  skillContent?: string
  skillContentError?: string
  skillKey?: string
  always?: boolean
  missing?: OpenClawSkillRequirements
  requirements?: OpenClawSkillRequirements
  configChecks?: unknown[]
  install?: OpenClawSkillInstallOption[]
}

export type OpenClawSkillRequirements = {
  bins?: string[]
  anyBins?: string[]
  env?: string[]
  config?: string[]
  os?: string[]
}

export type OpenClawSkillInstallOption = {
  id?: string
  kind?: string
  label?: string
  bins?: string[]
  packages?: string[]
  package?: string
  formula?: string
}

export type OpenClawSkillsSearchResponse = {
  source?: string
  results?: OpenClawSkillSearchResult[]
  skills?: OpenClawSkillSearchResult[]
  items?: OpenClawSkillSearchResult[]
}

export type OpenClawSkillSearchResult = {
  slug?: string
  name?: string
  title?: string
  displayName?: string
  description?: string
  summary?: string
  version?: string | null
  author?: string
  downloads?: number
  score?: number
  updatedAt?: string | number | null
  homepage?: string
  source?: string
}

export type OpenClawSkillsShowcaseHotResponse = {
  section: string
  timestamp: string
  cache?: {
    refresh: boolean
  }
  skills: OpenClawShowcaseHotSkill[]
}

export type OpenClawShowcaseHotSkill = {
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

export type OpenClawPluginStatusResponse = {
  workspaceDir?: string
  registry?: OpenClawPluginRegistrySummary
  plugins: OpenClawPluginStatus[]
  diagnostics?: OpenClawPluginDiagnostic[]
}

export type OpenClawPluginRegistrySummary = {
  source?: string
  diagnostics?: OpenClawPluginDiagnostic[]
  [key: string]: unknown
}

export type OpenClawPluginDiagnostic = {
  code?: string
  message?: string
  severity?: string
  pluginId?: string
  [key: string]: unknown
}

export type OpenClawPluginStatus = {
  pluginId?: string
  id?: string
  name?: string
  packageName?: string
  displayName?: string
  description?: string
  version?: string
  rootDir?: string
  manifestPath?: string
  source?: string
  origin?: string | Record<string, unknown>
  enabled?: boolean
  installed?: boolean
  startup?: Record<string, unknown>
  compat?: OpenClawPluginCompatibility[]
  compatibility?: OpenClawPluginCompatibility[]
  diagnostics?: OpenClawPluginDiagnostic[]
  package?: Record<string, unknown>
  manifest?: Record<string, unknown>
  [key: string]: unknown
}

export type OpenClawPluginCompatibility = {
  code?: string
  message?: string
  severity?: string
  [key: string]: unknown
}

export type OpenClawPluginsSearchResponse = {
  query?: string
  results?: OpenClawPluginSearchResult[]
  plugins?: OpenClawPluginSearchResult[]
  items?: OpenClawPluginSearchResult[]
}

export type OpenClawPluginRegistryPackage = {
  capabilityTags?: string[]
  channel?: string
  createdAt?: string | number | null
  displayName?: string
  executesCode?: boolean
  family?: string
  isOfficial?: boolean
  latestVersion?: string | null
  name?: string
  ownerHandle?: string
  runtimeId?: string
  summary?: string
  updatedAt?: string | number | null
  verificationTier?: string
  [key: string]: unknown
}

export type OpenClawPluginSearchResult = {
  name?: string
  packageName?: string
  id?: string
  pluginId?: string
  title?: string
  displayName?: string
  description?: string
  summary?: string
  version?: string | null
  author?: string
  homepage?: string
  repository?: string
  install?: string
  installSpec?: string
  downloads?: number
  score?: number
  updatedAt?: string | number | null
  package?: OpenClawPluginRegistryPackage
  [key: string]: unknown
}

export type OpenClawPluginInspectResponse = {
  workspaceDir?: string
  plugin?: OpenClawPluginStatus
  shape?: string
  capabilityMode?: string
  capabilityCount?: number
  capabilities?: unknown[]
  typedHooks?: unknown[]
  customHooks?: unknown[]
  tools?: unknown[]
  commands?: unknown[]
  cliCommands?: unknown[]
  services?: unknown[]
  gatewayDiscoveryServices?: unknown[]
  gatewayMethods?: unknown[]
  policy?: Record<string, unknown>
  compatibility?: OpenClawPluginCompatibility[]
  [key: string]: unknown
}

export type OpenClawPluginInstallRequest = {
  spec: string
  link?: boolean
  force?: boolean
  pin?: boolean
  marketplace?: string
  dangerouslyForceUnsafeInstall?: boolean
}

export type OpenClawPluginMutationResponse = {
  status: string
  timestamp: string
  pluginId?: string
  message?: string
  stdout?: string
  stderr?: string
}

export type OpenClawPluginDoctorResponse = {
  status: string
  timestamp: string
  output: string
  stderr?: string
}

export type OpenClawPluginRegistryResponse = {
  status?: string
  registry?: Record<string, unknown>
  persisted?: Record<string, unknown>
  diagnostics?: OpenClawPluginDiagnostic[]
  [key: string]: unknown
}

export type OpenClawSkillInstallRequest = {
  slug: string
  version?: string
  force?: boolean
  agentId?: string
  source?: string
}

export type OpenClawSkillDependencyInstallRequest = {
  name: string
  installId: string
  dangerouslyForceUnsafeInstall?: boolean
  timeoutMs?: number
}

export type OpenClawSkillUpdateRequest = {
  enabled?: boolean
  apiKey?: string
  env?: Record<string, string>
}

export type OpenClawSkillMutationResponse = {
  status: string
  timestamp: string
  skillKey?: string
  message?: string
  stdout?: string
  stderr?: string
  config?: Record<string, unknown>
}

/**
 * 获取当前主机上的 OpenClaw 本地环境信息。
 *
 * 对应后端 `/openclaw/environment` 接口，用于读取 CLI、OpenClaw Home、配置文件、Gateway 健康状态、owner 记录和日志摘要等基础状态。
 * 当 `refresh` 为 true 时，会要求后端跳过缓存重新检测。
 */
export function getOpenClawEnvironment(refresh = false) {
  return apiRequest<OpenClawEnvironmentResponse>('/openclaw/environment', {
    query: refresh ? { refresh: true } : undefined,
  })
}

export function getOpenClawMessageStats(options: { agentId?: string; hours?: number; range?: string } = {}) {
  return apiRequest<OpenClawMessageStatsResponse>('/openclaw/messages/stats', {
    query: {
      agentId: options.agentId && options.agentId !== 'all' ? options.agentId : undefined,
      hours: options.hours,
      range: options.range,
    },
  })
}

export function restartOpenClawGateway() {
  return apiRequest<OpenClawGatewayActionResponse>('/openclaw/gateway/restart', {
    method: 'POST',
  })
}

export function stopOpenClawGateway() {
  return apiRequest<OpenClawGatewayActionResponse>('/openclaw/gateway/stop', {
    method: 'POST',
  })
}

export function getOpenClawUpdateStatus(refresh = false) {
  return apiRequest<OpenClawUpdateStatusResponse>('/openclaw/update/status', {
    query: refresh ? { refresh: true } : undefined,
  })
}

export function updateOpenClaw() {
  return apiRequest<OpenClawUpdateActionResponse>('/openclaw/update', {
    method: 'POST',
  })
}

export function getOpenClawUpdateStreamURL() {
  return buildAPIURL('/openclaw/update/stream')
}

/**
 * 构造 OpenClaw 卸载 SSE 流地址。
 *
 * 后端会执行官方非交互卸载命令，并通过 `meta/status/log/error/done` 事件返回进度。
 */
export function getOpenClawUninstallStreamURL() {
  return buildAPIURL('/openclaw/uninstall')
}

export function getOpenClawInstallStreamURL() {
  return buildAPIURL('/openclaw/install')
}

/**
 * 读取当前主机上的 OpenClaw 配置文件。
 *
 * 对应后端 `/openclaw/config` GET 接口，用于查看默认 OpenClaw home 下的 `openclaw.json` 文件路径、存在状态和 JSON 内容。
 */

export function getOpenClawConfig() {
  return apiRequest<OpenClawConfigResponse>('/openclaw/config')
}

export function getOpenClawPublicGateway() {
  return apiRequest<OpenClawPublicGatewayResponse>('/openclaw/public-gateway')
}

export function updateOpenClawPublicGateway(publicUrl: string) {
  return apiRequest<OpenClawPublicGatewayResponse>('/openclaw/public-gateway', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicUrl }),
  })
}

export function resolveOpenClawGatewayWebSocketURL(gateway?: Pick<OpenClawGatewayInfo, 'publicWebSocketUrl' | 'webSocketUrl'> | null) {
  return gateway?.publicWebSocketUrl || gateway?.webSocketUrl || ''
}


export function listOpenClawGatewayDevicePairingRequests() {
  return apiRequest<OpenClawGatewayDevicePairingListResponse>('/openclaw/gateway-devices/pairing')
}

export function approveOpenClawGatewayDevicePairingRequest(body: OpenClawGatewayDevicePairingApproveRequest) {
  return apiRequest<OpenClawGatewayDevicePairingApproveResponse>('/openclaw/gateway-devices/pairing/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}


/**
 * 更新当前主机上的 OpenClaw 配置文件。
 *
 * 对应后端 `/openclaw/config` PUT 接口，用于提交完整 JSON 配置内容，后端会格式化后写回 `openclaw.json`。
 */
export function updateOpenClawConfig(content: Record<string, unknown>) {
  return apiRequest<OpenClawConfigResponse>('/openclaw/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content } satisfies OpenClawConfigRequest),
  })
}

export function getOpenClawDreaming(agentId?: string) {
  return apiRequest<OpenClawDreamingResponse>('/openclaw/dreaming', {
    query: agentId ? { agentId } : undefined,
  })
}

export function getOpenClawDreamDiary(agentId?: string) {
  return apiRequest<OpenClawDreamDiaryResponse>('/openclaw/dreaming/diary', {
    query: agentId ? { agentId } : undefined,
  })
}

export function updateOpenClawDreamingConfig(body: OpenClawDreamingConfigPatch) {
  return apiRequest<OpenClawDreamingConfigResponse>('/openclaw/dreaming/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function backfillOpenClawDreamDiary(agentId?: string) {
  return apiRequest<OpenClawDreamingActionResponse>('/openclaw/dreaming/diary/backfill', {
    method: 'POST',
    query: agentId ? { agentId } : undefined,
  })
}

export function resetOpenClawDreamDiary(agentId?: string) {
  return apiRequest<OpenClawDreamingActionResponse>('/openclaw/dreaming/diary/reset', {
    method: 'POST',
    query: agentId ? { agentId } : undefined,
  })
}

export function clearOpenClawDreamingGroundedShortTerm(agentId?: string) {
  return apiRequest<OpenClawDreamingActionResponse>('/openclaw/dreaming/grounded/clear', {
    method: 'POST',
    query: agentId ? { agentId } : undefined,
  })
}

export function getOpenClawCronStatus() {
  return apiRequest<OpenClawCronStatusResponse>('/openclaw/cron/status')
}

export function listOpenClawCronJobs(options: {
  agentId?: string
  enabled?: 'all' | 'disabled' | 'enabled'
  includeDisabled?: boolean
  limit?: number
  offset?: number
  query?: string
  sortBy?: 'name' | 'nextRunAtMs' | 'updatedAtMs'
  sortDir?: 'asc' | 'desc'
} = {}) {
  return apiRequest<OpenClawCronListResponse>('/openclaw/cron/jobs', {
    query: options,
  })
}

export function createOpenClawCronJob(body: OpenClawCronJobCreate) {
  return apiRequest<OpenClawCronJob>('/openclaw/cron/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateOpenClawCronJob(id: string, body: OpenClawCronJobPatch) {
  return apiRequest<OpenClawCronJob>(`/openclaw/cron/jobs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteOpenClawCronJob(id: string) {
  return apiRequest<{ ok: boolean, removed?: boolean }>(`/openclaw/cron/jobs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function runOpenClawCronJob(id: string, mode: 'due' | 'force' = 'force') {
  return apiRequest<OpenClawCronRunResponse>(`/openclaw/cron/jobs/${encodeURIComponent(id)}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  })
}

export function listOpenClawCronRuns(options: {
  deliveryStatus?: OpenClawCronDeliveryStatus
  id?: string
  limit?: number
  offset?: number
  query?: string
  sortDir?: 'asc' | 'desc'
  status?: 'all' | OpenClawCronRunStatus
} = {}) {
  return apiRequest<OpenClawCronRunsResponse>('/openclaw/cron/runs', {
    query: options,
  })
}

export function fetchOpenClawProviderModels(body: OpenClawFetchProviderModelsRequest) {
  return apiRequest<OpenClawFetchProviderModelsResponse>('/openclaw/models/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function testOpenClawProviderModel(body: OpenClawTestProviderModelRequest) {
  return apiRequest<OpenClawTestProviderModelResponse>('/openclaw/models/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * 列出当前 OpenClaw 配置中的智能体、路由绑定和隔离目录状态。
 */
export function listOpenClawAgents() {
  return apiRequest<OpenClawAgentsResponse>('/openclaw/agents')
}

/**
 * 读取指定 OpenClaw 智能体详情。
 */
export function getOpenClawAgent(id: string) {
  return apiRequest<OpenClawAgentDetailResponse>(`/openclaw/agents/${encodeURIComponent(id)}`)
}

export function createOpenClawAgent(body: OpenClawAgentMutationRequest) {
  return apiRequest<OpenClawAgentDetailResponse>('/openclaw/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateOpenClawAgent(id: string, body: OpenClawAgentMutationRequest) {
  return apiRequest<OpenClawAgentDetailResponse>(`/openclaw/agents/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteOpenClawAgent(id: string) {
  return apiRequest<OpenClawAgentDeleteResponse>(`/openclaw/agents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * 读取指定 OpenClaw 智能体 workspace 文件内容。
 */
export function getOpenClawAgentFile(id: string, name: string) {
  return apiRequest<OpenClawAgentFileResponse>(`/openclaw/agents/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`)
}

/**
 * 更新指定 OpenClaw 智能体 workspace 文件内容。
 */
export function updateOpenClawAgentFile(id: string, name: string, body: OpenClawAgentFileUpdateRequest) {
  return apiRequest<OpenClawAgentFileResponse>(`/openclaw/agents/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function getOpenClawAgentWorkspaceTree(id: string, options: OpenClawWorkspaceTreeOptions = {}) {
  return apiRequest<OpenClawWorkspaceTreeResponse>(`/openclaw/agents/${encodeURIComponent(id)}/workspace/tree`, {
    query: options,
  })
}

export function getOpenClawAgentWorkspaceFile(id: string, path: string, options: OpenClawWorkspaceFileOptions = {}) {
  return apiRequest<OpenClawWorkspaceFileResponse>(`/openclaw/agents/${encodeURIComponent(id)}/workspace/file`, {
    query: { path, ...options },
  })
}

export function createOpenClawAgentWorkspaceEntry(id: string, body: OpenClawWorkspaceCreateRequest) {
  return apiRequest<OpenClawWorkspaceMutationResponse>(`/openclaw/agents/${encodeURIComponent(id)}/workspace/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateOpenClawAgentWorkspaceFile(id: string, body: OpenClawWorkspaceUpdateRequest) {
  return apiRequest<OpenClawWorkspaceMutationResponse>(`/openclaw/agents/${encodeURIComponent(id)}/workspace/file`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteOpenClawAgentWorkspaceEntry(id: string, body: OpenClawWorkspaceDeleteRequest) {
  return apiRequest<OpenClawWorkspaceMutationResponse>(`/openclaw/agents/${encodeURIComponent(id)}/workspace/entries`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function moveOpenClawAgentWorkspaceEntry(id: string, body: OpenClawWorkspaceMoveRequest) {
  return apiRequest<OpenClawWorkspaceMutationResponse>(`/openclaw/agents/${encodeURIComponent(id)}/workspace/entries/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function getOpenClawAgentMemory(id: string) {
  return apiRequest<OpenClawAgentMemoryResponse>(`/openclaw/agents/${encodeURIComponent(id)}/memory`)
}

export function getOpenClawAgentMemoryFile(id: string, path: string) {
  return apiRequest<OpenClawAgentMemoryFileResponse>(`/openclaw/agents/${encodeURIComponent(id)}/memory/file?path=${encodeURIComponent(path)}`)
}

export function updateOpenClawAgentMemoryFile(id: string, path: string, body: OpenClawAgentMemoryFileUpdateRequest) {
  return apiRequest<OpenClawAgentMemoryFileResponse>(`/openclaw/agents/${encodeURIComponent(id)}/memory/file?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function searchOpenClawAgentMemory(id: string, body: OpenClawAgentMemorySearchRequest) {
  return apiRequest<OpenClawAgentMemorySearchResponse>(`/openclaw/agents/${encodeURIComponent(id)}/memory/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function indexOpenClawAgentMemory(id: string, body: OpenClawAgentMemoryIndexRequest = { force: false }) {
  return apiRequest<OpenClawAgentMemoryIndexResponse>(`/openclaw/agents/${encodeURIComponent(id)}/memory/index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * 列出当前主机 OpenClaw 配置备份。
 */
export function listOpenClawConfigBackups() {
  return apiRequest<OpenClawConfigBackupListResponse>('/openclaw/config/backups')
}

/**
 * 备份当前 OpenClaw 配置文件到 config-backups 目录。
 */
export function createOpenClawConfigBackup() {
  return apiRequest<OpenClawConfigBackupResponse>('/openclaw/config/backups', {
    method: 'POST',
  })
}

/**
 * 读取指定 OpenClaw 配置备份内容。
 */
export function getOpenClawConfigBackup(name: string) {
  return apiRequest<OpenClawConfigBackupDetailResponse>(`/openclaw/config/backups/${encodeURIComponent(name)}`)
}

/**
 * 用指定备份恢复当前 OpenClaw 配置文件。
 */
export function restoreOpenClawConfigBackup(name: string) {
  return apiRequest<OpenClawConfigBackupResponse>(`/openclaw/config/backups/${encodeURIComponent(name)}/restore`, {
    method: 'POST',
  })
}

/**
 * 删除指定 OpenClaw 配置备份。
 */
export function deleteOpenClawConfigBackup(name: string) {
  return apiRequest<OpenClawConfigBackupResponse>(`/openclaw/config/backups/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
}

export function getOpenClawSkillsStatus(agentId?: string) {
  return apiRequest<OpenClawSkillsStatusResponse>('/openclaw/skills/status', {
    query: agentId ? { agentId } : undefined,
  })
}

export function searchOpenClawSkills(query = '', limit = 20) {
  return apiRequest<OpenClawSkillsSearchResponse>('/openclaw/skills/search', {
    query: { query, limit },
  })
}

export function getOpenClawSkillsShowcaseHot(refresh = false) {
  return apiRequest<OpenClawSkillsShowcaseHotResponse>('/openclaw/skills/showcase/hot', {
    query: refresh ? { refresh: true } : undefined,
  })
}

export function getOpenClawSkillInfo(name: string, agentId?: string) {
  return apiRequest<OpenClawSkillStatus>(`/openclaw/skills/${encodeURIComponent(name)}`, {
    query: agentId ? { agentId } : undefined,
  })
}

export function installOpenClawSkill(request: OpenClawSkillInstallRequest) {
  return apiRequest<OpenClawSkillMutationResponse>('/openclaw/skills/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

export function installOpenClawSkillDependency(request: OpenClawSkillDependencyInstallRequest) {
  return apiRequest<OpenClawSkillMutationResponse>('/openclaw/skills/install-dependency', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

export function updateOpenClawSkill(skillKey: string, request: OpenClawSkillUpdateRequest) {
  return apiRequest<OpenClawSkillMutationResponse>(`/openclaw/skills/${encodeURIComponent(skillKey)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

export function getOpenClawPluginsStatus(enabled = false) {
  return apiRequest<OpenClawPluginStatusResponse>('/openclaw/plugins/status', {
    query: enabled ? { enabled: true } : undefined,
  })
}

export function searchOpenClawPlugins(query: string, limit = 20) {
  return apiRequest<OpenClawPluginsSearchResponse>('/openclaw/plugins/search', {
    query: { query, limit },
  })
}

export function getOpenClawPluginInfo(id: string) {
  return apiRequest<OpenClawPluginInspectResponse>(`/openclaw/plugins/${encodeURIComponent(id)}`)
}

export function getOpenClawPluginRuntimeInfo(id: string) {
  return apiRequest<OpenClawPluginInspectResponse>(`/openclaw/plugins/${encodeURIComponent(id)}/runtime`)
}

export function installOpenClawPlugin(request: OpenClawPluginInstallRequest) {
  return apiRequest<OpenClawPluginMutationResponse>('/openclaw/plugins/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

export function enableOpenClawPlugin(id: string) {
  return apiRequest<OpenClawPluginMutationResponse>(`/openclaw/plugins/${encodeURIComponent(id)}/enable`, {
    method: 'POST',
  })
}

export function disableOpenClawPlugin(id: string) {
  return apiRequest<OpenClawPluginMutationResponse>(`/openclaw/plugins/${encodeURIComponent(id)}/disable`, {
    method: 'POST',
  })
}

export function updateOpenClawPlugin(id: string) {
  return apiRequest<OpenClawPluginMutationResponse>(`/openclaw/plugins/${encodeURIComponent(id)}/update`, {
    method: 'POST',
  })
}

export function uninstallOpenClawPlugin(id: string, keepFiles = false) {
  return apiRequest<OpenClawPluginMutationResponse>(`/openclaw/plugins/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    query: keepFiles ? { keepFiles: true } : undefined,
  })
}

export function getOpenClawPluginsRegistry() {
  return apiRequest<OpenClawPluginRegistryResponse>('/openclaw/plugins/registry')
}

export function refreshOpenClawPluginsRegistry() {
  return apiRequest<OpenClawPluginRegistryResponse>('/openclaw/plugins/registry/refresh', {
    method: 'POST',
  })
}

export function getOpenClawPluginsDoctor() {
  return apiRequest<OpenClawPluginDoctorResponse>('/openclaw/plugins/doctor')
}

/**
 * 构造 OpenClaw 日志 SSE 流地址。
 *
 * 对应后端 `/openclaw/log` 接口，用于给 `EventSource` 消费日志流；支持指定日志类型、日志文件、首次扫描的尾部行数、是否持续跟随新增日志、文本过滤和日志等级过滤。
 */
export function getOpenClawLogStreamURL(options: OpenClawLogStreamOptions = {}) {
  const query: Record<string, boolean | number | string | undefined> = {
    kind: options.kind,
    file: options.file,
    tail: options.tail,
    follow: options.follow,
    filter: options.filter,
    levels: options.levels,
  }
  return buildAPIURL('/openclaw/log', query)
}
