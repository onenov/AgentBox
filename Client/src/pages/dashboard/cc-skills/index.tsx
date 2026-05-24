import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Chip, Modal, SearchField, Skeleton, toast } from '@heroui/react'
import { PieChart } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type {
  CCConnectShowcaseHotSkill,
  CCConnectSkillDetailResponse,
  CCConnectSkillHubResult,
  CCConnectSkillInfo,
  CCConnectSkillsResponse,
} from '@/api'
import { getCCConnectSkill, getCCConnectSkills, getCCConnectSkillsShowcaseHot, installCCConnectSkill, searchCCConnectSkills } from '@/api'
import SkillMarkdownViewer from '@/components/SkillMarkdownViewer'
import { usePageTitle } from '@/hooks/usePageTitle'
import { openExternalUrl } from '@/utils/openExternalUrl'
import DashboardLayout from '@/layouts/Dashboard'
import { CCConnectSkillsHeroIllustration } from './CCConnectSkillsHeroIllustration'

const collator = new Intl.Collator('zh-CN')
const skillChartColors = ['var(--accent)', 'var(--success)', 'var(--warning)', 'var(--danger)', 'var(--muted)']

type SkillViewMode = 'local' | 'discover'
type LoadState = 'idle' | 'loading' | 'ready' | 'error'

type GlobalSkill = CCConnectSkillInfo & {
  agentTypes: string[]
  sources: string[]
}

function CCSkillsPage() {
  usePageTitle('CC-Connect 技能中心')

  const [state, setState] = useState<LoadState>('idle')
  const [data, setData] = useState<CCConnectSkillsResponse | null>(null)
  const [error, setError] = useState('')
  const [viewMode, setViewMode] = useState<SkillViewMode>('local')
  const [query, setQuery] = useState('')
  const [storeQuery, setStoreQuery] = useState('')
  const [storeState, setStoreState] = useState<LoadState>('idle')
  const [storeError, setStoreError] = useState('')
  const [storeResults, setStoreResults] = useState<CCConnectSkillHubResult[]>([])
  const [storeResultsOpen, setStoreResultsOpen] = useState(false)
  const [discoverState, setDiscoverState] = useState<LoadState>('idle')
  const [discoverError, setDiscoverError] = useState('')
  const [discoverSkills, setDiscoverSkills] = useState<CCConnectShowcaseHotSkill[]>([])
  const [mutatingSkill, setMutatingSkill] = useState('')
  const [selectedSkill, setSelectedSkill] = useState<GlobalSkill | null>(null)
  const [detailData, setDetailData] = useState<CCConnectSkillDetailResponse | null>(null)
  const [detailState, setDetailState] = useState<LoadState>('idle')
  const [detailError, setDetailError] = useState('')

  const loadSkills = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const payload = await getCCConnectSkills()
      setData(payload)
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CC-Connect 技能状态加载失败')
      setState('error')
    }
  }, [])

  const loadDiscoverSkills = useCallback(async (refresh = false) => {
    setDiscoverState('loading')
    setDiscoverError('')
    try {
      const payload = await getCCConnectSkillsShowcaseHot(refresh)
      setDiscoverSkills(payload.skills ?? [])
      setDiscoverState('ready')
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : 'SkillHub 热榜加载失败')
      setDiscoverState('error')
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSkills()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadSkills])

  useEffect(() => {
    if (viewMode !== 'discover' || discoverState !== 'idle') return undefined
    const timer = window.setTimeout(() => {
      void loadDiscoverSkills()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [discoverState, loadDiscoverSkills, viewMode])

  const projects = useMemo(() => data?.projects ?? [], [data?.projects])
  const skills = useMemo(() => collectGlobalSkills(projects), [projects])
  const stats = useMemo(() => getCCSkillStats(skills, projects), [projects, skills])
  const installedSkillKeys = useMemo(() => new Set(
    skills.flatMap((skill) => [skill.name, skill.displayName]).filter(Boolean).map((value) => normalizeSkillKey(String(value))),
  ), [skills])

  const filteredSkills = useMemo(() => {
    const normalizedQuery = query.trim()
    return skills
      .filter((skill) => skillMatchesQuery(skill, normalizedQuery))
      .sort((a, b) => collator.compare(a.name, b.name))
  }, [query, skills])

  const searchStore = useCallback(async () => {
    setStoreState('loading')
    setStoreError('')
    try {
      const payload = await searchCCConnectSkills(storeQuery.trim(), 20)
      setStoreResults(payload.results ?? [])
      setStoreResultsOpen(true)
      setStoreState('ready')
    } catch (err) {
      setStoreError(err instanceof Error ? err.message : 'Skills Hub 搜索失败')
      setStoreResults([])
      setStoreResultsOpen(true)
      setStoreState('error')
    }
  }, [storeQuery])

  const installHubSkill = useCallback(async (skill: CCConnectSkillHubResult | CCConnectShowcaseHotSkill) => {
    const slug = getHubInstallSlug(skill)
    if (!slug || isHubSkillInstalled(installedSkillKeys, skill)) return
    setMutatingSkill(slug)
    try {
      const payload = await installCCConnectSkill({
        restartRuntime: true,
        slug,
        source: 'skillhub',
      })
      if (payload.restartError) {
        toast.warning('技能已安装，CC-Connect 重启失败，请手动重启后生效')
      } else {
        toast.success(payload.runtimeRestarted ? '技能安装完成，CC-Connect 已重启' : '技能安装完成')
      }
      await loadSkills()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '技能安装失败')
    } finally {
      setMutatingSkill('')
    }
  }, [installedSkillKeys, loadSkills])

  const openSkillDetail = useCallback(async (skill: GlobalSkill) => {
    setSelectedSkill(skill)
    setDetailData(null)
    setDetailError('')
    setDetailState('loading')
    try {
      const payload = await getCCConnectSkill(skill.name)
      setDetailData(payload)
      setDetailState('ready')
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '技能详情加载失败')
      setDetailState('error')
    }
  }, [])

  const isLoading = state === 'loading' && !data
  const refreshButtonVariant = state === 'error' ? 'primary' : 'ghost'

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

        {isLoading ? <CCSkillsSkeleton /> : null}

        {data ? (
          <>
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
              <CCSkillsHeroCard
                error={storeError}
                query={storeQuery}
                state={storeState}
                onQueryChange={setStoreQuery}
                onSearch={searchStore}
              />

              <CCSkillsDistributionCard stats={stats} />
            </section>

            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                {viewMode === 'local' ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
                    <SearchField variant="primary" className="md:w-64" value={query} onChange={setQuery} aria-label="搜索本地技能">
                      <SearchField.Group>
                        <SearchField.SearchIcon />
                        <SearchField.Input placeholder="搜索本地技能…" />
                        <SearchField.ClearButton />
                      </SearchField.Group>
                    </SearchField>
                    <Button isIconOnly variant={refreshButtonVariant} onPress={loadSkills} isDisabled={state === 'loading'} aria-label="刷新技能">
                      <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button isIconOnly variant="ghost" onPress={() => void loadDiscoverSkills(true)} isDisabled={discoverState === 'loading'} aria-label="刷新发现技能">
                      <Icon icon={discoverState === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={discoverState === 'loading' ? 'animate-spin' : ''} />
                    </Button>
                    <Button isIconOnly variant="primary" onPress={() => setViewMode('local')} aria-label="关闭发现">
                      <Icon icon="lucide:x" />
                    </Button>
                  </div>
                )}
              </div>

              {viewMode === 'local' ? (
                <LocalSkillsPanel skills={filteredSkills} onShowDetail={openSkillDetail} />
              ) : (
                <DiscoverSkillsPanel
                  error={discoverError}
                  installedSkillKeys={installedSkillKeys}
                  mutatingSkill={mutatingSkill}
                  skills={discoverSkills}
                  state={discoverState}
                  onInstall={installHubSkill}
                  onRefresh={() => loadDiscoverSkills(true)}
                />
              )}
            </section>
          </>
        ) : null}

        <CCSkillHubSearchResultsModal
          installedSkillKeys={installedSkillKeys}
          isOpen={storeResultsOpen}
          mutatingSkill={mutatingSkill}
          query={storeQuery}
          results={storeResults}
          state={storeState}
          onInstall={installHubSkill}
          onOpenChange={setStoreResultsOpen}
        />

        {selectedSkill ? (
          <SkillDetailModal
            detail={detailData}
            error={detailError}
            isOpen={Boolean(selectedSkill)}
            skill={selectedSkill}
            state={detailState}
            onOpenChange={(open) => {
              if (open) return
              setSelectedSkill(null)
              setDetailData(null)
              setDetailError('')
              setDetailState('idle')
            }}
            onRetry={() => void openSkillDetail(selectedSkill)}
          />
        ) : null}
      </div>
    </DashboardLayout>
  )
}

function CCSkillsHeroCard({
  error,
  query,
  state,
  onQueryChange,
  onSearch,
}: {
  error: string
  query: string
  state: LoadState
  onQueryChange: (query: string) => void
  onSearch: () => void
}) {
  const isSearching = state === 'loading'

  return (
    <Card variant="transparent" className="overflow-hidden">
      <Card.Content>
        <div className="flex flex-row items-center gap-4 md:gap-6">
          <div className="flex h-36 shrink-0 items-center justify-center overflow-visible p-1">
            <CCConnectSkillsHeroIllustration className="h-full w-auto rounded-2xl -p-4" />
          </div>

          <div className="flex min-w-0 w-full flex-col gap-5 pl-2">
            <div className="min-w-0">
              <Card.Title className="text-2xl font-bold md:text-3xl">AI Skills</Card.Title>
              <Card.Description className="mt-4 text-base md:text-lg">搜索 Skills Hub，安装到本机技能库。</Card.Description>
            </div>

            <div className="flex flex-row items-end gap-3 md:pr-6">
              <SearchField variant="primary" className="md:w-64" value={query} onChange={onQueryChange} aria-label="搜索 Skills Hub">
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
              <Button variant={query.trim() ? 'primary' : 'tertiary'} isIconOnly onPress={onSearch} isDisabled={isSearching} aria-label="搜索 Skills Hub">
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

function CCSkillsDistributionCard({ stats }: { stats: ReturnType<typeof getCCSkillStats> }) {
  const entries = Object.entries(stats.agentTypes)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
  const chartData = entries.map(([name, value], index) => ({
    fill: skillChartColors[index % skillChartColors.length],
    name,
    value,
  }))
  const fallbackData = [{ name: '暂无数据', value: 1, fill: 'var(--surface-secondary)' }]
  const displayedChartData = chartData.length ? chartData : fallbackData

  return (
    <Card>
      <Card.Content>
        <div className="flex flex-row items-center gap-6">
          <div className="relative shrink-0">
            <PieChart height={160} width={160}>
              <PieChart.Pie
                cx="50%"
                cy="50%"
                data={displayedChartData}
                dataKey="value"
                innerRadius="56%"
                nameKey="name"
                strokeWidth={0}
              >
                {displayedChartData.map((item) => (
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
            <SkillMetric label="本机技能" value={stats.total} />
            {/* <SkillMetric label="扫描目录" value={stats.dirCount} /> */}
            {entries.slice(0, 3).map(([name, value], index) => (
              <SkillLegendItem key={name} label={name} value={value} color={skillChartColors[index % skillChartColors.length]} />
            ))}
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function SkillMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
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

function LocalSkillsPanel({
  skills,
  onShowDetail,
}: {
  skills: GlobalSkill[]
  onShowDetail: (skill: GlobalSkill) => void
}) {
  if (skills.length === 0) {
    return <EmptyState title="没有匹配的技能" description="清空搜索关键词或刷新技能清单。" />
  }

  return (
    <div className="grid max-h-[calc(100vh-150px)] gap-3 overflow-y-auto xl:grid-cols-2 2xl:grid-cols-3">
      {skills.map((skill) => (
        <SkillCard key={`${skill.name}-${skill.sources.join(':')}`} skill={skill} onShowDetail={onShowDetail} />
      ))}
    </div>
  )
}

function SkillCard({ skill, onShowDetail }: { skill: GlobalSkill; onShowDetail: (skill: GlobalSkill) => void }) {
  const command = `/${skill.name}`

  return (
    <Card>
      <Card.Content>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground">
                <Icon icon="lucide:puzzle" className="size-4" />
              </div>
              <h3 className="truncate font-semibold text-foreground">{skill.displayName || skill.name}</h3>
              {skill.agentTypes.slice(0, 3).map((agentType) => <Chip key={agentType} size="sm" variant="soft">{agentType}</Chip>)}
              {skill.agentTypes.length > 3 ? <Chip size="sm" variant="soft">+{skill.agentTypes.length - 3}</Chip> : null}
            </div>
            <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted">{skill.description || '无描述'}</p>
            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate font-mono text-xs text-muted">{command}</span>
              <Chip size="sm" variant="soft">{skill.sources.length} 个来源</Chip>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button isIconOnly size="sm" variant="ghost" onPress={() => copyText(command, '已复制技能命令')} aria-label="复制技能命令">
              <Icon icon="lucide:copy" className="size-4" />
            </Button>
            <Button isIconOnly size="sm" variant="ghost" onPress={() => onShowDetail(skill)} aria-label="查看技能详情">
              <Icon icon="lucide:info" className="size-4" />
            </Button>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function CCSkillHubSearchResultsModal({
  installedSkillKeys,
  isOpen,
  mutatingSkill,
  query,
  results,
  state,
  onInstall,
  onOpenChange,
}: {
  installedSkillKeys: Set<string>
  isOpen: boolean
  mutatingSkill: string
  query: string
  results: CCConnectSkillHubResult[]
  state: LoadState
  onInstall: (skill: CCConnectSkillHubResult) => void
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
              <Modal.Heading>{`${query.trim() || 'Skills Hub'} 搜索结果`}</Modal.Heading>
              <p className="mt-1 text-sm text-muted">共 {results.length} 个结果，安装到本机 CC-Connect 技能库</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            {state === 'loading' ? (
              <div className="grid gap-3">
                <Skeleton className="h-24 rounded-2xl" />
                <Skeleton className="h-24 rounded-2xl" />
                <Skeleton className="h-24 rounded-2xl" />
              </div>
            ) : state === 'error' ? (
              <EmptyState title="Skills Hub 搜索失败" description="确认 skillhub CLI 可用后再试。" />
            ) : results.length > 0 ? (
              <div className="grid gap-3">
                {results.map((result) => {
                  const slug = getHubInstallSlug(result)
                  const installed = isHubSkillInstalled(installedSkillKeys, result)
                  return (
                    <HubSkillCard
                      key={slug || result.name || result.description}
                      installed={installed}
                      mutating={mutatingSkill === slug}
                      skill={result}
                      onInstall={onInstall}
                    />
                  )
                })}
              </div>
            ) : (
              <EmptyState title="没有找到远程技能" description="换一个关键词再试。" />
            )}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function HubSkillCard({
  installed,
  mutating,
  skill,
  onInstall,
}: {
  installed: boolean
  mutating: boolean
  skill: CCConnectSkillHubResult
  onInstall: (skill: CCConnectSkillHubResult) => void
}) {
  const slug = getHubInstallSlug(skill)
  const title = skill.name || slug || '未知技能'
  const description = skill.description || skill.summary || '暂无描述'
  const disabled = installed || mutating || !slug

  return (
    <Card>
      <Card.Content>
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-surface-secondary/50 text-foreground">
            <Icon icon="lucide:package-plus" className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="truncate text-sm font-bold text-foreground">{title}</h4>
                <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted">{description}</p>
              </div>
              <Button className="shrink-0" size="sm" variant={installed ? 'ghost' : 'outline'} onPress={() => onInstall(skill)} isDisabled={disabled}>
                <Icon icon={mutating ? 'lucide:loader-circle' : installed ? 'lucide:check' : 'lucide:download'} className={mutating ? 'animate-spin' : ''} />
                {installed ? '已安装' : '安装'}
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {slug ? <Chip size="sm" variant="soft">{slug}</Chip> : null}
              {skill.source ? <Chip size="sm" variant="soft">{skill.source}</Chip> : null}
              {skill.version ? <Chip size="sm" variant="soft">v{skill.version}</Chip> : null}
              {skill.author ? <Chip size="sm" variant="soft">{skill.author}</Chip> : null}
            </div>
          </div>
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
  state: LoadState
  error: string
  skills: CCConnectShowcaseHotSkill[]
  installedSkillKeys: Set<string>
  mutatingSkill: string
  onInstall: (skill: CCConnectShowcaseHotSkill) => void
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
        const installed = isHubSkillInstalled(installedSkillKeys, skill)
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
  skill: CCConnectShowcaseHotSkill
  installed: boolean
  mutating: boolean
  onInstall: (skill: CCConnectShowcaseHotSkill) => void
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
                <h4 className="truncate text-sm font-bold text-foreground">{skill.name || skill.slug}</h4>
              </div>
              <Button isIconOnly size="sm" variant="ghost" onPress={() => void openExternalUrl(detailUrl)} aria-label="查看详情">
                <Icon icon="lucide:external-link" />
              </Button>
            </div>
          </div>
          <Button
            className="shrink-0"
            size="sm"
            variant={installed ? 'primary' : 'outline'}
            onPress={() => onInstall(skill)}
            isDisabled={installed || mutating}
          >
            <Icon icon={mutating ? 'lucide:loader-circle' : installed ? 'lucide:check' : 'lucide:download'} className={mutating ? 'animate-spin' : ''} />
            {installed ? '已安装' : '安装'}
          </Button>
        </div>
        <p className="mt-1 line-clamp-2 max-h-10 overflow-hidden text-sm leading-5 text-muted break-words">{description}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip size="sm" variant="soft">{skill.slug}</Chip>
          {skill.version ? <Chip size="sm" variant="soft">v{skill.version}</Chip> : null}
          {skill.ownerName ? <Chip size="sm" variant="soft">{skill.ownerName}</Chip> : null}
          {skill.category ? <Chip size="sm" variant="soft">{skill.category}</Chip> : null}
        </div>
      </Card.Content>
    </Card>
  )
}

function SkillDetailModal({
  detail,
  error,
  isOpen,
  skill,
  state,
  onOpenChange,
  onRetry,
}: {
  detail: CCConnectSkillDetailResponse | null
  error: string
  isOpen: boolean
  skill: GlobalSkill
  state: LoadState
  onOpenChange: (open: boolean) => void
  onRetry: () => void
}) {
  const resolvedSkill = detail?.skill ?? skill
  const command = detail?.command || `/${resolvedSkill.name}`
  const agentTypes = detail?.agentTypes?.length ? detail.agentTypes : skill.agentTypes
  const sources = detail?.sources?.length ? detail.sources : skill.sources
  const contentErrors = detail?.errors ?? []

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
              <Modal.Heading>{resolvedSkill.displayName || resolvedSkill.name}</Modal.Heading>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted">{resolvedSkill.description || '无描述'}</p>
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
                        <MetaItem icon="lucide:terminal" label="命令" value={command} />
                        <MetaItem icon="lucide:key" label="Skill Key" value={resolvedSkill.name} />
                        <MetaItem icon="lucide:bot" label="Agent" value={agentTypes.join(', ') || '-'} />
                        <MetaItem icon="lucide:folder" label="来源数" value={String(sources.length)} />
                      </div>
                    </Card.Content>
                  </Card>

                  <DetailBlock title="状态" icon="lucide:activity">
                    <div className="flex flex-wrap gap-1.5">
                      <Chip size="sm" variant="soft" color="success">本机已安装</Chip>
                      <Chip size="sm" variant="soft">全局技能</Chip>
                      {detail?.contentPath ? <Chip size="sm" variant="soft">SKILL.md 已读取</Chip> : null}
                      {state === 'loading' ? <Chip size="sm" variant="soft">加载中</Chip> : null}
                    </div>
                  </DetailBlock>

                  <DetailBlock title="Agent 类型" icon="lucide:bot">
                    <ChipList items={agentTypes} empty="未检测到可见 Agent 类型" />
                  </DetailBlock>

                  <DetailBlock title="路径与来源" icon="lucide:link">
                    <div className="grid gap-2 text-sm">
                      {detail?.contentPath ? <PathRow label="SKILL.md" value={detail.contentPath} /> : null}
                      {sources.map((source, index) => (
                        <PathRow key={source} label={`Source ${index + 1}`} value={source} />
                      ))}
                    </div>
                  </DetailBlock>

                  {contentErrors.length > 0 ? (
                    <DetailBlock title="读取提示" icon="lucide:circle-alert">
                      <ChipList items={contentErrors} empty="无读取错误" />
                    </DetailBlock>
                  ) : null}
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
                  ) : state === 'error' ? (
                    <div className="flex min-h-48 flex-col items-center justify-center text-center">
                      <Icon icon="lucide:circle-alert" className="size-8 text-danger" />
                      <p className="mt-3 text-sm text-muted">{error}</p>
                      <Button className="mt-4" size="sm" variant="danger" onPress={onRetry}>
                        重试
                      </Button>
                    </div>
                  ) : (
                    <SkillMarkdownViewer className="max-h-[calc(min(72dvh,760px))]" content={detail?.content ?? ''} empty="未读取到 SKILL.md 内容" />
                  )}
                </Card.Content>
              </Card>
            </div>
          </Modal.Body>
          {/* <Modal.Footer>
            <Button variant="tertiary" onPress={() => onOpenChange(false)}>
              关闭
            </Button>
            <Button onPress={() => copyText(command, '已复制技能命令')}>
              <Icon icon="lucide:copy" />
              复制命令
            </Button>
          </Modal.Footer> */}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function DetailBlock({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
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

function MetaItem({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon icon={icon} className="size-4 shrink-0" />
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 truncate font-medium text-foreground" title={value}>{value}</span>
    </div>
  )
}

function ChipList({ items, empty }: { items: string[]; empty: string }) {
  const filtered = items.filter(Boolean)
  if (filtered.length === 0) {
    return <p className="text-sm text-muted">{empty}</p>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {filtered.map((item) => <Chip key={item} size="sm" variant="soft">{item}</Chip>)}
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

function EmptyState({ description, title }: { description: string; title: string }) {
  return (
    <Card>
      <Card.Content>
        <div className="flex flex-col items-center px-6 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-secondary text-muted">
            <Icon icon="lucide:puzzle" className="size-6" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted">{description}</p>
        </div>
      </Card.Content>
    </Card>
  )
}

function CCSkillsSkeleton() {
  return (
    <>
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
        <Skeleton className="h-52 rounded-2xl" />
        <Skeleton className="h-52 rounded-2xl" />
      </section>
      <section className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-36 rounded-2xl" />
      </section>
    </>
  )
}

function collectGlobalSkills(projects: CCConnectSkillsResponse['projects']) {
  const byName = new Map<string, GlobalSkill>()
  for (const project of projects) {
    for (const skill of project.skills) {
      const key = normalizeSkillKey(skill.name)
      const current = byName.get(key)
      if (current) {
        if (project.agentType && !current.agentTypes.includes(project.agentType)) current.agentTypes.push(project.agentType)
        if (skill.source && !current.sources.includes(skill.source)) current.sources.push(skill.source)
        if (!current.displayName && skill.displayName) current.displayName = skill.displayName
        if (!current.description && skill.description) current.description = skill.description
        continue
      }
      byName.set(key, {
        ...skill,
        agentTypes: project.agentType ? [project.agentType] : [],
        sources: skill.source ? [skill.source] : [],
      })
    }
  }
  return [...byName.values()]
}

function getCCSkillStats(skills: GlobalSkill[], projects: CCConnectSkillsResponse['projects']) {
  const agentTypes: Record<string, number> = {}
  for (const skill of skills) {
    for (const agentType of skill.agentTypes) {
      agentTypes[agentType] = (agentTypes[agentType] ?? 0) + 1
    }
  }
  return {
    agentTypes,
    dirCount: new Set(projects.flatMap((project) => project.dirs ?? [])).size,
    total: skills.length,
  }
}

function skillMatchesQuery(skill: GlobalSkill, query: string) {
  if (!query) return true
  const normalized = query.toLowerCase()
  return [
    skill.name,
    skill.displayName,
    skill.description,
    ...skill.sources,
    ...skill.agentTypes,
  ].some((value) => value?.toLowerCase().includes(normalized))
}

function getHubInstallSlug(skill: CCConnectSkillHubResult | CCConnectShowcaseHotSkill) {
  if ('slug' in skill && skill.slug) return skill.slug.trim()
  return skill.name?.trim() || ''
}

function isHubSkillInstalled(installedSkillKeys: Set<string>, skill: CCConnectSkillHubResult | CCConnectShowcaseHotSkill) {
  const values = [
    getHubInstallSlug(skill),
    skill.name,
  ]
  return values.filter(Boolean).some((value) => installedSkillKeys.has(normalizeSkillKey(String(value))))
}

function normalizeSkillKey(value: string) {
  return value.trim().toLowerCase().replaceAll('-', '_')
}

async function copyText(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(message)
  } catch {
    toast.warning('复制失败')
  }
}

export default CCSkillsPage
