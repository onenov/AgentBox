import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { Key } from '@heroui/react'
import { AlertDialog, Alert, Button, Card, Chip, Dropdown, Input, InputGroup, Label, ListBox, Separator, Skeleton, Spinner, Switch, Tabs, TextField, Tooltip, toast } from '@heroui/react'
import { CellSelect, ItemCard, ItemCardGroup, Segment } from '@heroui-pro/react'
import Editor from '@monaco-editor/react'
import { Icon } from '@iconify/react'
import { OpenClawGatewayDevicePairingModal } from './openclaw-device-pairing'
import type { OpenClawChannelStreamError, OpenClawChannelStreamLog, OpenClawChannelStreamMeta, OpenClawChannelStreamStatus, OpenClawChannelTaskResponse, OpenClawConfigBackup, OpenClawConfigBackupDetailResponse, OpenClawConfigBackupListResponse, OpenClawConfigResponse, OpenClawEnvironmentResponse, OpenClawPresenceEntry, OpenClawPublicGatewayResponse, OpenClawUpdateStatusResponse } from '@/api'
import {
  createOpenClawConfigBackup,
  deleteOpenClawConfigBackup,
  getOpenClawConfig,
  getOpenClawConfigBackup,
  getOpenClawPublicGateway,
  getOpenClawUninstallStreamURL,
  getOpenClawUpdateStreamURL,
  getOpenClawUpdateStatus,
  listOpenClawConfigBackups,
  restoreOpenClawConfigBackup,
  resolveOpenClawGatewayWebSocketURL,
  restartOpenClawGateway,
  stopOpenClawGateway,
  updateOpenClawConfig,
  updateOpenClawPublicGateway,
  OpenClawGatewayClient,
} from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import EmojiPickerField from '@/components/EmojiPicker'
import DashboardLayout from '@/layouts/Dashboard'
import { useThemeStore } from '@/stores/theme'
import { useOpenClawEnvironmentStore } from '@/stores/openclaw-environment'

const numberFormatter = new Intl.NumberFormat('zh-CN')
const defaultSelectKey = '__default__'
const settingControlClassName = 'w-full min-w-0'
const uninstalledRefreshIntervalMs = 3_000

function hasGatewayHealthIssue(environment: OpenClawEnvironmentResponse) {
  return !environment.gateway.tcpReachable
    || !environment.gateway.httpHealthOk
    || !environment.gateway.healthzOk
    || !environment.gateway.readyzOk
}

function OpenClawServicePage() {
  usePageTitle('OpenClaw 服务管理')
  const navigate = useNavigate()
  const data = useOpenClawEnvironmentStore((store) => store.data)
  const loadSharedOpenClawEnvironment = useOpenClawEnvironmentStore((store) => store.loadOpenClawEnvironment)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<string | number>('basic')
  const [configState, setConfigState] = useState<'idle' | 'loading' | 'saving' | 'ready' | 'error'>('idle')
  const [configData, setConfigData] = useState<OpenClawConfigResponse | null>(null)
  const [configText, setConfigText] = useState('')
  const [configError, setConfigError] = useState('')
  const [publicGatewayState, setPublicGatewayState] = useState<'idle' | 'loading' | 'saving' | 'ready' | 'error'>('idle')
  const [publicGatewayData, setPublicGatewayData] = useState<OpenClawPublicGatewayResponse | null>(null)
  const [publicGatewayURL, setPublicGatewayURL] = useState('')
  const [publicGatewayError, setPublicGatewayError] = useState('')
  const [backupState, setBackupState] = useState<'idle' | 'loading' | 'mutating' | 'ready' | 'error'>('idle')
  const [backupData, setBackupData] = useState<OpenClawConfigBackupListResponse | null>(null)
  const [backupDetail, setBackupDetail] = useState<OpenClawConfigBackupDetailResponse | null>(null)
  const [backupDetailState, setBackupDetailState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [backupDetailError, setBackupDetailError] = useState('')
  const [backupError, setBackupError] = useState('')
  const [gatewayActionState, setGatewayActionState] = useState<'idle' | 'restarting' | 'stopping'>('idle')
  const [updateStatusState, setUpdateStatusState] = useState<'idle' | 'checking' | 'ready' | 'error' | 'updating'>('idle')
  const [updateStatusData, setUpdateStatusData] = useState<OpenClawUpdateStatusResponse | null>(null)
  const [updateTask, setUpdateTask] = useState<OpenClawChannelTaskResponse | null>(null)
  const [isUpdateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [presenceState, setPresenceState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [presenceEntries, setPresenceEntries] = useState<OpenClawPresenceEntry[]>([])
  const [presenceError, setPresenceError] = useState('')
  const [uninstallTask, setUninstallTask] = useState<OpenClawChannelTaskResponse | null>(null)
  const [isUninstallConfirmOpen, setUninstallConfirmOpen] = useState(false)
  const [isGatewayDevicePairingOpen, setGatewayDevicePairingOpen] = useState(false)
  const updateLogRef = useRef<HTMLPreElement | null>(null)
  const updateSourceRef = useRef<EventSource | null>(null)
  const updateStreamFinishedRef = useRef(false)
  const uninstallLogRef = useRef<HTMLPreElement | null>(null)
  const uninstallSourceRef = useRef<EventSource | null>(null)
  const uninstallStreamFinishedRef = useRef(false)
  const isDark = useThemeStore((store) => store.isDark)

  const loadEnvironment = useCallback(async (refresh = false) => {
    setState('loading')
    setError('')

    try {
      const payload = await loadSharedOpenClawEnvironment(refresh)
      setState('ready')
      if (!refresh && hasGatewayHealthIssue(payload)) {
        void loadSharedOpenClawEnvironment(true)
      }
      return payload
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OpenClaw 服务信息加载失败')
      setState('error')
      return null
    }
  }, [loadSharedOpenClawEnvironment])

  const loadConfig = useCallback(async () => {
    setConfigState('loading')
    setConfigError('')

    try {
      const payload = await getOpenClawConfig()
      const content = payload.content ?? {}
      setConfigData(payload)
      setConfigText(JSON.stringify(content, null, 2))
      setConfigState('ready')
      return payload
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : '配置文件加载失败')
      setConfigState('error')
      return null
    }
  }, [])

  const loadPublicGateway = useCallback(async () => {
    setPublicGatewayState('loading')
    setPublicGatewayError('')

    try {
      const payload = await getOpenClawPublicGateway()
      setPublicGatewayData(payload)
      setPublicGatewayURL(payload.publicUrl || '')
      setPublicGatewayState('ready')
      return payload
    } catch (err) {
      setPublicGatewayError(err instanceof Error ? err.message : '公网 Gateway 地址加载失败')
      setPublicGatewayState('error')
      return null
    }
  }, [])

  const loadBackups = useCallback(async () => {
    setBackupState('loading')
    setBackupError('')

    try {
      const payload = await listOpenClawConfigBackups()
      setBackupData(payload)
      setBackupState('ready')
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : '配置备份加载失败')
      setBackupState('error')
    }
  }, [])

  const loadPresence = useCallback(async (environment = data, config = configData) => {
    const gatewayUrl = resolveOpenClawGatewayWebSocketURL(environment?.gateway)
    const token = getGatewayToken(config?.content)

    if (!gatewayUrl || !token) {
      setPresenceEntries([])
      setPresenceError(!gatewayUrl ? 'Gateway WebSocket 地址不可用' : 'Gateway 认证令牌缺失')
      setPresenceState('error')
      return
    }

    const client = new OpenClawGatewayClient({ token, url: gatewayUrl, requestTimeoutMs: 10_000 })
    setPresenceState('loading')
    setPresenceError('')

    try {
      const payload = await client.systemPresence()
      setPresenceEntries(Array.isArray(payload) ? payload : [])
      setPresenceState('ready')
    } catch (err) {
      setPresenceEntries([])
      setPresenceError(err instanceof Error ? err.message : '实例信息加载失败')
      setPresenceState('error')
    } finally {
      client.close()
    }
  }, [configData, data])

  const closeUpdateStream = useCallback(() => {
    updateSourceRef.current?.close()
    updateSourceRef.current = null
  }, [])

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
      id: `openclaw-uninstall-${Date.now()}`,
      logs: ['正在连接 OpenClaw 卸载流式任务。'],
      progress: 0,
      startedAt: now,
      status: 'pending',
      updatedAt: now,
    })

    const source = new EventSource(getOpenClawUninstallStreamURL())
    uninstallSourceRef.current = source

    source.addEventListener('meta', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as OpenClawChannelStreamMeta
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
        const payload = JSON.parse((event as MessageEvent).data) as OpenClawChannelStreamStatus
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
          toast.success('OpenClaw 卸载流程完成')
          window.setTimeout(() => window.location.reload(), 600)
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
        const payload = JSON.parse((event as MessageEvent).data) as OpenClawChannelStreamLog
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
        const payload = JSON.parse(raw) as OpenClawChannelStreamError
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
      toast.warning('OpenClaw 卸载流式任务连接中断')
      void loadEnvironment(true)
    }
  }, [closeUninstallStream, loadEnvironment])

  const saveConfig = useCallback(async () => {
    setConfigState('saving')
    setConfigError('')

    try {
      const content = JSON.parse(configText) as Record<string, unknown>
      const payload = await updateOpenClawConfig(content)
      const nextContent = payload.content ?? {}
      setConfigData(payload)
      setConfigText(JSON.stringify(nextContent, null, 2))
      setConfigState('ready')
      toast.success('配置文件已更新')
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : '配置文件更新失败')
      setConfigState('error')
      toast.warning('配置文件更新失败')
    }
  }, [configText])

  const savePublicGateway = useCallback(async () => {
    setPublicGatewayState('saving')
    setPublicGatewayError('')

    try {
      const payload = await updateOpenClawPublicGateway(publicGatewayURL)
      setPublicGatewayData(payload)
      setPublicGatewayURL(payload.publicUrl || '')
      setPublicGatewayState('ready')
      toast.success(payload.publicUrl ? '公网 Gateway 地址已更新' : '公网 Gateway 地址已清除')
      await loadEnvironment(true)
    } catch (err) {
      setPublicGatewayError(err instanceof Error ? err.message : '公网 Gateway 地址更新失败')
      setPublicGatewayState('error')
      toast.warning('公网 Gateway 地址更新失败')
    }
  }, [loadEnvironment, publicGatewayURL])

  const createBackup = useCallback(async () => {
    setBackupState('mutating')
    setBackupError('')

    try {
      await createOpenClawConfigBackup()
      toast.success('配置备份已创建')
      await loadBackups()
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : '配置备份创建失败')
      setBackupState('error')
      toast.warning('配置备份创建失败')
    }
  }, [loadBackups])

  const restoreBackup = useCallback(async (backup: OpenClawConfigBackup) => {
    setBackupState('mutating')
    setBackupError('')

    try {
      await restoreOpenClawConfigBackup(backup.name)
      toast.success('配置备份已恢复')
      await Promise.all([loadConfig(), loadBackups(), loadEnvironment(true)])
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : '配置备份恢复失败')
      setBackupState('error')
      toast.warning('配置备份恢复失败')
    }
  }, [loadBackups, loadConfig, loadEnvironment])

  const deleteBackup = useCallback(async (backup: OpenClawConfigBackup) => {
    setBackupState('mutating')
    setBackupError('')

    try {
      await deleteOpenClawConfigBackup(backup.name)
      toast.success('配置备份已删除')
      await loadBackups()
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : '配置备份删除失败')
      setBackupState('error')
      toast.warning('配置备份删除失败')
    }
  }, [loadBackups])

  const viewBackup = useCallback(async (backup: OpenClawConfigBackup) => {
    setBackupDetailState('loading')
    setBackupDetailError('')
    setBackupDetail(null)

    try {
      const payload = await getOpenClawConfigBackup(backup.name)
      setBackupDetail(payload)
      setBackupDetailState('ready')
    } catch (err) {
      setBackupDetailError(err instanceof Error ? err.message : '配置备份读取失败')
      setBackupDetailState('error')
      toast.warning('配置备份读取失败')
    }
  }, [])

  const copyServiceInfo = useCallback(() => {
    if (!data) return
    void copyText(buildServiceInfoText(data))
  }, [data])

  const copyConfigText = useCallback(() => {
    if (!configText) return
    void copyText(configText)
  }, [configText])

  const restartGateway = useCallback(async () => {
    try {
      const parsedConfig = JSON.parse(configText || '{}') as Record<string, unknown>
      if (readConfigValue(parsedConfig, 'gateway.mode') === 'remote') {
        toast.warning('当前是远端连接模式，不能启动本机 Gateway。请先将运行模式切换为“本机 Gateway（可启动）”并保存。')
        return
      }
    } catch {
      toast.warning('配置文件不是合法 JSON，无法重启 Gateway')
      return
    }

    setGatewayActionState('restarting')
    try {
      await restartOpenClawGateway()
      toast.success('Gateway 重启完成')
      await loadEnvironment(true)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'Gateway 重启失败')
    } finally {
      setGatewayActionState('idle')
    }
  }, [configText, loadEnvironment])

  const stopGateway = useCallback(async () => {
    setGatewayActionState('stopping')
    try {
      await stopOpenClawGateway()
      toast.success('Gateway 已停止运行')
      await loadEnvironment(true)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'Gateway 停止失败')
    } finally {
      setGatewayActionState('idle')
    }
  }, [loadEnvironment])

  const checkOpenClawUpdate = useCallback(async (refresh = false, notify = false) => {
    setUpdateStatusState('checking')

    try {
      const payload = await getOpenClawUpdateStatus(refresh)
      setUpdateStatusData(payload)
      setUpdateStatusState('ready')
      if (notify) {
        toast.success(payload.available ? '发现可用更新' : 'OpenClaw 已是最新版本')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '更新检测失败'
      setUpdateStatusState('error')
      if (notify) {
        toast.warning(message)
      }
    }
  }, [])

  const startUpdateStream = useCallback(() => {
    closeUpdateStream()
    updateStreamFinishedRef.current = false
    setUpdateStatusState('updating')
    setUpdateDialogOpen(true)

    const now = new Date().toISOString()
    setUpdateTask({
      id: `openclaw-update-${Date.now()}`,
      logs: ['正在连接 OpenClaw 更新流式任务。'],
      progress: 0,
      startedAt: now,
      status: 'pending',
      updatedAt: now,
    })

    const source = new EventSource(getOpenClawUpdateStreamURL())
    updateSourceRef.current = source

    source.addEventListener('meta', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as OpenClawChannelStreamMeta
        setUpdateTask((current) => current ? {
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
        setUpdateTask((current) => current ? {
          ...current,
          error: payload.error || current.error,
          id: payload.id || current.id,
          progress: payload.progress,
          status: payload.status,
          updatedAt: payload.timestamp,
        } : current)
        if (payload.status === 'error' && payload.error) {
          updateStreamFinishedRef.current = true
          closeUpdateStream()
          setUpdateStatusState('error')
          toast.warning(payload.error)
          void loadEnvironment(true)
        }
      } catch {
        // ignore malformed status payload
      }
    })

    source.addEventListener('log', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as OpenClawChannelStreamLog
        setUpdateTask((current) => current ? {
          ...current,
          id: payload.id || current.id,
          logs: appendStreamLog(current.logs, payload.line),
          status: current.status === 'pending' ? 'running' : current.status,
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
        const payload = JSON.parse(raw) as OpenClawChannelStreamError
        updateStreamFinishedRef.current = true
        closeUpdateStream()
        setUpdateStatusState('error')
        setUpdateTask((current) => current ? {
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

    source.addEventListener('done', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { id: string; timestamp: string }
        updateStreamFinishedRef.current = true
        closeUpdateStream()
        setUpdateTask((current) => current ? {
          ...current,
          id: payload.id || current.id,
          logs: appendStreamLog(current.logs, 'OpenClaw 更新完成。'),
          progress: 100,
          status: 'done',
          updatedAt: payload.timestamp,
        } : current)
        setUpdateStatusState('ready')
        toast.success('OpenClaw 更新完成')
        void loadEnvironment(true)
        void getOpenClawUpdateStatus(true).then(setUpdateStatusData).catch(() => undefined)
      } catch {
        // ignore malformed done payload
      }
    })

    source.onerror = () => {
      if (updateStreamFinishedRef.current) return
      updateStreamFinishedRef.current = true
      closeUpdateStream()
      setUpdateStatusState('error')
      const timestamp = new Date().toISOString()
      setUpdateTask((current) => current ? {
        ...current,
        error: '更新流式连接中断',
        logs: appendStreamLog(current.logs, '失败：更新流式连接中断'),
        progress: 100,
        status: 'error',
        updatedAt: timestamp,
      } : current)
      toast.warning('OpenClaw 更新流式任务连接中断')
      void loadEnvironment(true)
    }
  }, [closeUpdateStream, loadEnvironment])

  const formatConfigText = useCallback(() => {
    try {
      const parsed = JSON.parse(configText) as Record<string, unknown>
      setConfigText(JSON.stringify(parsed, null, 2))
      setConfigError('')
      toast.success('配置已格式化')
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : '配置文件不是合法 JSON')
      toast.warning('配置格式化失败')
    }
  }, [configText])

  useEffect(() => {
    const load = async () => {
      await Promise.all([loadEnvironment(true), loadConfig(), loadBackups(), loadPublicGateway()])
    }

    void load()
  }, [loadConfig, loadEnvironment, loadBackups, loadPublicGateway])

  useEffect(() => () => {
    closeUpdateStream()
    closeUninstallStream()
  }, [closeUpdateStream, closeUninstallStream])

  useEffect(() => {
    const handleStatusRefresh = () => {
      void loadEnvironment(true)
    }

    window.addEventListener('openclaw:status-refresh', handleStatusRefresh)
    return () => window.removeEventListener('openclaw:status-refresh', handleStatusRefresh)
  }, [loadEnvironment])

  useEffect(() => {
    if (updateLogRef.current) {
      updateLogRef.current.scrollTop = updateLogRef.current.scrollHeight
    }
  }, [updateTask?.logs])

  useEffect(() => {
    if (uninstallLogRef.current) {
      uninstallLogRef.current.scrollTop = uninstallLogRef.current.scrollHeight
    }
  }, [uninstallTask?.logs])

  useEffect(() => {
    if (!data?.cli.available) {
      return
    }

    const timer = window.setTimeout(() => {
      void checkOpenClawUpdate(false)
    }, 1800)

    return () => window.clearTimeout(timer)
  }, [checkOpenClawUpdate, data?.cli.available, data?.cli.path, data?.cli.version])

  useEffect(() => {
    if (activeTab !== 'instances' || !data || !configData || presenceState !== 'idle') {
      return
    }

    const timer = window.setTimeout(() => {
      void loadPresence(data, configData)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [activeTab, configData, data, loadPresence, presenceState])

  const isLoading = state === 'loading' && !data
  const refreshButtonVariant = state === 'loading' ? 'danger' : state === 'error' ? 'primary' : 'ghost'
  const isGatewayRunning = Boolean(data && isGatewayReachable(data))
  const cliVersion = formatCliVersion(data?.cli.version)
  const isUpdateRunning = updateTask?.status === 'pending' || updateTask?.status === 'running' || updateStatusState === 'updating'
  const hasOpenClawUpdate = data?.cli.available === true && updateStatusData?.available === true
  const targetOpenClawVersion = updateStatusData?.latestVersion || updateStatusData?.currentVersion || ''
  const isSavingConfig = configState === 'saving'
  const isLoadingConfig = configState === 'loading' && !configData
  const isSavingPublicGateway = publicGatewayState === 'saving'
  const isLoadingPublicGateway = publicGatewayState === 'loading' && !publicGatewayData
  const isPublicGatewayDirty = publicGatewayURL.trim().replace(/\/+$/, '') !== (publicGatewayData?.publicUrl || '')
  const isLoadingBackups = backupState === 'loading' && !backupData
  const isMutatingBackups = backupState === 'mutating'
  const backups = backupData?.backups ?? []
  const configSnapshot = useMemo(() => JSON.stringify(configData?.content ?? {}, null, 2), [configData])
  const isConfigDirty = useMemo(() => configText !== configSnapshot, [configSnapshot, configText])
  const isUninstallRunning = uninstallTask?.status === 'pending' || uninstallTask?.status === 'running'
  const isOpenClawAvailable = Boolean(data?.cli.available && data.home.exists && data.home.configExists)

  useEffect(() => {
    if (!data || isOpenClawAvailable || state === 'loading') {
      return
    }

    const timer = window.setInterval(() => {
      void loadEnvironment(true)
    }, uninstalledRefreshIntervalMs)

    return () => window.clearInterval(timer)
  }, [data, isOpenClawAvailable, loadEnvironment, state])

  if (error && !data) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[calc(100dvh-8rem)] items-center justify-center">
          <Card className="w-full max-w-md">
            <Card.Content>
              <div className="flex flex-col items-center px-6 py-8 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-warning/10 text-warning">
                  <Icon icon="lucide:triangle-alert" className="size-6" />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-foreground">无法加载服务信息</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{error}</p>
                <Button className="mt-6" variant={refreshButtonVariant} onPress={() => loadEnvironment(true)} isDisabled={state === 'loading'}>
                  <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
                  重新加载
                </Button>
              </div>
            </Card.Content>
          </Card>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>

      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        {error && data ? (
          <Card>
            <Card.Content>
              <div className="flex items-start gap-3 text-warning">
                <Icon icon="lucide:triangle-alert" className="mt-0.5 size-5" />
                <div>
                  <p className="font-medium">OpenClaw 服务信息刷新失败</p>
                  <p className="mt-1 text-sm text-muted">{error}</p>
                </div>
              </div>
            </Card.Content>
          </Card>
        ) : null}

        {isLoading ? <ServiceSkeleton /> : null}

        {data ? (
          <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
            <Card variant="transparent" className="h-full overflow-visible">
              <Card.Content className="flex h-full items-center justify-start overflow-visible">
                <div className="flex w-full flex-row items-center gap-4 overflow-visible md:gap-6">
                  <div className="flex h-36 shrink-0 items-center justify-center overflow-visible p-1">
                    <img src="https://assets.orence.net/file/20260512222431111.png" alt="System Overview" className="h-full w-auto" />
                  </div>
                  <div className="flex min-w-0 flex-col gap-5">
                    <div className="min-w-0">
                      <Card.Title className="md:text-3xl text-2xl font-bold">服务管理</Card.Title>
                      <Card.Description className="mt-4 md:text-lg text-base">查看 OpenClaw 服务信息，包括基本信息、配置文件、备份恢复等。</Card.Description>
                    </div>
                  </div>
                </div>
              </Card.Content>
            </Card>

            <ServiceHeroSummaryCard
              actionState={gatewayActionState}
              cliAvailable={Boolean(data.cli.available)}
              data={data}
              isRefreshing={state === 'loading'}
              isRunning={isGatewayRunning}
              onInstall={() => navigate('/dashboard/openclaw-install')}
              onRestart={() => void restartGateway()}
              onStop={() => void stopGateway()}
            />
          </section>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Segment aria-label="OpenClaw 服务管理" selectedKey={activeTab} onSelectionChange={setActiveTab}>
            <Segment.Item id="basic">
              <Segment.Separator />
              基本信息
            </Segment.Item>
            {isOpenClawAvailable ? (
              <>
                <Segment.Item id="instances">
                  <Segment.Separator />
                  实例
                </Segment.Item>
                <Segment.Item id="settings">
                  <Segment.Separator />
                  配置
                </Segment.Item>
                <Segment.Item id="config">
                  <Segment.Separator />
                  配置文件
                </Segment.Item>
                <Segment.Item id="backups">
                  <Segment.Separator />
                  备份恢复
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
                <Button size="sm" isIconOnly variant="ghost" onPress={() => setGatewayDevicePairingOpen(true)} isDisabled={!data} aria-label="设备配对审批">
                  <Icon icon="lucide:shield-check" />
                </Button>
                <Tooltip.Content>设备配对审批</Tooltip.Content>
              </Tooltip>
              <Button size="sm" isIconOnly variant="ghost" onPress={copyServiceInfo} isDisabled={!data}>
                <Icon icon="lucide:copy" />
              </Button>
              <Button size="sm" isIconOnly variant={refreshButtonVariant} onPress={() => loadEnvironment(true)} isDisabled={state === 'loading'}>
                <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
              </Button>
            </div>
          ) : null}

          {activeTab === 'instances' ? (
            <div className="flex items-center gap-2">
              <Button size="sm" isIconOnly variant="ghost" onPress={() => void loadPresence()} isDisabled={presenceState === 'loading'}>
                <Icon icon={presenceState === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={presenceState === 'loading' ? 'animate-spin' : ''} />
              </Button>
            </div>
          ) : null}

          {activeTab === 'settings' ? (
            <div className="flex items-center gap-2">
              <Button size="sm" isIconOnly variant="ghost" onPress={() => void Promise.all([loadConfig(), loadPublicGateway()])} isDisabled={isLoadingConfig || isSavingConfig || isLoadingPublicGateway || isSavingPublicGateway}>
                <Icon icon={isLoadingConfig || isLoadingPublicGateway ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={isLoadingConfig || isLoadingPublicGateway ? 'animate-spin' : ''} />
              </Button>
              <Button size="sm" variant="primary" onPress={saveConfig} isDisabled={isLoadingConfig || isSavingConfig || !isConfigDirty}>
                <Icon icon={isSavingConfig ? 'lucide:loader-circle' : 'lucide:save'} className={isSavingConfig ? 'animate-spin' : ''} />
                保存配置
              </Button>
            </div>
          ) : null}

          {activeTab === 'config' ? (
            <div className="flex items-center gap-2">
              <Button size="sm" isIconOnly variant="ghost" onPress={loadConfig} isDisabled={isLoadingConfig || isSavingConfig}>
                <Icon icon={isLoadingConfig ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={isLoadingConfig ? 'animate-spin' : ''} />
              </Button>
              <Button size="sm" variant="primary" onPress={saveConfig} isDisabled={isLoadingConfig || isSavingConfig || !isConfigDirty}>
                <Icon icon={isSavingConfig ? 'lucide:loader-circle' : 'lucide:save'} className={isSavingConfig ? 'animate-spin' : ''} />
                保存
              </Button>
            </div>
          ) : null}

          {activeTab === 'backups' ? (
            <div className="flex items-center gap-2">
              <Button size="sm" isIconOnly variant="ghost" onPress={loadBackups} isDisabled={isLoadingBackups || isMutatingBackups}>
                <Icon icon={isLoadingBackups ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={isLoadingBackups ? 'animate-spin' : ''} />
              </Button>
              <Button size="sm" variant="primary" onPress={createBackup} isDisabled={isLoadingBackups || isMutatingBackups}>
                <Icon icon={isMutatingBackups ? 'lucide:loader-circle' : 'lucide:archive'} className={isMutatingBackups ? 'animate-spin' : ''} />
                创建备份
              </Button>
            </div>
          ) : null}

          {activeTab === 'uninstall' ? (
            <div className="flex items-center gap-2">
              <Button size="sm" isIconOnly variant="ghost" onPress={() => loadEnvironment(true)} isDisabled={state === 'loading' || isUninstallRunning}>
                <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
              </Button>
            </div>
          ) : null}
        </div>

        {activeTab === 'basic' && data ? (
          <>
            <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
              <Card>
                <Card.Header>
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon icon="lucide:server-cog" className="size-6 shrink-0 text-muted" />
                    <div className="min-w-0">
                      <Card.Title>Gateway 服务</Card.Title>
                    </div>
                  </div>
                </Card.Header>
                <Card.Content>
                  <StatusItemList
                    items={[
                      { icon: 'lucide:radio-tower', title: 'TCP', description: 'Gateway 端口连通性', ok: data.gateway.tcpReachable },
                      { icon: 'lucide:activity', title: 'HTTP Health', description: 'HTTP 健康检查', ok: data.gateway.httpHealthOk },
                      { icon: 'lucide:heart-pulse', title: 'Healthz', description: '基础健康状态', ok: data.gateway.healthzOk },
                      { icon: 'lucide:badge-check', title: 'Readyz', description: '服务就绪状态', ok: data.gateway.readyzOk },
                    ]}
                  />
                  <InfoGrid
                    columns={4}
                    items={[
                      { icon: 'lucide:shield-check', label: '认证模式', value: data.gateway.authMode },
                      { icon: 'lucide:badge-info', label: 'HTTP 状态', value: data.gateway.httpHealthStatus },
                      { icon: 'lucide:cpu', label: 'Owner PID', value: data.gateway.ownerPid },
                      { icon: 'lucide:rocket', label: '启动来源', value: data.gateway.ownerStartedBy },
                      // ['Owner 记录', data.gateway.ownerRecordStatus],
                    ]}
                  />
                </Card.Content>
              </Card>

              <Card className="relative overflow-visible">
                {hasOpenClawUpdate ? (
                  <div className="absolute right-4 top-4 z-10">
                    <Tooltip delay={300}>
                      <Button
                        aria-label="更新 OpenClaw"
                        isPending={isUpdateRunning}
                        size="sm"
                        onPress={() => setUpdateDialogOpen(true)}
                      >
                        <Icon icon={isUpdateRunning ? 'lucide:loader-circle' : 'lucide:arrow-up-right'} className={isUpdateRunning ? 'size-4 animate-spin' : 'size-4'} />
                        {targetOpenClawVersion ? `更新到 ${targetOpenClawVersion}` : '存在可用更新'}
                      </Button>
                      <Tooltip.Content>
                        {targetOpenClawVersion ? `更新到 ${targetOpenClawVersion}` : '存在可用更新'}
                      </Tooltip.Content>
                    </Tooltip>
                  </div>
                ) : null}
                <Card.Header className={hasOpenClawUpdate ? 'pr-48' : undefined}>
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon icon="lucide:terminal-square" className="size-6 shrink-0 text-muted" />
                    <div className="min-w-0">
                      <Card.Title>CLI 工具</Card.Title>
                    </div>
                  </div>
                </Card.Header>
                <Card.Content>
                  <div className="grid gap-3">
                    <ItemCard className="min-w-0">
                      <ItemCard.Icon>
                        <Icon icon="lucide:tag" className="text-muted" />
                      </ItemCard.Icon>
                      <ItemCard.Content className="min-w-0">
                        <ItemCard.Title>版本</ItemCard.Title>
                        <ItemCard.Description className="min-w-0 break-words text-foreground [overflow-wrap:anywhere]">
                          {cliVersion || '-'}
                        </ItemCard.Description>
                      </ItemCard.Content>
                    </ItemCard>
                    <ItemCard className="min-w-0">
                      <ItemCard.Icon>
                        <Icon icon="lucide:package-check" className="text-muted" />
                      </ItemCard.Icon>
                      <ItemCard.Content className="min-w-0">
                        <ItemCard.Title>来源</ItemCard.Title>
                        <ItemCard.Description className="min-w-0 break-words text-foreground [overflow-wrap:anywhere]">
                          {data.cli.source || '-'}
                        </ItemCard.Description>
                      </ItemCard.Content>
                    </ItemCard>
                    <ItemCard className="min-w-0">
                      <ItemCard.Icon>
                        <Icon icon="lucide:folder-code" className="text-muted" />
                      </ItemCard.Icon>
                      <ItemCard.Content className="min-w-0">
                        <ItemCard.Title>路径</ItemCard.Title>
                        <ItemCard.Description className="min-w-0 break-words text-foreground [overflow-wrap:anywhere]">
                          {data.cli.path || '-'}
                        </ItemCard.Description>
                      </ItemCard.Content>
                    </ItemCard>
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
                      { icon: 'lucide:home', title: 'Home', description: 'OpenClaw 本地目录', ok: data.home.exists },
                      { icon: 'lucide:file-json', title: 'Config', description: '配置文件存在且有效', ok: data.home.configExists && data.home.configValid },
                      { icon: 'lucide:key-round', title: 'Device Key', description: '设备密钥文件', ok: data.home.deviceKeyExists },
                      { icon: 'lucide:user-check', title: 'Owner', description: 'Gateway owner 记录', ok: data.home.ownerExists },
                    ]}
                  />
                  <InfoGrid
                    columns={2}
                    items={[
                      { icon: 'lucide:house', label: 'Home 路径', value: data.home.path },
                      { icon: 'lucide:file-cog', label: '配置文件', value: data.home.configPath },
                      // ['配置错误', data.home.configError],
                      // ['设备密钥', data.home.deviceKeyPath],
                      // ['Owner 文件', data.home.ownerPath],
                    ]}
                  />
                </Card.Content>
              </Card>

              <Card className="relative overflow-visible">
                <div className="absolute right-4 top-4 z-10">
                  <Tooltip delay={300}>
                    <Button
                      isIconOnly
                      aria-label="查看日志"
                      size="sm"
                      variant="ghost"
                      onPress={() => navigate('/dashboard/openclaw-logs')}
                    >
                      <Icon icon="lucide:external-link" className="size-4" />
                    </Button>
                    <Tooltip.Content>查看日志</Tooltip.Content>
                  </Tooltip>
                </div>
                <Card.Header className="pr-16">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon icon="lucide:scroll-text" className="size-6 shrink-0 text-muted" />
                    <div className="min-w-0">
                      <Card.Title>日志与审计</Card.Title>
                    </div>
                  </div>
                </Card.Header>
                <Card.Content>
                  <InfoGrid
                    items={[
                      { icon: 'lucide:folder-archive', label: '日志目录', value: data.home.logsDir },
                      { icon: 'lucide:file-warning', label: '错误日志', value: data.home.errLogPath },
                      // ['错误日志存在', data.home.errLogExists ? '存在' : '不存在'],
                      { icon: 'lucide:hard-drive', label: '错误日志大小', value: formatBytes(data.home.errLogBytes) },
                      // ['Fatal 标记', data.home.errLogHasFatal ? '存在' : '未发现'],
                      { icon: 'lucide:globe-lock', label: '允许来源', value: data.gateway.allowedOrigins?.join(', ') },
                    ]}
                  />
                </Card.Content>
              </Card>
            </section>
          </>
        ) : null}

        {activeTab === 'instances' ? (
          <InstancesPanel
            entries={presenceEntries}
            error={presenceError}
            isLoading={presenceState === 'loading'}
          />
        ) : null}

        {activeTab === 'settings' ? (
          <OpenClawSettingsPanel
            configError={configError}
            configText={configText}
            gateway={data?.gateway ?? null}
            isLoading={isLoadingConfig}
            isSaving={isSavingConfig}
            publicGateway={publicGatewayData}
            publicGatewayError={publicGatewayError}
            publicGatewayURL={publicGatewayURL}
            isLoadingPublicGateway={isLoadingPublicGateway}
            isPublicGatewayDirty={isPublicGatewayDirty}
            isSavingPublicGateway={isSavingPublicGateway}
            onChange={setConfigText}
            onPublicGatewayChange={setPublicGatewayURL}
            onPublicGatewaySave={savePublicGateway}
          />
        ) : null}

        {activeTab === 'config' ? (
          <OpenClawConfigPanel
            config={configData}
            configError={configError}
            configText={configText}
            editorTheme={isDark ? 'vs-dark' : 'vs'}
            isLoading={isLoadingConfig}
            isSaving={isSavingConfig}
            onChange={setConfigText}
            onCopy={copyConfigText}
            onFormat={formatConfigText}
          />
        ) : null}

        {activeTab === 'backups' ? (
          <OpenClawBackupPanel
            backups={backups}
            directory={backupData?.directory}
            error={backupError}
            isLoading={isLoadingBackups}
            isMutating={isMutatingBackups}
            backupDetail={backupDetail}
            backupDetailError={backupDetailError}
            backupDetailState={backupDetailState}
            onCopyPath={(path) => void copyText(path, '已复制路径')}
            onDelete={deleteBackup}
            onRestore={restoreBackup}
            onView={viewBackup}
            onCopyBackupContent={(content) => void copyText(JSON.stringify(content, null, 2), '已复制备份内容')}
            onCloseViewer={() => {
              setBackupDetail(null)
              setBackupDetailError('')
              setBackupDetailState('idle')
            }}
            editorTheme={isDark ? 'vs-dark' : 'vs'}
          />
        ) : null}

        {activeTab === 'uninstall' ? (
          <OpenClawUninstallPanel
            data={data}
            isRunning={isUninstallRunning}
            logRef={uninstallLogRef}
            task={uninstallTask}
            onClearLog={() => setUninstallTask(null)}
            onRequestUninstall={() => setUninstallConfirmOpen(true)}
          />
        ) : null}

        <OpenClawGatewayDevicePairingModal
          isOpen={isGatewayDevicePairingOpen}
          onApproved={() => void loadEnvironment(true)}
          onOpenChange={setGatewayDevicePairingOpen}
        />

        <OpenClawUpdateDialog
          isOpen={isUpdateDialogOpen}
          isRunning={isUpdateRunning}
          logRef={updateLogRef}
          targetVersion={targetOpenClawVersion}
          task={updateTask}
          onConfirm={startUpdateStream}
          onOpenChange={(open) => {
            if (!open && !isUpdateRunning) {
              setUpdateDialogOpen(false)
            } else if (open) {
              setUpdateDialogOpen(true)
            }
          }}
        />

        <AlertDialog.Backdrop isOpen={isUninstallConfirmOpen} onOpenChange={(open) => !isUninstallRunning && setUninstallConfirmOpen(open)}>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-[500px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>卸载 OpenClaw？</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-sm leading-6 text-muted">
                  这会执行官方卸载流程，移除 OpenClaw CLI、配置、运行状态与本机数据。建议先确认配置备份已经保存。
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

function OpenClawUpdateDialog({
  isOpen,
  isRunning,
  logRef,
  targetVersion,
  task,
  onConfirm,
  onOpenChange,
}: {
  isOpen: boolean
  isRunning: boolean
  logRef: RefObject<HTMLPreElement | null>
  targetVersion: string
  task: OpenClawChannelTaskResponse | null
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  const logs = task?.logs ?? []
  const status = task?.status ?? 'pending'
  const showLogs = task !== null
  const title = targetVersion ? `更新到 ${targetVersion}` : '更新 OpenClaw？'
  const description = targetVersion
    ? `将执行官方更新流程并实时显示终端日志，目标版本：${targetVersion}。`
    : '将执行官方更新流程，并实时显示终端日志。'
  const statusText = status === 'done' ? '更新完成' : status === 'error' ? '更新失败' : isRunning ? '更新中' : '等待确认'

  const copyLogs = async () => {
    const text = [logs.join('\n'), task?.error ? task.error : ''].filter(Boolean).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('更新日志已复制')
    } catch {
      toast.warning('日志复制失败')
    }
  }

  return (
    <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className={showLogs ? 'sm:max-w-[720px]' : 'sm:max-w-[500px]'}>
          <AlertDialog.CloseTrigger />
          <AlertDialog.Header>
            <AlertDialog.Icon status={status === 'error' ? 'danger' : 'warning'} />
            <AlertDialog.Heading>{title}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p className="text-sm leading-6 text-muted">{description}</p>
            {showLogs ? (
              <div className="mt-4 overflow-hidden rounded-lg border border-border bg-content2">
                <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                    <Icon icon={isRunning ? 'lucide:loader-circle' : status === 'error' ? 'lucide:circle-alert' : 'lucide:circle-check'} className={isRunning ? 'size-4 animate-spin text-accent' : status === 'error' ? 'size-4 text-danger' : 'size-4 text-success'} />
                    <span>{statusText}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button isIconOnly aria-label="复制更新日志" size="sm" variant="ghost" onPress={() => void copyLogs()} isDisabled={logs.length === 0 && !task?.error}>
                      <Icon icon="lucide:copy" className="size-4" />
                    </Button>
                    <span className="text-xs text-muted">{task?.progress ?? 0}%</span>
                  </div>
                </div>
                <pre ref={logRef} className="max-h-72 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5 text-foreground">
                  {[logs.join('\n'), task?.error ? task.error : ''].filter(Boolean).join('\n')}
                </pre>
              </div>
            ) : null}
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="tertiary" isDisabled={isRunning}>取消</Button>
            <Button variant="primary" onPress={onConfirm} isDisabled={isRunning || status === 'done'}>
              <Icon icon={isRunning ? 'lucide:loader-circle' : 'lucide:arrow-up-circle'} className={isRunning ? 'animate-spin' : ''} />
              开始更新
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}

function OpenClawUninstallPanel({
  data,
  isRunning,
  logRef,
  task,
  onClearLog,
  onRequestUninstall,
}: {
  data: OpenClawEnvironmentResponse | null
  isRunning: boolean
  logRef: RefObject<HTMLPreElement | null>
  task: OpenClawChannelTaskResponse | null
  onClearLog: () => void
  onRequestUninstall: () => void
}) {
  const cliAvailable = Boolean(data?.cli.available)
  const homeExists = Boolean(data?.home.exists)
  const gatewayRunning = Boolean(data && isGatewayReachable(data))

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
            <Icon icon="lucide:trash-2" className="size-7" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold">卸载 OpenClaw</div>
            <div className="text-sm text-muted">危险操作：完整卸载OpenClaw，开始前请先确认。</div>
          </div>
        </div>

        <div className="grid gap-2">
          <StatusItemList
            items={[
              { icon: 'lucide:terminal-square', title: 'CLI', description: cliAvailable ? data?.cli.path || data?.cli.source || 'openclaw 命令仍存在' : 'openclaw CLI 已移除', ok: !cliAvailable },
              { icon: 'lucide:home', title: 'Home', description: homeExists ? data?.home.path || 'OpenClaw 本地目录仍存在' : 'OpenClaw 本地目录已移除', ok: !homeExists },
              { icon: 'lucide:radio-tower', title: 'Gateway', description: gatewayRunning ? 'Gateway 仍在运行' : 'Gateway 未运行', ok: !gatewayRunning },
              { icon: 'lucide:file-json', title: '配置', description: data?.home.configExists ? data?.home.configPath || 'openclaw.json 仍存在' : 'openclaw.json 已移除', ok: !data?.home.configExists },
            ]}
          />

          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>卸载 OpenClaw</Alert.Title>
              <Alert.Description>
                卸载会移除 OpenClaw CLI、配置、运行状态和本机数据。这个操作适合重装前清理，请确认需要保留的信息已经备份。
              </Alert.Description>
            </Alert.Content>
          </Alert>


          <div className="flex items-center gap-2 mt-2">
            <Button className="w-full" size="sm" variant="danger" isDisabled={isRunning} onPress={onRequestUninstall}>
              <Icon icon={isRunning ? 'lucide:loader-circle' : 'lucide:trash-2'} className={isRunning ? 'animate-spin' : ''} />
              卸载 OpenClaw
            </Button>
          </div>

        </div>
      </div>

      <OpenClawUninstallLogCard
        isRunning={isRunning}
        logRef={logRef}
        task={task}
        onClear={onClearLog}
      />
    </div>
  )
}

function OpenClawUninstallLogCard({
  isRunning,
  logRef,
  task,
  onClear,
}: {
  isRunning: boolean
  logRef: RefObject<HTMLPreElement | null>
  task: OpenClawChannelTaskResponse | null
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

type ConfigFieldType = 'text' | 'password' | 'number' | 'toggle' | 'textarea' | 'select' | 'emoji' | 'json'

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

type ParsedConfigResult =
  | { ok: true; value: Record<string, unknown>; message?: never }
  | { ok: false; message: string; value?: never }

const identityFields: ConfigField[] = [
  { path: 'ui.assistant.name', label: '助手名称', type: 'text', placeholder: 'OpenClaw', icon: 'lucide:user-round' },
  { path: 'ui.assistant.avatar', label: '助手头像', type: 'emoji', icon: 'lucide:smile' },
  { path: 'messages.responsePrefix', label: '回复前缀', type: 'text', placeholder: '[OpenClaw]', icon: 'lucide:message-square-text' },
  {
    path: 'messages.ackReactionScope',
    label: '确认反应范围',
    type: 'select',
    options: ['all', 'group-mentions', 'group-all', 'direct', 'off', 'none'],
    optionLabels: {
      all: '全部消息',
      'group-mentions': '群聊提及时',
      'group-all': '群聊全部消息',
      direct: '仅私聊',
      off: '关闭',
      none: '无确认反应',
    },
    icon: 'lucide:badge-check',
  },
  { path: 'session.maintenance.maxEntries', label: '会话条目上限', type: 'number', placeholder: '2000', min: 1, integer: true, icon: 'lucide:list-end' },
]

const agentDefaultFields: ConfigField[] = [
  { path: 'agents.defaults.model.primary', label: '默认主模型', type: 'text', placeholder: 'provider/model 或 model-id', icon: 'lucide:bot' },
  { path: 'agents.defaults.contextTokens', label: '默认上下文 Token', type: 'number', placeholder: '128000', min: 1, integer: true, icon: 'lucide:braces' },
  { path: 'agents.defaults.maxConcurrent', label: '最大并发', type: 'number', placeholder: '4', min: 1, integer: true, icon: 'lucide:git-branch-plus' },
  {
    path: 'agents.defaults.compaction.mode',
    label: '压缩模式',
    type: 'select',
    options: ['default', 'safeguard', 'aggressive', 'off'],
    optionLabels: {
      default: '默认策略',
      safeguard: '保护上下文',
      aggressive: '积极压缩',
      off: '关闭压缩',
    },
    icon: 'lucide:archive-restore',
  },
  { path: 'agents.defaults.compaction.maxHistoryShare', label: '历史占比上限', type: 'number', placeholder: '0.75', min: 0, max: 1, icon: 'lucide:chart-no-axes-column' },
]

const agentToolFields: ConfigField[] = [
  {
    path: 'tools.profile',
    label: '工具配置档',
    type: 'select',
    options: ['minimal', 'coding', 'messaging', 'full'],
    optionLabels: {
      minimal: '最小权限',
      coding: '编码工具',
      messaging: '消息工具',
      full: '完整权限',
    },
    icon: 'lucide:wrench',
  },
]

const gatewayFields: ConfigField[] = [
  { path: 'gateway.port', label: '端口', type: 'number', placeholder: '18789', min: 1, max: 65535, integer: true, icon: 'lucide:plug' },
  { path: 'gateway.auth.mode', label: '认证模式', type: 'select', options: ['none', 'token', 'password', 'trusted-proxy'], icon: 'lucide:shield-check' },
  { path: 'gateway.auth.token', label: '认证 Token', type: 'text', placeholder: '建议使用 32 bytes hex 密钥', icon: 'lucide:key-round' },
  {
    path: 'gateway.controlUi.dangerouslyDisableDeviceAuth',
    label: '跳过 Control UI 设备配对',
    type: 'toggle',
    description: '允许 Web 和客户端无需设备批准直接连接 Control UI。',
    icon: 'lucide:shield-off',
  },
]

const queueFields: ConfigField[] = [
  {
    path: 'messages.queue.mode',
    label: '消息队列模式',
    type: 'select',
    options: ['steer', 'queue', 'followup', 'collect', 'steer-backlog', 'interrupt'],
    optionLabels: {
      steer: '引导当前运行',
      queue: '逐条引导',
      followup: '稍后跟进',
      collect: '合并后跟进',
      'steer-backlog': '引导并保留跟进',
      interrupt: '中断当前运行',
    },
    icon: 'lucide:messages-square',
  },
  { path: 'messages.queue.debounceMs', label: '队列静默窗口（毫秒）', type: 'number', placeholder: '500', min: 0, integer: true, icon: 'lucide:timer-reset' },
  { path: 'messages.queue.cap', label: '单会话队列上限', type: 'number', placeholder: '20', min: 1, integer: true, icon: 'lucide:list-end' },
  {
    path: 'messages.queue.drop',
    label: '队列溢出策略',
    type: 'select',
    options: ['summarize', 'old', 'new'],
    optionLabels: {
      summarize: '丢旧并摘要',
      old: '丢弃最早消息',
      new: '拒绝最新消息',
    },
    icon: 'lucide:funnel',
  },
  {
    path: 'messages.queue.byChannel',
    label: '按渠道队列模式',
    type: 'json',
    placeholder: '{\n  "discord": "collect",\n  "telegram": "steer"\n}',
    rows: 4,
    icon: 'lucide:route',
  },
  {
    path: 'broadcast.strategy',
    label: '广播策略',
    type: 'select',
    options: ['parallel', 'sequential'],
    optionLabels: {
      parallel: '并行处理',
      sequential: '顺序处理',
    },
    icon: 'lucide:radio',
  },
  {
    path: 'broadcast',
    label: '广播目标映射',
    type: 'json',
    description: 'broadcast 完整对象；键为 peerId，值为 Agent ID 数组，可包含 strategy。',
    placeholder: '{\n  "strategy": "parallel",\n  "120363403215116621@g.us": ["main", "reviewer"]\n}',
    rows: 6,
    icon: 'lucide:share-2',
  },
]

const hooksFields: ConfigField[] = [
  { path: 'hooks.enabled', label: '启用 Hooks', type: 'toggle', icon: 'lucide:webhook' },
  { path: 'hooks.path', label: 'Hooks 路径', type: 'text', placeholder: '/hooks', icon: 'lucide:link' },
  { path: 'hooks.token', label: 'Hooks Token', type: 'password', placeholder: '专用 Hook 访问令牌', icon: 'lucide:key-round' },
  { path: 'hooks.maxBodyBytes', label: 'Hooks 请求体上限', type: 'number', placeholder: '262144', min: 1, integer: true, icon: 'lucide:file-archive' },
  { path: 'hooks.defaultSessionKey', label: 'Hooks 默认会话', type: 'text', placeholder: 'hook:ingress', icon: 'lucide:message-square' },
  { path: 'hooks.allowRequestSessionKey', label: '允许请求指定会话', type: 'toggle', icon: 'lucide:message-square-more' },
]

const runtimeFields: ConfigField[] = [
  { path: 'tools.agentToAgent.enabled', label: '启用 Agent 间委托', type: 'toggle', icon: 'lucide:users-round' },
  { path: 'session.agentToAgent.maxPingPongTurns', label: '最大来回委托轮次', type: 'number', placeholder: '4', min: 1, integer: true, icon: 'lucide:repeat-2' },
  {
    path: 'tools.sessions.visibility',
    label: '会话可见性',
    type: 'select',
    options: ['self', 'tree', 'agent', 'all'],
    optionLabels: {
      self: '仅当前会话',
      tree: '当前会话树',
      agent: '同一 Agent',
      all: '全部会话',
    },
    icon: 'lucide:eye',
  },
  {
    path: 'session.dmScope',
    label: '私聊隔离范围',
    type: 'select',
    options: ['main', 'per-peer', 'per-channel-peer', 'per-account-channel-peer'],
    optionLabels: {
      main: '共享主会话',
      'per-peer': '按联系人隔离',
      'per-channel-peer': '按渠道和联系人隔离',
      'per-account-channel-peer': '按账号、渠道和联系人隔离',
    },
    icon: 'lucide:message-circle',
  },
  { path: 'tools.exec.timeoutSec', label: '命令超时（秒）', type: 'number', placeholder: '30', min: 1, integer: true, icon: 'lucide:timer' },
  {
    path: 'tools.exec.host',
    label: '命令执行主机',
    type: 'select',
    options: ['auto', 'sandbox', 'gateway', 'node'],
    optionLabels: {
      auto: '自动选择',
      sandbox: '沙箱内执行',
      gateway: 'Gateway 主机',
      node: 'Node 主机',
    },
    icon: 'lucide:hard-drive',
  },
  {
    path: 'tools.exec.security',
    label: '命令安全模式',
    type: 'select',
    options: ['deny', 'allowlist', 'full'],
    optionLabels: {
      deny: '禁止执行',
      allowlist: '仅允许白名单',
      full: '完全允许',
    },
    icon: 'lucide:shield',
  },
  {
    path: 'tools.exec.ask',
    label: '命令审批模式',
    type: 'select',
    options: ['off', 'on-miss', 'always'],
    optionLabels: {
      off: '不询问',
      'on-miss': '白名单外询问',
      always: '总是询问',
    },
    icon: 'lucide:circle-help',
  },
  { path: 'tools.exec.strictInlineEval', label: '严格内联执行审批', type: 'toggle', icon: 'lucide:file-lock-2' },
]

const webSearchFields: ConfigField[] = [
  { path: 'tools.web.search.enabled', label: '启用 Web 搜索', type: 'toggle', icon: 'lucide:search' },
  { path: 'tools.web.search.provider', label: '搜索提供商', type: 'select', options: ['brave', 'duckduckgo', 'exa', 'firecrawl', 'gemini', 'grok', 'kimi', 'minimax', 'ollama', 'perplexity', 'searxng', 'tavily'], icon: 'lucide:blocks' },
  { path: 'tools.web.search.apiKey', label: '搜索 API Key', type: 'password', placeholder: '按所选搜索提供商填写', icon: 'lucide:key-round' },
  { path: 'tools.web.search.maxResults', label: '最大结果数', type: 'number', placeholder: '5', min: 1, max: 20, integer: true, icon: 'lucide:list-ordered' },
  { path: 'tools.web.search.timeoutSeconds', label: '超时（秒）', type: 'number', placeholder: '30', min: 1, max: 300, integer: true, icon: 'lucide:clock-3' },
  { path: 'tools.web.search.openaiCodex.enabled', label: '启用 Codex 原生搜索', type: 'toggle', icon: 'lucide:sparkles' },
  {
    path: 'tools.web.search.openaiCodex.mode',
    label: 'Codex 搜索模式',
    type: 'select',
    options: ['cached', 'live'],
    optionLabels: {
      cached: '缓存优先',
      live: '实时搜索',
    },
    icon: 'lucide:wifi',
  },
]

const automationFields: ConfigField[] = [
  { path: 'cron.enabled', label: '启用 Cron', type: 'toggle', icon: 'lucide:calendar-clock' },
  { path: 'cron.maxConcurrentRuns', label: 'Cron 最大并发任务', type: 'number', placeholder: '4', min: 1, integer: true, icon: 'lucide:workflow' },
  { path: 'commands.native', label: '原生命令', type: 'select', options: ['auto', 'on', 'off'], icon: 'lucide:terminal' },
  { path: 'commands.nativeSkills', label: '原生技能', type: 'select', options: ['auto', 'on', 'off'], icon: 'lucide:puzzle' },
  { path: 'commands.restart', label: '允许重启命令', type: 'toggle', icon: 'lucide:rotate-ccw' },
  { path: 'agents.defaults.heartbeat.every', label: '默认心跳间隔', type: 'text', placeholder: '30m', icon: 'lucide:heart-pulse' },
  { path: 'agents.defaults.heartbeat.target', label: '默认心跳目标', type: 'select', options: ['none', 'last', 'telegram', 'whatsapp', 'discord', 'slack', 'signal', 'line', 'feishu', 'wecom', 'qq'], icon: 'lucide:send' },
  { path: 'agents.defaults.heartbeat.prompt', label: '心跳提示词', type: 'textarea', placeholder: '请做轻量自检并回报关键状态。', icon: 'lucide:file-text' },
]

const approvalForwardingFields: ConfigField[] = [
  { path: 'approvals.exec.enabled', label: '启用执行审批转发', type: 'toggle', icon: 'lucide:terminal-square' },
  {
    path: 'approvals.exec.mode',
    label: '执行审批转发模式',
    type: 'select',
    options: ['session', 'targets', 'both'],
    optionLabels: {
      session: '来源会话',
      targets: '指定目标',
      both: '来源会话和目标',
    },
    icon: 'lucide:send',
  },
  {
    path: 'approvals.exec.targets',
    label: '执行审批转发目标',
    type: 'json',
    description: '目标数组，例如 [{ "channel": "slack", "to": "U123" }]。',
    placeholder: '[\n  { "channel": "slack", "to": "U12345678" },\n  { "channel": "telegram", "to": "123456789" }\n]',
    rows: 5,
    icon: 'lucide:send',
  },
  { path: 'approvals.plugin.enabled', label: '启用 Plugin 审批转发', type: 'toggle', icon: 'lucide:puzzle' },
  {
    path: 'approvals.plugin.mode',
    label: 'Plugin 审批转发模式',
    type: 'select',
    options: ['session', 'targets', 'both'],
    optionLabels: {
      session: '来源会话',
      targets: '指定目标',
      both: '来源会话和目标',
    },
    icon: 'lucide:send-horizontal',
  },
  {
    path: 'approvals.plugin.targets',
    label: 'Plugin 审批转发目标',
    type: 'json',
    description: '目标数组，结构与 approvals.exec.targets 相同。',
    placeholder: '[\n  { "channel": "slack", "to": "U12345678" }\n]',
    rows: 4,
    icon: 'lucide:send-horizontal',
  },
  {
    path: 'channels.discord.execApprovals.enabled',
    label: 'Discord 原生审批',
    type: 'select',
    options: ['auto', 'true', 'false'],
    optionLabels: {
      auto: '自动启用',
      true: '强制启用',
      false: '关闭',
    },
    optionValues: { auto: 'auto', true: true, false: false },
    icon: 'lucide:message-circle',
  },
  {
    path: 'channels.discord.execApprovals.target',
    label: 'Discord 审批位置',
    type: 'select',
    options: ['dm', 'channel', 'both'],
    optionLabels: {
      dm: '审批人私聊',
      channel: '来源频道',
      both: '私聊和来源频道',
    },
    icon: 'lucide:map-pin',
  },
  {
    path: 'channels.slack.execApprovals.enabled',
    label: 'Slack 原生审批',
    type: 'select',
    options: ['auto', 'true', 'false'],
    optionLabels: {
      auto: '自动启用',
      true: '强制启用',
      false: '关闭',
    },
    optionValues: { auto: 'auto', true: true, false: false },
    icon: 'lucide:message-circle',
  },
  {
    path: 'channels.slack.execApprovals.target',
    label: 'Slack 审批位置',
    type: 'select',
    options: ['dm', 'channel', 'both'],
    optionLabels: {
      dm: '审批人私聊',
      channel: '来源频道',
      both: '私聊和来源频道',
    },
    icon: 'lucide:map-pin',
  },
  {
    path: 'channels.telegram.execApprovals.enabled',
    label: 'Telegram 原生审批',
    type: 'select',
    options: ['auto', 'true', 'false'],
    optionLabels: {
      auto: '自动启用',
      true: '强制启用',
      false: '关闭',
    },
    optionValues: { auto: 'auto', true: true, false: false },
    icon: 'lucide:message-circle',
  },
  {
    path: 'channels.telegram.execApprovals.target',
    label: 'Telegram 审批位置',
    type: 'select',
    options: ['dm', 'channel', 'both'],
    optionLabels: {
      dm: '审批人私聊',
      channel: '来源聊天',
      both: '私聊和来源聊天',
    },
    icon: 'lucide:map-pin',
  },
  {
    path: 'channels.matrix.execApprovals.target',
    label: 'Matrix 审批位置',
    type: 'select',
    options: ['dm', 'channel', 'both'],
    optionLabels: {
      dm: '审批人私聊',
      channel: '来源房间',
      both: '私聊和来源房间',
    },
    icon: 'lucide:map-pin',
  },
]

const configSettingsGroups: ConfigSettingsGroup[] = [
  {
    id: 'gateway',
    title: '网关配置',
    description: '编辑 Gateway 监听端口、绑定策略和认证方式。',
    icon: 'lucide:globe',
    fields: gatewayFields,
  },
  {
    id: 'identity',
    title: '身份消息',
    description: '控制助手外观、回复前缀、确认 reaction 和会话维护体验。',
    icon: 'lucide:users',
    fields: identityFields,
  },
  {
    id: 'agents',
    title: 'Agent 默认上下文',
    description: '管理所有 Agent 共享的默认模型、上下文预算、并发和压缩策略。',
    icon: 'lucide:brain',
    fields: agentDefaultFields,
  },
  {
    id: 'tools',
    title: 'Agent 工具权限',
    description: '配置全局工具配置档、工具允许/禁止清单，以及沙箱内工具边界。',
    icon: 'lucide:wrench',
    fields: agentToolFields,
    listFields: [
      { label: '允许工具', path: 'tools.allow', placeholder: 'web_search, exec, browser', icon: 'lucide:list-checks' },
      { label: '禁止工具', path: 'tools.deny', placeholder: 'exec, fs, bundle-mcp', icon: 'lucide:list-x' },
      { label: '沙箱允许工具', path: 'tools.sandbox.tools.allow', placeholder: 'exec, fs.read', icon: 'lucide:shield-check' },
      { label: '沙箱禁止工具', path: 'tools.sandbox.tools.deny', placeholder: 'fs.write, browser', icon: 'lucide:shield-x' },
    ],
  },
  {
    id: 'runtime',
    title: 'Agent / 会话治理',
    description: '集中管理 Agent 间委托、会话可见性、DM 隔离和命令执行安全边界。',
    icon: 'lucide:shield-check',
    fields: runtimeFields,
    listFields: [
      { label: '命令白名单', path: 'tools.exec.safeBins', placeholder: 'ls, cat, git, npm', icon: 'lucide:list-checks' },
      { label: 'Agent 委托白名单', path: 'tools.agentToAgent.allow', placeholder: '*, main->work, work->main', icon: 'lucide:network' },
    ],
  },
  {
    id: 'search',
    title: '搜索与外部信息',
    description: '配置 Web Search、Codex 原生搜索和域名白名单。',
    icon: 'lucide:search',
    fields: webSearchFields,
    listFields: [
      { label: 'Codex 域名白名单', path: 'tools.web.search.openaiCodex.allowedDomains', placeholder: 'example.com, docs.openai.com', icon: 'lucide:globe-lock' },
    ],
  },
  {
    id: 'messages',
    title: '消息队列与广播',
    description: '配置入站消息排队、溢出处理、按渠道队列模式和多 Agent 广播策略。',
    icon: 'lucide:messages-square',
    fields: queueFields,
  },
  {
    id: 'automation',
    title: '自动化与运行维护',
    description: '配置 Cron、命令开关和 Heartbeat 默认投递策略。',
    icon: 'lucide:refresh-cw',
    fields: automationFields,
  },
  {
    id: 'approvals',
    title: '执行审批转发',
    description: '配置 exec / plugin 审批提示转发目标，以及 Slack、Discord、Telegram、Matrix 的原生审批位置。',
    icon: 'lucide:badge-check',
    fields: approvalForwardingFields,
    listFields: [
      { label: '执行审批 Agent 过滤', path: 'approvals.exec.agentFilter', placeholder: 'main, work', icon: 'lucide:bot' },
      { label: '执行审批会话过滤', path: 'approvals.exec.sessionFilter', placeholder: 'discord, ops-room', icon: 'lucide:filter' },
      { label: 'Plugin 审批 Agent 过滤', path: 'approvals.plugin.agentFilter', placeholder: 'main, work', icon: 'lucide:bot' },
      { label: 'Plugin 审批会话过滤', path: 'approvals.plugin.sessionFilter', placeholder: 'telegram, slack', icon: 'lucide:filter' },
      { label: 'Discord 审批人', path: 'channels.discord.execApprovals.approvers', placeholder: '1234567890, 9876543210', icon: 'lucide:users' },
      { label: 'Slack 审批人', path: 'channels.slack.execApprovals.approvers', placeholder: 'U12345678, U87654321', icon: 'lucide:users' },
      { label: 'Telegram 审批人', path: 'channels.telegram.execApprovals.approvers', placeholder: '123456789, 987654321', icon: 'lucide:users' },
    ],
  },
  {
    id: 'hooks',
    title: 'Hooks 配置',
    description: '配置 HTTP Hooks 入口、认证、会话路由和预设。',
    icon: 'lucide:webhook',
    fields: hooksFields,
    listFields: [
      { label: 'Hooks 允许 Agent', path: 'hooks.allowedAgentIds', placeholder: 'hooks, main', icon: 'lucide:users-round' },
      { label: 'Hooks 会话前缀', path: 'hooks.allowedSessionKeyPrefixes', placeholder: 'hook:, hook:gmail:', icon: 'lucide:list-filter' },
      { label: 'Hooks Presets', path: 'hooks.presets', placeholder: 'gmail', icon: 'lucide:puzzle' },
    ],
  },
]

function AgentBoxPublicGatewayCard({
  data,
  disabled,
  error,
  gateway,
  isDirty,
  isSaving,
  value,
  onChange,
  onSave,
}: {
  data: OpenClawPublicGatewayResponse | null
  disabled: boolean
  error: string
  gateway: OpenClawEnvironmentResponse['gateway'] | null
  isDirty: boolean
  isSaving: boolean
  value: string
  onChange: (value: string) => void
  onSave: () => void
}) {
  const currentHTTPURL = data?.publicUrl || gateway?.publicUrl || gateway?.url || ''
  const currentWebSocketURL = data?.publicWebSocketUrl || gateway?.publicWebSocketUrl || gateway?.webSocketUrl || ''

  return (
    <Card className="min-w-0" variant="transparent">
      <Card.Header>
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-muted">
            <Icon icon="lucide:radio-tower" className="size-5" />
          </div>
          <div className="min-w-0">
            <Card.Title>OpenClaw 公网 Gateway</Card.Title>
            <Card.Description>浏览器控制台和日志优先连接此远程 Gateway。</Card.Description>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        <div className="grid gap-3">
          {error ? (
            <div className="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          ) : null}
          <ItemCardGroup className="overflow-hidden">
            <ItemCard>
              <ItemCard.Icon className="size-10 rounded-full bg-surface-secondary/50 text-muted">
                <Icon icon="lucide:link" className="size-5" />
              </ItemCard.Icon>
              <ItemCard.Content>
                <ItemCard.Title>OPENCLAW_PUBLIC_GATEWAY_URL</ItemCard.Title>
                <ItemCard.Description>浏览器可访问的 OpenClaw Gateway 地址。</ItemCard.Description>
              </ItemCard.Content>
              <ItemCard.Action>
                <Input
                  aria-label="OPENCLAW_PUBLIC_GATEWAY_URL"
                  variant="secondary"
                  className={settingControlClassName}
                  disabled={disabled}
                  value={value}
                  placeholder="https://xxx"
                  onChange={(event) => onChange(event.target.value)}
                />
              </ItemCard.Action>
            </ItemCard>
            <FragmentWithSeparator showSeparator>
              <ItemCard>
                <ItemCard.Icon className="size-10 rounded-full bg-surface-secondary/50 text-muted">
                  <Icon icon="lucide:globe" className="size-5" />
                </ItemCard.Icon>
                <ItemCard.Content className="min-w-0">
                  <ItemCard.Title>当前 HTTP</ItemCard.Title>
                  <ItemCard.Description>浏览器最终使用的 HTTP Gateway。</ItemCard.Description>
                </ItemCard.Content>
                <ItemCard.Action>
                  <span className="block max-w-96 break-all text-right text-sm text-muted">{currentHTTPURL || '-'}</span>
                </ItemCard.Action>
              </ItemCard>
            </FragmentWithSeparator>
            <FragmentWithSeparator showSeparator>
              <ItemCard>
                <ItemCard.Icon className="size-10 rounded-full bg-surface-secondary/50 text-muted">
                  <Icon icon="lucide:radio-receiver" className="size-5" />
                </ItemCard.Icon>
                <ItemCard.Content className="min-w-0">
                  <ItemCard.Title>当前 WebSocket</ItemCard.Title>
                  <ItemCard.Description>浏览器最终使用的 WebSocket Gateway。</ItemCard.Description>
                </ItemCard.Content>
                <ItemCard.Action>
                  <span className="block max-w-96 break-all text-right text-sm text-muted">{currentWebSocketURL || '-'}</span>
                </ItemCard.Action>
              </ItemCard>
            </FragmentWithSeparator>
          </ItemCardGroup>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">留空会清除覆盖值，前端回退到本机 Gateway。</p>
            <Button
              size="sm"
              variant={isDirty ? 'primary' : 'secondary'}
              isDisabled={disabled || !isDirty}
              onPress={onSave}
            >
              <Icon icon={isSaving ? 'lucide:loader-circle' : 'lucide:save'} className={isSaving ? 'animate-spin' : ''} />
              保存
            </Button>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function OpenClawSettingsPanel({
  configError,
  configText,
  gateway,
  isLoading,
  isSaving,
  publicGateway,
  publicGatewayError,
  publicGatewayURL,
  isLoadingPublicGateway,
  isPublicGatewayDirty,
  isSavingPublicGateway,
  onChange,
  onPublicGatewayChange,
  onPublicGatewaySave,
}: {
  configError: string
  configText: string
  gateway: OpenClawEnvironmentResponse['gateway'] | null
  isLoading: boolean
  isSaving: boolean
  publicGateway: OpenClawPublicGatewayResponse | null
  publicGatewayError: string
  publicGatewayURL: string
  isLoadingPublicGateway: boolean
  isPublicGatewayDirty: boolean
  isSavingPublicGateway: boolean
  onChange: (value: string) => void
  onPublicGatewayChange: (value: string) => void
  onPublicGatewaySave: () => void
}) {
  const [activeSettingGroup, setActiveSettingGroup] = useState(configSettingsGroups[0].id)
  const parsed = useMemo(() => parseConfigText(configText), [configText])
  const content = parsed.ok ? parsed.value : {}
  const disabled = isLoading || isSaving || !parsed.ok
  const parseError = getConfigParseError(parsed)
  const selectedGroup = configSettingsGroups.find((group) => group.id === activeSettingGroup) ?? configSettingsGroups[0]
  const selectedFields = selectedGroup.fields.filter((field) => field.type !== 'json' && field.type !== 'textarea')
  const selectedStandaloneFields = selectedGroup.fields.filter((field) => field.type === 'json' || field.type === 'textarea')

  const setValue = useCallback((path: string, value: unknown) => {
    if (!parsed.ok) return
    const next = setConfigValue(parsed.value, path, value)
    onChange(JSON.stringify(next, null, 2))
  }, [onChange, parsed])

  return (
    <div className={`grid gap-4 ${isLoading || isSaving ? 'pointer-events-none opacity-60' : ''}`}>
      {configError || !parsed.ok ? (
        <Card>
          <Card.Content>
            <div className="flex items-start gap-3 text-danger">
              <Icon icon="lucide:triangle-alert" className="mt-0.5 size-5 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium">配置无法结构化编辑</p>
                <p className="mt-1 text-sm text-muted">{configError || parseError}</p>
              </div>
            </div>
          </Card.Content>
        </Card>
      ) : null}

      <div className="grid gap-2 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="h-fit lg:sticky lg:top-4">
          <Card.Content>
            <Tabs aria-label="OpenClaw 设置项" orientation="vertical" selectedKey={activeSettingGroup} onSelectionChange={(key) => setActiveSettingGroup(String(key))}>
              <Tabs.ListContainer className="w-full">
                <Tabs.List className="w-full">
                  {configSettingsGroups.map((group) => (
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
          {selectedGroup.id === 'gateway' ? (
            <AgentBoxPublicGatewayCard
              data={publicGateway}
              disabled={isLoadingPublicGateway || isSavingPublicGateway}
              error={publicGatewayError}
              gateway={gateway}
              isDirty={isPublicGatewayDirty}
              isSaving={isSavingPublicGateway}
              value={publicGatewayURL}
              onChange={onPublicGatewayChange}
              onSave={onPublicGatewaySave}
            />
          ) : null}

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
  const value = readConfigValue(config, field.path)
  const id = `openclaw-config-${field.path.replace(/[^a-z0-9_-]/gi, '-')}`
  const isJsonField = field.type === 'json'

  return (
    <Card className="min-w-0">
      <Card.Header>
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-secondary/50 text-muted">
            <Icon icon={field.icon || (isJsonField ? 'lucide:braces' : getConfigFieldIcon(field))} className="size-5" />
          </div>
          <div className="min-w-0">
            <Card.Title>{field.label}</Card.Title>
            <Card.Description>{field.description || field.path}</Card.Description>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        {isJsonField ? (
          <JsonConfigFieldControl
            key={`${field.path}-${formatJsonFieldValue(value)}`}
            disabled={disabled}
            field={field}
            id={id}
            value={value}
            onChange={onChange}
          />
        ) : (
          <ConfigFieldControl config={config} disabled={disabled} field={field} onChange={onChange} />
        )}
      </Card.Content>
    </Card>
  )
}

function ConfigFieldControl({ config, disabled, field, onChange }: { config: Record<string, unknown>; disabled: boolean; field: ConfigField; onChange: (path: string, value: unknown) => void }) {
  const value = readConfigValue(config, field.path)
  const id = `openclaw-config-${field.path.replace(/[^a-z0-9_-]/gi, '-')}`

  if (field.type === 'toggle') {
    return (
      <Switch size="lg" aria-label={field.label} isSelected={value === true} isDisabled={disabled} onChange={(isSelected) => onChange(field.path, isSelected)}>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch>
    )
  }

  if (field.type === 'emoji') {
    return (
      <EmojiPickerField
        value={typeof value === 'string' ? value : ''}
        isDisabled={disabled}
        onChange={(emoji) => onChange(field.path, emoji || undefined)}
      />
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
        onChange={(nextValue: Key | null) => {
          onChange(field.path, getSelectOptionValue(field, nextValue))
        }}
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

  if (field.type === 'json') {
    return (
      <JsonConfigFieldControl
        key={`${field.path}-${formatJsonFieldValue(value)}`}
        disabled={disabled}
        field={field}
        id={id}
        value={value}
        onChange={onChange}
      />
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
        rows={3}
        className="w-full min-w-0 rounded-xl border border-divider bg-surface-secondary/50 px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted focus:border-accent disabled:opacity-60"
      />
    )
  }

  if (field.type === 'password') {
    return <PasswordConfigFieldControl disabled={disabled} field={field} id={id} value={value} onChange={onChange} />
  }

  return (
    <div className="flex w-full min-w-0 items-center gap-2">
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
      {field.path === 'gateway.auth.token' ? (
        <Tooltip delay={300}>
          <Button isIconOnly aria-label="随机生成认证 Token" variant="ghost" isDisabled={disabled} onPress={() => onChange(field.path, generateOpenClawAuthToken())}>
            <Icon icon="lucide:refresh-cw" className="size-4" />
          </Button>
          <Tooltip.Content>随机生成 Token</Tooltip.Content>
        </Tooltip>
      ) : null}
    </div>
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

function JsonConfigFieldControl({
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
  const [draft, setDraft] = useState(formatJsonFieldValue(value))

  const commitDraft = useCallback(() => {
    const nextDraft = draft.trim()
    if (!nextDraft) {
      onChange(field.path, undefined)
      return
    }

    try {
      onChange(field.path, JSON.parse(nextDraft) as unknown)
    } catch {
      toast.warning(`${field.label} 不是合法 JSON`)
    }
  }, [draft, field.label, field.path, onChange])

  return (
    <textarea
      id={id}
      aria-label={field.label}
      value={draft}
      disabled={disabled}
      onBlur={commitDraft}
      onChange={(event) => setDraft(event.target.value)}
      placeholder={field.placeholder}
      rows={field.rows ?? 4}
      className="w-full min-w-0 rounded-xl border border-divider bg-surface-secondary/50 px-3 py-2 font-mono text-sm text-foreground outline-none transition placeholder:text-muted focus:border-accent disabled:opacity-60"
    />
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

function getConfigFieldIcon(field: ConfigField): string {
  if (field.type === 'toggle') return 'lucide:toggle-right'
  if (field.type === 'select') return 'lucide:list-filter'
  if (field.type === 'number') return 'lucide:hash'
  if (field.type === 'password') return 'lucide:key-round'
  if (field.type === 'textarea') return 'lucide:file-text'
  if (field.type === 'json') return 'lucide:braces'
  if (field.type === 'emoji') return 'lucide:smile'
  return 'lucide:type'
}

function parseConfigText(value: string): ParsedConfigResult {
  try {
    const parsed = JSON.parse(value || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, message: 'openclaw.json 顶层必须是 JSON 对象' }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '配置文件不是合法 JSON' }
  }
}

function getConfigParseError(result: ParsedConfigResult): string {
  return result.ok ? '' : result.message
}

function readConfigValue(raw: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object' || Array.isArray(acc)) return undefined
    return (acc as Record<string, unknown>)[key]
  }, raw)
}

function setConfigValue(raw: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const clone = cloneJson(raw)
  const keys = path.split('.')
  let cursor: Record<string, unknown> = clone
  keys.slice(0, -1).forEach((key) => {
    const next = cursor[key]
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cursor[key] = {}
    }
    cursor = cursor[key] as Record<string, unknown>
  })
  const lastKey = keys[keys.length - 1]
  if (value === undefined || value === '') {
    delete cursor[lastKey]
  } else {
    cursor[lastKey] = value
  }
  return clone
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? {}))
}

function formatJsonFieldValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function normalizeFieldInput(value: string, field: ConfigField): unknown {
  if (value === '') return undefined
  if (field.type !== 'number') return value
  const next = Number(value)
  if (!Number.isFinite(next)) return undefined
  return field.integer ? Math.trunc(next) : next
}

function generateOpenClawAuthToken() {
  const bytes = new Uint8Array(32)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  return Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

function parseConfigListInput(value: string): string[] {
  return value
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index)
}

function OpenClawConfigPanel({
  config,
  configError,
  configText,
  editorTheme,
  isLoading,
  isSaving,
  onChange,
  onCopy,
  onFormat,
}: {
  config: OpenClawConfigResponse | null
  configError: string
  configText: string
  editorTheme: 'vs' | 'vs-dark'
  isLoading: boolean
  isSaving: boolean
  onChange: (value: string) => void
  onCopy: () => void
  onFormat: () => void
}) {
  return (
    <Card className="relative overflow-visible">
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <Button size="sm" isIconOnly variant="ghost" onPress={onCopy} isDisabled={!configText}>
          <Icon icon="lucide:copy" />
        </Button>
        <Button size="sm" isIconOnly variant="ghost" onPress={onFormat} isDisabled={!configText || isLoading || isSaving}>
          <Icon icon="lucide:align-left" />
        </Button>
      </div>
      <Card.Header className="pr-28">
        <div className="flex min-w-0 items-center gap-2">
          <Icon icon="lucide:file-code-2" className="size-6 shrink-0 text-muted" />
          <div className="min-w-0">
            <Card.Title>配置文件</Card.Title>
            <Card.Description>{config?.path || 'OpenClaw openclaw.json'}</Card.Description>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        {configError ? (
          <div className="mb-3 rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
            {configError}
          </div>
        ) : null}
        <div className={`overflow-hidden h-[calc(100dvh-270px)] rounded-2xl border border-divider ${isLoading || isSaving ? 'pointer-events-none opacity-60' : ''}`}>
          <Editor
            height="100%"
            defaultLanguage="json"
            language="json"
            theme={editorTheme}
            value={configText}
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

function OpenClawBackupPanel({
  backups,
  directory,
  error,
  isLoading,
  isMutating,
  backupDetail,
  backupDetailError,
  backupDetailState,
  editorTheme,
  onCloseViewer,
  onCopyBackupContent,
  onCopyPath,
  onDelete,
  onRestore,
  onView,
}: {
  backups: OpenClawConfigBackup[]
  directory?: string
  error: string
  isLoading: boolean
  isMutating: boolean
  backupDetail: OpenClawConfigBackupDetailResponse | null
  backupDetailError: string
  backupDetailState: 'idle' | 'loading' | 'ready' | 'error'
  editorTheme: 'vs' | 'vs-dark'
  onCloseViewer: () => void
  onCopyBackupContent: (content: Record<string, unknown>) => void
  onCopyPath: (path: string) => void
  onDelete: (backup: OpenClawConfigBackup) => void
  onRestore: (backup: OpenClawConfigBackup) => void
  onView: (backup: OpenClawConfigBackup) => void
}) {
  const [pendingAction, setPendingAction] = useState<{
    backup: OpenClawConfigBackup
    type: 'delete' | 'restore'
  } | null>(null)
  const [isViewerOpen, setIsViewerOpen] = useState(false)
  const isDeleteAction = pendingAction?.type === 'delete'
  const isLoadingBackupDetail = backupDetailState === 'loading'
  const backupDetailText = useMemo(() => JSON.stringify(backupDetail?.content ?? {}, null, 2), [backupDetail])

  return (
    <>
      <Card>
        <Card.Header>
          <div className="flex min-w-0 items-center gap-2">
            <Icon icon="lucide:archive-restore" className="size-6 shrink-0 text-muted" />
            <div className="min-w-0">
              <Card.Title>配置备份</Card.Title>
              <Card.Description>{directory || 'OpenClaw Home/config-backups'}</Card.Description>
            </div>
          </div>
        </Card.Header>
        <Card.Content>
          {error ? (
            <div className="mb-3 rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          ) : null}

          {isLoading ? <BackupSkeleton /> : null}

          {!isLoading && backups.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-divider bg-surface-secondary/50 px-6 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted/10 text-muted">
                <Icon icon="lucide:archive" className="size-6" />
              </div>
              <h3 className="mt-4 font-semibold text-foreground">暂无配置备份</h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-muted">点击右上角“创建备份”，会自动备份当前配置。</p>
            </div>
          ) : null}

          {!isLoading && backups.length > 0 ? (
            <ItemCardGroup className={`w-full ${isMutating ? 'pointer-events-none opacity-60' : ''}`}>
              {backups.map((backup, index) => (
                <FragmentWithSeparator key={backup.name} showSeparator={index > 0}>
                  <ItemCard>
                    <ItemCard.Icon className="size-10 rounded-full bg-surface-secondary/50 text-muted">
                      <Icon icon="lucide:file-json-2" className="size-5" />
                    </ItemCard.Icon>
                    <ItemCard.Content>
                      <ItemCard.Title>{backup.name}</ItemCard.Title>
                      <ItemCard.Description>{backup.path}</ItemCard.Description>
                    </ItemCard.Content>
                    <ItemCard.Action>
                      <div className="flex items-center gap-2">
                        <div className="hidden text-right sm:block">
                          <p className="text-sm font-semibold text-foreground">{formatDateTime(backup.createdAt || backup.updatedAt)}</p>
                          <p className="text-xs text-muted">{formatBytes(backup.size)}</p>
                        </div>
                        <Dropdown>
                          <Button isIconOnly aria-label="配置备份操作" size="sm" variant="ghost">
                            <Icon icon="lucide:ellipsis" className="size-4" />
                          </Button>
                          <Dropdown.Popover className="min-w-[auto]" placement="bottom end">
                            <Dropdown.Menu>
                              <Dropdown.Item textValue="恢复" onAction={() => setPendingAction({ backup, type: 'restore' })}>
                                <Icon icon="lucide:rotate-ccw" className="size-4" />
                                <Label>恢复</Label>
                              </Dropdown.Item>
                              <Dropdown.Item textValue="复制" onAction={() => onCopyPath(backup.path)}>
                                <Icon icon="lucide:copy" className="size-4" />
                                <Label>复制</Label>
                              </Dropdown.Item>
                              <Dropdown.Item
                                textValue="查看"
                                onAction={() => {
                                  setIsViewerOpen(true)
                                  onView(backup)
                                }}
                              >
                                <Icon icon="lucide:eye" className="size-4" />
                                <Label>查看</Label>
                              </Dropdown.Item>
                              <Separator />
                              <Dropdown.Item textValue="删除" onAction={() => setPendingAction({ backup, type: 'delete' })}>
                                <Icon icon="lucide:trash-2" className="size-4 text-danger" />
                                <Label className="text-danger">删除</Label>
                              </Dropdown.Item>
                            </Dropdown.Menu>
                          </Dropdown.Popover>
                        </Dropdown>
                      </div>
                    </ItemCard.Action>
                  </ItemCard>
                </FragmentWithSeparator>
              ))}
            </ItemCardGroup>
          ) : null}
        </Card.Content>
      </Card>

      <AlertDialog.Backdrop isOpen={isViewerOpen} onOpenChange={(open) => {
        setIsViewerOpen(open)
        if (!open) {
          onCloseViewer()
        }
      }}>
        <AlertDialog.Container size="lg">
          <AlertDialog.Dialog className="sm:max-w-[720px]">
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Heading>{'备份-' + backupDetail?.backup.name || '查看备份内容'}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              {backupDetailError ? (
                <div className="mb-3 rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger"> {backupDetailError}</div>
              ) : null}
              <div className={`overflow-hidden rounded-2xl border border-divider ${isLoadingBackupDetail ? 'pointer-events-none opacity-60' : ''}`}>
                <Editor
                  height="min(70vh, 640px)"
                  defaultLanguage="json"
                  language="json"
                  theme={editorTheme}
                  value={backupDetailText}
                  options={{
                    automaticLayout: true,
                    domReadOnly: true,
                    fontSize: 13,
                    minimap: { enabled: false },
                    readOnly: true,
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                  }}
                />
              </div>
            </AlertDialog.Body>
            <AlertDialog.Footer>

              <Button slot="close" variant="tertiary">
                关闭
              </Button>
              <Button size="sm" variant="primary" onPress={() => backupDetail && onCopyBackupContent(backupDetail.content)} isDisabled={!backupDetail}>
                <Icon icon="lucide:copy" className="size-4" />
                复制
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      <AlertDialog.Backdrop isOpen={pendingAction !== null} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[420px]">
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status={isDeleteAction ? 'danger' : 'warning'} />
              <AlertDialog.Heading>{isDeleteAction ? '删除这个配置备份？' : '恢复这个配置备份？'}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>{pendingAction ? getBackupDialogBody(pendingAction) : ''}</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                取消
              </Button>
              <Button
                slot="close"
                variant={isDeleteAction ? 'danger' : 'primary'}
                onPress={() => {
                  if (!pendingAction) return
                  const action = pendingAction
                  setPendingAction(null)
                  if (action.type === 'delete') {
                    onDelete(action.backup)
                  } else {
                    onRestore(action.backup)
                  }
                }}
              >
                {isDeleteAction ? '删除备份' : '恢复备份'}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
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

function getBackupDialogBody(action: { backup: OpenClawConfigBackup; type: 'delete' | 'restore' }) {
  if (action.type === 'delete') {
    return `这会永久删除备份文件 ${action.backup.name}，删除后无法从备份列表恢复。`
  }
  return `这会用 ${action.backup.name} 覆盖当前 openclaw.json。建议确认当前配置已经备份后再继续。`
}

function ServiceHeroSummaryCard({
  actionState,
  cliAvailable,
  data,
  isRefreshing,
  isRunning,
  onInstall,
  onRestart,
  onStop,
}: {
  actionState: 'idle' | 'restarting' | 'stopping'
  cliAvailable: boolean
  data: OpenClawEnvironmentResponse | null
  isRefreshing: boolean
  isRunning: boolean
  onInstall: () => void
  onRestart: () => void
  onStop: () => void
}) {
  const gateway = data?.gateway
  const isInstalled = Boolean(data?.cli.available && data.home.exists && data.home.configExists)
  const isRestarting = actionState === 'restarting'
  const isStopping = actionState === 'stopping'
  const canRestartGateway = cliAvailable && !isStopping && !isRefreshing
  const canStopGateway = cliAvailable && isRunning && !isRestarting && !isRefreshing
  const statusLabel = isRunning ? '运行中' : '未运行'
  const statusText = gateway?.readyzOk
    ? 'Gateway 已就绪'
    : gateway?.httpHealthOk
      ? '健康检查通过，等待就绪'
      : isRunning
        ? '端口可达，健康检查未通过'
        : '未检测到可用 Gateway'

  return (
    <Card className="h-full">
      <Card.Content>
        <div className="flex h-full flex-col justify-center px-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className={isRunning ? 'flex size-11 shrink-0 items-center justify-center rounded-full bg-success/10 text-success shadow-[0_0_18px_color-mix(in_oklch,var(--success)_55%,transparent)]' : 'flex size-11 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning'}>
                  <Icon icon={isRunning ? 'lucide:radio-tower' : 'lucide:server-off'} className="size-5" />
                </div>
                <div className="min-w-0 pl-2">
                  <div className="truncate text-base font-semibold text-foreground">{statusLabel}</div>
                  <div className="truncate text-xs text-muted">{statusText}</div>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs text-muted">端口</div>
                <div className="mt-1 font-semibold tabular-nums text-foreground">{gateway?.port ?? '-'}</div>
              </div>
            </div>
            <div className="mt-4 flex flex-row items-center gap-2">
              {isInstalled ? (
                <>
                  <Button className="flex-1" size="sm" variant="primary" isPending={isRestarting} isDisabled={!canRestartGateway} onPress={onRestart}>
                    {({ isPending }) => (
                      <>
                        {isPending ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:rotate-ccw" className="size-4" />}
                        重启
                      </>
                    )}
                  </Button>
                  <Button className="flex-1" size="sm" variant="danger" isPending={isStopping} isDisabled={!canStopGateway} onPress={onStop}>
                    {({ isPending }) => (
                      <>
                        {isPending ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:square" className="size-4" />}
                        停止
                      </>
                    )}
                  </Button>
                </>
              ) : (
                <Button fullWidth size="sm" variant="primary" onPress={onInstall}>
                  <Icon icon="lucide:package-check" className="size-4" />
                  进入安装向导
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function InstancesPanel({
  entries,
  error,
  isLoading,
}: {
  entries: OpenClawPresenceEntry[]
  error: string
  isLoading: boolean
}) {
  const activeEntries = entries.filter((entry) => entry.reason !== 'disconnect')

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ServiceMetricCard icon="lucide:radio" title="实例" value={String(activeEntries.length)} description="最近 presence 连接" tone={activeEntries.length > 0 ? 'success' : 'warning'} />
        <ServiceMetricCard icon="lucide:monitor-dot" title="Gateway" value={activeEntries.some((entry) => entry.mode === 'gateway') ? '在线' : '未知'} description="本机 Gateway presence" tone={activeEntries.some((entry) => entry.mode === 'gateway') ? 'success' : 'warning'} />
        <ServiceMetricCard icon="lucide:users-round" title="Operator" value={String(activeEntries.filter((entry) => entry.roles?.includes('operator')).length)} description="控制端连接" tone="success" />
        <ServiceMetricCard icon="lucide:clock-3" title="最近上报" value={formatPresenceAge(activeEntries[0]?.ts)} description="system-presence" tone={activeEntries.length > 0 ? 'success' : 'warning'} />
      </section>

      <Card>
        <Card.Header>
          <div className="flex min-w-0 items-center gap-2">
            <Icon icon="lucide:radio-tower" className="size-6 shrink-0 text-muted" />
            <div className="min-w-0">
              <Card.Title>连接实例</Card.Title>
              <Card.Description>来自 Gateway `system-presence` 的客户端与节点上报。</Card.Description>
            </div>
          </div>
        </Card.Header>
        <Card.Content>
          {error ? (
            <div className="rounded-2xl bg-warning/10 p-4 text-sm text-warning">{error}</div>
          ) : isLoading ? (
            <div className="grid gap-2">
              <Skeleton className="h-20 rounded-2xl" />
              <Skeleton className="h-20 rounded-2xl" />
              <Skeleton className="h-20 rounded-2xl" />
            </div>
          ) : entries.length === 0 ? (
            <div className="rounded-2xl bg-surface-secondary/50 p-6 text-center text-sm text-muted">暂无实例上报</div>
          ) : (
            <div className="grid gap-2">
              {entries
                .slice()
                .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
                .map((entry, index) => (
                  <ItemCard key={entry.instanceId || `${entry.host}-${entry.ts}-${index}`} className="min-w-0">
                    <ItemCard.Icon>
                      <Icon icon={entry.mode === 'gateway' ? 'lucide:server' : 'lucide:monitor'} className="text-muted" />
                    </ItemCard.Icon>
                    <ItemCard.Content className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <ItemCard.Title>{entry.host || entry.text || 'unknown host'}</ItemCard.Title>
                        <Chip size="sm" variant="soft" color={entry.mode === 'gateway' ? 'success' : 'default'}>{entry.mode || 'unknown'}</Chip>
                        {entry.reason ? <Chip size="sm" variant="secondary">{entry.reason}</Chip> : null}
                      </div>
                      <ItemCard.Description className="min-w-0 break-words text-foreground [overflow-wrap:anywhere]">
                        {[entry.ip, entry.platform, entry.deviceFamily, entry.modelIdentifier, entry.version].filter(Boolean).join(' · ') || '-'}
                      </ItemCard.Description>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(entry.roles ?? []).map((role) => <Chip key={role} size="sm" variant="secondary">{role}</Chip>)}
                        {(entry.scopes ?? []).slice(0, 4).map((scope) => <Chip key={scope} size="sm" variant="secondary">{scope}</Chip>)}
                      </div>
                    </ItemCard.Content>
                    <ItemCard.Action>
                      <span className="text-xs tabular-nums text-muted">{formatPresenceAge(entry.ts)}</span>
                    </ItemCard.Action>
                  </ItemCard>
                ))}
            </div>
          )}
        </Card.Content>
      </Card>
    </div>
  )
}

function ServiceMetricCard({
  description,
  icon,
  title,
  tone,
  value,
}: {
  description: string
  icon: string
  title: string
  tone: 'success' | 'warning'
  value: string
}) {
  return (
    <Card>
      <Card.Content>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm text-muted">
              <Icon icon={icon} className="size-4 shrink-0" />
              <span>{title}</span>
            </div>
            <div className="mt-4 truncate text-3xl font-semibold tabular-nums text-foreground">{value || '-'}</div>
            <div className="mt-2 truncate text-sm text-muted">{description}</div>
          </div>
          <span className={`mt-1 size-2.5 shrink-0 rounded-full ${tone === 'success' ? 'bg-success' : 'bg-warning'}`} />
        </div>
      </Card.Content>
    </Card>
  )
}

function StatusItemList({ items }: { items: Array<{ description: string; icon: string; ok: boolean; title: string }> }) {
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
              className={`block size-2.5 shrink-0 rounded-full ${item.ok ? 'bg-success shadow-[0_0_12px_color-mix(in_oklch,var(--success)_80%,transparent)]' : 'bg-danger shadow-[0_0_12px_color-mix(in_oklch,var(--danger)_80%,transparent)]'}`}
              aria-label={item.ok ? '正常' : '异常'}
            />
          </ItemCard.Action>
        </ItemCard>
      ))}
    </div>
  )
}

function formatCliVersion(value?: string) {
  if (!value) return ''
  return value.replace(/^OpenClaw\s+/i, '').replace(/\s+\([^)]*\)$/, '').trim()
}

function isGatewayReachable(data: OpenClawEnvironmentResponse) {
  return Boolean(data.gateway.tcpReachable || data.gateway.httpHealthOk || data.gateway.healthzOk || data.gateway.readyzOk)
}

function getGatewayToken(content?: Record<string, unknown>) {
  const gateway = objectRecord(objectRecord(content).gateway)
  const auth = objectRecord(gateway.auth)
  const token = auth.token

  return typeof token === 'string' && token.trim() ? token.trim() : ''
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function formatPresenceAge(value?: number | null) {
  if (!value) return '-'
  const diffSeconds = Math.max(0, Math.floor((Date.now() - value) / 1000))
  if (diffSeconds < 60) return `${diffSeconds}s`
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h`
  return `${Math.floor(diffHours / 24)}d`
}

function formatBytes(value?: number) {
  if (value === undefined) return '-'
  if (value < 1024) return `${numberFormatter.format(value)} B`
  if (value < 1024 ** 2) return `${numberFormatter.format(value / 1024)} KB`
  if (value < 1024 ** 3) return `${numberFormatter.format(value / 1024 ** 2)} MB`
  return `${numberFormatter.format(value / 1024 ** 3)} GB`
}

function formatDateTime(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function InfoGrid({
  items,
  columns = 1,
}: {
  items: Array<{ icon: string; label: string; value: string | number | undefined }>
  columns?: 1 | 2 | 4
}) {
  const gridClassName = columns === 4
    ? 'sm:grid-cols-2 xl:grid-cols-4'
    : columns === 2
      ? 'sm:grid-cols-2'
      : 'grid-cols-1'

  return (
    <div className={`grid gap-3 ${gridClassName}`}>
      {items.map((item) => (
        <ItemCard key={item.label} className="min-w-0">
          <ItemCard.Icon>
            <Icon icon={item.icon} className="text-muted" />
          </ItemCard.Icon>
          <ItemCard.Content className="min-w-0">
            <ItemCard.Title>{item.label}</ItemCard.Title>
            <ItemCard.Description className="min-w-0 whitespace-normal break-words text-foreground [overflow-wrap:anywhere]">
              {item.value === undefined || item.value === '' ? '-' : String(item.value)}
            </ItemCard.Description>
          </ItemCard.Content>
        </ItemCard>
      ))}
    </div>
  )
}

function ServiceSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-24 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  )
}

function BackupSkeleton() {
  return (
    <div className="grid gap-2">
      <Skeleton className="h-16 rounded-2xl" />
      <Skeleton className="h-16 rounded-2xl" />
      <Skeleton className="h-16 rounded-2xl" />
    </div>
  )
}

function appendStreamLog(logs: string[], line: string) {
  const next = line.trim() ? [...logs, line] : logs
  return next.length > 240 ? next.slice(next.length - 240) : next
}

async function copyText(text: string, successMessage = '已复制 OpenClaw 服务信息') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(successMessage)
  } catch {
    toast.warning('复制失败')
  }
}

function buildServiceInfoText(data: OpenClawEnvironmentResponse) {
  return [
    `Gateway: ${data.gateway.url}`,
    `Gateway WebSocket: ${data.gateway.webSocketUrl}`,
    `Public Gateway: ${data.gateway.publicUrl || '-'}`,
    `Public Gateway WebSocket: ${data.gateway.publicWebSocketUrl || '-'}`,
    `Gateway Port: ${data.gateway.port}`,
    `CLI: ${data.cli.version || '-'} (${data.cli.path || data.cli.source || '-'})`,
    `Home: ${data.home.path}`,
    `Config: ${data.home.configPath}`,
    `Logs: ${data.home.logsDir}`,
    `Owner PID: ${data.gateway.ownerPid || '-'}`,
  ].join('\n')
}

export default OpenClawServicePage
