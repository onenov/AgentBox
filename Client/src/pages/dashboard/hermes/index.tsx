import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Chip, Dropdown, Skeleton, Table } from '@heroui/react'
import { ComposedChart, Segment } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type {
  EnvironmentResponse,
  HermesAgentsResponse,
  HermesAgentInfo,
  HermesCronStatusResponse,
  HermesEnvironmentResponse,
  HermesInstancesResponse,
  HermesMessageStatsResponse,
  HermesModelsResponse,
  HermesPlatformsResponse,
  HermesPluginsResponse,
  HermesRecentMessagesResponse,
  HermesSkillsResponse,
} from '@/api'
import {
  getHermesCronStatus,
  getHermesInstances,
  getHermesMessageStats,
  getHermesModels,
  getHermesPlatforms,
  getHermesPlugins,
  getHermesRecentMessages,
  getHermesSkills,
} from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { useEnvironmentStore } from '@/stores/environment'
import { useHermesAgentStore } from '@/stores/hermes-agent'
import { useHermesEnvironmentStore } from '@/stores/hermes-environment'

type DashboardTab = 'overview' | 'profiles' | 'messages'
type LoadState = 'idle' | 'loading' | 'ready' | 'error'
type MessageStatsRange = '1h' | '2h' | '6h' | '12h' | '24h' | 'week' | 'month' | 'all'
type Tone = 'danger' | 'success' | 'warning'
type StatCardColor = 'accent' | 'cyan' | 'danger' | 'rose' | 'success' | 'teal' | 'violet' | 'warning'

type HermesDashboardSnapshot = {
  agents: HermesAgentsResponse | null
  cron: HermesCronStatusResponse | null
  environment: HermesEnvironmentResponse | null
  instances: HermesInstancesResponse | null
  messageStats: HermesMessageStatsResponse | null
  models: HermesModelsResponse | null
  platforms: HermesPlatformsResponse | null
  plugins: HermesPluginsResponse | null
  recentMessages: HermesRecentMessagesResponse | null
  skills: HermesSkillsResponse | null
}

type LoadErrors = Partial<Record<keyof HermesDashboardSnapshot, string>>

type HermesOverviewMetrics = {
  activeAgents: number
  activeProfile: string
  cronJobs: number
  enabledPlatforms: number
  gatewayCpu: string
  gatewayMemory: string
  gatewayPid: string
  gatewayStatus: string
  gatewayTone: Tone
  gatewayUptime: string
  model: string
  pluginEnabled: number
  profiles: number
  provider: string
  runningProcesses: number
  messages: number
  skillsEnabled: number
  version: string
}

type MessageStatsPoint = {
  assistant: number
  label: string
  time: string
  tool: number
  total: number
  user: number
}

const messageStatsRangeOptions: Array<{ hours?: number; label: string; range?: 'week' | 'month' | 'all'; value: MessageStatsRange }> = [
  { hours: 1, label: '1 小时', value: '1h' },
  { hours: 2, label: '2 小时', value: '2h' },
  { hours: 6, label: '6 小时', value: '6h' },
  { hours: 12, label: '12 小时', value: '12h' },
  { hours: 24, label: '24 小时', value: '24h' },
  { label: '本周', range: 'week', value: 'week' },
  { label: '本月', range: 'month', value: 'month' },
  { label: '全部', range: 'all', value: 'all' },
]

function messageStatsRangeQuery(value: MessageStatsRange) {
  const option = messageStatsRangeOptions.find((item) => item.value === value) ?? messageStatsRangeOptions[2]
  return option.range ? { range: option.range } : { hours: option.hours }
}

const emptySnapshot: HermesDashboardSnapshot = {
  agents: null,
  cron: null,
  environment: null,
  instances: null,
  messageStats: null,
  models: null,
  platforms: null,
  plugins: null,
  recentMessages: null,
  skills: null,
}

function HermesDashboardPage() {
  usePageTitle('Hermes')
  const navigate = useNavigate()
  const selectedAgentName = useHermesAgentStore((store) => store.selectedName)
  const selectedProfile = useHermesAgentStore((store) => store.selectedProfile)
  const profiles = useHermesAgentStore((store) => store.profiles)
  const loadAgentsStore = useHermesAgentStore((store) => store.loadAgents)
  const selectAgent = useHermesAgentStore((store) => store.selectAgent)
  const hostEnvironment = useEnvironmentStore((store) => store.data)
  const hostEnvironmentError = useEnvironmentStore((store) => store.error)
  const loadHostEnvironment = useEnvironmentStore((store) => store.loadEnvironment)
  const loadSharedHermesEnvironment = useHermesEnvironmentStore((store) => store.loadHermesEnvironment)

  const [activeTab, setActiveTab] = useState<DashboardTab>('overview')
  const [snapshot, setSnapshot] = useState<HermesDashboardSnapshot>(emptySnapshot)
  const [errors, setErrors] = useState<LoadErrors>({})
  const [state, setState] = useState<LoadState>('idle')
  const [messageStatsRange, setMessageStatsRange] = useState<MessageStatsRange>('6h')

  const activeProfileName = selectedAgentName || selectedProfile?.name || snapshot.environment?.profile?.name || ''

  const loadDashboard = useCallback(async (refresh = false) => {
    setState('loading')
    setErrors({})

    const nextErrors: LoadErrors = {}
    const capture = async <K extends keyof HermesDashboardSnapshot>(
      key: K,
      loader: () => Promise<NonNullable<HermesDashboardSnapshot[K]>>,
    ) => {
      try {
        return await loader()
      } catch (err) {
        nextErrors[key] = err instanceof Error ? err.message : `${key} 加载失败`
        return null
      }
    }

    try {
      const agents = await capture('agents', () => loadAgentsStore(refresh))
      const profile = selectedAgentName || agents?.profiles.find((item) => item.isActive)?.name || agents?.profiles.find((item) => item.isDefault)?.name || ''
      const environment = await capture('environment', () => loadSharedHermesEnvironment(refresh, profile))

      if (environment && !isHermesInstalled(environment)) {
        navigate('/dashboard/hermes-install', { replace: true })
        return { ...emptySnapshot, agents, environment }
      }

      const [
        instances,
        messageStats,
        recentMessages,
        plugins,
        skills,
        models,
        platforms,
        cron,
      ] = await Promise.all([
        capture('instances', () => getHermesInstances(80, profile)),
        capture('messageStats', () => getHermesMessageStats({ profile, ...messageStatsRangeQuery(messageStatsRange) })),
        capture('recentMessages', () => getHermesRecentMessages({ limit: 120, profile })),
        capture('plugins', () => getHermesPlugins(refresh, profile)),
        capture('skills', () => getHermesSkills(refresh, profile)),
        capture('models', () => getHermesModels(profile)),
        capture('platforms', () => getHermesPlatforms(refresh, profile)),
        capture('cron', () => getHermesCronStatus(profile)),
      ])

      setSnapshot({ agents, cron, environment, instances, messageStats, models, platforms, plugins, recentMessages, skills })
      setErrors(nextErrors)
      setState(Object.keys(nextErrors).length > 0 ? 'error' : 'ready')
      return { agents, cron, environment, instances, messageStats, models, platforms, plugins, recentMessages, skills }
    } catch (err) {
      setErrors({ environment: err instanceof Error ? err.message : 'Hermes 控制台加载失败' })
      setState('error')
      return null
    }
  }, [loadAgentsStore, loadSharedHermesEnvironment, messageStatsRange, navigate, selectedAgentName])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDashboard(false)
      void loadHostEnvironment(false).catch(() => undefined)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadDashboard, loadHostEnvironment])

  const metrics = useMemo(() => getOverviewMetrics(snapshot), [snapshot])
  const failedChecks = useMemo(() => snapshot.environment?.checks.filter((check) => !check.ok) ?? [], [snapshot.environment?.checks])
  const checkStats = useMemo(() => getCheckStats(snapshot.environment?.checks), [snapshot.environment?.checks])
  const messageStatsTrend = useMemo(() => buildMessageStatsTrend(snapshot.messageStats), [snapshot.messageStats])
  const hasData = Object.values(snapshot).some(Boolean)
  const isInitialLoading = state === 'loading' && !hasData
  const refreshButtonVariant = state === 'loading' ? 'danger' : state === 'error' ? 'primary' : 'ghost'
  const hasLoadErrors = Object.keys(errors).length > 0
  const loadErrorMessage = hasLoadErrors ? formatLoadErrors(errors) : ''

  const changeMessageStatsRange = useCallback((nextRange: MessageStatsRange) => {
    setMessageStatsRange(nextRange)
  }, [])

  const refreshDashboard = useCallback(() => {
    void loadDashboard(true)
    void loadHostEnvironment(true).catch(() => undefined)
  }, [loadDashboard, loadHostEnvironment])

  if (hasLoadErrors && !hasData) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[calc(100dvh-8rem)] items-center justify-center">
          <Card className="w-full max-w-md">
            <Card.Content>
              <div className="flex flex-col items-center px-6 py-8 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-warning/10 text-warning">
                  <Icon icon="lucide:triangle-alert" className="size-6" />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-foreground">无法加载 Hermes 控制台</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{loadErrorMessage}</p>
                <Button className="mt-6" variant={refreshButtonVariant} onPress={refreshDashboard} isDisabled={state === 'loading'}>
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
        {isInitialLoading ? <HermesDashboardSkeleton /> : null}

        {!isInitialLoading ? (
          <>
            <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
              <Card variant="transparent" className="h-full overflow-visible">
                <Card.Content className="flex h-full items-center overflow-visible">
                  <div className="flex w-full flex-row items-center gap-4 overflow-visible md:gap-6">
                  <div className="flex h-36 shrink-0 items-center justify-center overflow-visible p-1">
                      <img
                        src="/assets/images/Hermes-White.png"
                        alt="Hermes Overview"
                        className="h-full w-auto rounded-full"
                      />
                    </div>
                    <div className="flex min-w-0 flex-col gap-5 pl-2">
                      <div className="min-w-0">
                        <Card.Title className="text-2xl font-bold md:text-3xl">Hermes Agent</Card.Title>
                        <Card.Description className="mt-4 text-base md:text-lg">
                        欢迎使用 Hermes 控制台，今天需要做什么呢？
                        </Card.Description>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <ProfileDropdown
                          profiles={profiles.length ? profiles : snapshot.agents?.profiles ?? []}
                          selectedName={activeProfileName}
                          onSelect={selectAgent}
                        />
                        <Button isIconOnly aria-label="打开终端" size="sm" variant="tertiary" onPress={() => navigate('/dashboard/hermes-terminal')}>
                          <Icon icon="lucide:terminal-square" className="size-4" />
                        </Button>
                        <Button isIconOnly aria-label="服务配置" size="sm" variant="tertiary" onPress={() => navigate('/dashboard/hermes-service')}>
                          <Icon icon="lucide:settings-2" className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card.Content>
              </Card>

              <GatewaySummaryCard
                checkStats={checkStats}
                environment={snapshot.environment}
                metrics={metrics}
              />
            </section>

            {hasLoadErrors ? (
              <InlineWarning
                icon="lucide:triangle-alert"
                message={loadErrorMessage}
                title="部分 Hermes 数据加载失败"
              />
            ) : null}

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <Segment aria-label="Hermes 仪表盘视图" selectedKey={activeTab} onSelectionChange={(key) => setActiveTab(key as DashboardTab)}>
                <Segment.Item id="overview"><Segment.Separator /><Icon icon="lucide:layout-dashboard" className="size-4" />概览</Segment.Item>
                <Segment.Item id="messages"><Segment.Separator /><Icon icon="lucide:messages-square" className="size-4" />消息</Segment.Item>
                <Segment.Item id="profiles"><Segment.Separator /><Icon icon="lucide:users-round" className="size-4" />Profiles</Segment.Item>
              </Segment>

              <Button size="sm" isIconOnly variant={refreshButtonVariant} onPress={refreshDashboard} isDisabled={state === 'loading'}>
                <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
              </Button>
            </div>

            {activeTab === 'overview' ? (
              <OverviewPanel
                failedChecks={failedChecks}
                hostEnvironment={hostEnvironment}
                hostEnvironmentError={hostEnvironmentError}
                messageStats={snapshot.messageStats}
                messageStatsRange={messageStatsRange}
                metrics={metrics}
                statsTrend={messageStatsTrend}
                onMessageStatsRangeChange={changeMessageStatsRange}
                onNavigate={navigate}
              />
            ) : null}

            {activeTab === 'profiles' ? (
              <ProfilesPanel agents={snapshot.agents} onNavigate={navigate} selectedName={activeProfileName} />
            ) : null}

            {activeTab === 'messages' ? (
              <MessagesPanel messages={snapshot.recentMessages} onNavigate={navigate} />
            ) : null}
          </>
        ) : null}
      </div>
    </DashboardLayout>
  )
}

function GatewaySummaryCard({
  checkStats,
  environment,
  metrics,
}: {
  checkStats: { passed: number; total: number }
  environment: HermesEnvironmentResponse | null
  metrics: HermesOverviewMetrics
}) {
  return (
    <Card className="h-full">
      <Card.Content>
        <div className="flex h-full flex-col justify-center gap-4 px-2">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className={environment?.gateway.running ? 'flex size-11 shrink-0 items-center justify-center rounded-full bg-success/10 text-success shadow-[0_0_18px_color-mix(in_oklch,var(--success)_55%,transparent)]' : 'flex size-11 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning'}>
                <Icon icon={environment?.gateway.running ? 'lucide:radio-tower' : 'lucide:server-off'} className="size-5" />
              </div>
              <div className="min-w-0 pl-2">
                <div className="truncate text-base font-semibold text-foreground">{metrics.gatewayStatus}</div>
                <div className="truncate text-xs text-muted">{environment?.summary || environment?.home.path || '-'}</div>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-xs text-muted">端口</div>
              <div className="mt-1 font-semibold tabular-nums text-foreground">{environment?.gateway.listenPorts?.join(', ') || '-'}</div>
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

function OverviewPanel({
  failedChecks,
  hostEnvironment,
  hostEnvironmentError,
  messageStats,
  messageStatsRange,
  metrics,
  onMessageStatsRangeChange,
  onNavigate,
  statsTrend,
}: {
  failedChecks: HermesEnvironmentResponse['checks']
  hostEnvironment: EnvironmentResponse | null
  hostEnvironmentError: string
  messageStats: HermesMessageStatsResponse | null
  messageStatsRange: MessageStatsRange
  metrics: HermesOverviewMetrics
  onMessageStatsRangeChange: (range: MessageStatsRange) => void
  onNavigate: (path: string) => void
  statsTrend: MessageStatsPoint[]
}) {
  return (
    <div className="grid gap-4">
      <FailedChecksCard checks={failedChecks} />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard color="success" description={metrics.gatewayPid} icon="lucide:radio-tower" title="Gateway" tone={metrics.gatewayTone} value={metrics.gatewayStatus} onPress={() => onNavigate('/dashboard/hermes-service')} />
        <StatCard color="accent" description={`${metrics.runningProcesses} 个后台进程`} icon="lucide:users-round" title="Active Agents" tone={metrics.activeAgents > 0 ? 'success' : 'warning'} value={String(metrics.activeAgents)} onPress={() => onNavigate('/dashboard/hermes-agents')} />
        <StatCard color="violet" description={metrics.provider} icon="lucide:brain-circuit" title="主模型" tone={metrics.model === '-' ? 'warning' : 'success'} value={metrics.model} onPress={() => onNavigate('/dashboard/hermes-models')} />
        <StatCard color="cyan" description={`启用 ${metrics.enabledPlatforms} 个平台`} icon="lucide:messages-square" title="消息平台" tone={metrics.enabledPlatforms > 0 ? 'success' : 'warning'} value={String(metrics.enabledPlatforms)} onPress={() => onNavigate('/dashboard/hermes-platforms')} />
        <StatCard color="teal" description={`用户 ${formatCompactNumber(messageStats?.roles.user ?? 0)} · 助手 ${formatCompactNumber(messageStats?.roles.assistant ?? 0)}`} icon="lucide:message-circle" title="消息" tone={metrics.messages > 0 ? 'success' : 'warning'} value={String(metrics.messages)} onPress={() => onNavigate('/dashboard/hermes-platforms')} />
        <StatCard color="warning" description={`${metrics.skillsEnabled} enabled`} icon="lucide:sparkles" title="技能" tone={metrics.skillsEnabled > 0 ? 'success' : 'warning'} value={String(metrics.skillsEnabled)} onPress={() => onNavigate('/dashboard/hermes-skills')} />
        <StatCard color="rose" description={`${metrics.pluginEnabled} enabled`} icon="lucide:puzzle" title="插件" tone={metrics.pluginEnabled > 0 ? 'success' : 'warning'} value={String(metrics.pluginEnabled)} onPress={() => onNavigate('/dashboard/hermes-plugins')} />
        <StatCard color="danger" description="定时任务与运行记录" icon="lucide:calendar-clock" title="Cron" tone={metrics.cronJobs > 0 ? 'success' : 'warning'} value={String(metrics.cronJobs)} onPress={() => onNavigate('/dashboard/hermes-cron')} />
        <StatCard color="danger" description="当前进程 CPU" icon="lucide:cpu" title="CPU" tone={metrics.gatewayCpu === '-' ? 'warning' : 'success'} value={metrics.gatewayCpu} />
        <StatCard color="teal" description="RSS 常驻内存" icon="lucide:memory-stick" title="内存" tone={metrics.gatewayMemory === '-' ? 'warning' : 'success'} value={metrics.gatewayMemory} />
        <StatCard color="warning" description="Gateway uptime" icon="lucide:clock-3" title="已运行" tone={metrics.gatewayUptime === '-' ? 'warning' : 'success'} value={metrics.gatewayUptime} />
        <StatCard color="accent" description="Hermes CLI 版本" icon="lucide:badge-check" title="版本号" tone={metrics.version === '未检测到' ? 'warning' : 'success'} value={metrics.version} />
      </section>
      <MessageStatsCard
        range={messageStatsRange}
        stats={messageStats}
        trend={statsTrend}
        onRangeChange={onMessageStatsRangeChange}
      />
      <HostEnvironmentCard environment={hostEnvironment} error={hostEnvironmentError} />
    </div>
  )
}

function FailedChecksCard({ checks }: { checks: HermesEnvironmentResponse['checks'] }) {
  if (checks.length === 0) return null

  return (
    <Card>
      <Card.Header>
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
            <Icon icon="lucide:triangle-alert" className="size-6" />
          </div>
          <div className="min-w-0">
            <Card.Title>健康检查失败项</Card.Title>
            <Card.Description>以下项目会直接影响 Hermes Gateway 或消息平台运行。</Card.Description>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        <div className="grid gap-2">
          {checks.map((check) => (
            <div key={check.name} className="rounded-2xl bg-danger/10 px-4 py-3 text-sm">
              <div className="font-medium text-danger">{check.name}</div>
              <div className="mt-1 break-words text-muted">{check.message}</div>
            </div>
          ))}
        </div>
      </Card.Content>
    </Card>
  )
}

function MessageStatsCard({
  onRangeChange,
  range,
  stats,
  trend,
}: {
  onRangeChange: (range: MessageStatsRange) => void
  range: MessageStatsRange
  stats: HermesMessageStatsResponse | null
  trend: MessageStatsPoint[]
}) {
  const hasData = trend.some((item) => item.total > 0)
  const selectedRangeLabel = messageStatsRangeOptions.find((option) => option.value === range)?.label ?? '6 小时'
  return (
    <Card>
      <Card.Header>
        <div className="flex w-full min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Icon icon="lucide:chart-no-axes-combined" className="size-6" />
            </div>
            <div className="min-w-0">
              <Card.Title>消息统计</Card.Title>
              <Card.Description>扫描 Hermes 本地 sessions/*.jsonl，按小时汇总用户、助手和工具消息。</Card.Description>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Dropdown>
              <Button size="sm" variant="tertiary">
                <Icon icon="lucide:clock" className="size-4" />
                {selectedRangeLabel}
                <Icon icon="lucide:chevron-down" className="size-4 text-muted" />
              </Button>
              <Dropdown.Popover className="min-w-[auto]" placement="bottom end">
                <Dropdown.Menu
                  selectedKeys={new Set([range])}
                  selectionMode="single"
                  onAction={(key) => onRangeChange(String(key) as MessageStatsRange)}
                >
                  {messageStatsRangeOptions.map((option) => (
                    <Dropdown.Item key={option.value} id={option.value} textValue={option.label}>
                      <Dropdown.ItemIndicator />
                      <span>{option.label}</span>
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        {!stats ? (
          <Skeleton className="h-80 rounded-2xl" />
        ) : !hasData ? (
          <div className="flex h-72 items-center justify-center rounded-2xl bg-surface-secondary/50 text-sm text-muted">所选时间范围暂无消息</div>
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <LegendDot color="var(--accent)" label="总消息" value={formatCompactNumber(stats.total)} />
              <LegendDot color="var(--success)" label="用户" value={formatCompactNumber(stats.roles.user)} />
              <LegendDot color="var(--warning)" label="助手" value={formatCompactNumber(stats.roles.assistant)} />
              <LegendDot color="var(--danger)" label="工具" value={formatCompactNumber(stats.roles.tool)} />
            </div>
            <ComposedChart data={trend} height={300} margin={{ bottom: 0, left: 0, right: 0, top: 8 }}>
              <ComposedChart.Grid stroke="var(--border)" strokeDasharray="3 3" />
              <ComposedChart.XAxis dataKey="label" stroke="var(--muted)" tickLine={false} axisLine={false} />
              <ComposedChart.YAxis hide />
              <ComposedChart.Area dataKey="total" type="monotone" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.14} strokeWidth={2.5} dot={false} name="总消息" />
              <ComposedChart.Line dataKey="user" type="monotone" stroke="var(--success)" strokeWidth={2} dot={false} name="用户" />
              <ComposedChart.Line dataKey="assistant" type="monotone" stroke="var(--warning)" strokeWidth={2} dot={false} name="助手" />
              <ComposedChart.Line dataKey="tool" type="monotone" stroke="var(--danger)" strokeWidth={2} dot={false} name="工具" />
              <ComposedChart.Tooltip content={<MessageStatsTooltip />} />
            </ComposedChart>
          </div>
        )}
      </Card.Content>
    </Card>
  )
}

function ProfilesPanel({
  agents,
  onNavigate,
  selectedName,
}: {
  agents: HermesAgentsResponse | null
  onNavigate: (path: string) => void
  selectedName: string
}) {
  const profiles = agents?.profiles ?? []
  if (!agents) return <HermesDashboardSkeleton compact />
  return (
    <div className="grid gap-4">
      {/* <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label="Profiles" value={String(agents.summary.total)} tone={agents.summary.total > 0 ? 'success' : 'warning'} />
        <SummaryTile label="运行中" value={String(agents.summary.running)} tone={agents.summary.running > 0 ? 'success' : 'warning'} />
        <SummaryTile label="技能总数" value={formatCompactNumber(agents.summary.skillCount)} tone={agents.summary.skillCount > 0 ? 'success' : 'warning'} />
        <SummaryTile label="会话文件" value={formatCompactNumber(agents.summary.sessionCount)} tone={agents.summary.sessionCount > 0 ? 'success' : 'warning'} />
      </section> */}
      <section className="grid gap-3 xl:grid-cols-2">
        {profiles.map((profile) => (
          <Card key={profile.name} className={profile.name === selectedName ? 'border-accent/60' : ''}>
            <Card.Content>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${profile.gatewayRunning ? 'bg-success/10 text-success' : 'bg-surface-secondary text-muted'}`}>
                    <Icon icon={profile.isActive ? 'lucide:star' : 'lucide:bot'} className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-foreground">{profile.displayName || profile.name}</h3>
                      {profile.isActive ? <Chip size="sm" variant="soft" color="success">active</Chip> : null}
                      {profile.isDefault ? <Chip size="sm" variant="soft">default</Chip> : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">{profile.path}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="tertiary" onPress={() => onNavigate('/dashboard/hermes-agents')}>
                    <Icon icon="lucide:settings" className="size-4" />
                    管理
                  </Button>
                  <Button size="sm" variant="tertiary" onPress={() => onNavigate('/dashboard/hermes-terminal')}>
                    <Icon icon="lucide:terminal-square" className="size-4" />
                    终端
                  </Button>
                  <Button size="sm" variant="tertiary" onPress={() => onNavigate('/dashboard/hermes-sessions')}>
                    <Icon icon="lucide:messages-square" className="size-4" />
                    会话
                  </Button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MiniMetric label="模型" value={profile.model || '-'} />
                <MiniMetric label="Provider" value={profile.provider || '-'} />
                <MiniMetric label="技能" value={String(profile.skillCount)} />
                <MiniMetric label="会话" value={String(profile.sessionCount)} />
              </div>
            </Card.Content>
          </Card>
        ))}
      </section>
    </div>
  )
}

function MessagesPanel({ messages, onNavigate }: { messages: HermesRecentMessagesResponse | null; onNavigate: (path: string) => void }) {
  const [selectedPlatform, setSelectedPlatform] = useState('all')
  const platformOptions = useMemo(() => buildRecentMessagePlatformOptions(messages), [messages])
  const selectedPlatformLabel = platformOptions.find((option) => option.value === selectedPlatform)?.label ?? '全部平台'
  const filteredMessages = useMemo(() => {
    const rows = messages?.messages ?? []
    if (selectedPlatform === 'all') return rows
    return rows.filter((message) => normalizeMessagePlatform(message.platform) === selectedPlatform)
  }, [messages?.messages, selectedPlatform])

  if (!messages) return <HermesDashboardSkeleton compact />
  return (
    <div className="grid gap-4">
      <Card>
        <Card.Header>
          <div className="flex w-full min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <Card.Title>最近消息</Card.Title>
              <Card.Description>逐条展示 Hermes 本地会话日志里的用户和助手消息。</Card.Description>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Dropdown>
                <Button size="sm" variant="tertiary">
                  <Icon icon="lucide:messages-square" className="size-4" />
                  {selectedPlatformLabel}
                  <Icon icon="lucide:chevron-down" className="size-4 text-muted" />
                </Button>
                <Dropdown.Popover className="min-w-[180px]" placement="bottom end">
                  <Dropdown.Menu
                    selectedKeys={new Set([selectedPlatform])}
                    selectionMode="single"
                    onAction={(key) => setSelectedPlatform(String(key))}
                  >
                    {platformOptions.map((option) => (
                      <Dropdown.Item key={option.value} id={option.value} textValue={option.label}>
                        <Dropdown.ItemIndicator />
                        <span>{option.label}</span>
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
              <Button size="sm" variant="tertiary" onPress={() => onNavigate('/dashboard/hermes-sessions')}>
                <Icon icon="lucide:external-link" className="size-4" />
                会话管理
              </Button>
            </div>
          </div>
        </Card.Header>
        <Card.Content>
          <Table variant="secondary">
            <Table.ScrollContainer className="max-h-[520px] overflow-auto">
              <Table.Content aria-label="Hermes recent messages" className="min-w-[1060px] table-fixed">
                <Table.Header className="sticky top-0 z-10">
                  <Table.Column isRowHeader id="platform" className="w-[130px]">平台</Table.Column>
                  <Table.Column id="time" className="w-[156px]">时间</Table.Column>
                  <Table.Column id="role" className="w-[96px]">角色</Table.Column>
                  <Table.Column id="sender" className="w-[180px]">发送者</Table.Column>
                  <Table.Column id="content">内容</Table.Column>
                  <Table.Column id="session" className="w-[180px]">会话</Table.Column>
                </Table.Header>
                <Table.Body
                  items={filteredMessages}
                  renderEmptyState={() => <div className="px-4 py-10 text-center text-sm text-muted">暂无消息数据</div>}
                >
                  {(item) => (
                    <Table.Row key={item.id} id={item.id}>
                      <Table.Cell className="w-[130px]">
                        <Chip size="sm" variant="soft">{item.platform || 'local'}</Chip>
                      </Table.Cell>
                      <Table.Cell className="w-[156px] text-xs tabular-nums text-muted">
                        {formatDateTime(item.timestamp)}
                      </Table.Cell>
                      <Table.Cell className="w-[96px]">
                        <Chip size="sm" variant="soft" color={item.role === 'assistant' ? 'warning' : item.role === 'user' ? 'success' : undefined}>
                          {item.role === 'assistant' ? '助手' : item.role === 'user' ? '用户' : item.role}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell className="w-[180px]">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{item.sender || item.chatName || '-'}</p>
                          <p className="truncate text-xs text-muted">{item.senderId || item.chatId || item.chatType || '-'}</p>
                        </div>
                      </Table.Cell>
                      <Table.Cell className="min-w-0">
                        <p className="line-clamp-2 break-words text-sm text-foreground" title={item.content}>{item.content || '-'}</p>
                      </Table.Cell>
                      <Table.Cell className="w-[180px]">
                        <div className="min-w-0">
                          <p className="truncate text-xs text-muted">{item.chatName || item.chatId || '-'}</p>
                          <p className="truncate text-xs text-muted">{item.sessionId}</p>
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  )}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card.Content>
      </Card>
    </div>
  )
}

function buildRecentMessagePlatformOptions(messages: HermesRecentMessagesResponse | null) {
  const counts = new Map<string, { label: string; total: number }>()

  for (const message of messages?.messages ?? []) {
    const value = normalizeMessagePlatform(message.platform)
    const current = counts.get(value)
    if (current) {
      current.total += 1
      continue
    }
    counts.set(value, { label: message.platform?.trim() || 'local', total: 1 })
  }

  const options = Array.from(counts.entries())
    .sort(([, left], [, right]) => {
      if (left.total === right.total) return left.label.localeCompare(right.label)
      return right.total - left.total
    })
    .map(([value, item]) => ({ label: `${item.label} (${item.total})`, value }))

  return [{ label: `全部平台 (${messages?.messages.length ?? 0})`, value: 'all' }, ...options]
}

function normalizeMessagePlatform(value?: string) {
  return value?.trim() || 'local'
}

function ProfileDropdown({
  onSelect,
  profiles,
  selectedName,
}: {
  onSelect: (name: string) => void
  profiles: HermesAgentInfo[]
  selectedName: string
}) {
  const selectedProfile = profiles.find((profile) => profile.name === selectedName) ?? profiles.find((profile) => profile.isActive) ?? profiles[0]
  if (!selectedProfile) return null

  return (
    <Dropdown>
      <Button variant="tertiary" className="min-w-0 rounded-full pl-1 pr-2">
        <ProfileAvatar profile={selectedProfile} size="sm" />
        <span className="min-w-0 max-w-44 truncate text-sm font-semibold text-foreground">{selectedProfile.displayName || selectedProfile.name}</span>
        <Icon icon="lucide:chevron-down" className="size-4 text-muted" />
      </Button>
      <Dropdown.Popover placement="bottom start">
        <Dropdown.Menu selectedKeys={new Set(selectedName ? [selectedName] : [])} selectionMode="single" onAction={(key) => onSelect(String(key))}>
          {profiles.map((profile) => (
            <Dropdown.Item key={profile.name} id={profile.name} textValue={profile.name}>
              <Dropdown.ItemIndicator type="dot" />
              <div className="flex min-w-0 items-center gap-3">
                <ProfileAvatar profile={profile} />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{profile.displayName || profile.name}</span>
                  <p className="mt-1 truncate text-xs text-muted">{profile.model || profile.path}</p>
                </div>
              </div>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function ProfileAvatar({ profile, size = 'md' }: { profile: HermesAgentInfo; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'size-7 [&>svg]:size-3.5' : 'size-9 [&>svg]:size-4'
  const toneClass = profile.gatewayRunning
    ? 'bg-success shadow-[0_0_14px_color-mix(in_oklch,var(--success)_70%,transparent)] ring-success/30'
    : profile.isDefault
      ? 'bg-accent ring-accent/30'
      : 'bg-muted ring-muted/30'

  return (
    <span className={`relative flex shrink-0 items-center justify-center rounded-full text-white ring-2 ${sizeClass} ${toneClass}`}>
      <Icon icon={profile.isDefault ? 'lucide:brain-cog' : 'lucide:brain'} />
    </span>
  )
}

function StatCard({
  color,
  description,
  icon,
  onPress,
  title,
  tone,
  value,
}: {
  color: StatCardColor
  description: string
  icon: string
  onPress?: () => void
  title: string
  tone: Tone
  value: string
}) {
  const colorClass = {
    accent: 'bg-accent/10 text-accent',
    cyan: 'bg-cyan-500/10 text-cyan-600',
    danger: 'bg-danger/10 text-danger',
    rose: 'bg-rose-500/10 text-rose-600',
    success: 'bg-success/10 text-success',
    teal: 'bg-teal-500/10 text-teal-600',
    violet: 'bg-violet-500/10 text-violet-600',
    warning: 'bg-warning/10 text-warning',
  }[color]
  const toneClass = {
    danger: 'bg-danger',
    success: 'bg-success',
    warning: 'bg-warning',
  }[tone]
  const content = (
    <Card.Content>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs flex items-center gap-2 text-muted">
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className={`size-2 rounded-full ${toneClass}`} />
            </div>
            {title}
          </div>
          <div className="mt-2 truncate text-xl font-semibold text-foreground" title={value}>{value}</div>
          <div className="mt-1 truncate text-xs text-muted" title={description}>{description}</div>
        </div>
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${colorClass}`}>
          <Icon icon={icon} className="size-5" />
        </div>
      </div>
    </Card.Content>
  )
  if (!onPress) return <Card>{content}</Card>
  return (
    <button type="button" className="min-w-0 text-left" onClick={onPress}>
      <Card className="h-full border border-transparent transition-all duration-200 hover:![border-color:var(--accent)]">{content}</Card>
    </button>
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

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-surface-secondary/50 px-3 py-2">
      <div className="truncate text-xs text-muted">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-foreground" title={value}>{value}</div>
    </div>
  )
}

function HostEnvironmentCard({ environment, error }: { environment: EnvironmentResponse | null; error: string }) {
  const items = [
    {
      label: '操作系统',
      value: [environment?.os?.version, environment?.os?.name].filter(Boolean).join(' · ') || '-',
    },
    {
      label: '内核版本',
      value: environment?.os?.kernel || '-',
    },
    {
      label: '架构',
      value: environment?.os?.arch || environment?.cpu?.architecture || '-',
    },
    {
      label: '主机名',
      value: environment?.os?.hostname || '-',
    },
    {
      label: '处理器',
      value: formatHostCPU(environment?.cpu),
    },
    {
      label: '内存',
      value: formatHostMemory(environment?.memory),
    },
    {
      label: '操作系统运行时长',
      value: formatHostDuration(environment?.uptime?.systemSeconds),
    },
    {
      label: 'Node.js 版本号',
      value: environment?.tools?.nodejs?.version || '-',
    },
  ]

  return (
    <Card>
      <Card.Header>
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Icon icon="lucide:monitor-cog" className="size-7" />
          </div>
          <div className="min-w-0">
            <Card.Title>操作系统信息</Card.Title>
            <Card.Description>本机系统、硬件与基础运行环境。</Card.Description>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        {error ? (
          <div className="mb-3 rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">
            <div className="flex items-start gap-3">
              <Icon icon="lucide:triangle-alert" className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium">主机环境加载失败</div>
                <div className="mt-1 break-words text-muted">{error}</div>
              </div>
            </div>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {items.map((item) => (
            <HostEnvironmentTile
              key={item.label}
              isLoading={!environment && !error}
              label={item.label}
              value={item.value}
            />
          ))}
        </div>
      </Card.Content>
    </Card>
  )
}

function HostEnvironmentTile({
  isLoading,
  label,
  value,
}: {
  isLoading: boolean
  label: string
  value: string
}) {
  return (
    <div className="min-w-0 rounded-2xl bg-surface-secondary/50 px-4 py-3">
      <div className="min-w-0">
        <div className="truncate text-xs text-muted">{label}</div>
        {isLoading ? (
          <Skeleton className="mt-2 h-5 w-28 rounded-lg" />
        ) : (
          <div className="mt-1 truncate text-sm font-semibold text-foreground" title={value}>
            {value || '-'}
          </div>
        )}
      </div>
    </div>
  )
}

function InlineWarning({ icon, message, title }: { icon: string; message: string; title: string }) {
  return (
    <Card>
      <Card.Content>
        <div className="flex items-start gap-3 text-warning">
          <Icon icon={icon} className="mt-0.5 size-5" />
          <div className="min-w-0">
            <p className="font-medium">{title}</p>
            <p className="mt-1 break-words text-sm text-muted">{message}</p>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function LegendDot({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
      <span>{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </span>
  )
}

function HermesDashboardSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className="grid gap-4">
      {!compact ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
          <Skeleton className="h-48 rounded-3xl" />
          <Skeleton className="h-48 rounded-3xl" />
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-32 rounded-3xl" />
        <Skeleton className="h-32 rounded-3xl" />
        <Skeleton className="h-32 rounded-3xl" />
        <Skeleton className="h-32 rounded-3xl" />
      </div>
      <Skeleton className="h-80 rounded-3xl" />
    </div>
  )
}

function MessageStatsTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean
  label?: number | string
  payload?: Array<{ color?: string; dataKey?: string | number; name?: string; value?: number | string }>
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-2xl bg-overlay px-3 py-2 text-xs shadow-overlay">
      <div className="mb-2 font-medium text-foreground">{label}</div>
      <div className="grid gap-1.5">
        {payload.map((item) => (
          <div key={String(item.dataKey)} className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-2 text-muted">
              <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
              {item.name || item.dataKey}
            </span>
            <span className="font-medium tabular-nums text-foreground">{formatCompactNumber(Number(item.value ?? 0))}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function getOverviewMetrics(snapshot: HermesDashboardSnapshot): HermesOverviewMetrics {
  const environment = snapshot.environment
  const process = environment?.gateway.process
  const model = snapshot.models?.model.default || environment?.config.modelDefault || '-'
  const provider = snapshot.models?.model.provider || environment?.config.modelProvider || '-'
  return {
    activeAgents: snapshot.instances?.summary.activeAgents ?? environment?.gateway.activeAgents ?? 0,
    activeProfile: environment?.profile?.name || snapshot.agents?.profiles.find((profile) => profile.isActive)?.name || '-',
    cronJobs: snapshot.cron?.jobs ?? 0,
    enabledPlatforms: snapshot.platforms?.summary.enabled ?? 0,
    gatewayCpu: formatPercent(process?.cpuPercent),
    gatewayMemory: formatProcessMemory(process?.rssMb, process?.rssBytes),
    gatewayPid: environment?.gateway.pid ? `PID ${environment.gateway.pid}` : 'PID -',
    gatewayStatus: environment?.gateway.running ? '运行中' : environment?.gateway.state || '离线',
    gatewayTone: environment?.gateway.running ? 'success' : 'warning',
    gatewayUptime: process?.uptime || '-',
    model,
    pluginEnabled: snapshot.plugins?.summary.enabled ?? 0,
    profiles: snapshot.agents?.summary.total ?? 0,
    provider,
    runningProcesses: snapshot.instances?.summary.runningProcesses ?? 0,
    messages: snapshot.messageStats?.total ?? 0,
    skillsEnabled: snapshot.skills?.summary.enabled ?? 0,
    version: formatHermesVersion(environment?.cli.version) || (environment?.cli.available ? '可用' : '未检测到'),
  }
}

function buildMessageStatsTrend(stats: HermesMessageStatsResponse | null): MessageStatsPoint[] {
  return stats?.buckets.map((bucket) => ({
    assistant: bucket.roles.assistant,
    label: bucket.label,
    time: bucket.time,
    tool: bucket.roles.tool,
    total: bucket.total,
    user: bucket.roles.user,
  })) ?? []
}

function getCheckStats(checks?: HermesEnvironmentResponse['checks']) {
  const total = checks?.length ?? 0
  const passed = checks?.filter((check) => check.ok).length ?? 0
  return { passed, total }
}

function formatLoadErrors(errors: LoadErrors) {
  return Object.entries(errors).map(([key, value]) => `${key}: ${value}`).join('；')
}

function formatHermesVersion(value?: string) {
  if (!value) return ''
  return value.replace(/^Hermes Agent\s*/i, '').trim()
}

function isHermesInstalled(environment: HermesEnvironmentResponse) {
  return Boolean(
    environment.cli.available
    && environment.home.exists
    && environment.home.configExists
    && environment.config.modelProvider?.trim()
    && environment.config.modelDefault?.trim(),
  )
}

function formatPercent(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  return `${trimTrailingZero(value)}%`
}

function formatProcessMemory(rssMb?: number, rssBytes?: number) {
  if (typeof rssMb === 'number' && Number.isFinite(rssMb) && rssMb > 0) return `${trimTrailingZero(rssMb)} MB`
  if (typeof rssBytes === 'number' && Number.isFinite(rssBytes) && rssBytes > 0) return `${trimTrailingZero(rssBytes / 1024 / 1024)} MB`
  return '-'
}

function formatHostCPU(cpu?: EnvironmentResponse['cpu']) {
  const cores = typeof cpu?.logicalCores === 'number' && cpu.logicalCores > 0 ? `${cpu.logicalCores} 核` : ''
  return [cores, cpu?.model].filter(Boolean).join(' · ') || cpu?.architecture || '-'
}

function formatHostMemory(memory?: EnvironmentResponse['memory']) {
  if (!memory) return '-'
  return `${formatHostBytes(memory.used)} / ${formatHostBytes(memory.total)}`
}

function formatHostBytes(value?: number) {
  if (!value || value <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${trimTrailingZero(size)} ${units[unitIndex]}`
}

function formatHostDuration(seconds?: number) {
  if (!seconds || seconds <= 0) return '0 秒'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`
  if (minutes > 0) return `${minutes} 分钟`
  return `${Math.floor(seconds)} 秒`
}

function formatCompactNumber(value: number) {
  if (!Number.isFinite(value)) return '0'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1, notation: Math.abs(value) >= 10000 ? 'compact' : 'standard' }).format(value)
}

function formatDateTime(value?: string) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function trimTrailingZero(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '')
}

export default HermesDashboardPage
