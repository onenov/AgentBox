import { getPublicKeyAsync, signAsync, utils } from '@noble/ed25519'
import { getDesktopStorageValue, setDesktopStorageValueAsync } from '@/utils/desktopStorage'
import { isTauriRuntime } from '@/utils/tauri'

import type {
  OpenClawCronJob,
  OpenClawCronJobCreate,
  OpenClawCronJobPatch,
  OpenClawCronListResponse,
  OpenClawCronRunResponse,
  OpenClawCronRunsResponse,
  OpenClawCronStatusResponse,
  OpenClawCronDeliveryStatus,
  OpenClawCronRunStatus,
  OpenClawSkillDependencyInstallRequest,
  OpenClawSkillInstallRequest,
  OpenClawSkillMutationResponse,
  OpenClawSkillsSearchResponse,
  OpenClawSkillsStatusResponse,
  OpenClawSkillUpdateRequest,
} from './openclaw'

export type OpenClawGatewayFrame =
  | OpenClawGatewayEventFrame
  | OpenClawGatewayRequestFrame
  | OpenClawGatewayResponseFrame

export type OpenClawGatewayEventFrame = {
  event: string
  payload?: unknown
  seq?: number
  stateVersion?: unknown
  type: 'event'
}

export type OpenClawGatewayRequestFrame<TParams = unknown> = {
  id: string
  method: string
  params?: TParams
  type: 'req'
}

export type OpenClawGatewayResponseFrame<TPayload = unknown> = {
  error?: OpenClawGatewayErrorPayload
  id: string
  ok: boolean
  payload?: TPayload
  type: 'res'
}

export type OpenClawGatewayErrorPayload = {
  code?: string
  details?: unknown
  message?: string
  retryAfterMs?: number
  retryable?: boolean
}

export type OpenClawGatewayHello = {
  auth?: {
    deviceToken?: string
    issuedAtMs?: number
    role?: string
    scopes?: string[]
  }
  features?: {
    events?: string[]
    methods?: string[]
  }
  policy?: {
    tickIntervalMs?: number
  }
  protocol?: number
  server?: {
    connId?: string
    version?: string
  }
  snapshot?: {
    sessionDefaults?: {
      defaultAgentId?: string
      mainSessionKey?: string
    }
  }
  type: 'hello-ok'
}

export type OpenClawGatewayConnectParams = {
  auth?: {
    deviceToken?: string
    password?: string
    token?: string
  }
  caps: string[]
  client: {
    id: string
    instanceId?: string
    mode: string
    platform: string
    version: string
  }
  device?: {
    id: string
    nonce: string
    publicKey: string
    signature: string
    signedAt: number
  }
  locale: string
  maxProtocol: 4
  minProtocol: 3
  role: 'operator'
  scopes: string[]
  userAgent: string
}

export type OpenClawGatewayURLOptions = {
  path?: string
  query?: Record<string, boolean | number | string | undefined>
  url?: string
}

export type OpenClawGatewayClientOptions = OpenClawGatewayURLOptions & {
  clientVersion?: string
  password?: string
  protocols?: string | string[]
  requestTimeoutMs?: number
  token?: string
}

export type OpenClawGatewayRequestOptions = {
  id?: string
  timeoutMs?: number
}

export type OpenClawGatewayEventHandler = (
  frame: OpenClawGatewayEventFrame,
  event: MessageEvent<string>,
) => void

export type OpenClawGatewayConnectionState = 'closed' | 'connected' | 'connecting' | 'error' | 'open'
export type OpenClawGatewayConnectionStateHandler = (state: OpenClawGatewayConnectionState) => void

export type OpenClawCostUsageTotals = {
  cacheRead: number
  cacheReadCost: number
  cacheWrite: number
  cacheWriteCost: number
  input: number
  inputCost: number
  missingCostEntries: number
  output: number
  outputCost: number
  totalCost: number
  totalTokens: number
}

export type OpenClawUsageCacheStatus = {
  cachedFiles: number
  pendingFiles: number
  refreshedAt?: number
  staleFiles: number
  status: 'fresh' | 'partial' | 'refreshing' | 'stale'
}

export type OpenClawCostUsageSummary = {
  cacheStatus?: OpenClawUsageCacheStatus
  daily: Array<OpenClawCostUsageTotals & { date: string }>
  days: number
  totals: OpenClawCostUsageTotals
  updatedAt: number
}

export type OpenClawSessionModelUsage = {
  count: number
  model?: string
  provider?: string
  totals: OpenClawCostUsageTotals
}

export type OpenClawSessionsUsageResult = {
  aggregates: {
    byAgent?: Array<{ agentId: string; count?: number; totals: OpenClawCostUsageTotals }>
    byChannel?: Array<{ channel: string; totals: OpenClawCostUsageTotals }>
    byModel?: OpenClawSessionModelUsage[]
    byProvider?: OpenClawSessionModelUsage[]
    daily?: Array<{
      cost: number
      date: string
      errors: number
      messages: number
      tokens: number
      toolCalls: number
    }>
    messages?: {
      assistant: number
      errors: number
      toolCalls: number
      toolResults: number
      total: number
      user: number
    }
    tools?: {
      totalCalls: number
      uniqueTools: number
      tools: Array<{ name: string; count: number }>
    }
    latency?: {
      avgMs: number
      count: number
      maxMs: number
      minMs: number
      p95Ms: number
    }
  }
  cacheStatus?: OpenClawUsageCacheStatus
  endDate: string
  sessions: Array<{
    agentId?: string
    hasActiveRun?: boolean
    key: string
    label?: string
    model?: string
    modelProvider?: string
    sessionId?: string
    updatedAt?: number
    usage?: (OpenClawCostUsageTotals & {
      durationMs?: number
      firstActivity?: number
      lastActivity?: number
      messageCounts?: {
        assistant: number
        errors: number
        toolCalls: number
        toolResults: number
        total: number
        user: number
      }
      toolUsage?: {
        totalCalls: number
        uniqueTools: number
        tools: Array<{ name: string; count: number }>
      }
      utcQuarterHourTokenUsage?: Array<{
        cacheRead?: number
        cacheWrite?: number
        date: string
        input?: number
        output?: number
        quarterIndex: number
        totalCost?: number
        totalTokens: number
      }>
    }) | null
  }>
  startDate: string
  totals: OpenClawCostUsageTotals
  updatedAt: number
}

export type OpenClawSessionsListResult = {
  count?: number
  defaults?: {
    contextTokens?: number | null
    model?: string | null
    modelProvider?: string | null
    thinkingDefault?: string | null
    thinkingOptions?: string[]
  }
  hasMore?: boolean
  limitApplied?: number
  sessions: Array<{
    agentId?: string
    chatType?: string
    contextTokens?: number | null
    endedAt?: number
    hasActiveRun?: boolean
    kind?: string
    key: string
    derivedTitle?: string
    label?: string
    model?: string
    modelProvider?: string
    percentUsed?: number
    provider?: string
    remainingTokens?: number
    runtimeMs?: number
    sessionId?: string
    startedAt?: number
    status?: string
    totalTokens?: number
    totalTokensFresh?: boolean
    updatedAt?: number
  }>
  storePath?: string
  totalCount?: number
  ts?: number
}

export type OpenClawDoctorMemoryStatusPayload = {
  agentId?: string
  dreaming?: unknown
  embedding?: unknown
  provider?: unknown
}

export type OpenClawDoctorMemoryDreamDiaryPayload = {
  agentId?: string
  content?: unknown
  found?: unknown
  path?: unknown
  updatedAtMs?: unknown
}

export type OpenClawDoctorMemoryDreamActionPayload = {
  action?: unknown
  archivedDreamsDiary?: unknown
  archivedSessionCorpus?: unknown
  archivedSessionIngestion?: unknown
  archiveDir?: unknown
  changed?: unknown
  dedupedEntries?: unknown
  found?: unknown
  keptEntries?: unknown
  path?: unknown
  removedEntries?: unknown
  removedShortTermEntries?: unknown
  replaced?: unknown
  scannedFiles?: unknown
  warnings?: unknown
  written?: unknown
}

export type OpenClawPresenceEntry = {
  deviceFamily?: string | null
  host?: string | null
  instanceId?: string | null
  ip?: string | null
  lastInputSeconds?: number | null
  mode?: string | null
  modelIdentifier?: string | null
  platform?: string | null
  reason?: string | null
  roles?: string[] | null
  scopes?: string[] | null
  text?: string | null
  ts?: number | null
  version?: string | null
}

export type OpenClawSessionsUsageParams = {
  endDate?: string
  groupBy?: 'family' | 'instance'
  includeContextWeight?: boolean
  includeHistorical?: boolean
  key?: string
  limit?: number
  mode?: 'gateway' | 'specific' | 'utc'
  range?: '1d' | '1y' | '30d' | '7d' | '90d' | 'all'
  startDate?: string
  utcOffset?: string
}

export type OpenClawUsageCostParams = {
  days?: number
  endDate?: string
  mode?: 'gateway' | 'specific' | 'utc'
  range?: '1d' | '1y' | '30d' | '7d' | '90d' | 'all'
  startDate?: string
  utcOffset?: string
}

export type OpenClawSessionsListParams = {
  activeMinutes?: number
  configuredAgentsOnly?: boolean
  includeDerivedTitles?: boolean
  includeGlobal?: boolean
  includeLastMessage?: boolean
  includeUnknown?: boolean
  label?: string
  limit?: number
  spawnedBy?: string
}

export type OpenClawChatContentBlock = Record<string, unknown>

export type OpenClawChatMessageItem = {
  content?: string | OpenClawChatContentBlock[]
  contextTokens?: number | null
  contextWindow?: number | null
  cost?: {
    total?: number
  }
  id?: string
  key?: string
  mediaUrl?: string
  mediaUrls?: string[]
  model?: string
  modelProvider?: string
  role?: string
  text?: string
  timestamp?: number
  toolName?: string
  tool_name?: string
  usage?: Record<string, number | { total?: number } | undefined>
}

export type OpenClawChatHistoryParams = {
  limit?: number
  maxChars?: number
  sessionKey: string
}

export type OpenClawChatHistoryResult = {
  fastMode?: boolean
  messages?: OpenClawChatMessageItem[]
  sessionId?: string
  sessionKey: string
  thinkingLevel?: string
  verboseLevel?: string
}

export type OpenClawChatAttachment = {
  content?: unknown
  fileName?: string
  mimeType?: string
  type?: string
}

export type OpenClawChatSendParams = {
  attachments?: OpenClawChatAttachment[]
  deliver?: boolean
  fastMode?: boolean
  idempotencyKey: string
  message: string
  originatingAccountId?: string
  originatingChannel?: string
  originatingThreadId?: string
  originatingTo?: string
  sessionId?: string
  sessionKey: string
  thinking?: string
  timeoutMs?: number
}

export type OpenClawChatSendResult = {
  runId?: string
  sessionKey?: string
  status?: string
}

export type OpenClawChatAbortParams = {
  runId?: string
  sessionKey: string
}

export type OpenClawChatAbortResult = {
  aborted?: number
  ok?: boolean
  runId?: string
  status?: string
}

export type OpenClawCommandCategory = 'docks' | 'management' | 'media' | 'options' | 'session' | 'status' | 'tools'

export type OpenClawCommandArg = {
  choices?: Array<{
    label: string
    value: string
  }>
  description: string
  dynamic?: boolean
  name: string
  required?: boolean
  type: 'boolean' | 'number' | 'string'
}

export type OpenClawCommandEntry = {
  acceptsArgs: boolean
  args?: OpenClawCommandArg[]
  category?: OpenClawCommandCategory
  description: string
  name: string
  nativeName?: string
  scope: 'both' | 'native' | 'text'
  source: 'native' | 'plugin' | 'skill'
  textAliases?: string[]
}

export type OpenClawCommandsListParams = {
  agentId?: string
  includeArgs?: boolean
  provider?: string
  scope?: 'both' | 'native' | 'text'
}

export type OpenClawCommandsListResult = {
  commands: OpenClawCommandEntry[]
}

export type OpenClawCronJobsListParams = {
  agentId?: string
  enabled?: 'all' | 'disabled' | 'enabled'
  includeDisabled?: boolean
  limit?: number
  offset?: number
  query?: string
  sortBy?: 'name' | 'nextRunAtMs' | 'updatedAtMs'
  sortDir?: 'asc' | 'desc'
}

export type OpenClawCronRunsParams = {
  deliveryStatus?: OpenClawCronDeliveryStatus
  deliveryStatuses?: OpenClawCronDeliveryStatus[]
  id?: string
  limit?: number
  offset?: number
  query?: string
  scope?: 'all' | 'job'
  sortDir?: 'asc' | 'desc'
  status?: 'all' | OpenClawCronRunStatus
  statuses?: OpenClawCronRunStatus[]
}

const defaultGatewayWebSocketURL = 'ws://127.0.0.1:18789'
const defaultRequestTimeoutMs = 30_000
const connectTimeoutMs = 10_000
const connectDelayMs = 750
const browserDeviceIdentityStorageKey = 'openclaw-device-identity-v1'
const browserDeviceAuthStorageKey = 'openclaw.device.auth.v1'
const operatorRole = 'operator'
const operatorScopes = [
  'operator.admin',
  'operator.read',
  'operator.write',
  'operator.approvals',
  'operator.pairing',
]

type BrowserDeviceIdentity = {
  deviceId: string
  privateKey: string
  publicKey: string
}

type StoredBrowserDeviceIdentity = BrowserDeviceIdentity & {
  createdAtMs: number
  version: 1
}

type BrowserDeviceAuthEntry = {
  role: string
  scopes: string[]
  token: string
  updatedAtMs: number
}

type BrowserDeviceAuthStore = {
  deviceId: string
  tokens: Record<string, BrowserDeviceAuthEntry>
  version: 1
}

type ConnectPlan = {
  deviceIdentity: BrowserDeviceIdentity | null
  params: OpenClawGatewayConnectParams
}

export class OpenClawGatewayRequestError extends Error {
  readonly details?: unknown
  readonly gatewayCode: string
  readonly retryAfterMs?: number
  readonly retryable: boolean

  constructor(error: OpenClawGatewayErrorPayload = {}) {
    super(error.message || error.code || 'OpenClaw Gateway request failed')
    this.name = 'OpenClawGatewayRequestError'
    this.details = error.details
    this.gatewayCode = error.code || 'UNAVAILABLE'
    this.retryAfterMs = error.retryAfterMs
    this.retryable = error.retryable === true
  }
}

export function buildOpenClawGatewayWebSocketURL(options: OpenClawGatewayURLOptions = {}) {
  const url = new URL(options.url || defaultGatewayWebSocketURL)

  if (url.protocol === 'http:') {
    url.protocol = 'ws:'
  } else if (url.protocol === 'https:') {
    url.protocol = 'wss:'
  }

  if (options.path !== undefined) {
    url.pathname = options.path.startsWith('/') ? options.path : `/${options.path}`
  }

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value))
      }
    }
  }

  return url.toString()
}

export function createOpenClawGatewayWebSocket(options: OpenClawGatewayClientOptions = {}) {
  return new WebSocket(buildOpenClawGatewayWebSocketURL(options), options.protocols)
}

export function createOpenClawGatewayRequest<TParams>(
  method: string,
  params?: TParams,
  id = createGatewayMessageId(),
): OpenClawGatewayRequestFrame<TParams> {
  return {
    id,
    method,
    params,
    type: 'req',
  }
}

export function sendOpenClawGatewayRequest<TParams>(
  socket: WebSocket,
  frame: OpenClawGatewayRequestFrame<TParams>,
) {
  if (socket.readyState !== WebSocket.OPEN) {
    throw new Error('OpenClaw Gateway WebSocket is not open')
  }

  socket.send(JSON.stringify(frame))
}

function getSafeLocalStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function base64UrlDecode(input: string) {
  const normalized = input.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    out[index] = binary.charCodeAt(index)
  }

  return out
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function fingerprintPublicKey(publicKey: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', publicKey.slice().buffer)
  return bytesToHex(new Uint8Array(hash))
}

async function generateBrowserDeviceIdentity(): Promise<BrowserDeviceIdentity> {
  const privateKey = utils.randomSecretKey()
  const publicKey = await getPublicKeyAsync(privateKey)
  const deviceId = await fingerprintPublicKey(publicKey)

  return {
    deviceId,
    privateKey: base64UrlEncode(privateKey),
    publicKey: base64UrlEncode(publicKey),
  }
}

async function loadOrCreateBrowserDeviceIdentity(): Promise<BrowserDeviceIdentity> {
  const storage = getSafeLocalStorage()

  try {
    const raw = isTauriRuntime()
      ? await getDesktopStorageValue<string>(browserDeviceIdentityStorageKey)
      : storage?.getItem(browserDeviceIdentityStorageKey)
    if (raw) {
      const parsed = JSON.parse(raw) as StoredBrowserDeviceIdentity
      if (
        parsed?.version === 1 &&
        typeof parsed.deviceId === 'string' &&
        typeof parsed.privateKey === 'string' &&
        typeof parsed.publicKey === 'string'
      ) {
        const derivedId = await fingerprintPublicKey(base64UrlDecode(parsed.publicKey))
        if (derivedId !== parsed.deviceId) {
          await writeBrowserDeviceIdentity({ ...parsed, deviceId: derivedId })
          return { deviceId: derivedId, privateKey: parsed.privateKey, publicKey: parsed.publicKey }
        }

        return {
          deviceId: parsed.deviceId,
          privateKey: parsed.privateKey,
          publicKey: parsed.publicKey,
        }
      }
    }
  } catch {
    // Regenerate below when stored identity is unreadable.
  }

  const identity = await generateBrowserDeviceIdentity()
  const stored: StoredBrowserDeviceIdentity = {
    ...identity,
    createdAtMs: Date.now(),
    version: 1,
  }

  await writeBrowserDeviceIdentity(stored)
  return identity
}

async function writeBrowserDeviceIdentity(stored: StoredBrowserDeviceIdentity) {
  const raw = JSON.stringify(stored)
  if (isTauriRuntime()) {
    await setDesktopStorageValueAsync(browserDeviceIdentityStorageKey, raw)
  }
  getSafeLocalStorage()?.setItem(browserDeviceIdentityStorageKey, raw)
}

function buildDeviceAuthPayload(params: {
  clientId: string
  clientMode: string
  deviceId: string
  nonce: string
  role: string
  scopes: string[]
  signedAtMs: number
  token?: string | null
}) {
  return [
    'v2',
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(','),
    String(params.signedAtMs),
    params.token ?? '',
    params.nonce,
  ].join('|')
}

async function signDevicePayload(privateKeyBase64Url: string, payload: string) {
  const key = base64UrlDecode(privateKeyBase64Url)
  const data = new TextEncoder().encode(payload)
  const signature = await signAsync(data, key)

  return base64UrlEncode(signature)
}

async function readDeviceAuthStore(): Promise<BrowserDeviceAuthStore | null> {
  try {
    const raw = isTauriRuntime()
      ? await getDesktopStorageValue<string>(browserDeviceAuthStorageKey)
      : getSafeLocalStorage()?.getItem(browserDeviceAuthStorageKey)
    if (!raw) return null

    const parsed = JSON.parse(raw) as BrowserDeviceAuthStore
    if (
      parsed?.version !== 1 ||
      typeof parsed.deviceId !== 'string' ||
      !parsed.tokens ||
      typeof parsed.tokens !== 'object'
    ) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

async function writeDeviceAuthStore(store: BrowserDeviceAuthStore) {
  try {
    const raw = JSON.stringify(store)
    if (isTauriRuntime()) {
      await setDesktopStorageValueAsync(browserDeviceAuthStorageKey, raw)
    }
    getSafeLocalStorage()?.setItem(browserDeviceAuthStorageKey, raw)
  } catch {
    // Best effort.
  }
}

function normalizeDeviceAuthScopes(scopes?: string[]) {
  const out = new Set<string>()

  for (const scope of scopes ?? []) {
    const trimmed = scope.trim()
    if (trimmed) out.add(trimmed)
  }

  if (out.has('operator.admin')) {
    out.add('operator.read')
    out.add('operator.write')
  } else if (out.has('operator.write')) {
    out.add('operator.read')
  }

  return Array.from(out).sort()
}

async function loadDeviceAuthToken(deviceId: string, role: string) {
  const store = await readDeviceAuthStore()
  if (!store || store.deviceId !== deviceId) return null

  const entry = store.tokens[role.trim()]
  return typeof entry?.token === 'string' ? entry : null
}

async function storeDeviceAuthToken(params: {
  deviceId: string
  role: string
  scopes?: string[]
  token: string
}) {
  const existing = await readDeviceAuthStore()
  const role = params.role.trim()
  const store: BrowserDeviceAuthStore = {
    deviceId: params.deviceId,
    tokens:
      existing && existing.deviceId === params.deviceId && existing.tokens
        ? { ...existing.tokens }
        : {},
    version: 1,
  }

  store.tokens[role] = {
    role,
    scopes: normalizeDeviceAuthScopes(params.scopes),
    token: params.token,
    updatedAtMs: Date.now(),
  }

  await writeDeviceAuthStore(store)
}

async function clearDeviceAuthToken(deviceId: string, role: string) {
  const store = await readDeviceAuthStore()
  if (!store || store.deviceId !== deviceId) return

  const next: BrowserDeviceAuthStore = {
    deviceId: store.deviceId,
    tokens: { ...store.tokens },
    version: 1,
  }

  delete next.tokens[role.trim()]
  await writeDeviceAuthStore(next)
}

function readConnectErrorDetailCode(error: OpenClawGatewayRequestError) {
  const details = error.details

  if (details && typeof details === 'object' && 'code' in details) {
    const code = (details as { code?: unknown }).code
    return typeof code === 'string' ? code : null
  }

  return error.gatewayCode
}

export function waitForOpenClawGatewayOpen(socket: WebSocket, timeoutMs = 10_000) {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('OpenClaw Gateway WebSocket open timed out'))
    }, timeoutMs)

    const handleOpen = () => {
      cleanup()
      resolve()
    }

    const handleError = () => {
      cleanup()
      reject(new Error('OpenClaw Gateway WebSocket failed to open'))
    }

    const cleanup = () => {
      window.clearTimeout(timeout)
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('error', handleError)
    }

    socket.addEventListener('open', handleOpen, { once: true })
    socket.addEventListener('error', handleError, { once: true })
  })
}

export class OpenClawGatewayClient {
  private connectNonce: string | null = null
  private connectPromise: Promise<OpenClawGatewayHello> | null = null
  private connectTimer: number | null = null
  private connectWasSent = false
  private deviceIdentity: BrowserDeviceIdentity | null = null
  private hello: OpenClawGatewayHello | null = null
  private readonly connectionStateHandlers = new Set<OpenClawGatewayConnectionStateHandler>()
  private readonly eventHandlers = new Set<OpenClawGatewayEventHandler>()
  private readonly options: OpenClawGatewayClientOptions
  private readonly pending = new Map<string, PendingGatewayRequest>()
  private socket: WebSocket | null = null

  constructor(options: OpenClawGatewayClientOptions = {}) {
    this.options = options
  }

  connect() {
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
      return this.socket
    }

    const socket = createOpenClawGatewayWebSocket(this.options)

    socket.addEventListener('open', this.handleOpen)
    socket.addEventListener('message', this.handleMessage)
    socket.addEventListener('close', this.handleClose)
    socket.addEventListener('error', this.handleError)

    this.socket = socket
    this.hello = null
    this.connectWasSent = false
    this.connectNonce = null
    this.connectPromise = null
    this.emitConnectionState('connecting')

    return socket
  }

  async ready(timeoutMs = connectTimeoutMs) {
    if (this.hello) return this.hello

    this.connect()

    if (!this.connectPromise) {
      this.connectPromise = new Promise<OpenClawGatewayHello>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          cleanup()
          reject(new Error('OpenClaw Gateway connect timed out'))
        }, timeoutMs)

        const handleHello = (hello: OpenClawGatewayHello) => {
          cleanup()
          resolve(hello)
        }

        const handleReject = (err: Error) => {
          cleanup()
          reject(err)
        }

        const cleanup = () => {
          window.clearTimeout(timeout)
          this.connectHelloResolvers.delete(handleHello)
          this.connectRejectResolvers.delete(handleReject)
        }

        this.connectHelloResolvers.add(handleHello)
        this.connectRejectResolvers.add(handleReject)
      })
    }

    return this.connectPromise
  }

  close(code?: number, reason?: string) {
    if (!this.socket) return

    this.clearConnectTimer()
    this.socket.removeEventListener('open', this.handleOpen)
    this.socket.removeEventListener('message', this.handleMessage)
    this.socket.removeEventListener('close', this.handleClose)
    this.socket.removeEventListener('error', this.handleError)
    this.socket.close(code, reason)
    this.socket = null
    this.rejectPending(new Error('OpenClaw Gateway WebSocket closed'))
  }

  onEvent(handler: OpenClawGatewayEventHandler) {
    this.eventHandlers.add(handler)

    return () => {
      this.eventHandlers.delete(handler)
    }
  }

  onConnectionState(handler: OpenClawGatewayConnectionStateHandler) {
    this.connectionStateHandlers.add(handler)

    return () => {
      this.connectionStateHandlers.delete(handler)
    }
  }

  async request<TParams = unknown, TPayload = unknown>(
    method: string,
    params?: TParams,
    options: OpenClawGatewayRequestOptions = {},
  ) {
    const id = options.id || createGatewayMessageId()
    const timeoutMs = options.timeoutMs ?? this.options.requestTimeoutMs ?? defaultRequestTimeoutMs

    await this.ready(timeoutMs)

    const response = new Promise<TPayload>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`OpenClaw Gateway request timed out: ${method}`))
      }, timeoutMs)

      this.pending.set(id, {
        method,
        reject,
        resolve: resolve as (payload: unknown) => void,
        timeout,
      })
    })

    sendOpenClawGatewayRequest(this.connect(), createOpenClawGatewayRequest(method, params, id))

    return response
  }

  sessionsList(params: OpenClawSessionsListParams = {}, options?: OpenClawGatewayRequestOptions) {
    return this.request<OpenClawSessionsListParams, OpenClawSessionsListResult>(
      'sessions.list',
      params,
      options,
    )
  }

  chatHistory(params: OpenClawChatHistoryParams, options?: OpenClawGatewayRequestOptions) {
    return this.request<OpenClawChatHistoryParams, OpenClawChatHistoryResult>(
      'chat.history',
      params,
      options,
    )
  }

  chatSend(params: OpenClawChatSendParams, options?: OpenClawGatewayRequestOptions) {
    return this.request<OpenClawChatSendParams, OpenClawChatSendResult>(
      'chat.send',
      params,
      options,
    )
  }

  chatAbort(params: OpenClawChatAbortParams, options?: OpenClawGatewayRequestOptions) {
    return this.request<OpenClawChatAbortParams, OpenClawChatAbortResult>(
      'chat.abort',
      params,
      options,
    )
  }

  commandsList(params: OpenClawCommandsListParams = {}, options?: OpenClawGatewayRequestOptions) {
    return this.request<OpenClawCommandsListParams, OpenClawCommandsListResult>(
      'commands.list',
      params,
      options,
    )
  }

  sessionsUsage(params: OpenClawSessionsUsageParams = {}, options?: OpenClawGatewayRequestOptions) {
    return this.request<OpenClawSessionsUsageParams, OpenClawSessionsUsageResult>(
      'sessions.usage',
      params,
      options,
    )
  }

  usageCost(params: OpenClawUsageCostParams = {}, options?: OpenClawGatewayRequestOptions) {
    return this.request<OpenClawUsageCostParams, OpenClawCostUsageSummary>(
      'usage.cost',
      params,
      options,
    )
  }

  usageStatus<TPayload = unknown>(options?: OpenClawGatewayRequestOptions) {
    return this.request<Record<string, never>, TPayload>('usage.status', {}, options)
  }

  systemPresence(options?: OpenClawGatewayRequestOptions) {
    return this.request<Record<string, never>, OpenClawPresenceEntry[]>(
      'system-presence',
      {},
      options,
    )
  }

  skillsStatus(params: { agentId?: string } = {}, options?: OpenClawGatewayRequestOptions) {
    return this.request<{ agentId?: string }, OpenClawSkillsStatusResponse>(
      'skills.status',
      params,
      options,
    )
  }

  skillsSearch(params: { limit?: number; query?: string } = {}, options?: OpenClawGatewayRequestOptions) {
    return this.request<{ limit?: number; query?: string }, OpenClawSkillsSearchResponse>(
      'skills.search',
      params,
      options,
    )
  }

  skillsInstallFromClawHub(
    request: OpenClawSkillInstallRequest,
    options?: OpenClawGatewayRequestOptions,
  ) {
    const { force, slug, version } = request

    return this.request<
      { force?: boolean; source: 'clawhub'; slug: string; version?: string },
      OpenClawSkillMutationResponse
    >('skills.install', { force, source: 'clawhub', slug, version }, options)
  }

  skillsInstallDependency(
    request: OpenClawSkillDependencyInstallRequest,
    options?: OpenClawGatewayRequestOptions,
  ) {
    return this.request<OpenClawSkillDependencyInstallRequest, OpenClawSkillMutationResponse>(
      'skills.install',
      request,
      options,
    )
  }

  skillsUpdate(
    skillKey: string,
    request: OpenClawSkillUpdateRequest,
    options?: OpenClawGatewayRequestOptions,
  ) {
    return this.request<
      OpenClawSkillUpdateRequest & { skillKey: string },
      OpenClawSkillMutationResponse
    >('skills.update', { skillKey, ...request }, options)
  }

  doctorMemoryStatus(options?: OpenClawGatewayRequestOptions) {
    return this.request<Record<string, never>, OpenClawDoctorMemoryStatusPayload>(
      'doctor.memory.status',
      {},
      options,
    )
  }

  doctorMemoryDreamDiary(options?: OpenClawGatewayRequestOptions) {
    return this.request<Record<string, never>, OpenClawDoctorMemoryDreamDiaryPayload>(
      'doctor.memory.dreamDiary',
      {},
      options,
    )
  }

  doctorMemoryBackfillDreamDiary(options?: OpenClawGatewayRequestOptions) {
    return this.request<Record<string, never>, OpenClawDoctorMemoryDreamActionPayload>(
      'doctor.memory.backfillDreamDiary',
      {},
      options,
    )
  }

  doctorMemoryResetDreamDiary(options?: OpenClawGatewayRequestOptions) {
    return this.request<Record<string, never>, OpenClawDoctorMemoryDreamActionPayload>(
      'doctor.memory.resetDreamDiary',
      {},
      options,
    )
  }

  doctorMemoryResetGroundedShortTerm(options?: OpenClawGatewayRequestOptions) {
    return this.request<Record<string, never>, OpenClawDoctorMemoryDreamActionPayload>(
      'doctor.memory.resetGroundedShortTerm',
      {},
      options,
    )
  }

  cronStatus(options?: OpenClawGatewayRequestOptions) {
    return this.request<Record<string, never>, OpenClawCronStatusResponse>('cron.status', {}, options)
  }

  cronJobs(params: OpenClawCronJobsListParams = {}, options?: OpenClawGatewayRequestOptions) {
    return this.request<OpenClawCronJobsListParams, OpenClawCronListResponse>(
      'cron.list',
      params,
      options,
    )
  }

  cronAdd(body: OpenClawCronJobCreate, options?: OpenClawGatewayRequestOptions) {
    return this.request<OpenClawCronJobCreate, OpenClawCronJob>('cron.add', body, options)
  }

  cronUpdate(id: string, patch: OpenClawCronJobPatch, options?: OpenClawGatewayRequestOptions) {
    return this.request<{ id: string; patch: OpenClawCronJobPatch }, OpenClawCronJob>(
      'cron.update',
      { id, patch },
      options,
    )
  }

  cronRemove(id: string, options?: OpenClawGatewayRequestOptions) {
    return this.request<{ id: string }, { ok: boolean; removed?: boolean }>(
      'cron.remove',
      { id },
      options,
    )
  }

  cronRun(id: string, mode: 'due' | 'force' = 'force', options?: OpenClawGatewayRequestOptions) {
    return this.request<{ id: string; mode: 'due' | 'force' }, OpenClawCronRunResponse>(
      'cron.run',
      { id, mode },
      options,
    )
  }

  cronRuns(params: OpenClawCronRunsParams = {}, options?: OpenClawGatewayRequestOptions) {
    return this.request<OpenClawCronRunsParams, OpenClawCronRunsResponse>(
      'cron.runs',
      params,
      options,
    )
  }

  private readonly connectHelloResolvers = new Set<(hello: OpenClawGatewayHello) => void>()
  private readonly connectRejectResolvers = new Set<(err: Error) => void>()

  private handleOpen = () => {
    this.emitConnectionState('open')
    this.clearConnectTimer()
    this.connectTimer = window.setTimeout(() => {
      this.connectTimer = null
      this.sendConnect()
    }, connectDelayMs)
  }

  private handleMessage = (event: MessageEvent<string>) => {
    const frame = parseGatewayFrame(event.data)

    if (!frame) return

    if (frame.type === 'event') {
      if (frame.event === 'connect.challenge') {
        const payload = frame.payload as { nonce?: unknown } | undefined
        this.connectNonce = typeof payload?.nonce === 'string' ? payload.nonce : null
        this.sendConnect()
        return
      }

      for (const handler of this.eventHandlers) {
        handler(frame, event)
      }
      return
    }

    if (frame.type !== 'res') return

    const pending = this.pending.get(frame.id)

    if (!pending) return

    window.clearTimeout(pending.timeout)
    this.pending.delete(frame.id)

    if (frame.ok) {
      if (pending.method === 'connect') {
        const hello = frame.payload as OpenClawGatewayHello

        this.hello = hello
        if (hello.auth?.deviceToken && this.deviceIdentity) {
          void storeDeviceAuthToken({
            deviceId: this.deviceIdentity.deviceId,
            role: hello.auth.role ?? operatorRole,
            scopes: hello.auth.scopes,
            token: hello.auth.deviceToken,
          })
        }
        this.emitConnectionState('connected')
        for (const resolve of this.connectHelloResolvers) resolve(hello)
      }
      pending.resolve(frame.payload)
    } else {
      const error = new OpenClawGatewayRequestError(frame.error)

      if (pending.method === 'connect') {
        this.connectPromise = null
        if (
          error instanceof OpenClawGatewayRequestError &&
          this.deviceIdentity &&
          readConnectErrorDetailCode(error) === 'AUTH_DEVICE_TOKEN_MISMATCH'
        ) {
          void clearDeviceAuthToken(this.deviceIdentity.deviceId, operatorRole)
        }
      }
      pending.reject(error)
    }
  }

  private handleClose = () => {
    this.clearConnectTimer()
    this.hello = null
    this.connectPromise = null
    this.connectWasSent = false
    this.emitConnectionState('closed')
    const error = new Error('OpenClaw Gateway WebSocket closed')

    this.rejectPending(error)
    for (const reject of this.connectRejectResolvers) reject(error)
  }

  private handleError = () => {
    this.emitConnectionState('error')
    this.rejectPending(new Error('OpenClaw Gateway WebSocket error'))
  }

  private emitConnectionState(state: OpenClawGatewayConnectionState) {
    for (const handler of this.connectionStateHandlers) handler(state)
  }

  private async sendConnect() {
    const socket = this.socket

    if (!socket || socket.readyState !== WebSocket.OPEN || this.connectWasSent) return

    this.clearConnectTimer()
    this.connectWasSent = true

    let plan: ConnectPlan

    try {
      plan = await this.buildConnectPlan()
    } catch (err) {
      this.connectWasSent = false
      this.connectPromise = null
      const error = err instanceof Error ? err : new Error('OpenClaw Gateway connect failed')

      for (const reject of this.connectRejectResolvers) reject(error)
      return
    }

    if (!this.socket || this.socket !== socket || socket.readyState !== WebSocket.OPEN) return

    this.deviceIdentity = plan.deviceIdentity

    const id = createGatewayMessageId()
    const timeout = window.setTimeout(() => {
      this.pending.delete(id)
      const error = new Error('OpenClaw Gateway connect timed out')

      for (const reject of this.connectRejectResolvers) reject(error)
    }, connectTimeoutMs)

    this.pending.set(id, {
      method: 'connect',
      reject: (err) => {
        for (const reject of this.connectRejectResolvers) reject(err)
      },
      resolve: () => undefined,
      timeout,
    })

    sendOpenClawGatewayRequest(socket, createOpenClawGatewayRequest('connect', plan.params, id))
  }

  private async buildConnectPlan(): Promise<ConnectPlan> {
    const token = this.options.token?.trim()
    const password = this.options.password?.trim()
    const client = {
      id: 'openclaw-control-ui',
      mode: 'webchat',
      platform: getBrowserPlatform(),
      version: this.options.clientVersion || 'clawpanel',
    }
    const scopes = [...operatorScopes]
    const auth: OpenClawGatewayConnectParams['auth'] = {}
    const canUseBrowserIdentity = typeof crypto !== 'undefined' && Boolean(crypto.subtle)
    const deviceIdentity = canUseBrowserIdentity ? await loadOrCreateBrowserDeviceIdentity() : null
    const storedDeviceAuth = deviceIdentity ? await loadDeviceAuthToken(deviceIdentity.deviceId, operatorRole) : null
    const storedDeviceToken =
      storedDeviceAuth &&
      (storedDeviceAuth.scopes.includes('operator.read') ||
        storedDeviceAuth.scopes.includes('operator.write') ||
        storedDeviceAuth.scopes.includes('operator.admin'))
        ? storedDeviceAuth.token
        : undefined

    if (token) auth.token = token
    if (password) auth.password = password
    if (storedDeviceToken && !(token || password)) {
      auth.token = storedDeviceToken
    }

    const authTokenForSignature = auth.token ?? auth.deviceToken ?? null
    const signedAt = Date.now()
    const nonce = this.connectNonce ?? ''
    const device =
      deviceIdentity && canUseBrowserIdentity
        ? {
            id: deviceIdentity.deviceId,
            nonce,
            publicKey: deviceIdentity.publicKey,
            signature: await signDevicePayload(
              deviceIdentity.privateKey,
              buildDeviceAuthPayload({
                clientId: client.id,
                clientMode: client.mode,
                deviceId: deviceIdentity.deviceId,
                nonce,
                role: operatorRole,
                scopes,
                signedAtMs: signedAt,
                token: authTokenForSignature,
              }),
            ),
            signedAt,
          }
        : undefined

    return {
      deviceIdentity,
      params: {
        auth: Object.keys(auth).length > 0 ? auth : undefined,
        caps: ['tool-events'],
        client,
        device,
        locale: typeof navigator !== 'undefined' ? navigator.language : 'zh-CN',
        maxProtocol: 4,
        minProtocol: 3,
        role: operatorRole,
        scopes,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'clawpanel',
      },
    }
  }

  private clearConnectTimer() {
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

type PendingGatewayRequest = {
  method: string
  reject: (error: Error) => void
  resolve: (payload: unknown) => void
  timeout: number
}

function parseGatewayFrame(data: string): OpenClawGatewayFrame | null {
  try {
    const parsed = JSON.parse(data) as OpenClawGatewayFrame

    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

function createGatewayMessageId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `gateway-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function getBrowserPlatform() {
  return typeof navigator !== 'undefined' && navigator.platform ? navigator.platform : 'web'
}
