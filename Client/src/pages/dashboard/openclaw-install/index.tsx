import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Chip, Modal, Skeleton, Tooltip, toast } from '@heroui/react'
import { Stepper } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type {
  EnvironmentResponse,
  OpenClawChannelStreamError,
  OpenClawChannelStreamLog,
  OpenClawChannelStreamMeta,
  OpenClawChannelStreamStatus,
  OpenClawChannelTaskResponse,
  OpenClawEnvironmentResponse,
  PluginActionStreamError,
  PluginActionStreamLog,
  PluginActionStreamStatus,
  ToolInfo,
} from '@/api'
import { getOpenClawInstallStreamURL, getPluginInstallStreamURL } from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { useEnvironmentStore } from '@/stores/environment'
import { useOpenClawEnvironmentStore } from '@/stores/openclaw-environment'
import { InstallLoadErrorCard } from '../install-shared/InstallLoadErrorCard'

type LoadState = 'error' | 'loading' | 'ready'
type StepTone = 'active' | 'danger' | 'success' | 'warning' | 'waiting'
type InstallDependencyID = 'git' | 'homebrew' | 'nodejs'

type InstallStepItem = {
  description: string
  icon: string
  indicatorOnly?: boolean
  installPluginId?: InstallDependencyID
  prerequisite?: boolean
  required?: boolean
  title: string
  tone: StepTone
  trailing: string
}

function OpenClawInstallPage() {
  usePageTitle('OpenClaw 安装向导')
  const navigate = useNavigate()
  const environment = useEnvironmentStore((store) => store.data)
  const loadSharedEnvironment = useEnvironmentStore((store) => store.loadEnvironment)
  const openClawEnvironment = useOpenClawEnvironmentStore((store) => store.data)
  const loadSharedOpenClawEnvironment = useOpenClawEnvironmentStore((store) => store.loadOpenClawEnvironment)
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState('')
  const [isLogOpen, setLogOpen] = useState(false)
  const [installingDependency, setInstallingDependency] = useState<InstallDependencyID | ''>('')
  const [task, setTask] = useState<OpenClawChannelTaskResponse | null>(null)
  const logRef = useRef<HTMLPreElement | null>(null)
  const sourceRef = useRef<EventSource | null>(null)
  const dependencySourceRef = useRef<EventSource | null>(null)
  const streamFinishedRef = useRef(false)
  const dependencyStreamFinishedRef = useRef(false)

  const closeStream = useCallback(() => {
    sourceRef.current?.close()
    sourceRef.current = null
  }, [])

  const closeDependencyStream = useCallback(() => {
    dependencySourceRef.current?.close()
    dependencySourceRef.current = null
  }, [])

  const loadStatus = useCallback(async (refresh = false) => {
    setState('loading')
    setError('')
    try {
      await Promise.all([
        loadSharedEnvironment(refresh),
        loadSharedOpenClawEnvironment(refresh),
      ])
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : '安装环境检测失败')
      setState('error')
    }
  }, [loadSharedEnvironment, loadSharedOpenClawEnvironment])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStatus()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadStatus])

  useEffect(() => () => {
    closeStream()
    closeDependencyStream()
  }, [closeDependencyStream, closeStream])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [task?.logs])

  const startInstallStream = useCallback(() => {
    if (task?.status === 'pending' || task?.status === 'running') return

    closeStream()
    streamFinishedRef.current = false
    setLogOpen(true)
    const now = new Date().toISOString()
    setTask({
      id: `openclaw-install-${Date.now()}`,
      logs: ['正在连接 OpenClaw 官方安装任务。'],
      progress: 0,
      startedAt: now,
      status: 'pending',
      updatedAt: now,
    })

    const source = new EventSource(getOpenClawInstallStreamURL())
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
          toast.success('OpenClaw 安装任务完成')
          window.dispatchEvent(new CustomEvent('openclaw:status-refresh'))
          void loadStatus(true)
          navigate('/dashboard/openclaw-service')
        }
        if (payload.status === 'error' && payload.error) {
          streamFinishedRef.current = true
          closeStream()
          setLogOpen(true)
          toast.warning(payload.error)
          void loadStatus(true)
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
          logs: appendTaskLog(current.logs, payload.line),
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
        setLogOpen(true)
        toast.warning(payload.message)
        void loadStatus(true)
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
      setLogOpen(true)
      toast.warning('OpenClaw 安装流式任务连接中断')
      void loadStatus(true)
    }
  }, [closeStream, loadStatus, navigate, task?.status])

  const isTaskRunning = task?.status === 'pending' || task?.status === 'running'
  const isOpenClawReady = Boolean(openClawEnvironment?.cli.available && openClawEnvironment.home.configExists && openClawEnvironment.home.configValid)
  const hasMissingRequiredPrerequisite = hasMissingRequiredPrerequisites(environment)
  const steps = useMemo(() => buildInstallSteps(environment, openClawEnvironment, task, state), [environment, openClawEnvironment, state, task])
  const currentStep = useMemo(() => getInstallCurrentStep(steps), [steps])
  const activeInstallStepIndex = useMemo(() => getFirstInstallableStepIndex(steps), [steps])
  const installDependencyStream = useCallback((step: InstallStepItem) => new Promise<void>((resolve, reject) => {
    if (!step.installPluginId) {
      resolve()
      return
    }

    closeDependencyStream()
    dependencyStreamFinishedRef.current = false
    setLogOpen(true)
    const now = new Date().toISOString()
    setTask({
      id: `openclaw-dependency-${step.installPluginId}-${Date.now()}`,
      logs: [`正在连接 ${step.title} 安装任务。`],
      progress: 0,
      startedAt: now,
      status: 'pending',
      updatedAt: now,
    })

    const source = new EventSource(getPluginInstallStreamURL(step.installPluginId))
    dependencySourceRef.current = source

    source.addEventListener('status', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as PluginActionStreamStatus
        setTask((current) => current ? {
          ...current,
          error: payload.error || current.error,
          id: payload.id || current.id,
          progress: payload.progress,
          status: payload.status === 'done' ? 'done' : payload.status === 'error' ? 'error' : 'running',
          updatedAt: payload.timestamp,
        } : current)
      } catch {
        // ignore malformed status payload
      }
    })

    source.addEventListener('log', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as PluginActionStreamLog
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

    source.addEventListener('done', () => {
      dependencyStreamFinishedRef.current = true
      closeDependencyStream()
      setTask((current) => current ? {
        ...current,
        logs: appendTaskLog(current.logs, `${step.title} 安装完成。`),
        progress: 100,
        status: 'done',
        updatedAt: new Date().toISOString(),
      } : current)
      resolve()
    })

    source.addEventListener('error', (event) => {
      const raw = (event as MessageEvent).data
      if (!raw) return
      try {
        const payload = JSON.parse(raw) as PluginActionStreamError
        dependencyStreamFinishedRef.current = true
        closeDependencyStream()
        setTask((current) => current ? {
          ...current,
          error: payload.message,
          id: payload.id || current.id,
          logs: appendTaskLog(current.logs, `失败：${payload.message}`),
          progress: 100,
          status: 'error',
          updatedAt: payload.timestamp,
        } : current)
        reject(new Error(payload.message))
      } catch {
        // ignore malformed error payload
      }
    })

    source.onerror = () => {
      if (dependencyStreamFinishedRef.current) return
      dependencyStreamFinishedRef.current = true
      closeDependencyStream()
      const message = `${step.title} 安装流式连接中断`
      setTask((current) => current ? {
        ...current,
        error: message,
        logs: appendTaskLog(current.logs, `失败：${message}`),
        progress: 100,
        status: 'error',
        updatedAt: new Date().toISOString(),
      } : current)
      reject(new Error(message))
    }
  }), [closeDependencyStream])

  const installDependency = useCallback(async (step: InstallStepItem) => {
    if (!step.installPluginId || installingDependency || isTaskRunning) return

    setInstallingDependency(step.installPluginId)
    setError('')
    try {
      await installDependencyStream(step)
      toast.success(dependencyInstallSuccessMessage(step))
      await loadStatus(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : `${step.title} 安装失败`
      setError(message)
      toast.warning(message)
    } finally {
      setInstallingDependency('')
    }
  }, [installDependencyStream, installingDependency, isTaskRunning, loadStatus])
  const handlePrimaryAction = useCallback(() => {
    if (isOpenClawReady) {
      navigate('/dashboard/openclaw-service')
      return
    }
    if (hasMissingRequiredPrerequisite) {
      toast.warning('请先安装缺失的前置依赖')
      return
    }

    startInstallStream()
  }, [hasMissingRequiredPrerequisite, isOpenClawReady, navigate, startInstallStream])

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-2xl flex-col gap-6 py-6">
        {error ? (
          <InstallLoadErrorCard
            compact={Boolean(environment)}
            error={error}
            isRetrying={state === 'loading'}
            title={environment ? 'OpenClaw 安装环境刷新失败' : '无法加载 OpenClaw 安装环境'}
            onRetry={() => void loadStatus(true)}
          />
        ) : null}

        {state === 'loading' && !environment ? <InstallSkeleton /> : null}

        {environment ? (
          <>
            <div className="flex w-full items-center justify-start gap-4">
              <img
                src="https://assets.orence.net/file/20260516013447922.svg"
                alt=""
                className="h-32 w-auto max-w-full object-contain"
              />

              <div className="flex flex-col gap-2">
                <div className="text-2xl font-bold">OpenClaw 安装向导</div>
                <div className="text-sm text-muted">本向导将检测本机环境并完成 OpenClaw 安装验证。</div>
              </div>
            </div>

            <Card className="-mt-10">
              <Card.Header>
                <div className="flex w-full min-w-0 items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                      <Icon icon="lucide:package-check" className="size-7" />
                    </div>
                    <div className="min-w-0">
                      <Card.Title>安装流程</Card.Title>
                      <Card.Description>检测本机环境并完成 OpenClaw 安装验证。</Card.Description>
                    </div>
                  </div>
                  <Tooltip delay={300}>
                    <Button isIconOnly aria-label="刷新安装环境检测" size="sm" variant="ghost" onPress={() => void loadStatus(true)} isDisabled={state === 'loading'}>
                      <Icon icon="lucide:refresh-cw" className={state === 'loading' ? 'size-4 animate-spin' : 'size-4'} />
                    </Button>
                    <Tooltip.Content>刷新检测</Tooltip.Content>
                  </Tooltip>
                </div>
              </Card.Header>
              <Card.Content className="grid gap-5 mt-4">
                <InstallStepper
                  activeInstallStepIndex={activeInstallStepIndex}
                  currentStep={currentStep}
                  isDependencyActionDisabled={Boolean(installingDependency || isTaskRunning)}
                  installingDependency={installingDependency}
                  steps={steps}
                  onInstallDependency={(step) => void installDependency(step)}
                />
                <Button fullWidth variant="primary" onPress={handlePrimaryAction} isDisabled={Boolean(isTaskRunning || installingDependency || (!isOpenClawReady && hasMissingRequiredPrerequisite))}>
                  <Icon icon={isTaskRunning ? 'lucide:loader-circle' : isOpenClawReady ? 'lucide:layout-dashboard' : ''} className={isTaskRunning ? 'animate-spin' : ''} />
                  {isTaskRunning ? '安装中' : isOpenClawReady ? '仪表盘' : hasMissingRequiredPrerequisite ? '需先安装前置依赖' : '安装'}
                </Button>
              </Card.Content>
            </Card>
          </>
        ) : null}

        <Modal.Backdrop isOpen={isLogOpen} onOpenChange={setLogOpen} variant="opaque">
          <Modal.Container size="lg" scroll="inside">
            <Modal.Dialog className="sm:max-w-[820px]">
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Icon className="bg-accent/10 text-accent">
                  <Icon icon="lucide:terminal-square" className="size-5" />
                </Modal.Icon>
                <div className="min-w-0">
                  <Modal.Heading>OpenClaw 安装日志</Modal.Heading>
                </div>
              </Modal.Header>
              <Modal.Body>
                <InstallTaskLogCard
                  isRunning={Boolean(isTaskRunning)}
                  logRef={logRef}
                  task={task}
                  onClear={() => setTask(null)}
                />
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </div>
    </DashboardLayout>
  )
}

function InstallStepper({
  activeInstallStepIndex,
  currentStep,
  isDependencyActionDisabled,
  installingDependency,
  onInstallDependency,
  steps,
}: {
  activeInstallStepIndex: number
  currentStep: number
  isDependencyActionDisabled: boolean
  installingDependency: InstallDependencyID | ''
  onInstallDependency: (step: InstallStepItem) => void
  steps: InstallStepItem[]
}) {
  return (
    <Stepper className="openclaw-install-stepper px-1" currentStep={currentStep} orientation="vertical" size="lg">
      {steps.map((step, index) => (
        <Stepper.Step key={step.title}>
          <InstallStepIndicator icon={step.icon} tone={step.tone} />
          <Stepper.Content className="min-w-0 flex-1">
            <Stepper.Title className={titleClassName(step.tone) + ' text-base font-semibold'}>{step.title}</Stepper.Title>
            <Stepper.Description className="truncate">{step.description}</Stepper.Description>
          </Stepper.Content>
          <StepTrailing
            indicatorOnly={step.indicatorOnly}
            isActionDisabled={isDependencyActionDisabled || activeInstallStepIndex !== index}
            installing={Boolean(step.installPluginId && installingDependency === step.installPluginId)}
            step={step}
            tone={step.tone}
            value={step.trailing}
            onInstall={() => onInstallDependency(step)}
          />
          <Stepper.Separator />
        </Stepper.Step>
      ))}
    </Stepper>
  )
}

function InstallStepIndicator({ icon, tone }: { icon: string; tone: StepTone }) {
  if (tone === 'success') {
    return (
      <Stepper.Indicator className="bg-surface text-primary">
        <Stepper.Icon>
          <Icon icon={icon} className="size-6" />
        </Stepper.Icon>
      </Stepper.Indicator>
    )
  }
  if (tone === 'danger') {
    return (
      <Stepper.Indicator className="bg-surface text-danger">
        <Stepper.Icon>
          <Icon icon={icon} className="size-6" />
        </Stepper.Icon>
      </Stepper.Indicator>
    )
  }
  if (tone === 'warning') {
    return (
      <Stepper.Indicator className="bg-warning text-warning-foreground">
        <Stepper.Icon>
          <Icon icon={icon} className="size-6" />
        </Stepper.Icon>
      </Stepper.Indicator>
    )
  }
  if (tone === 'active') {
    return (
      <Stepper.Indicator>
        <Stepper.Icon>
          <Icon icon="lucide:loader-circle" className="size-6 animate-spin" />
        </Stepper.Icon>
      </Stepper.Indicator>
    )
  }
  return (
    <Stepper.Indicator className="bg-surface text-muted">
      <Stepper.Icon>
        <Icon icon={icon} className="size-6" />
      </Stepper.Icon>
    </Stepper.Indicator>
  )
}

function StepTrailing({
  indicatorOnly = false,
  isActionDisabled,
  installing,
  onInstall,
  step,
  tone,
  value,
}: {
  indicatorOnly?: boolean
  isActionDisabled: boolean
  installing: boolean
  onInstall: () => void
  step: InstallStepItem
  tone: StepTone
  value: string
}) {
  const color = tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : tone === 'success' ? 'success' : 'default'
  const canInstall = Boolean(step.installPluginId && (step.required ? tone === 'danger' : tone === 'warning'))

  if (canInstall) {
    return (
      <Button className="shrink-0" size="sm" variant={tone === 'danger' ? 'primary' : 'tertiary'} onPress={onInstall} isDisabled={isActionDisabled}>
        <Icon icon={installing ? 'lucide:loader-circle' : 'lucide:download'} className={installing ? 'animate-spin' : ''} />
        安装
      </Button>
    )
  }

  if (indicatorOnly) {
    return (
      <Chip className="shrink-0 truncate text-sm" color={color} variant="soft">
        {value}
      </Chip>
    )
  }

  return (
    <Chip className="shrink-0 truncate text-sm" color={color} variant="soft">
      {value}
    </Chip>
  )
}

function titleClassName(tone: StepTone) {
  if (tone === 'danger') return 'text-danger'
  if (tone === 'success') return 'text-primary'
  if (tone === 'warning') return 'text-warning'
  return undefined
}

function InstallTaskLogCard({
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
  const logs = task?.logs ?? ['尚未开始安装任务。']
  const copyLogs = async () => {
    const text = [logs.join('\n'), task?.error ? task.error : ''].filter(Boolean).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('安装日志已复制')
    } catch {
      toast.warning('日志复制失败')
    }
  }

  return (
    <Card className="min-w-0">
      <Card.Header>
        <div className="flex w-full min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <Card.Title>安装日志</Card.Title>
            <Card.Description>{task?.id || '等待流式任务'}</Card.Description>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Chip color={tone} variant="soft">{status}</Chip>
            <Tooltip delay={300}>
              <Button isIconOnly aria-label="复制安装日志" size="sm" variant="ghost" onPress={() => void copyLogs()} isDisabled={logs.length === 0}>
                <Icon icon="lucide:copy" className="size-4" />
              </Button>
              <Tooltip.Content>复制日志</Tooltip.Content>
            </Tooltip>
            <Tooltip delay={300}>
              <Button isIconOnly aria-label="清空安装日志" size="sm" variant="ghost" onPress={onClear} isDisabled={!task || isRunning}>
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

function InstallSkeleton() {
  return (
    <Card>
      <Card.Content className="space-y-4 p-5">
        {Array.from({ length: 7 }).map((_, index) => (
          <Skeleton key={index} className="h-12 rounded-xl" />
        ))}
      </Card.Content>
    </Card>
  )
}

function getInstallCurrentStep(steps: InstallStepItem[]) {
  const activeStep = steps.findIndex((step) => step.tone === 'active')
  if (activeStep >= 0) return activeStep

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index]?.tone === 'success') return index
  }

  return 0
}

function buildInstallSteps(environment: EnvironmentResponse | null, openClawEnvironment: OpenClawEnvironmentResponse | null, task: OpenClawChannelTaskResponse | null, state: LoadState): InstallStepItem[] {
  const tools = environment?.tools
  const osName = environment?.os?.name || ''
  const toolSteps = osName === 'darwin'
    ? [
        toolStep('Xcode Tools', 'simple-icons:xcode', tools?.xcode, false, 'git'),
        toolStep('Git', 'devicon:git', tools?.git, false, 'git'),
        toolStep('Homebrew', 'devicon:homebrew', tools?.homebrew, false, 'homebrew'),
        nodeJSRuntimeStep(tools?.nodejs, tools?.npm),
      ]
    : [
        toolStep('Git', 'devicon:git', tools?.git, false, 'git'),
        nodeJSRuntimeStep(tools?.nodejs, tools?.npm),
      ]

  const openClawDetectedStep = openClawInstalledStep(openClawEnvironment)
  const taskSteps: InstallStepItem[] = [
    taskStep('OpenClaw 安装', 'lucide:package-check', '执行官方安装脚本', task, state, 8, 72, openClawDetectedStep),
    taskStep('CLI 验证', 'lucide:terminal-square', 'openclaw --version', task, state, 72, 86, openClawDetectedStep ? openClawCliStep(openClawEnvironment) : undefined),
    taskStep('Doctor 检查', 'lucide:stethoscope', 'openclaw doctor', task, state, 86, 96, openClawDetectedStep ? openClawDoctorStep(openClawEnvironment) : undefined),
    taskStep('Gateway 状态', 'lucide:radio-tower', 'openclaw gateway status', task, state, 96, 101, openClawDetectedStep ? openClawGatewayStep(openClawEnvironment) : undefined),
  ]

  return [...toolSteps, ...taskSteps]
}

function toolStep(title: string, icon: string, tool: ToolInfo | undefined, optional: boolean, installPluginId?: InstallDependencyID): InstallStepItem {
  if (tool?.available) {
    return {
      description: tool.path || '-',
      icon,
      indicatorOnly: true,
      installPluginId,
      prerequisite: true,
      required: !optional,
      title,
      tone: 'success',
      trailing: '可用',
    }
  }

  return {
    description: tool?.error || (optional ? '可选工具未检测到' : '未检测到可执行文件'),
    icon,
    indicatorOnly: true,
    installPluginId,
    prerequisite: true,
    required: !optional,
    title,
    tone: optional ? 'warning' : 'danger',
    trailing: optional ? '可选' : '缺失',
  }
}

function nodeJSRuntimeStep(nodejs: ToolInfo | undefined, npm: ToolInfo | undefined): InstallStepItem {
  if (nodejs?.available && npm?.available) {
    return {
      description: nodejs.path || npm.path || 'Node.js 环境可用',
      icon: 'logos:nodejs-icon-alt',
      indicatorOnly: true,
      installPluginId: 'nodejs',
      prerequisite: true,
      required: true,
      title: 'Node.js',
      tone: 'success',
      trailing: '可用',
    }
  }

  return {
    description: nodejs?.error || npm?.error || '未检测到完整 Node.js 环境',
    icon: 'logos:nodejs-icon-alt',
    indicatorOnly: true,
    installPluginId: 'nodejs',
    prerequisite: true,
    required: true,
    title: 'Node.js',
    tone: 'danger',
    trailing: '缺失',
  }
}

function hasMissingRequiredPrerequisites(environment: EnvironmentResponse | null) {
  if (!environment?.tools) return true

  const requiredTools = [
    environment.tools.git,
  ]
  if (environment.os?.name === 'darwin') {
    requiredTools.push(environment.tools.xcode)
    requiredTools.push(environment.tools.homebrew)
  }

  return requiredTools.some((tool) => !tool?.available) || !environment.tools.nodejs?.available || !environment.tools.npm?.available
}

function getFirstInstallableStepIndex(steps: InstallStepItem[]) {
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    if (!step.required && step.installPluginId && step.tone === 'warning') return index
    if (!step.required || step.tone === 'success') continue
    return step.installPluginId ? index : -1
  }
  return -1
}

function dependencyInstallSuccessMessage(step: InstallStepItem) {
  if (step.title === 'Xcode Tools') return 'Xcode Tools 安装已启动'
  if (step.installPluginId === 'homebrew') return 'Homebrew 安装已启动'
  return `${step.title} 安装完成`
}

function taskStep(title: string, icon: string, description: string, task: OpenClawChannelTaskResponse | null, state: LoadState, start: number, end: number, detectedStep?: InstallStepItem): InstallStepItem {
  if (!task || !task.id.startsWith('openclaw-install-')) {
    return detectedStep ?? { description, icon, title, tone: state === 'loading' ? 'waiting' : 'waiting', trailing: '等待' }
  }
  if (task.status === 'error' && task.progress >= start && task.progress < end) {
    return { description: task.error || description, icon, title, tone: 'danger', trailing: '失败' }
  }
  if (task.status === 'done' || task.progress >= end) {
    return { description, icon, title, tone: 'success', trailing: '完成' }
  }
  if (task.progress >= start && task.progress < end) {
    return { description, icon, title, tone: 'active', trailing: '进行中' }
  }
  return detectedStep ?? { description, icon, title, tone: 'waiting', trailing: '等待' }
}

function openClawInstalledStep(environment: OpenClawEnvironmentResponse | null): InstallStepItem | undefined {
  if (!environment) return undefined
  if (environment.cli.available && environment.home.configExists && environment.home.configValid) {
    return {
      description: environment.cli.path || 'OpenClaw CLI 可用，配置文件已就绪',
      icon: 'lucide:package-check',
      title: 'OpenClaw 官方安装',
      tone: 'success',
      trailing: environment.cli.version || '已安装',
    }
  }

  return undefined
}

function openClawCliStep(environment: OpenClawEnvironmentResponse | null): InstallStepItem | undefined {
  if (!environment) return undefined
  if (environment.cli.available) {
    return {
      description: environment.cli.path || 'openclaw --version',
      icon: 'lucide:terminal-square',
      title: 'CLI 验证',
      tone: 'success',
      trailing: environment.cli.version || '可用',
    }
  }

  return {
    description: environment.cli.error || 'OpenClaw CLI 未检测到',
    icon: 'lucide:terminal-square',
    title: 'CLI 验证',
    tone: 'danger',
    trailing: '缺失',
  }
}

function openClawDoctorStep(environment: OpenClawEnvironmentResponse | null): InstallStepItem | undefined {
  if (!environment) return undefined
  const failedChecks = environment.checks.filter((check) => !check.ok)
  if (failedChecks.length === 0) {
    return {
      description: environment.summary || '所有检查通过',
      icon: 'lucide:stethoscope',
      title: 'Doctor 检查',
      tone: 'success',
      trailing: '通过',
    }
  }

  const blockingChecks = failedChecks.filter((check) => check.name !== 'device_key')
  return {
    description: failedChecks.map((check) => check.message).join('；'),
    icon: 'lucide:stethoscope',
    title: 'Doctor 检查',
    tone: blockingChecks.length > 0 ? 'danger' : 'warning',
    trailing: blockingChecks.length > 0 ? '失败' : '需配对',
  }
}

function openClawGatewayStep(environment: OpenClawEnvironmentResponse | null): InstallStepItem | undefined {
  if (!environment) return undefined
  const gateway = environment.gateway
  if (gateway.tcpReachable && gateway.httpHealthOk && gateway.healthzOk && gateway.readyzOk) {
    return {
      description: gateway.url || 'Gateway 已就绪',
      icon: 'lucide:radio-tower',
      title: 'Gateway 状态',
      tone: 'success',
      trailing: String(gateway.port),
    }
  }

  if (gateway.tcpReachable || gateway.httpHealthOk || gateway.healthzOk || gateway.readyzOk) {
    return {
      description: gateway.url || 'Gateway 部分检查通过',
      icon: 'lucide:radio-tower',
      title: 'Gateway 状态',
      tone: 'warning',
      trailing: '检查中',
    }
  }

  return {
    description: gateway.url || 'Gateway 不可达',
    icon: 'lucide:radio-tower',
    title: 'Gateway 状态',
    tone: 'danger',
    trailing: '不可达',
  }
}

function appendTaskLog(logs: string[], line: string) {
  const next = line.trim() ? [...logs, line] : logs
  return next.length > 240 ? next.slice(next.length - 240) : next
}

export default OpenClawInstallPage
