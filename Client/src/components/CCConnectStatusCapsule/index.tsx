import { useCallback, useEffect, useState } from 'react'
import { Button, Popover, Spinner, toast } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useNavigate } from 'react-router-dom'
import type { CCConnectEnvironmentResponse } from '@/api'
import { restartCCConnectDaemon, startCCConnectDaemon, stopCCConnectDaemon } from '@/api'
import { useCCConnectEnvironmentStore } from '@/stores/cc-connect-environment'

type CapsuleState = 'checking' | 'disconnected' | 'not-installed' | 'running' | 'stopped'
type CapsuleSnapshot = {
  detail: string
  managementLabel: string
  state: CapsuleState
}

const snapshotListeners = new Set<(snapshot: CapsuleSnapshot) => void>()

let capsuleSnapshot: CapsuleSnapshot = {
  detail: '正在检测 CC-Connect 状态',
  managementLabel: '-',
  state: 'checking',
}
let environmentMonitorStarted = false
let environmentRefreshPromise: Promise<void> | null = null

function CCConnectStatusCapsule() {
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState<CapsuleSnapshot>(() => capsuleSnapshot)
  const [actionState, setActionState] = useState<'idle' | 'refreshing' | 'restarting' | 'starting' | 'stopping'>('idle')
  const [isPopoverOpen, setPopoverOpen] = useState(false)

  useEffect(() => {
    snapshotListeners.add(setSnapshot)
    ensureEnvironmentMonitor()

    const handleStatusRefresh = () => {
      void refreshEnvironmentMonitor()
    }
    window.addEventListener('cc-connect:status-refresh', handleStatusRefresh)

    return () => {
      snapshotListeners.delete(setSnapshot)
      window.removeEventListener('cc-connect:status-refresh', handleStatusRefresh)
    }
  }, [])

  const { detail, managementLabel, state } = snapshot
  const isRunning = state === 'running'
  const isChecking = state === 'checking'
  const isDisconnected = state === 'disconnected'
  const isInstalled = state !== 'not-installed'
  const isStopped = state === 'stopped'
  const isRefreshing = actionState === 'refreshing'
  const isRestarting = actionState === 'restarting'
  const isStarting = actionState === 'starting'
  const isStopping = actionState === 'stopping'
  const statusLabel = isRunning ? 'RUNNING' : isChecking ? 'CHECKING' : isDisconnected ? '服务异常' : isStopped ? 'STOPPED' : '未安装'
  const statusAriaLabel = isRunning ? '运行中' : isChecking ? '检测中' : isDisconnected ? '服务异常' : isStopped ? '已停止' : '未安装'
  const displayDetail = detail || 'CC-Connect 状态不可用'
  const displaySummary = displayDetail

  const refreshStatus = useCallback(async () => {
    setActionState('refreshing')
    try {
      await refreshEnvironmentMonitor()
      toast.success('CC-Connect 状态已刷新')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'CC-Connect 状态刷新失败')
    } finally {
      setActionState('idle')
    }
  }, [])

  const startService = useCallback(async () => {
    setActionState('starting')
    try {
      await startCCConnectDaemon()
      toast.success('CC-Connect daemon 已启动')
      await refreshEnvironmentMonitor()
      window.dispatchEvent(new CustomEvent('cc-connect:status-refresh'))
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'CC-Connect daemon 启动失败')
    } finally {
      setActionState('idle')
    }
  }, [])

  const restartService = useCallback(async () => {
    setActionState('restarting')
    try {
      await restartCCConnectDaemon()
      toast.success('CC-Connect daemon 已重启')
      await refreshEnvironmentMonitor()
      window.dispatchEvent(new CustomEvent('cc-connect:status-refresh'))
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'CC-Connect daemon 重启失败')
    } finally {
      setActionState('idle')
    }
  }, [])

  const stopService = useCallback(async () => {
    setActionState('stopping')
    try {
      await stopCCConnectDaemon()
      toast.success('CC-Connect daemon 已停止')
      await refreshEnvironmentMonitor()
      window.dispatchEvent(new CustomEvent('cc-connect:status-refresh'))
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'CC-Connect daemon 停止失败')
    } finally {
      setActionState('idle')
    }
  }, [])

  const openInstall = useCallback(() => {
    setPopoverOpen(false)
    navigate('/dashboard/cc-install')
  }, [navigate])

  return (
    <Popover isOpen={isPopoverOpen} onOpenChange={setPopoverOpen}>
      <Popover.Trigger>
        <button
          aria-label={`CC-Connect ${statusAriaLabel}`}
          className={`hidden h-8 cursor-pointer items-center gap-2 rounded-[calc(var(--radius)_*_2.5)] px-3 transition-colors sm:inline-flex ${isRunning
            ? 'bg-default text-foreground'
            : isChecking
              ? 'border border-warning/30 bg-warning/10 text-warning'
              : isDisconnected
                ? 'border border-danger/30 bg-danger/10 text-danger hover:bg-danger/15'
                : isStopped
                  ? 'border border-warning/30 bg-warning/10 text-warning hover:bg-warning/15'
                  : 'bg-danger text-danger-foreground hover:bg-danger/90'
            }`}
          title={displaySummary}
          type="button"
        >
          <CCConnectIndicator state={state} size="sm" />
          <span className="text-xs font-bold">{statusLabel}</span>
        </button>
      </Popover.Trigger>

      <Popover.Content className="w-80" offset={8} placement="bottom">
        <Popover.Dialog className="p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <CCConnectIndicator state={state} className="mt-0.5" />
              <div className="min-w-0">
                <Popover.Heading className="text-sm font-semibold text-foreground">CC-Connect Service</Popover.Heading>
                <div className="line-clamp-2 text-xs leading-5 text-muted" title={displaySummary}>{displaySummary}</div>
                <div className="mt-1 truncate text-[11px] text-muted" title={managementLabel}>Management: {managementLabel}</div>
              </div>
            </div>
            <Button isIconOnly size="sm" variant="tertiary" isPending={isRefreshing} isDisabled={isRestarting || isStarting || isStopping} onPress={refreshStatus}>
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
                {isRunning ? (
                  <Button className="flex-1" size="sm" variant="primary" isPending={isRestarting} isDisabled={actionState !== 'idle'} onPress={restartService}>
                    {({ isPending }) => (
                      <>
                        {isPending ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:rotate-ccw" className="size-4" />}
                        重启
                      </>
                    )}
                  </Button>
                ) : (
                  <Button className="flex-1" size="sm" variant="primary" isPending={isStarting} isDisabled={actionState !== 'idle'} onPress={startService}>
                    {({ isPending }) => (
                      <>
                        {isPending ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:play" className="size-4" />}
                        启动
                      </>
                    )}
                  </Button>
                )}
                <Button className="flex-1" size="sm" variant="danger" isPending={isStopping} isDisabled={!isRunning || actionState !== 'idle'} onPress={stopService}>
                  {({ isPending }) => (
                    <>
                      {isPending ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:square" className="size-4" />}
                      停止
                    </>
                  )}
                </Button>
              </>
            ) : (
              <Button className="flex-1" size="sm" variant="primary" onPress={openInstall}>
                <Icon icon="lucide:package-check" className="size-4" />
                进入安装向导
              </Button>
            )}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}

function CCConnectIndicator({ state, size = 'md', className = '' }: { state: CapsuleState; size?: 'sm' | 'md'; className?: string }) {
  const isRunning = state === 'running'
  const isChecking = state === 'checking'
  const isDisconnected = state === 'disconnected'
  const isStopped = state === 'stopped'
  const sizeClass = size === 'sm' ? 'size-5 [&>svg]:size-3' : 'size-9 [&>svg]:size-4'
  const icon = isRunning ? 'lucide:radio-tower' : isChecking ? 'lucide:loader-circle' : isStopped ? 'lucide:server-off' : 'lucide:package-x'
  const toneClass = isRunning
    ? 'bg-success shadow-[0_0_14px_color-mix(in_oklch,var(--success)_70%,transparent)] ring-success/30'
    : isChecking
      ? 'bg-warning shadow-[0_0_14px_color-mix(in_oklch,var(--warning)_70%,transparent)] ring-warning/30'
      : isDisconnected
        ? 'bg-danger shadow-[0_0_14px_color-mix(in_oklch,var(--danger)_70%,transparent)] ring-danger/30'
        : isStopped
          ? 'bg-warning ring-warning/30'
          : 'bg-danger ring-danger/30'

  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full text-white ring-2 ${sizeClass} ${toneClass} ${isChecking ? 'animate-pulse' : ''} ${className}`}>
      <Icon icon={icon} className={isChecking ? 'animate-spin' : ''} />
    </span>
  )
}

function ensureEnvironmentMonitor() {
  if (environmentMonitorStarted) return

  environmentMonitorStarted = true
  void loadEnvironmentSnapshot(false)
}

function refreshEnvironmentMonitor() {
  emitSnapshot({ ...capsuleSnapshot, detail: '正在刷新 CC-Connect 状态', state: 'checking' })
  return loadEnvironmentSnapshot(true)
}

function loadEnvironmentSnapshot(refresh: boolean) {
  if (environmentRefreshPromise) return environmentRefreshPromise

  environmentRefreshPromise = useCCConnectEnvironmentStore.getState().loadCCConnectEnvironment(refresh)
    .then((environment) => {
      emitSnapshot(buildSnapshot(environment))
    })
    .catch((err) => {
      emitSnapshot({
        detail: err instanceof Error ? err.message : 'CC-Connect 状态不可用',
        managementLabel: '-',
        state: 'disconnected',
      })
    })
    .finally(() => {
      environmentRefreshPromise = null
    })

  return environmentRefreshPromise
}

function emitSnapshot(snapshot: CapsuleSnapshot) {
  capsuleSnapshot = snapshot
  for (const listener of snapshotListeners) listener(snapshot)
}

function buildSnapshot(environment: CCConnectEnvironmentResponse): CapsuleSnapshot {
  const installed = Boolean(environment.cli.available && environment.home.configExists)
  const running = Boolean(environment.runtime?.running || environment.daemon.running || environment.management.reachable)
  const managementLabel = environment.management.url || (environment.config.management.port ? `127.0.0.1:${environment.config.management.port}` : '-')

  if (!installed) {
    return {
      detail: environment.summary || 'CC-Connect 未安装或 config.toml 未就绪',
      managementLabel,
      state: 'not-installed',
    }
  }

  if (running && environment.management.reachable) {
    return {
      detail: 'CC-Connect 服务运行中',
      managementLabel,
      state: 'running',
    }
  }

  if (running) {
    return {
      detail: 'CC-Connect 服务运行中，连接状态待确认',
      managementLabel,
      state: 'running',
    }
  }

  if (environment.daemon.installed) {
    return {
      detail: 'daemon 已安装，当前未运行',
      managementLabel,
      state: 'stopped',
    }
  }

  return {
    detail: '配置已就绪，daemon 未安装',
    managementLabel,
    state: 'stopped',
  }
}

export default CCConnectStatusCapsule
