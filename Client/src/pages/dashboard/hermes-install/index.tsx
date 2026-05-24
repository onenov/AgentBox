import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Chip, Modal, Skeleton, Tooltip, toast } from '@heroui/react'
import { Stepper } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type {
  EnvironmentResponse,
  HermesEnvironmentResponse,
  HermesTaskResponse,
  HermesTaskStreamError,
  HermesTaskStreamLog,
  HermesTaskStreamMeta,
  HermesTaskStreamStatus,
  PluginActionStreamError,
  PluginActionStreamLog,
  PluginActionStreamStatus,
  ToolInfo,
} from '@/api'
import { getHermesInstallStreamURL, getPluginInstallStreamURL } from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { useEnvironmentStore } from '@/stores/environment'
import { useHermesEnvironmentStore } from '@/stores/hermes-environment'
import { InstallLoadErrorCard } from '../install-shared/InstallLoadErrorCard'

type LoadState = 'error' | 'loading' | 'ready'
type StepTone = 'active' | 'danger' | 'success' | 'warning' | 'waiting'
type InstallDependencyID = 'git' | 'uv'

type InstallStepItem = {
  description: string
  icon: string
  indicatorOnly?: boolean
  installPluginId?: InstallDependencyID
  required?: boolean
  title: string
  tone: StepTone
  trailing: string
}

function HermesInstallPage() {
  usePageTitle('Hermes 安装向导')
  const navigate = useNavigate()
  const environment = useEnvironmentStore((store) => store.data)
  const loadSharedEnvironment = useEnvironmentStore((store) => store.loadEnvironment)
  const hermesEnvironment = useHermesEnvironmentStore((store) => store.data)
  const loadSharedHermesEnvironment = useHermesEnvironmentStore((store) => store.loadHermesEnvironment)
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState('')
  const [isLogOpen, setLogOpen] = useState(false)
  const [installingDependency, setInstallingDependency] = useState<InstallDependencyID | ''>('')
  const [task, setTask] = useState<HermesTaskResponse | null>(null)
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
        loadSharedHermesEnvironment(refresh),
      ])
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : '安装环境检测失败')
      setState('error')
    }
  }, [loadSharedEnvironment, loadSharedHermesEnvironment])

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
      id: `hermes-install-${Date.now()}`,
      logs: ['正在连接 Hermes 官方安装任务。'],
      progress: 0,
      startedAt: now,
      status: 'pending',
      updatedAt: now,
    })

    const source = new EventSource(getHermesInstallStreamURL())
    sourceRef.current = source

    source.addEventListener('meta', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as HermesTaskStreamMeta
        setTask((current) => current ? { ...current, id: payload.id, status: 'running', updatedAt: payload.timestamp } : current)
      } catch {
        // ignore malformed stream metadata
      }
    })

    source.addEventListener('status', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as HermesTaskStreamStatus
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
          toast.success('Hermes 安装任务完成')
          window.dispatchEvent(new CustomEvent('hermes:status-refresh'))
          void loadStatus(true)
          navigate('/dashboard/hermes-service')
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
        const payload = JSON.parse((event as MessageEvent).data) as HermesTaskStreamLog
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
        const payload = JSON.parse(raw) as HermesTaskStreamError
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
      toast.warning('Hermes 安装流式任务连接中断')
      void loadStatus(true)
    }
  }, [closeStream, loadStatus, navigate, task?.status])

  const isTaskRunning = task?.status === 'pending' || task?.status === 'running'
  const isHermesReady = Boolean(
    hermesEnvironment?.cli.available
    && hermesEnvironment.home.exists
    && hermesEnvironment.home.configExists
    && isHermesModelInitialized(hermesEnvironment),
  )
  const hasMissingRequiredPrerequisite = hasMissingRequiredPrerequisites(environment)
  const steps = useMemo(() => buildInstallSteps(environment, hermesEnvironment, task, state), [environment, hermesEnvironment, state, task])
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
      id: `hermes-dependency-${step.installPluginId}-${Date.now()}`,
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
    if (isHermesReady) {
      navigate('/dashboard/hermes-service')
      return
    }
    if (hasMissingRequiredPrerequisite) {
      toast.warning('请先安装缺失的前置依赖')
      return
    }

    startInstallStream()
  }, [hasMissingRequiredPrerequisite, isHermesReady, navigate, startInstallStream])

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-2xl flex-col gap-6 py-6">
        {error ? (
          <InstallLoadErrorCard
            compact={Boolean(environment)}
            error={error}
            isRetrying={state === 'loading'}
            title={environment ? 'Hermes 安装环境刷新失败' : '无法加载 Hermes 安装环境'}
            onRetry={() => void loadStatus(true)}
          />
        ) : null}

        {state === 'loading' && !environment ? <InstallSkeleton /> : null}

        {environment ? (
          <>
            <div className="flex w-full items-center justify-start gap-4">
              <img
                src="https://assets.orence.net/file/20260516211848532.svg"
                alt=""
                className="h-28 w-auto max-w-full object-contain"
              />

              <div className="flex flex-col gap-2">
                <div className="text-2xl font-bold">Hermes 安装向导</div>
                <div className="text-sm text-muted">本向导将检测本机环境并完成 Hermes 安装验证。</div>
              </div>
            </div>

            <Card className="-mt-6">
              <Card.Header>
                <div className="flex w-full min-w-0 items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                      <Icon icon="lucide:package-check" className="size-7" />
                    </div>
                    <div className="min-w-0">
                      <Card.Title>安装流程</Card.Title>
                      <Card.Description>检测本机环境并完成 Hermes 安装验证。</Card.Description>
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
              <Card.Content className="mt-4 grid gap-5">
                <InstallStepper
                  activeInstallStepIndex={activeInstallStepIndex}
                  currentStep={currentStep}
                  isDependencyActionDisabled={Boolean(installingDependency || isTaskRunning)}
                  installingDependency={installingDependency}
                  steps={steps}
                  onInstallDependency={(step) => void installDependency(step)}
                />
                <Button fullWidth variant="primary" onPress={handlePrimaryAction} isDisabled={Boolean(isTaskRunning || installingDependency || (!isHermesReady && hasMissingRequiredPrerequisite))}>
                  <Icon icon={isTaskRunning ? 'lucide:loader-circle' : isHermesReady ? 'lucide:layout-dashboard' : 'lucide:download'} className={isTaskRunning ? 'animate-spin' : ''} />
                  {isTaskRunning ? '安装中' : isHermesReady ? '服务管理' : hasMissingRequiredPrerequisite ? '需先安装前置依赖' : '安装'}
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
                  <Modal.Heading>Hermes 安装日志</Modal.Heading>
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
    return <Chip className="shrink-0 truncate text-sm" color={color} variant="soft">{value}</Chip>
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
  task: HermesTaskResponse | null
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
        {Array.from({ length: 8 }).map((_, index) => (
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

function buildInstallSteps(environment: EnvironmentResponse | null, hermesEnvironment: HermesEnvironmentResponse | null, task: HermesTaskResponse | null, state: LoadState): InstallStepItem[] {
  const tools = environment?.tools
  const osName = environment?.os?.name || ''
  const toolSteps = [
    ...(osName === 'darwin' ? [toolStep('Xcode Tools', 'simple-icons:xcode', tools?.xcode, false, 'git')] : []),
    toolStep('Git', 'devicon:git', tools?.git, false, 'git'),
    toolStep('Python', 'devicon:python', tools?.python, false),
    toolStep('uv', 'lucide:zap', tools?.uv, false, 'uv'),
  ]

  const hermesDetectedStep = hermesInstalledStep(hermesEnvironment)
  const taskSteps: InstallStepItem[] = [
    taskStep('Hermes 安装', 'lucide:package-check', '执行官方安装脚本，跳过交互设置', task, state, 8, 72, hermesDetectedStep),
    taskStep('CLI 验证', 'lucide:terminal-square', 'hermes --version', task, state, 72, 86, hermesDetectedStep ? hermesCliStep(hermesEnvironment) : undefined),
    taskStep('Home 与配置', 'lucide:folder-cog', '初始化 ~/.hermes/config.yaml', task, state, 86, 90, hermesDetectedStep ? hermesConfigStep(hermesEnvironment) : undefined),
    taskStep('模型初始化', 'lucide:brain-circuit', '从 model-initialization.json 写入默认 Provider', task, state, 90, 94, hermesDetectedStep ? hermesModelStep(hermesEnvironment) : undefined),
    taskStep('Gateway 状态', 'lucide:radio-tower', 'hermes gateway restart，等待运行态上报', task, state, 94, 98, hermesDetectedStep ? hermesGatewayStep(hermesEnvironment) : undefined),
    taskStep('API Server 配置', 'lucide:server', 'platforms.api_server.enabled', task, state, 98, 101, hermesDetectedStep ? hermesApiServerStep(hermesEnvironment) : undefined),
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
    required: !optional,
    title,
    tone: optional ? 'warning' : 'danger',
    trailing: optional ? '可选' : '缺失',
  }
}

function hasMissingRequiredPrerequisites(environment: EnvironmentResponse | null) {
  if (!environment?.tools) return true

  const requiredTools = [environment.tools.git, environment.tools.python, environment.tools.uv]
  if (environment.os?.name === 'darwin') {
    requiredTools.unshift(environment.tools.xcode)
  }
  return requiredTools.some((tool) => !tool?.available)
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
  return `${step.title} 安装完成`
}

function taskStep(title: string, icon: string, description: string, task: HermesTaskResponse | null, state: LoadState, start: number, end: number, detectedStep?: InstallStepItem): InstallStepItem {
  if (!task || !task.id.startsWith('hermes-install-')) {
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

function hermesInstalledStep(environment: HermesEnvironmentResponse | null): InstallStepItem | undefined {
  if (!environment) return undefined
  if (environment.cli.available && environment.home.exists && environment.home.configExists) {
    return {
      description: environment.cli.path || 'Hermes CLI 可用，配置文件已就绪',
      icon: 'lucide:package-check',
      title: 'Hermes 官方安装',
      tone: 'success',
      trailing: environment.cli.version || '已安装',
    }
  }

  return undefined
}

function hermesCliStep(environment: HermesEnvironmentResponse | null): InstallStepItem | undefined {
  if (!environment) return undefined
  if (environment.cli.available) {
    return {
      description: environment.cli.path || 'hermes --version',
      icon: 'lucide:terminal-square',
      title: 'CLI 验证',
      tone: 'success',
      trailing: environment.cli.version || '可用',
    }
  }

  return {
    description: environment.cli.error || 'Hermes CLI 未检测到',
    icon: 'lucide:terminal-square',
    title: 'CLI 验证',
    tone: 'danger',
    trailing: '缺失',
  }
}

function hermesConfigStep(environment: HermesEnvironmentResponse | null): InstallStepItem | undefined {
  if (!environment) return undefined
  if (environment.home.exists && environment.home.configExists && environment.config.readable) {
    return {
      description: environment.home.configPath,
      icon: 'lucide:folder-cog',
      title: 'Home 与配置',
      tone: environment.config.parsed ? 'success' : 'warning',
      trailing: environment.config.parsed ? '已就绪' : '需检查',
    }
  }

  return {
    description: environment.home.configPath || 'config.yaml 未检测到',
    icon: 'lucide:folder-cog',
    title: 'Home 与配置',
    tone: 'danger',
    trailing: '缺失',
  }
}

function hermesApiServerStep(environment: HermesEnvironmentResponse | null): InstallStepItem | undefined {
  if (!environment) return undefined
  if (environment.config.apiServerEnabled) {
    return {
      description: 'platforms.api_server.enabled = true',
      icon: 'lucide:server',
      title: 'API Server 配置',
      tone: 'success',
      trailing: '已启用',
    }
  }

  return {
    description: 'API Server 未在 config.yaml 中启用',
    icon: 'lucide:server',
    title: 'API Server 配置',
    tone: 'warning',
    trailing: '未启用',
  }
}

function hermesModelStep(environment: HermesEnvironmentResponse | null): InstallStepItem | undefined {
  if (!environment) return undefined
  const provider = environment.config.modelProvider?.trim() ?? ''
  const defaultModel = environment.config.modelDefault?.trim() ?? ''
  if (provider && defaultModel) {
    return {
      description: `${provider}/${defaultModel}`,
      icon: 'lucide:brain-circuit',
      title: '模型初始化',
      tone: 'success',
      trailing: '已就绪',
    }
  }

  if (defaultModel || provider) {
    return {
      description: [provider, defaultModel].filter(Boolean).join('/') || '模型字段不完整',
      icon: 'lucide:brain-circuit',
      title: '模型初始化',
      tone: 'warning',
      trailing: '需检查',
    }
  }

  return {
    description: 'config.yaml 尚未写入默认模型 Provider',
    icon: 'lucide:brain-circuit',
    title: '模型初始化',
    tone: 'warning',
    trailing: '未初始化',
  }
}

function isHermesModelInitialized(environment: HermesEnvironmentResponse | null) {
  return Boolean(environment?.config.modelProvider?.trim() && environment.config.modelDefault?.trim())
}

function hermesGatewayStep(environment: HermesEnvironmentResponse | null): InstallStepItem | undefined {
  if (!environment) return undefined
  if (environment.gateway.running) {
    return {
      description: environment.gateway.urls?.join(', ') || 'Gateway 进程已检测',
      icon: 'lucide:radio-tower',
      title: 'Gateway 状态',
      tone: 'success',
      trailing: environment.gateway.pid ? `PID ${environment.gateway.pid}` : '运行中',
    }
  }

  return {
    description: environment.gateway.pidFileError || environment.gateway.stateFileError || 'Gateway 未运行',
    icon: 'lucide:radio-tower',
    title: 'Gateway 状态',
    tone: 'warning',
    trailing: '未运行',
  }
}

function appendTaskLog(logs: string[], line: string) {
  const next = line.trim() ? [...logs, line] : logs
  return next.length > 240 ? next.slice(next.length - 240) : next
}

export default HermesInstallPage
