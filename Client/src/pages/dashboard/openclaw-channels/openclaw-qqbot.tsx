import type { ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Key } from '@heroui/react'
import { AlertDialog, Alert, Button, Card, Chip, Dropdown, InputGroup, Link, ListBox, Modal, Separator, Skeleton, Switch, toast } from '@heroui/react'
import { CellSelect, ItemCard, ItemCardGroup, Segment } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type {
  OpenClawAgentSummary,
  OpenClawChannelStreamError,
  OpenClawChannelStreamLog,
  OpenClawChannelStreamMeta,
  OpenClawChannelStreamStatus,
  OpenClawChannelTaskResponse,
  OpenClawQQBotAccount,
  OpenClawQQBotStatusResponse,
} from '@/api'
import {
  deleteOpenClawQQBotAccount,
  getOpenClawQQBotAddAccountStreamURL,
  getOpenClawQQBotInstallStreamURL,
  getOpenClawQQBotStatus,
  getOpenClawQQBotUninstallStreamURL,
  listOpenClawAgents,
  updateOpenClawQQBotAccountConfig,
  updateOpenClawQQBotConfig,
} from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { openExternalUrl } from '@/utils/openExternalUrl'
import DashboardLayout from '@/layouts/Dashboard'

type LoadState = 'error' | 'idle' | 'loading' | 'ready'
type QQBotTaskKind = 'add' | 'install' | 'uninstall'
type AccountModalMode = 'create' | 'edit'
type QQBotFormSection = 'advanced' | 'form' | 'help'

type QQBotAccountDraft = {
  agentId: string
  enabled: boolean
}

type QQBotForm = {
  accountId: string
  agentId: string
  allowFrom: string
  appId: string
  clientSecret: string
  deliverDebounceEnabled: boolean
  deliverDebounceMaxWaitMs: string
  deliverDebounceSeparator: string
  deliverDebounceWindowMs: string
  dmPolicy: string
  execApprovalsAgentFilter: string
  execApprovalsApprovers: string
  execApprovalsEnabled: string
  execApprovalsSessionFilter: string
  execApprovalsTarget: string
  groupAllowFrom: string
  groupPolicy: string
  markdownSupport: boolean
  name: string
  sttApiKey: string
  sttBaseUrl: string
  sttEnabled: boolean
  sttModel: string
  sttProvider: string
  streamingC2CStreamApi: boolean
  streamingEnabled: boolean
  streamingMode: string
  systemPrompt: string
  ttsApiKey: string
  ttsBaseUrl: string
  ttsEnabled: boolean
  ttsModel: string
  ttsProvider: string
  ttsResponseType: string
  ttsVoice: string
  upgradeMode: string
  upgradePkg: string
  upgradeUrl: string
  urlDirectUpload: boolean
}

type AgentOption = {
  id: string
  label: string
  value: string
}

const addFormTabs: Array<{ icon: string; id: QQBotFormSection; label: string }> = [
  { icon: 'lucide:user-round-cog', id: 'form', label: '账号信息' },
  { icon: 'lucide:circle-help', id: 'help', label: '帮助流程' },
]

const editFormTabs: Array<{ icon: string; id: QQBotFormSection; label: string }> = [
  { icon: 'lucide:user-round-cog', id: 'form', label: '基本信息' },
  { icon: 'lucide:sliders-horizontal', id: 'advanced', label: '高级设置' },
]

const qqbotHelpSteps: Array<{ content: ReactNode; step: string }> = [
  {
    step: '1',
    content: (
      <>
        打开{' '}
        <Link href="https://q.qq.com/qqbot/#/developer/developer-setting" target="_blank" rel="noreferrer">
          QQ 开放平台
          <Link.Icon />
        </Link>
        ，创建或进入机器人应用。
      </>
    ),
  },
  { step: '2', content: '复制 AppID 和 Client Secret。' },
  { step: '3', content: '写入 AppID、Client Secret、准入策略和 Agent 绑定。' },
]

const dmPolicyOptions = [
  { id: 'open', label: '开放' },
  { id: 'allowlist', label: '仅准入列表' },
  { id: 'disabled', label: '禁用' },
]

const groupPolicyOptions = [
  { id: 'open', label: '开放' },
  { id: 'allowlist', label: '仅群准入列表' },
  { id: 'disabled', label: '禁用' },
]

const upgradeModeOptions = [
  { id: 'doc', label: '只显示升级文档' },
  { id: 'hot-reload', label: '热更新插件' },
]

const streamingModeOptions = [
  { id: 'off', label: '关闭' },
  { id: 'partial', label: '逐步预览' },
]

const execApprovalsEnabledOptions = [
  { id: 'auto', label: '自动' },
  { id: 'true', label: '启用' },
  { id: 'false', label: '禁用' },
]

const execApprovalsTargetOptions = [
  { id: 'dm', label: '私聊' },
  { id: 'channel', label: '原聊天' },
  { id: 'both', label: '两者都发' },
]

const defaultForm: QQBotForm = {
  accountId: 'default',
  agentId: '',
  allowFrom: '',
  appId: '',
  clientSecret: '',
  deliverDebounceEnabled: true,
  deliverDebounceMaxWaitMs: '8000',
  deliverDebounceSeparator: '',
  deliverDebounceWindowMs: '1500',
  dmPolicy: 'allowlist',
  execApprovalsAgentFilter: '',
  execApprovalsApprovers: '',
  execApprovalsEnabled: 'auto',
  execApprovalsSessionFilter: '',
  execApprovalsTarget: 'dm',
  groupAllowFrom: '',
  groupPolicy: 'allowlist',
  markdownSupport: true,
  name: '',
  sttApiKey: '',
  sttBaseUrl: '',
  sttEnabled: false,
  sttModel: '',
  sttProvider: '',
  streamingC2CStreamApi: false,
  streamingEnabled: false,
  streamingMode: 'off',
  systemPrompt: '',
  ttsApiKey: '',
  ttsBaseUrl: '',
  ttsEnabled: false,
  ttsModel: '',
  ttsProvider: '',
  ttsResponseType: '',
  ttsVoice: '',
  upgradeMode: 'hot-reload',
  upgradePkg: '',
  upgradeUrl: '',
  urlDirectUpload: true,
}

export function OpenClawQQBotPanel() {
  const [state, setState] = useState<LoadState>('idle')
  const [status, setStatus] = useState<OpenClawQQBotStatusResponse | null>(null)
  const [accountDrafts, setAccountDrafts] = useState<Record<string, QQBotAccountDraft>>({})
  const [agents, setAgents] = useState<OpenClawAgentSummary[]>([])
  const [error, setError] = useState('')
  const [savingAccountId, setSavingAccountId] = useState('')
  const [savingChannelEnabled, setSavingChannelEnabled] = useState(false)
  const [task, setTask] = useState<OpenClawChannelTaskResponse | null>(null)
  const [taskKind, setTaskKind] = useState<QQBotTaskKind | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<AccountModalMode>('create')
  const [activeSection, setActiveSection] = useState<QQBotFormSection>('form')
  const [form, setForm] = useState<QQBotForm>(defaultForm)
  const [accountEditTarget, setAccountEditTarget] = useState<OpenClawQQBotAccount | null>(null)
  const [accountDeleteTarget, setAccountDeleteTarget] = useState<OpenClawQQBotAccount | null>(null)
  const [accountDeleting, setAccountDeleting] = useState(false)
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const logRef = useRef<HTMLPreElement | null>(null)
  const sourceRef = useRef<EventSource | null>(null)
  const streamFinishedRef = useRef(false)

  const loadStatus = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const [nextStatus, nextAgents] = await Promise.all([getOpenClawQQBotStatus(), listOpenClawAgents()])
      setStatus(nextStatus)
      setAgents(nextAgents.agents ?? [])
      setAccountDrafts(buildQQBotAccountDrafts(nextStatus.accounts ?? []))
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'QQBot 渠道状态加载失败')
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

  const startStream = useCallback((kind: QQBotTaskKind, url: string) => {
    closeStream()
    streamFinishedRef.current = false
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
          setTask(null)
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
        setTask((current) => current ? {
          ...current,
          id: payload.id || current.id,
          logs: appendTaskLog(current.logs, maskQQBotSecret(payload.line)),
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
      setTask((current) => current ? {
        ...current,
        error: '流式连接中断',
        logs: appendTaskLog(current.logs, '失败：流式连接中断'),
        progress: 100,
        status: 'error',
        updatedAt: timestamp,
      } : current)
      toast.warning('QQBot 渠道流式任务连接中断')
      void loadStatus()
    }
  }, [closeStream, loadStatus])

  const openAddModal = useCallback(() => {
    setModalMode('create')
    setAccountEditTarget(null)
    setForm(defaultForm)
    setActiveSection('form')
    setIsModalOpen(true)
  }, [])

  const openEditModal = useCallback((account: OpenClawQQBotAccount) => {
    setModalMode('edit')
    setAccountEditTarget(account)
    setForm(buildQQBotFormFromAccount(account))
    setActiveSection('form')
    setIsModalOpen(true)
  }, [])

  const submitModal = useCallback(async () => {
    if (modalMode === 'create') {
      if (!form.appId.trim() || !form.clientSecret.trim()) {
        toast.warning('请输入 AppID 和 Client Secret')
        return
      }
      setIsModalOpen(false)
      startStream('add', getOpenClawQQBotAddAccountStreamURL(form))
      setForm(defaultForm)
      setActiveSection('form')
      return
    }
    if (!accountEditTarget) return
    setSavingAccountId(accountEditTarget.accountId)
    try {
      const nextStatus = await updateOpenClawQQBotAccountConfig(accountEditTarget.accountId, buildQQBotAccountUpdateRequest(form))
      setStatus(nextStatus)
      setAccountDrafts(buildQQBotAccountDrafts(nextStatus.accounts ?? []))
      setIsModalOpen(false)
      setAccountEditTarget(null)
      toast.success('QQBot 账号已更新')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'QQBot 账号更新失败')
    } finally {
      setSavingAccountId('')
    }
  }, [accountEditTarget, form, modalMode, startStream])

  const updateChannelEnabled = useCallback(async (enabled: boolean) => {
    setSavingChannelEnabled(true)
    setStatus((current) => current ? { ...current, enabled, config: { ...current.config, enabled } } : current)
    try {
      const nextStatus = await updateOpenClawQQBotConfig({ enabled })
      setStatus(nextStatus)
      setAccountDrafts(buildQQBotAccountDrafts(nextStatus.accounts ?? []))
      toast.success(enabled ? 'QQBot 渠道已启用' : 'QQBot 渠道已停用')
    } catch (err) {
      void loadStatus()
      toast.warning(err instanceof Error ? err.message : 'QQBot 渠道开关更新失败')
    } finally {
      setSavingChannelEnabled(false)
    }
  }, [loadStatus])

  const updateAccount = useCallback(async (account: OpenClawQQBotAccount, patch: Partial<QQBotAccountDraft>) => {
    const draft = {
      ...getQQBotAccountDraft(accountDrafts, account.accountId, account),
      ...patch,
    }
    setAccountDrafts((current) => ({ ...current, [account.accountId]: draft }))
    setSavingAccountId(account.accountId)
    try {
      const nextStatus = await updateOpenClawQQBotAccountConfig(account.accountId, {
        agentId: draft.agentId,
        enabled: draft.enabled,
      })
      setStatus(nextStatus)
      setAccountDrafts(buildQQBotAccountDrafts(nextStatus.accounts ?? []))
      toast.success('QQBot 账号配置已更新')
    } catch (err) {
      setAccountDrafts(buildQQBotAccountDrafts(status?.accounts ?? []))
      toast.warning(err instanceof Error ? err.message : 'QQBot 账号配置更新失败')
    } finally {
      setSavingAccountId('')
    }
  }, [accountDrafts, status?.accounts])

  const deleteAccount = useCallback(async () => {
    if (!accountDeleteTarget) return
    setAccountDeleting(true)
    try {
      await deleteOpenClawQQBotAccount(accountDeleteTarget.accountId)
      setAccountDeleteTarget(null)
      toast.success('QQBot 账号已删除')
      void loadStatus()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'QQBot 账号删除失败')
    } finally {
      setAccountDeleting(false)
    }
  }, [accountDeleteTarget, loadStatus])

  const uninstallPlugin = useCallback(() => {
    setUninstallOpen(false)
    startStream('uninstall', getOpenClawQQBotUninstallStreamURL())
  }, [startStream])

  const installPlugin = useCallback(() => {
    startStream('install', getOpenClawQQBotInstallStreamURL())
  }, [startStream])

  const agentOptions = useMemo(() => buildAgentOptions(agents), [agents])
  const isLoading = state === 'loading' && !status
  const isTaskRunning = Boolean(task && task.status !== 'done' && task.status !== 'error')
  const accounts = status?.accounts ?? []
  const configured = Boolean(status?.configured)
  const enabled = Boolean(status?.enabled)
  const installed = Boolean(status?.installed)
  const canUninstall = Boolean(status?.installed || status?.configured)

  return (
    <>
      {error ? (
        <div className="w-full py-3">
          <Alert status="danger" className="items-center">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>QQBot 渠道状态加载失败</Alert.Title>
              <Alert.Description>请检查 QQBot 渠道配置和网关运行状态。</Alert.Description>
            </Alert.Content>
            <Button isIconOnly size="sm" variant="danger" onPress={() => void loadStatus()}>
              <Icon icon="lucide:refresh-cw" className="size-4" />
            </Button>
          </Alert>
        </div>
      ) : null}

      <div className="mx-auto flex w-full flex-col gap-2">
        <Card>
          <Card.Content>
            <div className="flex w-full items-center justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <Icon icon="simple-icons:tencentqq" className="size-7" />
                </div>
                <div className="min-w-0">
                  <Card.Title>QQBot</Card.Title>
                  <Card.Description>通过 @tencent-connect/openclaw-qqbot 接入 QQ 机器人。</Card.Description>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {state !== 'loading' && !isTaskRunning ? (
                  <Button size="sm" isIconOnly variant={state === 'error' ? 'primary' : 'ghost'} aria-label="刷新 QQBot 渠道状态" onPress={() => void loadStatus()}>
                    <Icon icon="lucide:refresh-cw" />
                  </Button>
                ) : null}
                {installed ? (
                  <>
                    <Button
                      size="sm"
                      variant="tertiary"
                      isDisabled={!canUninstall || isTaskRunning || isLoading}
                      onPress={() => setUninstallOpen(true)}
                    >
                      <Icon icon="lucide:trash-2" />
                      卸载
                    </Button>
                    <Button size="sm" variant="primary" isDisabled={isTaskRunning} onPress={openAddModal}>
                      <Icon icon="lucide:plus" />
                      添加账号
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="primary" isDisabled={isTaskRunning || isLoading} onPress={installPlugin}>
                    <Icon icon="lucide:package-plus" />
                    安装
                  </Button>
                )}
              </div>
            </div>
          </Card.Content>
        </Card>

        <StatusItemList
          items={[
            {
              description: status?.installed ? 'QQBot 插件已安装' : '请先安装插件',
              icon: 'lucide:package-check',
              loading: isLoading,
              ok: Boolean(status?.installed),
              title: '插件状态',
            },
            {
              description: configured ? `${accounts.length} 个账号` : '等待配置 AppID 和 Secret',
              icon: 'lucide:key-round',
              loading: isLoading,
              ok: configured,
              title: '配置状态',
            },
            {
              description: enabled ? 'QQBot 渠道已启用' : 'QQBot 渠道已停用',
              icon: 'lucide:radio',
              loading: isLoading,
              ok: enabled,
              title: '运行状态',
            },
            {
              action: (
                <Switch
                  size="lg"
                  aria-label="切换 QQBot 渠道总开关"
                  isSelected={enabled}
                  isDisabled={!configured || isTaskRunning || isLoading || savingChannelEnabled}
                  onChange={(nextEnabled) => void updateChannelEnabled(nextEnabled)}
                >
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch>
              ),
              description: enabled ? 'QQBot 渠道已启用' : 'QQBot 渠道已停用',
              icon: 'lucide:power',
              loading: isLoading,
              ok: enabled,
              title: '启用状态',
            },
          ]}
        />

        {status?.installed ? (
          accounts.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {accounts.map((account) => (
                <QQBotAccountCard
                  key={account.accountId}
                  account={account}
                  agentOptions={agentOptions}
                  draft={getQQBotAccountDraft(accountDrafts, account.accountId, account)}
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
              description="添加一个 QQBot 账号后，就可以配置路由 Agent、启用状态和消息接入策略。"
              icon="ri:qq-fill"
              title="还没有 QQBot 账号"
            />
          )
        ) : (
          <ChannelEmptyState
            description="安装 QQBot 插件后，可以在这里添加账号并配置消息接入。"
            icon="lucide:package-x"
            title="QQBot 插件未安装"
          />
        )}

        {status?.error ? (
          <div className="rounded-xl bg-warning/10 p-3 text-sm leading-6 text-warning">{status.error}</div>
        ) : null}

        <TaskLogPanel task={task} taskKind={taskKind} logRef={logRef} onClose={() => setTask(null)} />

        <QQBotAccountModal
          activeSection={activeSection}
          agentOptions={agentOptions}
          form={form}
          isOpen={isModalOpen}
          isSubmitting={isTaskRunning || Boolean(accountEditTarget && savingAccountId === accountEditTarget.accountId)}
          mode={modalMode}
          onActiveSectionChange={setActiveSection}
          onFormChange={setForm}
          onOpenChange={(open) => {
            setIsModalOpen(open)
            if (!open) {
              setActiveSection('form')
              setAccountEditTarget(null)
              setModalMode('create')
            }
          }}
          onSubmit={submitModal}
        />

        <AlertDialog.Backdrop isOpen={uninstallOpen} onOpenChange={setUninstallOpen}>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-[480px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>卸载 QQBot 插件？</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-sm leading-6 text-muted">将卸载 @tencent-connect/openclaw-qqbot，并清理 QQBot 渠道配置、账号和 Agent 绑定。</p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary">取消</Button>
                <Button variant="danger" onPress={uninstallPlugin} isDisabled={isTaskRunning}>
                  <Icon icon="lucide:trash-2" />
                  卸载
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
                <AlertDialog.Heading>删除 QQBot 账号？</AlertDialog.Heading>
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

function QQBotAccountCard({
  account,
  agentOptions,
  draft,
  isDisabled,
  isSaving,
  onChange,
  onDelete,
  onEdit,
}: {
  account: OpenClawQQBotAccount
  agentOptions: AgentOption[]
  draft: QQBotAccountDraft
  isDisabled: boolean
  isSaving: boolean
  onChange: (patch: Partial<QQBotAccountDraft>) => void
  onDelete: (account: OpenClawQQBotAccount) => void
  onEdit: (account: OpenClawQQBotAccount) => void
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
              <Icon icon="ri:qq-fill" className="size-6" />
            </div>
            <div className="min-w-0">
              <Card.Title className="text-base">{account.name || account.accountId}</Card.Title>
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
            <Switch size="lg" className="flex p-1 bg-default rounded-full" aria-label="启用 QQBot 账号" isSelected={draft.enabled} isDisabled={isDisabled || isSaving} onChange={(enabled) => onChange({ enabled })}>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            <Button isIconOnly size="sm" variant="tertiary" aria-label="编辑 QQBot 账号" onPress={() => onEdit(account)} isDisabled={isDisabled || isSaving}>
              <Icon icon="lucide:pencil" className="size-4" />
            </Button>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            <Button isIconOnly size="sm" variant="tertiary" aria-label="删除 QQBot 账号" onPress={() => onDelete(account)} isDisabled={isDisabled || isSaving}>
              <Icon icon="lucide:trash-2" className="size-4" />
            </Button>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function QQBotAccountModal({
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
  activeSection: QQBotFormSection
  agentOptions: AgentOption[]
  form: QQBotForm
  isOpen: boolean
  isSubmitting: boolean
  mode: AccountModalMode
  onActiveSectionChange: (section: QQBotFormSection) => void
  onFormChange: (form: QQBotForm) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
}) {
  const tabs = mode === 'edit' ? editFormTabs : addFormTabs
  const update = (patch: Partial<QQBotForm>) => onFormChange({ ...form, ...patch })

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="sm:max-w-[680px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
              <Icon icon="simple-icons:tencentqq" className="size-5" />
            </Modal.Icon>
            <div>
              <Modal.Heading>{mode === 'edit' ? '编辑 QQBot 账号' : '添加 QQBot 账号'}</Modal.Heading>
              <p className="mt-1 text-sm text-muted">{mode === 'edit' ? '更新账号凭据、准入和语音能力配置。' : '填写 QQ 开放平台 AppID 与 Client Secret。'}</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="space-y-5 p-1">
              <Segment selectedKey={activeSection} onSelectionChange={(key) => onActiveSectionChange(String(key) as QQBotFormSection)}>
                {tabs.map((tab) => (
                  <Segment.Item key={tab.id} id={tab.id}>
                    <Segment.Separator />
                    <Icon icon={tab.icon} className="size-4" />
                    {tab.label}
                  </Segment.Item>
                ))}
              </Segment>

              {activeSection === 'help' ? (
                <div className="grid gap-3">
                  {qqbotHelpSteps.map((item) => (
                    <div key={item.step} className="flex items-start gap-3 rounded-xl bg-surface-secondary/50 p-3 text-sm text-foreground">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{item.step}</span>
                      <span className="leading-6">{item.content}</span>
                    </div>
                  ))}
                </div>
              ) : activeSection === 'advanced' ? (
                <div className="max-h-[500px] space-y-5 overflow-y-auto">
                  <AccessControlGroup form={form} isSubmitting={isSubmitting} onChange={update} />
                  <TextareaCard
                    description="账号级提示词，会写入 channels.qqbot.accounts.*.systemPrompt。"
                    disabled={isSubmitting}
                    icon="lucide:message-square-text"
                    placeholder="Keep answers brief."
                    title="System Prompt"
                    value={form.systemPrompt}
                    onChange={(systemPrompt) => update({ systemPrompt })}
                  />
                  <DeliveryExperienceGroup form={form} isSubmitting={isSubmitting} onChange={update} />
                  <OperationsGroup form={form} isSubmitting={isSubmitting} onChange={update} />
                  <StreamingApprovalsGroup form={form} isSubmitting={isSubmitting} onChange={update} />
                  <SpeechGroup
                    enabled={form.sttEnabled}
                    model={form.sttModel}
                    provider={form.sttProvider}
                    title="语音转文字 STT"
                    onChange={(patch) => update({
                      sttEnabled: patch.enabled ?? form.sttEnabled,
                      sttModel: patch.model ?? form.sttModel,
                      sttProvider: patch.provider ?? form.sttProvider,
                    })}
                  />
                  <SpeechGroup
                    enabled={form.ttsEnabled}
                    model={form.ttsModel}
                    provider={form.ttsProvider}
                    responseType={form.ttsResponseType}
                    title="文字转语音 TTS"
                    voice={form.ttsVoice}
                    withTTS
                    onChange={(patch) => update({
                      ttsEnabled: patch.enabled ?? form.ttsEnabled,
                      ttsModel: patch.model ?? form.ttsModel,
                      ttsProvider: patch.provider ?? form.ttsProvider,
                      ttsResponseType: patch.responseType ?? form.ttsResponseType,
                      ttsVoice: patch.voice ?? form.ttsVoice,
                    })}
                  />
                </div>
              ) : (
                <div className="max-h-[500px] space-y-5 overflow-y-auto">
                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>账号信息</ItemCardGroup.Title>
                      <ItemCardGroup.Description>{mode === 'edit' ? '编辑账号名称与基础凭据。' : '填写 QQBot 账号凭据。'}</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem description="填写一个可识别的名称。" icon="lucide:badge" title="账号名称">
                      <ClearableInput value={form.name} disabled={isSubmitting} placeholder="显示名称" onChange={(name) => update({ name })} />
                    </FormItem>
                    <Separator />
                    <FormItem description="OpenClaw 账号 ID。" icon="lucide:user-round" title="账号 ID">
                      <ClearableInput value={form.accountId} disabled={isSubmitting || mode === 'edit'} placeholder="default" onChange={(accountId) => update({ accountId })} />
                    </FormItem>
                    <Separator />
                    <FormItem description={mode === 'edit' ? '留空保持当前 AppID 不变。' : 'QQ 开放平台应用 AppID。'} icon="lucide:key-round" title="AppID">
                      <ClearableInput value={form.appId} disabled={isSubmitting} placeholder="1020..." onChange={(appId) => update({ appId })} />
                    </FormItem>
                    <Separator />
                    <FormItem description={mode === 'edit' ? '留空保持当前 Client Secret 不变。' : 'QQBot Client Secret。'} icon="lucide:lock-keyhole" title="Client Secret">
                      <ClearableInput value={form.clientSecret} disabled={isSubmitting} placeholder="client secret" onChange={(clientSecret) => update({ clientSecret })} />
                    </FormItem>
                    {mode === 'create' ? (
                      <>
                        <Separator />
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
                      </>
                    ) : null}
                  </ItemCardGroup>
                </div>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={() => onOpenChange(false)}>取消</Button>
            <Button
              variant="tertiary"
              onPress={() => void openExternalUrl('https://q.qq.com/qqbot/openclaw/index.html')}
            >
              <Icon icon="lucide:external-link" className="size-4" />
              QQ开放平台
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

function AccessControlGroup({
  form,
  isSubmitting,
  onChange,
}: {
  form: QQBotForm
  isSubmitting: boolean
  onChange: (patch: Partial<QQBotForm>) => void
}) {
  return (
    <ItemCardGroup className="overflow-hidden">
      <ItemCardGroup.Header>
        <ItemCardGroup.Title>访问控制</ItemCardGroup.Title>
        <ItemCardGroup.Description>控制私聊、群聊和账号级准入列表。</ItemCardGroup.Description>
      </ItemCardGroup.Header>
      <FormItem description="私聊消息如何准入。" icon="lucide:message-circle" title="DM 策略">
        <FriendlySelect ariaLabel="DM 策略" isDisabled={isSubmitting} options={dmPolicyOptions} value={form.dmPolicy || 'allowlist'} onChange={(dmPolicy) => onChange({ dmPolicy: String(dmPolicy ?? 'allowlist') })} />
      </FormItem>
      <Separator />
      <FormItem description="群消息如何准入。" icon="lucide:messages-square" title="群策略">
        <FriendlySelect ariaLabel="群策略" isDisabled={isSubmitting} options={groupPolicyOptions} value={form.groupPolicy || 'allowlist'} onChange={(groupPolicy) => onChange({ groupPolicy: String(groupPolicy ?? 'allowlist') })} />
      </FormItem>
      <Separator />
      <InlineTextareaItem
        description="支持逗号或换行分隔。"
        disabled={isSubmitting}
        icon="lucide:user-check"
        placeholder={'openid_1\nopenid_2'}
        title="私聊准入用户"
        value={form.allowFrom}
        onChange={(allowFrom) => onChange({ allowFrom })}
      />
      <Separator />
      <InlineTextareaItem
        description="群消息先匹配 groupAllowFrom，再回退 allowFrom。"
        disabled={isSubmitting}
        icon="lucide:users-round"
        placeholder={'group_openid_1\ngroup_openid_2'}
        title="群准入对象"
        value={form.groupAllowFrom}
        onChange={(groupAllowFrom) => onChange({ groupAllowFrom })}
      />
    </ItemCardGroup>
  )
}

function DeliveryExperienceGroup({
  form,
  isSubmitting,
  onChange,
}: {
  form: QQBotForm
  isSubmitting: boolean
  onChange: (patch: Partial<QQBotForm>) => void
}) {
  return (
    <ItemCardGroup className="overflow-hidden">
      <ItemCardGroup.Header>
        <ItemCardGroup.Title>投递体验</ItemCardGroup.Title>
        <ItemCardGroup.Description>控制 Markdown、URL 直传和多段回复合并。</ItemCardGroup.Description>
      </ItemCardGroup.Header>
      <FormItem actionClassName="w-fit" description="启用 QQ Markdown 能力。" icon="lucide:file-type-2" title="Markdown">
        <Switch size="lg" aria-label="启用 QQ Markdown" isSelected={form.markdownSupport} isDisabled={isSubmitting} onChange={(markdownSupport) => onChange({ markdownSupport })}>
          <Switch.Control><Switch.Thumb /></Switch.Control>
        </Switch>
      </FormItem>
      <Separator />
      <FormItem actionClassName="w-fit" description="公网媒体 URL 优先交给 QQ 平台拉取。" icon="lucide:upload-cloud" title="URL 直传">
        <Switch size="lg" aria-label="启用 URL 直传" isSelected={form.urlDirectUpload} isDisabled={isSubmitting} onChange={(urlDirectUpload) => onChange({ urlDirectUpload })}>
          <Switch.Control><Switch.Thumb /></Switch.Control>
        </Switch>
      </FormItem>
      <Separator />
      <FormItem actionClassName="w-fit" description="短时间内多次 deliver 合并成一条消息。" icon="lucide:merge" title="合并回复">
        <Switch size="lg" aria-label="启用合并回复" isSelected={form.deliverDebounceEnabled} isDisabled={isSubmitting} onChange={(deliverDebounceEnabled) => onChange({ deliverDebounceEnabled })}>
          <Switch.Control><Switch.Thumb /></Switch.Control>
        </Switch>
      </FormItem>
      <Separator />
      <FormItem description="合并窗口，单位毫秒。" icon="lucide:timer" title="窗口时间">
        <ClearableInput value={form.deliverDebounceWindowMs} disabled={isSubmitting} placeholder="1500" onChange={(deliverDebounceWindowMs) => onChange({ deliverDebounceWindowMs })} />
      </FormItem>
      <Separator />
      <FormItem description="从第一段消息开始的最长等待，单位毫秒。" icon="lucide:hourglass" title="最长等待">
        <ClearableInput value={form.deliverDebounceMaxWaitMs} disabled={isSubmitting} placeholder="8000" onChange={(deliverDebounceMaxWaitMs) => onChange({ deliverDebounceMaxWaitMs })} />
      </FormItem>
      <Separator />
      <FormItem description="合并多段文本时使用的分隔符。" icon="lucide:separator-horizontal" title="分隔符">
        <ClearableInput value={form.deliverDebounceSeparator} disabled={isSubmitting} placeholder="\\n\\n---\\n\\n" onChange={(deliverDebounceSeparator) => onChange({ deliverDebounceSeparator })} />
      </FormItem>
    </ItemCardGroup>
  )
}

function OperationsGroup({
  form,
  isSubmitting,
  onChange,
}: {
  form: QQBotForm
  isSubmitting: boolean
  onChange: (patch: Partial<QQBotForm>) => void
}) {
  return (
    <ItemCardGroup className="overflow-hidden">
      <ItemCardGroup.Header>
        <ItemCardGroup.Title>运维</ItemCardGroup.Title>
        <ItemCardGroup.Description>控制 /bot-upgrade 的展示和热更新行为。</ItemCardGroup.Description>
      </ItemCardGroup.Header>
      <FormItem description="/bot-upgrade 的处理方式。" icon="lucide:refresh-cw" title="升级模式">
        <FriendlySelect ariaLabel="升级模式" isDisabled={isSubmitting} options={upgradeModeOptions} value={form.upgradeMode || 'hot-reload'} onChange={(upgradeMode) => onChange({ upgradeMode: String(upgradeMode ?? 'hot-reload') })} />
      </FormItem>
      <Separator />
      <FormItem description="文档模式下返回的升级指引地址。" icon="lucide:link" title="升级文档">
        <ClearableInput value={form.upgradeUrl} disabled={isSubmitting} placeholder="https://..." onChange={(upgradeUrl) => onChange({ upgradeUrl })} />
      </FormItem>
      <Separator />
      <FormItem description="热更新时使用的 npm 包名。" icon="lucide:package" title="升级包">
        <ClearableInput value={form.upgradePkg} disabled={isSubmitting} placeholder="@tencent-connect/openclaw-qqbot" onChange={(upgradePkg) => onChange({ upgradePkg })} />
      </FormItem>
    </ItemCardGroup>
  )
}

function StreamingApprovalsGroup({
  form,
  isSubmitting,
  onChange,
}: {
  form: QQBotForm
  isSubmitting: boolean
  onChange: (patch: Partial<QQBotForm>) => void
}) {
  return (
    <ItemCardGroup className="overflow-hidden">
      <ItemCardGroup.Header>
        <ItemCardGroup.Title>流式与审批</ItemCardGroup.Title>
        <ItemCardGroup.Description>控制 QQ 侧流式预览和 Exec 审批投递。</ItemCardGroup.Description>
      </ItemCardGroup.Header>
      <FormItem actionClassName="w-fit" description="启用后私聊可使用 QQ 流式消息能力。" icon="lucide:radio-tower" title="流式回复">
        <Switch size="lg" aria-label="启用 QQBot 流式回复" isSelected={form.streamingEnabled} isDisabled={isSubmitting} onChange={(streamingEnabled) => onChange({ streamingEnabled, streamingMode: streamingEnabled ? 'partial' : 'off' })}>
          <Switch.Control><Switch.Thumb /></Switch.Control>
        </Switch>
      </FormItem>
      <Separator />
      <FormItem description="流式回复模式。" icon="lucide:activity" title="流式模式">
        <FriendlySelect ariaLabel="流式模式" isDisabled={isSubmitting} options={streamingModeOptions} value={form.streamingMode || 'off'} onChange={(streamingMode) => onChange({ streamingMode: String(streamingMode ?? 'off'), streamingEnabled: streamingMode === 'partial' })} />
      </FormItem>
      <Separator />
      <FormItem actionClassName="w-fit" description="兼容旧版 C2C streaming API。" icon="lucide:route" title="C2C Stream API">
        <Switch size="lg" aria-label="启用 C2C Stream API" isSelected={form.streamingC2CStreamApi} isDisabled={isSubmitting} onChange={(streamingC2CStreamApi) => onChange({ streamingC2CStreamApi })}>
          <Switch.Control><Switch.Thumb /></Switch.Control>
        </Switch>
      </FormItem>
      <Separator />
      <FormItem description="Exec 审批是否由 QQBot 原生承接。" icon="lucide:shield-check" title="审批状态">
        <FriendlySelect ariaLabel="Exec 审批状态" isDisabled={isSubmitting} options={execApprovalsEnabledOptions} value={form.execApprovalsEnabled || 'auto'} onChange={(execApprovalsEnabled) => onChange({ execApprovalsEnabled: String(execApprovalsEnabled ?? 'auto') })} />
      </FormItem>
      <Separator />
      <FormItem description="审批提示发送位置。" icon="lucide:send" title="审批投递">
        <FriendlySelect ariaLabel="Exec 审批投递" isDisabled={isSubmitting} options={execApprovalsTargetOptions} value={form.execApprovalsTarget || 'dm'} onChange={(execApprovalsTarget) => onChange({ execApprovalsTarget: String(execApprovalsTarget ?? 'dm') })} />
      </FormItem>
      <Separator />
      <InlineTextareaItem
        description="每行一个 QQ OpenID。"
        disabled={isSubmitting}
        icon="lucide:user-round-check"
        placeholder={'openid_1\nopenid_2'}
        title="审批者"
        value={form.execApprovalsApprovers}
        onChange={(execApprovalsApprovers) => onChange({ execApprovalsApprovers })}
      />
      <Separator />
      <InlineTextareaItem
        description="限制哪些 Agent 会走 QQBot 原生审批。"
        disabled={isSubmitting}
        icon="lucide:bot"
        placeholder={'main\ncoder'}
        title="Agent 过滤"
        value={form.execApprovalsAgentFilter}
        onChange={(execApprovalsAgentFilter) => onChange({ execApprovalsAgentFilter })}
      />
      <Separator />
      <InlineTextareaItem
        description="限制哪些会话会走 QQBot 原生审批。"
        disabled={isSubmitting}
        icon="lucide:workflow"
        placeholder="session-id"
        title="会话过滤"
        value={form.execApprovalsSessionFilter}
        onChange={(execApprovalsSessionFilter) => onChange({ execApprovalsSessionFilter })}
      />
    </ItemCardGroup>
  )
}

function SpeechGroup({
  enabled,
  model,
  onChange,
  provider,
  responseType,
  title,
  voice,
  withTTS,
}: {
  enabled: boolean
  model: string
  onChange: (patch: { enabled?: boolean; model?: string; provider?: string; responseType?: string; voice?: string }) => void
  provider: string
  responseType?: string
  title: string
  voice?: string
  withTTS?: boolean
}) {
  return (
    <ItemCardGroup className="overflow-hidden">
      <ItemCardGroup.Header>
        <ItemCardGroup.Title>{title}</ItemCardGroup.Title>
        <ItemCardGroup.Description>配置 provider、model 和启用状态；provider 引用 models.providers。</ItemCardGroup.Description>
      </ItemCardGroup.Header>
      <FormItem actionClassName="w-fit" description="启用该语音能力。" icon="lucide:toggle-right" title="启用">
        <Switch size="lg" aria-label={`${title} 启用`} isSelected={enabled} onChange={(nextEnabled) => onChange({ enabled: nextEnabled })}>
          <Switch.Control><Switch.Thumb /></Switch.Control>
        </Switch>
      </FormItem>
      <FormItem description="models.providers 中的 provider key。" icon="lucide:plug" title="Provider">
        <ClearableInput value={provider} placeholder="openai" onChange={(nextProvider) => onChange({ provider: nextProvider })} />
      </FormItem>
      <FormItem description="模型名称。" icon="lucide:box" title="Model">
        <ClearableInput value={model} placeholder={withTTS ? 'tts-1' : 'whisper-1'} onChange={(nextModel) => onChange({ model: nextModel })} />
      </FormItem>
      {withTTS ? (
        <>
          <FormItem description="TTS voice。" icon="lucide:audio-lines" title="Voice">
            <ClearableInput value={voice ?? ''} placeholder="alloy" onChange={(nextVoice) => onChange({ voice: nextVoice })} />
          </FormItem>
          <FormItem description="TTS response format/type。" icon="lucide:file-audio" title="Response Type">
            <ClearableInput value={responseType ?? ''} placeholder="mp3" onChange={(nextResponseType) => onChange({ responseType: nextResponseType })} />
          </FormItem>
        </>
      ) : null}
    </ItemCardGroup>
  )
}

function ClearableInput({ disabled, onChange, placeholder, value }: { disabled?: boolean; onChange: (value: string) => void; placeholder?: string; value: string }) {
  return (
    <InputGroup fullWidth variant="secondary">
      <InputGroup.Input value={value} disabled={disabled} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      {value ? (
        <InputGroup.Suffix className="shrink-0 px-1">
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

function InlineTextareaItem({
  description,
  disabled,
  icon,
  onChange,
  placeholder,
  title,
  value,
}: {
  description?: string
  disabled?: boolean
  icon: string
  onChange: (value: string) => void
  placeholder?: string
  title: string
  value: string
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
        <textarea
          className="min-h-20 w-full min-w-[260px] rounded-2xl border border-divider bg-surface-secondary/50 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent disabled:opacity-60"
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </ItemCard.Action>
    </ItemCard>
  )
}

function FormItem({
  actionClassName = 'w-full min-w-0 sm:w-auto',
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

function TaskLogPanel({ logRef, onClose, task, taskKind }: { logRef: RefObject<HTMLPreElement | null>; onClose: () => void; task: OpenClawChannelTaskResponse | null; taskKind: QQBotTaskKind | null }) {
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

function taskTitle(kind: QQBotTaskKind | null) {
  switch (kind) {
    case 'add':
      return '添加 QQBot 账号'
    case 'install':
      return '安装 QQBot 插件'
    case 'uninstall':
      return '卸载 QQBot 插件'
    default:
      return 'QQBot 渠道任务'
  }
}

function taskDoneMessage(kind: QQBotTaskKind | null) {
  switch (kind) {
    case 'add':
      return 'QQBot 账号已添加'
    case 'install':
      return 'QQBot 插件已安装'
    case 'uninstall':
      return 'QQBot 插件已卸载'
    default:
      return 'QQBot 渠道任务已完成'
  }
}

function buildQQBotAccountDrafts(accounts: OpenClawQQBotAccount[]) {
  return accounts.reduce<Record<string, QQBotAccountDraft>>((drafts, account) => {
    drafts[account.accountId] = getQQBotAccountDraft({}, account.accountId, account)
    return drafts
  }, {})
}

function buildQQBotFormFromAccount(account: OpenClawQQBotAccount): QQBotForm {
  return {
    accountId: account.accountId,
    agentId: account.agentId ?? '',
    allowFrom: (account.allowFrom ?? []).join('\n'),
    appId: '',
    clientSecret: '',
    deliverDebounceEnabled: account.deliverDebounce?.enabled !== false,
    deliverDebounceMaxWaitMs: String(account.deliverDebounce?.maxWaitMs || 8000),
    deliverDebounceSeparator: account.deliverDebounce?.separator || '',
    deliverDebounceWindowMs: String(account.deliverDebounce?.windowMs || 1500),
    dmPolicy: account.dmPolicy || 'allowlist',
    execApprovalsAgentFilter: (account.execApprovals?.agentFilter ?? []).join('\n'),
    execApprovalsApprovers: (account.execApprovals?.approvers ?? []).join('\n'),
    execApprovalsEnabled: account.execApprovals?.enabled || 'auto',
    execApprovalsSessionFilter: (account.execApprovals?.sessionFilter ?? []).join('\n'),
    execApprovalsTarget: account.execApprovals?.target || 'dm',
    groupAllowFrom: (account.groupAllowFrom ?? []).join('\n'),
    groupPolicy: account.groupPolicy || 'allowlist',
    markdownSupport: account.markdownSupport !== false,
    name: account.name || '',
    sttApiKey: '',
    sttBaseUrl: account.stt?.baseUrl || '',
    sttEnabled: account.stt?.enabled === true,
    sttModel: account.stt?.model || '',
    sttProvider: account.stt?.provider || '',
    streamingC2CStreamApi: account.streaming?.c2cStreamApi === true,
    streamingEnabled: account.streaming?.enabled === true,
    streamingMode: account.streaming?.mode || (account.streaming?.enabled ? 'partial' : 'off'),
    systemPrompt: account.systemPrompt || '',
    ttsApiKey: '',
    ttsBaseUrl: account.tts?.baseUrl || '',
    ttsEnabled: account.tts?.enabled === true,
    ttsModel: account.tts?.model || '',
    ttsProvider: account.tts?.provider || '',
    ttsResponseType: account.tts?.responseType || '',
    ttsVoice: account.tts?.voice || '',
    upgradeMode: account.upgradeMode || 'hot-reload',
    upgradePkg: account.upgradePkg || '',
    upgradeUrl: account.upgradeUrl || '',
    urlDirectUpload: account.urlDirectUpload !== false,
  }
}

function buildQQBotAccountUpdateRequest(form: QQBotForm) {
  return {
    allowFrom: splitQQBotList(form.allowFrom),
    deliverDebounce: {
      enabled: form.deliverDebounceEnabled,
      maxWaitMs: numberFromQQBotInput(form.deliverDebounceMaxWaitMs, 8000),
      separator: form.deliverDebounceSeparator,
      windowMs: numberFromQQBotInput(form.deliverDebounceWindowMs, 1500),
    },
    dmPolicy: form.dmPolicy,
    execApprovals: {
      agentFilter: splitQQBotList(form.execApprovalsAgentFilter),
      approvers: splitQQBotList(form.execApprovalsApprovers),
      enabled: form.execApprovalsEnabled,
      sessionFilter: splitQQBotList(form.execApprovalsSessionFilter),
      target: form.execApprovalsTarget,
    },
    groupAllowFrom: splitQQBotList(form.groupAllowFrom),
    groupPolicy: form.groupPolicy,
    markdownSupport: form.markdownSupport,
    name: form.name.trim(),
    streaming: {
      c2cStreamApi: form.streamingC2CStreamApi,
      enabled: form.streamingEnabled && form.streamingMode !== 'off',
      mode: form.streamingEnabled ? form.streamingMode : 'off',
    },
    systemPrompt: form.systemPrompt.trim(),
    stt: {
      ...(form.sttApiKey.trim() ? { apiKey: form.sttApiKey.trim() } : {}),
      baseUrl: form.sttBaseUrl.trim(),
      enabled: form.sttEnabled,
      model: form.sttModel.trim(),
      provider: form.sttProvider.trim(),
    },
    tts: {
      ...(form.ttsApiKey.trim() ? { apiKey: form.ttsApiKey.trim() } : {}),
      baseUrl: form.ttsBaseUrl.trim(),
      enabled: form.ttsEnabled,
      model: form.ttsModel.trim(),
      provider: form.ttsProvider.trim(),
      responseType: form.ttsResponseType.trim(),
      voice: form.ttsVoice.trim(),
    },
    upgradeMode: form.upgradeMode,
    upgradePkg: form.upgradePkg.trim(),
    upgradeUrl: form.upgradeUrl.trim(),
    urlDirectUpload: form.urlDirectUpload,
    ...(form.appId.trim() ? { appId: form.appId.trim() } : {}),
    ...(form.clientSecret.trim() ? { clientSecret: form.clientSecret.trim() } : {}),
  }
}

function getQQBotAccountDraft(drafts: Record<string, QQBotAccountDraft>, accountId: string, account?: OpenClawQQBotAccount): QQBotAccountDraft {
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

function splitQQBotList(value: string) {
  return value
    .split(/[,，\n\r;；]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function numberFromQQBotInput(value: string, fallback: number) {
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function appendTaskLog(logs: string[], line?: string) {
  const safeLine = line ?? ''
  const next = safeLine.trim() ? [...logs, safeLine] : logs
  return next.length > 240 ? next.slice(next.length - 240) : next
}

function maskQQBotSecret(line?: string) {
  return (line ?? '').replace(/([A-Za-z0-9_-]{4,}:)[A-Za-z0-9_-]{12,}/g, '$1<client-secret>')
}

function OpenClawQQBotPage() {
  usePageTitle('OpenClaw QQBot 渠道')
  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <OpenClawQQBotPanel />
      </div>
    </DashboardLayout>
  )
}

export default OpenClawQQBotPage
