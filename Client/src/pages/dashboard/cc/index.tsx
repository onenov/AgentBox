import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Skeleton } from '@heroui/react'
import { Icon } from '@iconify/react'
import type { CCConnectEnvironmentResponse } from '@/api'
import DashboardLayout from '@/layouts/Dashboard'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useCCConnectEnvironmentStore } from '@/stores/cc-connect-environment'

type LoadState = 'idle' | 'loading' | 'ready' | 'error'
type Tone = 'danger' | 'success' | 'warning'

type CCDashboardSnapshot = {
  environment: CCConnectEnvironmentResponse | null
}

type LoadErrors = Partial<Record<keyof CCDashboardSnapshot, string>>
type CCProjectSummary = NonNullable<CCConnectEnvironmentResponse['config']['projects']>[number]

const emptySnapshot: CCDashboardSnapshot = {
  environment: null,
}

function CCConnectDashboardPage() {
  usePageTitle('CC-Connect')
  const navigate = useNavigate()
  const loadSharedEnvironment = useCCConnectEnvironmentStore((store) => store.loadCCConnectEnvironment)
  const [snapshot, setSnapshot] = useState<CCDashboardSnapshot>(emptySnapshot)
  const [errors, setErrors] = useState<LoadErrors>({})
  const [state, setState] = useState<LoadState>('idle')

  const loadDashboard = useCallback(async (refresh = false) => {
    setState('loading')
    setErrors({})
    const nextErrors: LoadErrors = {}
    const capture = async <K extends keyof CCDashboardSnapshot>(
      key: K,
      loader: () => Promise<NonNullable<CCDashboardSnapshot[K]>>,
    ) => {
      try {
        return await loader()
      } catch (err) {
        nextErrors[key] = err instanceof Error ? err.message : `${key} 加载失败`
        return null
      }
    }

    const environment = await capture('environment', () => loadSharedEnvironment(refresh))

    setSnapshot({ environment })
    setErrors(nextErrors)
    setState(Object.keys(nextErrors).length > 0 ? 'error' : 'ready')
  }, [loadSharedEnvironment])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDashboard(false)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadDashboard])

  const metrics = useMemo(() => getCCDashboardMetrics(snapshot), [snapshot])
  const checkStats = useMemo(() => getCheckStats(snapshot.environment?.checks), [snapshot.environment?.checks])
  const hasData = Boolean(snapshot.environment)
  const isInitialLoading = state === 'loading' && !hasData
  const hasErrors = Object.keys(errors).length > 0

  const refreshDashboard = useCallback(() => {
    void loadDashboard(true)
  }, [loadDashboard])

  const onNavigate = useCallback((path: string) => {
    navigate(path)
  }, [navigate])

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        {isInitialLoading ? <CCDashboardSkeleton /> : null}

        {!isInitialLoading ? (
          <>
            <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.85fr)]">
              <Card variant="transparent" className="h-full overflow-visible">
                <Card.Content className="flex h-full items-center overflow-visible">
                  <div className="flex w-full flex-row items-center gap-4 overflow-visible md:gap-6">
                    <div className="flex h-36 shrink-0 items-center justify-center overflow-visible p-1">
                      <img src="/assets/images/CC-Connect-White.png" alt="CC-Connect Overview" className="h-full w-auto rounded-full" />
                    </div>
                    <div className="flex min-w-0 flex-col gap-5 pl-2">
                      <div className="min-w-0">
                        <Card.Title className="text-2xl font-bold md:text-3xl">CC-Connect</Card.Title>
                        <Card.Description className="mt-4 text-base md:text-lg">
                          欢迎使用 CC-Connect 控制台，今天需要做什么呢？
                        </Card.Description>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {/* <Chip color={metrics.installed ? 'success' : 'warning'} variant="soft">
                          {metrics.installed ? '已安装' : '待安装'}
                        </Chip>
                        <Chip color={metrics.runtimeTone === 'success' ? 'success' : metrics.runtimeTone === 'danger' ? 'danger' : 'warning'} variant="soft">
                          {metrics.runtimeLabel}
                        </Chip> */}
                        <Button variant="tertiary" onPress={() => onNavigate(metrics.installed ? '/dashboard/cc-service' : '/dashboard/cc-install')}>
                          <Icon icon={metrics.installed ? 'lucide:server-cog' : 'lucide:wand-sparkles'} />
                          {metrics.installed ? '服务管理' : '安装向导'}
                        </Button>
                        <Button isIconOnly variant={state === 'loading' ? 'danger' : 'ghost'} aria-label="刷新 CC-Connect 总览" onPress={refreshDashboard} isDisabled={state === 'loading'}>
                          <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card.Content>
              </Card>

              <RuntimeSummaryCard checkStats={checkStats} environment={snapshot.environment} metrics={metrics} />
            </section>

            <ProjectsListCard environment={snapshot.environment} onNavigate={onNavigate} />

            {hasErrors ? <LoadWarning errors={errors} /> : null}
          </>
        ) : null}
      </div>
    </DashboardLayout>
  )
}

function getCCDashboardMetrics(snapshot: CCDashboardSnapshot) {
  const environment = snapshot.environment
  const installed = isCCConnectInstalled(environment)
  const runtimeRunning = environment?.runtime.running === true || environment?.daemon.running === true
  const managementReachable = environment?.management.reachable === true
  const runtimeTone: Tone = runtimeRunning && managementReachable ? 'success' : installed ? 'warning' : 'danger'

  return {
    installed,
    managementPort: environment?.config.management.port || 0,
    runtimeLabel: runtimeRunning ? '运行中' : installed ? '未运行' : '未安装',
    runtimeSummary: environment?.summary || environment?.management.url || environment?.home.path || '-',
    runtimeTone,
    version: environment?.cli.version || (environment?.cli.available ? '已安装' : '-'),
  }
}

function isCCConnectInstalled(environment: CCConnectEnvironmentResponse | null) {
  return Boolean(environment?.cli.available && environment.home.exists && environment.config.exists)
}

function RuntimeSummaryCard({
  checkStats,
  environment,
  metrics,
}: {
  checkStats: { passed: number; total: number }
  environment: CCConnectEnvironmentResponse | null
  metrics: ReturnType<typeof getCCDashboardMetrics>
}) {
  const running = metrics.runtimeTone === 'success'
  const warning = metrics.runtimeTone === 'warning'
  return (
    <Card className="h-full">
      <Card.Content>
        <div className="flex h-full flex-col justify-center gap-4 px-2">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className={running ? 'flex size-11 shrink-0 items-center justify-center rounded-full bg-success/10 text-success shadow-[0_0_18px_color-mix(in_oklch,var(--success)_55%,transparent)]' : 'flex size-11 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning'}>
                <Icon icon={running ? 'lucide:radio-tower' : warning ? 'lucide:server-off' : 'lucide:x-circle'} className="size-5" />
              </div>
              <div className="min-w-0 pl-2">
                <div className="truncate text-base font-semibold text-foreground">
                  {running ? 'CC-Connect 运行中' : metrics.installed ? 'CC-Connect 未运行' : 'CC-Connect 未安装'}
                </div>
                <div className="truncate text-xs text-muted">{metrics.runtimeSummary}</div>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-xs text-muted">端口</div>
              <div className="mt-1 font-semibold tabular-nums text-foreground">{metrics.managementPort || '-'}</div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryTile label="检查清单" value={`${checkStats.passed}/${checkStats.total}`} tone={checkStats.passed === checkStats.total ? 'success' : 'danger'} />
            <SummaryTile label="配置状态" value={environment?.config.parsed ? '有效' : environment?.config.exists ? '异常' : '缺失'} tone={environment?.config.parsed ? 'success' : environment?.config.exists ? 'warning' : 'danger'} />
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function ProjectsListCard({
  environment,
  onNavigate,
}: {
  environment: CCConnectEnvironmentResponse | null
  onNavigate: (path: string) => void
}) {
  const projects = (environment?.config.projects ?? []).filter((project) => project.name !== 'default-project')

  return (
    <Card>
      <Card.Header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Icon icon="lucide:folder-kanban" className="size-5" />
          </div>
          <div className="min-w-0">
            <Card.Title>项目列表</Card.Title>
            <Card.Description>{projects.length > 0 ? `${projects.length} 个项目已配置` : '暂无项目配置'}</Card.Description>
          </div>
        </div>
        <Button className="self-start sm:self-auto" size="sm" variant="tertiary" onPress={() => onNavigate('/dashboard/cc-projects')}>
          <Icon icon="lucide:folder-cog" className="size-4" />
          项目管理
        </Button>
      </Card.Header>
      <Card.Content>
        {projects.length > 0 ? (
          <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-surface-secondary/40">
            {projects.map((project) => (
              <ProjectListItem key={project.name} project={project} />
            ))}
          </div>
        ) : (
          <div className="flex min-h-32 flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-surface-secondary/40 px-4 py-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-warning/10 text-warning">
              <Icon icon="lucide:folder-plus" className="size-5" />
            </div>
            <div className="mt-3 text-sm font-medium text-foreground">还没有项目</div>
            <div className="mt-1 text-xs text-muted">创建项目后会显示 Agent、工作目录和消息平台。</div>
          </div>
        )}
      </Card.Content>
    </Card>
  )
}

function ProjectListItem({ project }: { project: CCProjectSummary }) {
  return (
    <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(220px,0.8fr)] lg:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-background text-foreground">
          <Icon icon="lucide:folder-cog" className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground" title={project.name}>{project.name}</div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted">
            <Icon icon="lucide:bot" className="size-3.5 shrink-0" />
            <span className="truncate">{project.agentType || '-'}</span>
          </div>
        </div>
      </div>

      <div className="min-w-0 rounded-xl bg-surface/70 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted">
          <Icon icon="lucide:folder-open" className="size-3.5 shrink-0" />
          <span>工作目录</span>
        </div>
        <div className="mt-1 truncate text-sm font-medium text-foreground" title={project.workDir || '-'}>
          {project.workDir || '-'}
        </div>
      </div>

      <div className="grid min-w-0 gap-2">
        <TagList icon="lucide:messages-square" items={project.platformTypes} placeholder="未配置平台" />
        <TagList icon="lucide:plug" items={project.providerRefs ?? []} placeholder="未引用 Provider" />
      </div>
    </div>
  )
}

function TagList({ icon, items, placeholder }: { icon: string; items: string[]; placeholder: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon icon={icon} className="size-3.5 shrink-0 text-muted" />
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {items.length > 0 ? (
          items.map((item) => (
            <span key={item} className="max-w-28 truncate rounded-full bg-content2 px-2 py-0.5 text-xs font-medium text-foreground" title={item}>
              {item}
            </span>
          ))
        ) : (
          <span className="text-xs text-muted">{placeholder}</span>
        )}
      </div>
    </div>
  )
}

function LoadWarning({ errors }: { errors: LoadErrors }) {
  return (
    <Card className="border-warning/40 bg-warning/5">
      <Card.Content className="flex items-start gap-3">
        <Icon icon="lucide:triangle-alert" className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground">部分数据加载失败</div>
          <div className="mt-1 text-sm leading-6 text-muted">{Object.entries(errors).map(([key, value]) => `${key}: ${value}`).join('；')}</div>
        </div>
      </Card.Content>
    </Card>
  )
}

function SummaryTile({ label, tone, value }: { label: string; tone: Tone; value: string }) {
  const failedCount = (() => {
    if (label !== '检查清单') return null

    const match = value.match(/^(\d+)\/(\d+)$/)
    if (!match) return null

    const passed = Number(match[1])
    const total = Number(match[2])
    if (!Number.isFinite(passed) || !Number.isFinite(total)) return null

    return Math.max(total - passed, 0)
  })()
  const isOk = tone === 'success'
  const statusText = isOk ? (label === '检查清单' ? '全部通过' : value || '有效') : failedCount !== null ? `${failedCount} 项异常` : value || '异常'
  const icon = isOk ? 'lucide:check' : 'lucide:circle-alert'
  const statusClass = isOk ? 'text-success bg-success/10' : tone === 'warning' ? 'text-warning bg-warning/10' : 'text-danger bg-danger/10'
  const iconClass = isOk ? 'bg-success text-white shadow-[0_0_0_4px_color-mix(in_oklch,var(--success)_12%,transparent)]' : tone === 'warning' ? 'bg-warning text-white shadow-[0_0_0_4px_color-mix(in_oklch,var(--warning)_12%,transparent)]' : 'bg-danger text-white shadow-[0_0_0_4px_color-mix(in_oklch,var(--danger)_12%,transparent)]'

  return (
    <div className="group flex items-center justify-between gap-3 rounded-2xl bg-surface-secondary/80 px-3.5 py-3 transition-colors hover:bg-surface-tertiary">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
      </div>
      <div className={`inline-flex shrink-0 items-center gap-2 rounded-full py-1 pl-2 pr-1 ${statusClass}`}>
        <span className="max-w-16 truncate text-xs font-medium tabular-nums">{statusText}</span>
        <span className={`flex size-6 items-center justify-center rounded-full ${iconClass}`}>
          <Icon icon={icon} className="size-3.5" />
        </span>
      </div>
    </div>
  )
}

function getCheckStats(checks?: CCConnectEnvironmentResponse['checks']) {
  const items = checks ?? []
  return {
    passed: items.filter((check) => check.ok).length,
    total: items.length,
  }
}

function CCDashboardSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-48 rounded-md" />
    </div>
  )
}

export default CCConnectDashboardPage
