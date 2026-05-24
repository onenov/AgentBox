/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import {
  getOpenClawConfig,
  listOpenClawAgents,
  resolveOpenClawGatewayWebSocketURL,
  OpenClawGatewayClient,
  type OpenClawChatAttachment,
  type OpenClawChatMessageItem,
  type OpenClawCommandEntry,
  type OpenClawConfigResponse,
  type OpenClawGatewayEventFrame,
  type OpenClawGatewayHello,
  type OpenClawSessionsListResult,
} from '@/api'
import { useOpenClawEnvironmentStore } from '@/stores/openclaw-environment'

type ConnectionStatus = 'connecting' | 'error' | 'ready'

export type OpenClawChatToolCall = {
  description?: string
  icon?: string
  id: string
  name: string
  result?: string
  status: 'done' | 'error' | 'pending' | 'running'
}

export type OpenClawChatMessageMeta = {
  cacheRead?: number
  cacheWrite?: number
  contextPercent?: number
  cost?: number
  input?: number
  model?: string
  output?: number
}

export type OpenClawChatFile = {
  dataUrl?: string
  id: string
  mimeType?: string
  name: string
  size?: number
  url?: string
}

export type OpenClawChatMessage = {
  content: string
  files?: OpenClawChatFile[]
  id: string
  images?: string[]
  meta?: OpenClawChatMessageMeta
  reasoning?: string
  role: 'assistant' | 'user'
  streaming?: boolean
  timestamp: number
  tools?: OpenClawChatToolCall[]
}

type ToolTranscriptBatch = OpenClawChatMessage & {
  role: 'assistant'
  tools: OpenClawChatToolCall[]
}

export type OpenClawChatSession = {
  agentId?: string
  channelId?: string
  channel?: string
  contextTokens?: number | null
  displayName?: string
  key: string
  label?: string
  model?: string
  modelProvider?: string
  sessionId?: string
  title: string
  updatedAt?: number
}

export type OpenClawChatAttachmentDraft = {
  category: 'file' | 'image'
  data: string
  id: string
  mimeType?: string
  name: string
  size?: number
}

export type OpenClawChatModelOption = {
  id: string
  isPrimary: boolean
  label: string
  modelId: string
  provider: string
}

export type OpenClawChatAgentOption = {
  emoji?: string
  id: string
  isDefault?: boolean
  label: string
  model?: string
}

export type OpenClawChatSlashCommand = OpenClawCommandEntry

type OpenClawChatContextValue = {
  abortCurrentRun: () => Promise<void>
  addAttachments: (files: FileList | File[]) => Promise<void>
  agentOptions: OpenClawChatAgentOption[]
  attachments: OpenClawChatAttachmentDraft[]
  connectionDetail: string
  connectionStatus: ConnectionStatus
  createSession: () => void
  currentRunId: string | null
  currentSession: OpenClawChatSession | null
  currentSessionKey: string | null
  error: string
  gatewayVersion: string
  isLoadingMessages: boolean
  isLoadingSessions: boolean
  isSending: boolean
  isSwitchingModel: boolean
  messages: OpenClawChatMessage[]
  modelOptions: OpenClawChatModelOption[]
  refresh: () => Promise<void>
  reloadMessages: () => Promise<void>
  removeAttachment: (id: string) => void
  selectAgent: (agentId: string) => void
  selectSession: (key: string) => void
  sendMessage: (text: string) => Promise<void>
  selectedAgentId: string
  selectedModel: string
  showToolCards: boolean
  sessions: OpenClawChatSession[]
  slashCommands: OpenClawChatSlashCommand[]
  switchModel: (model: string) => Promise<void>
  toggleToolCards: () => void
}

type OpenClawSessionListItem = OpenClawSessionsListResult['sessions'][number] & {
  deliveryContext?: Record<string, unknown>
  lastChannel?: string
  origin?: Record<string, unknown>
}

const OpenClawChatContext = createContext<OpenClawChatContextValue | null>(null)
const silentReplyPattern = /^(?:\s*NO_REPLY\s*|\s*HEARTBEAT_OK\s*|Model\s+(?:set to|reset to default)\b.*)$/i
const envelopePrefix = /^\[([^\]]+)\]\s*/
const inboundMetaSentinels = [
  'Conversation info (untrusted metadata):',
  'Sender (untrusted metadata):',
  'Thread starter (untrusted, for context):',
  'Replied message (untrusted, for context):',
  'Forwarded message context (untrusted metadata):',
  'Chat history since last reply (untrusted, for context):',
]

export function OpenClawChatProvider({ children }: { children: ReactNode }) {
  const loadOpenClawEnvironment = useOpenClawEnvironmentStore((store) => store.loadOpenClawEnvironment)
  const [agentOptions, setAgentOptions] = useState<OpenClawChatAgentOption[]>([])
  const [attachments, setAttachments] = useState<OpenClawChatAttachmentDraft[]>([])
  const [connectionDetail, setConnectionDetail] = useState('正在连接 OpenClaw Gateway')
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')
  const [currentRunId, setCurrentRunId] = useState<string | null>(null)
  const [currentSessionKey, setCurrentSessionKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [gatewayVersion, setGatewayVersion] = useState('')
  const [isLoadingMessages, setLoadingMessages] = useState(false)
  const [isLoadingSessions, setLoadingSessions] = useState(false)
  const [isSending, setSending] = useState(false)
  const [isSwitchingModel, setSwitchingModel] = useState(false)
  const [messages, setMessages] = useState<OpenClawChatMessage[]>([])
  const [modelOptions, setModelOptions] = useState<OpenClawChatModelOption[]>([])
  const [modelBySession, setModelBySession] = useState<Record<string, string>>({})
  const [showToolCards, setShowToolCards] = useState(true)
  const [sessions, setSessions] = useState<OpenClawChatSession[]>([])
  const [slashCommands, setSlashCommands] = useState<OpenClawChatSlashCommand[]>([])

  const clientRef = useRef<OpenClawGatewayClient | null>(null)
  const currentRunIdRef = useRef<string | null>(null)
  const currentSessionKeyRef = useRef<string | null>(null)
  const defaultSessionKeyRef = useRef<string | null>(null)
  const optimisticSessionKeysRef = useRef<Set<string>>(new Set())
  const sessionAliasesRef = useRef<Record<string, string>>({})
  const sessionsRef = useRef<OpenClawChatSession[]>([])
  const connectSeqRef = useRef(0)
  const messagesSeqRef = useRef(0)
  const sessionsSeqRef = useRef(0)

  const currentSession = useMemo(
    () => sessions.find((session) => session.key === currentSessionKey) ?? null,
    [currentSessionKey, sessions],
  )
  const selectedAgentId = currentSession?.agentId || parseSessionInfo(currentSessionKey || '').agentId || agentOptions[0]?.id || 'main'
  const selectedModel = useMemo(() => {
    if (currentSessionKey && modelBySession[currentSessionKey]) return modelBySession[currentSessionKey]
    const serverModel = resolveModelLabel(currentSession?.modelProvider, currentSession?.model)
    if (serverModel) return serverModel
    const primary = modelOptions.find((option) => option.isPrimary)
    return primary?.id ?? modelOptions[0]?.id ?? ''
  }, [currentSession, currentSessionKey, modelBySession, modelOptions])

  useEffect(() => {
    currentSessionKeyRef.current = currentSessionKey
  }, [currentSessionKey])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    currentRunIdRef.current = currentRunId
  }, [currentRunId])

  const setActiveSessionKey = useCallback((key: string | null) => {
    currentSessionKeyRef.current = key
    setCurrentSessionKey(key)
  }, [])

  const loadSessions = useCallback(async (preferredSessionKey?: string | null) => {
    const client = clientRef.current
    if (!client) return

    const requestId = ++sessionsSeqRef.current
    setLoadingSessions(true)

    try {
      const result = await client.sessionsList({
        includeDerivedTitles: true,
        includeGlobal: true,
        includeUnknown: true,
        limit: 200,
      })
      if (requestId !== sessionsSeqRef.current) return

      const nextSessions = normalizeSessions(result)
      const nextSessionKeys = new Set(nextSessions.map((session) => session.key))
      for (const key of Array.from(optimisticSessionKeysRef.current)) {
        if (nextSessionKeys.has(key)) optimisticSessionKeysRef.current.delete(key)
      }
      const visibleSessions = mergeOptimisticSessions(nextSessions, sessionsRef.current, optimisticSessionKeysRef.current)
      sessionsRef.current = visibleSessions
      setSessions(visibleSessions)
      setModelBySession((current) => {
        const next = { ...current }
        for (const session of visibleSessions) {
          const model = resolveModelLabel(session.modelProvider, session.model)
          if (model && !next[session.key]) next[session.key] = model
        }
        return next
      })
      setCurrentSessionKey((current) => {
        const currentKey = resolveSessionAlias(current, sessionAliasesRef.current)
        const preferredKey = resolveSessionAlias(preferredSessionKey ?? null, sessionAliasesRef.current)
        const nextKey = chooseCurrentSessionKey(visibleSessions, currentKey, preferredKey)
        currentSessionKeyRef.current = nextKey
        return nextKey
      })
    } finally {
      if (requestId === sessionsSeqRef.current) setLoadingSessions(false)
    }
  }, [])

  const loadMessages = useCallback(async (sessionKey = currentSessionKeyRef.current) => {
    const client = clientRef.current
    if (!client || !sessionKey) return

    const requestId = ++messagesSeqRef.current
    setLoadingMessages(true)

    try {
      const result = await client.chatHistory({ limit: 200, sessionKey })
      if (requestId !== messagesSeqRef.current || currentSessionKeyRef.current !== sessionKey) return

      setMessages(
        normalizeGatewayMessages(result.messages ?? []).filter(isDisplayableMessage),
      )
    } catch (err) {
      if (requestId === messagesSeqRef.current) {
        setError(err instanceof Error ? err.message : '消息历史加载失败')
      }
    } finally {
      if (requestId === messagesSeqRef.current) setLoadingMessages(false)
    }
  }, [])

  const loadSlashCommands = useCallback(async (agentId?: string | null) => {
    const client = clientRef.current
    if (!client) return

    try {
      const result = await client.commandsList({
        agentId: agentId || undefined,
        includeArgs: true,
        scope: 'both',
      })
      setSlashCommands(normalizeSlashCommands(result.commands))
    } catch {
      setSlashCommands(fallbackSlashCommands)
    }
  }, [])

  const promoteSessionKey = useCallback((fromKey: string | null | undefined, toKey: string | null | undefined) => {
    const previousKey = fromKey?.trim()
    const nextKey = toKey?.trim()
    if (!previousKey || !nextKey || previousKey === nextKey) return

    sessionAliasesRef.current[previousKey] = nextKey
    optimisticSessionKeysRef.current.delete(previousKey)
    optimisticSessionKeysRef.current.add(nextKey)
    const nextSessions = promoteSessionInList(sessionsRef.current, previousKey, nextKey)
    sessionsRef.current = nextSessions
    setSessions(nextSessions)
    setCurrentSessionKey((current) => {
      if (current !== previousKey) return current
      currentSessionKeyRef.current = nextKey
      return nextKey
    })
  }, [])

  const handleGatewayEvent = useCallback((frame: OpenClawGatewayEventFrame) => {
    if (frame.event === 'chat') {
      handleChatEvent(frame.payload, {
        clearRun: () => {
          setCurrentRunId(null)
          currentRunIdRef.current = null
          setSending(false)
        },
        loadMessages,
        loadSessions,
        noteSessionKey: (sessionKey, runId) => {
          const selectedSessionKey = currentSessionKeyRef.current
          if (!selectedSessionKey || selectedSessionKey === sessionKey) return
          const activeRunId = currentRunIdRef.current
          if (runId && activeRunId && runId === activeRunId) {
            promoteSessionKey(selectedSessionKey, sessionKey)
          }
        },
        shouldHandleSession: (sessionKey, runId) => {
          const selectedSessionKey = currentSessionKeyRef.current
          if (!sessionKey || !selectedSessionKey) return true
          if (sessionKey === selectedSessionKey) return true
          if (sessionAliasesRef.current[selectedSessionKey] === sessionKey) return true

          const activeRunId = currentRunIdRef.current
          return Boolean(
            runId
            && activeRunId
            && runId === activeRunId
            && optimisticSessionKeysRef.current.has(selectedSessionKey),
          )
        },
        setError,
        setMessages,
      })
      return
    }

    if (frame.event === 'agent') {
      const tool = normalizeAgentToolEvent(frame.payload)
      if (!tool) return
      setMessages((current) => upsertStreamingTool(current, tool, currentRunIdRef.current))
    }
  }, [loadMessages, loadSessions, promoteSessionKey])

  const loadAgentOptions = useCallback(async (config: OpenClawConfigResponse) => {
    try {
      const payload = await listOpenClawAgents()
      setAgentOptions(payload.agents.map((agent) => ({
        emoji: agent.identity?.emoji,
        id: agent.id,
        isDefault: agent.isDefault,
        label: agent.identity?.name || agent.name || agent.id,
        model: agent.model || payload.defaults.model,
      })))
    } catch {
      setAgentOptions(normalizeAgentOptionsFromConfig(config.content))
    }
  }, [])

  const connect = useCallback(async (refreshEnvironment = false) => {
    const connectSeq = ++connectSeqRef.current
    clientRef.current?.close()
    clientRef.current = null
    setConnectionStatus('connecting')
    setConnectionDetail('正在连接 OpenClaw Gateway')
    setError('')

    try {
      const [environment, config] = await Promise.all([
        loadOpenClawEnvironment(refreshEnvironment),
        getOpenClawConfig(),
      ])
      if (connectSeq !== connectSeqRef.current) return

      if (!environment.cli.available || !environment.home.configExists || !environment.home.configValid) {
        throw new Error(environment.summary || 'OpenClaw 未安装或配置未就绪')
      }

      const gatewayUrl = resolveOpenClawGatewayWebSocketURL(environment.gateway)
      if (!gatewayUrl) {
        throw new Error('Gateway WebSocket 地址不可用')
      }

      const auth = getGatewayAuth(config.content)
      setModelOptions(normalizeModelOptions(config.content))
      void loadAgentOptions(config)
      const client = new OpenClawGatewayClient({
        password: auth.password,
        requestTimeoutMs: 30_000,
        token: auth.token,
        url: gatewayUrl,
      })

      clientRef.current = client
      const unsubscribeEvent = client.onEvent(handleGatewayEvent)
      const unsubscribeState = client.onConnectionState((state) => {
        if (clientRef.current !== client) return
        if (state === 'connected') {
          setConnectionStatus('ready')
          setConnectionDetail('Gateway WebSocket 已连接')
        } else if (state === 'error' || state === 'closed') {
          setConnectionStatus('error')
          setConnectionDetail(state === 'error' ? 'Gateway WebSocket 连接错误' : 'Gateway WebSocket 已断开')
        }
      })

      const hello = await client.ready(10_000)
      if (connectSeq !== connectSeqRef.current) {
        unsubscribeEvent()
        unsubscribeState()
        client.close()
        return
      }

      setGatewayVersion(readGatewayVersion(hello))
      defaultSessionKeyRef.current = hello.snapshot?.sessionDefaults?.mainSessionKey ?? null
      setConnectionStatus('ready')
      setConnectionDetail('Gateway WebSocket 已连接')
      void loadSlashCommands(hello.snapshot?.sessionDefaults?.defaultAgentId)
      await loadSessions(defaultSessionKeyRef.current)

      return () => {
        unsubscribeEvent()
        unsubscribeState()
      }
    } catch (err) {
      if (connectSeq !== connectSeqRef.current) return
      const message = err instanceof Error ? err.message : 'OpenClaw Gateway 连接失败'
      setConnectionStatus('error')
      setConnectionDetail(message)
      setError(message)
    }
  }, [handleGatewayEvent, loadAgentOptions, loadOpenClawEnvironment, loadSessions, loadSlashCommands])

  useEffect(() => {
    let cleanup: void | (() => void)
    let disposed = false
    const timer = window.setTimeout(() => {
      void connect().then((nextCleanup) => {
        if (disposed) {
          nextCleanup?.()
          return
        }
        cleanup = nextCleanup
      })
    }, 0)

    return () => {
      disposed = true
      window.clearTimeout(timer)
      cleanup?.()
      clientRef.current?.close()
      clientRef.current = null
    }
  }, [connect])

  useEffect(() => {
    if (connectionStatus === 'ready' && currentSessionKey) {
      void loadMessages(currentSessionKey)
    }
  }, [connectionStatus, currentSessionKey, loadMessages])

  useEffect(() => {
    if (connectionStatus === 'ready') {
      void loadSlashCommands(selectedAgentId)
    }
  }, [connectionStatus, loadSlashCommands, selectedAgentId])

  const refresh = useCallback(async () => {
    await connect(true)
  }, [connect])

  const reloadMessages = useCallback(async () => {
    await loadMessages()
  }, [loadMessages])

  const selectSession = useCallback((key: string) => {
    setActiveSessionKey(key)
    setMessages([])
    setError('')
  }, [setActiveSessionKey])

  const selectAgent = useCallback((agentId: string) => {
    if (!agentId) return
    const existing = sessions.find((session) => session.agentId === agentId && session.channelId === 'main')
      ?? sessions.find((session) => session.agentId === agentId)
    const nextKey = existing?.key ?? `agent:${agentId}:main`

    if (!existing) {
      const agent = agentOptions.find((option) => option.id === agentId)
      const session: OpenClawChatSession = {
        agentId,
        channelId: 'main',
        key: nextKey,
        model: agent?.model,
        title: agent?.label || agentId,
        updatedAt: Date.now(),
      }
      setSessions((current) => {
        const next = [session, ...current.filter((item) => item.key !== nextKey)]
        sessionsRef.current = next
        return next
      })
      optimisticSessionKeysRef.current.add(nextKey)
    }

    setActiveSessionKey(nextKey)
    setMessages([])
    setError('')
  }, [agentOptions, sessions, setActiveSessionKey])

  const createSession = useCallback(() => {
    const agentId = selectedAgentId || 'main'
    const key = `agent:${agentId}:${createShortId()}`
    const session: OpenClawChatSession = {
      agentId,
      channelId: key.split(':').slice(2).join(':'),
      key,
      title: '新对话',
      updatedAt: Date.now(),
    }

    optimisticSessionKeysRef.current.add(key)
    setSessions((current) => {
      const next = [session, ...current.filter((item) => item.key !== key)]
      sessionsRef.current = next
      return next
    })
    setActiveSessionKey(key)
    setMessages([])
    setAttachments([])
    setError('')
  }, [selectedAgentId, setActiveSessionKey])

  const addAttachments = useCallback(async (files: FileList | File[]) => {
    const next = await Promise.all(Array.from(files).map(fileToAttachmentDraft))
    setAttachments((current) => [...current, ...next])
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id))
  }, [])

  const sendMessage = useCallback(async (rawText: string) => {
    const client = clientRef.current
    const sessionKey = currentSessionKeyRef.current ?? defaultSessionKeyRef.current
    const text = rawText.trim()

    if (!client || !sessionKey || !text || isSending) return

    const runId = createShortId()
    const outgoingAttachments = attachments
    const optimisticMessage: OpenClawChatMessage = {
      content: text,
      files: outgoingAttachments
        .filter((item) => item.category === 'file')
        .map((item) => ({
          dataUrl: buildDataUrl(item.mimeType || 'application/octet-stream', item.data),
          id: item.id,
          mimeType: item.mimeType,
          name: item.name,
          size: item.size,
        })),
      id: `user-${runId}`,
      images: outgoingAttachments
        .filter((item) => item.category === 'image')
        .map((item) => buildDataUrl(item.mimeType || 'image/png', item.data)),
      role: 'user',
      timestamp: Date.now(),
    }
    const assistantPlaceholder: OpenClawChatMessage = {
      content: '',
      id: `gateway-stream-${runId}`,
      role: 'assistant',
      streaming: true,
      timestamp: Date.now(),
    }

    setMessages((current) => [...current, optimisticMessage, assistantPlaceholder])
    setAttachments([])
    setCurrentRunId(runId)
    currentRunIdRef.current = runId
    setSending(true)
    setError('')

    try {
      const response = await client.chatSend({
        attachments: outgoingAttachments.map(toGatewayAttachment),
        deliver: false,
        idempotencyKey: runId,
        message: text,
        sessionKey,
      })
      if (response.runId && response.runId !== runId) {
        setCurrentRunId(response.runId)
        currentRunIdRef.current = response.runId
        setMessages((current) => rekeyStreamingMessage(current, runId, response.runId!))
      }
      const responseSessionKey = typeof response.sessionKey === 'string' && response.sessionKey.trim()
        ? response.sessionKey.trim()
        : sessionKey
      if (responseSessionKey !== sessionKey) {
        promoteSessionKey(sessionKey, responseSessionKey)
      }
      await loadSessions(responseSessionKey)
    } catch (err) {
      const message = err instanceof Error ? err.message : '消息发送失败'
      setCurrentRunId(null)
      currentRunIdRef.current = null
      setSending(false)
      setMessages((current) => [
        ...removeStreamingMessage(current, runId),
        {
          content: `发送失败：${message}`,
          id: `error-${createShortId()}`,
          role: 'assistant',
          timestamp: Date.now(),
        },
      ])
    }
  }, [attachments, isSending, loadSessions, promoteSessionKey])

  const switchModel = useCallback(async (model: string) => {
    const client = clientRef.current
    const sessionKey = currentSessionKeyRef.current
    if (!client || !sessionKey || !model || isSwitchingModel) return

    setSwitchingModel(true)
    setError('')
    try {
      await client.chatSend({
        deliver: false,
        idempotencyKey: `model-${createShortId()}`,
        message: `/model ${model}`,
        sessionKey,
      })
      setModelBySession((current) => ({ ...current, [sessionKey]: model }))
      await loadSessions(sessionKey)
    } catch (err) {
      setError(err instanceof Error ? err.message : '模型切换失败')
    } finally {
      setSwitchingModel(false)
    }
  }, [isSwitchingModel, loadSessions])

  const abortCurrentRun = useCallback(async () => {
    const client = clientRef.current
    const sessionKey = currentSessionKeyRef.current
    if (!client || !sessionKey) return
    const runId = currentRunIdRef.current

    try {
      await client.chatAbort({
        runId: runId ?? undefined,
        sessionKey,
      })
    } finally {
      setCurrentRunId(null)
      currentRunIdRef.current = null
      setSending(false)
      if (runId) setMessages((current) => removeStreamingMessage(current, runId))
    }
  }, [])

  const toggleToolCards = useCallback(() => {
    setShowToolCards((current) => !current)
  }, [])

  const value = useMemo<OpenClawChatContextValue>(() => ({
    abortCurrentRun,
    addAttachments,
    agentOptions,
    attachments,
    connectionDetail,
    connectionStatus,
    createSession,
    currentRunId,
    currentSession,
    currentSessionKey,
    error,
    gatewayVersion,
    isLoadingMessages,
    isLoadingSessions,
    isSending,
    isSwitchingModel,
    messages,
    modelOptions,
    refresh,
    reloadMessages,
    removeAttachment,
    selectAgent,
    selectSession,
    sendMessage,
    selectedAgentId,
    selectedModel,
    showToolCards,
    sessions,
    slashCommands,
    switchModel,
    toggleToolCards,
  }), [
    abortCurrentRun,
    addAttachments,
    agentOptions,
    attachments,
    connectionDetail,
    connectionStatus,
    createSession,
    currentRunId,
    currentSession,
    currentSessionKey,
    error,
    gatewayVersion,
    isLoadingMessages,
    isLoadingSessions,
    isSending,
    isSwitchingModel,
    messages,
    modelOptions,
    refresh,
    reloadMessages,
    removeAttachment,
    selectAgent,
    selectSession,
    sendMessage,
    selectedAgentId,
    selectedModel,
    showToolCards,
    sessions,
    slashCommands,
    switchModel,
    toggleToolCards,
  ])

  return <OpenClawChatContext.Provider value={value}>{children}</OpenClawChatContext.Provider>
}

export function useOpenClawChat() {
  const context = useContext(OpenClawChatContext)
  if (!context) {
    throw new Error('useOpenClawChat must be used inside OpenClawChatProvider')
  }
  return context
}

function handleChatEvent(
  payload: unknown,
  helpers: {
    clearRun: () => void
    loadMessages: (sessionKey?: string | null) => Promise<void>
    loadSessions: (preferredSessionKey?: string | null) => Promise<void>
    noteSessionKey: (sessionKey: string, runId: string | null) => void
    shouldHandleSession: (sessionKey: string | null, runId: string | null) => boolean
    setError: (value: string) => void
    setMessages: Dispatch<SetStateAction<OpenClawChatMessage[]>>
  },
) {
  if (!payload || typeof payload !== 'object') return

  const record = payload as Record<string, unknown>
  const sessionKey = typeof record.sessionKey === 'string' ? record.sessionKey : null
  const runId = typeof record.runId === 'string' ? record.runId : null
  if (!helpers.shouldHandleSession(sessionKey, runId)) return
  if (sessionKey) helpers.noteSessionKey(sessionKey, runId)

  const state = typeof record.state === 'string' ? record.state : null
  const rawMessage = record.message && typeof record.message === 'object'
    ? record.message as OpenClawChatMessageItem
    : null

  if (state === 'delta') {
    if (!rawMessage) return
    const message = normalizeGatewayMessage(rawMessage)
    if (!isDisplayableMessage(message)) return
    helpers.setMessages((current) => upsertStreamingMessage(current, message, runId))
    return
  }

  if (state === 'final' || state === 'aborted') {
    if (rawMessage) {
      const message = normalizeGatewayMessage(rawMessage)
      if (!isDisplayableMessage(message)) {
        helpers.setMessages((current) => removeStreamingMessage(current, runId ?? message.id))
        helpers.clearRun()
        return
      }
      helpers.setMessages((current) => finalizeStreamingMessage(current, message, runId))
    } else if (sessionKey) {
      void helpers.loadMessages(sessionKey)
    }
    helpers.clearRun()
    void helpers.loadSessions(sessionKey)
    return
  }

  if (state === 'error') {
    const message = typeof record.errorMessage === 'string' ? record.errorMessage : 'Gateway 对话执行失败'
    helpers.setError(message)
    helpers.setMessages((current) => [
      ...current,
      {
        content: `执行失败：${message}`,
        id: `error-${createShortId()}`,
        role: 'assistant',
        timestamp: Date.now(),
      },
    ])
    helpers.clearRun()
  }
}

function normalizeSessions(result: OpenClawSessionsListResult): OpenClawChatSession[] {
  return (result.sessions ?? [])
    .map<OpenClawChatSession | null>((rawSession) => {
      const session = rawSession as OpenClawSessionListItem
      const key = String(session.key ?? session.sessionId ?? '').trim()
      if (!key) return null

      const rawTitle = readFirstString(session.derivedTitle, session.label, session.provider, session.sessionId) ?? parseSessionLabel(key)
      const parsed = parseSessionInfo(key, rawTitle)
      const title = isHeartbeatTitle(rawTitle) && isMainSessionKey(key)
        ? parseSessionLabel(key)
        : rawTitle

      return {
        agentId: session.agentId ?? parsed.agentId ?? undefined,
        channelId: parsed.channelId ?? undefined,
        channel: readFirstString(session.lastChannel, objectRecord(session.deliveryContext).channel, objectRecord(session.origin).provider) ?? inferChannelFromSessionKey(key),
        contextTokens: typeof session.contextTokens === 'number' ? session.contextTokens : undefined,
        displayName: title,
        key,
        label: session.derivedTitle ?? session.label,
        model: session.model,
        modelProvider: session.modelProvider ?? session.provider,
        sessionId: session.sessionId,
        title,
        updatedAt: session.updatedAt,
      }
    })
    .filter((session): session is OpenClawChatSession => Boolean(session))
    .filter((session) => isMainSession(session) || !isHeartbeatSession(session))
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
}

function normalizeSlashCommands(commands: OpenClawCommandEntry[] = []): OpenClawChatSlashCommand[] {
  const seen = new Set<string>()
  return commands
    .map((command) => ({
      ...command,
      textAliases: normalizeCommandAliases(command),
    }))
    .filter((command) => command.textAliases.length > 0)
    .filter((command) => {
      const key = command.name.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) => {
      const tierScore = (command: OpenClawChatSlashCommand) => (
        command.category === 'session' || command.category === 'options' || command.category === 'status' ? 0 : 1
      )
      return tierScore(left) - tierScore(right) || left.name.localeCompare(right.name)
    })
}

function normalizeCommandAliases(command: OpenClawCommandEntry) {
  const aliases = command.textAliases?.filter((alias) => alias.startsWith('/')) ?? []
  const nativeAlias = command.nativeName ? `/${command.nativeName}` : ''
  const nameAlias = command.name.startsWith('/') ? command.name : `/${command.name}`
  return [...new Set([nameAlias, nativeAlias, ...aliases].filter(Boolean))]
}

function mergeOptimisticSessions(
  serverSessions: OpenClawChatSession[],
  currentSessions: OpenClawChatSession[],
  optimisticSessionKeys: Set<string>,
) {
  if (!optimisticSessionKeys.size) return serverSessions

  const serverKeys = new Set(serverSessions.map((session) => session.key))
  const preserved = currentSessions.filter((session) => (
    optimisticSessionKeys.has(session.key) && !serverKeys.has(session.key)
  ))
  if (!preserved.length) return serverSessions

  const preservedKeys = new Set(preserved.map((session) => session.key))
  return [
    ...preserved,
    ...serverSessions.filter((session) => !preservedKeys.has(session.key)),
  ]
}

function chooseCurrentSessionKey(
  sessions: OpenClawChatSession[],
  currentKey: string | null,
  preferredKey: string | null,
) {
  if (currentKey && sessions.some((session) => session.key === currentKey)) return currentKey
  if (preferredKey && sessions.some((session) => session.key === preferredKey)) return preferredKey
  return sessions[0]?.key ?? null
}

function resolveSessionAlias(key: string | null, aliases: Record<string, string>) {
  if (!key) return null
  return aliases[key] ?? key
}

function promoteSessionInList(sessions: OpenClawChatSession[], fromKey: string, toKey: string) {
  const source = sessions.find((session) => session.key === fromKey)
  if (!source) return sessions

  const parsed = parseSessionInfo(toKey, source.title)
  const promoted: OpenClawChatSession = {
    ...source,
    agentId: parsed.agentId ?? source.agentId,
    channelId: parsed.channelId ?? source.channelId,
    key: toKey,
    title: source.title,
  }

  return [
    promoted,
    ...sessions.filter((session) => session.key !== fromKey && session.key !== toKey),
  ]
}

function isHeartbeatSession(session: OpenClawChatSession) {
  const text = `${session.title} ${session.displayName ?? ''} ${session.label ?? ''}`.toLowerCase()
  return isHeartbeatTitle(text)
}

function isHeartbeatTitle(value: string) {
  const text = value.toLowerCase()
  return text.includes('openclaw heartbeat poll') || text.includes('heartbeat_ok')
}

function isMainSession(session: OpenClawChatSession) {
  return isMainSessionKey(session.key) || (session.agentId === 'main' && (session.channelId === 'main' || !session.channelId))
}

function isMainSessionKey(key: string) {
  return key === 'main' || key === 'agent:main:main'
}

function normalizeModelOptions(content?: Record<string, unknown>): OpenClawChatModelOption[] {
  const agents = objectRecord(objectRecord(content).agents)
  const defaults = objectRecord(agents.defaults)
  const defaultModel = objectRecord(defaults.model)
  const primary = readFirstString(defaultModel.primary)
  const providers = objectRecord(objectRecord(content).models).providers
  const options: OpenClawChatModelOption[] = []
  const seen = new Set<string>()

  if (primary) {
    const parsed = parseModelRef(primary)
    seen.add(primary)
    options.push({
      id: primary,
      isPrimary: true,
      label: primary,
      modelId: parsed.modelId,
      provider: parsed.provider,
    })
  }

  for (const [provider, rawProvider] of Object.entries(objectRecord(providers))) {
    const models = (objectRecord(rawProvider).models ?? []) as unknown
    if (!Array.isArray(models)) continue

    for (const item of models) {
      const record = objectRecord(item)
      const modelId = typeof item === 'string' ? item : readFirstString(record.id)
      if (!modelId) continue
      const id = `${provider}/${modelId}`
      if (seen.has(id)) continue
      seen.add(id)
      options.push({
        id,
        isPrimary: id === primary,
        label: readFirstString(record.name) || id,
        modelId,
        provider,
      })
    }
  }

  return options
}

function normalizeAgentOptionsFromConfig(content?: Record<string, unknown>): OpenClawChatAgentOption[] {
  const agents = objectRecord(content).agents
  const defaults = objectRecord(objectRecord(agents).defaults)
  const defaultAgentId = readFirstString(defaults.defaultAgentId) || 'main'
  const defaultModel = readFirstString(objectRecord(defaults.model).primary)
  const list = objectRecord(agents).list
  const rows = Array.isArray(list) ? list : []
  const options = rows
    .map<OpenClawChatAgentOption | null>((item) => {
      const record = objectRecord(item)
      const id = readFirstString(record.id)
      if (!id) return null
      const identity = objectRecord(record.identity)
      return {
        emoji: readFirstString(identity.emoji),
        id,
        isDefault: id === defaultAgentId,
        label: readFirstString(identity.name, record.name) || id,
        model: readFirstString(objectRecord(record.model).primary) || defaultModel,
      }
    })
    .filter((option): option is OpenClawChatAgentOption => Boolean(option))

  if (!options.some((option) => option.id === defaultAgentId)) {
    options.unshift({
      id: defaultAgentId,
      isDefault: true,
      label: defaultAgentId,
      model: defaultModel,
    })
  }

  return options
}

function normalizeGatewayMessages(messages: OpenClawChatMessageItem[]): OpenClawChatMessage[] {
  const normalized: OpenClawChatMessage[] = []
  let toolBatch: ToolTranscriptBatch | null = null

  const flushToolBatch = () => {
    if (toolBatch?.tools.length) normalized.push(toolBatch)
    toolBatch = null
  }

  for (const message of messages) {
    if (isPureAssistantToolCallMessage(message)) {
      flushToolBatch()
      const tools = extractGatewayToolCalls(message)
      if (tools.length) {
        toolBatch = {
          content: '',
          id: `tools-${String(message.id ?? message.key ?? createShortId())}`,
          role: 'assistant',
          timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
          tools,
        }
      }
      continue
    }

    if (isGatewayToolTranscriptMessage(typeof message.role === 'string' ? message.role.toLowerCase() : '')) {
      const tool = extractGatewayToolResult(message)
      if (tool) {
        if (!toolBatch) {
          toolBatch = {
            content: '',
            id: `tools-${String(message.id ?? message.key ?? createShortId())}`,
            role: 'assistant',
            timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
            tools: [],
          }
        }
        toolBatch.tools = mergeTool(toolBatch.tools, tool)
      }
      continue
    }

    flushToolBatch()
    normalized.push(normalizeGatewayMessage(message))
  }

  flushToolBatch()
  return normalized
}

function normalizeGatewayMessage(message: OpenClawChatMessageItem): OpenClawChatMessage {
  const rawRole = typeof message.role === 'string' ? message.role.toLowerCase() : ''
  const role = rawRole === 'user' ? 'user' : 'assistant'
  const isToolTranscriptMessage = isGatewayToolTranscriptMessage(rawRole) || isPureAssistantToolCallMessage(message)
  const media = extractGatewayMedia(message)
  const content = isToolTranscriptMessage ? '' : normalizeMessageWhitespace(extractGatewayText(message))
  const reasoning = normalizeMessageWhitespace(extractGatewayThinking(message) ?? '') || undefined
  const tools = isToolTranscriptMessage ? [] : extractGatewayToolCalls(message)
  const meta = role === 'assistant' && !isToolTranscriptMessage ? extractGatewayMessageMeta(message) : undefined

  return {
    content,
    files: media.files,
    id: String(message.id ?? message.key ?? createShortId()),
    images: media.images,
    meta,
    reasoning,
    role,
    timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
    tools: tools.length ? tools : undefined,
  }
}

function isGatewayToolTranscriptMessage(role: string) {
  return ['function', 'tool', 'toolresult', 'tool_result'].includes(role)
}

function isPureAssistantToolCallMessage(message: OpenClawChatMessageItem) {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return false
  return message.content.length > 0 && message.content.every((block) => {
    const kind = String(block.type ?? '').toLowerCase()
    return ['toolcall', 'tool_call', 'tooluse', 'tool_use'].includes(kind)
  })
}

function extractGatewayText(message: OpenClawChatMessageItem) {
  const rawContent = message.content
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : ''

  if (typeof rawContent === 'string') return processGatewayMessageText(rawContent, role)
  if (Array.isArray(rawContent)) {
    const texts = rawContent
      .map((block) => {
        if (block.type === 'text' && typeof block.text === 'string') return block.text
        if (typeof block.text === 'string' && ['audio', 'image', 'image_url', 'video', 'voice'].includes(String(block.type))) return block.text
        return ''
      })
      .filter(Boolean)
    return processGatewayMessageText(texts.join('\n'), role)
  }
  if (typeof message.text === 'string') return processGatewayMessageText(message.text, role)
  return ''
}

function isDisplayableMessage(message: OpenClawChatMessage) {
  if (message.role === 'assistant' && silentReplyPattern.test(message.content)) return false
  return Boolean(
    message.content.trim()
    || message.reasoning?.trim()
    || message.meta
    || message.tools?.length
    || message.images?.length
    || message.files?.length
    || message.streaming
  )
}

function normalizeMessageWhitespace(text: string) {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractGatewayThinking(message: OpenClawChatMessageItem) {
  const rawContent = message.content
  const parts: string[] = []

  if (Array.isArray(rawContent)) {
    for (const block of rawContent) {
      if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
        parts.push(block.thinking.trim())
      }
    }
  }

  if (parts.length) return parts.join('\n')

  const rawText = typeof message.text === 'string'
    ? message.text
    : typeof message.content === 'string'
      ? message.content
      : ''
  const matches = [...rawText.matchAll(/<\s*think(?:ing)?\s*>([\s\S]*?)<\s*\/\s*think(?:ing)?\s*>/gi)]
  const extracted = matches.map((match) => (match[1] ?? '').trim()).filter(Boolean)
  return extracted.length ? extracted.join('\n') : null
}

function extractGatewayToolCalls(message: OpenClawChatMessageItem): OpenClawChatToolCall[] {
  const rawContent = message.content
  const tools: OpenClawChatToolCall[] = []

  if (Array.isArray(rawContent)) {
    for (const block of rawContent) {
      const kind = String(block.type ?? '').toLowerCase()
      const isToolCall = ['toolcall', 'tool_call', 'tooluse', 'tool_use'].includes(kind)
        || (typeof block.name === 'string' && block.arguments != null)
      if (!isToolCall) continue
      tools.push({
        description: readToolCallDescription(block),
        id: readFirstString(block.id, block.toolCallId, block.tool_call_id) ?? createShortId(),
        name: String(block.name || 'tool'),
        status: 'running',
      })
    }

    for (const block of rawContent) {
      const kind = String(block.type ?? '').toLowerCase()
      if (kind !== 'toolresult' && kind !== 'tool_result') continue
      const name = String(block.name || 'tool')
      const existing = [...tools].reverse().find((tool) => tool.name === name && !tool.result)
      const result = readToolResultText(block)
      if (existing) {
        existing.result = result
        existing.status = 'done'
      } else {
        tools.push({
          id: createShortId(),
          name,
          result,
          status: 'done',
        })
      }
    }
  }

  if (typeof message.toolName === 'string' || typeof message.tool_name === 'string') {
    tools.push({
      id: createShortId(),
      name: String(message.toolName || message.tool_name || 'tool'),
      result: extractGatewayText(message),
      status: 'done',
    })
  }

  return tools
}

function extractGatewayToolResult(message: OpenClawChatMessageItem): OpenClawChatToolCall | null {
  const record = message as Record<string, unknown>
  const name = readFirstString(record.toolName, record.tool_name, record.name) ?? 'tool'
  const id = readFirstString(record.toolCallId, record.tool_call_id, record.id, record.key) ?? name
  const result = normalizeMessageWhitespace(extractGatewayText(message))
  const isError = record.isError === true || record.error === true

  return {
    id,
    name,
    result: result || readFirstString(record.result, record.output),
    status: isError ? 'error' : 'done',
  }
}

function readToolCallDescription(block: Record<string, unknown>) {
  const partialArgs = readFirstString(block.partialArgs)
  if (partialArgs) return partialArgs

  const args = block.arguments ?? block.input
  if (!args || typeof args !== 'object') return undefined
  const record = args as Record<string, unknown>
  return readFirstString(record.path, record.command, record.query, record.content)
}

function extractGatewayMessageMeta(message: OpenClawChatMessageItem): OpenClawChatMessageMeta | undefined {
  const usage = objectRecord(message.usage)
  const cost = objectRecord(message.cost)
  const usageCost = objectRecord(usage.cost)
  const input = readFiniteNumber(usage.input, usage.inputTokens)
  const output = readFiniteNumber(usage.output, usage.outputTokens)
  const cacheRead = readFiniteNumber(usage.cacheRead, usage.cache_read_input_tokens)
  const cacheWrite = readFiniteNumber(usage.cacheWrite, usage.cache_creation_input_tokens)
  const totalCost = readFiniteNumber(cost.total, usageCost.total)
  const model = resolveModelLabel(message.modelProvider, message.model)
  const contextWindow = readFiniteNumber(message.contextTokens, message.contextWindow)
  const promptTokens = (input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0)
  const contextPercent = contextWindow && promptTokens > 0
    ? Math.min(Math.round((promptTokens / contextWindow) * 100), 100)
    : undefined
  const safeModel = model && model !== 'gateway-injected' ? model : undefined

  if (
    input === undefined
    && output === undefined
    && cacheRead === undefined
    && cacheWrite === undefined
    && totalCost === undefined
    && contextPercent === undefined
    && !safeModel
  ) {
    return undefined
  }

  return {
    cacheRead,
    cacheWrite,
    contextPercent,
    cost: totalCost,
    input,
    model: safeModel,
    output,
  }
}

function extractGatewayMedia(message: OpenClawChatMessageItem) {
  const images: string[] = []
  const files: OpenClawChatFile[] = []
  const rawContent = message.content

  if (Array.isArray(rawContent)) {
    for (const block of rawContent) {
      const type = String(block.type ?? '')
      const mimeType = String(block.mimeType || block.mediaType || '')
      const source = block.source && typeof block.source === 'object' ? block.source as Record<string, unknown> : null
      const imageUrl = block.image_url && typeof block.image_url === 'object' ? block.image_url as Record<string, unknown> : null

      if (type === 'image' && block.omitted !== true) {
        if (typeof block.data === 'string' && block.data) images.push(buildDataUrl(mimeType || 'image/png', block.data))
        else if (source?.type === 'base64' && typeof source.data === 'string') images.push(buildDataUrl(String(source.media_type || 'image/png'), source.data))
        else if (typeof block.url === 'string') images.push(block.url)
        else if (typeof source?.url === 'string') images.push(source.url)
      } else if (type === 'image_url' && typeof imageUrl?.url === 'string') {
        images.push(imageUrl.url)
      } else if (['audio', 'document', 'file', 'video', 'voice'].includes(type)) {
        files.push({
          dataUrl: typeof block.data === 'string' && block.data ? buildDataUrl(mimeType || 'application/octet-stream', block.data) : undefined,
          id: createShortId(),
          mimeType,
          name: String(block.fileName || block.name || '附件'),
          size: typeof block.size === 'number' ? block.size : undefined,
          url: typeof block.url === 'string' ? block.url : undefined,
        })
      }
    }
  }

  const mediaUrls = Array.isArray(message.mediaUrls)
    ? message.mediaUrls
    : typeof message.mediaUrl === 'string'
      ? [message.mediaUrl]
      : []
  for (const url of mediaUrls) {
    if (/\.(jpe?g|png|gif|webp|heic|svg)(\?|$)/i.test(url)) images.push(url)
    else files.push({ id: createShortId(), name: url.split('/').pop()?.split('?')[0] || '附件', url })
  }

  return { files, images: [...new Set(images)] }
}

function normalizeAgentToolEvent(payload: unknown): OpenClawChatToolCall | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const stream = String(record.stream ?? record.type ?? '').toLowerCase()
  const data = objectRecord(record.data)
  const kind = String(data.kind ?? record.kind ?? '').toLowerCase()
  const hasToolSignal = stream === 'tool'
    || (stream === 'item' && ['command', 'tool'].includes(kind))
    || stream === 'command_output'
    || record.toolName != null
    || record.tool_name != null
    || record.toolCallId != null
    || data.toolName != null
    || data.tool_name != null
    || data.toolCallId != null

  if (!hasToolSignal) return null
  if (
    stream
    && !['command_output', 'item', 'tool'].includes(stream)
    && record.toolName == null
    && record.tool_name == null
    && record.toolCallId == null
  ) {
    return null
  }

  const name = readFirstString(
    data.toolName,
    data.tool_name,
    data.name,
    data.tool,
    record.toolName,
    record.tool_name,
    record.name,
    record.tool,
  )
  if (!name) return null

  const phase = String(data.phase ?? data.status ?? record.phase ?? record.status ?? stream).toLowerCase()
  const status = phase.includes('error') || phase.includes('fail')
    ? 'error'
    : phase.includes('end') || phase.includes('done') || phase.includes('complete') || phase.includes('result')
      ? 'done'
      : 'running'
  const description = readFirstString(
    data.title,
    data.meta,
    data.message,
    data.text,
    data.summary,
    record.title,
    record.meta,
    record.message,
    record.text,
    record.summary,
  )
  const result = readFirstString(
    data.error,
    data.result,
    data.output,
    data.summary,
    data.progressText,
    record.error,
    record.result,
    record.output,
    record.summary,
    record.progressText,
  ) ?? (status === 'done' ? description : undefined)

  return {
    description,
    icon: status === 'error' ? 'lucide:circle-alert' : 'lucide:wrench',
    id: String(data.toolCallId ?? data.tool_call_id ?? data.itemId ?? data.id ?? data.callId ?? record.toolCallId ?? record.tool_call_id ?? record.id ?? record.callId ?? name),
    name,
    result,
    status,
  }
}

function upsertStreamingMessage(current: OpenClawChatMessage[], message: OpenClawChatMessage, runId: string | null) {
  const streamId = `gateway-stream-${runId ?? message.id}`
  const next = { ...message, id: streamId, streaming: true }
  const existingIndex = current.findIndex((item) => item.id === streamId)
  if (existingIndex < 0) return [...current, next]
  return current.map((item, index) => index === existingIndex ? { ...item, ...next } : item)
}

function finalizeStreamingMessage(current: OpenClawChatMessage[], message: OpenClawChatMessage, runId: string | null) {
  if (silentReplyPattern.test(message.content)) return removeStreamingMessage(current, runId ?? message.id)
  const streamId = `gateway-stream-${runId ?? message.id}`
  const existingIndex = current.findIndex((item) => item.id === streamId)
  const finalMessage = { ...message, streaming: false }
  if (existingIndex >= 0) return current.map((item, index) => index === existingIndex ? finalMessage : item)
  if (current.some((item) => item.id === message.id)) return current
  return [...current, finalMessage]
}

function rekeyStreamingMessage(current: OpenClawChatMessage[], fromRunId: string, toRunId: string) {
  const fromId = `gateway-stream-${fromRunId}`
  const toId = `gateway-stream-${toRunId}`
  if (fromId === toId || current.some((item) => item.id === toId)) return current
  return current.map((item) => item.id === fromId ? { ...item, id: toId } : item)
}

function removeStreamingMessage(current: OpenClawChatMessage[], runId: string) {
  const streamId = runId.startsWith('gateway-stream-') ? runId : `gateway-stream-${runId}`
  return current.filter((item) => item.id !== streamId)
}

function upsertStreamingTool(current: OpenClawChatMessage[], tool: OpenClawChatToolCall, runId: string | null) {
  const streamId = `gateway-stream-${runId ?? 'live'}`
  const existingIndex = current.findIndex((item) => item.id === streamId)
  const existing = existingIndex >= 0 ? current[existingIndex] : null
  const tools = mergeTool(existing?.tools ?? [], tool)
  const next: OpenClawChatMessage = {
    content: existing?.content ?? '',
    id: streamId,
    role: 'assistant',
    streaming: true,
    timestamp: existing?.timestamp ?? Date.now(),
    tools,
  }

  if (existingIndex < 0) return [...current, next]
  return current.map((item, index) => index === existingIndex ? { ...item, tools, streaming: true } : item)
}

function mergeTool(tools: OpenClawChatToolCall[], tool: OpenClawChatToolCall) {
  const existingIndex = tools.findIndex((item) => item.id === tool.id)
  if (existingIndex < 0) return [...tools, tool]
  return tools.map((item, index) => index === existingIndex ? { ...item, ...tool } : item)
}

function processGatewayMessageText(text: string, role: string) {
  if (role === 'assistant') return collapseBlankLines(stripThinkingTags(text))
  if (role === 'user') return collapseBlankLines(stripChannelDeliveryPreamble(stripInboundMetadata(stripEnvelope(text))))
  return collapseBlankLines(stripChannelDeliveryPreamble(stripEnvelope(text)))
}

function stripThinkingTags(text: string) {
  return text
    .replace(/<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi, '')
    .replace(/Conversation info \(untrusted metadata\):\s*```json[\s\S]*?```\s*/gi, '')
    .replace(/\[Queued messages while agent was busy\]\s*---\s*Queued #\d+\s*/gi, '')
    .trim()
}

function stripEnvelope(text: string) {
  const match = text.match(envelopePrefix)
  if (!match) return text
  const header = match[1] ?? ''
  if (!/\d{4}-\d{2}-\d{2}/.test(header) && !['WebChat', 'WhatsApp', 'Telegram', 'Discord', 'Matrix'].some((label) => header.startsWith(`${label} `))) {
    return text
  }
  return text.slice(match[0].length)
}

function stripInboundMetadata(text: string) {
  const lines = text.split('\n')
  const result: string[] = []
  let inMetaBlock = false
  let inFencedJson = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (!inMetaBlock && inboundMetaSentinels.includes(line.trim())) {
      if (lines[index + 1]?.trim() !== '```json') {
        result.push(line)
        continue
      }
      inMetaBlock = true
      inFencedJson = false
      continue
    }
    if (inMetaBlock) {
      if (!inFencedJson && line.trim() === '```json') {
        inFencedJson = true
        continue
      }
      if (inFencedJson) {
        if (line.trim() === '```') {
          inMetaBlock = false
          inFencedJson = false
        }
        continue
      }
      if (line.trim() === '') continue
      inMetaBlock = false
    }
    result.push(line)
  }

  return result.join('\n').replace(/^\n+/, '').replace(/\n+$/, '')
}

function stripChannelDeliveryPreamble(text: string) {
  return text
    .replace(/^\s*\[[^\]]+\]\s+to=[^\n]+\n*/gi, '')
    .replace(/^\s*System:\s*\[[^\]]+\]\s+[^\n]+\n*/gi, '')
    .replace(/^\s*\n+/, '')
}

function collapseBlankLines(text: string) {
  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function parseSessionInfo(key: string, fallbackTitle?: string) {
  const parts = key.split(':')
  if (parts.length < 3) {
    return { agentId: null, channelId: key || null, title: fallbackTitle || key || 'Chat' }
  }

  const agentId = parts[1] || 'main'
  const channelId = parts.slice(2).join(':') || 'main'
  return {
    agentId,
    channelId,
    title: fallbackTitle || parseSessionLabel(key),
  }
}

function parseSessionLabel(key: string) {
  const parts = key.split(':')
  if (parts.length < 3) return key || 'Chat'
  const agent = parts[1] || 'main'
  const channel = parts.slice(2).join(':')
  if (agent === 'main' && channel === 'main') return '主会话'
  if (agent === 'main') return channel
  return `${agent} / ${channel}`
}

function inferChannelFromSessionKey(key: string) {
  const parts = key.split(':')
  if (parts.length < 3) return 'webchat'
  return parts[2] || 'webchat'
}

function parseModelRef(value: string) {
  const slashIndex = value.indexOf('/')
  if (slashIndex > 0) {
    return {
      modelId: value.slice(slashIndex + 1),
      provider: value.slice(0, slashIndex),
    }
  }
  return {
    modelId: value,
    provider: '',
  }
}

function resolveModelLabel(provider: unknown, model: unknown) {
  const modelValue = readFirstString(model)
  if (!modelValue) return null
  const providerValue = readFirstString(provider)
  if (!providerValue) return modelValue

  const prefix = `${providerValue}/`
  if (modelValue.toLowerCase().startsWith(prefix.toLowerCase())) {
    return `${providerValue}/${modelValue.slice(prefix.length)}`
  }
  return `${providerValue}/${modelValue}`
}

function readGatewayVersion(hello: OpenClawGatewayHello) {
  return hello.server?.version || `Protocol ${hello.protocol ?? '-'}`
}

function readToolResultText(block: Record<string, unknown>) {
  if (typeof block.text === 'string') return block.text
  if (typeof block.content === 'string') return block.content
  return undefined
}

function readFirstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function readFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function getGatewayAuth(content?: Record<string, unknown>) {
  const gateway = objectRecord(objectRecord(content).gateway)
  const auth = objectRecord(gateway.auth)
  const token = auth.token
  const password = auth.password

  return {
    password: typeof password === 'string' && password.trim() ? password.trim() : undefined,
    token: typeof token === 'string' && token.trim() ? token.trim() : undefined,
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function buildDataUrl(mimeType: string, data: string) {
  return `data:${mimeType};base64,${data}`
}

function createShortId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const fallbackSlashCommands: OpenClawChatSlashCommand[] = normalizeSlashCommands([
  {
    acceptsArgs: false,
    category: 'status',
    description: 'Show available commands.',
    name: 'help',
    nativeName: 'help',
    scope: 'both',
    source: 'native',
    textAliases: ['/help'],
  },
  {
    acceptsArgs: false,
    category: 'session',
    description: 'Start a new session.',
    name: 'new',
    nativeName: 'new',
    scope: 'both',
    source: 'native',
    textAliases: ['/new'],
  },
  {
    acceptsArgs: true,
    args: [{ description: 'Model id (provider/model or id)', name: 'model', type: 'string' }],
    category: 'options',
    description: 'Show or set the model.',
    name: 'model',
    nativeName: 'model',
    scope: 'both',
    source: 'native',
    textAliases: ['/model'],
  },
  {
    acceptsArgs: true,
    category: 'options',
    description: 'List model providers/models.',
    name: 'models',
    nativeName: 'models',
    scope: 'both',
    source: 'native',
    textAliases: ['/models'],
  },
  {
    acceptsArgs: true,
    args: [{ description: 'Thinking level', name: 'level', type: 'string' }],
    category: 'options',
    description: 'Set thinking level.',
    name: 'think',
    nativeName: 'think',
    scope: 'both',
    source: 'native',
    textAliases: ['/think', '/thinking', '/t'],
  },
  {
    acceptsArgs: false,
    category: 'session',
    description: 'Stop the current run.',
    name: 'stop',
    nativeName: 'stop',
    scope: 'both',
    source: 'native',
    textAliases: ['/stop'],
  },
  {
    acceptsArgs: true,
    category: 'session',
    description: 'Reset the current session.',
    name: 'reset',
    nativeName: 'reset',
    scope: 'both',
    source: 'native',
    textAliases: ['/reset'],
  },
  {
    acceptsArgs: true,
    args: [{ description: 'Extra compaction instructions', name: 'instructions', type: 'string' }],
    category: 'session',
    description: 'Compact the session context.',
    name: 'compact',
    nativeName: 'compact',
    scope: 'both',
    source: 'native',
    textAliases: ['/compact'],
  },
  {
    acceptsArgs: true,
    category: 'tools',
    description: 'Run a skill by name.',
    name: 'skill',
    nativeName: 'skill',
    scope: 'both',
    source: 'native',
    textAliases: ['/skill'],
  },
  {
    acceptsArgs: true,
    category: 'tools',
    description: 'Run host shell commands (host-only).',
    name: 'bash',
    scope: 'text',
    source: 'native',
    textAliases: ['/bash'],
  },
])

async function fileToAttachmentDraft(file: File): Promise<OpenClawChatAttachmentDraft> {
  const dataUrl = await readFileAsDataUrl(file)
  const commaIndex = dataUrl.indexOf(',')
  const data = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl
  const mimeType = file.type || 'application/octet-stream'

  return {
    category: mimeType.startsWith('image/') ? 'image' : 'file',
    data,
    id: createShortId(),
    mimeType,
    name: file.name,
    size: file.size,
  }
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result || '')))
    reader.addEventListener('error', () => reject(reader.error || new Error('附件读取失败')))
    reader.readAsDataURL(file)
  })
}

function toGatewayAttachment(attachment: OpenClawChatAttachmentDraft): OpenClawChatAttachment {
  return {
    content: attachment.data,
    fileName: attachment.name,
    mimeType: attachment.mimeType,
    type: attachment.category,
  }
}
