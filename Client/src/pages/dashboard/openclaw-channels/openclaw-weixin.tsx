import type { ReactNode, RefObject } from 'react'
import { useCallback, useMemo, useEffect, useRef, useState } from 'react'
import * as QRCode from 'qrcode'
import { AlertDialog, Alert, Button, Card, Chip, Dropdown, Modal, Skeleton, Switch, toast } from '@heroui/react'
import { ItemCard } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type {
  OpenClawAgentSummary,
  OpenClawChannelStreamError,
  OpenClawChannelStreamLog,
  OpenClawChannelStreamMeta,
  OpenClawChannelStreamStatus,
  OpenClawChannelTaskResponse,
  OpenClawWeixinAccount,
  OpenClawWeixinDMScope,
  OpenClawWeixinStatusResponse,
} from '@/api'
import {
  deleteOpenClawWeixinAccount,
  getOpenClawWeixinDMScopeStreamURL,
  getOpenClawWeixinInstallStreamURL,
  getOpenClawWeixinLoginStreamURL,
  getOpenClawWeixinStatus,
  getOpenClawWeixinUninstallStreamURL,
  listOpenClawAgents,
  updateOpenClawWeixinAccountConfig,
  updateOpenClawWeixinConfig,
} from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'

type LoadState = 'error' | 'idle' | 'loading' | 'ready'
type TaskKind = 'install' | 'login' | 'scope' | 'uninstall'

type WeixinAccountDraft = {
  agentId: string
  enabled: boolean
}

type AgentOption = {
  id: string
  label: string
  value: string
}

export function OpenClawWeixinPanel() {
  const [state, setState] = useState<LoadState>('idle')
  const [status, setStatus] = useState<OpenClawWeixinStatusResponse | null>(null)
  const [accountDrafts, setAccountDrafts] = useState<Record<string, WeixinAccountDraft>>({})
  const [agents, setAgents] = useState<OpenClawAgentSummary[]>([])
  const [savingAccountId, setSavingAccountId] = useState('')
  const [savingChannelEnabled, setSavingChannelEnabled] = useState(false)
  const [error, setError] = useState('')
  const [task, setTask] = useState<OpenClawChannelTaskResponse | null>(null)
  const [taskKind, setTaskKind] = useState<TaskKind | null>(null)
  const [loginQr, setLoginQr] = useState<{ dataUrl: string; url: string } | null>(null)
  const [loginQrOpen, setLoginQrOpen] = useState(false)
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const [accountDeleteTarget, setAccountDeleteTarget] = useState<OpenClawWeixinAccount | null>(null)
  const [accountDeleting, setAccountDeleting] = useState(false)
  const logRef = useRef<HTMLPreElement | null>(null)
  const sourceRef = useRef<EventSource | null>(null)
  const streamFinishedRef = useRef(false)
  const loginQrUrlRef = useRef('')

  const loadStatus = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const [nextStatus, nextAgents] = await Promise.all([getOpenClawWeixinStatus(), listOpenClawAgents()])
      setStatus(nextStatus)
      setAgents(nextAgents.agents ?? [])
      setAccountDrafts(buildAccountDrafts(nextStatus.accounts ?? []))
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : '微信渠道状态加载失败')
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

  const renderLoginQr = useCallback(async (url: string) => {
    if (loginQrUrlRef.current === url) return
    loginQrUrlRef.current = url
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 280,
      })
      setLoginQr({ dataUrl, url })
      setLoginQrOpen(true)
    } catch {
      toast.warning('微信登录二维码渲染失败')
    }
  }, [])

  const startStream = useCallback((kind: TaskKind, url: string) => {
    closeStream()
    streamFinishedRef.current = false
    if (kind === 'login') {
      loginQrUrlRef.current = ''
      setLoginQr(null)
      setLoginQrOpen(false)
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
        setTask((current) => current ? {
          ...current,
          id: payload.id,
          status: 'running',
          updatedAt: payload.timestamp,
        } : current)
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
          setLoginQrOpen(false)
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
        if (kind === 'login') {
          const qrUrl = extractWeixinLoginUrl(payload.line)
          if (qrUrl) void renderLoginQr(qrUrl)
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
      toast.warning('微信渠道流式任务连接中断')
      void loadStatus()
    }
  }, [closeStream, loadStatus, renderLoginQr])

  const enableIsolation = useCallback((enabled: boolean) => {
    const nextScope: OpenClawWeixinDMScope = enabled ? 'per-account-channel-peer' : 'main'
    startStream('scope', getOpenClawWeixinDMScopeStreamURL(nextScope))
  }, [startStream])

  const confirmUninstall = useCallback(() => {
    setUninstallOpen(false)
    startStream('uninstall', getOpenClawWeixinUninstallStreamURL())
  }, [startStream])

  const cancelLoginStream = useCallback(() => {
    if (taskKind !== 'login' || streamFinishedRef.current) {
      setLoginQrOpen(false)
      return
    }
    streamFinishedRef.current = true
    closeStream()
    loginQrUrlRef.current = ''
    setLoginQr(null)
    setLoginQrOpen(false)
    setTask(null)
    toast.warning('已取消微信扫码登录')
    void loadStatus()
  }, [closeStream, loadStatus, taskKind])

  const handleLoginQrOpenChange = useCallback((open: boolean) => {
    if (open) {
      setLoginQrOpen(true)
      return
    }
    cancelLoginStream()
  }, [cancelLoginStream])

  const agentOptions = useMemo(() => buildAgentOptions(agents), [agents])

  const updateChannelEnabled = useCallback(async (enabled: boolean) => {
    setSavingChannelEnabled(true)
    setStatus((current) => current ? { ...current, enabled } : current)
    try {
      const nextStatus = await updateOpenClawWeixinConfig({ enabled })
      setStatus(nextStatus)
      setAccountDrafts(buildAccountDrafts(nextStatus.accounts ?? []))
      toast.success(enabled ? '微信渠道已启用' : '微信渠道已停用')
    } catch (err) {
      void loadStatus()
      toast.warning(err instanceof Error ? err.message : '微信渠道开关更新失败')
    } finally {
      setSavingChannelEnabled(false)
    }
  }, [loadStatus])

  const updateAccount = useCallback(async (account: OpenClawWeixinAccount, patch: Partial<WeixinAccountDraft>) => {
    const draft = {
      ...getAccountDraft(accountDrafts, account.accountId, account),
      ...patch,
    }
    setAccountDrafts((current) => ({
      ...current,
      [account.accountId]: draft,
    }))
    setSavingAccountId(account.accountId)
    try {
      const nextStatus = await updateOpenClawWeixinAccountConfig(account.accountId, {
        agentId: draft.agentId,
        enabled: draft.enabled,
      })
      setStatus(nextStatus)
      setAccountDrafts(buildAccountDrafts(nextStatus.accounts ?? []))
      toast.success('微信账号配置已更新')
    } catch (err) {
      setAccountDrafts(buildAccountDrafts(status?.accounts ?? []))
      toast.warning(err instanceof Error ? err.message : '微信账号配置更新失败')
    } finally {
      setSavingAccountId('')
    }
  }, [accountDrafts, status?.accounts])

  const deleteAccount = useCallback(async () => {
    if (!accountDeleteTarget) return
    setAccountDeleting(true)
    try {
      await deleteOpenClawWeixinAccount(accountDeleteTarget.accountId)
      setAccountDeleteTarget(null)
      toast.success('微信账号已删除')
      void loadStatus()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '微信账号删除失败')
    } finally {
      setAccountDeleting(false)
    }
  }, [accountDeleteTarget, loadStatus])

  const isLoading = state === 'loading' && !status
  const isTaskRunning = Boolean(task && task.status !== 'done' && task.status !== 'error')
  const dmScopeIsolated = status?.dmScope === 'per-account-channel-peer'
  const installed = Boolean(status?.installed)
  const accounts = status?.accounts ?? []

  return (
    <>
      {error ? (
        <div className=" py-3 w-full">
          <Alert status="danger" className='items-center'>
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>微信渠道状态加载失败</Alert.Title>
              <Alert.Description>
                请检查微信渠道状态和网关运行状态。
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
            <div className="flex w-full gap-4 justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <Icon icon="ri:wechat-fill" className="size-7" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Card.Title>微信</Card.Title>
                    {/* {isLoading ? <Skeleton className="h-6 w-20" /> : <Chip color={tone.color} variant="soft">{statusText}</Chip>} */}
                  </div>
                  <Card.Description>
                    将 OpenClaw 接入微信，与你的微信账号联动。
                  </Card.Description>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {state !== 'loading' && !isTaskRunning ? (
                  <Button size="sm" isIconOnly variant={state === 'error' ? 'primary' : 'ghost'} aria-label="刷新微信渠道状态" onPress={() => void loadStatus()}>
                    <Icon icon="lucide:refresh-cw" />
                  </Button>
                ) : null}
                {!installed && !isTaskRunning ? (
                  <Button size="sm" variant="primary" onPress={() => startStream('install', getOpenClawWeixinInstallStreamURL())}>
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
                  <Button size="sm" variant="primary" onPress={() => startStream('login', getOpenClawWeixinLoginStreamURL())}>
                    <Icon icon="lucide:qr-code" />
                    添加账号
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
              description: status?.enabled ? '微信渠道已启用' : '微信渠道已停用',
              icon: 'lucide:user-check',
              loading: isLoading,
              ok: Boolean(status?.enabled),
              title: '运行状态',
            },
            {
              action: (
                <Switch
                  size="lg"
                  aria-label="切换多账号上下文隔离"
                  isSelected={dmScopeIsolated}
                  isDisabled={isTaskRunning || isLoading}
                  onChange={enableIsolation}
                >
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch>
              ),
              description: dmScopeIsolated ? '按账号和会话隔离上下文' : '当前使用主会话上下文',
              icon: 'lucide:split',
              loading: isLoading,
              ok: dmScopeIsolated,
              title: '上下文隔离',
            },
            {
              action: (
                <Switch
                  size="lg"
                  aria-label="切换微信渠道总开关"
                  isSelected={Boolean(status?.enabled)}
                  isDisabled={!installed || isTaskRunning || isLoading || savingChannelEnabled}
                  onChange={(enabled) => void updateChannelEnabled(enabled)}
                >
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch>
              ),
              description: status?.enabled ? '微信渠道已启用' : '微信渠道已停用',
              icon: 'lucide:power',
              loading: isLoading,
              ok: Boolean(status?.enabled),
              title: '启用状态',
            },
          ]}
        />

        {installed ? (
          accounts.length > 0 ? (
            <div className="grid gap-2 lg:grid-cols-2">
              {accounts.map((account) => (
                <WeixinAccountCard
                  key={account.accountId}
                  account={account}
                  agentOptions={agentOptions}
                  draft={getAccountDraft(accountDrafts, account.accountId, account)}
                  isDisabled={isLoading || isTaskRunning}
                  isSaving={savingAccountId === account.accountId}
                  onChange={(patch) => void updateAccount(account, patch)}
                  onDelete={setAccountDeleteTarget}
                />
              ))}
            </div>
          ) : (
            <ChannelEmptyState
              description="登录一个微信账号后，就可以配置路由 Agent、启用状态和消息接入策略。"
              icon="ri:wechat-fill"
              title="还没有微信账号"
            />
          )
        ) : (
          <ChannelEmptyState
            description="安装微信插件后，可以在这里登录账号并配置消息接入。"
            icon="lucide:package-x"
            title="微信插件未安装"
          />
        )}
        {status?.openClawError ? (
          <div className="mt-4 rounded-xl bg-warning/10 p-3 text-sm leading-6 text-warning">
            {status.openClawError}
          </div>
        ) : null}


        <TaskLogPanel task={task} taskKind={taskKind} logRef={logRef} onClose={() => setTask(null)} />

        <WeixinLoginQrModal qr={loginQr} isOpen={loginQrOpen && Boolean(loginQr)} onOpenChange={handleLoginQrOpenChange} />

        <AlertDialog.Backdrop isOpen={uninstallOpen} onOpenChange={setUninstallOpen}>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-[480px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>卸载微信插件？</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-sm leading-6 text-muted">
                  这会执行微信插件卸载，并清理插件配置残留。
                </p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary">取消</Button>
                <Button variant="danger" onPress={confirmUninstall}>
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
                <AlertDialog.Heading>删除微信账号？</AlertDialog.Heading>
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

function WeixinAccountCard({
  account,
  agentOptions,
  draft,
  isDisabled,
  isSaving,
  onChange,
  onDelete,
}: {
  account: OpenClawWeixinAccount
  agentOptions: AgentOption[]
  draft: WeixinAccountDraft
  isDisabled: boolean
  isSaving: boolean
  onChange: (patch: Partial<WeixinAccountDraft>) => void
  onDelete: (account: OpenClawWeixinAccount) => void
}) {
  const selectedAgent = agentOptions.find((option) => option.value === draft.agentId) ?? agentOptions[0]
  return (
    <Card>
      <Card.Content>
        <div className="flex gap-4 items-center justify-between">

          <div className="flex items-center gap-4">
            <div
              className={`flex size-11 shrink-0 items-center justify-center rounded-full ${draft.enabled ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}
              aria-label={draft.enabled ? '运行中' : '已停止'}
              title={draft.enabled ? '运行中' : '已停止'}
            >
              <Icon icon="ri:wechat-fill" className="size-6" />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Card.Title className="text-base">{account.name || account.accountId}</Card.Title>
              </div>
              <div className="grid gap-2 text-sm text-muted">
                {account.savedAt ? <InfoLine icon="lucide:clock-3" value={formatAccountTime(account.savedAt)} /> : null}
              </div>
            </div>
          </div>

          <div className="flex gap-2 items-center">
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
            <div className="flex p-1 bg-default rounded-full">
              <Switch
                size="lg"
                aria-label="启用微信账号"
                isSelected={draft.enabled}
                isDisabled={isDisabled || isSaving}
                onChange={(enabled) => onChange({ enabled })}
              >
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch>
            </div>

            <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            <Button isIconOnly size="sm" variant="tertiary" aria-label="删除微信账号" onPress={() => onDelete(account)} isDisabled={isDisabled || isSaving}>
              <Icon icon="lucide:trash-2" className="size-4" />
            </Button>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function WeixinLoginQrModal({ isOpen, onOpenChange, qr }: { isOpen: boolean; onOpenChange: (open: boolean) => void; qr: { dataUrl: string; url: string } | null }) {
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
                <Modal.Heading>微信扫码登录</Modal.Heading>
                <p className="mt-1 text-sm text-muted">使用微信扫一扫进行登录</p>
              </div>
            </Modal.Header>
            <Modal.Body>
              {qr ? (
                <div className="flex flex-col items-center gap-4 py-4">
                  <div className="rounded-xl bg-white p-4">
                    <img src={qr.dataUrl} alt="微信登录二维码" className="size-[280px]" />
                  </div>
                  {/* <a className="max-w-full break-all rounded-lg bg-surface-secondary/50 px-3 py-2 font-mono text-xs leading-5 text-muted" href={qr.url} target="_blank" rel="noreferrer">
                    {qr.url}
                  </a> */}
                </div>
              ) : null}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

function OpenClawWeixinPage() {
  usePageTitle('OpenClaw 微信渠道')

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <OpenClawWeixinPanel />
      </div>
    </DashboardLayout>
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

function buildAccountDrafts(accounts: OpenClawWeixinAccount[]) {
  return accounts.reduce<Record<string, WeixinAccountDraft>>((drafts, account) => {
    drafts[account.accountId] = getAccountDraft({}, account.accountId, account)
    return drafts
  }, {})
}

function getAccountDraft(drafts: Record<string, WeixinAccountDraft>, accountId: string, account?: OpenClawWeixinAccount): WeixinAccountDraft {
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
    if (!id) continue
    if (seen.has(id)) continue
    seen.add(id)
    options.push({ id: `agent:${id}`, label: agent.name || agent.identity?.name || id, value: id })
  }
  return options
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

  return date.toLocaleDateString('zh-CN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function extractWeixinLoginUrl(line: string) {
  return line.match(/https:\/\/liteapp\.weixin\.qq\.com\/q\/\S+/)?.[0]?.replace(/[)。）\],;，；]+$/, '') ?? ''
}

function taskTitle(kind: TaskKind | null) {
  switch (kind) {
    case 'install':
      return '安装微信插件'
    case 'login':
      return '扫码登录微信'
    case 'scope':
      return '更新上下文隔离'
    case 'uninstall':
      return '卸载微信插件'
    default:
      return '微信渠道任务'
  }
}

function taskDoneMessage(kind: TaskKind | null) {
  switch (kind) {
    case 'install':
      return '微信插件安装完成'
    case 'login':
      return '微信扫码登录完成'
    case 'scope':
      return '上下文隔离已更新'
    case 'uninstall':
      return '微信插件卸载完成'
    default:
      return '微信渠道任务完成'
  }
}

export default OpenClawWeixinPage
