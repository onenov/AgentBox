import { apiRequest, buildAPIURL } from './client'

export type HermesEnvironmentResponse = {
  status: string
  timestamp: string
  cache?: {
    refresh: boolean
  }
  profile?: HermesProfileSelection
  cli: HermesCLIInfo
  home: HermesHomeInfo
  config: HermesConfigInfo
  env: HermesEnvInfo
  gateway: HermesGatewayInfo
  checks: HermesCheck[]
  summary: string
}

export type HermesProfileSelection = {
  name: string
  path: string
  isDefault: boolean
  isActive: boolean
}

export type HermesTextFileResponse = {
  status: string
  timestamp: string
  path: string
  exists: boolean
  content: string
}

export type HermesGatewayActionResponse = {
  status: string
  timestamp: string
  action: 'restart' | 'stop' | string
  message: string
  stdout?: string
  stderr?: string
}

export type HermesUpdateStatusResponse = {
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

export type HermesUpdateActionResponse = {
  status: string
  timestamp: string
  message: string
  stdout?: string
  stderr?: string
}

export type HermesTaskStatus = 'pending' | 'running' | 'done' | 'error' | string

export type HermesTaskResponse = {
  id: string
  status: HermesTaskStatus
  progress: number
  logs: string[]
  startedAt: string
  updatedAt: string
  error?: string
}

export type HermesTaskStreamMeta = {
  id: string
  kind: string
  timestamp: string
}

export type HermesTaskStreamStatus = {
  id: string
  status: HermesTaskStatus
  progress: number
  error?: string
  timestamp: string
}

export type HermesTaskStreamLog = {
  id: string
  line: string
  timestamp: string
}

export type HermesTaskStreamError = {
  id: string
  message: string
  timestamp: string
}

export type HermesLogStreamMeta = {
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

export type HermesLogStreamLine = {
  line: string
  level?: string
  message?: string
  subsystem?: string
  time?: string
  timestamp: string
}

export type HermesLogStreamError = {
  message: string
  timestamp: string
}

export type HermesLogStreamOptions = {
  kind?: 'gateway' | 'gateway-run' | 'gateway-exit' | 'errors' | 'agent'
  file?: string
  tail?: number
  follow?: boolean
  filter?: string
  levels?: string
  profile?: string
}

export type HermesInstancesResponse = {
  status: string
  timestamp: string
  homePath: string
  gatewayStatePath: string
  processRegistryPath: string
  stateDbPath: string
  summary: {
    activeAgents: number
    runningProcesses: number
    totalProcesses: number
    recentSessions: number
  }
  active: {
    count: number
    gatewayState?: string
    updatedAt?: string
    source: string
  }
  processes: HermesRuntimeProcess[]
  sessions: HermesSessionInstance[]
  sourceNote: string
  errors?: string[]
}

export type HermesAgentsResponse = {
  status: string
  timestamp: string
  root: string
  profiles: HermesAgentInfo[]
  summary: HermesAgentsSummary
}

export type HermesAgentDetailResponse = {
  status: string
  timestamp: string
  profile: HermesAgentInfo
  files: HermesProfileFile[]
  memory: HermesProfileFile[]
}

export type HermesAgentMutationResponse = {
  status: string
  timestamp: string
  message: string
  name: string
  profile?: HermesAgentInfo
  stdout?: string
  stderr?: string
}

export type HermesAgentCreateRequest = {
  name: string
  cloneMode?: 'fresh' | 'clone' | 'clone-all'
  cloneFrom?: string
  noSkills?: boolean
}

export type HermesAgentRenameRequest = {
  newName: string
}

export type HermesAgentsSummary = {
  total: number
  active: number
  default: number
  running: number
  withEnv: number
  withSoul: number
  skillCount: number
  sessionCount: number
}

export type HermesAgentInfo = {
  name: string
  displayName: string
  path: string
  isDefault: boolean
  isActive: boolean
  exists: boolean
  gatewayRunning: boolean
  gateway: HermesGatewayInfo
  config: HermesProfileFile
  env: HermesProfileFile
  soul: HermesProfileFile
  memory: HermesProfileFile
  user: HermesProfileFile
  skillsDir: string
  sessionsDir: string
  logsDir: string
  workspaceDir: string
  homeDir: string
  memoryDir: string
  cronDir: string
  skillCount: number
  sessionCount: number
  logCount: number
  memoryFileCount: number
  cronJobCount: number
  model?: string
  provider?: string
  displayLanguage?: string
  displayPersonality?: string
  toolsets?: string[]
  apiServerEnabled: boolean
  setupCommand: string
  chatCommand: string
  distribution: HermesDistributionInfo
  noBundledSkills: boolean
}

export type HermesProfileFile = {
  key: 'config' | 'env' | 'soul' | string
  label: string
  path: string
  exists: boolean
  bytes?: number
}

export type HermesDistributionInfo = {
  name?: string
  version?: string
  source?: string
}

export type HermesSkillsResponse = {
  status: string
  timestamp: string
  cache?: {
    refresh: boolean
  }
  homePath: string
  skillsDir: string
  config: HermesSkillsConfig
  summary: HermesSkillsSummary
  categories: HermesSkillCategoryInfo[]
  skills: HermesSkillInfo[]
  errors?: string[]
}

export type HermesSkillsConfig = {
  path: string
  exists: boolean
  disabled: string[] | null
  externalDirs: string[] | null
  platformDisabled: string[] | null
  toolsets: string[] | null
  disabledToolsets: string[] | null
  skillToolsetEnabled: boolean
  templateVars: boolean
  inlineShell: boolean
  inlineShellTimeout?: string
  guardAgentCreated: boolean
  liveReloadHint: string
  error?: string
}

export type HermesSkillsSummary = {
  total: number
  enabled: number
  disabled: number
  bundled: number
  custom: number
  external: number
  categories: Record<string, number>
  sourceCounts: Record<string, number>
  supportingFileCount: number
}

export type HermesSkillCategoryInfo = {
  name: string
  description?: string
  path?: string
}

export type HermesSkillInfo = {
  name: string
  description?: string
  category?: string
  path: string
  skillDir: string
  relativePath: string
  root: string
  source: string
  enabled: boolean
  disabled: boolean
  bundled: boolean
  toolsetEnabled: boolean
  platforms?: string[] | null
  tags?: string[] | null
  relatedSkills?: string[] | null
  configKeys?: string[] | null
  prerequisiteCommands?: string[] | null
  supportingFiles: HermesSkillSupportGroup[] | null
}

export type HermesSkillSupportGroup = {
  name: string
  count: number
  files: string[] | null
}

export type HermesSkillMutationResponse = {
  status: string
  timestamp: string
  skill: HermesSkillInfo
  message: string
}

export type HermesSkillDetailResponse = {
  status: string
  timestamp: string
  skill: HermesSkillInfo
  content: string
}

export type HermesSkillHubResult = {
  identifier: string
  name: string
  description?: string
  source?: string
  trustLevel?: string
  repo?: string
  path?: string
  tags?: string[] | null
  extra?: Record<string, unknown>
}

export type HermesSkillsSearchResponse = {
  status: string
  timestamp: string
  query: string
  source: string
  results: HermesSkillHubResult[]
}

export type HermesSkillsDiscoverResponse = {
  status: string
  timestamp: string
  cache?: {
    refresh: boolean
  }
  source: string
  skills: HermesSkillHubResult[]
}

export type HermesSkillInstallRequest = {
  identifier: string
  category?: string
  name?: string
  force?: boolean
  source?: string
}

export type HermesSkillInstallResponse = {
  status: string
  timestamp: string
  identifier: string
  skillName?: string
  message: string
  stdout?: string
  stderr?: string
  skill?: HermesSkillInfo
}

export type HermesModelApiMode = 'anthropic_messages' | 'bedrock_converse' | 'chat_completions' | 'codex_responses'
export type HermesImageInputMode = 'auto' | 'native' | 'text'

export type HermesAgentModelSettings = {
  imageInputMode?: HermesImageInputMode | string
}

export type HermesAuxiliaryVisionConfig = {
  apiKey?: string
  apiMode?: HermesModelApiMode | string
  baseUrl?: string
  downloadTimeout?: number
  extraBody?: Record<string, unknown>
  model?: string
  provider?: string
  timeout?: number
}

export type HermesModelConfig = {
  apiKey?: string
  apiMode?: HermesModelApiMode | string
  baseUrl?: string
  default?: string
  provider?: string
}

export type HermesModelDefinition = {
  contextLength?: number
  contextWindow?: number
  extra?: Record<string, unknown>
  id: string
  input?: string[]
  maxTokens?: number
  name?: string
  raw?: Record<string, unknown>
  reasoning?: boolean
}

export type HermesModelProvider = {
  apiKey?: string
  apiMode?: HermesModelApiMode | string
  baseUrl?: string
  defaultModel?: string
  extra?: Record<string, unknown>
  key?: string
  keyEnv?: string
  model?: string
  models?: HermesModelDefinition[]
  name?: string
  raw?: Record<string, unknown>
  requestTimeoutSeconds?: number
  staleTimeoutSeconds?: number
}

export type HermesFallbackProvider = {
  apiKey?: string
  apiMode?: HermesModelApiMode | string
  baseUrl?: string
  model?: string
  provider?: string
}

export type HermesModelsResponse = {
  agent: HermesAgentModelSettings
  auxiliaryVision: HermesAuxiliaryVisionConfig
  credentialPoolStrategies?: Record<string, unknown>
  customProviders?: Record<string, unknown>[]
  exists: boolean
  fallbackProviders: HermesFallbackProvider[]
  model: HermesModelConfig
  path: string
  providers: Record<string, HermesModelProvider>
  raw?: Record<string, unknown>
  status: string
  timestamp: string
}

export type HermesModelsUpdateRequest = {
  agent: HermesAgentModelSettings
  auxiliaryVision: HermesAuxiliaryVisionConfig
  credentialPoolStrategies?: Record<string, unknown>
  fallbackProviders: HermesFallbackProvider[]
  model: HermesModelConfig
  providers: Record<string, HermesModelProvider>
}

export type HermesFetchProviderModelsRequest = {
  apiKey?: string
  apiMode?: HermesModelApiMode | string
  baseUrl: string
  contextLength?: number
  maxTokens?: number
}

export type HermesFetchProviderModelsResponse = {
  models: HermesModelDefinition[]
  sourceUrl: string
  status: string
  timestamp: string
}

export type HermesTestProviderModelRequest = {
  apiKey?: string
  apiMode?: HermesModelApiMode | string
  baseUrl: string
  model: string
}

export type HermesTestProviderModelResponse = {
  durationMs: number
  message: string
  ok: boolean
  status: string
  statusCode?: number
  timestamp: string
}

export type HermesPlatformsResponse = {
  status: string
  timestamp: string
  profile: HermesProfileSelection
  config: HermesPlatformFileInfo
  env: HermesPlatformFileInfo
  summary: HermesPlatformsSummary
  platforms: HermesPlatformInfo[]
}

export type HermesPlatformFileInfo = {
  path: string
  exists: boolean
}

export type HermesPlatformsSummary = {
  total: number
  enabled: number
  configured: number
  connected: number
}

export type HermesPlatformInfo = {
  name: string
  label: string
  category: 'common' | 'core' | 'more' | 'plugin' | string
  icon: string
  enabled: boolean
  configured: boolean
  connected: boolean
  runtimeState?: string
  runtimeError?: string
  updatedAt?: string
  requiredEnv: HermesPlatformEnvKey[]
  homeChannel?: string
  homeChannelKey?: string
  replyToMode?: 'all' | 'first' | 'off' | string
  gatewayRestartNotification: boolean
  requireMention?: boolean | null
  freeResponse?: string
  allowed?: string
  unauthorizedDmBehavior?: 'ignore' | 'pair' | string
  noticeDelivery?: 'private' | 'public' | string
  plugin: boolean
  configKeys: {
    freeResponse?: string
    allowed?: string
  }
}

export type HermesPlatformEnvKey = {
  key: string
  present: boolean
  source?: string
}

export type HermesPlatformUpdateRequest = {
  enabled?: boolean
  requireMention?: boolean
  freeResponse?: string
  allowed?: string
  replyToMode?: 'all' | 'first' | 'off' | string
  gatewayRestartNotification?: boolean
  unauthorizedDmBehavior?: 'ignore' | 'pair' | string
  noticeDelivery?: 'private' | 'public' | string
  env?: Record<string, string>
}

export type HermesPairingRequest = {
  id: string
  code: string
  createdAt: string
  lastSeenAt?: string
  meta?: Record<string, unknown>
}

export type HermesPairingListResponse = {
  status: string
  timestamp: string
  profile: HermesProfileSelection
  platform: string
  requests: HermesPairingRequest[]
}

export type HermesPairingApproveRequest = {
  code: string
}

export type HermesPairingApproveResponse = {
  status: string
  timestamp: string
  profile: HermesProfileSelection
  approved: boolean
  platform: string
  code: string
  message?: string
  rawOutput?: string
}

export type HermesPluginsResponse = {
  status: string
  timestamp: string
  cache?: {
    refresh: boolean
  }
  homePath: string
  pluginsDir: string
  config: HermesPluginsConfig
  summary: HermesPluginsSummary
  plugins: HermesPluginInfo[]
  errors?: string[]
}

export type HermesPluginsConfig = {
  path: string
  exists: boolean
  enabled: string[] | null
  disabled: string[] | null
  error?: string
}

export type HermesPluginsSummary = {
  total: number
  enabled: number
  disabled: number
  bundled: number
  user: number
  project: number
  dashboard: number
  sources: Record<string, number>
  kinds: Record<string, number>
}

export type HermesPluginInfo = {
  key: string
  name: string
  dirName: string
  displayName?: string
  version?: string
  description?: string
  author?: string
  kind: string
  source: string
  path: string
  manifestPath: string
  enabled: boolean
  loadMode: string
  statusLabel: string
  explicitlyEnabled: boolean
  explicitlyDisabled: boolean
  bundled: boolean
  git: boolean
  requiresEnv?: string[] | null
  providesTools?: string[] | null
  providesHooks?: string[] | null
  dashboard?: HermesDashboardInfo
  files: HermesPluginFile[]
  error?: string
}

export type HermesDashboardInfo = {
  manifestPath: string
  name?: string
  label?: string
  description?: string
  bundle?: string
  css?: string
  api?: string
  tabPath?: string
  tabIcon?: string
  tabHidden: boolean
  slots?: string[] | null
}

export type HermesPluginFile = {
  kind: string
  path: string
  exists: boolean
}

export type HermesPluginInstallRequest = {
  identifier: string
  force?: boolean
  enable?: boolean
}

export type HermesPluginMutationResponse = {
  status: string
  timestamp: string
  plugin?: string
  message: string
  stdout?: string
  stderr?: string
}

export type HermesPluginDetailResponse = {
  status: string
  timestamp: string
  plugin: HermesPluginInfo
  manifest?: string
  readme?: string
  afterInstall?: string
  dashboardManifest?: string
  init?: string
}

export type HermesRuntimeProcess = {
  sessionId: string
  command: string
  pid?: number
  pidScope?: string
  cwd?: string
  startedAt?: string
  uptimeSeconds?: number
  status: string
  taskId?: string
  sessionKey?: string
  watcherPlatform?: string
  watcherThreadId?: string
  watcherInterval?: number
  notifyOnComplete: boolean
  watchPatterns?: string[]
  process?: HermesProcessInfo
}

export type HermesSessionInstance = {
  id: string
  source?: string
  platform?: string
  userId?: string
  model?: string
  title?: string
  startedAt?: string
  endedAt?: string
  endReason?: string
  lastActiveAt?: string
  messageCount: number
  toolCallCount: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  estimatedCostUsd?: number
  actualCostUsd?: number
  costStatus?: string
  handoffState?: string
  handoffPlatform?: string
  handoffError?: string
}

export type HermesProfileSummary = {
  name: string
  displayName: string
  path: string
  isDefault: boolean
  isActive: boolean
  stateDbPath: string
}

export type HermesManagedSession = HermesSessionInstance & {
  profile: string
  profileDisplayName: string
  profilePath: string
  stateDbPath: string
  parentSessionId?: string
  preview?: string
  matchSnippet?: string
  matchedMessageCount: number
  isActive: boolean
  activeProcessIds?: string[]
  totalTokens: number
  costUsd?: number
}

export type HermesSessionsSummary = {
  totalMatched: number
  returned: number
  profiles: number
  active: number
  ended: number
  totalMessages: number
  totalToolCalls: number
  totalTokens: number
  totalCostUsd: number
}

export type HermesSessionsResponse = {
  status: string
  timestamp: string
  profiles: HermesProfileSummary[]
  summary: HermesSessionsSummary
  sessions: HermesManagedSession[]
  limit: number
  offset: number
  hasMore: boolean
  errors?: string[]
}

export type HermesSessionMessage = {
  id: number
  sessionId: string
  role: string
  content?: unknown
  text?: string
  toolCallId?: string
  toolCalls?: unknown
  toolName?: string
  timestamp?: string
  tokenCount?: number
  finishReason?: string
  reasoning?: string
  reasoningContent?: string
}

export type HermesSessionDetailResponse = {
  status: string
  timestamp: string
  profile: HermesProfileSummary
  session: HermesManagedSession
  messages: HermesSessionMessage[]
  errors?: string[]
}

export type HermesSessionEndResponse = {
  status: string
  timestamp: string
  profile: HermesProfileSummary
  session: HermesManagedSession
  terminatedProcesses: number
}

export type HermesSessionsBulkDeleteResponse = {
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
    profile: string
    id: string
    status: 'deleted' | 'skipped' | 'missing' | 'error' | string
    message?: string
  }>
}

export type HermesMessageRoleCounts = {
  user: number
  assistant: number
  tool: number
  other: number
}

export type HermesMessageStatsRange = {
  hours: number
  bucket: string
  preset: string
  start: string
  end: string
  timezone: string
}

export type HermesMessageStatsPlatform = {
  platform: string
  total: number
  roles: HermesMessageRoleCounts
}

export type HermesMessageStatsBucket = {
  time: string
  label: string
  total: number
  roles: HermesMessageRoleCounts
}

export type HermesMessageStatsResponse = {
  status: string
  timestamp: string
  profile: HermesProfileSelection
  home: string
  range: HermesMessageStatsRange
  total: number
  roles: HermesMessageRoleCounts
  platforms: HermesMessageStatsPlatform[]
  buckets: HermesMessageStatsBucket[]
  scanned: {
    files: number
    errors?: string[]
  }
}

export type HermesRecentMessage = {
  id: string
  sessionId: string
  sessionKey?: string
  platform?: string
  chatId?: string
  chatName?: string
  chatType?: string
  sender?: string
  senderId?: string
  role: string
  content: string
  timestamp: string
  displayTime?: string
}

export type HermesRecentMessagesResponse = {
  status: string
  timestamp: string
  profile: HermesProfileSelection
  home: string
  limit: number
  messages: HermesRecentMessage[]
  scanned: {
    files: number
    errors?: string[]
  }
}

export type HermesTerminalStatus = 'exited' | 'running' | 'stopping' | string

export type HermesTerminalCommand = 'chat' | 'chat-tui' | 'continue' | 'setup'

export type HermesTerminalSession = {
  id: string
  status: HermesTerminalStatus
  profile: HermesProfileSelection
  command: string
  kind: HermesTerminalCommand | string
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

export type HermesTerminalSummary = {
  total: number
  running: number
  exited: number
}

export type HermesTerminalsResponse = {
  status: string
  timestamp: string
  sessions: HermesTerminalSession[]
  summary: HermesTerminalSummary
}

export type HermesTerminalCreateRequest = {
  profile?: string
  command?: HermesTerminalCommand
  resumeSessionId?: string
  cwd?: string
  cols?: number
  rows?: number
}

export type HermesCLIInfo = {
  available: boolean
  path?: string
  version?: string
  project?: string
  python?: string
  openaiSdk?: string
  updateSummary?: string
  source?: string
  error?: string
}

export type HermesHomeInfo = {
  path: string
  envOverride?: string
  exists: boolean
  configPath: string
  configExists: boolean
  envPath: string
  envExists: boolean
  logsDir: string
  logsDirExists: boolean
  sessionsDir: string
  sessionsDirExists: boolean
  skillsDir: string
  skillsDirExists: boolean
  pluginsDir: string
  pluginsDirExists: boolean
  cronDir: string
  cronDirExists: boolean
  stateDbPath: string
  stateDbExists: boolean
  stateDbBytes?: number
  gatewayPidPath: string
  gatewayPidExists: boolean
  gatewayStatePath: string
  gatewayStateExists: boolean
}

export type HermesConfigInfo = {
  path: string
  exists: boolean
  readable: boolean
  parsed: boolean
  error?: string
  topKeys?: string[]
  modelDefault?: string
  modelProvider?: string
  terminalBackend?: string
  terminalCwd?: string
  terminalTimeout?: string
  displayLanguage?: string
  displayPersonality?: string
  dashboardTheme?: string
  toolsets?: string[]
  apiServerEnabled: boolean
}

export type HermesEnvInfo = {
  path: string
  exists: boolean
  keyCount: number
  error?: string
}

export type HermesGatewayInfo = {
  running: boolean
  pid?: number
  kind?: string
  manager?: string
  state?: string
  updatedAt?: string
  activeAgents: number
  restartRequested: boolean
  exitReason?: string
  argv?: string[]
  listenPorts?: number[]
  urls?: string[]
  platforms?: HermesGatewayPlatform[]
  process?: HermesProcessInfo
  pidFileError?: string
  stateFileError?: string
}

export type HermesGatewayPlatform = {
  name: string
  state?: string
  errorCode?: string
  errorMessage?: string
  updatedAt?: string
}

export type HermesProcessInfo = {
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

export type HermesCheck = {
  name: string
  ok: boolean
  message: string
  durationMs: number
}

export type HermesCronSchedule =
  | { display?: string; kind: 'once'; run_at?: string }
  | { display?: string; kind: 'interval'; minutes: number }
  | { display?: string; expr: string; kind: 'cron' }

export type HermesCronRepeat = {
  completed?: number
  times?: number | null
}

export type HermesCronJob = {
  id: string
  name: string
  prompt?: string
  promptPreview?: string
  skills?: string[]
  skill?: string | null
  model?: string | null
  provider?: string | null
  base_url?: string | null
  script?: string | null
  no_agent?: boolean
  context_from?: string[] | string | null
  enabled_toolsets?: string[] | null
  workdir?: string | null
  schedule: HermesCronSchedule | Record<string, unknown>
  schedule_display?: string
  scheduleDisplay?: string
  repeat?: HermesCronRepeat
  repeatLabel?: string
  enabled?: boolean
  state?: string
  paused_at?: string | null
  paused_reason?: string | null
  created_at?: string
  next_run_at?: string | null
  last_run_at?: string | null
  last_status?: 'ok' | 'error' | string | null
  last_error?: string | null
  last_delivery_error?: string | null
  deliver?: string
  origin?: Record<string, unknown> | null
}

export type HermesCronStatusResponse = {
  status: string
  timestamp: string
  enabled: boolean
  gatewayRunning: boolean
  jobs: number
  enabledJobs: number
  pausedJobs: number
  nextRunAt?: string | null
  cronDir: string
  jobsPath: string
  outputDir: string
  jobsPathExists: boolean
  outputDirExists: boolean
}

export type HermesCronListResponse = {
  jobs: HermesCronJob[]
  hasMore: boolean
  limit: number
  nextOffset: null | number
  offset: number
  total: number
}

export type HermesCronRunEntry = {
  jobId: string
  jobName?: string
  file: string
  path: string
  ts: string
  status?: 'ok' | 'error' | string
  summary?: string
  content?: string
  size?: number
}

export type HermesCronRunsResponse = {
  entries: HermesCronRunEntry[]
  hasMore: boolean
  limit: number
  nextOffset: null | number
  offset: number
  total: number
}

export type HermesCronJobCreate = {
  name?: string
  prompt?: string
  schedule: string
  repeat?: number | null
  deliver?: string
  skills?: string[]
  model?: string
  provider?: string
  baseUrl?: string
  script?: string
  contextFrom?: string[]
  enabledToolsets?: string[]
  workdir?: string
  noAgent?: boolean
}

export type HermesCronJobPatch = Partial<HermesCronJobCreate> & {
  enabled?: boolean
}

export type HermesCronRunResponse = {
  success?: boolean
  ok?: boolean
  enqueued?: boolean
  job_id?: string
  message?: string
  removed?: boolean
  removed_job?: {
    id: string
    name?: string
    schedule?: string
  }
  job?: HermesCronJob
}

export type HermesKanbanStatus = 'archived' | 'blocked' | 'done' | 'ready' | 'running' | 'todo' | 'triage'

export type HermesKanbanBoardMeta = {
  slug: string
  name: string
  description?: string
  icon?: string
  color?: string
  created_at?: number | null
  archived?: boolean
  db_path?: string
  is_current?: boolean
  isCurrent?: boolean
  counts?: Partial<Record<HermesKanbanStatus, number>>
  total?: number
}

export type HermesKanbanTask = {
  id: string
  title: string
  body?: string | null
  assignee?: string | null
  status: HermesKanbanStatus
  priority: number
  created_by?: string | null
  created_at?: number
  createdAt?: number
  started_at?: number | null
  startedAt?: number | null
  completed_at?: number | null
  completedAt?: number | null
  workspace_kind?: string
  workspaceKind?: string
  workspace_path?: string | null
  workspacePath?: string | null
  tenant?: string | null
  result?: string | null
  consecutive_failures?: number
  consecutiveFailures?: number
  worker_pid?: number | null
  workerPid?: number | null
  last_failure_error?: string | null
  lastFailureError?: string | null
  max_runtime_seconds?: number | null
  maxRuntimeSeconds?: number | null
  last_heartbeat_at?: number | null
  lastHeartbeatAt?: number | null
  current_run_id?: number | null
  currentRunId?: number | null
  skills?: string[] | null
  max_retries?: number | null
  maxRetries?: number | null
  latest_summary?: string | null
  latestSummary?: string | null
  comment_count?: number
  commentCount?: number
  link_counts?: { children: number; parents: number }
  linkCounts?: { children: number; parents: number }
  progress?: { done: number; total: number } | null
  age?: Record<string, number | null>
}

export type HermesKanbanColumn = {
  name: HermesKanbanStatus
  tasks: HermesKanbanTask[]
}

export type HermesKanbanBoardResponse = {
  status: string
  timestamp: string
  board: string
  columns: HermesKanbanColumn[]
  tenants: string[]
  assignees: string[]
  latest_event_id?: number
  latestEventId?: number
  now: number
  stats?: {
    by_status?: Partial<Record<HermesKanbanStatus, number>>
    by_assignee?: Record<string, Partial<Record<HermesKanbanStatus, number>>>
    oldest_ready_age_seconds?: number | null
    now?: number
  }
}

export type HermesKanbanBoardsResponse = {
  status: string
  timestamp: string
  boards: HermesKanbanBoardMeta[]
  current?: string
}

export type HermesKanbanComment = {
  id: number
  task_id?: string
  taskId?: string
  author: string
  body: string
  created_at?: number
  createdAt?: number
}

export type HermesKanbanEvent = {
  id: number
  task_id?: string
  taskId?: string
  kind: string
  payload?: Record<string, unknown> | null
  created_at?: number
  createdAt?: number
  run_id?: number | null
  runId?: number | null
}

export type HermesKanbanRun = {
  id: number
  task_id?: string
  taskId?: string
  profile?: string | null
  status: string
  started_at?: number
  startedAt?: number
  ended_at?: number | null
  endedAt?: number | null
  outcome?: string | null
  summary?: string | null
  metadata?: Record<string, unknown> | null
  error?: string | null
}

export type HermesKanbanTaskDetailResponse = {
  status: string
  timestamp: string
  task: HermesKanbanTask
  comments: HermesKanbanComment[]
  events: HermesKanbanEvent[]
  links: { children: string[]; parents: string[] }
  runs: HermesKanbanRun[]
}

export type HermesKanbanTaskMutationResponse = {
  status: string
  timestamp: string
  task?: HermesKanbanTask | null
  ok?: boolean
}

export type HermesKanbanTaskCreate = {
  title: string
  body?: string
  assignee?: string
  tenant?: string
  priority?: number
  workspaceKind?: 'dir' | 'scratch' | 'worktree' | string
  workspacePath?: string
  parents?: string[]
  triage?: boolean
  maxRuntimeSeconds?: number
  maxRetries?: number
  skills?: string[]
}

export type HermesKanbanTaskPatch = {
  status?: HermesKanbanStatus
  assignee?: string | null
  priority?: number
  title?: string
  body?: string | null
  result?: string
  summary?: string
  blockReason?: string
  metadata?: Record<string, unknown>
}

export type HermesKanbanDispatchResponse = {
  status: string
  timestamp: string
  reclaimed: number
  crashed: string[]
  timed_out?: string[]
  timedOut?: string[]
  auto_blocked?: string[]
  autoBlocked?: string[]
  promoted: number
  spawned: Array<{ assignee?: string | null; task_id?: string; taskId?: string; workspace?: string | null }>
  skipped_unassigned?: string[]
  skippedUnassigned?: string[]
  skipped_nonspawnable?: string[]
  skippedNonspawnable?: string[]
}

function withHermesProfileQuery(profile?: string, extra?: Record<string, boolean | number | string | undefined>) {
  return {
    ...extra,
    profile: profile?.trim() || undefined,
  }
}

export function getHermesEnvironment(refresh = false, profile?: string) {
  return apiRequest<HermesEnvironmentResponse>('/hermes/environment', {
    query: withHermesProfileQuery(profile, refresh ? { refresh: true } : undefined),
  })
}

export function getHermesInstances(limit = 50, profile?: string) {
  return apiRequest<HermesInstancesResponse>('/hermes/instances', {
    query: withHermesProfileQuery(profile, { limit }),
  })
}

export function listHermesTerminals(profile?: string) {
  return apiRequest<HermesTerminalsResponse>('/hermes/terminals', {
    query: withHermesProfileQuery(profile),
  })
}

export function createHermesTerminal(body: HermesTerminalCreateRequest) {
  return apiRequest<HermesTerminalSession>('/hermes/terminals', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

export function getHermesTerminal(id: string) {
  return apiRequest<HermesTerminalSession>(`/hermes/terminals/${encodeURIComponent(id)}`)
}

export function stopHermesTerminal(id: string) {
  return apiRequest<HermesTerminalSession>(`/hermes/terminals/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function deleteHermesTerminalRecord(id: string) {
  return apiRequest<HermesTerminalSession>(`/hermes/terminals/${encodeURIComponent(id)}/record`, {
    method: 'DELETE',
  })
}

export function getHermesTerminalWebSocketURL(id: string) {
  return buildAPIURL('/hermes/terminal/ws', { id })
}

export function listHermesSessions(options: {
  includeChildren?: boolean
  limit?: number
  offset?: number
  profile?: string
  query?: string
  sortBy?: 'lastActive' | 'startedAt' | 'messages' | 'cost' | 'tokens' | string
  sortDir?: 'asc' | 'desc' | string
  source?: string
  status?: 'all' | 'active' | 'ended' | string
} = {}) {
  return apiRequest<HermesSessionsResponse>('/hermes/sessions', {
    query: {
      includeChildren: options.includeChildren ? true : undefined,
      limit: options.limit,
      offset: options.offset,
      profile: options.profile?.trim() || undefined,
      query: options.query?.trim() || undefined,
      sortBy: options.sortBy,
      sortDir: options.sortDir,
      source: options.source?.trim() || undefined,
      status: options.status,
    },
  })
}

export function getHermesSession(profile: string, id: string) {
  return apiRequest<HermesSessionDetailResponse>(`/hermes/sessions/${encodeURIComponent(profile)}/${encodeURIComponent(id)}`)
}

export function endHermesSession(profile: string, id: string, reason = 'manual_close') {
  return apiRequest<HermesSessionEndResponse>(`/hermes/sessions/${encodeURIComponent(profile)}/${encodeURIComponent(id)}/end`, {
    body: JSON.stringify({ reason }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

export function deleteHermesSessions(sessions: Array<{ id: string; profile: string }>) {
  return apiRequest<HermesSessionsBulkDeleteResponse>('/hermes/sessions/bulk-delete', {
    body: JSON.stringify({ sessions }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

export function getHermesMessageStats(options: {
  hours?: number
  profile?: string
  range?: 'hour' | 'week' | 'month' | 'all' | string
} = {}) {
  return apiRequest<HermesMessageStatsResponse>('/hermes/messages/stats', {
    query: {
      hours: options.hours,
      profile: options.profile?.trim() || undefined,
      range: options.range,
    },
  })
}

export function getHermesRecentMessages(options: {
  limit?: number
  profile?: string
} = {}) {
  return apiRequest<HermesRecentMessagesResponse>('/hermes/messages/recent', {
    query: {
      limit: options.limit,
      profile: options.profile?.trim() || undefined,
    },
  })
}

export function listHermesAgents() {
  return apiRequest<HermesAgentsResponse>('/hermes/agents')
}

export function getHermesAgent(name: string) {
  return apiRequest<HermesAgentDetailResponse>(`/hermes/agents/${encodeURIComponent(name)}`)
}

export function createHermesAgent(request: HermesAgentCreateRequest) {
  return apiRequest<HermesAgentMutationResponse>('/hermes/agents', {
    body: JSON.stringify(request),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

export function renameHermesAgent(name: string, request: HermesAgentRenameRequest) {
  return apiRequest<HermesAgentMutationResponse>(`/hermes/agents/${encodeURIComponent(name)}`, {
    body: JSON.stringify(request),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
  })
}

export function deleteHermesAgent(name: string) {
  return apiRequest<HermesAgentMutationResponse>(`/hermes/agents/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
}

export function useHermesAgent(name: string) {
  return apiRequest<HermesAgentMutationResponse>(`/hermes/agents/${encodeURIComponent(name)}/use`, {
    method: 'POST',
  })
}

export function getHermesAgentFile(name: string, file: 'config' | 'env' | 'soul' | 'memory' | 'user' | string) {
  return apiRequest<HermesTextFileResponse>(`/hermes/agents/${encodeURIComponent(name)}/files/${encodeURIComponent(file)}`)
}

export function updateHermesAgentFile(name: string, file: 'config' | 'env' | 'soul' | 'memory' | 'user' | string, content: string) {
  return apiRequest<HermesTextFileResponse>(`/hermes/agents/${encodeURIComponent(name)}/files/${encodeURIComponent(file)}`, {
    body: JSON.stringify({ content }),
    headers: { 'Content-Type': 'application/json' },
    method: 'PUT',
  })
}

export function getHermesSkills(refresh = false, profile?: string) {
  return apiRequest<HermesSkillsResponse>('/hermes/skills', {
    query: withHermesProfileQuery(profile, refresh ? { refresh: true } : undefined),
  })
}

export function reloadHermesSkills(profile?: string) {
  return apiRequest<HermesSkillsResponse>('/hermes/skills/reload', {
    method: 'POST',
    query: withHermesProfileQuery(profile),
  })
}

export function searchHermesSkills(query = '', limit = 20, source = 'all') {
  return apiRequest<HermesSkillsSearchResponse>('/hermes/skills/search', {
    query: { query, limit, source },
  })
}

export function discoverHermesSkills(refresh = false, limit = 24, source = 'skillhub') {
  return apiRequest<HermesSkillsDiscoverResponse>('/hermes/skills/discover', {
    query: { limit, source, refresh: refresh ? true : undefined },
  })
}

export function installHermesSkill(request: HermesSkillInstallRequest, profile?: string) {
  return apiRequest<HermesSkillInstallResponse>('/hermes/skills/install', {
    body: JSON.stringify(request),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    query: withHermesProfileQuery(profile),
  })
}

export function getHermesSkill(name: string, profile?: string) {
  return apiRequest<HermesSkillDetailResponse>(`/hermes/skills/${encodeURIComponent(name)}`, {
    query: withHermesProfileQuery(profile),
  })
}

export function updateHermesSkill(name: string, enabled: boolean, profile?: string) {
  return apiRequest<HermesSkillMutationResponse>(`/hermes/skills/${encodeURIComponent(name)}`, {
    body: JSON.stringify({ enabled }),
    headers: { 'Content-Type': 'application/json' },
    method: 'PUT',
    query: withHermesProfileQuery(profile),
  })
}

export function getHermesModels(profile?: string) {
  return apiRequest<HermesModelsResponse>('/hermes/models', {
    query: withHermesProfileQuery(profile),
  })
}

export function updateHermesModels(body: HermesModelsUpdateRequest, profile?: string) {
  return apiRequest<HermesModelsResponse>('/hermes/models', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'PUT',
    query: withHermesProfileQuery(profile),
  })
}

export function fetchHermesProviderModels(body: HermesFetchProviderModelsRequest) {
  return apiRequest<HermesFetchProviderModelsResponse>('/hermes/models/fetch', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

export function testHermesProviderModel(body: HermesTestProviderModelRequest) {
  return apiRequest<HermesTestProviderModelResponse>('/hermes/models/test', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

export function getHermesPlatforms(refresh = false, profile?: string) {
  return apiRequest<HermesPlatformsResponse>('/hermes/platforms', {
    query: withHermesProfileQuery(profile, refresh ? { refresh: true } : undefined),
  })
}

export function updateHermesPlatform(name: string, body: HermesPlatformUpdateRequest, profile?: string) {
  return apiRequest<HermesPlatformsResponse>(`/hermes/platforms/${encodeURIComponent(name)}`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
    query: withHermesProfileQuery(profile),
  })
}

export function listHermesPairingRequests(platform: string, profile?: string) {
  return apiRequest<HermesPairingListResponse>(`/hermes/pairing/${encodeURIComponent(platform)}`, {
    query: withHermesProfileQuery(profile),
  })
}

export function approveHermesPairingRequest(platform: string, body: HermesPairingApproveRequest, profile?: string) {
  return apiRequest<HermesPairingApproveResponse>(`/hermes/pairing/${encodeURIComponent(platform)}/approve`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    query: withHermesProfileQuery(profile),
  })
}

export function getHermesPlugins(refresh = false, profile?: string) {
  return apiRequest<HermesPluginsResponse>('/hermes/plugins', {
    query: withHermesProfileQuery(profile, refresh ? { refresh: true } : undefined),
  })
}

export function installHermesPlugin(request: HermesPluginInstallRequest, profile?: string) {
  return apiRequest<HermesPluginMutationResponse>('/hermes/plugins/install', {
    body: JSON.stringify(request),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    query: withHermesProfileQuery(profile),
  })
}

export function getHermesPlugin(name: string, profile?: string) {
  return apiRequest<HermesPluginDetailResponse>(`/hermes/plugins/${encodeURIComponent(name)}`, {
    query: withHermesProfileQuery(profile),
  })
}

export function enableHermesPlugin(name: string, profile?: string) {
  return apiRequest<HermesPluginMutationResponse>(`/hermes/plugins/${encodeURIComponent(name)}/enable`, {
    method: 'POST',
    query: withHermesProfileQuery(profile),
  })
}

export function disableHermesPlugin(name: string, profile?: string) {
  return apiRequest<HermesPluginMutationResponse>(`/hermes/plugins/${encodeURIComponent(name)}/disable`, {
    method: 'POST',
    query: withHermesProfileQuery(profile),
  })
}

export function updateHermesPlugin(name: string, profile?: string) {
  return apiRequest<HermesPluginMutationResponse>(`/hermes/plugins/${encodeURIComponent(name)}/update`, {
    method: 'POST',
    query: withHermesProfileQuery(profile),
  })
}

export function uninstallHermesPlugin(name: string, profile?: string) {
  return apiRequest<HermesPluginMutationResponse>(`/hermes/plugins/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    query: withHermesProfileQuery(profile),
  })
}

export function getHermesLogStreamURL(options: HermesLogStreamOptions = {}) {
  const query: Record<string, boolean | number | string | undefined> = {
    kind: options.kind,
    file: options.file,
    tail: options.tail,
    follow: options.follow,
    filter: options.filter,
    levels: options.levels,
    profile: options.profile,
  }
  return buildAPIURL('/hermes/log', query)
}

export function getHermesPlatformQRSetupStreamURL(name: string, profile?: string) {
  return buildAPIURL(`/hermes/platforms/${encodeURIComponent(name)}/qr-setup`, withHermesProfileQuery(profile))
}

export function getHermesInstallStreamURL() {
  return buildAPIURL('/hermes/install')
}

export function getHermesDoctorStreamURL(profile?: string) {
  return buildAPIURL('/hermes/doctor', withHermesProfileQuery(profile))
}

export function getHermesUninstallStreamURL() {
  return buildAPIURL('/hermes/uninstall')
}

export function restartHermesGateway(profile?: string) {
  return apiRequest<HermesGatewayActionResponse>('/hermes/gateway/restart', {
    method: 'POST',
    query: withHermesProfileQuery(profile),
  })
}

export function stopHermesGateway(profile?: string) {
  return apiRequest<HermesGatewayActionResponse>('/hermes/gateway/stop', {
    method: 'POST',
    query: withHermesProfileQuery(profile),
  })
}

export function getHermesUpdateStatus(refresh = false) {
  return apiRequest<HermesUpdateStatusResponse>('/hermes/update/status', {
    query: refresh ? { refresh: true } : undefined,
  })
}

export function updateHermes() {
  return apiRequest<HermesUpdateActionResponse>('/hermes/update', {
    method: 'POST',
  })
}

export function getHermesUpdateStreamURL() {
  return buildAPIURL('/hermes/update/stream')
}

export function getHermesConfig(profile?: string) {
  return apiRequest<HermesTextFileResponse>('/hermes/config', {
    query: withHermesProfileQuery(profile),
  })
}

export function updateHermesConfig(content: string, profile?: string) {
  return apiRequest<HermesTextFileResponse>('/hermes/config', {
    body: JSON.stringify({ content }),
    headers: { 'Content-Type': 'application/json' },
    method: 'PUT',
    query: withHermesProfileQuery(profile),
  })
}

export function getHermesEnv(profile?: string) {
  return apiRequest<HermesTextFileResponse>('/hermes/env', {
    query: withHermesProfileQuery(profile),
  })
}

export function updateHermesEnv(content: string, profile?: string) {
  return apiRequest<HermesTextFileResponse>('/hermes/env', {
    body: JSON.stringify({ content }),
    headers: { 'Content-Type': 'application/json' },
    method: 'PUT',
    query: withHermesProfileQuery(profile),
  })
}

export function getHermesCronStatus(profile?: string) {
  return apiRequest<HermesCronStatusResponse>('/hermes/cron/status', {
    query: withHermesProfileQuery(profile),
  })
}

export function listHermesCronJobs(options: {
  enabled?: 'all' | 'disabled' | 'enabled'
  includeDisabled?: boolean
  limit?: number
  offset?: number
  profile?: string
  query?: string
  sortBy?: 'createdAt' | 'lastRunAt' | 'name' | 'nextRunAt' | 'updatedAt'
  sortDir?: 'asc' | 'desc'
} = {}) {
  return apiRequest<HermesCronListResponse>('/hermes/cron/jobs', {
    query: withHermesProfileQuery(options.profile, options),
  })
}

export function createHermesCronJob(body: HermesCronJobCreate, profile?: string) {
  return apiRequest<HermesCronRunResponse>('/hermes/cron/jobs', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    query: withHermesProfileQuery(profile),
  })
}

export function updateHermesCronJob(id: string, body: HermesCronJobPatch, profile?: string) {
  return apiRequest<HermesCronRunResponse>(`/hermes/cron/jobs/${encodeURIComponent(id)}`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
    query: withHermesProfileQuery(profile),
  })
}

export function deleteHermesCronJob(id: string, profile?: string) {
  return apiRequest<HermesCronRunResponse>(`/hermes/cron/jobs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    query: withHermesProfileQuery(profile),
  })
}

export function runHermesCronJob(id: string, profile?: string) {
  return apiRequest<HermesCronRunResponse>(`/hermes/cron/jobs/${encodeURIComponent(id)}/run`, {
    method: 'POST',
    query: withHermesProfileQuery(profile),
  })
}

export function listHermesCronRuns(options: {
  id?: string
  limit?: number
  offset?: number
  profile?: string
  query?: string
  sortDir?: 'asc' | 'desc'
  status?: 'all' | 'error' | 'ok'
} = {}) {
  return apiRequest<HermesCronRunsResponse>('/hermes/cron/runs', {
    query: withHermesProfileQuery(options.profile, options),
  })
}

export function listHermesKanbanBoards(options: {
  includeArchived?: boolean
  profile?: string
} = {}) {
  return apiRequest<HermesKanbanBoardsResponse>('/hermes/kanban/boards', {
    query: withHermesProfileQuery(options.profile, {
      includeArchived: options.includeArchived,
    }),
  })
}

export function getHermesKanbanBoard(options: {
  board?: string
  includeArchived?: boolean
  profile?: string
  tenant?: string
} = {}) {
  return apiRequest<HermesKanbanBoardResponse>('/hermes/kanban/board', {
    query: withHermesProfileQuery(options.profile, {
      board: options.board || 'default',
      includeArchived: options.includeArchived,
      tenant: options.tenant,
    }),
  })
}

export function getHermesKanbanTask(id: string, options: { board?: string; profile?: string } = {}) {
  return apiRequest<HermesKanbanTaskDetailResponse>(`/hermes/kanban/tasks/${encodeURIComponent(id)}`, {
    query: withHermesProfileQuery(options.profile, { board: options.board || 'default' }),
  })
}

export function createHermesKanbanTask(body: HermesKanbanTaskCreate, options: { board?: string; profile?: string } = {}) {
  return apiRequest<HermesKanbanTaskMutationResponse>('/hermes/kanban/tasks', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    query: withHermesProfileQuery(options.profile, { board: options.board || 'default' }),
  })
}

export function updateHermesKanbanTask(id: string, body: HermesKanbanTaskPatch, options: { board?: string; profile?: string } = {}) {
  return apiRequest<HermesKanbanTaskMutationResponse>(`/hermes/kanban/tasks/${encodeURIComponent(id)}`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
    query: withHermesProfileQuery(options.profile, { board: options.board || 'default' }),
  })
}

export function addHermesKanbanComment(id: string, body: { author?: string; body: string }, options: { board?: string; profile?: string } = {}) {
  return apiRequest<{ ok?: boolean; status: string; timestamp: string }>(`/hermes/kanban/tasks/${encodeURIComponent(id)}/comments`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    query: withHermesProfileQuery(options.profile, { board: options.board || 'default' }),
  })
}

export function dispatchHermesKanban(options: {
  board?: string
  dryRun?: boolean
  max?: number
  profile?: string
} = {}) {
  return apiRequest<HermesKanbanDispatchResponse>('/hermes/kanban/dispatch', {
    method: 'POST',
    query: withHermesProfileQuery(options.profile, {
      board: options.board || 'default',
      dryRun: options.dryRun,
      max: options.max,
    }),
  })
}
