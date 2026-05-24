import { useCallback, useEffect, useState } from 'react'
import { Button, Popover, Spinner, toast } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getOpenClawConfig, resolveOpenClawGatewayWebSocketURL, restartOpenClawGateway, stopOpenClawGateway, OpenClawGatewayClient } from '@/api'
import { useOpenClawEnvironmentStore } from '@/stores/openclaw-environment'

type CapsuleState = 'checking' | 'disconnected' | 'not-installed' | 'running'
type CapsuleSnapshot = {
  detail: string
  state: CapsuleState
}
const reconnectDelayMs = 5_000
const snapshotListeners = new Set<(snapshot: CapsuleSnapshot) => void>()

let gatewayClient: OpenClawGatewayClient | null = null
let gatewayConnectionUnsubscribe: (() => void) | null = null
let gatewayReconnectTimer: number | null = null
let gatewayStartPromise: Promise<void> | null = null
let gatewayMonitorStarted = false
let capsuleSnapshot: CapsuleSnapshot = {
  detail: '正在连接 Gateway',
  state: 'checking',
}

function OpenClawStatusCapsule() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [snapshot, setSnapshot] = useState<CapsuleSnapshot>(() => capsuleSnapshot)
  const [actionState, setActionState] = useState<'idle' | 'restarting' | 'stopping' | 'refreshing'>('idle')
  const [isPopoverOpen, setPopoverOpen] = useState(false)

  useEffect(() => {
    snapshotListeners.add(setSnapshot)
    ensureGatewayMonitor()

    const handleStatusRefresh = () => {
      void refreshGatewayMonitor()
    }
    window.addEventListener('openclaw:status-refresh', handleStatusRefresh)

    return () => {
      snapshotListeners.delete(setSnapshot)
      window.removeEventListener('openclaw:status-refresh', handleStatusRefresh)
    }
  }, [])

  const { detail, state } = snapshot
  const isRunning = state === 'running'
  const isChecking = state === 'checking'
  const isDisconnected = state === 'disconnected'
  const isInstalled = state !== 'not-installed'
  const isRestarting = actionState === 'restarting'
  const isStopping = actionState === 'stopping'
  const isRefreshing = actionState === 'refreshing'
  const statusLabel = isRunning ? 'RUNNING' : isChecking ? 'CHECKING' : isDisconnected ? '网关状态异常' : 'STOPPED'
  const statusAriaLabel = isRunning ? '运行中' : isChecking ? '检测中' : isDisconnected ? '网关状态异常' : '未安装'
  const displayDetail = isRunning || isChecking ? detail : 'OpenClaw环境异常'

  const refreshStatus = useCallback(async () => {
    setActionState('refreshing')
    try {
      await refreshGatewayMonitor()
      toast.success('Gateway 状态已刷新')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'Gateway 状态刷新失败')
    } finally {
      setActionState('idle')
    }
  }, [])

  const restartGateway = useCallback(async () => {
    setActionState('restarting')
    try {
      await restartOpenClawGateway()
      toast.success('Gateway 重启完成')
      await refreshGatewayMonitor()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'Gateway 重启失败')
    } finally {
      setActionState('idle')
    }
  }, [])

  const stopGateway = useCallback(async () => {
    setActionState('stopping')
    try {
      await stopOpenClawGateway()
      toast.success('Gateway 已停止运行')
      await refreshGatewayMonitor()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'Gateway 停止失败')
    } finally {
      setActionState('idle')
    }
  }, [])

  return (
    <div className="flex items-center gap-2 shrink-0">
      {isRunning && pathname !== '/openclaw-chat' ? (
        <Button className="flex-1" size="sm" variant="tertiary" onPress={() => navigate('/openclaw-chat')}>
          <Icon icon="lucide:messages-square" className="size-4" />
          Chat
        </Button>
      ) : null}

      <Popover isOpen={isPopoverOpen} onOpenChange={setPopoverOpen}>
        <Popover.Trigger>
          <button
            aria-label={`OpenClaw ${statusAriaLabel}`}
            className={`h-8 cursor-pointer items-center gap-2 rounded-[calc(var(--radius)_*_2.5)] px-3 transition-colors sm:inline-flex ${isRunning
              ? 'bg-default text-foreground'
              : isChecking
                ? 'border border-warning/30 bg-warning/10 text-warning'
                : isDisconnected
                  ? 'border border-danger/30 bg-danger/10 text-danger hover:bg-danger/15'
                  : 'bg-danger text-danger-foreground hover:bg-danger/90'
              }`}
            title={displayDetail}
            type="button"
          >
            <OpenClawGatewayIndicator state={state} size="sm" />
            <span className="text-xs font-bold">{statusLabel}</span>
          </button>
        </Popover.Trigger>

        <Popover.Content className="w-72" offset={8} placement="bottom">
          <Popover.Dialog className="p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <OpenClawGatewayIndicator state={state} className="mt-0.5" />
                <div className="min-w-0">
                  <Popover.Heading className="text-sm font-semibold text-foreground">OpenClaw Gateway</Popover.Heading>
                  <div className="line-clamp-2 text-xs leading-5 text-muted" title={displayDetail}>{displayDetail}</div>
                </div>
              </div>
              <Button isIconOnly size="sm" variant="tertiary" isPending={isRefreshing} isDisabled={isRestarting || isStopping} onPress={refreshStatus}>
                {({ isPending }) => (
                  <>
                    {isPending ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:refresh-cw" className="size-4" />}
                  </>
                )}
              </Button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              {isInstalled ? (
                <>
                  <Button className="flex-1" size="sm" variant="primary" isPending={isRestarting} isDisabled={isStopping || isRefreshing} onPress={restartGateway}>
                    {({ isPending }) => (
                      <>
                        {isPending ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:rotate-ccw" className="size-4" />}
                        重启
                      </>
                    )}
                  </Button>
                  <Button className="flex-1" size="sm" variant="danger" isPending={isStopping} isDisabled={!isRunning || isRestarting || isRefreshing} onPress={stopGateway}>
                    {({ isPending }) => (
                      <>
                        {isPending ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:square" className="size-4" />}
                        停止
                      </>
                    )}
                  </Button>
                </>
              ) : (
                <Button className="flex-1" size="sm" variant="primary" onPress={() => navigate('/dashboard/openclaw-install')}>
                  <Icon icon="lucide:package-check" className="size-4" />
                  进入安装向导
                </Button>
              )}
            </div>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  )
}

function OpenClawGatewayIndicator({ state, size = 'md', className = '' }: { state: CapsuleState; size?: 'sm' | 'md'; className?: string }) {
  const isRunning = state === 'running'
  const isChecking = state === 'checking'
  const isDisconnected = state === 'disconnected'
  const sizeClass = size === 'sm' ? 'size-5 [&>svg]:size-3' : 'size-9 [&>svg]:size-4'
  const icon = isRunning ? 'lucide:radio-tower' : isChecking ? 'lucide:loader-circle' : 'lucide:server-off'
  const toneClass = isRunning
    ? 'bg-success shadow-[0_0_14px_color-mix(in_oklch,var(--success)_70%,transparent)] ring-success/30'
    : isChecking
      ? 'bg-warning shadow-[0_0_14px_color-mix(in_oklch,var(--warning)_70%,transparent)] ring-warning/30'
      : isDisconnected
        ? 'bg-danger shadow-[0_0_14px_color-mix(in_oklch,var(--danger)_70%,transparent)] ring-danger/30'
        : 'bg-muted ring-muted/30'

  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full text-white ring-2 ${sizeClass} ${toneClass} ${isChecking ? 'animate-pulse' : ''} ${className}`}>
      <Icon icon={icon} className={isChecking ? 'animate-spin' : ''} />
    </span>
  )
}

function ensureGatewayMonitor() {
  if (gatewayMonitorStarted) return

  gatewayMonitorStarted = true
  void connectGateway({ refresh: false, silent: true })
}

function refreshGatewayMonitor() {
  emitSnapshot({ detail: '正在刷新 Gateway 状态', state: 'checking' })
  return connectGateway({ force: true, refresh: true })
}

function emitSnapshot(snapshot: CapsuleSnapshot) {
  capsuleSnapshot = snapshot
  for (const listener of snapshotListeners) listener(snapshot)
}

function clearGatewayReconnectTimer() {
  if (gatewayReconnectTimer !== null) {
    window.clearTimeout(gatewayReconnectTimer)
    gatewayReconnectTimer = null
  }
}

function scheduleGatewayReconnect() {
  if (gatewayReconnectTimer !== null) return

  gatewayReconnectTimer = window.setTimeout(() => {
    gatewayReconnectTimer = null
    void connectGateway({ refresh: true, silent: true })
  }, reconnectDelayMs)
}

function connectGateway({ force = false, refresh = false, silent = false }: { force?: boolean; refresh?: boolean; silent?: boolean } = {}) {
  if (gatewayStartPromise && !force) return gatewayStartPromise

  gatewayStartPromise = (async () => {
    clearGatewayReconnectTimer()
    gatewayConnectionUnsubscribe?.()
    gatewayConnectionUnsubscribe = null
    gatewayClient?.close()
    gatewayClient = null

    if (!silent && capsuleSnapshot.state === 'checking') {
      emitSnapshot({ detail: '正在连接 Gateway', state: 'checking' })
    }

    try {
      const [environment, config] = await Promise.all([
        useOpenClawEnvironmentStore.getState().loadOpenClawEnvironment(refresh),
        getOpenClawConfig(),
      ])
      const gatewayUrl = resolveOpenClawGatewayWebSocketURL(environment.gateway)
      const auth = getGatewayAuth(config.content)

      if (!environment.cli.available || !environment.home.configExists || !environment.home.configValid) {
        emitSnapshot({ detail: environment.summary || 'OpenClaw 未安装或配置未就绪', state: 'not-installed' })
        return
      }

      if (!gatewayUrl) {
        throw new Error('Gateway WebSocket 地址不可用')
      }

      const nextClient = new OpenClawGatewayClient({
        password: auth.password,
        requestTimeoutMs: 10_000,
        token: auth.token,
        url: gatewayUrl,
      })

      gatewayClient = nextClient
      gatewayConnectionUnsubscribe = nextClient.onConnectionState((nextState) => {
        if (gatewayClient !== nextClient) return
        if (nextState === 'connected') {
          emitSnapshot({ detail: 'Gateway WebSocket 已连接', state: 'running' })
        } else if (nextState === 'closed' || nextState === 'error') {
          emitSnapshot({
            detail: nextState === 'error' ? 'Gateway WebSocket 连接错误' : 'Gateway WebSocket 已断开',
            state: 'disconnected',
          })
          scheduleGatewayReconnect()
        }
      })

      await nextClient.ready(10_000)
    } catch (err) {
      emitSnapshot({
        detail: err instanceof Error ? err.message : 'Gateway WebSocket 不可用',
        state: isOpenClawInstalledError(err) ? 'not-installed' : 'disconnected',
      })
      scheduleGatewayReconnect()
    } finally {
      gatewayStartPromise = null
    }
  })()

  return gatewayStartPromise
}

function isOpenClawInstalledError(err: unknown) {
  if (!(err instanceof Error)) return false
  const message = err.message.toLowerCase()
  return message.includes('openclaw') && (message.includes('not found') || message.includes('未安装') || message.includes('未检测到'))
}

function getGatewayAuth(content?: Record<string, unknown>) {
  const gateway = objectRecord(objectRecord(content).gateway)
  const auth = objectRecord(gateway.auth)
  const token = auth.token
  const password = auth.password

  return {
    password: typeof password === 'string' && password.trim() ? password.trim() : undefined,
    token: typeof token === 'string' && token.trim() ? token.trim() : undefined,
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

export default OpenClawStatusCapsule
