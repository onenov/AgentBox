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
  OpenClawTwitchAccount,
  OpenClawTwitchStatusResponse,
} from '@/api'
import {
  deleteOpenClawTwitchAccount,
  getOpenClawTwitchAddAccountStreamURL,
  getOpenClawTwitchStatus,
  listOpenClawAgents,
  updateOpenClawTwitchAccountConfig,
  updateOpenClawTwitchConfig,
  validateOpenClawTwitchCredential,
} from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'

type LoadState = 'error' | 'idle' | 'loading' | 'ready'
type TwitchTaskKind = 'add'
type AccountModalMode = 'create' | 'edit'
type FormSection = 'access' | 'form' | 'help'

type TwitchAccountDraft = {
  agentId: string
  enabled: boolean
}

type TwitchAccountForm = {
  accessToken: string
  accountId: string
  agentId: string
  allowFrom: string
  allowedRoles: string
  channel: string
  clientId: string
  clientSecret: string
  name: string
  refreshToken: string
  requireMention: boolean
  username: string
}

type CredentialCheck = {
  error?: string
  label?: string
  signature: string
  valid: boolean
}

type AgentOption = {
  id: string
  label: string
  value: string
}

const formTabs: Array<{ icon: string; id: FormSection; label: string }> = [
  { icon: 'lucide:user-round-cog', id: 'form', label: '账号信息' },
  { icon: 'lucide:shield-check', id: 'access', label: '访问控制' },
  { icon: 'lucide:circle-help', id: 'help', label: '帮助流程' },
]

const defaultForm: TwitchAccountForm = {
  accessToken: '',
  accountId: 'default',
  agentId: '',
  allowFrom: '',
  allowedRoles: '',
  channel: '',
  clientId: '',
  clientSecret: '',
  name: '',
  refreshToken: '',
  requireMention: false,
  username: '',
}

const roleOptions = ['broadcaster', 'moderator', 'vip', 'subscriber']

const twitchHelpSteps: Array<{ content: ReactNode; step: string }> = [
  {
    step: '1',
    content: (
      <>
        在{' '}
        <Link href="https://dev.twitch.tv/console/apps" target="_blank" rel="noreferrer">
          Twitch Developer Console
          <Link.Icon />
        </Link>
        创建应用并复制 Client ID。
      </>
    ),
  },
  { step: '2', content: '为机器人账号生成 OAuth Access Token，建议包含聊天读写所需 scope。' },
  { step: '3', content: '填写机器人 username、要加入的 channel，以及允许唤起 OpenClaw 的用户或角色。' },
  {
    step: '4',
    content: (
      <>
        详细字段可对照{' '}
        <Link href="https://docs.openclaw.ai/zh-CN/channels/twitch" target="_blank" rel="noreferrer">
          OpenClaw Twitch 文档
          <Link.Icon />
        </Link>
        。
      </>
    ),
  },
]

export function OpenClawTwitchPanel() {
  const [state, setState] = useState<LoadState>('idle')
  const [status, setStatus] = useState<OpenClawTwitchStatusResponse | null>(null)
  const [accountDrafts, setAccountDrafts] = useState<Record<string, TwitchAccountDraft>>({})
  const [agents, setAgents] = useState<OpenClawAgentSummary[]>([])
  const [error, setError] = useState('')
  const [savingAccountId, setSavingAccountId] = useState('')
  const [savingChannelEnabled, setSavingChannelEnabled] = useState(false)
  const [task, setTask] = useState<OpenClawChannelTaskResponse | null>(null)
  const [taskKind, setTaskKind] = useState<TwitchTaskKind | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<AccountModalMode>('create')
  const [activeSection, setActiveSection] = useState<FormSection>('form')
  const [form, setForm] = useState<TwitchAccountForm>(defaultForm)
  const [editTarget, setEditTarget] = useState<OpenClawTwitchAccount | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<OpenClawTwitchAccount | null>(null)
  const [accountDeleting, setAccountDeleting] = useState(false)
  const logRef = useRef<HTMLPreElement | null>(null)
  const sourceRef = useRef<EventSource | null>(null)
  const streamFinishedRef = useRef(false)

  const loadStatus = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const [nextStatus, nextAgents] = await Promise.all([getOpenClawTwitchStatus(), listOpenClawAgents()])
      setStatus(nextStatus)
      setAgents(nextAgents.agents ?? [])
      setAccountDrafts(buildTwitchAccountDrafts(nextStatus.accounts ?? []))
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Twitch 渠道状态加载失败')
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

  const startStream = useCallback((kind: TwitchTaskKind, url: string) => {
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
          toast.success('Twitch 账号已添加')
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
          logs: appendTaskLog(current.logs, maskTwitchToken(payload.line)),
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
      toast.warning('Twitch 渠道流式任务连接中断')
      void loadStatus()
    }
  }, [closeStream, loadStatus])

  const updateChannelEnabled = useCallback(async (enabled: boolean) => {
    setSavingChannelEnabled(true)
    setStatus((current) => current ? { ...current, enabled, config: { ...current.config, enabled } } : current)
    try {
      const nextStatus = await updateOpenClawTwitchConfig({ enabled })
      setStatus(nextStatus)
      setAccountDrafts(buildTwitchAccountDrafts(nextStatus.accounts ?? []))
      toast.success(enabled ? 'Twitch 渠道已启用' : 'Twitch 渠道已停用')
    } catch (err) {
      void loadStatus()
      toast.warning(err instanceof Error ? err.message : 'Twitch 渠道开关更新失败')
    } finally {
      setSavingChannelEnabled(false)
    }
  }, [loadStatus])

  const updateAccount = useCallback(async (account: OpenClawTwitchAccount, patch: Partial<TwitchAccountDraft>) => {
    const draft = {
      ...getTwitchAccountDraft(accountDrafts, account.accountId, account),
      ...patch,
    }
    setAccountDrafts((current) => ({ ...current, [account.accountId]: draft }))
    setSavingAccountId(account.accountId)
    try {
      const nextStatus = await updateOpenClawTwitchAccountConfig(account.accountId, {
        agentId: draft.agentId,
        enabled: draft.enabled,
      })
      setStatus(nextStatus)
      setAccountDrafts(buildTwitchAccountDrafts(nextStatus.accounts ?? []))
      toast.success('Twitch 账号配置已更新')
    } catch (err) {
      setAccountDrafts(buildTwitchAccountDrafts(status?.accounts ?? []))
      toast.warning(err instanceof Error ? err.message : 'Twitch 账号配置更新失败')
    } finally {
      setSavingAccountId('')
    }
  }, [accountDrafts, status?.accounts])

  const openAddModal = useCallback(() => {
    setFormMode('create')
    setEditTarget(null)
    setForm(defaultForm)
    setActiveSection('form')
    setIsFormOpen(true)
  }, [])

  const openEditModal = useCallback((account: OpenClawTwitchAccount) => {
    setFormMode('edit')
    setEditTarget(account)
    setForm(buildTwitchAccountFormFromAccount(account))
    setActiveSection('form')
    setIsFormOpen(true)
  }, [])

  const submitForm = useCallback(async () => {
    if (!form.username.trim() || !form.clientId.trim() || !form.channel.trim()) {
      toast.warning('Username、Client ID 和 Channel 不能为空')
      return
    }
    if (formMode === 'create' && !form.accessToken.trim()) {
      toast.warning('Access Token 不能为空')
      return
    }

    if (formMode === 'edit' && editTarget) {
      setSavingAccountId(editTarget.accountId)
      try {
        const nextStatus = await updateOpenClawTwitchAccountConfig(editTarget.accountId, {
          agentId: form.agentId,
          allowFrom: splitFormList(form.allowFrom),
          allowedRoles: splitFormList(form.allowedRoles),
          channel: form.channel.trim(),
          clientId: form.clientId.trim(),
          clientSecret: form.clientSecret.trim(),
          name: form.name.trim(),
          refreshToken: form.refreshToken.trim(),
          requireMention: form.requireMention,
          username: form.username.trim(),
          ...(form.accessToken.trim() ? { accessToken: form.accessToken.trim() } : {}),
        })
        setStatus(nextStatus)
        setAccountDrafts(buildTwitchAccountDrafts(nextStatus.accounts ?? []))
        setIsFormOpen(false)
        setEditTarget(null)
        toast.success('Twitch 账号已更新')
      } catch (err) {
        toast.warning(err instanceof Error ? err.message : 'Twitch 账号更新失败')
      } finally {
        setSavingAccountId('')
      }
      return
    }

    setIsFormOpen(false)
    startStream('add', getOpenClawTwitchAddAccountStreamURL(form))
    setForm(defaultForm)
    setActiveSection('form')
  }, [editTarget, form, formMode, startStream])

  const deleteAccount = useCallback(async () => {
    if (!deleteTarget) return
    setAccountDeleting(true)
    try {
      await deleteOpenClawTwitchAccount(deleteTarget.accountId)
      setDeleteTarget(null)
      toast.success('Twitch 账号已删除')
      void loadStatus()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'Twitch 账号删除失败')
    } finally {
      setAccountDeleting(false)
    }
  }, [deleteTarget, loadStatus])

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
              <Alert.Title>Twitch 渠道状态加载失败</Alert.Title>
              <Alert.Description>请检查 Twitch 渠道配置和网关运行状态。</Alert.Description>
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
                  <Icon icon="simple-icons:twitch" className="size-6" />
                </div>
                <div className="min-w-0">
                  <Card.Title>Twitch</Card.Title>
                  <Card.Description>添加 Twitch 聊天机器人账号</Card.Description>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {state !== 'loading' && !isTaskRunning ? (
                  <Button size="sm" isIconOnly variant={state === 'error' ? 'primary' : 'ghost'} aria-label="刷新 Twitch 渠道状态" onPress={() => void loadStatus()}>
                    <Icon icon="lucide:refresh-cw" />
                  </Button>
                ) : null}
                <Button size="sm" variant="primary" isDisabled={isTaskRunning} onPress={openAddModal}>
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
              description: configured ? `${accounts.length} 个账号` : '等待添加 Twitch 凭据',
              icon: 'lucide:key-round',
              loading: isLoading,
              ok: configured,
              title: '配置状态',
            },
            {
              description: enabled ? 'Twitch 渠道已启用' : 'Twitch 渠道已停用',
              icon: 'lucide:radio',
              loading: isLoading,
              ok: enabled,
              title: '运行状态',
            },
            {
              description: status?.config.tokenConfigured ? status.config.tokenSource : '未配置',
              icon: 'lucide:fingerprint',
              loading: isLoading,
              ok: Boolean(status?.config.tokenConfigured),
              title: '默认 Token',
            },
            {
              action: (
                <Switch
                  size="lg"
                  aria-label="切换 Twitch 渠道总开关"
                  isSelected={enabled}
                  isDisabled={!configured || isTaskRunning || isLoading || savingChannelEnabled}
                  onChange={(nextEnabled) => void updateChannelEnabled(nextEnabled)}
                >
                  <Switch.Control><Switch.Thumb /></Switch.Control>
                </Switch>
              ),
              description: enabled ? 'Twitch 渠道已启用' : 'Twitch 渠道已停用',
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
                <TwitchAccountCard
                  key={account.accountId}
                  account={account}
                  agentOptions={agentOptions}
                  draft={getTwitchAccountDraft(accountDrafts, account.accountId, account)}
                  isDisabled={isLoading || isTaskRunning}
                  isSaving={savingAccountId === account.accountId}
                  onChange={(patch) => void updateAccount(account, patch)}
                  onDelete={setDeleteTarget}
                  onEdit={openEditModal}
                />
              ))}
            </div>
          ) : (
            <ChannelEmptyState
              description="添加一个 Twitch 账号后，就可以配置路由 Agent、启用状态和消息接入策略。"
              icon="simple-icons:twitch"
              title="还没有 Twitch 账号"
            />
          )
        ) : (
          <ChannelEmptyState
            description="配置 Twitch 凭据后，可以在这里管理账号和消息接入。"
            icon="lucide:package-x"
            title="Twitch 尚未配置"
          />
        )}

        {status?.error ? (
          <div className="rounded-xl bg-warning/10 p-3 text-sm leading-6 text-warning">{status.error}</div>
        ) : null}

        <TaskLogPanel task={task} taskKind={taskKind} logRef={logRef} onClose={() => setTask(null)} />

        <TwitchAccountModal
          activeSection={activeSection}
          agentOptions={agentOptions}
          editAccount={editTarget}
          form={form}
          isOpen={isFormOpen}
          isSubmitting={isTaskRunning || Boolean(editTarget && savingAccountId === editTarget.accountId)}
          mode={formMode}
          onActiveSectionChange={setActiveSection}
          onFormChange={setForm}
          onOpenChange={(open) => {
            setIsFormOpen(open)
            if (!open) {
              setActiveSection('form')
              setEditTarget(null)
              setFormMode('create')
            }
          }}
          onSubmit={() => void submitForm()}
        />

        <AlertDialog.Backdrop isOpen={Boolean(deleteTarget)} onOpenChange={(open) => {
          if (!open && !accountDeleting) setDeleteTarget(null)
        }}>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-[480px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>删除 Twitch 账号？</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="break-all text-sm leading-6 text-muted">{deleteTarget?.accountId}</p>
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

function TwitchAccountCard({
  account,
  agentOptions,
  draft,
  isDisabled,
  isSaving,
  onChange,
  onDelete,
  onEdit,
}: {
  account: OpenClawTwitchAccount
  agentOptions: AgentOption[]
  draft: TwitchAccountDraft
  isDisabled: boolean
  isSaving: boolean
  onChange: (patch: Partial<TwitchAccountDraft>) => void
  onDelete: (account: OpenClawTwitchAccount) => void
  onEdit: (account: OpenClawTwitchAccount) => void
}) {
  const selectedAgent = agentOptions.find((option) => option.value === draft.agentId) ?? agentOptions[0]
  return (
    <Card>
      <Card.Content>
        <div className="flex gap-4 items-center justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div
              className={`flex size-11 shrink-0 items-center justify-center rounded-full ${draft.enabled ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}
              aria-label={draft.enabled ? '已启用' : '已停用'}
              title={draft.enabled ? '已启用' : '已停用'}
            >
              <Icon icon="simple-icons:twitch" className="size-6" />
            </div>
            <div className="flex min-w-0 flex-col items-start">
              <Card.Title className="text-base">{account.name || account.accountId}</Card.Title>
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-xs text-muted">{account.username || '-'} → {account.channel || '-'}</span>
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
            <Switch size="lg" className="flex p-1 bg-default rounded-full" aria-label="启用 Twitch 账号" isSelected={draft.enabled} isDisabled={isDisabled || isSaving} onChange={(enabled) => onChange({ enabled })}>
              <Switch.Control><Switch.Thumb /></Switch.Control>
            </Switch>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            <Button isIconOnly size="sm" variant="tertiary" aria-label="编辑 Twitch 账号" onPress={() => onEdit(account)} isDisabled={isDisabled || isSaving}>
              <Icon icon="lucide:pencil" className="size-4" />
            </Button>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            <Button isIconOnly size="sm" variant="tertiary" aria-label="删除 Twitch 账号" onPress={() => onDelete(account)} isDisabled={isDisabled || isSaving}>
              <Icon icon="lucide:trash-2" className="size-4" />
            </Button>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function TwitchAccountModal({
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
  activeSection: FormSection
  agentOptions: AgentOption[]
  editAccount: OpenClawTwitchAccount | null
  form: TwitchAccountForm
  isOpen: boolean
  isSubmitting: boolean
  mode: AccountModalMode
  onActiveSectionChange: (section: FormSection) => void
  onFormChange: (form: TwitchAccountForm) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
}) {
  const update = (patch: Partial<TwitchAccountForm>) => onFormChange({ ...form, ...patch })
  const [credentialCheck, setCredentialCheck] = useState<CredentialCheck | null>(null)
  const [isCredentialChecking, setIsCredentialChecking] = useState(false)
  const canValidateCredential = Boolean(form.accessToken.trim())
  const credentialSignature = form.accessToken.trim()
  const visibleCredentialCheck = credentialCheck?.signature === credentialSignature ? credentialCheck : null

  const validateCredential = async () => {
    if (!canValidateCredential || isCredentialChecking) return
    setIsCredentialChecking(true)
    setCredentialCheck(null)
    try {
      const result = await validateOpenClawTwitchCredential({ accessToken: form.accessToken.trim() })
      if (result.valid) {
        const label = result.login ? `@${result.login}` : result.userId || result.clientId || ''
        setCredentialCheck({ label, signature: credentialSignature, valid: true })
        toast.success(label ? `Twitch Token 校验通过：${label}` : 'Twitch Token 校验通过')
        if (mode === 'create') {
          update({
            clientId: form.clientId || result.clientId || '',
            username: form.username || result.login || '',
          })
        }
      } else {
        setCredentialCheck({ error: result.error || 'Twitch Access Token 校验失败', signature: credentialSignature, valid: false })
        toast.warning(result.error || 'Twitch Access Token 校验失败')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Twitch Access Token 校验失败'
      setCredentialCheck({ error: message, signature: credentialSignature, valid: false })
      toast.warning(message)
    } finally {
      setIsCredentialChecking(false)
    }
  }

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="sm:max-w-[680px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-[#9146ff]/10 text-[#9146ff]">
              <Icon icon="simple-icons:twitch" className="size-5" />
            </Modal.Icon>
            <div>
              <Modal.Heading>{mode === 'edit' ? '编辑 Twitch 账号' : '添加 Twitch 账号'}</Modal.Heading>
              <p className="mt-1 text-sm text-muted">
                {mode === 'edit'
                  ? `更新 ${editAccount?.name || editAccount?.accountId || 'Twitch 账号'} 的基础和访问设置。`
                  : '填写 Twitch 机器人账号和 OAuth 凭据。'}
              </p>
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

              {activeSection === 'help' ? (
                <div className="grid gap-3">
                  {twitchHelpSteps.map((item) => (
                    <div key={item.step} className="flex items-start gap-3 rounded-xl bg-surface-secondary/50 p-3 text-sm text-foreground">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{item.step}</span>
                      <span className="leading-6">{item.content}</span>
                    </div>
                  ))}
                </div>
              ) : activeSection === 'access' ? (
                <div className="space-y-5 max-h-[500px] overflow-y-auto">
                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>访问控制</ItemCardGroup.Title>
                      <ItemCardGroup.Description>限制哪些 Twitch 用户或角色可以唤起 OpenClaw。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem actionClassName="w-fit" description="开启后聊天消息需要提及机器人后才触发。" icon="lucide:at-sign" title="需要提及">
                      <Switch size="lg" aria-label="Twitch 消息要求提及机器人" isSelected={form.requireMention} isDisabled={isSubmitting} onChange={(requireMention) => update({ requireMention })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </FormItem>
                  </ItemCardGroup>

                  <TextareaCard
                    description="支持逗号或换行分隔；可填写 Twitch user id 或 login。"
                    disabled={isSubmitting}
                    icon="lucide:users"
                    placeholder="alice, 123456789"
                    title="准入用户"
                    value={form.allowFrom}
                    onChange={(allowFrom) => update({ allowFrom })}
                  />

                  <TextareaCard
                    description={`常见角色：${roleOptions.join(', ')}。`}
                    disabled={isSubmitting}
                    icon="lucide:badge-check"
                    placeholder="broadcaster, moderator, vip"
                    title="准入角色"
                    value={form.allowedRoles}
                    onChange={(allowedRoles) => update({ allowedRoles })}
                  />
                </div>
              ) : (
                <div className="space-y-5 max-h-[500px] overflow-y-auto">
                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>账号信息</ItemCardGroup.Title>
                      <ItemCardGroup.Description>{mode === 'edit' ? '编辑账号名称、频道和凭据。' : '填写 Twitch 机器人账号凭据。'}</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem description="填写一个可识别的名称。" icon="lucide:badge" title="账号名称">
                      <ClearableInput value={form.name} disabled={isSubmitting} placeholder={mode === 'edit' ? '未命名' : '显示名称'} onChange={(name) => update({ name })} />
                    </FormItem>
                    <Separator />
                    <FormItem description="本地账号 ID。" icon="lucide:user-round" title="账号 ID">
                      <ClearableInput value={form.accountId} disabled={isSubmitting || mode === 'edit'} placeholder="default" onChange={(accountId) => update({ accountId })} />
                    </FormItem>
                    <Separator />
                    <FormItem description="机器人 Twitch login。" icon="lucide:user" title="Username">
                      <ClearableInput value={form.username} disabled={isSubmitting} placeholder="openclaw_bot" onChange={(username) => update({ username })} />
                    </FormItem>
                    <Separator />
                    <FormItem description="要加入并监听的 Twitch 频道。" icon="lucide:radio" title="Channel">
                      <ClearableInput value={form.channel} disabled={isSubmitting} placeholder="your_channel" onChange={(channel) => update({ channel })} />
                    </FormItem>
                    <Separator />
                    <FormItem description="Twitch 应用 Client ID。" icon="lucide:app-window" title="Client ID">
                      <ClearableInput value={form.clientId} disabled={isSubmitting} placeholder="client id" onChange={(clientId) => update({ clientId })} />
                    </FormItem>
                    <Separator />
                    <FormItem description={mode === 'edit' ? '留空保持当前 Access Token 不变。' : 'OAuth Access Token。'} icon="lucide:key-round" title="Access Token">
                      <ClearableInput value={form.accessToken} disabled={isSubmitting} placeholder="oauth:..." onChange={(accessToken) => update({ accessToken })} />
                    </FormItem>
                    <Separator />
                    <FormItem description="可选，用于后续刷新 token。" icon="lucide:rotate-cw" title="Refresh Token">
                      <ClearableInput value={form.refreshToken} disabled={isSubmitting} placeholder="refresh token" onChange={(refreshToken) => update({ refreshToken })} />
                    </FormItem>
                    <Separator />
                    <FormItem description="可选，留空会清除配置。" icon="lucide:key-square" title="Client Secret">
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
            <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted">
              {visibleCredentialCheck?.valid ? (
                <>
                  <Icon icon="lucide:badge-check" className="size-4 shrink-0 text-success" />
                  <span className="truncate">已校验 {visibleCredentialCheck.label}</span>
                </>
              ) : visibleCredentialCheck?.error ? (
                <>
                  <Icon icon="lucide:triangle-alert" className="size-4 shrink-0 text-warning" />
                  <span className="truncate">{visibleCredentialCheck.error}</span>
                </>
              ) : null}
            </div>
            {canValidateCredential ? (
              <Button variant="secondary" isPending={isCredentialChecking} isDisabled={isSubmitting} onPress={() => void validateCredential()}>
                <Icon icon="lucide:shield-check" className="size-4" />
                校验凭据
              </Button>
            ) : null}
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

function FormItem({ actionClassName = 'w-full min-w-0 sm:w-auto', children, description, icon, title }: { actionClassName?: string; children: ReactNode; description?: string; icon: string; title: string }) {
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
              <span className={`block size-2.5 shrink-0 rounded-full ${item.ok ? 'bg-success shadow-[0_0_12px_color-mix(in_oklch,var(--success)_80%,transparent)]' : 'bg-danger shadow-[0_0_12px_color-mix(in_oklch,var(--danger)_80%,transparent)]'}`} aria-label={item.ok ? '正常' : '异常'} />
            )}
          </ItemCard.Action>
        </ItemCard>
      ))}
    </div>
  )
}

function TaskLogPanel({ logRef, onClose, task, taskKind }: { logRef: RefObject<HTMLPreElement | null>; onClose: () => void; task: OpenClawChannelTaskResponse | null; taskKind: TwitchTaskKind | null }) {
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

function buildTwitchAccountDrafts(accounts: OpenClawTwitchAccount[]) {
  return accounts.reduce<Record<string, TwitchAccountDraft>>((drafts, account) => {
    drafts[account.accountId] = getTwitchAccountDraft({}, account.accountId, account)
    return drafts
  }, {})
}

function buildTwitchAccountFormFromAccount(account: OpenClawTwitchAccount): TwitchAccountForm {
  return {
    accessToken: '',
    accountId: account.accountId,
    agentId: account.agentId ?? '',
    allowFrom: (account.allowFrom ?? []).join('\n'),
    allowedRoles: (account.allowedRoles ?? []).join('\n'),
    channel: account.channel || '',
    clientId: account.clientId || '',
    clientSecret: '',
    name: account.name || '',
    refreshToken: '',
    requireMention: account.requireMention,
    username: account.username || '',
  }
}

function splitFormList(value: string) {
  return value
    .split(/[,，\n\r;；]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function getTwitchAccountDraft(drafts: Record<string, TwitchAccountDraft>, accountId: string, account?: OpenClawTwitchAccount): TwitchAccountDraft {
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

function maskTwitchToken(line: string) {
  return line
    .replace(/\boauth:[A-Za-z0-9_-]{12,}\b/g, '<access-token>')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, (match) => match.length > 80 ? '<access-token>' : match)
}

function taskTitle(kind: TwitchTaskKind | null) {
  switch (kind) {
    case 'add':
      return '添加 Twitch 账号'
    default:
      return 'Twitch 渠道任务'
  }
}

function OpenClawTwitchPage() {
  usePageTitle('OpenClaw Twitch 渠道')

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <OpenClawTwitchPanel />
      </div>
    </DashboardLayout>
  )
}

export default OpenClawTwitchPage
