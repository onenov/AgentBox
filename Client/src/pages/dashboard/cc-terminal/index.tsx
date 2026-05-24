import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertDialog, Button, Card, Chip, Dropdown, Input, Label, ListBox, Modal, Spinner, Tooltip, toast } from '@heroui/react'
import { CellSelect, ItemCard, ItemCardGroup } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { Key } from '@heroui/react'
import type { CCConnectAgentEngineInfo, CCConnectProjectConfig, CCConnectTerminalCommand, CCConnectTerminalSession } from '@/api'
import { createCCConnectTerminal, deleteCCConnectTerminalRecord, getCCConnectAgentEngines, getCCConnectProjectsConfig, getCCConnectTerminalWebSocketURL, listCCConnectTerminals, stopCCConnectTerminal } from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { useConfigStore } from '@/stores/config'
import { isTauriRuntime } from '@/utils/tauri'

type CommandOption = { value: CCConnectTerminalCommand; label: string; description: string; icon: string }
type TerminalDimensions = { cols: number; rows: number }
type FitAddonWithDimensions = FitAddon & {
  proposeDimensions?: () => TerminalDimensions | undefined
}

const commandOptions: CommandOption[] = [
  { value: 'interactive', label: '交互终端', description: '进入该项目目录并启动对应 Agent CLI', icon: 'lucide:terminal-square' },
  { value: 'continue', label: '继续最近会话', description: '使用 Agent CLI 的最近会话继续能力', icon: 'lucide:history' },
  { value: 'list-sessions', label: '会话选择器', description: '打开 Agent CLI 自带的会话选择/列表能力', icon: 'lucide:list-tree' },
]

const terminalRouteLog = (message: string, detail?: Record<string, unknown>) => {
  console.info(`[CC-Connect终端路由] ${message}`, detail ?? '')
}

function CCConnectTerminalPage() {
  usePageTitle('CC-Connect 终端')
  const appName = useConfigStore((state) => state.appName)
  const [projects, setProjects] = useState<CCConnectProjectConfig[]>([])
  const [agentEngines, setAgentEngines] = useState<CCConnectAgentEngineInfo[]>([])
  const [projectName, setProjectName] = useState('')
  const [agentType, setAgentType] = useState('')
  const [sessions, setSessions] = useState<CCConnectTerminalSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')
  const [command, setCommand] = useState<CCConnectTerminalCommand>('interactive')
  const [cwd, setCwd] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [isLaunchOpen, setLaunchOpen] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [isDeletingRecord, setIsDeletingRecord] = useState(false)
  const [deleteRecordTarget, setDeleteRecordTarget] = useState<CCConnectTerminalSession | null>(null)
  const [isTerminalFullscreen, setIsTerminalFullscreen] = useState(false)
  const [detachedSessionId, setDetachedSessionId] = useState('')
  const [terminalMountKey, setTerminalMountKey] = useState(0)
  const [error, setError] = useState('')
  const [detachedSearchParams] = useState(() => new URLSearchParams(window.location.search))
  const isDetachedTerminalWindow = detachedSearchParams.get('terminalWindow') === '1'
  const canOpenDetachedTerminalWindow = !isTauriRuntime()
  const detachedInitialSessionId = detachedSearchParams.get('session') ?? ''
  const detachedProjectName = detachedSearchParams.get('project') ?? ''
  const terminalHostRef = useRef<HTMLDivElement | null>(null)
  const terminalCardRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const detachedWindowRef = useRef<Window | null>(null)
  const terminalRemountTimerRef = useRef<number | undefined>(undefined)
  const lastRemountSizeRef = useRef('')
  const sessionsRef = useRef<CCConnectTerminalSession[]>([])
  const currentSessionRef = useRef<CCConnectTerminalSession | null>(null)
  const attachedSessionIdRef = useRef('')
  const currentSession = sessions.find((item) => item.id === activeSessionId) ?? null

  const visibleProjects = useMemo(() => projects.filter((project) => project.name !== 'default-project'), [projects])
  const selectedProjectName = detachedProjectName || projectName || visibleProjects[0]?.name || ''
  const selectedProject = visibleProjects.find((project) => project.name === selectedProjectName) ?? visibleProjects[0] ?? null
  const projectBoundAgentType = normalizeAgentType(selectedProject?.agent.type)
  const firstInstalledAgentType = agentEngines.find((engine) => engine.installed)?.type ?? ''
  const selectedAgentType = normalizeAgentType(agentType) || projectBoundAgentType || firstInstalledAgentType || 'claudecode'
  const selectedAgentEngine = agentEngines.find((engine) => engine.type === selectedAgentType) ?? null
  const selectedAgentInstalled = selectedAgentEngine?.installed === true

  useEffect(() => {
    terminalRouteLog('CC-Connect Terminal 页面已挂载', {
      detachedInitialSessionId,
      detachedProjectName,
      isDetachedTerminalWindow,
      selectedProjectName,
    })

    return () => {
      terminalRouteLog('CC-Connect Terminal 页面开始卸载')
    }
  }, [detachedInitialSessionId, detachedProjectName, isDetachedTerminalWindow, selectedProjectName])

  const loadProjects = useCallback(async () => {
    const payload = await getCCConnectProjectsConfig()
    const nextProjects = payload.config.projects.filter((project) => project.name !== 'default-project')
    setProjects(nextProjects)
    setProjectName((current) => current || nextProjects[0]?.name || '')
  }, [])

  const loadAgentEngines = useCallback(async () => {
    const payload = await getCCConnectAgentEngines()
    setAgentEngines(payload.engines)
  }, [])

  const loadSessions = useCallback(async () => {
    if (!selectedProjectName) return
    setState('loading')
    setError('')
    try {
      const payload = await listCCConnectTerminals(selectedProjectName)
      setSessions(payload.sessions)
      setActiveSessionId((current) => {
        if (detachedInitialSessionId && payload.sessions.some((item) => item.id === detachedInitialSessionId)) return detachedInitialSessionId
        if (current && payload.sessions.some((item) => item.id === current)) return current
        return payload.sessions.find((item) => item.status === 'running')?.id ?? payload.sessions[0]?.id ?? ''
      })
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CC-Connect 终端会话加载失败')
      setState('error')
    }
  }, [detachedInitialSessionId, selectedProjectName])

  const refitTerminal = useCallback(() => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current as FitAddonWithDimensions | null
    const dimensions = fitAddon?.proposeDimensions?.()
    if (terminal && dimensions && dimensions.cols > 0 && dimensions.rows > 0) {
      terminal.resize(dimensions.cols, dimensions.rows)
    } else {
      fitAddon?.fit()
    }
    if (terminal) {
      terminal.refresh(0, Math.max(terminal.rows - 1, 0))
    }
  }, [])

  const refreshTerminalLayout = useCallback(() => {
    refitTerminal()
    const terminal = terminalRef.current
    const socket = socketRef.current
    if (terminal && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ cols: terminal.cols, rows: terminal.rows, type: 'resize' }))
    }
  }, [refitTerminal])

  const scheduleTerminalRefresh = useCallback(() => {
    const refresh = () => {
      refreshTerminalLayout()
      const terminal = terminalRef.current
      if (terminal) {
        terminal.refresh(0, Math.max(terminal.rows - 1, 0))
      }
    }
    window.requestAnimationFrame(() => {
      refresh()
      window.requestAnimationFrame(() => {
        refresh()
        window.requestAnimationFrame(refresh)
      })
    })
    window.setTimeout(refresh, 80)
    window.setTimeout(refresh, 180)
    window.setTimeout(refresh, 360)
  }, [refreshTerminalLayout])

  const remountTerminalView = useCallback(() => {
    attachedSessionIdRef.current = ''
    socketRef.current?.close()
    terminalRef.current?.dispose()
    terminalRef.current = null
    fitAddonRef.current = null
    setTerminalMountKey((current) => current + 1)
  }, [])

  const scheduleTerminalRemount = useCallback(() => {
    if (!currentSessionRef.current) return
    window.clearTimeout(terminalRemountTimerRef.current)
    terminalRemountTimerRef.current = window.setTimeout(() => {
      const target = terminalHostRef.current?.parentElement ?? terminalHostRef.current
      if (!target) return
      const rect = target.getBoundingClientRect()
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)
      if (width <= 0 || height <= 0) return
      const sizeKey = `${width}x${height}`
      if (lastRemountSizeRef.current === sizeKey) return
      lastRemountSizeRef.current = sizeKey
      remountTerminalView()
    }, 320)
  }, [remountTerminalView])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProjects()
      void loadAgentEngines()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAgentEngines, loadProjects])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSessions()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadSessions])

  useEffect(() => {
    const refreshSessions = () => {
      void loadSessions()
    }
    const handleVisibilityChange = () => {
      if (!document.hidden) refreshSessions()
    }
    window.addEventListener('cc-connect:terminals-refresh', refreshSessions)
    window.addEventListener('focus', refreshSessions)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('cc-connect:terminals-refresh', refreshSessions)
      window.removeEventListener('focus', refreshSessions)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [loadSessions])

  useEffect(() => {
    const terminal = new Terminal({
      allowProposedApi: true,
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.35,
      scrollback: 5000,
      theme: {
        background: '#071111',
        cursor: '#9ff5d3',
        foreground: '#e6fff5',
        selectionBackground: '#2f6f5f',
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    if (terminalHostRef.current) {
      terminal.open(terminalHostRef.current)
      fitAddon.fit()
    }
    const inputSubscription = terminal.onData((data) => {
      const socket = socketRef.current
      const session = currentSessionRef.current
      if (socket?.readyState === WebSocket.OPEN && isTerminalSessionInteractive(session)) {
        socket.send(JSON.stringify({ data, type: 'input' }))
      }
    })
    return () => {
      inputSubscription.dispose()
      socketRef.current?.close()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [terminalMountKey])

  useEffect(() => {
    let resizeTimer: number | undefined
    const handleResize = () => {
      scheduleTerminalRefresh()
      scheduleTerminalRemount()
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(scheduleTerminalRefresh, 220)
    }
    window.addEventListener('resize', handleResize)
    window.visualViewport?.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      window.visualViewport?.removeEventListener('resize', handleResize)
      window.clearTimeout(resizeTimer)
      window.clearTimeout(terminalRemountTimerRef.current)
    }
  }, [scheduleTerminalRefresh, scheduleTerminalRemount])

  useEffect(() => {
    const targets = new Set<Element>()
    if (terminalHostRef.current) {
      targets.add(terminalHostRef.current)
      if (terminalHostRef.current.parentElement) {
        targets.add(terminalHostRef.current.parentElement)
      }
    }
    if (terminalCardRef.current) {
      targets.add(terminalCardRef.current)
    }
    if (targets.size === 0) return
    let resizeFrame = 0
    let resizeTimer: number | undefined
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(resizeFrame)
      resizeFrame = window.requestAnimationFrame(() => {
        scheduleTerminalRefresh()
        scheduleTerminalRemount()
      })
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(scheduleTerminalRefresh, 240)
    })
    targets.forEach((target) => observer.observe(target))
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(resizeFrame)
      window.clearTimeout(resizeTimer)
    }
  }, [scheduleTerminalRefresh, scheduleTerminalRemount, terminalMountKey])

  useEffect(() => {
    if (!currentSession) return
    const firstFrame = window.requestAnimationFrame(() => {
      scheduleTerminalRefresh()
      window.requestAnimationFrame(scheduleTerminalRefresh)
    })
    const timeout = window.setTimeout(scheduleTerminalRefresh, 120)
    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.clearTimeout(timeout)
    }
  }, [currentSession, scheduleTerminalRefresh])

  useEffect(() => {
    if (!currentSession) {
      const frame = window.requestAnimationFrame(() => {
        setDetachedSessionId('')
      })
      return () => window.cancelAnimationFrame(frame)
    }
  }, [currentSession])

  useEffect(() => {
    if (!detachedSessionId) return
    const timer = window.setInterval(() => {
      if (detachedWindowRef.current?.closed) {
        detachedWindowRef.current = null
        setDetachedSessionId('')
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [detachedSessionId])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsTerminalFullscreen(document.fullscreenElement === terminalCardRef.current)
      window.requestAnimationFrame(refitTerminal)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [refitTerminal])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    currentSessionRef.current = currentSession
  }, [currentSession])

  const attachSession = useCallback((session: CCConnectTerminalSession, force = false) => {
    const terminal = terminalRef.current
    if (!terminal) return
    const existingSocket = socketRef.current
    const isSameSession = attachedSessionIdRef.current === session.id
    const isSocketActive = existingSocket?.readyState === WebSocket.OPEN || existingSocket?.readyState === WebSocket.CONNECTING
    if (!force && isSameSession && isSocketActive) return

    socketRef.current?.close()
    attachedSessionIdRef.current = session.id
    terminal.clear()
    terminal.writeln(`Connecting to ${session.command}`)

    const socket = new WebSocket(getCCConnectTerminalWebSocketURL(session.id))
    socketRef.current = socket
    socket.addEventListener('open', () => {
      if (socketRef.current !== socket) return
      refitTerminal()
      const activeTerminal = terminalRef.current
      if (activeTerminal) {
        socket.send(JSON.stringify({ cols: activeTerminal.cols, rows: activeTerminal.rows, type: 'resize' }))
      }
    })
    socket.addEventListener('message', (event) => {
      if (socketRef.current !== socket) return
      try {
        const frame = JSON.parse(event.data as string) as {
          payload?: {
            data?: string
            scrollback?: string[]
            session?: CCConnectTerminalSession
          }
          type?: string
        }
        if (frame.type === 'snapshot') {
          terminal.clear()
          frame.payload?.scrollback?.forEach((chunk) => terminal.write(sanitizeTerminalChunk(chunk)))
          if (frame.payload?.session) {
            setSessions((current) => upsertTerminalSession(current, frame.payload!.session!))
          }
        }
        if (frame.type === 'output' && frame.payload?.data) {
          terminal.write(sanitizeTerminalChunk(frame.payload.data))
        }
        if ((frame.type === 'status' || frame.type === 'exit') && frame.payload?.session) {
          setSessions((current) => upsertTerminalSession(current, frame.payload!.session!))
        }
      } catch {
        terminal.writeln(String(event.data))
      }
    })
    socket.addEventListener('close', () => {
      if (socketRef.current !== socket) return
      attachedSessionIdRef.current = ''
    })
    socket.addEventListener('error', () => {
      if (socketRef.current !== socket) return
    })
  }, [refitTerminal])

  useEffect(() => {
    if (!activeSessionId) {
      attachedSessionIdRef.current = ''
      socketRef.current?.close()
      terminalRef.current?.clear()
      const frame = window.requestAnimationFrame(refitTerminal)
      return () => window.cancelAnimationFrame(frame)
    }
    if (!isDetachedTerminalWindow && detachedSessionId === activeSessionId) {
      attachedSessionIdRef.current = ''
      socketRef.current?.close()
      terminalRef.current?.clear()
      const frame = window.requestAnimationFrame(refitTerminal)
      return () => window.cancelAnimationFrame(frame)
    }
    const session = sessionsRef.current.find((item) => item.id === activeSessionId)
    if (!session) return
    attachSession(session)
  }, [activeSessionId, attachSession, detachedSessionId, isDetachedTerminalWindow, refitTerminal, terminalMountKey])

  const startSession = useCallback(async (options?: { command?: CCConnectTerminalCommand; cwd?: string }) => {
    const launchCommand = options?.command ?? command
    const launchCwd = options?.cwd ?? cwd
    if (agentEngines.length === 0) {
      toast.warning('正在检测 Agent 引擎，请稍后再启动')
      return
    }
    if (!selectedAgentInstalled) {
      toast.warning(`${selectedAgentEngine?.label || selectedAgentType} 未安装，无法启动终端`)
      return
    }
    setIsStarting(true)
    try {
      const terminal = terminalRef.current
      const created = await createCCConnectTerminal({
        agentType: selectedAgentType,
        command: launchCommand,
        cwd: launchCwd.trim() || undefined,
        project: selectedProjectName,
        cols: terminal?.cols,
        rows: terminal?.rows,
      })
      setSessions((current) => upsertTerminalSession(current, created))
      setActiveSessionId(created.id)
      setDetachedSessionId('')
      setLaunchOpen(false)
      toast.success('CC-Connect 终端已启动')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'CC-Connect 终端启动失败')
    } finally {
      setIsStarting(false)
    }
  }, [agentEngines.length, command, cwd, selectedAgentEngine?.label, selectedAgentInstalled, selectedAgentType, selectedProjectName])

  const stopSession = useCallback(async (session: CCConnectTerminalSession) => {
    setIsStopping(true)
    try {
      const stopped = await stopCCConnectTerminal(session.id)
      setSessions((current) => upsertTerminalSession(current, stopped))
      toast.success('CC-Connect 终端已停止')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '停止终端失败')
    } finally {
      setIsStopping(false)
    }
  }, [])

  const deleteSessionRecord = useCallback(async () => {
    const session = deleteRecordTarget
    if (!session) return
    setIsDeletingRecord(true)
    try {
      await deleteCCConnectTerminalRecord(session.id)
      const nextSessions = sessions.filter((item) => item.id !== session.id)
      setSessions(nextSessions)
      if (activeSessionId === session.id) {
        setActiveSessionId(nextSessions.find((item) => item.status === 'running')?.id ?? nextSessions[0]?.id ?? '')
      }
      attachedSessionIdRef.current = ''
      socketRef.current?.close()
      terminalRef.current?.clear()
      setDeleteRecordTarget(null)
      toast.success('终端记录已删除')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '终端记录删除失败')
    } finally {
      setIsDeletingRecord(false)
    }
  }, [activeSessionId, deleteRecordTarget, sessions])

  const toggleTerminalFullscreen = useCallback(async () => {
    const element = terminalCardRef.current
    if (!element) return
    try {
      if (document.fullscreenElement === element) {
        await document.exitFullscreen()
      } else {
        setDetachedSessionId('')
        await element.requestFullscreen()
      }
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '无法切换终端全屏')
    }
  }, [])

  const openTerminalWindow = useCallback(async () => {
    if (!currentSession) return
    if (document.fullscreenElement === terminalCardRef.current) {
      await document.exitFullscreen()
    }
    const url = new URL(window.location.href)
    url.searchParams.set('terminalWindow', '1')
    url.searchParams.set('session', currentSession.id)
    url.searchParams.set('project', currentSession.project.name || selectedProjectName)
    const popup = window.open(url.toString(), `ccConnect-terminal-${currentSession.id}`, 'popup=yes,width=960,height=640,left=120,top=90,resizable=yes,scrollbars=no')
    if (!popup) {
      toast.warning('浏览器阻止了小窗口打开')
      return
    }
    detachedWindowRef.current = popup
    setDetachedSessionId(currentSession.id)
    attachedSessionIdRef.current = ''
    socketRef.current?.close()
    terminalRef.current?.clear()
  }, [currentSession, selectedProjectName])

  const closeDetachedTerminalWindow = useCallback(() => {
    window.opener?.focus?.()
    window.close()
  }, [])

  const runningCount = sessions.filter((item) => item.status === 'running').length
  const canReconnect = isTerminalSessionInteractive(currentSession)
  const isTerminalDetachedFromMain = Boolean(!isDetachedTerminalWindow && currentSession && detachedSessionId === currentSession.id)
  const shouldShowMainEmptyState = !currentSession || isTerminalDetachedFromMain
  const shouldShowTerminal = Boolean(currentSession && !isTerminalDetachedFromMain)

  const content = (
    <div className={`mx-auto flex w-full flex-col gap-2 ${isDetachedTerminalWindow ? 'h-dvh bg-background p-3' : 'h-[calc(100dvh-100px)]'}`}>

        {!isDetachedTerminalWindow ? (
        <div className="flex gap-5 justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <SessionSelectDropdown
                activeSessionId={activeSessionId}
                isLoading={state === 'loading'}
                runningCount={runningCount}
                sessions={sessions}
                onRefresh={loadSessions}
                onSelect={setActiveSessionId}
              />
              {currentSession && !isTerminalSessionInteractive(currentSession) ? <Chip color="danger" size="sm" variant="soft">只读</Chip> : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" variant="primary" onPress={() => setLaunchOpen(true)}>
              <Icon icon="lucide:plus" className="size-4" />
              新建
            </Button>
            {canReconnect ? (
              <Tooltip delay={300}>
                <Button size="sm" variant="primary" onPress={() => currentSession && attachSession(currentSession, true)}>
                  <Icon icon="lucide:plug-zap" className="size-4" />
                  重连
                </Button>
                <Tooltip.Content>重新连接到运行中的终端</Tooltip.Content>
              </Tooltip>
            ) : null}
            {currentSession ? (
              <>
                {currentSession.status === 'running' ? (
                  <Button size="sm" variant="danger" isPending={isStopping} onPress={() => void stopSession(currentSession)}>
                    {({ isPending }) => (
                      <>
                        {isPending ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:square" className="size-4" />}
                        停止
                      </>
                    )}
                  </Button>
                ) : null}
                {!isTerminalSessionInteractive(currentSession) ? (
                  <Button isIconOnly size="sm" variant="danger-soft" onPress={() => setDeleteRecordTarget(currentSession)}>
                    <Icon icon="lucide:trash-2" className="size-4" />
                  </Button>
                ) : null}
                {!isDetachedTerminalWindow && canOpenDetachedTerminalWindow ? (
                  <Tooltip delay={300}>
                    <Button isIconOnly size="sm" variant={isTerminalDetachedFromMain ? 'primary' : 'tertiary'} aria-label="浏览器小窗口显示终端" onPress={() => void openTerminalWindow()}>
                      <Icon icon="lucide:picture-in-picture-2" className="size-4" />
                    </Button>
                    <Tooltip.Content>浏览器小窗口显示终端</Tooltip.Content>
                  </Tooltip>
                ) : null}
                <Tooltip delay={300}>
                  <Button isIconOnly size="sm" variant="tertiary" aria-label="重建终端显示" onPress={remountTerminalView}>
                    <Icon icon="lucide:refresh-cw" className="size-4" />
                  </Button>
                  <Tooltip.Content>重建终端显示</Tooltip.Content>
                </Tooltip>
                <Tooltip delay={300}>
                  <Button isIconOnly size="sm" variant="tertiary" aria-label={isTerminalFullscreen ? '退出全屏' : '全屏显示终端'} onPress={() => void toggleTerminalFullscreen()}>
                    <Icon icon={isTerminalFullscreen ? 'lucide:minimize-2' : 'lucide:maximize-2'} className="size-4" />
                  </Button>
                  <Tooltip.Content>{isTerminalFullscreen ? '退出全屏' : '全屏显示终端'}</Tooltip.Content>
                </Tooltip>
              </>
            ) : null}
          </div>
        </div>
        ) : null}
        {error ? <div className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div> : null}


        <div ref={terminalCardRef} className={`flex min-h-0 flex-1 flex-col overflow-hidden ${isTerminalFullscreen ? 'bg-background' : ''}`}>
          <div className="relative min-h-0 flex-1 p-0">
            {isDetachedTerminalWindow ? (
              <Tooltip delay={300}>
                <Button
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  aria-label="关闭小窗口并回到主窗口"
                  className="absolute right-3 top-3 z-20 bg-background/90 shadow-lg backdrop-blur"
                  onPress={closeDetachedTerminalWindow}
                >
                  <Icon icon="lucide:x" className="size-4" />
                </Button>
                <Tooltip.Content>关闭小窗口并回到主窗口</Tooltip.Content>
              </Tooltip>
            ) : null}
            {shouldShowMainEmptyState ? (
              <TerminalEmptyState
                isStarting={isStarting}
                onQuickStart={() => void startSession({ command: 'interactive', cwd: '' })}
              />
            ) : null}
            <div className={`${shouldShowTerminal ? 'relative h-full' : 'absolute inset-0 pointer-events-none opacity-0'} bg-[#071111] ${isTerminalFullscreen ? '' : 'rounded-xl'} p-3`}>
              <div key={terminalMountKey} ref={terminalHostRef} className="h-full w-full overflow-hidden" />
            </div>
          </div>
        </div>
        {!isDetachedTerminalWindow ? (
          <>
            <LaunchTerminalModal
              agentEngines={agentEngines}
              selectedAgentEngine={selectedAgentEngine}
              selectedAgentInstalled={selectedAgentInstalled}
              selectedAgentType={selectedAgentType}
              command={command}
              cwd={cwd}
              isOpen={isLaunchOpen}
              isStarting={isStarting}
              projects={visibleProjects}
              selectedProject={selectedProject}
              selectedProjectName={selectedProjectName}
              onCommandChange={setCommand}
              onCwdChange={setCwd}
              onAgentTypeChange={setAgentType}
              onOpenChange={setLaunchOpen}
              onProjectChange={setProjectName}
              onStart={() => void startSession()}
            />
            <AlertDialog.Backdrop isOpen={deleteRecordTarget !== null} onOpenChange={(open) => {
              if (!open && !isDeletingRecord) setDeleteRecordTarget(null)
            }}>
              <AlertDialog.Container>
                <AlertDialog.Dialog className="sm:max-w-[460px]">
                  <AlertDialog.CloseTrigger />
                  <AlertDialog.Header>
                    <AlertDialog.Icon status="danger" />
                    <AlertDialog.Heading>删除终端记录？</AlertDialog.Heading>
                  </AlertDialog.Header>
                  <AlertDialog.Body>
                    这会删除终端会话「{deleteRecordTarget ? formatSessionTitle(deleteRecordTarget) : '-'}」在 {appName} SQLite 中的记录，不会删除 CC-Connect 会话内容。
                  </AlertDialog.Body>
                  <AlertDialog.Footer>
                    <Button variant="tertiary" isDisabled={isDeletingRecord} onPress={() => setDeleteRecordTarget(null)}>取消</Button>
                    <Button variant="danger" isPending={isDeletingRecord} onPress={() => void deleteSessionRecord()}>删除记录</Button>
                  </AlertDialog.Footer>
                </AlertDialog.Dialog>
              </AlertDialog.Container>
            </AlertDialog.Backdrop>
          </>
        ) : null}
      </div>
  )

  if (isDetachedTerminalWindow) {
    return content
  }

  return (
    <DashboardLayout>
      {content}
    </DashboardLayout>
  )
}

function TerminalEmptyState({
  isStarting,
  onQuickStart,
}: {
  isStarting: boolean
  onQuickStart: () => void
}) {
  return (
    <Card className="w-full h-full items-center">
      <Card.Content className="flex h-full w-full flex-col items-center justify-center text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-surface-secondary/60 text-muted">
          <Icon icon="lucide:terminal-square" className="size-8" />
        </div>
        <div className="mt-4 text-lg font-semibold">暂无连接</div>
        <div className="mt-2 max-w-sm leading-6 text-muted text-sm mb-4">
          选择 Agent、命令和工作目录后启动一个 CC-Connect 终端，会话输出会显示在这里。
        </div>
        {/* <div className="rounded-2xl bg-surface-secondary/50 px-4 py-3 text-left">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">快速启动</div>
          <div className="mt-1 flex items-center gap-2 text-sm text-foreground">
            <Icon icon="lucide:brain" className="size-4 text-muted" />
            <span className="min-w-0 truncate">{agentName}</span>
            <span className="text-muted">·</span>
            <span>TUI Chat</span>
          </div>
        </div> */}
        <Button size="sm" isPending={isStarting} variant="primary" onPress={onQuickStart}>
          {({ isPending }) => (
            <>
              {isPending ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:rocket" className="size-4" />}
              快速启动
            </>
          )}
        </Button>
      </Card.Content>
    </Card>
  )
}

function LaunchTerminalModal({
  agentEngines,
  command,
  cwd,
  isOpen,
  isStarting,
  projects,
  selectedAgentEngine,
  selectedAgentInstalled,
  selectedAgentType,
  selectedProject,
  selectedProjectName,
  onAgentTypeChange,
  onCommandChange,
  onCwdChange,
  onOpenChange,
  onProjectChange,
  onStart,
}: {
  agentEngines: CCConnectAgentEngineInfo[]
  command: CCConnectTerminalCommand
  cwd: string
  isOpen: boolean
  isStarting: boolean
  projects: CCConnectProjectConfig[]
  selectedAgentEngine: CCConnectAgentEngineInfo | null
  selectedAgentInstalled: boolean
  selectedAgentType: string
  selectedProject: CCConnectProjectConfig | null
  selectedProjectName: string
  onAgentTypeChange: (agentType: string) => void
  onCommandChange: (command: CCConnectTerminalCommand) => void
  onCwdChange: (cwd: string) => void
  onOpenChange: (open: boolean) => void
  onProjectChange: (project: string) => void
  onStart: () => void
}) {
  const selectedCommand = commandOptions.find((option) => option.value === command) ?? commandOptions[1]

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="md">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
              <Icon icon="lucide:terminal-square" className="size-5" />
            </Modal.Icon>
            <div>
              <Modal.Heading>新建 CC-Connect 终端</Modal.Heading>
              <p className="mt-1 text-sm text-muted">选择项目、启动命令和工作目录。</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="grid gap-4">
              <ItemCardGroup className="overflow-hidden">
                <ItemCardGroup.Header>
                  <ItemCardGroup.Title>启动配置</ItemCardGroup.Title>
                  <ItemCardGroup.Description>选择运行 CC-Connect 终端使用的项目和命令。</ItemCardGroup.Description>
                </ItemCardGroup.Header>
                <TerminalFormItem icon="lucide:folder-cog" title="项目">
                  <ProjectSelectDropdown projects={projects} selectedName={selectedProjectName} onSelect={onProjectChange} />
                </TerminalFormItem>
                <div className="h-px bg-separator" />
                <TerminalFormItem icon={agentIcon(selectedAgentType)} title="Agent 引擎">
                  <AgentEngineSelectDropdown engines={agentEngines} selectedType={selectedAgentType} onSelect={onAgentTypeChange} />
                </TerminalFormItem>
                <div className="h-px bg-separator" />
                <TerminalFormItem icon={selectedCommand.icon} title="命令">
                  <CellSelect aria-label="启动命令" value={command} variant="secondary" onChange={(key: Key | null) => key && onCommandChange(String(key) as CCConnectTerminalCommand)}>
                    <CellSelect.Trigger>
                      <CellSelect.Value>
                        {() => (
                          <span className="flex min-w-0 items-center gap-2">
                            <Icon icon={selectedCommand.icon} className="size-4 text-muted" />
                            <span className="truncate">{selectedCommand.label}</span>
                          </span>
                        )}
                      </CellSelect.Value>
                      <CellSelect.Indicator />
                    </CellSelect.Trigger>
                    <CellSelect.Popover>
                      <ListBox>
                        {commandOptions.map((option) => (
                          <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
                            <div className="flex min-w-0 items-center gap-2">
                              <Icon icon={option.icon} className="size-4 text-muted" />
                              <div className="min-w-0">
                                <div className="truncate">{option.label}</div>
                                <div className="truncate text-xs text-muted">{option.description}</div>
                              </div>
                            </div>
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </CellSelect.Popover>
                  </CellSelect>
                </TerminalFormItem>
              </ItemCardGroup>
              <Card>
                <Card.Header>
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-secondary/50 text-muted">
                      <Icon icon="lucide:folder" className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <Card.Title>工作目录</Card.Title>
                      <Card.Description>留空时使用当前项目的工作目录。</Card.Description>
                    </div>
                  </div>
                </Card.Header>
                <Card.Content>
                  <Input
                    aria-label="工作目录"
                    placeholder={selectedProject?.agent.workDir || '当前项目工作目录'}
                    value={cwd}
                    onChange={(event) => onCwdChange(event.target.value)}
                    variant="secondary"
                  />
                  {selectedAgentEngine && !selectedAgentInstalled ? (
                    <p className="mt-2 text-xs text-danger">{selectedAgentEngine.error || `${selectedAgentEngine.label} 未安装`}</p>
                  ) : null}
                </Card.Content>
              </Card>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={() => onOpenChange(false)}>取消</Button>
            <Button variant="primary" isDisabled={!selectedAgentInstalled} isPending={isStarting} onPress={onStart}>
              {({ isPending }) => (
                <>
                  {isPending ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:play" className="size-4" />}
                  启动
                </>
              )}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function ProjectSelectDropdown({ projects, selectedName, onSelect }: { projects: CCConnectProjectConfig[]; selectedName: string; onSelect: (name: string) => void }) {
  const selectedProject = projects.find((project) => project.name === selectedName) ?? projects[0]
  if (!selectedProject) return null

  return (
    <Dropdown>
      <Button variant="tertiary" className="min-w-0 rounded-full pl-1 pr-2">
        <ProjectAvatar project={selectedProject} size="sm" />
        <span className="min-w-0 max-w-44 truncate text-sm font-semibold text-foreground">{selectedProject.name}</span>
        <Icon icon="lucide:chevron-down" className="size-4 text-muted" />
      </Button>
      <Dropdown.Popover placement="bottom start">
        <Dropdown.Menu selectedKeys={new Set(selectedName ? [selectedName] : [])} selectionMode="single" onAction={(key) => onSelect(String(key))}>
          {projects.map((project) => (
            <Dropdown.Item key={project.name} id={project.name} textValue={project.name}>
              <Dropdown.ItemIndicator type="dot" />
              <div className="flex min-w-0 items-center gap-3">
                <ProjectAvatar project={project} />
                <div className="min-w-0 flex-1">
                  <Label className="truncate">{project.name}</Label>
                  <p className="mt-1 truncate text-xs text-muted">{project.agent.type || '-'} · {project.agent.workDir || '-'}</p>
                </div>
              </div>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function AgentEngineSelectDropdown({ engines, selectedType, onSelect }: { engines: CCConnectAgentEngineInfo[]; selectedType: string; onSelect: (agentType: string) => void }) {
  const selectedEngine = engines.find((engine) => engine.type === selectedType) ?? engines[0]
  if (!selectedEngine) {
    return (
      <Button variant="tertiary" className="min-w-0 rounded-full pl-2 pr-3" isDisabled>
        <Icon icon="lucide:loader-circle" className="size-4 animate-spin text-muted" />
        <span className="text-sm font-semibold text-muted">检测中</span>
      </Button>
    )
  }

  return (
    <Dropdown>
      <Button variant="tertiary" className="min-w-0 rounded-full pl-1 pr-2">
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-white ring-2 [&>svg]:size-3.5 ${selectedEngine.installed ? 'bg-success ring-success/30' : 'bg-muted ring-muted/30'}`}>
          <Icon icon={agentIcon(selectedEngine.type)} />
        </span>
        <span className="min-w-0 max-w-44 truncate text-sm font-semibold text-foreground">{selectedEngine.label}</span>
        <Icon icon="lucide:chevron-down" className="size-4 text-muted" />
      </Button>
      <Dropdown.Popover placement="bottom start">
        <Dropdown.Menu selectedKeys={new Set(selectedType ? [selectedType] : [])} selectionMode="single" onAction={(key) => {
          const engine = engines.find((item) => item.type === String(key))
          if (engine?.installed) onSelect(engine.type)
        }}>
          {engines.map((engine) => (
            <Dropdown.Item key={engine.type} id={engine.type} textValue={engine.label} isDisabled={!engine.installed}>
              <Dropdown.ItemIndicator type="dot" />
              <div className="flex min-w-0 items-center gap-3">
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-full text-white ring-2 [&>svg]:size-4 ${engine.installed ? 'bg-success ring-success/30' : 'bg-muted ring-muted/30'}`}>
                  <Icon icon={agentIcon(engine.type)} />
                </span>
                <div className="min-w-0 flex-1">
                  <Label className="truncate">{engine.label}</Label>
                  {/* <p className="mt-1 truncate text-xs text-muted">{engine.installed ? engine.path || engine.command : engine.error || '未安装'}</p> */}
                </div>
              </div>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function agentIcon(agentType?: string) {
  switch (normalizeAgentType(agentType)) {
    case 'claudecode':
      return 'mingcute:claude-line'
    case 'codex':
      return 'proicons:openai'
    case 'gemini':
      return 'lineicons:gemini'
    case 'opencode':
      return 'gravity-ui:code'
    case 'qoder':
      return 'tabler:code-minus'
    default:
      return 'lucide:brain-circuit'
  }
}

function normalizeAgentType(agentType?: string) {
  return (agentType || '').trim().toLowerCase()
}

function ProjectAvatar({ project, size = 'md' }: { project: CCConnectProjectConfig; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'size-7 [&>svg]:size-3.5' : 'size-9 [&>svg]:size-4'
  const toneClass = 'bg-accent ring-accent/30'

  return (
    <span className={`relative flex shrink-0 items-center justify-center rounded-full text-white ring-2 ${sizeClass} ${toneClass}`}>
      <Icon icon={agentIcon(project.agent.type)} />
    </span>
  )
}

function TerminalFormItem({
  children,
  description,
  icon,
  title,
}: {
  children: React.ReactNode
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
        <div className="w-full min-w-0 sm:w-auto">{children}</div>
      </ItemCard.Action>
    </ItemCard>
  )
}

function SessionSelectDropdown({
  activeSessionId,
  isLoading,
  runningCount,
  sessions,
  onRefresh,
  onSelect,
}: {
  activeSessionId: string
  isLoading: boolean
  runningCount: number
  sessions: CCConnectTerminalSession[]
  onRefresh: () => void
  onSelect: (id: string) => void
}) {
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null
  const buttonLabel = activeSession ? formatSessionTitle(activeSession) : '选择会话'

  return (
    <Dropdown>
      <Button aria-label="查看终端会话" className="min-w-0 rounded-full pl-1 pr-2" variant="tertiary" isDisabled={isLoading} onPress={onRefresh}>
        {activeSession ? (
          <SessionStatusAvatar session={activeSession} size="sm" />
        ) : (
          <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-white ring-2 ring-muted/30">
            <Icon icon={isLoading ? 'lucide:loader-circle' : 'lucide:terminal-square'} className={isLoading ? 'size-3.5 animate-spin' : 'size-3.5'} />
            {runningCount > 0 ? <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-success shadow-[0_0_10px_color-mix(in_oklch,var(--success)_70%,transparent)]" /> : null}
          </span>
        )}
        <span className="min-w-0 max-w-44 truncate text-sm font-semibold text-foreground">{buttonLabel}</span>
        <Icon icon="lucide:chevron-down" className="size-4 shrink-0 text-muted" />
      </Button>
      <Dropdown.Popover className="min-w-[auto]" placement="bottom start">
        <Dropdown.Menu selectedKeys={new Set(activeSessionId ? [activeSessionId] : [])} selectionMode="single" onAction={(key) => key !== 'empty' && onSelect(String(key))}>
          {sessions.length === 0 ? (
            <Dropdown.Item key="empty" id="empty" isDisabled textValue="暂无终端会话">
              <div className="flex items-center gap-3 py-1 text-muted">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted/20 text-muted">
                  <Icon icon="lucide:terminal-square" className="size-4" />
                </span>
                <div>
                  <div className="text-sm font-medium">暂无终端会话</div>
                  <div className="text-xs">启动后会在这里切换</div>
                </div>
              </div>
            </Dropdown.Item>
          ) : (
            sessions.map((session) => (
              <Dropdown.Item key={session.id} id={session.id} textValue={`${session.command} ${session.cwd}`}>
                <Dropdown.ItemIndicator type="dot" />
                <div className="flex min-w-0 items-center gap-3">
                  <SessionStatusAvatar session={session} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{formatSessionTitle(session)}</div>
                    <div className="mt-1 truncate text-xs text-muted">{formatTerminalTime(session.updatedAt)} · PID {session.pid || '-'} · {session.cwd}</div>
                  </div>
                </div>
              </Dropdown.Item>
            ))
          )}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function SessionStatusAvatar({ session, size = 'md' }: { session: CCConnectTerminalSession; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'size-7 [&>svg]:size-3.5' : 'size-9 [&>svg]:size-4'
  const toneClass = session.status === 'running'
    ? 'bg-success shadow-[0_0_14px_color-mix(in_oklch,var(--success)_70%,transparent)] ring-success/30'
    : 'bg-danger ring-danger/30'

  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full text-white ring-2 ${sizeClass} ${toneClass}`}>
      <Icon icon="lucide:terminal-square" />
    </span>
  )
}

function formatSessionTitle(session: CCConnectTerminalSession) {
  return `${session.command}-PID ${session.pid || '-'}`
}

function sanitizeTerminalChunk(chunk: string) {
  const osc11LoosePattern = new RegExp('\\]11;rgb:[0-9A-Fa-f/]+', 'g')
  return chunk.replace(osc11LoosePattern, '')
}

function upsertTerminalSession(sessions: CCConnectTerminalSession[], next: CCConnectTerminalSession) {
  const exists = sessions.some((item) => item.id === next.id)
  if (!exists) return [next, ...sessions]
  return sessions.map((item) => item.id === next.id ? next : item)
}

function isTerminalSessionInteractive(session: CCConnectTerminalSession | null) {
  return session?.status === 'running'
}

function formatTerminalTime(value: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default CCConnectTerminalPage
