import { type SVGProps, useCallback, useEffect, useMemo, useState } from 'react'
import { AlertDialog, Button, Card, Chip, Modal, SearchField, Separator, Skeleton, Switch, Tooltip, toast } from '@heroui/react'
import { ItemCard, ItemCardGroup, PieChart, Segment } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type {
  HermesPluginDetailResponse,
  HermesPluginInfo,
  HermesPluginInstallRequest,
  HermesPluginsResponse,
} from '@/api'
import {
  disableHermesPlugin,
  enableHermesPlugin,
  getHermesPlugin,
  getHermesPlugins,
  installHermesPlugin,
  uninstallHermesPlugin,
  updateHermesPlugin,
} from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { useHermesAgentStore } from '@/stores/hermes-agent'
import { HermesLoadErrorCard } from '../hermes-shared/HermesLoadErrorCard'

const collator = new Intl.Collator('zh-CN')

type LoadState = 'idle' | 'loading' | 'ready' | 'error'
type PluginTab = 'all' | 'enabled' | 'disabled' | 'bundled' | 'user' | 'dashboard'
type SelectionKey = string | number

const pluginChartColors = {
  enabled: 'var(--success)',
  disabled: 'var(--muted)',
  bundled: 'var(--accent)',
  user: 'var(--warning)',
}

const pluginHeroGridStroke = 'rgba(247, 247, 247, 1)'

function PluginsHeroIllustration(props: Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'xmlns'>) {
  const { className, ...rest } = props
  const accentRing = 'color-mix(in oklch, var(--accent) 62%, white)'
  const accentSoft = 'color-mix(in oklch, var(--accent) 36%, white)'
  const accentDeep = 'color-mix(in oklch, var(--accent), black 0%)'
  const accentBright = 'color-mix(in oklch, var(--accent), white 26%)'
  const gradId = 'hermesPluginsHeroChipGrad'
  const vb = { x: 166, y: 0, w: 308, h: 301 }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      fill="none"
      className={className}
      aria-hidden
      {...rest}
    >
      <circle cx="240" cy="60" r="20" stroke={accentRing} strokeWidth={2} />
      <circle cx="240" cy="100" r="20" stroke={accentRing} strokeWidth={2} />
      <circle cx="200" cy="60" r="20" stroke={accentRing} strokeWidth={2} />
      <circle cx="200" cy="100" r="20" stroke={accentRing} strokeWidth={2} />
      <circle cx="280" cy="60" r="20" stroke={accentRing} strokeWidth={2} />
      <circle cx="280" cy="100" r="20" stroke={accentRing} strokeWidth={2} />
      <path stroke={pluginHeroGridStroke} strokeWidth={2} d="M174 59.5H378" />
      <path stroke={pluginHeroGridStroke} strokeWidth={2} d="M174 99.5H378" />
      <path stroke={pluginHeroGridStroke} strokeWidth={2} d="M174 220.5H466" />
      <path stroke={pluginHeroGridStroke} strokeWidth={2} d="M174 260.5H466" />
      <path stroke={pluginHeroGridStroke} strokeWidth={2} d="M280 299.933V0" />
      <path stroke={pluginHeroGridStroke} strokeWidth={2} d="M240 299.933V0" />
      <path stroke={pluginHeroGridStroke} strokeWidth={2} d="M200 299.933V0" />
      <circle cx="240" cy="60" r="5" fill="#FFFFFF" />
      <circle cx="240" cy="100" r="10" fill="#FFFFFF" />
      <circle cx="200" cy="60" r="5" fill="#FFFFFF" />
      <circle cx="200" cy="100" r="5" fill="#FFFFFF" />
      <circle cx="280" cy="60" r="5" fill="#FFFFFF" />
      <circle cx="280" cy="100" r="10" fill="#FFFFFF" />
      <path stroke="#181818" strokeWidth={3} d="M400 73.45V119.815L420 139.815V160.106" />
      <path stroke="#181818" strokeWidth={3} d="M380 73v66.815l20 20v40" />
      <path
        fill="#EBECEC"
        fillRule="evenodd"
        d="M400 20C422.091 20 440 37.9086 440 60C451.046 60 460 68.9543 460 80C460 91.0457 451.046 100 440 100L350 100C333.431 100 320 86.5685 320 70C320 53.4315 333.431 40 350 40C354.917 40 359.557 41.1827 363.652 43.2791C369.984 29.538 383.878 20 400 20Z"
      />
      <circle cx="400" cy="200" r="10" fill="var(--accent)" />
      <circle cx="420" cy="160" r="10" fill={accentSoft} />
      <path d="m299.785 120-119.785 0 .027 119.759L200.267 260H320V140.453L299.785 120Z" fill={`url(#${gradId})`} />
      <path d="m319.785 100-119.785 0 .027 119.759L220.267 240H340V120.453L319.785 100Z" fill={accentSoft} />
      <rect x="200" y="100" width="20" height="20" fill="#181818" />
      <rect x="320" y="220" width="20" height="20" fill="#181818" />
      <path d="m339.785 80-119.785 0 .027 119.759L240.267 220H360V100.453L339.785 80Z" fill="#F7F7F7" />
      <rect x="260" y="120" width="60" height="60" fill="#EBECEC" />
      <rect x="240" y="80" width="10" height="20" fill="#EBECEC" />
      <rect x="250" y="200" width="10" height="20" fill="#EBECEC" />
      <rect x="260" y="80" width="10" height="20" fill="#EBECEC" />
      <rect x="270" y="200" width="10" height="20" fill="#EBECEC" />
      <rect x="280" y="80" width="10" height="20" fill="#EBECEC" />
      <rect x="290" y="200" width="10" height="20" fill="#EBECEC" />
      <rect x="300" y="80" width="10" height="20" fill="#EBECEC" />
      <rect x="310" y="200" width="10" height="20" fill="#EBECEC" />
      <rect x="320" y="80" width="10" height="20" fill="#EBECEC" />
      <rect x="330" y="200" width="10" height="20" fill="#EBECEC" />
      <defs>
        <linearGradient id={gradId} x1="250" y1="260" x2="250" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={accentDeep} />
          <stop offset="0.5" stopColor="var(--accent)" />
          <stop offset="1" stopColor={accentBright} />
        </linearGradient>
      </defs>
    </svg>
  )
}

function HermesPluginsPage() {
  usePageTitle('Hermes 插件')
  const selectedAgentName = useHermesAgentStore((store) => store.selectedName)
  const loadAgents = useHermesAgentStore((store) => store.loadAgents)

  const [state, setState] = useState<LoadState>('idle')
  const [data, setData] = useState<HermesPluginsResponse | null>(null)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<SelectionKey>('all')
  const [query, setQuery] = useState('')
  const [mutatingPlugin, setMutatingPlugin] = useState('')

  const [installOpen, setInstallOpen] = useState(false)
  const [installIdentifier, setInstallIdentifier] = useState('')
  const [installForce, setInstallForce] = useState(false)
  const [installEnable, setInstallEnable] = useState(true)

  const [detailOpen, setDetailOpen] = useState(false)
  const [detailState, setDetailState] = useState<LoadState>('idle')
  const [detailError, setDetailError] = useState('')
  const [detailPlugin, setDetailPlugin] = useState<HermesPluginInfo | null>(null)
  const [detailPayload, setDetailPayload] = useState<HermesPluginDetailResponse | null>(null)

  const [pluginToUninstall, setPluginToUninstall] = useState<HermesPluginInfo | null>(null)

  const loadPlugins = useCallback(async (refresh = false) => {
    setState('loading')
    setError('')
    try {
      const payload = await getHermesPlugins(refresh, selectedAgentName)
      setData(payload)
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hermes 插件状态加载失败')
      setState('error')
    }
  }, [selectedAgentName])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAgents(false)
      void loadPlugins(false)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAgents, loadPlugins])

  const plugins = useMemo(() => data?.plugins ?? [], [data?.plugins])
  const stats = useMemo(() => getPluginStats(plugins), [plugins])
  const filteredPlugins = useMemo(() => {
    const normalizedQuery = query.trim()
    return plugins
      .filter((plugin) => matchesTab(plugin, String(activeTab) as PluginTab))
      .filter((plugin) => pluginMatchesQuery(plugin, normalizedQuery))
      .sort((a, b) => collator.compare(pluginName(a), pluginName(b)))
  }, [activeTab, plugins, query])

  const submitInstall = useCallback(async () => {
    const identifier = installIdentifier.trim()
    if (!identifier) {
      toast.warning('请输入 Git URL 或 owner/repo')
      return
    }
    const request: HermesPluginInstallRequest = {
      enable: installEnable,
      force: installForce,
      identifier,
    }
    setMutatingPlugin(identifier)
    try {
      await installHermesPlugin(request, selectedAgentName)
      toast.success('Hermes 插件安装完成，重启 Gateway 后生效')
      setInstallOpen(false)
      await loadPlugins(true)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'Hermes 插件安装失败')
    } finally {
      setMutatingPlugin('')
    }
  }, [installEnable, installForce, installIdentifier, loadPlugins, selectedAgentName])

  const togglePlugin = useCallback(async (plugin: HermesPluginInfo) => {
    const key = pluginOperationName(plugin)
    if (!key) return
    setMutatingPlugin(key)
    try {
      if (plugin.enabled) {
        await disableHermesPlugin(key, selectedAgentName)
        toast.success('插件已停用，重启 Gateway 后生效')
      } else {
        await enableHermesPlugin(key, selectedAgentName)
        toast.success('插件已启用，重启 Gateway 后生效')
      }
      await loadPlugins(true)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '插件启停失败')
    } finally {
      setMutatingPlugin('')
    }
  }, [loadPlugins, selectedAgentName])

  const updatePlugin = useCallback(async (plugin: HermesPluginInfo) => {
    const key = pluginOperationName(plugin)
    if (!key) return
    setMutatingPlugin(key)
    try {
      await updateHermesPlugin(key, selectedAgentName)
      toast.success('插件更新完成，重启 Gateway 后生效')
      await loadPlugins(true)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '插件更新失败')
    } finally {
      setMutatingPlugin('')
    }
  }, [loadPlugins, selectedAgentName])

  const openPluginDetail = useCallback(async (plugin: HermesPluginInfo) => {
    const key = pluginOperationName(plugin)
    if (!key) return
    setDetailOpen(true)
    setDetailPlugin(plugin)
    setDetailPayload(null)
    setDetailError('')
    setDetailState('loading')
    try {
      const payload = await getHermesPlugin(key, selectedAgentName)
      setDetailPayload(payload)
      setDetailPlugin(payload.plugin)
      setDetailState('ready')
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '插件详情加载失败')
      setDetailState('error')
    }
  }, [selectedAgentName])

  const confirmUninstallPlugin = useCallback(async () => {
    if (!pluginToUninstall) return
    const key = pluginOperationName(pluginToUninstall)
    if (!key) return
    setMutatingPlugin(key)
    try {
      await uninstallHermesPlugin(key, selectedAgentName)
      toast.success('插件已卸载，重启 Gateway 后生效')
      setPluginToUninstall(null)
      await loadPlugins(true)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '插件卸载失败')
    } finally {
      setMutatingPlugin('')
    }
  }, [loadPlugins, pluginToUninstall, selectedAgentName])

  const isLoading = state === 'loading' && !data
  const refreshButtonVariant = state === 'loading' ? 'danger' : state === 'error' ? 'primary' : 'ghost'

  return (
    <DashboardLayout>
      <div className={error && !data ? 'flex min-h-[calc(100dvh-8rem)] items-center justify-center' : 'mx-auto flex max-w-7xl flex-col gap-6'}>
        {error && !data ? (
          <HermesLoadErrorCard
            error={error}
            isRetrying={state === 'loading'}
            title="无法加载 Hermes 插件"
            onRetry={() => void loadPlugins(true)}
          />
        ) : null}

        {error && data ? (
          <Card>
            <Card.Content>
              <div className="flex items-start gap-3 text-danger">
                <Icon icon="lucide:circle-alert" className="mt-0.5 size-5" />
                <div>
                  <p className="font-medium">Hermes 插件刷新失败</p>
                  <p className="mt-1 text-sm text-muted">{error}</p>
                </div>
              </div>
            </Card.Content>
          </Card>
        ) : null}

        {isLoading ? <PluginsSkeleton /> : null}

        {data ? (
          <>
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.8fr)]">
              <PluginHero
                identifier={installIdentifier}
                state={state}
                error={data.config.error || ''}
                onIdentifierChange={setInstallIdentifier}
                onOpenInstall={() => setInstallOpen(true)}
                onQuickInstall={submitInstall}
              />
              <PluginStatsCard stats={stats} />
            </section>

            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <Segment selectedKey={activeTab} onSelectionChange={setActiveTab}>
                  <Segment.Item id="all"><Segment.Separator />全部</Segment.Item>
                  <Segment.Item id="enabled"><Segment.Separator />已启用</Segment.Item>
                  <Segment.Item id="disabled"><Segment.Separator />未启用</Segment.Item>
                  <Segment.Item id="bundled"><Segment.Separator />内置</Segment.Item>
                  <Segment.Item id="user"><Segment.Separator />用户</Segment.Item>
                  <Segment.Item id="dashboard"><Segment.Separator />Dashboard</Segment.Item>
                </Segment>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <SearchField variant="primary" className="md:w-64" value={query} onChange={setQuery} aria-label="搜索 Hermes 插件">
                    <SearchField.Group>
                      <SearchField.SearchIcon />
                      <SearchField.Input placeholder="搜索..." />
                      <SearchField.ClearButton />
                    </SearchField.Group>
                  </SearchField>
                  <Button isIconOnly variant={refreshButtonVariant} onPress={() => loadPlugins(true)} isDisabled={state === 'loading'} aria-label="刷新插件">
                    <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="max-h-[calc(100vh-150px)] overflow-y-auto">
                  <div className="flex-1 grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
                    {filteredPlugins.map((plugin) => {
                      const key = pluginKey(plugin)
                      const operationName = pluginOperationName(plugin)
                      return (
                        <PluginCard
                          key={`${plugin.source}-${key}`}
                          plugin={plugin}
                          mutating={mutatingPlugin === operationName}
                          onShowDetail={openPluginDetail}
                          onToggle={togglePlugin}
                          onUninstall={setPluginToUninstall}
                          onUpdate={updatePlugin}
                        />
                      )
                    })}
                    {filteredPlugins.length === 0 ? (
                      <div className="col-span-full flex min-h-[360px] items-center justify-center">
                        <EmptyState title="没有匹配的插件" description="尝试切换筛选条件、清空搜索，或安装一个 Git 插件。" />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : null}

        <InstallPluginModal
          enable={installEnable}
          force={installForce}
          identifier={installIdentifier}
          isOpen={installOpen}
          mutating={Boolean(mutatingPlugin)}
          onEnableChange={setInstallEnable}
          onForceChange={setInstallForce}
          onIdentifierChange={setInstallIdentifier}
          onOpenChange={setInstallOpen}
          onSubmit={submitInstall}
        />

        <PluginDetailModal
          error={detailError}
          isOpen={detailOpen}
          payload={detailPayload}
          plugin={detailPlugin}
          state={detailState}
          onOpenChange={setDetailOpen}
          onRetry={() => detailPlugin && openPluginDetail(detailPlugin)}
        />

        <PluginUninstallConfirmDialog
          isOpen={pluginToUninstall !== null}
          isUninstalling={pluginToUninstall ? mutatingPlugin === pluginOperationName(pluginToUninstall) : false}
          plugin={pluginToUninstall}
          onConfirm={confirmUninstallPlugin}
          onOpenChange={(open) => !open && setPluginToUninstall(null)}
        />
      </div>
    </DashboardLayout>
  )
}

type PluginStats = ReturnType<typeof getPluginStats>

function PluginHero({
  identifier,
  state,
  error,
  onIdentifierChange,
  onQuickInstall,
  onOpenInstall,
}: {
  identifier: string
  state: LoadState
  error: string
  onIdentifierChange: (value: string) => void
  onQuickInstall: () => void
  onOpenInstall: () => void
}) {
  const isInstalling = state === 'loading'
  return (
    <Card variant="transparent" className="overflow-hidden">
      <Card.Content>
        <div className="flex flex-row items-center gap-4 md:gap-6">
          <div className="flex h-36 shrink-0 items-center justify-center overflow-visible p-1 drop-shadow-[0_8px_14px_color-mix(in_oklch,var(--accent)_28%,transparent)]">
            <PluginsHeroIllustration className="h-full w-auto md:scale-105" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <div className="min-w-0">
              <Card.Title className="text-2xl font-bold md:text-3xl">扩展插件</Card.Title>
              <Card.Description className="mt-4 text-base md:text-lg">安装插件，管理 plugins.enabled / disabled 和 Dashboard 扩展。</Card.Description>
            </div>
            <div className="flex flex-row items-end gap-3 md:pr-6">
              <SearchField variant="primary" className="min-w-0 md:w-80" value={identifier} onChange={onIdentifierChange} aria-label="插件 Git 标识">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="owner/repo 或 Git URL" onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      onQuickInstall()
                    }
                  }} />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <Button isIconOnly variant={identifier.trim() ? 'primary' : 'tertiary'} onPress={onQuickInstall} isDisabled={isInstalling || !identifier.trim()} aria-label="安装插件">
                <Icon icon={isInstalling ? 'lucide:loader-circle' : 'lucide:download'} className={isInstalling ? 'animate-spin' : ''} />
              </Button>
              <Button variant="tertiary" onPress={onOpenInstall}>
                <Icon icon="lucide:settings-2" className="size-4" />
                选项
              </Button>
            </div>
          </div>
        </div>
        {error ? (
          <div className="mt-4 rounded-2xl bg-warning/10 p-3 text-sm text-warning">
            <div className="flex items-start gap-2">
              <Icon icon="lucide:circle-alert" className="mt-0.5 size-4" />
              <span>{error}</span>
            </div>
          </div>
        ) : null}
      </Card.Content>
    </Card>
  )
}

function PluginStatsCard({ stats }: { stats: PluginStats }) {
  const chartData = [
    { name: '已启用', value: stats.enabled, fill: pluginChartColors.enabled },
    { name: '未启用', value: stats.notEnabled, fill: pluginChartColors.disabled },
  ].filter((item) => item.value > 0)
  const displayChartData = chartData.length ? chartData : [{ name: '暂无数据', value: 1, fill: 'var(--surface-secondary)' }]
  return (
    <Card>
      <Card.Content>
        <div className="flex flex-row items-center gap-6">
          <div className="relative shrink-0">
            <PieChart height={160} width={160}>
              <PieChart.Pie cx="50%" cy="50%" data={displayChartData} dataKey="value" innerRadius="56%" nameKey="name" strokeWidth={0}>
                {displayChartData.map((item) => <PieChart.Cell key={item.name} fill={item.fill} />)}
              </PieChart.Pie>
              <PieChart.Tooltip content={<PieChart.TooltipContent />} />
            </PieChart>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold tabular-nums text-foreground">{stats.total}</span>
              <span className="text-[10px] text-muted">全部插件</span>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <PluginLegendItem label="已启用" value={stats.enabled} color={pluginChartColors.enabled} />
            <PluginLegendItem label="未启用" value={stats.notEnabled} color={pluginChartColors.disabled} />
            <PluginLegendItem label="内置" value={stats.bundled} color={pluginChartColors.bundled} />
            <PluginLegendItem label="用户" value={stats.user} color={pluginChartColors.user} />
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function PluginLegendItem({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <div className="flex flex-1 items-center justify-between gap-3">
        <span className="text-sm text-foreground">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
      </div>
    </div>
  )
}

function PluginCard({
  plugin,
  mutating,
  onShowDetail,
  onToggle,
  onUninstall,
  onUpdate,
}: {
  plugin: HermesPluginInfo
  mutating: boolean
  onShowDetail: (plugin: HermesPluginInfo) => void
  onToggle: (plugin: HermesPluginInfo) => void
  onUninstall: (plugin: HermesPluginInfo) => void
  onUpdate: (plugin: HermesPluginInfo) => void
}) {
  const status = getPluginStatus(plugin)
  return (
    <Card className="overflow-hidden">
      <Card.Content>
        <div className="flex h-full flex-col gap-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <span className={`size-2.5 rounded-full ${status.dotClass}`} />
              <Chip size="sm" variant="soft">{formatSource(plugin.source)}</Chip>
              <Chip size="sm" variant="soft">{formatKind(plugin.kind)}</Chip>
              <Chip size="sm" variant="soft" color={status.color}>{status.label}</Chip>
              {plugin.version ? <Chip size="sm" variant="soft">v{plugin.version}</Chip> : null}
              {plugin.dashboard ? <Chip size="sm" variant="soft">Dashboard</Chip> : null}
              {plugin.error ? <Chip size="sm" variant="soft" color="warning">Error</Chip> : null}
            </div>
            <Switch size="lg" isSelected={plugin.explicitlyEnabled || plugin.enabled} isDisabled={mutating || !canTogglePlugin(plugin)} onChange={() => onToggle(plugin)} aria-label="切换插件启用状态">
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
          </div>

          <h3 className="truncate text-base font-semibold text-foreground">{pluginName(plugin)}</h3>
          <p className="line-clamp-2 min-h-10 text-sm leading-5 text-muted">{plugin.description || '未提供描述。'}</p>

          {/* <div className="mt-2 flex flex-wrap gap-1.5">
            {plugin.providesTools?.slice(0, 3).map((tool) => <Chip key={tool} size="sm" variant="soft">tool:{tool}</Chip>)}
            {plugin.providesHooks?.slice(0, 2).map((hook) => <Chip key={hook} size="sm" variant="soft">hook:{hook}</Chip>)}
            {plugin.requiresEnv?.slice(0, 2).map((env) => <Chip key={env} size="sm" variant="soft">env:{env}</Chip>)}
          </div> */}

          <div className="mt-auto flex justify-between gap-2 pt-2">
            <Tooltip delay={300}>
              <Button isIconOnly size="sm" variant="ghost" onPress={() => onUninstall(plugin)} isDisabled={mutating || plugin.bundled} aria-label="卸载插件">
                <Icon icon="lucide:trash-2" className="size-4" />
              </Button>
              <Tooltip.Content>{plugin.bundled ? '内置插件不可卸载' : '卸载插件'}</Tooltip.Content>
            </Tooltip>
            <div className="flex gap-2">
              <Tooltip delay={300}>
                <Button isIconOnly size="sm" variant="ghost" onPress={() => onUpdate(plugin)} isDisabled={mutating || !plugin.git} aria-label="更新插件">
                  <Icon icon={mutating ? 'lucide:loader-circle' : 'lucide:git-pull-request-arrow'} className={mutating ? 'animate-spin' : 'size-4'} />
                </Button>
                <Tooltip.Content>{plugin.git ? 'Git 更新' : '只有 Git 插件可更新'}</Tooltip.Content>
              </Tooltip>
              <Button size="sm" variant="ghost" onPress={() => onShowDetail(plugin)}>
                <Icon icon="lucide:info" className="size-4" />
                详情
              </Button>
            </div>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function InstallPluginModal({
  isOpen,
  identifier,
  force,
  enable,
  mutating,
  onIdentifierChange,
  onForceChange,
  onEnableChange,
  onSubmit,
  onOpenChange,
}: {
  isOpen: boolean
  identifier: string
  force: boolean
  enable: boolean
  mutating: boolean
  onIdentifierChange: (value: string) => void
  onForceChange: (value: boolean) => void
  onEnableChange: (value: boolean) => void
  onSubmit: () => void
  onOpenChange: (isOpen: boolean) => void
}) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="md">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground"><Icon icon="lucide:download" className="size-5" /></Modal.Icon>
            <div>
              <Modal.Heading>安装 Hermes 插件</Modal.Heading>
              <p className="mt-1 text-sm text-muted">支持 Git URL、SSH URL、file:// 或 owner/repo shorthand。</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="flex flex-col gap-4 p-1">
              <SearchField value={identifier} onChange={onIdentifierChange} aria-label="Hermes 插件标识">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="anpicasso/hermes-plugin-chrome-profiles" />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <ItemCardGroup className="overflow-hidden">
                <ItemCardGroup.Header>
                  <ItemCardGroup.Title>安装选项</ItemCardGroup.Title>
                  <ItemCardGroup.Description>控制安装后的启用状态和覆盖策略。</ItemCardGroup.Description>
                </ItemCardGroup.Header>
                <PluginSwitch
                  description="安装后自动写入 plugins.enabled。"
                  icon="lucide:toggle-right"
                  isSelected={enable}
                  title="安装后启用"
                  onChange={onEnableChange}
                />
                <Separator />
                <PluginSwitch
                  description="已存在同名插件时删除后重新安装。"
                  icon="lucide:refresh-cw"
                  isSelected={force}
                  title="Force 覆盖"
                  onChange={onForceChange}
                />
              </ItemCardGroup>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={() => onOpenChange(false)}>取消</Button>
            <Button variant="primary" onPress={onSubmit} isDisabled={mutating || !identifier.trim()}>
              <Icon icon={mutating ? 'lucide:loader-circle' : 'lucide:download'} className={mutating ? 'animate-spin' : 'size-4'} />
              安装
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function PluginSwitch({
  description,
  icon,
  isSelected,
  title,
  onChange,
}: {
  description: string
  icon: string
  isSelected: boolean
  title: string
  onChange: (isSelected: boolean) => void
}) {
  return (
    <ItemCard>
      <ItemCard.Icon className="size-10 rounded-full bg-surface-secondary/50 text-muted">
        <Icon icon={icon} className="size-4" />
      </ItemCard.Icon>
      <ItemCard.Content>
        <ItemCard.Title>{title}</ItemCard.Title>
        <ItemCard.Description>{description}</ItemCard.Description>
      </ItemCard.Content>
      <ItemCard.Action>
        <Switch aria-label={title} isSelected={isSelected} onChange={onChange}>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch>
      </ItemCard.Action>
    </ItemCard>
  )
}

function PluginDetailModal({
  isOpen,
  state,
  error,
  plugin,
  payload,
  onOpenChange,
  onRetry,
}: {
  isOpen: boolean
  state: LoadState
  error: string
  plugin: HermesPluginInfo | null
  payload: HermesPluginDetailResponse | null
  onOpenChange: (isOpen: boolean) => void
  onRetry: () => void
}) {
  const current = payload?.plugin ?? plugin
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="lg">
        <Modal.Dialog className="sm:max-w-[1040px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground"><Icon icon="lucide:puzzle" className="size-5" /></Modal.Icon>
            <div className="min-w-0">
              <Modal.Heading>{current ? pluginName(current) : '插件详情'}</Modal.Heading>
              <p className="mt-1 truncate text-sm text-muted">{current ? pluginKey(current) : 'Loading...'}</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            {state === 'loading' ? (
              <div className="grid h-[min(68dvh,760px)] gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
                <Skeleton className="h-full rounded-3xl" />
                <Skeleton className="h-full rounded-3xl" />
              </div>
            ) : error ? (
              <EmptyState title="详情加载失败" description={error} action={<Button variant="primary" onPress={onRetry}>重试</Button>} />
            ) : current ? (
              <div className="grid h-[min(68dvh,760px)] gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
                <div className="min-h-0 overflow-y-auto">
                  <div className="flex flex-col gap-4">
                    <Card>
                      <Card.Content>
                        <div className="grid gap-2 text-xs text-muted">
                          <InfoLine label="Key" value={current.key} />
                          <InfoLine label="Name" value={current.name} />
                          <InfoLine label="Version" value={current.version} />
                          <InfoLine label="Kind" value={formatKind(current.kind)} />
                          <InfoLine label="Source" value={formatSource(current.source)} />
                          <InfoLine label="Author" value={current.author} />
                        </div>
                      </Card.Content>
                    </Card>
                    <DetailBlock title="加载状态" icon="lucide:activity">
                      <div className="flex flex-wrap gap-1.5">
                        <Chip size="sm" variant="soft" color={current.enabled ? 'success' : 'warning'}>{current.enabled ? '已启用' : '未启用'}</Chip>
                        {current.explicitlyEnabled ? <Chip size="sm" variant="soft">enabled</Chip> : null}
                        {current.explicitlyDisabled ? <Chip size="sm" variant="soft" color="warning">disabled</Chip> : null}
                        {current.git ? <Chip size="sm" variant="soft">Git</Chip> : null}
                        {current.dashboard ? <Chip size="sm" variant="soft">Dashboard</Chip> : null}
                      </div>
                    </DetailBlock>
                    <DetailBlock title="声明能力" icon="lucide:wrench">
                      <ChipList items={[...(current.providesTools ?? []).map((item) => `tool:${item}`), ...(current.providesHooks ?? []).map((item) => `hook:${item}`), ...(current.requiresEnv ?? []).map((item) => `env:${item}`)]} empty="未声明工具、Hook 或环境变量。" />
                    </DetailBlock>
                    {current.dashboard ? (
                      <DetailBlock title="Dashboard 扩展" icon="lucide:layout-dashboard">
                        <div className="grid gap-2 text-sm">
                          <InfoLine label="Label" value={current.dashboard.label} />
                          <InfoLine label="Tab Path" value={current.dashboard.tabPath} />
                          <InfoLine label="Bundle" value={current.dashboard.bundle} />
                          <InfoLine label="API" value={current.dashboard.api} />
                          <ChipList items={current.dashboard.slots ?? []} empty="未声明 slot。" />
                        </div>
                      </DetailBlock>
                    ) : null}
                    <DetailBlock title="路径" icon="lucide:link">
                      <div className="grid gap-2 text-sm">
                        <PathRow label="Root" value={current.path} />
                        <PathRow label="Manifest" value={current.manifestPath} />
                      </div>
                    </DetailBlock>
                  </div>
                </div>
                <Card className="min-h-0">
                  <Card.Header>
                    <div className="flex items-center gap-2">
                      <Icon icon="lucide:file-text" className="size-4 text-muted" />
                      <Card.Title className="text-sm">插件文件</Card.Title>
                    </div>
                  </Card.Header>
                  <Card.Content className="min-h-0">
                    <pre className="max-h-[calc(min(68dvh,760px)-72px)] overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-surface-secondary/50 p-4 text-xs leading-5 text-foreground">
                      {formatPluginDetailText(payload)}
                    </pre>
                  </Card.Content>
                </Card>
              </div>
            ) : null}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function DetailBlock({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <Card>
      <Card.Header>
        <div className="flex items-center gap-2">
          <Icon icon={icon} className="size-4 text-muted" />
          <Card.Title className="text-sm">{title}</Card.Title>
        </div>
      </Card.Header>
      <Card.Content>{children}</Card.Content>
    </Card>
  )
}

function ChipList({ items, empty }: { items: string[]; empty: string }) {
  const filtered = items.filter(Boolean)
  if (filtered.length === 0) return <p className="text-sm text-muted">{empty}</p>
  return <div className="flex flex-wrap gap-1.5">{filtered.map((item) => <Chip key={item} size="sm" variant="soft">{item}</Chip>)}</div>
}

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <Card className="min-w-0 bg-surface-secondary/50">
      <Card.Content>
        <div className="text-xs text-muted">{label}</div>
        <div className="mt-1 break-all text-sm text-foreground">{value}</div>
      </Card.Content>
    </Card>
  )
}

function PluginUninstallConfirmDialog({
  plugin,
  isOpen,
  isUninstalling,
  onConfirm,
  onOpenChange,
}: {
  plugin: HermesPluginInfo | null
  isOpen: boolean
  isUninstalling: boolean
  onConfirm: () => Promise<void>
  onOpenChange: (isOpen: boolean) => void
}) {
  const key = plugin ? pluginKey(plugin) : ''
  return (
    <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[480px]">
          <AlertDialog.CloseTrigger />
          <AlertDialog.Header>
            <AlertDialog.Icon status="danger" />
            <AlertDialog.Heading>卸载 Hermes 插件？</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <div className="space-y-3 text-sm leading-6 text-muted">
              <p>这会调用 <span className="font-medium text-foreground">hermes plugins remove</span> 删除用户插件 <span className="font-semibold text-foreground">{plugin ? pluginName(plugin) : key}</span>。</p>
              <div className="rounded-2xl bg-surface-tertiary px-3 py-3">
                <p className="break-all">Plugin: {key || '-'}</p>
                <p className="mt-1 break-all">Path: {plugin?.path || '-'}</p>
              </div>
              <p>内置插件不可卸载；卸载后通常需要重启 Hermes Gateway 才能完全生效。</p>
            </div>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="tertiary" isDisabled={isUninstalling}>取消</Button>
            <Button variant="danger" onPress={() => void onConfirm()} isDisabled={isUninstalling || !plugin || !key}>
              <Icon icon={isUninstalling ? 'lucide:loader-circle' : 'lucide:trash-2'} className={isUninstalling ? 'animate-spin' : ''} />
              确认
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}

function InfoLine({ label, value }: { label: string; value?: unknown }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 break-all text-sm font-medium text-foreground">{formatValue(value)}</p>
    </div>
  )
}

function PluginsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.8fr)]">
        <Skeleton className="h-48 rounded-3xl" />
        <Skeleton className="h-48 rounded-3xl" />
      </div>
      <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
        <Skeleton className="h-48 rounded-3xl" />
        <Skeleton className="h-48 rounded-3xl" />
        <Skeleton className="h-48 rounded-3xl" />
      </div>
    </div>
  )
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl px-6 py-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-surface text-muted"><Icon icon="lucide:inbox" className="size-6" /></div>
      <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

function getPluginStats(plugins: HermesPluginInfo[]) {
  const enabled = plugins.filter((plugin) => plugin.enabled).length
  const notEnabled = plugins.filter((plugin) => !plugin.enabled).length
  return {
    total: plugins.length,
    enabled,
    disabled: notEnabled,
    notEnabled,
    bundled: plugins.filter((plugin) => plugin.bundled).length,
    user: plugins.filter((plugin) => plugin.source === 'user' || plugin.source === 'git').length,
    dashboard: plugins.filter((plugin) => plugin.dashboard).length,
  }
}

function matchesTab(plugin: HermesPluginInfo, tab: PluginTab) {
  if (tab === 'enabled') return plugin.enabled
  if (tab === 'disabled') return !plugin.enabled
  if (tab === 'bundled') return plugin.bundled
  if (tab === 'user') return plugin.source === 'user' || plugin.source === 'git'
  if (tab === 'dashboard') return Boolean(plugin.dashboard)
  return true
}

function pluginMatchesQuery(plugin: HermesPluginInfo, query: string) {
  const trimmed = query.trim()
  if (!trimmed) return true
  const fields = [
    plugin.key,
    plugin.name,
    plugin.dirName,
    plugin.displayName,
    plugin.description,
    plugin.version,
    plugin.author,
    plugin.kind,
    plugin.source,
    plugin.loadMode,
    plugin.statusLabel,
    plugin.path,
    plugin.manifestPath,
    plugin.dashboard?.label,
    plugin.dashboard?.tabPath,
    ...(plugin.requiresEnv ?? []),
    ...(plugin.providesTools ?? []),
    ...(plugin.providesHooks ?? []),
  ].filter(Boolean).map((value) => String(value))
  const rawQuery = trimmed.toLowerCase()
  const relaxedQuery = normalizePluginSearchText(trimmed)
  return fields.some((field) => field.toLowerCase().includes(rawQuery) || normalizePluginSearchText(field).includes(relaxedQuery))
}

function normalizePluginSearchText(value: string) {
  return value.toLowerCase().replace(/[\s._:/\\-]+/g, '')
}

function canTogglePlugin(plugin: HermesPluginInfo) {
  return plugin.loadMode === 'opt-in' || plugin.explicitlyEnabled || plugin.explicitlyDisabled
}

function getPluginStatus(plugin: HermesPluginInfo) {
  if (plugin.explicitlyDisabled) {
    return { color: 'warning' as const, dotClass: 'bg-warning', label: '禁用' }
  }
  if (plugin.loadMode === 'auto') {
    return { color: 'success' as const, dotClass: 'bg-success', label: '自动加载' }
  }
  if (plugin.loadMode === 'provider') {
    return { color: 'success' as const, dotClass: 'bg-success', label: 'Provider' }
  }
  if (plugin.loadMode === 'exclusive') {
    return { color: 'warning' as const, dotClass: 'bg-warning', label: '专属配置' }
  }
  if (plugin.enabled) {
    return { color: 'success' as const, dotClass: 'bg-success', label: '启用' }
  }
  return { color: 'warning' as const, dotClass: 'bg-warning', label: '未启用' }
}

function pluginKey(plugin: HermesPluginInfo) {
  return String(plugin.key || plugin.name || '').trim()
}

function pluginOperationName(plugin: HermesPluginInfo) {
  return String(plugin.name || plugin.dirName || plugin.key || '').trim()
}

function pluginName(plugin: HermesPluginInfo) {
  return String(plugin.displayName || plugin.name || plugin.key || 'Unnamed Plugin')
}

function formatSource(source: string) {
  switch (source) {
    case 'bundled':
      return '内置'
    case 'git':
      return 'Git'
    case 'user':
      return '用户'
    case 'project':
      return '项目'
    default:
      return source || '未知'
  }
}

function formatKind(kind: string) {
  switch (kind) {
    case 'standalone':
      return '独立'
    case 'backend':
      return '后端'
    case 'platform':
      return '平台'
    case 'model-provider':
      return '模型'
    case 'exclusive':
      return '互斥'
    default:
      return kind || 'plugin'
  }
}

function formatValue(value: unknown) {
  if (value == null || value === '') return '-'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function formatPluginDetailText(payload: HermesPluginDetailResponse | null) {
  if (!payload) return '暂无插件文件内容'
  const sections = [
    ['plugin.yaml', payload.manifest],
    ['README', payload.readme],
    ['after-install.md', payload.afterInstall],
    ['dashboard/manifest.json', payload.dashboardManifest],
    ['__init__.py', payload.init],
  ].filter(([, content]) => typeof content === 'string' && content.trim())
  if (sections.length === 0) return '未读取到 manifest、README 或 __init__.py 内容'
  return sections.map(([title, content]) => `# ${title}\n\n${content}`).join('\n\n---\n\n')
}

export default HermesPluginsPage
