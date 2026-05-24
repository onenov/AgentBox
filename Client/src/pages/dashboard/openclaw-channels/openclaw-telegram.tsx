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
  OpenClawTelegramAccount,
  OpenClawTelegramConfig,
  OpenClawTelegramConfigUpdateRequest,
  OpenClawTelegramStatusResponse,
} from '@/api'
import {
  deleteOpenClawTelegramAccount,
  getOpenClawTelegramAddAccountStreamURL,
  getOpenClawTelegramStatus,
  listOpenClawAgents,
  updateOpenClawTelegramAccountConfig,
  updateOpenClawTelegramConfig,
  validateOpenClawTelegramCredential,
} from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { OpenClawPairingModal } from './openclaw-pairing'

type LoadState = 'error' | 'idle' | 'loading' | 'ready'
type TelegramTaskKind = 'add'
type AccountModalMode = 'create' | 'edit'
type AddFormSection = 'advanced' | 'form' | 'help'

type TelegramAccountDraft = {
  agentId: string
  enabled: boolean
}

type TelegramAddForm = {
  actionDeleteMessage: boolean
  actionEditMessage: boolean
  actionReactions: boolean
  actionSendMessage: boolean
  actionSticker: boolean
  accountId: string
  agentId: string
  allowFrom: string
  botToken: string
  commandsNative: string
  commandsNativeSkills: string
  customCommands: string
  dmPolicy: string
  execApprovalsApprovers: string
  execApprovalsEnabled: string
  execApprovalsTarget: string
  groupPolicy: string
  inlineButtons: string
  name: string
  streamingBlock: boolean
  streamingMode: string
  streamingPreviewCommandText: string
  streamingPreviewToolProgress: boolean
  streamingProgressCommandText: string
  streamingProgressToolProgress: boolean
  webhookHost: string
  webhookPath: string
  webhookSecret: string
  webhookUrl: string
  requireMention: boolean
}

type TelegramCredentialCheck = {
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

const addFormTabs: Array<{ icon: string; id: AddFormSection; label: string }> = [
  { icon: 'lucide:user-round-cog', id: 'form', label: '账号信息' },
  { icon: 'lucide:circle-help', id: 'help', label: '帮助流程' },
]

const editFormTabs: Array<{ icon: string; id: AddFormSection; label: string }> = [
  { icon: 'lucide:user-round-cog', id: 'form', label: '基本信息' },
  { icon: 'lucide:sliders-horizontal', id: 'advanced', label: '高级设置' },
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
  { id: 'disabled', label: '禁用群聊' },
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
  { id: 'channel', label: '原聊天审批' },
  { id: 'both', label: '同时发送' },
]

const streamingModeOptions = [
  { id: 'off', label: '关闭' },
  { id: 'partial', label: '回答预览' },
  { id: 'block', label: '块级预览' },
  { id: 'progress', label: '进度模式' },
]

const commandTextOptions = [
  { id: 'raw', label: '显示原始命令' },
  { id: 'status', label: '仅显示状态' },
]

const inlineButtonOptions = [
  { id: 'inherit', label: '继承默认' },
  { id: 'off', label: '关闭' },
  { id: 'dm', label: '仅私聊' },
  { id: 'group', label: '仅群聊' },
  { id: 'all', label: '全部允许' },
  { id: 'allowlist', label: '按白名单' },
]

const telegramHelpSteps: Array<{ content: ReactNode; step: string }> = [
  {
    step: '1',
    content: (
      <>
        在 Telegram 里打开{' '}
        <Link href="https://t.me/BotFather" target="_blank" rel="noreferrer">
          @BotFather
          <Link.Icon />
        </Link>
        ，使用 /newbot 创建机器人。
      </>
    ),
  },
  { step: '2', content: '复制 BotFather 返回的 token，粘贴到账号信息里。' },
  { step: '3', content: '保持 DM 策略为 pairing，启动网关后用 pairing 命令批准首个私聊。' },
  { step: '4', content: '群聊接入时先把机器人加入群，默认要求 @ 机器人后触发。' },
]

const defaultAddForm: TelegramAddForm = {
  actionDeleteMessage: false,
  actionEditMessage: true,
  actionReactions: true,
  actionSendMessage: true,
  actionSticker: false,
  accountId: 'default',
  agentId: '',
  allowFrom: '',
  botToken: '',
  commandsNative: 'auto',
  commandsNativeSkills: 'auto',
  customCommands: '',
  dmPolicy: 'pairing',
  execApprovalsApprovers: '',
  execApprovalsEnabled: 'inherit',
  execApprovalsTarget: 'dm',
  groupPolicy: '',
  inlineButtons: 'allowlist',
  name: '',
  requireMention: true,
  streamingBlock: false,
  streamingMode: 'partial',
  streamingPreviewCommandText: 'raw',
  streamingPreviewToolProgress: true,
  streamingProgressCommandText: 'raw',
  streamingProgressToolProgress: true,
  webhookHost: '',
  webhookPath: '',
  webhookSecret: '',
  webhookUrl: '',
}

export function OpenClawTelegramPanel() {
  const [state, setState] = useState<LoadState>('idle')
  const [status, setStatus] = useState<OpenClawTelegramStatusResponse | null>(null)
  const [accountDrafts, setAccountDrafts] = useState<Record<string, TelegramAccountDraft>>({})
  const [agents, setAgents] = useState<OpenClawAgentSummary[]>([])
  const [error, setError] = useState('')
  const [savingAccountId, setSavingAccountId] = useState('')
  const [savingChannelEnabled, setSavingChannelEnabled] = useState(false)
  const [savingChannelDMPolicy, setSavingChannelDMPolicy] = useState(false)
  const [task, setTask] = useState<OpenClawChannelTaskResponse | null>(null)
  const [taskKind, setTaskKind] = useState<TelegramTaskKind | null>(null)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [accountModalMode, setAccountModalMode] = useState<AccountModalMode>('create')
  const [isPairingOpen, setIsPairingOpen] = useState(false)
  const [activeAddSection, setActiveAddSection] = useState<AddFormSection>('form')
  const [addForm, setAddForm] = useState<TelegramAddForm>(defaultAddForm)
  const [accountEditTarget, setAccountEditTarget] = useState<OpenClawTelegramAccount | null>(null)
  const [accountDeleteTarget, setAccountDeleteTarget] = useState<OpenClawTelegramAccount | null>(null)
  const [accountDeleting, setAccountDeleting] = useState(false)
  const logRef = useRef<HTMLPreElement | null>(null)
  const sourceRef = useRef<EventSource | null>(null)
  const streamFinishedRef = useRef(false)

  const loadStatus = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const [nextStatus, nextAgents] = await Promise.all([getOpenClawTelegramStatus(), listOpenClawAgents()])
      setStatus(nextStatus)
      setAgents(nextAgents.agents ?? [])
      setAccountDrafts(buildTelegramAccountDrafts(nextStatus.accounts ?? []))
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Telegram 渠道状态加载失败')
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

  const startStream = useCallback((kind: TelegramTaskKind, url: string) => {
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
          toast.success('Telegram 账号已添加')
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
          logs: appendTaskLog(current.logs, maskTelegramToken(payload.line)),
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
      toast.warning('Telegram 渠道流式任务连接中断')
      void loadStatus()
    }
  }, [closeStream, loadStatus])

  const submitEditAccount = useCallback(async () => {
    if (!accountEditTarget) return
    if (addForm.dmPolicy === 'allowlist' && !addForm.allowFrom.trim()) {
      toast.warning('Allowlist 策略需要填写准入用户')
      return
    }
    setSavingAccountId(accountEditTarget.accountId)
    try {
      await updateOpenClawTelegramConfig(buildTelegramAdvancedConfigRequest(addForm))
      const nextStatus = await updateOpenClawTelegramAccountConfig(accountEditTarget.accountId, {
        actions: {
          deleteMessage: addForm.actionDeleteMessage,
          editMessage: addForm.actionEditMessage,
          reactions: addForm.actionReactions,
          sendMessage: addForm.actionSendMessage,
          sticker: addForm.actionSticker,
        },
        allowFrom: splitTelegramAccountFormList(addForm.allowFrom),
        capabilities: {
          inlineButtons: addForm.inlineButtons === 'inherit' ? '' : addForm.inlineButtons,
        },
        dmPolicy: addForm.dmPolicy,
        execApprovals: {
          approvers: splitTelegramAccountFormList(addForm.execApprovalsApprovers),
          enabled: addForm.execApprovalsEnabled,
          target: addForm.execApprovalsTarget === 'inherit' ? '' : addForm.execApprovalsTarget,
        },
        groupPolicy: addForm.groupPolicy,
        name: addForm.name.trim(),
        requireMention: addForm.requireMention,
        ...(addForm.botToken.trim() ? { botToken: addForm.botToken.trim() } : {}),
      })
      setStatus(nextStatus)
      setAccountDrafts(buildTelegramAccountDrafts(nextStatus.accounts ?? []))
      setAddForm(buildTelegramAccountFormFromAccount((nextStatus.accounts ?? []).find((item) => item.accountId === accountEditTarget.accountId) ?? accountEditTarget, nextStatus.config))
      setIsAddOpen(false)
      setAccountEditTarget(null)
      toast.success('Telegram 账号已更新')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'Telegram 账号更新失败')
    } finally {
      setSavingAccountId('')
    }
  }, [accountEditTarget, addForm])

  const submitAddAccount = useCallback(() => {
    if (accountModalMode === 'edit') {
      if (!accountEditTarget) return
      void submitEditAccount()
      return
    }
    if (!addForm.botToken.trim()) {
      toast.warning('请输入 Bot Token')
      return
    }
    if (addForm.dmPolicy === 'allowlist' && !addForm.allowFrom.trim()) {
      toast.warning('Allowlist 策略需要填写准入用户')
      return
    }
    setIsAddOpen(false)
    startStream('add', getOpenClawTelegramAddAccountStreamURL(addForm))
    setAddForm(defaultAddForm)
    setActiveAddSection('form')
  }, [accountEditTarget, accountModalMode, addForm, startStream, submitEditAccount])

  const openAddAccountModal = useCallback(() => {
    setAccountModalMode('create')
    setAccountEditTarget(null)
    setAddForm({
      ...defaultAddForm,
      dmPolicy: status?.config.dmPolicy || defaultAddForm.dmPolicy,
    })
    setActiveAddSection('form')
    setIsAddOpen(true)
  }, [status?.config])

  const openEditAccountModal = useCallback((account: OpenClawTelegramAccount) => {
    setAccountModalMode('edit')
    setAccountEditTarget(account)
    setAddForm(buildTelegramAccountFormFromAccount(account, status?.config))
    setActiveAddSection('form')
    setIsAddOpen(true)
  }, [status?.config])

  const updateChannelEnabled = useCallback(async (enabled: boolean) => {
    setSavingChannelEnabled(true)
    setStatus((current) => current ? { ...current, enabled, config: { ...current.config, enabled } } : current)
    try {
      const nextStatus = await updateOpenClawTelegramConfig({ enabled })
      setStatus(nextStatus)
      setAccountDrafts(buildTelegramAccountDrafts(nextStatus.accounts ?? []))
      toast.success(enabled ? 'Telegram 渠道已启用' : 'Telegram 渠道已停用')
    } catch (err) {
      void loadStatus()
      toast.warning(err instanceof Error ? err.message : 'Telegram 渠道开关更新失败')
    } finally {
      setSavingChannelEnabled(false)
    }
  }, [loadStatus])

  const updateChannelDMPolicy = useCallback(async (dmPolicy: string) => {
    if (!dmPolicy || !dmPolicyOptions.some((option) => option.id === dmPolicy)) return
    setSavingChannelDMPolicy(true)
    setStatus((current) => current ? { ...current, config: { ...current.config, dmPolicy } } : current)
    try {
      const nextStatus = await updateOpenClawTelegramConfig({ dmPolicy })
      setStatus(nextStatus)
      setAccountDrafts(buildTelegramAccountDrafts(nextStatus.accounts ?? []))
      setAddForm((current) => ({ ...current, dmPolicy: nextStatus.config.dmPolicy || dmPolicy }))
      toast.success('默认 DM 准入已更新')
    } catch (err) {
      void loadStatus()
      toast.warning(err instanceof Error ? err.message : '默认 DM 准入更新失败')
    } finally {
      setSavingChannelDMPolicy(false)
    }
  }, [loadStatus])

  const updateAccount = useCallback(async (account: OpenClawTelegramAccount, patch: Partial<TelegramAccountDraft>) => {
    const draft = {
      ...getTelegramAccountDraft(accountDrafts, account.accountId, account),
      ...patch,
    }
    setAccountDrafts((current) => ({ ...current, [account.accountId]: draft }))
    setSavingAccountId(account.accountId)
    try {
      const nextStatus = await updateOpenClawTelegramAccountConfig(account.accountId, {
        agentId: draft.agentId,
        enabled: draft.enabled,
      })
      setStatus(nextStatus)
      setAccountDrafts(buildTelegramAccountDrafts(nextStatus.accounts ?? []))
      toast.success('Telegram 账号配置已更新')
    } catch (err) {
      setAccountDrafts(buildTelegramAccountDrafts(status?.accounts ?? []))
      toast.warning(err instanceof Error ? err.message : 'Telegram 账号配置更新失败')
    } finally {
      setSavingAccountId('')
    }
  }, [accountDrafts, status?.accounts])

  const deleteAccount = useCallback(async () => {
    if (!accountDeleteTarget) return
    setAccountDeleting(true)
    try {
      await deleteOpenClawTelegramAccount(accountDeleteTarget.accountId)
      setAccountDeleteTarget(null)
      toast.success('Telegram 账号已删除')
      void loadStatus()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'Telegram 账号删除失败')
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
          <Alert status="danger" className='items-center'>
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Telegram渠道状态加载失败</Alert.Title>
              <Alert.Description>
                请检查 Telegram 渠道状态和网关运行状态。
              </Alert.Description>
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
                  <Icon icon="ri:telegram-fill" className="size-7" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Card.Title>Telegram</Card.Title>

                  </div>
                  <Card.Description>
                    添加你的 TelegramBot 机器人
                  </Card.Description>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {state !== 'loading' && !isTaskRunning ? (
                  <Button size="sm" isIconOnly variant={state === 'error' ? 'primary' : 'ghost'} aria-label="刷新 Telegram 渠道状态" onPress={() => void loadStatus()}>
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
              description: configured ? `${accounts.length} 个账号` : '等待添加 Bot Token',
              icon: 'lucide:key-round',
              loading: isLoading,
              ok: configured,
              title: '配置状态',
            },
            {
              description: enabled ? 'Telegram 渠道已启用' : 'Telegram 渠道已停用',
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
              description: '访问控制和激活',
              icon: 'lucide:shield-check',
              loading: isLoading,
              ok: configured,
              title: '默认DM',
            },
            {
              action: (
                <Switch
                  size="lg"
                  aria-label="切换 Telegram 渠道总开关"
                  isSelected={enabled}
                  isDisabled={!configured || isTaskRunning || isLoading || savingChannelEnabled}
                  onChange={(nextEnabled) => void updateChannelEnabled(nextEnabled)}
                >
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch>
              ),
              description: enabled ? 'Telegram 渠道已启用' : 'Telegram 渠道已停用',
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
                <TelegramAccountCard
                  key={account.accountId}
                  account={account}
                  agentOptions={agentOptions}
                  draft={getTelegramAccountDraft(accountDrafts, account.accountId, account)}
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
              description="添加一个 Telegram Bot 账号后，就可以配置路由 Agent、启用状态和消息接入策略。"
              icon="ri:telegram-fill"
              title="还没有 Telegram 账号"
            />
          )
        ) : (
          <ChannelEmptyState
            description="配置 Bot Token 后，可以在这里管理 Telegram 账号和消息接入。"
            icon="lucide:package-x"
            title="Telegram 尚未配置"
          />
        )}

        {status?.error ? (
          <div className="rounded-xl bg-warning/10 p-3 text-sm leading-6 text-warning">
            {status.error}
          </div>
        ) : null}

        <TaskLogPanel task={task} taskKind={taskKind} logRef={logRef} onClose={() => setTask(null)} />

        <OpenClawPairingModal
          channel="telegram"
          channelLabel="Telegram"
          isOpen={isPairingOpen}
          onApproved={() => void loadStatus()}
          onOpenChange={setIsPairingOpen}
        />

        <TelegramAddAccountModal
          activeSection={activeAddSection}
          agentOptions={agentOptions}
          editAccount={accountEditTarget}
          form={addForm}
          isOpen={isAddOpen}
          isSubmitting={isTaskRunning || Boolean(accountEditTarget && savingAccountId === accountEditTarget.accountId)}
          mode={accountModalMode}
          onActiveSectionChange={setActiveAddSection}
          onFormChange={setAddForm}
          onOpenChange={(open) => {
            setIsAddOpen(open)
            if (!open) {
              setActiveAddSection('form')
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
                <AlertDialog.Heading>删除 Telegram 账号？</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="break-all text-sm leading-6 text-muted">
                  {accountDeleteTarget?.accountId}
                </p>
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

function TelegramAccountCard({
  account,
  agentOptions,
  draft,
  isDisabled,
  isSaving,
  onChange,
  onDelete,
  onEdit,
}: {
  account: OpenClawTelegramAccount
  agentOptions: AgentOption[]
  draft: TelegramAccountDraft
  isDisabled: boolean
  isSaving: boolean
  onChange: (patch: Partial<TelegramAccountDraft>) => void
  onDelete: (account: OpenClawTelegramAccount) => void
  onEdit: (account: OpenClawTelegramAccount) => void
}) {
  const selectedAgent = agentOptions.find((option) => option.value === draft.agentId) ?? agentOptions[0]
  return (
    <Card>
      <Card.Content>
        <div className="flex gap-4 items-center justify-between">
          <div className="flex items-center gap-4">
            <div
              className={`flex size-11 shrink-0 items-center justify-center rounded-full ${draft.enabled ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}
              aria-label={draft.enabled ? '已启用' : '已停用'}
              title={draft.enabled ? '已启用' : '已停用'}
            >
              <Icon icon="ri:telegram-fill" className="size-6" />
            </div>

            <div className="flex min-w-0 items-center gap-4">
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
            <Switch
              size="lg"
              className="flex p-1 bg-default rounded-full"
              aria-label="启用 Telegram 账号"
              isSelected={draft.enabled}
              isDisabled={isDisabled || isSaving}
              onChange={(enabled) => onChange({ enabled })}
            >
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            <Button isIconOnly size="sm" variant="tertiary" aria-label="编辑 Telegram 账号" onPress={() => onEdit(account)} isDisabled={isDisabled || isSaving}>
              <Icon icon="lucide:pencil" className="size-4" />
            </Button>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            <Button isIconOnly size="sm" variant="tertiary" aria-label="删除 Telegram 账号" onPress={() => onDelete(account)} isDisabled={isDisabled || isSaving}>
              <Icon icon="lucide:trash-2" className="size-4" />
            </Button>
          </div>
        </div>
      </Card.Content>
    </Card >
  )
}

function TelegramAddAccountModal({
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
  activeSection: AddFormSection
  agentOptions: AgentOption[]
  editAccount: OpenClawTelegramAccount | null
  form: TelegramAddForm
  isOpen: boolean
  isSubmitting: boolean
  mode: AccountModalMode
  onActiveSectionChange: (section: AddFormSection) => void
  onFormChange: (form: TelegramAddForm) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
}) {
  const update = (patch: Partial<TelegramAddForm>) => onFormChange({ ...form, ...patch })
  const [credentialCheck, setCredentialCheck] = useState<TelegramCredentialCheck | null>(null)
  const [isCredentialChecking, setIsCredentialChecking] = useState(false)
  const tabs = mode === 'edit' ? editFormTabs : addFormTabs
  const canValidateCredential = Boolean(form.accountId.trim() && form.botToken.trim())
  const credentialSignature = `${form.accountId.trim()}\n${form.botToken.trim()}`
  const visibleCredentialCheck = credentialCheck?.signature === credentialSignature ? credentialCheck : null

  const validateCredential = async () => {
    if (!canValidateCredential || isCredentialChecking) return
    setIsCredentialChecking(true)
    setCredentialCheck(null)
    try {
      const result = await validateOpenClawTelegramCredential({ botToken: form.botToken.trim() })
      if (result.valid) {
        const label = result.username ? `@${result.username}` : result.firstName || String(result.botId ?? '')
        setCredentialCheck({ label, signature: credentialSignature, valid: true })
        toast.success(label ? `Telegram Bot 校验通过：${label}` : 'Telegram Bot 校验通过')
      } else {
        setCredentialCheck({ error: result.error || 'Telegram Bot Token 校验失败', signature: credentialSignature, valid: false })
        toast.warning(result.error || 'Telegram Bot Token 校验失败')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Telegram Bot Token 校验失败'
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
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
              <Icon icon="simple-icons:telegram" className="size-5" />
            </Modal.Icon>
            <div>
              <Modal.Heading>{mode === 'edit' ? '编辑 Telegram 账号' : '添加 Telegram 账号'}</Modal.Heading>
              <p className="mt-1 text-sm text-muted">
                {mode === 'edit'
                  ? `更新 ${editAccount?.name || editAccount?.accountId || 'Telegram 账号'} 的基础和高级设置。`
                  : '填写 BotFather token 后写入 Telegram 渠道。'}
              </p>
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="space-y-5 p-1">
              <Segment selectedKey={activeSection} onSelectionChange={(key) => onActiveSectionChange(String(key) as AddFormSection)}>
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
                  {telegramHelpSteps.map((item) => (
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
                      <ItemCardGroup.Description>调整这个账号的默认接入策略与群聊行为。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem description="默认 DM 准入策略。" icon="lucide:shield-check" title="DM 策略">
                      <FriendlySelect
                        ariaLabel="DM 策略"
                        isDisabled={isSubmitting}
                        options={dmPolicyOptions}
                        value={form.dmPolicy}
                        onChange={(value) => update({ dmPolicy: String(value ?? 'pairing') })}
                      />
                    </FormItem>
                    <FormItem description="群聊准入策略。" icon="lucide:messages-square" title="群聊策略">
                      <FriendlySelect
                        ariaLabel="群聊策略"
                        isDisabled={isSubmitting}
                        options={groupPolicyOptions}
                        value={form.groupPolicy || 'inherit'}
                        onChange={(value) => update({ groupPolicy: String(value ?? 'inherit') === 'inherit' ? '' : String(value) })}
                      />
                    </FormItem>
                    <FormItem actionClassName="w-fit" description="开启后群聊消息需要提及机器人后才触发。" icon="lucide:at-sign" title="群聊需 @">
                      <Switch size="lg" aria-label="群聊要求提及机器人" isSelected={form.requireMention} isDisabled={isSubmitting} onChange={(requireMention) => update({ requireMention })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </FormItem>
                  </ItemCardGroup>

                  <TextareaCard
                    description="支持逗号或换行分隔；Allowlist 策略至少需要一个用户 ID。"
                    disabled={isSubmitting}
                    icon="lucide:users"
                    placeholder="tg:123456789, tg:987654321"
                    title="准入用户"
                    value={form.allowFrom}
                    onChange={(allowFrom) => update({ allowFrom })}
                  />

                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>Exec 审批</ItemCardGroup.Title>
                      <ItemCardGroup.Description>配置 Telegram 原生审批提示和审批者。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem description="自动会从命令所有者推断审批能力。" icon="lucide:shield-alert" title="审批开关">
                      <FriendlySelect
                        ariaLabel="Exec 审批开关"
                        isDisabled={isSubmitting}
                        options={booleanModeOptions}
                        value={form.execApprovalsEnabled}
                        onChange={(value) => update({ execApprovalsEnabled: String(value ?? 'inherit') })}
                      />
                    </FormItem>
                    <FormItem description="审批提示发送到哪里。" icon="lucide:send" title="投递位置">
                      <FriendlySelect
                        ariaLabel="Exec 审批投递位置"
                        isDisabled={isSubmitting}
                        options={execTargetOptions}
                        value={form.execApprovalsTarget || 'inherit'}
                        onChange={(value) => update({ execApprovalsTarget: String(value ?? 'inherit') })}
                      />
                    </FormItem>
                  </ItemCardGroup>

                  <TextareaCard
                    description="支持逗号或换行分隔。审批者必须是数字 Telegram 用户 ID。"
                    disabled={isSubmitting}
                    icon="lucide:user-check"
                    placeholder="123456789, 987654321"
                    title="审批者"
                    value={form.execApprovalsApprovers}
                    onChange={(execApprovalsApprovers) => update({ execApprovalsApprovers })}
                  />

                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>流式预览</ItemCardGroup.Title>
                      <ItemCardGroup.Description>控制 Telegram 预览消息、工具进度和命令文本显示。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem description="off、partial、block 或 progress。" icon="lucide:radio-tower" title="模式">
                      <FriendlySelect
                        ariaLabel="流式模式"
                        isDisabled={isSubmitting}
                        options={streamingModeOptions}
                        value={form.streamingMode}
                        onChange={(value) => update({ streamingMode: String(value ?? 'partial') })}
                      />
                    </FormItem>
                    <FormItem actionClassName="w-fit" description="回答预览里是否显示工具进度。" icon="lucide:activity" title="预览工具进度">
                      <Switch size="lg" aria-label="预览工具进度" isSelected={form.streamingPreviewToolProgress} isDisabled={isSubmitting} onChange={(streamingPreviewToolProgress) => update({ streamingPreviewToolProgress })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </FormItem>
                    <FormItem description="工具进度里的命令详情显示策略。" icon="lucide:terminal" title="预览命令文本">
                      <FriendlySelect
                        ariaLabel="预览命令文本"
                        isDisabled={isSubmitting}
                        options={commandTextOptions}
                        value={form.streamingPreviewCommandText}
                        onChange={(value) => update({ streamingPreviewCommandText: String(value ?? 'raw') })}
                      />
                    </FormItem>
                    <FormItem actionClassName="w-fit" description="progress 模式是否保留工具进度。" icon="lucide:list-checks" title="进度工具状态">
                      <Switch size="lg" aria-label="进度模式工具状态" isSelected={form.streamingProgressToolProgress} isDisabled={isSubmitting} onChange={(streamingProgressToolProgress) => update({ streamingProgressToolProgress })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </FormItem>
                    <FormItem description="progress 模式中的命令文本策略。" icon="lucide:terminal-square" title="进度命令文本">
                      <FriendlySelect
                        ariaLabel="进度命令文本"
                        isDisabled={isSubmitting}
                        options={commandTextOptions}
                        value={form.streamingProgressCommandText}
                        onChange={(value) => update({ streamingProgressCommandText: String(value ?? 'raw') })}
                      />
                    </FormItem>
                    <FormItem actionClassName="w-fit" description="兼容旧 blockStreaming 配置。" icon="lucide:blocks" title="Block Streaming">
                      <Switch size="lg" aria-label="Block Streaming" isSelected={form.streamingBlock} isDisabled={isSubmitting} onChange={(streamingBlock) => update({ streamingBlock })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </FormItem>
                  </ItemCardGroup>

                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>命令菜单</ItemCardGroup.Title>
                      <ItemCardGroup.Description>控制原生命令和自定义菜单条目。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem description="Telegram setMyCommands 的内置命令。" icon="lucide:command" title="原生命令">
                      <FriendlySelect
                        ariaLabel="原生命令"
                        isDisabled={isSubmitting}
                        options={booleanModeOptions}
                        value={form.commandsNative}
                        onChange={(value) => update({ commandsNative: String(value ?? 'auto') })}
                      />
                    </FormItem>
                    <FormItem description="技能命令是否进入菜单。" icon="lucide:sparkles" title="技能命令">
                      <FriendlySelect
                        ariaLabel="技能命令"
                        isDisabled={isSubmitting}
                        options={booleanModeOptions}
                        value={form.commandsNativeSkills}
                        onChange={(value) => update({ commandsNativeSkills: String(value ?? 'auto') })}
                      />
                    </FormItem>
                  </ItemCardGroup>

                  <TextareaCard
                    description="支持换行分隔；每行 command: description，命令无需写 /。"
                    disabled={isSubmitting}
                    icon="lucide:list-plus"
                    placeholder={'backup: Git backup\ngenerate: Create an image'}
                    title="自定义命令"
                    value={form.customCommands}
                    onChange={(customCommands) => update({ customCommands })}
                  />

                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>Webhook</ItemCardGroup.Title>
                      <ItemCardGroup.Description>配置 webhook 入口；secret 留空不会覆盖已有值。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem description="完整公网回调地址。" icon="lucide:link" title="Webhook URL">
                      <ClearableInput value={form.webhookUrl} disabled={isSubmitting} placeholder="https://example.com/telegram-webhook" onChange={(webhookUrl) => update({ webhookUrl })} />
                    </FormItem>
                    <FormItem description="本地 webhook 路径。" icon="lucide:route" title="Webhook Path">
                      <ClearableInput value={form.webhookPath} disabled={isSubmitting} placeholder="/telegram-webhook" onChange={(webhookPath) => update({ webhookPath })} />
                    </FormItem>
                    <FormItem description="本地监听地址。" icon="lucide:server" title="Webhook Host">
                      <ClearableInput value={form.webhookHost} disabled={isSubmitting} placeholder="127.0.0.1" onChange={(webhookHost) => update({ webhookHost })} />
                    </FormItem>
                    <FormItem description="留空保持当前密钥不变。" icon="lucide:key-round" title="Webhook Secret">
                      <ClearableInput value={form.webhookSecret} disabled={isSubmitting} placeholder="secret" onChange={(webhookSecret) => update({ webhookSecret })} />
                    </FormItem>
                  </ItemCardGroup>

                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>操作能力</ItemCardGroup.Title>
                      <ItemCardGroup.Description>控制内联按钮和消息操作动作。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem description="内联按钮允许范围。" icon="lucide:panel-top-open" title="内联按钮">
                      <FriendlySelect
                        ariaLabel="内联按钮范围"
                        isDisabled={isSubmitting}
                        options={inlineButtonOptions}
                        value={form.inlineButtons || 'inherit'}
                        onChange={(value) => update({ inlineButtons: String(value ?? 'inherit') })}
                      />
                    </FormItem>
                    <ActionSwitch label="发送消息" value={form.actionSendMessage} disabled={isSubmitting} onChange={(actionSendMessage) => update({ actionSendMessage })} />
                    <ActionSwitch label="编辑消息" value={form.actionEditMessage} disabled={isSubmitting} onChange={(actionEditMessage) => update({ actionEditMessage })} />
                    <ActionSwitch label="删除消息" value={form.actionDeleteMessage} disabled={isSubmitting} onChange={(actionDeleteMessage) => update({ actionDeleteMessage })} />
                    <ActionSwitch label="表情回应" value={form.actionReactions} disabled={isSubmitting} onChange={(actionReactions) => update({ actionReactions })} />
                    <ActionSwitch label="贴纸" value={form.actionSticker} disabled={isSubmitting} onChange={(actionSticker) => update({ actionSticker })} />
                  </ItemCardGroup>
                </div>
              ) : (
                <div className="space-y-5 max-h-[500px] overflow-y-auto">
                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>账号信息</ItemCardGroup.Title>
                      <ItemCardGroup.Description>{mode === 'edit' ? '编辑账号名称与基础标识。' : '填写 Telegram BotFather 返回的账号凭据。'}</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem description="填写一个可识别的名称。" icon="lucide:badge" title="账号名称">
                      <ClearableInput value={form.name} disabled={isSubmitting} placeholder={mode === 'edit' ? '未命名' : '显示名称'} onChange={(name) => update({ name })} />
                    </FormItem>
                    <Separator />
                    <FormItem description="填写一个可识别的ID。" icon="lucide:user-round" title="账号 ID">
                      <ClearableInput value={form.accountId} disabled={isSubmitting || mode === 'edit'} placeholder="default" onChange={(accountId) => update({ accountId })} />
                    </FormItem>
                    <Separator />
                    <FormItem description={mode === 'edit' ? '留空保持当前 Bot Token 不变。' : '从 BotFather 获取。'} icon="lucide:key-round" title="Bot Token">
                      <ClearableInput value={form.botToken} placeholder="123456:ABC-DEF..." disabled={isSubmitting} onChange={(botToken) => update({ botToken })} />
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

                  {mode === 'create' ? (
                    <ItemCardGroup className="overflow-hidden">
                      <ItemCardGroup.Header>
                        <ItemCardGroup.Title>访问策略</ItemCardGroup.Title>
                        <ItemCardGroup.Description>控制谁可以通过 Telegram 私聊或群聊唤起 OpenClaw。</ItemCardGroup.Description>
                      </ItemCardGroup.Header>
                      <FormItem description="根据需求选择准入策略。" icon="lucide:shield-check" title="DM 策略">
                        <FriendlySelect
                          ariaLabel="DM 策略"
                          isDisabled={isSubmitting}
                          options={dmPolicyOptions}
                          value={form.dmPolicy}
                          onChange={(value) => update({ dmPolicy: String(value ?? 'pairing') })}
                        />
                      </FormItem>
                      <FormItem actionClassName="w-fit" description="开启后群聊消息需要提及机器人后才触发。" icon="lucide:at-sign" title="群聊需 @">
                        <Switch size="lg" aria-label="群聊要求提及机器人" isSelected={form.requireMention} isDisabled={isSubmitting} onChange={(requireMention) => update({ requireMention })}>
                          <Switch.Control><Switch.Thumb /></Switch.Control>
                        </Switch>
                      </FormItem>
                    </ItemCardGroup>
                  ) : null}

                  {mode === 'create' ? (
                    <TextareaCard
                      description="支持逗号或换行分隔；Allowlist 策略至少需要一个用户 ID。"
                      disabled={isSubmitting}
                      icon="lucide:users"
                      placeholder="tg:123456789, tg:987654321"
                      title="准入用户"
                      value={form.allowFrom}
                      onChange={(allowFrom) => update({ allowFrom })}
                    />
                  ) : null}
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

function TaskLogPanel({ logRef, onClose, task, taskKind }: { logRef: RefObject<HTMLPreElement | null>; onClose: () => void; task: OpenClawChannelTaskResponse | null; taskKind: TelegramTaskKind | null }) {
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

function buildTelegramAccountDrafts(accounts: OpenClawTelegramAccount[]) {
  return accounts.reduce<Record<string, TelegramAccountDraft>>((drafts, account) => {
    drafts[account.accountId] = getTelegramAccountDraft({}, account.accountId, account)
    return drafts
  }, {})
}

function buildTelegramAccountFormFromAccount(account: OpenClawTelegramAccount, config?: OpenClawTelegramConfig): TelegramAddForm {
  return {
    actionDeleteMessage: booleanDefault(account.actions?.deleteMessage, config?.actions?.deleteMessage, false),
    actionEditMessage: booleanDefault(account.actions?.editMessage, config?.actions?.editMessage, true),
    actionReactions: booleanDefault(account.actions?.reactions, config?.actions?.reactions, true),
    actionSendMessage: booleanDefault(account.actions?.sendMessage, config?.actions?.sendMessage, true),
    actionSticker: booleanDefault(account.actions?.sticker, config?.actions?.sticker, false),
    accountId: account.accountId,
    agentId: account.agentId ?? '',
    allowFrom: (account.allowFrom ?? []).join('\n'),
    botToken: '',
    commandsNative: config?.commands?.native || 'auto',
    commandsNativeSkills: config?.commands?.nativeSkills || 'auto',
    customCommands: (config?.customCommands ?? []).map((item) => `${item.command}: ${item.description}`).join('\n'),
    dmPolicy: account.dmPolicy || config?.dmPolicy || 'pairing',
    execApprovalsApprovers: (account.execApprovals?.approvers ?? config?.execApprovals?.approvers ?? []).join('\n'),
    execApprovalsEnabled: account.execApprovals?.enabled || config?.execApprovals?.enabled || 'inherit',
    execApprovalsTarget: account.execApprovals?.target || config?.execApprovals?.target || 'dm',
    groupPolicy: account.groupPolicy || '',
    inlineButtons: account.capabilities?.inlineButtons || config?.capabilities?.inlineButtons || 'allowlist',
    name: account.name || '',
    requireMention: account.requireMention,
    streamingBlock: Boolean(config?.streamingConfig?.blockStreaming),
    streamingMode: config?.streamingConfig?.mode || config?.streaming || 'partial',
    streamingPreviewCommandText: config?.streamingConfig?.previewCommandText || 'raw',
    streamingPreviewToolProgress: config?.streamingConfig?.previewToolProgress !== false,
    streamingProgressCommandText: config?.streamingConfig?.progressCommandText || 'raw',
    streamingProgressToolProgress: config?.streamingConfig?.progressToolProgress !== false,
    webhookHost: config?.webhook?.host || '',
    webhookPath: config?.webhook?.path || '',
    webhookSecret: '',
    webhookUrl: config?.webhook?.url || '',
  }
}

function buildTelegramAdvancedConfigRequest(form: TelegramAddForm): OpenClawTelegramConfigUpdateRequest {
  return {
    actions: {
      deleteMessage: form.actionDeleteMessage,
      editMessage: form.actionEditMessage,
      reactions: form.actionReactions,
      sendMessage: form.actionSendMessage,
      sticker: form.actionSticker,
    },
    blockStreaming: form.streamingBlock,
    capabilities: {
      inlineButtons: form.inlineButtons === 'inherit' ? '' : form.inlineButtons,
    },
    commands: {
      native: form.commandsNative,
      nativeSkills: form.commandsNativeSkills,
    },
    customCommands: parseTelegramCustomCommands(form.customCommands),
    execApprovals: {
      approvers: splitTelegramAccountFormList(form.execApprovalsApprovers),
      enabled: form.execApprovalsEnabled,
      target: form.execApprovalsTarget === 'inherit' ? '' : form.execApprovalsTarget,
    },
    streaming: {
      mode: form.streamingMode,
      previewCommandText: form.streamingPreviewCommandText,
      previewToolProgress: form.streamingPreviewToolProgress,
      progressCommandText: form.streamingProgressCommandText,
      progressToolProgress: form.streamingProgressToolProgress,
    },
    webhookHost: form.webhookHost.trim(),
    webhookPath: form.webhookPath.trim(),
    webhookUrl: form.webhookUrl.trim(),
    ...(form.webhookSecret.trim() ? { webhookSecret: form.webhookSecret.trim() } : {}),
  }
}

function parseTelegramCustomCommands(value: string) {
  return value
    .split(/\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [commandPart, ...descriptionParts] = line.split(':')
      return {
        command: commandPart.trim().replace(/^\//, ''),
        description: descriptionParts.join(':').trim(),
      }
    })
    .filter((item) => item.command && item.description)
}

function splitTelegramAccountFormList(value: string) {
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

function getTelegramAccountDraft(drafts: Record<string, TelegramAccountDraft>, accountId: string, account?: OpenClawTelegramAccount): TelegramAccountDraft {
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

function maskTelegramToken(line: string) {
  return line.replace(/\b\d{5,}:[A-Za-z0-9_-]{12,}\b/g, '<bot-token>')
}

function taskTitle(kind: TelegramTaskKind | null) {
  switch (kind) {
    case 'add':
      return '添加 Telegram 账号'
    default:
      return 'Telegram 渠道任务'
  }
}

function OpenClawTelegramPage() {
  usePageTitle('OpenClaw Telegram 渠道')

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <OpenClawTelegramPanel />
      </div>
    </DashboardLayout>
  )
}

export default OpenClawTelegramPage
