import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Chip, Modal, SearchField, Skeleton, Switch, toast } from '@heroui/react'
import { PieChart, Segment } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type {
  OpenClawShowcaseHotSkill,
  OpenClawSkillDependencyInstallRequest,
  OpenClawSkillInstallOption,
  OpenClawSkillInstallRequest,
  OpenClawSkillSearchResult,
  OpenClawSkillStatus,
  OpenClawSkillsStatusResponse,
  OpenClawSkillUpdateRequest,
} from '@/api'
import SkillMarkdownViewer from '@/components/SkillMarkdownViewer'
import {
  getOpenClawConfig,
  getOpenClawSkillInfo,
  getOpenClawSkillsStatus,
  getOpenClawSkillsShowcaseHot,
  installOpenClawSkill,
  installOpenClawSkillDependency,
  resolveOpenClawGatewayWebSocketURL,
  OpenClawGatewayClient,
  searchOpenClawSkills,
  updateOpenClawSkill,
} from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { openExternalUrl } from '@/utils/openExternalUrl'
import DashboardLayout from '@/layouts/Dashboard'
import { useOpenClawEnvironmentStore } from '@/stores/openclaw-environment'

const collator = new Intl.Collator('zh-CN')

const skillChartColors = {
  ready: 'var(--success)',
  missing: 'var(--warning)',
  disabled: 'var(--danger)',
  blocked: 'var(--muted)',
}

type SkillTab = 'all' | 'ready' | 'missing' | 'disabled' | 'blocked'
type SkillViewMode = 'local' | 'discover'
type SelectionKey = string | number

function OpenClawSkillsPage() {
  usePageTitle('OpenClaw 技能中心')
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [data, setData] = useState<OpenClawSkillsStatusResponse | null>(null)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<SelectionKey>('all')
  const [viewMode, setViewMode] = useState<SkillViewMode>('local')
  const [query, setQuery] = useState('')
  const [mutatingSkill, setMutatingSkill] = useState('')
  const [storeQuery, setStoreQuery] = useState('')
  const [storeState, setStoreState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [storeError, setStoreError] = useState('')
  const [storeResults, setStoreResults] = useState<OpenClawSkillSearchResult[]>([])
  const [storeResultsOpen, setStoreResultsOpen] = useState(false)
  const [discoverState, setDiscoverState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [discoverError, setDiscoverError] = useState('')
  const [discoverSkills, setDiscoverSkills] = useState<OpenClawShowcaseHotSkill[]>([])
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailSkill, setDetailSkill] = useState<OpenClawSkillStatus | null>(null)
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [detailError, setDetailError] = useState('')

  const loadSkills = useCallback(async () => {
    setState('loading')
    setError('')

    try {
      const payload = await getOpenClawSkillsStatusPreferGateway()
      setData(payload)
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OpenClaw 技能状态加载失败')
      setState('error')
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSkills()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadSkills])

  const skills = useMemo(() => data?.skills ?? [], [data?.skills])
  const stats = useMemo(() => getSkillStats(skills), [skills])
  const filteredSkills = useMemo(() => {
    const normalizedQuery = query.trim()
    return skills
      .filter((skill) => matchesTab(skill, String(activeTab) as SkillTab))
      .filter((skill) => skillMatchesQuery(skill, normalizedQuery))
      .sort((a, b) => collator.compare(a.name, b.name))
  }, [activeTab, query, skills])
  const installedSkillKeys = useMemo(() => new Set(
    skills.flatMap((skill) => [skill.name, skill.skillKey])
      .filter(Boolean)
      .map((value) => normalizeSkillKey(String(value))),
  ), [skills])

  const loadDiscoverSkills = useCallback(async (refresh = false) => {
    setDiscoverState('loading')
    setDiscoverError('')
    try {
      const payload = await getOpenClawSkillsShowcaseHot(refresh)
      setDiscoverSkills(payload.skills ?? [])
      setDiscoverState('ready')
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : 'SkillHub 热榜加载失败')
      setDiscoverState('error')
    }
  }, [])

  useEffect(() => {
    if (viewMode === 'discover' && discoverState === 'idle') {
      const timer = window.setTimeout(() => {
        void loadDiscoverSkills()
      }, 0)

      return () => window.clearTimeout(timer)
    }
  }, [discoverState, loadDiscoverSkills, viewMode])

  const toggleSkill = useCallback(async (skill: OpenClawSkillStatus) => {
    const skillKey = skill.skillKey || skill.name
    setMutatingSkill(skillKey)
    try {
      await updateOpenClawSkillPreferGateway(skillKey, { enabled: skill.disabled })
      toast.success(skill.disabled ? '技能已启用' : '技能已停用')
      await loadSkills()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '技能配置更新失败')
    } finally {
      setMutatingSkill('')
    }
  }, [loadSkills])

  const searchStore = useCallback(async () => {
    setStoreState('loading')
    setStoreError('')
    try {
      const payload = await searchOpenClawSkillsPreferGateway(storeQuery.trim(), 20)
      const results = extractStoreResults(payload)
      setStoreResults(results)
      setStoreResultsOpen(true)
      setStoreState('ready')
    } catch (err) {
      setStoreError(err instanceof Error ? err.message : '技能商店搜索失败')
      setStoreState('error')
    }
  }, [storeQuery])

  const installStoreSkill = useCallback(async (result: OpenClawSkillSearchResult) => {
    const slug = result.slug || result.name
    if (!slug) return
    setMutatingSkill(slug)
    try {
      await installOpenClawSkillPreferGateway({ slug, source: result.source })
      toast.success('技能安装完成')
      await loadSkills()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '技能安装失败')
    } finally {
      setMutatingSkill('')
    }
  }, [loadSkills])

  const installDiscoverSkill = useCallback(async (skill: OpenClawShowcaseHotSkill) => {
    const slug = skill.slug?.trim()
    if (!slug || installedSkillKeys.has(normalizeSkillKey(slug))) return
    setMutatingSkill(slug)
    try {
      await installOpenClawSkillPreferGateway({ slug, source: 'skillhub' })
      toast.success('技能安装完成')
      await loadSkills()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '技能安装失败')
    } finally {
      setMutatingSkill('')
    }
  }, [installedSkillKeys, loadSkills])

  const openSkillDetail = useCallback(async (skill: OpenClawSkillStatus) => {
    setDetailOpen(true)
    setDetailSkill(skill)
    setDetailError('')
    setDetailState('loading')
    try {
      const payload = await getOpenClawSkillInfo(skill.skillKey || skill.name)
      setDetailSkill({ ...skill, ...payload })
      setDetailState('ready')
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '技能详情加载失败')
      setDetailState('error')
    }
  }, [])

  const installDependency = useCallback(async (skill: OpenClawSkillStatus, option: OpenClawSkillInstallOption) => {
    const installId = option.id?.trim()
    if (!installId) return
    const skillKey = skill.skillKey || skill.name
    setMutatingSkill(skillKey)
    try {
      await installOpenClawSkillDependencyPreferGateway({ name: skill.name, installId })
      toast.success('依赖安装完成')
      await loadSkills()
      if (detailOpen && detailSkill?.name === skill.name) {
        await openSkillDetail(skill)
      }
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '依赖安装失败')
    } finally {
      setMutatingSkill('')
    }
  }, [detailOpen, detailSkill, loadSkills, openSkillDetail])

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
                <h2 className="mt-4 text-lg font-semibold text-foreground">无法加载技能状态</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{error}</p>
                <Button className="mt-6" variant={refreshButtonVariant} onPress={loadSkills} isDisabled={state === 'loading'}>
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
                  <p className="font-medium">无法加载技能状态</p>
                  <p className="mt-1 text-sm text-muted">{error}</p>
                </div>
              </div>
            </Card.Content>
          </Card>
        ) : null}

        {isLoading ? <SkillsSkeleton /> : null}

        {data ? (
          <>
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
              <ClawHubInstallCard
                query={storeQuery}
                state={storeState}
                error={storeError}
                onQueryChange={setStoreQuery}
                onSearch={searchStore}
              />

              <SkillStatusPieChart stats={stats} />
            </section>

            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">

                {viewMode === 'local' ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <Segment selectedKey={activeTab} onSelectionChange={setActiveTab}>
                      <Segment.Item id="all">
                        <Segment.Separator />
                        全部
                      </Segment.Item>
                      <Segment.Item id="ready">
                        <Segment.Separator />
                        可用
                      </Segment.Item>
                      <Segment.Item id="missing">
                        <Segment.Separator />
                        缺依赖
                      </Segment.Item>
                      <Segment.Item id="disabled">
                        <Segment.Separator />
                        已停用
                      </Segment.Item>
                      <Segment.Item id="blocked">
                        <Segment.Separator />
                        被阻止
                      </Segment.Item>
                    </Segment>
                    <Button variant="tertiary" onPress={() => setViewMode('discover')}>
                      <Icon icon="lucide:sparkles" />
                      发现
                    </Button>
                  </div>
                ) : (
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground">
                      <Icon icon="lucide:sparkles" className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="font-semibold text-lg text-foreground">发现技能</h2>
                    </div>
                  </div>
                )}

                {viewMode === 'local' ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <SearchField variant="primary" className="md:w-64" value={query} onChange={setQuery} aria-label="搜索技能">
                      <SearchField.Group>
                        <SearchField.SearchIcon />
                        <SearchField.Input placeholder="搜索..." />
                        <SearchField.ClearButton />
                      </SearchField.Group>
                    </SearchField>
                    <Button isIconOnly variant={refreshButtonVariant} onPress={loadSkills} isDisabled={state === 'loading'}>
                      <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
                    </Button>
                  </div>
                ) : (
                  <Button isIconOnly variant="primary" onPress={() => setViewMode('local')} aria-label="关闭发现">
                    <Icon icon="lucide:x" />
                  </Button>
                )}
              </div>


              <div className="flex flex-col gap-4">
                {viewMode === 'local' ? (
                  <>
                    <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3 max-h-[calc(100vh-150px)] overflow-y-auto">
                      {filteredSkills.map((skill) => (
                        <SkillCard
                          key={`${skill.source || 'unknown'}-${skill.name}`}
                          skill={skill}
                          mutating={mutatingSkill === (skill.skillKey || skill.name)}
                          onShowDetail={openSkillDetail}
                          onToggle={toggleSkill}
                        />
                      ))}
                    </div>

                    {filteredSkills.length === 0 ? (
                      <EmptyState title="没有匹配的技能" description="尝试切换筛选条件或清空搜索关键词。" />
                    ) : null}
                  </>
                ) : (
                  <DiscoverSkillsPanel
                    state={discoverState}
                    error={discoverError}
                    skills={discoverSkills}
                    installedSkillKeys={installedSkillKeys}
                    mutatingSkill={mutatingSkill}
                    onInstall={installDiscoverSkill}
                    onRefresh={() => loadDiscoverSkills(true)}
                  />
                )}
              </div>

            </section>
          </>
        ) : null}
        <ClawHubSearchResultsModal
          isOpen={storeResultsOpen}
          query={storeQuery}
          state={storeState}
          results={storeResults}
          mutatingSkill={mutatingSkill}
          onInstall={installStoreSkill}
          onOpenChange={setStoreResultsOpen}
        />
        {detailSkill ? (
          <SkillDetailModal
            skill={detailSkill}
            isOpen={detailOpen}
            state={detailState}
            error={detailError}
            mutating={mutatingSkill === (detailSkill.skillKey || detailSkill.name)}
            onInstallDependency={installDependency}
            onOpenChange={setDetailOpen}
            onRetry={() => openSkillDetail(detailSkill)}
          />
        ) : null}
      </div>
    </DashboardLayout>
  )
}

type SkillStats = ReturnType<typeof getSkillStats>

function ClawHubInstallCard({
  query,
  state,
  error,
  onQueryChange,
  onSearch,
}: {
  query: string
  state: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  onQueryChange: (query: string) => void
  onSearch: () => void
}) {
  const isSearching = state === 'loading'

  return (
    <Card variant="transparent" className="overflow-hidden">
      <Card.Content>
        <div className="md:gap-6 gap-4 flex flex-row items-center">
          <div className="flex h-36 items-center justify-center shrink-0 overflow-visible p-1">
            <img src="https://assets.orence.net/file/20260512222532254.png" alt="System Overview" className="h-full w-auto" />
          </div>

          <div className="flex min-w-0 flex-col gap-5 w-full pl-2">
            <div className="min-w-0">
              <Card.Title className="md:text-3xl text-2xl font-bold">AI Skills</Card.Title>
              <Card.Description className="mt-4 md:text-lg text-base">发现技能，安装到当前 OpenClaw 工作区。</Card.Description>
            </div>

            <div className="flex gap-3 flex-row items-end md:pr-6">
              <SearchField variant="primary" className="md:w-64" value={query} onChange={onQueryChange} aria-label="搜索技能商店">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="搜索安装技能…" onKeyDown={(event) => {
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

function ClawHubSearchResultsModal({
  isOpen,
  query,
  state,
  results,
  mutatingSkill,
  onInstall,
  onOpenChange,
}: {
  isOpen: boolean
  query: string
  state: 'idle' | 'loading' | 'ready' | 'error'
  results: OpenClawSkillSearchResult[]
  mutatingSkill: string
  onInstall: (result: OpenClawSkillSearchResult) => void
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
              <p className="mt-1 text-sm text-muted">共 {results.length} 个结果，安装到当前 OpenClaw 工作区</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            {state === 'loading' ? (
              <div className="grid gap-3">
                <Skeleton className="h-16 rounded-2xl" />
                <Skeleton className="h-16 rounded-2xl" />
                <Skeleton className="h-16 rounded-2xl" />
              </div>
            ) : results.length > 0 ? (
              <div className="flex flex-col gap-3">
                <div className="grid gap-3">
                  {results.map((result) => (
                    <StoreSkillCard
                      key={result.slug || result.name || result.title}
                      result={result}
                      mutating={mutatingSkill === (result.slug || result.name)}
                      onInstall={onInstall}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState title="没有找到远程技能" description="换一个关键词再试。" />
            )}
          </Modal.Body>
          {/* <Modal.Footer>
            <Button variant="tertiary" onPress={() => onOpenChange(false)}>
              关闭
            </Button>
          </Modal.Footer> */}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function SkillStatusPieChart({ stats }: { stats: SkillStats }) {
  const chartData = [
    { name: '可用', value: stats.ready, fill: skillChartColors.ready },
    { name: '缺依赖', value: stats.missing, fill: skillChartColors.missing },
    { name: '已停用', value: stats.disabled, fill: skillChartColors.disabled },
    { name: '被阻止', value: stats.blocked, fill: skillChartColors.blocked },
  ].filter((item) => item.value > 0)

  return (
    <Card>
      <Card.Content>
        <div className="flex flex-row items-center gap-6">
          <div className="relative shrink-0">
            <PieChart height={160} width={160}>
              <PieChart.Pie
                // cornerRadius={12}
                cx="50%"
                cy="50%"
                data={chartData.length ? chartData : [{ name: '暂无数据', value: 1, fill: 'var(--surface-secondary)' }]}
                dataKey="value"
                innerRadius="56%"
                nameKey="name"
                strokeWidth={0}
              >
                {(chartData.length ? chartData : [{ name: '暂无数据', value: 1, fill: 'var(--surface-secondary)' }]).map((item) => (
                  <PieChart.Cell key={item.name} fill={item.fill} />
                ))}
              </PieChart.Pie>
              <PieChart.Tooltip content={<PieChart.TooltipContent />} />
            </PieChart>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold tabular-nums text-foreground">{stats.total}</span>
              <span className="text-[10px] text-muted">全部技能</span>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-3">
            <SkillLegendItem label="可用" value={stats.ready} color={skillChartColors.ready} />
            <SkillLegendItem label="缺依赖" value={stats.missing} color={skillChartColors.missing} />
            <SkillLegendItem label="已停用" value={stats.disabled} color={skillChartColors.disabled} />
            <SkillLegendItem label="被阻止" value={stats.blocked} color={skillChartColors.blocked} />
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function SkillLegendItem({ label, value, color }: { label: string; value: number; color: string }) {
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
type SkillCardProps = {
  skill: OpenClawSkillStatus
  mutating: boolean
  onShowDetail: (skill: OpenClawSkillStatus) => void
  onToggle: (skill: OpenClawSkillStatus) => void
}

function SkillCard({
  skill,
  mutating,
  onShowDetail,
  onToggle,
}: SkillCardProps) {
  const missing = flattenMissing(skill.missing)
  const statusChip = getSkillStatusChip(skill)
  return (
    <Card>
      <Card.Content>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg leading-none">{skill.emoji || '✦'}</span>
              <h3 className="truncate font-semibold text-foreground">{skill.name}</h3>
              {statusChip ? <Chip size="sm" variant="soft" color={statusChip.color}>{statusChip.label}</Chip> : null}
              {skill.bundled ? <Chip size="sm" variant="soft">内置</Chip> : null}
            </div>
            <p className="mt-2 line-clamp-1 text-sm leading-6 text-muted">{skill.description || '无描述'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button isIconOnly size="sm" variant="ghost" onPress={() => onShowDetail(skill)}>
              <Icon icon={missing.length > 0 ? 'lucide:triangle-alert' : 'lucide:info'} />
            </Button>
            <Switch
              aria-label={`${skill.disabled ? '启用' : '停用'} ${skill.name}`}
              isDisabled={mutating}
              isSelected={!skill.disabled}
              size="lg"
              onChange={() => onToggle(skill)}
            >
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
          </div>
        </div>
        {skill.filePath ? <p className="truncate text-xs text-muted">{skill.filePath}</p> : null}
      </Card.Content>
    </Card>
  )
}

function SkillDetailModal({
  skill,
  isOpen,
  state,
  mutating,
  error,
  onInstallDependency,
  onOpenChange,
  onRetry,
}: {
  skill: OpenClawSkillStatus
  isOpen: boolean
  state: 'idle' | 'loading' | 'ready' | 'error'
  mutating: boolean
  error: string
  onInstallDependency: (skill: OpenClawSkillStatus, option: OpenClawSkillInstallOption) => void
  onOpenChange: (isOpen: boolean) => void
  onRetry: () => void
}) {
  const missing = flattenMissing(skill.missing)
  const requirements = flattenRequirements(skill.requirements)
  const installOptions = getInstallOptions(skill)
  const skillContent = skill.skillContent ?? ''
  const skillContentError = skill.skillContentError ?? ''

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="lg">
        <Modal.Dialog className="sm:max-w-[1040px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
              <Icon icon="lucide:badge-info" className="size-5" />
            </Modal.Icon>
            <div className="min-w-0">
              <Modal.Heading>{skill.name}</Modal.Heading>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted">{skill.description || '无描述'}</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="grid h-[min(68dvh,760px)] gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
              <div className="min-h-0 overflow-y-auto">
                <div className="flex flex-col gap-4">
                  {state === 'error' ? (
                    <Card className="bg-danger/10 text-danger">
                      <Card.Content>
                        <div className="flex items-start gap-3">
                          <Icon icon="lucide:circle-alert" className="mt-0.5 size-5" />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium">技能详情加载失败</p>
                            <p className="mt-1 text-sm leading-6 text-muted">{error}</p>
                          </div>
                          <Button size="sm" variant="danger" onPress={onRetry}>
                            重试
                          </Button>
                        </div>
                      </Card.Content>
                    </Card>
                  ) : null}

                  <Card>
                    <Card.Content>
                      <div className="grid gap-2 text-xs text-muted">
                        <MetaItem icon="lucide:folder" label="来源" value={skill.source || '-'} />
                        <MetaItem icon="lucide:key" label="Skill Key" value={skill.skillKey || skill.name} />
                        <MetaItem icon="lucide:brain" label="模型可见" value={skill.modelVisible ? '是' : '否'} />
                        <MetaItem icon="lucide:command" label="命令可见" value={skill.commandVisible ? '是' : '否'} />
                        <MetaItem icon="lucide:mouse-pointer-click" label="用户可调用" value={skill.userInvocable ? '是' : '否'} />
                        <MetaItem icon="lucide:package-check" label="内置" value={skill.bundled ? '是' : '否'} />
                      </div>
                    </Card.Content>
                  </Card>

                  <DetailBlock title="状态" icon="lucide:activity">
                    <div className="flex flex-wrap gap-1.5">
                      <Chip size="sm" variant="soft" color={getSkillTone(skill).color}>{getSkillTone(skill).label}</Chip>
                      {skill.always ? <Chip size="sm" variant="soft">Always</Chip> : null}
                      {skill.blockedByAllowlist ? <Chip size="sm" variant="soft" color="warning">Allowlist 阻止</Chip> : null}
                      {skill.blockedByAgentFilter ? <Chip size="sm" variant="soft" color="warning">Agent 过滤</Chip> : null}
                    </div>
                  </DetailBlock>

                  <DetailBlock title="依赖要求" icon="lucide:list-checks">
                    {requirements.length > 0 ? <ChipList items={requirements} /> : <p className="text-sm text-muted">无声明依赖</p>}
                  </DetailBlock>

                  <Card>
                    <Card.Header>
                      <div className="flex items-center gap-2">
                        <Icon icon="lucide:triangle-alert" className="size-4 text-muted" />
                        <Card.Title className="text-sm">缺失依赖</Card.Title>
                      </div>
                    </Card.Header>
                    <Card.Content>
                      {missing.length > 0 ? (
                        <div className="flex flex-col gap-3">
                          <ChipList items={missing} color="warning" />
                          {hasInstallableMissing(skill) && installOptions.length === 0 ? (
                            <p className="text-xs leading-5 text-muted">该技能没有声明自动安装器，需要手动安装缺失的 bin/运行环境。</p>
                          ) : null}
                          {hasConfigurableMissing(skill) ? (
                            <p className="text-xs leading-5 text-muted">env/config 缺失需要在 OpenClaw 配置里补齐，支持通过技能配置写入 `skills.entries`。</p>
                          ) : null}
                        </div>
                      ) : <p className="text-sm text-muted">未检测到缺失依赖</p>}
                    </Card.Content>
                  </Card>

                  {installOptions.length > 0 ? (
                    <DetailBlock title="安装器" icon="lucide:download">
                      <div className="grid gap-2">
                        {installOptions.map((option) => (
                          <div key={option.id || option.label || option.kind} className="rounded-xl bg-surface-secondary/50 px-3 py-2 text-sm">
                            <div className="font-medium text-foreground">{formatInstallOptionLabel(option)}</div>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {option.kind ? <Chip size="sm" variant="soft">{option.kind}</Chip> : null}
                              {option.bins?.map((bin) => <Chip key={bin} size="sm" variant="soft">bin:{bin}</Chip>)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </DetailBlock>
                  ) : null}

                  <DetailBlock title="路径与链接" icon="lucide:link">
                    <div className="grid gap-2 text-sm">
                      {skill.homepage ? <PathRow label="Homepage" value={skill.homepage} /> : null}
                      {skill.baseDir ? <PathRow label="Base Dir" value={skill.baseDir} /> : null}
                      {skill.filePath ? <PathRow label="Skill File" value={skill.filePath} /> : null}
                    </div>
                  </DetailBlock>
                </div>
              </div>

              <Card className="min-h-0">
                <Card.Header>
                  <div className="flex items-center gap-2">
                    <Icon icon="lucide:file-text" className="size-4 text-muted" />
                    <Card.Title className="text-sm">SKILL.md</Card.Title>
                  </div>
                </Card.Header>
                <Card.Content className="min-h-0">
                  {state === 'loading' ? (
                    <div className="grid gap-3">
                      <Skeleton className="h-4 rounded-lg" />
                      <Skeleton className="h-4 rounded-lg" />
                      <Skeleton className="h-4 rounded-lg" />
                      <Skeleton className="h-48 rounded-2xl" />
                    </div>
                  ) : skillContentError ? (
                    <div className="flex min-h-48 flex-col items-center justify-center text-center">
                      <Icon icon="lucide:circle-alert" className="size-8 text-danger" />
                      <p className="mt-3 text-sm text-muted">{skillContentError}</p>
                    </div>
                  ) : (
                    <SkillMarkdownViewer className="max-h-[calc(min(72dvh,760px)-72px)]" content={skillContent} empty="未读取到 SKILL.md 内容" />
                  )}
                </Card.Content>
              </Card>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={() => onOpenChange(false)}>
              取消
            </Button>
            {state !== 'loading' && missing.length > 0 ? installOptions.map((option) => {
              const installId = option.id?.trim()
              return (
                <Button key={installId || option.label || option.kind} variant="primary" onPress={() => onInstallDependency(skill, option)} isDisabled={!installId || mutating}>
                  <Icon icon={mutating ? 'lucide:loader-circle' : 'lucide:download'} className={mutating ? 'animate-spin' : ''} />
                  {formatInstallOptionLabel(option)}
                </Button>
              )
            }) : null}
          </Modal.Footer>
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

function ChipList({ items, color }: { items: string[]; color?: 'warning' }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => <Chip key={item} size="sm" variant="soft" color={color}>{item}</Chip>)}
    </div>
  )
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

function StoreSkillCard({ result, mutating, onInstall }: { result: OpenClawSkillSearchResult; mutating: boolean; onInstall: (result: OpenClawSkillSearchResult) => void }) {
  const slug = result.slug || result.name || result.title || ''
  const title = getStoreSkillTitle(result)
  const description = getStoreSkillDescription(result)
  return (
    <Card>
      <Card.Content>
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-surface-secondary/50 text-foreground">
            <Icon icon="lucide:package-plus" className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="truncate text-sm font-medium text-foreground">{title}</h4>
            <p className="mt-1 line-clamp-2 max-h-10 overflow-hidden text-sm leading-5 text-muted break-words">{description}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {slug ? <Chip size="sm" variant="soft">{slug}</Chip> : null}
              {result.source ? <Chip size="sm" variant="soft">{result.source}</Chip> : null}
              {result.version ? <Chip size="sm" variant="soft">v{result.version}</Chip> : null}
              {result.author ? <Chip size="sm" variant="soft">{result.author}</Chip> : null}
            </div>
          </div>
          <Button className="shrink-0" size="sm" variant="outline" onPress={() => onInstall(result)} isDisabled={!slug || mutating}>
            <Icon icon={mutating ? 'lucide:loader-circle' : 'lucide:download'} className={mutating ? 'animate-spin' : ''} />
            安装
          </Button>
        </div>
      </Card.Content>
    </Card>
  )
}

function DiscoverSkillsPanel({
  state,
  error,
  skills,
  installedSkillKeys,
  mutatingSkill,
  onInstall,
  onRefresh,
}: {
  state: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  skills: OpenClawShowcaseHotSkill[]
  installedSkillKeys: Set<string>
  mutatingSkill: string
  onInstall: (skill: OpenClawShowcaseHotSkill) => void
  onRefresh: () => void
}) {
  if (state === 'loading') {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-20 rounded-2xl" />
      </div>
    )
  }

  if (state === 'error') {
    return (
      <Card className="bg-danger/10 text-danger">
        <Card.Content>
          <div className="flex items-start gap-3">
            <Icon icon="lucide:circle-alert" className="mt-0.5 size-5" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">SkillHub 热榜加载失败</p>
              <p className="mt-1 text-sm leading-6 text-muted">{error}</p>
            </div>
            <Button size="sm" variant="danger" onPress={onRefresh}>
              重试
            </Button>
          </div>
        </Card.Content>
      </Card>
    )
  }

  return (
    <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
      {skills.map((skill) => {
        const slug = skill.slug.trim()
        const installed = installedSkillKeys.has(normalizeSkillKey(slug))
        return (
          <DiscoverSkillCard
            key={slug}
            installed={installed}
            mutating={mutatingSkill === slug}
            skill={skill}
            onInstall={onInstall}
          />
        )
      })}
      {skills.length === 0 ? (
        <EmptyState title="没有热榜技能" description="SkillHub 当前没有返回可展示的热门技能。" />
      ) : null}
    </div>
  )
}

function DiscoverSkillCard({
  skill,
  installed,
  mutating,
  onInstall,
}: {
  skill: OpenClawShowcaseHotSkill
  installed: boolean
  mutating: boolean
  onInstall: (skill: OpenClawShowcaseHotSkill) => void
}) {
  const detailUrl = `https://skillhub.cn/skills/${encodeURIComponent(skill.slug)}`
  const description = skill.descriptionZh || skill.description || '暂无描述'

  return (
    <Card>
      <Card.Content>
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-surface-secondary/50 text-foreground">
            <Icon icon="lucide:flame" className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h4 className="truncate text-sm font-bold text-foreground">{skill.name}</h4>

              </div>
              <Button isIconOnly size="sm" variant="ghost" onPress={() => void openExternalUrl(detailUrl)} aria-label="查看详情">
                <Icon icon="lucide:external-link" />
              </Button>
            </div>

          </div>
          <Button
            className="shrink-0"
            size="sm"
            variant={installed ? 'ghost' : 'outline'}
            onPress={() => onInstall(skill)}
            isDisabled={installed || mutating}
          >
            <Icon icon={mutating ? 'lucide:loader-circle' : installed ? 'lucide:check' : 'lucide:download'} className={mutating ? 'animate-spin' : ''} />
            {installed ? '安装' : '安装'}
          </Button>
        </div>
        <p className="mt-1 line-clamp-2 max-h-10 overflow-hidden text-sm leading-5 text-muted break-words">{description}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
       
          <Chip size="sm" variant="soft">{skill.slug}</Chip>
          {skill.version ? <Chip size="sm" variant="soft">v{skill.version}</Chip> : null}
          {skill.ownerName ? <Chip size="sm" variant="soft">{skill.ownerName}</Chip> : null}
          {skill.category ? <Chip size="sm" variant="soft">{skill.category}</Chip> : null}
          {installed ? <Chip size="sm" variant="soft" color="success">已安装</Chip> : null}
        </div>
      </Card.Content>
    </Card>
  )
}

function getStoreSkillTitle(result: OpenClawSkillSearchResult) {
  return result.displayName || result.title || result.name || result.slug || '未知技能'
}

function getStoreSkillDescription(result: OpenClawSkillSearchResult) {
  return result.summary || result.description || '暂无描述'
}

function MetaItem({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-surface-secondary/50 px-2.5 py-2">
      <Icon icon={icon} className="size-4 shrink-0" />
      <span className="shrink-0">{label}</span>
      <span className="truncate text-foreground">{value}</span>
    </div>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-3xl px-6 py-10 text-center">
      <Icon icon="lucide:inbox" className="mx-auto size-8 text-muted" />
      <h3 className="mt-3 font-medium text-foreground">{title}</h3>
      <p className="mt-1 text-sm text-muted">{description}</p>
    </div>
  )
}

function SkillsSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-24 rounded-2xl" />
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  )
}

function getSkillStats(skills: OpenClawSkillStatus[]) {
  return skills.reduce((acc, skill) => {
    acc.total += 1
    if (skill.disabled) acc.disabled += 1
    if (skill.blockedByAllowlist || skill.blockedByAgentFilter) acc.blocked += 1
    if (hasMissing(skill)) acc.missing += 1
    if (skill.eligible && !skill.disabled && !skill.blockedByAllowlist && !skill.blockedByAgentFilter) acc.ready += 1
    return acc
  }, { total: 0, ready: 0, missing: 0, disabled: 0, blocked: 0 })
}

function matchesTab(skill: OpenClawSkillStatus, tab: SkillTab) {
  if (tab === 'ready') return skill.eligible && !skill.disabled && !skill.blockedByAllowlist && !skill.blockedByAgentFilter
  if (tab === 'missing') return hasMissing(skill)
  if (tab === 'disabled') return skill.disabled
  if (tab === 'blocked') return skill.blockedByAllowlist || skill.blockedByAgentFilter
  return true
}

function hasMissing(skill: OpenClawSkillStatus) {
  return flattenMissing(skill.missing).length > 0
}

function flattenMissing(missing?: OpenClawSkillStatus['missing']) {
  if (!missing) return []
  return [
    ...(missing.bins || []).map((value) => `bin:${value}`),
    ...(missing.anyBins || []).map((value) => `any:${value}`),
    ...(missing.env || []).map((value) => `env:${value}`),
    ...(missing.config || []).map((value) => `config:${value}`),
    ...(missing.os || []).map((value) => `os:${value}`),
  ]
}

function flattenRequirements(requirements?: OpenClawSkillStatus['requirements']) {
  if (!requirements) return []
  return [
    ...(requirements.bins || []).map((value) => `bin:${value}`),
    ...(requirements.anyBins || []).map((value) => `any:${value}`),
    ...(requirements.env || []).map((value) => `env:${value}`),
    ...(requirements.config || []).map((value) => `config:${value}`),
    ...(requirements.os || []).map((value) => `os:${value}`),
  ]
}

function getInstallOptions(skill: OpenClawSkillStatus) {
  return (skill.install || []).filter((option) => option.id?.trim())
}

function skillMatchesQuery(skill: OpenClawSkillStatus, query: string) {
  const trimmed = query.trim()
  if (!trimmed) return true
  const fields = [
    skill.name,
    skill.skillKey,
    skill.description,
    skill.source,
    skill.homepage,
    skill.baseDir,
    skill.filePath,
    skill.emoji,
    ...(skill.bundled ? ['bundled', '内置'] : []),
    ...flattenRequirements(skill.requirements),
    ...flattenMissing(skill.missing),
    ...getInstallOptions(skill).flatMap((option) => [
      option.id,
      option.kind,
      option.label,
      option.package,
      option.formula,
      ...(option.bins ?? []),
      ...(option.packages ?? []),
    ]),
  ]
    .filter(Boolean)
    .map((value) => String(value))

  const rawQuery = trimmed.toLowerCase()
  const relaxedQuery = normalizeSkillSearchText(trimmed)

  return fields.some((field) => {
    const rawField = field.toLowerCase()
    return rawField.includes(rawQuery) || normalizeSkillSearchText(field).includes(relaxedQuery)
  })
}

function normalizeSkillSearchText(value: string) {
  return value.toLowerCase().replace(/[\s._:/\\-]+/g, '')
}

function hasInstallableMissing(skill: OpenClawSkillStatus) {
  return Boolean((skill.missing?.bins?.length || 0) > 0 || (skill.missing?.anyBins?.length || 0) > 0)
}

function hasConfigurableMissing(skill: OpenClawSkillStatus) {
  return Boolean((skill.missing?.env?.length || 0) > 0 || (skill.missing?.config?.length || 0) > 0)
}

function formatInstallOptionLabel(option: OpenClawSkillInstallOption) {
  if (option.label?.trim()) return option.label.trim()
  if (option.kind === 'brew' && option.formula) return `安装 ${option.formula}`
  if (option.package) return `安装 ${option.package}`
  if (option.kind) return `安装 ${option.kind}`
  return '安装依赖'
}

function getSkillStatusChip(skill: OpenClawSkillStatus): { label: string; color: 'warning' } | null {
  if (skill.blockedByAllowlist || skill.blockedByAgentFilter) return { label: '被阻止', color: 'warning' }
  if (hasMissing(skill)) return { label: '缺依赖', color: 'warning' }
  return null
}

function getSkillTone(skill: OpenClawSkillStatus): { label: string; color: 'danger' | 'success' | 'warning' } {
  if (skill.disabled) return { label: '已停用', color: 'danger' }
  if (skill.blockedByAllowlist || skill.blockedByAgentFilter) return { label: '被阻止', color: 'warning' }
  if (hasMissing(skill)) return { label: '缺依赖', color: 'warning' }
  if (skill.eligible) return { label: '可用', color: 'success' }
  return { label: '不可用', color: 'warning' }
}

function extractStoreResults(payload: unknown) {
  if (Array.isArray(payload)) return payload as OpenClawSkillSearchResult[]
  if (payload && typeof payload === 'object') {
    const record = payload as { results?: OpenClawSkillSearchResult[]; skills?: OpenClawSkillSearchResult[]; items?: OpenClawSkillSearchResult[] }
    return record.results || record.skills || record.items || []
  }
  return []
}

function normalizeSkillKey(value: string) {
  return value.trim().toLowerCase()
}

async function getOpenClawSkillsStatusPreferGateway() {
  return withOpenClawSkillsGatewayFallback(
    (client) => client.skillsStatus({}, { timeoutMs: 15_000 }),
    () => getOpenClawSkillsStatus(),
  )
}

async function searchOpenClawSkillsPreferGateway(query = '', limit = 20) {
  try {
    return await searchOpenClawSkills(query, limit)
  } catch (backendError) {
    return withOpenClawSkillsGatewayFallback(
      (client) => client.skillsSearch({ limit, query }, { timeoutMs: 20_000 }),
      () => Promise.reject(backendError),
    )
  }
}

async function installOpenClawSkillPreferGateway(request: OpenClawSkillInstallRequest) {
  try {
    return await installOpenClawSkill(request)
  } catch (backendError) {
    if (request.source === 'skillhub') {
      throw backendError
    }
    return withOpenClawSkillsGatewayFallback(
      (client) => client.skillsInstallFromClawHub(request, { timeoutMs: 120_000 }),
      () => Promise.reject(backendError),
    )
  }
}

async function installOpenClawSkillDependencyPreferGateway(request: OpenClawSkillDependencyInstallRequest) {
  const timeoutMs = request.timeoutMs ?? 15 * 60_000

  return withOpenClawSkillsGatewayFallback(
    (client) => client.skillsInstallDependency({ ...request, timeoutMs }, { timeoutMs: timeoutMs + 30_000 }),
    () => installOpenClawSkillDependency({ ...request, timeoutMs }),
  )
}

async function updateOpenClawSkillPreferGateway(skillKey: string, request: OpenClawSkillUpdateRequest) {
  return withOpenClawSkillsGatewayFallback(
    (client) => client.skillsUpdate(skillKey, request, { timeoutMs: 15_000 }),
    () => updateOpenClawSkill(skillKey, request),
  )
}

async function withOpenClawSkillsGatewayFallback<T>(
  callGateway: (client: OpenClawGatewayClient) => Promise<T>,
  callBackend: () => Promise<T>,
) {
  let client: OpenClawGatewayClient | null = null

  try {
    client = await createOpenClawSkillsGatewayClient()
    return await callGateway(client)
  } catch {
    return await callBackend()
  } finally {
    client?.close()
  }
}

async function createOpenClawSkillsGatewayClient() {
  const [environment, config] = await Promise.all([
    useOpenClawEnvironmentStore.getState().loadOpenClawEnvironment(),
    getOpenClawConfig(),
  ])
  const gatewayUrl = resolveOpenClawGatewayWebSocketURL(environment.gateway)
  const auth = getGatewayAuth(config.content)

  if (!gatewayUrl) {
    throw new Error('Gateway WebSocket 地址不可用')
  }

  const client = new OpenClawGatewayClient({
    password: auth.password,
    requestTimeoutMs: 10_000,
    token: auth.token,
    url: gatewayUrl,
  })

  await client.ready(10_000)

  return client
}

function getGatewayAuth(content?: Record<string, unknown>) {
  const gateway = objectRecord(objectRecord(content).gateway)
  const auth = objectRecord(gateway.auth)
  const password = auth.password
  const token = auth.token

  return {
    password: typeof password === 'string' && password.trim() ? password.trim() : undefined,
    token: typeof token === 'string' && token.trim() ? token.trim() : undefined,
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export default OpenClawSkillsPage
