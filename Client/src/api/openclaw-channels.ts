import { apiRequest, buildAPIURL } from './client'

export type OpenClawChannelTaskStatus = 'done' | 'error' | 'pending' | 'running'

export type OpenClawWeixinDMScope =
  | 'main'
  | 'per-account-channel-peer'
  | 'per-channel-peer'
  | 'per-peer'

export type OpenClawWeixinStatusResponse = {
  accounts: OpenClawWeixinAccount[]
  config?: OpenClawWeixinConfig
  configPath?: string
  dmScope: OpenClawWeixinDMScope | string
  enabled: boolean
  installed: boolean
  openClawError?: string
  openClawHome?: string
  package: string
  pluginId: string
  statePath?: string
  status: string
  version?: string
}

export type OpenClawWeixinConfig = {
  botAgent?: string
  cdnBaseUrl: string
  channelConfigUpdatedAt?: string
  enabled: boolean
  name?: string
  routeTag?: string
}

export type OpenClawWeixinAccount = {
  accountId: string
  agentId?: string
  baseUrl?: string
  cdnBaseUrl?: string
  enabled: boolean
  name?: string
  routeTag?: string
  savedAt?: string
  userId?: string
}

export type OpenClawWeixinAccountConfigUpdateRequest = {
  agentId?: string
  enabled?: boolean
}

export type OpenClawWeixinConfigUpdateRequest = {
  botAgent?: string
  cdnBaseUrl?: string
  enabled?: boolean
  name?: string
  routeTag?: string
}

export type OpenClawWeixinAccountDeleteResponse = {
  accountId: string
  status: string
  timestamp: string
}

export type OpenClawFeishuStatusResponse = {
  accounts: OpenClawFeishuAccount[]
  channelId: string
  config: OpenClawFeishuConfig
  configPath?: string
  configured: boolean
  enabled: boolean
  error?: string
  installed: boolean
  openClawHome?: string
  package: string
  pluginId: string
  status: string
  version?: string
}

export type OpenClawFeishuConfig = {
  accountCount: number
  enabled: boolean
  footerElapsed: boolean
  footerStatus: boolean
  groupAllowFromCount: number
  groupPolicy?: string
  requireMention: boolean
  streaming: boolean
  threadSession: boolean
  toolsProfile?: string
}

export type OpenClawFeishuAccount = {
  accountId: string
  agentId?: string
  allowFrom?: string[]
  appId?: string
  appSecretConfigured: boolean
  configured: boolean
  connectionMode?: string
  dmPolicy?: string
  domain?: string
  enabled: boolean
  encryptKeyConfigured: boolean
  groupAllowFrom?: string[]
  groupCount: number
  groupPolicy?: string
  name?: string
  requireMention: boolean
  verificationTokenConfigured: boolean
}

export type OpenClawFeishuConfigUpdateRequest = {
  enabled?: boolean
  footerElapsed?: boolean
  footerStatus?: boolean
  groupAllowFrom?: string[]
  groupPolicy?: string
  requireMention?: boolean
  streaming?: boolean
  threadSession?: boolean
}

export type OpenClawFeishuAccountConfigUpdateRequest = {
  agentId?: string
  allowFrom?: string[]
  appId?: string
  appSecret?: string
  dmPolicy?: string
  domain?: string
  enabled?: boolean
  groupAllowFrom?: string[]
  groupPolicy?: string
  name?: string
  requireMention?: boolean
}

export type OpenClawFeishuAccountDeleteResponse = {
  accountId: string
  status: string
  timestamp: string
}

export type OpenClawFeishuAddAccountStreamParams = {
  accountId?: string
  agentId?: string
  appId: string
  appSecret: string
  dmPolicy?: string
  domain?: string
  groupPolicy?: string
  name?: string
  requireMention?: boolean
}

export type OpenClawTelegramStatusResponse = {
  accounts: OpenClawTelegramAccount[]
  channelId: string
  config: OpenClawTelegramConfig
  configPath?: string
  configured: boolean
  enabled: boolean
  error?: string
  installed: boolean
  openClawHome?: string
  package: string
  status: string
  version?: string
}

export type OpenClawTelegramConfig = {
  actions: OpenClawTelegramActionsConfig
  allowFromCount: number
  apiRoot?: string
  capabilities: OpenClawTelegramCapabilitiesConfig
  commands: OpenClawTelegramCommandsConfig
  customCommands?: OpenClawTelegramCustomCommand[]
  customCommandCount: number
  dmPolicy: string
  enabled: boolean
  execApprovals: OpenClawTelegramExecApprovalsConfig
  groupCount: number
  groupPolicy?: string
  historyLimit?: string
  linkPreview: boolean
  proxyConfigured: boolean
  replyToMode?: string
  streaming?: string
  streamingConfig: OpenClawTelegramStreamingConfig
  webhook: OpenClawTelegramWebhookConfig
}

export type OpenClawTelegramAccount = {
  actions: OpenClawTelegramActionsConfig
  accountId: string
  allowFrom?: string[]
  agentId?: string
  allowFromCount: number
  capabilities: OpenClawTelegramCapabilitiesConfig
  dmPolicy?: string
  enabled: boolean
  execApprovals: OpenClawTelegramExecApprovalsConfig
  groupCount: number
  groupPolicy?: string
  name?: string
  requireMention: boolean
  tokenConfigured: boolean
  tokenSource: string
}

export type OpenClawTelegramConfigUpdateRequest = {
  actions?: OpenClawTelegramActionsConfig
  blockStreaming?: boolean
  capabilities?: OpenClawTelegramCapabilitiesConfig
  commands?: OpenClawTelegramCommandsConfig
  customCommands?: OpenClawTelegramCustomCommand[]
  dmPolicy?: string
  enabled?: boolean
  execApprovals?: OpenClawTelegramExecApprovalsConfig
  streaming?: OpenClawTelegramStreamingConfigUpdate
  webhookHost?: string
  webhookPath?: string
  webhookSecret?: string
  webhookUrl?: string
}

export type OpenClawTelegramCredentialValidateRequest = {
  botToken: string
}

export type OpenClawTelegramCredentialValidateResponse = {
  botId?: number
  error?: string
  firstName?: string
  httpStatus?: number
  rawError?: string
  rawResponse?: string
  status: string
  telegramDescription?: string
  telegramErrorCode?: number
  timestamp: string
  username?: string
  valid: boolean
}

export type OpenClawTelegramAccountConfigUpdateRequest = {
  actions?: OpenClawTelegramActionsConfig
  allowFrom?: string[]
  agentId?: string
  botToken?: string
  capabilities?: OpenClawTelegramCapabilitiesConfig
  dmPolicy?: string
  enabled?: boolean
  execApprovals?: OpenClawTelegramExecApprovalsConfig
  groupPolicy?: string
  name?: string
  requireMention?: boolean
}

export type OpenClawTelegramExecApprovalsConfig = {
  agentFilter?: string[]
  approvers?: string[]
  enabled?: string
  sessionFilter?: string[]
  target?: string
}

export type OpenClawTelegramCommandsConfig = {
  native?: string
  nativeSkills?: string
}

export type OpenClawTelegramCustomCommand = {
  command: string
  description: string
}

export type OpenClawTelegramStreamingConfig = {
  blockStreaming: boolean
  mode?: string
  previewCommandText?: string
  previewToolProgress: boolean
  progressCommandText?: string
  progressToolProgress: boolean
}

export type OpenClawTelegramStreamingConfigUpdate = {
  mode?: string
  previewCommandText?: string
  previewToolProgress?: boolean
  progressCommandText?: string
  progressToolProgress?: boolean
}

export type OpenClawTelegramWebhookConfig = {
  host?: string
  path?: string
  secretConfigured: boolean
  url?: string
}

export type OpenClawTelegramCapabilitiesConfig = {
  inlineButtons?: string
}

export type OpenClawTelegramActionsConfig = {
  deleteMessage?: boolean
  editMessage?: boolean
  reactions?: boolean
  sendMessage?: boolean
  sticker?: boolean
}

export type OpenClawTelegramAccountDeleteResponse = {
  accountId: string
  status: string
  timestamp: string
}

export type OpenClawDiscordStatusResponse = {
  accounts: OpenClawDiscordAccount[]
  channelId: string
  config: OpenClawDiscordConfig
  configPath?: string
  configured: boolean
  enabled: boolean
  error?: string
  installed: boolean
  openClawHome?: string
  package: string
  status: string
  version?: string
}

export type OpenClawDiscordConfig = {
  actions: OpenClawDiscordActionsConfig
  allowFromCount: number
  commands: OpenClawDiscordCommandsConfig
  dmPolicy: string
  enabled: boolean
  execApprovals: OpenClawDiscordExecApprovalsConfig
  groupCount: number
  groupPolicy?: string
  historyLimit?: string
  proxyConfigured: boolean
  replyToMode?: string
  streaming?: string
  streamingConfig: OpenClawDiscordStreamingConfig
}

export type OpenClawDiscordAccount = {
  accountId: string
  actions: OpenClawDiscordActionsConfig
  allowFrom?: string[]
  allowFromCount: number
  agentId?: string
  applicationId?: string
  dmPolicy?: string
  enabled: boolean
  execApprovals: OpenClawDiscordExecApprovalsConfig
  groupCount: number
  groupPolicy?: string
  guildIds?: string[]
  name?: string
  requireMention: boolean
  tokenConfigured: boolean
  tokenSource: string
}

export type OpenClawDiscordConfigUpdateRequest = {
  actions?: OpenClawDiscordActionsConfig
  commands?: OpenClawDiscordCommandsConfig
  dmPolicy?: string
  enabled?: boolean
  execApprovals?: OpenClawDiscordExecApprovalsConfig
  groupPolicy?: string
  streaming?: OpenClawDiscordStreamingConfigUpdate
}

export type OpenClawDiscordCredentialValidateRequest = {
  botToken: string
}

export type OpenClawDiscordCredentialValidateResponse = {
  botId?: string
  discordDescription?: string
  discordErrorCode?: number
  error?: string
  httpStatus?: number
  rawError?: string
  rawResponse?: string
  status: string
  timestamp: string
  username?: string
  valid: boolean
}

export type OpenClawDiscordAccountConfigUpdateRequest = {
  actions?: OpenClawDiscordActionsConfig
  allowFrom?: string[]
  agentId?: string
  applicationId?: string
  botToken?: string
  dmPolicy?: string
  enabled?: boolean
  execApprovals?: OpenClawDiscordExecApprovalsConfig
  groupPolicy?: string
  guildIds?: string[]
  name?: string
  requireMention?: boolean
}

export type OpenClawDiscordExecApprovalsConfig = {
  agentFilter?: string[]
  approvers?: string[]
  enabled?: string
  sessionFilter?: string[]
  target?: string
}

export type OpenClawDiscordCommandsConfig = {
  native?: string
  nativeSkills?: string
}

export type OpenClawDiscordStreamingConfig = {
  mode?: string
  previewCommandText?: string
  previewToolProgress: boolean
  progressCommandText?: string
  progressToolProgress: boolean
}

export type OpenClawDiscordStreamingConfigUpdate = {
  mode?: string
  previewCommandText?: string
  previewToolProgress?: boolean
  progressCommandText?: string
  progressToolProgress?: boolean
}

export type OpenClawDiscordActionsConfig = {
  messages?: boolean
  moderation?: boolean
  permissions?: boolean
  pins?: boolean
  polls?: boolean
  reactions?: boolean
  stickers?: boolean
  threads?: boolean
}

export type OpenClawDiscordAccountDeleteResponse = {
  accountId: string
  status: string
  timestamp: string
}

export type OpenClawDiscordAddAccountStreamParams = {
  accountId?: string
  agentId?: string
  allowFrom?: string
  applicationId?: string
  botToken: string
  dmPolicy?: string
  groupPolicy?: string
  guildIds?: string
  name?: string
  requireMention?: boolean
}

export type OpenClawDingTalkStatusResponse = {
  accounts: OpenClawDingTalkAccount[]
  channelId: string
  config: OpenClawDingTalkConfig
  configPath?: string
  configured: boolean
  enabled: boolean
  error?: string
  installed: boolean
  openClawHome?: string
  package: string
  status: string
  version?: string
}

export type OpenClawDingTalkConfig = {
  accountCount: number
  allowFromCount: number
  asyncMode: boolean
  clientIdConfigured: boolean
  clientSecretConfigured: boolean
  debug: boolean
  dmPolicy?: string
  enabled: boolean
  groupPolicy?: string
  groupSessionScope?: string
  requireMention: boolean
  systemPrompt?: string
}

export type OpenClawDingTalkAccount = {
  accountId: string
  ackText?: string
  agentId?: string
  allowFrom?: string[]
  allowFromCount: number
  asyncMode: boolean
  chatbotCorpId?: string
  chatbotUserId?: string
  clientIdConfigured: boolean
  clientSecretConfigured: boolean
  debug: boolean
  dmPolicy?: string
  enabled: boolean
  enableMediaUpload: boolean
  endpoint?: string
  groupAllowFrom?: string[]
  groupAllowFromCount: number
  groupCount: number
  groupPolicy?: string
  groupReplyMode?: string
  groupSessionScope?: string
  groups?: Record<string, unknown>
  historyLimit?: number
  mediaMaxMb?: number
  name?: string
  requireMention: boolean
  resolveSenderNames: boolean
  separateSessionByConversation: boolean
  sharedMemoryAcrossConversations: boolean
  systemPrompt?: string
  textChunkLimit?: number
  toolsDocs: boolean
  toolsMedia: boolean
  typingIndicator: boolean
}

export type OpenClawDingTalkConfigUpdateRequest = {
  debug?: boolean
  dmPolicy?: string
  enabled?: boolean
  groupPolicy?: string
  requireMention?: boolean
}

export type OpenClawDingTalkAccountConfigUpdateRequest = {
  ackText?: string
  agentId?: string
  allowFrom?: string[]
  asyncMode?: boolean
  chatbotCorpId?: string
  chatbotUserId?: string
  clientId?: string
  clientSecret?: string
  debug?: boolean
  dmPolicy?: string
  enabled?: boolean
  enableMediaUpload?: boolean
  endpoint?: string
  groupAllowFrom?: string[]
  groupPolicy?: string
  groupReplyMode?: string
  groupSessionScope?: string
  groups?: Record<string, unknown>
  historyLimit?: number
  mediaMaxMb?: number
  name?: string
  requireMention?: boolean
  resolveSenderNames?: boolean
  separateSessionByConversation?: boolean
  sharedMemoryAcrossConversations?: boolean
  systemPrompt?: string
  textChunkLimit?: number
  toolsDocs?: boolean
  toolsMedia?: boolean
  typingIndicator?: boolean
}

export type OpenClawDingTalkAccountDeleteResponse = {
  accountId: string
  status: string
  timestamp: string
}

export type OpenClawDingTalkAddAccountStreamParams = {
  accountId?: string
  ackText?: string
  agentId?: string
  allowFrom?: string
  asyncMode?: boolean
  chatbotCorpId?: string
  chatbotUserId?: string
  clientId: string
  clientSecret: string
  debug?: boolean
  dmPolicy?: string
  enableMediaUpload?: boolean
  endpoint?: string
  groupAllowFrom?: string
  groupPolicy?: string
  groupReplyMode?: string
  groupSessionScope?: string
  groupsJson?: string
  historyLimit?: string
  mediaMaxMb?: string
  name?: string
  requireMention?: boolean
  resolveSenderNames?: boolean
  separateSessionByConversation?: boolean
  sharedMemoryAcrossConversations?: boolean
  systemPrompt?: string
  textChunkLimit?: string
  toolsDocs?: boolean
  toolsMedia?: boolean
  typingIndicator?: boolean
}

export type OpenClawWeComStatusResponse = {
  accounts: OpenClawWeComAccount[]
  channelId: string
  config: OpenClawWeComConfig
  configPath?: string
  configured: boolean
  enabled: boolean
  error?: string
  installed: boolean
  openClawHome?: string
  package: string
  status: string
  version?: string
}

export type OpenClawWeComConfig = {
  accountCount: number
  allowFromCount: number
  botConfigured: boolean
  connectionMode?: string
  defaultAccount?: string
  dmPolicy?: string
  dynamicAgentsEnabled: boolean
  enabled: boolean
  groupAllowFromCount: number
  groupPolicy?: string
  name?: string
}

export type OpenClawWeComAccount = {
  accountId: string
  agent: OpenClawWeComAgentConfig
  agentId?: string
  allowFrom?: string[]
  allowFromCount: number
  botIdConfigured: boolean
  connectionMode?: string
  dmPolicy?: string
  enabled: boolean
  encodingAESKeyConfigured: boolean
  groupAllowFrom?: string[]
  groupAllowFromCount: number
  groupCount: number
  groupPolicy?: string
  groups?: Record<string, unknown>
  media: OpenClawWeComMediaConfig
  mediaLocalRoots?: string[]
  name?: string
  network: OpenClawWeComNetworkConfig
  receiveId?: string
  secretConfigured: boolean
  sendThinkingMessage: boolean
  streamPlaceholderContent?: string
  tokenConfigured: boolean
  websocketUrl?: string
  welcomeText?: string
  dynamicAgents: OpenClawWeComDynamicAgentsConfig
}

export type OpenClawWeComAgentConfig = {
  agentId?: string
  allowFrom?: string[]
  allowFromCount: number
  configured: boolean
  corpIdConfigured: boolean
  corpSecretConfigured: boolean
  dmPolicy?: string
  encodingAESKeyConfigured: boolean
  tokenConfigured: boolean
  welcomeText?: string
}

export type OpenClawWeComMediaConfig = {
  cleanupOnStart: boolean
  maxBytes?: number
  retentionHours?: number
  tempDir?: string
}

export type OpenClawWeComNetworkConfig = {
  egressProxyUrl?: string
  retries?: number
  retryDelayMs?: number
  timeoutMs?: number
}

export type OpenClawWeComDynamicAgentsConfig = {
  adminUsers?: string[]
  enabled: boolean
  dmCreateAgent: boolean
  groupEnabled: boolean
}

export type OpenClawWeComConfigUpdateRequest = {
  defaultAccount?: string
  dmPolicy?: string
  enabled?: boolean
  groupPolicy?: string
  name?: string
}

export type OpenClawWeComAccountConfigUpdateRequest = {
  agent?: OpenClawWeComAgentConfigUpdateRequest
  agentId?: string
  allowFrom?: string[]
  botId?: string
  connectionMode?: string
  dmPolicy?: string
  dynamicAgents?: OpenClawWeComDynamicAgentsConfigUpdateRequest
  encodingAESKey?: string
  enabled?: boolean
  groupAllowFrom?: string[]
  groupPolicy?: string
  groups?: Record<string, unknown>
  media?: OpenClawWeComMediaConfigUpdateRequest
  mediaLocalRoots?: string[]
  name?: string
  network?: OpenClawWeComNetworkConfigUpdateRequest
  receiveId?: string
  secret?: string
  sendThinkingMessage?: boolean
  streamPlaceholderContent?: string
  token?: string
  websocketUrl?: string
  welcomeText?: string
}

export type OpenClawWeComAgentConfigUpdateRequest = {
  agentId?: string
  allowFrom?: string[]
  corpId?: string
  corpSecret?: string
  dmPolicy?: string
  encodingAESKey?: string
  token?: string
  welcomeText?: string
}

export type OpenClawWeComMediaConfigUpdateRequest = {
  cleanupOnStart?: boolean
  maxBytes?: number
  retentionHours?: number
  tempDir?: string
}

export type OpenClawWeComNetworkConfigUpdateRequest = {
  egressProxyUrl?: string
  retries?: number
  retryDelayMs?: number
  timeoutMs?: number
}

export type OpenClawWeComDynamicAgentsConfigUpdateRequest = {
  adminUsers?: string[]
  enabled?: boolean
  dmCreateAgent?: boolean
  groupEnabled?: boolean
}

export type OpenClawWeComAccountDeleteResponse = {
  accountId: string
  status: string
  timestamp: string
}

export type OpenClawWeComAddAccountStreamParams = {
  accountId?: string
  agentId?: string
  allowFrom?: string
  botId?: string
  connectionMode?: string
  dmPolicy?: string
  dynamicAdminUsers?: string
  dynamicAgentsEnabled?: boolean
  dynamicDmCreateAgent?: boolean
  dynamicGroupEnabled?: boolean
  encodingAESKey?: string
  groupAllowFrom?: string
  groupPolicy?: string
  groupsJson?: string
  mediaCleanupOnStart?: boolean
  mediaLocalRoots?: string
  mediaMaxBytes?: string
  mediaRetentionHours?: string
  mediaTempDir?: string
  name?: string
  networkEgressProxyUrl?: string
  networkRetries?: string
  networkRetryDelayMs?: string
  networkTimeoutMs?: string
  receiveId?: string
  secret?: string
  sendThinkingMessage?: boolean
  streamPlaceholderContent?: string
  token?: string
  websocketUrl?: string
  welcomeText?: string
  agentCorpId?: string
  agentCorpSecret?: string
  agentAgentId?: string
  agentToken?: string
  agentEncodingAESKey?: string
  agentWelcomeText?: string
  agentDmPolicy?: string
  agentAllowFrom?: string
}

export type OpenClawQQBotStatusResponse = {
  accounts: OpenClawQQBotAccount[]
  channelId: string
  config: OpenClawQQBotConfig
  configPath?: string
  configured: boolean
  enabled: boolean
  error?: string
  installed: boolean
  openClawHome?: string
  package: string
  status: string
  version?: string
}

export type OpenClawQQBotConfig = {
  accountCount: number
  allowFrom?: string[]
  allowFromCount: number
  defaultAccount?: string
  enabled: boolean
  name?: string
  stt: OpenClawQQBotSpeechConfig
  systemPrompt?: string
  tts: OpenClawQQBotSpeechConfig
}

export type OpenClawQQBotAccount = {
  accountId: string
  agentId?: string
  allowFrom?: string[]
  allowFromCount: number
  appIdConfigured: boolean
  audioFormatPolicy: OpenClawQQBotAudioFormatPolicy
  clientSecretConfigured: boolean
  deliverDebounce: OpenClawQQBotDeliverDebounceConfig
  dmPolicy?: string
  enabled: boolean
  execApprovals: OpenClawQQBotExecApprovalsConfig
  groupAllowFrom?: string[]
  groupPolicy?: string
  markdownSupport: boolean
  name?: string
  stt: OpenClawQQBotSpeechConfig
  streaming: OpenClawQQBotStreamingConfig
  systemPrompt?: string
  tts: OpenClawQQBotSpeechConfig
  upgradeMode?: string
  upgradePkg?: string
  upgradeUrl?: string
  urlDirectUpload: boolean
}

export type OpenClawQQBotSpeechConfig = {
  apiKeyConfigured: boolean
  baseUrl?: string
  enabled: boolean
  model?: string
  provider?: string
  responseType?: string
  voice?: string
}

export type OpenClawQQBotAudioFormatPolicy = {
  sttDirectFormats?: string[]
  transcodeEnabled: boolean
  uploadDirectFormats?: string[]
}

export type OpenClawQQBotDeliverDebounceConfig = {
  enabled: boolean
  maxWaitMs: number
  separator?: string
  windowMs: number
}

export type OpenClawQQBotExecApprovalsConfig = {
  agentFilter?: string[]
  approvers?: string[]
  enabled?: string
  sessionFilter?: string[]
  target?: string
}

export type OpenClawQQBotStreamingConfig = {
  c2cStreamApi: boolean
  enabled: boolean
  mode?: string
}

export type OpenClawQQBotConfigUpdateRequest = {
  allowFrom?: string[]
  defaultAccount?: string
  enabled?: boolean
  name?: string
  stt?: OpenClawQQBotSpeechConfigUpdate
  systemPrompt?: string
  tts?: OpenClawQQBotSpeechConfigUpdate
}

export type OpenClawQQBotAccountConfigUpdateRequest = {
  agentId?: string
  allowFrom?: string[]
  appId?: string
  audioFormatPolicy?: OpenClawQQBotAudioFormatPolicyUpdate
  clientSecret?: string
  deliverDebounce?: OpenClawQQBotDeliverDebounceConfigUpdate
  dmPolicy?: string
  enabled?: boolean
  execApprovals?: OpenClawQQBotExecApprovalsConfigUpdate
  groupAllowFrom?: string[]
  groupPolicy?: string
  markdownSupport?: boolean
  name?: string
  stt?: OpenClawQQBotSpeechConfigUpdate
  streaming?: OpenClawQQBotStreamingConfigUpdate
  systemPrompt?: string
  tts?: OpenClawQQBotSpeechConfigUpdate
  upgradeMode?: string
  upgradePkg?: string
  upgradeUrl?: string
  urlDirectUpload?: boolean
}

export type OpenClawQQBotAudioFormatPolicyUpdate = {
  sttDirectFormats?: string[]
  transcodeEnabled?: boolean
  uploadDirectFormats?: string[]
}

export type OpenClawQQBotDeliverDebounceConfigUpdate = {
  enabled?: boolean
  maxWaitMs?: number
  separator?: string
  windowMs?: number
}

export type OpenClawQQBotExecApprovalsConfigUpdate = {
  agentFilter?: string[]
  approvers?: string[]
  enabled?: string
  sessionFilter?: string[]
  target?: string
}

export type OpenClawQQBotStreamingConfigUpdate = {
  c2cStreamApi?: boolean
  enabled?: boolean
  mode?: string
}

export type OpenClawQQBotSpeechConfigUpdate = {
  apiKey?: string
  baseUrl?: string
  enabled?: boolean
  model?: string
  provider?: string
  responseType?: string
  voice?: string
}

export type OpenClawQQBotAccountDeleteResponse = {
  accountId: string
  status: string
  timestamp: string
}

export type OpenClawQQBotAddAccountStreamParams = {
  accountId?: string
  agentId?: string
  allowFrom?: string
  appId: string
  clientSecret: string
  name?: string
  sttApiKey?: string
  sttBaseUrl?: string
  sttEnabled?: boolean
  sttModel?: string
  sttProvider?: string
  systemPrompt?: string
  ttsApiKey?: string
  ttsBaseUrl?: string
  ttsEnabled?: boolean
  ttsModel?: string
  ttsProvider?: string
  ttsResponseType?: string
  ttsVoice?: string
}

export type OpenClawYuanbaoStatusResponse = {
  accounts: OpenClawYuanbaoAccount[]
  channelId: string
  config: OpenClawYuanbaoConfig
  configPath?: string
  configured: boolean
  enabled: boolean
  error?: string
  installed: boolean
  openClawHome?: string
  package: string
  status: string
  version?: string
}

export type OpenClawYuanbaoConfig = {
  accountCount: number
  defaultAccount?: string
  enabled: boolean
  name?: string
  systemPrompt?: string
}

export type OpenClawYuanbaoAccount = {
  accountId: string
  agentId?: string
  appIdConfigured: boolean
  appSecretConfigured: boolean
  enabled: boolean
  name?: string
  systemPrompt?: string
}

export type OpenClawYuanbaoConfigUpdateRequest = {
  defaultAccount?: string
  enabled?: boolean
  name?: string
  systemPrompt?: string
}

export type OpenClawYuanbaoAccountConfigUpdateRequest = {
  agentId?: string
  appId?: string
  appSecret?: string
  enabled?: boolean
  name?: string
  systemPrompt?: string
}

export type OpenClawYuanbaoAccountDeleteResponse = {
  accountId: string
  status: string
  timestamp: string
}

export type OpenClawYuanbaoAddAccountStreamParams = {
  accountId?: string
  agentId?: string
  appId?: string
  appSecret?: string
  name?: string
  systemPrompt?: string
}

export type OpenClawTelegramAddAccountStreamParams = {
  accountId?: string
  agentId?: string
  allowFrom?: string
  botToken: string
  dmPolicy?: string
  groupPolicy?: string
  name?: string
  requireMention?: boolean
}

export type OpenClawMatrixStatusResponse = {
  accounts: OpenClawMatrixAccount[]
  channelId: string
  config: OpenClawMatrixConfig
  configPath?: string
  configured: boolean
  enabled: boolean
  error?: string
  installed: boolean
  openClawHome?: string
  package: string
  status: string
  version?: string
}

export type OpenClawMatrixConfig = {
  actions: OpenClawMatrixActionsConfig
  allowPrivateNetwork: boolean
  autoJoin?: string
  autoJoinAllowlistCount: number
  defaultAccount?: string
  dmAllowFromCount: number
  dmEnabled: boolean
  dmPolicy: string
  enabled: boolean
  encryption: boolean
  execApprovals: OpenClawMatrixExecApprovalsConfig
  groupAllowFromCount: number
  groupCount: number
  groupPolicy?: string
  replyToMode?: string
  streaming?: string
  threadReplies?: string
}

export type OpenClawMatrixAccount = {
  accountId: string
  actions: OpenClawMatrixActionsConfig
  agentId?: string
  allowPrivateNetwork: boolean
  authConfigured: boolean
  authSource: string
  autoJoin?: string
  autoJoinAllowlist?: string[]
  autoJoinAllowlistCount: number
  deviceName?: string
  dmAllowFrom?: string[]
  dmAllowFromCount: number
  dmEnabled: boolean
  dmPolicy?: string
  dmSessionScope?: string
  dmThreadReplies?: string
  enabled: boolean
  encryption: boolean
  execApprovals: OpenClawMatrixExecApprovalsConfig
  groupAllowFrom?: string[]
  groupAllowFromCount: number
  groupCount: number
  groupPolicy?: string
  homeserver?: string
  name?: string
  streaming?: string
  threadReplies?: string
  userId?: string
}

export type OpenClawMatrixConfigUpdateRequest = {
  actions?: OpenClawMatrixActionsConfig
  dmPolicy?: string
  enabled?: boolean
  execApprovals?: OpenClawMatrixExecApprovalsConfig
  groupPolicy?: string
  replyToMode?: string
  streaming?: OpenClawMatrixStreamingConfigUpdate
  threadReplies?: string
}

export type OpenClawMatrixAccountConfigUpdateRequest = {
  accessToken?: string
  actions?: OpenClawMatrixActionsConfig
  agentId?: string
  allowPrivateNetwork?: boolean
  autoJoin?: string
  autoJoinAllowlist?: string[]
  deviceName?: string
  dmAllowFrom?: string[]
  dmEnabled?: boolean
  dmPolicy?: string
  dmSessionScope?: string
  dmThreadReplies?: string
  enabled?: boolean
  encryption?: boolean
  execApprovals?: OpenClawMatrixExecApprovalsConfig
  groupAllowFrom?: string[]
  groupPolicy?: string
  groups?: string[]
  homeserver?: string
  name?: string
  password?: string
  streaming?: string
  threadReplies?: string
  userId?: string
}

export type OpenClawMatrixExecApprovalsConfig = {
  agentFilter?: string[]
  approvers?: string[]
  enabled?: string
  sessionFilter?: string[]
  target?: string
}

export type OpenClawMatrixActionsConfig = {
  channelInfo?: boolean
  memberInfo?: boolean
  messages?: boolean
  pins?: boolean
  profile?: boolean
  reactions?: boolean
  verification?: boolean
}

export type OpenClawMatrixStreamingConfigUpdate = {
  mode?: string
  previewToolProgress?: boolean
  progressToolProgress?: boolean
}

export type OpenClawMatrixAccountDeleteResponse = {
  accountId: string
  status: string
  timestamp: string
}

export type OpenClawMatrixAddAccountStreamParams = {
  accessToken?: string
  accountId?: string
  agentId?: string
  allowPrivateNetwork?: boolean
  autoJoin?: string
  autoJoinAllowlist?: string
  deviceName?: string
  dmAllowFrom?: string
  dmPolicy?: string
  encryption?: boolean
  groupAllowFrom?: string
  groupPolicy?: string
  homeserver: string
  initialSyncLimit?: string
  name?: string
  password?: string
  userId?: string
}

export type OpenClawTwitchStatusResponse = {
  accounts: OpenClawTwitchAccount[]
  channelId: string
  config: OpenClawTwitchConfig
  configPath?: string
  configured: boolean
  enabled: boolean
  error?: string
  installed: boolean
  openClawHome?: string
  package: string
  status: string
  version?: string
}

export type OpenClawTwitchConfig = {
  accountCount: number
  allowFromCount: number
  allowedRoles?: string[]
  channel?: string
  clientId?: string
  clientIdConfigured: boolean
  clientSecretConfigured: boolean
  enabled: boolean
  refreshTokenConfigured: boolean
  requireMention: boolean
  tokenConfigured: boolean
  tokenSource: string
  username?: string
}

export type OpenClawTwitchAccount = {
  accountId: string
  agentId?: string
  allowFrom?: string[]
  allowFromCount: number
  allowedRoles?: string[]
  channel?: string
  clientId?: string
  clientIdConfigured: boolean
  clientSecretConfigured: boolean
  enabled: boolean
  name?: string
  refreshTokenConfigured: boolean
  requireMention: boolean
  tokenConfigured: boolean
  tokenSource: string
  username?: string
}

export type OpenClawTwitchConfigUpdateRequest = {
  enabled?: boolean
}

export type OpenClawTwitchCredentialValidateRequest = {
  accessToken: string
}

export type OpenClawTwitchCredentialValidateResponse = {
  clientId?: string
  error?: string
  expiresIn?: number
  httpStatus?: number
  login?: string
  rawError?: string
  rawResponse?: string
  scopes?: string[]
  status: string
  timestamp: string
  userId?: string
  valid: boolean
}

export type OpenClawTwitchAccountConfigUpdateRequest = {
  accessToken?: string
  agentId?: string
  allowFrom?: string[]
  allowedRoles?: string[]
  channel?: string
  clientId?: string
  clientSecret?: string
  enabled?: boolean
  name?: string
  refreshToken?: string
  requireMention?: boolean
  username?: string
}

export type OpenClawTwitchAccountDeleteResponse = {
  accountId: string
  status: string
  timestamp: string
}

export type OpenClawTwitchAddAccountStreamParams = {
  accessToken: string
  accountId?: string
  agentId?: string
  allowFrom?: string
  allowedRoles?: string
  channel: string
  clientId: string
  clientSecret?: string
  name?: string
  refreshToken?: string
  requireMention?: boolean
  username: string
}

export type OpenClawWhatsAppStatusResponse = {
  accounts: OpenClawWhatsAppAccount[]
  channelId: string
  config: OpenClawWhatsAppConfig
  configPath?: string
  configured: boolean
  enabled: boolean
  error?: string
  installed: boolean
  linked: boolean
  openClawHome?: string
  package: string
  status: string
  version?: string
}

export type OpenClawWhatsAppConfig = {
  actions: OpenClawWhatsAppActionsConfig
  allowFromCount: number
  chunkMode?: string
  configWrites: boolean
  dmPolicy: string
  enabled: boolean
  groupAllowFromCount: number
  groupCount: number
  groupPolicy?: string
  historyLimit?: string
  mediaMaxMb?: string
  reactionLevel?: string
  replyToMode?: string
  selfChatMode: boolean
  sendReadReceipts: boolean
  textChunkLimit?: string
}

export type OpenClawWhatsAppAccount = {
  accountId: string
  agentId?: string
  allowFrom?: string[]
  allowFromCount: number
  authDir: string
  authDirConfigured: boolean
  credsUpdatedAt?: string
  dmPolicy?: string
  enabled: boolean
  groupAllowFrom?: string[]
  groupAllowFromCount: number
  groupCount: number
  groupPolicy?: string
  legacyAuthDir: boolean
  linked: boolean
  name?: string
  selfChatMode: boolean
  selfId?: string
  selfPhone?: string
  sendReadReceipts: boolean
}

export type OpenClawWhatsAppConfigUpdateRequest = {
  actions?: OpenClawWhatsAppActionsConfig
  allowFrom?: string[]
  chunkMode?: string
  configWrites?: boolean
  dmPolicy?: string
  enabled?: boolean
  groupAllowFrom?: string[]
  groupPolicy?: string
  historyLimit?: string
  mediaMaxMb?: string
  reactionLevel?: string
  replyToMode?: string
  selfChatMode?: boolean
  sendReadReceipts?: boolean
  textChunkLimit?: string
}

export type OpenClawWhatsAppAccountConfigUpdateRequest = {
  agentId?: string
  allowFrom?: string[]
  authDir?: string
  dmPolicy?: string
  enabled?: boolean
  groupAllowFrom?: string[]
  groupPolicy?: string
  name?: string
  selfChatMode?: boolean
  sendReadReceipts?: boolean
}

export type OpenClawWhatsAppActionsConfig = {
  polls?: boolean
  reactions?: boolean
}

export type OpenClawWhatsAppAccountDeleteResponse = {
  accountId: string
  status: string
  timestamp: string
}

export type OpenClawWhatsAppAddAccountStreamParams = {
  accountId?: string
  agentId?: string
  allowFrom?: string
  authDir?: string
  dmPolicy?: string
  groupAllowFrom?: string
  groupPolicy?: string
  name?: string
  selfChatMode?: boolean
}

export type OpenClawPairingRequest = {
  accountId?: string
  code: string
  createdAt: string
  id: string
  lastSeenAt?: string
  meta?: Record<string, unknown>
}

export type OpenClawPairingListResponse = {
  channel: string
  rawOutput?: string
  requests: OpenClawPairingRequest[]
  status: string
  timestamp: string
}

export type OpenClawPairingApproveRequest = {
  accountId?: string
  code: string
  notify?: boolean
}

export type OpenClawPairingApproveResponse = {
  approved: boolean
  channel: string
  code: string
  message?: string
  rawOutput?: string
  status: string
  timestamp: string
}

export type OpenClawChannelTaskResponse = {
  error?: string
  id: string
  logs: string[]
  progress: number
  startedAt: string
  status: OpenClawChannelTaskStatus
  updatedAt: string
}

export type OpenClawChannelStreamMeta = {
  id: string
  kind: string
  timestamp: string
}

export type OpenClawChannelStreamStatus = {
  error?: string
  id: string
  progress: number
  status: OpenClawChannelTaskStatus
  timestamp: string
}

export type OpenClawChannelStreamLog = {
  id: string
  line: string
  timestamp: string
}

export type OpenClawChannelStreamError = {
  id: string
  message: string
  timestamp: string
}

export type OpenClawRecentChannelMessage = {
  id: string
  messageId?: string
  sessionId: string
  agentId: string
  channel?: string
  chatId?: string
  sender?: string
  senderId?: string
  role: string
  content: string
  timestamp: string
  displayTime?: string
  metadata?: Record<string, string>
}

export type OpenClawRecentChannelMessagesResponse = {
  status: string
  timestamp: string
  home: string
  agentId: string
  limit: number
  messages: OpenClawRecentChannelMessage[]
  scanned: {
    agentDirs: number
    files: number
    errors?: string[]
  }
}

export function getOpenClawRecentChannelMessages(options: { agentId?: string; limit?: number } = {}) {
  return apiRequest<OpenClawRecentChannelMessagesResponse>('/openclaw/messages/recent', {
    query: {
      agentId: options.agentId && options.agentId !== 'all' ? options.agentId : undefined,
      limit: options.limit,
    },
  })
}

export function getOpenClawWeixinStatus() {
  return apiRequest<OpenClawWeixinStatusResponse>('/openclaw/channels/weixin')
}

export function updateOpenClawWeixinConfig(body: OpenClawWeixinConfigUpdateRequest) {
  return apiRequest<OpenClawWeixinStatusResponse>('/openclaw/channels/weixin/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteOpenClawWeixinAccount(accountId: string) {
  return apiRequest<OpenClawWeixinAccountDeleteResponse>(`/openclaw/channels/weixin/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
  })
}

export function updateOpenClawWeixinAccountConfig(accountId: string, body: OpenClawWeixinAccountConfigUpdateRequest) {
  return apiRequest<OpenClawWeixinStatusResponse>(`/openclaw/channels/weixin/accounts/${encodeURIComponent(accountId)}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function getOpenClawWeixinInstallStreamURL() {
  return buildAPIURL('/openclaw/channels/weixin/install')
}

export function getOpenClawWeixinLoginStreamURL() {
  return buildAPIURL('/openclaw/channels/weixin/login')
}

export function getOpenClawWeixinDMScopeStreamURL(scope: OpenClawWeixinDMScope) {
  return buildAPIURL('/openclaw/channels/weixin/dm-scope', { scope })
}

export function getOpenClawWeixinUninstallStreamURL() {
  return buildAPIURL('/openclaw/channels/weixin/uninstall')
}

export function getOpenClawFeishuStatus() {
  return apiRequest<OpenClawFeishuStatusResponse>('/openclaw/channels/feishu')
}

export function updateOpenClawFeishuConfig(body: OpenClawFeishuConfigUpdateRequest) {
  return apiRequest<OpenClawFeishuStatusResponse>('/openclaw/channels/feishu/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteOpenClawFeishuAccount(accountId: string) {
  return apiRequest<OpenClawFeishuAccountDeleteResponse>(`/openclaw/channels/feishu/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
  })
}

export function updateOpenClawFeishuAccountConfig(accountId: string, body: OpenClawFeishuAccountConfigUpdateRequest) {
  return apiRequest<OpenClawFeishuStatusResponse>(`/openclaw/channels/feishu/accounts/${encodeURIComponent(accountId)}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function getOpenClawFeishuInstallStreamURL() {
  return buildAPIURL('/openclaw/channels/feishu/install')
}

export function getOpenClawFeishuScanAddStreamURL() {
  return buildAPIURL('/openclaw/channels/feishu/scan-add')
}

export function getOpenClawFeishuAddAccountStreamURL(params: OpenClawFeishuAddAccountStreamParams) {
  return buildAPIURL('/openclaw/channels/feishu/manual-add', {
    accountId: params.accountId?.trim() || 'default',
    agentId: params.agentId?.trim() || undefined,
    appId: params.appId.trim(),
    appSecret: params.appSecret.trim(),
    dmPolicy: params.dmPolicy || 'pairing',
    domain: params.domain?.trim() || undefined,
    groupPolicy: params.groupPolicy?.trim() === 'inherit' ? undefined : params.groupPolicy?.trim() || undefined,
    name: params.name?.trim() || undefined,
    requireMention: params.requireMention ? 'true' : 'false',
  })
}

export function getOpenClawFeishuDoctorStreamURL() {
  return buildAPIURL('/openclaw/channels/feishu/doctor')
}

export function getOpenClawFeishuUninstallStreamURL() {
  return buildAPIURL('/openclaw/channels/feishu/uninstall')
}

export function getOpenClawTelegramStatus() {
  return apiRequest<OpenClawTelegramStatusResponse>('/openclaw/channels/telegram')
}

export function updateOpenClawTelegramConfig(body: OpenClawTelegramConfigUpdateRequest) {
  return apiRequest<OpenClawTelegramStatusResponse>('/openclaw/channels/telegram/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function validateOpenClawTelegramCredential(body: OpenClawTelegramCredentialValidateRequest) {
  return apiRequest<OpenClawTelegramCredentialValidateResponse>('/openclaw/channels/telegram/credential/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function listOpenClawPairingRequests(channel: string, accountId?: string) {
  const query = accountId?.trim() ? `?accountId=${encodeURIComponent(accountId.trim())}` : ''
  return apiRequest<OpenClawPairingListResponse>(`/openclaw/pairing/${encodeURIComponent(channel)}${query}`)
}

export function approveOpenClawPairingRequest(channel: string, body: OpenClawPairingApproveRequest) {
  return apiRequest<OpenClawPairingApproveResponse>(`/openclaw/pairing/${encodeURIComponent(channel)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateOpenClawTelegramAccountConfig(accountId: string, body: OpenClawTelegramAccountConfigUpdateRequest) {
  return apiRequest<OpenClawTelegramStatusResponse>(`/openclaw/channels/telegram/accounts/${encodeURIComponent(accountId)}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteOpenClawTelegramAccount(accountId: string) {
  return apiRequest<OpenClawTelegramAccountDeleteResponse>(`/openclaw/channels/telegram/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
  })
}

export function getOpenClawTelegramAddAccountStreamURL(params: OpenClawTelegramAddAccountStreamParams) {
  return buildAPIURL('/openclaw/channels/telegram/add', {
    accountId: params.accountId?.trim() || 'default',
    agentId: params.agentId?.trim() || undefined,
    allowFrom: params.allowFrom?.trim() || undefined,
    botToken: params.botToken,
    dmPolicy: params.dmPolicy || 'pairing',
    groupPolicy: params.groupPolicy?.trim() || undefined,
    name: params.name?.trim() || undefined,
    requireMention: params.requireMention ? 'true' : 'false',
  })
}

export function getOpenClawWhatsAppStatus() {
  return apiRequest<OpenClawWhatsAppStatusResponse>('/openclaw/channels/whatsapp')
}

export function updateOpenClawWhatsAppConfig(body: OpenClawWhatsAppConfigUpdateRequest) {
  return apiRequest<OpenClawWhatsAppStatusResponse>('/openclaw/channels/whatsapp/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateOpenClawWhatsAppAccountConfig(accountId: string, body: OpenClawWhatsAppAccountConfigUpdateRequest) {
  return apiRequest<OpenClawWhatsAppStatusResponse>(`/openclaw/channels/whatsapp/accounts/${encodeURIComponent(accountId)}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteOpenClawWhatsAppAccount(accountId: string) {
  return apiRequest<OpenClawWhatsAppAccountDeleteResponse>(`/openclaw/channels/whatsapp/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
  })
}

export function getOpenClawWhatsAppAddAccountStreamURL(params: OpenClawWhatsAppAddAccountStreamParams) {
  return buildAPIURL('/openclaw/channels/whatsapp/add', {
    accountId: params.accountId?.trim() || 'default',
    agentId: params.agentId?.trim() || undefined,
    allowFrom: params.allowFrom?.trim() || undefined,
    authDir: params.authDir?.trim() || undefined,
    dmPolicy: params.dmPolicy || 'pairing',
    groupAllowFrom: params.groupAllowFrom?.trim() || undefined,
    groupPolicy: params.groupPolicy?.trim() || undefined,
    name: params.name?.trim() || undefined,
    selfChatMode: params.selfChatMode ? 'true' : 'false',
  })
}

export function getOpenClawWhatsAppLoginStreamURL(accountId?: string) {
  return buildAPIURL('/openclaw/channels/whatsapp/login', {
    accountId: accountId?.trim() || undefined,
  })
}

export function getOpenClawWhatsAppLogoutStreamURL(accountId?: string) {
  return buildAPIURL('/openclaw/channels/whatsapp/logout', {
    accountId: accountId?.trim() || undefined,
  })
}

export function getOpenClawWhatsAppUninstallStreamURL() {
  return buildAPIURL('/openclaw/channels/whatsapp/uninstall')
}

export function getOpenClawTwitchStatus() {
  return apiRequest<OpenClawTwitchStatusResponse>('/openclaw/channels/twitch')
}

export function updateOpenClawTwitchConfig(body: OpenClawTwitchConfigUpdateRequest) {
  return apiRequest<OpenClawTwitchStatusResponse>('/openclaw/channels/twitch/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function validateOpenClawTwitchCredential(body: OpenClawTwitchCredentialValidateRequest) {
  return apiRequest<OpenClawTwitchCredentialValidateResponse>('/openclaw/channels/twitch/credential/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateOpenClawTwitchAccountConfig(accountId: string, body: OpenClawTwitchAccountConfigUpdateRequest) {
  return apiRequest<OpenClawTwitchStatusResponse>(`/openclaw/channels/twitch/accounts/${encodeURIComponent(accountId)}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteOpenClawTwitchAccount(accountId: string) {
  return apiRequest<OpenClawTwitchAccountDeleteResponse>(`/openclaw/channels/twitch/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
  })
}

export function getOpenClawTwitchAddAccountStreamURL(params: OpenClawTwitchAddAccountStreamParams) {
  return buildAPIURL('/openclaw/channels/twitch/add', {
    accessToken: params.accessToken,
    accountId: params.accountId?.trim() || 'default',
    agentId: params.agentId?.trim() || undefined,
    allowFrom: params.allowFrom?.trim() || undefined,
    allowedRoles: params.allowedRoles?.trim() || undefined,
    channel: params.channel.trim(),
    clientId: params.clientId.trim(),
    clientSecret: params.clientSecret?.trim() || undefined,
    name: params.name?.trim() || undefined,
    refreshToken: params.refreshToken?.trim() || undefined,
    requireMention: params.requireMention ? 'true' : 'false',
    username: params.username.trim(),
  })
}

export function getOpenClawDiscordStatus() {
  return apiRequest<OpenClawDiscordStatusResponse>('/openclaw/channels/discord')
}

export function updateOpenClawDiscordConfig(body: OpenClawDiscordConfigUpdateRequest) {
  return apiRequest<OpenClawDiscordStatusResponse>('/openclaw/channels/discord/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function validateOpenClawDiscordCredential(body: OpenClawDiscordCredentialValidateRequest) {
  return apiRequest<OpenClawDiscordCredentialValidateResponse>('/openclaw/channels/discord/credential/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateOpenClawDiscordAccountConfig(accountId: string, body: OpenClawDiscordAccountConfigUpdateRequest) {
  return apiRequest<OpenClawDiscordStatusResponse>(`/openclaw/channels/discord/accounts/${encodeURIComponent(accountId)}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteOpenClawDiscordAccount(accountId: string) {
  return apiRequest<OpenClawDiscordAccountDeleteResponse>(`/openclaw/channels/discord/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
  })
}

export function getOpenClawDiscordAddAccountStreamURL(params: OpenClawDiscordAddAccountStreamParams) {
  return buildAPIURL('/openclaw/channels/discord/add', {
    accountId: params.accountId?.trim() || 'default',
    agentId: params.agentId?.trim() || undefined,
    allowFrom: params.allowFrom?.trim() || undefined,
    applicationId: params.applicationId?.trim() || undefined,
    botToken: params.botToken,
    dmPolicy: params.dmPolicy || 'pairing',
    groupPolicy: params.groupPolicy?.trim() || undefined,
    guildIds: params.guildIds?.trim() || undefined,
    name: params.name?.trim() || undefined,
    requireMention: params.requireMention ? 'true' : 'false',
  })
}

export function getOpenClawDingTalkStatus() {
  return apiRequest<OpenClawDingTalkStatusResponse>('/openclaw/channels/dingtalk')
}

export function updateOpenClawDingTalkConfig(body: OpenClawDingTalkConfigUpdateRequest) {
  return apiRequest<OpenClawDingTalkStatusResponse>('/openclaw/channels/dingtalk/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateOpenClawDingTalkAccountConfig(accountId: string, body: OpenClawDingTalkAccountConfigUpdateRequest) {
  return apiRequest<OpenClawDingTalkStatusResponse>(`/openclaw/channels/dingtalk/accounts/${encodeURIComponent(accountId)}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteOpenClawDingTalkAccount(accountId: string) {
  return apiRequest<OpenClawDingTalkAccountDeleteResponse>(`/openclaw/channels/dingtalk/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
  })
}

export function getOpenClawDingTalkInstallStreamURL() {
  return buildAPIURL('/openclaw/channels/dingtalk/install')
}

export function getOpenClawDingTalkScanAddStreamURL() {
  return buildAPIURL('/openclaw/channels/dingtalk/scan-add')
}

export function getOpenClawDingTalkAddAccountStreamURL(params: OpenClawDingTalkAddAccountStreamParams) {
  return buildAPIURL('/openclaw/channels/dingtalk/add', {
    accountId: params.accountId?.trim() || 'default',
    ackText: params.ackText?.trim() || undefined,
    agentId: params.agentId?.trim() || undefined,
    allowFrom: params.allowFrom?.trim() || undefined,
    asyncMode: params.asyncMode ? 'true' : 'false',
    chatbotCorpId: params.chatbotCorpId?.trim() || undefined,
    chatbotUserId: params.chatbotUserId?.trim() || undefined,
    clientId: params.clientId.trim(),
    clientSecret: params.clientSecret.trim(),
    debug: params.debug ? 'true' : 'false',
    dmPolicy: params.dmPolicy || 'pairing',
    enableMediaUpload: params.enableMediaUpload ? 'true' : 'false',
    endpoint: params.endpoint?.trim() || undefined,
    groupAllowFrom: params.groupAllowFrom?.trim() || undefined,
    groupPolicy: params.groupPolicy?.trim() === 'inherit' ? undefined : params.groupPolicy?.trim() || undefined,
    groupReplyMode: params.groupReplyMode?.trim() === 'inherit' ? undefined : params.groupReplyMode?.trim() || undefined,
    groupSessionScope: params.groupSessionScope?.trim() === 'inherit' ? undefined : params.groupSessionScope?.trim() || undefined,
    groupsJson: params.groupsJson?.trim() || undefined,
    historyLimit: params.historyLimit?.trim() || undefined,
    mediaMaxMb: params.mediaMaxMb?.trim() || undefined,
    name: params.name?.trim() || undefined,
    requireMention: params.requireMention ? 'true' : 'false',
    resolveSenderNames: params.resolveSenderNames ? 'true' : 'false',
    separateSessionByConversation: params.separateSessionByConversation ? 'true' : 'false',
    sharedMemoryAcrossConversations: params.sharedMemoryAcrossConversations ? 'true' : 'false',
    systemPrompt: params.systemPrompt?.trim() || undefined,
    textChunkLimit: params.textChunkLimit?.trim() || undefined,
    toolsDocs: params.toolsDocs ? 'true' : 'false',
    toolsMedia: params.toolsMedia ? 'true' : 'false',
    typingIndicator: params.typingIndicator ? 'true' : 'false',
  })
}

export function getOpenClawDingTalkUninstallStreamURL() {
  return buildAPIURL('/openclaw/channels/dingtalk/uninstall')
}

export function getOpenClawWeComStatus() {
  return apiRequest<OpenClawWeComStatusResponse>('/openclaw/channels/wecom')
}

export function updateOpenClawWeComConfig(body: OpenClawWeComConfigUpdateRequest) {
  return apiRequest<OpenClawWeComStatusResponse>('/openclaw/channels/wecom/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateOpenClawWeComAccountConfig(accountId: string, body: OpenClawWeComAccountConfigUpdateRequest) {
  return apiRequest<OpenClawWeComStatusResponse>(`/openclaw/channels/wecom/accounts/${encodeURIComponent(accountId)}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteOpenClawWeComAccount(accountId: string) {
  return apiRequest<OpenClawWeComAccountDeleteResponse>(`/openclaw/channels/wecom/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
  })
}

export function getOpenClawWeComInstallStreamURL() {
  return buildAPIURL('/openclaw/channels/wecom/install')
}

export function getOpenClawWeComScanAddStreamURL() {
  return buildAPIURL('/openclaw/channels/wecom/scan-add')
}

export function getOpenClawWeComAddAccountStreamURL(params: OpenClawWeComAddAccountStreamParams) {
  return buildAPIURL('/openclaw/channels/wecom/add', {
    accountId: params.accountId?.trim() || 'default',
    agentId: params.agentId?.trim() || undefined,
    allowFrom: params.allowFrom?.trim() || undefined,
    agentAgentId: params.agentAgentId?.trim() || undefined,
    agentAllowFrom: params.agentAllowFrom?.trim() || undefined,
    agentCorpId: params.agentCorpId?.trim() || undefined,
    agentCorpSecret: params.agentCorpSecret?.trim() || undefined,
    agentDmPolicy: params.agentDmPolicy?.trim() === 'inherit' ? undefined : params.agentDmPolicy?.trim() || undefined,
    agentEncodingAESKey: params.agentEncodingAESKey?.trim() || undefined,
    agentToken: params.agentToken?.trim() || undefined,
    agentWelcomeText: params.agentWelcomeText?.trim() || undefined,
    botId: params.botId?.trim() || undefined,
    connectionMode: params.connectionMode?.trim() || 'websocket',
    dmPolicy: params.dmPolicy || 'open',
    dynamicAdminUsers: params.dynamicAdminUsers?.trim() || undefined,
    dynamicAgentsEnabled: params.dynamicAgentsEnabled ? 'true' : 'false',
    dynamicDmCreateAgent: params.dynamicDmCreateAgent ? 'true' : 'false',
    dynamicGroupEnabled: params.dynamicGroupEnabled ? 'true' : 'false',
    encodingAESKey: params.encodingAESKey?.trim() || undefined,
    groupAllowFrom: params.groupAllowFrom?.trim() || undefined,
    groupPolicy: params.groupPolicy?.trim() || 'open',
    groupsJson: params.groupsJson?.trim() || undefined,
    mediaCleanupOnStart: params.mediaCleanupOnStart ? 'true' : 'false',
    mediaLocalRoots: params.mediaLocalRoots?.trim() || undefined,
    mediaMaxBytes: params.mediaMaxBytes?.trim() || undefined,
    mediaRetentionHours: params.mediaRetentionHours?.trim() || undefined,
    mediaTempDir: params.mediaTempDir?.trim() || undefined,
    name: params.name?.trim() || undefined,
    networkEgressProxyUrl: params.networkEgressProxyUrl?.trim() || undefined,
    networkRetries: params.networkRetries?.trim() || undefined,
    networkRetryDelayMs: params.networkRetryDelayMs?.trim() || undefined,
    networkTimeoutMs: params.networkTimeoutMs?.trim() || undefined,
    receiveId: params.receiveId?.trim() || undefined,
    secret: params.secret?.trim() || undefined,
    sendThinkingMessage: params.sendThinkingMessage ? 'true' : 'false',
    streamPlaceholderContent: params.streamPlaceholderContent?.trim() || undefined,
    token: params.token?.trim() || undefined,
    websocketUrl: params.websocketUrl?.trim() || undefined,
    welcomeText: params.welcomeText?.trim() || undefined,
  })
}

export function getOpenClawWeComUninstallStreamURL() {
  return buildAPIURL('/openclaw/channels/wecom/uninstall')
}

export function getOpenClawMatrixStatus() {
  return apiRequest<OpenClawMatrixStatusResponse>('/openclaw/channels/matrix')
}

export function updateOpenClawMatrixConfig(body: OpenClawMatrixConfigUpdateRequest) {
  return apiRequest<OpenClawMatrixStatusResponse>('/openclaw/channels/matrix/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateOpenClawMatrixAccountConfig(accountId: string, body: OpenClawMatrixAccountConfigUpdateRequest) {
  return apiRequest<OpenClawMatrixStatusResponse>(`/openclaw/channels/matrix/accounts/${encodeURIComponent(accountId)}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteOpenClawMatrixAccount(accountId: string) {
  return apiRequest<OpenClawMatrixAccountDeleteResponse>(`/openclaw/channels/matrix/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
  })
}

export function getOpenClawMatrixAddAccountStreamURL(params: OpenClawMatrixAddAccountStreamParams) {
  return buildAPIURL('/openclaw/channels/matrix/add', {
    accessToken: params.accessToken?.trim() || undefined,
    accountId: params.accountId?.trim() || 'default',
    agentId: params.agentId?.trim() || undefined,
    allowPrivateNetwork: params.allowPrivateNetwork ? 'true' : 'false',
    autoJoin: params.autoJoin?.trim() || undefined,
    autoJoinAllowlist: params.autoJoinAllowlist?.trim() || undefined,
    deviceName: params.deviceName?.trim() || undefined,
    dmAllowFrom: params.dmAllowFrom?.trim() || undefined,
    dmPolicy: params.dmPolicy || 'pairing',
    encryption: params.encryption ? 'true' : 'false',
    groupAllowFrom: params.groupAllowFrom?.trim() || undefined,
    groupPolicy: params.groupPolicy?.trim() || undefined,
    homeserver: params.homeserver.trim(),
    initialSyncLimit: params.initialSyncLimit?.trim() || undefined,
    name: params.name?.trim() || undefined,
    password: params.password?.trim() || undefined,
    userId: params.userId?.trim() || undefined,
  })
}

export function getOpenClawQQBotStatus() {
  return apiRequest<OpenClawQQBotStatusResponse>('/openclaw/channels/qqbot')
}

export function updateOpenClawQQBotConfig(body: OpenClawQQBotConfigUpdateRequest) {
  return apiRequest<OpenClawQQBotStatusResponse>('/openclaw/channels/qqbot/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateOpenClawQQBotAccountConfig(accountId: string, body: OpenClawQQBotAccountConfigUpdateRequest) {
  return apiRequest<OpenClawQQBotStatusResponse>(`/openclaw/channels/qqbot/accounts/${encodeURIComponent(accountId)}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteOpenClawQQBotAccount(accountId: string) {
  return apiRequest<OpenClawQQBotAccountDeleteResponse>(`/openclaw/channels/qqbot/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
  })
}

export function getOpenClawQQBotAddAccountStreamURL(params: OpenClawQQBotAddAccountStreamParams) {
  return buildAPIURL('/openclaw/channels/qqbot/add', {
    accountId: params.accountId?.trim() || 'default',
    agentId: params.agentId?.trim() || undefined,
    allowFrom: params.allowFrom?.trim() || undefined,
    appId: params.appId.trim(),
    clientSecret: params.clientSecret.trim(),
    name: params.name?.trim() || undefined,
    sttApiKey: params.sttApiKey?.trim() || undefined,
    sttBaseUrl: params.sttBaseUrl?.trim() || undefined,
    sttEnabled: params.sttEnabled ? 'true' : 'false',
    sttModel: params.sttModel?.trim() || undefined,
    sttProvider: params.sttProvider?.trim() || undefined,
    systemPrompt: params.systemPrompt?.trim() || undefined,
    ttsApiKey: params.ttsApiKey?.trim() || undefined,
    ttsBaseUrl: params.ttsBaseUrl?.trim() || undefined,
    ttsEnabled: params.ttsEnabled ? 'true' : 'false',
    ttsModel: params.ttsModel?.trim() || undefined,
    ttsProvider: params.ttsProvider?.trim() || undefined,
    ttsResponseType: params.ttsResponseType?.trim() || undefined,
    ttsVoice: params.ttsVoice?.trim() || undefined,
  })
}

export function getOpenClawQQBotInstallStreamURL() {
  return buildAPIURL('/openclaw/channels/qqbot/install')
}

export function getOpenClawQQBotUninstallStreamURL() {
  return buildAPIURL('/openclaw/channels/qqbot/uninstall')
}

export function getOpenClawYuanbaoStatus() {
  return apiRequest<OpenClawYuanbaoStatusResponse>('/openclaw/channels/yuanbao')
}

export function updateOpenClawYuanbaoConfig(body: OpenClawYuanbaoConfigUpdateRequest) {
  return apiRequest<OpenClawYuanbaoStatusResponse>('/openclaw/channels/yuanbao/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateOpenClawYuanbaoAccountConfig(accountId: string, body: OpenClawYuanbaoAccountConfigUpdateRequest) {
  return apiRequest<OpenClawYuanbaoStatusResponse>(`/openclaw/channels/yuanbao/accounts/${encodeURIComponent(accountId)}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteOpenClawYuanbaoAccount(accountId: string) {
  return apiRequest<OpenClawYuanbaoAccountDeleteResponse>(`/openclaw/channels/yuanbao/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
  })
}

export function getOpenClawYuanbaoAddAccountStreamURL(params: OpenClawYuanbaoAddAccountStreamParams) {
  return buildAPIURL('/openclaw/channels/yuanbao/add', {
    accountId: params.accountId?.trim() || 'default',
    agentId: params.agentId?.trim() || undefined,
    appId: params.appId?.trim() || undefined,
    appSecret: params.appSecret?.trim() || undefined,
    name: params.name?.trim() || undefined,
    systemPrompt: params.systemPrompt?.trim() || undefined,
  })
}

export function getOpenClawYuanbaoInstallStreamURL() {
  return buildAPIURL('/openclaw/channels/yuanbao/install')
}

export function getOpenClawYuanbaoUninstallStreamURL() {
  return buildAPIURL('/openclaw/channels/yuanbao/uninstall')
}
