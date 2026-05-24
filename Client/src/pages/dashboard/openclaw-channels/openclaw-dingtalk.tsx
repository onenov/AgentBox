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
  OpenClawDingTalkAccount,
  OpenClawDingTalkStatusResponse,
} from '@/api'
import {
  deleteOpenClawDingTalkAccount,
  getOpenClawDingTalkAddAccountStreamURL,
  getOpenClawDingTalkInstallStreamURL,
  getOpenClawDingTalkScanAddStreamURL,
  getOpenClawDingTalkStatus,
  getOpenClawDingTalkUninstallStreamURL,
  listOpenClawAgents,
  updateOpenClawDingTalkAccountConfig,
  updateOpenClawDingTalkConfig,
} from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { openExternalUrl } from '@/utils/openExternalUrl'
import DashboardLayout from '@/layouts/Dashboard'
import { OpenClawPairingModal } from './openclaw-pairing'

type LoadState = 'error' | 'idle' | 'loading' | 'ready'
type TaskKind = 'add' | 'install' | 'scan' | 'uninstall'
type ModalMode = 'create' | 'edit'
type ModalSection = 'basic' | 'advanced'

type DingTalkAccountDraft = {
  agentId: string
  enabled: boolean
}

type DingTalkForm = {
  accountId: string
  ackText: string
  agentId: string
  allowFrom: string
  asyncMode: boolean
  chatbotCorpId: string
  chatbotUserId: string
  clientId: string
  clientSecret: string
  debug: boolean
  dmPolicy: string
  enableMediaUpload: boolean
  endpoint: string
  groupAllowFrom: string
  groupPolicy: string
  groupReplyMode: string
  groupSessionScope: string
  groupsJson: string
  historyLimit: string
  mediaMaxMb: string
  name: string
  requireMention: boolean
  resolveSenderNames: boolean
  separateSessionByConversation: boolean
  sharedMemoryAcrossConversations: boolean
  systemPrompt: string
  textChunkLimit: string
  toolsDocs: boolean
  toolsMedia: boolean
  typingIndicator: boolean
}

type AgentOption = {
  id: string
  label: string
  value: string
}

type DingTalkAuthorizationQr = {
  dataUrl: string
  url: string
  userCode?: string
}

const defaultForm: DingTalkForm = {
  accountId: 'default',
  ackText: '',
  agentId: '',
  allowFrom: '',
  asyncMode: false,
  chatbotCorpId: '',
  chatbotUserId: '',
  clientId: '',
  clientSecret: '',
  debug: false,
  dmPolicy: 'pairing',
  enableMediaUpload: true,
  endpoint: '',
  groupAllowFrom: '',
  groupPolicy: 'open',
  groupReplyMode: 'aicard',
  groupSessionScope: 'group',
  groupsJson: '',
  historyLimit: '',
  mediaMaxMb: '',
  name: '',
  requireMention: true,
  resolveSenderNames: false,
  separateSessionByConversation: true,
  sharedMemoryAcrossConversations: false,
  systemPrompt: '',
  textChunkLimit: '',
  toolsDocs: true,
  toolsMedia: true,
  typingIndicator: false,
}

const dmPolicyOptions = [
  { id: 'pairing', label: '配对验证' },
  { id: 'allowlist', label: '仅白名单' },
  { id: 'open', label: '公开访问' },
  { id: 'disabled', label: '禁用私聊' },
]

const groupPolicyOptions = [
  { id: 'inherit', label: '继承默认' },
  { id: 'open', label: '公开访问' },
  { id: 'allowlist', label: '仅白名单' },
  { id: 'disabled', label: '禁用群聊' },
]

const groupReplyModeOptions = [
  { id: 'inherit', label: '继承默认' },
  { id: 'aicard', label: 'AI 卡片' },
  { id: 'text', label: '纯文本' },
  { id: 'markdown', label: 'Markdown' },
]

const groupSessionScopeOptions = [
  { id: 'inherit', label: '继承默认' },
  { id: 'group', label: '按群会话' },
  { id: 'group_sender', label: '按群 + 发送者' },
]

const modalTabs = [
  { id: 'basic', icon: 'lucide:bot', label: '基础设置' },
  { id: 'advanced', icon: 'lucide:sliders-horizontal', label: '高级设置' },
] satisfies Array<{ id: ModalSection; icon: string; label: string }>

export function OpenClawDingTalkPanel() {
  const [state, setState] = useState<LoadState>('idle')
  const [status, setStatus] = useState<OpenClawDingTalkStatusResponse | null>(null)
  const [agents, setAgents] = useState<OpenClawAgentSummary[]>([])
  const [accountDrafts, setAccountDrafts] = useState<Record<string, DingTalkAccountDraft>>({})
  const [error, setError] = useState('')
  const [task, setTask] = useState<OpenClawChannelTaskResponse | null>(null)
  const [taskKind, setTaskKind] = useState<TaskKind | null>(null)
  const [savingAccountId, setSavingAccountId] = useState('')
  const [savingChannelEnabled, setSavingChannelEnabled] = useState(false)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<ModalMode>('create')
  const [formSection, setFormSection] = useState<ModalSection>('basic')
  const [form, setForm] = useState<DingTalkForm>(defaultForm)
  const [editAccount, setEditAccount] = useState<OpenClawDingTalkAccount | null>(null)
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const [accountDeleteTarget, setAccountDeleteTarget] = useState<OpenClawDingTalkAccount | null>(null)
  const [accountDeleting, setAccountDeleting] = useState(false)
  const [authorizationQr, setAuthorizationQr] = useState<DingTalkAuthorizationQr | null>(null)
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
      const [nextStatus, nextAgents] = await Promise.all([getOpenClawDingTalkStatus(), listOpenClawAgents()])
      setStatus(nextStatus)
      setAgents(nextAgents.agents ?? [])
      setAccountDrafts(buildAccountDrafts(nextStatus.accounts ?? []))
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : '钉钉渠道状态加载失败')
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
      setAuthorizationQr({
        dataUrl,
        url,
        userCode: extractDingTalkUserCode(url),
      })
      setAuthorizationQrOpen(true)
    } catch {
      toast.warning('钉钉授权二维码渲染失败')
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
          setAuthorizationQrOpen(false)
          setTask(null)
          toast.success(taskDoneMessage(kind))
          void loadStatus()
        }
        if (payload.status === 'error' && payload.error) {
          streamFinishedRef.current = true
          closeStream()
          setAuthorizationQrOpen(false)
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
          const authorizationUrl = extractDingTalkAuthorizationUrl(payload.line)
          if (authorizationUrl) void renderAuthorizationQr(authorizationUrl)
        }
        setTask((current) => current ? {
          ...current,
          id: payload.id || current.id,
          logs: appendTaskLog(current.logs, maskDingTalkSecret(payload.line)),
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
        // ignore malformed error payload
      }
    })

    source.onerror = () => {
      if (streamFinishedRef.current) return
      streamFinishedRef.current = true
      closeStream()
      const timestamp = new Date().toISOString()
      setAuthorizationQrOpen(false)
      setTask((current) => current ? {
        ...current,
        error: '流式连接中断',
        logs: appendTaskLog(current.logs, '失败：流式连接中断'),
        progress: 100,
        status: 'error',
        updatedAt: timestamp,
      } : current)
      toast.warning('钉钉渠道流式任务连接中断')
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
    toast.warning('已取消钉钉扫码添加')
    void loadStatus()
  }, [closeStream, loadStatus, task, taskKind])

  const updateChannelEnabled = useCallback(async (enabled: boolean) => {
    setSavingChannelEnabled(true)
    setStatus((current) => current ? { ...current, enabled, config: { ...current.config, enabled } } : current)
    try {
      const nextStatus = await updateOpenClawDingTalkConfig({ enabled })
      setStatus(nextStatus)
      setAccountDrafts(buildAccountDrafts(nextStatus.accounts ?? []))
      toast.success(enabled ? '钉钉渠道已启用' : '钉钉渠道已停用')
    } catch (err) {
      void loadStatus()
      toast.warning(err instanceof Error ? err.message : '钉钉渠道开关更新失败')
    } finally {
      setSavingChannelEnabled(false)
    }
  }, [loadStatus])

  const updateAccount = useCallback(async (account: OpenClawDingTalkAccount, patch: Partial<DingTalkAccountDraft>) => {
    const draft = {
      ...getAccountDraft(accountDrafts, account.accountId, account),
      ...patch,
    }
    setAccountDrafts((current) => ({ ...current, [account.accountId]: draft }))
    setSavingAccountId(account.accountId)
    try {
      const nextStatus = await updateOpenClawDingTalkAccountConfig(account.accountId, {
        agentId: draft.agentId,
        enabled: draft.enabled,
      })
      setStatus(nextStatus)
      setAccountDrafts(buildAccountDrafts(nextStatus.accounts ?? []))
      toast.success('钉钉账号配置已更新')
    } catch (err) {
      setAccountDrafts(buildAccountDrafts(status?.accounts ?? []))
      toast.warning(err instanceof Error ? err.message : '钉钉账号配置更新失败')
    } finally {
      setSavingAccountId('')
    }
  }, [accountDrafts, status?.accounts])

  const openCreateModal = useCallback(() => {
    setForm(defaultForm)
    setEditAccount(null)
    setFormMode('create')
    setFormSection('basic')
    setIsFormOpen(true)
  }, [])

  const openEditModal = useCallback((account: OpenClawDingTalkAccount) => {
    setEditAccount(account)
    setFormMode('edit')
    setForm({
      accountId: account.accountId,
      ackText: account.ackText || '',
      agentId: account.agentId ?? '',
      allowFrom: (account.allowFrom ?? []).join('\n'),
      asyncMode: account.asyncMode,
      chatbotCorpId: account.chatbotCorpId || '',
      chatbotUserId: account.chatbotUserId || '',
      clientId: '',
      clientSecret: '',
      debug: account.debug,
      dmPolicy: account.dmPolicy || 'pairing',
      enableMediaUpload: account.enableMediaUpload,
      endpoint: account.endpoint || '',
      groupAllowFrom: (account.groupAllowFrom ?? []).join('\n'),
      groupPolicy: account.groupPolicy || 'inherit',
      groupReplyMode: account.groupReplyMode || 'inherit',
      groupSessionScope: account.groupSessionScope || 'inherit',
      groupsJson: account.groups ? JSON.stringify(account.groups, null, 2) : '',
      historyLimit: account.historyLimit != null ? String(account.historyLimit) : '',
      mediaMaxMb: account.mediaMaxMb != null ? String(account.mediaMaxMb) : '',
      name: account.name || '',
      requireMention: account.requireMention,
      resolveSenderNames: account.resolveSenderNames,
      separateSessionByConversation: account.separateSessionByConversation,
      sharedMemoryAcrossConversations: account.sharedMemoryAcrossConversations,
      systemPrompt: account.systemPrompt || '',
      textChunkLimit: account.textChunkLimit != null ? String(account.textChunkLimit) : '',
      toolsDocs: account.toolsDocs,
      toolsMedia: account.toolsMedia,
      typingIndicator: account.typingIndicator,
    })
    setFormSection('basic')
    setIsFormOpen(true)
  }, [])

  const submitForm = useCallback(async () => {
    let historyLimit: number | undefined
    let textChunkLimit: number | undefined
    let mediaMaxMb: number | undefined
    let groups: Record<string, unknown> | undefined
    try {
      historyLimit = parseOptionalInteger(form.historyLimit, '历史消息数', 0)
      textChunkLimit = parseOptionalInteger(form.textChunkLimit, '文本分块上限', 1)
      mediaMaxMb = parseOptionalNumber(form.mediaMaxMb, '媒体大小上限')
      groups = parseOptionalObject(form.groupsJson, '群覆盖 JSON')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '高级设置格式不正确')
      setFormSection('advanced')
      return
    }
    if (formMode === 'create') {
      if (!form.clientId.trim() || !form.clientSecret.trim()) {
        toast.warning('请输入 Client ID 和 Client Secret')
        return
      }
      if (form.dmPolicy === 'allowlist' && !form.allowFrom.trim()) {
        toast.warning('Allowlist 策略需要填写准入用户')
        setFormSection('advanced')
        return
      }
      if (form.groupPolicy === 'allowlist' && !form.groupAllowFrom.trim()) {
        toast.warning('群聊 Allowlist 策略需要填写准入群聊')
        setFormSection('advanced')
        return
      }
      setIsFormOpen(false)
      startStream('add', getOpenClawDingTalkAddAccountStreamURL(form))
      setForm(defaultForm)
      return
    }

    if (!editAccount) return
    if (form.dmPolicy === 'allowlist' && !form.allowFrom.trim()) {
      toast.warning('Allowlist 策略需要填写准入用户')
      setFormSection('advanced')
      return
    }
    if (form.groupPolicy === 'allowlist' && !form.groupAllowFrom.trim()) {
      toast.warning('群聊 Allowlist 策略需要填写准入群聊')
      setFormSection('advanced')
      return
    }
    setSavingAccountId(editAccount.accountId)
    try {
      const nextStatus = await updateOpenClawDingTalkAccountConfig(editAccount.accountId, {
        ackText: form.ackText,
        agentId: form.agentId,
        allowFrom: splitFormList(form.allowFrom),
        asyncMode: form.asyncMode,
        chatbotCorpId: form.chatbotCorpId,
        chatbotUserId: form.chatbotUserId,
        clientId: form.clientId.trim() || undefined,
        clientSecret: form.clientSecret.trim() || undefined,
        debug: form.debug,
        dmPolicy: form.dmPolicy,
        enableMediaUpload: form.enableMediaUpload,
        endpoint: form.endpoint,
        groupAllowFrom: splitFormList(form.groupAllowFrom),
        groupPolicy: form.groupPolicy === 'inherit' ? '' : form.groupPolicy,
        groupReplyMode: form.groupReplyMode === 'inherit' ? '' : form.groupReplyMode,
        groupSessionScope: form.groupSessionScope === 'inherit' ? '' : form.groupSessionScope,
        groups: form.groupsJson.trim() ? groups : {},
        historyLimit,
        mediaMaxMb,
        name: form.name,
        requireMention: form.requireMention,
        resolveSenderNames: form.resolveSenderNames,
        separateSessionByConversation: form.separateSessionByConversation,
        sharedMemoryAcrossConversations: form.sharedMemoryAcrossConversations,
        systemPrompt: form.systemPrompt,
        textChunkLimit,
        toolsDocs: form.toolsDocs,
        toolsMedia: form.toolsMedia,
        typingIndicator: form.typingIndicator,
      })
      setStatus(nextStatus)
      setAccountDrafts(buildAccountDrafts(nextStatus.accounts ?? []))
      setIsFormOpen(false)
      setEditAccount(null)
      toast.success('钉钉账号已更新')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '钉钉账号更新失败')
    } finally {
      setSavingAccountId('')
    }
  }, [editAccount, form, formMode, startStream])

  const deleteAccount = useCallback(async () => {
    if (!accountDeleteTarget) return
    setAccountDeleting(true)
    try {
      await deleteOpenClawDingTalkAccount(accountDeleteTarget.accountId)
      setAccountDeleteTarget(null)
      toast.success('钉钉账号已删除')
      void loadStatus()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '钉钉账号删除失败')
    } finally {
      setAccountDeleting(false)
    }
  }, [accountDeleteTarget, loadStatus])

  const agentOptions = useMemo(() => buildAgentOptions(agents), [agents])
  const isLoading = state === 'loading' && !status
  const isTaskRunning = Boolean(task && task.status !== 'done' && task.status !== 'error')
  const accounts = status?.accounts ?? []
  const configured = Boolean(status?.configured)
  const installed = Boolean(status?.installed)
  const enabled = Boolean(status?.enabled)

  return (
    <>
      {error ? (
        <div className=" py-3 w-full">
          <Alert status="danger" className="items-center">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>钉钉渠道状态加载失败</Alert.Title>
              <Alert.Description>请检查钉钉官方插件和 Gateway 运行状态。</Alert.Description>
            </Alert.Content>
            <Button isIconOnly size="sm" variant="danger" onPress={() => void loadStatus()}>
              <Icon icon="lucide:refresh-cw" className="size-4" />
            </Button>
          </Alert>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 w-full">
        <Card>
          <Card.Content>
            <div className="flex w-full items-center justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <Icon icon="ant-design:dingtalk-circle-filled" className="size-7" />
                </div>
                <div className="min-w-0">
                  <Card.Title>钉钉</Card.Title>
                  <Card.Description>接入钉钉官方 OpenClaw 插件。</Card.Description>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {state !== 'loading' && !isTaskRunning ? (
                  <Button size="sm" isIconOnly variant={state === 'error' ? 'primary' : 'ghost'} aria-label="刷新钉钉渠道状态" onPress={() => void loadStatus()}>
                    <Icon icon="lucide:refresh-cw" />
                  </Button>
                ) : null}
                {!installed && !isTaskRunning ? (
                  <Button size="sm" variant="primary" onPress={() => startStream('install', getOpenClawDingTalkInstallStreamURL())}>
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
                    <Button size="sm" variant="primary" isDisabled={isTaskRunning} onPress={() => startStream('scan', getOpenClawDingTalkScanAddStreamURL())}>
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
              description: configured ? (accounts.length > 0 ? `${accounts.length} 个机器人` : '已配置单机器人凭据') : '等待关联机器人',
              icon: 'lucide:key-round',
              loading: isLoading,
              ok: configured,
              title: '配置',
            },
            {
              description: enabled ? '钉钉渠道已启用' : '钉钉渠道已停用',
              icon: 'lucide:radio',
              loading: isLoading,
              ok: enabled,
              title: '运行',
            },
            {
              action: (
                <Switch
                  size="lg"
                  aria-label="切换钉钉渠道总开关"
                  isSelected={enabled}
                  isDisabled={!configured || isTaskRunning || isLoading || savingChannelEnabled}
                  onChange={(nextEnabled) => void updateChannelEnabled(nextEnabled)}
                >
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch>
              ),
              description: enabled ? '钉钉渠道已启用' : '钉钉渠道已停用',
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
                <DingTalkAccountCard
                  key={account.accountId}
                  account={account}
                  agentOptions={agentOptions}
                  draft={getAccountDraft(accountDrafts, account.accountId, account)}
                  isDisabled={isLoading || isTaskRunning}
                  isSaving={savingAccountId === account.accountId}
                  onChange={(patch) => void updateAccount(account, patch)}
                  onDelete={setAccountDeleteTarget}
                  onEdit={openEditModal}
                />
              ))}
            </div>
          ) : (
            <ChannelEmptyState
              description="添加一个钉钉机器人账号后，就可以配置路由 Agent、启用状态和消息接入策略。"
              icon="ant-design:dingtalk-circle-filled"
              title="还没有钉钉账号"
            />
          )
        ) : (
          <ChannelEmptyState
            description="安装钉钉插件后，可以在这里添加机器人账号并配置消息接入。"
            icon="lucide:package-x"
            title="钉钉插件未安装"
          />
        )}

        {status?.error ? (
          <div className="rounded-xl bg-warning/10 p-3 text-sm leading-6 text-warning">{status.error}</div>
        ) : null}

        <TaskLogPanel task={task} taskKind={taskKind} logRef={logRef} onClose={() => setTask(null)} />

        <OpenClawPairingModal
          channel="dingtalk-connector"
          channelLabel="钉钉"
          isOpen={isPairingOpen}
          onApproved={() => void loadStatus()}
          onOpenChange={setIsPairingOpen}
        />

        <DingTalkAuthorizationQrModal
          isOpen={authorizationQrOpen && Boolean(authorizationQr)}
          qr={authorizationQr}
          onOpenChange={handleAuthorizationQrOpenChange}
        />

        <DingTalkAccountModal
          agentOptions={agentOptions}
          form={form}
          activeSection={formSection}
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
                <AlertDialog.Heading>卸载钉钉插件？</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-sm leading-6 text-muted">这会执行插件卸载并清理本地钉钉渠道配置。</p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary">取消</Button>
                <Button variant="danger" onPress={() => {
                  setUninstallOpen(false)
                  startStream('uninstall', getOpenClawDingTalkUninstallStreamURL())
                }}>
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
                <AlertDialog.Heading>删除钉钉账号？</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="break-all text-sm leading-6 text-muted">{accountDeleteTarget?.accountId}</p>
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

function DingTalkAccountCard({
  account,
  agentOptions,
  draft,
  isDisabled,
  isSaving,
  onChange,
  onDelete,
  onEdit,
}: {
  account: OpenClawDingTalkAccount
  agentOptions: AgentOption[]
  draft: DingTalkAccountDraft
  isDisabled: boolean
  isSaving: boolean
  onChange: (patch: Partial<DingTalkAccountDraft>) => void
  onDelete: (account: OpenClawDingTalkAccount) => void
  onEdit: (account: OpenClawDingTalkAccount) => void
}) {
  const selectedAgent = agentOptions.find((option) => option.value === draft.agentId) ?? agentOptions[0]
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
              <Icon icon="ant-design:dingtalk-circle-filled" className="size-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Card.Title className="text-base">{account.name || account.accountId}</Card.Title>
              </div>
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
                    onChange({ agentId: option?.value ?? '' })
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
            <Switch size="lg" className="flex p-1 bg-default rounded-full" aria-label="启用钉钉账号" isSelected={draft.enabled} isDisabled={isDisabled || isSaving} onChange={(enabled) => onChange({ enabled })}>
              <Switch.Control><Switch.Thumb /></Switch.Control>
            </Switch>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            <Button isIconOnly size="sm" variant="tertiary" aria-label="编辑钉钉账号" onPress={() => onEdit(account)} isDisabled={isDisabled || isSaving}>
              <Icon icon="lucide:pencil" className="size-4" />
            </Button>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            <Button isIconOnly size="sm" variant="tertiary" aria-label="删除钉钉账号" onPress={() => onDelete(account)} isDisabled={isDisabled || isSaving}>
              <Icon icon="lucide:trash-2" className="size-4" />
            </Button>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function DingTalkAccountModal({
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
  activeSection: ModalSection
  agentOptions: AgentOption[]
  form: DingTalkForm
  isOpen: boolean
  isSubmitting: boolean
  mode: ModalMode
  onActiveSectionChange: (section: ModalSection) => void
  onFormChange: (form: DingTalkForm) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
}) {
  const update = (patch: Partial<DingTalkForm>) => onFormChange({ ...form, ...patch })
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="sm:max-w-[680px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent/10 text-accent">
              <Icon icon="ant-design:dingtalk-circle-filled" className="size-5" />
            </Modal.Icon>
            <div>
              <Modal.Heading>{mode === 'edit' ? '编辑钉钉机器人' : '添加钉钉机器人'}</Modal.Heading>
              <p className="mt-1 text-sm text-muted">{mode === 'edit' ? '更新账号策略、凭据和 Agent 绑定。' : '写入钉钉官方 connector 多账号配置。'}</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="space-y-5 p-1">
              <Segment selectedKey={activeSection} onSelectionChange={(key) => onActiveSectionChange(String(key) as ModalSection)}>
                {modalTabs.map((tab) => (
                  <Segment.Item key={tab.id} id={tab.id}>
                    <Segment.Separator />
                    <Icon icon={tab.icon} className="size-4" />
                    {tab.label}
                  </Segment.Item>
                ))}
              </Segment>

              {activeSection === 'basic' ? (
                <div className="space-y-5">
                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>机器人</ItemCardGroup.Title>
                      <ItemCardGroup.Description>保存到 channels.dingtalk-connector.accounts。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem description="用于多账号配置和路由匹配。" icon="lucide:user-round" title="账号 ID">
                      <ClearableInput value={form.accountId} disabled={isSubmitting || mode === 'edit'} placeholder="default" onChange={(accountId) => update({ accountId })} />
                    </FormItem>
                    <FormItem description="后台显示名称。" icon="lucide:badge" title="名称">
                      <ClearableInput value={form.name} disabled={isSubmitting} placeholder="日报机器人" onChange={(name) => update({ name })} />
                    </FormItem>
                    <FormItem description={mode === 'edit' ? '留空保持当前 Client ID 不变。' : '钉钉应用 AppKey。'} icon="lucide:key-round" title="Client ID">
                      <ClearableInput value={form.clientId} disabled={isSubmitting} placeholder="ding..." onChange={(clientId) => update({ clientId })} />
                    </FormItem>
                    <FormItem description={mode === 'edit' ? '留空保持当前 Client Secret 不变。' : '钉钉应用 AppSecret。'} icon="lucide:lock-keyhole" title="Client Secret">
                      <ClearableInput value={form.clientSecret} disabled={isSubmitting} placeholder="secret" onChange={(clientSecret) => update({ clientSecret })} />
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
                  </ItemCardGroup>

                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>访问策略</ItemCardGroup.Title>
                      <ItemCardGroup.Description>控制私聊、群聊和 @ 触发。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem description="私聊准入策略。" icon="lucide:shield-check" title="DM 策略">
                      <FriendlySelect ariaLabel="DM 策略" isDisabled={isSubmitting} options={dmPolicyOptions} value={form.dmPolicy} onChange={(value) => update({ dmPolicy: String(value ?? 'pairing') })} />
                    </FormItem>
                    <FormItem description="群聊准入策略。" icon="lucide:messages-square" title="群聊策略">
                      <FriendlySelect ariaLabel="群聊策略" isDisabled={isSubmitting} options={groupPolicyOptions} value={form.groupPolicy || 'inherit'} onChange={(value) => update({ groupPolicy: String(value ?? 'inherit') })} />
                    </FormItem>
                    <FormItem actionClassName="w-fit" description="群消息需要 @ 机器人后才触发。" icon="lucide:at-sign" title="群聊需 @">
                      <Switch size="lg" aria-label="群聊要求提及机器人" isSelected={form.requireMention} isDisabled={isSubmitting} onChange={(requireMention) => update({ requireMention })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </FormItem>
                  </ItemCardGroup>
                </div>
              ) : (
                <div className="space-y-5">
                  <TextareaCard
                    description="私聊 allowlist 使用，支持逗号或换行分隔。"
                    disabled={isSubmitting}
                    icon="lucide:users"
                    placeholder="user-open-id-1, user-open-id-2"
                    title="准入用户"
                    value={form.allowFrom}
                    onChange={(allowFrom) => update({ allowFrom })}
                  />
                  <TextareaCard
                    description="群聊 allowlist 使用，填写 conversationId。"
                    disabled={isSubmitting}
                    icon="lucide:message-square-lock"
                    placeholder="cidxxx, cidyyy"
                    title="准入群聊"
                    value={form.groupAllowFrom}
                    onChange={(groupAllowFrom) => update({ groupAllowFrom })}
                  />
                  <TextareaCard
                    description="可选，作为该机器人的提示词补充。"
                    disabled={isSubmitting}
                    icon="lucide:file-text"
                    placeholder="你是团队日报助手。"
                    title="系统提示词"
                    value={form.systemPrompt}
                    onChange={(systemPrompt) => update({ systemPrompt })}
                  />

                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>会话与回复</ItemCardGroup.Title>
                      <ItemCardGroup.Description>控制群聊上下文、流式卡片和异步确认。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem description="群聊使用 AI 卡片、文本或 Markdown 回复。" icon="lucide:message-circle-reply" title="群回复模式">
                      <FriendlySelect ariaLabel="群回复模式" isDisabled={isSubmitting} options={groupReplyModeOptions} value={form.groupReplyMode || 'inherit'} onChange={(value) => update({ groupReplyMode: String(value ?? 'inherit') })} />
                    </FormItem>
                    <FormItem description="群内共享会话，或按发送者拆分。" icon="lucide:route" title="群会话范围">
                      <FriendlySelect ariaLabel="群会话范围" isDisabled={isSubmitting} options={groupSessionScopeOptions} value={form.groupSessionScope || 'inherit'} onChange={(value) => update({ groupSessionScope: String(value ?? 'inherit') })} />
                    </FormItem>
                    <FormItem actionClassName="w-fit" description="按会话隔离上下文。" icon="lucide:split" title="会话隔离">
                      <Switch size="lg" aria-label="按会话隔离上下文" isSelected={form.separateSessionByConversation} isDisabled={isSubmitting} onChange={(separateSessionByConversation) => update({ separateSessionByConversation })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </FormItem>
                    <FormItem actionClassName="w-fit" description="跨会话共享记忆。" icon="lucide:brain" title="共享记忆">
                      <Switch size="lg" aria-label="跨会话共享记忆" isSelected={form.sharedMemoryAcrossConversations} isDisabled={isSubmitting} onChange={(sharedMemoryAcrossConversations) => update({ sharedMemoryAcrossConversations })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </FormItem>
                    <FormItem actionClassName="w-fit" description="长任务先回复确认文本。" icon="lucide:timer" title="异步模式">
                      <Switch size="lg" aria-label="启用异步模式" isSelected={form.asyncMode} isDisabled={isSubmitting} onChange={(asyncMode) => update({ asyncMode })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </FormItem>
                    <FormItem description="异步模式开启时发送。" icon="lucide:message-square-text" title="确认文本">
                      <ClearableInput value={form.ackText} disabled={isSubmitting} placeholder="已收到，正在处理。" onChange={(ackText) => update({ ackText })} />
                    </FormItem>
                  </ItemCardGroup>

                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>工具与媒体</ItemCardGroup.Title>
                      <ItemCardGroup.Description>控制钉钉文档、媒体上传和上下文限额。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem actionClassName="w-fit" description="启用文档相关工具。" icon="lucide:file-text" title="文档工具">
                      <Switch size="lg" aria-label="启用文档工具" isSelected={form.toolsDocs} isDisabled={isSubmitting} onChange={(toolsDocs) => update({ toolsDocs })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </FormItem>
                    <FormItem actionClassName="w-fit" description="启用媒体相关工具。" icon="lucide:image" title="媒体工具">
                      <Switch size="lg" aria-label="启用媒体工具" isSelected={form.toolsMedia} isDisabled={isSubmitting} onChange={(toolsMedia) => update({ toolsMedia })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </FormItem>
                    <FormItem actionClassName="w-fit" description="允许上传媒体到钉钉。" icon="lucide:upload-cloud" title="媒体上传">
                      <Switch size="lg" aria-label="启用媒体上传" isSelected={form.enableMediaUpload} isDisabled={isSubmitting} onChange={(enableMediaUpload) => update({ enableMediaUpload })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </FormItem>
                    <FormItem description="留空使用 connector 默认值。" icon="lucide:history" title="历史消息数">
                      <ClearableInput value={form.historyLimit} disabled={isSubmitting} placeholder="0" onChange={(historyLimit) => update({ historyLimit })} />
                    </FormItem>
                    <FormItem description="正整数，留空使用默认值。" icon="lucide:wrap-text" title="文本分块上限">
                      <ClearableInput value={form.textChunkLimit} disabled={isSubmitting} placeholder="4000" onChange={(textChunkLimit) => update({ textChunkLimit })} />
                    </FormItem>
                    <FormItem description="单位 MB，留空使用默认值。" icon="lucide:file-up" title="媒体大小上限">
                      <ClearableInput value={form.mediaMaxMb} disabled={isSubmitting} placeholder="20" onChange={(mediaMaxMb) => update({ mediaMaxMb })} />
                    </FormItem>
                  </ItemCardGroup>

                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>调试与身份</ItemCardGroup.Title>
                      <ItemCardGroup.Description>多 Agent 协作和连接排障。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem actionClassName="w-fit" description="输出 connector 调试日志。" icon="lucide:bug" title="Debug">
                      <Switch size="lg" aria-label="启用 debug" isSelected={form.debug} isDisabled={isSubmitting} onChange={(debug) => update({ debug })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </FormItem>
                    <FormItem actionClassName="w-fit" description="解析发送者名称。" icon="lucide:id-card" title="解析发送者">
                      <Switch size="lg" aria-label="解析发送者名称" isSelected={form.resolveSenderNames} isDisabled={isSubmitting} onChange={(resolveSenderNames) => update({ resolveSenderNames })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </FormItem>
                    <FormItem actionClassName="w-fit" description="展示正在输入状态。" icon="lucide:ellipsis" title="输入状态">
                      <Switch size="lg" aria-label="展示正在输入状态" isSelected={form.typingIndicator} isDisabled={isSubmitting} onChange={(typingIndicator) => update({ typingIndicator })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </FormItem>
                    <FormItem description="自定义 DWClient gateway endpoint。" icon="lucide:plug" title="Endpoint">
                      <ClearableInput value={form.endpoint} disabled={isSubmitting} placeholder="https://..." onChange={(endpoint) => update({ endpoint })} />
                    </FormItem>
                    <FormItem description="日志中 BotIdentity 的 chatbotUserId。" icon="lucide:bot-message-square" title="Chatbot User ID">
                      <ClearableInput value={form.chatbotUserId} disabled={isSubmitting} placeholder="加密机器人用户 ID" onChange={(chatbotUserId) => update({ chatbotUserId })} />
                    </FormItem>
                    <FormItem description="日志中 BotIdentity 的 chatbotCorpId。" icon="lucide:building-2" title="Chatbot Corp ID">
                      <ClearableInput value={form.chatbotCorpId} disabled={isSubmitting} placeholder="corp id" onChange={(chatbotCorpId) => update({ chatbotCorpId })} />
                    </FormItem>
                  </ItemCardGroup>

                  <TextareaCard
                    description="高级群覆盖配置，必须是 JSON 对象；留空会清除账号级覆盖。"
                    disabled={isSubmitting}
                    icon="lucide:braces"
                    placeholder={'{"conversation-id":{"requireMention":false}}'}
                    title="群覆盖 JSON"
                    value={form.groupsJson}
                    onChange={(groupsJson) => update({ groupsJson })}
                  />
                </div>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={() => onOpenChange(false)}>取消</Button>
            <Button
              variant="tertiary"
              onPress={() => void openExternalUrl('https://open-dev.dingtalk.com/fe/app')}
            >
              <Icon icon="lucide:external-link" className="size-4" />
              钉钉开放平台
            </Button>
            <Button variant="primary" isPending={isSubmitting} onPress={onSubmit}>
              <Icon icon="lucide:save" className="size-4" />
              {mode === 'edit' ? '保存修改' : '添加机器人'}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function DingTalkAuthorizationQrModal({ isOpen, onOpenChange, qr }: { isOpen: boolean; onOpenChange: (open: boolean) => void; qr: DingTalkAuthorizationQr | null }) {
  const openWebAuth = () => {
    if (!qr?.url) return
    void openExternalUrl(qr.url)
  }

  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
        <Modal.Container size="sm">
          <Modal.Dialog className="sm:max-w-[420px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Icon className="bg-warning/10 text-warning">
                <Icon icon="lucide:qr-code" className="size-5" />
              </Modal.Icon>
              <div>
                <Modal.Heading>钉钉扫码授权</Modal.Heading>
                <p className="mt-1 text-sm text-muted">使用钉钉扫一扫选择已有机器人，或通过网页新建机器人</p>
              </div>
            </Modal.Header>
            <Modal.Body>
              {qr ? (
                <div className="flex flex-col items-center gap-4 py-4">
                  <div className="rounded-xl bg-white p-4">
                    <img src={qr.dataUrl} alt="钉钉授权二维码" className="size-[280px]" />
                  </div>
                  {/* {qr.userCode ? (
                    <div className="rounded-lg bg-surface-secondary/50 px-3 py-2 font-mono text-sm text-foreground">
                      {qr.userCode}
                    </div>
                  ) : null} */}
                  <p className="text-center text-sm leading-6 text-muted">扫码可选择已有机器人；网页授权仅支持新建钉钉机器人。</p>
                </div>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button className="w-full" variant="primary" onPress={openWebAuth} isDisabled={!qr?.url}>
                <Icon icon="lucide:external-link" className="size-4" />
                新建机器人
              </Button>
            </Modal.Footer>
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

function TextareaCard({
  description,
  disabled,
  icon,
  onChange,
  placeholder,
  title,
  value,
}: {
  description: string
  disabled?: boolean
  icon: string
  onChange: (value: string) => void
  placeholder?: string
  title: string
  value: string
}) {
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
        <textarea
          className="min-h-24 w-full rounded-2xl border border-divider bg-surface-secondary/50 px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent disabled:opacity-60"
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </Card.Content>
    </Card>
  )
}

function FormItem({
  actionClassName = 'w-full w-auto',
  children,
  description,
  icon,
  title,
}: {
  actionClassName?: string
  children: ReactNode
  description?: string
  icon: string
  title: string
}) {
  return (
    <ItemCard>
      <ItemCard.Icon className="size-10 rounded-full bg-surface-secondary/50 text-muted">
        <Icon icon={icon} className="size-5" />
      </ItemCard.Icon>
      <ItemCard.Content>
        <ItemCard.Title>{title}</ItemCard.Title>
        {description ? <ItemCard.Description>{description}</ItemCard.Description> : null}
      </ItemCard.Content>
      <ItemCard.Action>
        <div className={actionClassName}>{children}</div>
      </ItemCard.Action>
    </ItemCard>
  )
}

function FriendlySelect({
  ariaLabel,
  isDisabled,
  onChange,
  options,
  value,
}: {
  ariaLabel: string
  isDisabled?: boolean
  onChange: (value: Key | null) => void
  options: Array<{ id: string; label: string }>
  value: Key | null
}) {
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
          <ItemCard.Icon>
            <Icon icon={item.icon} className="text-muted" />
          </ItemCard.Icon>
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

function buildAccountDrafts(accounts: OpenClawDingTalkAccount[]) {
  return accounts.reduce<Record<string, DingTalkAccountDraft>>((drafts, account) => {
    drafts[account.accountId] = getAccountDraft({}, account.accountId, account)
    return drafts
  }, {})
}

function getAccountDraft(drafts: Record<string, DingTalkAccountDraft>, accountId: string, account?: OpenClawDingTalkAccount): DingTalkAccountDraft {
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
  return value
    .split(/[,，\n\r;；]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseOptionalInteger(value: string, label: string, min: number) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${label}必须是大于等于 ${min} 的整数`)
  }
  return parsed
}

function parseOptionalNumber(value: string, label: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label}必须是大于 0 的数字`)
  }
  return parsed
}

function parseOptionalObject(value: string, label: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = JSON.parse(trimmed) as unknown
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${label}必须是 JSON 对象`)
  }
  return parsed as Record<string, unknown>
}

function extractDingTalkAuthorizationUrl(line: string) {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
  return line
    .replace(ansiPattern, '')
    .match(/https:\/\/[^\s"'<>]+\/openapp\/registration\/openClaw\?\S+/)?.[0]
    ?.replace(/[)。）\],;，；]+$/, '') ?? ''
}

function extractDingTalkUserCode(url: string) {
  try {
    return new URL(url).searchParams.get('user_code') ?? undefined
  } catch {
    return undefined
  }
}

function maskDingTalkSecret(line: string) {
  return line
    .replace(/(clientSecret=|clientSecret["':\s]+|client_secret["':\s]+)[^,\s"'}]+/gi, '$1<client-secret>')
    .replace(/(Client Secret:\s*)\S+/gi, '$1<client-secret>')
}

function taskTitle(kind: TaskKind | null) {
  switch (kind) {
    case 'add':
      return '添加钉钉机器人'
    case 'install':
      return '安装钉钉插件'
    case 'scan':
      return '扫码添加钉钉机器人'
    case 'uninstall':
      return '卸载钉钉插件'
    default:
      return '钉钉渠道任务'
  }
}

function taskDoneMessage(kind: TaskKind | null) {
  switch (kind) {
    case 'add':
      return '钉钉机器人已添加'
    case 'install':
      return '钉钉插件安装完成'
    case 'scan':
      return '钉钉扫码添加完成'
    case 'uninstall':
      return '钉钉插件卸载完成'
    default:
      return '钉钉渠道任务完成'
  }
}

function OpenClawDingTalkPage() {
  usePageTitle('OpenClaw 钉钉渠道')

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <OpenClawDingTalkPanel />
      </div>
    </DashboardLayout>
  )
}

export default OpenClawDingTalkPage
