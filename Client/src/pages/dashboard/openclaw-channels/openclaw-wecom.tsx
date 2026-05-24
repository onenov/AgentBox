import type { ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as QRCode from 'qrcode'
import type { Key } from '@heroui/react'
import { AlertDialog, Alert, Button, Card, Chip, Dropdown, InputGroup, ListBox, Modal, Skeleton, Switch, toast } from '@heroui/react'
import { CellSelect, ItemCard, ItemCardGroup, Segment } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type {
  OpenClawAgentSummary,
  OpenClawChannelStreamError,
  OpenClawChannelStreamLog,
  OpenClawChannelStreamMeta,
  OpenClawChannelStreamStatus,
  OpenClawChannelTaskResponse,
  OpenClawWeComAccount,
  OpenClawWeComStatusResponse,
} from '@/api'
import {
  deleteOpenClawWeComAccount,
  getOpenClawWeComAddAccountStreamURL,
  getOpenClawWeComInstallStreamURL,
  getOpenClawWeComScanAddStreamURL,
  getOpenClawWeComStatus,
  getOpenClawWeComUninstallStreamURL,
  listOpenClawAgents,
  updateOpenClawWeComAccountConfig,
  updateOpenClawWeComConfig,
} from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { openExternalUrl } from '@/utils/openExternalUrl'
import DashboardLayout from '@/layouts/Dashboard'
import { OpenClawPairingModal } from './openclaw-pairing'

type LoadState = 'error' | 'idle' | 'loading' | 'ready'
type TaskKind = 'add' | 'install' | 'scan' | 'uninstall'
type ModalMode = 'create' | 'edit'
type FormSection = 'basic' | 'bot' | 'agent' | 'advanced'

type WeComAccountDraft = {
  agentId: string
  enabled: boolean
}

type WeComForm = {
  accountId: string
  agentId: string
  allowFrom: string
  botId: string
  connectionMode: string
  dmPolicy: string
  dynamicAdminUsers: string
  dynamicAgentsEnabled: boolean
  dynamicDmCreateAgent: boolean
  dynamicGroupEnabled: boolean
  encodingAESKey: string
  groupAllowFrom: string
  groupPolicy: string
  groupsJson: string
  mediaCleanupOnStart: boolean
  mediaLocalRoots: string
  mediaMaxBytes: string
  mediaRetentionHours: string
  mediaTempDir: string
  name: string
  networkEgressProxyUrl: string
  networkRetries: string
  networkRetryDelayMs: string
  networkTimeoutMs: string
  receiveId: string
  secret: string
  sendThinkingMessage: boolean
  streamPlaceholderContent: string
  token: string
  websocketUrl: string
  welcomeText: string
  agentCorpId: string
  agentCorpSecret: string
  agentAgentId: string
  agentToken: string
  agentEncodingAESKey: string
  agentWelcomeText: string
  agentDmPolicy: string
  agentAllowFrom: string
}

type AgentOption = {
  id: string
  label: string
  value: string
}

type WeComAuthorizationQr = {
  dataUrl: string
  url: string
}

const defaultForm: WeComForm = {
  accountId: 'default',
  agentId: '',
  allowFrom: '',
  botId: '',
  connectionMode: 'websocket',
  dmPolicy: 'open',
  dynamicAdminUsers: '',
  dynamicAgentsEnabled: false,
  dynamicDmCreateAgent: true,
  dynamicGroupEnabled: true,
  encodingAESKey: '',
  groupAllowFrom: '',
  groupPolicy: 'open',
  groupsJson: '',
  mediaCleanupOnStart: false,
  mediaLocalRoots: '',
  mediaMaxBytes: '',
  mediaRetentionHours: '',
  mediaTempDir: '',
  name: '',
  networkEgressProxyUrl: '',
  networkRetries: '',
  networkRetryDelayMs: '',
  networkTimeoutMs: '',
  receiveId: '',
  secret: '',
  sendThinkingMessage: true,
  streamPlaceholderContent: '',
  token: '',
  websocketUrl: 'wss://openws.work.weixin.qq.com',
  welcomeText: '',
  agentCorpId: '',
  agentCorpSecret: '',
  agentAgentId: '',
  agentToken: '',
  agentEncodingAESKey: '',
  agentWelcomeText: '',
  agentDmPolicy: 'inherit',
  agentAllowFrom: '',
}

const formTabs: Array<{ icon: string; id: FormSection; label: string }> = [
  { icon: 'lucide:bot', id: 'basic', label: '基础设置' },
  { icon: 'lucide:radio-tower', id: 'bot', label: 'Bot 模式' },
  { icon: 'lucide:building-2', id: 'agent', label: '自建应用' },
  { icon: 'lucide:sliders-horizontal', id: 'advanced', label: '高级设置' },
]

const connectionModeOptions = [
  { id: 'websocket', label: 'WebSocket' },
  { id: 'webhook', label: 'Webhook' },
]

const dmPolicyOptions = [
  { id: 'open', label: '公开访问' },
  { id: 'pairing', label: '配对验证' },
  { id: 'allowlist', label: '仅白名单' },
  { id: 'disabled', label: '禁用私聊' },
]

const agentDmPolicyOptions = [
  { id: 'inherit', label: '继承默认' },
  ...dmPolicyOptions,
]

const groupPolicyOptions = [
  { id: 'open', label: '公开访问' },
  { id: 'allowlist', label: '仅白名单' },
  { id: 'disabled', label: '禁用群聊' },
]

export function OpenClawWeComPanel() {
  const [state, setState] = useState<LoadState>('idle')
  const [status, setStatus] = useState<OpenClawWeComStatusResponse | null>(null)
  const [agents, setAgents] = useState<OpenClawAgentSummary[]>([])
  const [accountDrafts, setAccountDrafts] = useState<Record<string, WeComAccountDraft>>({})
  const [error, setError] = useState('')
  const [task, setTask] = useState<OpenClawChannelTaskResponse | null>(null)
  const [taskKind, setTaskKind] = useState<TaskKind | null>(null)
  const [savingAccountId, setSavingAccountId] = useState('')
  const [savingChannelEnabled, setSavingChannelEnabled] = useState(false)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<ModalMode>('create')
  const [formSection, setFormSection] = useState<FormSection>('basic')
  const [form, setForm] = useState<WeComForm>(defaultForm)
  const [editAccount, setEditAccount] = useState<OpenClawWeComAccount | null>(null)
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const [accountDeleteTarget, setAccountDeleteTarget] = useState<OpenClawWeComAccount | null>(null)
  const [accountDeleting, setAccountDeleting] = useState(false)
  const [authorizationQr, setAuthorizationQr] = useState<WeComAuthorizationQr | null>(null)
  const [authorizationQrOpen, setAuthorizationQrOpen] = useState(false)
  const [isPairingOpen, setIsPairingOpen] = useState(false)
  const logRef = useRef<HTMLPreElement | null>(null)
  const sourceRef = useRef<EventSource | null>(null)
  const streamFinishedRef = useRef(false)
  const authorizationQrUrlRef = useRef('')

  const loadStatus = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const [nextStatus, nextAgents] = await Promise.all([getOpenClawWeComStatus(), listOpenClawAgents()])
      setStatus(nextStatus)
      setAgents(nextAgents.agents ?? [])
      setAccountDrafts(buildAccountDrafts(nextStatus.accounts ?? []))
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : '企业微信渠道状态加载失败')
      setState('error')
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStatus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadStatus])

  useEffect(() => () => {
    sourceRef.current?.close()
  }, [])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [task?.logs])

  const closeStream = useCallback(() => {
    sourceRef.current?.close()
    sourceRef.current = null
  }, [])

  const renderAuthorizationQr = useCallback(async (url: string) => {
    if (authorizationQrUrlRef.current === url) {
      setAuthorizationQrOpen(true)
      return
    }
    authorizationQrUrlRef.current = url
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 280,
      })
      setAuthorizationQr({ dataUrl, url })
      setAuthorizationQrOpen(true)
    } catch {
      toast.warning('企业微信授权二维码渲染失败')
    }
  }, [])

  const startStream = useCallback((kind: TaskKind, url: string) => {
    closeStream()
    streamFinishedRef.current = false
    if (kind === 'scan') {
      authorizationQrUrlRef.current = ''
      setAuthorizationQr(null)
      setAuthorizationQrOpen(false)
    }
    setTaskKind(kind)
    const now = new Date().toISOString()
    setTask({
      id: `${kind}-${Date.now()}`,
      logs: ['正在连接流式任务。'],
      progress: 0,
      startedAt: now,
      status: 'pending',
      updatedAt: now,
    })

    const source = new EventSource(url)
    sourceRef.current = source

    source.addEventListener('meta', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as OpenClawChannelStreamMeta
        setTask((current) => current ? { ...current, id: payload.id, status: 'running', updatedAt: payload.timestamp } : current)
      } catch {
        // ignore malformed stream metadata
      }
    })

    source.addEventListener('status', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as OpenClawChannelStreamStatus
        setTask((current) => current ? {
          ...current,
          error: payload.error || current.error,
          id: payload.id || current.id,
          progress: payload.progress,
          status: payload.status,
          updatedAt: payload.timestamp,
        } : current)
        if (payload.status === 'done') {
          streamFinishedRef.current = true
          closeStream()
          if (kind === 'scan') {
            setAuthorizationQrOpen(false)
            setAuthorizationQr(null)
          }
          setTask(null)
          setTaskKind(null)
          toast.success(taskDoneMessage(kind))
          void loadStatus()
        }
        if (payload.status === 'error' && payload.error) {
          streamFinishedRef.current = true
          closeStream()
          toast.warning(payload.error)
          void loadStatus()
        }
      } catch {
        // ignore malformed status payload
      }
    })

    source.addEventListener('log', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as OpenClawChannelStreamLog
        if (kind === 'scan') {
          const authorizationUrl = extractWeComAuthorizationUrl(payload.line)
          if (authorizationUrl) void renderAuthorizationQr(authorizationUrl)
        }
        setTask((current) => current ? {
          ...current,
          id: payload.id || current.id,
          logs: appendTaskLog(current.logs, payload.line),
          updatedAt: payload.timestamp,
        } : current)
      } catch {
        // ignore malformed log payload
      }
    })

    source.addEventListener('error', (event) => {
      const data = (event as MessageEvent).data
      if (!data) return
      try {
        const payload = JSON.parse(data) as OpenClawChannelStreamError
        streamFinishedRef.current = true
        closeStream()
        setAuthorizationQrOpen(false)
        setTask((current) => current ? {
          ...current,
          error: payload.message,
          id: payload.id || current.id,
          logs: appendTaskLog(current.logs, `失败：${payload.message}`),
          progress: 100,
          status: 'error',
          updatedAt: payload.timestamp,
        } : current)
        toast.warning(payload.message)
        void loadStatus()
      } catch {
        // EventSource also emits browser-level errors here; keep the existing task visible.
      }
    })

    source.addEventListener('done', () => {
      streamFinishedRef.current = true
      closeStream()
      if (kind === 'scan') {
        setAuthorizationQrOpen(false)
        setAuthorizationQr(null)
      }
      setTask(null)
      setTaskKind(null)
      void loadStatus()
    })

    source.onerror = () => {
      if (streamFinishedRef.current) return
      streamFinishedRef.current = true
      closeStream()
      setAuthorizationQrOpen(false)
      const timestamp = new Date().toISOString()
      setTask((current) => current ? {
        ...current,
        error: '流式连接中断',
        logs: appendTaskLog(current.logs, '失败：流式连接中断'),
        progress: 100,
        status: 'error',
        updatedAt: timestamp,
      } : current)
      toast.warning('企业微信渠道流式任务连接中断')
      void loadStatus()
    }
  }, [closeStream, loadStatus, renderAuthorizationQr])

  const handleAuthorizationQrOpenChange = useCallback((open: boolean) => {
    if (open) {
      setAuthorizationQrOpen(true)
      return
    }

    setAuthorizationQrOpen(false)
    if (taskKind !== 'scan' || !task || task.status === 'done' || task.status === 'error') return

    streamFinishedRef.current = true
    closeStream()
    setAuthorizationQr(null)
    setTask(null)
    setTaskKind(null)
    toast.warning('已取消企业微信扫码添加')
    void loadStatus()
  }, [closeStream, loadStatus, task, taskKind])

  const agentOptions = useMemo(() => buildAgentOptions(agents), [agents])
  const isLoading = state === 'loading' && !status
  const isTaskRunning = Boolean(task && task.status !== 'done' && task.status !== 'error')
  const installed = Boolean(status?.installed)
  const configured = Boolean(status?.configured)
  const enabled = Boolean(status?.enabled)
  const accounts = status?.accounts ?? []

  const toggleChannel = useCallback(async (enabled: boolean) => {
    setSavingChannelEnabled(true)
    try {
      const nextStatus = await updateOpenClawWeComConfig({ enabled })
      setStatus(nextStatus)
      setAccountDrafts(buildAccountDrafts(nextStatus.accounts ?? []))
      toast.success(enabled ? '企业微信渠道已启用' : '企业微信渠道已停用')
    } catch (err) {
      void loadStatus()
      toast.warning(err instanceof Error ? err.message : '企业微信渠道开关更新失败')
    } finally {
      setSavingChannelEnabled(false)
    }
  }, [loadStatus])

  const updateAccount = useCallback(async (account: OpenClawWeComAccount, patch: Partial<WeComAccountDraft>) => {
    const draft = {
      ...getAccountDraft(accountDrafts, account.accountId, account),
      ...patch,
    }
    setAccountDrafts((current) => ({ ...current, [account.accountId]: draft }))
    setSavingAccountId(account.accountId)
    try {
      const nextStatus = await updateOpenClawWeComAccountConfig(account.accountId, {
        agentId: draft.agentId,
        enabled: draft.enabled,
      })
      setStatus(nextStatus)
      setAccountDrafts(buildAccountDrafts(nextStatus.accounts ?? []))
      toast.success('企业微信账号配置已更新')
    } catch (err) {
      setAccountDrafts(buildAccountDrafts(status?.accounts ?? []))
      toast.warning(err instanceof Error ? err.message : '企业微信账号配置更新失败')
    } finally {
      setSavingAccountId('')
    }
  }, [accountDrafts, status?.accounts])

  const openCreateModal = useCallback(() => {
    setForm(defaultForm)
    setFormMode('create')
    setFormSection('basic')
    setEditAccount(null)
    setIsFormOpen(true)
  }, [])

  const openEditModal = useCallback((account: OpenClawWeComAccount) => {
    setEditAccount(account)
    setFormMode('edit')
    setFormSection('basic')
    setForm({
      accountId: account.accountId,
      agentId: account.agentId ?? '',
      allowFrom: (account.allowFrom ?? []).join('\n'),
      botId: '',
      connectionMode: account.connectionMode || 'websocket',
      dmPolicy: account.dmPolicy || 'open',
      dynamicAdminUsers: (account.dynamicAgents.adminUsers ?? []).join('\n'),
      dynamicAgentsEnabled: account.dynamicAgents.enabled,
      dynamicDmCreateAgent: account.dynamicAgents.dmCreateAgent,
      dynamicGroupEnabled: account.dynamicAgents.groupEnabled,
      encodingAESKey: '',
      groupAllowFrom: (account.groupAllowFrom ?? []).join('\n'),
      groupPolicy: account.groupPolicy || 'open',
      groupsJson: account.groups ? JSON.stringify(account.groups, null, 2) : '',
      mediaCleanupOnStart: account.media.cleanupOnStart,
      mediaLocalRoots: (account.mediaLocalRoots ?? []).join('\n'),
      mediaMaxBytes: account.media.maxBytes != null ? String(account.media.maxBytes) : '',
      mediaRetentionHours: account.media.retentionHours != null ? String(account.media.retentionHours) : '',
      mediaTempDir: account.media.tempDir || '',
      name: account.name || '',
      networkEgressProxyUrl: account.network.egressProxyUrl || '',
      networkRetries: account.network.retries != null ? String(account.network.retries) : '',
      networkRetryDelayMs: account.network.retryDelayMs != null ? String(account.network.retryDelayMs) : '',
      networkTimeoutMs: account.network.timeoutMs != null ? String(account.network.timeoutMs) : '',
      receiveId: account.receiveId || '',
      secret: '',
      sendThinkingMessage: account.sendThinkingMessage,
      streamPlaceholderContent: account.streamPlaceholderContent || '',
      token: '',
      websocketUrl: account.websocketUrl || 'wss://openws.work.weixin.qq.com',
      welcomeText: account.welcomeText || '',
      agentCorpId: '',
      agentCorpSecret: '',
      agentAgentId: account.agent.agentId || '',
      agentToken: '',
      agentEncodingAESKey: '',
      agentWelcomeText: account.agent.welcomeText || '',
      agentDmPolicy: account.agent.dmPolicy || 'inherit',
      agentAllowFrom: (account.agent.allowFrom ?? []).join('\n'),
    })
    setIsFormOpen(true)
  }, [])

  const submitForm = useCallback(async () => {
    let groups: Record<string, unknown> | undefined
    let mediaMaxBytes: number | undefined
    let mediaRetentionHours: number | undefined
    let networkTimeoutMs: number | undefined
    let networkRetries: number | undefined
    let networkRetryDelayMs: number | undefined
    try {
      groups = parseOptionalObject(form.groupsJson, '群覆盖 JSON')
      mediaMaxBytes = parseOptionalInteger(form.mediaMaxBytes, '媒体大小上限', 1)
      mediaRetentionHours = parseOptionalInteger(form.mediaRetentionHours, '媒体保留小时', 1)
      networkTimeoutMs = parseOptionalInteger(form.networkTimeoutMs, '网络超时', 1)
      networkRetries = parseOptionalInteger(form.networkRetries, '网络重试次数', 0)
      networkRetryDelayMs = parseOptionalInteger(form.networkRetryDelayMs, '重试间隔', 0)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '高级设置格式不正确')
      setFormSection('advanced')
      return
    }
    if (form.dmPolicy === 'allowlist' && !form.allowFrom.trim()) {
      toast.warning('DM allowlist 策略需要填写准入用户')
      setFormSection('advanced')
      return
    }
    if (form.groupPolicy === 'allowlist' && !form.groupAllowFrom.trim()) {
      toast.warning('群聊 allowlist 策略需要填写准入群聊')
      setFormSection('advanced')
      return
    }
    if (formMode === 'create') {
      const hasBotWebsocket = form.connectionMode === 'websocket' && (form.botId.trim() || form.secret.trim())
      const hasBotWebhook = form.connectionMode === 'webhook' && (form.token.trim() || form.encodingAESKey.trim())
      const hasAgent = form.agentCorpId.trim() || form.agentCorpSecret.trim() || form.agentToken.trim() || form.agentEncodingAESKey.trim()
      if (!hasBotWebsocket && !hasBotWebhook && !hasAgent) {
        toast.warning('请至少填写 Bot 模式或自建应用模式的一组凭据')
        setFormSection(form.connectionMode === 'webhook' ? 'bot' : 'agent')
        return
      }
      setIsFormOpen(false)
      startStream('add', getOpenClawWeComAddAccountStreamURL(form))
      setForm(defaultForm)
      return
    }
    if (!editAccount) return
    setSavingAccountId(editAccount.accountId)
    try {
      const nextStatus = await updateOpenClawWeComAccountConfig(editAccount.accountId, {
        agent: {
          agentId: form.agentAgentId,
          allowFrom: splitFormList(form.agentAllowFrom),
          corpId: form.agentCorpId,
          corpSecret: form.agentCorpSecret,
          dmPolicy: form.agentDmPolicy === 'inherit' ? '' : form.agentDmPolicy,
          encodingAESKey: form.agentEncodingAESKey,
          token: form.agentToken,
          welcomeText: form.agentWelcomeText,
        },
        agentId: form.agentId,
        allowFrom: splitFormList(form.allowFrom),
        botId: form.botId,
        connectionMode: form.connectionMode,
        dmPolicy: form.dmPolicy,
        dynamicAgents: {
          adminUsers: splitFormList(form.dynamicAdminUsers),
          enabled: form.dynamicAgentsEnabled,
          dmCreateAgent: form.dynamicDmCreateAgent,
          groupEnabled: form.dynamicGroupEnabled,
        },
        encodingAESKey: form.encodingAESKey,
        groupAllowFrom: splitFormList(form.groupAllowFrom),
        groupPolicy: form.groupPolicy,
        groups: form.groupsJson.trim() ? groups : {},
        media: {
          cleanupOnStart: form.mediaCleanupOnStart,
          maxBytes: mediaMaxBytes,
          retentionHours: mediaRetentionHours,
          tempDir: form.mediaTempDir,
        },
        mediaLocalRoots: splitFormList(form.mediaLocalRoots),
        name: form.name,
        network: {
          egressProxyUrl: form.networkEgressProxyUrl,
          retries: networkRetries,
          retryDelayMs: networkRetryDelayMs,
          timeoutMs: networkTimeoutMs,
        },
        receiveId: form.receiveId,
        secret: form.secret,
        sendThinkingMessage: form.sendThinkingMessage,
        streamPlaceholderContent: form.streamPlaceholderContent,
        token: form.token,
        websocketUrl: form.websocketUrl,
        welcomeText: form.welcomeText,
      })
      setStatus(nextStatus)
      setAccountDrafts(buildAccountDrafts(nextStatus.accounts ?? []))
      setIsFormOpen(false)
      setEditAccount(null)
      toast.success('企业微信账号已更新')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '企业微信账号更新失败')
    } finally {
      setSavingAccountId('')
    }
  }, [editAccount, form, formMode, startStream])

  const deleteAccount = useCallback(async () => {
    if (!accountDeleteTarget) return
    setAccountDeleting(true)
    try {
      await deleteOpenClawWeComAccount(accountDeleteTarget.accountId)
      setAccountDeleteTarget(null)
      toast.success('企业微信账号已删除')
      void loadStatus()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '企业微信账号删除失败')
    } finally {
      setAccountDeleting(false)
    }
  }, [accountDeleteTarget, loadStatus])

  return (
    <>
      {error ? (
        <div className=" py-3 w-full">
          <Alert status="danger" className="items-center">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>企业微信渠道状态加载失败</Alert.Title>
              <Alert.Description>请检查企业微信插件配置和网关运行状态。</Alert.Description>
            </Alert.Content>
            <Button isIconOnly size="sm" variant="danger" aria-label="刷新企业微信渠道状态" onPress={() => void loadStatus()}>
              <Icon icon="lucide:refresh-cw" className="size-4" />
            </Button>
          </Alert>
        </div>
      ) : null}

      <div className="flex flex-col gap-2  w-full">
        <Card>
          <Card.Content>
            <div className="flex w-full items-center justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <Icon icon="ant-design:wechat-work-outlined" className="size-7" />
                </div>
                <div className="min-w-0">
                  <Card.Title>企业微信</Card.Title>
                  <Card.Description>接入企业微信官方 OpenClaw 插件，管理 Bot、Agent 回调和多账号。</Card.Description>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {state !== 'loading' && !isTaskRunning ? (
                  <Button size="sm" isIconOnly variant={state === 'error' ? 'primary' : 'ghost'} aria-label="刷新企业微信渠道状态" onPress={() => void loadStatus()}>
                    <Icon icon="lucide:refresh-cw" />
                  </Button>
                ) : null}
                {!installed && !isTaskRunning ? (
                  <Button size="sm" variant="primary" onPress={() => startStream('install', getOpenClawWeComInstallStreamURL())}>
                    <Icon icon="lucide:plug" />
                    安装
                  </Button>
                ) : null}
                {installed && !isTaskRunning ? (
                  <Button size="sm" variant="tertiary" onPress={() => setUninstallOpen(true)}>
                    <Icon icon="lucide:trash-2" />
                    卸载
                  </Button>
                ) : null}
                {installed ? (
                  <>
                    <Button size="sm" variant="tertiary" isDisabled={isTaskRunning} onPress={() => setIsPairingOpen(true)}>
                      <Icon icon="lucide:shield-check" />
                      配对审批
                    </Button>
                    <Button size="sm" variant="primary" isDisabled={isTaskRunning} onPress={() => startStream('scan', getOpenClawWeComScanAddStreamURL())}>
                      <Icon icon="lucide:qr-code" />
                      扫码添加
                    </Button>
                    <Button size="sm" variant="primary" isDisabled={isTaskRunning} onPress={openCreateModal}>
                      <Icon icon="lucide:plus" />
                      手动添加
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </Card.Content>
        </Card>

        <StatusItemList
          items={[
            {
              description: installed ? status?.version || '已检测到插件' : '等待安装官方插件',
              icon: 'lucide:package-check',
              loading: isLoading,
              ok: installed,
              title: '插件',
            },
            {
              description: configured ? `${accounts.length} 个账号` : '等待添加账号',
              icon: 'lucide:key-round',
              loading: isLoading,
              ok: configured,
              title: '配置',
            },
            {
              description: enabled ? '企业微信渠道已启用' : '企业微信渠道已停用',
              icon: 'lucide:radio',
              loading: isLoading,
              ok: enabled,
              title: '运行',
            },
            {
              action: installed && !isTaskRunning && !isLoading ? (
                <Switch
                  size="lg"
                  aria-label="切换企业微信渠道总开关"
                  isSelected={enabled}
                  isDisabled={!configured || savingChannelEnabled}
                  onChange={(nextEnabled) => void toggleChannel(nextEnabled)}
                >
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch>
              ) : null,
              description: enabled ? '企业微信渠道已启用' : '企业微信渠道已停用',
              icon: 'lucide:power',
              loading: isLoading,
              ok: enabled,
              title: '启用',
            },
          ]}
        />

        {installed ? (
          accounts.length > 0 ? (
            <div className="grid gap-2 lg:grid-cols-2">
              {accounts.map((account) => (
                <WeComAccountCard
                  key={account.accountId}
                  account={account}
                  agentOptions={agentOptions}
                  draft={getAccountDraft(accountDrafts, account.accountId, account)}
                  isDisabled={isLoading || isTaskRunning}
                  isSaving={savingAccountId === account.accountId}
                  onDelete={setAccountDeleteTarget}
                  onEdit={openEditModal}
                  onUpdate={(patch) => void updateAccount(account, patch)}
                />
              ))}
            </div>
          ) : (
            <ChannelEmptyState
              description="添加一个企业微信账号后，就可以配置路由 Agent、连接模式和消息接入策略。"
              icon="ant-design:wechat-work-outlined"
              title="还没有企业微信账号"
            />
          )
        ) : (
          <ChannelEmptyState
            description="安装企业微信插件后，可以在这里添加账号并配置消息接入。"
            icon="lucide:package-x"
            title="企业微信插件未安装"
          />
        )}

        {status?.error ? (
          <div className="rounded-xl bg-warning/10 p-3 text-sm leading-6 text-warning">{status.error}</div>
        ) : null}

        <TaskLogPanel task={task} taskKind={taskKind} logRef={logRef} onClose={() => setTask(null)} />

        <OpenClawPairingModal
          channel="wecom"
          channelLabel="企业微信"
          isOpen={isPairingOpen}
          onApproved={() => void loadStatus()}
          onOpenChange={setIsPairingOpen}
        />

        <WeComAuthorizationQrModal
          isOpen={authorizationQrOpen && Boolean(authorizationQr)}
          qr={authorizationQr}
          onOpenChange={handleAuthorizationQrOpenChange}
        />

      <WeComAccountModal
          activeSection={formSection}
          agentOptions={agentOptions}
          form={form}
          isOpen={isFormOpen}
          isSubmitting={isTaskRunning || Boolean(editAccount && savingAccountId === editAccount.accountId)}
          mode={formMode}
          onActiveSectionChange={setFormSection}
          onFormChange={setForm}
          onOpenChange={(open) => {
            setIsFormOpen(open)
            if (!open) {
              setEditAccount(null)
              setFormMode('create')
            }
          }}
          onSubmit={submitForm}
        />

        <AlertDialog.Backdrop isOpen={uninstallOpen} onOpenChange={setUninstallOpen}>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-[480px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>卸载企业微信插件？</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-sm leading-6 text-muted">这会执行插件卸载，并清理 channels.wecom、插件入口和路由绑定。</p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary">取消</Button>
                <Button
                  variant="danger"
                  onPress={() => {
                    setUninstallOpen(false)
                    startStream('uninstall', getOpenClawWeComUninstallStreamURL())
                  }}
                >
                  <Icon icon="lucide:trash-2" />
                  确认卸载
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>

        <AlertDialog.Backdrop isOpen={Boolean(accountDeleteTarget)} onOpenChange={(open) => {
          if (!open && !accountDeleting) setAccountDeleteTarget(null)
        }}>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-[480px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>删除企业微信账号？</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-sm leading-6 text-muted">将删除账号 {accountDeleteTarget?.accountId} 的本地配置和 Agent 路由绑定。</p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary" isDisabled={accountDeleting}>取消</Button>
                <Button variant="danger" onPress={() => void deleteAccount()} isDisabled={accountDeleting}>
                  <Icon icon={accountDeleting ? 'lucide:loader-circle' : 'lucide:trash-2'} className={accountDeleting ? 'animate-spin' : ''} />
                  删除
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </div>
    </>
  )
}

function ChannelEmptyState({
  description,
  icon,
  title,
}: {
  description: string
  icon: string
  title: string
}) {
  return (
    <Card>
      <Card.Content>
        <div className="flex flex-col items-center px-6 py-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-surface-secondary/50 text-muted">
            <Icon icon={icon} className="size-7" />
          </div>
          <Card.Title className="mt-4 text-lg">{title}</Card.Title>
          <Card.Description className="mt-2 max-w-xl leading-6">
            {description}
          </Card.Description>
        </div>
      </Card.Content>
    </Card>
  )
}

function WeComAccountCard({
  account,
  agentOptions,
  draft,
  isDisabled,
  isSaving,
  onDelete,
  onEdit,
  onUpdate,
}: {
  account: OpenClawWeComAccount
  agentOptions: AgentOption[]
  draft: WeComAccountDraft
  isDisabled: boolean
  isSaving: boolean
  onDelete: (account: OpenClawWeComAccount) => void
  onEdit: (account: OpenClawWeComAccount) => void
  onUpdate: (patch: Partial<WeComAccountDraft>) => void
}) {
  const selectedAgent = agentOptions.find((option) => option.value === draft.agentId) ?? agentOptions[0]
  const modeLabel = account.agent.configured ? `${account.connectionMode || 'websocket'} + Agent` : account.connectionMode || 'websocket'
  return (
    <Card>
      <Card.Content>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div
              className={`flex size-11 shrink-0 items-center justify-center rounded-full ${draft.enabled ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}
              aria-label={draft.enabled ? '已启用' : '已停用'}
              title={draft.enabled ? '已启用' : '已停用'}
            >
              <Icon icon="ant-design:wechat-work-outlined" className="size-6" />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-col gap-1">
                <Card.Title className="text-base">{account.name || account.accountId}</Card.Title>
                <div className="flex flex-wrap items-center gap-2">
                <Chip size="sm" variant="soft">{modeLabel}</Chip>
                {account.botIdConfigured || account.tokenConfigured ? <Chip size="sm" color="success" variant="soft">Bot</Chip> : null}
                {account.agent.configured ? <Chip size="sm" color="success" variant="soft">Agent</Chip> : null}
                </div>
              </div>
              {/* <div className="grid gap-1 text-sm text-muted">
                <InfoLine icon="lucide:route" value={`DM ${account.dmPolicy || 'open'} / 群聊 ${account.groupPolicy || 'open'}`} />
                <InfoLine icon="lucide:users-round" value={`准入用户 ${account.allowFromCount} / 准入群 ${account.groupAllowFromCount} / 群覆盖 ${account.groupCount}`} />
              </div> */}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Dropdown>
              <Button size="sm" variant="tertiary" aria-label="选择绑定 Agent" isDisabled={isDisabled || isSaving}>
                <Icon icon={isSaving ? 'lucide:loader-circle' : 'lucide:bot'} className={`size-4 ${isSaving ? 'animate-spin' : ''}`} />
                {selectedAgent?.label || '未绑定'}
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu
                  selectedKeys={new Set([selectedAgent?.id ?? 'unbound'])}
                  selectionMode="single"
                  onAction={(key) => {
                    const option = agentOptions.find((item) => item.id === String(key))
                    onUpdate({ agentId: option?.value ?? '' })
                  }}
                >
                  {agentOptions.map((option) => (
                    <Dropdown.Item key={option.id} id={option.id} textValue={option.label}>
                      <Dropdown.ItemIndicator />
                      <span className="min-w-0 truncate">{option.label}</span>
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            <Switch size="lg" className="flex p-1 bg-default rounded-full" aria-label="启用企业微信账号" isSelected={draft.enabled} isDisabled={isDisabled || isSaving} onChange={(enabled) => onUpdate({ enabled })}>
              <Switch.Control><Switch.Thumb /></Switch.Control>
            </Switch>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            <Button isIconOnly size="sm" variant="tertiary" aria-label="编辑企业微信账号" isDisabled={isDisabled || isSaving} onPress={() => onEdit(account)}>
              <Icon icon="lucide:pencil" className="size-4" />
            </Button>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            <Button isIconOnly size="sm" variant="tertiary" aria-label="删除企业微信账号" isDisabled={isDisabled || isSaving} onPress={() => onDelete(account)}>
              <Icon icon="lucide:trash-2" className="size-4" />
            </Button>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function WeComAccountModal({
  activeSection,
  agentOptions,
  form,
  isOpen,
  isSubmitting,
  mode,
  onActiveSectionChange,
  onFormChange,
  onOpenChange,
  onSubmit,
}: {
  activeSection: FormSection
  agentOptions: AgentOption[]
  form: WeComForm
  isOpen: boolean
  isSubmitting: boolean
  mode: ModalMode
  onActiveSectionChange: (section: FormSection) => void
  onFormChange: (form: WeComForm) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
}) {
  const update = (patch: Partial<WeComForm>) => onFormChange({ ...form, ...patch })
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="sm:max-w-[760px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-success/10 text-success">
              <Icon icon="ant-design:wechat-work-outlined" className="size-5" />
            </Modal.Icon>
            <div>
              <Modal.Heading>{mode === 'edit' ? '编辑企业微信账号' : '添加企业微信账号'}</Modal.Heading>
              <p className="mt-1 text-sm text-muted">配置 Bot 模式、自建应用 Agent 模式和账号级高级策略。</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="space-y-5 p-1">
              <Segment selectedKey={activeSection} onSelectionChange={(key) => onActiveSectionChange(String(key) as FormSection)}>
                {formTabs.map((tab) => (
                  <Segment.Item key={tab.id} id={tab.id}>
                    <Segment.Separator />
                    <Icon icon={tab.icon} className="size-4" />
                    {tab.label}
                  </Segment.Item>
                ))}
              </Segment>

              <div className='max-h-[50vh] overflow-y-auto'>

                {activeSection === 'basic' ? (
                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>账号信息</ItemCardGroup.Title>
                      <ItemCardGroup.Description>账号级配置会覆盖 channels.wecom 顶层配置。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem description="用于多账号配置和路由匹配。" icon="lucide:user-round" title="账号 ID">
                      <ClearableInput value={form.accountId} disabled={isSubmitting || mode === 'edit'} placeholder="default" onChange={(accountId) => update({ accountId })} />
                    </FormItem>
                    <FormItem description="后台显示名称。" icon="lucide:badge" title="名称">
                      <ClearableInput value={form.name} disabled={isSubmitting} placeholder="企业微信机器人" onChange={(name) => update({ name })} />
                    </FormItem>
                    <FormItem description="默认绑定给哪个智能体。" icon="lucide:bot" title="智能体">
                      <FriendlySelect
                        ariaLabel="绑定 Agent"
                        isDisabled={isSubmitting}
                        options={agentOptions}
                        value={agentOptions.find((option) => option.value === form.agentId)?.id ?? 'unbound'}
                        onChange={(value) => {
                          const option = agentOptions.find((item) => item.id === String(value))
                          update({ agentId: option?.value ?? '' })
                        }}
                      />
                    </FormItem>
                    <FormItem description="控制私聊准入。" icon="lucide:shield-check" title="DM 策略">
                      <FriendlySelect ariaLabel="DM 策略" isDisabled={isSubmitting} options={dmPolicyOptions} value={form.dmPolicy} onChange={(value) => update({ dmPolicy: String(value ?? 'open') })} />
                    </FormItem>
                    <FormItem description="控制群聊准入。" icon="lucide:messages-square" title="群聊策略">
                      <FriendlySelect ariaLabel="群聊策略" isDisabled={isSubmitting} options={groupPolicyOptions} value={form.groupPolicy} onChange={(value) => update({ groupPolicy: String(value ?? 'open') })} />
                    </FormItem>
                  </ItemCardGroup>
                ) : null}

                {activeSection === 'bot' ? (
                  <div className="space-y-5">
                    <ItemCardGroup className="overflow-hidden">
                      <ItemCardGroup.Header>
                        <ItemCardGroup.Title>Bot 模式</ItemCardGroup.Title>
                        <ItemCardGroup.Description>WebSocket 适合快速接入和流式回复；Webhook 需要配置回调 URL。</ItemCardGroup.Description>
                      </ItemCardGroup.Header>
                      <FormItem description="Bot 连接方式。" icon="lucide:radio-tower" title="连接模式">
                        <FriendlySelect ariaLabel="连接模式" isDisabled={isSubmitting} options={connectionModeOptions} value={form.connectionMode} onChange={(value) => update({ connectionMode: String(value ?? 'websocket') })} />
                      </FormItem>
                      <FormItem description={mode === 'edit' ? '留空保持当前 Bot ID 不变。' : 'WebSocket 模式必填。'} icon="lucide:fingerprint" title="Bot ID">
                        <ClearableInput value={form.botId} disabled={isSubmitting} placeholder="bot-id" onChange={(botId) => update({ botId })} />
                      </FormItem>
                      <FormItem description={mode === 'edit' ? '留空保持当前 Secret 不变。' : 'WebSocket 模式必填。'} icon="lucide:key-round" title="Secret">
                        <ClearableInput value={form.secret} disabled={isSubmitting} placeholder="secret" onChange={(secret) => update({ secret })} />
                      </FormItem>
                      <FormItem description="默认 wss://openws.work.weixin.qq.com。" icon="lucide:plug" title="WebSocket URL">
                        <ClearableInput value={form.websocketUrl} disabled={isSubmitting} placeholder="wss://openws.work.weixin.qq.com" onChange={(websocketUrl) => update({ websocketUrl })} />
                      </FormItem>
                      <FormItem actionClassName="w-fit" description="发送“思考中”占位消息。" icon="lucide:message-circle-dashed" title="思考占位">
                        <Switch size="lg" aria-label="发送思考占位消息" isSelected={form.sendThinkingMessage} isDisabled={isSubmitting} onChange={(sendThinkingMessage) => update({ sendThinkingMessage })}>
                          <Switch.Control><Switch.Thumb /></Switch.Control>
                        </Switch>
                      </FormItem>
                    </ItemCardGroup>

                    <ItemCardGroup className="overflow-hidden">
                      <ItemCardGroup.Header>
                        <ItemCardGroup.Title>Bot Webhook</ItemCardGroup.Title>
                        <ItemCardGroup.Description>回调路径：/plugins/wecom/bot 或 /plugins/wecom/bot/&lt;accountId&gt;。</ItemCardGroup.Description>
                      </ItemCardGroup.Header>
                      <FormItem description={mode === 'edit' ? '留空保持当前 Token 不变。' : 'Webhook 模式必填。'} icon="lucide:ticket" title="Token">
                        <ClearableInput value={form.token} disabled={isSubmitting} placeholder="callback token" onChange={(token) => update({ token })} />
                      </FormItem>
                      <FormItem description={mode === 'edit' ? '留空保持当前 EncodingAESKey 不变。' : '43 位加密密钥。'} icon="lucide:lock-keyhole" title="EncodingAESKey">
                        <ClearableInput value={form.encodingAESKey} disabled={isSubmitting} placeholder="encoding aes key" onChange={(encodingAESKey) => update({ encodingAESKey })} />
                      </FormItem>
                      <FormItem description="用于解密校验的接收方 ID。" icon="lucide:mail-check" title="Receive ID">
                        <ClearableInput value={form.receiveId} disabled={isSubmitting} placeholder="receive id" onChange={(receiveId) => update({ receiveId })} />
                      </FormItem>
                      <FormItem description="enter_chat 事件欢迎语。" icon="lucide:message-square-heart" title="欢迎语">
                        <ClearableInput value={form.welcomeText} disabled={isSubmitting} placeholder="欢迎使用 OpenClaw" onChange={(welcomeText) => update({ welcomeText })} />
                      </FormItem>
                      <FormItem description="流式回复占位内容。" icon="lucide:loader" title="流式占位">
                        <ClearableInput value={form.streamPlaceholderContent} disabled={isSubmitting} placeholder="正在思考..." onChange={(streamPlaceholderContent) => update({ streamPlaceholderContent })} />
                      </FormItem>
                    </ItemCardGroup>
                  </div>
                ) : null}

                {activeSection === 'agent' ? (
                  <div className="space-y-5">
                    <ItemCardGroup className="overflow-hidden">
                      <ItemCardGroup.Header>
                        <ItemCardGroup.Title>自建应用 Agent</ItemCardGroup.Title>
                        <ItemCardGroup.Description>用于 XML 加密回调和主动发送，保存企业微信后台 API 接收前需要先写入这些配置。</ItemCardGroup.Description>
                      </ItemCardGroup.Header>
                      <FormItem description={mode === 'edit' ? '留空保持当前 CorpID 不变。' : '企业 CorpID。'} icon="lucide:building-2" title="Corp ID">
                        <ClearableInput value={form.agentCorpId} disabled={isSubmitting} placeholder="ww..." onChange={(agentCorpId) => update({ agentCorpId })} />
                      </FormItem>
                      <FormItem description={mode === 'edit' ? '留空保持当前 CorpSecret 不变。' : '应用 Secret。'} icon="lucide:key-round" title="Corp Secret">
                        <ClearableInput value={form.agentCorpSecret} disabled={isSubmitting} placeholder="corp secret" onChange={(agentCorpSecret) => update({ agentCorpSecret })} />
                      </FormItem>
                      <FormItem description="自建应用 AgentId，主动发送需要。" icon="lucide:hash" title="Agent ID">
                        <ClearableInput value={form.agentAgentId} disabled={isSubmitting} placeholder="1000002" onChange={(agentAgentId) => update({ agentAgentId })} />
                      </FormItem>
                      <FormItem description={mode === 'edit' ? '留空保持当前 Token 不变。' : 'API 接收 Token。'} icon="lucide:ticket" title="Token">
                        <ClearableInput value={form.agentToken} disabled={isSubmitting} placeholder="callback token" onChange={(agentToken) => update({ agentToken })} />
                      </FormItem>
                      <FormItem description={mode === 'edit' ? '留空保持当前 EncodingAESKey 不变。' : 'API 接收 EncodingAESKey。'} icon="lucide:lock-keyhole" title="EncodingAESKey">
                        <ClearableInput value={form.agentEncodingAESKey} disabled={isSubmitting} placeholder="encoding aes key" onChange={(agentEncodingAESKey) => update({ agentEncodingAESKey })} />
                      </FormItem>
                      <FormItem description="Agent 模式 DM 策略覆盖。" icon="lucide:shield-check" title="Agent DM 策略">
                        <FriendlySelect ariaLabel="Agent DM 策略" isDisabled={isSubmitting} options={agentDmPolicyOptions} value={form.agentDmPolicy} onChange={(value) => update({ agentDmPolicy: String(value ?? 'inherit') })} />
                      </FormItem>
                    </ItemCardGroup>
                    <TextareaCard description="Agent 模式准入用户，支持逗号或换行分隔。" disabled={isSubmitting} icon="lucide:users" placeholder="user_id_1, user_id_2" title="Agent 准入用户" value={form.agentAllowFrom} onChange={(agentAllowFrom) => update({ agentAllowFrom })} />
                    <TextareaCard description="Agent 欢迎语。" disabled={isSubmitting} icon="lucide:message-square-heart" placeholder="欢迎使用 OpenClaw" title="Agent 欢迎语" value={form.agentWelcomeText} onChange={(agentWelcomeText) => update({ agentWelcomeText })} />
                  </div>
                ) : null}

                {activeSection === 'advanced' ? (
                  <div className="space-y-5">
                    <TextareaCard description="DM allowlist 使用，支持逗号或换行分隔。" disabled={isSubmitting} icon="lucide:users" placeholder="user_id_1, user_id_2" title="准入用户" value={form.allowFrom} onChange={(allowFrom) => update({ allowFrom })} />
                    <TextareaCard description="群聊 allowlist 使用，填写 group_id/chat_id。" disabled={isSubmitting} icon="lucide:message-square-lock" placeholder="group_id_1, group_id_2" title="准入群聊" value={form.groupAllowFrom} onChange={(groupAllowFrom) => update({ groupAllowFrom })} />
                    <TextareaCard description="群内发送者 allowlist 等覆盖配置，必须是 JSON 对象。" disabled={isSubmitting} icon="lucide:braces" placeholder={'{"group_id_1":{"allowFrom":["user_id_1"]}}'} title="群覆盖 JSON" value={form.groupsJson} onChange={(groupsJson) => update({ groupsJson })} />

                    <ItemCardGroup className="overflow-hidden">
                      <ItemCardGroup.Header>
                        <ItemCardGroup.Title>动态 Agent</ItemCardGroup.Title>
                        <ItemCardGroup.Description>按用户或群自动创建隔离 Agent。</ItemCardGroup.Description>
                      </ItemCardGroup.Header>
                      <FormItem actionClassName="w-fit" description="启用动态 Agent 路由。" icon="lucide:route" title="动态 Agent">
                        <Switch size="lg" aria-label="启用动态 Agent" isSelected={form.dynamicAgentsEnabled} isDisabled={isSubmitting} onChange={(dynamicAgentsEnabled) => update({ dynamicAgentsEnabled })}><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
                      </FormItem>
                      <FormItem actionClassName="w-fit" description="私聊为每个用户创建独立 Agent。" icon="lucide:user-plus" title="私聊建 Agent">
                        <Switch size="lg" aria-label="私聊创建 Agent" isSelected={form.dynamicDmCreateAgent} isDisabled={isSubmitting} onChange={(dynamicDmCreateAgent) => update({ dynamicDmCreateAgent })}><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
                      </FormItem>
                      <FormItem actionClassName="w-fit" description="群聊启用动态 Agent。" icon="lucide:users-round" title="群聊动态">
                        <Switch size="lg" aria-label="群聊动态 Agent" isSelected={form.dynamicGroupEnabled} isDisabled={isSubmitting} onChange={(dynamicGroupEnabled) => update({ dynamicGroupEnabled })}><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
                      </FormItem>
                    </ItemCardGroup>
                    <TextareaCard description="管理员用户会绕过动态路由，使用主 Agent。" disabled={isSubmitting} icon="lucide:user-cog" placeholder="admin_user_id" title="动态 Agent 管理员" value={form.dynamicAdminUsers} onChange={(dynamicAdminUsers) => update({ dynamicAdminUsers })} />

                    <ItemCardGroup className="overflow-hidden">
                      <ItemCardGroup.Header>
                        <ItemCardGroup.Title>媒体与网络</ItemCardGroup.Title>
                        <ItemCardGroup.Description>本地媒体路径、临时目录、固定出口代理和网络重试。</ItemCardGroup.Description>
                      </ItemCardGroup.Header>
                      <FormItem actionClassName="w-fit" description="Gateway 启动时清理临时媒体。" icon="lucide:trash" title="启动清理">
                        <Switch size="lg" aria-label="启动清理媒体" isSelected={form.mediaCleanupOnStart} isDisabled={isSubmitting} onChange={(mediaCleanupOnStart) => update({ mediaCleanupOnStart })}><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
                      </FormItem>
                      <FormItem description="媒体最大字节数。" icon="lucide:file-up" title="Media Max Bytes">
                        <ClearableInput value={form.mediaMaxBytes} disabled={isSubmitting} placeholder="20971520" onChange={(mediaMaxBytes) => update({ mediaMaxBytes })} />
                      </FormItem>
                      <FormItem description="媒体保留小时数。" icon="lucide:clock" title="Retention Hours">
                        <ClearableInput value={form.mediaRetentionHours} disabled={isSubmitting} placeholder="24" onChange={(mediaRetentionHours) => update({ mediaRetentionHours })} />
                      </FormItem>
                      <FormItem description="媒体临时目录。" icon="lucide:folder" title="Temp Dir">
                        <ClearableInput value={form.mediaTempDir} disabled={isSubmitting} placeholder="~/.openclaw/wecom-media" onChange={(mediaTempDir) => update({ mediaTempDir })} />
                      </FormItem>
                      <FormItem description="企业可信 IP 固定出口代理。" icon="lucide:network" title="Egress Proxy">
                        <ClearableInput value={form.networkEgressProxyUrl} disabled={isSubmitting} placeholder="http://proxy.company.local:3128" onChange={(networkEgressProxyUrl) => update({ networkEgressProxyUrl })} />
                      </FormItem>
                      <FormItem description="HTTP 超时，单位 ms。" icon="lucide:timer" title="Timeout Ms">
                        <ClearableInput value={form.networkTimeoutMs} disabled={isSubmitting} placeholder="30000" onChange={(networkTimeoutMs) => update({ networkTimeoutMs })} />
                      </FormItem>
                      <FormItem description="重试次数。" icon="lucide:refresh-ccw" title="Retries">
                        <ClearableInput value={form.networkRetries} disabled={isSubmitting} placeholder="2" onChange={(networkRetries) => update({ networkRetries })} />
                      </FormItem>
                      <FormItem description="重试间隔，单位 ms。" icon="lucide:timer-reset" title="Retry Delay">
                        <ClearableInput value={form.networkRetryDelayMs} disabled={isSubmitting} placeholder="1000" onChange={(networkRetryDelayMs) => update({ networkRetryDelayMs })} />
                      </FormItem>
                    </ItemCardGroup>
                    <TextareaCard description="允许发送的本地媒体路径白名单，支持 ~，逗号或换行分隔。" disabled={isSubmitting} icon="lucide:folder-lock" placeholder="~/Downloads\n~/Documents" title="Media Local Roots" value={form.mediaLocalRoots} onChange={(mediaLocalRoots) => update({ mediaLocalRoots })} />
                  </div>
                ) : null}

              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={() => onOpenChange(false)}>取消</Button>
            <Button variant="tertiary" onPress={() => void openExternalUrl('https://github.com/WecomTeam/wecom-openclaw-plugin')}>
              <Icon icon="lucide:github" className="size-4" />
              GitHub
            </Button>
            <Button variant="primary" isPending={isSubmitting} onPress={onSubmit}>
              <Icon icon="lucide:save" className="size-4" />
              {mode === 'edit' ? '保存修改' : '添加账号'}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function WeComAuthorizationQrModal({ isOpen, onOpenChange, qr }: { isOpen: boolean; onOpenChange: (open: boolean) => void; qr: WeComAuthorizationQr | null }) {
  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
        <Modal.Container size="sm">
          <Modal.Dialog className="sm:max-w-[420px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Icon className="bg-success/10 text-success">
                <Icon icon="lucide:qr-code" className="size-5" />
              </Modal.Icon>
              <div>
                <Modal.Heading>企业微信扫码添加</Modal.Heading>
                <p className="mt-1 text-sm text-muted">请使用企业微信客户端扫描二维码完成机器人添加。</p>
              </div>
            </Modal.Header>
            <Modal.Body>
              {qr ? (
                <div className="flex flex-col items-center gap-4 py-4">
                  <div className="rounded-xl bg-white p-4">
                    <img src={qr.dataUrl} alt="企业微信授权二维码" className="size-[280px]" />
                  </div>
                  <p className="text-center text-sm leading-6 text-muted">使用企业微信扫码添加机器人</p>
                </div>
              ) : null}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

function ClearableInput({ disabled, onChange, placeholder, value }: { disabled?: boolean; onChange: (value: string) => void; placeholder?: string; value: string }) {
  return (
    <InputGroup fullWidth variant="secondary">
      <InputGroup.Input value={value} disabled={disabled} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      {value ? (
        <InputGroup.Suffix className="px-1 shrink-0">
          <Button isIconOnly size="sm" variant="ghost" aria-label="清空输入" isDisabled={disabled} onPress={() => onChange('')}>
            <Icon icon="lucide:x" className="size-4" />
          </Button>
        </InputGroup.Suffix>
      ) : null}
    </InputGroup>
  )
}

function TextareaCard({ description, disabled, icon, onChange, placeholder, title, value }: { description: string; disabled?: boolean; icon: string; onChange: (value: string) => void; placeholder?: string; title: string; value: string }) {
  return (
    <Card>
      <Card.Header>
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-secondary/50 text-muted">
            <Icon icon={icon} className="size-5" />
          </div>
          <div>
            <Card.Title>{title}</Card.Title>
            <Card.Description>{description}</Card.Description>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        <textarea className="min-h-24 w-full rounded-2xl border border-divider bg-surface-secondary/50 px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent disabled:opacity-60" disabled={disabled} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
      </Card.Content>
    </Card>
  )
}

function FormItem({ actionClassName = 'w-full w-auto', children, description, icon, title }: { actionClassName?: string; children: ReactNode; description: string; icon: string; title: string }) {
  return (
    <ItemCard>
      <ItemCard.Icon className="size-10 rounded-full bg-surface-secondary/50 text-muted">
        <Icon icon={icon} className="size-5" />
      </ItemCard.Icon>
      <ItemCard.Content>
        <ItemCard.Title>{title}</ItemCard.Title>
        <ItemCard.Description>{description}</ItemCard.Description>
      </ItemCard.Content>
      <ItemCard.Action>
        <div className={actionClassName}>{children}</div>
      </ItemCard.Action>
    </ItemCard>
  )
}

function FriendlySelect({ ariaLabel, isDisabled, onChange, options, value }: { ariaLabel: string; isDisabled?: boolean; onChange: (value: Key | null) => void; options: Array<{ id: string; label: string }>; value: Key | null }) {
  return (
    <CellSelect aria-label={ariaLabel} className="w-full" isDisabled={isDisabled} value={value} variant="secondary" onChange={onChange}>
      <CellSelect.Trigger>
        <CellSelect.Value />
        <CellSelect.Indicator />
      </CellSelect.Trigger>
      <CellSelect.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </CellSelect.Popover>
    </CellSelect>
  )
}

function StatusItemList({ items }: { items: Array<{ action?: ReactNode; description: string; icon: string; loading: boolean; ok: boolean; title: string }> }) {
  return (
    <div className="mb-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <ItemCard key={item.title}>
          <ItemCard.Icon><Icon icon={item.icon} className="text-muted" /></ItemCard.Icon>
          <ItemCard.Content>
            <ItemCard.Title>{item.title}</ItemCard.Title>
            <ItemCard.Description>{item.loading ? <Skeleton className="h-4 w-28" /> : item.description}</ItemCard.Description>
          </ItemCard.Content>
          <ItemCard.Action>
            {item.loading ? (
              <Skeleton className="size-2.5 rounded-full" />
            ) : item.action ? (
              item.action
            ) : (
              <span
                className={`block size-2.5 shrink-0 rounded-full ${item.ok ? 'bg-success shadow-[0_0_12px_color-mix(in_oklch,var(--success)_80%,transparent)]' : 'bg-danger shadow-[0_0_12px_color-mix(in_oklch,var(--danger)_80%,transparent)]'}`}
                aria-label={item.ok ? '正常' : '异常'}
              />
            )}
          </ItemCard.Action>
        </ItemCard>
      ))}
    </div>
  )
}

function TaskLogPanel({ logRef, onClose, task, taskKind }: { logRef: RefObject<HTMLPreElement | null>; onClose: () => void; task: OpenClawChannelTaskResponse | null; taskKind: TaskKind | null }) {
  if (!task) return null

  const isRunning = task.status === 'pending' || task.status === 'running'
  const tone = task.status === 'done' ? 'success' : task.status === 'error' ? 'danger' : 'warning'
  const copyLogs = async () => {
    const text = [task.logs.join('\n'), task.error ? task.error : ''].filter(Boolean).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('日志已复制')
    } catch {
      toast.warning('日志复制失败')
    }
  }

  return (
    <Card>
      <Card.Header>
        <div className="flex w-full items-center justify-between gap-3">
          <Card.Title className="text-base font-bold">{taskTitle(taskKind)}</Card.Title>
          <div className="flex items-center gap-2">
            <Chip color={tone} variant="soft">{task.status}</Chip>
            <Button isIconOnly variant="ghost" aria-label="复制日志" onPress={() => void copyLogs()}>
              <Icon icon="lucide:copy" className="size-4" />
            </Button>
            <Button isIconOnly variant="ghost" aria-label="关闭日志卡片" onPress={onClose}>
              <Icon icon="lucide:x" className="size-4" />
            </Button>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        <div className="mb-3 h-2 overflow-hidden rounded-full bg-surface-secondary/50">
          <div className={`h-full rounded-full ${task.status === 'error' ? 'bg-danger' : 'bg-success'}`} style={{ width: `${Math.max(3, task.progress)}%` }} />
        </div>
        {isRunning ? (
          <div className="mb-3 flex items-center gap-2 text-sm text-muted">
            <Icon icon="lucide:loader-circle" className="size-4 animate-spin" />
            正在执行，日志会实时显示。
          </div>
        ) : null}
        <pre ref={logRef} className="max-h-96 overflow-auto rounded-xl bg-surface-secondary/50 p-4 font-mono text-xs leading-5 text-foreground whitespace-pre-wrap">
          {task.logs.join('\n')}
          {task.error ? `\n${task.error}` : ''}
        </pre>
      </Card.Content>
    </Card>
  )
}

function appendTaskLog(logs: string[], line: string) {
  const next = line.trim() ? [...logs, line] : logs
  return next.length > 240 ? next.slice(next.length - 240) : next
}

function buildAccountDrafts(accounts: OpenClawWeComAccount[]) {
  return accounts.reduce<Record<string, WeComAccountDraft>>((drafts, account) => {
    drafts[account.accountId] = getAccountDraft({}, account.accountId, account)
    return drafts
  }, {})
}

function getAccountDraft(drafts: Record<string, WeComAccountDraft>, accountId: string, account?: OpenClawWeComAccount): WeComAccountDraft {
  return drafts[accountId] ?? {
    agentId: account?.agentId ?? '',
    enabled: account?.enabled !== false,
  }
}

function buildAgentOptions(agents: OpenClawAgentSummary[]): AgentOption[] {
  const options: AgentOption[] = [{ id: 'unbound', label: '未绑定', value: '' }]
  const seen = new Set([''])
  for (const agent of agents) {
    const id = agent.id?.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    options.push({ id: `agent:${id}`, label: agent.name || agent.identity?.name || id, value: id })
  }
  return options
}

function splitFormList(value: string) {
  return value.split(/[,，\n\r;；]/).map((item) => item.trim()).filter(Boolean)
}

function parseOptionalInteger(value: string, label: string, min: number) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < min) throw new Error(`${label}必须是大于等于 ${min} 的整数`)
  return parsed
}

function parseOptionalObject(value: string, label: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = JSON.parse(trimmed) as unknown
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(`${label}必须是 JSON 对象`)
  return parsed as Record<string, unknown>
}

function extractWeComAuthorizationUrl(line: string) {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
  const cleanLine = line.replace(ansiPattern, '')
  return cleanLine
    .match(/https:\/\/work\.weixin\.qq\.com\/ai\/qc\/(?:gen|auth|scan|[^\s"'<>]+)\?\S+/)?.[0]
    ?.replace(/[)。）\],;，；]+$/, '') ?? ''
}

function taskDoneMessage(kind: TaskKind) {
  switch (kind) {
    case 'install':
      return '企业微信插件安装完成'
    case 'add':
      return '企业微信账号添加完成'
    case 'scan':
      return '企业微信扫码添加完成'
    case 'uninstall':
      return '企业微信插件卸载完成'
    default:
      return '企业微信任务完成'
  }
}

function taskTitle(kind: TaskKind | null) {
  switch (kind) {
    case 'install':
      return '安装企业微信插件'
    case 'add':
      return '添加企业微信账号'
    case 'scan':
      return '扫码添加企业微信账号'
    case 'uninstall':
      return '卸载企业微信插件'
    default:
      return '企业微信任务'
  }
}

function OpenClawWeComPage() {
  usePageTitle('OpenClaw 企业微信')
  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 py-6">
        <OpenClawWeComPanel />
      </div>
    </DashboardLayout>
  )
}

export default OpenClawWeComPage
