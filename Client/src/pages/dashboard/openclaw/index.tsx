import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Chip, Dropdown, Skeleton } from '@heroui/react'
import { ComposedChart, PieChart, Segment } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  useNodesState,
} from '@xyflow/react'
import dagre from 'dagre'
import '@xyflow/react/dist/style.css'
import type {
  EnvironmentResponse,
  OpenClawAgentBinding,
  OpenClawAgentsResponse,
  OpenClawAgentSummary,
  OpenClawCheck,
  OpenClawConfigResponse,
  OpenClawCostUsageTotals,
  OpenClawCostUsageSummary,
  OpenClawEnvironmentResponse,
  OpenClawMessageStatsResponse,
  OpenClawSessionsListResult,
  OpenClawSessionsUsageResult,
} from '@/api'
import { getOpenClawConfig, getOpenClawMessageStats, listOpenClawAgents, resolveOpenClawGatewayWebSocketURL, OpenClawGatewayClient } from '@/api'
import { openExternalUrl } from '@/utils/openExternalUrl'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { useEnvironmentStore } from '@/stores/environment'
import { useOpenClawEnvironmentStore } from '@/stores/openclaw-environment'
import { useThemeStore } from '@/stores/theme'

type GatewayUsageSnapshot = {
  cost: OpenClawCostUsageSummary
  sessions: OpenClawSessionsListResult
  usage: OpenClawSessionsUsageResult
}

type DashboardTab = 'overview' | 'topology' | 'usage' | 'sessions'
type UsageRange = '1d' | '7d' | '30d'
type MessageStatsRange = '1h' | '2h' | '6h' | '12h' | '24h' | 'week' | 'month' | 'all'
type LoadState = 'idle' | 'loading' | 'ready' | 'error'

type TopologyChannel = {
  configured: boolean
  enabled: boolean
  icon: string
  id: string
  label: string
  type: string
}

type TopologyAccount = {
  accountId: string
  channelId: string
  configured: boolean
  enabled: boolean
  icon: string
  id: string
  label: string
}

type TopologyAgent = {
  id: string
  isDefault: boolean
  label: string
  ready: boolean
  runtime: string
  sessionsReady: boolean
  subagents: string[]
}

type TopologyGateway = {
  authMode: string
  port: number
  ready: boolean
  status: string
  url: string
}

type TopologyRoute = {
  accountId?: string
  agentId: string
  channelId: string
  fallback?: boolean
  id: string
  label: string
  type: 'binding' | 'fallback' | 'subagent'
}

type TopologySelection =
  | { id: string; kind: 'account'; value: TopologyAccount }
  | { id: string; kind: 'agent'; value: TopologyAgent }
  | { id: string; kind: 'channel'; value: TopologyChannel }
  | { id: string; kind: 'gateway'; value: TopologyGateway }
  | { id: string; kind: 'route'; value: TopologyRoute }
  | null

type OverviewMetrics = {
  agentCount: number
  communicationAccountCount: number
  enabledCommunicationAccountCount: number
  gatewayCpu: string
  gatewayCpuDescription: string
  gatewayMemory: string
  gatewayMemoryDescription: string
  gatewayPid: string
  gatewayStatus: string
  gatewayTone: 'success' | 'warning'
  gatewayUptime: string
  gatewayUptimeDescription: string
  primaryModel: string
  providerCount: number
  totalModelCount: number
  version: string
}

type StatCardColor = 'accent' | 'cyan' | 'danger' | 'rose' | 'success' | 'teal' | 'violet' | 'warning'

type TopologyFlowNodeData = {
  icon: string
  id: string
  isSelected: boolean
  kind: 'account' | 'agent' | 'channel' | 'gateway'
  meta: string
  status: string
  title: string
  tone: 'danger' | 'muted' | 'success' | 'warning'
} & Record<string, unknown>

type TopologyFlowNode = Node<TopologyFlowNodeData, 'topologyNode'>
type TopologyFlowEdge = Edge<{ route?: TopologyRoute; selection?: TopologySelection }>

const topologyNodeTypes = { topologyNode: TopologyFlowNodeCard }
const TOPOLOGY_NODE_WIDTH = 226
const TOPOLOGY_NODE_HEIGHT = 88

const usageRangeOptions: Array<{ label: string; value: UsageRange }> = [
  { label: '1D', value: '1d' },
  { label: '7D', value: '7d' },
  { label: '30D', value: '30d' },
]

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

function OpenClawDashboardPage() {
  usePageTitle('OpenClaw')
  const navigate = useNavigate()
  const hostData = useEnvironmentStore((store) => store.data)
  const loadSharedEnvironment = useEnvironmentStore((store) => store.loadEnvironment)
  const data = useOpenClawEnvironmentStore((store) => store.data)
  const loadSharedOpenClawEnvironment = useOpenClawEnvironmentStore((store) => store.loadOpenClawEnvironment)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [configData, setConfigData] = useState<OpenClawConfigResponse | null>(null)
  const [topologyData, setTopologyData] = useState<OpenClawAgentsResponse | null>(null)
  const [topologyState, setTopologyState] = useState<LoadState>('idle')
  const [usageData, setUsageData] = useState<GatewayUsageSnapshot | null>(null)
  const [usageState, setUsageState] = useState<LoadState>('idle')
  const [messageStatsData, setMessageStatsData] = useState<OpenClawMessageStatsResponse | null>(null)
  const [messageStatsState, setMessageStatsState] = useState<LoadState>('idle')
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview')
  const [usageRange, setUsageRange] = useState<UsageRange>('1d')
  const [messageStatsRange, setMessageStatsRange] = useState<MessageStatsRange>('6h')
  const [messageStatsAgentId, setMessageStatsAgentId] = useState('all')
  const [error, setError] = useState('')
  const [configError, setConfigError] = useState('')
  const [hostError, setHostError] = useState('')
  const [topologyError, setTopologyError] = useState('')
  const [usageError, setUsageError] = useState('')
  const [messageStatsError, setMessageStatsError] = useState('')

  const loadEnvironment = useCallback(async (refresh = false) => {
    setState('loading')
    setError('')

    try {
      const payload = await loadSharedOpenClawEnvironment(refresh)
      setState('ready')
      return payload
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OpenClaw 环境加载失败')
      setState('error')
      return null
    }
  }, [loadSharedOpenClawEnvironment])

  const loadConfig = useCallback(async () => {
    setConfigError('')

    try {
      const payload = await getOpenClawConfig()
      setConfigData(payload)
      return payload
    } catch (err) {
      setConfigData(null)
      setConfigError(err instanceof Error ? err.message : 'OpenClaw 配置加载失败')
      return null
    }
  }, [])

  const loadHostEnvironment = useCallback(async (refresh = false) => {
    setHostError('')

    try {
      const payload = await loadSharedEnvironment(refresh)
      return payload
    } catch (err) {
      setHostError(err instanceof Error ? err.message : '主机环境加载失败')
      return null
    }
  }, [loadSharedEnvironment])

  const loadTopology = useCallback(async () => {
    setTopologyState('loading')
    setTopologyError('')

    try {
      const payload = await listOpenClawAgents()
      setTopologyData(payload)
      setTopologyState('ready')
      return payload
    } catch (err) {
      setTopologyData(null)
      setTopologyError(err instanceof Error ? err.message : 'OpenClaw 拓扑加载失败')
      setTopologyState('error')
      return null
    }
  }, [])

  const loadMessageStats = useCallback(async (range: MessageStatsRange = messageStatsRange, agentId = messageStatsAgentId) => {
    setMessageStatsState('loading')
    setMessageStatsError('')

    try {
      const payload = await getOpenClawMessageStats({ agentId, ...messageStatsRangeQuery(range) })
      setMessageStatsData(payload)
      setMessageStatsState('ready')
      return payload
    } catch (err) {
      setMessageStatsData(null)
      setMessageStatsError(err instanceof Error ? err.message : '消息统计加载失败')
      setMessageStatsState('error')
      return null
    }
  }, [messageStatsAgentId, messageStatsRange])

  const loadUsage = useCallback(async (environment: OpenClawEnvironmentResponse, config: OpenClawConfigResponse | null, range: UsageRange) => {
    const gatewayUrl = resolveOpenClawGatewayWebSocketURL(environment.gateway)
    const token = getGatewayToken(config?.content)

    if (!gatewayUrl || !token) {
      setUsageData(null)
      setUsageError(!gatewayUrl ? 'Gateway WebSocket 地址不可用' : 'Gateway 认证令牌缺失')
      setUsageState('error')
      return null
    }

    const client = new OpenClawGatewayClient({ token, url: gatewayUrl, requestTimeoutMs: 10_000 })
    setUsageState('loading')
    setUsageError('')

    try {
      const [sessions, usage, cost] = await Promise.all([
        requestSessionsList(client),
        requestSessionsUsage(client, range),
        requestUsageCost(client, range),
      ])

      const snapshot = { sessions, usage, cost }
      setUsageData(snapshot)
      setUsageState('ready')
      return snapshot
    } catch (err) {
      setUsageData(null)
      setUsageError(err instanceof Error ? err.message : 'Gateway usage 加载失败')
      setUsageState('error')
      return null
    } finally {
      client.close()
    }
  }, [])

  const refreshDashboard = useCallback(async (refresh = false, range: UsageRange = '1d') => {
    const environment = await loadEnvironment(refresh)

    if (environment && !isOpenClawInstalled(environment)) {
      navigate('/dashboard/openclaw-install', { replace: true })
      return
    }

    const [, config] = await Promise.all([
      loadHostEnvironment(refresh),
      loadConfig(),
      loadTopology(),
      loadMessageStats(messageStatsRange, messageStatsAgentId),
    ])

    if (environment) {
      await loadUsage(environment, config, range)
    } else {
      setUsageData(null)
      setUsageState('idle')
    }
  }, [loadConfig, loadEnvironment, loadHostEnvironment, loadMessageStats, loadTopology, loadUsage, messageStatsAgentId, messageStatsRange, navigate])

  const changeUsageRange = useCallback((nextRange: UsageRange) => {
    setUsageRange(nextRange)

    if (data) {
      void loadUsage(data, configData, nextRange)
    }
  }, [configData, data, loadUsage])

  const changeMessageStatsRange = useCallback((nextRange: MessageStatsRange) => {
    setMessageStatsRange(nextRange)
    void loadMessageStats(nextRange, messageStatsAgentId)
  }, [loadMessageStats, messageStatsAgentId])

  const changeMessageStatsAgent = useCallback((nextAgentId: string) => {
    setMessageStatsAgentId(nextAgentId)
    void loadMessageStats(messageStatsRange, nextAgentId)
  }, [loadMessageStats, messageStatsRange])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshDashboard(false, '1d')
    }, 0)

    return () => window.clearTimeout(timer)
  }, [refreshDashboard])

  const isLoading = state === 'loading' && !data
  const refreshButtonVariant = state === 'loading' ? 'danger' : state === 'error' ? 'primary' : 'ghost'
  const checkStats = getCheckStats(data?.checks)
  const failedChecks = useMemo(() => data?.checks.filter((check) => !check.ok) ?? [], [data?.checks])
  const overviewMetrics = useMemo(() => getOverviewMetrics(configData, topologyData, data), [configData, data, topologyData])
  const usageRangeLabel = usageRangeOptions.find((option) => option.value === usageRange)?.label ?? '1D'
  const gatewayConsoleUrl = useMemo(() => getGatewayConsoleUrl(data, configData), [configData, data])

  return (
    <DashboardLayout>
      <div className={error && !data ? 'flex min-h-[calc(100dvh-8rem)] items-center justify-center' : 'mx-auto flex max-w-7xl flex-col gap-6'}>
        {error && !data ? (
          <Card className="w-full max-w-md">
            <Card.Content>
              <div className="flex flex-col items-center px-6 py-8 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-warning/10 text-warning">
                  <Icon icon="lucide:triangle-alert" className="size-6" />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-foreground">无法加载 OpenClaw 环境</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{error}</p>
                <Button className="mt-6" variant={refreshButtonVariant} onPress={() => void refreshDashboard(true, usageRange)} isDisabled={state === 'loading'}>
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
              <div className="flex items-start gap-3 text-warning">
                <Icon icon="lucide:triangle-alert" className="mt-0.5 size-5" />
                <div>
                  <p className="font-medium">OpenClaw 环境刷新失败</p>
                  <p className="mt-1 text-sm text-muted">{error}</p>
                </div>
              </div>
            </Card.Content>
          </Card>
        ) : null}

        {configError && data ? (
          <Card>
            <Card.Content>
              <div className="flex items-start gap-3 text-warning">
                <Icon icon="lucide:file-warning" className="mt-0.5 size-5" />
                <div>
                  <p className="font-medium">OpenClaw 配置读取失败</p>
                  <p className="mt-1 text-sm text-muted">{configError}</p>
                </div>
              </div>
            </Card.Content>
          </Card>
        ) : null}

        {isLoading ? <OpenClawSkeleton /> : null}

        {data ? (
          <>
            <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.85fr)]">
              <Card variant="transparent" className="h-full overflow-visible">
                <Card.Content className="flex h-full items-center overflow-visible">
                  <div className="flex w-full flex-row items-center gap-4 overflow-visible md:gap-6">
                    <div className="flex h-36 shrink-0 items-center justify-center overflow-visible p-1">
                      <img
                        src="/assets/images/OpenClaw.png"
                        alt="OpenClaw Overview"
                        className="h-full w-auto rounded-full"
                      />
                    </div>
                    <div className="flex min-w-0 flex-col gap-5 pl-2">
                      <div className="min-w-0">
                        <Card.Title className="text-2xl font-bold md:text-3xl">OpenClaw</Card.Title>
                        <Card.Description className="mt-4 text-base md:text-lg">
                          欢迎使用 OpenClaw 控制台，今天需要做什么呢？
                        </Card.Description>
                      </div>
                    </div>
                  </div>
                </Card.Content>
              </Card>

              <Card className="h-full">
                <Card.Content>
                  <div className="flex h-full flex-col justify-center gap-4 px-2">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className={data.gateway.readyzOk ? 'flex size-11 shrink-0 items-center justify-center rounded-full bg-success/10 text-success shadow-[0_0_18px_color-mix(in_oklch,var(--success)_55%,transparent)]' : 'flex size-11 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning'}>
                          <Icon icon={data.gateway.readyzOk ? 'lucide:radio-tower' : data.gateway.tcpReachable ? 'lucide:activity' : 'lucide:server-off'} className="size-5" />
                        </div>
                        <div className="min-w-0 pl-2">
                          <div className="truncate text-base font-semibold text-foreground">
                            {data.gateway.readyzOk ? 'Gateway 运行中' : data.gateway.tcpReachable ? 'Gateway 运行中' : 'Gateway 离线'}
                          </div>
                          <div className="truncate text-xs text-muted">{data.summary || data.gateway.url || '-'}</div>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-xs text-muted">端口</div>
                        <div className="mt-1 font-semibold tabular-nums text-foreground">{data.gateway.port || '-'}</div>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <SummaryTile label="检查清单" value={`${checkStats.passed}/${checkStats.total}`} tone={failedChecks.length === 0 ? 'success' : 'danger'} />
                      <SummaryTile label="配置状态" value={data.home.configValid ? '有效' : data.home.configExists ? '异常' : '缺失'} tone={data.home.configValid ? 'success' : data.home.configExists ? 'warning' : 'danger'} />
                      {/* <SummaryTile label="Device Key" value={data.home.deviceKeyExists ? '已生成' : '缺失'} tone={data.home.deviceKeyExists ? 'success' : 'warning'} />
                      <SummaryTile label="CLI" value={data.cli.available ? '可用' : '未检测到'} tone={data.cli.available ? 'success' : 'danger'} /> */}
                    </div>
                  </div>
                </Card.Content>
              </Card>
            </section>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <Segment aria-label="OpenClaw 仪表盘视图" selectedKey={activeTab} onSelectionChange={(key) => setActiveTab(key as DashboardTab)}>
                <Segment.Item id="overview">
                  <Segment.Separator />
                  <Icon icon="lucide:layout-dashboard" className="size-4" />
                  概览
                </Segment.Item>
                <Segment.Item id="usage">
                  <Segment.Separator />
                  <Icon icon="lucide:chart-no-axes-combined" className="size-4" />
                  用量
                </Segment.Item>
                <Segment.Item id="sessions">
                  <Segment.Separator />
                  <Icon icon="lucide:messages-square" className="size-4" />
                  会话
                </Segment.Item>
                <Segment.Item id="topology">
                  <Segment.Separator />
                  <Icon icon="lucide:network" className="size-4" />
                  拓扑
                </Segment.Item>
              </Segment>

              <div className="flex items-center gap-2">
                {activeTab === 'usage' ? (
                  <Dropdown>
                    <Button size="sm" variant="tertiary">
                      <Icon icon="lucide:funnel" className="size-4" />
                      {usageRangeLabel}
                      <Icon icon="lucide:chevron-down" className="size-4 text-muted" />
                    </Button>
                    <Dropdown.Popover className="min-w-[auto]" placement="bottom end">
                      <Dropdown.Menu
                        selectedKeys={new Set([usageRange])}
                        selectionMode="single"
                        onAction={(key) => changeUsageRange(String(key) as UsageRange)}
                      >
                        {usageRangeOptions.map((option) => (
                          <Dropdown.Item key={option.value} id={option.value} textValue={option.label}>
                            <Dropdown.ItemIndicator />
                            <span>{option.label}</span>
                          </Dropdown.Item>
                        ))}
                      </Dropdown.Menu>
                    </Dropdown.Popover>
                  </Dropdown>
                ) : null}

                <Button
                  size="sm"
                  variant="tertiary"
                  onPress={() => void openExternalUrl(gatewayConsoleUrl)}
                  isDisabled={!gatewayConsoleUrl}
                >
                  <Icon icon="lucide:external-link" className="size-4" />
                  原生控制台
                </Button>

                <Button size="sm" isIconOnly variant={refreshButtonVariant} onPress={() => void refreshDashboard(true, usageRange)} isDisabled={state === 'loading' || usageState === 'loading'}>
                  <Icon icon={state === 'loading' || usageState === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' || usageState === 'loading' ? 'animate-spin' : ''} />
                </Button>
              </div>
            </div>

            {activeTab === 'overview' ? (
              <OverviewPanel
                hostEnvironment={hostData}
                hostError={hostError}
                messageStats={messageStatsData}
                messageStatsAgentId={messageStatsAgentId}
                messageStatsError={messageStatsError}
                messageStatsRange={messageStatsRange}
                messageStatsIsLoading={messageStatsState === 'loading'}
                metrics={overviewMetrics}
                onMessageStatsAgentChange={changeMessageStatsAgent}
                onMessageStatsRangeChange={changeMessageStatsRange}
                onNavigate={navigate}
                topologyData={topologyData}
              />
            ) : null}

            {activeTab === 'topology' ? (
              <TopologyPanel
                agentsData={topologyData}
                configData={configData}
                environment={data}
                error={topologyError || configError}
                isLoading={topologyState === 'loading'}
              />
            ) : null}

            {activeTab === 'usage' ? (
              <UsagePanel
                error={usageError}
                isLoading={usageState === 'loading'}
                snapshot={usageData}
                usageRange={usageRange}
              />
            ) : null}

            {activeTab === 'sessions' ? (
              <SessionsPanel
                error={usageError}
                isLoading={usageState === 'loading'}
                sessionsResult={usageData?.sessions ?? null}
                usageResult={usageData?.usage ?? null}
              />
            ) : null}

            {failedChecks.length > 0 ? (
              <Card>
                <Card.Header>
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon icon="lucide:shield-alert" className="size-6 shrink-0 text-danger" />
                    <div className="min-w-0">
                      <Card.Title>未通过检测项</Card.Title>
                      <Card.Description>仅显示需要处理的 OpenClaw 环境检查</Card.Description>
                    </div>
                  </div>
                </Card.Header>
                <Card.Content>
                  <div className="flex flex-col gap-2">
                    {failedChecks.map((check) => (
                      <CheckItem key={check.name} check={check} />
                    ))}
                  </div>
                </Card.Content>
              </Card>
            ) : null}
          </>
        ) : null}
      </div>
    </DashboardLayout>
  )
}

function getCheckStats(checks?: OpenClawCheck[]) {
  const total = checks?.length || 0
  const passed = checks?.filter((check) => check.ok).length || 0
  return { total, passed }
}

function getOverviewMetrics(
  configData: OpenClawConfigResponse | null,
  agentsData: OpenClawAgentsResponse | null,
  environment: OpenClawEnvironmentResponse | null,
): OverviewMetrics {
  const content = configData?.content ?? {}
  const channels = configObject(content.channels)
  const models = configObject(content.models)
  const providers = configObject(models.providers)
  const agents = configObject(content.agents)
  const agentDefaults = configObject(agents.defaults)
  const defaultModel = configObject(agentDefaults.model)
  const agentList = Array.isArray(agents.list) ? agents.list : []
  const communicationAccountStats = getCommunicationAccountStats(channels)
  const ownerProcess = environment?.gateway.ownerProcess
  let totalModelCount = 0

  for (const provider of Object.values(providers)) {
    const providerConfig = configObject(provider)
    if (Array.isArray(providerConfig.models)) {
      totalModelCount += providerConfig.models.length
    }
  }

  return {
    agentCount: agentsData?.summary?.total ?? agentsData?.agents.length ?? agentList.length,
    communicationAccountCount: communicationAccountStats.total,
    enabledCommunicationAccountCount: communicationAccountStats.enabled,
    gatewayCpu: formatProcessPercent(ownerProcess?.cpuPercent),
    gatewayCpuDescription: ownerProcess?.detected ? `进程状态 ${ownerProcess.state || '-'}` : '等待进程采样',
    gatewayMemory: formatProcessMemory(ownerProcess?.rssMb, ownerProcess?.rssBytes),
    gatewayMemoryDescription: ownerProcess?.detected ? 'RSS 常驻内存' : '等待进程采样',
    gatewayPid: environment?.gateway.ownerPid ? `PID ${environment.gateway.ownerPid}` : 'PID -',
    gatewayStatus: environment?.gateway.readyzOk ? '运行中' : environment?.gateway.tcpReachable ? '启动中' : '离线',
    gatewayTone: environment?.gateway.readyzOk || environment?.gateway.tcpReachable ? 'success' : 'warning',
    gatewayUptime: ownerProcess?.uptime || '-',
    gatewayUptimeDescription: formatProcessStartedAt(ownerProcess?.startedAt),
    primaryModel: stringFromUnknown(defaultModel.primary) || stringFromUnknown(agentDefaults.model) || agentsData?.defaults?.model || '-',
    providerCount: Object.keys(providers).length,
    totalModelCount,
    version: formatOpenClawVersion(environment?.cli.version) || (environment?.cli.available ? '可用' : '未检测到'),
  }
}

function getCommunicationAccountStats(channels: Record<string, unknown>): { enabled: number; total: number } {
  return Object.values(channels).reduce<{ enabled: number; total: number }>((stats, channelValue) => {
    const accounts = configObject(configObject(channelValue).accounts)
    const accountConfigs = Object.values(accounts).map(configObject).filter((account) => Object.keys(account).length > 0)

    stats.total += accountConfigs.length
    stats.enabled += accountConfigs.filter((account) => account.enabled === true).length
    return stats
  }, { enabled: 0, total: 0 })
}

function formatOpenClawVersion(value?: string) {
  if (!value) return ''
  const match = value.match(/OpenClaw\s+([^\s]+)/i)
  return match?.[1] || value
}

function isOpenClawInstalled(environment: OpenClawEnvironmentResponse) {
  return Boolean(environment.cli.available && environment.home.configExists && environment.home.configValid)
}

function formatProcessPercent(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  return `${trimTrailingZero(value)}%`
}

function formatProcessMemory(rssMb?: number, rssBytes?: number) {
  if (typeof rssMb === 'number' && Number.isFinite(rssMb) && rssMb > 0) {
    return `${trimTrailingZero(rssMb)} MB`
  }

  if (typeof rssBytes === 'number' && Number.isFinite(rssBytes) && rssBytes > 0) {
    return `${trimTrailingZero(rssBytes / 1024 / 1024)} MB`
  }

  return '-'
}

function formatProcessStartedAt(value?: string) {
  if (!value) return '等待进程采样'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '启动时间不可解析'
  return `启动于 ${parsed.toLocaleString('zh-CN', { hour12: false })}`
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

function OverviewPanel({
  hostEnvironment,
  hostError,
  messageStats,
  messageStatsAgentId,
  messageStatsError,
  messageStatsRange,
  messageStatsIsLoading,
  metrics,
  onMessageStatsAgentChange,
  onMessageStatsRangeChange,
  onNavigate,
  topologyData,
}: {
  hostEnvironment: EnvironmentResponse | null
  hostError: string
  messageStats: OpenClawMessageStatsResponse | null
  messageStatsAgentId: string
  messageStatsError: string
  messageStatsRange: MessageStatsRange
  messageStatsIsLoading: boolean
  metrics: OverviewMetrics
  onMessageStatsAgentChange: (agentId: string) => void
  onMessageStatsRangeChange: (range: MessageStatsRange) => void
  onNavigate: (path: string) => void
  topologyData: OpenClawAgentsResponse | null
}) {
  return (
    <div className="grid gap-4">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          onPress={() => onNavigate('/dashboard/openclaw-service')}
          color="success"
          description={metrics.gatewayPid}
          icon="lucide:radio-tower"
          title="Gateway"
          tone={metrics.gatewayTone}
          value={metrics.gatewayStatus}
        />
        <StatCard
          onPress={() => onNavigate('/dashboard/openclaw-models')}
          color="violet"
          description={`共 ${metrics.totalModelCount} 个模型 · ${metrics.providerCount} 个渠道商`}
          icon="lucide:brain-circuit"
          title="AI 主模型"
          tone={metrics.primaryModel === '-' ? 'warning' : 'success'}
          value={metrics.primaryModel}
        />
        <StatCard
          onPress={() => onNavigate('/dashboard/openclaw-channels')}
          color="cyan"
          description={`已启用 ${metrics.enabledCommunicationAccountCount} 个账号`}
          icon="lucide:contact-round"
          title="通讯账号"
          tone={metrics.communicationAccountCount > 0 ? 'success' : 'warning'}
          value={String(metrics.communicationAccountCount)}
        />
        <StatCard
          onPress={() => onNavigate('/dashboard/openclaw-agents')}
          color="accent"
          description="已配置 Agent"
          icon="lucide:bot"
          title="Agent 数量"
          tone={metrics.agentCount > 0 ? 'success' : 'warning'}
          value={String(metrics.agentCount)}
        />
        <StatCard
          color="danger"
          description={metrics.gatewayCpuDescription}
          icon="lucide:cpu"
          title="CPU"
          tone={metrics.gatewayCpu === '-' ? 'warning' : 'success'}
          value={metrics.gatewayCpu}
        />
        <StatCard
          color="teal"
          description={metrics.gatewayMemoryDescription}
          icon="lucide:memory-stick"
          title="内存"
          tone={metrics.gatewayMemory === '-' ? 'warning' : 'success'}
          value={metrics.gatewayMemory}
        />
        <StatCard
          color="warning"
          description={metrics.gatewayUptimeDescription}
          icon="lucide:clock-3"
          title="已运行"
          tone={metrics.gatewayUptime === '-' ? 'warning' : 'success'}
          value={metrics.gatewayUptime}
        />
        <StatCard
          color="rose"
          description="OpenClaw CLI 版本"
          icon="lucide:badge-check"
          title="版本号"
          tone={metrics.version === '未检测到' ? 'warning' : 'success'}
          value={metrics.version}
        />
      </section>
      <MessageStatsCard
        agentId={messageStatsAgentId}
        error={messageStatsError}
        isLoading={messageStatsIsLoading}
        range={messageStatsRange}
        stats={messageStats}
        topologyData={topologyData}
        onAgentChange={onMessageStatsAgentChange}
        onRangeChange={onMessageStatsRangeChange}
      />
      <HostEnvironmentCard error={hostError} environment={hostEnvironment} />
    </div>
  )
}

function MessageStatsCard({
  agentId,
  error,
  isLoading,
  onAgentChange,
  onRangeChange,
  range,
  stats,
  topologyData,
}: {
  agentId: string
  error: string
  isLoading: boolean
  onAgentChange: (agentId: string) => void
  onRangeChange: (range: MessageStatsRange) => void
  range: MessageStatsRange
  stats: OpenClawMessageStatsResponse | null
  topologyData: OpenClawAgentsResponse | null
}) {
  const agentOptions = useMemo(() => buildMessageStatsAgentOptions(topologyData, stats), [stats, topologyData])
  const selectedAgent = agentOptions.find((option) => option.id === agentId) ?? agentOptions[0]
  const selectedRangeLabel = messageStatsRangeOptions.find((option) => option.value === range)?.label ?? '6 小时'
  const chartData = useMemo(() => stats?.buckets.map((bucket) => ({
    assistant: bucket.roles.assistant,
    label: bucket.label,
    time: bucket.time,
    toolResult: bucket.roles.toolResult,
    total: bucket.total,
    user: bucket.roles.user,
  })) ?? [], [stats?.buckets])

  const hasData = chartData.some((item) => item.total > 0)

  return (
    <Card>
      <Card.Header>
        <div className="flex w-full min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Icon icon="lucide:activity" className="size-7" />
            </div>
            <div className="min-w-0">
              <Card.Title>消息统计</Card.Title>
              <Card.Description>按 Agent 扫描 session 消息，按小时汇总数量走势。</Card.Description>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Dropdown>
              <Button size="sm" variant="tertiary">
                <Icon icon="lucide:bot" className="size-4" />
                {selectedAgent?.label ?? '全部'}
                <Icon icon="lucide:chevron-down" className="size-4 text-muted" />
              </Button>
              <Dropdown.Popover className="min-w-[auto]" placement="bottom end">
                <Dropdown.Menu
                  selectedKeys={new Set([agentId])}
                  selectionMode="single"
                  onAction={(key) => onAgentChange(String(key))}
                >
                  {agentOptions.map((option) => (
                    <Dropdown.Item key={option.id} id={option.id} textValue={option.label}>
                      <Dropdown.ItemIndicator />
                      <span>{option.label}</span>
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
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
        {error ? <InlineWarning icon="lucide:triangle-alert" message={error} title="消息统计加载失败" /> : null}
        {isLoading && !stats ? (
          <Skeleton className="h-80 rounded-2xl" />
        ) : !stats || chartData.length === 0 ? (
          <div className="flex h-72 items-center justify-center rounded-2xl bg-surface-secondary/50 text-sm text-muted">暂无消息统计数据</div>
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <LegendDot color="var(--accent)" label="总消息" value={formatCompactNumber(stats.total)} />
              <LegendDot color="var(--success)" label="用户" value={formatCompactNumber(stats.roles.user)} />
              <LegendDot color="var(--warning)" label="助手" value={formatCompactNumber(stats.roles.assistant)} />
              <LegendDot color="var(--danger)" label="工具结果" value={formatCompactNumber(stats.roles.toolResult)} />
            </div>
            {hasData ? (
              <ComposedChart data={chartData} height={320} margin={{ bottom: 0, left: 0, right: 0, top: 8 }}>
                <ComposedChart.Grid stroke="var(--border)" strokeDasharray="3 3" />
                <ComposedChart.XAxis dataKey="label" stroke="var(--muted)" tickLine={false} axisLine={false} />
                <ComposedChart.YAxis hide />
                <ComposedChart.Area dataKey="total" type="monotone" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.14} strokeWidth={2.5} dot={false} name="总消息" />
                <ComposedChart.Line dataKey="user" type="monotone" stroke="var(--success)" strokeWidth={2} dot={false} name="用户" />
                <ComposedChart.Line dataKey="assistant" type="monotone" stroke="var(--warning)" strokeWidth={2} dot={false} name="助手" />
                <ComposedChart.Line dataKey="toolResult" type="monotone" stroke="var(--danger)" strokeWidth={2} dot={false} name="工具结果" />
                <ComposedChart.Tooltip content={<MessageStatsTooltip />} />
              </ComposedChart>
            ) : (
              <div className="flex h-72 items-center justify-center rounded-2xl bg-surface-secondary/50 text-sm text-muted">所选时间范围暂无消息</div>
            )}
          </div>
        )}
      </Card.Content>
    </Card>
  )
}

function buildMessageStatsAgentOptions(topologyData: OpenClawAgentsResponse | null, stats: OpenClawMessageStatsResponse | null) {
  const options = [{ id: 'all', label: '全部' }]
  const seen = new Set(options.map((option) => option.id))

  for (const agent of topologyData?.agents ?? []) {
    const id = agent.id.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    options.push({ id, label: agent.name ? `${agent.name} (${id})` : id })
  }

  for (const agent of stats?.agents ?? []) {
    const id = agent.agentId.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    options.push({ id, label: id })
  }

  return options
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
        {payload.map((item) => {
          const key = String(item.dataKey)
          const value = Number(item.value ?? 0)
          return (
            <div key={key} className="flex items-center justify-between gap-6">
              <span className="flex items-center gap-2 text-muted">
                <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
                {item.name || key}
              </span>
              <span className="font-medium tabular-nums text-foreground">{formatCompactNumber(value)}</span>
            </div>
          )
        })}
      </div>
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

function TopologyPanel({
  agentsData,
  configData,
  environment,
  error,
  isLoading,
}: {
  agentsData: OpenClawAgentsResponse | null
  configData: OpenClawConfigResponse | null
  environment: OpenClawEnvironmentResponse
  error: string
  isLoading: boolean
}) {
  const [selected, setSelected] = useState<TopologySelection>(null)
  const topology = useMemo(() => buildOpenClawTopology(agentsData, configData), [agentsData, configData])
  const selectedRoute = selected?.kind === 'route' ? selected.value : null
  const selectedAccount = selected?.kind === 'account' ? selected.value : selectedRoute?.accountId ? topology.accounts.find((account) => account.channelId === selectedRoute.channelId && account.accountId === selectedRoute.accountId) : null
  const selectedChannel = selected?.kind === 'channel' ? selected.value : selectedAccount ? topology.channels.find((channel) => channel.id === selectedAccount.channelId) : selectedRoute ? topology.channels.find((channel) => channel.id === selectedRoute.channelId) : null
  const selectedAgent = selected?.kind === 'agent' ? selected.value : selectedRoute ? topology.agents.find((agent) => agent.id === selectedRoute.agentId) : null
  const gatewayReady = environment.gateway.tcpReachable && environment.gateway.httpHealthOk && environment.gateway.readyzOk
  const gatewayNode = {
    authMode: environment.gateway.authMode,
    port: environment.gateway.port,
    ready: gatewayReady,
    status: gatewayReady ? 'ready' : environment.gateway.tcpReachable ? 'running' : 'offline',
    url: environment.gateway.url,
  }

  if (isLoading && !agentsData) {
    return <OpenClawSkeleton />
  }

  return (
    <div className="grid gap-4">
      {error ? <InlineWarning icon="lucide:triangle-alert" message={error} title="拓扑数据加载失败" /> : null}

      {/* <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label="Gateway" value={gatewayReady ? '已就绪' : environment.gateway.tcpReachable ? '运行中' : '离线'} tone={gatewayReady ? 'success' : environment.gateway.tcpReachable ? 'warning' : 'danger'} />
        <SummaryTile label="Channels" value={`${enabledChannels} / ${topology.channels.length}`} tone={enabledChannels > 0 ? 'success' : topology.channels.length > 0 ? 'warning' : 'danger'} />
        <SummaryTile label="Agents" value={`${readyAgents} / ${topology.agents.length}`} tone={readyAgents === topology.agents.length && readyAgents > 0 ? 'success' : readyAgents > 0 ? 'warning' : 'danger'} />
        <SummaryTile label="Routes" value={String(topology.routes.filter((route) => route.type === 'binding').length)} tone={topology.routes.some((route) => route.type === 'binding') ? 'success' : 'warning'} />
      </section> */}

      <section
        className="grid min-w-0 transition-[grid-template-columns,gap] duration-300 ease-out"
        style={{
          gap: selected ? '1rem' : '0rem',
          gridTemplateColumns: selected ? 'minmax(0, 1fr) minmax(280px, 280px)' : 'minmax(0, 1fr) 0px',
        }}
      >
        <Card className="min-w-0">
          <Card.Header>
            <div className="flex min-w-0 items-center gap-2">
              <Icon icon="lucide:network" className="size-6 shrink-0 text-muted" />
              <div className="min-w-0">
                <Card.Title>拓扑总览</Card.Title>
                <Card.Description>Gateway、消息渠道、路由绑定和 Agent 调用关系。</Card.Description>
              </div>
            </div>
          </Card.Header>
          <Card.Content>
            {topology.agents.length === 0 && topology.channels.length === 0 ? (
              <div className="rounded-2xl bg-surface-secondary/50 p-6 text-center text-sm text-muted">暂无可展示的 Agent 或 Channel</div>
            ) : (
              <TopologyCanvas topology={topology} selected={selected} onSelect={setSelected} gateway={gatewayNode} />
            )}
          </Card.Content>
        </Card>

        <div className={`min-w-0 overflow-hidden transition-opacity duration-300 ease-out ${selected ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
          {selected ? (
            <Card className="h-full w-[280px]">
              <Card.Header>
                <div className="flex w-full min-w-0 items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon icon="lucide:badge-info" className="size-6 shrink-0 text-muted" />
                    <div className="min-w-0">
                      <Card.Title>节点详情</Card.Title>
                      <Card.Description>当前选中的拓扑对象</Card.Description>
                    </div>
                  </div>
                  <Button
                    isIconOnly
                    aria-label="关闭节点详情"
                    size="sm"
                    variant="ghost"
                    onPress={() => setSelected(null)}
                  >
                    <Icon icon="lucide:x" className="size-4" />
                  </Button>
                </div>
              </Card.Header>
              <Card.Content className="overflow-auto">
                <TopologyDetail
                  account={selectedAccount ?? null}
                  agent={selectedAgent ?? null}
                  channel={selectedChannel ?? null}
                  gateway={selected.kind === 'gateway' ? selected.value : null}
                  route={selectedRoute}
                  selection={selected}
                />
              </Card.Content>
            </Card>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function TopologyCanvas({
  gateway,
  onSelect,
  selected,
  topology,
}: {
  gateway: TopologyGateway
  onSelect: (selection: TopologySelection) => void
  selected: TopologySelection
  topology: ReturnType<typeof buildOpenClawTopology>
}) {
  const { edges, nodes: layoutedNodes } = useMemo(() => buildTopologyFlow(topology, gateway, selected), [gateway, selected, topology])
  const reactFlowColorMode = useThemeStore((state) => state.resolvedTheme)
  const [nodes, setNodes, onNodesChange] = useNodesState<TopologyFlowNode>(layoutedNodes)

  useEffect(() => {
    setNodes((previousNodes) => {
      const previousById = new Map(previousNodes.map((node) => [node.id, node]))
      const hasSameNodes = previousNodes.length === layoutedNodes.length && layoutedNodes.every((node) => previousById.has(node.id))

      return layoutedNodes.map((node) => {
        const previous = hasSameNodes ? previousById.get(node.id) : null
        return previous ? { ...node, position: previous.position } : node
      })
    })
  }, [layoutedNodes, setNodes])

  const selectNode = useCallback((_: unknown, node: TopologyFlowNode) => {
    if (node.data.kind === 'gateway') {
      onSelect({ id: 'gateway', kind: 'gateway', value: gateway })
      return
    }

    if (node.data.kind === 'account') {
      const account = topology.accounts.find((item) => item.id === node.data.id)
      if (account) onSelect({ id: account.id, kind: 'account', value: account })
      return
    }

    if (node.data.kind === 'channel') {
      const channel = topology.channels.find((item) => item.id === node.data.id)
      if (channel) onSelect({ id: channel.id, kind: 'channel', value: channel })
      return
    }

    const agent = topology.agents.find((item) => item.id === node.data.id)
    if (agent) onSelect({ id: agent.id, kind: 'agent', value: agent })
  }, [gateway, onSelect, topology.accounts, topology.agents, topology.channels])

  const selectEdge = useCallback((_: unknown, edge: TopologyFlowEdge) => {
    if (edge.data?.route) {
      onSelect({ id: edge.data.route.id, kind: 'route', value: edge.data.route })
    }
  }, [onSelect])

  return (
    <div className="relative h-[calc(100dvh-200px)] overflow-hidden rounded-2xl bg-surface-secondary/50">
      <ReactFlow
        colorMode={reactFlowColorMode}
        defaultEdgeOptions={{ type: 'default' }}
        edges={edges}
        fitView
        fitViewOptions={{ maxZoom: 1.05, padding: 0.18 }}
        minZoom={0.35}
        nodeTypes={topologyNodeTypes}
        nodes={nodes}
        nodesDraggable={true}
        onEdgeClick={selectEdge}
        onNodeClick={selectNode}
        onNodesChange={onNodesChange}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--border)" gap={24} size={1} variant={BackgroundVariant.Dots} />
        <Controls className="!border-border !bg-background/90 !shadow-sm" />
      </ReactFlow>
      <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-wrap items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-xs text-muted">
        <TopologyLegendDot className="bg-success" label="Gateway 输入" />
        <TopologyLegendDot className="bg-accent" label="绑定路由" />
        <TopologyLegendDot className="bg-muted" label="默认回退" />
        <TopologyLegendDot className="bg-warning" label="Agent 调用" />
      </div>
    </div>
  )
}

function TopologyFlowNodeCard({ data }: NodeProps<TopologyFlowNode>) {
  const toneStyles = {
    danger: {
      border: 'border-danger/45',
      dot: 'bg-danger',
      glow: 'from-danger/16',
      icon: 'bg-danger/10 text-danger ring-danger/15',
      pill: 'bg-danger/10 text-danger',
    },
    muted: {
      border: 'border-border',
      dot: 'bg-muted',
      glow: 'from-muted/12',
      icon: 'bg-surface-secondary text-muted ring-border',
      pill: 'bg-surface-secondary text-muted',
    },
    success: {
      border: 'border-success/45',
      dot: 'bg-success',
      glow: 'from-success/16',
      icon: 'bg-success/10 text-success ring-success/15',
      pill: 'bg-success/10 text-success',
    },
    warning: {
      border: 'border-warning/45',
      dot: 'bg-warning',
      glow: 'from-warning/18',
      icon: 'bg-warning/10 text-warning ring-warning/15',
      pill: 'bg-warning/10 text-warning',
    },
  }[data.tone]
  const kindLabel = {
    account: 'Account',
    agent: 'Agent',
    channel: 'Channel',
    gateway: 'Gateway',
  }[data.kind]

  return (
    <div
      className={`relative h-[88px] w-[226px] overflow-hidden rounded-xl border bg-background/95 text-left shadow-sm backdrop-blur transition ${data.isSelected ? 'border-accent ring-2 ring-accent/20' : `${toneStyles.border} hover:border-accent/50 hover:shadow-md`
        }`}
    >
      <span className={`pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b ${toneStyles.glow} to-transparent opacity-80`} />
      {data.kind !== 'gateway' ? <Handle className="!size-2.5 !border-2 !border-background !bg-accent" position={Position.Left} type="target" /> : null}
      {data.kind !== 'agent' ? <Handle className="!size-2.5 !border-2 !border-background !bg-success" position={Position.Right} type="source" /> : null}
      {data.kind === 'agent' ? <Handle className="!size-2.5 !border-2 !border-background !bg-warning" position={Position.Right} type="source" /> : null}
      <span className="relative flex h-full flex-col justify-between px-3.5 py-3">
        <span className="flex items-start gap-3">
          <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 ${toneStyles.icon}`}>
            <Icon icon={data.icon} className="size-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">{data.title}</span>
              <span className={`size-1.5 shrink-0 rounded-full ${toneStyles.dot}`} />
            </span>
            <span className="mt-1 block truncate text-xs text-muted">{data.meta || '-'}</span>
          </span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${toneStyles.pill}`}>{data.status}</span>
        </span>
        <span className="flex items-center justify-between gap-2 text-[10px] text-muted">
          <span>{kindLabel}</span>
          <Icon icon={data.isSelected ? 'lucide:mouse-pointer-click' : 'lucide:move'} className="size-3.5 opacity-70" />
        </span>
      </span>
    </div>
  )
}

function TopologyLegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-2 rounded-full ${className}`} />
      <span>{label}</span>
    </span>
  )
}

function buildTopologyFlow(
  topology: ReturnType<typeof buildOpenClawTopology>,
  gateway: TopologyGateway,
  selected: TopologySelection,
): { edges: TopologyFlowEdge[]; nodes: TopologyFlowNode[] } {
  const rawNodes: TopologyFlowNode[] = [
    {
      data: {
        icon: 'lucide:server-cog',
        id: 'gateway',
        isSelected: selected?.kind === 'gateway',
        kind: 'gateway',
        meta: `本地端口 ${gateway.port || '-'}`,
        status: gateway.ready ? '已就绪' : gateway.status === 'running' ? '运行中' : '离线',
        title: 'Gateway',
        tone: gateway.ready ? 'success' : gateway.status === 'offline' ? 'danger' : 'warning',
      },
      id: 'gateway',
      position: { x: 0, y: 0 },
      sourcePosition: Position.Right,
      type: 'topologyNode',
    },
  ]
  const rawEdges: TopologyFlowEdge[] = []
  const nodeIds = new Set(['gateway'])

  for (const channel of topology.channels) {
    const nodeId = topologyChannelNodeId(channel.id)
    nodeIds.add(nodeId)
    rawNodes.push({
      data: {
        icon: channel.icon,
        id: channel.id,
        isSelected: selected?.id === channel.id,
        kind: 'channel',
        meta: `${channel.type} · ${channel.configured ? '已配置' : '未配置'}`,
        status: channel.enabled ? '启用' : '停用',
        title: channel.label,
        tone: channel.enabled ? 'success' : 'muted',
      },
      id: nodeId,
      position: { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      type: 'topologyNode',
    })
    rawEdges.push({
      animated: true,
      id: `gateway-${channel.id}`,
      markerEnd: { color: channel.enabled ? '#22c55e' : '#94a3b8', type: MarkerType.ArrowClosed },
      source: 'gateway',
      style: { stroke: channel.enabled ? '#22c55e' : '#94a3b8', strokeDasharray: channel.enabled ? undefined : '6 4', strokeWidth: 1.8 },
      target: nodeId,
    })
  }

  for (const account of topology.accounts) {
    const nodeId = topologyAccountNodeId(account.channelId, account.accountId)
    const channelNodeId = topologyChannelNodeId(account.channelId)
    if (!nodeIds.has(channelNodeId)) continue

    nodeIds.add(nodeId)
    rawNodes.push({
      data: {
        icon: account.icon,
        id: account.id,
        isSelected: selected?.id === account.id,
        kind: 'account',
        meta: account.channelId,
        status: account.enabled ? '启用' : '停用',
        title: account.label,
        tone: account.enabled ? 'success' : 'warning',
      },
      id: nodeId,
      position: { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      type: 'topologyNode',
    })
    rawEdges.push({
      animated: account.enabled,
      id: `channel-${account.id}`,
      markerEnd: { color: account.enabled ? '#22c55e' : '#f59e0b', type: MarkerType.ArrowClosed },
      source: channelNodeId,
      style: { stroke: account.enabled ? '#22c55e' : '#f59e0b', strokeDasharray: account.enabled ? undefined : '6 4', strokeWidth: 1.8 },
      target: nodeId,
    })
  }

  for (const agent of topology.agents) {
    const nodeId = topologyAgentNodeId(agent.id)
    nodeIds.add(nodeId)
    rawNodes.push({
      data: {
        icon: agent.isDefault ? 'lucide:star' : 'lucide:bot',
        id: agent.id,
        isSelected: selected?.id === agent.id,
        kind: 'agent',
        meta: `${agent.isDefault ? '默认 Agent' : agent.runtime} · ${agent.sessionsReady ? '会话正常' : '会话缺失'}`,
        status: agent.ready ? '就绪' : agent.sessionsReady ? '部分就绪' : '未就绪',
        title: agent.label,
        tone: agent.ready ? 'success' : agent.sessionsReady ? 'warning' : 'danger',
      },
      id: nodeId,
      position: { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      type: 'topologyNode',
    })
  }

  for (const route of topology.routes) {
    const source = route.type === 'subagent'
      ? topologyAgentNodeId(route.channelId)
      : route.accountId
        ? topologyAccountNodeId(route.channelId, route.accountId)
        : topologyChannelNodeId(route.channelId)
    const target = topologyAgentNodeId(route.agentId)
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue

    const isSelected = selected?.id === route.id
    const routeAccount = route.accountId ? topology.accounts.find((account) => account.channelId === route.channelId && account.accountId === route.accountId) : null
    const isDisabledAccountRoute = routeAccount?.enabled === false
    const color = route.type === 'subagent' ? '#f59e0b' : isDisabledAccountRoute ? '#f59e0b' : route.fallback ? '#94a3b8' : '#6366f1'
    rawEdges.push({
      animated: true,
      data: { route },
      id: route.id,
      label: route.label,
      labelBgBorderRadius: 10,
      labelBgPadding: [7, 4],
      labelBgStyle: { fill: 'rgb(255 255 255 / 0.88)', stroke: isSelected ? '#6366f1' : '#e2e8f0' },
      labelStyle: { fill: isSelected ? '#4f46e5' : '#64748b', fontSize: 11, fontWeight: 600 },
      markerEnd: { color, height: 16, type: MarkerType.ArrowClosed, width: 16 },
      selected: isSelected,
      source,
      style: {
        stroke: color,
        strokeDasharray: route.type === 'subagent' || route.fallback || isDisabledAccountRoute ? '6 4' : undefined,
        strokeWidth: isSelected ? 3 : 2,
      },
      target,
      type: 'default',
    })
  }

  return { edges: rawEdges, nodes: layoutTopologyGraph(rawNodes, rawEdges) }
}

function layoutTopologyGraph(nodes: TopologyFlowNode[], edges: TopologyFlowEdge[]) {
  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ marginx: 48, marginy: 48, nodesep: 54, rankdir: 'LR', ranksep: 150 })

  for (const node of nodes) {
    graph.setNode(node.id, { height: TOPOLOGY_NODE_HEIGHT, width: TOPOLOGY_NODE_WIDTH })
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target)
  }
  dagre.layout(graph)

  return nodes.map((node) => {
    const position = graph.node(node.id)
    return {
      ...node,
      position: {
        x: position.x - TOPOLOGY_NODE_WIDTH / 2,
        y: position.y - TOPOLOGY_NODE_HEIGHT / 2,
      },
    }
  })
}

function topologyAccountNodeId(channelId: string, accountId: string) {
  return `account:${channelId}:${accountId}`
}

function topologyChannelNodeId(id: string) {
  return `channel:${id}`
}

function topologyAgentNodeId(id: string) {
  return `agent:${id}`
}

function TopologyDetail({
  account,
  agent,
  channel,
  gateway,
  route,
  selection,
}: {
  account: TopologyAccount | null
  agent: TopologyAgent | null
  channel: TopologyChannel | null
  gateway: TopologyGateway | null
  route: TopologyRoute | null
  selection: TopologySelection
}) {
  if (!selection) {
    return <div className="rounded-2xl bg-surface-secondary/50 p-5 text-sm text-muted">选择拓扑中的 Channel、Agent 或路由后会显示配置详情。</div>
  }

  if (selection.kind === 'gateway' && gateway) {
    return (
      <div className="grid gap-3">
        <SummaryTile label="Gateway" value={gateway.ready ? '已就绪' : gateway.status} tone={gateway.ready ? 'success' : 'warning'} />
        <SummaryTile label="URL" value={gateway.url || '-'} tone={gateway.ready ? 'success' : 'warning'} />
        <SummaryTile label="端口" value={String(gateway.port || '-')} tone="success" />
        <SummaryTile label="认证" value={gateway.authMode || '-'} tone={gateway.authMode === 'config_missing' ? 'danger' : 'success'} />
      </div>
    )
  }

  if (selection.kind === 'channel' && channel) {
    return (
      <div className="grid gap-3">
        <SummaryTile label="Channel" value={channel.label} tone={channel.enabled ? 'success' : 'warning'} />
        <SummaryTile label="ID" value={channel.id} tone={channel.configured ? 'success' : 'warning'} />
        <SummaryTile label="类型" value={channel.type} tone="success" />
        <SummaryTile label="状态" value={channel.enabled ? '启用' : '禁用'} tone={channel.enabled ? 'success' : 'warning'} />
      </div>
    )
  }

  if (selection.kind === 'account' && account) {
    return (
      <div className="grid gap-3">
        <SummaryTile label="Account" value={account.label} tone={account.enabled ? 'success' : 'warning'} />
        <SummaryTile label="账号 ID" value={account.accountId} tone={account.configured ? 'success' : 'warning'} />
        <SummaryTile label="Channel" value={channel?.label ?? account.channelId} tone={channel?.enabled === false ? 'warning' : 'success'} />
        <SummaryTile label="状态" value={account.enabled ? '启用' : '禁用'} tone={account.enabled ? 'success' : 'warning'} />
      </div>
    )
  }

  if (selection.kind === 'agent' && agent) {
    return (
      <div className="grid gap-3">
        <SummaryTile label="Agent" value={agent.label} tone={agent.ready ? 'success' : 'warning'} />
        <SummaryTile label="ID" value={agent.id} tone="success" />
        <SummaryTile label="Runtime" value={agent.runtime} tone={agent.runtime === 'configured' ? 'success' : 'warning'} />
        <SummaryTile label="Session Store" value={agent.sessionsReady ? '存在' : '缺失'} tone={agent.sessionsReady ? 'success' : 'danger'} />
        <SummaryTile label="Subagents" value={agent.subagents.length ? agent.subagents.join(', ') : '-'} tone={agent.subagents.length ? 'success' : 'warning'} />
      </div>
    )
  }

  if (selection.kind === 'route' && route) {
    return (
      <div className="grid gap-3">
        <SummaryTile label="Route" value={route.label} tone={route.fallback ? 'warning' : account?.enabled === false ? 'warning' : 'success'} />
        <SummaryTile label="类型" value={route.type} tone={route.fallback ? 'warning' : 'success'} />
        <SummaryTile label="Channel" value={channel?.label ?? route.channelId} tone={channel?.enabled === false ? 'warning' : 'success'} />
        {route.accountId ? <SummaryTile label="Account" value={account?.label ?? route.accountId} tone={account?.enabled === false ? 'warning' : 'success'} /> : null}
        <SummaryTile label="Agent" value={agent?.label ?? route.agentId} tone={agent?.ready === false ? 'warning' : 'success'} />
      </div>
    )
  }

  return <div className="rounded-2xl bg-surface-secondary/50 p-5 text-sm text-muted">无法解析选中项。</div>
}

function buildOpenClawTopology(agentsData: OpenClawAgentsResponse | null, configData: OpenClawConfigResponse | null) {
  const agents = (agentsData?.agents ?? []).map(mapTopologyAgent)
  const channels = buildTopologyChannels(configData, agentsData?.bindings ?? [])
  const accounts = buildTopologyAccounts(configData, agentsData?.bindings ?? [])
  const defaultAgent = agents.find((agent) => agent.isDefault) ?? agents[0]
  const boundChannels = new Set<string>()
  const routes: TopologyRoute[] = []

  for (const [index, binding] of (agentsData?.bindings ?? []).entries()) {
    if (!binding.channel || !binding.agentId) continue
    if (!agents.some((agent) => agent.id === binding.agentId)) continue
    boundChannels.add(binding.channel)
    routes.push({
      accountId: binding.accountId,
      agentId: binding.agentId,
      channelId: binding.channel,
      id: `binding-${index}`,
      label: binding.label || `binding ${index + 1}`,
      type: 'binding',
    })
  }

  if (defaultAgent) {
    for (const channel of channels) {
      if (!boundChannels.has(channel.id)) {
        routes.push({
          agentId: defaultAgent.id,
          channelId: channel.id,
          fallback: true,
          id: `fallback-${channel.id}`,
          label: 'fallback',
          type: 'fallback',
        })
      }
    }
  }

  for (const agent of agents) {
    for (const target of agent.subagents) {
      if (!agents.some((candidate) => candidate.id === target)) continue
      routes.push({
        agentId: target,
        channelId: agent.id,
        id: `subagent-${agent.id}-${target}`,
        label: 'subagent',
        type: 'subagent',
      })
    }
  }

  return { accounts, agents, channels, routes }
}

function buildTopologyChannels(configData: OpenClawConfigResponse | null, bindings: OpenClawAgentBinding[]) {
  const channelsMap = configObject(configData?.content?.channels)
  const channelIds = new Set([...Object.keys(channelsMap), ...bindings.map((binding) => binding.channel).filter(Boolean) as string[]])

  return Array.from(channelIds)
    .sort((a, b) => a.localeCompare(b))
    .map((id) => {
      const config = configObject(channelsMap[id])
      const configured = Object.keys(config).length > 0
      const display = getTopologyChannelDisplay(id)
      return {
        configured,
        enabled: isTopologyChannelEnabled(config),
        icon: display.icon,
        id,
        label: stringFromUnknown(config.label) || stringFromUnknown(config.name) || stringFromUnknown(config.botName) || display.label,
        type: display.label,
      }
    })
}

function buildTopologyAccounts(configData: OpenClawConfigResponse | null, bindings: OpenClawAgentBinding[]): TopologyAccount[] {
  const channelsMap = configObject(configData?.content?.channels)
  const accounts = new Map<string, TopologyAccount>()

  for (const [channelId, channelConfigValue] of Object.entries(channelsMap)) {
    const channelConfig = configObject(channelConfigValue)
    const channelAccounts = configObject(channelConfig.accounts)
    for (const [accountId, accountConfigValue] of Object.entries(channelAccounts)) {
      const accountConfig = configObject(accountConfigValue)
      const id = topologyAccountNodeId(channelId, accountId)
      const display = getTopologyChannelDisplay(channelId)
      accounts.set(id, {
        accountId,
        channelId,
        configured: Object.keys(accountConfig).length > 0,
        enabled: accountConfig.enabled === true,
        icon: display.icon,
        id,
        label: stringFromUnknown(accountConfig.name) || stringFromUnknown(accountConfig.label) || accountId,
      })
    }
  }

  for (const binding of bindings) {
    if (!binding.channel || !binding.accountId) continue
    const id = topologyAccountNodeId(binding.channel, binding.accountId)
    if (accounts.has(id)) continue
    accounts.set(id, {
      accountId: binding.accountId,
      channelId: binding.channel,
      configured: false,
      enabled: false,
      icon: getTopologyChannelDisplay(binding.channel).icon,
      id,
      label: binding.accountId,
    })
  }

  return Array.from(accounts.values()).sort((a, b) => `${a.channelId}/${a.accountId}`.localeCompare(`${b.channelId}/${b.accountId}`))
}

const topologyChannelDisplayMap: Record<string, { icon: string; label: string }> = {
  discord: { icon: 'simple-icons:discord', label: 'Discord' },
  'dingtalk-connector': { icon: 'ant-design:dingtalk-circle-filled', label: '钉钉' },
  feishu: { icon: 'icon-park-outline:lark', label: '飞书' },
  matrix: { icon: 'simple-icons:matrix', label: 'Matrix' },
  'openclaw-weixin': { icon: 'simple-icons:wechat', label: '微信' },
  qqbot: { icon: 'simple-icons:tencentqq', label: 'QQ' },
  telegram: { icon: 'simple-icons:telegram', label: 'Telegram' },
  twitch: { icon: 'simple-icons:twitch', label: 'Twitch' },
  wecom: { icon: 'ant-design:wechat-work-outlined', label: '企业微信' },
  whatsapp: { icon: 'simple-icons:whatsapp', label: 'WhatsApp' },
}

function getTopologyChannelDisplay(channelId: string) {
  return topologyChannelDisplayMap[channelId] ?? { icon: 'lucide:radio-tower', label: formatChannelName(channelId) }
}

function isTopologyChannelEnabled(config: Record<string, unknown>) {
  if (!Object.keys(config).length) return false
  if (config.enabled === false) return false
  if (config.enabled === true) return true

  const accounts = configObject(config.accounts)
  return Object.values(accounts).some((account) => configObject(account).enabled === true)
}

function mapTopologyAgent(agent: OpenClawAgentSummary): TopologyAgent {
  const subagents = readAgentSubagents(agent.config)
  return {
    id: agent.id,
    isDefault: agent.isDefault,
    label: agent.identity?.name || agent.name || agent.id,
    ready: Boolean(agent.workspaceExists && agent.agentDirExists && agent.sessionStoreExists),
    runtime: agent.runtime?.explicit ? 'configured' : agent.runtime?.type || 'default',
    sessionsReady: agent.sessionStoreExists,
    subagents,
  }
}

function readAgentSubagents(config?: Record<string, unknown>) {
  const subagents = configObject(config?.subagents)
  const allowAgents = stringListFromUnknown(subagents.allowAgents)
  if (allowAgents.length > 0) return allowAgents

  const tools = configObject(config?.tools)
  const agentToAgent = configObject(tools.agentToAgent)
  return stringListFromUnknown(agentToAgent.allow)
}

function configObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringFromUnknown(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function stringListFromUnknown(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(stringFromUnknown).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function formatChannelName(id: string) {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || id
}

function UsagePanel({
  error,
  isLoading,
  snapshot,
  usageRange,
}: {
  error: string
  isLoading: boolean
  snapshot: GatewayUsageSnapshot | null
  usageRange: UsageRange
}) {
  const daily = getDailyChartData(snapshot)
  const providerRows = getProviderRows(snapshot)
  const modelRows = getModelRows(snapshot)
  const toolRows = getToolRows(snapshot)
  const agentRows = getAgentRows(snapshot)
  const insights = getUsageInsights(snapshot)
  const stats = getUsageStats(snapshot)

  return (
    <div className="grid gap-4">
      {error ? <InlineWarning icon="lucide:triangle-alert" message={error} title="Gateway 用量加载失败" /> : null}
      <UsageInsightsGrid insights={insights} isLoading={isLoading} stats={stats} />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
        <UsageAreaCard daily={daily} isLoading={isLoading} usageRange={usageRange} />
        <UsageBreakdownCard insights={insights} totals={snapshot?.usage.totals} isLoading={isLoading} />
      </section>

      <UsageActivityCard isLoading={isLoading} snapshot={snapshot} />

      <section className="grid gap-4 xl:grid-cols-2">
        <ProviderUsageCard rows={providerRows} isLoading={isLoading} />
        <InsightListCard
          icon="lucide:brain-circuit"
          isLoading={isLoading}
          rows={modelRows}
          title="模型使用"
          emptyText="暂无模型用量"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <InsightListCard
          icon="lucide:wrench"
          isLoading={isLoading}
          rows={toolRows}
          title="工具使用"
          emptyText="暂无工具调用"
        />
        <InsightListCard
          icon="lucide:bot"
          isLoading={isLoading}
          rows={agentRows}
          title="Agent 使用"
          emptyText="暂无 Agent 用量"
        />
      </section>
    </div>
  )
}

function SessionsPanel({
  error,
  isLoading,
  sessionsResult,
  usageResult,
}: {
  error: string
  isLoading: boolean
  sessionsResult: OpenClawSessionsListResult | null
  usageResult: OpenClawSessionsUsageResult | null
}) {
  const sessions = sessionsResult?.sessions ?? []
  const usageByKey = new Map((usageResult?.sessions ?? []).map((session) => [session.key, session]))
  const defaultContextTokens = sessionsResult?.defaults?.contextTokens ?? null
  const totalSessionCount = sessionsResult?.totalCount ?? sessionsResult?.count ?? sessions.length
  const sessionCards = sessions.map((session) => {
    const usageSession = usageByKey.get(session.key)
    const usage = usageSession?.usage
    const messageCounts = usage?.messageCounts
    const toolUsage = usage?.toolUsage
    const tokens = usage?.totalTokens ?? session.totalTokens ?? 0
    const contextTokens = session.contextTokens ?? defaultContextTokens ?? null
    const percentUsed = resolveSessionPercentUsed(session.percentUsed, tokens, contextTokens)
    const remainingTokens = session.remainingTokens ?? (contextTokens != null ? Math.max(contextTokens - tokens, 0) : null)

    return {
      agentId: usageSession?.agentId || session.agentId || '-',
      barColor: getTokenBarColor(percentUsed),
      cost: usage?.totalCost ?? 0,
      contextTokens,
      durationMs: usage?.durationMs ?? session.runtimeMs ?? 0,
      flags: getSessionFlags(session, usageSession?.hasActiveRun),
      hasActiveRun: Boolean(session.hasActiveRun || usageSession?.hasActiveRun),
      id: session.key,
      label: formatSessionDisplayName(session.label || usageSession?.label || session.key),
      messages: messageCounts?.total ?? 0,
      model: formatModelRef(session.modelProvider || session.provider || usageSession?.modelProvider, session.model || usageSession?.model),
      percentUsed,
      remainingTokens,
      status: session.hasActiveRun || usageSession?.hasActiveRun ? 'running' : session.status || 'idle',
      tokens,
      tools: toolUsage?.totalCalls ?? messageCounts?.toolCalls ?? 0,
      updatedAt: usageSession?.updatedAt ?? session.updatedAt,
    }
  })
  const runningSessionCount = sessionCards.filter((session) => session.hasActiveRun).length

  return (
    <div className="grid gap-4">
      {error ? <InlineWarning icon="lucide:triangle-alert" message={error} title="Gateway 会话加载失败" /> : null}
      <Card className="relative">
        <div className="absolute right-4 top-4 z-10 flex flex-wrap justify-end gap-2">

          <Button variant="tertiary" size="sm">
            <Icon icon="lucide:circle-fill" className="size-3.5" />
            会话
            <Chip variant="primary">
              {isLoading ? '-' : formatCompactNumber(totalSessionCount)}
            </Chip>
          </Button>

          <Button variant="tertiary" size="sm">
            <Icon icon="lucide:circle-fill" className="size-3.5" />
            运行中
            <Chip variant="primary">
              {isLoading ? '-' : formatCompactNumber(runningSessionCount)}
            </Chip>
          </Button>
        </div>
        <Card.Header className="pr-48">
          <div className="flex min-w-0 items-center gap-2">
            <Icon icon="lucide:activity" className="size-6 shrink-0 text-muted" />
            <div className="min-w-0">
              <Card.Title>活跃会话</Card.Title>
              <Card.Description>显示全部会话，Token 用量按上下文窗口解析为进度条。</Card.Description>
            </div>
          </div>
        </Card.Header>
        <Card.Content>
          {isLoading ? (
            <OpenClawSkeleton />
          ) : sessions.length === 0 ? (
            <div className="rounded-2xl bg-surface-secondary/50 p-6 text-center text-sm text-muted">暂无会话</div>
          ) : (
            <div className="grid max-h-[680px] gap-3 overflow-auto">
              {sessionCards.map((item) => (
                <SessionUsageCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </Card.Content>
      </Card>
    </div>
  )
}

type SessionUsageItem = {
  agentId: string
  barColor: string
  contextTokens: number | null
  cost: number
  durationMs: number
  flags: string[]
  hasActiveRun: boolean
  id: string
  label: string
  messages: number
  model: string
  percentUsed: number
  remainingTokens: number | null
  status: string
  tokens: number
  tools: number
  updatedAt?: number
}

function SessionUsageCard({ item }: { item: SessionUsageItem }) {
  const contextLabel = item.contextTokens != null ? formatTokenAmount(item.contextTokens) : '-'
  const remainingLabel = item.remainingTokens != null ? formatTokenAmount(item.remainingTokens) : '-'

  return (
    <div className="rounded-2xl bg-surface-secondary/50 p-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-center gap-3">
            <span className={`flex size-9 shrink-0 items-center justify-center rounded-2xl ${item.hasActiveRun ? 'bg-success/10 text-success' : 'bg-surface text-muted'}`}>
              <Icon icon="lucide:messages-square" className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground" title={item.id}>{item.label || '-'}</span>
                {item.model !== '-' ? (
                  <Chip size="sm" variant="soft">
                    {item.model}
                  </Chip>
                ) : null}
                {item.flags.map((flag) => (
                  <Chip key={flag} size="sm" variant="soft" color={flag === '运行中' ? 'success' : 'default'}>
                    {flag}
                  </Chip>
                ))}
              </div>
              <div className="mt-1 truncate text-xs text-muted" title={item.id}>{item.id}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>Agent {item.agentId}</span>
            <span>{formatCompactNumber(item.messages)} 消息</span>
            <span>{formatCompactNumber(item.tools)} 工具</span>
            <span>{formatCurrency(item.cost)}</span>
          </div>
        </div>

        <div className="grid gap-2">
          <div className="h-2.5 overflow-hidden rounded-full bg-background-tertiary">
            <div
              className="h-full rounded-full"
              style={{ backgroundColor: item.barColor, width: `${Math.min(item.percentUsed, 100)}%` }}
            />
          </div>
          <div className="flex flex-col gap-1 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
            <span className="tabular-nums">
              {formatTokenAmount(item.tokens)} / {contextLabel} · 剩余 {remainingLabel} · {item.percentUsed}%
            </span>
            <span className="tabular-nums">
              {formatDurationCompact(item.durationMs)} · {formatTimeFromMs(item.updatedAt)}
            </span>
          </div>
        </div>
      </div>
    </div>
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
  tone: 'success' | 'warning'
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
    success: 'bg-success',
    warning: 'bg-warning',
  }[tone]
  const content = (
    <Card.Content>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className={`size-2 rounded-full ${toneClass}`} />
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

function SummaryTile({ label, value, tone }: { label: string; value: string; tone: 'success' | 'warning' | 'danger' }) {
  const failedCount = (() => {
    if (label !== '检查') return null

    const match = value.match(/^(\d+)\/(\d+)$/)
    if (!match) return null

    const passed = Number(match[1])
    const total = Number(match[2])
    if (!Number.isFinite(passed) || !Number.isFinite(total)) return null

    return Math.max(total - passed, 0)
  })()
  const isOk = tone === 'success'
  const statusText = isOk ? (label === '检查' ? '全部通过' : value || '有效') : failedCount !== null ? `${failedCount} 项异常` : value || '异常'
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

function InlineWarning({ icon, message, title }: { icon: string; message: string; title: string }) {
  return (
    <Card>
      <Card.Content>
        <div className="flex items-start gap-3 text-warning">
          <Icon icon={icon} className="mt-0.5 size-5" />
          <div>
            <p className="font-medium">{title}</p>
            <p className="mt-1 text-sm text-muted">{message}</p>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function UsageInsightsGrid({
  insights,
  isLoading,
  stats,
}: {
  insights: UsageInsights
  isLoading: boolean
  stats: ReturnType<typeof getUsageStats>
}) {
  const cards = [
    {
      description: stats.tokenDescription,
      icon: 'lucide:coins',
      title: 'Token 消耗',
      tone: stats.totalTokens === '0' ? 'warning' as const : 'success' as const,
      value: stats.totalTokens,
    },
    {
      description: stats.costDescription,
      icon: 'lucide:circle-dollar-sign',
      title: 'API 费用',
      tone: stats.totalCost === '$0.00' ? 'warning' as const : 'success' as const,
      value: stats.totalCost,
    },
    {
      description: `${formatCurrency(insights.throughputCostPerMinute, 4)} / 分钟`,
      icon: 'lucide:gauge',
      title: '吞吐量',
      tone: 'success' as const,
      value: insights.throughputTokensPerMinute === null ? '-' : `${formatTokenAmount(insights.throughputTokensPerMinute)} tok/min`,
    },
    {
      description: `共 ${formatCompactNumber(insights.messages.total)} 条消息`,
      icon: 'lucide:coins',
      title: '平均 Token / 消息',
      tone: 'success' as const,
      value: formatTokenAmount(insights.avgTokensPerMessage),
    },
    {
      description: `${formatTokenAmount(insights.cacheRead)} 已缓存 · ${formatTokenAmount(insights.cacheBase)} 提示`,
      icon: 'lucide:database-zap',
      title: '缓存命中率',
      tone: insights.cacheHitRate >= 0.6 ? 'success' as const : 'warning' as const,
      value: formatPercent(insights.cacheHitRate, 1),
    },
    {
      description: `${formatCompactNumber(insights.messages.errors)} 错误 · ${formatDurationCompact(insights.avgDurationMs)} 平均会话`,
      icon: 'lucide:bug',
      title: '错误率',
      tone: insights.errorRate > 0.01 ? 'warning' as const : 'success' as const,
      value: formatPercent(insights.errorRate, 2),
    },
    {
      description: `范围内共 ${formatCompactNumber(insights.totalSessions)} 个`,
      icon: 'lucide:files',
      title: '会话',
      tone: insights.sessionCount > 0 ? 'success' as const : 'warning' as const,
      value: formatCompactNumber(insights.sessionCount),
    },
    {
      description: `${formatCompactNumber(insights.tools.uniqueTools)} 个工具`,
      icon: 'lucide:wrench',
      title: '工具调用',
      tone: insights.tools.totalCalls > 0 ? 'success' as const : 'warning' as const,
      value: formatCompactNumber(insights.tools.totalCalls),
    },
  ]

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <MetricCard key={card.title} {...card} isLoading={isLoading} />
      ))}
    </section>
  )
}

function MetricCard({
  description,
  icon,
  isLoading,
  title,
  tone,
  value,
}: {
  description: string
  icon: string
  isLoading: boolean
  title: string
  tone: 'success' | 'warning'
  value: string
}) {
  return (
    <Card>
      <Card.Content>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-sm text-muted">
              <Icon icon={icon} className="size-4 shrink-0" />
              <span className="truncate">{title}</span>
            </div>
            <span className={`size-2.5 shrink-0 rounded-full ${tone === 'success' ? 'bg-success' : 'bg-warning'}`} />
          </div>
          <div className="truncate text-3xl font-semibold tabular-nums text-foreground">
            {isLoading ? <Skeleton className="h-9 w-28 rounded-lg" /> : value}
          </div>
          <div className="truncate text-sm text-muted">{description}</div>
        </div>
      </Card.Content>
    </Card>
  )
}

function UsageAreaCard({
  daily,
  isLoading,
  usageRange,
}: {
  daily: Array<{ cost: number; date: string; label: string; tokens: number }>
  isLoading: boolean
  usageRange: UsageRange
}) {
  const rangeLabel = usageRangeOptions.find((option) => option.value === usageRange)?.label ?? '1D'

  return (
    <Card>
      <Card.Header>
        <div className="flex min-w-0 items-center gap-2">
          <Icon icon="lucide:chart-area" className="size-6 shrink-0 text-muted" />
          <div className="min-w-0">
            <Card.Title>每日用量</Card.Title>
            <Card.Description>{rangeLabel} Token 与费用走势。</Card.Description>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        {isLoading ? (
          <Skeleton className="h-60 rounded-2xl" />
        ) : daily.length === 0 ? (
          <div className="flex h-60 items-center justify-center rounded-2xl bg-surface-secondary/50 text-sm text-muted">暂无用量数据</div>
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <LegendDot color="var(--success)" label="Token" value={formatTokenAmount(daily.reduce((sum, item) => sum + item.tokens, 0))} />
              <LegendDot color="var(--warning)" label="费用" value={formatCurrency(daily.reduce((sum, item) => sum + item.cost, 0))} />
            </div>
            <ComposedChart data={daily} height={300} margin={{ bottom: 0, left: 0, right: 0, top: 8 }}>
              <ComposedChart.Grid stroke="var(--border)" strokeDasharray="3 3" />
              <ComposedChart.XAxis dataKey="label" hide />
              <ComposedChart.YAxis hide yAxisId="tokens" />
              <ComposedChart.YAxis hide yAxisId="cost" orientation="right" />
              <ComposedChart.Area dataKey="tokens" type="monotone" stroke="var(--success)" fill="var(--success)" fillOpacity={0.14} strokeWidth={2} dot={false} name="Token" yAxisId="tokens" />
              <ComposedChart.Line dataKey="cost" type="monotone" stroke="var(--warning)" strokeWidth={2} dot={false} name="费用" yAxisId="cost" />
              <ComposedChart.Tooltip content={<DailyUsageTooltip />} />
            </ComposedChart>
          </div>
        )}
      </Card.Content>
    </Card>
  )
}

function DailyUsageTooltip({
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
        {payload.map((item) => {
          const key = String(item.dataKey)
          const value = Number(item.value ?? 0)
          return (
            <div key={key} className="flex items-center justify-between gap-6">
              <span className="flex items-center gap-2 text-muted">
                <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
                {item.name || key}
              </span>
              <span className="font-medium tabular-nums text-foreground">{key === 'cost' ? formatCurrency(value) : formatTokenAmount(value)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function UsageBreakdownCard({
  insights,
  isLoading,
  totals,
}: {
  insights: UsageInsights
  isLoading: boolean
  totals?: OpenClawCostUsageTotals
}) {
  const tokenRows = [
    { label: '输入', value: totals?.input ?? 0, color: 'var(--success)' },
    { label: '输出', value: totals?.output ?? 0, color: 'var(--warning)' },
    { label: '缓存读取', value: totals?.cacheRead ?? 0, color: 'var(--accent)' },
    { label: '缓存写入', value: totals?.cacheWrite ?? 0, color: 'var(--danger)' },
  ]
  const messageRows = [
    { label: '用户', value: insights.messages.user, color: 'var(--success)' },
    { label: '助手', value: insights.messages.assistant, color: 'var(--warning)' },
  ]
  const tokenData = tokenRows.some((row) => row.value > 0) ? tokenRows : [{ label: '暂无数据', value: 1, color: 'var(--surface-secondary)' }]
  const messageData = messageRows.some((row) => row.value > 0) ? messageRows : [{ label: '暂无数据', value: 1, color: 'var(--surface-secondary)' }]
  const tokenTotal = tokenRows.reduce((sum, row) => sum + row.value, 0)
  const messageTotal = messageRows.reduce((sum, row) => sum + row.value, 0)

  return (
    <Card>
      <Card.Content>
        {isLoading ? (
          <Skeleton className="h-60 rounded-2xl justify-center" />
        ) : (
          <div className="flex flex-col gap-2 justify-center my-auto">
            <BreakdownDonut
              centerLabel="Token"
              centerValue={formatTokenAmount(tokenTotal)}
              legendLabel="Token 构成"
              rows={tokenData}
              valueFormatter={formatTokenAmount}
            />
            <BreakdownDonut
              centerLabel="消息"
              centerValue={formatCompactNumber(messageTotal)}
              legendLabel="消息构成"
              rows={messageData}
              valueFormatter={formatCompactNumber}
            />
          </div>
        )}
      </Card.Content>
    </Card>
  )
}

function UsageActivityCard({ isLoading, snapshot }: { isLoading: boolean; snapshot: GatewayUsageSnapshot | null }) {
  const stats = buildUsageMosaicStats(snapshot)
  const maxHour = Math.max(...stats.hourTotals, 1)

  return (
    <Card>
      <Card.Header>
        <div className="flex min-w-0 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <Icon icon="lucide:clock-3" className="size-6 shrink-0 text-muted" />
            <div className="min-w-0">
              <Card.Title>按时间查看活动</Card.Title>
              <Card.Description>按本地时区统计 Token 活动分布。</Card.Description>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-lg font-semibold tabular-nums text-foreground">{formatTokenAmount(stats.totalTokens)}</div>
            <div className="text-xs text-muted">tokens</div>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        {isLoading ? (
          <Skeleton className="h-60 rounded-2xl" />
        ) : !stats.hasData ? (
          <div className="flex h-44 items-center justify-center rounded-2xl bg-surface-secondary/50 text-sm text-muted">暂无时间线数据</div>
        ) : (
          <div className="grid gap-5">
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-foreground">小时</div>
                <div className="text-xs text-muted">0 → 23</div>
              </div>
              <div className="grid grid-cols-12 gap-2 md:grid-cols-[repeat(24,minmax(0,1fr))]">
                {stats.hourTotals.map((value, hour) => (
                  <div
                    key={hour}
                    className="h-9 rounded-xl border"
                    style={{
                      background: getUsageHeatBackground(value, maxHour, 8, 70),
                      borderColor: getUsageHeatBorder(value, maxHour),
                    }}
                    title={`${hour}:00 · ${formatTokenAmount(value)} tokens`}
                  />
                ))}
              </div>
              <div className="grid grid-cols-6 gap-2 text-xs text-muted">
                <span>0:00</span>
                <span>4:00</span>
                <span>8:00</span>
                <span>12:00</span>
                <span>16:00</span>
                <span>20:00</span>
              </div>
            </div>
          </div>
        )}
      </Card.Content>
    </Card>
  )
}

function BreakdownDonut({
  centerLabel,
  centerValue,
  legendLabel,
  rows,
  valueFormatter,
}: {
  centerLabel: string
  centerValue: string
  legendLabel: string
  rows: Array<{ label: string; value: number; color: string }>
  valueFormatter: (value: number) => string
}) {
  return (
    <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)] md:items-center">
      <div className="relative mx-auto size-44">
        <PieChart height={176} width={176}>
          <PieChart.Pie data={rows} dataKey="value" innerRadius="62%" nameKey="label" strokeWidth={0}>
            {rows.map((item) => (
              <PieChart.Cell key={item.label} fill={item.color} />
            ))}
          </PieChart.Pie>
          <PieChart.Tooltip content={<PieChart.TooltipContent valueFormatter={(value) => valueFormatter(Number(value))} />} />
        </PieChart>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums text-foreground">{centerValue}</span>
          <span className="text-xs text-muted">{centerLabel}</span>
        </div>
      </div>
      <div className="grid gap-2">
        <div className="text-xs text-muted">{legendLabel}</div>
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 rounded-2xl bg-surface-secondary/50 px-3 py-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
              <span className="truncate text-sm text-muted">{row.label}</span>
            </span>
            <span className="text-sm font-medium tabular-nums text-foreground">{valueFormatter(row.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function InsightListCard({
  emptyText,
  icon,
  isLoading,
  rows,
  title,
}: {
  emptyText: string
  icon: string
  isLoading: boolean
  rows: Array<{ label: string; meta?: string; value: string }>
  title: string
}) {
  return (
    <Card>
      <Card.Header>
        <div className="flex min-w-0 items-center gap-2">
          <Icon icon={icon} className="size-5 shrink-0 text-muted" />
          <Card.Title>{title}</Card.Title>
        </div>
      </Card.Header>
      <Card.Content>
        {isLoading ? (
          <Skeleton className="h-56 rounded-2xl" />
        ) : rows.length === 0 ? (
          <div className="rounded-2xl bg-surface-secondary/50 p-6 text-center text-sm text-muted">{emptyText}</div>
        ) : (
          <div className="grid gap-2">
            {rows.slice(0, 6).map((row) => (
              <div key={`${row.label}-${row.value}`} className="flex items-center justify-between gap-3 rounded-2xl bg-surface-secondary/50 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{row.label}</div>
                  {row.meta ? <div className="mt-0.5 truncate text-xs text-muted">{row.meta}</div> : null}
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">{row.value}</span>
              </div>
            ))}
          </div>
        )}
      </Card.Content>
    </Card>
  )
}

function LegendDot({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-surface-secondary/50 px-3 py-1">
      <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
      <span>{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </span>
  )
}

function ProviderUsageCard({ isLoading, rows }: { isLoading: boolean; rows: Array<{ cost: number; name: string; tokens: number }> }) {
  return (
    <Card>
      <Card.Header>
        <Card.Title>Provider 使用</Card.Title>
      </Card.Header>
      <Card.Content>
        {isLoading ? (
          <Skeleton className="h-56 rounded-2xl" />
        ) : rows.length === 0 ? (
          <div className="rounded-2xl bg-surface-secondary/50 p-6 text-center text-sm text-muted">暂无 Provider 用量</div>
        ) : (
          <div className="grid gap-2">
            {rows.map((row) => (
              <div key={row.name} className="grid gap-2 rounded-2xl bg-surface-secondary/50 p-3 sm:grid-cols-[minmax(0,1fr)_120px_120px] sm:items-center">
                <span className="truncate font-medium text-foreground">{row.name}</span>
                <span className="text-sm tabular-nums text-muted">{formatTokenAmount(row.tokens)} tokens</span>
                <span className="text-sm font-medium tabular-nums text-foreground">{formatCurrency(row.cost)}</span>
              </div>
            ))}
          </div>
        )}
      </Card.Content>
    </Card>
  )
}

type UsageInsights = {
  avgDurationMs: number
  avgTokensPerMessage: number
  cacheBase: number
  cacheHitRate: number
  cacheRead: number
  errorRate: number
  messages: {
    assistant: number
    errors: number
    total: number
    user: number
  }
  sessionCount: number
  throughputCostPerMinute: number
  throughputTokensPerMinute: number | null
  tools: {
    totalCalls: number
    uniqueTools: number
  }
  totalSessions: number
}

function getUsageInsights(data: GatewayUsageSnapshot | null): UsageInsights {
  const totals = data?.usage.totals
  const messages = data?.usage.aggregates.messages
  const totalMessages = messages?.total ?? 0
  const sessions = data?.usage.sessions ?? []
  const listedSessions = data?.sessions.sessions ?? []
  const sessionCount = sessions.length || listedSessions.length
  const totalSessions = data?.sessions.totalCount ?? data?.sessions.count ?? sessionCount
  const durationMs = getUsageDurationMs(data)
  const minutes = durationMs > 0 ? durationMs / 60_000 : 0
  const totalTokens = totals?.totalTokens ?? 0
  const totalCost = totals?.totalCost ?? data?.cost.totals.totalCost ?? 0
  const cacheRead = totals?.cacheRead ?? 0
  const cacheBase = (totals?.input ?? 0) + cacheRead + (totals?.cacheWrite ?? 0)
  const tools = data?.usage.aggregates.tools

  return {
    avgDurationMs: getAverageDurationMs(data, durationMs, sessionCount),
    avgTokensPerMessage: totalMessages > 0 ? totalTokens / totalMessages : 0,
    cacheBase,
    cacheHitRate: cacheBase > 0 ? cacheRead / cacheBase : 0,
    cacheRead,
    errorRate: totalMessages > 0 ? (messages?.errors ?? 0) / totalMessages : 0,
    messages: {
      assistant: messages?.assistant ?? 0,
      errors: messages?.errors ?? 0,
      total: totalMessages,
      user: messages?.user ?? 0,
    },
    sessionCount,
    throughputCostPerMinute: minutes > 0 ? totalCost / minutes : 0,
    throughputTokensPerMinute: minutes > 0 ? totalTokens / minutes : null,
    tools: {
      totalCalls: tools?.totalCalls ?? messages?.toolCalls ?? 0,
      uniqueTools: tools?.uniqueTools ?? tools?.tools?.length ?? 0,
    },
    totalSessions,
  }
}

function getUsageDurationMs(data: GatewayUsageSnapshot | null) {
  const usageSessions = data?.usage.sessions ?? []
  const usageDuration = usageSessions.reduce((sum, session) => {
    const usage = session.usage
    if (usage?.durationMs && usage.durationMs > 0) return sum + usage.durationMs
    if (usage?.firstActivity && usage?.lastActivity) return sum + Math.max(usage.lastActivity - usage.firstActivity, 0)
    return sum
  }, 0)

  if (usageDuration > 0) return usageDuration

  return (data?.sessions.sessions ?? []).reduce((sum, session) => sum + Math.max(session.runtimeMs ?? 0, 0), 0)
}

function getAverageDurationMs(data: GatewayUsageSnapshot | null, totalDurationMs: number, sessionCount: number) {
  const latency = data?.usage.aggregates.latency
  if (latency?.count && latency.avgMs >= 0) return latency.avgMs
  return sessionCount > 0 ? totalDurationMs / sessionCount : 0
}

function getUsageStats(data: GatewayUsageSnapshot | null) {
  const sessions = data?.sessions.sessions ?? []
  const usageTotals = data?.usage.totals
  const costTotals = data?.cost.totals
  const runningSessions = sessions.filter((session) => session.hasActiveRun).length
  const modelUsage = data?.usage.aggregates.byModel ?? []
  const topModel = modelUsage
    .slice()
    .sort((a, b) => b.totals.totalTokens - a.totals.totalTokens)[0]
  const topModelName = [topModel?.provider, topModel?.model].filter(Boolean).join('/')
  const input = usageTotals?.input ?? 0
  const output = usageTotals?.output ?? 0
  const cacheRead = usageTotals?.cacheRead ?? 0
  const cacheStatus = data?.cost.cacheStatus?.status

  return {
    activeDescription: `${runningSessions} 个运行中 · 近 60 分钟`,
    activeSessions: formatCompactNumber(sessions.length),
    costDescription: cacheStatus ? `近 30 天 · 缓存 ${cacheStatus}` : '近 30 天',
    modelCount: formatCompactNumber(modelUsage.length),
    modelDescription: topModelName ? `最高：${topModelName}` : '近 30 天无模型调用',
    tokenDescription: `输入 ${formatTokenAmount(input)} · 输出 ${formatTokenAmount(output)} · 缓存 ${formatTokenAmount(cacheRead)}`,
    totalCost: formatCurrency(costTotals?.totalCost ?? usageTotals?.totalCost ?? 0),
    totalTokens: formatTokenAmount(usageTotals?.totalTokens ?? 0),
  }
}

function getDailyChartData(data: GatewayUsageSnapshot | null) {
  return (data?.cost.daily ?? data?.usage.aggregates.daily ?? []).map((entry) => ({
    cost: readNumberField(entry, 'totalCost') ?? readNumberField(entry, 'cost') ?? 0,
    date: entry.date,
    label: entry.date.slice(5),
    tokens: readNumberField(entry, 'totalTokens') ?? readNumberField(entry, 'tokens') ?? 0,
  }))
}

function getProviderRows(data: GatewayUsageSnapshot | null) {
  return (data?.usage.aggregates.byProvider ?? [])
    .slice()
    .sort((a, b) => b.totals.totalTokens - a.totals.totalTokens)
    .map((entry) => ({
      cost: entry.totals.totalCost,
      name: entry.provider || 'unknown',
      tokens: entry.totals.totalTokens,
    }))
}

type UsageMosaicStats = {
  hasData: boolean
  hourTotals: number[]
  totalTokens: number
  weekdayTotals: Array<{ label: string; tokens: number }>
}

function buildUsageMosaicStats(data: GatewayUsageSnapshot | null): UsageMosaicStats {
  const hourTotals = Array.from({ length: 24 }, () => 0)
  const weekdayTotals = Array.from({ length: 7 }, () => 0)
  let totalTokens = 0
  let hasData = false

  for (const session of data?.usage.sessions ?? []) {
    const usage = session.usage
    if (!usage || !usage.totalTokens || usage.totalTokens <= 0) continue

    totalTokens += usage.totalTokens

    const hasPreciseBuckets = forEachSessionTokenUsageBucket(session, ({ hour, weekday, tokens }) => {
      hourTotals[hour] += tokens
      weekdayTotals[weekday] += tokens
    })

    if (hasPreciseBuckets) {
      hasData = true
      continue
    }

    const hasSessionSpan = forEachSessionHourSlice(session, ({ usage: sessionUsage, hour, weekday, share }) => {
      const tokens = sessionUsage.totalTokens * share
      hourTotals[hour] += tokens
      weekdayTotals[weekday] += tokens
    })

    if (hasSessionSpan) hasData = true
  }

  const labels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const displayOrder = [1, 2, 3, 4, 5, 6, 0]

  return {
    hasData,
    hourTotals,
    totalTokens,
    weekdayTotals: displayOrder.map((index) => ({ label: labels[index], tokens: weekdayTotals[index] })),
  }
}

function forEachSessionTokenUsageBucket(
  session: OpenClawSessionsUsageResult['sessions'][number],
  visitor: (params: { hour: number; weekday: number; tokens: number }) => void,
) {
  const buckets = session.usage?.utcQuarterHourTokenUsage
  if (!buckets?.length) return false

  let visited = false
  for (const bucket of buckets) {
    if (bucket.totalTokens <= 0) continue

    const mapped = getHourAndWeekdayForUtcQuarterBucket(bucket.date, bucket.quarterIndex)
    if (!mapped) continue

    visited = true
    visitor({ hour: mapped.hour, weekday: mapped.weekday, tokens: bucket.totalTokens })
  }

  return visited
}

function forEachSessionHourSlice(
  session: OpenClawSessionsUsageResult['sessions'][number],
  visitor: (params: {
    usage: NonNullable<OpenClawSessionsUsageResult['sessions'][number]['usage']>
    hour: number
    weekday: number
    share: number
  }) => void,
) {
  const usage = session.usage
  if (!usage) return false

  const start = usage.firstActivity ?? session.updatedAt
  const end = usage.lastActivity ?? session.updatedAt
  if (!start || !end) return false

  const startMs = Math.min(start, end)
  const endMs = Math.max(start, end)
  const durationMs = Math.max(endMs - startMs, 1)
  let cursor = startMs

  while (cursor < endMs) {
    const date = new Date(cursor)
    const nextHour = setToHourEnd(date)
    const nextMs = Math.min(nextHour.getTime(), endMs)
    const share = Math.max(nextMs - cursor, 0) / durationMs

    visitor({
      usage,
      hour: date.getHours(),
      weekday: date.getDay(),
      share,
    })

    cursor = nextMs + 1
  }

  return true
}

function getHourAndWeekdayForUtcQuarterBucket(dateStr: string, quarterIndex: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!match || !Number.isInteger(quarterIndex) || quarterIndex < 0 || quarterIndex > 95) return null

  const [, year, month, day] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 0, quarterIndex * 15))
  if (Number.isNaN(date.valueOf())) return null

  return {
    hour: date.getHours(),
    weekday: date.getDay(),
  }
}

function setToHourEnd(date: Date) {
  const next = new Date(date)
  next.setMinutes(59, 59, 999)
  return next
}

function getUsageHeatBackground(value: number, max: number, minMix: number, maxMix: number) {
  if (value <= 0 || max <= 0) return 'transparent'
  const intensity = Math.min(value / max, 1)
  return `color-mix(in srgb, var(--accent) ${(minMix + intensity * maxMix).toFixed(1)}%, transparent)`
}

function getUsageHeatBorder(value: number, max: number) {
  if (value <= 0 || max <= 0) return 'var(--border)'
  const intensity = Math.min(value / max, 1)
  return intensity > 0.7
    ? 'color-mix(in srgb, var(--accent) 60%, transparent)'
    : 'color-mix(in srgb, var(--accent) 24%, transparent)'
}

function resolveSessionPercentUsed(percentUsed: number | undefined, tokens: number, contextTokens: number | null) {
  if (typeof percentUsed === 'number' && Number.isFinite(percentUsed)) {
    return Math.max(0, Math.min(100, Math.round(percentUsed)))
  }

  if (!contextTokens || contextTokens <= 0) {
    return 0
  }

  return Math.max(0, Math.min(100, Math.round((tokens / contextTokens) * 100)))
}

function getTokenBarColor(percentUsed: number) {
  if (percentUsed > 80) return 'var(--danger)'
  if (percentUsed > 50) return 'var(--warning)'
  return 'var(--success)'
}

function getSessionFlags(
  session: OpenClawSessionsListResult['sessions'][number],
  usageHasActiveRun?: boolean,
) {
  const flags: string[] = []
  if (session.hasActiveRun || usageHasActiveRun) flags.push('运行中')
  if (session.status && session.status !== 'done') flags.push(session.status)
  if (session.kind && session.kind !== 'direct') flags.push(session.kind)
  if (session.chatType && session.chatType !== session.kind) flags.push(session.chatType)

  return Array.from(new Set(flags)).slice(0, 3)
}

function formatSessionDisplayName(value: string) {
  const tokenIndex = value.indexOf('?token=')
  const withoutToken = tokenIndex >= 0 ? value.slice(0, tokenIndex) : value

  return withoutToken.replace(/^agent:main:/, '') || withoutToken || '-'
}

function getModelRows(data: GatewayUsageSnapshot | null) {
  return (data?.usage.aggregates.byModel ?? [])
    .slice()
    .sort((a, b) => b.totals.totalTokens - a.totals.totalTokens)
    .slice(0, 6)
    .map((entry) => ({
      label: formatModelRef(entry.provider, entry.model),
      meta: `${formatTokenAmount(entry.totals.totalTokens)} tokens · ${formatCompactNumber(entry.count)} 消息`,
      value: formatCurrency(entry.totals.totalCost),
    }))
}

function getToolRows(data: GatewayUsageSnapshot | null) {
  return (data?.usage.aggregates.tools?.tools ?? [])
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((entry) => ({
      label: entry.name,
      meta: '调用次数',
      value: formatCompactNumber(entry.count),
    }))
}

function getAgentRows(data: GatewayUsageSnapshot | null) {
  return (data?.usage.aggregates.byAgent ?? [])
    .slice()
    .sort((a, b) => b.totals.totalTokens - a.totals.totalTokens)
    .slice(0, 6)
    .map((entry) => ({
      label: entry.agentId || 'unknown',
      meta: `${formatTokenAmount(entry.totals.totalTokens)} tokens${entry.count ? ` · ${formatCompactNumber(entry.count)} 消息` : ''}`,
      value: formatCurrency(entry.totals.totalCost),
    }))
}

function readNumberField(value: unknown, key: string) {
  const record = objectRecord(value)
  const field = record[key]

  return typeof field === 'number' && Number.isFinite(field) ? field : undefined
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function getGatewayToken(content?: Record<string, unknown>) {
  const gateway = objectRecord(objectRecord(content).gateway)
  const auth = objectRecord(gateway.auth)
  const token = auth.token

  return typeof token === 'string' && token.trim() ? token.trim() : ''
}

function getGatewayConsoleUrl(environment: OpenClawEnvironmentResponse | null, config?: OpenClawConfigResponse | null) {
  if (!environment) {
    return ''
  }

  const token = getGatewayToken(config?.content)
  if (!token) {
    return ''
  }

  const baseURL = environment.gateway.publicUrl || ''
  if (baseURL) {
    return appendGatewayToken(baseURL, token)
  }

  const port = environment.gateway.port || readNumberField(config?.content?.gateway, 'port') || 18789

  return appendGatewayToken(`http://127.0.0.1:${port}/`, token)
}

function appendGatewayToken(baseURL: string, token: string) {
  try {
    const url = new URL(baseURL)
    url.searchParams.set('token', token)
    return url.toString()
  } catch {
    const separator = baseURL.includes('?') ? '&' : '?'
    return `${baseURL}${separator}token=${encodeURIComponent(token)}`
  }
}

async function requestSessionsList(client: OpenClawGatewayClient) {
  try {
    return await client.sessionsList({ limit: 200 })
  } catch (err) {
    if (isUnsupportedGatewayParamError(err)) {
      return await client.sessionsList({ limit: 200 })
    }
    throw err
  }
}

async function requestSessionsUsage(client: OpenClawGatewayClient, usageRange: UsageRange) {
  const range = getLastNDaysDateRange(getUsageRangeDays(usageRange))

  try {
    return await client.sessionsUsage({
      groupBy: 'family',
      includeContextWeight: true,
      includeHistorical: true,
      limit: 200,
      range: usageRange,
    })
  } catch (err) {
    if (isUnsupportedGatewayParamError(err)) {
      return await client.sessionsUsage({
        endDate: range.endDate,
        includeContextWeight: true,
        limit: 200,
        startDate: range.startDate,
      })
    }
    throw err
  }
}

async function requestUsageCost(client: OpenClawGatewayClient, usageRange: UsageRange) {
  try {
    return await client.usageCost({
      mode: 'specific',
      range: usageRange,
      utcOffset: formatUtcOffset(new Date().getTimezoneOffset()),
    })
  } catch (err) {
    if (isUnsupportedGatewayParamError(err)) {
      return await client.usageCost({ days: getUsageRangeDays(usageRange) })
    }
    throw err
  }
}

function getUsageRangeDays(range: UsageRange) {
  if (range === '30d') return 30
  if (range === '7d') return 7
  return 1
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: value >= 1000 ? 1 : 0,
    notation: value >= 10000 ? 'compact' : 'standard',
  }).format(value)
}

function formatTokenAmount(value: number) {
  const absValue = Math.abs(value)
  const units = [
    { suffix: 'B', value: 1_000_000_000 },
    { suffix: 'M', value: 1_000_000 },
    { suffix: 'K', value: 1_000 },
  ]
  const unit = units.find((item) => absValue >= item.value)

  if (!unit) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
  }

  return `${trimTrailingZero(value / unit.value)}${unit.suffix}`
}

function trimTrailingZero(value: number) {
  return value.toFixed(1).replace(/\.0$/, '')
}

function formatCurrency(value: number, maximumFractionDigits?: number) {
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    maximumFractionDigits: maximumFractionDigits ?? (value > 0 && value < 0.01 ? 4 : 2),
    style: 'currency',
  }).format(value)
}

function formatPercent(value: number, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`
}

function formatModelRef(provider?: string | null, model?: string | null) {
  return [provider, model].filter(Boolean).join('/') || '-'
}

function formatTimeFromMs(value?: number) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function formatDurationCompact(value?: number) {
  if (!value || value <= 0) return '-'
  if (value < 1000) return `${Math.round(value)}ms`

  const seconds = Math.round(value / 1000)
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

function formatUtcOffset(timezoneOffsetMinutes: number) {
  const offsetFromUtcMinutes = -timezoneOffsetMinutes
  const sign = offsetFromUtcMinutes >= 0 ? '+' : '-'
  const absMinutes = Math.abs(offsetFromUtcMinutes)
  const hours = Math.floor(absMinutes / 60)
  const minutes = absMinutes % 60

  return minutes === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${String(minutes).padStart(2, '0')}`
}

function getLastNDaysDateRange(days: number) {
  const end = new Date()
  const start = new Date(end)

  start.setDate(end.getDate() - Math.max(1, days) + 1)

  return {
    endDate: formatDateParam(end),
    startDate: formatDateParam(start),
  }
}

function formatDateParam(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function isUnsupportedGatewayParamError(err: unknown) {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''

  return /unexpected property/i.test(message) || /invalid .* params/i.test(message)
}

function CheckItem({ check }: { check: OpenClawCheck }) {
  return (
    <div className="rounded-2xl border border-divider p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{check.name}</span>
        <Chip size="sm" variant="soft" color="danger">
          FAIL
        </Chip>
      </div>
      <div className="mt-2 text-sm text-muted">{check.message}</div>
      <div className="mt-2 text-xs text-muted">{check.durationMs} ms</div>
    </div>
  )
}

function OpenClawSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-24 rounded-2xl" />
      <Skeleton className="h-44 rounded-2xl" />
    </div>
  )
}

export default OpenClawDashboardPage
