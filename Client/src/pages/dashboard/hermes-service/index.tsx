import { type SVGProps, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Key } from '@heroui/react'
import { Alert, AlertDialog, Button, Card, Chip, Input, ListBox, Modal, Skeleton, Spinner, Switch, Tabs, Tooltip, toast } from '@heroui/react'
import { CellSelect, ItemCard, ItemCardGroup, Segment } from '@heroui-pro/react'
import Editor from '@monaco-editor/react'
import { Icon } from '@iconify/react'
import { parse as parseYAML, stringify as stringifyYAML } from 'yaml'
import { useNavigate } from 'react-router-dom'
import type { HermesEnvironmentResponse, HermesInstancesResponse, HermesTaskResponse, HermesTaskStreamError, HermesTaskStreamLog, HermesTaskStreamMeta, HermesTaskStreamStatus, HermesTextFileResponse, HermesUpdateStatusResponse } from '@/api'
import { getHermesConfig, getHermesDoctorStreamURL, getHermesEnv, getHermesInstances, getHermesUninstallStreamURL, getHermesUpdateStatus, getHermesUpdateStreamURL, restartHermesGateway, stopHermesGateway, updateHermesConfig, updateHermesEnv } from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { useHermesAgentStore } from '@/stores/hermes-agent'
import { useThemeStore } from '@/stores/theme'
import { useHermesEnvironmentStore } from '@/stores/hermes-environment'

const numberFormatter = new Intl.NumberFormat('zh-CN')
const defaultSelectKey = '__default__'
const settingControlClassName = 'w-full min-w-0'

function HermesServiceHeroIllustration(props: Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'xmlns'>) {
  const { className, ...rest } = props
  const accentSoft = 'color-mix(in oklch, var(--accent) 36%, white)'
  const accentAccent = 'color-mix(in oklch, var(--accent), white 28%)'
  const accentBright = 'color-mix(in oklch, var(--accent), white 26%)'
  const radarArcStroke = 'rgba(235, 236, 236, 1)'
  const radarGradId = 'hermesServiceHeroRadar'
  const scopeGradId = 'hermesServiceHeroScope'
  const serverGradId = 'hermesServiceHeroServer'

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="92 0 308 252"
      fill="none"
      className={className}
      aria-hidden
      {...rest}
    >
      <defs>
        <linearGradient id={radarGradId} x1="185.432" y1="72.329" x2="215.168" y2="89.497" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={accentBright} />
          <stop offset="1" stopColor="var(--accent)" />
        </linearGradient>
        <linearGradient id={scopeGradId} x1="346.969" y1="189.537" x2="382.232" y2="189.537" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor={accentBright} />
        </linearGradient>
        <linearGradient id={serverGradId} x1="320" y1="149" x2="200" y2="149" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor={accentBright} />
        </linearGradient>
      </defs>
      <path d="M200.173 0L100.173 57.095L100.173 118.828C100.173 175.125 124.905 225.124 200.173 250C274.905 225.124 300.173 175.125 300.173 118.828L300.173 57.095L200.173 0Z" fill="#EBECEC" />
      <path d="M200.173 25L120.173 70.6764L120.173 120.062C120.173 165.1 139.959 205.1 200.173 225C259.958 205.1 280.173 165.1 280.173 120.062L280.173 70.6764L200.173 25Z" fill="#FFFFFF" />
      <path d="M201.173 175L201.173 249.575L199.921 250C151.114 233.855 123.539 207.146 110.173 175.001L201.173 175Z" fill="#C3C5C6" />
      <path d="M200.173 175L200.173 225L198.376 224.397C165.504 213.177 144.933 195.865 133.173 175.001L200.173 175Z" fill="#F7F7F7" />
      <path d="M200.173 0L200.173 250C274.905 225.125 300.173 175.125 300.173 118.828L300.173 57.0952L200.173 0Z" fill="#F7F7F7" />
      <path stroke={radarArcStroke} strokeWidth="1.118446601941748" d="M167.538 71.2095C165.786 77.786 165.857 84.6884 167.545 91.0489" />
      <path d="M200.184 38L200.194 80.9126L162.965 102.372C166.612 108.69 171.922 114.163 178.702 118.072C199.261 129.92 225.55 122.888 237.42 102.366C249.289 81.8442 242.246 55.6025 221.686 43.7546C214.901 39.8438 207.493 37.9913 200.184 38Z" fill="#EBECEC" />
      <path d="M200.036 46.583L200.043 80.9128L170.261 98.0804C173.178 103.135 177.425 107.514 182.85 110.64C199.297 120.119 220.328 114.494 229.824 98.0761C239.32 81.6583 233.685 60.6651 217.238 51.1866C211.809 48.0582 205.883 46.576 200.036 46.583Z" fill="#FFFFFF" />
      <path stroke={radarArcStroke} strokeWidth="1.118446601941748" d="M159.35 69.0527C157.113 76.8802 156.989 85.4065 159.351 93.6363" />
      <path
        d="M226.048 80.9137C226.048 95.1337 214.52 106.662 200.3 106.662C186.08 106.662 174.552 95.1337 174.552 80.9137C174.552 66.6937 186.08 55.1655 200.3 55.1655C214.52 55.1655 226.048 66.6937 226.048 80.9137Z"
        fill={accentSoft}
      />
      <path d="M200.3 80.9153L222.595 93.7872C227.033 86.0841 227.363 76.2928 222.597 68.0396L222.597 68.0391L200.3 80.9153Z" fill={accentAccent} />
      <path d="M183.135 80.913C183.135 90.3937 190.82 98.0784 200.3 98.0784C209.781 98.0784 217.466 90.3937 217.466 80.913C217.466 71.4328 209.781 63.7476 200.3 63.7476C190.82 63.7476 183.135 71.4328 183.135 80.913Z" fill={`url(#${radarGradId})`} />
      <path d="M200.301 80.9135L215.165 72.3308C212.251 67.2006 206.536 63.748 200.3 63.748L200.301 80.9135Z" fill={accentAccent} />
      <path d="M200.3 80.9149L215.163 89.496C218.121 84.3609 218.341 77.8332 215.165 72.3311L215.165 72.3306L200.3 80.9149Z" fill="#181818" />
      <path d="M170.261 63.748L200.245 80.9134L200.246 46.5825C187.432 46.5825 176.246 53.487 170.261 63.748Z" fill="#F7F7F7" />
      <path d="M208.883 85.9201L200.3 90.7837L200.3 81.0565L208.883 76.1929L208.883 85.9201Z" fill="#C3C5C6" />
      <path d="M191.717 85.9201L191.717 76.1929L200.3 81.0565L200.3 90.7837L191.717 85.9201Z" fill="#F7F7F7" />
      <path d="M200.3 71.2578L191.717 76.1931L200.3 81.0567L208.883 76.1931L200.3 71.2578Z" fill="#FFFFFF" />
      <path stroke={radarArcStroke} strokeWidth="1.118446601941748" d="M151.157 95.7931C149.754 91.1461 149 86.2238 149 81.1295C149 76.034 149.754 71.1123 151.157 66.4653" />
      <path d="M320 251L400 251L400 241L320 241L320 251Z" fill="#EBECEC" />
      <path d="M341 241L346 241L346 231L341 231L341 241Z" fill="#C3C5C6" />
      <path d="M370 241.147L380 241.147L380 198.937L370 198.937L370 241.147Z" fill="#C3C5C6" />
      <path d="M376.641 202.029C374.933 203.736 372.165 203.736 370.458 202.029L354.392 185.963C352.685 184.256 352.685 181.488 354.392 179.78C356.1 178.073 358.867 178.073 360.575 179.78L376.641 195.846C378.348 197.553 378.348 200.321 376.641 202.029Z" fill="#C3C5C6" />
      <path d="M379.732 198.937L373.549 205.12L362.426 193.996L368.608 187.813L379.732 198.937Z" fill="#C3C5C6" />
      <path d="M347.22 210.319L343.817 206.916L379.612 171.122L383.015 174.524L347.22 210.319Z" fill="#C3C5C6" />
      <path d="M346.969 198.565L355.572 207.168L382.232 180.508L373.629 171.905L346.969 198.565Z" fill={`url(#${scopeGradId})`} />
      <path d="M206 232L314 232L314 149L206 149L206 232Z" fill="#181818" />
      <path d="M200 167L320 167L320 131L200 131L200 167Z" fill={`url(#${serverGradId})`} />
      <path d="M200 209L320 209L320 173L200 173L200 209Z" fill={accentSoft} />
      <path d="M200 251L320 251L320 215L200 215L200 251Z" fill={accentSoft} />
      <path d="M308 149C308 152.312 305.313 155 301.999 155C298.687 155 296 152.312 296 149C296 145.686 298.687 143 301.999 143C305.313 143 308 145.686 308 149Z" fill="#FFFFFF" />
      <path d="M308 191C308 194.312 305.313 197 301.999 197C298.687 197 296 194.312 296 191C296 187.686 298.687 185 301.999 185C305.313 185 308 187.686 308 191Z" fill="#FFFFFF" />
      <path d="M308 233C308 236.312 305.313 239 301.999 239C298.687 239 296 236.312 296 233C296 229.686 298.687 227 301.999 227C305.313 227 308 229.686 308 233Z" fill="#FFFFFF" />
      <path stroke="rgba(255, 255, 255, 1)" strokeWidth="2.5" d="M212 143L230 143" />
      <path stroke="rgba(255, 255, 255, 1)" strokeWidth="2.5" d="M212 155L230 155" />
      <path stroke="rgba(255, 255, 255, 1)" strokeWidth="2.5" d="M212 185L230 185" />
      <path stroke="rgba(255, 255, 255, 1)" strokeWidth="2.5" d="M212 197L230 197" />
    </svg>
  )
}

function HermesServicePage() {
  usePageTitle('Hermes 服务管理')
  const navigate = useNavigate()
  const data = useHermesEnvironmentStore((store) => store.data)
  const loadSharedHermesEnvironment = useHermesEnvironmentStore((store) => store.loadHermesEnvironment)
  const selectedAgentName = useHermesAgentStore((store) => store.selectedName)
  const loadAgents = useHermesAgentStore((store) => store.loadAgents)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<string | number>('basic')
  const [gatewayActionState, setGatewayActionState] = useState<'idle' | 'restarting' | 'stopping'>('idle')
  const [updateStatusState, setUpdateStatusState] = useState<'idle' | 'checking' | 'ready' | 'error' | 'updating'>('idle')
  const [updateStatusData, setUpdateStatusData] = useState<HermesUpdateStatusResponse | null>(null)
  const [updateTask, setUpdateTask] = useState<HermesTaskResponse | null>(null)
  const [isUpdateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [configState, setConfigState] = useState<'idle' | 'loading' | 'saving' | 'ready' | 'error'>('idle')
  const [configData, setConfigData] = useState<HermesTextFileResponse | null>(null)
  const [configText, setConfigText] = useState('')
  const [configError, setConfigError] = useState('')
  const [envState, setEnvState] = useState<'idle' | 'loading' | 'saving' | 'ready' | 'error'>('idle')
  const [envData, setEnvData] = useState<HermesTextFileResponse | null>(null)
  const [envText, setEnvText] = useState('')
  const [envError, setEnvError] = useState('')
  const [instancesState, setInstancesState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [instancesData, setInstancesData] = useState<HermesInstancesResponse | null>(null)
  const [instancesError, setInstancesError] = useState('')
  const [doctorTask, setDoctorTask] = useState<HermesTaskResponse | null>(null)
  const [isDoctorLogOpen, setDoctorLogOpen] = useState(false)
  const [uninstallTask, setUninstallTask] = useState<HermesTaskResponse | null>(null)
  const [isUninstallConfirmOpen, setUninstallConfirmOpen] = useState(false)
  const updateLogRef = useRef<HTMLPreElement | null>(null)
  const updateSourceRef = useRef<EventSource | null>(null)
  const updateStreamFinishedRef = useRef(false)
  const doctorLogRef = useRef<HTMLPreElement | null>(null)
  const doctorSourceRef = useRef<EventSource | null>(null)
  const doctorStreamFinishedRef = useRef(false)
  const uninstallLogRef = useRef<HTMLPreElement | null>(null)
  const uninstallSourceRef = useRef<EventSource | null>(null)
  const uninstallStreamFinishedRef = useRef(false)
  const isDark = useThemeStore((store) => store.isDark)

  const loadEnvironment = useCallback(async (refresh = false) => {
    setState('loading')
    setError('')

    try {
      const payload = await loadSharedHermesEnvironment(refresh, selectedAgentName)
      setState('ready')
      window.dispatchEvent(new Event('hermes:status-refresh'))
      return payload
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hermes 服务信息加载失败')
      setState('error')
      return null
    }
  }, [loadSharedHermesEnvironment, selectedAgentName])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAgents(false)
      void loadEnvironment(false)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadAgents, loadEnvironment])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setConfigData(null)
      setConfigText('')
      setConfigError('')
      setConfigState('idle')
      setEnvData(null)
      setEnvText('')
      setEnvError('')
      setEnvState('idle')
      setInstancesData(null)
      setInstancesError('')
      setInstancesState('idle')
    })
    return () => window.cancelAnimationFrame(frame)
  }, [selectedAgentName])

  const loadConfig = useCallback(async () => {
    setConfigState('loading')
    setConfigError('')

    try {
      const payload = await getHermesConfig(selectedAgentName)
      setConfigData(payload)
      setConfigText(payload.content ?? '')
      setConfigState('ready')
      return payload
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : '配置文件加载失败')
      setConfigState('error')
      return null
    }
  }, [selectedAgentName])

  const loadEnv = useCallback(async () => {
    setEnvState('loading')
    setEnvError('')

    try {
      const payload = await getHermesEnv(selectedAgentName)
      setEnvData(payload)
      setEnvText(payload.content ?? '')
      setEnvState('ready')
      return payload
    } catch (err) {
      setEnvError(err instanceof Error ? err.message : '.env 加载失败')
      setEnvState('error')
      return null
    }
  }, [selectedAgentName])

  const loadInstances = useCallback(async () => {
    setInstancesState('loading')
    setInstancesError('')

    try {
      const payload = await getHermesInstances(50, selectedAgentName)
      setInstancesData(payload)
      setInstancesState('ready')
      return payload
    } catch (err) {
      setInstancesError(err instanceof Error ? err.message : '实例信息加载失败')
      setInstancesState('error')
      return null
    }
  }, [selectedAgentName])

  const saveConfig = useCallback(async () => {
    setConfigState('saving')
    setConfigError('')

    try {
      const payload = await updateHermesConfig(configText, selectedAgentName)
      setConfigData(payload)
      setConfigText(payload.content ?? '')
      setConfigState('ready')
      toast.success('配置文件已更新，正在重启 Gateway')
      setGatewayActionState('restarting')
      try {
        await restartHermesGateway(selectedAgentName)
        toast.success('Gateway 重启完成')
      } catch (restartErr) {
        toast.warning(restartErr instanceof Error ? restartErr.message : 'Gateway 重启失败')
      } finally {
        setGatewayActionState('idle')
      }
      await loadEnvironment(true)
      if (activeTab === 'instances') {
        await loadInstances()
      }
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : '配置文件更新失败')
      setConfigState('error')
      toast.warning('配置文件更新失败')
    }
  }, [activeTab, configText, loadEnvironment, loadInstances, selectedAgentName])

  const saveEnv = useCallback(async () => {
    setEnvState('saving')
    setEnvError('')

    try {
      const payload = await updateHermesEnv(envText, selectedAgentName)
      setEnvData(payload)
      setEnvText(payload.content ?? '')
      setEnvState('ready')
      toast.success('.env 已更新')
      await loadEnvironment(true)
    } catch (err) {
      setEnvError(err instanceof Error ? err.message : '.env 更新失败')
      setEnvState('error')
      toast.warning('.env 更新失败')
    }
  }, [envText, loadEnvironment, selectedAgentName])

  const restartGateway = useCallback(async () => {
    setGatewayActionState('restarting')
    try {
      await restartHermesGateway(selectedAgentName)
      toast.success('Gateway 重启完成')
      await loadEnvironment(true)
      if (activeTab === 'instances') {
        await loadInstances()
      }
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'Gateway 重启失败')
    } finally {
      setGatewayActionState('idle')
    }
  }, [activeTab, loadEnvironment, loadInstances, selectedAgentName])

  const stopGateway = useCallback(async () => {
    setGatewayActionState('stopping')
    try {
      await stopHermesGateway(selectedAgentName)
      toast.success('Gateway 已停止运行')
      await loadEnvironment(true)
      if (activeTab === 'instances') {
        await loadInstances()
      }
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'Gateway 停止失败')
    } finally {
      setGatewayActionState('idle')
    }
  }, [activeTab, loadEnvironment, loadInstances, selectedAgentName])

  const checkHermesUpdate = useCallback(async (refresh = false, notify = false) => {
    setUpdateStatusState('checking')

    try {
      const payload = await getHermesUpdateStatus(refresh)
      setUpdateStatusData(payload)
      setUpdateStatusState('ready')
      if (notify) {
        toast.success(payload.available ? '发现可用更新' : 'Hermes 已是最新版本')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '更新检测失败'
      setUpdateStatusState('error')
      if (notify) {
        toast.warning(message)
      }
    }
  }, [])

  const closeUpdateStream = useCallback(() => {
    updateSourceRef.current?.close()
    updateSourceRef.current = null
  }, [])

  const startUpdateStream = useCallback(() => {
    closeUpdateStream()
    updateStreamFinishedRef.current = false
    setUpdateStatusState('updating')
    setUpdateDialogOpen(true)

    const now = new Date().toISOString()
    setUpdateTask({
      id: `hermes-update-${Date.now()}`,
      logs: ['正在连接 Hermes 更新流式任务。'],
      progress: 0,
      startedAt: now,
      status: 'pending',
      updatedAt: now,
    })

    const source = new EventSource(getHermesUpdateStreamURL())
    updateSourceRef.current = source

    source.addEventListener('meta', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as HermesTaskStreamMeta
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
        const payload = JSON.parse((event as MessageEvent).data) as HermesTaskStreamStatus
        setUpdateTask((current) => current ? {
          ...current,
          error: payload.error || current.error,
          id: payload.id || current.id,
          progress: payload.progress,
          status: payload.status,
          updatedAt: payload.timestamp,
        } : current)
        if (payload.status === 'done') {
          updateStreamFinishedRef.current = true
          closeUpdateStream()
          setUpdateStatusState('ready')
          toast.success('Hermes 更新完成')
          void loadEnvironment(true)
          void getHermesUpdateStatus(true).then(setUpdateStatusData).catch(() => undefined)
        }
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
        const payload = JSON.parse((event as MessageEvent).data) as HermesTaskStreamLog
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
        const payload = JSON.parse(raw) as HermesTaskStreamError
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
      toast.warning('Hermes 更新流式任务连接中断')
      void loadEnvironment(true)
    }
  }, [closeUpdateStream, loadEnvironment])

  const closeDoctorStream = useCallback(() => {
    doctorSourceRef.current?.close()
    doctorSourceRef.current = null
  }, [])

  const startDoctorStream = useCallback(() => {
    closeDoctorStream()
    doctorStreamFinishedRef.current = false
    setDoctorLogOpen(true)

    const now = new Date().toISOString()
    setDoctorTask({
      id: `hermes-doctor-${Date.now()}`,
      logs: ['正在连接 Hermes Doctor 流式任务。'],
      progress: 0,
      startedAt: now,
      status: 'pending',
      updatedAt: now,
    })

    const source = new EventSource(getHermesDoctorStreamURL(selectedAgentName))
    doctorSourceRef.current = source

    source.addEventListener('meta', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as HermesTaskStreamMeta
        setDoctorTask((current) => current ? {
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
        const payload = JSON.parse((event as MessageEvent).data) as HermesTaskStreamStatus
        setDoctorTask((current) => current ? {
          ...current,
          error: payload.error || current.error,
          id: payload.id || current.id,
          progress: payload.progress,
          status: payload.status,
          updatedAt: payload.timestamp,
        } : current)
        if (payload.status === 'done') {
          doctorStreamFinishedRef.current = true
          closeDoctorStream()
          toast.success('Hermes Doctor 执行完成')
          void loadEnvironment(true)
        }
        if (payload.status === 'error' && payload.error) {
          doctorStreamFinishedRef.current = true
          closeDoctorStream()
          toast.warning(payload.error)
          void loadEnvironment(true)
        }
      } catch {
        // ignore malformed status payload
      }
    })

    source.addEventListener('log', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as HermesTaskStreamLog
        setDoctorTask((current) => current ? {
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
        const payload = JSON.parse(raw) as HermesTaskStreamError
        doctorStreamFinishedRef.current = true
        closeDoctorStream()
        setDoctorTask((current) => current ? {
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
      if (doctorStreamFinishedRef.current) return
      doctorStreamFinishedRef.current = true
      closeDoctorStream()
      const timestamp = new Date().toISOString()
      setDoctorTask((current) => current ? {
        ...current,
        error: '流式连接中断',
        logs: appendStreamLog(current.logs, '失败：流式连接中断'),
        progress: 100,
        status: 'error',
        updatedAt: timestamp,
      } : current)
      toast.warning('Hermes Doctor 流式任务连接中断')
      void loadEnvironment(true)
    }
  }, [closeDoctorStream, loadEnvironment, selectedAgentName])

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
      id: `hermes-uninstall-${Date.now()}`,
      logs: ['正在连接 Hermes 卸载流式任务。'],
      progress: 0,
      startedAt: now,
      status: 'pending',
      updatedAt: now,
    })

    const source = new EventSource(getHermesUninstallStreamURL())
    uninstallSourceRef.current = source

    source.addEventListener('meta', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as HermesTaskStreamMeta
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
        const payload = JSON.parse((event as MessageEvent).data) as HermesTaskStreamStatus
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
          toast.success('Hermes 卸载流程完成')
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
        const payload = JSON.parse((event as MessageEvent).data) as HermesTaskStreamLog
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
        const payload = JSON.parse(raw) as HermesTaskStreamError
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
      toast.warning('Hermes 卸载流式任务连接中断')
      void loadEnvironment(true)
    }
  }, [closeUninstallStream, loadEnvironment])

  useEffect(() => () => closeUpdateStream(), [closeUpdateStream])
  useEffect(() => () => closeDoctorStream(), [closeDoctorStream])
  useEffect(() => () => closeUninstallStream(), [closeUninstallStream])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (isHermesUninstalled(data)) return
      if (activeTab === 'instances' && instancesState === 'idle') {
        void loadInstances()
      }
      if ((activeTab === 'settings' || activeTab === 'config') && configState === 'idle') {
        void loadConfig()
      }
      if (activeTab === 'env' && envState === 'idle') {
        void loadEnv()
      }
    }, 0)

    return () => window.clearTimeout(timer)
  }, [activeTab, configState, data, envState, instancesState, loadConfig, loadEnv, loadInstances])

  const isLoading = state === 'loading' && !data
  const refreshButtonVariant = state === 'loading' ? 'danger' : state === 'error' ? 'primary' : 'ghost'
  const gatewayStatus = data ? getHermesGatewayStatus(data) : null
  const isGatewayRunning = Boolean(gatewayStatus?.isServiceAvailable)
  const isUninstalled = isHermesUninstalled(data)
  const effectiveActiveTab = isUninstalled && activeTab !== 'basic' && activeTab !== 'uninstall' ? 'basic' : activeTab
  const failedChecks = useMemo(() => data?.checks.filter((check) => !check.ok) ?? [], [data])
  const isLoadingConfig = configState === 'loading' && !configData
  const isSavingConfig = configState === 'saving'
  const isConfigDirty = configText !== (configData?.content ?? '')
  const isLoadingEnv = envState === 'loading' && !envData
  const isSavingEnv = envState === 'saving'
  const isEnvDirty = envText !== (envData?.content ?? '')
  const isLoadingInstances = instancesState === 'loading' && !instancesData
  const editorTheme = isDark ? 'vs-dark' : 'vs'
  const isUpdateRunning = updateTask?.status === 'pending' || updateTask?.status === 'running' || updateStatusState === 'updating'
  const isDoctorRunning = doctorTask?.status === 'pending' || doctorTask?.status === 'running'
  const isUninstallRunning = uninstallTask?.status === 'pending' || uninstallTask?.status === 'running'
  const hasHermesUpdate = data?.cli.available === true && updateStatusData?.available === true
  const targetHermesVersion = updateStatusData?.latestVersion || updateStatusData?.currentVersion || ''

  useEffect(() => {
    if (!updateLogRef.current) return
    updateLogRef.current.scrollTop = updateLogRef.current.scrollHeight
  }, [updateTask?.logs, updateTask?.status])

  useEffect(() => {
    if (!doctorLogRef.current) return
    doctorLogRef.current.scrollTop = doctorLogRef.current.scrollHeight
  }, [doctorTask?.logs, doctorTask?.status])

  useEffect(() => {
    if (!uninstallLogRef.current) return
    uninstallLogRef.current.scrollTop = uninstallLogRef.current.scrollHeight
  }, [uninstallTask?.logs, uninstallTask?.status])

  useEffect(() => {
    if (!data?.cli.available) {
      return
    }

    const timer = window.setTimeout(() => {
      void checkHermesUpdate(false)
    }, 1800)

    return () => window.clearTimeout(timer)
  }, [checkHermesUpdate, data?.cli.available, data?.cli.path, data?.cli.version])

  const copyServiceInfo = useCallback(() => {
    if (!data) return
    void copyText(buildServiceInfoText(data), '已复制 Hermes 服务信息')
  }, [data])

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
                <h2 className="mt-4 text-lg font-semibold text-foreground">无法加载 Hermes 服务信息</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{error}</p>
                <Button className="mt-6" variant={refreshButtonVariant} onPress={() => void loadEnvironment(true)} isDisabled={state === 'loading'}>
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
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-warning/10 px-4 py-3 text-warning">
            <div className="flex min-w-0 items-start gap-3">
              <Icon icon="lucide:triangle-alert" className="mt-0.5 size-5 shrink-0" />
              <p className="min-w-0 text-sm leading-6 text-muted">{error}</p>
            </div>
            <Button size="sm" variant="ghost" onPress={() => void loadEnvironment(true)} isDisabled={state === 'loading'}>
              <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
              重试
            </Button>
          </div>
        ) : null}

        {/* {error && data ? (
          <Card>
            <Card.Content>
              <div className="flex items-start gap-3 text-warning">
                <Icon icon="lucide:triangle-alert" className="mt-0.5 size-5" />
                <div>
                  <p className="font-medium">Hermes 服务信息刷新失败</p>
                  <p className="mt-1 text-sm text-muted">{error}</p>
                </div>
              </div>
            </Card.Content>
          </Card>
        ) : null} */}

        {isLoading ? <ServiceSkeleton /> : null}

        {data ? (
          <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
            <Card variant="transparent" className="h-full overflow-visible">
              <Card.Content className="flex h-full items-center justify-start overflow-visible">
                <div className="flex w-full flex-row items-center gap-4 overflow-visible md:gap-6">
                  <div className="flex h-36 shrink-0 items-center justify-center overflow-visible rounded-2xl p-1 drop-shadow-[0_8px_14px_color-mix(in_oklch,var(--accent)_28%,transparent)]">
                    <HermesServiceHeroIllustration className="h-full w-auto md:scale-105" />
                  </div>
                  <div className="flex min-w-0 flex-col gap-5">
                    <div className="min-w-0">
                      <Card.Title className="md:text-3xl text-2xl font-bold">服务管理</Card.Title>
                      <Card.Description className="mt-4 md:text-lg text-base">查看 Hermes CLI、Home、配置、环境变量和 Gateway 运行状态。</Card.Description>
                    </div>
                  </div>
                </div>
              </Card.Content>
            </Card>

            <HermesHeroSummaryCard
              actionState={gatewayActionState}
              cliAvailable={Boolean(data.cli.available)}
              data={data}
              isRefreshing={state === 'loading'}
              isRunning={isGatewayRunning}
              onInstall={() => navigate('/dashboard/hermes-install')}
              onRestart={() => void restartGateway()}
              onStop={() => void stopGateway()}
            />
          </section>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Segment aria-label="Hermes 服务管理" selectedKey={effectiveActiveTab} onSelectionChange={setActiveTab}>
            <Segment.Item id="basic">
              <Segment.Separator />
              基本信息
            </Segment.Item>
            {!isUninstalled ? (
              <>
                <Segment.Item id="settings">
                  <Segment.Separator />
                  配置
                </Segment.Item>
                <Segment.Item id="instances">
                  <Segment.Separator />
                  实例
                </Segment.Item>
                <Segment.Item id="config">
                  <Segment.Separator />
                  配置文件
                </Segment.Item>
                <Segment.Item id="env">
                  <Segment.Separator />
                  环境变量
                </Segment.Item>
              </>
            ) : null}
            <Segment.Item id="uninstall">
              <Segment.Separator />
              卸载
            </Segment.Item>
          </Segment>

          {effectiveActiveTab === 'basic' ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="tertiary" onPress={startDoctorStream} isDisabled={!data?.cli.available || isDoctorRunning}>
                <Icon icon={isDoctorRunning ? 'lucide:loader-circle' : 'lucide:stethoscope'} className={isDoctorRunning ? 'animate-spin' : ''} />
                Hermes Doctor
              </Button>
              <Tooltip delay={300}>
                <Button size="sm" isIconOnly variant="ghost" aria-label="复制 Hermes 服务信息" onPress={copyServiceInfo} isDisabled={!data}>
                  <Icon icon="lucide:copy" />
                </Button>
                <Tooltip.Content>复制服务信息</Tooltip.Content>
              </Tooltip>
              <Tooltip delay={300}>
                <Button size="sm" isIconOnly aria-label="刷新 Hermes 服务信息" variant={refreshButtonVariant} onPress={() => loadEnvironment(true)} isDisabled={state === 'loading'}>
                  <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
                </Button>
                <Tooltip.Content>刷新</Tooltip.Content>
              </Tooltip>
            </div>
          ) : null}

          {effectiveActiveTab === 'settings' ? (
            <div className="flex items-center gap-2">
              <Tooltip delay={300}>
                <Button size="sm" isIconOnly variant="ghost" aria-label="刷新 Hermes 配置" onPress={loadConfig} isDisabled={isLoadingConfig || isSavingConfig}>
                  <Icon icon={isLoadingConfig ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={isLoadingConfig ? 'animate-spin' : ''} />
                </Button>
                <Tooltip.Content>刷新</Tooltip.Content>
              </Tooltip>
              <Button size="sm" variant="primary" onPress={saveConfig} isDisabled={isLoadingConfig || isSavingConfig || !isConfigDirty}>
                <Icon icon={isSavingConfig ? 'lucide:loader-circle' : 'lucide:save'} className={isSavingConfig ? 'animate-spin' : ''} />
                保存配置
              </Button>
            </div>
          ) : null}

          {effectiveActiveTab === 'instances' ? (
            <div className="flex items-center gap-2">
              <Tooltip delay={300}>
                <Button size="sm" isIconOnly variant="ghost" aria-label="刷新 Hermes 实例" onPress={loadInstances} isDisabled={instancesState === 'loading'}>
                  <Icon icon={instancesState === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={instancesState === 'loading' ? 'animate-spin' : ''} />
                </Button>
                <Tooltip.Content>刷新</Tooltip.Content>
              </Tooltip>
            </div>
          ) : null}

          {effectiveActiveTab === 'config' ? (
            <div className="flex items-center gap-2">
              <Tooltip delay={300}>
                <Button size="sm" isIconOnly variant="ghost" aria-label="刷新 Hermes 配置文件" onPress={loadConfig} isDisabled={isLoadingConfig || isSavingConfig}>
                  <Icon icon={isLoadingConfig ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={isLoadingConfig ? 'animate-spin' : ''} />
                </Button>
                <Tooltip.Content>刷新</Tooltip.Content>
              </Tooltip>
              <Button size="sm" variant="primary" onPress={saveConfig} isDisabled={isLoadingConfig || isSavingConfig || !isConfigDirty}>
                <Icon icon={isSavingConfig ? 'lucide:loader-circle' : 'lucide:save'} className={isSavingConfig ? 'animate-spin' : ''} />
                保存
              </Button>
            </div>
          ) : null}

          {effectiveActiveTab === 'env' ? (
            <div className="flex items-center gap-2">
              <Tooltip delay={300}>
                <Button size="sm" isIconOnly variant="ghost" aria-label="刷新 Hermes 环境变量" onPress={loadEnv} isDisabled={isLoadingEnv || isSavingEnv}>
                  <Icon icon={isLoadingEnv ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={isLoadingEnv ? 'animate-spin' : ''} />
                </Button>
                <Tooltip.Content>刷新</Tooltip.Content>
              </Tooltip>
              <Button size="sm" variant="primary" onPress={saveEnv} isDisabled={isLoadingEnv || isSavingEnv || !isEnvDirty}>
                <Icon icon={isSavingEnv ? 'lucide:loader-circle' : 'lucide:save'} className={isSavingEnv ? 'animate-spin' : ''} />
                保存
              </Button>
            </div>
          ) : null}

          {effectiveActiveTab === 'uninstall' ? (
            <div className="flex items-center gap-2">
              <Tooltip delay={300}>
                <Button size="sm" isIconOnly variant="ghost" aria-label="刷新 Hermes 卸载状态" onPress={() => loadEnvironment(true)} isDisabled={state === 'loading' || isUninstallRunning}>
                  <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
                </Button>
                <Tooltip.Content>刷新</Tooltip.Content>
              </Tooltip>
            </div>
          ) : null}
        </div>

        {effectiveActiveTab === 'basic' && data ? (
          <>
            <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
              <Card>
                <Card.Header>
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon icon="lucide:radio-tower" className="size-6 shrink-0 text-muted" />
                    <div className="min-w-0">
                      <Card.Title>Gateway 服务</Card.Title>
                    </div>
                  </div>
                </Card.Header>
                <Card.Content>
                  <StatusItemList
                    items={[
                      {
                        icon: 'lucide:activity',
                        title: '进程探测',
                        description: formatGatewayProcessProbe(data),
                        ok: data.gateway.running,
                        tone: data.gateway.running ? 'success' : gatewayStatus?.isServiceAvailable ? 'warning' : 'danger',
                      },
                      { icon: 'lucide:file-json', title: '状态文件', description: data.gateway.state || data.gateway.stateFileError || 'gateway_state.json', ok: data.home.gatewayStateExists && !data.gateway.stateFileError },
                      { icon: 'lucide:plug', title: '监听端口', description: formatPortList(data.gateway.listenPorts), ok: Boolean(data.gateway.listenPorts?.length) },
                      { icon: 'lucide:server', title: 'API Server', description: formatPlatformState(data, 'api_server'), ok: gatewayStatus?.isApiConnected ?? false },
                    ]}
                  />
                  <InfoGrid
                    columns={4}
                    items={[
                      { icon: 'lucide:badge-info', label: '状态', value: data.gateway.state || (data.gateway.running ? 'running' : 'stopped') },
                      { icon: 'lucide:cpu', label: 'PID', value: data.gateway.pid },
                      { icon: 'lucide:layers-3', label: '活跃 Agent', value: data.gateway.activeAgents },
                      { icon: 'lucide:clock-3', label: '运行时长', value: data.gateway.process?.uptime },
                    ]}
                  />
                </Card.Content>
              </Card>

              <Card className="relative overflow-visible">
                {hasHermesUpdate ? (
                  <div className="absolute right-4 top-4 z-10">
                    <Tooltip delay={300}>
                      <Button
                        aria-label="更新 Hermes"
                        isPending={isUpdateRunning}
                        size="sm"
                        variant="primary"
                        onPress={() => setUpdateDialogOpen(true)}
                      >
                        <Icon icon={isUpdateRunning ? 'lucide:loader-circle' : 'lucide:arrow-up-right'} className={isUpdateRunning ? 'size-4 animate-spin' : 'size-4'} />
                        {targetHermesVersion ? `更新到 ${targetHermesVersion}` : '存在可用更新'}
                      </Button>
                      <Tooltip.Content>
                        {targetHermesVersion ? `更新到 ${targetHermesVersion}` : '存在可用更新'}
                      </Tooltip.Content>
                    </Tooltip>
                  </div>
                ) : null}
                <Card.Header className={hasHermesUpdate ? 'pr-48' : undefined}>
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon icon="lucide:terminal-square" className="size-6 shrink-0 text-muted" />
                    <div className="min-w-0">
                      <Card.Title>CLI 工具</Card.Title>
                    </div>
                  </div>
                </Card.Header>
                <Card.Content>
                  <div className="grid gap-3">
                    <InfoItem icon="lucide:tag" label="版本" value={data.cli.version || '-'} />
                    <InfoItem icon="lucide:package-check" label="来源" value={data.cli.source || '-'} />
                    <InfoItem icon="lucide:folder-code" label="路径" value={data.cli.path || '-'} />
                    <InfoItem icon="lucide:folder-git-2" label="Project" value={data.cli.project || '-'} />
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
                      <Card.Title>Home 与配置</Card.Title>
                    </div>
                  </div>
                </Card.Header>
                <Card.Content>
                  <StatusItemList
                    items={[
                      { icon: 'lucide:home', title: 'Home', description: data.home.path, ok: data.home.exists },
                      { icon: 'lucide:file-cog', title: 'Config', description: data.config.error || data.home.configPath, ok: data.config.exists && data.config.parsed },
                      { icon: 'lucide:database', title: 'State DB', description: formatBytes(data.home.stateDbBytes), ok: data.home.stateDbExists },
                      { icon: 'lucide:scroll-text', title: 'Logs', description: data.home.logsDir, ok: data.home.logsDirExists },
                    ]}
                  />
                  <InfoGrid
                    columns={2}
                    items={[
                      { icon: 'lucide:house', label: 'Home 路径', value: data.home.path },
                      { icon: 'lucide:file-cog', label: '配置文件', value: data.home.configPath },
                      { icon: 'lucide:terminal', label: 'Terminal', value: [data.config.terminalBackend, data.config.terminalCwd].filter(Boolean).join(' · ') },
                      { icon: 'lucide:bot', label: '默认模型', value: data.config.modelDefault },
                    ]}
                  />
                </Card.Content>
              </Card>

              <Card>
                <Card.Header>
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon icon="lucide:key-round" className="size-6 shrink-0 text-muted" />
                    <div className="min-w-0">
                      <Card.Title>Env 与运行面</Card.Title>
                    </div>
                  </div>
                </Card.Header>
                <Card.Content>
                  <InfoGrid
                    items={[
                      { icon: 'lucide:file-key-2', label: '.env', value: data.env.exists ? `${data.env.keyCount} 个 key` : '不存在' },
                      { icon: 'lucide:layout-dashboard', label: 'Dashboard 主题', value: data.config.dashboardTheme },
                      { icon: 'lucide:languages', label: '语言 / 人格', value: [data.config.displayLanguage, data.config.displayPersonality].filter(Boolean).join(' / ') },
                      { icon: 'lucide:wrench', label: 'Toolsets', value: data.config.toolsets?.join(', ') },
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
                      <Card.Description>来自 `/hermes/environment` 的本机只读探测结果；进程探测和 API 连接会分开呈现。</Card.Description>
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
                            <ItemCard.Title>{check.name}</ItemCard.Title>
                            <Chip size="sm" color="danger" variant="soft">{check.durationMs}ms</Chip>
                          </div>
                          <ItemCard.Description className="min-w-0 whitespace-normal break-words text-foreground [overflow-wrap:anywhere]">
                            {formatHermesCheckMessage(data, check)}
                          </ItemCard.Description>
                        </ItemCard.Content>
                      </ItemCard>
                    ))}
                  </div>
                </Card.Content>
              </Card>
            ) : null}
          </>
        ) : null}

        {effectiveActiveTab === 'settings' ? (
          <HermesConfigSettingsPanel
            configError={configError}
            configText={configText}
            isLoading={isLoadingConfig}
            isSaving={isSavingConfig}
            onChange={setConfigText}
          />
        ) : null}

        {effectiveActiveTab === 'instances' ? (
          <HermesInstancesPanel
            data={instancesData}
            error={instancesError}
            gatewayActiveAgents={data?.gateway.activeAgents ?? 0}
            gatewayState={data?.gateway.state}
            isLoading={isLoadingInstances}
          />
        ) : null}

        {effectiveActiveTab === 'config' ? (
          <HermesTextFilePanel
            error={configError}
            isLoading={isLoadingConfig}
            isSaving={isSavingConfig}
            language="yaml"
            path={configData?.path || data?.home.configPath || '~/.hermes/config.yaml'}
            text={configText}
            theme={editorTheme}
            title="配置文件"
            onChange={setConfigText}
          />
        ) : null}

        {effectiveActiveTab === 'env' ? (
          <HermesTextFilePanel
            error={envError}
            isLoading={isLoadingEnv}
            isSaving={isSavingEnv}
            language="dotenv"
            path={envData?.path || data?.home.envPath || '~/.hermes/.env'}
            text={envText}
            theme={editorTheme}
            title="环境变量"
            onChange={setEnvText}
          />
        ) : null}

        {effectiveActiveTab === 'uninstall' ? (
          <HermesUninstallPanel
            data={data}
            isRunning={isUninstallRunning}
            logRef={uninstallLogRef}
            task={uninstallTask}
            onClearLog={() => setUninstallTask(null)}
            onRequestUninstall={() => setUninstallConfirmOpen(true)}
          />
        ) : null}

        <HermesDoctorLogModal
          isOpen={isDoctorLogOpen}
          isRunning={Boolean(isDoctorRunning)}
          logRef={doctorLogRef}
          task={doctorTask}
          onClear={() => setDoctorTask(null)}
          onOpenChange={setDoctorLogOpen}
        />

        <HermesUpdateDialog
          isOpen={isUpdateDialogOpen}
          isRunning={Boolean(isUpdateRunning)}
          logRef={updateLogRef}
          targetVersion={targetHermesVersion}
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
                <AlertDialog.Heading>卸载 Hermes？</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-sm leading-6 text-muted">
                  这会停止 Hermes Gateway，并移除 Hermes CLI、Home、配置、环境变量、技能、插件、会话、日志和本机运行状态。建议先确认需要保留的数据已经备份。
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

function HermesHeroSummaryCard({
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
  data: HermesEnvironmentResponse | null
  isRefreshing: boolean
  isRunning: boolean
  onInstall: () => void
  onRestart: () => void
  onStop: () => void
}) {
  const isInstalled = Boolean(data?.cli.available && data.home.exists && data.home.configExists)
  const isRestarting = actionState === 'restarting'
  const isStopping = actionState === 'stopping'
  const gatewayStatus = data ? getHermesGatewayStatus(data) : null
  const canRestartGateway = cliAvailable && !isStopping && !isRefreshing
  const canStopGateway = cliAvailable && isRunning && !isRestarting && !isRefreshing
  const statusLabel = gatewayStatus?.label ?? '未连接'
  const statusText = gatewayStatus?.description ?? '等待服务探测结果'
  const portLabel = data?.gateway.listenPorts?.length ? data.gateway.listenPorts.join(', ') : '-'

  return (
    <Card className="h-full">
      <Card.Content>
        <div className="flex h-full flex-col justify-center px-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className={gatewayStatus?.tone === 'success' ? 'flex size-11 shrink-0 items-center justify-center rounded-full bg-success/10 text-success shadow-[0_0_18px_color-mix(in_oklch,var(--success)_55%,transparent)]' : gatewayStatus?.tone === 'warning' ? 'flex size-11 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning' : 'flex size-11 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger'}>
                  <Icon icon={gatewayStatus?.icon ?? 'lucide:server-off'} className="size-5" />
                </div>
                <div className="min-w-0 pl-2">
                  <div className="truncate text-base font-semibold text-foreground">{statusLabel}</div>
                  <div className="truncate text-xs text-muted">{statusText}</div>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs text-muted">端口</div>
                <div className="mt-1 font-semibold tabular-nums text-foreground">{portLabel}</div>
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

function HermesTextFilePanel({
  error,
  isLoading,
  isSaving,
  language,
  path,
  text,
  theme,
  title,
  onChange,
}: {
  error: string
  isLoading: boolean
  isSaving: boolean
  language: string
  path: string
  text: string
  theme: 'vs' | 'vs-dark'
  title: string
  onChange: (value: string) => void
}) {
  return (
    <Card>
      <Card.Header>
        <div className="flex min-w-0 items-center gap-2">
          <Icon icon={language === 'dotenv' ? 'lucide:file-key-2' : 'lucide:file-code-2'} className="size-6 shrink-0 text-muted" />
          <div className="min-w-0">
            <Card.Title>{title}</Card.Title>
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
        <div className={`overflow-hidden h-[calc(100dvh-250px)] rounded-2xl border border-divider ${isLoading || isSaving ? 'pointer-events-none opacity-60' : ''}`}>
          <Editor
            height="100%"
            defaultLanguage={language}
            language={language}
            theme={theme}
            value={text}
            onChange={(value) => onChange(value ?? '')}
            options={{
              automaticLayout: true,
              fontSize: 13,
              formatOnPaste: language !== 'dotenv',
              formatOnType: language !== 'dotenv',
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

type ConfigFieldType = 'text' | 'number' | 'toggle' | 'textarea' | 'select'

type ConfigField = {
  path: string
  label: string
  type: ConfigFieldType
  description?: string
  icon?: string
  optionLabels?: Record<string, string>
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

const hermesLanguageOptions = ['en', 'zh', 'zh-hant', 'ja', 'de', 'es', 'fr', 'tr', 'uk', 'af', 'ko', 'it', 'ga', 'pt', 'ru', 'hu']
const hermesLanguageLabels: Record<string, string> = {
  af: 'af - Afrikaans',
  de: 'de - Deutsch',
  en: 'en - English',
  es: 'es - Español',
  fr: 'fr - Français',
  ga: 'ga - Gaeilge',
  hu: 'hu - Magyar',
  it: 'it - Italiano',
  ja: 'ja - 日本語',
  ko: 'ko - 한국어',
  pt: 'pt - Português',
  ru: 'ru - Русский',
  tr: 'tr - Türkçe',
  uk: 'uk - Українська',
  zh: 'zh - 简体中文',
  'zh-hant': 'zh-hant - 繁體中文',
}

const hermesPersonalityOptions = ['default', 'none', 'neutral', 'helpful', 'concise', 'technical', 'creative', 'teacher', 'kawaii', 'catgirl', 'pirate', 'shakespeare', 'surfer', 'noir', 'uwu', 'philosopher', 'hype']
const hermesPersonalityLabels: Record<string, string> = {
  catgirl: 'catgirl - Neko 风格',
  concise: 'concise - 简洁',
  creative: 'creative - 创意',
  default: 'default - 默认人格',
  helpful: 'helpful - 友好助手',
  hype: 'hype - 高能',
  kawaii: 'kawaii - 可爱',
  neutral: 'neutral - 中性 / 清空',
  noir: 'noir - 黑色电影',
  none: 'none - 无人格',
  philosopher: 'philosopher - 哲学',
  pirate: 'pirate - 海盗',
  shakespeare: 'shakespeare - 莎士比亚',
  surfer: 'surfer - 冲浪',
  teacher: 'teacher - 教学',
  technical: 'technical - 技术专家',
  uwu: 'uwu - uwu',
}

const hermesDashboardThemeOptions = ['default', 'default-large', 'midnight', 'ember', 'mono', 'cyberpunk', 'rose']
const hermesDashboardThemeLabels: Record<string, string> = {
  cyberpunk: 'cyberpunk - Neon green on black',
  default: 'default - Hermes Teal',
  'default-large': 'default-large - Hermes Teal Large',
  ember: 'ember - Warm crimson and bronze',
  midnight: 'midnight - Deep blue-violet',
  mono: 'mono - Clean grayscale',
  rose: 'rose - Soft pink',
}

const hermesTimezoneOptions = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Seoul',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Australia/Sydney',
]
const hermesTimezoneLabels: Record<string, string> = {
  'America/Chicago': 'America/Chicago - Central Time',
  'America/Denver': 'America/Denver - Mountain Time',
  'America/Los_Angeles': 'America/Los_Angeles - Pacific Time',
  'America/New_York': 'America/New_York - Eastern Time',
  'Asia/Hong_Kong': 'Asia/Hong_Kong - 香港',
  'Asia/Kolkata': 'Asia/Kolkata - India',
  'Asia/Seoul': 'Asia/Seoul - 서울',
  'Asia/Shanghai': 'Asia/Shanghai - 中国标准时间',
  'Asia/Singapore': 'Asia/Singapore - Singapore',
  'Asia/Taipei': 'Asia/Taipei - 台北',
  'Asia/Tokyo': 'Asia/Tokyo - 東京',
  'Australia/Sydney': 'Australia/Sydney - Sydney',
  'Europe/Berlin': 'Europe/Berlin - Berlin',
  'Europe/London': 'Europe/London - London',
  'Europe/Paris': 'Europe/Paris - Paris',
  UTC: 'UTC',
}

const hermesModelFields: ConfigField[] = [
  { path: 'model.default', label: '默认模型', type: 'text', placeholder: 'gpt-5.5', icon: 'lucide:bot' },
  { path: 'model.provider', label: '默认 Provider', type: 'text', placeholder: 'openai', icon: 'lucide:blocks' },
  { path: 'model.context_length', label: '上下文长度', type: 'number', placeholder: '0 = 自动', min: 0, integer: true, icon: 'lucide:braces' },
  {
    path: 'model.api_mode',
    label: 'API 模式',
    type: 'select',
    options: ['chat_completions', 'codex_responses', 'anthropic_messages', 'bedrock_converse'],
    icon: 'lucide:route',
  },
]

const hermesAgentFields: ConfigField[] = [
  { path: 'agent.max_turns', label: '最大轮次', type: 'number', placeholder: '90', min: 1, integer: true, icon: 'lucide:list-end' },
  { path: 'agent.gateway_timeout', label: 'Gateway 空闲超时', type: 'number', placeholder: '1800', min: 0, integer: true, icon: 'lucide:timer' },
  { path: 'agent.restart_drain_timeout', label: '重启等待时间', type: 'number', placeholder: '180', min: 0, integer: true, icon: 'lucide:timer-reset' },
  { path: 'agent.api_max_retries', label: 'API 最大重试', type: 'number', placeholder: '3', min: 0, integer: true, icon: 'lucide:refresh-cw' },
  {
    path: 'agent.image_input_mode',
    label: '图片输入模式',
    type: 'select',
    options: ['auto', 'native', 'text'],
    optionLabels: { auto: '自动', native: '原生视觉', text: '文本预分析' },
    icon: 'lucide:image',
  },
]

const hermesTerminalFields: ConfigField[] = [
  {
    path: 'terminal.backend',
    label: '执行后端',
    type: 'select',
    options: ['local', 'docker', 'ssh', 'modal', 'daytona', 'vercel_sandbox', 'singularity'],
    icon: 'lucide:terminal-square',
  },
  { path: 'terminal.cwd', label: '默认目录', type: 'text', placeholder: '.', icon: 'lucide:folder-code' },
  { path: 'terminal.timeout', label: '命令超时', type: 'number', placeholder: '180', min: 1, integer: true, icon: 'lucide:clock-3' },
  { path: 'terminal.container_cpu', label: '容器 CPU', type: 'number', placeholder: '1', min: 1, icon: 'lucide:cpu' },
  { path: 'terminal.container_memory', label: '容器内存 MB', type: 'number', placeholder: '5120', min: 128, integer: true, icon: 'lucide:memory-stick' },
  { path: 'terminal.container_persistent', label: '容器持久化', type: 'toggle', icon: 'lucide:database' },
]

const hermesDisplayFields: ConfigField[] = [
  {
    path: 'display.language',
    label: '语言',
    type: 'select',
    description: 'Hermes 静态提示语言，来自 agent.i18n.SUPPORTED_LANGUAGES。',
    options: hermesLanguageOptions,
    optionLabels: hermesLanguageLabels,
    icon: 'lucide:languages',
  },
  {
    path: 'display.personality',
    label: '人格',
    type: 'select',
    description: 'CLI 内置人格；自定义人格可继续在 agent.personalities 中维护。',
    options: hermesPersonalityOptions,
    optionLabels: hermesPersonalityLabels,
    icon: 'lucide:smile',
  },
  {
    path: 'dashboard.theme',
    label: 'Dashboard 主题',
    type: 'select',
    description: 'Hermes Web Server 内置主题；当前自定义主题会保留为可选项。',
    options: hermesDashboardThemeOptions,
    optionLabels: hermesDashboardThemeLabels,
    icon: 'lucide:layout-dashboard',
  },
  {
    path: 'timezone',
    label: '时区',
    type: 'select',
    description: 'IANA 时区；未设置时使用服务器本地时区。',
    options: hermesTimezoneOptions,
    optionLabels: hermesTimezoneLabels,
    icon: 'lucide:clock',
  },
]

const hermesPlatformFields: ConfigField[] = [
  { path: 'platforms.api_server.enabled', label: '启用 API Server', type: 'toggle', icon: 'lucide:server' },
  {
    path: 'platforms.api_server.extra.key',
    label: 'API Server 密钥',
    type: 'text',
    description: 'API Server Authorization: Bearer 认证',
    placeholder: '建议使用 openssl rand -hex 32',
    icon: 'lucide:key-round',
  },
  { path: 'platforms.api_server.extra.host', label: 'API Server Host', type: 'text', placeholder: '127.0.0.1', icon: 'lucide:network' },
  { path: 'platforms.api_server.extra.port', label: 'API Server Port', type: 'number', placeholder: '8642', min: 1, max: 65535, integer: true, icon: 'lucide:plug' },
  { path: 'platforms.api_server.extra.model_name', label: 'API 模型名', type: 'text', placeholder: 'hermes-agent', icon: 'lucide:tag' },
]

const hermesWebFields: ConfigField[] = [
  { path: 'web.backend', label: 'Web 后端', type: 'text', placeholder: 'shared backend', icon: 'lucide:globe' },
  { path: 'web.search_backend', label: '搜索后端', type: 'text', placeholder: 'searxng / exa / tavily', icon: 'lucide:search' },
  { path: 'web.extract_backend', label: '提取后端', type: 'text', placeholder: 'native / firecrawl', icon: 'lucide:file-search' },
  { path: 'network.force_ipv4', label: '强制 IPv4', type: 'toggle', icon: 'lucide:wifi' },
]

const hermesAutomationFields: ConfigField[] = [
  {
    path: 'cron.wrap_response',
    label: 'Cron 输出包装',
    type: 'toggle',
    description: '开启时在投递内容外加任务名与说明页脚（对应 Hermes cron.wrap_response）；关闭则投递原始模型输出。',
    icon: 'lucide:heading',
  },
  { path: 'sessions.auto_prune', label: '自动清理会话', type: 'toggle', icon: 'lucide:eraser' },
  { path: 'sessions.retention_days', label: '会话保留天数', type: 'number', placeholder: '90', min: 1, integer: true, icon: 'lucide:calendar-clock' },
  { path: 'sessions.vacuum_after_prune', label: '清理后 VACUUM', type: 'toggle', icon: 'lucide:database-zap' },
]

const hermesConfigSettingsGroups: ConfigSettingsGroup[] = [
  {
    id: 'platforms',
    title: 'API Server',
    description: '配置 OpenAI-compatible API Server 的鉴权、监听与展示模型名。',
    icon: 'lucide:server',
    fields: hermesPlatformFields,
  },
  {
    id: 'model',
    title: '模型配置',
    description: '编辑默认模型、Provider、上下文长度和 API 模式。',
    icon: 'lucide:bot',
    fields: hermesModelFields,
  },
  {
    id: 'agent',
    title: 'Agent 运行',
    description: '控制轮次、Gateway 超时、重启等待和图片输入策略。',
    icon: 'lucide:brain',
    fields: hermesAgentFields,
    listFields: [
      { label: '禁用 Toolsets', path: 'agent.disabled_toolsets', placeholder: 'browser, web', icon: 'lucide:list-x' },
    ],
  },
  {
    id: 'terminal',
    title: '终端执行',
    description: '配置终端后端、工作目录、命令超时和容器资源。',
    icon: 'lucide:terminal-square',
    fields: hermesTerminalFields,
    listFields: [
      { label: '环境透传', path: 'terminal.env_passthrough', placeholder: 'PATH, HOME, OPENAI_API_KEY', icon: 'lucide:list-checks' },
      { label: 'Shell 初始化文件', path: 'terminal.shell_init_files', placeholder: '~/.zshrc, ~/.profile', icon: 'lucide:file-terminal' },
      { label: 'Docker Volumes', path: 'terminal.docker_volumes', placeholder: '/host:/container', icon: 'lucide:hard-drive' },
    ],
  },
  {
    id: 'display',
    title: '显示与 Dashboard',
    description: '调整语言、人格、主题和时区。',
    icon: 'lucide:layout-dashboard',
    fields: hermesDisplayFields,
  },
  {
    id: 'tools',
    title: '工具与插件',
    description: '配置全局 toolsets 和插件启用/禁用列表。',
    icon: 'lucide:wrench',
    fields: [],
    listFields: [
      { label: 'Toolsets', path: 'toolsets', placeholder: 'hermes-cli, web, browser', icon: 'lucide:layers-3' },
      { label: '启用插件', path: 'plugins.enabled', placeholder: 'observability/langfuse', icon: 'lucide:puzzle' },
      { label: '禁用插件', path: 'plugins.disabled', placeholder: 'plugin-name', icon: 'lucide:ban' },
    ],
  },
  {
    id: 'web',
    title: '网络与 Web',
    description: '配置 Web 搜索/提取后端和 IPv4 网络策略。',
    icon: 'lucide:search',
    fields: hermesWebFields,
  },
  {
    id: 'automation',
    title: '自动化与会话',
    description: '配置 Cron 投递包装（wrap_response）与 state.db 会话自动清理。',
    icon: 'lucide:calendar-clock',
    fields: hermesAutomationFields,
  },
]

function HermesConfigSettingsPanel({
  configError,
  configText,
  isLoading,
  isSaving,
  onChange,
}: {
  configError: string
  configText: string
  isLoading: boolean
  isSaving: boolean
  onChange: (value: string) => void
}) {
  const [activeSettingGroup, setActiveSettingGroup] = useState(hermesConfigSettingsGroups[0].id)
  const parsed = useMemo(() => parseHermesConfigText(configText), [configText])
  const content = parsed.ok ? parsed.value : {}
  const disabled = isLoading || isSaving || !parsed.ok
  const selectedGroup = hermesConfigSettingsGroups.find((group) => group.id === activeSettingGroup) ?? hermesConfigSettingsGroups[0]

  const setValue = useCallback((path: string, value: unknown) => {
    if (!parsed.ok) return
    const next = setConfigValue(parsed.value, path, value)
    onChange(stringifyHermesConfig(next))
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
                <p className="mt-1 text-sm text-muted">{configError || getConfigParseError(parsed)}</p>
              </div>
            </div>
          </Card.Content>
        </Card>
      ) : null}

      <div className="grid gap-2 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="h-fit lg:sticky lg:top-4">
          <Card.Content>
            <Tabs aria-label="Hermes 设置项" orientation="vertical" selectedKey={activeSettingGroup} onSelectionChange={(key) => setActiveSettingGroup(String(key))}>
              <Tabs.ListContainer className="w-full">
                <Tabs.List className="w-full">
                  {hermesConfigSettingsGroups.map((group) => (
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
                {selectedGroup.fields.map((field, index) => (
                  <FragmentWithSeparator key={field.path} showSeparator={index > 0}>
                    <ConfigFieldItem config={content} disabled={disabled} field={field} onChange={setValue} />
                  </FragmentWithSeparator>
                ))}
                {selectedGroup.listFields?.map((field, index) => (
                  <FragmentWithSeparator key={field.path} showSeparator={selectedGroup.fields.length > 0 || index > 0}>
                    <ListConfigFieldItem config={content} disabled={disabled} field={field} onChange={setValue} />
                  </FragmentWithSeparator>
                ))}
              </ItemCardGroup>
            </Card.Content>
          </Card>
        </div>
      </div>
    </div>
  )
}

function FragmentWithSeparator({ children, showSeparator }: { children: React.ReactNode; showSeparator: boolean }) {
  return (
    <>
      {showSeparator ? <div className="h-px bg-divider" /> : null}
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

function ConfigFieldControl({ config, disabled, field, onChange }: { config: Record<string, unknown>; disabled: boolean; field: ConfigField; onChange: (path: string, value: unknown) => void }) {
  const value = readConfigValue(config, field.path)

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
    const selectedKey = getHermesSelectedOptionKey(field, value)
    const currentValue = typeof value === 'string' ? value : ''
    const extraOption = currentValue && !field.options?.includes(currentValue) ? currentValue : ''
    const options = extraOption ? [...(field.options ?? []), extraOption] : field.options ?? []

    return (
      <CellSelect
        aria-label={field.label}
        className={settingControlClassName}
        isDisabled={disabled}
        value={selectedKey}
        variant="secondary"
        onChange={(nextValue: Key | null) => onChange(field.path, !nextValue || nextValue === defaultSelectKey ? undefined : String(nextValue))}
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
            {options.map((option) => (
              <ListBox.Item key={option} id={option} textValue={getHermesSelectOptionLabel(field, option)}>
                {getHermesSelectOptionLabel(field, option)}
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

  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <Input
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
      {field.path === 'platforms.api_server.extra.key' ? (
        <Tooltip delay={300}>
          <Button isIconOnly aria-label="随机生成 API Server 密钥" variant="ghost" isDisabled={disabled} onPress={() => onChange(field.path, generateHermesApiServerKey())}>
            <Icon icon="lucide:refresh-cw" className="size-4" />
          </Button>
          <Tooltip.Content>随机生成密钥</Tooltip.Content>
        </Tooltip>
      ) : null}
    </div>
  )
}

function getHermesSelectedOptionKey(field: ConfigField, value: unknown): string {
  if (typeof value !== 'string' || !value) return defaultSelectKey
  if (field.options?.includes(value)) return value
  return value
}

function getHermesSelectOptionLabel(field: ConfigField, option: string): string {
  return field.optionLabels?.[option] ?? `${option} - 当前配置值`
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
  if (field.type === 'textarea') return 'lucide:file-text'
  return 'lucide:type'
}

function parseHermesConfigText(value: string): ParsedConfigResult {
  try {
    const parsed = parseYAML(value || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, message: 'config.yaml 顶层必须是 YAML 对象' }
    }
    return { ok: true, value: normalizeHermesConfigForSettings(parsed as Record<string, unknown>) }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '配置文件不是合法 YAML' }
  }
}

function getConfigParseError(result: ParsedConfigResult): string {
  return result.ok ? '' : result.message
}

function stringifyHermesConfig(value: Record<string, unknown>): string {
  return stringifyYAML(value, { indent: 2, lineWidth: 0 })
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

function normalizeHermesConfigForSettings(raw: Record<string, unknown>): Record<string, unknown> {
  const clone = cloneJson(raw)
  migrateModelSectionConfig(clone)
  migrateApiServerExtraConfig(clone)
  migrateCronWrapResponseConfig(clone)
  return clone
}

/** 与 Hermes load_config 中 _normalize_root_model_keys 对齐：旧版根级 provider/base_url/context_length 或标量 model 字符串。 */
function migrateModelSectionConfig(config: Record<string, unknown>) {
  const rootKeys = ['provider', 'base_url', 'context_length'] as const
  const rawModel = config.model

  let modelObj: Record<string, unknown>
  let touched = false

  if (rawModel != null && typeof rawModel === 'object' && !Array.isArray(rawModel)) {
    modelObj = { ...(rawModel as Record<string, unknown>) }
  } else if (typeof rawModel === 'string') {
    touched = true
    const trimmed = rawModel.trim()
    modelObj = trimmed ? { default: trimmed } : {}
  } else {
    modelObj = {}
  }

  for (const key of rootKeys) {
    const rootVal = config[key]
    if (!rootVal || modelObj[key] !== undefined) continue
    modelObj[key] = rootVal
    delete config[key]
    touched = true
  }

  if (!touched) return

  if (Object.keys(modelObj).length === 0 && (rawModel === undefined || rawModel === null)) return

  config.model = modelObj
}

function migrateApiServerExtraConfig(config: Record<string, unknown>) {
  const apiServer = readConfigValue(config, 'platforms.api_server')
  if (!apiServer || typeof apiServer !== 'object' || Array.isArray(apiServer)) return
  const apiServerConfig = apiServer as Record<string, unknown>
  const extraValue = apiServerConfig.extra
  if (!extraValue || typeof extraValue !== 'object' || Array.isArray(extraValue)) {
    apiServerConfig.extra = {}
  }
  const extra = apiServerConfig.extra as Record<string, unknown>
  for (const key of ['host', 'port', 'model_name', 'key']) {
    if (extra[key] === undefined && apiServerConfig[key] !== undefined) {
      extra[key] = apiServerConfig[key]
    }
    delete apiServerConfig[key]
  }
  if (extra.key === undefined && apiServerConfig.api_key !== undefined) {
    extra.key = apiServerConfig.api_key
  }
  delete apiServerConfig.api_key
}

/** Dashboard 曾错误使用 cron.response_header；Hermes 仅识别 cron.wrap_response（布尔）。 */
function migrateCronWrapResponseConfig(config: Record<string, unknown>) {
  const cron = readConfigValue(config, 'cron')
  if (!cron || typeof cron !== 'object' || Array.isArray(cron)) return
  const cronObj = cron as Record<string, unknown>
  if (cronObj.wrap_response !== undefined) {
    delete cronObj.response_header
    return
  }
  if (!('response_header' in cronObj)) return
  const legacy = cronObj.response_header
  delete cronObj.response_header
  if (legacy === undefined || legacy === null) return
  if (typeof legacy === 'boolean') {
    cronObj.wrap_response = legacy
    return
  }
  if (typeof legacy === 'number') {
    cronObj.wrap_response = legacy !== 0
    return
  }
  const text = String(legacy).trim().toLowerCase()
  if (text === '' || text === 'false' || text === '0' || text === 'no' || text === 'off') {
    cronObj.wrap_response = false
    return
  }
  if (text === 'true' || text === '1' || text === 'yes' || text === 'on') {
    cronObj.wrap_response = true
    return
  }
  // 旧版占位文案或非布尔字符串：视为希望保留默认「带标题包装」行为
  cronObj.wrap_response = true
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? {}))
}

function normalizeFieldInput(value: string, field: ConfigField): unknown {
  if (value === '') return undefined
  if (field.type !== 'number') return value
  const next = Number(value)
  if (!Number.isFinite(next)) return undefined
  return field.integer ? Math.trunc(next) : next
}

function generateHermesApiServerKey() {
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

function HermesInstancesPanel({
  data,
  error,
  gatewayActiveAgents,
  gatewayState,
  isLoading,
}: {
  data: HermesInstancesResponse | null
  error: string
  gatewayActiveAgents: number
  gatewayState?: string
  isLoading: boolean
}) {
  const summary = data?.summary
  const activeCount = summary?.activeAgents ?? gatewayActiveAgents
  const runningProcesses = summary?.runningProcesses ?? 0
  const recentSessions = summary?.recentSessions ?? 0
  const stateLabel = data?.active.gatewayState || gatewayState || '-'

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ServiceMetricCard icon="lucide:bot" title="活跃 Agent" value={String(activeCount)} description="gateway_state 上报" tone={activeCount > 0 ? 'success' : 'warning'} />
        <ServiceMetricCard icon="lucide:terminal-square" title="后台任务" value={String(runningProcesses)} description="processes.json" tone={runningProcesses > 0 ? 'success' : 'warning'} />
        <ServiceMetricCard icon="lucide:messages-square" title="最近会话" value={String(recentSessions)} description="state.db 顶层会话" tone={recentSessions > 0 ? 'success' : 'warning'} />
        <ServiceMetricCard icon="lucide:radio-tower" title="Gateway" value={stateLabel} description={formatDateTime(data?.active.updatedAt)} tone={stateLabel === 'running' ? 'success' : 'warning'} />
      </section>

      {error ? (
        <Card>
          <Card.Content>
            <div className="flex items-start gap-3 text-warning">
              <Icon icon="lucide:triangle-alert" className="mt-0.5 size-5" />
              <div>
                <p className="font-medium">实例信息刷新失败</p>
                <p className="mt-1 text-sm text-muted">{error}</p>
              </div>
            </div>
          </Card.Content>
        </Card>
      ) : null}

      {isLoading ? (
        <div className="grid gap-2">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      ) : (
        <section className="grid items-start gap-4 xl:grid-cols-2">
          <Card>
            <Card.Header>
              <div className="flex min-w-0 items-center gap-2">
                <Icon icon="lucide:terminal-square" className="size-6 shrink-0 text-muted" />
                <div className="min-w-0">
                  <Card.Title>运行任务</Card.Title>
                  <Card.Description>{data?.processRegistryPath || '~/.hermes/processes.json'}</Card.Description>
                </div>
              </div>
            </Card.Header>
            <Card.Content>
              {!data?.processes.length ? (
                <EmptyPanel icon="lucide:circle-slash" text="暂无后台任务记录" />
              ) : (
                <div className="grid gap-2">
                  {data.processes.map((process) => (
                    <ItemCard key={process.sessionId || `${process.pid}-${process.command}`} className="min-w-0">
                      <ItemCard.Icon>
                        <Icon icon={process.status === 'running' ? 'lucide:play-circle' : 'lucide:circle-off'} className={process.status === 'running' ? 'text-success' : 'text-muted'} />
                      </ItemCard.Icon>
                      <ItemCard.Content className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <ItemCard.Title>{process.sessionId || `PID ${process.pid ?? '-'}`}</ItemCard.Title>
                          <Chip size="sm" color={process.status === 'running' ? 'success' : 'default'} variant="soft">{process.status}</Chip>
                          {process.pid ? <Chip size="sm" variant="secondary">PID {process.pid}</Chip> : null}
                        </div>
                        <ItemCard.Description className="min-w-0 whitespace-normal break-words text-foreground [overflow-wrap:anywhere]">
                          {process.command || '-'}
                        </ItemCard.Description>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {process.cwd ? <Chip size="sm" variant="secondary">{process.cwd}</Chip> : null}
                          {process.taskId ? <Chip size="sm" variant="secondary">{process.taskId}</Chip> : null}
                          {process.watcherPlatform ? <Chip size="sm" variant="secondary">{process.watcherPlatform}</Chip> : null}
                        </div>
                      </ItemCard.Content>
                      <ItemCard.Action>
                        <span className="text-xs tabular-nums text-muted">{formatDuration(process.uptimeSeconds)}</span>
                      </ItemCard.Action>
                    </ItemCard>
                  ))}
                </div>
              )}
            </Card.Content>
          </Card>

          <Card>
            <Card.Header>
              <div className="flex min-w-0 items-center gap-2">
                <Icon icon="lucide:messages-square" className="size-6 shrink-0 text-muted" />
                <div className="min-w-0">
                  <Card.Title>最近会话</Card.Title>
                  <Card.Description>{data?.stateDbPath || '~/.hermes/state.db'}</Card.Description>
                </div>
              </div>
            </Card.Header>
            <Card.Content>
              {!data?.sessions.length ? (
                <EmptyPanel icon="lucide:inbox" text="暂无会话记录" />
              ) : (
                <div className="grid gap-2">
                  {data.sessions.map((session) => (
                    <ItemCard key={session.id} className="min-w-0">
                      <ItemCard.Icon>
                        <Icon icon="lucide:message-circle" className="text-muted" />
                      </ItemCard.Icon>
                      <ItemCard.Content className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <ItemCard.Title>{session.title || session.platform || session.id}</ItemCard.Title>
                          {session.platform ? <Chip size="sm" variant="soft">{session.platform}</Chip> : null}
                          {session.model ? <Chip size="sm" variant="secondary">{session.model}</Chip> : null}
                        </div>
                        <ItemCard.Description className="min-w-0 whitespace-normal break-words text-foreground [overflow-wrap:anywhere]">
                          {session.id}
                        </ItemCard.Description>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Chip size="sm" variant="secondary">{numberFormatter.format(session.messageCount)} messages</Chip>
                          <Chip size="sm" variant="secondary">{numberFormatter.format(session.toolCallCount)} tools</Chip>
                          {session.endReason ? <Chip size="sm" variant="secondary">{session.endReason}</Chip> : null}
                        </div>
                      </ItemCard.Content>
                      <ItemCard.Action>
                        <span className="text-xs tabular-nums text-muted">{formatDateTime(session.lastActiveAt || session.startedAt)}</span>
                      </ItemCard.Action>
                    </ItemCard>
                  ))}
                </div>
              )}
            </Card.Content>
          </Card>
        </section>
      )}

      {data?.errors?.length ? (
        <Card>
          <Card.Header>
            <div className="flex min-w-0 items-center gap-2">
              <Icon icon="lucide:list-warning" className="size-6 shrink-0 text-muted" />
              <div className="min-w-0">
                <Card.Title>部分数据不可用</Card.Title>
              </div>
            </div>
          </Card.Header>
          <Card.Content>
            <div className="grid gap-2">
              {data.errors.map((item) => (
                <ItemCard key={item} className="min-w-0">
                  <ItemCard.Icon>
                    <Icon icon="lucide:triangle-alert" className="text-warning" />
                  </ItemCard.Icon>
                  <ItemCard.Content className="min-w-0">
                    <ItemCard.Description className="min-w-0 whitespace-normal break-words text-foreground [overflow-wrap:anywhere]">
                      {item}
                    </ItemCard.Description>
                  </ItemCard.Content>
                </ItemCard>
              ))}
            </div>
          </Card.Content>
        </Card>
      ) : null}
    </div>
  )
}

function HermesUninstallPanel({
  data,
  isRunning,
  logRef,
  task,
  onClearLog,
  onRequestUninstall,
}: {
  data: HermesEnvironmentResponse | null
  isRunning: boolean
  logRef: RefObject<HTMLPreElement | null>
  task: HermesTaskResponse | null
  onClearLog: () => void
  onRequestUninstall: () => void
}) {
  const cliAvailable = Boolean(data?.cli.available)
  const homeExists = Boolean(data?.home.exists)
  const gatewayRunning = Boolean(data?.gateway.running || data?.gateway.listenPorts?.length)
  const configExists = Boolean(data?.home.configExists)

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
            <Icon icon="lucide:trash-2" className="size-7" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold">卸载 Hermes</div>
            <div className="text-sm text-muted">危险操作：完整卸载 Hermes，开始前请先确认。</div>
          </div>
        </div>

        <div className="grid gap-2">
          <StatusItemList
            items={[
              { icon: 'lucide:terminal-square', title: 'CLI', description: cliAvailable ? data?.cli.path || data?.cli.source || 'hermes 命令仍存在' : 'hermes CLI 已移除', ok: !cliAvailable },
              { icon: 'lucide:home', title: 'Home', description: homeExists ? data?.home.path || 'Hermes 本地目录仍存在' : 'Hermes 本地目录已移除', ok: !homeExists },
              { icon: 'lucide:radio-tower', title: 'Gateway', description: gatewayRunning ? 'Gateway 进程或监听端口仍存在' : 'Gateway 未运行', ok: !gatewayRunning },
              { icon: 'lucide:file-cog', title: '配置', description: configExists ? data?.home.configPath || 'config.yaml 仍存在' : 'config.yaml 已移除', ok: !configExists },
            ]}
          />

          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>卸载 Hermes</Alert.Title>
              <Alert.Description>
                卸载会移除 Hermes CLI、Home、配置、环境变量、技能、插件、会话、日志和本机运行状态。这个操作适合重装前清理，请确认需要保留的信息已经备份。
              </Alert.Description>
            </Alert.Content>
          </Alert>

          <div className="mt-2 flex items-center gap-2">
            <Button className="w-full" size="sm" variant="danger" isDisabled={isRunning} onPress={onRequestUninstall}>
              <Icon icon={isRunning ? 'lucide:loader-circle' : 'lucide:trash-2'} className={isRunning ? 'animate-spin' : ''} />
              卸载 Hermes
            </Button>
          </div>
        </div>
      </div>

      <HermesUninstallLogCard
        isRunning={isRunning}
        logRef={logRef}
        task={task}
        onClear={onClearLog}
      />
    </div>
  )
}

function HermesUpdateDialog({
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
  task: HermesTaskResponse | null
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  const logs = task?.logs ?? []
  const status = task?.status ?? 'pending'
  const showLogs = task !== null
  const title = targetVersion ? `更新到 ${targetVersion}` : '更新 Hermes？'
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

function HermesDoctorLogModal({
  isOpen,
  isRunning,
  logRef,
  task,
  onClear,
  onOpenChange,
}: {
  isOpen: boolean
  isRunning: boolean
  logRef: RefObject<HTMLPreElement | null>
  task: HermesTaskResponse | null
  onClear: () => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="sm:max-w-[820px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent/10 text-accent">
              <Icon icon="lucide:stethoscope" className="size-5" />
            </Modal.Icon>
            <div className="min-w-0">
              <Modal.Heading>Hermes Doctor</Modal.Heading>
              <p className="mt-1 text-sm text-muted">运行 hermes doctor，并实时输出诊断日志。</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            <HermesDoctorLogCard
              isRunning={isRunning}
              logRef={logRef}
              task={task}
              onClear={onClear}
            />
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function HermesDoctorLogCard({
  isRunning,
  logRef,
  task,
  onClear,
}: {
  isRunning: boolean
  logRef: RefObject<HTMLPreElement | null>
  task: HermesTaskResponse | null
  onClear: () => void
}) {
  const status = task?.status ?? 'idle'
  const tone = status === 'done' ? 'success' : status === 'error' ? 'danger' : isRunning ? 'warning' : 'default'
  const logs = task?.logs ?? ['尚未开始 Doctor 任务。']

  const copyLogs = async () => {
    const text = [logs.join('\n'), task?.error ? task.error : ''].filter(Boolean).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Doctor 日志已复制')
    } catch {
      toast.warning('日志复制失败')
    }
  }

  return (
    <Card className="min-w-0">
      <Card.Header>
        <div className="flex w-full min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <Card.Title>Doctor 日志</Card.Title>
            <Card.Description>{task?.id || '等待流式任务'}</Card.Description>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Chip color={tone} variant="soft">{status}</Chip>
            <Tooltip delay={300}>
              <Button isIconOnly aria-label="复制 Doctor 日志" size="sm" variant="ghost" onPress={() => void copyLogs()} isDisabled={logs.length === 0}>
                <Icon icon="lucide:copy" className="size-4" />
              </Button>
              <Tooltip.Content>复制日志</Tooltip.Content>
            </Tooltip>
            <Tooltip delay={300}>
              <Button isIconOnly aria-label="清空 Doctor 日志" size="sm" variant="ghost" onPress={onClear} isDisabled={!task || isRunning}>
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
        {isRunning ? (
          <div className="mb-3 flex items-center gap-2 text-sm text-muted">
            <Icon icon="lucide:loader-circle" className="size-4 animate-spin" />
            正在执行，终端输出会实时追加。
          </div>
        ) : null}
        <pre ref={logRef} className="max-h-[360px] min-h-80 overflow-auto rounded-xl bg-surface-secondary/50 p-4 font-mono text-xs leading-5 whitespace-pre-wrap text-foreground">
          {logs.join('\n')}
          {task?.error ? `\n${task.error}` : ''}
        </pre>
      </Card.Content>
    </Card>
  )
}

function HermesUninstallLogCard({
  isRunning,
  logRef,
  task,
  onClear,
}: {
  isRunning: boolean
  logRef: RefObject<HTMLPreElement | null>
  task: HermesTaskResponse | null
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
                <span>卸载日志</span> bg-surface-secondary/50"
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
            <div className="mt-2 truncate text-sm text-muted">{description || '-'}</div>
          </div>
          <span className={`mt-1 size-2.5 shrink-0 rounded-full ${tone === 'success' ? 'bg-success' : 'bg-warning'}`} />
        </div>
      </Card.Content>
    </Card>
  )
}

function EmptyPanel({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl bg-surface-secondary/50 p-6 text-center text-sm text-muted">
      <Icon icon={icon} className="mb-2 size-6" />
      {text}
    </div>
  )
}

type StatusTone = 'success' | 'warning' | 'danger'

function StatusItemList({ items }: { items: Array<{ description: string; icon: string; ok: boolean; title: string; tone?: StatusTone }> }) {
  return (
    <div className="mb-2 grid gap-2 sm:grid-cols-1">
      {items.map((item) => (
        <ItemCard key={item.title}>
          <ItemCard.Icon>
            <Icon icon={item.icon} className="text-muted" />
          </ItemCard.Icon>
          <ItemCard.Content>
            <ItemCard.Title>{item.title}</ItemCard.Title>
            <ItemCard.Description className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">{item.description}</ItemCard.Description>
          </ItemCard.Content>
          <ItemCard.Action>
            <span
              className={`block size-2.5 shrink-0 rounded-full ${statusToneClassName(item.tone ?? (item.ok ? 'success' : 'danger'))}`}
              aria-label={item.ok ? '正常' : '异常'}
            />
          </ItemCard.Action>
        </ItemCard>
      ))}
    </div>
  )
}

function statusToneClassName(tone: StatusTone) {
  if (tone === 'success') return 'bg-success shadow-[0_0_12px_color-mix(in_oklch,var(--success)_80%,transparent)]'
  if (tone === 'warning') return 'bg-warning shadow-[0_0_12px_color-mix(in_oklch,var(--warning)_80%,transparent)]'
  return 'bg-danger shadow-[0_0_12px_color-mix(in_oklch,var(--danger)_80%,transparent)]'
}

function InfoItem({ icon, label, value }: { icon: string; label: string; value: string | number | undefined }) {
  return (
    <ItemCard className="min-w-0">
      <ItemCard.Icon>
        <Icon icon={icon} className="text-muted" />
      </ItemCard.Icon>
      <ItemCard.Content className="min-w-0">
        <ItemCard.Title>{label}</ItemCard.Title>
        <ItemCard.Description className="min-w-0 break-words text-foreground [overflow-wrap:anywhere]">
          {value === undefined || value === '' ? '-' : String(value)}
        </ItemCard.Description>
      </ItemCard.Content>
    </ItemCard>
  )
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
        <InfoItem key={item.label} icon={item.icon} label={item.label} value={item.value} />
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

function formatPlatformState(data: HermesEnvironmentResponse, name: string) {
  const platform = data.gateway.platforms?.find((entry) => entry.name === name)
  if (!platform) return '未上报'
  return [platform.state, platform.errorMessage].filter(Boolean).join(' · ') || name
}

function getHermesGatewayStatus(data: HermesEnvironmentResponse): {
  description: string
  icon: string
  isApiConnected: boolean
  isProcessDetected: boolean
  isServiceAvailable: boolean
  isStateRunning: boolean
  label: string
  tone: StatusTone
} {
  const isApiConnected = data.gateway.platforms?.some((platform) => platform.name === 'api_server' && platform.state === 'connected') ?? false
  const isStateRunning = data.gateway.state === 'running'
  const isProcessDetected = Boolean(data.gateway.running)

  if (isApiConnected) {
    return {
      description: isProcessDetected ? 'API Server 已连接，PID 进程已确认' : 'API Server 已连接；PID 进程探测未确认',
      icon: 'lucide:server',
      isApiConnected,
      isProcessDetected,
      isServiceAvailable: true,
      isStateRunning,
      label: '服务可用',
      tone: isProcessDetected ? 'success' : 'warning',
    }
  }

  if (isStateRunning) {
    return {
      description: isProcessDetected ? 'Gateway 状态文件显示 running，PID 进程已确认' : 'Gateway 状态文件显示 running；PID 进程探测未确认',
      icon: 'lucide:radio-tower',
      isApiConnected,
      isProcessDetected,
      isServiceAvailable: true,
      isStateRunning,
      label: '状态文件显示运行中',
      tone: isProcessDetected ? 'success' : 'warning',
    }
  }

  if (isProcessDetected) {
    return {
      description: 'Gateway 进程已检测，等待运行状态上报',
      icon: 'lucide:activity',
      isApiConnected,
      isProcessDetected,
      isServiceAvailable: true,
      isStateRunning,
      label: '进程已检测',
      tone: 'warning',
    }
  }

  return {
    description: '未检测到 API Server 连接或 Gateway 进程',
    icon: 'lucide:server-off',
    isApiConnected,
    isProcessDetected,
    isServiceAvailable: false,
    isStateRunning,
    label: '未连接',
    tone: 'danger',
  }
}

function isHermesUninstalled(data: HermesEnvironmentResponse | null) {
  return data?.cli.available === false && data.home.exists === false
}

function formatGatewayProcessProbe(data: HermesEnvironmentResponse) {
  if (data.gateway.running) return `进程已确认${data.gateway.pid ? ` · PID ${data.gateway.pid}` : ''}`
  const processError = data.gateway.process?.error
  const pidText = data.gateway.pid ? `PID ${data.gateway.pid}` : '未读取到 PID'
  const connected = data.gateway.platforms?.some((platform) => platform.name === 'api_server' && platform.state === 'connected') ?? false
  const prefix = connected || data.gateway.state === 'running' ? 'PID 进程探测未确认' : '未检测到运行进程'

  return [prefix, pidText, processError].filter(Boolean).join(' · ')
}

function formatHermesCheckMessage(data: HermesEnvironmentResponse, check: { message: string; name: string }) {
  if (check.name !== 'gateway_process') return check.message

  const status = getHermesGatewayStatus(data)
  if (status.isApiConnected) {
    return '服务可用，API Server 已连接；只是 PID 进程探测未确认，请检查 gateway.pid 是否过期或进程探测权限是否异常。'
  }
  if (status.isStateRunning) {
    return 'gateway_state.json 显示 running；只是 PID 进程探测未确认，请检查 PID 是否过期或 ps 权限/进程名探测是否异常。'
  }

  return check.message
}

function formatPortList(ports?: number[]) {
  return ports?.length ? ports.join(', ') : '未检测到监听端口'
}

function formatDateTime(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function formatDuration(value?: number) {
  if (!value || value < 0) return '-'
  if (value < 60) return `${Math.floor(value)}s`
  const minutes = Math.floor(value / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

function formatBytes(value?: number) {
  if (value === undefined) return '-'
  if (value < 1024) return `${numberFormatter.format(value)} B`
  if (value < 1024 ** 2) return `${numberFormatter.format(value / 1024)} KB`
  if (value < 1024 ** 3) return `${numberFormatter.format(value / 1024 ** 2)} MB`
  return `${numberFormatter.format(value / 1024 ** 3)} GB`
}

function appendStreamLog(logs: string[], line: string) {
  const next = line.trim() ? [...logs, line] : logs
  return next.length > 240 ? next.slice(next.length - 240) : next
}

async function copyText(text: string, successMessage = '已复制 Hermes 服务信息') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(successMessage)
  } catch {
    toast.warning('复制失败')
  }
}

function buildServiceInfoText(data: HermesEnvironmentResponse) {
  return [
    `Gateway: ${data.gateway.state || (data.gateway.running ? 'running' : 'stopped')}`,
    `Gateway PID: ${data.gateway.pid || '-'}`,
    `Gateway Ports: ${formatPortList(data.gateway.listenPorts)}`,
    `CLI: ${data.cli.version || '-'} (${data.cli.path || data.cli.source || '-'})`,
    `Home: ${data.home.path}`,
    `Config: ${data.home.configPath}`,
    `Env key count: ${data.env.keyCount}`,
    `Model: ${data.config.modelDefault || '-'}`,
  ].join('\n')
}

export default HermesServicePage
