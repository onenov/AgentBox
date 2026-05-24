import type { ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Key } from '@heroui/react'
import { AlertDialog, Alert, Button, Card, Chip, Dropdown, InputGroup, ListBox, Link, Modal, Separator, Skeleton, Switch, toast } from '@heroui/react'
import { CellSelect, ItemCard, ItemCardGroup, Segment } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type {
  OpenClawAgentSummary,
  OpenClawChannelStreamError,
  OpenClawChannelStreamLog,
  OpenClawChannelStreamMeta,
  OpenClawChannelStreamStatus,
  OpenClawChannelTaskResponse,
  OpenClawMatrixAccount,
  OpenClawMatrixAccountConfigUpdateRequest,
  OpenClawMatrixStatusResponse,
} from '@/api'
import {
  deleteOpenClawMatrixAccount,
  getOpenClawMatrixAddAccountStreamURL,
  getOpenClawMatrixStatus,
  listOpenClawAgents,
  updateOpenClawMatrixAccountConfig,
  updateOpenClawMatrixConfig,
} from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { OpenClawPairingModal } from './openclaw-pairing'

type LoadState = 'error' | 'idle' | 'loading' | 'ready'
type MatrixTaskKind = 'add'
type AccountModalMode = 'create' | 'edit'
type MatrixFormSection = 'advanced' | 'form' | 'help'
type AuthMethod = 'password' | 'token'

type MatrixAccountDraft = {
  agentId: string
  enabled: boolean
}

type MatrixAddForm = {
  accessToken: string
  accountId: string
  actionChannelInfo: boolean
  actionMemberInfo: boolean
  actionMessages: boolean
  actionPins: boolean
  actionProfile: boolean
  actionReactions: boolean
  actionVerification: boolean
  agentId: string
  allowPrivateNetwork: boolean
  authMethod: AuthMethod
  autoJoin: string
  autoJoinAllowlist: string
  deviceName: string
  dmAllowFrom: string
  dmEnabled: boolean
  dmPolicy: string
  dmSessionScope: string
  dmThreadReplies: string
  encryption: boolean
  execApprovalsApprovers: string
  execApprovalsEnabled: string
  execApprovalsTarget: string
  groupAllowFrom: string
  groupPolicy: string
  groups: string
  homeserver: string
  initialSyncLimit: string
  name: string
  password: string
  streamingMode: string
  threadReplies: string
  userId: string
}

type AgentOption = {
  id: string
  label: string
  value: string
}

const addFormTabs: Array<{ icon: string; id: MatrixFormSection; label: string }> = [
  { icon: 'lucide:user-round-cog', id: 'form', label: '账号信息' },
  { icon: 'lucide:sliders-horizontal', id: 'advanced', label: '高级设置' },
  { icon: 'lucide:circle-help', id: 'help', label: '帮助流程' },
]

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
  { id: 'disabled', label: '禁用房间' },
]

const authMethodOptions = [
  { id: 'token', label: '访问令牌' },
  { id: 'password', label: '账号密码' },
]

const autoJoinOptions = [
  { id: 'inherit', label: '继承默认' },
  { id: 'off', label: '不自动加入' },
  { id: 'allowlist', label: '按白名单' },
  { id: 'always', label: '全部邀请' },
]

const booleanModeOptions = [
  { id: 'inherit', label: '继承' },
  { id: 'auto', label: '自动' },
  { id: 'true', label: '开启' },
  { id: 'false', label: '关闭' },
]

const execTargetOptions = [
  { id: 'inherit', label: '继承默认' },
  { id: 'dm', label: '私信审批' },
  { id: 'channel', label: '原房间审批' },
  { id: 'both', label: '同时发送' },
]

const sessionScopeOptions = [
  { id: 'inherit', label: '继承默认' },
  { id: 'per-user', label: '按用户' },
  { id: 'per-room', label: '按房间' },
]

const threadReplyOptions = [
  { id: 'inherit', label: '继承默认' },
  { id: 'off', label: '关闭' },
  { id: 'inbound', label: '跟随入站线程' },
  { id: 'always', label: '总是线程回复' },
]

const streamingModeOptions = [
  { id: 'inherit', label: '继承默认' },
  { id: 'off', label: '关闭' },
  { id: 'partial', label: '回答预览' },
  { id: 'quiet', label: '静默预览' },
  { id: 'progress', label: '进度模式' },
]

const matrixHelpSteps: Array<{ content: ReactNode; step: string }> = [
  { step: '1', content: '在 Matrix homeserver 上创建一个专用 Bot 账号。' },
  { step: '2', content: '选择 accessToken 认证，或使用 userId + password 让 OpenClaw 首次登录并缓存令牌。' },
  { step: '3', content: '如 homeserver 在 localhost、LAN 或 Tailscale 内网，开启私有网络访问。' },
  { step: '4', content: '保持 DM 策略为 pairing，启动网关后用 Matrix 私信配对审批首个用户。' },
  {
    step: '5',
    content: (
      <>
        E2EE 账号建议按官方{' '}
        <Link href="https://docs.openclaw.ai/zh-CN/channels/matrix" target="_blank" rel="noreferrer">
          Matrix 文档
          <Link.Icon />
        </Link>
        {' '}完成验证和 recovery key 保存。
      </>
    ),
  },
]

const defaultAddForm: MatrixAddForm = {
  accessToken: '',
  accountId: 'default',
  actionChannelInfo: true,
  actionMemberInfo: true,
  actionMessages: true,
  actionPins: false,
  actionProfile: true,
  actionReactions: true,
  actionVerification: true,
  agentId: '',
  allowPrivateNetwork: false,
  authMethod: 'token',
  autoJoin: 'off',
  autoJoinAllowlist: '',
  deviceName: 'OpenClaw Gateway',
  dmAllowFrom: '',
  dmEnabled: true,
  dmPolicy: 'pairing',
  dmSessionScope: 'per-user',
  dmThreadReplies: 'inherit',
  encryption: false,
  execApprovalsApprovers: '',
  execApprovalsEnabled: 'inherit',
  execApprovalsTarget: 'dm',
  groupAllowFrom: '',
  groupPolicy: 'allowlist',
  groups: '',
  homeserver: '',
  initialSyncLimit: '',
  name: '',
  password: '',
  streamingMode: 'inherit',
  threadReplies: 'inherit',
  userId: '',
}

export function OpenClawMatrixPanel() {
  const [state, setState] = useState<LoadState>('idle')
  const [status, setStatus] = useState<OpenClawMatrixStatusResponse | null>(null)
  const [accountDrafts, setAccountDrafts] = useState<Record<string, MatrixAccountDraft>>({})
  const [agents, setAgents] = useState<OpenClawAgentSummary[]>([])
  const [error, setError] = useState('')
  const [savingAccountId, setSavingAccountId] = useState('')
  const [savingChannelEnabled, setSavingChannelEnabled] = useState(false)
  const [savingChannelDMPolicy, setSavingChannelDMPolicy] = useState(false)
  const [task, setTask] = useState<OpenClawChannelTaskResponse | null>(null)
  const [taskKind, setTaskKind] = useState<MatrixTaskKind | null>(null)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [accountModalMode, setAccountModalMode] = useState<AccountModalMode>('create')
  const [isPairingOpen, setIsPairingOpen] = useState(false)
  const [activeFormSection, setActiveFormSection] = useState<MatrixFormSection>('form')
  const [addForm, setAddForm] = useState<MatrixAddForm>(defaultAddForm)
  const [accountEditTarget, setAccountEditTarget] = useState<OpenClawMatrixAccount | null>(null)
  const [accountDeleteTarget, setAccountDeleteTarget] = useState<OpenClawMatrixAccount | null>(null)
  const [accountDeleting, setAccountDeleting] = useState(false)
  const logRef = useRef<HTMLPreElement | null>(null)
  const sourceRef = useRef<EventSource | null>(null)
  const streamFinishedRef = useRef(false)

  const loadStatus = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const [nextStatus, nextAgents] = await Promise.all([getOpenClawMatrixStatus(), listOpenClawAgents()])
      setStatus(nextStatus)
      setAgents(nextAgents.agents ?? [])
      setAccountDrafts(buildMatrixAccountDrafts(nextStatus.accounts ?? []))
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Matrix 渠道状态加载失败')
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

  const startStream = useCallback((kind: MatrixTaskKind, url: string) => {
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
          toast.success('Matrix 账号已添加')
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
          logs: appendTaskLog(current.logs, maskMatrixSecrets(payload.line)),
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
      toast.warning('Matrix 渠道流式任务连接中断')
      void loadStatus()
    }
  }, [closeStream, loadStatus])

  const submitEditAccount = useCallback(async () => {
    if (!accountEditTarget) return
    const validation = validateMatrixForm(addForm, true)
    if (validation) {
      toast.warning(validation)
      return
    }
    setSavingAccountId(accountEditTarget.accountId)
    try {
      const nextStatus = await updateOpenClawMatrixAccountConfig(accountEditTarget.accountId, buildMatrixAccountRequest(addForm, true))
      setStatus(nextStatus)
      setAccountDrafts(buildMatrixAccountDrafts(nextStatus.accounts ?? []))
      setIsAddOpen(false)
      setAccountEditTarget(null)
      toast.success('Matrix 账号已更新')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'Matrix 账号更新失败')
    } finally {
      setSavingAccountId('')
    }
  }, [accountEditTarget, addForm])

  const submitAddAccount = useCallback(() => {
    if (accountModalMode === 'edit') {
      void submitEditAccount()
      return
    }
    const validation = validateMatrixForm(addForm, false)
    if (validation) {
      toast.warning(validation)
      return
    }
    setIsAddOpen(false)
    startStream('add', getOpenClawMatrixAddAccountStreamURL({
      accessToken: addForm.authMethod === 'token' ? addForm.accessToken : undefined,
      accountId: addForm.accountId,
      agentId: addForm.agentId,
      allowPrivateNetwork: addForm.allowPrivateNetwork,
      autoJoin: addForm.autoJoin === 'inherit' ? undefined : addForm.autoJoin,
      autoJoinAllowlist: addForm.autoJoinAllowlist,
      deviceName: addForm.deviceName,
      dmAllowFrom: addForm.dmAllowFrom,
      dmPolicy: addForm.dmPolicy,
      encryption: addForm.encryption,
      groupAllowFrom: addForm.groupAllowFrom,
      groupPolicy: addForm.groupPolicy === 'inherit' ? undefined : addForm.groupPolicy,
      homeserver: addForm.homeserver,
      initialSyncLimit: addForm.initialSyncLimit,
      name: addForm.name,
      password: addForm.authMethod === 'password' ? addForm.password : undefined,
      userId: addForm.authMethod === 'password' ? addForm.userId : undefined,
    }))
    setAddForm(defaultAddForm)
    setActiveFormSection('form')
  }, [accountModalMode, addForm, startStream, submitEditAccount])

  const openAddAccountModal = useCallback(() => {
    setAccountModalMode('create')
    setAccountEditTarget(null)
    setAddForm({
      ...defaultAddForm,
      dmPolicy: status?.config.dmPolicy || defaultAddForm.dmPolicy,
      groupPolicy: status?.config.groupPolicy || defaultAddForm.groupPolicy,
    })
    setActiveFormSection('form')
    setIsAddOpen(true)
  }, [status?.config])

  const openEditAccountModal = useCallback((account: OpenClawMatrixAccount) => {
    setAccountModalMode('edit')
    setAccountEditTarget(account)
    setAddForm(buildMatrixAccountFormFromAccount(account))
    setActiveFormSection('form')
    setIsAddOpen(true)
  }, [])

  const updateChannelEnabled = useCallback(async (enabled: boolean) => {
    setSavingChannelEnabled(true)
    setStatus((current) => current ? { ...current, enabled, config: { ...current.config, enabled } } : current)
    try {
      const nextStatus = await updateOpenClawMatrixConfig({ enabled })
      setStatus(nextStatus)
      setAccountDrafts(buildMatrixAccountDrafts(nextStatus.accounts ?? []))
      toast.success(enabled ? 'Matrix 渠道已启用' : 'Matrix 渠道已停用')
    } catch (err) {
      void loadStatus()
      toast.warning(err instanceof Error ? err.message : 'Matrix 渠道开关更新失败')
    } finally {
      setSavingChannelEnabled(false)
    }
  }, [loadStatus])

  const updateChannelDMPolicy = useCallback(async (dmPolicy: string) => {
    if (!dmPolicy || !dmPolicyOptions.some((option) => option.id === dmPolicy)) return
    setSavingChannelDMPolicy(true)
    setStatus((current) => current ? { ...current, config: { ...current.config, dmPolicy } } : current)
    try {
      const nextStatus = await updateOpenClawMatrixConfig({ dmPolicy })
      setStatus(nextStatus)
      setAccountDrafts(buildMatrixAccountDrafts(nextStatus.accounts ?? []))
      toast.success('默认 DM 准入已更新')
    } catch (err) {
      void loadStatus()
      toast.warning(err instanceof Error ? err.message : '默认 DM 准入更新失败')
    } finally {
      setSavingChannelDMPolicy(false)
    }
  }, [loadStatus])

  const updateAccount = useCallback(async (account: OpenClawMatrixAccount, patch: Partial<MatrixAccountDraft>) => {
    const draft = {
      ...getMatrixAccountDraft(accountDrafts, account.accountId, account),
      ...patch,
    }
    setAccountDrafts((current) => ({ ...current, [account.accountId]: draft }))
    setSavingAccountId(account.accountId)
    try {
      const nextStatus = await updateOpenClawMatrixAccountConfig(account.accountId, {
        agentId: draft.agentId,
        enabled: draft.enabled,
      })
      setStatus(nextStatus)
      setAccountDrafts(buildMatrixAccountDrafts(nextStatus.accounts ?? []))
      toast.success('Matrix 账号配置已更新')
    } catch (err) {
      setAccountDrafts(buildMatrixAccountDrafts(status?.accounts ?? []))
      toast.warning(err instanceof Error ? err.message : 'Matrix 账号配置更新失败')
    } finally {
      setSavingAccountId('')
    }
  }, [accountDrafts, status?.accounts])

  const deleteAccount = useCallback(async () => {
    if (!accountDeleteTarget) return
    setAccountDeleting(true)
    try {
      await deleteOpenClawMatrixAccount(accountDeleteTarget.accountId)
      setAccountDeleteTarget(null)
      toast.success('Matrix 账号已删除')
      void loadStatus()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'Matrix 账号删除失败')
    } finally {
      setAccountDeleting(false)
    }
  }, [accountDeleteTarget, loadStatus])

  const agentOptions = useMemo(() => buildAgentOptions(agents), [agents])
  const isLoading = state === 'loading' && !status
  const isTaskRunning = Boolean(task && task.status !== 'done' && task.status !== 'error')
  const accounts = status?.accounts ?? []
  const configured = Boolean(status?.configured)
  const enabled = Boolean(status?.enabled)

  return (
    <>
      {error ? (
        <div className=" py-3 w-full">
          <Alert status="danger" className="items-center">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Matrix 渠道状态加载失败</Alert.Title>
              <Alert.Description>请检查 Matrix 渠道状态和网关运行状态。</Alert.Description>
            </Alert.Content>
            <Button isIconOnly size="sm" variant="danger" onPress={() => void loadStatus()}>
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
                  <Icon icon="simple-icons:matrix" className="size-6" />
                </div>
                <div className="min-w-0">
                  <Card.Title>Matrix</Card.Title>
                  <Card.Description>接入 Matrix homeserver、私聊、房间和 E2EE 账号。</Card.Description>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {state !== 'loading' && !isTaskRunning ? (
                  <Button size="sm" isIconOnly variant={state === 'error' ? 'primary' : 'ghost'} aria-label="刷新 Matrix 渠道状态" onPress={() => void loadStatus()}>
                    <Icon icon="lucide:refresh-cw" />
                  </Button>
                ) : null}
                <Button size="sm" variant="tertiary" isDisabled={isTaskRunning} onPress={() => setIsPairingOpen(true)}>
                  <Icon icon="lucide:shield-check" />
                  配对审批
                </Button>
                <Button size="sm" variant="primary" isDisabled={isTaskRunning} onPress={openAddAccountModal}>
                  <Icon icon="lucide:plus" />
                  添加账号
                </Button>
              </div>
            </div>
          </Card.Content>
        </Card>

        <StatusItemList
          items={[
            {
              description: configured ? `${accounts.length} 个账号` : '等待配置 homeserver 和认证',
              icon: 'lucide:key-round',
              loading: isLoading,
              ok: configured,
              title: '配置状态',
            },
            {
              description: enabled ? 'Matrix 渠道已启用' : 'Matrix 渠道已停用',
              icon: 'lucide:radio',
              loading: isLoading,
              ok: enabled,
              title: '运行状态',
            },
            {
              action: (
                <div className="w-auto">
                  <FriendlySelect
                    ariaLabel="默认 DM 准入"
                    isDisabled={isTaskRunning || isLoading || savingChannelDMPolicy}
                    options={dmPolicyOptions}
                    value={status?.config.dmPolicy || 'pairing'}
                    onChange={(value) => void updateChannelDMPolicy(String(value ?? 'pairing'))}
                  />
                </div>
              ),
              description: '私信配对和准入',
              icon: 'lucide:shield-check',
              loading: isLoading,
              ok: configured,
              title: '默认DM',
            },
            {
              action: (
                <Switch
                  size="lg"
                  aria-label="切换 Matrix 渠道总开关"
                  isSelected={enabled}
                  isDisabled={!configured || isTaskRunning || isLoading || savingChannelEnabled}
                  onChange={(nextEnabled) => void updateChannelEnabled(nextEnabled)}
                >
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch>
              ),
              description: enabled ? 'Matrix 渠道已启用' : 'Matrix 渠道已停用',
              icon: 'lucide:power',
              loading: isLoading,
              ok: enabled,
              title: '启用状态',
            },
          ]}
        />

        {configured ? (
          accounts.length > 0 ? (
            <div className="grid gap-2 lg:grid-cols-2">
              {accounts.map((account) => (
                <MatrixAccountCard
                  key={account.accountId}
                  account={account}
                  agentOptions={agentOptions}
                  draft={getMatrixAccountDraft(accountDrafts, account.accountId, account)}
                  isDisabled={isLoading || isTaskRunning}
                  isSaving={savingAccountId === account.accountId}
                  onChange={(patch) => void updateAccount(account, patch)}
                  onDelete={setAccountDeleteTarget}
                  onEdit={openEditAccountModal}
                />
              ))}
            </div>
          ) : (
            <ChannelEmptyState
              description="添加一个 Matrix 账号后，就可以配置路由 Agent、启用状态和消息接入策略。"
              icon="simple-icons:matrix"
              title="还没有 Matrix 账号"
            />
          )
        ) : (
          <ChannelEmptyState
            description="配置 homeserver 和认证信息后，可以在这里管理 Matrix 账号和消息接入。"
            icon="lucide:package-x"
            title="Matrix 尚未配置"
          />
        )}

        {status?.error ? (
          <div className="rounded-xl bg-warning/10 p-3 text-sm leading-6 text-warning">
            {status.error}
          </div>
        ) : null}

        <TaskLogPanel task={task} taskKind={taskKind} logRef={logRef} onClose={() => setTask(null)} />

        <OpenClawPairingModal
          channel="matrix"
          channelLabel="Matrix"
          isOpen={isPairingOpen}
          onApproved={() => void loadStatus()}
          onOpenChange={setIsPairingOpen}
        />

        <MatrixAddAccountModal
          activeSection={activeFormSection}
          agentOptions={agentOptions}
          editAccount={accountEditTarget}
          form={addForm}
          isOpen={isAddOpen}
          isSubmitting={isTaskRunning || Boolean(accountEditTarget && savingAccountId === accountEditTarget.accountId)}
          mode={accountModalMode}
          onActiveSectionChange={setActiveFormSection}
          onFormChange={setAddForm}
          onOpenChange={(open) => {
            setIsAddOpen(open)
            if (!open) {
              setActiveFormSection('form')
              setAccountEditTarget(null)
              setAccountModalMode('create')
            }
          }}
          onSubmit={submitAddAccount}
        />

        <AlertDialog.Backdrop isOpen={Boolean(accountDeleteTarget)} onOpenChange={(open) => {
          if (!open && !accountDeleting) setAccountDeleteTarget(null)
        }}>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-[480px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>删除 Matrix 账号？</AlertDialog.Heading>
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

function MatrixAccountCard({
  account,
  agentOptions,
  draft,
  isDisabled,
  isSaving,
  onChange,
  onDelete,
  onEdit,
}: {
  account: OpenClawMatrixAccount
  agentOptions: AgentOption[]
  draft: MatrixAccountDraft
  isDisabled: boolean
  isSaving: boolean
  onChange: (patch: Partial<MatrixAccountDraft>) => void
  onDelete: (account: OpenClawMatrixAccount) => void
  onEdit: (account: OpenClawMatrixAccount) => void
}) {
  const selectedAgent = agentOptions.find((option) => option.value === draft.agentId) ?? agentOptions[0]
  return (
    <Card>
      <Card.Content>
        <div className="flex gap-4 items-center justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-secondary/50 text-foreground">
              <Icon icon="simple-icons:matrix" className="size-6" />
            </div>
            <div className="flex min-w-0 flex-col items-start gap-1">
              <Card.Title className="max-w-56 truncate text-base">{account.name || account.accountId}</Card.Title>
              <div className="flex flex-wrap gap-1">
                <Chip color={draft.enabled ? 'success' : 'danger'} variant="soft">{draft.enabled ? '已启用' : '已停用'}</Chip>
                <Chip color={account.authConfigured ? 'success' : 'warning'} variant="soft">{account.authSource || 'missing'}</Chip>
                {account.encryption ? <Chip color="accent" variant="soft">E2EE</Chip> : null}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button isIconOnly size="sm" variant="tertiary" aria-label="编辑 Matrix 账号" onPress={() => onEdit(account)} isDisabled={isDisabled || isSaving}>
              <Icon icon="lucide:pencil" className="size-4" />
            </Button>
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
            <Switch size="lg" aria-label="启用 Matrix 账号" isSelected={draft.enabled} isDisabled={isDisabled || isSaving} onChange={(enabled) => onChange({ enabled })}>
              <Switch.Control><Switch.Thumb /></Switch.Control>
            </Switch>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            <Button isIconOnly size="sm" variant="tertiary" aria-label="删除 Matrix 账号" onPress={() => onDelete(account)} isDisabled={isDisabled || isSaving}>
              <Icon icon="lucide:trash-2" className="size-4" />
            </Button>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function MatrixAddAccountModal({
  activeSection,
  agentOptions,
  editAccount,
  form,
  isOpen,
  isSubmitting,
  mode,
  onActiveSectionChange,
  onFormChange,
  onOpenChange,
  onSubmit,
}: {
  activeSection: MatrixFormSection
  agentOptions: AgentOption[]
  editAccount: OpenClawMatrixAccount | null
  form: MatrixAddForm
  isOpen: boolean
  isSubmitting: boolean
  mode: AccountModalMode
  onActiveSectionChange: (section: MatrixFormSection) => void
  onFormChange: (form: MatrixAddForm) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
}) {
  const update = (patch: Partial<MatrixAddForm>) => onFormChange({ ...form, ...patch })

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="sm:max-w-[720px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
              <Icon icon="simple-icons:matrix" className="size-5" />
            </Modal.Icon>
            <div>
              <Modal.Heading>{mode === 'edit' ? '编辑 Matrix 账号' : '添加 Matrix 账号'}</Modal.Heading>
              <p className="mt-1 text-sm text-muted">
                {mode === 'edit'
                  ? `更新 ${editAccount?.name || editAccount?.accountId || 'Matrix 账号'} 的连接、访问和 E2EE 配置。`
                  : '写入 homeserver、认证方式和 Matrix 访问策略。'}
              </p>
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="space-y-5 p-1">
              <Segment selectedKey={activeSection} onSelectionChange={(key) => onActiveSectionChange(String(key) as MatrixFormSection)}>
                {addFormTabs.map((tab) => (
                  <Segment.Item key={tab.id} id={tab.id}>
                    <Segment.Separator />
                    <Icon icon={tab.icon} className="size-4" />
                    {tab.label}
                  </Segment.Item>
                ))}
              </Segment>

              {activeSection === 'help' ? (
                <div className="grid gap-3">
                  {matrixHelpSteps.map((item) => (
                    <div key={item.step} className="flex items-start gap-3 rounded-xl bg-surface-secondary/50 p-3 text-sm text-foreground">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{item.step}</span>
                      <span className="leading-6">{item.content}</span>
                    </div>
                  ))}
                </div>
              ) : activeSection === 'advanced' ? (
                <div className="space-y-5 max-h-[500px] overflow-y-auto">
                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>访问控制</ItemCardGroup.Title>
                      <ItemCardGroup.Description>Matrix 私聊、房间和邀请处理策略。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem description="私信在配对、白名单、公开和禁用之间切换。" icon="lucide:shield-check" title="DM 策略">
                      <FriendlySelect ariaLabel="DM 策略" isDisabled={isSubmitting} options={dmPolicyOptions} value={form.dmPolicy} onChange={(value) => update({ dmPolicy: String(value ?? 'pairing') })} />
                    </FormItem>
                    <FormItem actionClassName="w-fit" description="关闭后忽略所有私信。" icon="lucide:message-circle-off" title="DM 启用">
                      <Switch size="lg" aria-label="DM 启用" isSelected={form.dmEnabled} isDisabled={isSubmitting} onChange={(dmEnabled) => update({ dmEnabled })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </FormItem>
                    <FormItem description="DM 会话按用户或按房间隔离。" icon="lucide:git-branch" title="DM 会话">
                      <FriendlySelect ariaLabel="DM 会话作用域" isDisabled={isSubmitting} options={sessionScopeOptions} value={form.dmSessionScope || 'inherit'} onChange={(value) => update({ dmSessionScope: String(value ?? 'inherit') })} />
                    </FormItem>
                    <FormItem description="私信线程回复覆盖。" icon="lucide:messages-square" title="DM 线程">
                      <FriendlySelect ariaLabel="DM 线程回复" isDisabled={isSubmitting} options={threadReplyOptions} value={form.dmThreadReplies || 'inherit'} onChange={(value) => update({ dmThreadReplies: String(value ?? 'inherit') })} />
                    </FormItem>
                    <FormItem description="房间消息准入策略。" icon="lucide:door-open" title="房间策略">
                      <FriendlySelect ariaLabel="房间策略" isDisabled={isSubmitting} options={groupPolicyOptions} value={form.groupPolicy || 'inherit'} onChange={(value) => update({ groupPolicy: String(value ?? 'inherit') })} />
                    </FormItem>
                    <FormItem description="新邀请的自动加入策略。" icon="lucide:user-plus" title="自动加入">
                      <FriendlySelect ariaLabel="自动加入" isDisabled={isSubmitting} options={autoJoinOptions} value={form.autoJoin || 'inherit'} onChange={(value) => update({ autoJoin: String(value ?? 'inherit') })} />
                    </FormItem>
                  </ItemCardGroup>

                  <TextareaCard description="支持逗号或换行分隔，使用完整 Matrix 用户 ID。" disabled={isSubmitting} icon="lucide:users" placeholder="@alice:example.org, @ops:example.org" title="DM 白名单" value={form.dmAllowFrom} onChange={(dmAllowFrom) => update({ dmAllowFrom })} />
                  <TextareaCard description="房间流量允许的 Matrix 用户 ID。" disabled={isSubmitting} icon="lucide:user-check" placeholder="@ops:example.org" title="房间用户白名单" value={form.groupAllowFrom} onChange={(groupAllowFrom) => update({ groupAllowFrom })} />
                  <TextareaCard description="自动加入允许的 !roomId:server 或 #alias:server。" disabled={isSubmitting} icon="lucide:door-open" placeholder="!ops:example.org\n#support:example.org" title="自动加入白名单" value={form.autoJoinAllowlist} onChange={(autoJoinAllowlist) => update({ autoJoinAllowlist })} />
                  <TextareaCard description="账号级房间覆盖项，保存为 groups 映射。" disabled={isSubmitting} icon="lucide:hash" placeholder="!ops:example.org\n#support:example.org" title="房间列表" value={form.groups} onChange={(groups) => update({ groups })} />

                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>线程和预览</ItemCardGroup.Title>
                      <ItemCardGroup.Description>控制 Matrix 回复线程和流式预览模式。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem description="房间和私信的默认线程回复。" icon="lucide:message-square-reply" title="线程回复">
                      <FriendlySelect ariaLabel="线程回复" isDisabled={isSubmitting} options={threadReplyOptions} value={form.threadReplies || 'inherit'} onChange={(value) => update({ threadReplies: String(value ?? 'inherit') })} />
                    </FormItem>
                    <FormItem description="Matrix streaming 支持 off、partial、quiet、progress。" icon="lucide:radio-tower" title="流式模式">
                      <FriendlySelect ariaLabel="流式模式" isDisabled={isSubmitting} options={streamingModeOptions} value={form.streamingMode || 'inherit'} onChange={(value) => update({ streamingMode: String(value ?? 'inherit') })} />
                    </FormItem>
                  </ItemCardGroup>

                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>安全和审批</ItemCardGroup.Title>
                      <ItemCardGroup.Description>E2EE、私有 homeserver 和原生 exec 审批。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem actionClassName="w-fit" description="为此账号启用 Matrix E2EE。" icon="lucide:lock-keyhole" title="E2EE">
                      <Switch size="lg" aria-label="启用 E2EE" isSelected={form.encryption} isDisabled={isSubmitting} onChange={(encryption) => update({ encryption })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </FormItem>
                    <FormItem actionClassName="w-fit" description="允许 localhost、LAN 或 Tailscale homeserver。" icon="lucide:network" title="私有网络">
                      <Switch size="lg" aria-label="允许私有网络 homeserver" isSelected={form.allowPrivateNetwork} isDisabled={isSubmitting} onChange={(allowPrivateNetwork) => update({ allowPrivateNetwork })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </FormItem>
                    <FormItem description="审批提示开关。" icon="lucide:shield-alert" title="审批开关">
                      <FriendlySelect ariaLabel="Exec 审批开关" isDisabled={isSubmitting} options={booleanModeOptions} value={form.execApprovalsEnabled} onChange={(value) => update({ execApprovalsEnabled: String(value ?? 'inherit') })} />
                    </FormItem>
                    <FormItem description="审批提示发送到哪里。" icon="lucide:send" title="投递位置">
                      <FriendlySelect ariaLabel="Exec 审批投递位置" isDisabled={isSubmitting} options={execTargetOptions} value={form.execApprovalsTarget || 'inherit'} onChange={(value) => update({ execApprovalsTarget: String(value ?? 'inherit') })} />
                    </FormItem>
                  </ItemCardGroup>

                  <TextareaCard description="支持逗号或换行分隔，回退到 DM allowFrom。" disabled={isSubmitting} icon="lucide:user-check" placeholder="@owner:example.org" title="审批者" value={form.execApprovalsApprovers} onChange={(execApprovalsApprovers) => update({ execApprovalsApprovers })} />

                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>操作能力</ItemCardGroup.Title>
                      <ItemCardGroup.Description>控制 Matrix 原生工具动作。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <ActionSwitch label="发送和编辑消息" value={form.actionMessages} disabled={isSubmitting} onChange={(actionMessages) => update({ actionMessages })} />
                    <ActionSwitch label="表情回应" value={form.actionReactions} disabled={isSubmitting} onChange={(actionReactions) => update({ actionReactions })} />
                    <ActionSwitch label="置顶消息" value={form.actionPins} disabled={isSubmitting} onChange={(actionPins) => update({ actionPins })} />
                    <ActionSwitch label="资料同步" value={form.actionProfile} disabled={isSubmitting} onChange={(actionProfile) => update({ actionProfile })} />
                    <ActionSwitch label="成员信息" value={form.actionMemberInfo} disabled={isSubmitting} onChange={(actionMemberInfo) => update({ actionMemberInfo })} />
                    <ActionSwitch label="房间信息" value={form.actionChannelInfo} disabled={isSubmitting} onChange={(actionChannelInfo) => update({ actionChannelInfo })} />
                    <ActionSwitch label="设备验证" value={form.actionVerification} disabled={isSubmitting} onChange={(actionVerification) => update({ actionVerification })} />
                  </ItemCardGroup>
                </div>
              ) : (
                <div className="space-y-5 max-h-[500px] overflow-y-auto">
                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>账号信息</ItemCardGroup.Title>
                      <ItemCardGroup.Description>{mode === 'edit' ? '编辑账号名称、homeserver 和认证信息。' : '填写 Matrix homeserver 与认证方式。'}</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem description="填写一个可识别的名称。" icon="lucide:badge" title="账号名称">
                      <ClearableInput value={form.name} disabled={isSubmitting} placeholder={mode === 'edit' ? '未命名' : '显示名称'} onChange={(name) => update({ name })} />
                    </FormItem>
                    <Separator />
                    <FormItem description="默认账号使用 default。" icon="lucide:user-round" title="账号 ID">
                      <ClearableInput value={form.accountId} disabled={isSubmitting || mode === 'edit'} placeholder="default" onChange={(accountId) => update({ accountId })} />
                    </FormItem>
                    <Separator />
                    <FormItem description="例如 https://matrix.example.org。" icon="lucide:server" title="Homeserver">
                      <ClearableInput value={form.homeserver} disabled={isSubmitting} placeholder="https://matrix.example.org" onChange={(homeserver) => update({ homeserver })} />
                    </FormItem>
                    <Separator />
                    <FormItem description="选择 accessToken 或 userId + password。" icon="lucide:key-round" title="认证方式">
                      <FriendlySelect ariaLabel="认证方式" isDisabled={isSubmitting} options={authMethodOptions} value={form.authMethod} onChange={(value) => update({ authMethod: String(value ?? 'token') as AuthMethod })} />
                    </FormItem>
                    {form.authMethod === 'token' ? (
                      <FormItem description={mode === 'edit' ? '留空保持当前 token 不变。' : '从 Matrix 客户端或管理员界面获取。'} icon="lucide:ticket" title="Access Token">
                        <ClearableInput value={form.accessToken} disabled={isSubmitting} placeholder="syt_xxx" onChange={(accessToken) => update({ accessToken })} />
                      </FormItem>
                    ) : (
                      <>
                        <FormItem description="完整 Matrix 用户 ID。" icon="lucide:at-sign" title="User ID">
                          <ClearableInput value={form.userId} disabled={isSubmitting} placeholder="@bot:example.org" onChange={(userId) => update({ userId })} />
                        </FormItem>
                        <FormItem description={mode === 'edit' ? '留空保持当前密码不变。' : '首次登录后 OpenClaw 会缓存令牌。'} icon="lucide:key" title="Password">
                          <ClearableInput value={form.password} disabled={isSubmitting} placeholder="password" onChange={(password) => update({ password })} />
                        </FormItem>
                      </>
                    )}
                    <FormItem description="密码登录时使用的设备名称。" icon="lucide:monitor-smartphone" title="设备名称">
                      <ClearableInput value={form.deviceName} disabled={isSubmitting} placeholder="OpenClaw Gateway" onChange={(deviceName) => update({ deviceName })} />
                    </FormItem>
                    <FormItem description="启动同步事件上限，可留空。" icon="lucide:list-tree" title="初始同步">
                      <ClearableInput value={form.initialSyncLimit} disabled={isSubmitting} placeholder="20" onChange={(initialSyncLimit) => update({ initialSyncLimit })} />
                    </FormItem>
                    {mode === 'create' ? (
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
                    ) : null}
                  </ItemCardGroup>
                </div>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted">
              <Icon icon="lucide:info" className="size-4 shrink-0" />
              <span className="truncate">凭据只写入本机 OpenClaw 配置，不会在状态接口返回。</span>
            </div>
            <Button variant="tertiary" onPress={() => onOpenChange(false)}>取消</Button>
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

function ActionSwitch({ disabled, label, onChange, value }: { disabled?: boolean; label: string; onChange: (value: boolean) => void; value: boolean }) {
  return (
    <FormItem actionClassName="w-fit" icon="lucide:toggle-right" title={label}>
      <Switch size="lg" aria-label={label} isSelected={value} isDisabled={disabled} onChange={onChange}>
        <Switch.Control><Switch.Thumb /></Switch.Control>
      </Switch>
    </FormItem>
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
            <ItemCard.Description>
              {item.loading ? <Skeleton className="h-4 w-28" /> : item.description}
            </ItemCard.Description>
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

function TaskLogPanel({ logRef, onClose, task, taskKind }: { logRef: RefObject<HTMLPreElement | null>; onClose: () => void; task: OpenClawChannelTaskResponse | null; taskKind: MatrixTaskKind | null }) {
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

function validateMatrixForm(form: MatrixAddForm, editMode: boolean) {
  if (!form.accountId.trim()) return '请输入账号 ID'
  if (!form.homeserver.trim()) return '请输入 homeserver'
  if (!editMode && form.authMethod === 'token' && !form.accessToken.trim()) return '请输入 access token'
  if (!editMode && form.authMethod === 'password' && (!form.userId.trim() || !form.password.trim())) return '密码认证需要 userId 和 password'
  if (form.dmPolicy === 'allowlist' && !form.dmAllowFrom.trim()) return 'DM allowlist 策略需要填写 Matrix 用户 ID'
  if (form.autoJoin === 'allowlist' && !form.autoJoinAllowlist.trim()) return '自动加入 allowlist 需要填写房间 ID 或别名'
  if (form.initialSyncLimit.trim() && Number.isNaN(Number(form.initialSyncLimit.trim()))) return '初始同步上限必须是数字'
  return ''
}

function buildMatrixAccountRequest(form: MatrixAddForm, includeOptionalSecrets: boolean): OpenClawMatrixAccountConfigUpdateRequest {
  return {
    actions: {
      channelInfo: form.actionChannelInfo,
      memberInfo: form.actionMemberInfo,
      messages: form.actionMessages,
      pins: form.actionPins,
      profile: form.actionProfile,
      reactions: form.actionReactions,
      verification: form.actionVerification,
    },
    agentId: form.agentId,
    allowPrivateNetwork: form.allowPrivateNetwork,
    autoJoin: form.autoJoin === 'inherit' ? '' : form.autoJoin,
    autoJoinAllowlist: splitMatrixFormList(form.autoJoinAllowlist),
    deviceName: form.deviceName.trim(),
    dmAllowFrom: splitMatrixFormList(form.dmAllowFrom),
    dmEnabled: form.dmEnabled,
    dmPolicy: form.dmPolicy,
    dmSessionScope: form.dmSessionScope === 'inherit' ? '' : form.dmSessionScope,
    dmThreadReplies: form.dmThreadReplies === 'inherit' ? '' : form.dmThreadReplies,
    enabled: true,
    encryption: form.encryption,
    execApprovals: {
      approvers: splitMatrixFormList(form.execApprovalsApprovers),
      enabled: form.execApprovalsEnabled,
      target: form.execApprovalsTarget === 'inherit' ? '' : form.execApprovalsTarget,
    },
    groupAllowFrom: splitMatrixFormList(form.groupAllowFrom),
    groupPolicy: form.groupPolicy === 'inherit' ? '' : form.groupPolicy,
    groups: splitMatrixFormList(form.groups),
    homeserver: form.homeserver.trim(),
    name: form.name.trim(),
    streaming: form.streamingMode === 'inherit' ? '' : form.streamingMode,
    threadReplies: form.threadReplies === 'inherit' ? '' : form.threadReplies,
    userId: form.userId.trim(),
    ...(includeOptionalSecrets && form.authMethod === 'token' && form.accessToken.trim() ? { accessToken: form.accessToken.trim() } : {}),
    ...(includeOptionalSecrets && form.authMethod === 'password' && form.password.trim() ? { password: form.password.trim() } : {}),
  }
}

function buildMatrixAccountDrafts(accounts: OpenClawMatrixAccount[]) {
  return accounts.reduce<Record<string, MatrixAccountDraft>>((drafts, account) => {
    drafts[account.accountId] = getMatrixAccountDraft({}, account.accountId, account)
    return drafts
  }, {})
}

function buildMatrixAccountFormFromAccount(account: OpenClawMatrixAccount): MatrixAddForm {
  return {
    ...defaultAddForm,
    accountId: account.accountId,
    actionChannelInfo: booleanDefault(account.actions?.channelInfo, true),
    actionMemberInfo: booleanDefault(account.actions?.memberInfo, true),
    actionMessages: booleanDefault(account.actions?.messages, true),
    actionPins: booleanDefault(account.actions?.pins, false),
    actionProfile: booleanDefault(account.actions?.profile, true),
    actionReactions: booleanDefault(account.actions?.reactions, true),
    actionVerification: booleanDefault(account.actions?.verification, true),
    agentId: account.agentId ?? '',
    allowPrivateNetwork: account.allowPrivateNetwork,
    autoJoin: account.autoJoin || 'inherit',
    autoJoinAllowlist: (account.autoJoinAllowlist ?? []).join('\n'),
    deviceName: account.deviceName || defaultAddForm.deviceName,
    dmAllowFrom: (account.dmAllowFrom ?? []).join('\n'),
    dmEnabled: account.dmEnabled !== false,
    dmPolicy: account.dmPolicy || 'pairing',
    dmSessionScope: account.dmSessionScope || 'inherit',
    dmThreadReplies: account.dmThreadReplies || 'inherit',
    encryption: account.encryption,
    execApprovalsApprovers: (account.execApprovals?.approvers ?? []).join('\n'),
    execApprovalsEnabled: account.execApprovals?.enabled || 'inherit',
    execApprovalsTarget: account.execApprovals?.target || 'dm',
    groupAllowFrom: (account.groupAllowFrom ?? []).join('\n'),
    groupPolicy: account.groupPolicy || 'inherit',
    homeserver: account.homeserver || '',
    name: account.name || '',
    streamingMode: account.streaming || 'inherit',
    threadReplies: account.threadReplies || 'inherit',
    userId: account.userId || '',
  }
}

function splitMatrixFormList(value: string) {
  return value
    .split(/[,，\n\r;；]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function booleanDefault(...values: Array<boolean | undefined>) {
  for (const value of values) {
    if (typeof value === 'boolean') return value
  }
  return false
}

function getMatrixAccountDraft(drafts: Record<string, MatrixAccountDraft>, accountId: string, account?: OpenClawMatrixAccount): MatrixAccountDraft {
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

function appendTaskLog(logs: string[], line: string) {
  const next = line.trim() ? [...logs, line] : logs
  return next.length > 240 ? next.slice(next.length - 240) : next
}

function maskMatrixSecrets(line: string) {
  return line
    .replace(/\bsyt_[A-Za-z0-9._=-]{8,}\b/g, '<matrix-access-token>')
    .replace(/(--password\s+)(\S+)/g, '$1<matrix-password>')
}

function taskTitle(kind: MatrixTaskKind | null) {
  switch (kind) {
    case 'add':
      return '添加 Matrix 账号'
    default:
      return 'Matrix 渠道任务'
  }
}

function OpenClawMatrixPage() {
  usePageTitle('OpenClaw Matrix 渠道')

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <OpenClawMatrixPanel />
      </div>
    </DashboardLayout>
  )
}

export default OpenClawMatrixPage
