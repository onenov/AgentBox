import type { ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Key } from '@heroui/react'
import { AlertDialog, Alert, Button, Card, Chip, Dropdown, InputGroup, ListBox, Modal, Separator, Skeleton, Switch, toast } from '@heroui/react'
import { CellSelect, ItemCard, ItemCardGroup, Segment } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type {
  OpenClawAgentSummary,
  OpenClawChannelStreamError,
  OpenClawChannelStreamLog,
  OpenClawChannelStreamMeta,
  OpenClawChannelStreamStatus,
  OpenClawChannelTaskResponse,
  OpenClawYuanbaoAccount,
  OpenClawYuanbaoStatusResponse,
} from '@/api'
import {
  deleteOpenClawYuanbaoAccount,
  getOpenClawYuanbaoAddAccountStreamURL,
  getOpenClawYuanbaoInstallStreamURL,
  getOpenClawYuanbaoStatus,
  getOpenClawYuanbaoUninstallStreamURL,
  listOpenClawAgents,
  updateOpenClawYuanbaoAccountConfig,
  updateOpenClawYuanbaoConfig,
} from '@/api'
import { openExternalUrl } from '@/utils/openExternalUrl'

type LoadState = 'error' | 'idle' | 'loading' | 'ready'
type YuanbaoTaskKind = 'add' | 'install' | 'uninstall'
type AccountModalMode = 'create' | 'edit'
type YuanbaoFormSection = 'form' | 'help'

type YuanbaoAccountDraft = {
  agentId: string
  enabled: boolean
}

type YuanbaoForm = {
  accountId: string
  agentId: string
  appId: string
  appSecret: string
  name: string
  systemPrompt: string
}

type AgentOption = {
  id: string
  label: string
  value: string
}

const formTabs: Array<{ icon: string; id: YuanbaoFormSection; label: string }> = [
  { icon: 'lucide:bot', id: 'form', label: '账号信息' },
  { icon: 'lucide:circle-help', id: 'help', label: '接入流程' },
]

const defaultForm: YuanbaoForm = {
  accountId: 'default',
  agentId: '',
  appId: '',
  appSecret: '',
  name: '',
  systemPrompt: '',
}

const yuanbaoHelpSteps: Array<{ content: ReactNode; step: string; title: string }> = [
  { step: '1', title: '安装插件', content: '在已部署 OpenClaw 的设备上安装 openclaw-plugin-yuanbao@latest。' },
  { step: '2', title: '复制凭据', content: '在元宝 App「关联已有 OpenClaw」面板中选择「方式2：通道配置」，复制 AppID 和 AppSecret。' },
  { step: '3', title: '添加账号', content: '填写账号 ID、凭据和要绑定的 Agent，提交后会执行 channels add 并重启 Gateway。' },
  { step: '4', title: '邀请入派', content: '关联成功后邀请元宝 Bot 加入元宝派，群成员 @元宝Bot 即可触发 AI 回复。' },
]

export function OpenClawYuanbaoBotPanel() {
  const [state, setState] = useState<LoadState>('idle')
  const [status, setStatus] = useState<OpenClawYuanbaoStatusResponse | null>(null)
  const [accountDrafts, setAccountDrafts] = useState<Record<string, YuanbaoAccountDraft>>({})
  const [agents, setAgents] = useState<OpenClawAgentSummary[]>([])
  const [error, setError] = useState('')
  const [savingAccountId, setSavingAccountId] = useState('')
  const [savingChannelEnabled, setSavingChannelEnabled] = useState(false)
  const [task, setTask] = useState<OpenClawChannelTaskResponse | null>(null)
  const [taskKind, setTaskKind] = useState<YuanbaoTaskKind | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<AccountModalMode>('create')
  const [activeSection, setActiveSection] = useState<YuanbaoFormSection>('form')
  const [form, setForm] = useState<YuanbaoForm>(defaultForm)
  const [accountEditTarget, setAccountEditTarget] = useState<OpenClawYuanbaoAccount | null>(null)
  const [accountDeleteTarget, setAccountDeleteTarget] = useState<OpenClawYuanbaoAccount | null>(null)
  const [accountDeleting, setAccountDeleting] = useState(false)
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const logRef = useRef<HTMLPreElement | null>(null)
  const sourceRef = useRef<EventSource | null>(null)
  const streamFinishedRef = useRef(false)

  const loadStatus = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const [nextStatus, nextAgents] = await Promise.all([getOpenClawYuanbaoStatus(), listOpenClawAgents()])
      setStatus(nextStatus)
      setAgents(nextAgents.agents ?? [])
      setAccountDrafts(buildYuanbaoAccountDrafts(nextStatus.accounts ?? []))
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : '元宝 Bot 渠道状态加载失败')
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
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [task?.logs])

  const closeStream = useCallback(() => {
    sourceRef.current?.close()
    sourceRef.current = null
  }, [])

  const startStream = useCallback((kind: YuanbaoTaskKind, url: string) => {
    closeStream()
    streamFinishedRef.current = false
    setTaskKind(kind)
    const now = new Date().toISOString()
    setTask({ id: `${kind}-${Date.now()}`, logs: ['正在连接流式任务。'], progress: 0, startedAt: now, status: 'pending', updatedAt: now })

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
        setTask((current) => current ? { ...current, error: payload.error || current.error, id: payload.id || current.id, progress: payload.progress, status: payload.status, updatedAt: payload.timestamp } : current)
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
        setTask((current) => current ? { ...current, id: payload.id || current.id, logs: appendTaskLog(current.logs, maskYuanbaoSecret(payload.line)), updatedAt: payload.timestamp } : current)
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
        setTask((current) => current ? { ...current, error: payload.message, id: payload.id || current.id, logs: appendTaskLog(current.logs, `失败：${payload.message}`), progress: 100, status: 'error', updatedAt: payload.timestamp } : current)
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
      setTask((current) => current ? { ...current, error: '流式连接中断', logs: appendTaskLog(current.logs, '失败：流式连接中断'), progress: 100, status: 'error', updatedAt: timestamp } : current)
      toast.warning('元宝 Bot 渠道流式任务连接中断')
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

  const openEditModal = useCallback((account: OpenClawYuanbaoAccount) => {
    setModalMode('edit')
    setAccountEditTarget(account)
    setForm(buildYuanbaoFormFromAccount(account))
    setActiveSection('form')
    setIsModalOpen(true)
  }, [])

  const submitModal = useCallback(async () => {
    if (modalMode === 'create') {
      if (!form.appId.trim() || !form.appSecret.trim()) {
        toast.warning('请输入 AppID 和 AppSecret')
        return
      }
      setIsModalOpen(false)
      startStream('add', getOpenClawYuanbaoAddAccountStreamURL(form))
      setForm(defaultForm)
      setActiveSection('form')
      return
    }
    if (!accountEditTarget) return
    setSavingAccountId(accountEditTarget.accountId)
    try {
      const nextStatus = await updateOpenClawYuanbaoAccountConfig(accountEditTarget.accountId, buildYuanbaoAccountUpdateRequest(form))
      setStatus(nextStatus)
      setAccountDrafts(buildYuanbaoAccountDrafts(nextStatus.accounts ?? []))
      setIsModalOpen(false)
      setAccountEditTarget(null)
      toast.success('元宝 Bot 账号已更新')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '元宝 Bot 账号更新失败')
    } finally {
      setSavingAccountId('')
    }
  }, [accountEditTarget, form, modalMode, startStream])

  const updateChannelEnabled = useCallback(async (enabled: boolean) => {
    setSavingChannelEnabled(true)
    setStatus((current) => current ? { ...current, enabled, config: { ...current.config, enabled } } : current)
    try {
      const nextStatus = await updateOpenClawYuanbaoConfig({ enabled })
      setStatus(nextStatus)
      setAccountDrafts(buildYuanbaoAccountDrafts(nextStatus.accounts ?? []))
      toast.success(enabled ? '元宝 Bot 渠道已启用' : '元宝 Bot 渠道已停用')
    } catch (err) {
      void loadStatus()
      toast.warning(err instanceof Error ? err.message : '元宝 Bot 渠道开关更新失败')
    } finally {
      setSavingChannelEnabled(false)
    }
  }, [loadStatus])

  const updateAccount = useCallback(async (account: OpenClawYuanbaoAccount, patch: Partial<YuanbaoAccountDraft>) => {
    const draft = { ...getYuanbaoAccountDraft(accountDrafts, account.accountId, account), ...patch }
    setAccountDrafts((current) => ({ ...current, [account.accountId]: draft }))
    setSavingAccountId(account.accountId)
    try {
      const nextStatus = await updateOpenClawYuanbaoAccountConfig(account.accountId, { agentId: draft.agentId, enabled: draft.enabled })
      setStatus(nextStatus)
      setAccountDrafts(buildYuanbaoAccountDrafts(nextStatus.accounts ?? []))
      toast.success('元宝 Bot 账号配置已更新')
    } catch (err) {
      setAccountDrafts(buildYuanbaoAccountDrafts(status?.accounts ?? []))
      toast.warning(err instanceof Error ? err.message : '元宝 Bot 账号配置更新失败')
    } finally {
      setSavingAccountId('')
    }
  }, [accountDrafts, status?.accounts])

  const deleteAccount = useCallback(async () => {
    if (!accountDeleteTarget) return
    setAccountDeleting(true)
    try {
      await deleteOpenClawYuanbaoAccount(accountDeleteTarget.accountId)
      setAccountDeleteTarget(null)
      toast.success('元宝 Bot 账号已删除')
      void loadStatus()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '元宝 Bot 账号删除失败')
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
  const installed = Boolean(status?.installed)
  const canUninstall = Boolean(status?.installed || status?.configured)

  return (
    <>
      {error ? (
        <div className="w-full py-3">
          <Alert status="danger" className="items-center">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>元宝 Bot 渠道状态加载失败</Alert.Title>
              <Alert.Description>请检查元宝 Bot 渠道配置和网关运行状态。</Alert.Description>
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
                  <Icon icon="lucide:bot-message-square" className="size-7" />
                </div>
                <div className="min-w-0">
                  <Card.Title>元宝 Bot</Card.Title>
                  <Card.Description>通过 openclaw-plugin-yuanbao 接入元宝派，支持 @Bot 群聊互动、长期记忆、联网搜索与 7×24 在线服务。</Card.Description>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {state !== 'loading' && !isTaskRunning ? (
                  <Button size="sm" isIconOnly variant={state === 'error' ? 'primary' : 'ghost'} aria-label="刷新元宝 Bot 渠道状态" onPress={() => void loadStatus()}>
                    <Icon icon="lucide:refresh-cw" />
                  </Button>
                ) : null}
                {installed ? (
                  <>
                    <Button size="sm" variant="tertiary" isDisabled={!canUninstall || isTaskRunning || isLoading} onPress={() => setUninstallOpen(true)}>
                      <Icon icon="lucide:trash-2" />
                      卸载
                    </Button>
                    <Button size="sm" variant="primary" isDisabled={isTaskRunning} onPress={openAddModal}>
                      <Icon icon="lucide:plus" />
                      添加账号
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="primary" isDisabled={isTaskRunning || isLoading} onPress={() => startStream('install', getOpenClawYuanbaoInstallStreamURL())}>
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
            { description: status?.installed ? '元宝插件已安装' : '请先安装插件', icon: 'lucide:package-check', loading: isLoading, ok: installed, title: '插件状态' },
            { description: configured ? `${accounts.length} 个账号` : '等待配置 AppID 和 AppSecret', icon: 'lucide:key-round', loading: isLoading, ok: configured, title: '配置状态' },
            { description: enabled ? '元宝 Bot 渠道已启用' : '元宝 Bot 渠道已停用', icon: 'lucide:radio', loading: isLoading, ok: enabled, title: '运行状态' },
            {
              action: (
                <Switch size="lg" aria-label="切换元宝 Bot 渠道总开关" isSelected={enabled} isDisabled={!configured || isTaskRunning || isLoading || savingChannelEnabled} onChange={(nextEnabled) => void updateChannelEnabled(nextEnabled)}>
                  <Switch.Control><Switch.Thumb /></Switch.Control>
                </Switch>
              ),
              description: enabled ? '元宝 Bot 渠道已启用' : '元宝 Bot 渠道已停用',
              icon: 'lucide:power',
              loading: isLoading,
              ok: enabled,
              title: '启用状态',
            },
          ]}
        />

        {installed ? (
          accounts.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {accounts.map((account) => (
                <YuanbaoAccountCard
                  key={account.accountId}
                  account={account}
                  agentOptions={agentOptions}
                  draft={getYuanbaoAccountDraft(accountDrafts, account.accountId, account)}
                  isDisabled={isLoading || isTaskRunning}
                  isSaving={savingAccountId === account.accountId}
                  onChange={(patch) => void updateAccount(account, patch)}
                  onDelete={setAccountDeleteTarget}
                  onEdit={openEditModal}
                />
              ))}
            </div>
          ) : (
            <ChannelEmptyState description="添加一个元宝 Bot 账号后，就可以配置路由 Agent、启用状态和关联凭据。" icon="lucide:bot-message-square" title="还没有元宝 Bot 账号" />
          )
        ) : (
          <ChannelEmptyState description="安装元宝龙虾插件后，可以在这里添加账号并关联已有 OpenClaw。" icon="lucide:package-x" title="元宝插件未安装" />
        )}

        {status?.error ? <div className="rounded-xl bg-warning/10 p-3 text-sm leading-6 text-warning">{status.error}</div> : null}

        <TaskLogPanel task={task} taskKind={taskKind} logRef={logRef} onClose={() => setTask(null)} />

        <YuanbaoAccountModal
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
                <AlertDialog.Heading>卸载元宝插件？</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-sm leading-6 text-muted">将卸载 openclaw-plugin-yuanbao，并清理元宝渠道配置、账号和 Agent 绑定。</p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary">取消</Button>
                <Button variant="danger" onPress={() => { setUninstallOpen(false); startStream('uninstall', getOpenClawYuanbaoUninstallStreamURL()) }} isDisabled={isTaskRunning}>
                  <Icon icon="lucide:trash-2" />
                  卸载
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>

        <AlertDialog.Backdrop isOpen={Boolean(accountDeleteTarget)} onOpenChange={(open) => { if (!open && !accountDeleting) setAccountDeleteTarget(null) }}>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-[480px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>删除元宝 Bot 账号？</AlertDialog.Heading>
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

function ChannelEmptyState({ description, icon, title }: { description: string; icon: string; title: string }) {
  return (
    <Card>
      <Card.Content>
        <div className="flex flex-col items-center px-6 py-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-surface-secondary/50 text-muted">
            <Icon icon={icon} className="size-7" />
          </div>
          <Card.Title className="mt-4 text-lg">{title}</Card.Title>
          <Card.Description className="mt-2 max-w-xl leading-6">{description}</Card.Description>
        </div>
      </Card.Content>
    </Card>
  )
}

function YuanbaoAccountCard({ account, agentOptions, draft, isDisabled, isSaving, onChange, onDelete, onEdit }: { account: OpenClawYuanbaoAccount; agentOptions: AgentOption[]; draft: YuanbaoAccountDraft; isDisabled: boolean; isSaving: boolean; onChange: (patch: Partial<YuanbaoAccountDraft>) => void; onDelete: (account: OpenClawYuanbaoAccount) => void; onEdit: (account: OpenClawYuanbaoAccount) => void }) {
  const selectedAgent = agentOptions.find((option) => option.value === draft.agentId) ?? agentOptions[0]
  return (
    <Card>
      <Card.Content>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className={`flex size-11 shrink-0 items-center justify-center rounded-full ${draft.enabled ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`} aria-label={draft.enabled ? '已启用' : '已停用'}>
              <Icon icon="lucide:bot-message-square" className="size-6" />
            </div>
            <div className="min-w-0">
              <Card.Title className="text-base">{account.name || account.accountId}</Card.Title>
              <Card.Description className="mt-1">
                {account.appIdConfigured && account.appSecretConfigured ? 'AppID/AppSecret 已配置' : '凭据未完整配置'}
              </Card.Description>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Dropdown>
              <Button size="sm" variant="tertiary" aria-label="选择绑定 Agent" isDisabled={isDisabled || isSaving}>
                <Icon icon={isSaving ? 'lucide:loader-circle' : 'lucide:bot'} className={`size-4 ${isSaving ? 'animate-spin' : ''}`} />
                {selectedAgent?.label || '未绑定'}
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu selectedKeys={new Set([selectedAgent?.id ?? 'unbound'])} selectionMode="single" onAction={(key) => {
                  const option = agentOptions.find((item) => item.id === String(key))
                  onChange({ agentId: option?.value ?? '' })
                }}>
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
            <Switch size="lg" className="flex p-1 bg-default rounded-full" aria-label="启用元宝 Bot 账号" isSelected={draft.enabled} isDisabled={isDisabled || isSaving} onChange={(enabled) => onChange({ enabled })}>
              <Switch.Control><Switch.Thumb /></Switch.Control>
            </Switch>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            <Button isIconOnly size="sm" variant="tertiary" aria-label="编辑元宝 Bot 账号" onPress={() => onEdit(account)} isDisabled={isDisabled || isSaving}>
              <Icon icon="lucide:pencil" className="size-4" />
            </Button>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            <Button isIconOnly size="sm" variant="tertiary" aria-label="删除元宝 Bot 账号" onPress={() => onDelete(account)} isDisabled={isDisabled || isSaving}>
              <Icon icon="lucide:trash-2" className="size-4" />
            </Button>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function YuanbaoAccountModal({ activeSection, agentOptions, form, isOpen, isSubmitting, mode, onActiveSectionChange, onFormChange, onOpenChange, onSubmit }: { activeSection: YuanbaoFormSection; agentOptions: AgentOption[]; form: YuanbaoForm; isOpen: boolean; isSubmitting: boolean; mode: AccountModalMode; onActiveSectionChange: (section: YuanbaoFormSection) => void; onFormChange: (form: YuanbaoForm) => void; onOpenChange: (open: boolean) => void; onSubmit: () => void }) {
  const update = (patch: Partial<YuanbaoForm>) => onFormChange({ ...form, ...patch })
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="sm:max-w-[680px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
              <Icon icon="lucide:bot-message-square" className="size-5" />
            </Modal.Icon>
            <div>
              <Modal.Heading>{mode === 'edit' ? '编辑元宝 Bot 账号' : '添加元宝 Bot 账号'}</Modal.Heading>
              <p className="mt-1 text-sm text-muted">{mode === 'edit' ? '更新账号名称、凭据和 Agent 绑定。' : '填写元宝 AppID 和 AppSecret。'}</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="space-y-5 p-1">
              <Segment selectedKey={activeSection} onSelectionChange={(key) => onActiveSectionChange(String(key) as YuanbaoFormSection)}>
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
                  {yuanbaoHelpSteps.map((item) => (
                    <div key={item.step} className="flex items-start gap-3 rounded-xl bg-surface-secondary/50 p-3 text-sm text-foreground">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{item.step}</span>
                      <span className="leading-6"><span className="font-medium">{item.title}：</span>{item.content}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="max-h-[500px] space-y-5 overflow-y-auto">
                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>账号信息</ItemCardGroup.Title>
                      <ItemCardGroup.Description>{mode === 'edit' ? '编辑账号名称与基础凭据。' : '填写方式 2 通道配置中的 AppID 与 AppSecret。'}</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem description="填写一个可识别的名称。" icon="lucide:badge" title="账号名称">
                      <ClearableInput value={form.name} disabled={isSubmitting} placeholder="显示名称" onChange={(name) => update({ name })} />
                    </FormItem>
                    <Separator />
                    <FormItem description="OpenClaw 账号 ID。" icon="lucide:user-round" title="账号 ID">
                      <ClearableInput value={form.accountId} disabled={isSubmitting || mode === 'edit'} placeholder="default" onChange={(accountId) => update({ accountId })} />
                    </FormItem>
                    <Separator />
                    <FormItem description={mode === 'edit' ? '留空保持当前 AppID 不变。' : '元宝通道配置中的 AppID。'} icon="lucide:key-round" title="AppID">
                      <ClearableInput value={form.appId} disabled={isSubmitting} placeholder="AppID" onChange={(appId) => update({ appId })} />
                    </FormItem>
                    <Separator />
                    <FormItem description={mode === 'edit' ? '留空保持当前 AppSecret 不变。' : '元宝通道配置中的 AppSecret。'} icon="lucide:lock-keyhole" title="AppSecret">
                      <ClearableInput value={form.appSecret} disabled={isSubmitting} placeholder="AppSecret" onChange={(appSecret) => update({ appSecret })} />
                    </FormItem>
                    <Separator />
                    <FormItem description="默认绑定给哪个智能体。" icon="lucide:bot" title="智能体">
                      <FriendlySelect ariaLabel="绑定 Agent" isDisabled={isSubmitting} options={agentOptions} value={agentOptions.find((option) => option.value === form.agentId)?.id ?? 'unbound'} onChange={(value) => {
                        const option = agentOptions.find((item) => item.id === String(value))
                        update({ agentId: option?.value ?? '' })
                      }} />
                    </FormItem>
                  </ItemCardGroup>

                  <TextareaCard
                    description="账号级提示词，会写入 channels.yuanbao.accounts.*.systemPrompt。"
                    disabled={isSubmitting}
                    icon="lucide:message-square-text"
                    placeholder="Keep answers brief."
                    title="System Prompt"
                    value={form.systemPrompt}
                    onChange={(systemPrompt) => update({ systemPrompt })}
                  />
                </div>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={() => onOpenChange(false)}>取消</Button>
            <Button variant="tertiary" onPress={() => void openExternalUrl('https://yuanbao.tencent.com')}>
              <Icon icon="lucide:external-link" className="size-4" />
              打开元宝
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
          <ItemCard.Icon><Icon icon={item.icon} className="text-muted" /></ItemCard.Icon>
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

function TaskLogPanel({ logRef, onClose, task, taskKind }: { logRef: RefObject<HTMLPreElement | null>; onClose: () => void; task: OpenClawChannelTaskResponse | null; taskKind: YuanbaoTaskKind | null }) {
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
            <Button isIconOnly variant="ghost" aria-label="复制日志" onPress={() => void copyLogs()}><Icon icon="lucide:copy" className="size-4" /></Button>
            <Button isIconOnly variant="ghost" aria-label="关闭日志卡片" onPress={onClose}><Icon icon="lucide:x" className="size-4" /></Button>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        <div className="mb-3 h-2 overflow-hidden rounded-full bg-surface-secondary/50">
          <div className={`h-full rounded-full ${task.status === 'error' ? 'bg-danger' : 'bg-success'}`} style={{ width: `${Math.max(3, task.progress)}%` }} />
        </div>
        {isRunning ? <div className="mb-3 flex items-center gap-2 text-sm text-muted"><Icon icon="lucide:loader-circle" className="size-4 animate-spin" />正在执行，日志会实时显示。</div> : null}
        <pre ref={logRef} className="max-h-96 overflow-auto rounded-xl bg-surface-secondary/50 p-4 font-mono text-xs leading-5 text-foreground whitespace-pre-wrap">
          {task.logs.join('\n')}
          {task.error ? `\n${task.error}` : ''}
        </pre>
      </Card.Content>
    </Card>
  )
}

function taskTitle(kind: YuanbaoTaskKind | null) {
  switch (kind) {
    case 'add': return '添加元宝 Bot 账号'
    case 'install': return '安装元宝插件'
    case 'uninstall': return '卸载元宝插件'
    default: return '元宝 Bot 渠道任务'
  }
}

function taskDoneMessage(kind: YuanbaoTaskKind | null) {
  switch (kind) {
    case 'add': return '元宝 Bot 账号已添加'
    case 'install': return '元宝插件已安装'
    case 'uninstall': return '元宝插件已卸载'
    default: return '元宝 Bot 渠道任务已完成'
  }
}

function buildYuanbaoAccountDrafts(accounts: OpenClawYuanbaoAccount[]) {
  return accounts.reduce<Record<string, YuanbaoAccountDraft>>((drafts, account) => {
    drafts[account.accountId] = getYuanbaoAccountDraft({}, account.accountId, account)
    return drafts
  }, {})
}

function buildYuanbaoFormFromAccount(account: OpenClawYuanbaoAccount): YuanbaoForm {
  return {
    accountId: account.accountId,
    agentId: account.agentId ?? '',
    appId: '',
    appSecret: '',
    name: account.name || '',
    systemPrompt: account.systemPrompt || '',
  }
}

function buildYuanbaoAccountUpdateRequest(form: YuanbaoForm) {
  return {
    agentId: form.agentId,
    appId: form.appId,
    appSecret: form.appSecret,
    name: form.name,
    systemPrompt: form.systemPrompt,
  }
}

function getYuanbaoAccountDraft(drafts: Record<string, YuanbaoAccountDraft>, accountId: string, account: OpenClawYuanbaoAccount): YuanbaoAccountDraft {
  return drafts[accountId] ?? { agentId: account.agentId ?? '', enabled: account.enabled }
}

function buildAgentOptions(agents: OpenClawAgentSummary[]): AgentOption[] {
  return [
    { id: 'unbound', label: '未绑定', value: '' },
    ...agents.map((agent) => ({ id: agent.id, label: agent.name || agent.id, value: agent.id })),
  ]
}

function appendTaskLog(logs: string[], line: string) {
  const value = line.trimEnd()
  if (!value) return logs
  return [...logs, value].slice(-400)
}

function maskYuanbaoSecret(line: string) {
  return line
    .replace(/(--token\s+)(\S+)/gi, '$1******')
    .replace(/(appSecret[=:]\s*)(\S+)/gi, '$1******')
}
