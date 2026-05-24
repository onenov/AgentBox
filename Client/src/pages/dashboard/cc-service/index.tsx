import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { Key } from '@heroui/react'
import { Button, Alert, AlertDialog, Card, Chip, Input, InputGroup, Label, ListBox, Separator, Skeleton, Spinner, Switch, Tabs, TextField, Tooltip, toast } from '@heroui/react'
import { CellSelect, ItemCard, ItemCardGroup, Segment } from '@heroui-pro/react'
import Editor from '@monaco-editor/react'
import { Icon } from '@iconify/react'
import type {
  CCConnectBasicConfig,
  CCConnectEnvironmentResponse,
  CCConnectTaskResponse,
  CCConnectTaskStreamError,
  CCConnectTaskStreamLog,
  CCConnectTaskStreamMeta,
  CCConnectTaskStreamStatus,
  CCConnectTextFileResponse,
} from '@/api'
import {
  getCCConnectBasicConfig,
  getCCConnectConfig,
  getCCConnectSettings,
  getCCConnectUninstallStreamURL,
  installCCConnectDaemon,
  restartCCConnectDaemon,
  startCCConnectDaemon,
  stopCCConnectDaemon,
  updateCCConnectBasicConfig,
  updateCCConnectConfig,
  updateCCConnectSettings,
} from '@/api'
import DashboardLayout from '@/layouts/Dashboard'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useCCConnectEnvironmentStore } from '@/stores/cc-connect-environment'
import { useThemeStore } from '@/stores/theme'
import { CCConnectServiceHeroIllustration } from './CCConnectServiceHeroIllustration'

const numberFormatter = new Intl.NumberFormat('zh-CN')
const defaultSelectKey = '__default__'
const settingControlClassName = 'w-full min-w-0'

type ActiveTab = 'basic' | 'settings' | 'config' | 'uninstall'
type LoadState = 'idle' | 'loading' | 'ready' | 'error'
type ConfigState = 'idle' | 'loading' | 'saving' | 'ready' | 'error'
type DaemonAction = 'idle' | 'installing' | 'starting' | 'stopping' | 'restarting'
type CCConnectServiceBasicConfig = CCConnectBasicConfig & { autoStart: boolean }

function CCServicePage() {
  usePageTitle('CC-Connect 服务管理')
  const data = useCCConnectEnvironmentStore((store) => store.data)
  const loadSharedEnvironment = useCCConnectEnvironmentStore((store) => store.loadCCConnectEnvironment)
  const isDark = useThemeStore((store) => store.isDark)
  const [state, setState] = useState<LoadState>('idle')
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<ActiveTab>('basic')
  const [daemonAction, setDaemonAction] = useState<DaemonAction>('idle')
  const [basicConfigState, setBasicConfigState] = useState<ConfigState>('idle')
  const [basicConfigData, setBasicConfigData] = useState<CCConnectServiceBasicConfig | null>(null)
  const [basicDraft, setBasicDraft] = useState<CCConnectServiceBasicConfig | null>(null)
  const [basicConfigError, setBasicConfigError] = useState('')
  const [configState, setConfigState] = useState<ConfigState>('idle')
  const [configData, setConfigData] = useState<CCConnectTextFileResponse | null>(null)
  const [configText, setConfigText] = useState('')
  const [configError, setConfigError] = useState('')
  const [uninstallTask, setUninstallTask] = useState<CCConnectTaskResponse | null>(null)
  const [isUninstallConfirmOpen, setUninstallConfirmOpen] = useState(false)
  const uninstallLogRef = useRef<HTMLPreElement | null>(null)
  const uninstallSourceRef = useRef<EventSource | null>(null)
  const uninstallStreamFinishedRef = useRef(false)

  const loadEnvironment = useCallback(async (refresh = false) => {
    setState('loading')
    setError('')

    try {
      await loadSharedEnvironment(refresh)
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CC-Connect 服务信息加载失败')
      setState('error')
    }
  }, [loadSharedEnvironment])

  const loadBasicConfig = useCallback(async () => {
    setBasicConfigState('loading')
    setBasicConfigError('')

    try {
      const [payload, settingsPayload] = await Promise.all([
        getCCConnectBasicConfig(),
        getCCConnectSettings(),
      ])
      const nextConfig = withCCConnectSettings(payload.config, settingsPayload.settings)
      setBasicConfigData(nextConfig)
      setBasicDraft(cloneConfig(nextConfig))
      setBasicConfigState('ready')
      return payload
    } catch (err) {
      setBasicConfigError(err instanceof Error ? err.message : '基础配置加载失败')
      setBasicConfigState('error')
      return null
    }
  }, [])

  const loadConfigFile = useCallback(async () => {
    setConfigState('loading')
    setConfigError('')

    try {
      const payload = await getCCConnectConfig()
      setConfigData(payload)
      setConfigText(payload.content ?? '')
      setConfigState('ready')
      return payload
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : '配置文件加载失败')
      setConfigState('error')
      return null
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadEnvironment(false)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadEnvironment])

  const hasConfigFile = Boolean(data?.home.configExists)

  useEffect(() => {
    const shouldLoadBasicConfig = hasConfigFile && activeTab === 'settings' && basicConfigState === 'idle'
    const shouldLoadConfigFile = hasConfigFile && activeTab === 'config' && configState === 'idle'

    if (!shouldLoadBasicConfig && !shouldLoadConfigFile) {
      return
    }

    const timer = window.setTimeout(() => {
      if (shouldLoadBasicConfig) void loadBasicConfig()
      if (shouldLoadConfigFile) void loadConfigFile()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [activeTab, basicConfigState, configState, hasConfigFile, loadBasicConfig, loadConfigFile])

  useEffect(() => {
    if (!hasConfigFile && (activeTab === 'settings' || activeTab === 'config')) {
      setActiveTab('basic')
    }
  }, [activeTab, hasConfigFile])

  const isBasicDirty = useMemo(() => {
    if (!basicDraft || !basicConfigData) return false
    return JSON.stringify(basicDraft) !== JSON.stringify(basicConfigData)
  }, [basicDraft, basicConfigData])

  const isConfigDirty = configText !== (configData?.content ?? '')
  const isLoading = state === 'loading' && !data
  const isLoadingBasicConfig = basicConfigState === 'loading'
  const isSavingBasicConfig = basicConfigState === 'saving'
  const isLoadingConfig = configState === 'loading'
  const isSavingConfig = configState === 'saving'
  const editorTheme = isDark ? 'vs-dark' : 'vs'
  const isUninstallRunning = uninstallTask?.status === 'pending' || uninstallTask?.status === 'running'

  const closeUninstallStream = useCallback(() => {
    uninstallSourceRef.current?.close()
    uninstallSourceRef.current = null
  }, [])

  const startUninstallStream = useCallback(() => {
    closeUninstallStream()
    uninstallStreamFinishedRef.current = false
    setUninstallConfirmOpen(false)

    const now = new Date().toISOString()
    setUninstallTask({
      id: `cc-connect-uninstall-${Date.now()}`,
      logs: ['正在连接 CC-Connect 卸载流式任务。'],
      progress: 0,
      startedAt: now,
      status: 'pending',
      updatedAt: now,
    })

    const source = new EventSource(getCCConnectUninstallStreamURL())
    uninstallSourceRef.current = source

    source.addEventListener('meta', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as CCConnectTaskStreamMeta
        setUninstallTask((current) => current ? {
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
        const payload = JSON.parse((event as MessageEvent).data) as CCConnectTaskStreamStatus
        setUninstallTask((current) => current ? {
          ...current,
          error: payload.error || current.error,
          id: payload.id || current.id,
          progress: payload.progress,
          status: payload.status,
          updatedAt: payload.timestamp,
        } : current)
        if (payload.status === 'done') {
          uninstallStreamFinishedRef.current = true
          closeUninstallStream()
          toast.success('CC-Connect 卸载流程完成')
          void loadEnvironment(true)
        }
        if (payload.status === 'error' && payload.error) {
          uninstallStreamFinishedRef.current = true
          closeUninstallStream()
          toast.warning(payload.error)
          void loadEnvironment(true)
        }
      } catch {
        // ignore malformed status payload
      }
    })

    source.addEventListener('log', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as CCConnectTaskStreamLog
        setUninstallTask((current) => current ? {
          ...current,
          id: payload.id || current.id,
          logs: appendStreamLog(current.logs, payload.line),
          updatedAt: payload.timestamp,
        } : current)
      } catch {
        // ignore malformed log payload
      }
    })

    source.addEventListener('error', (event) => {
      const raw = (event as MessageEvent).data
      if (!raw) return
      try {
        const payload = JSON.parse(raw) as CCConnectTaskStreamError
        uninstallStreamFinishedRef.current = true
        closeUninstallStream()
        setUninstallTask((current) => current ? {
          ...current,
          error: payload.message,
          id: payload.id || current.id,
          logs: appendStreamLog(current.logs, `失败：${payload.message}`),
          progress: 100,
          status: 'error',
          updatedAt: payload.timestamp,
        } : current)
        toast.warning(payload.message)
        void loadEnvironment(true)
      } catch {
        // ignore malformed error payload
      }
    })

    source.onerror = () => {
      if (uninstallStreamFinishedRef.current) return
      uninstallStreamFinishedRef.current = true
      closeUninstallStream()
      const timestamp = new Date().toISOString()
      setUninstallTask((current) => current ? {
        ...current,
        error: '流式连接中断',
        logs: appendStreamLog(current.logs, '失败：流式连接中断'),
        progress: 100,
        status: 'error',
        updatedAt: timestamp,
      } : current)
      toast.warning('CC-Connect 卸载流式任务连接中断')
      void loadEnvironment(true)
    }
  }, [closeUninstallStream, loadEnvironment])

  useEffect(() => () => closeUninstallStream(), [closeUninstallStream])

  useEffect(() => {
    if (!uninstallLogRef.current) return
    uninstallLogRef.current.scrollTop = uninstallLogRef.current.scrollHeight
  }, [uninstallTask?.logs, uninstallTask?.status])

  const runDaemonAction = useCallback(async (action: Exclude<DaemonAction, 'idle'>) => {
    setDaemonAction(action)
    try {
      if (action === 'installing') {
        await installCCConnectDaemon()
        toast.success('CC-Connect daemon 已安装并启动')
      } else if (action === 'starting') {
        await startCCConnectDaemon()
        toast.success('CC-Connect daemon 已启动')
      } else if (action === 'stopping') {
        await stopCCConnectDaemon()
        toast.success('CC-Connect daemon 已停止')
      } else {
        await restartCCConnectDaemon()
        toast.success('CC-Connect daemon 已重启')
      }
      await loadEnvironment(true)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'daemon 操作失败')
    } finally {
      setDaemonAction('idle')
    }
  }, [loadEnvironment])

  const saveBasicConfig = useCallback(async () => {
    if (!basicDraft) return
    setBasicConfigState('saving')
    setBasicConfigError('')

    try {
      const { autoStart, ...config } = basicDraft
      const [payload, settingsPayload] = await Promise.all([
        updateCCConnectBasicConfig(config),
        updateCCConnectSettings({ autoStart }),
      ])
      const nextConfig = withCCConnectSettings(payload.config, settingsPayload.settings)
      setBasicConfigData(nextConfig)
      setBasicDraft(cloneConfig(nextConfig))
      setBasicConfigState('ready')
      setConfigState('idle')
      setConfigData(null)
      setConfigText('')
      toast.success('CC-Connect 基础配置已保存')
      await loadEnvironment(true)
    } catch (err) {
      setBasicConfigError(err instanceof Error ? err.message : '基础配置保存失败')
      setBasicConfigState('error')
    }
  }, [basicDraft, loadEnvironment])

  const saveConfigFile = useCallback(async () => {
    setConfigState('saving')
    setConfigError('')

    try {
      const payload = await updateCCConnectConfig(configText)
      setConfigData(payload)
      setConfigText(payload.content ?? '')
      setConfigState('ready')
      setBasicConfigState('idle')
      setBasicConfigData(null)
      setBasicDraft(null)
      toast.success('CC-Connect config.toml 已保存')
      await loadEnvironment(true)
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : '配置文件保存失败')
      setConfigState('error')
    }
  }, [configText, loadEnvironment])

  const updateBasicDraft = useCallback((path: string, value: unknown) => {
    setBasicDraft((current) => current ? setNestedConfigValue(current, path, value) : current)
  }, [])

  const copyServiceInfo = useCallback(() => {
    if (!data) return
    void copyText(buildServiceInfoText(data))
  }, [data])

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
                <h2 className="mt-4 text-lg font-semibold text-foreground">无法加载 CC-Connect 服务信息</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{error}</p>
                <Button className="mt-6" variant={state === 'loading' ? 'danger' : 'primary'} onPress={() => void loadEnvironment(true)} isDisabled={state === 'loading'}>
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
                  <p className="font-medium">无法刷新 CC-Connect 服务信息</p>
                  <p className="mt-1 text-sm text-muted">{error}</p>
                </div>
              </div>
            </Card.Content>
          </Card>
        ) : null}

        {isLoading ? <CCServiceSkeleton /> : null}

        {data ? (
          <>
            <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
              <Card variant="transparent" className="h-full overflow-visible">
                <Card.Content className="flex h-full items-center justify-start overflow-visible">
                  <div className="flex w-full flex-row items-center gap-4 overflow-visible md:gap-6">
                    <div className="flex h-36 shrink-0 items-center justify-center overflow-visible rounded-2xl -p-4">
                      <CCConnectServiceHeroIllustration className="h-full w-auto md:scale-105" />
                    </div>
                    <div className="flex min-w-0 flex-col gap-5">
                      <div className="min-w-0">
                        <Card.Title className="text-2xl font-bold md:text-3xl">服务管理</Card.Title>
                        <Card.Description className="mt-4 text-base md:text-lg">查看 CC-Connect 服务信息，包括基本信息、配置和配置文件。</Card.Description>
                      </div>
                    </div>
                  </div>
                </Card.Content>
              </Card>

              <CCConnectHeroSummaryCard
                actionState={daemonAction}
                data={data}
                isRefreshing={state === 'loading'}
                onRestart={() => void runDaemonAction('restarting')}
                onStart={() => void runDaemonAction('starting')}
                onStop={() => void runDaemonAction('stopping')}
              />
            </section>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Segment aria-label="CC-Connect 服务管理" selectedKey={activeTab} onSelectionChange={(key) => setActiveTab(String(key) as ActiveTab)}>
                <Segment.Item id="basic">
                  <Segment.Separator />
                  基本信息
                </Segment.Item>
                {hasConfigFile ? (
                  <>
                    <Segment.Item id="settings">
                      <Segment.Separator />
                      配置
                    </Segment.Item>
                    <Segment.Item id="config">
                      <Segment.Separator />
                      配置文件
                    </Segment.Item>
                  </>
                ) : null}
                <Segment.Item id="uninstall">
                  <Segment.Separator />
                  卸载
                </Segment.Item>
              </Segment>

              {activeTab === 'basic' ? (
                <div className="flex items-center gap-2">
                  <Tooltip delay={300}>
                    <Button size="sm" isIconOnly variant="ghost" onPress={copyServiceInfo}>
                      <Icon icon="lucide:copy" />
                    </Button>
                    <Tooltip.Content>复制服务信息</Tooltip.Content>
                  </Tooltip>
                  <Button size="sm" isIconOnly variant="ghost" onPress={() => void loadEnvironment(true)} isDisabled={state === 'loading'}>
                    <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
                  </Button>
                </div>
              ) : null}

              {hasConfigFile && activeTab === 'settings' ? (
                <div className="flex items-center gap-2">
                  <Button size="sm" isIconOnly variant="ghost" onPress={() => void loadBasicConfig()} isDisabled={isLoadingBasicConfig || isSavingBasicConfig}>
                    <Icon icon={isLoadingBasicConfig ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={isLoadingBasicConfig ? 'animate-spin' : ''} />
                  </Button>
                  <Button size="sm" variant="primary" onPress={() => void saveBasicConfig()} isDisabled={isLoadingBasicConfig || isSavingBasicConfig || !isBasicDirty || !basicDraft}>
                    <Icon icon={isSavingBasicConfig ? 'lucide:loader-circle' : 'lucide:save'} className={isSavingBasicConfig ? 'animate-spin' : ''} />
                    保存配置
                  </Button>
                </div>
              ) : null}

              {hasConfigFile && activeTab === 'config' ? (
                <div className="flex items-center gap-2">
                  <Button size="sm" isIconOnly variant="ghost" onPress={() => void loadConfigFile()} isDisabled={isLoadingConfig || isSavingConfig}>
                    <Icon icon={isLoadingConfig ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={isLoadingConfig ? 'animate-spin' : ''} />
                  </Button>
                  <Button size="sm" variant="primary" onPress={() => void saveConfigFile()} isDisabled={isLoadingConfig || isSavingConfig || !isConfigDirty}>
                    <Icon icon={isSavingConfig ? 'lucide:loader-circle' : 'lucide:save'} className={isSavingConfig ? 'animate-spin' : ''} />
                    保存
                  </Button>
                </div>
              ) : null}

              {activeTab === 'uninstall' ? (
                <div className="flex items-center gap-2">
                  <Button size="sm" isIconOnly variant="ghost" onPress={() => void loadEnvironment(true)} isDisabled={state === 'loading' || isUninstallRunning}>
                    <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
                  </Button>
                </div>
              ) : null}
            </div>

            {activeTab === 'basic' ? (
              <CCConnectBasicPanel data={data} />
            ) : null}

            {hasConfigFile && activeTab === 'settings' ? (
              <CCConnectSettingsPanel
                config={basicDraft}
                error={basicConfigError}
                isLoading={isLoadingBasicConfig}
                isSaving={isSavingBasicConfig}
                onChange={updateBasicDraft}
              />
            ) : null}

            {hasConfigFile && activeTab === 'config' ? (
              <CCConnectTextFilePanel
                error={configError}
                isLoading={isLoadingConfig}
                isSaving={isSavingConfig}
                path={configData?.path || data.home.configPath || '~/.cc-connect/config.toml'}
                text={configText}
                theme={editorTheme}
                onChange={setConfigText}
              />
            ) : null}

            {activeTab === 'uninstall' ? (
              <CCConnectUninstallPanel
                data={data}
                isRunning={isUninstallRunning}
                logRef={uninstallLogRef}
                task={uninstallTask}
                onClearLog={() => setUninstallTask(null)}
                onRequestUninstall={() => setUninstallConfirmOpen(true)}
              />
            ) : null}
          </>
        ) : null}

        <AlertDialog.Backdrop isOpen={isUninstallConfirmOpen} onOpenChange={(open) => !isUninstallRunning && setUninstallConfirmOpen(open)}>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-[500px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>卸载 CC-Connect？</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-sm leading-6 text-muted">
                  这会停止 CC-Connect 运行时，移除 ~/.cc-connect、配置、本机数据和 CLI。建议先确认 config.toml 与项目配置已经备份。
                </p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary" isDisabled={isUninstallRunning}>
                  取消
                </Button>
                <Button variant="danger" isDisabled={isUninstallRunning} onPress={startUninstallStream}>
                  <Icon icon="lucide:trash-2" />
                  确认卸载
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </div>
    </DashboardLayout>
  )
}

function CCConnectBasicPanel({ data }: { data: CCConnectEnvironmentResponse }) {
  const failedChecks = data.checks.filter((check) => !check.ok && !(check.name === 'daemon' && data.management.reachable))
  const runtimeStatus = getCCConnectRuntimeStatus(data)
  const processStatus = getCCConnectProcessStatus(data)

  return (
    <>
      <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
        <Card>
          <Card.Header>
            <div className="flex min-w-0 items-center gap-2">
              <Icon icon="lucide:server-cog" className="size-6 shrink-0 text-muted" />
              <div className="min-w-0">
                <Card.Title>服务状态</Card.Title>
              </div>
            </div>
          </Card.Header>
          <Card.Content>
            <StatusItemList
              items={[
                { icon: 'lucide:activity', title: '运行状态', description: runtimeStatus.description, ok: runtimeStatus.ok, tone: runtimeStatus.tone },
                { icon: 'lucide:cpu', title: '运行进程', description: processStatus.description, ok: processStatus.ok, tone: processStatus.tone },
                { icon: 'lucide:globe-lock', title: 'Management API', description: data.management.reachable ? data.management.url || 'Management API 可访问' : data.management.error || 'Management API 不可达', ok: data.management.reachable },
                { icon: 'lucide:route', title: 'Bridge 配置', description: `${data.config.bridge.port}${data.config.bridge.path ? ` · ${data.config.bridge.path}` : ''}`, ok: data.config.bridge.enabled },
              ]}
            />
            <InfoGrid
              columns={2}
              items={[
                { icon: 'lucide:clock-3', label: '运行时间', value: formatSeconds(data.management.uptimeSeconds) },
                { icon: 'lucide:memory-stick', label: '内存占用', value: formatBytes(data.runtime?.rssBytes) },
              ]}
            />
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <div className="flex min-w-0 items-center gap-2">
              <Icon icon="lucide:terminal-square" className="size-6 shrink-0 text-muted" />
              <div className="min-w-0">
                <Card.Title>CLI 工具</Card.Title>
              </div>
            </div>
          </Card.Header>
          <Card.Content>
            <div className="grid gap-3">
              <InfoItem icon="lucide:tag" label="版本" value={data.cli.version || (data.cli.available ? '已安装' : '-')} />
              <InfoItem icon="lucide:package-check" label="来源" value={data.cli.source || '-'} />
              <InfoItem icon="lucide:folder-code" label="路径" value={data.cli.path || data.cli.error || '-'} />
              {/* <InfoItem icon="lucide:folder-code" label="WorkDir" value={data.daemon.workDir} /> */}
              <InfoItem icon="lucide:scroll-text" label="Log" value={data.daemon.logPath || data.home.logPath} />
            </div>
          </Card.Content>
        </Card>
      </section>

      <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
        <Card>
          <Card.Header>
            <div className="flex min-w-0 items-center gap-2">
              <Icon icon="lucide:folder-cog" className="size-6 shrink-0 text-muted" />
              <div className="min-w-0">
                <Card.Title>配置目录</Card.Title>
              </div>
            </div>
          </Card.Header>
          <Card.Content>
            <StatusItemList
              items={[
                { icon: 'lucide:home', title: 'Home', description: data.home.path, ok: data.home.exists },
                { icon: 'lucide:file-cog', title: 'Config', description: data.config.error || data.home.configPath, ok: data.config.exists && data.config.parsed },
                { icon: 'lucide:database', title: 'Data Dir', description: data.home.dataDir, ok: data.home.dataDirExists },
                { icon: 'lucide:file-json-2', title: 'Daemon Meta', description: data.home.daemonMetaPath, ok: data.home.daemonMetaExists },
              ]}
            />
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <div className="flex min-w-0 items-center gap-2">
              <Icon icon="lucide:network" className="size-6 shrink-0 text-muted" />
              <div className="min-w-0">
                <Card.Title>服务端口</Card.Title>
              </div>
            </div>
          </Card.Header>
          <Card.Content>
            <InfoGrid
              items={[
                // { icon: 'lucide:globe-lock', label: 'Management', value: data.config.management.url || `127.0.0.1:${data.config.management.port}` },
                { icon: 'lucide:key-round', label: 'Management Token', value: data.config.management.tokenSet ? '已设置' : '未设置' },
                { icon: 'lucide:route', label: 'Bridge', value: `${data.config.bridge.port}${data.config.bridge.path ? ` · ${data.config.bridge.path}` : ''}` },
                { icon: 'lucide:key-round', label: 'Bridge Token', value: data.config.bridge.tokenSet ? '已设置' : '未设置' },
              ]}
            />
          </Card.Content>
        </Card>
      </section>

      {failedChecks.length ? (
        <Card>
          <Card.Header>
            <div className="flex min-w-0 items-center gap-2">
              <Icon icon="lucide:list-checks" className="size-6 shrink-0 text-muted" />
              <div className="min-w-0">
                <Card.Title>需关注检测项</Card.Title>
                <Card.Description>来自 `/cc-connect/environment` 的本机只读探测结果。</Card.Description>
              </div>
            </div>
          </Card.Header>
          <Card.Content>
            <div className="grid gap-2 md:grid-cols-2">
              {failedChecks.map((check) => (
                <ItemCard key={check.name} className="min-w-0">
                  <ItemCard.Icon>
                    <Icon icon="lucide:triangle-alert" className="text-danger" />
                  </ItemCard.Icon>
                  <ItemCard.Content className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <ItemCard.Title>{checkLabel(check.name)}</ItemCard.Title>
                      <Chip size="sm" color="danger" variant="soft">{check.durationMs}ms</Chip>
                    </div>
                    <ItemCard.Description className="min-w-0 whitespace-normal break-words text-foreground [overflow-wrap:anywhere]">
                      {check.message}
                    </ItemCard.Description>
                  </ItemCard.Content>
                </ItemCard>
              ))}
            </div>
          </Card.Content>
        </Card>
      ) : null}
    </>
  )
}

type ConfigFieldType = 'text' | 'password' | 'number' | 'toggle' | 'textarea' | 'select'

type ConfigField = {
  path: string
  label: string
  type: ConfigFieldType
  description?: string
  icon?: string
  optionLabels?: Record<string, string>
  optionValues?: Record<string, string | number | boolean | null>
  options?: string[]
  placeholder?: string
  min?: number
  max?: number
  integer?: boolean
  rows?: number
}

type ConfigListField = {
  path: string
  label: string
  placeholder: string
  description?: string
  icon?: string
}

type ConfigSettingsGroup = {
  id: string
  title: string
  description: string
  icon: string
  fields: ConfigField[]
  listFields?: ConfigListField[]
}

const ccConnectGlobalFields: ConfigField[] = [
  {
    path: 'autoStart',
    label: '自动启动',
    type: 'toggle',
    description: '后端启动时自动运行 CC-Connect。',
    icon: 'lucide:rocket',
  },
  {
    path: 'language',
    label: '语言',
    type: 'select',
    options: ['zh', 'en'],
    optionLabels: { en: 'en - English', zh: 'zh - 简体中文' },
    icon: 'lucide:languages',
  },
  { path: 'dataDir', label: '数据目录', type: 'text', placeholder: '空值使用 ~/.cc-connect', icon: 'lucide:folder' },
  {
    path: 'attachmentSend',
    label: '附件发送',
    type: 'select',
    options: ['on', 'off'],
    optionLabels: { off: 'off - 禁用附件回传', on: 'on - 允许附件回传' },
    description: '控制图片/文件回传；流式预览请使用 stream_preview 配置。',
    icon: 'lucide:paperclip',
  },
  { path: 'idleTimeoutMins', label: '空闲超时分钟', type: 'number', placeholder: '120', min: 0, integer: true, icon: 'lucide:timer' },
  { path: 'providerPresetsUrl', label: 'Provider Presets URL', type: 'text', placeholder: 'https://...', icon: 'lucide:cloud' },
  { path: 'logLevel', label: '日志级别', type: 'select', options: ['debug', 'info', 'warn', 'error'], icon: 'lucide:file-text' },
]

const ccConnectDisplayFields: ConfigField[] = [
  { path: 'display.mode', label: '显示模式', type: 'select', options: ['auto', 'compact', 'full'], icon: 'lucide:panel-top' },
  { path: 'display.cardMode', label: '卡片模式', type: 'select', options: ['local', 'remote', 'none'], icon: 'lucide:panels-top-left' },
  { path: 'display.thinkingMessages', label: 'Thinking 消息', type: 'toggle', icon: 'lucide:brain' },
  { path: 'display.thinkingMaxLen', label: 'Thinking 最大长度', type: 'number', placeholder: '300', min: 0, integer: true, icon: 'lucide:text-cursor-input' },
  { path: 'display.toolMessages', label: 'Tool 消息', type: 'toggle', icon: 'lucide:wrench' },
  { path: 'display.toolMaxLen', label: 'Tool 最大长度', type: 'number', placeholder: '500', min: 0, integer: true, icon: 'lucide:scissors-line-dashed' },
]

const ccConnectPreviewFields: ConfigField[] = [
  { path: 'streamPreview.enabled', label: '启用流式预览', type: 'toggle', icon: 'lucide:radio' },
  { path: 'streamPreview.intervalMs', label: '预览间隔 ms', type: 'number', placeholder: '1500', min: 0, integer: true, icon: 'lucide:clock-3' },
  { path: 'streamPreview.minDeltaChars', label: '最小增量字符', type: 'number', placeholder: '80', min: 0, integer: true, icon: 'lucide:text-select' },
  { path: 'streamPreview.maxChars', label: '预览最大字符', type: 'number', placeholder: '6000', min: 0, integer: true, icon: 'lucide:scan-text' },
]

const ccConnectRateLimitFields: ConfigField[] = [
  { path: 'rateLimit.maxMessages', label: '输入窗口消息数', type: 'number', placeholder: '20', min: 0, integer: true, icon: 'lucide:gauge' },
  { path: 'rateLimit.windowSecs', label: '输入窗口秒数', type: 'number', placeholder: '60', min: 0, integer: true, icon: 'lucide:timer-reset' },
  { path: 'outgoingRateLimit.maxMessages', label: '外发窗口消息数', type: 'number', placeholder: '20', min: 0, integer: true, icon: 'lucide:send' },
  { path: 'outgoingRateLimit.windowSecs', label: '外发窗口秒数', type: 'number', placeholder: '60', min: 0, integer: true, icon: 'lucide:clock' },
]

const ccConnectCronFields: ConfigField[] = [
  { path: 'cron.silent', label: 'Cron 静默', type: 'toggle', icon: 'lucide:volume-x' },
  { path: 'cron.sessionMode', label: 'Cron 会话模式', type: 'select', options: ['new', 'reuse'], icon: 'lucide:git-branch' },
]

const ccConnectManagementFields: ConfigField[] = [
  { path: 'management.enabled', label: '启用 Management', type: 'toggle', icon: 'lucide:power' },
  { path: 'management.port', label: 'Management 端口', type: 'number', placeholder: '9820', min: 0, max: 65535, integer: true, icon: 'lucide:plug' },
  { path: 'management.token', label: 'Management Token', type: 'password', placeholder: 'Management API Bearer Token', icon: 'lucide:key-round' },
]

const ccConnectBridgeFields: ConfigField[] = [
  { path: 'bridge.enabled', label: '启用 Bridge', type: 'toggle', icon: 'lucide:power' },
  { path: 'bridge.port', label: 'Bridge 端口', type: 'number', placeholder: '9810', min: 0, max: 65535, integer: true, icon: 'lucide:plug' },
  { path: 'bridge.path', label: 'Bridge 路径', type: 'text', placeholder: '/bridge/ws', icon: 'lucide:link' },
  { path: 'bridge.token', label: 'Bridge Token', type: 'password', placeholder: 'Bridge WebSocket Token', icon: 'lucide:key-round' },
  { path: 'bridge.insecure', label: '允许 Insecure', type: 'toggle', icon: 'lucide:shield-alert' },
]

const ccConnectWebhookFields: ConfigField[] = [
  { path: 'webhook.enabled', label: '启用 Webhook', type: 'toggle', icon: 'lucide:power' },
  { path: 'webhook.port', label: 'Webhook 端口', type: 'number', placeholder: '9830', min: 0, max: 65535, integer: true, icon: 'lucide:plug' },
  { path: 'webhook.path', label: 'Webhook 路径', type: 'text', placeholder: '/webhook', icon: 'lucide:link' },
  { path: 'webhook.token', label: 'Webhook Token', type: 'password', placeholder: 'Webhook Token', icon: 'lucide:key-round' },
]

const ccConnectConfigSettingsGroups: ConfigSettingsGroup[] = [
  {
    id: 'global',
    title: '基础配置',
    description: '编辑自动启动、语言、数据目录、附件发送、日志级别和全局过滤词。',
    icon: 'lucide:settings-2',
    fields: ccConnectGlobalFields,
    listFields: [
      { label: '禁用词', path: 'bannedWords', placeholder: 'token, password', icon: 'lucide:list-x' },
    ],
  },
  {
    id: 'display',
    title: '显示与输出',
    description: '控制消息呈现、卡片模式、Thinking 和 Tool 输出截断。',
    icon: 'lucide:layout-dashboard',
    fields: ccConnectDisplayFields,
  },
  {
    id: 'preview',
    title: '流式预览',
    description: '配置流式预览开关、刷新间隔和预览内容长度。',
    icon: 'lucide:activity',
    fields: ccConnectPreviewFields,
  },
  {
    id: 'rate-limit',
    title: '限流策略',
    description: '配置入站消息和外发消息的窗口限流。',
    icon: 'lucide:gauge',
    fields: ccConnectRateLimitFields,
  },
  {
    id: 'cron',
    title: 'Cron',
    description: '配置定时任务投递行为和会话模式。',
    icon: 'lucide:calendar-clock',
    fields: ccConnectCronFields,
  },
  {
    id: 'management',
    title: 'Management API',
    description: '配置本地 Management API 端口、Token 和跨域来源。',
    icon: 'lucide:globe-lock',
    fields: ccConnectManagementFields,
    listFields: [
      { label: 'CORS Origins', path: 'management.corsOrigins', placeholder: 'http://127.0.0.1:5173', icon: 'lucide:shield-check' },
    ],
  },
  {
    id: 'bridge',
    title: 'Bridge',
    description: '配置 Bridge WebSocket 端口、路径、Token 和跨域来源。',
    icon: 'lucide:route',
    fields: ccConnectBridgeFields,
    listFields: [
      { label: 'CORS Origins', path: 'bridge.corsOrigins', placeholder: 'http://127.0.0.1:5173', icon: 'lucide:shield-check' },
    ],
  },
  {
    id: 'webhook',
    title: 'Webhook',
    description: '配置 Webhook 监听开关、端口、路径和 Token。',
    icon: 'lucide:webhook',
    fields: ccConnectWebhookFields,
  },
]

function CCConnectUninstallPanel({
  data,
  isRunning,
  logRef,
  task,
  onClearLog,
  onRequestUninstall,
}: {
  data: CCConnectEnvironmentResponse | null
  isRunning: boolean
  logRef: RefObject<HTMLPreElement | null>
  task: CCConnectTaskResponse | null
  onClearLog: () => void
  onRequestUninstall: () => void
}) {
  const cliAvailable = Boolean(data?.cli.available)
  const homeExists = Boolean(data?.home.exists)
  const runtimeRunning = Boolean(data?.runtime?.running || data?.daemon.running || data?.management.reachable)
  const configExists = Boolean(data?.home.configExists)

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
            <Icon icon="lucide:trash-2" className="size-7" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold">卸载 CC-Connect</div>
            <div className="text-sm text-muted">危险操作：完整卸载 CC-Connect，开始前请先确认。</div>
          </div>
        </div>

        <div className="grid gap-2">
          <StatusItemList
            items={[
              { icon: 'lucide:terminal-square', title: 'CLI', description: cliAvailable ? data?.cli.path || data?.cli.source || 'cc-connect 命令仍存在' : 'cc-connect CLI 已移除', ok: !cliAvailable },
              { icon: 'lucide:home', title: 'Home', description: homeExists ? data?.home.path || 'CC-Connect 本地目录仍存在' : 'CC-Connect 本地目录已移除', ok: !homeExists },
              { icon: 'lucide:radio-tower', title: '运行时', description: runtimeRunning ? '运行进程或 Management API 仍存在' : '运行时未运行', ok: !runtimeRunning },
              { icon: 'lucide:file-cog', title: '配置', description: configExists ? data?.home.configPath || 'config.toml 仍存在' : 'config.toml 已移除', ok: !configExists },
            ]}
          />

          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>卸载 CC-Connect</Alert.Title>
              <Alert.Description>
                卸载会停止 CC-Connect 运行时，移除 CLI、Home、config.toml、本机数据、日志和运行状态。这个操作适合重装前清理，请确认需要保留的信息已经备份。
              </Alert.Description>
            </Alert.Content>
          </Alert>

          <div className="mt-2 flex items-center gap-2">
            <Button className="w-full" size="sm" variant="danger" isDisabled={isRunning} onPress={onRequestUninstall}>
              <Icon icon={isRunning ? 'lucide:loader-circle' : 'lucide:trash-2'} className={isRunning ? 'animate-spin' : ''} />
              卸载 CC-Connect
            </Button>
          </div>
        </div>
      </div>

      <CCConnectUninstallLogCard
        isRunning={isRunning}
        logRef={logRef}
        task={task}
        onClear={onClearLog}
      />
    </div>
  )
}

function CCConnectUninstallLogCard({
  isRunning,
  logRef,
  task,
  onClear,
}: {
  isRunning: boolean
  logRef: RefObject<HTMLPreElement | null>
  task: CCConnectTaskResponse | null
  onClear: () => void
}) {
  const status = task?.status ?? 'idle'
  const tone = status === 'done' ? 'success' : status === 'error' ? 'danger' : isRunning ? 'warning' : 'default'
  const logs = task?.logs ?? ['尚未开始卸载任务。']

  const copyLogs = async () => {
    const text = [logs.join('\n'), task?.error ? task.error : ''].filter(Boolean).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('卸载日志已复制')
    } catch {
      toast.warning('日志复制失败')
    }
  }

  return (
    <Card className="min-w-0">
      <Card.Header>
        <div className="flex w-full min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <Card.Title>
              <span className="inline-flex min-w-0 items-center gap-2">
                <span>卸载日志</span>
                {isRunning ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-normal text-muted">
                    <Icon icon="lucide:loader-circle" className="size-4 animate-spin" />
                    正在卸载...
                  </span>
                ) : null}
              </span>
            </Card.Title>
            <Card.Description>{task?.id || '等待任务'}</Card.Description>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Chip color={tone} variant="soft">{status}</Chip>
            <Tooltip delay={300}>
              <Button isIconOnly aria-label="复制卸载日志" size="sm" variant="ghost" onPress={() => void copyLogs()} isDisabled={logs.length === 0}>
                <Icon icon="lucide:copy" className="size-4" />
              </Button>
              <Tooltip.Content>复制日志</Tooltip.Content>
            </Tooltip>
            <Tooltip delay={300}>
              <Button isIconOnly aria-label="清空卸载日志" size="sm" variant="ghost" onPress={onClear} isDisabled={!task || isRunning}>
                <Icon icon="lucide:x" className="size-4" />
              </Button>
              <Tooltip.Content>清空日志</Tooltip.Content>
            </Tooltip>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        <div className="mb-3 h-2 overflow-hidden rounded-full bg-surface-secondary/50">
          <div className={`h-full rounded-full ${status === 'error' ? 'bg-danger' : status === 'idle' ? 'bg-muted' : 'bg-success'}`} style={{ width: `${Math.max(status === 'idle' ? 0 : 3, task?.progress ?? 0)}%` }} />
        </div>
        <pre ref={logRef} className="h-[370px] overflow-auto rounded-xl bg-surface-secondary/50 p-4 font-mono text-xs leading-5 whitespace-pre-wrap text-foreground">
          {logs.join('\n')}
          {task?.error ? `\n${task.error}` : ''}
        </pre>
      </Card.Content>
    </Card>
  )
}

function CCConnectSettingsPanel({
  config,
  error,
  isLoading,
  isSaving,
  onChange,
}: {
  config: CCConnectServiceBasicConfig | null
  error: string
  isLoading: boolean
  isSaving: boolean
  onChange: (path: string, value: unknown) => void
}) {
  const [activeSettingGroup, setActiveSettingGroup] = useState(ccConnectConfigSettingsGroups[0].id)
  const content = config ? cloneConfig(config) as unknown as Record<string, unknown> : {}
  const disabled = isLoading || isSaving || !config
  const selectedGroup = ccConnectConfigSettingsGroups.find((group) => group.id === activeSettingGroup) ?? ccConnectConfigSettingsGroups[0]
  const selectedFields = selectedGroup.fields.filter((field) => field.type !== 'textarea')
  const selectedStandaloneFields = selectedGroup.fields.filter((field) => field.type === 'textarea')

  const setValue = useCallback((path: string, value: unknown) => {
    onChange(path, value)
  }, [onChange])

  if (isLoading && !config) {
    return <ConfigSkeleton />
  }

  if (!config) {
    return (
      <Card>
        <Card.Content>
          <div className="flex min-h-40 flex-col items-center justify-center text-center">
            <Icon icon="lucide:file-warning" className="size-8 text-muted" />
            <p className="mt-3 text-sm font-medium text-foreground">基础配置暂不可用</p>
            <p className="mt-1 text-xs text-muted">{error || '等待读取 config.toml。'}</p>
          </div>
        </Card.Content>
      </Card>
    )
  }

  return (
    <div className={`grid gap-4 ${isLoading || isSaving ? 'pointer-events-none opacity-60' : ''}`}>
      {error ? (
        <Card>
          <Card.Content>
            <div className="flex items-start gap-3 text-danger">
              <Icon icon="lucide:triangle-alert" className="mt-0.5 size-5 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium">配置操作失败</p>
                <p className="mt-1 text-sm text-muted">{error}</p>
              </div>
            </div>
          </Card.Content>
        </Card>
      ) : null}

      <div className="grid gap-2 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="h-fit lg:sticky lg:top-4">
          <Card.Content>
            <Tabs aria-label="CC-Connect 设置项" orientation="vertical" selectedKey={activeSettingGroup} onSelectionChange={(key) => setActiveSettingGroup(String(key))}>
              <Tabs.ListContainer className="w-full">
                <Tabs.List className="w-full">
                  {ccConnectConfigSettingsGroups.map((group) => (
                    <Tabs.Tab key={group.id} id={group.id} className="w-full justify-start gap-2 px-3">
                      <Icon icon={group.icon} className="size-4 shrink-0" />
                      <span className="truncate">{group.title}</span>
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  ))}
                </Tabs.List>
              </Tabs.ListContainer>
            </Tabs>
          </Card.Content>
        </Card>

        <div className="flex min-w-0 flex-col gap-4 -mt-4">
          <Card variant="transparent" className="min-w-0">
            <Card.Header>
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-muted">
                  <Icon icon={selectedGroup.icon} className="size-5" />
                </div>
                <div className="min-w-0">
                  <Card.Title>{selectedGroup.title}</Card.Title>
                  <Card.Description>{selectedGroup.description}</Card.Description>
                </div>
              </div>
            </Card.Header>
            <Card.Content>
              <ItemCardGroup className="overflow-hidden">
                {selectedFields.map((field, index) => (
                  <FragmentWithSeparator key={field.path} showSeparator={index > 0}>
                    <ConfigFieldItem config={content} disabled={disabled} field={field} onChange={setValue} />
                  </FragmentWithSeparator>
                ))}
                {selectedGroup.listFields?.map((field, index) => (
                  <FragmentWithSeparator key={field.path} showSeparator={selectedFields.length > 0 || index > 0}>
                    <ListConfigFieldItem config={content} disabled={disabled} field={field} onChange={setValue} />
                  </FragmentWithSeparator>
                ))}
              </ItemCardGroup>
            </Card.Content>

            {selectedStandaloneFields.map((field) => (
              <StandaloneConfigFieldCard key={field.path} config={content} disabled={disabled} field={field} onChange={setValue} />
            ))}
          </Card>
        </div>
      </div>
    </div>
  )
}

function FragmentWithSeparator({ children, showSeparator }: { children: ReactNode; showSeparator: boolean }) {
  return (
    <>
      {showSeparator ? <Separator /> : null}
      {children}
    </>
  )
}

function ConfigFieldItem({ config, disabled, field, onChange }: { config: Record<string, unknown>; disabled: boolean; field: ConfigField; onChange: (path: string, value: unknown) => void }) {
  return (
    <ItemCard>
      <ItemCard.Icon className="size-10 rounded-full bg-surface-secondary/50 text-muted">
        <Icon icon={field.icon || getConfigFieldIcon(field)} className="size-5" />
      </ItemCard.Icon>
      <ItemCard.Content>
        <ItemCard.Title>{field.label}</ItemCard.Title>
        <ItemCard.Description>{field.description || field.path}</ItemCard.Description>
      </ItemCard.Content>
      <ItemCard.Action>
        <ConfigFieldControl config={config} disabled={disabled} field={field} onChange={onChange} />
      </ItemCard.Action>
    </ItemCard>
  )
}

function StandaloneConfigFieldCard({ config, disabled, field, onChange }: { config: Record<string, unknown>; disabled: boolean; field: ConfigField; onChange: (path: string, value: unknown) => void }) {
  return (
    <Card className="min-w-0">
      <Card.Header>
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-secondary/50 text-muted">
            <Icon icon={field.icon || getConfigFieldIcon(field)} className="size-5" />
          </div>
          <div className="min-w-0">
            <Card.Title>{field.label}</Card.Title>
            <Card.Description>{field.description || field.path}</Card.Description>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        <ConfigFieldControl config={config} disabled={disabled} field={field} onChange={onChange} />
      </Card.Content>
    </Card>
  )
}

function ConfigFieldControl({ config, disabled, field, onChange }: { config: Record<string, unknown>; disabled: boolean; field: ConfigField; onChange: (path: string, value: unknown) => void }) {
  const value = readConfigValue(config, field.path)
  const id = `cc-connect-config-${field.path.replace(/[^a-z0-9_-]/gi, '-')}`

  if (field.type === 'toggle') {
    return (
      <Switch size="lg" aria-label={field.label} isSelected={value === true} isDisabled={disabled} onChange={(isSelected) => onChange(field.path, isSelected)}>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch>
    )
  }

  if (field.type === 'select') {
    const selectedKey = getSelectedOptionKey(field, value)

    return (
      <CellSelect
        aria-label={field.label}
        className={settingControlClassName}
        isDisabled={disabled}
        value={selectedKey}
        variant="secondary"
        onChange={(nextValue: Key | null) => onChange(field.path, getSelectOptionValue(field, nextValue))}
      >
        <CellSelect.Trigger>
          <CellSelect.Value />
          <CellSelect.Indicator />
        </CellSelect.Trigger>
        <CellSelect.Popover>
          <ListBox>
            <ListBox.Item id={defaultSelectKey} textValue="默认 / 未设置">
              默认 / 未设置
              <ListBox.ItemIndicator />
            </ListBox.Item>
            {field.options?.map((option) => (
              <ListBox.Item key={option} id={option} textValue={getSelectOptionLabel(field, option)}>
                {getSelectOptionLabel(field, option)}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </CellSelect.Popover>
      </CellSelect>
    )
  }

  if (field.type === 'textarea') {
    return (
      <textarea
        id={id}
        aria-label={field.label}
        value={value === undefined || value === null ? '' : String(value)}
        disabled={disabled}
        onChange={(event) => onChange(field.path, event.target.value || undefined)}
        placeholder={field.placeholder}
        rows={field.rows ?? 3}
        className="w-full min-w-0 rounded-xl border border-divider bg-surface-secondary/50 px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted focus:border-accent disabled:opacity-60"
      />
    )
  }

  if (field.type === 'password') {
    return <PasswordConfigFieldControl disabled={disabled} field={field} id={id} value={value} onChange={onChange} />
  }

  return (
    <Input
      id={id}
      aria-label={field.label}
      variant="secondary"
      className={settingControlClassName}
      type={field.type === 'number' ? 'number' : 'text'}
      value={value === undefined || value === null ? '' : String(value)}
      disabled={disabled}
      min={field.min}
      max={field.max}
      placeholder={field.placeholder}
      onChange={(event) => onChange(field.path, normalizeFieldInput(event.target.value, field))}
    />
  )
}

function PasswordConfigFieldControl({
  disabled,
  field,
  id,
  value,
  onChange,
}: {
  disabled: boolean
  field: ConfigField
  id: string
  value: unknown
  onChange: (path: string, value: unknown) => void
}) {
  const [isVisible, setIsVisible] = useState(false)
  const currentValue = value === undefined || value === null ? '' : String(value)

  return (
    <TextField className={settingControlClassName} name={field.path}>
      <Label className="sr-only">{field.label}</Label>
      <InputGroup>
        <InputGroup.Input
          id={id}
          aria-label={field.label}
          className="w-full"
          type={isVisible ? 'text' : 'password'}
          value={currentValue}
          disabled={disabled}
          placeholder={field.placeholder}
          onChange={(event) => onChange(field.path, event.target.value || undefined)}
        />
        <InputGroup.Suffix className="pr-0">
          <Button
            isIconOnly
            aria-label={isVisible ? '隐藏密码' : '显示密码'}
            size="sm"
            variant="ghost"
            isDisabled={disabled || !currentValue}
            onPress={() => setIsVisible((visible) => !visible)}
          >
            <Icon icon={isVisible ? 'lucide:eye-off' : 'lucide:eye'} className="size-4" />
          </Button>
        </InputGroup.Suffix>
      </InputGroup>
    </TextField>
  )
}

function ListConfigFieldItem({ config, disabled, field, onChange }: { config: Record<string, unknown>; disabled: boolean; field: ConfigListField; onChange: (path: string, value: unknown) => void }) {
  const raw = readConfigValue(config, field.path)
  const value = Array.isArray(raw) ? raw.join(', ') : typeof raw === 'string' ? raw : ''

  return (
    <ItemCard>
      <ItemCard.Icon className="size-10 rounded-full bg-surface-secondary/50 text-muted">
        <Icon icon={field.icon || 'lucide:list-checks'} className="size-5" />
      </ItemCard.Icon>
      <ItemCard.Content>
        <ItemCard.Title>{field.label}</ItemCard.Title>
        <ItemCard.Description>{field.description || `${field.path}，逗号或换行分隔，保存时写为数组。`}</ItemCard.Description>
      </ItemCard.Content>
      <ItemCard.Action>
        <Input
          aria-label={field.label}
          variant="secondary"
          className={settingControlClassName}
          value={value}
          disabled={disabled}
          placeholder={field.placeholder}
          onChange={(event) => {
            const list = parseConfigListInput(event.target.value)
            onChange(field.path, list.length > 0 ? list : undefined)
          }}
        />
      </ItemCard.Action>
    </ItemCard>
  )
}

function getSelectedOptionKey(field: ConfigField, value: unknown): string {
  if (!field.options) return defaultSelectKey
  if (field.optionValues) {
    return field.options.find((option) => Object.is(field.optionValues?.[option], value)) ?? defaultSelectKey
  }
  return typeof value === 'string' && field.options.includes(value) ? value : defaultSelectKey
}

function getSelectOptionValue(field: ConfigField, nextValue: Key | null): unknown {
  if (!nextValue || nextValue === defaultSelectKey) return undefined
  const option = String(nextValue)
  if (field.optionValues && Object.prototype.hasOwnProperty.call(field.optionValues, option)) {
    return field.optionValues[option]
  }
  return option
}

function getSelectOptionLabel(field: ConfigField, option: string): string {
  return field.optionLabels?.[option] ?? option
}

function getConfigFieldIcon(field: ConfigField): string {
  if (field.type === 'toggle') return 'lucide:toggle-right'
  if (field.type === 'select') return 'lucide:list-filter'
  if (field.type === 'number') return 'lucide:hash'
  if (field.type === 'password') return 'lucide:key-round'
  if (field.type === 'textarea') return 'lucide:file-text'
  return 'lucide:type'
}

function readConfigValue(raw: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object' || Array.isArray(acc)) return undefined
    return (acc as Record<string, unknown>)[key]
  }, raw)
}

function normalizeFieldInput(value: string, field: ConfigField): unknown {
  if (value === '') return undefined
  if (field.type !== 'number') return value
  const next = Number(value)
  if (!Number.isFinite(next)) return undefined
  return field.integer ? Math.trunc(next) : next
}

function parseConfigListInput(value: string): string[] {
  return value
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index)
}

function CCConnectTextFilePanel({
  error,
  isLoading,
  isSaving,
  path,
  text,
  theme,
  onChange,
}: {
  error: string
  isLoading: boolean
  isSaving: boolean
  path: string
  text: string
  theme: 'vs' | 'vs-dark'
  onChange: (value: string) => void
}) {
  return (
    <Card>
      <Card.Header>
        <div className="flex min-w-0 items-center gap-2">
          <Icon icon="lucide:file-code-2" className="size-6 shrink-0 text-muted" />
          <div className="min-w-0">
            <Card.Title>配置文件</Card.Title>
            <Card.Description>{path}</Card.Description>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        {error ? (
          <div className="mb-3 rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}
        <div className={`h-[calc(100dvh-250px)] overflow-hidden rounded-2xl border border-divider ${isLoading || isSaving ? 'pointer-events-none opacity-60' : ''}`}>
          <Editor
            height="100%"
            defaultLanguage="toml"
            language="toml"
            theme={theme}
            value={text}
            onChange={(value) => onChange(value ?? '')}
            options={{
              automaticLayout: true,
              fontSize: 13,
              formatOnPaste: true,
              formatOnType: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              tabSize: 2,
              wordWrap: 'on',
            }}
          />
        </div>
      </Card.Content>
    </Card>
  )
}

function CCConnectHeroSummaryCard({
  actionState,
  data,
  isRefreshing,
  onRestart,
  onStart,
  onStop,
}: {
  actionState: DaemonAction
  data: CCConnectEnvironmentResponse
  isRefreshing: boolean
  onRestart: () => void
  onStart: () => void
  onStop: () => void
}) {
  const status = getCCConnectServiceStatus(data)
  const isRuntimeReachable = data.runtime?.running || data.daemon.running || data.management.reachable
  const canStart = data.cli.available && data.home.configExists && !isRuntimeReachable && actionState === 'idle' && !isRefreshing
  const canRestart = data.cli.available && data.home.configExists && actionState === 'idle' && !isRefreshing
  const canStop = data.cli.available && isRuntimeReachable && actionState === 'idle' && !isRefreshing
  const portLabel = data.config.management.port ? String(data.config.management.port) : '-'

  return (
    <Card className="h-full">
      <Card.Content>
        <div className="flex h-full flex-col justify-center px-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className={status.tone === 'success' ? 'flex size-11 shrink-0 items-center justify-center rounded-full bg-success/10 text-success shadow-[0_0_18px_color-mix(in_oklch,var(--success)_55%,transparent)]' : status.tone === 'warning' ? 'flex size-11 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning' : 'flex size-11 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger'}>
                  <Icon icon={status.icon} className="size-5" />
                </div>
                <div className="min-w-0 pl-2">
                  <div className="truncate text-base font-semibold text-foreground">{status.label}</div>
                  <div className="truncate text-xs text-muted">{status.description}</div>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs text-muted">Management</div>
                <div className="mt-1 font-semibold tabular-nums text-foreground">{portLabel}</div>
              </div>
            </div>
            <div className="mt-4 flex flex-row items-center gap-2">
              {!data.cli.available || !data.home.configExists ? (
                <Button className="flex-1" size="sm" variant="primary" isDisabled={actionState !== 'idle' || isRefreshing} onPress={() => window.location.assign('/dashboard/cc-install')}>
                  <Icon icon="lucide:download" className="size-4" />
                  安装向导
                </Button>
              ) : isRuntimeReachable ? (
                <>
                  <Button className="flex-1" size="sm" variant="primary" isPending={actionState === 'restarting'} isDisabled={!canRestart} onPress={onRestart}>
                    {({ isPending }) => (
                      <>
                        {isPending ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:rotate-ccw" className="size-4" />}
                        重启
                      </>
                    )}
                  </Button>
                  <Button className="flex-1" size="sm" variant="danger" isPending={actionState === 'stopping'} isDisabled={!canStop} onPress={onStop}>
                    {({ isPending }) => (
                      <>
                        {isPending ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:square" className="size-4" />}
                        停止
                      </>
                    )}
                  </Button>
                </>
              ) : (
                <>
                  <Button className="flex-1" size="sm" variant="primary" isPending={actionState === 'starting'} isDisabled={!canStart} onPress={onStart}>
                    {({ isPending }) => (
                      <>
                        {isPending ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:play" className="size-4" />}
                        启动
                      </>
                    )}
                  </Button>
                  <Button className="flex-1" size="sm" variant="secondary" isPending={actionState === 'restarting'} isDisabled={!canRestart} onPress={onRestart}>
                    {({ isPending }) => (
                      <>
                        {isPending ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:rotate-cw" className="size-4" />}
                        重启
                      </>
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function CCServiceSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <Card>
        <Card.Content>
          <div className="flex items-center gap-4">
            <Skeleton className="size-16 rounded-2xl" />
            <div className="flex flex-1 flex-col gap-3">
              <Skeleton className="h-8 w-64 rounded-lg" />
              <Skeleton className="h-5 w-full max-w-2xl rounded-lg" />
            </div>
          </div>
        </Card.Content>
      </Card>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index}>
            <Card.Content>
              <Skeleton className="h-24 rounded-xl" />
            </Card.Content>
          </Card>
        ))}
      </div>
    </div>
  )
}

function ConfigSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index}>
          <Card.Content>
            <div className="flex flex-col gap-3">
              <Skeleton className="h-8 w-52 rounded-lg" />
              <Skeleton className="h-12 rounded-xl" />
              <Skeleton className="h-12 rounded-xl" />
              <Skeleton className="h-12 rounded-xl" />
            </div>
          </Card.Content>
        </Card>
      ))}
    </div>
  )
}

type StatusItemTone = 'danger' | 'success' | 'warning'

function StatusItemList({ items }: { items: Array<{ description: string; icon: string; ok: boolean; title: string; tone?: StatusItemTone }> }) {
  return (
    <div className="mb-2 grid gap-2 sm:grid-cols-1">
      {items.map((item) => (
        <ItemCard key={item.title}>
          <ItemCard.Icon>
            <Icon icon={item.icon} className="text-muted" />
          </ItemCard.Icon>
          <ItemCard.Content>
            <ItemCard.Title>{item.title}</ItemCard.Title>
            <ItemCard.Description>{item.description}</ItemCard.Description>
          </ItemCard.Content>
          <ItemCard.Action>
            <span
              className={getStatusIndicatorClassName(item.tone ?? (item.ok ? 'success' : 'danger'))}
              aria-label={item.ok ? '正常' : '需关注'}
            />
          </ItemCard.Action>
        </ItemCard>
      ))}
    </div>
  )
}

function getStatusIndicatorClassName(tone: StatusItemTone) {
  if (tone === 'success') {
    return 'block size-2.5 shrink-0 rounded-full bg-success shadow-[0_0_12px_color-mix(in_oklch,var(--success)_80%,transparent)]'
  }
  if (tone === 'warning') {
    return 'block size-2.5 shrink-0 rounded-full bg-warning shadow-[0_0_12px_color-mix(in_oklch,var(--warning)_80%,transparent)]'
  }
  return 'block size-2.5 shrink-0 rounded-full bg-danger shadow-[0_0_12px_color-mix(in_oklch,var(--danger)_80%,transparent)]'
}

function InfoGrid({
  columns = 1,
  items,
}: {
  columns?: 1 | 2 | 4
  items: Array<{ icon: string; label: string; value: number | string | undefined }>
}) {
  const gridClassName = columns === 4
    ? 'sm:grid-cols-2 xl:grid-cols-4'
    : columns === 2
      ? 'sm:grid-cols-2'
      : 'grid-cols-1'

  return (
    <div className={`grid gap-3 ${gridClassName}`}>
      {items.map((item) => (
        <InfoItem key={item.label} icon={item.icon} label={item.label} value={item.value} />
      ))}
    </div>
  )
}

function InfoItem({ icon, label, value }: { icon: string; label: string; value: number | string | undefined }) {
  return (
    <ItemCard className="min-w-0">
      <ItemCard.Icon>
        <Icon icon={icon} className="text-muted" />
      </ItemCard.Icon>
      <ItemCard.Content className="min-w-0">
        <ItemCard.Title>{label}</ItemCard.Title>
        <ItemCard.Description className="min-w-0 whitespace-normal break-words text-foreground [overflow-wrap:anywhere]">
          {value === undefined || value === '' ? '-' : String(value)}
        </ItemCard.Description>
      </ItemCard.Content>
    </ItemCard>
  )
}

function getCCConnectRuntimeStatus(data: CCConnectEnvironmentResponse): { description: string; ok: boolean; tone: StatusItemTone } {
  if (data.runtime?.managed && data.management.reachable) {
    return { description: '运行中，Management API 可访问', ok: true, tone: 'success' }
  }
  if (data.runtime?.running && data.management.reachable) {
    return { description: '运行中，Management API 可访问', ok: true, tone: 'success' }
  }
  if (data.daemon.running && data.management.reachable) {
    return { description: '后台服务运行中，Management API 可访问', ok: true, tone: 'success' }
  }
  if (data.management.reachable) {
    return { description: '检测到 cc-connect 进程，Management API 可访问', ok: true, tone: 'success' }
  }
  if (data.daemon.running) {
    return { description: '后台服务运行中，Management API 待确认', ok: true, tone: 'warning' }
  }
  return { description: data.daemon.installed ? '未检测到运行中的 cc-connect 进程' : '等待启动 cc-connect', ok: false, tone: 'danger' }
}

function getCCConnectProcessStatus(data: CCConnectEnvironmentResponse): { description: string; ok: boolean; tone: StatusItemTone } {
  const pid = data.runtime?.pid || data.daemon.pid
  if (data.runtime?.running || data.daemon.running || data.management.reachable) {
    return { description: pid ? `PID ${pid}` : '运行中', ok: true, tone: 'success' }
  }
  return { description: '未运行', ok: false, tone: 'danger' }
}

function getCCConnectServiceStatus(data: CCConnectEnvironmentResponse) {
  if (data.daemon.running && data.management.reachable) {
    return { description: 'daemon 运行中，API 可访问', icon: 'lucide:check-circle-2', label: '运行中', tone: 'success' as const }
  }
  if (data.daemon.running) {
    return { description: 'daemon 已运行，API 待确认', icon: 'lucide:radio-tower', label: 'daemon 运行中', tone: 'warning' as const }
  }
  if (data.management.reachable) {
    if (data.runtime?.managed) {
      return { description: '运行中', icon: 'lucide:check-circle-2', label: '运行中', tone: 'success' as const }
    }
    return { description: data.daemon.installed ? '独立进程运行中，launchd 未运行' : 'API 可访问，daemon 未安装', icon: 'lucide:globe-lock', label: 'API 可访问', tone: 'success' as const }
  }
  if (data.daemon.installed) {
    return { description: '未检测到运行中的 cc-connect 进程', icon: 'lucide:server-off', label: '已停止', tone: 'warning' as const }
  }
  if (!data.cli.available) {
    return { description: '未检测到 cc-connect CLI', icon: 'lucide:terminal-x', label: 'CLI 缺失', tone: 'danger' as const }
  }
  return { description: data.home.configExists ? '配置已就绪，daemon 未安装' : '等待 config.toml', icon: 'lucide:package-open', label: '待安装', tone: 'warning' as const }
}

function checkLabel(name: string) {
  switch (name) {
    case 'cli':
      return 'CLI'
    case 'config':
      return '配置文件'
    case 'daemon':
      return 'daemon'
    case 'management':
      return 'Management API'
    default:
      return name
  }
}

function formatSeconds(value?: number) {
  if (value === undefined) return '-'
  if (value < 60) return `${numberFormatter.format(value)}s`
  const minutes = Math.floor(value / 60)
  if (minutes < 60) return `${numberFormatter.format(minutes)}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${numberFormatter.format(hours)}h`
  return `${numberFormatter.format(Math.floor(hours / 24))}d`
}

function formatBytes(value?: number) {
  if (!value) return '-'
  if (value < 1024) return `${numberFormatter.format(value)} B`
  if (value < 1024 ** 2) return `${numberFormatter.format(value / 1024)} KB`
  if (value < 1024 ** 3) return `${numberFormatter.format(value / 1024 ** 2)} MB`
  return `${numberFormatter.format(value / 1024 ** 3)} GB`
}

function buildServiceInfoText(data: CCConnectEnvironmentResponse) {
  const runtimePID = data.runtime?.pid || data.daemon.pid || '-'
  return [
    `CLI: ${data.cli.version || '-'} (${data.cli.path || '-'})`,
    `Config: ${data.config.path || '-'}`,
    `Data Dir: ${data.home.dataDir || '-'}`,
    `Runtime: ${data.runtime?.running || data.management.reachable ? 'running' : 'stopped'}`,
    `Runtime PID: ${runtimePID}`,
    `Management API: ${data.management.reachable ? 'reachable' : data.management.enabled ? 'enabled' : 'disabled'}`,
    `Management URL: ${data.management.url || data.config.management.url || '-'}`,
    `Projects: ${data.management.projectsCount || data.config.projectCount || 0}`,
  ].join('\n')
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('已复制 CC-Connect 服务信息')
  } catch {
    toast.warning('复制失败')
  }
}

function appendStreamLog(logs: string[], line: string) {
  const next = [...logs]
  for (const item of line.split(/\r?\n/)) {
    const value = item.trimEnd()
    if (value) next.push(value)
  }
  return next.slice(-800)
}

function withCCConnectSettings(config: CCConnectBasicConfig, settings?: { autoStart?: boolean }): CCConnectServiceBasicConfig {
  return {
    ...config,
    autoStart: Boolean(settings?.autoStart),
  }
}

function cloneConfig(config: CCConnectServiceBasicConfig): CCConnectServiceBasicConfig {
  return JSON.parse(JSON.stringify(config)) as CCConnectServiceBasicConfig
}

function setNestedConfigValue<T extends object>(source: T, path: string, value: unknown): T {
  const next = JSON.parse(JSON.stringify(source)) as Record<string, unknown>
  const parts = path.split('.')
  let cursor = next
  for (const part of parts.slice(0, -1)) {
    const existing = cursor[part]
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      cursor[part] = {}
    }
    cursor = cursor[part] as Record<string, unknown>
  }
  cursor[parts[parts.length - 1]] = value
  return next as T
}

export default CCServicePage
