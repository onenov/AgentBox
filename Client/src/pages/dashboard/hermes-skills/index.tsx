import { type SVGProps, useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Chip, Modal, SearchField, Skeleton, Switch, toast } from '@heroui/react'
import { PieChart, Segment } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type { HermesSkillDetailResponse, HermesSkillHubResult, HermesSkillInfo, HermesSkillsResponse } from '@/api'
import { discoverHermesSkills, getHermesSkill, getHermesSkills, installHermesSkill, reloadHermesSkills, searchHermesSkills, updateHermesSkill } from '@/api'
import SkillMarkdownViewer from '@/components/SkillMarkdownViewer'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { useHermesAgentStore } from '@/stores/hermes-agent'
import { HermesLoadErrorCard } from '../hermes-shared/HermesLoadErrorCard'

type SelectionKey = string | number
type SkillTab = 'all' | 'enabled' | 'disabled' | 'bundled' | 'custom' | 'external'
type SkillViewMode = 'local' | 'discover'

const numberFormatter = new Intl.NumberFormat('zh-CN')
const collator = new Intl.Collator('zh-CN')

const hermesSkillChartColors = {
  enabled: 'var(--success)',
  disabled: 'var(--warning)',
  builtin: 'var(--accent)',
  categories: 'var(--muted)',
}

const skillsHeroGridStroke = 'rgba(247, 247, 247, 1)'
const skillsHeroTriangleStroke = 'rgba(235, 236, 236, 1)'

const skillsHeroTriangleDecorPathD = 'M318.69 1.74034L321.024 5.80714L323.626 4.31404L321.292 0.247238L318.69 1.74034ZM278.968 5.81657L281.301 1.74974L278.699 0.256642L276.365 4.32346L278.968 5.81657ZM325.691 13.9408L330.358 22.0744L332.96 20.5813L328.293 12.4477L325.691 13.9408ZM269.634 22.0839L274.301 13.9502L271.698 12.4571L267.032 20.5908L269.634 22.0839ZM335.025 30.2081L339.692 38.3417L342.294 36.8486L337.627 28.715L335.025 30.2081ZM260.3 38.3511L264.967 30.2175L262.365 28.7244L257.698 36.858L260.3 38.3511ZM344.359 46.4754L349.025 54.609L351.628 53.1159L346.961 44.9823L344.359 46.4754ZM250.966 54.6184L255.633 46.4848L253.031 44.9917L248.364 53.1253L250.966 54.6184ZM353.692 62.7427L358.359 70.8763L360.962 69.3832L356.295 61.2496L353.692 62.7427ZM241.632 70.8857L246.299 62.7521L243.697 61.259L239.03 69.3926L241.632 70.8857ZM363.026 79.01L367.693 87.1436L370.296 85.6505L365.629 77.5169L363.026 79.01ZM232.298 87.153L236.965 79.0194L234.363 77.5263L229.696 85.6599L232.298 87.153ZM372.36 95.2773L377.027 103.411L379.629 101.918L374.962 93.7842L372.36 95.2773ZM222.964 103.42L227.631 95.2867L225.029 93.7936L220.362 101.927L222.964 103.42ZM381.694 111.545L386.361 119.678L388.963 118.185L384.296 110.051L381.694 111.545ZM213.63 119.688L218.297 111.554L215.695 110.061L211.028 118.195L213.63 119.688ZM391.028 127.812L395.695 135.946L398.297 134.452L393.63 126.319L391.028 127.812ZM204.296 135.955L208.963 127.821L206.361 126.328L201.694 134.462L204.296 135.955ZM400.362 144.079L405.029 152.213L407.631 150.72L402.964 142.586L400.362 144.079ZM194.962 152.222L199.629 144.089L197.027 142.595L192.36 150.729L194.962 152.222ZM409.696 160.346L414.363 168.48L416.965 166.987L412.298 158.853L409.696 160.346ZM185.629 168.49L190.296 160.356L187.693 158.863L183.026 166.996L185.629 168.49ZM419.03 176.614L423.697 184.747L426.299 183.254L421.632 175.121L419.03 176.614ZM176.295 184.757L180.962 176.623L178.359 175.13L173.692 183.264L176.295 184.757ZM428.364 192.881L433.031 201.015L435.633 199.522L430.966 191.388L428.364 192.881ZM166.961 201.024L171.628 192.89L169.025 191.397L164.359 199.531L166.961 201.024ZM437.698 209.148L442.365 217.282L444.967 215.789L440.3 207.655L437.698 209.148ZM157.627 217.291L162.294 209.158L159.692 207.665L155.025 215.798L157.627 217.291ZM447.032 225.416L451.698 233.549L454.301 232.056L449.634 223.923L447.032 225.416ZM148.293 233.559L152.96 225.425L150.358 223.932L145.691 232.066L148.293 233.559ZM456.365 241.683L458.699 245.75L461.301 244.257L458.968 240.19L456.365 241.683ZM141.292 245.759L143.626 241.692L141.024 240.199L138.69 244.266L141.292 245.759Z'

function SkillsHeroIllustration(props: Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'xmlns'>) {
  const { className, ...rest } = props
  const accentSoft = 'color-mix(in oklch, var(--accent) 36%, white)'
  const accentDeep = 'color-mix(in oklch, var(--accent), black 0%)'
  const accentBright = 'color-mix(in oklch, var(--accent), white 26%)'
  const capGradId = 'hermesSkillsHeroCapGrad'
  const wrenchMaskId = 'hermesSkillsHeroWrenchMask'
  const vb = { x: 134, y: 0, w: 336, h: 246.504 }
  const gx0 = vb.x
  const gx1 = vb.x + vb.w

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} fill="none" className={className} aria-hidden {...rest}>
      <path stroke={skillsHeroGridStroke} strokeWidth={2} d={`M${gx0} 245.503H${gx1}`} />
      <path stroke={skillsHeroGridStroke} strokeWidth={2} d={`M${gx0} 45.0032H${gx1}`} />
      <path fillRule="evenodd" fill="#EBECEC" d={skillsHeroTriangleDecorPathD} />
      <path fill="#181818" d="M152.896 224.003 447.696 224.003 459.949 244.997 140 244.997 152.896 224.003z" />
      <path fill="#F7F7F7" d="M171.896 224.003 428.093 224.003 440.345 244.997 160 244.997 171.896 224.003z" />
      <path fill="#EBECEC" d="M299.5 1.00317 224 132.003h151L299.5 1.00317z" />
      <rect x="300" y="125.003173828125" width="90" height="110" fill={accentSoft} />
      <path fill="var(--accent)" d="M390 125.003 370 125.003 390 160.003 390 125.003z" />
      <rect x="351" y="167.003173828125" width="10" height="10" fill="#FFFFFF" />
      <rect x="332" y="196.003173828125" width="10" height="10" fill="#FFFFFF" transform="rotate(-90 332 196.003173828125)" />
      <rect x="342.071044921875" y="211.015380859375" width="10" height="10" fill="#FFFFFF" transform="rotate(-135 342.071044921875 211.015380859375)" />
      <rect width="10" height="10" x="0" y="0" fill="#FFFFFF" transform="matrix(0.7071067690849304, -0.7071067690849304, -0.7071067690849304, -0.7071067690849304, 370, 211.015380859375)" />
      <rect width="10" height="10" x="0" y="0" fill="#FFFFFF" transform="matrix(0.7071067690849304, -0.7071067690849304, -0.7071067690849304, -0.7071067690849304, 343.1298828125, 184.14532470703125)" />
      <rect x="351" y="205.003173828125" width="10" height="10" fill="#FFFFFF" />
      <rect x="370" y="196.003173828125" width="10" height="10" fill="#FFFFFF" transform="rotate(-90 370 196.003173828125)" />
      <rect x="368.941162109375" y="184.14532470703125" width="10" height="10" fill="#FFFFFF" transform="rotate(-135 368.941162109375 184.14532470703125)" />
      <circle cx="356.5" cy="191.503173828125" r="17.5" fill="#FFFFFF" />
      <circle cx="356.5" cy="191.503173828125" r="7.5" fill={accentSoft} />
      <path
        fillRule="evenodd"
        fill={`url(#${capGradId})`}
        d="M309 244.954C303.947 244.452 300 240.189 300 235.003C300 229.818 303.947 225.554 309 225.053L309 225.003 390 225.003 390 245.003 309 245.003 309 244.954z"
      />
      <rect x="210" y="125.003173828125" width="90" height="110" fill="#F7F7F7" />
      <path fill={accentSoft} d="M210 125.003 230 125.003 210 160.003 210 125.003z" />
      <path
        fillRule="evenodd"
        fill={accentSoft}
        d="M290 225.003 210 225.003 210 245.003 290 245.003C295.523 245.003 300 240.526 300 235.003 300 229.48 295.523 225.003 290 225.003z"
      />
      <path
        fillRule="evenodd"
        fill="#181818"
        d="M236.997 135.977 235.003 135.977 233.643 140.967 235 145.937 235 176.977 239 176.977 239 145.936 240.357 140.967 238.997 135.977 236.997 135.977z"
      />
      <circle cx="237" cy="179.97747802734375" r="4" fill="#181818" />
      <rect x="227" y="185.97747802734375" width="20" height="30" fill="#EBECEC" />
      <rect x="230" y="178.97747802734375" width="14" height="7" rx="3.5" fill="#C3C5C6" />
      <path stroke={skillsHeroGridStroke} strokeWidth={2} d={`M${gx0} 124.503H${gx1}`} />
      <rect x="254" y="45.003173828125" width="90" height="110" fill="#F7F7F7" />
      <path
        fill="#C3C5C6"
        fillRule="evenodd"
        d="M264 164.003C258.477 164.003 254 159.526 254 154.003C254 148.48 258.477 144.003 264 144.003H344v20H264z"
      />
      <circle cx="300" cy="85.003173828125" r="30" fill="#FFFFFF" />
      <g mask={`url(#${wrenchMaskId})`}>
        <rect x="298.3536376953125" y="79.07855224609375" width="10" height="36" fill="#181818" transform="rotate(45 298.3536376953125 79.07855224609375)" />
        <circle cx="316.88916015625" cy="76.40087890625" r="15" fill="#181818" transform="rotate(45 301.88916015625 61.40087890625)" />
        <rect x="316.03125" y="61.40087890625" width="10" height="25" fill="#FFFFFF" transform="rotate(45 316.03125 61.40087890625)" />
      </g>
      <path d="M300 2.00317 160 245.003 440 245.003 300 2.00317z" stroke={skillsHeroTriangleStroke} strokeWidth={2} />
      <defs>
        <linearGradient id={capGradId} x1="390" y1={235.003173828125} x2="300" y2={235.003173828125} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={accentDeep} />
          <stop offset="0.5" stopColor="var(--accent)" />
          <stop offset="1" stopColor={accentBright} />
        </linearGradient>
        <mask id={wrenchMaskId} maskUnits="userSpaceOnUse" style={{ maskType: 'alpha' }}>
          <circle cx="300" cy="85.003" r="30" fill="#FFFFFF" />
        </mask>
      </defs>
    </svg>
  )
}

function HermesSkillsPage() {
  usePageTitle('Hermes 技能中心')
  const selectedAgentName = useHermesAgentStore((store) => store.selectedName)
  const loadAgents = useHermesAgentStore((store) => store.loadAgents)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [data, setData] = useState<HermesSkillsResponse | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [storeQuery, setStoreQuery] = useState('')
  const [storeState, setStoreState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [storeError, setStoreError] = useState('')
  const [storeResults, setStoreResults] = useState<HermesSkillHubResult[]>([])
  const [storeResultsOpen, setStoreResultsOpen] = useState(false)
  const [viewMode, setViewMode] = useState<SkillViewMode>('local')
  const [discoverState, setDiscoverState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [discoverError, setDiscoverError] = useState('')
  const [discoverSkills, setDiscoverSkills] = useState<HermesSkillHubResult[]>([])
  const [activeTab, setActiveTab] = useState<SelectionKey>('all')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [mutatingSkill, setMutatingSkill] = useState('')
  const [detailSkill, setDetailSkill] = useState<HermesSkillInfo | null>(null)
  const [detailData, setDetailData] = useState<HermesSkillDetailResponse | null>(null)
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [detailError, setDetailError] = useState('')
  const [detailOpen, setDetailOpen] = useState(false)

  const loadSkills = useCallback(async (refresh = false) => {
    setState('loading')
    setError('')

    try {
      const payload = await getHermesSkills(refresh, selectedAgentName)
      setData(payload)
      setState('ready')
      return payload
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hermes 技能加载失败')
      setState('error')
      return null
    }
  }, [selectedAgentName])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAgents(false)
      void loadSkills(false)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadAgents, loadSkills])

  const skills = useMemo(() => data?.skills ?? [], [data?.skills])
  const stats = useMemo(() => getHermesSkillStats(skills), [skills])
  const installedSkillKeys = useMemo(() => new Set(skills.map((skill) => normalizeSkillKey(skill.name))), [skills])
  const tabSkills = useMemo(() => skills.filter((skill) => matchesTab(skill, String(activeTab) as SkillTab)), [activeTab, skills])
  const categories = useMemo(() => getCategoryOptions(tabSkills), [tabSkills])
  const categoryDescriptions = useMemo(() => new Map((data?.categories ?? []).map((category) => [category.name, category.description || ''])), [data?.categories])
  const selectedCategoryDescription = selectedCategory === 'all' ? '' : categoryDescriptions.get(selectedCategory) || ''
  const filteredSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return tabSkills
      .filter((skill) => selectedCategory === 'all' || (skill.category || 'uncategorized') === selectedCategory)
      .filter((skill) => {
        if (!normalizedQuery) return true
        return [
          skill.name,
          skill.description,
          skill.category,
          skill.source,
          skill.relativePath,
          ...(skill.tags ?? []),
          ...(skill.platforms ?? []),
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery))
      })
      .sort((a, b) => {
        const categoryCompare = collator.compare(a.category || '', b.category || '')
        if (categoryCompare !== 0) return categoryCompare
        return collator.compare(a.name, b.name)
      })
  }, [query, selectedCategory, tabSkills])

  const refreshSkills = useCallback(async () => {
    await loadSkills(true)
  }, [loadSkills])

  const loadDiscoverSkills = useCallback(async (refresh = false) => {
    setDiscoverState('loading')
    setDiscoverError('')
    try {
      const payload = await discoverHermesSkills(refresh, 24, 'skillhub')
      setDiscoverSkills(payload.skills ?? [])
      setDiscoverState('ready')
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : 'Hermes Skills Hub 加载失败')
      setDiscoverState('error')
    }
  }, [])

  useEffect(() => {
    if (viewMode !== 'discover' || discoverState !== 'idle') return undefined
    const timer = window.setTimeout(() => {
      void loadDiscoverSkills(false)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [discoverState, loadDiscoverSkills, viewMode])

  const rescanSkills = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const payload = await reloadHermesSkills(selectedAgentName)
      setData(payload)
      setState('ready')
      toast.success('Hermes 技能已重新扫描')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hermes 技能重新扫描失败')
      setState('error')
      toast.warning('Hermes 技能重新扫描失败')
    }
  }, [selectedAgentName])

  const searchStore = useCallback(async () => {
    setStoreState('loading')
    setStoreError('')
    try {
      const payload = await searchHermesSkills(storeQuery.trim(), 20, 'all')
      setStoreResults(payload.results ?? [])
      setStoreResultsOpen(true)
      setStoreState('ready')
    } catch (err) {
      setStoreError(err instanceof Error ? err.message : 'Hermes Skills Hub 搜索失败')
      setStoreResults([])
      setStoreResultsOpen(true)
      setStoreState('error')
    }
  }, [storeQuery])

  const installHubSkill = useCallback(async (skill: HermesSkillHubResult) => {
    const identifier = skill.identifier?.trim()
    if (!identifier) return
    setMutatingSkill(identifier)
    try {
      await installHermesSkill({ identifier, source: skill.source }, selectedAgentName)
      toast.success('Hermes 技能安装完成')
      await loadSkills(true)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'Hermes 技能安装失败')
    } finally {
      setMutatingSkill('')
    }
  }, [loadSkills, selectedAgentName])

  const changeTab = useCallback((key: SelectionKey) => {
    setActiveTab(key)
    setSelectedCategory('all')
  }, [])

  const toggleSkill = useCallback(async (skill: HermesSkillInfo) => {
    setMutatingSkill(skill.name)
    try {
      const payload = await updateHermesSkill(skill.name, skill.disabled, selectedAgentName)
      setData((current) => current ? replaceSkill(current, payload.skill) : current)
      toast.success(skill.disabled ? '技能已启用' : '技能已停用')
      await loadSkills(true)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '技能启停失败')
    } finally {
      setMutatingSkill('')
    }
  }, [loadSkills, selectedAgentName])

  const openDetail = useCallback(async (skill: HermesSkillInfo) => {
    setDetailSkill(skill)
    setDetailData(null)
    setDetailError('')
    setDetailOpen(true)
    setDetailState('loading')
    try {
      const payload = await getHermesSkill(skill.name, selectedAgentName)
      setDetailData(payload)
      setDetailSkill(payload.skill)
      setDetailState('ready')
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '技能文件加载失败')
      setDetailState('error')
    }
  }, [selectedAgentName])

  const isLoading = state === 'loading' && !data
  const refreshButtonVariant = state === 'loading' ? 'danger' : state === 'error' ? 'primary' : 'ghost'

  return (
    <DashboardLayout>
      <div className={error && !data ? 'flex min-h-[calc(100dvh-8rem)] items-center justify-center' : 'mx-auto flex max-w-7xl flex-col gap-6'}>
        {error && !data ? (
          <HermesLoadErrorCard
            error={error}
            isRetrying={state === 'loading'}
            title="无法加载 Hermes 技能"
            onRetry={() => void loadSkills(true)}
          />
        ) : null}

        {error && data ? (
          <Card>
            <Card.Content>
              <div className="flex items-start gap-3 text-danger">
                <Icon icon="lucide:circle-alert" className="mt-0.5 size-5" />
                <div>
                  <p className="font-medium">Hermes 技能刷新失败</p>
                  <p className="mt-1 text-sm text-muted">{error}</p>
                </div>
              </div>
            </Card.Content>
          </Card>
        ) : null}

        {isLoading ? <HermesSkillsSkeleton /> : null}

        {data ? (
          <>
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.85fr)]">
              <HermesHubInstallCard
                error={storeError}
                query={storeQuery}
                state={storeState}
                onQueryChange={setStoreQuery}
                onSearch={searchStore}
              />

              <HermesSkillDistributionCard stats={stats} />
            </section>

            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                {viewMode === 'local' ? (
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                    <Segment selectedKey={activeTab} onSelectionChange={changeTab}>
                      <Segment.Item id="all">
                        <Segment.Separator />
                        全部
                      </Segment.Item>
                      <Segment.Item id="enabled">
                        <Segment.Separator />
                        启用
                      </Segment.Item>
                      <Segment.Item id="disabled">
                        <Segment.Separator />
                        停用
                      </Segment.Item>
                      <Segment.Item id="bundled">
                        <Segment.Separator />
                        内置
                      </Segment.Item>
                      <Segment.Item id="custom">
                        <Segment.Separator />
                        自定义
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
                    <h2 className="font-semibold text-lg text-foreground">发现技能</h2>
                  </div>
                )}

                {viewMode === 'local' ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <SearchField variant="primary" className="md:w-64" value={query} onChange={setQuery} aria-label="搜索 Hermes 技能">
                      <SearchField.Group>
                        <SearchField.SearchIcon />
                        <SearchField.Input placeholder="搜索..." />
                        <SearchField.ClearButton />
                      </SearchField.Group>
                    </SearchField>
                    <Button variant="tertiary" onPress={rescanSkills} isDisabled={state === 'loading'}>
                      <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:scan-line'} className={state === 'loading' ? 'animate-spin' : ''} />
                      重新扫描
                    </Button>
                    <Button isIconOnly variant={refreshButtonVariant} onPress={refreshSkills} isDisabled={state === 'loading'} aria-label="刷新技能">
                      <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button isIconOnly variant="ghost" onPress={() => loadDiscoverSkills(true)} isDisabled={discoverState === 'loading'} aria-label="刷新发现技能">
                      <Icon icon={discoverState === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={discoverState === 'loading' ? 'animate-spin' : ''} />
                    </Button>
                    <Button isIconOnly variant="primary" onPress={() => setViewMode('local')} aria-label="关闭发现">
                      <Icon icon="lucide:x" />
                    </Button>
                  </div>
                )}
              </div>

              {viewMode === 'local' ? (
                <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                  <CategoryPanel categories={categories} selectedCategory={selectedCategory} onSelect={setSelectedCategory} />
                  <div className="flex min-w-0 flex-1 flex-col gap-4">
                    {selectedCategoryDescription ? (
                      <CategoryDescription category={selectedCategory} description={selectedCategoryDescription} />
                    ) : null}
                    <div className="h-[calc(100dvh-210px)] overflow-y-auto">
                      <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-2">
                        {filteredSkills.length > 0 ? (
                          filteredSkills.map((skill) => (
                            <HermesSkillCard
                              key={`${skill.source}-${skill.path}`}
                              skill={skill}
                              mutating={mutatingSkill === skill.name}
                              onOpenDetail={openDetail}
                              onToggle={toggleSkill}
                            />
                          ))
                        ) : (
                          <div className="flex min-h-full xl:col-span-2 2xl:col-span-2">
                            <EmptyState title="没有匹配的技能" description="尝试切换分类、状态或清空搜索关键词。" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <HermesDiscoverSkillsPanel
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

            <HermesSkillsConfigCard data={data} />
          </>
        ) : null}

        <HermesHubSearchResultsModal
          installedSkillKeys={installedSkillKeys}
          isOpen={storeResultsOpen}
          mutatingSkill={mutatingSkill}
          query={storeQuery}
          results={storeResults}
          state={storeState}
          onInstall={installHubSkill}
          onOpenChange={setStoreResultsOpen}
        />

        {detailSkill ? (
          <HermesSkillDetailModal
            skill={detailSkill}
            content={detailData?.content ?? ''}
            error={detailError}
            isOpen={detailOpen}
            state={detailState}
            onOpenChange={setDetailOpen}
            onRetry={() => void openDetail(detailSkill)}
          />
        ) : null}
      </div>
    </DashboardLayout>
  )
}

type HermesSkillStats = ReturnType<typeof getHermesSkillStats>

function HermesHubInstallCard({
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
    <Card variant="transparent" className="overflow-visible">
      <Card.Content>
        <div className="flex flex-row items-center gap-4 md:gap-6">
          <div className="flex h-36 shrink-0 items-center justify-center overflow-visible p-1 drop-shadow-[0_8px_14px_color-mix(in_oklch,var(--accent)_28%,transparent)]">
            <SkillsHeroIllustration className="h-full w-auto md:scale-105" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <div className="min-w-0">
              <Card.Title className="text-2xl font-bold md:text-3xl">Skills</Card.Title>
              <Card.Description className="mt-4 text-base md:text-lg">搜索 Skills Hub，安装到本机 Hermes 技能库。</Card.Description>
              <div className="mt-4 flex flex-row items-end gap-3 md:pr-6">
                <SearchField variant="primary" className="md:w-64" value={query} onChange={onQueryChange} aria-label="搜索 Hermes Skills Hub">
                  <SearchField.Group>
                    <SearchField.SearchIcon />
                    <SearchField.Input placeholder="搜索安装技能..." onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        onSearch()
                      }
                    }} />
                    <SearchField.ClearButton />
                  </SearchField.Group>
                </SearchField>
                <Button isIconOnly variant={query.trim() ? 'primary' : 'tertiary'} onPress={onSearch} isDisabled={isSearching}>
                  <Icon icon={isSearching ? 'lucide:loader-circle' : 'lucide:search'} className={isSearching ? 'animate-spin' : ''} />
                </Button>
              </div>
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

function HermesSkillDistributionCard({ stats }: { stats: HermesSkillStats }) {
  const chartData = [
    { name: '启用', value: stats.enabled, fill: hermesSkillChartColors.enabled },
    { name: '禁用', value: stats.disabled, fill: hermesSkillChartColors.disabled },
  ].filter((item) => item.value > 0)
  const fallbackData = [{ name: '暂无数据', value: 1, fill: 'var(--surface-secondary)' }]
  const activeData = chartData.length ? chartData : fallbackData

  return (
    <Card>
      <Card.Content>
        <div className="flex flex-row items-center gap-6">
          <div className="relative shrink-0">
            <PieChart height={160} width={160}>
              <PieChart.Pie
                cx="50%"
                cy="50%"
                data={activeData}
                dataKey="value"
                innerRadius="56%"
                nameKey="name"
                strokeWidth={0}
              >
                {activeData.map((item) => (
                  <PieChart.Cell key={item.name} fill={item.fill} />
                ))}
              </PieChart.Pie>
              <PieChart.Tooltip content={<PieChart.TooltipContent />} />
            </PieChart>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold tabular-nums text-foreground">{numberFormatter.format(stats.total)}</span>
              <span className="text-[10px] text-muted">全部</span>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <HermesLegendItem label="启用" value={stats.enabled} color={hermesSkillChartColors.enabled} />
            <HermesLegendItem label="禁用" value={stats.disabled} color={hermesSkillChartColors.disabled} />
            <HermesLegendItem label="内置" value={stats.builtin} color={hermesSkillChartColors.builtin} />
            <HermesLegendItem label="集合" value={stats.categories} color={hermesSkillChartColors.categories} />
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function HermesLegendItem({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <span className="truncate text-sm text-foreground">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">{numberFormatter.format(value)}</span>
      </div>
    </div>
  )
}

function CategoryPanel({
  categories,
  selectedCategory,
  onSelect,
}: {
  categories: Array<{ key: string; label: string; count: number }>
  selectedCategory: string
  onSelect: (category: string) => void
}) {
  return (
    <Card>
      <Card.Header>
        <div className="flex items-center gap-2">
          <Icon icon="lucide:folder-tree" className="size-4 text-muted" />
          <Card.Title className="text-sm">分类</Card.Title>
        </div>
      </Card.Header>
      <Card.Content>
        <div className="flex flex-col gap-1 max-h-[calc(100dvh-300px)] overflow-y-auto">
          {categories.map((category) => {
            const selected = selectedCategory === category.key
            return (
              <button
                key={category.key}
                className={`flex min-h-9 items-center justify-between gap-2 rounded-xl px-3 text-left text-sm transition-colors ${selected ? 'bg-accent-soft text-accent-soft-foreground' : 'text-muted hover:bg-surface-secondary hover:text-foreground'}`}
                type="button"
                onClick={() => onSelect(category.key)}
              >
                <span className="min-w-0 truncate">{category.label}</span>
                <span className="shrink-0 font-medium tabular-nums">{numberFormatter.format(category.count)}</span>
              </button>
            )
          })}
        </div>
      </Card.Content>
    </Card>
  )
}

function CategoryDescription({ category, description }: { category: string; description: string }) {
  return (
    <Card>
      <Card.Content>
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background text-primary">
            <Icon icon="lucide:book-open-text" className="size-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{category}</h3>
            <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function HermesHubSearchResultsModal({
  isOpen,
  query,
  state,
  results,
  installedSkillKeys,
  mutatingSkill,
  onInstall,
  onOpenChange,
}: {
  isOpen: boolean
  query: string
  state: 'idle' | 'loading' | 'ready' | 'error'
  results: HermesSkillHubResult[]
  installedSkillKeys: Set<string>
  mutatingSkill: string
  onInstall: (skill: HermesSkillHubResult) => void
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
              <p className="mt-1 text-sm text-muted">共 {results.length} 个结果，安装到当前 Hermes Home</p>
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
                  const installed = installedSkillKeys.has(normalizeSkillKey(result.name))
                  return (
                    <HermesHubSkillCard
                      key={result.identifier || result.name}
                      installed={installed}
                      mutating={mutatingSkill === result.identifier}
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

function HermesDiscoverSkillsPanel({
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
  skills: HermesSkillHubResult[]
  installedSkillKeys: Set<string>
  mutatingSkill: string
  onInstall: (skill: HermesSkillHubResult) => void
  onRefresh: () => void
}) {
  if (state === 'loading') {
    return (
      <div className="grid gap-3 xl:grid-cols-2">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
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
              <p className="font-medium">Hermes Skills Hub 加载失败</p>
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
    <div className="min-h-[calc(100dvh-300px)]">
      {skills.length > 0 ? (
        <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
          {skills.map((skill) => {
            const installed = installedSkillKeys.has(normalizeSkillKey(skill.name))
            return (
              <HermesHubSkillCard
                key={skill.identifier || skill.name}
                installed={installed}
                mutating={mutatingSkill === skill.identifier}
                skill={skill}
                onInstall={onInstall}
              />
            )
          })}
        </div>
      ) : (
        <EmptyState title="没有发现技能" description="Hermes Skills Hub 当前没有返回可展示的技能。" />
      )}
    </div>
  )
}

function HermesHubSkillCard({
  skill,
  installed,
  mutating,
  onInstall,
}: {
  skill: HermesSkillHubResult
  installed?: boolean
  mutating: boolean
  onInstall: (skill: HermesSkillHubResult) => void
}) {
  const title = skill.name || skill.identifier || '未知技能'
  const disabled = installed || mutating || !skill.identifier

  return (
    <Card>
      <Card.Content>
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-surface-secondary/50 text-foreground">
            <Icon icon="lucide:sparkles" className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="truncate text-sm font-bold text-foreground">{title}</h4>
                <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted">{skill.description || '暂无描述'}</p>
              </div>
              <Button className="shrink-0" size="sm" variant={installed ? 'ghost' : 'outline'} onPress={() => onInstall(skill)} isDisabled={disabled}>
                <Icon icon={mutating ? 'lucide:loader-circle' : installed ? 'lucide:check' : 'lucide:download'} className={mutating ? 'animate-spin' : ''} />
                {installed ? '已安装' : '安装'}
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {skill.identifier ? <Chip size="sm" variant="soft">{skill.identifier}</Chip> : null}
              {skill.source ? <Chip size="sm" variant="soft">{formatHubSource(skill.source)}</Chip> : null}
              {skill.trustLevel ? <Chip size="sm" variant="soft">{formatTrustLevel(skill.trustLevel)}</Chip> : null}
              {skill.tags?.slice(0, 3).map((tag) => <Chip key={tag} size="sm" variant="soft">{tag}</Chip>)}
            </div>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function HermesSkillCard({
  skill,
  mutating,
  onOpenDetail,
  onToggle,
}: {
  skill: HermesSkillInfo
  mutating: boolean
  onOpenDetail: (skill: HermesSkillInfo) => void
  onToggle: (skill: HermesSkillInfo) => void
}) {
  return (
    <Card className="h-auto shrink-0">
      <Card.Content className="flex h-full flex-col justify-between">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-secondary/50 text-foreground">
                <Icon icon={skill.disabled ? 'lucide:sparkle' : 'lucide:sparkles'} className="size-4" />
              </div>
              <h3 className="min-w-0 max-w-full truncate font-semibold text-foreground">{skill.name}</h3>
              <Chip size="sm" variant="soft" color={skill.disabled ? 'warning' : 'success'}>{skill.disabled ? '已停用' : '启用'}</Chip>
              {isBuiltinSkill(skill) ? <Chip size="sm" variant="soft">内置</Chip> : null}
            </div>
            <p className="mt-2 line-clamp-1 text-sm leading-5 text-muted">{skill.description || '无描述'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button isIconOnly size="sm" variant="ghost" onPress={() => onOpenDetail(skill)} aria-label="查看技能详情">
              <Icon icon="lucide:info" />
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
        {/* 
        <div className="mt-3 flex flex-wrap gap-1.5">
          {skill.category ? <Chip size="sm" variant="soft">{skill.category}</Chip> : null}
          <Chip size="sm" variant="soft">{formatSource(skill.source)}</Chip>
          {skill.platforms?.slice(0, 3).map((platform) => <Chip key={platform} size="sm" variant="soft">{platform}</Chip>)}
          {skill.tags?.slice(0, 3).map((tag) => <Chip key={tag} size="sm" variant="soft">{tag}</Chip>)}
        </div> */}
        {/* <p className="mt-3 truncate text-xs text-muted">{skill.relativePath}</p> */}
      </Card.Content>
    </Card>
  )
}

function HermesSkillDetailModal({
  skill,
  content,
  error,
  isOpen,
  state,
  onOpenChange,
  onRetry,
}: {
  skill: HermesSkillInfo
  content: string
  error: string
  isOpen: boolean
  state: 'idle' | 'loading' | 'ready' | 'error'
  onOpenChange: (isOpen: boolean) => void
  onRetry: () => void
}) {
  const supportingFiles = skill.supportingFiles ?? []

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="lg">
        <Modal.Dialog className="sm:max-w-[960px]">
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
            <div className="grid h-[min(68dvh,760px)] gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
              <div className="min-h-0 overflow-y-auto">
                <div className="flex flex-col gap-4">
                  <Card>
                    <Card.Content>
                      <div className="grid gap-2 text-xs text-muted">
                        <MetaItem icon="lucide:folder" label="分类" value={skill.category || 'uncategorized'} />
                        <MetaItem icon="lucide:package-check" label="来源" value={formatSource(skill.source)} />
                        <MetaItem icon="lucide:toggle-right" label="状态" value={skill.disabled ? '已停用' : '启用'} />
                        <MetaItem icon="lucide:box" label="内置" value={isBuiltinSkill(skill) ? '是' : '否'} />
                      </div>
                    </Card.Content>
                  </Card>

                  <DetailBlock title="平台与标签" icon="lucide:tags">
                    <ChipList items={[...(skill.platforms ?? []), ...(skill.tags ?? [])]} empty="无平台或标签声明" />
                  </DetailBlock>

                  <DetailBlock title="声明项" icon="lucide:list-checks">
                    <ChipList items={[...(skill.prerequisiteCommands ?? []).map((item) => `cmd:${item}`), ...(skill.configKeys ?? []).map((item) => `config:${item}`)]} empty="无依赖或配置声明" />
                  </DetailBlock>

                  <DetailBlock title="辅助文件" icon="lucide:files">
                    {supportingFiles.length > 0 ? (
                      <div className="grid gap-3">
                        {supportingFiles.map((group) => (
                          <div key={group.name} className="rounded-xl bg-surface-secondary/50 px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm font-medium text-foreground">{group.name}</span>
                              <Chip size="sm" variant="soft">{group.count}</Chip>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {(group.files ?? []).slice(0, 8).map((file) => <Chip key={file} size="sm" variant="soft">{file}</Chip>)}
                              {(group.files ?? []).length > 8 ? <Chip size="sm" variant="soft">+{(group.files ?? []).length - 8}</Chip> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted">未检测到 references、templates、scripts、assets 或 examples 文件。</p>
                    )}
                  </DetailBlock>

                  <DetailBlock title="路径" icon="lucide:link">
                    <div className="grid gap-2 text-sm">
                      <PathRow label="Root" value={skill.root} />
                      <PathRow label="Skill Dir" value={skill.skillDir} />
                      <PathRow label="SKILL.md" value={skill.path} />
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
                  ) : state === 'error' ? (
                    <div className="flex min-h-48 flex-col items-center justify-center text-center">
                      <Icon icon="lucide:circle-alert" className="size-8 text-danger" />
                      <p className="mt-3 text-sm text-muted">{error}</p>
                      <Button className="mt-4" size="sm" variant="danger" onPress={onRetry}>
                        重试
                      </Button>
                    </div>
                  ) : (
                    <SkillMarkdownViewer className="max-h-[calc(min(72dvh,760px))]" content={content} empty="SKILL.md 内容为空" />
                  )}
                </Card.Content>
              </Card>
            </div>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function HermesSkillsConfigCard({ data }: { data: HermesSkillsResponse }) {
  const platformDisabled = data.config.platformDisabled ?? []
  const toolsets = data.config.toolsets ?? []
  const disabledToolsets = data.config.disabledToolsets ?? []

  return (
    <Card>
      <Card.Content>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Icon icon="lucide:settings-2" className="size-4 text-muted" />
              <h3 className="text-sm font-semibold text-foreground">技能配置</h3>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted">{data.config.liveReloadHint}</p>
            <p className="mt-2 break-all text-xs text-muted">{data.config.path}</p>
          </div>
          <div className="flex flex-wrap gap-1.5 md:justify-end">
            <Chip size="sm" variant="soft">template vars {data.config.templateVars ? 'on' : 'off'}</Chip>
            <Chip size="sm" variant="soft">inline shell {data.config.inlineShell ? 'on' : 'off'}</Chip>
            <Chip size="sm" variant="soft">内置 {data.config.skillToolsetEnabled ? 'on' : 'off'}</Chip>
            {toolsets.length > 0 ? <Chip size="sm" variant="soft">内置来源 {toolsets.join(', ')}</Chip> : null}
            {disabledToolsets.length > 0 ? <Chip size="sm" variant="soft">停用内置来源 {disabledToolsets.length}</Chip> : null}
            {data.config.inlineShellTimeout ? <Chip size="sm" variant="soft">timeout {data.config.inlineShellTimeout}</Chip> : null}
            {platformDisabled.length > 0 ? <Chip size="sm" variant="soft">platform disabled {platformDisabled.length}</Chip> : null}
          </div>
        </div>
      </Card.Content>
    </Card>
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

function MetaItem({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon icon={icon} className="size-4 shrink-0" />
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 truncate font-medium text-foreground">{value}</span>
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

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card className="flex min-h-full flex-1">
      <Card.Content className="flex flex-1">
        <div className="flex min-h-full flex-1 flex-col items-center justify-center px-6 py-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-secondary/50 text-muted">
            <Icon icon="lucide:inbox" className="size-6" />
          </div>
          <h3 className="mt-4 font-semibold text-foreground">{title}</h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{description}</p>
        </div>
      </Card.Content>
    </Card>
  )
}

function HermesSkillsSkeleton() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.85fr)]">
        <Skeleton className="h-40 rounded-3xl" />
        <Skeleton className="h-40 rounded-3xl" />
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    </div>
  )
}

function getCategoryOptions(skills: HermesSkillInfo[]) {
  const counts = skills.reduce<Record<string, number>>((acc, skill) => {
    const category = skill.category || 'uncategorized'
    acc[category] = (acc[category] ?? 0) + 1
    return acc
  }, {})
  const categories = Object.entries(counts)
    .map(([key, count]) => ({ key, label: key === 'uncategorized' ? '未分类' : key, count }))
    .sort((a, b) => b.count - a.count || collator.compare(a.label, b.label))
  return [{ key: 'all', label: '全部', count: skills.length }, ...categories]
}

function getHermesSkillStats(skills: HermesSkillInfo[]) {
  return skills.reduce((stats, skill) => {
    stats.total += 1
    if (skill.disabled) {
      stats.disabled += 1
    } else {
      stats.enabled += 1
    }

    const category = skill.category || 'uncategorized'
    stats.categorySet.add(category)
    stats.categories = stats.categorySet.size

    if (isBuiltinSkill(skill)) {
      stats.builtin += 1
    } else if (skill.source === 'custom') {
      stats.custom += 1
    } else if (skill.source === 'external') {
      stats.external += 1
    } else {
      stats.unknown += 1
    }
    return stats
  }, {
    total: 0,
    enabled: 0,
    disabled: 0,
    builtin: 0,
    custom: 0,
    external: 0,
    unknown: 0,
    categories: 0,
    categorySet: new Set<string>(),
  })
}

function matchesTab(skill: HermesSkillInfo, tab: SkillTab) {
  switch (tab) {
    case 'enabled':
      return !skill.disabled
    case 'disabled':
      return skill.disabled
    case 'bundled':
      return isBuiltinSkill(skill)
    case 'custom':
      return skill.source === 'custom'
    case 'external':
      return skill.source === 'external'
    default:
      return true
  }
}

function isBuiltinSkill(skill: HermesSkillInfo) {
  return skill.toolsetEnabled || skill.bundled || skill.source === 'bundled'
}

function normalizeSkillKey(value: string) {
  return value.trim().toLowerCase()
}

function replaceSkill(data: HermesSkillsResponse, skill: HermesSkillInfo): HermesSkillsResponse {
  return {
    ...data,
    skills: data.skills.map((item) => item.name === skill.name ? skill : item),
  }
}

function formatSource(source: string) {
  switch (source) {
    case 'bundled':
      return '内置'
    case 'custom':
      return '自定义'
    case 'external':
      return '外部'
    case 'hub':
      return 'Hub'
    default:
      return source || '未知'
  }
}

function formatHubSource(source: string) {
  switch (source) {
    case 'official':
      return '官方'
    case 'skills-sh':
      return 'skills.sh'
    case 'well-known':
      return 'well-known'
    case 'github':
      return 'GitHub'
    case 'clawhub':
      return 'ClawHub'
    case 'claude-marketplace':
      return 'Claude'
    case 'lobehub':
      return 'LobeHub'
    default:
      return source || '未知'
  }
}

function formatTrustLevel(value: string) {
  switch (value) {
    case 'builtin':
      return '内置可信'
    case 'trusted':
      return '可信'
    case 'community':
      return '社区'
    default:
      return value
  }
}

export default HermesSkillsPage
