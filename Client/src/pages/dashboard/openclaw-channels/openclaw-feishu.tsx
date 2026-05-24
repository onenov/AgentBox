import type { ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as QRCode from 'qrcode'
import type { Key } from '@heroui/react'
import { Alert, AlertDialog, Button, Card, Chip, Dropdown, InputGroup, Modal, Skeleton, Switch, toast } from '@heroui/react'
import { ItemCard, ItemCardGroup } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type {
  OpenClawAgentSummary,
  OpenClawChannelStreamError,
  OpenClawChannelStreamLog,
  OpenClawChannelStreamMeta,
  OpenClawChannelStreamStatus,
  OpenClawChannelTaskResponse,
  OpenClawFeishuAccount,
  OpenClawFeishuStatusResponse,
} from '@/api'
import {
  deleteOpenClawFeishuAccount,
  getOpenClawFeishuAddAccountStreamURL,
  getOpenClawFeishuDoctorStreamURL,
  getOpenClawFeishuInstallStreamURL,
  getOpenClawFeishuScanAddStreamURL,
  getOpenClawFeishuStatus,
  getOpenClawFeishuUninstallStreamURL,
  listOpenClawAgents,
  updateOpenClawFeishuAccountConfig,
  updateOpenClawFeishuConfig,
} from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { openExternalUrl } from '@/utils/openExternalUrl'
import DashboardLayout from '@/layouts/Dashboard'
import { OpenClawPairingModal } from './openclaw-pairing'

type LoadState = 'error' | 'idle' | 'loading' | 'ready'
type TaskKind = 'add' | 'doctor' | 'install' | 'scan' | 'uninstall'

type FeishuAccountDraft = {
  agentId: string
  enabled: boolean
}

type FeishuForm = {
  accountId: string
  agentId: string
  appId: string
  appSecret: string
  dmPolicy: string
  domain: string
  groupPolicy: string
  name: string
  requireMention: boolean
}

type FeishuEditForm = {
  agentId: string
  allowFromText: string
  appId: string
  appSecret: string
  dmPolicy: string
  domain: string
  enabled: boolean
  groupAllowFromText: string
  groupPolicy: string
  name: string
  requireMention: boolean
}

type AgentOption = {
  id: string
  label: string
  value: string
}

const defaultFeishuForm: FeishuForm = {
  accountId: 'default',
  agentId: '',
  appId: '',
  appSecret: '',
  dmPolicy: 'pairing',
  domain: 'feishu',
  groupPolicy: 'allowlist',
  name: '',
  requireMention: true,
}

const dmPolicyOptions = [
  { id: 'pairing', label: '配对验证' },
  { id: 'allowlist', label: '仅白名单' },
  { id: 'open', label: '公开访问' },
  { id: 'disabled', label: '禁用私聊' },
]

const groupPolicyOptions = [
  { id: 'allowlist', label: '仅白名单' },
  { id: 'open', label: '公开访问' },
  { id: 'disabled', label: '禁用群聊' },
  { id: 'inherit', label: '继承默认' },
]

const domainOptions = [
  { id: 'feishu', label: '飞书' },
  { id: 'lark', label: 'Lark' },
]

export function OpenClawFeishuPanel() {
  const [state, setState] = useState<LoadState>('idle')
  const [status, setStatus] = useState<OpenClawFeishuStatusResponse | null>(null)
  const [accountDrafts, setAccountDrafts] = useState<Record<string, FeishuAccountDraft>>({})
  const [agents, setAgents] = useState<OpenClawAgentSummary[]>([])
  const [savingAccountId, setSavingAccountId] = useState('')
  const [savingChannel, setSavingChannel] = useState('')
  const [error, setError] = useState('')
  const [task, setTask] = useState<OpenClawChannelTaskResponse | null>(null)
  const [taskKind, setTaskKind] = useState<TaskKind | null>(null)
  const [manualAddOpen, setManualAddOpen] = useState(false)
  const [form, setForm] = useState<FeishuForm>(defaultFeishuForm)
  const [editTarget, setEditTarget] = useState<OpenClawFeishuAccount | null>(null)
  const [editForm, setEditForm] = useState<FeishuEditForm | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const [feishuQr, setFeishuQr] = useState<{ dataUrl: string; url: string } | null>(null)
  const [feishuQrOpen, setFeishuQrOpen] = useState(false)
  const [accountDeleteTarget, setAccountDeleteTarget] = useState<OpenClawFeishuAccount | null>(null)
  const [accountDeleting, setAccountDeleting] = useState(false)
  const [isPairingOpen, setIsPairingOpen] = useState(false)
  const logRef = useRef<HTMLPreElement | null>(null)
  const sourceRef = useRef<EventSource | null>(null)
  const streamFinishedRef = useRef(false)
  const feishuQrUrlRef = useRef('')

  const loadStatus = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const [nextStatus, nextAgents] = await Promise.all([getOpenClawFeishuStatus(), listOpenClawAgents()])
      setStatus(nextStatus)
      setAgents(nextAgents.agents ?? [])
      setAccountDrafts(buildAccountDrafts(nextStatus.accounts ?? []))
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : '飞书渠道状态加载失败')
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

  const renderFeishuQr = useCallback(async (url: string) => {
    if (feishuQrUrlRef.current === url) return
    feishuQrUrlRef.current = url
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 280,
      })
      setFeishuQr({ dataUrl, url })
      setFeishuQrOpen(true)
    } catch {
      toast.warning('飞书配置二维码渲染失败')
    }
  }, [])

  const startStream = useCallback((kind: TaskKind, url: string) => {
    closeStream()
    streamFinishedRef.current = false
    if (kind === 'install' || kind === 'scan') {
      feishuQrUrlRef.current = ''
      setFeishuQr(null)
      setFeishuQrOpen(false)
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
          setFeishuQrOpen(false)
          setTask(null)
          toast.success(taskDoneMessage(kind))
          void loadStatus()
        }
        if (payload.status === 'error' && payload.error) {
          streamFinishedRef.current = true
          closeStream()
          setFeishuQrOpen(false)
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
        const qrUrl = extractFeishuQrUrl(payload.line)
        if (qrUrl) void renderFeishuQr(qrUrl)
        setTask((current) => current ? {
          ...current,
          id: payload.id || current.id,
          logs: appendTaskLog(current.logs, maskFeishuSecrets(payload.line)),
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
        setFeishuQrOpen(false)
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
      setFeishuQrOpen(false)
      const timestamp = new Date().toISOString()
      setTask((current) => current ? {
        ...current,
        error: '流式连接中断',
        logs: appendTaskLog(current.logs, '失败：流式连接中断'),
        progress: 100,
        status: 'error',
        updatedAt: timestamp,
      } : current)
      toast.warning('飞书渠道流式任务连接中断')
      void loadStatus()
    }
  }, [closeStream, loadStatus, renderFeishuQr])

  const updateChannelFlag = useCallback(async (key: 'enabled' | 'footerElapsed' | 'footerStatus' | 'requireMention' | 'streaming' | 'threadSession', enabled: boolean) => {
    setSavingChannel(key)
    setStatus((current) => current ? {
      ...current,
      enabled: key === 'enabled' ? enabled : current.enabled,
      config: { ...current.config, [key]: enabled },
    } : current)
    try {
      const nextStatus = await updateOpenClawFeishuConfig({ [key]: enabled })
      setStatus(nextStatus)
      setAccountDrafts(buildAccountDrafts(nextStatus.accounts ?? []))
      toast.success(channelFlagMessage(key, enabled))
    } catch (err) {
      void loadStatus()
      toast.warning(err instanceof Error ? err.message : '飞书渠道配置更新失败')
    } finally {
      setSavingChannel('')
    }
  }, [loadStatus])

  const updateAccount = useCallback(async (account: OpenClawFeishuAccount, patch: Partial<FeishuAccountDraft>) => {
    const draft = {
      ...getAccountDraft(accountDrafts, account.accountId, account),
      ...patch,
    }
    setAccountDrafts((current) => ({ ...current, [account.accountId]: draft }))
    setSavingAccountId(account.accountId)
    try {
      const nextStatus = await updateOpenClawFeishuAccountConfig(account.accountId, {
        agentId: draft.agentId,
        enabled: draft.enabled,
      })
      setStatus(nextStatus)
      setAccountDrafts(buildAccountDrafts(nextStatus.accounts ?? []))
      toast.success('飞书账号配置已更新')
    } catch (err) {
      setAccountDrafts(buildAccountDrafts(status?.accounts ?? []))
      toast.warning(err instanceof Error ? err.message : '飞书账号配置更新失败')
    } finally {
      setSavingAccountId('')
    }
  }, [accountDrafts, status?.accounts])

  const deleteAccount = useCallback(async () => {
    if (!accountDeleteTarget) return
    setAccountDeleting(true)
    try {
      await deleteOpenClawFeishuAccount(accountDeleteTarget.accountId)
      setAccountDeleteTarget(null)
      toast.success('飞书账号已删除')
      void loadStatus()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '飞书账号删除失败')
    } finally {
      setAccountDeleting(false)
    }
  }, [accountDeleteTarget, loadStatus])

  const openEditAccount = useCallback((account: OpenClawFeishuAccount) => {
    setEditTarget(account)
    setEditForm(buildEditForm(account))
  }, [])

  const closeEditAccount = useCallback((open: boolean) => {
    if (open) return
    if (editSaving) return
    setEditTarget(null)
    setEditForm(null)
  }, [editSaving])

  const submitEditAccount = useCallback(async () => {
    if (!editTarget || !editForm) return
    setEditSaving(true)
    const appSecret = editForm.appSecret.trim()
    try {
      const nextStatus = await updateOpenClawFeishuAccountConfig(editTarget.accountId, {
        agentId: editForm.agentId,
        allowFrom: parseListInput(editForm.allowFromText),
        appId: editForm.appId.trim(),
        ...(appSecret ? { appSecret } : {}),
        dmPolicy: editForm.dmPolicy,
        domain: editForm.domain,
        enabled: editForm.enabled,
        groupAllowFrom: parseListInput(editForm.groupAllowFromText),
        groupPolicy: editForm.groupPolicy,
        name: editForm.name.trim(),
        requireMention: editForm.requireMention,
      })
      setStatus(nextStatus)
      setAccountDrafts(buildAccountDrafts(nextStatus.accounts ?? []))
      setEditTarget(null)
      setEditForm(null)
      toast.success('飞书机器人配置已更新')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '飞书机器人配置更新失败')
    } finally {
      setEditSaving(false)
    }
  }, [editForm, editTarget])

  const submitManualAdd = useCallback(() => {
    if (!form.appId.trim() || !form.appSecret.trim()) {
      toast.warning('App ID 和 App Secret 不能为空')
      return
    }
    setManualAddOpen(false)
    startStream('add', getOpenClawFeishuAddAccountStreamURL(form))
    setForm(defaultFeishuForm)
  }, [form, startStream])

  const handleFeishuQrOpenChange = useCallback((open: boolean) => {
    if (open) {
      setFeishuQrOpen(true)
      return
    }

    setFeishuQrOpen(false)
    if (taskKind !== 'scan' || !task || task.status === 'done' || task.status === 'error') return

    streamFinishedRef.current = true
    closeStream()
    setFeishuQr(null)
    setTask(null)
    toast.warning('已取消飞书扫码登录')
    void loadStatus()
  }, [closeStream, loadStatus, task, taskKind])

  const agentOptions = useMemo(() => buildAgentOptions(agents), [agents])
  const isLoading = state === 'loading' && !status
  const isTaskRunning = Boolean(task && task.status !== 'done' && task.status !== 'error')
  const installed = Boolean(status?.installed)
  const configured = Boolean(status?.configured)
  const enabled = Boolean(status?.enabled)
  const accounts = status?.accounts ?? []

  return (
    <>
      {error ? (
        <div className=" py-3 w-full">
          <Alert status="danger" className="items-center">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>飞书渠道状态加载失败</Alert.Title>
              <Alert.Description>请检查飞书插件配置和网关运行状态。</Alert.Description>
            </Alert.Content>
            <Button isIconOnly size="sm" variant="danger" aria-label="刷新飞书渠道状态" onPress={() => void loadStatus()}>
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
                  <Icon icon="icon-park-outline:lark" className="size-7" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Card.Title>飞书 / Lark</Card.Title>
                  </div>
                  <Card.Description>
                    接入飞书官方 OpenClaw 插件，管理机器人、授权和话题上下文。
                  </Card.Description>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {state !== 'loading' && !isTaskRunning ? (
                  <Button size="sm" isIconOnly variant={state === 'error' ? 'primary' : 'ghost'} aria-label="刷新飞书渠道状态" onPress={() => void loadStatus()}>
                    <Icon icon="lucide:refresh-cw" />
                  </Button>
                ) : null}
                {!installed && !isTaskRunning ? (
                  <Button size="sm" variant="primary" onPress={() => startStream('install', getOpenClawFeishuInstallStreamURL())}>
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
                {installed && !isTaskRunning ? (
                  <Button size="sm" variant="tertiary" onPress={() => startStream('doctor', getOpenClawFeishuDoctorStreamURL())}>
                    <Icon icon="lucide:stethoscope" />
                    诊断
                  </Button>
                ) : null}
                {installed && !isTaskRunning ? (
                  <Button size="sm" variant="tertiary" onPress={() => setIsPairingOpen(true)}>
                    <Icon icon="lucide:shield-check" />
                    配对审批
                  </Button>
                ) : null}
                {installed && !isTaskRunning ? (
                  <Button size="sm" variant="primary" onPress={() => startStream('scan', getOpenClawFeishuScanAddStreamURL())}>
                    <Icon icon="lucide:qr-code" />
                    扫码添加
                  </Button>
                ) : null}
                {installed && !isTaskRunning ? (
                  <Button size="sm" variant="primary" onPress={() => setManualAddOpen(true)}>
                    <Icon icon="lucide:keyboard" />
                    手动添加
                  </Button>
                ) : null}
              </div>
            </div>
          </Card.Content>
        </Card>

        <StatusItemList
          items={[
            {
              description: installed ? status?.version || '版本未知' : '等待安装官方插件',
              icon: 'lucide:package-check',
              loading: isLoading,
              ok: installed,
              title: '插件',
            },
            {
              description: configured ? `${accounts.length} 个账号` : '等待关联机器人',
              icon: 'lucide:key-round',
              loading: isLoading,
              ok: configured,
              title: '配置',
            },
            {
              action: installed && !isTaskRunning && !isLoading ? (
                <Switch
                  size="lg"
                  aria-label="切换飞书渠道总开关"
                  isSelected={enabled}
                  isDisabled={savingChannel === 'enabled'}
                  onChange={(value) => void updateChannelFlag('enabled', value)}
                >
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch>
              ) : null,
              description: enabled ? '飞书渠道已启用' : '飞书渠道已停用',
              icon: 'lucide:power',
              loading: isLoading,
              ok: enabled,
              title: '启用状态',
            },
            {
              action: installed && !isTaskRunning && !isLoading ? (
                <Switch
                  size="lg"
                  aria-label="切换飞书话题独立上下文"
                  isSelected={Boolean(status?.config.threadSession)}
                  isDisabled={savingChannel === 'threadSession'}
                  onChange={(value) => void updateChannelFlag('threadSession', value)}
                >
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch>
              ) : null,
              description: status?.config.threadSession ? '每个话题独立上下文' : '使用默认会话上下文',
              icon: 'lucide:messages-square',
              loading: isLoading,
              ok: Boolean(status?.config.threadSession),
              title: '话题上下文',
            },
          ]}
        />

        <div>
          {installed ? (
            accounts.length > 0 ? (
              <div className="grid gap-2 lg:grid-cols-2">
                {accounts.map((account) => (
                  <FeishuAccountCard
                    key={account.accountId}
                    account={account}
                    agentOptions={agentOptions}
                    draft={getAccountDraft(accountDrafts, account.accountId, account)}
                    isDisabled={isLoading || isTaskRunning}
                    isSaving={savingAccountId === account.accountId}
                    onChange={(patch) => void updateAccount(account, patch)}
                    onDelete={setAccountDeleteTarget}
                    onEdit={openEditAccount}
                  />
                ))}
              </div>
            ) : (
              <FeishuEmptyAccountsCard />
            )
          ) : (
            <FeishuNotInstalledCard />
          )}
        </div>

        {status?.error ? (
          <div className="rounded-xl bg-warning/10 p-3 text-sm leading-6 text-warning">
            {status.error}
          </div>
        ) : null}

        <TaskLogPanel task={task} taskKind={taskKind} logRef={logRef} onClose={() => setTask(null)} />
        <OpenClawPairingModal
          channel="feishu"
          channelLabel="飞书"
          isOpen={isPairingOpen}
          onApproved={() => void loadStatus()}
          onOpenChange={setIsPairingOpen}
        />
        <FeishuQrModal qr={feishuQr} isOpen={feishuQrOpen && Boolean(feishuQr)} onOpenChange={handleFeishuQrOpenChange} />

        <ConfirmDialog
          danger
          isOpen={uninstallOpen}
          title="卸载飞书插件？"
          body="这会卸载 openclaw-lark 插件并清理 channels.feishu 配置残留。"
          confirmLabel="确认卸载"
          onOpenChange={setUninstallOpen}
          onConfirm={() => {
            setUninstallOpen(false)
            startStream('uninstall', getOpenClawFeishuUninstallStreamURL())
          }}
        />

        <FeishuAccountModal
          agentOptions={agentOptions}
          form={form}
          isOpen={manualAddOpen}
          isSubmitting={isTaskRunning}
          onFormChange={setForm}
          onOpenChange={setManualAddOpen}
          onSubmit={submitManualAdd}
        />

        <FeishuAccountEditModal
          account={editTarget}
          agentOptions={agentOptions}
          form={editForm}
          isOpen={Boolean(editTarget && editForm)}
          isSubmitting={editSaving}
          onFormChange={setEditForm}
          onOpenChange={closeEditAccount}
          onSubmit={submitEditAccount}
        />

        <AlertDialog.Backdrop isOpen={Boolean(accountDeleteTarget)} onOpenChange={(open) => {
          if (!open && !accountDeleting) setAccountDeleteTarget(null)
        }}>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-[480px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>删除飞书账号？</AlertDialog.Heading>
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

function FeishuNotInstalledCard() {
  return (
    <Card>
      <Card.Content>
        <div className="flex flex-col items-center px-6 py-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-surface-secondary/50 text-muted">
            <Icon icon="lucide:package-x" className="size-7" />
          </div>
          <Card.Title className="mt-4 text-lg">飞书插件未安装</Card.Title>
          <Card.Description className="mt-2 max-w-xl leading-6">
            安装飞书插件后，可以在这里添加机器人账号并配置消息接入。
          </Card.Description>
        </div>
      </Card.Content>
    </Card>
  )
}

function FeishuEmptyAccountsCard() {
  return (
    <Card>
      <Card.Content>
        <div className="flex flex-col items-center px-6 py-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-surface-secondary/50 text-muted">
            <Icon icon="icon-park-outline:lark" className="size-7" />
          </div>
          <Card.Title className="mt-4 text-lg">还没有飞书账号</Card.Title>
          <Card.Description className="mt-2 max-w-xl leading-6">
            添加一个飞书机器人账号后，就可以配置路由 Agent、启用状态和消息接入策略。
          </Card.Description>
        </div>
      </Card.Content>
    </Card>
  )
}

function FeishuAccountCard({
  account,
  agentOptions,
  draft,
  isDisabled,
  isSaving,
  onChange,
  onDelete,
  onEdit,
}: {
  account: OpenClawFeishuAccount
  agentOptions: AgentOption[]
  draft: FeishuAccountDraft
  isDisabled: boolean
  isSaving: boolean
  onChange: (patch: Partial<FeishuAccountDraft>) => void
  onDelete: (account: OpenClawFeishuAccount) => void
  onEdit: (account: OpenClawFeishuAccount) => void
}) {
  const selectedAgent = agentOptions.find((option) => option.value === draft.agentId) ?? agentOptions[0]
  return (
    <Card>
      <Card.Content>
        <div className="flex gap-4 items-center justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div
              className={`flex size-11 shrink-0 items-center justify-center rounded-full ${draft.enabled ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}
              aria-label={draft.enabled ? '运行中' : '已停止'}
              title={draft.enabled ? '运行中' : '已停止'}
            >
              <Icon icon="icon-park-outline:lark" className="size-6" />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Card.Title className="text-base">{account.name || account.accountId}</Card.Title>
              </div>
              <div className="grid gap-1 text-sm text-muted">
                {account.appId ? <InfoLine icon="lucide:key-round" mono value={account.appId} /> : <InfoLine icon="lucide:key-round" value="未写入 App ID" />}
                {/* <InfoLine icon="lucide:shield-check" value={account.configured ? '凭据已配置' : '等待 App Secret'} /> */}
              </div>
            </div>
          </div>

          {!isDisabled && !isSaving ? (
            <div className="flex shrink-0 items-center gap-2">
              <Dropdown>
                <Button size="sm" variant="tertiary" aria-label="选择绑定 Agent">
                  <Icon icon="lucide:bot" className="size-4" />
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
                className="flex p-1 bg-default rounded-full"
                size="lg"
                aria-label="启用飞书账号"
                isSelected={draft.enabled}
                onChange={(enabled) => onChange({ enabled })}
              >
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch>
              <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
              <Button isIconOnly size="sm" variant="tertiary" aria-label="编辑飞书机器人" onPress={() => onEdit(account)}>
                <Icon icon="lucide:pencil" className="size-4" />
              </Button>
              <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
              <Button isIconOnly size="sm" variant="tertiary" aria-label="删除飞书账号" onPress={() => onDelete(account)}>
                <Icon icon="lucide:trash-2" className="size-4" />
              </Button>
            </div>
          ) : null}
        </div>
      </Card.Content>
    </Card>
  )
}

function FeishuAccountModal({
  agentOptions,
  form,
  isOpen,
  isSubmitting,
  onFormChange,
  onOpenChange,
  onSubmit,
}: {
  agentOptions: AgentOption[]
  form: FeishuForm
  isOpen: boolean
  isSubmitting: boolean
  onFormChange: (form: FeishuForm) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
}) {
  const update = (patch: Partial<FeishuForm>) => onFormChange({ ...form, ...patch })
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="sm:max-w-[680px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-primary/10 text-primary">
              <Icon icon="icon-park-outline:lark" className="size-5" />
            </Modal.Icon>
            <div>
              <Modal.Heading>添加飞书机器人</Modal.Heading>
              <p className="mt-1 text-sm text-muted">写入飞书官方插件多账号配置。</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="space-y-5 p-1">
              <ItemCardGroup className="overflow-hidden">
                <ItemCardGroup.Header>
                  <ItemCardGroup.Title>机器人</ItemCardGroup.Title>
                  <ItemCardGroup.Description>保存到 channels.feishu.accounts。</ItemCardGroup.Description>
                </ItemCardGroup.Header>
                <FormItem description="用于多账号配置和路由匹配。" icon="lucide:user-round" title="账号 ID">
                  <ClearableInput value={form.accountId} disabled={isSubmitting} placeholder="default" onChange={(accountId) => update({ accountId })} />
                </FormItem>
                <FormItem description="后台显示名称。" icon="lucide:badge" title="名称">
                  <ClearableInput value={form.name} disabled={isSubmitting} placeholder="团队助手" onChange={(name) => update({ name })} />
                </FormItem>
                <FormItem description="飞书开放平台应用凭证。" icon="lucide:key-round" title="App ID">
                  <ClearableInput value={form.appId} disabled={isSubmitting} placeholder="cli_xxx" onChange={(appId) => update({ appId })} />
                </FormItem>
                <FormItem description="只写入本机 openclaw.json，不会在前端展示。" icon="lucide:lock-keyhole" title="App Secret">
                  <ClearableInput value={form.appSecret} disabled={isSubmitting} placeholder="app secret" onChange={(appSecret) => update({ appSecret })} />
                </FormItem>
                <FormItem description="选择飞书国内版或 Lark 海外版。" icon="lucide:globe-2" title="域">
                  <FriendlySelect ariaLabel="飞书域" isDisabled={isSubmitting} options={domainOptions} value={form.domain} onChange={(value) => update({ domain: String(value ?? 'feishu') })} />
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
                  <FriendlySelect ariaLabel="群聊策略" isDisabled={isSubmitting} options={groupPolicyOptions} value={form.groupPolicy} onChange={(value) => update({ groupPolicy: String(value ?? 'allowlist') })} />
                </FormItem>
                <FormItem actionClassName="w-fit" description="群消息需要 @ 机器人后才触发。" icon="lucide:at-sign" title="群聊需 @">
                  <Switch size="lg" aria-label="群聊要求提及机器人" isSelected={form.requireMention} isDisabled={isSubmitting} onChange={(requireMention) => update({ requireMention })}>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch>
                </FormItem>
              </ItemCardGroup>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={() => onOpenChange(false)}>取消</Button>
            <Button
              variant="tertiary"
              onPress={() => void openExternalUrl('https://open.feishu.cn/app')}
            >
              <Icon icon="lucide:external-link" className="size-4" />
              飞书开放平台
            </Button>
            <Button variant="primary" isPending={isSubmitting} onPress={onSubmit}>
              <Icon icon="lucide:save" className="size-4" />
              添加机器人
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function FeishuAccountEditModal({
  account,
  agentOptions,
  form,
  isOpen,
  isSubmitting,
  onFormChange,
  onOpenChange,
  onSubmit,
}: {
  account: OpenClawFeishuAccount | null
  agentOptions: AgentOption[]
  form: FeishuEditForm | null
  isOpen: boolean
  isSubmitting: boolean
  onFormChange: (form: FeishuEditForm | null) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
}) {
  const update = (patch: Partial<FeishuEditForm>) => {
    if (!form) return
    onFormChange({ ...form, ...patch })
  }

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="sm:max-w-[680px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent/10 text-accent">
              <Icon icon="icon-park-outline:lark" className="size-5" />
            </Modal.Icon>
            <div>
              <Modal.Heading>编辑飞书机器人</Modal.Heading>
              <p className="mt-1 text-sm text-muted">更新账号策略、凭据和 Agent 绑定。</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            {form ? (
              <div className="space-y-5 p-1">
                <ItemCardGroup className="overflow-hidden">
                  <ItemCardGroup.Header>
                    <ItemCardGroup.Title>机器人</ItemCardGroup.Title>
                    <ItemCardGroup.Description>{account?.accountId || '飞书机器人'}</ItemCardGroup.Description>
                  </ItemCardGroup.Header>
                  <FormItem description="后台显示名称，不影响飞书开放平台应用名称。" icon="lucide:badge" title="名称">
                    <ClearableInput value={form.name} disabled={isSubmitting} placeholder={account?.accountId || '飞书机器人'} onChange={(name) => update({ name })} />
                  </FormItem>
                  <FormItem actionClassName="w-fit" description="控制该机器人是否参与消息处理。" icon="lucide:power" title="启用">
                    <Switch size="lg" aria-label="启用飞书机器人" isSelected={form.enabled} isDisabled={isSubmitting} onChange={(enabled) => update({ enabled })}>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                    </Switch>
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
                    <ItemCardGroup.Title>凭据</ItemCardGroup.Title>
                    <ItemCardGroup.Description>更新飞书开放平台应用凭证。</ItemCardGroup.Description>
                  </ItemCardGroup.Header>
                  <FormItem description="飞书开放平台应用 App ID。" icon="lucide:key-round" title="App ID">
                    <ClearableInput value={form.appId} disabled={isSubmitting} placeholder="cli_xxx" onChange={(appId) => update({ appId })} />
                  </FormItem>
                  <FormItem description="留空则不修改现有 App Secret。" icon="lucide:lock-keyhole" title="App Secret">
                    <ClearableInput value={form.appSecret} disabled={isSubmitting} placeholder={account?.appSecretConfigured ? '已配置，留空不修改' : 'app secret'} onChange={(appSecret) => update({ appSecret })} />
                  </FormItem>
                  <FormItem description="选择飞书国内版或 Lark 海外版。" icon="lucide:globe-2" title="域">
                    <FriendlySelect ariaLabel="飞书域" isDisabled={isSubmitting} options={domainOptions} value={form.domain} onChange={(value) => update({ domain: String(value ?? 'feishu') })} />
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
                  <FormItem description="私聊白名单 Open ID，多个用逗号、空格或换行分隔。" icon="lucide:user-check" title="私聊白名单">
                    <ClearableInput value={form.allowFromText} disabled={isSubmitting} placeholder="ou_xxx, ou_yyy" onChange={(allowFromText) => update({ allowFromText })} />
                  </FormItem>
                  <FormItem description="群聊准入策略。" icon="lucide:messages-square" title="群聊策略">
                    <FriendlySelect ariaLabel="群聊策略" isDisabled={isSubmitting} options={groupPolicyOptions} value={form.groupPolicy} onChange={(value) => update({ groupPolicy: String(value ?? 'allowlist') })} />
                  </FormItem>
                  <FormItem description="群聊白名单 Open ID，多个用逗号、空格或换行分隔。" icon="lucide:users-round" title="群聊白名单">
                    <ClearableInput value={form.groupAllowFromText} disabled={isSubmitting} placeholder="ou_xxx, ou_yyy" onChange={(groupAllowFromText) => update({ groupAllowFromText })} />
                  </FormItem>
                  <FormItem actionClassName="w-fit" description="群消息需要 @ 机器人后才触发。" icon="lucide:at-sign" title="群聊需 @">
                    <Switch size="lg" aria-label="群聊要求提及机器人" isSelected={form.requireMention} isDisabled={isSubmitting} onChange={(requireMention) => update({ requireMention })}>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                    </Switch>
                  </FormItem>
                </ItemCardGroup>
              </div>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" isDisabled={isSubmitting} onPress={() => onOpenChange(false)}>取消</Button>
            <Button
              variant="tertiary"
              isDisabled={isSubmitting}
              onPress={() => void openExternalUrl('https://open.feishu.cn/app')}
            >
              <Icon icon="lucide:external-link" className="size-4" />
              飞书开放平台
            </Button>
            <Button variant="primary" isPending={isSubmitting} onPress={onSubmit}>
              <Icon icon="lucide:save" className="size-4" />
              保存修改
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function ConfirmDialog({ body, confirmLabel, danger, isOpen, onConfirm, onOpenChange, title }: { body: string; confirmLabel: string; danger: boolean; isOpen: boolean; onConfirm: () => void; onOpenChange: (open: boolean) => void; title: string }) {
  return (
    <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[480px]">
          <AlertDialog.CloseTrigger />
          <AlertDialog.Header>
            <AlertDialog.Icon status={danger ? 'danger' : 'warning'} />
            <AlertDialog.Heading>{title}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p className="text-sm leading-6 text-muted">{body}</p>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="tertiary">取消</Button>
            <Button variant={danger ? 'danger' : 'primary'} onPress={onConfirm}>
              <Icon icon={danger ? 'lucide:trash-2' : 'lucide:play'} />
              {confirmLabel}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}

function FormItem({ actionClassName = 'w-full w-auto', children, description, icon, title }: { actionClassName?: string; children: ReactNode; description?: string; icon: string; title: string }) {
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

function ClearableInput({ disabled, onChange, placeholder, value }: { disabled?: boolean; onChange: (value: string) => void; placeholder?: string; value: string }) {
  return (
    <InputGroup fullWidth variant="secondary">
      <InputGroup.Input value={value} disabled={disabled} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      {value ? (
        <InputGroup.Suffix className="px-1 shrink-0">
          <Button isIconOnly size="sm" variant="ghost" aria-label="清空输入" isDisabled={disabled} onPress={() => onChange('')}>
            <Icon icon="lucide:x" className="size-3.5" />
          </Button>
        </InputGroup.Suffix>
      ) : null}
    </InputGroup>
  )
}

function FriendlySelect({ ariaLabel, isDisabled, onChange, options, value }: { ariaLabel: string; isDisabled?: boolean; onChange: (value: Key) => void; options: Array<{ id: string; label: string }>; value: string }) {
  const selected = options.find((option) => option.id === value) ?? options[0]
  return (
    <Dropdown>
      <Button variant="tertiary" aria-label={ariaLabel} isDisabled={isDisabled} className="w-full justify-between">
        <span className="min-w-0 truncate">{selected?.label ?? '选择'}</span>
        <Icon icon="lucide:chevron-down" className="size-4 shrink-0" />
      </Button>
      <Dropdown.Popover>
        <Dropdown.Menu selectedKeys={new Set([selected?.id ?? ''])} selectionMode="single" onAction={onChange}>
          {options.map((option) => (
            <Dropdown.Item key={option.id} id={option.id} textValue={option.label}>
              <Dropdown.ItemIndicator />
              <span className="min-w-0 truncate">{option.label}</span>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function StatusItemList({ items }: { items: Array<{ action?: ReactNode; description: string; icon: string; loading: boolean; ok: boolean; title: string }> }) {
  return (
    <div className="mb-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item, index) => (
        <ItemCard key={`${item.title}-${index}`}>
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

function InfoLine({ icon, mono, value }: { icon: string; mono?: boolean; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon icon={icon} className="size-3.5 shrink-0" />
      <span className={`min-w-0 break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

function FeishuQrModal({ isOpen, onOpenChange, qr }: { isOpen: boolean; onOpenChange: (open: boolean) => void; qr: { dataUrl: string; url: string } | null }) {
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
              <Modal.Icon className="bg-primary/10 text-primary">
                <Icon icon="icon-park-outline:lark" className="size-5" />
              </Modal.Icon>
              <div>
                <Modal.Heading>飞书扫码配置</Modal.Heading>
                <p className="mt-1 text-sm text-muted">使用飞书扫一扫，或通过网页选择 / 创建机器人</p>
              </div>
            </Modal.Header>
            <Modal.Body>
              {qr ? (
                <div className="flex flex-col items-center gap-4 py-4">
                  <div className="rounded-xl bg-white p-4">
                    <img src={qr.dataUrl} alt="飞书配置二维码" className="size-[280px]" />
                  </div>
                  <p className="text-center text-sm leading-6 text-muted">无法扫码时，可打开飞书开放平台完成网页授权。</p>
                </div>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button className="w-full" variant="primary" onPress={openWebAuth} isDisabled={!qr?.url}>
                <Icon icon="lucide:external-link" className="size-4" />
                网页授权
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
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

function buildAccountDrafts(accounts: OpenClawFeishuAccount[]) {
  return accounts.reduce<Record<string, FeishuAccountDraft>>((drafts, account) => {
    drafts[account.accountId] = getAccountDraft({}, account.accountId, account)
    return drafts
  }, {})
}

function buildEditForm(account: OpenClawFeishuAccount): FeishuEditForm {
  return {
    agentId: account.agentId ?? '',
    allowFromText: (account.allowFrom ?? []).join(', '),
    appId: account.appId ?? '',
    appSecret: '',
    dmPolicy: account.dmPolicy || 'pairing',
    domain: account.domain || 'feishu',
    enabled: account.enabled !== false,
    groupAllowFromText: (account.groupAllowFrom ?? []).join(', '),
    groupPolicy: account.groupPolicy || 'allowlist',
    name: account.name ?? '',
    requireMention: Boolean(account.requireMention),
  }
}

function getAccountDraft(drafts: Record<string, FeishuAccountDraft>, accountId: string, account?: OpenClawFeishuAccount): FeishuAccountDraft {
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

function parseListInput(value: string) {
  const seen = new Set<string>()
  return value
    .split(/[\s,，;；]+/)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false
      seen.add(item)
      return true
    })
}

function taskTitle(kind: TaskKind | null) {
  switch (kind) {
    case 'add':
      return '添加飞书机器人'
    case 'doctor':
      return '飞书插件诊断'
    case 'install':
      return '安装飞书插件'
    case 'scan':
      return '扫码添加飞书机器人'
    case 'uninstall':
      return '卸载飞书插件'
    default:
      return '飞书渠道任务'
  }
}

function taskDoneMessage(kind: TaskKind | null) {
  switch (kind) {
    case 'add':
      return '飞书机器人已添加'
    case 'doctor':
      return '飞书诊断完成'
    case 'install':
      return '飞书插件安装流程完成'
    case 'scan':
      return '飞书扫码添加完成'
    case 'uninstall':
      return '飞书插件卸载完成'
    default:
      return '飞书渠道任务完成'
  }
}

function channelFlagMessage(key: string, enabled: boolean) {
  switch (key) {
    case 'enabled':
      return enabled ? '飞书渠道已启用' : '飞书渠道已停用'
    case 'streaming':
      return enabled ? '飞书流式输出已开启' : '飞书流式输出已关闭'
    case 'threadSession':
      return enabled ? '话题独立上下文已开启' : '话题独立上下文已关闭'
    case 'footerStatus':
      return enabled ? '页脚状态已开启' : '页脚状态已关闭'
    case 'footerElapsed':
      return enabled ? '页脚耗时已开启' : '页脚耗时已关闭'
    case 'requireMention':
      return enabled ? '群聊需要 @ 已开启' : '群聊需要 @ 已关闭'
    default:
      return '飞书渠道配置已更新'
  }
}

function maskFeishuSecrets(value: string) {
  return value
    .replace(/(appSecret["'=:\s]+)([A-Za-z0-9_-]{8,})/gi, '$1••••••')
    .replace(/(verificationToken["'=:\s]+)([A-Za-z0-9_-]{8,})/gi, '$1••••••')
    .replace(/(encryptKey["'=:\s]+)([A-Za-z0-9_-]{8,})/gi, '$1••••••')
}

function extractFeishuQrUrl(line: string) {
  const cleanLine = stripAnsi(line)
  const match = cleanLine.match(/https:\/\/(?:open\.)?(?:feishu|larksuite|larkoffice)\.[^\s)）\],;，；]+/i)
  if (!match) return ''
  const url = match[0].replace(/[)。）\],;，；]+$/, '')
  if (!/oauth|verification|authorize|auth|app|onboard/i.test(url)) return ''
  return url
}

function stripAnsi(value: string) {
  return value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g'), '')
}

function OpenClawFeishuPage() {
  usePageTitle('OpenClaw 飞书渠道')

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <OpenClawFeishuPanel />
      </div>
    </DashboardLayout>
  )
}

export default OpenClawFeishuPage
