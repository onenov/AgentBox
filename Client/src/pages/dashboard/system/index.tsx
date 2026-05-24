import type { ReactNode } from 'react'
import { Button, Card, Chip, Skeleton, toast } from '@heroui/react'
import { KPI, AreaChart, PieChart, TrendChip } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type { BrowserLatencyResult, CPUInfo, EnvironmentResponse, NetworkCheckItem, ToolInfo } from '@/api'
import { checkBrowserAPIHealthLatency, getNetworkCheck } from '@/api'
import DashboardLayout from '@/layouts/Dashboard'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useEnvironmentStore } from '@/stores/environment'

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

const byteFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
})

const percentFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
})

function SystemInfoPage() {
  usePageTitle('系统信息')
  const data = useEnvironmentStore((store) => store.data)
  const loadSharedEnvironment = useEnvironmentStore((store) => store.loadEnvironment)
  const [state, setState] = useState<LoadState>('loading')
  const [networkChecks, setNetworkChecks] = useState<NetworkCheckItem[]>([])
  const [browserLatency, setBrowserLatency] = useState<BrowserLatencyResult | null>(null)
  const [error, setError] = useState<string>('')
  const [isToolsRefreshing, setIsToolsRefreshing] = useState(false)

  const loadEnvironment = useCallback(async (refresh = false) => {
    setState('loading')
    setError('')

    try {
      const [, networkPayload, browserPayload] = await Promise.all([
        loadSharedEnvironment(refresh),
        getNetworkCheck(refresh),
        checkBrowserAPIHealthLatency(),
      ])
      setNetworkChecks(networkPayload.targets)
      setBrowserLatency(browserPayload)
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : '系统信息加载失败')
      setState('error')
    }
  }, [loadSharedEnvironment])

  const refreshTools = useCallback(async () => {
    setIsToolsRefreshing(true)
    try {
      await loadSharedEnvironment(true, 'tools')
    } catch (err) {
      setError(err instanceof Error ? err.message : '开发工具信息刷新失败')
    } finally {
      setIsToolsRefreshing(false)
    }
  }, [loadSharedEnvironment])

  const refreshMemory = useCallback(async () => {
    try {
      await loadSharedEnvironment(true, 'memory')
    } catch {
      // 内存自动刷新失败时保留当前页面状态，避免打断用户查看其它信息。
    }
  }, [loadSharedEnvironment])

  const copyHostInfo = useCallback(() => {
    if (!data) return
    void copyText(buildHostInfoText(data))
  }, [data])

  const tools = data?.tools
  const copyToolsInfo = useCallback(() => {
    if (!tools) return
    void copyText(buildToolsInfoText(tools))
  }, [tools])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadEnvironment()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadEnvironment])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshMemory()
    }, 30_000)

    return () => window.clearInterval(timer)
  }, [refreshMemory])

  const isLoading = state === 'loading' && !data
  const disk = data?.disks?.[0]
  const networkIO = data?.network?.io?.[0]
  const loadChartData = data
    ? [
      { name: '15m', value: data.load?.load15 ?? 0 },
      { name: '5m', value: data.load?.load5 ?? 0 },
      { name: '1m', value: data.load?.load1 ?? 0 },
    ]
    : []
  const networkChartData = data
    ? [
      { name: '上行', value: networkIO?.bytesSentPerSecond ?? 0 },
      { name: '下行', value: networkIO?.bytesRecvPerSecond ?? 0 },
    ]
    : []
  const refreshButtonVariant = state === 'loading' ? 'danger' : state === 'error' ? 'primary' : 'ghost'
  const memoryChartData = data?.memory
    ? [
      { name: '已用', value: data.memory.used, fill: 'var(--danger)' },
      { name: '可用', value: data.memory.available, fill: 'var(--success)' },
    ]
    : []
  const diskChartData = disk
    ? [
      { name: '已用', value: disk.used, fill: 'var(--warning)' },
      { name: '可用', value: disk.free, fill: 'var(--accent)' },
    ]
    : []

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
                <h2 className="mt-4 text-lg font-semibold text-foreground">无法加载系统信息</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{error}</p>
                <Button className="mt-6" variant={refreshButtonVariant} onPress={() => loadEnvironment(true)} isDisabled={state === 'loading'}>
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
                  <p className="font-medium">无法加载系统信息</p>
                  <p className="mt-1 text-sm text-muted">{error}</p>
                </div>
              </div>
            </Card.Content>
          </Card>
        ) : null}

        {isLoading ? <SystemSkeleton /> : null}

        {data ? (
          <>
            <section className="w-full">
              <Card variant="transparent" className="overflow-visible">
                <Card.Content className="overflow-visible">
                  <div className="md:gap-6 gap-4 flex flex-row items-center overflow-visible">
                    <div className="flex h-24 items-center justify-center shrink-0 overflow-visible p-1">
                      <img src="https://assets.orence.net/file/20260512221136009.png" alt="System Overview" className="h-full w-auto" />
                    </div>
                    <div className="flex min-w-0 flex-col gap-5 w-full">
                      <div className="min-w-0">
                        <Card.Title className="md:text-3xl text-2xl font-bold">系统概览</Card.Title>
                        <Card.Description className="mt-4 md:text-lg text-base">查看系统信息，包括主机、磁盘、内存、CPU 负载等。</Card.Description>
                      </div>
                    </div>
                  </div>
                </Card.Content>
              </Card>
            </section>
            <section className="grid gap-4 lg:grid-cols-2">
              <KPIAreaCard
                title="CPU 负载"
                tag="1m"
                value={formatNumber(data.load?.load1)}
                footer={`5m ${formatNumber(data.load?.load5)} · 15m ${formatNumber(data.load?.load15)}`}
                data={loadChartData}
                dataKey="value"
                stroke="var(--warning)"
                fill="var(--warning)"
                valueFormatter={(value) => formatNumber(Number(value))}
              />

              <KPIAreaCard
                title="网络实时 IO"
                tag={networkIO?.name ?? 'network'}
                value={formatRate(networkIO?.bytesRecvPerSecond)}
                footer={(
                  <NetworkIOFooter
                    recvRate={networkIO?.bytesRecvPerSecond}
                    recvTotal={networkIO?.bytesRecv}
                    sentRate={networkIO?.bytesSentPerSecond}
                    sentTotal={networkIO?.bytesSent}
                  />
                )}
                data={networkChartData}
                dataKey="value"
                stroke="var(--accent)"
                fill="var(--accent)"
                valueFormatter={(value) => formatRate(Number(value))}
              />
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <Card className="relative overflow-visible">
                <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
                  <Button size="sm" isIconOnly variant="ghost" onPress={copyHostInfo}>
                    <Icon icon="lucide:copy" />
                  </Button>
                  <Button size="sm" isIconOnly variant={refreshButtonVariant} onPress={() => loadEnvironment(true)} isDisabled={state === 'loading'}>
                    <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
                  </Button>
                </div>
                <Card.Header className="pr-40">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon icon={osIcon(data.os?.name)} className="size-6 shrink-0 text-muted" />
                    <div className="min-w-0">
                      <Card.Title>主机概览</Card.Title>
                    </div>
                  </div>
                </Card.Header>
                <Card.Content>
                  <InfoGrid
                    columns={2}
                    items={[
                      ['系统', [data.os?.version, data.os?.name].filter(Boolean).join(' · ')],
                      ['架构', data.os?.arch],
                      ['CPU', formatCPUInfo(data.cpu)],
                      ['内核', data.os?.kernel],
                      ['主机名', data.os?.hostname],
                      ['当前用户', data.user?.username || data.user?.name],
                      ['Home', data.user?.homeDir],
                      ['运行时间', formatDuration(data.uptime?.systemSeconds)],
                      ['IP 地址', data.network?.ips?.map((ip) => `${ip.interface}: ${ip.address}`).join('，')],
                      ['DNS', data.network?.dns?.servers?.join('，')],
                    ]}
                  />
                  <div className="mt-1 grid gap-3 grid-cols-2 xl:grid-cols-4">
                    <LatencyCard item={browserLatency} />
                    {networkChecks.map((item) => (
                      <LatencyCard key={item.name} item={item} />
                    ))}
                  </div>
                </Card.Content>
              </Card>

              <div className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <ResourcePieCard
                    title={`磁盘 ${formatBytes(disk?.used)} / ${formatBytes(disk?.total)}`}
                    data={diskChartData}
                    centerLabel={formatPercent(disk?.usedPercent)}
                  />
                  <ResourcePieCard
                    title={`内存 ${formatBytes(data.memory?.used)} / ${formatBytes(data.memory?.total)}`}
                    data={memoryChartData}
                    centerLabel={formatPercent(data.memory?.usedPercent)}
                  />
                </div>

                <Card className="relative overflow-visible">
                  <div className="absolute right-4 top-4 z-10 flex flex-wrap justify-end gap-2">
                    <Chip color="default" variant="soft">
                      <Icon icon="lucide:circle" className="size-1.5 fill-current" />
                      <Chip.Label>{data.runtime?.goVersion ?? 'Go unknown'}</Chip.Label>
                    </Chip>
                    <Chip color={processStatusColor(data.process?.status)} variant="soft">
                      <Icon icon="lucide:circle" className="size-1.5 fill-current" />
                      <Chip.Label>
                        {data.process?.status ?? 'unknown'} · {formatDuration(data.uptime?.backendSeconds)}
                      </Chip.Label>
                    </Chip>
                  </div>
                  <Card.Header className="pr-52">
                    <div className="flex min-w-0 items-start gap-2">
                      <Icon icon="token:go" className="size-6 shrink-0 text-muted" />
                      <div className="min-w-0">
                        <Card.Title>后端进程</Card.Title>
                      </div>
                    </div>
                  </Card.Header>
                  <Card.Content>
                    <InfoGrid
                      columns={2}
                      items={[
                        ['PID / PPID', `${data.process?.pid ?? '-'} / ${data.process?.ppid ?? '-'}`],
                        ['RSS 内存', formatBytes(data.process?.rss)],
                        ['线程数', String(data.process?.threads ?? '-')],
                        ['运行时间', formatDuration(data.process?.uptimeSeconds)],
                      ]}
                    />
                  </Card.Content>
                </Card>
              </div>
            </section>

            <section>
              <Card className="relative overflow-visible">
                <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
                  <Button size="sm" isIconOnly variant="ghost" onPress={copyToolsInfo}>
                    <Icon icon="lucide:copy" />
                  </Button>
                  <Button size="sm" isIconOnly variant="ghost" onPress={refreshTools} isDisabled={isToolsRefreshing}>
                    <Icon icon={isToolsRefreshing ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={isToolsRefreshing ? 'animate-spin' : ''} />
                  </Button>
                </div>
                <Card.Header className="pr-40">
                  <div className="flex min-w-0 items-start gap-2">
                    <Icon icon="mingcute:terminal-fill" className="size-6 shrink-0 text-muted" />
                    <div className="min-w-0">
                      <Card.Title>开发工具</Card.Title>
                    </div>
                  </div>
                </Card.Header>
                <Card.Content>
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <ToolStatus name="Node.js" tool={data.tools?.nodejs} icon="logos:nodejs-icon-alt" />
                    <ToolStatus name="npm" tool={data.tools?.npm} icon="logos:npm-icon" />
                    <ToolStatus name="npx" tool={data.tools?.npx} icon="fluent-emoji-flat:package" />
                    <ToolStatus name="Python" tool={data.tools?.python} icon="logos:python" />
                    <ToolStatus name="uv" tool={data.tools?.uv} icon="simple-icons:astral" />
                    <ToolStatus name="Git" tool={data.tools?.git} icon="devicon:git" />
                    <ToolStatus name="Docker" tool={data.tools?.docker} icon="logos:docker-icon" />
                    <ToolStatus name="Homebrew" tool={data.tools?.homebrew} icon="devicon:homebrew" />
                  </div>
                </Card.Content>
              </Card>
            </section>
          </>
        ) : null}
      </div>
    </DashboardLayout>
  )
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success('已复制到剪贴板', { timeout: 1600 })
  } catch {
    toast.danger('复制失败', { timeout: 1600 })
  }
}

function buildHostInfoText(data: EnvironmentResponse) {
  const disk = data.disks?.[0]
  const lines = [
    '# 主机信息',
    `系统: ${[data.os?.version, data.os?.name].filter(Boolean).join(' · ') || '-'}`,
    `架构: ${data.os?.arch || '-'}`,
    `主机名: ${data.os?.hostname || '-'}`,
    `当前用户: ${data.user?.username || data.user?.name || '-'}`,
    `Home: ${data.user?.homeDir || '-'}`,
    `CPU: ${formatCPUInfo(data.cpu)}`,
    `内核: ${data.os?.kernel || '-'}`,
    `运行时间: ${formatDuration(data.uptime?.systemSeconds)}`,
    `IP 地址: ${data.network?.ips?.map((ip) => `${ip.interface}: ${ip.address}`).join('，') || '-'}`,
    `DNS: ${data.network?.dns?.servers?.join('，') || '-'}`,
    '',
    '# 磁盘信息',
    `设备: ${disk?.device || '-'}`,
    `挂载点: ${disk?.mountpoint || '-'}`,
    `文件系统: ${disk?.filesystem || '-'}`,
    `容量: ${disk ? `${formatBytes(disk.used)} / ${formatBytes(disk.total)}` : '-'}`,
    `已用: ${formatPercent(disk?.usedPercent)}`,
    '',
    '# 内存信息',
    `容量: ${data.memory ? `${formatBytes(data.memory.used)} / ${formatBytes(data.memory.total)}` : '-'}`,
    `已用: ${formatPercent(data.memory?.usedPercent)}`,
    `可用: ${formatBytes(data.memory?.available)}`,
    `Swap: ${formatBytes(data.memory?.swapUsed)} / ${formatBytes(data.memory?.swapTotal)}`,
    '',
    '# 后端信息',
    `Go: ${data.runtime?.goVersion || '-'}`,
    `状态: ${data.process?.status || '-'}`,
    `PID / PPID: ${data.process?.pid ?? '-'} / ${data.process?.ppid ?? '-'}`,
    `RSS 内存: ${formatBytes(data.process?.rss)}`,
    `线程数: ${data.process?.threads ?? '-'}`,
    `进程运行时间: ${formatDuration(data.process?.uptimeSeconds)}`,
    `后端运行时间: ${formatDuration(data.uptime?.backendSeconds)}`,
  ]

  return lines.join('\n')
}

function buildToolsInfoText(tools: EnvironmentResponse['tools']) {
  const toolEntries: Array<[string, ToolInfo | undefined]> = [
    ['Node.js', tools?.nodejs],
    ['npm', tools?.npm],
    ['npx', tools?.npx],
    ['Python', tools?.python],
    ['uv', tools?.uv],
    ['Git', tools?.git],
    ['Docker', tools?.docker],
    ['Homebrew', tools?.homebrew],
  ]

  return toolEntries.map(([name, tool]) => [
    `# ${name}`,
    `状态: ${tool?.available ? '可用' : '缺失'}`,
    `版本: ${tool?.version || '-'}`,
    `路径: ${tool?.globalPrefix || tool?.path || '-'}`,
    tool?.running === undefined ? undefined : `运行中: ${tool.running ? '是' : '否'}`,
    tool?.error ? `错误: ${tool.error}` : undefined,
  ].filter(Boolean).join('\n')).join('\n\n')
}

function osIcon(name?: string) {
  const normalized = name?.toLowerCase()
  if (normalized === 'darwin') return 'simple-icons:apple'
  if (normalized === 'linux') return 'simple-icons:linux'
  if (normalized === 'windows') return 'logos:microsoft-windows-icon'
  return 'lucide:monitor'
}

function LatencyCard({ item }: { item: BrowserLatencyResult | NetworkCheckItem | null }) {
  const isOK = item?.status === 'ok'
  const isLoading = !item

  return (
    <div className="min-w-0 rounded-2xl bg-surface-secondary/50 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium text-foreground">{item?.name ?? '检测中'}</p>
        <span className={["size-2 rounded-full", isLoading ? 'bg-muted' : isOK ? 'bg-success' : 'bg-warning'].join(' ')} />
      </div>
      <p className="mt-2 text-base font-semibold tabular-nums text-foreground">{item ? `${item.latencyMs}ms` : '-'}</p>
      {/* <p className="mt-1 truncate text-xs text-muted">{isLoading ? '等待检测' : isOK ? ('statusCode' in item && item.statusCode ? `HTTP ${item.statusCode}` : 'API 可达') : item.error || '检测失败'}</p> */}
    </div>
  )
}

function NetworkIOFooter({
  recvRate,
  recvTotal,
  sentRate,
  sentTotal,
}: {
  recvRate?: number
  recvTotal?: number
  sentRate?: number
  sentTotal?: number
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="inline-flex items-center gap-1">
        <span className="text-success">↓</span>
        <span>{formatRate(recvRate)}</span>
        <span className="text-muted">总计 {formatBytes(recvTotal)}</span>
      </span>
      <span className="size-1 rounded-full bg-muted/60" />
      <span className="inline-flex items-center gap-1">
        <span className="text-warning">↑</span>
        <span>{formatRate(sentRate)}</span>
        <span className="text-muted">总计 {formatBytes(sentTotal)}</span>
      </span>
    </span>
  )
}

function KPIAreaCard({
  data,
  dataKey,
  fill,
  footer,
  stroke,
  tag,
  title,
  value,
  valueFormatter,
}: {
  data: Array<Record<string, number | string>>
  dataKey: string
  fill: string
  footer: ReactNode
  stroke: string
  tag: string
  title: string
  value: string
  valueFormatter: (value: number | string) => string
}) {
  return (
    <KPI>
      <KPI.Header>
        <KPI.Title>{title}</KPI.Title>
        <TrendChip trend="up" variant="soft">{tag}</TrendChip>
      </KPI.Header>
      <KPI.Value value={0}>{() => value}</KPI.Value>
      <div className="mt-3">
        <AreaChart data={data} height={72} margin={{ bottom: 0, left: 0, right: 0, top: 8 }}>
          <AreaChart.Area dataKey={dataKey} type="monotone" stroke={stroke} fill={fill} fillOpacity={0.14} strokeWidth={2} dot={false} />
          <AreaChart.Tooltip content={<AreaChart.TooltipContent valueFormatter={valueFormatter} />} />
        </AreaChart>
      </div>
      <KPI.Footer>
        <span className="text-sm text-muted">{footer}</span>
      </KPI.Footer>
    </KPI>
  )
}

function ResourcePieCard({
  centerLabel,
  data,
  title,
}: {
  centerLabel: string
  data: Array<{ fill: string; name: string; value: number }>
  title: string
}) {
  return (
    <Card>
      <Card.Header>
        <Card.Title>{title}</Card.Title>
      </Card.Header>
      <Card.Content>
        <div className="flex flex-col gap-3">
          <div className="relative mx-auto w-full max-w-36">
            <PieChart height={144}>
              <PieChart.Pie
                data={data}
                dataKey="value"
                innerRadius={40}
                outerRadius={62}
                paddingAngle={3}
                stroke="var(--surface)"
                strokeWidth={4}
              >
                {data.map((item) => (
                  <PieChart.Cell key={item.name} fill={item.fill} />
                ))}
              </PieChart.Pie>
              <PieChart.Tooltip content={<PieChart.TooltipContent valueFormatter={(value) => formatBytes(Number(value))} />} />
            </PieChart>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-semibold tabular-nums text-foreground">{centerLabel}</span>
              <span className="text-xs text-muted">已用</span>
            </div>
          </div>
          <div className="space-y-2">
            {data.map((item) => (
              <div key={item.name} className="flex items-center justify-between gap-2 rounded-2xl bg-surface-secondary/50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ backgroundColor: item.fill }} />
                  <span className="text-sm text-muted">{item.name}</span>
                </div>
                <span className="text-sm font-medium tabular-nums text-foreground">{formatBytes(item.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function SystemSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index}>
          <Card.Content className="space-y-4 p-5">
            <Skeleton className="h-4 w-24 rounded-full" />
            <Skeleton className="h-9 w-32 rounded-xl" />
            <Skeleton className="h-4 w-40 rounded-full" />
          </Card.Content>
        </Card>
      ))}
    </div>
  )
}

function InfoGrid({ columns = 1, items }: { columns?: 1 | 2 | 4; items: Array<[string, string | undefined]> }) {
  const gridClass = columns === 4 ? 'lg:grid-cols-4' : columns === 2 ? 'md:grid-cols-2' : ''

  return (
    <dl className={['grid gap-3', gridClass].filter(Boolean).join(' ')}>
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-2xl bg-surface-secondary/50 px-4 py-3">
          <dt className="text-sm text-muted">{label}</dt>
          <dd className="mt-1 block min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-foreground">{value || '-'}</dd>
        </div>
      ))}
    </dl>
  )
}

function processStatusColor(status?: string) {
  const normalized = status?.toLowerCase()
  if (!normalized) return 'warning'
  if (['running', 'sleep', 'idle'].includes(normalized)) return 'success'
  if (['zombie', 'dead', 'stopped'].includes(normalized)) return 'danger'
  return 'warning'
}

function ToolStatus({ name, tool, icon }: { name: string; tool?: ToolInfo; icon: string }) {
  const available = tool?.available ?? false
  const toolPath = tool?.globalPrefix || tool?.path

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl bg-surface-secondary/50 px-3 py-3 sm:px-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Icon icon={icon} className="size-8 shrink-0 text-muted" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{name}</p>
            <p className="truncate text-xs text-muted">{tool?.version || '未检测到'}</p>
            {toolPath ? <p className="mt-1 truncate text-xs text-muted">{toolPath}</p> : null}
          </div>
        </div>
        <span className={["mt-1 size-2.5 shrink-0 rounded-full", available ? 'bg-success' : 'bg-warning'].join(' ')} />
      </div>
    </div>
  )
}

function formatBytes(value?: number) {
  if (!value || value <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${byteFormatter.format(size)} ${units[unitIndex]}`
}

function formatRate(value?: number) {
  const formatted = formatBytes(value)
  return formatted === '-' ? '-' : `${formatted}/s`
}

function formatPercent(value?: number) {
  if (value === undefined || Number.isNaN(value)) return '-'
  return `${percentFormatter.format(value)}%`
}

function formatNumber(value?: number) {
  if (value === undefined || Number.isNaN(value)) return '-'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}

function formatCPUInfo(cpu?: CPUInfo) {
  const cores = typeof cpu?.logicalCores === 'number' && cpu.logicalCores > 0 ? `${cpu.logicalCores} 核` : ''
  return [cores, cpu?.model].filter(Boolean).join(' · ') || cpu?.architecture || '-'
}

function formatDuration(seconds?: number) {
  if (!seconds || seconds <= 0) return '0 秒'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`
  if (minutes > 0) return `${minutes} 分钟`
  return `${Math.floor(seconds)} 秒`
}
export default SystemInfoPage
