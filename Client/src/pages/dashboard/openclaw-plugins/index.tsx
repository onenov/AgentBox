import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertDialog, Button, Card, Chip, Modal, SearchField, Separator, Skeleton, Switch, toast } from '@heroui/react'
import { ItemCard, ItemCardGroup, PieChart, Segment } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type {
  OpenClawPluginDoctorResponse,
  OpenClawPluginInspectResponse,
  OpenClawPluginInstallRequest,
  OpenClawPluginSearchResult,
  OpenClawPluginStatus,
  OpenClawPluginStatusResponse,
} from '@/api'
import {
  disableOpenClawPlugin,
  enableOpenClawPlugin,
  getOpenClawPluginInfo,
  getOpenClawPluginRuntimeInfo,
  getOpenClawPluginsDoctor,
  getOpenClawPluginsStatus,
  installOpenClawPlugin,
  refreshOpenClawPluginsRegistry,
  searchOpenClawPlugins,
  uninstallOpenClawPlugin,
} from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'

const collator = new Intl.Collator('zh-CN')

type PluginTab = 'all' | 'enabled' | 'disabled' | 'issues'
type SelectionKey = string | number
type LoadState = 'idle' | 'loading' | 'ready' | 'error'

const pluginChartColors = {
  enabled: 'var(--success)',
  disabled: 'var(--muted)',
  issues: 'var(--warning)',
}

function OpenClawPluginsPage() {
  usePageTitle('OpenClaw 扩展插件')

  const [state, setState] = useState<LoadState>('idle')
  const [data, setData] = useState<OpenClawPluginStatusResponse | null>(null)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<SelectionKey>('all')
  const [query, setQuery] = useState('')
  const [mutatingPlugin, setMutatingPlugin] = useState('')

  const [storeQuery, setStoreQuery] = useState('')
  const [storeState, setStoreState] = useState<LoadState>('idle')
  const [storeError, setStoreError] = useState('')
  const [storeResults, setStoreResults] = useState<OpenClawPluginSearchResult[]>([])
  const [storeResultsOpen, setStoreResultsOpen] = useState(false)

  const [installOpen, setInstallOpen] = useState(false)
  const [installSpec, setInstallSpec] = useState('')
  const [installForce, setInstallForce] = useState(false)
  const [installLink, setInstallLink] = useState(false)
  const [installUnsafe, setInstallUnsafe] = useState(false)

  const [detailOpen, setDetailOpen] = useState(false)
  const [detailState, setDetailState] = useState<LoadState>('idle')
  const [detailError, setDetailError] = useState('')
  const [detailPlugin, setDetailPlugin] = useState<OpenClawPluginStatus | null>(null)
  const [detailPayload, setDetailPayload] = useState<OpenClawPluginInspectResponse | null>(null)
  const [runtimePayload, setRuntimePayload] = useState<OpenClawPluginInspectResponse | null>(null)

  const [doctorOpen, setDoctorOpen] = useState(false)
  const [doctorState, setDoctorState] = useState<LoadState>('idle')
  const [doctorPayload, setDoctorPayload] = useState<OpenClawPluginDoctorResponse | null>(null)
  const [doctorError, setDoctorError] = useState('')

  const [pluginToUninstall, setPluginToUninstall] = useState<OpenClawPluginStatus | null>(null)

  const loadPlugins = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const payload = await getOpenClawPluginsStatus()
      setData({ ...payload, plugins: normalizePlugins(payload.plugins) })
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OpenClaw 插件状态加载失败')
      setState('error')
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadPlugins()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadPlugins])

  const plugins = useMemo(() => data?.plugins ?? [], [data?.plugins])
  const stats = useMemo(() => getPluginStats(plugins, data), [data, plugins])
  const filteredPlugins = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return plugins
      .filter((plugin) => matchesTab(plugin, String(activeTab) as PluginTab))
      .filter((plugin) => {
        if (!normalizedQuery) return true
        return [pluginID(plugin), pluginName(plugin), plugin.packageName, pluginDescription(plugin), plugin.source, plugin.rootDir, plugin.manifestPath]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery))
      })
      .sort((a, b) => collator.compare(pluginName(a), pluginName(b)))
  }, [activeTab, plugins, query])

  const searchStore = useCallback(async () => {
    const keyword = storeQuery.trim()
    if (!keyword) {
      toast.warning('请输入插件搜索关键词')
      return
    }
    setStoreState('loading')
    setStoreError('')
    try {
      const payload = await searchOpenClawPlugins(keyword, 20)
      setStoreResults(extractStoreResults(payload))
      setStoreResultsOpen(true)
      setStoreState('ready')
    } catch (err) {
      setStoreError(err instanceof Error ? err.message : 'ClawHub 插件搜索失败')
      setStoreState('error')
    }
  }, [storeQuery])

  const installPlugin = useCallback(async (request: OpenClawPluginInstallRequest) => {
    const spec = request.spec.trim()
    if (!spec) return
    setMutatingPlugin(spec)
    try {
      await installOpenClawPlugin({ ...request, spec })
      toast.success('插件安装完成，必要时请重启 Gateway')
      setInstallOpen(false)
      await loadPlugins()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '插件安装失败')
    } finally {
      setMutatingPlugin('')
    }
  }, [loadPlugins])

  const installFromStore = useCallback((result: OpenClawPluginSearchResult) => {
    const spec = pluginInstallSpec(result)
    setInstallSpec(spec)
    void installPlugin({ spec })
  }, [installPlugin])

  const submitManualInstall = useCallback(() => {
    void installPlugin({
      spec: installSpec,
      force: installForce,
      link: installLink,
      dangerouslyForceUnsafeInstall: installUnsafe,
    })
  }, [installForce, installLink, installPlugin, installSpec, installUnsafe])

  const togglePlugin = useCallback(async (plugin: OpenClawPluginStatus) => {
    const id = pluginID(plugin)
    if (!id) return
    setMutatingPlugin(id)
    try {
      if (isPluginEnabled(plugin)) {
        await disableOpenClawPlugin(id)
        toast.success('插件已停用，重启 Gateway 后生效')
      } else {
        await enableOpenClawPlugin(id)
        toast.success('插件已启用，重启 Gateway 后生效')
      }
      await loadPlugins()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '插件启停失败')
    } finally {
      setMutatingPlugin('')
    }
  }, [loadPlugins])

  const openPluginDetail = useCallback(async (plugin: OpenClawPluginStatus) => {
    const id = pluginID(plugin)
    if (!id) return
    setDetailOpen(true)
    setDetailPlugin(plugin)
    setDetailPayload(null)
    setRuntimePayload(null)
    setDetailError('')
    setDetailState('loading')
    try {
      setDetailPayload(await getOpenClawPluginInfo(id))
      setDetailState('ready')
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '插件详情加载失败')
      setDetailState('error')
    }
  }, [])

  const inspectRuntime = useCallback(async () => {
    if (!detailPlugin) return
    const id = pluginID(detailPlugin)
    if (!id) return
    setMutatingPlugin(id)
    try {
      setRuntimePayload(await getOpenClawPluginRuntimeInfo(id))
      toast.success('运行时检查完成')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '运行时检查失败')
    } finally {
      setMutatingPlugin('')
    }
  }, [detailPlugin])

  const refreshRegistry = useCallback(async () => {
    setState('loading')
    try {
      await refreshOpenClawPluginsRegistry()
      toast.success('插件 registry 已刷新')
      await loadPlugins()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '插件 registry 刷新失败')
      setState(data ? 'ready' : 'error')
    }
  }, [data, loadPlugins])

  const runDoctor = useCallback(async () => {
    setDoctorOpen(true)
    setDoctorState('loading')
    setDoctorError('')
    setDoctorPayload(null)
    try {
      setDoctorPayload(await getOpenClawPluginsDoctor())
      setDoctorState('ready')
    } catch (err) {
      setDoctorError(err instanceof Error ? err.message : '插件诊断失败')
      setDoctorState('error')
    }
  }, [])
  const removePlugin = useCallback(async (plugin: OpenClawPluginStatus) => {
    const id = pluginID(plugin)
    if (!id) return
    setPluginToUninstall(plugin)
  }, [])

  const confirmUninstallPlugin = useCallback(async () => {
    if (!pluginToUninstall) return
    const id = pluginID(pluginToUninstall)
    if (!id) return
    setMutatingPlugin(id)
    try {
      await uninstallOpenClawPlugin(id)
      toast.success('插件已卸载，重启 Gateway 后生效')
      setPluginToUninstall(null)
      await loadPlugins()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '插件卸载失败')
    } finally {
      setMutatingPlugin('')
    }
  }, [loadPlugins, pluginToUninstall])

  const isLoading = state === 'loading' && !data
  const refreshButtonVariant = state === 'loading' ? 'danger' : state === 'error' ? 'primary' : 'ghost'

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
                <h2 className="mt-4 text-lg font-semibold text-foreground">无法加载插件状态</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{error}</p>
                <Button className="mt-6" variant={refreshButtonVariant} onPress={loadPlugins} isDisabled={state === 'loading'}>
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
                  <p className="font-medium">无法刷新插件状态</p>
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
              <PluginHubHero
                query={storeQuery}
                state={storeState}
                error={storeError}
                onQueryChange={setStoreQuery}
                onSearch={searchStore}
                onOpenInstall={() => setInstallOpen(true)}
              />
              <PluginStatsCard stats={stats} registrySource={data.registry?.source} workspaceDir={data.workspaceDir} />
            </section>

            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <Segment selectedKey={activeTab} onSelectionChange={setActiveTab}>
                  <Segment.Item id="all"><Segment.Separator />全部</Segment.Item>
                  <Segment.Item id="enabled"><Segment.Separator />已启用</Segment.Item>
                  <Segment.Item id="disabled"><Segment.Separator />已停用</Segment.Item>
                  <Segment.Item id="issues"><Segment.Separator />需关注</Segment.Item>
                </Segment>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <SearchField variant="primary" className="md:w-64" value={query} onChange={setQuery} aria-label="搜索插件">
                    <SearchField.Group>
                      <SearchField.SearchIcon />
                      <SearchField.Input placeholder="搜索..." />
                      <SearchField.ClearButton />
                    </SearchField.Group>
                  </SearchField>
                  <Button variant="tertiary" onPress={refreshRegistry} isDisabled={state === 'loading'}>
                    <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:database-zap'} className={state === 'loading' ? 'animate-spin' : ''} />
                    刷新 Registry
                  </Button>
                  <Button variant="tertiary" onPress={runDoctor}>
                    <Icon icon="lucide:stethoscope" className="size-4" />
                    Doctor
                  </Button>
                  <Button isIconOnly variant={refreshButtonVariant} onPress={loadPlugins} isDisabled={state === 'loading'}>
                    <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
                  </Button>
                </div>
              </div>

           
                  <div className="flex flex-col gap-4">
                    <div className="grid max-h-[calc(100vh-150px)] gap-3 overflow-y-auto xl:grid-cols-2 2xl:grid-cols-3">
                      {filteredPlugins.map((plugin) => {
                        const id = pluginID(plugin)
                        return (
                          <PluginCard
                            key={`${plugin.source || 'unknown'}-${id || pluginName(plugin)}`}
                            plugin={plugin}
                            mutating={mutatingPlugin === id}
                            onShowDetail={openPluginDetail}
                            onToggle={togglePlugin}
                            onUninstall={removePlugin}
                          />
                        )
                      })}
                    </div>

                    {filteredPlugins.length === 0 ? (
                      <EmptyState title="没有匹配的插件" description="尝试切换筛选条件、刷新 registry，或通过 ClawHub / spec 安装插件。" />
                    ) : null}
                  </div>
         
            </section>
          </>
        ) : null}

        <PluginSearchResultsModal
          isOpen={storeResultsOpen}
          query={storeQuery}
          state={storeState}
          results={storeResults}
          mutatingPlugin={mutatingPlugin}
          onInstall={installFromStore}
          onOpenChange={setStoreResultsOpen}
        />
        <ManualInstallModal
          isOpen={installOpen}
          spec={installSpec}
          force={installForce}
          link={installLink}
          unsafe={installUnsafe}
          mutating={Boolean(mutatingPlugin)}
          onSpecChange={setInstallSpec}
          onForceChange={setInstallForce}
          onLinkChange={setInstallLink}
          onUnsafeChange={setInstallUnsafe}
          onSubmit={submitManualInstall}
          onOpenChange={setInstallOpen}
        />
        <PluginDetailModal
          isOpen={detailOpen}
          state={detailState}
          error={detailError}
          plugin={detailPlugin}
          detail={detailPayload}
          runtime={runtimePayload}
          mutating={detailPlugin ? mutatingPlugin === pluginID(detailPlugin) : false}
          onRuntimeInspect={inspectRuntime}
          onOpenChange={setDetailOpen}
          onRetry={() => detailPlugin && openPluginDetail(detailPlugin)}
        />
        <DoctorModal
          isOpen={doctorOpen}
          state={doctorState}
          payload={doctorPayload}
          error={doctorError}
          onRetry={runDoctor}
          onOpenChange={setDoctorOpen}
        />
        <PluginUninstallConfirmDialog
          plugin={pluginToUninstall}
          isOpen={pluginToUninstall !== null}
          isUninstalling={pluginToUninstall ? mutatingPlugin === pluginID(pluginToUninstall) : false}
          onConfirm={confirmUninstallPlugin}
          onOpenChange={(open) => !open && setPluginToUninstall(null)}
        />
      </div>
    </DashboardLayout>
  )
}

function PluginHubHero({
  query,
  state,
  error,
  onQueryChange,
  onSearch,
  onOpenInstall,
}: {
  query: string
  state: LoadState
  error: string
  onQueryChange: (query: string) => void
  onSearch: () => void
  onOpenInstall: () => void
}) {
  const isSearching = state === 'loading'
  return (
    <Card variant="transparent" className="overflow-hidden">
      <Card.Content>
        <div className="flex flex-row items-center gap-4 md:gap-6">
          <div className="flex h-36 shrink-0 items-center justify-center overflow-visible p-1">
            <div className="flex h-36 items-center justify-center shrink-0 overflow-visible p-1">
              <img src="https://assets.orence.net/file/20260513004230577.png" alt="Plugins" className="h-full w-auto" />
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-5 pl-2">
            <div className="min-w-0">
              <Card.Title className="text-2xl font-bold md:text-3xl">扩展插件</Card.Title>
              <Card.Description className="mt-4 text-base md:text-lg">管理 OpenClaw 插件生命周期：发现、安装、启停、诊断、更新与卸载。</Card.Description>
            </div>
            <div className="flex flex-row items-end gap-3 md:pr-6">
              <SearchField variant="primary" className="md:w-64" value={query} onChange={onQueryChange} aria-label="搜索 ClawHub 插件">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="搜索安装插件…" onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      onSearch()
                    }
                  }} />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <Button variant={query.trim() ? 'primary' : 'tertiary'} isIconOnly onPress={onSearch} isDisabled={isSearching}>
                <Icon icon={isSearching ? 'lucide:loader-circle' : 'lucide:search'} className={isSearching ? 'animate-spin' : ''} />
              </Button>
              <Button variant="tertiary" onPress={onOpenInstall}>
                <Icon icon="lucide:box" className="size-4" />
                Spec
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

function PluginStatsCard({ stats, registrySource, workspaceDir }: { stats: PluginStats; registrySource?: string; workspaceDir?: string }) {
  const chartData = [
    { name: '已启用', value: stats.enabled, fill: pluginChartColors.enabled },
    { name: '已停用', value: stats.disabled, fill: pluginChartColors.disabled },
    { name: '需关注', value: stats.issues, fill: pluginChartColors.issues },
  ].filter((item) => item.value > 0)
  const fallbackChartData = [{ name: '暂无数据', value: 1, fill: 'var(--surface-secondary)' }]
  const displayChartData = chartData.length ? chartData : fallbackChartData

  return (
    <Card>
      <Card.Content>
        <div className="flex flex-row items-center gap-6">
          <div className="relative shrink-0">
            <PieChart height={160} width={160}>
              <PieChart.Pie
                cx="50%"
                cy="50%"
                data={displayChartData}
                dataKey="value"
                innerRadius="56%"
                nameKey="name"
                strokeWidth={0}
              >
                {displayChartData.map((item) => (
                  <PieChart.Cell key={item.name} fill={item.fill} />
                ))}
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
            <PluginLegendItem label="已停用" value={stats.disabled} color={pluginChartColors.disabled} />
            <PluginLegendItem label="需关注" value={stats.issues} color={pluginChartColors.issues} />
            <div className="mt-1 flex flex-col gap-1.5 border-t border-divider pt-3 text-xs text-muted">
              <div className="flex items-center justify-between gap-3">
                <span>Registry</span>
                <span className="max-w-[160px] truncate font-medium text-foreground">{registrySource || 'unknown'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Workspace</span>
                <span className="max-w-[160px] truncate font-medium text-foreground">{workspaceDir || 'default'}</span>
              </div>
            </div>
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
}: {
  plugin: OpenClawPluginStatus
  mutating: boolean
  onShowDetail: (plugin: OpenClawPluginStatus) => void
  onToggle: (plugin: OpenClawPluginStatus) => void
  onUninstall: (plugin: OpenClawPluginStatus) => void
}) {
  const id = pluginID(plugin)
  const enabled = isPluginEnabled(plugin)
  const issues = pluginIssueCount(plugin)
  return (
    <Card className="overflow-hidden">
      <Card.Content>
        <div className="flex h-full flex-col gap-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex w-full justify-between gap-2">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                  className={`size-2.5 rounded-full ${enabled ? 'bg-success' : 'bg-danger'}`}
                  aria-label={enabled ? 'Enabled' : 'Disabled'}
                  title={enabled ? 'Enabled' : 'Disabled'}
                />
                {plugin.installed === false ? <Chip size="sm" variant="soft">Discovered</Chip> : null}
                {issues > 0 ? <Chip size="sm" variant="soft">{issues} issues</Chip> : null}
                {plugin.version ? <Chip size="sm" variant="soft">v{plugin.version}</Chip> : null}
                {plugin.packageName ? <Chip size="sm" variant="soft">{plugin.packageName}</Chip> : null}
                {pluginSource(plugin) ? <Chip size="sm" variant="soft">{pluginSource(plugin)}</Chip> : null}
              </div>
              <Switch size="lg" isSelected={enabled} isDisabled={mutating || !id} onChange={() => onToggle(plugin)} aria-label="切换插件启用状态">
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch>
            </div>
          </div>

          <h3 className="truncate text-base font-semibold text-foreground">{pluginName(plugin)}</h3>
          {/* <p className="mt-1 truncate text-xs text-muted">{id || plugin.packageName || 'unknown-plugin'}</p> */}

          <p className="line-clamp-2 min-h-10 text-sm leading-5 text-muted">{pluginDescription(plugin)}</p>

          <div className="mt-auto flex justify-between gap-2">
            <Button isIconOnly size="sm" variant="ghost" onPress={() => onUninstall(plugin)} isDisabled={mutating || !id}>
              <Icon icon="lucide:trash-2" className="size-4" />
            </Button>

            <div className="flex flex-row gap-2">
              <Button size="sm" variant="ghost" onPress={() => onShowDetail(plugin)} isDisabled={!id}>
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
      <ItemCard.Icon>
        <Icon icon={icon} />
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

function PluginSearchResultsModal({
  isOpen,
  query,
  state,
  results,
  mutatingPlugin,
  onInstall,
  onOpenChange,
}: {
  isOpen: boolean
  query: string
  state: LoadState
  results: OpenClawPluginSearchResult[]
  mutatingPlugin: string
  onInstall: (result: OpenClawPluginSearchResult) => void
  onOpenChange: (isOpen: boolean) => void
}) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
              <Icon icon="lucide:shopping-bag" className="size-5" />
            </Modal.Icon>
            <div className="min-w-0">
              <Modal.Heading>{`${query.trim()} 搜索结果`}</Modal.Heading>
              <p className="mt-1 text-sm text-muted">共 {results.length} 个结果，安装将调用 `openclaw plugins install`。</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            {state === 'loading' ? (
              <div className="grid gap-3">
                <Skeleton className="h-20 rounded-2xl" />
                <Skeleton className="h-20 rounded-2xl" />
                <Skeleton className="h-20 rounded-2xl" />
              </div>
            ) : results.length > 0 ? (
              <div className="grid gap-3">
                {results.map((result) => {
                  const spec = pluginInstallSpec(result)
                  const version = pluginSearchVersion(result)
                  const author = pluginSearchAuthor(result)
                  const tags = pluginSearchTags(result)
                  return (
                    <Card key={pluginSearchKey(result)}>
                      <Card.Content>
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <h3 className="truncate font-semibold text-foreground">{pluginSearchName(result)}</h3>
                            <p className="mt-1 line-clamp-2 text-sm text-muted">{pluginSearchDescription(result)}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {version ? <Chip size="sm" variant="soft">v{version}</Chip> : null}
                              {author ? <Chip size="sm" variant="soft">{author}</Chip> : null}
                              {typeof result.score === 'number' ? <Chip size="sm" variant="soft">score {result.score}</Chip> : null}
                              {tags.slice(0, 3).map((tag) => <Chip key={tag} size="sm" variant="soft">{tag}</Chip>)}
                              {spec ? <Chip size="sm" variant="soft">{spec}</Chip> : null}
                            </div>
                          </div>
                          <Button variant="primary" onPress={() => onInstall(result)} isDisabled={!spec || mutatingPlugin === spec}>
                            <Icon icon={mutatingPlugin === spec ? 'lucide:loader-circle' : 'lucide:download'} className={mutatingPlugin === spec ? 'animate-spin' : 'size-4'} />
                            安装
                          </Button>
                        </div>
                      </Card.Content>
                    </Card>
                  )
                })}
              </div>
            ) : (
              <EmptyState title="没有找到远程插件" description="换一个关键词再试，或使用 Spec 安装指定来源。" />
            )}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function ManualInstallModal({
  isOpen,
  spec,
  force,
  link,
  unsafe,
  mutating,
  onSpecChange,
  onForceChange,
  onLinkChange,
  onUnsafeChange,
  onSubmit,
  onOpenChange,
}: {
  isOpen: boolean
  spec: string
  force: boolean
  link: boolean
  unsafe: boolean
  mutating: boolean
  onSpecChange: (value: string) => void
  onForceChange: (value: boolean) => void
  onLinkChange: (value: boolean) => void
  onUnsafeChange: (value: boolean) => void
  onSubmit: () => void
  onOpenChange: (isOpen: boolean) => void
}) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="md">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground"><Icon icon="lucide:terminal" className="size-5" /></Modal.Icon>
            <div>
              <Modal.Heading>安装插件</Modal.Heading>
              <p className="mt-1 text-sm text-muted">支持 clawhub、npm、git、local path、archive 和 marketplace spec。</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="flex flex-col gap-4 p-1">
              <SearchField value={spec} onChange={onSpecChange} aria-label="插件安装 spec">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="clawhub:@openclaw/discord" />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <ItemCardGroup className="overflow-hidden">
                <PluginSwitch
                  description="已存在同名插件时允许覆盖安装。"
                  icon="lucide:refresh-cw"
                  isSelected={force}
                  title="Force 覆盖"
                  onChange={onForceChange}
                />
                <Separator />
                <PluginSwitch
                  description="用于本地路径调试，保持插件目录链接。"
                  icon="lucide:link"
                  isSelected={link}
                  title="Link 本地路径"
                  onChange={onLinkChange}
                />
                <Separator />
                <PluginSwitch
                  description="仅在确认来源可信时开启。"
                  icon="lucide:shield-alert"
                  isSelected={unsafe}
                  title="绕过危险拦截"
                  onChange={onUnsafeChange}
                />
              </ItemCardGroup>
              {/* <div className="rounded-2xl bg-warning/10 p-3 text-sm leading-6 text-warning">
                安装、更新、卸载、启停通常需要重启 OpenClaw Gateway 才能完全生效。
              </div> */}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={() => onOpenChange(false)}>取消</Button>
            <Button variant="primary" onPress={onSubmit} isDisabled={mutating || !spec.trim()}>
              <Icon icon={mutating ? 'lucide:loader-circle' : 'lucide:download'} className={mutating ? 'animate-spin' : 'size-4'} />
              安装
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function PluginDetailModal({
  isOpen,
  state,
  error,
  plugin,
  detail,
  runtime,
  mutating,
  onRuntimeInspect,
  onOpenChange,
  onRetry,
}: {
  isOpen: boolean
  state: LoadState
  error: string
  plugin: OpenClawPluginStatus | null
  detail: OpenClawPluginInspectResponse | null
  runtime: OpenClawPluginInspectResponse | null
  mutating: boolean
  onRuntimeInspect: () => void
  onOpenChange: (isOpen: boolean) => void
  onRetry: () => void
}) {
  const payload = detail ?? plugin
  const detailPlugin = getInspectPlugin(payload)
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground"><Icon icon="lucide:puzzle" className="size-5" /></Modal.Icon>
            <div className="min-w-0">
              <Modal.Heading>{detailPlugin ? pluginName(detailPlugin) : '插件详情'}</Modal.Heading>
              <p className="mt-1 truncate text-sm text-muted">{detailPlugin ? pluginID(detailPlugin) : 'Loading...'}</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            {state === 'loading' ? (
              <div className="grid gap-3"><Skeleton className="h-20 rounded-2xl" /><Skeleton className="h-40 rounded-2xl" /></div>
            ) : error ? (
              <EmptyState title="详情加载失败" description={error} action={<Button variant="primary" onPress={onRetry}>重试</Button>} />
            ) : detailPlugin ? (
              <div className="flex flex-col gap-4">
                <Card><Card.Content><PluginDetailSummary plugin={detailPlugin} /></Card.Content></Card>
                <CapabilityGrid detail={detail} />
                {runtime ? <RuntimeSummary runtime={runtime} /> : null}
                <RawJSONBlock title="静态 inspect JSON" payload={detail ?? detailPlugin} />
                {runtime ? <RawJSONBlock title="运行时 inspect JSON" payload={runtime} /> : null}
              </div>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={() => onOpenChange(false)}>关闭</Button>
            <Button variant="primary" onPress={onRuntimeInspect} isDisabled={mutating || !plugin}>
              <Icon icon={mutating ? 'lucide:loader-circle' : 'lucide:radar'} className={mutating ? 'animate-spin' : 'size-4'} />
              运行时检查
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function getInspectPlugin(payload: OpenClawPluginInspectResponse | OpenClawPluginStatus | null): OpenClawPluginStatus | null {
  if (!payload) return null
  if ('plugin' in payload && payload.plugin && typeof payload.plugin === 'object') return payload.plugin as OpenClawPluginStatus
  return payload
}

function PluginDetailSummary({ plugin }: { plugin: OpenClawPluginStatus }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <InfoLine label="Plugin ID" value={pluginID(plugin)} />
      <InfoLine label="Package" value={plugin.packageName} />
      <InfoLine label="Version" value={plugin.version} />
      <InfoLine label="Source" value={pluginSource(plugin)} />
      <InfoLine label="Manifest" value={plugin.manifestPath} wide />
      <InfoLine label="Root" value={plugin.rootDir} wide />
    </div>
  )
}

function CapabilityGrid({ detail }: { detail: OpenClawPluginInspectResponse | null }) {
  if (!detail) return null
  const items = [
    { label: 'Typed Hooks', value: arrayCount(detail.typedHooks), icon: 'lucide:hook' },
    { label: 'Custom Hooks', value: arrayCount(detail.customHooks), icon: 'lucide:git-branch' },
    { label: 'Tools', value: arrayCount(detail.tools), icon: 'lucide:wrench' },
    { label: 'Commands', value: arrayCount(detail.commands) + arrayCount(detail.cliCommands), icon: 'lucide:terminal-square' },
    { label: 'Services', value: arrayCount(detail.services), icon: 'lucide:server' },
    { label: 'Gateway Methods', value: arrayCount(detail.gatewayMethods), icon: 'lucide:radio-tower' },
  ]
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <Card key={item.label}>
          <Card.Content>
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-xs text-muted">{item.label}</p><p className="text-xl font-semibold tabular-nums text-foreground">{item.value}</p></div>
              <Icon icon={item.icon} className="size-5 text-accent" />
            </div>
          </Card.Content>
        </Card>
      ))}
    </div>
  )
}

function RuntimeSummary({ runtime }: { runtime: OpenClawPluginInspectResponse }) {
  return (
    <Card>
      <Card.Content>
        <div className="flex items-start gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-success/10 text-success"><Icon icon="lucide:check" className="size-5" /></div>
          <div>
            <h3 className="font-semibold text-foreground">运行时检查完成</h3>
            <p className="mt-1 text-sm text-muted">已加载插件 runtime，可查看 tools、hooks、services 和 Gateway 方法。</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Chip size="sm" variant="primary">Tools {arrayCount(runtime.tools)}</Chip>
              <Chip size="sm" variant="primary">Hooks {arrayCount(runtime.typedHooks) + arrayCount(runtime.customHooks)}</Chip>
              <Chip size="sm" variant="primary">Services {arrayCount(runtime.services)}</Chip>
            </div>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function DoctorModal({
  isOpen,
  state,
  payload,
  error,
  onRetry,
  onOpenChange,
}: {
  isOpen: boolean
  state: LoadState
  payload: OpenClawPluginDoctorResponse | null
  error: string
  onRetry: () => void
  onOpenChange: (isOpen: boolean) => void
}) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground"><Icon icon="lucide:stethoscope" className="size-5" /></Modal.Icon>
            <div><Modal.Heading>插件 Doctor</Modal.Heading><p className="mt-1 text-sm text-muted">来自 `openclaw plugins doctor` 的诊断输出。</p></div>
          </Modal.Header>
          <Modal.Body>
            {state === 'loading' ? <Skeleton className="h-64 rounded-2xl" /> : error ? <EmptyState title="诊断失败" description={error} action={<Button variant="primary" onPress={onRetry}>重试</Button>} /> : <pre className="max-h-[60vh] overflow-auto rounded-2xl bg-surface-secondary/50 p-4 text-xs leading-5 text-foreground">{payload?.output || '暂无输出'}</pre>}
          </Modal.Body>
          <Modal.Footer><Button variant="tertiary" onPress={() => onOpenChange(false)}>关闭</Button><Button variant="primary" onPress={onRetry}>重新诊断</Button></Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function PluginUninstallConfirmDialog({
  plugin,
  isOpen,
  isUninstalling,
  onConfirm,
  onOpenChange,
}: {
  plugin: OpenClawPluginStatus | null
  isOpen: boolean
  isUninstalling: boolean
  onConfirm: () => Promise<void>
  onOpenChange: (isOpen: boolean) => void
}) {
  const id = plugin ? pluginID(plugin) : ''
  return (
    <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[480px]">
          <AlertDialog.CloseTrigger />
          <AlertDialog.Header>
            <AlertDialog.Icon status="danger" />
            <AlertDialog.Heading>卸载插件？</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <div className="space-y-3 text-sm leading-6 text-muted">
              <p>
                这会调用 <span className="font-medium text-foreground">openclaw plugins uninstall</span> 卸载插件 <span className="font-semibold text-foreground">{plugin ? pluginName(plugin) : id}</span>。
              </p>
              <div className="rounded-2xl bg-surface-tertiary px-3 py-3">
                <p className="break-all">Plugin ID: {id || '-'}</p>
                {/* <p className="mt-1 break-all">Package: {plugin?.packageName || '-'}</p> */}
                {/* <p className="mt-1 break-all">Source: {plugin ? pluginSource(plugin) || '-' : '-'}</p> */}
              </div>
              <p>卸载后通常需要重启 OpenClaw Gateway 才能完全生效。</p>
            </div>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="tertiary" isDisabled={isUninstalling}>
              取消
            </Button>
            <Button variant="danger" onPress={() => void onConfirm()} isDisabled={isUninstalling || !plugin || !id}>
              <Icon icon={isUninstalling ? 'lucide:loader-circle' : 'lucide:trash-2'} className={isUninstalling ? 'animate-spin' : ''} />
              确认
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}

function InfoLine({ label, value, wide = false }: { label: string; value?: unknown; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 break-all text-sm font-medium text-foreground">{formatValue(value)}</p>
    </div>
  )
}

function RawJSONBlock({ title, payload }: { title: string; payload: unknown }) {
  return (
    <details className="rounded-2xl border border-default bg-surface-secondary/50 p-4">
      <summary className="cursor-pointer text-sm font-medium text-foreground">{title}</summary>
      <pre className="mt-3 max-h-72 overflow-auto text-xs leading-5 text-muted">{JSON.stringify(payload, null, 2)}</pre>
    </details>
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
        <Skeleton className="h-56 rounded-3xl" />
        <Skeleton className="h-56 rounded-3xl" />
        <Skeleton className="h-56 rounded-3xl" />
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

type PluginStats = ReturnType<typeof getPluginStats>

function getPluginStats(plugins: OpenClawPluginStatus[], data: OpenClawPluginStatusResponse | null) {
  const enabled = plugins.filter(isPluginEnabled).length
  const issues = plugins.filter((plugin) => pluginIssueCount(plugin) > 0).length
  const diagnostics = data?.diagnostics?.length ?? 0
  return {
    total: plugins.length,
    enabled,
    disabled: Math.max(plugins.length - enabled, 0),
    issues: issues + diagnostics,
  }
}

function normalizePlugins(plugins?: OpenClawPluginStatus[]) {
  if (!Array.isArray(plugins)) return []
  return plugins.map((plugin) => getPluginStatus(plugin))
}

function getPluginStatus(payload: OpenClawPluginStatus | OpenClawPluginInspectResponse): OpenClawPluginStatus {
  if ('plugin' in payload && payload.plugin && typeof payload.plugin === 'object') return payload.plugin as OpenClawPluginStatus
  return payload as OpenClawPluginStatus
}

function matchesTab(plugin: OpenClawPluginStatus, tab: PluginTab) {
  if (tab === 'enabled') return isPluginEnabled(plugin)
  if (tab === 'disabled') return !isPluginEnabled(plugin)
  if (tab === 'issues') return pluginIssueCount(plugin) > 0
  return true
}

function isPluginEnabled(plugin: OpenClawPluginStatus) {
  return plugin.enabled !== false
}

function pluginIssueCount(plugin: OpenClawPluginStatus) {
  return arrayCount(plugin.diagnostics) + arrayCount(plugin.compat) + arrayCount(plugin.compatibility)
}

function pluginID(plugin: OpenClawPluginStatus) {
  return String(plugin.pluginId || plugin.id || plugin.name || plugin.packageName || '').trim()
}

function pluginName(plugin: OpenClawPluginStatus) {
  return String(plugin.displayName || plugin.name || plugin.pluginId || plugin.id || plugin.packageName || 'Unnamed Plugin')
}

function pluginDescription(plugin: OpenClawPluginStatus) {
  if (typeof plugin.description === 'string' && plugin.description.trim()) return plugin.description

  const capabilityParts = [
    labeledIDs('models', plugin.providerIds),
    labeledIDs('speech', plugin.speechProviderIds),
    labeledIDs('realtime transcription', plugin.realtimeTranscriptionProviderIds),
    labeledIDs('voice', plugin.realtimeVoiceProviderIds),
    labeledIDs('media understanding', plugin.mediaUnderstandingProviderIds),
    labeledIDs('image generation', plugin.imageGenerationProviderIds),
    labeledIDs('video generation', plugin.videoGenerationProviderIds),
    labeledIDs('music generation', plugin.musicGenerationProviderIds),
    labeledIDs('web fetch', plugin.webFetchProviderIds),
    labeledIDs('web search', plugin.webSearchProviderIds),
    labeledIDs('migration', plugin.migrationProviderIds),
    labeledIDs('memory embedding', plugin.memoryEmbeddingProviderIds),
    labeledIDs('agent harness', plugin.agentHarnessIds),
    labeledIDs('commands', plugin.commands),
    labeledIDs('CLI backends', plugin.cliBackendIds),
    labeledIDs('channels', plugin.channelIds),
    labeledIDs('services', plugin.services),
    labeledIDs('gateway discovery', plugin.gatewayDiscoveryServiceIds),
    labeledIDs('gateway methods', plugin.gatewayMethods),
  ].filter(Boolean)

  if (capabilityParts.length > 0) return `Provides ${capabilityParts.join('; ')}.`

  const dependencyStatus = plugin.dependencyStatus && typeof plugin.dependencyStatus === 'object'
    ? plugin.dependencyStatus as Record<string, unknown>
    : null
  const dependencies = dependencyStatus ? arrayCount(dependencyStatus.dependencies) : 0
  if (dependencies > 0) return `OpenClaw ${plugin.format || 'plugin'} extension with ${dependencies} installed dependencies.`

  return `OpenClaw ${plugin.format || 'plugin'} extension${plugin.origin ? ` from ${plugin.origin}` : ''}.`
}

function labeledIDs(label: string, value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return ''
  return `${label}: ${value.map((item) => String(item)).join(', ')}`
}
function pluginSource(plugin: OpenClawPluginStatus) {
  if (typeof plugin.origin === 'string') return formatPluginOrigin(plugin.origin)
  if (plugin.origin && typeof plugin.origin === 'object') {
    const type = 'type' in plugin.origin ? formatPluginOrigin(String(plugin.origin.type)) : ''
    const source = 'source' in plugin.origin ? String(plugin.origin.source) : ''
    return [type, source].filter(Boolean).join(':')
  }
  return plugin.source
}

function formatPluginOrigin(origin: string) {
  if (origin === 'bundled') return '内置'
  return origin
}

function extractStoreResults(payload: unknown) {
  const results = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? ((payload as { results?: OpenClawPluginSearchResult[]; plugins?: OpenClawPluginSearchResult[]; items?: OpenClawPluginSearchResult[] }).results
        ?? (payload as { plugins?: OpenClawPluginSearchResult[] }).plugins
        ?? (payload as { items?: OpenClawPluginSearchResult[] }).items
        ?? [])
      : []

  return results.map((result) => normalizePluginSearchResult(result as OpenClawPluginSearchResult))
}

function normalizePluginSearchResult(result: OpenClawPluginSearchResult): OpenClawPluginSearchResult {
  const registryPackage = pluginSearchPackage(result)
  if (!registryPackage) return result

  return {
    ...result,
    displayName: result.displayName ?? registryPackage.displayName,
    name: result.name ?? registryPackage.name,
    pluginId: result.pluginId ?? registryPackage.runtimeId,
    summary: result.summary ?? registryPackage.summary,
    version: result.version ?? registryPackage.latestVersion ?? null,
    author: result.author ?? registryPackage.ownerHandle,
    updatedAt: result.updatedAt ?? registryPackage.updatedAt ?? null,
  }
}

function pluginSearchPackage(result: OpenClawPluginSearchResult) {
  return result.package && typeof result.package === 'object' && !Array.isArray(result.package) ? result.package : undefined
}

function pluginSearchKey(result: OpenClawPluginSearchResult) {
  return pluginInstallSpec(result) || `${pluginSearchName(result)}-${result.score ?? ''}`
}

function pluginSearchName(result: OpenClawPluginSearchResult) {
  const registryPackage = pluginSearchPackage(result)
  return String(result.displayName || registryPackage?.displayName || result.title || result.name || registryPackage?.name || result.pluginId || registryPackage?.runtimeId || result.packageName || 'Unnamed Plugin')
}

function pluginSearchDescription(result: OpenClawPluginSearchResult) {
  const registryPackage = pluginSearchPackage(result)
  return String(result.description || result.summary || registryPackage?.summary || '未提供描述。')
}

function pluginSearchVersion(result: OpenClawPluginSearchResult) {
  const registryPackage = pluginSearchPackage(result)
  return String(result.version || registryPackage?.latestVersion || '').trim()
}

function pluginSearchAuthor(result: OpenClawPluginSearchResult) {
  const registryPackage = pluginSearchPackage(result)
  return String(result.author || registryPackage?.ownerHandle || '').trim()
}

function pluginSearchTags(result: OpenClawPluginSearchResult) {
  const directTags = Array.isArray(result.capabilityTags) ? result.capabilityTags : []
  const registryPackage = pluginSearchPackage(result)
  const packageTags = Array.isArray(registryPackage?.capabilityTags) ? registryPackage.capabilityTags : []
  return [...directTags, ...packageTags].map((tag) => String(tag)).filter(Boolean)
}

function pluginInstallSpec(result: OpenClawPluginSearchResult) {
  const registryPackage = pluginSearchPackage(result)
  const explicit = String(result.installSpec || result.install || '').trim()
  if (explicit) return explicit.replace(/^openclaw\s+plugins\s+install\s+/, '')
  const packageName = String(result.packageName || result.name || registryPackage?.name || result.pluginId || result.id || registryPackage?.runtimeId || '').trim()
  if (!packageName) return ''
  return packageName.startsWith('clawhub:') || packageName.startsWith('npm:') || packageName.startsWith('git:') ? packageName : `clawhub:${packageName}`
}

function arrayCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0
}

function formatValue(value: unknown) {
  if (value == null || value === '') return '—'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

export default OpenClawPluginsPage
