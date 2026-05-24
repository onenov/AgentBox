import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertDialog, Button, Card, Skeleton, toast } from '@heroui/react'
import { Icon } from '@iconify/react'
import type { PluginActionStreamDone, PluginActionStreamError, PluginActionStreamLog, PluginActionStreamMeta, PluginActionStreamStatus, PluginAppStatus, PluginsStatusResponse } from '@/api'
import { getPluginInstallStreamURL, listPlugins, listPluginUpdates, uninstallPlugin, updatePlugin } from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { openExternalUrl } from '@/utils/openExternalUrl'
import DashboardLayout from '@/layouts/Dashboard'

type LoadState = 'idle' | 'loading' | 'ready' | 'error'
type PluginAction = 'install' | 'update' | 'uninstall'
type PluginInstallStreamState = {
  id: string
  logs: string[]
  pluginId: string
  progress: number
  status: 'idle' | 'pending' | 'running' | 'done' | 'error'
  error?: string
}

function PluginsPage() {
  usePageTitle('应用管理')
  const [state, setState] = useState<LoadState>('idle')
  const [data, setData] = useState<PluginsStatusResponse | null>(null)
  const [error, setError] = useState('')
  const [mutating, setMutating] = useState('')
  const [pendingAction, setPendingAction] = useState<{ action: PluginAction; plugin: PluginAppStatus } | null>(null)
  const [hasCheckedUpdates, setHasCheckedUpdates] = useState(false)
  const [refreshUpdates, setRefreshUpdates] = useState(false)
  const [installStream, setInstallStream] = useState<PluginInstallStreamState | null>(null)
  const installStreamRef = useRef<EventSource | null>(null)
  const streamFinishedRef = useRef(false)

  const closeInstallStream = useCallback(() => {
    installStreamRef.current?.close()
    installStreamRef.current = null
  }, [])

  const loadData = useCallback(async (refresh = false) => {
    setState('loading')
    setError('')
    setHasCheckedUpdates(false)
    setRefreshUpdates(refresh)
    try {
      const payload = await listPlugins(refresh)
      setData(payload)
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : '应用列表加载失败')
      setState('error')
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadData()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadData])

  useEffect(() => {
    if (state !== 'ready' || hasCheckedUpdates || !data?.plugins.some((plugin) => plugin.installed && plugin.canUpdate)) return

    const timeoutId = window.setTimeout(async () => {
      setHasCheckedUpdates(true)
      try {
        const payload = await listPluginUpdates(refreshUpdates)
        setData((current) => current ? {
          ...current,
          plugins: current.plugins.map((plugin) => {
            const update = payload.updates.find((item) => item.id === plugin.id)
            return update ? { ...plugin, canUpdate: update.canUpdate, updateAvailable: update.updateAvailable } : plugin
          }),
        } : current)
      } catch {
        // Update checks are intentionally silent; keep the visible page state stable.
      }
    }, 1500)

    return () => window.clearTimeout(timeoutId)
  }, [data?.plugins, hasCheckedUpdates, refreshUpdates, state])

  useEffect(() => () => closeInstallStream(), [closeInstallStream])

  const plugins = useMemo(() => data?.plugins ?? [], [data?.plugins])
  const refreshButtonVariant = state === 'loading' ? 'danger' : state === 'error' ? 'primary' : 'ghost'
  const isLoading = state === 'loading' && !data

  const runInstallStream = useCallback((plugin: PluginAppStatus) => {
    if (mutating) return

    closeInstallStream()
    streamFinishedRef.current = false
    setMutating(`${plugin.id}:install`)
    setError('')
    setInstallStream({
      id: `plugin-install-${plugin.id}-${Date.now()}`,
      logs: [`正在连接 ${plugin.name} 安装任务。`],
      pluginId: plugin.id,
      progress: 0,
      status: 'pending',
    })

    const source = new EventSource(getPluginInstallStreamURL(plugin.id))
    installStreamRef.current = source

    source.addEventListener('meta', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as PluginActionStreamMeta
        setInstallStream((current) => current ? { ...current, id: payload.id, pluginId: payload.pluginId, status: 'running' } : current)
      } catch {
        // Ignore malformed stream metadata.
      }
    })

    source.addEventListener('status', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as PluginActionStreamStatus
        const nextStatus = payload.status === 'done' ? 'done' : payload.status === 'error' ? 'error' : 'running'
        setInstallStream((current) => current ? {
          ...current,
          error: payload.error || current.error,
          id: payload.id || current.id,
          pluginId: payload.pluginId || current.pluginId,
          progress: payload.progress,
          status: nextStatus,
        } : current)
        if (payload.status === 'done') {
          streamFinishedRef.current = true
          closeInstallStream()
          setMutating('')
          setInstallStream((current) => current ? {
            ...current,
            logs: current.logs.some((line) => line.includes('安装完成')) ? current.logs : appendInstallLog(current.logs, `${plugin.name} 安装完成。`),
            progress: 100,
            status: 'done',
          } : current)
          toast.success(`${plugin.name} 已安装`)
          void loadData(true)
          return
        }
        if (payload.status === 'error' && payload.error) {
          streamFinishedRef.current = true
          closeInstallStream()
          setMutating('')
          toast.warning(payload.error)
          void loadData(true)
        }
      } catch {
        // Ignore malformed status payload.
      }
    })

    source.addEventListener('log', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as PluginActionStreamLog
        setInstallStream((current) => current ? {
          ...current,
          id: payload.id || current.id,
          logs: appendInstallLog(current.logs, payload.line),
          pluginId: payload.pluginId || current.pluginId,
          status: current.status === 'pending' ? 'running' : current.status,
        } : current)
      } catch {
        // Ignore malformed log payload.
      }
    })

    source.addEventListener('error', (event) => {
      const raw = (event as MessageEvent).data
      if (!raw) return
      try {
        const payload = JSON.parse(raw) as PluginActionStreamError
        streamFinishedRef.current = true
        closeInstallStream()
        setMutating('')
        setInstallStream((current) => current ? {
          ...current,
          error: payload.message,
          id: payload.id || current.id,
          logs: appendInstallLog(current.logs, `失败：${payload.message}`),
          pluginId: payload.pluginId || current.pluginId,
          progress: 100,
          status: 'error',
        } : current)
        toast.warning(payload.message)
        void loadData(true)
      } catch {
        // Ignore malformed error payload.
      }
    })

    source.addEventListener('done', (event) => {
      if (streamFinishedRef.current) return
      try {
        const payload = JSON.parse((event as MessageEvent).data) as PluginActionStreamDone
        streamFinishedRef.current = true
        closeInstallStream()
        setMutating('')
        setInstallStream((current) => current ? {
          ...current,
          id: payload.id || current.id,
          logs: current.logs.some((line) => line.includes('安装完成')) ? current.logs : appendInstallLog(current.logs, `${plugin.name} 安装完成。`),
          pluginId: payload.pluginId || current.pluginId,
          progress: 100,
          status: 'done',
        } : current)
        toast.success(`${plugin.name} 已安装`)
        void loadData(true)
      } catch {
        // Ignore malformed done payload.
      }
    })

    source.onerror = () => {
      if (streamFinishedRef.current) return
      streamFinishedRef.current = true
      closeInstallStream()
      setMutating('')
      setInstallStream((current) => current ? {
        ...current,
        error: '安装流式连接中断',
        logs: appendInstallLog(current.logs, '失败：安装流式连接中断'),
        progress: 100,
        status: 'error',
      } : current)
      toast.warning(`${plugin.name} 安装流式连接中断`)
      void loadData(true)
    }
  }, [closeInstallStream, loadData, mutating])

  const runAction = useCallback(async (plugin: PluginAppStatus, action: PluginAction) => {
    if (action === 'install') {
      runInstallStream(plugin)
      return
    }
    setMutating(`${plugin.id}:${action}`)
    setError('')
    try {
      if (action === 'update') {
        await updatePlugin(plugin.id)
        toast.success(`${plugin.name} 已更新`)
      } else {
        await uninstallPlugin(plugin.id)
        toast.success(`${plugin.name} 已卸载`)
      }
      setPendingAction(null)
      await loadData(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : `${plugin.name} 操作失败`
      setError(message)
      toast.warning(message)
    } finally {
      setMutating('')
    }
  }, [loadData, runInstallStream])

  return (
    <DashboardLayout>
      <div className={error && !data ? 'flex min-h-[calc(100dvh-8rem)] items-center justify-center' : 'mx-auto flex max-w-7xl flex-col gap-6'}>
        {error && !data ? (
          <Card className="w-full max-w-md">
            <Card.Content>
              <div className="flex flex-col items-center px-6 py-8 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
                  <Icon icon="lucide:circle-alert" className="size-6" />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-foreground">无法加载应用列表</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{error}</p>
                <Button className="mt-6" variant={refreshButtonVariant} onPress={() => void loadData(true)} isDisabled={state === 'loading'}>
                  <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
                  重新加载
                </Button>
              </div>
            </Card.Content>
          </Card>
        ) : null}

        {error && data ? (
          <Card>
            <Card.Content>
              <div className="flex items-start gap-3 text-danger">
                <Icon icon="lucide:circle-alert" className="mt-0.5 size-5" />
                <div>
                  <p className="font-medium">应用操作失败</p>
                  <p className="mt-1 text-sm text-muted">{error}</p>
                </div>
              </div>
            </Card.Content>
          </Card>
        ) : null}

        {isLoading ? <PluginsSkeleton /> : null}

        {data ? (
          <>
            <section className="w-full">
              <Card variant="transparent" className="overflow-visible">
                <Card.Content className="overflow-visible">
                  <div className="md:gap-6 gap-4 flex flex-row items-center overflow-visible">
                    <div className="flex h-24 items-center justify-center shrink-0 overflow-visible p-1">
                      <img src="https://assets.orence.net/file/20260514002926244.png" alt="Extensions" className="h-full w-auto" />
                    </div>
                    <div className="flex min-w-0 flex-col gap-5 w-full">
                      <div className="min-w-0">
                        <Card.Title className="md:text-3xl text-2xl font-bold">应用管理</Card.Title>
                        <Card.Description className="mt-4 md:text-lg text-base">集中查看并管理本机已集成的第三方 AI 服务与扩展工具。</Card.Description>
                      </div>
                    </div>
                    <Button className="shrink-0" size="sm" isIconOnly variant={refreshButtonVariant} onPress={() => void loadData(true)} isDisabled={state === 'loading'}>
                      <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
                    </Button>
                  </div>
                </Card.Content>
              </Card>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              {plugins.map((plugin) => (
                <PluginAppCard
                  key={plugin.id}
                  plugin={plugin}
                  mutating={mutating}
                  onAction={(action) => setPendingAction({ action, plugin })}
                />
              ))}
            </section>
          </>
        ) : null}

        <PluginActionDialog
          pendingAction={pendingAction}
          installStream={installStream}
          isMutating={pendingAction ? mutating === `${pendingAction.plugin.id}:${pendingAction.action}` : false}
          onConfirm={() => pendingAction && void runAction(pendingAction.plugin, pendingAction.action)}
          onOpenChange={(open) => {
            const installTerminal = installStream?.status === 'done' || installStream?.status === 'error'
            if (!open && (!mutating || installTerminal)) {
              if (installTerminal) {
                closeInstallStream()
                setMutating('')
              }
              setPendingAction(null)
              setInstallStream(null)
            }
          }}
        />
      </div>
    </DashboardLayout>
  )
}

function PluginAppCard({
  plugin,
  mutating,
  onAction,
}: {
  plugin: PluginAppStatus
  mutating: string
  onAction: (action: PluginAction) => void
}) {
  const isInstalling = mutating === `${plugin.id}:install`
  const isUpdating = mutating === `${plugin.id}:update`
  const isUninstalling = mutating === `${plugin.id}:uninstall`

  return (
    <Card className="relative overflow-visible">
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        {plugin.updateAvailable && plugin.canUpdate ? (
          <Button
            size="sm"
            variant="primary"
            className="shadow-sm"
            isDisabled={isInstalling || isUpdating || isUninstalling}
            onPress={() => onAction('update')}
          >
            <Icon icon={isUpdating ? 'lucide:loader-circle' : 'lucide:arrow-up-circle'} className={isUpdating ? 'animate-spin' : ''} />
            更新
          </Button>
        ) : null}
        {!plugin.installed ? (
          <Button variant="primary" isDisabled={!plugin.canInstall || isInstalling || isUpdating || isUninstalling} onPress={() => onAction('install')}>
            <Icon icon={isInstalling ? 'lucide:loader-circle' : 'lucide:download'} className={isInstalling ? 'animate-spin' : ''} />
            安装
          </Button>
        ) : null}
        {plugin.canUninstall ? (
          <Button variant="tertiary" isDisabled={isInstalling || isUpdating || isUninstalling} onPress={() => onAction('uninstall')}>
            <Icon icon={isUninstalling ? 'lucide:loader-circle' : 'lucide:trash-2'} className={isUninstalling ? 'animate-spin' : ''} />
            卸载
          </Button>
        ) : null}
        <Button
          size="sm"
          isIconOnly
          variant="tertiary"
          className="shadow-sm"
          isDisabled={!plugin.homepage}
          aria-label={`${plugin.name} 主页`}
          onPress={() => void openExternalUrl(plugin.homepage)}
        >
          <Icon icon="lucide:external-link" />
        </Button>
      </div>
      <Card.Header className={plugin.updateAvailable && plugin.canUpdate ? 'pr-48' : 'pr-20'}>
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl">
            {plugin.logoUrl ? (
              <img src={plugin.logoUrl} alt="" className="size-12 object-contain" loading="lazy" referrerPolicy="no-referrer" />
            ) : (
              <Icon icon="lucide:store" className="size-6 text-success" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Card.Title className="text-xl">{plugin.name}</Card.Title>
            </div>
            <Card.Description className="mt-2">{plugin.tagline}</Card.Description>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-6 text-muted">{plugin.description}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <InfoItem label="CLI" value={plugin.cliPath || '未检测到'} />
            <InfoItem label="版本" value={plugin.version || '-'} />
          </div>

        </div>
      </Card.Content>
    </Card>
  )
}

function InfoItem({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-surface-secondary/50 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-foreground" title={value}>{value || '-'}</p>
    </div>
  )
}

function PluginActionDialog({
  installStream,
  pendingAction,
  isMutating,
  onConfirm,
  onOpenChange,
}: {
  installStream: PluginInstallStreamState | null
  pendingAction: { action: PluginAction; plugin: PluginAppStatus } | null
  isMutating: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  const meta = pendingAction ? actionMeta(pendingAction.action, pendingAction.plugin) : null
  const logs = installStream?.logs ?? []
  const showInstallLogs = pendingAction?.action === 'install' && installStream
  const copyInstallLogs = async () => {
    const text = [logs.join('\n'), installStream?.error ? installStream.error : ''].filter(Boolean).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('安装日志已复制')
    } catch {
      toast.warning('日志复制失败')
    }
  }

  return (
    <AlertDialog.Backdrop isOpen={pendingAction !== null} onOpenChange={onOpenChange}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className={showInstallLogs ? 'sm:max-w-[720px]' : 'sm:max-w-[460px]'}>
          <AlertDialog.CloseTrigger />
          <AlertDialog.Header>
            <AlertDialog.Icon status={pendingAction?.action === 'uninstall' ? 'danger' : 'warning'} />
            <AlertDialog.Heading>{meta?.title}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p className="text-sm leading-6 text-muted">{meta?.description}</p>
            {showInstallLogs ? (
              <div className="mt-4 overflow-hidden rounded-lg border border-border bg-content2">
                <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                    <Icon icon={installStream.status === 'running' || installStream.status === 'pending' ? 'lucide:loader-circle' : installStream.status === 'error' ? 'lucide:circle-alert' : 'lucide:circle-check'} className={installStream.status === 'running' || installStream.status === 'pending' ? 'size-4 animate-spin text-accent' : installStream.status === 'error' ? 'size-4 text-danger' : 'size-4 text-success'} />
                    <span>{installStream.status === 'done' ? '安装完成' : installStream.status === 'error' ? '安装失败' : '安装中'}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button isIconOnly aria-label="复制安装日志" size="sm" variant="ghost" onPress={() => void copyInstallLogs()} isDisabled={logs.length === 0 && !installStream.error}>
                      <Icon icon="lucide:copy" className="size-4" />
                    </Button>
                    <span className="text-xs text-muted">{installStream.progress}%</span>
                  </div>
                </div>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5 text-foreground">
                  {[logs.join('\n'), installStream.error ? installStream.error : ''].filter(Boolean).join('\n')}
                </pre>
              </div>
            ) : null}
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="tertiary" isDisabled={isMutating}>取消</Button>
            <Button
              variant={pendingAction?.action === 'uninstall' ? 'danger' : 'primary'}
              onPress={onConfirm}
              isDisabled={isMutating || installStream?.status === 'done'}
            >
              <Icon icon={isMutating ? 'lucide:loader-circle' : meta?.icon || 'lucide:play'} className={isMutating ? 'animate-spin' : ''} />
              {meta?.confirmText}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}

function actionMeta(action: PluginAction, plugin: PluginAppStatus) {
  if (action === 'install') {
    if (plugin.id === 'homebrew') {
      return {
        title: '安装 Homebrew？',
        // description: 'macOS 会下载 Homebrew.pkg 并用系统安装器打开。安装过程中如需要管理员密码，请只在系统安装器提示中输入；AgentBox 不会读取或保存密码。',
        confirmText: '安装',
        icon: 'lucide:package-open',
      }
    }
    return {
      title: `安装 ${plugin.name}？`,
      // description: `将执行安装命令：${plugin.installCommand}`,
      confirmText: '安装',
      icon: 'lucide:download',
    }
  }
  if (action === 'update') {
    return {
      title: `更新 ${plugin.name}？`,
      description: `将通过已检测到的 ${plugin.name} CLI 执行更新。`,
      confirmText: '更新',
      icon: 'lucide:arrow-up-circle',
    }
  }
  if (plugin.id === 'nodejs') {
    return {
      title: `深度卸载 ${plugin.name}？`,
      description: '将卸载 Node.js，并同时停止和清理 PM2、pnpm、npm 全局包、npm 缓存、nvm 与相关用户目录。',
      confirmText: '深度卸载',
      icon: 'lucide:trash-2',
    }
  }
  return {
    title: `卸载 ${plugin.name}？`,
    description: `将通过后端执行 ${plugin.name} 的卸载流程。`,
    confirmText: '卸载',
    icon: 'lucide:trash-2',
  }
}

function appendInstallLog(logs: string[], line: string) {
  const next = line.trim() ? [...logs, line] : logs
  return next.length > 240 ? next.slice(next.length - 240) : next
}

function PluginsSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <Card variant="transparent">
        <Card.Content>
          <div className="flex items-center gap-6">
            <Skeleton className="size-24 rounded-3xl" />
            <div className="flex flex-1 flex-col gap-3">
              <Skeleton className="h-8 w-56 rounded-lg" />
              <Skeleton className="h-5 w-full max-w-xl rounded-lg" />
              <Skeleton className="h-8 w-72 rounded-lg" />
            </div>
          </div>
        </Card.Content>
      </Card>
      <Card>
        <Card.Content>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-7 w-40 rounded-lg" />
            <Skeleton className="h-5 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        </Card.Content>
      </Card>
    </div>
  )
}

export default PluginsPage
