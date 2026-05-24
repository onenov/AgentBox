import type { ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Key } from '@heroui/react'
import { Alert, AlertDialog, Button, Card, Chip, Dropdown, InputGroup, ListBox, Modal, Skeleton, Switch, toast } from '@heroui/react'
import { CellSelect, ItemCard, ItemCardGroup, Segment } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type {
  OpenClawAgentSummary,
  OpenClawChannelStreamError,
  OpenClawChannelStreamLog,
  OpenClawChannelStreamMeta,
  OpenClawChannelStreamStatus,
  OpenClawChannelTaskResponse,
  OpenClawWhatsAppAccount,
  OpenClawWhatsAppStatusResponse,
} from '@/api'
import {
  deleteOpenClawWhatsAppAccount,
  getOpenClawWhatsAppAddAccountStreamURL,
  getOpenClawWhatsAppLoginStreamURL,
  getOpenClawWhatsAppLogoutStreamURL,
  getOpenClawWhatsAppStatus,
  getOpenClawWhatsAppUninstallStreamURL,
  listOpenClawAgents,
  updateOpenClawWhatsAppAccountConfig,
  updateOpenClawWhatsAppConfig,
} from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { OpenClawPairingModal } from './openclaw-pairing'

type LoadState = 'error' | 'idle' | 'loading' | 'ready'
type TaskKind = 'add' | 'login' | 'logout' | 'uninstall'
type ModalMode = 'create' | 'edit'
type ModalSection = 'form' | 'policy'

type WhatsAppAccountDraft = {
  agentId: string
  enabled: boolean
}

type WhatsAppForm = {
  accountId: string
  agentId: string
  allowFrom: string
  authDir: string
  dmPolicy: string
  groupAllowFrom: string
  groupPolicy: string
  name: string
  selfChatMode: boolean
  sendReadReceipts: boolean
}

type AgentOption = {
  id: string
  label: string
  value: string
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

const modalTabs: Array<{ icon: string; id: ModalSection; label: string }> = [
  { icon: 'lucide:user-round-cog', id: 'form', label: '账号信息' },
  { icon: 'lucide:shield-check', id: 'policy', label: '访问策略' },
]

const defaultForm: WhatsAppForm = {
  accountId: 'default',
  agentId: '',
  allowFrom: '',
  authDir: '',
  dmPolicy: 'pairing',
  groupAllowFrom: '',
  groupPolicy: 'allowlist',
  name: '',
  selfChatMode: false,
  sendReadReceipts: true,
}

export function OpenClawWhatsAppPanel() {
  const [state, setState] = useState<LoadState>('idle')
  const [status, setStatus] = useState<OpenClawWhatsAppStatusResponse | null>(null)
  const [accountDrafts, setAccountDrafts] = useState<Record<string, WhatsAppAccountDraft>>({})
  const [agents, setAgents] = useState<OpenClawAgentSummary[]>([])
  const [error, setError] = useState('')
  const [savingChannelEnabled, setSavingChannelEnabled] = useState(false)
  const [savingAccountId, setSavingAccountId] = useState('')
  const [task, setTask] = useState<OpenClawChannelTaskResponse | null>(null)
  const [taskKind, setTaskKind] = useState<TaskKind | null>(null)
  const [isPairingOpen, setIsPairingOpen] = useState(false)
  const [isAccountOpen, setIsAccountOpen] = useState(false)
  const [accountModalMode, setAccountModalMode] = useState<ModalMode>('create')
  const [activeSection, setActiveSection] = useState<ModalSection>('form')
  const [form, setForm] = useState<WhatsAppForm>(defaultForm)
  const [editTarget, setEditTarget] = useState<OpenClawWhatsAppAccount | null>(null)
  const [logoutTarget, setLogoutTarget] = useState<OpenClawWhatsAppAccount | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<OpenClawWhatsAppAccount | null>(null)
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const [accountDeleting, setAccountDeleting] = useState(false)
  const logRef = useRef<HTMLPreElement | null>(null)
  const sourceRef = useRef<EventSource | null>(null)
  const streamFinishedRef = useRef(false)

  const loadStatus = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const [nextStatus, nextAgents] = await Promise.all([getOpenClawWhatsAppStatus(), listOpenClawAgents()])
      setStatus(nextStatus)
      setAgents(nextAgents.agents ?? [])
      setAccountDrafts(buildAccountDrafts(nextStatus.accounts ?? []))
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'WhatsApp 渠道状态加载失败')
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

  const startStream = useCallback((kind: TaskKind, url: string) => {
    closeStream()
    streamFinishedRef.current = false
    setTaskKind(kind)

    const now = new Date().toISOString()
    setTask({
      id: `${kind}-${Date.now()}`,
      logs: ['正在连接流式任务。日志将显示配对状态，不返回二维码图形。'],
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
      toast.warning('WhatsApp 渠道流式任务连接中断')
      void loadStatus()
    }
  }, [closeStream, loadStatus])

  const openAddModal = useCallback(() => {
    setAccountModalMode('create')
    setEditTarget(null)
    setForm({
      ...defaultForm,
      dmPolicy: status?.config.dmPolicy || defaultForm.dmPolicy,
      groupPolicy: status?.config.groupPolicy || defaultForm.groupPolicy,
    })
    setActiveSection('form')
    setIsAccountOpen(true)
  }, [status?.config])

  const openEditModal = useCallback((account: OpenClawWhatsAppAccount) => {
    setAccountModalMode('edit')
    setEditTarget(account)
    setForm(buildFormFromAccount(account, status))
    setActiveSection('form')
    setIsAccountOpen(true)
  }, [status])

  const submitAccount = useCallback(async () => {
    if (form.dmPolicy === 'allowlist' && !form.allowFrom.trim()) {
      toast.warning('Allowlist 策略需要填写准入号码')
      return
    }
    if (form.groupPolicy === 'allowlist' && !form.groupAllowFrom.trim()) {
      toast.warning('群聊 Allowlist 策略需要填写群聊准入号码')
      return
    }
    if (accountModalMode === 'edit' && editTarget) {
      setSavingAccountId(editTarget.accountId)
      try {
        const nextStatus = await updateOpenClawWhatsAppAccountConfig(editTarget.accountId, {
          agentId: form.agentId,
          allowFrom: splitFormList(form.allowFrom),
          authDir: form.authDir.trim(),
          dmPolicy: form.dmPolicy,
          enabled: getAccountDraft(accountDrafts, editTarget.accountId, editTarget).enabled,
          groupAllowFrom: splitFormList(form.groupAllowFrom),
          groupPolicy: form.groupPolicy === 'inherit' ? '' : form.groupPolicy,
          name: form.name.trim(),
          selfChatMode: form.selfChatMode,
          sendReadReceipts: form.sendReadReceipts,
        })
        setStatus(nextStatus)
        setAccountDrafts(buildAccountDrafts(nextStatus.accounts ?? []))
        setIsAccountOpen(false)
        setEditTarget(null)
        toast.success('WhatsApp 账号已更新')
      } catch (err) {
        toast.warning(err instanceof Error ? err.message : 'WhatsApp 账号更新失败')
      } finally {
        setSavingAccountId('')
      }
      return
    }

    setIsAccountOpen(false)
    startStream('add', getOpenClawWhatsAppAddAccountStreamURL({
      accountId: form.accountId,
      agentId: form.agentId,
      allowFrom: form.allowFrom,
      authDir: form.authDir,
      dmPolicy: form.dmPolicy,
      groupAllowFrom: form.groupAllowFrom,
      groupPolicy: form.groupPolicy === 'inherit' ? '' : form.groupPolicy,
      name: form.name,
      selfChatMode: form.selfChatMode,
    }))
    setForm(defaultForm)
  }, [accountDrafts, accountModalMode, editTarget, form, startStream])

  const updateChannelEnabled = useCallback(async (enabled: boolean) => {
    setSavingChannelEnabled(true)
    setStatus((current) => current ? { ...current, enabled, config: { ...current.config, enabled } } : current)
    try {
      const nextStatus = await updateOpenClawWhatsAppConfig({ enabled })
      setStatus(nextStatus)
      setAccountDrafts(buildAccountDrafts(nextStatus.accounts ?? []))
      toast.success(enabled ? 'WhatsApp 渠道已启用' : 'WhatsApp 渠道已停用')
    } catch (err) {
      void loadStatus()
      toast.warning(err instanceof Error ? err.message : 'WhatsApp 渠道开关更新失败')
    } finally {
      setSavingChannelEnabled(false)
    }
  }, [loadStatus])

  const updateChannelDMPolicy = useCallback(async (dmPolicy: string) => {
    if (!dmPolicy || !dmPolicyOptions.some((option) => option.id === dmPolicy)) return
    setStatus((current) => current ? { ...current, config: { ...current.config, dmPolicy } } : current)
    try {
      const nextStatus = await updateOpenClawWhatsAppConfig({ dmPolicy })
      setStatus(nextStatus)
      setAccountDrafts(buildAccountDrafts(nextStatus.accounts ?? []))
      toast.success('默认 DM 准入已更新')
    } catch (err) {
      void loadStatus()
      toast.warning(err instanceof Error ? err.message : '默认 DM 准入更新失败')
    }
  }, [loadStatus])

  const updateAccount = useCallback(async (account: OpenClawWhatsAppAccount, patch: Partial<WhatsAppAccountDraft>) => {
    const draft = {
      ...getAccountDraft(accountDrafts, account.accountId, account),
      ...patch,
    }
    setAccountDrafts((current) => ({ ...current, [account.accountId]: draft }))
    setSavingAccountId(account.accountId)
    try {
      const nextStatus = await updateOpenClawWhatsAppAccountConfig(account.accountId, {
        agentId: draft.agentId,
        enabled: draft.enabled,
      })
      setStatus(nextStatus)
      setAccountDrafts(buildAccountDrafts(nextStatus.accounts ?? []))
      toast.success('WhatsApp 账号配置已更新')
    } catch (err) {
      setAccountDrafts(buildAccountDrafts(status?.accounts ?? []))
      toast.warning(err instanceof Error ? err.message : 'WhatsApp 账号配置更新失败')
    } finally {
      setSavingAccountId('')
    }
  }, [accountDrafts, status?.accounts])

  const deleteAccount = useCallback(async () => {
    if (!deleteTarget) return
    setAccountDeleting(true)
    try {
      await deleteOpenClawWhatsAppAccount(deleteTarget.accountId)
      setDeleteTarget(null)
      toast.success('WhatsApp 账号配置已删除')
      void loadStatus()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'WhatsApp 账号删除失败')
    } finally {
      setAccountDeleting(false)
    }
  }, [deleteTarget, loadStatus])

  const agentOptions = useMemo(() => buildAgentOptions(agents), [agents])
  const isLoading = state === 'loading' && !status
  const isTaskRunning = Boolean(task && task.status !== 'done' && task.status !== 'error')
  const accounts = status?.accounts ?? []
  const installed = Boolean(status?.installed)
  const linked = Boolean(status?.linked)
  const enabled = Boolean(status?.enabled)

  return (
    <>
      {error ? (
        <div className="mx-auto w-full max-w-6xl py-3">
          <Alert status="danger" className="items-center">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>WhatsApp 渠道状态加载失败</Alert.Title>
              <Alert.Description>请检查 OpenClaw 配置和 Gateway 运行状态。</Alert.Description>
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
                  <Icon icon="simple-icons:whatsapp" className="size-6" />
                </div>
                <div className="min-w-0">
                  <Card.Title>WhatsApp</Card.Title>
                  <Card.Description>通过 WhatsApp Web / Baileys 接入 OpenClaw，支持 QR 登录和多账号。</Card.Description>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {state !== 'loading' && !isTaskRunning ? (
                  <Button size="sm" isIconOnly variant={state === 'error' ? 'primary' : 'ghost'} aria-label="刷新 WhatsApp 渠道状态" onPress={() => void loadStatus()}>
                    <Icon icon="lucide:refresh-cw" />
                  </Button>
                ) : null}
                <Button size="sm" variant="tertiary" isDisabled={isTaskRunning} onPress={() => setIsPairingOpen(true)}>
                  <Icon icon="lucide:shield-check" />
                  配对审批
                </Button>
                {installed ? (
                  <Button size="sm" variant="tertiary" isDisabled={isTaskRunning} onPress={() => setUninstallOpen(true)}>
                    <Icon icon="lucide:trash-2" />
                    卸载
                  </Button>
                ) : null}
                <Button size="sm" variant="primary" isDisabled={isTaskRunning} onPress={openAddModal}>
                  <Icon icon="lucide:qr-code" />
                  添加账号
                </Button>
              </div>
            </div>
          </Card.Content>
        </Card>

        <StatusItemList
          items={[
            {
              description: installed ? status?.version || '已安装' : '首次添加时会触发安装提示',
              icon: 'lucide:package-check',
              loading: isLoading,
              ok: installed,
              title: '插件',
            },
            {
              description: linked ? `${accounts.filter((account) => account.linked).length} 个账号已登录` : '等待扫码登录',
              icon: 'lucide:qr-code',
              loading: isLoading,
              ok: linked,
              title: '登录态',
            },
            {
              action: (
                <FriendlySelect
                  ariaLabel="默认 DM 准入"
                  isDisabled={isTaskRunning || isLoading}
                  options={dmPolicyOptions}
                  value={status?.config.dmPolicy || 'pairing'}
                  onChange={(value) => void updateChannelDMPolicy(String(value ?? 'pairing'))}
                />
              ),
              description: '访问控制和激活',
              icon: 'lucide:shield-check',
              loading: isLoading,
              ok: Boolean(status?.configured),
              title: '默认 DM',
            },
            {
              action: (
                <Switch
                  size="lg"
                  aria-label="切换 WhatsApp 渠道总开关"
                  isSelected={enabled}
                  isDisabled={!installed || isTaskRunning || isLoading || savingChannelEnabled}
                  onChange={(nextEnabled) => void updateChannelEnabled(nextEnabled)}
                >
                  <Switch.Control><Switch.Thumb /></Switch.Control>
                </Switch>
              ),
              description: enabled ? 'WhatsApp 渠道已启用' : 'WhatsApp 渠道已停用',
              icon: 'lucide:power',
              loading: isLoading,
              ok: enabled,
              title: '启用状态',
            },
          ]}
        />

        {installed ? (
          accounts.length > 0 ? (
            <div className="grid gap-2 lg:grid-cols-2">
              {accounts.map((account) => (
                <WhatsAppAccountCard
                  key={account.accountId}
                  account={account}
                  agentOptions={agentOptions}
                  draft={getAccountDraft(accountDrafts, account.accountId, account)}
                  isDisabled={isLoading || isTaskRunning}
                  isSaving={savingAccountId === account.accountId}
                  onChange={(patch) => void updateAccount(account, patch)}
                  onDelete={setDeleteTarget}
                  onEdit={openEditModal}
                  onLogin={(nextAccount) => startStream('login', getOpenClawWhatsAppLoginStreamURL(nextAccount.accountId))}
                  onLogout={setLogoutTarget}
                />
              ))}
            </div>
          ) : (
            <ChannelEmptyState
              description="添加一个 WhatsApp 账号后，就可以扫码登录并配置消息接入策略。"
              icon="simple-icons:whatsapp"
              title="还没有 WhatsApp 账号"
            />
          )
        ) : (
          <ChannelEmptyState
            description="安装 WhatsApp 插件后，可以在这里添加账号并配置消息接入。"
            icon="lucide:package-x"
            title="WhatsApp 插件未安装"
          />
        )}


        {status?.error ? (
          <div className="rounded-xl bg-warning/10 p-3 text-sm leading-6 text-warning">
            {status.error}
          </div>
        ) : null}

        <TaskLogPanel task={task} taskKind={taskKind} logRef={logRef} onClose={() => setTask(null)} />

        <OpenClawPairingModal
          channel="whatsapp"
          channelLabel="WhatsApp"
          isOpen={isPairingOpen}
          onApproved={() => void loadStatus()}
          onOpenChange={setIsPairingOpen}
        />

        <WhatsAppAccountModal
          activeSection={activeSection}
          agentOptions={agentOptions}
          form={form}
          isOpen={isAccountOpen}
          isSubmitting={isTaskRunning || Boolean(editTarget && savingAccountId === editTarget.accountId)}
          mode={accountModalMode}
          onActiveSectionChange={setActiveSection}
          onFormChange={setForm}
          onOpenChange={(open) => {
            setIsAccountOpen(open)
            if (!open) {
              setEditTarget(null)
              setAccountModalMode('create')
              setActiveSection('form')
            }
          }}
          onSubmit={submitAccount}
        />

        <AlertDialog.Backdrop isOpen={Boolean(logoutTarget)} onOpenChange={(open) => !open && setLogoutTarget(null)}>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-[480px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="warning" />
                <AlertDialog.Heading>登出 WhatsApp 账号？</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="break-all text-sm leading-6 text-muted">{logoutTarget?.accountId}</p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary">取消</Button>
                <Button variant="danger" onPress={() => {
                  if (!logoutTarget) return
                  const accountId = logoutTarget.accountId
                  setLogoutTarget(null)
                  startStream('logout', getOpenClawWhatsAppLogoutStreamURL(accountId))
                }}>
                  <Icon icon="lucide:log-out" />
                  登出
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>

        <AlertDialog.Backdrop isOpen={uninstallOpen} onOpenChange={setUninstallOpen}>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-[480px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>卸载 WhatsApp 插件？</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-sm leading-6 text-muted">这会禁用并删除 WhatsApp 渠道配置、卸载插件并刷新注册表。</p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary">取消</Button>
                <Button variant="danger" onPress={() => {
                  setUninstallOpen(false)
                  startStream('uninstall', getOpenClawWhatsAppUninstallStreamURL())
                }}>
                  <Icon icon="lucide:trash-2" />
                  确认卸载
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>

        <AlertDialog.Backdrop isOpen={Boolean(deleteTarget)} onOpenChange={(open) => {
          if (!open && !accountDeleting) setDeleteTarget(null)
        }}>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-[480px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>删除 WhatsApp 账号配置？</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="break-all text-sm leading-6 text-muted">{deleteTarget?.accountId}</p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary" isDisabled={accountDeleting}>取消</Button>
                <Button variant="danger" onPress={() => void deleteAccount()} isDisabled={accountDeleting}>
                  <Icon icon={accountDeleting ? 'lucide:loader-circle' : 'lucide:trash-2'} className={accountDeleting ? 'animate-spin' : ''} />
                  删除配置
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

function WhatsAppAccountCard({
  account,
  agentOptions,
  draft,
  isDisabled,
  isSaving,
  onChange,
  onDelete,
  onEdit,
  onLogin,
  onLogout,
}: {
  account: OpenClawWhatsAppAccount
  agentOptions: AgentOption[]
  draft: WhatsAppAccountDraft
  isDisabled: boolean
  isSaving: boolean
  onChange: (patch: Partial<WhatsAppAccountDraft>) => void
  onDelete: (account: OpenClawWhatsAppAccount) => void
  onEdit: (account: OpenClawWhatsAppAccount) => void
  onLogin: (account: OpenClawWhatsAppAccount) => void
  onLogout: (account: OpenClawWhatsAppAccount) => void
}) {
  const selectedAgent = agentOptions.find((option) => option.value === draft.agentId) ?? agentOptions[0]
  return (
    <Card>
      <Card.Content>
        <div className="flex gap-4 items-center justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
              <Icon icon="simple-icons:whatsapp" className="size-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Card.Title className="text-base">{account.name || account.accountId}</Card.Title>
                <Chip color={account.linked ? 'success' : 'warning'} variant="soft">{account.linked ? '已登录' : '待扫码'}</Chip>
                <Chip color={draft.enabled ? 'success' : 'danger'} variant="soft">{draft.enabled ? '已启用' : '已停用'}</Chip>
              </div>
              <div className="mt-1 grid gap-1 text-xs text-muted">
                {account.selfPhone ? <InfoLine icon="lucide:phone" value={account.selfPhone} /> : null}
                {account.credsUpdatedAt ? <InfoLine icon="lucide:clock-3" value={formatAccountTime(account.credsUpdatedAt)} /> : null}
                <InfoLine icon="lucide:folder-key" mono value={account.authDir} />
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button isIconOnly size="sm" variant="tertiary" aria-label="编辑 WhatsApp 账号" onPress={() => onEdit(account)} isDisabled={isDisabled || isSaving}>
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
            <Button isIconOnly size="sm" variant="tertiary" aria-label="扫码登录 WhatsApp" onPress={() => onLogin(account)} isDisabled={isDisabled || isSaving}>
              <Icon icon="lucide:qr-code" className="size-4" />
            </Button>
            <Button isIconOnly size="sm" variant="tertiary" aria-label="登出 WhatsApp" onPress={() => onLogout(account)} isDisabled={isDisabled || isSaving || !account.linked}>
              <Icon icon="lucide:log-out" className="size-4" />
            </Button>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            <Switch size="lg" aria-label="启用 WhatsApp 账号" isSelected={draft.enabled} isDisabled={isDisabled || isSaving} onChange={(enabled) => onChange({ enabled })}>
              <Switch.Control><Switch.Thumb /></Switch.Control>
            </Switch>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            <Button isIconOnly size="sm" variant="tertiary" aria-label="删除 WhatsApp 账号配置" onPress={() => onDelete(account)} isDisabled={isDisabled || isSaving}>
              <Icon icon="lucide:trash-2" className="size-4" />
            </Button>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function WhatsAppAccountModal({
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
  form: WhatsAppForm
  isOpen: boolean
  isSubmitting: boolean
  mode: ModalMode
  onActiveSectionChange: (section: ModalSection) => void
  onFormChange: (form: WhatsAppForm) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
}) {
  const update = (patch: Partial<WhatsAppForm>) => onFormChange({ ...form, ...patch })
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="sm:max-w-[680px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-success/10 text-success">
              <Icon icon="simple-icons:whatsapp" className="size-5" />
            </Modal.Icon>
            <div>
              <Modal.Heading>{mode === 'edit' ? '编辑 WhatsApp 账号' : '添加 WhatsApp 账号'}</Modal.Heading>
              <p className="mt-1 text-sm text-muted">{mode === 'edit' ? '更新账号配置和访问策略。' : '写入账号配置后启动 WhatsApp Web QR 登录。'}</p>
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

              {activeSection === 'form' ? (
                <ItemCardGroup className="overflow-hidden">
                  <ItemCardGroup.Header>
                    <ItemCardGroup.Title>账号信息</ItemCardGroup.Title>
                    <ItemCardGroup.Description>账号 ID 默认使用 default；authDir 可绑定已有 WhatsApp Web 凭据目录。</ItemCardGroup.Description>
                  </ItemCardGroup.Header>
                  <FormItem description="用于列表和运维识别。" icon="lucide:badge" title="账号名称">
                    <ClearableInput value={form.name} disabled={isSubmitting} placeholder="工作号" onChange={(name) => update({ name })} />
                  </FormItem>
                  <FormItem description="OpenClaw account id。" icon="lucide:user-round" title="账号 ID">
                    <ClearableInput value={form.accountId} disabled={isSubmitting || mode === 'edit'} placeholder="default" onChange={(accountId) => update({ accountId })} />
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
                  <FormItem description="可选；例如 ~/.openclaw/credentials/whatsapp/work。" icon="lucide:folder-key" title="Auth Dir">
                    <ClearableInput value={form.authDir} disabled={isSubmitting} placeholder="留空使用默认路径" onChange={(authDir) => update({ authDir })} />
                  </FormItem>
                </ItemCardGroup>
              ) : (
                <div className="space-y-5">
                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>访问控制</ItemCardGroup.Title>
                      <ItemCardGroup.Description>DM 默认建议 pairing；群聊通常使用 allowlist。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem description="控制私聊接入。" icon="lucide:shield-check" title="DM 策略">
                      <FriendlySelect ariaLabel="DM 策略" isDisabled={isSubmitting} options={dmPolicyOptions} value={form.dmPolicy} onChange={(value) => update({ dmPolicy: String(value ?? 'pairing') })} />
                    </FormItem>
                    <FormItem description="控制群聊发送者准入。" icon="lucide:messages-square" title="群聊策略">
                      <FriendlySelect ariaLabel="群聊策略" isDisabled={isSubmitting} options={groupPolicyOptions} value={form.groupPolicy || 'inherit'} onChange={(value) => update({ groupPolicy: String(value ?? 'inherit') })} />
                    </FormItem>
                    <FormItem actionClassName="w-fit" description="个人号码 fallback 时打开。" icon="lucide:user-round-check" title="Self Chat">
                      <Switch size="lg" aria-label="启用 Self Chat 模式" isSelected={form.selfChatMode} isDisabled={isSubmitting} onChange={(selfChatMode) => update({ selfChatMode })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </FormItem>
                    <FormItem actionClassName="w-fit" description="默认开启，self-chat 会自动跳过。" icon="lucide:check-check" title="已读回执">
                      <Switch size="lg" aria-label="发送已读回执" isSelected={form.sendReadReceipts} isDisabled={isSubmitting} onChange={(sendReadReceipts) => update({ sendReadReceipts })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </FormItem>
                  </ItemCardGroup>
                  <TextareaCard description="支持逗号或换行分隔；使用 E.164 号码，如 +15551234567。" disabled={isSubmitting} icon="lucide:users" placeholder="+15551234567" title="DM 准入号码" value={form.allowFrom} onChange={(allowFrom) => update({ allowFrom })} />
                  <TextareaCard description="群聊 sender allowlist；留空时运行时可能回退到 allowFrom。" disabled={isSubmitting} icon="lucide:users-round" placeholder="+15551234567" title="群聊准入号码" value={form.groupAllowFrom} onChange={(groupAllowFrom) => update({ groupAllowFrom })} />
                </div>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={() => onOpenChange(false)}>取消</Button>
            <Button variant="primary" isPending={isSubmitting} onPress={onSubmit}>
              <Icon icon={mode === 'edit' ? 'lucide:save' : 'lucide:qr-code'} className="size-4" />
              {mode === 'edit' ? '保存修改' : '添加并扫码'}
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
        <textarea className="min-h-24 w-full rounded-2xl border border-divider bg-surface-secondary/50 px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent disabled:opacity-60" disabled={disabled} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
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
    <CellSelect aria-label={ariaLabel} className="w-auto" isDisabled={isDisabled} value={value} variant="secondary" onChange={onChange}>
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
            {item.loading ? <Skeleton className="size-2.5 rounded-full" /> : item.action ? item.action : <span className={`block size-2.5 shrink-0 rounded-full ${item.ok ? 'bg-success shadow-[0_0_12px_color-mix(in_oklch,var(--success)_80%,transparent)]' : 'bg-danger shadow-[0_0_12px_color-mix(in_oklch,var(--danger)_80%,transparent)]'}`} aria-label={item.ok ? '正常' : '异常'} />}
          </ItemCard.Action>
        </ItemCard>
      ))}
    </div>
  )
}

function InfoLine({ icon, mono, value }: { icon: string; mono?: boolean; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon icon={icon} className="size-3.5 shrink-0" />
      <span className={`min-w-0 break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
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
            正在执行。请在 WhatsApp 的「已关联设备」中完成配对，日志会继续同步状态。
          </div>
        ) : null}
        <pre ref={logRef} className="max-h-[32rem] overflow-auto rounded-xl bg-surface-secondary/50 p-4 font-mono text-[10px] leading-4 text-foreground whitespace-pre">
          {task.logs.join('\n')}
          {task.error ? `\n${task.error}` : ''}
        </pre>
      </Card.Content>
    </Card>
  )
}

function appendTaskLog(logs: string[], line: string) {
  const next = line.trim() ? [...logs, line] : logs
  return next.length > 300 ? next.slice(next.length - 300) : next
}

function buildAccountDrafts(accounts: OpenClawWhatsAppAccount[]) {
  return accounts.reduce<Record<string, WhatsAppAccountDraft>>((drafts, account) => {
    drafts[account.accountId] = getAccountDraft({}, account.accountId, account)
    return drafts
  }, {})
}

function getAccountDraft(drafts: Record<string, WhatsAppAccountDraft>, accountId: string, account?: OpenClawWhatsAppAccount): WhatsAppAccountDraft {
  return drafts[accountId] ?? {
    agentId: account?.agentId ?? '',
    enabled: account?.enabled !== false,
  }
}

function buildFormFromAccount(account: OpenClawWhatsAppAccount, status: OpenClawWhatsAppStatusResponse | null): WhatsAppForm {
  return {
    accountId: account.accountId,
    agentId: account.agentId ?? '',
    allowFrom: (account.allowFrom ?? []).join('\n'),
    authDir: account.authDirConfigured ? account.authDir : '',
    dmPolicy: account.dmPolicy || status?.config.dmPolicy || 'pairing',
    groupAllowFrom: (account.groupAllowFrom ?? []).join('\n'),
    groupPolicy: account.groupPolicy || status?.config.groupPolicy || 'inherit',
    name: account.name || '',
    selfChatMode: account.selfChatMode,
    sendReadReceipts: account.sendReadReceipts,
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

function formatAccountTime(value: string) {
  const date = new Date(value)
  const timestamp = date.getTime()
  if (Number.isNaN(timestamp)) return value
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (diffSeconds < 60) return '刚刚'
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} 小时前`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays} 天前`
  return date.toLocaleDateString('zh-CN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function taskTitle(kind: TaskKind | null) {
  switch (kind) {
    case 'add':
      return '添加 WhatsApp 账号'
    case 'login':
      return '扫码登录 WhatsApp'
    case 'logout':
      return '登出 WhatsApp'
    case 'uninstall':
      return '卸载 WhatsApp 插件'
    default:
      return 'WhatsApp 渠道任务'
  }
}

function taskDoneMessage(kind: TaskKind | null) {
  switch (kind) {
    case 'add':
      return 'WhatsApp 账号已添加'
    case 'login':
      return 'WhatsApp 扫码登录完成'
    case 'logout':
      return 'WhatsApp 账号已登出'
    case 'uninstall':
      return 'WhatsApp 插件卸载完成'
    default:
      return 'WhatsApp 渠道任务完成'
  }
}

function OpenClawWhatsAppPage() {
  usePageTitle('OpenClaw WhatsApp 渠道')
  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <OpenClawWhatsAppPanel />
      </div>
    </DashboardLayout>
  )
}

export default OpenClawWhatsAppPage
