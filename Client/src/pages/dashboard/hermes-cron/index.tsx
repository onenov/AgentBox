import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode, SVGProps } from 'react'
import type { Selection } from '@heroui/react'
import { Alert, AlertDialog, Button, Card, Chip, Dropdown, Input, Label, Modal, SearchField, Separator, Skeleton, Switch, toast } from '@heroui/react'
import { ItemCard, ItemCardGroup, PieChart, Segment } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type { HermesCronJob, HermesCronJobCreate, HermesCronJobPatch, HermesCronListResponse, HermesCronRunEntry, HermesCronRunsResponse, HermesCronStatusResponse, HermesModelsResponse, HermesPlatformInfo, HermesPlatformsResponse, HermesSkillInfo, HermesSkillsResponse } from '@/api'
import { createHermesCronJob, deleteHermesCronJob, getHermesCronStatus, getHermesModels, getHermesPlatforms, getHermesSkills, listHermesCronJobs, listHermesCronRuns, runHermesCronJob, updateHermesCronJob } from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { useHermesAgentStore } from '@/stores/hermes-agent'
import { HermesLoadErrorCard } from '../hermes-shared/HermesLoadErrorCard'

type LoadState = 'idle' | 'loading' | 'ready' | 'error'
type ScheduleKind = 'cron' | 'every' | 'once'
type FormMode = 'create' | 'edit'
type FormSection = 'delivery' | 'execution' | 'preview' | 'schedule'
type BoardColumn = 'enabled' | 'paused'
type RunStatusFilter = 'all' | 'error' | 'ok'

type SelectOption = {
  icon?: string
  id: string
  label: string
}

type CronFormOptions = {
  deliverTargets: SelectOption[]
  models: HermesModelsResponse | null
  skills: HermesSkillInfo[]
}

type CronFormState = {
  baseUrl: string
  contextFrom: string
  deliver: string
  enabledToolsets: string
  everyUnit: 'd' | 'h' | 'm'
  everyValue: string
  model: string
  name: string
  noAgent: boolean
  prompt: string
  provider: string
  repeat: string
  schedule: string
  scheduleKind: ScheduleKind
  script: string
  skills: string
  workdir: string
}

const defaultForm: CronFormState = {
  baseUrl: '',
  contextFrom: '',
  deliver: '',
  enabledToolsets: '',
  everyUnit: 'h',
  everyValue: '1',
  model: '',
  name: '',
  noAgent: false,
  prompt: '',
  provider: '',
  repeat: '',
  schedule: '0 9 * * *',
  scheduleKind: 'cron',
  script: '',
  skills: '',
  workdir: '',
}

const defaultScheduleByKind: Record<ScheduleKind, string> = {
  cron: '0 9 * * *',
  every: '',
  once: '30m',
}

const formSections = [
  { id: 'schedule', label: '计划' },
  { id: 'execution', label: '执行' },
  { id: 'delivery', label: '投递' },
  { id: 'preview', label: '预览' },
]

const scheduleTabs = [
  { id: 'once', label: '一次性' },
  { id: 'every', label: '固定间隔' },
  { id: 'cron', label: 'Cron 表达式' },
]

const chartColors = {
  enabled: 'var(--success)',
  paused: 'var(--muted)',
}

const cronDeliveryPlatformNames = new Set([
  'bluebubbles',
  'dingtalk',
  'discord',
  'email',
  'feishu',
  'homeassistant',
  'matrix',
  'mattermost',
  'qqbot',
  'signal',
  'slack',
  'sms',
  'telegram',
  'wecom',
  'wecom_callback',
  'weixin',
  'whatsapp',
  'yuanbao',
])

const numberFormatter = new Intl.NumberFormat('zh-CN')
const collator = new Intl.Collator('zh-CN')

function HermesCronPage() {
  usePageTitle('Hermes 定时任务')
  const selectedAgentName = useHermesAgentStore((store) => store.selectedName)
  const loadAgents = useHermesAgentStore((store) => store.loadAgents)
  const [state, setState] = useState<LoadState>('idle')
  const [status, setStatus] = useState<HermesCronStatusResponse | null>(null)
  const [jobsData, setJobsData] = useState<HermesCronListResponse | null>(null)
  const [runsData, setRunsData] = useState<HermesCronRunsResponse | null>(null)
  const [skillsData, setSkillsData] = useState<HermesSkillsResponse | null>(null)
  const [modelsData, setModelsData] = useState<HermesModelsResponse | null>(null)
  const [platformsData, setPlatformsData] = useState<HermesPlatformsResponse | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [runQuery, setRunQuery] = useState('')
  const [runStatusFilter, setRunStatusFilter] = useState<RunStatusFilter>('all')
  const [form, setForm] = useState<CronFormState>(defaultForm)
  const [formMode, setFormMode] = useState<FormMode>('create')
  const [activeSection, setActiveSection] = useState<FormSection>('schedule')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingJobId, setEditingJobId] = useState('')
  const [mutatingJobId, setMutatingJobId] = useState('')
  const [jobToDelete, setJobToDelete] = useState<HermesCronJob | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const loadCron = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const [nextStatus, nextJobs, nextRuns] = await Promise.all([
        getHermesCronStatus(selectedAgentName),
        listHermesCronJobs({ enabled: 'all', includeDisabled: true, limit: 100, profile: selectedAgentName, query, sortBy: 'nextRunAt' }),
        listHermesCronRuns({ limit: 100, profile: selectedAgentName, query: runQuery, sortDir: 'desc', status: runStatusFilter }),
      ])
      setStatus(nextStatus)
      setJobsData(nextJobs)
      setRunsData(nextRuns)
      void Promise.all([
        getHermesSkills(false, selectedAgentName),
        getHermesModels(selectedAgentName),
        getHermesPlatforms(false, selectedAgentName),
      ]).then(([nextSkills, nextModels, nextPlatforms]) => {
        setSkillsData(nextSkills)
        setModelsData(nextModels)
        setPlatformsData(nextPlatforms)
      }).catch(() => {
        setSkillsData(null)
        setModelsData(null)
        setPlatformsData(null)
      })
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hermes 定时任务加载失败')
      setState('error')
    }
  }, [query, runQuery, runStatusFilter, selectedAgentName])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAgents(false)
      void loadCron()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAgents, loadCron])

  const jobs = useMemo(() => jobsData?.jobs ?? [], [jobsData?.jobs])
  const runs = useMemo(() => runsData?.entries ?? [], [runsData?.entries])
  const stats = useMemo(() => getCronStats(jobs), [jobs])
  const groupedJobs = useMemo(() => groupJobs(jobs), [jobs])
  const isLoading = state === 'loading' && !jobsData
  const createPayload = useMemo(() => buildCreatePayload(form), [form])
  const createPayloadText = useMemo(() => JSON.stringify(createPayload, null, 2), [createPayload])
  const formOptions = useMemo<CronFormOptions>(() => ({
    deliverTargets: buildDeliveryTargetOptions(platformsData?.platforms ?? []),
    models: modelsData,
    skills: skillsData?.skills ?? [],
  }), [modelsData, platformsData?.platforms, skillsData?.skills])
  const shouldShowJobSearch = jobs.length > 0 || query.trim() !== ''
  const hasLoadError = Boolean(error && !status && !jobsData && !runsData)

  const openCreateForm = useCallback(() => {
    setForm(defaultForm)
    setFormMode('create')
    setEditingJobId('')
    setActiveSection('schedule')
    setIsFormOpen(true)
  }, [])

  const openEditForm = useCallback((job: HermesCronJob) => {
    setForm(jobToForm(job))
    setFormMode('edit')
    setEditingJobId(job.id)
    setActiveSection('schedule')
    setIsFormOpen(true)
  }, [])

  const submitForm = useCallback(async () => {
    const validation = validateForm(form)
    if (validation) {
      toast.warning(validation)
      return
    }
    setIsSubmitting(true)
    try {
      if (formMode === 'create') {
        await createHermesCronJob(buildCreatePayload(form), selectedAgentName)
        toast.success('Hermes 定时任务已创建')
      } else {
        await updateHermesCronJob(editingJobId, buildPatchPayload(form), selectedAgentName)
        toast.success('Hermes 定时任务已保存')
      }
      setIsFormOpen(false)
      setForm(defaultForm)
      setEditingJobId('')
      await loadCron()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : formMode === 'create' ? '定时任务创建失败' : '定时任务保存失败')
    } finally {
      setIsSubmitting(false)
    }
  }, [editingJobId, form, formMode, loadCron, selectedAgentName])

  const toggleJob = useCallback(async (job: HermesCronJob) => {
    setMutatingJobId(job.id)
    try {
      await updateHermesCronJob(job.id, { enabled: !(job.enabled ?? true) }, selectedAgentName)
      toast.success((job.enabled ?? true) ? '定时任务已暂停' : '定时任务已恢复')
      await loadCron()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '任务状态更新失败')
    } finally {
      setMutatingJobId('')
    }
  }, [loadCron, selectedAgentName])

  const runJob = useCallback(async (job: HermesCronJob) => {
    setMutatingJobId(job.id)
    try {
      await runHermesCronJob(job.id, selectedAgentName)
      toast.success('任务已标记为下次 tick 运行')
      await loadCron()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '任务触发失败')
    } finally {
      setMutatingJobId('')
    }
  }, [loadCron, selectedAgentName])

  const cloneJob = useCallback(async (job: HermesCronJob) => {
    setMutatingJobId(job.id)
    try {
      await createHermesCronJob({ ...jobToCreatePayload(job), name: `${job.name} 副本` }, selectedAgentName)
      toast.success('定时任务已克隆')
      await loadCron()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '定时任务克隆失败')
    } finally {
      setMutatingJobId('')
    }
  }, [loadCron, selectedAgentName])

  const deleteJob = useCallback(async () => {
    if (!jobToDelete) return
    setMutatingJobId(jobToDelete.id)
    try {
      await deleteHermesCronJob(jobToDelete.id, selectedAgentName)
      toast.success('定时任务已删除')
      setJobToDelete(null)
      await loadCron()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '定时任务删除失败')
    } finally {
      setMutatingJobId('')
    }
  }, [jobToDelete, loadCron, selectedAgentName])

  return (
    <DashboardLayout>
      <div className={hasLoadError ? 'flex min-h-[calc(100dvh-8rem)] items-center justify-center' : 'mx-auto flex max-w-7xl flex-col gap-6'}>
        {hasLoadError ? (
          <HermesLoadErrorCard
            error={error}
            isRetrying={state === 'loading'}
            title="无法加载 Hermes 定时任务"
            onRetry={() => void loadCron()}
          />
        ) : null}

        {!hasLoadError ? (
          <>
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.8fr)]">
              <CronHero isRefreshing={state === 'loading'} onCreate={openCreateForm} onRefresh={() => void loadCron()} />
              <CronStatusCard status={status} stats={stats} />
            </section>

            {error ? <ErrorCard error={error} /> : null}

            <section className="flex flex-col gap-4">
              {shouldShowJobSearch ? (
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <SearchField variant="primary" className="md:w-72" value={query} onChange={setQuery} aria-label="搜索 Hermes 定时任务">
                    <SearchField.Group>
                      <SearchField.SearchIcon />
                      <SearchField.Input placeholder="搜索任务..." />
                      <SearchField.ClearButton />
                    </SearchField.Group>
                  </SearchField>
                </div>
              ) : null}

              {isLoading ? <CronSkeleton /> : null}
              {!isLoading && jobs.length === 0 ? <EmptyState /> : null}
              {!isLoading && jobs.length > 0 ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  <CronColumn
                    id="enabled"
                    jobs={groupedJobs.enabled}
                    mutatingJobId={mutatingJobId}
                    onClone={cloneJob}
                    onDelete={setJobToDelete}
                    onEdit={openEditForm}
                    onRun={runJob}
                    onToggle={toggleJob}
                  />
                  <CronColumn
                    id="paused"
                    jobs={groupedJobs.paused}
                    mutatingJobId={mutatingJobId}
                    onClone={cloneJob}
                    onDelete={setJobToDelete}
                    onEdit={openEditForm}
                    onRun={runJob}
                    onToggle={toggleJob}
                  />
                </div>
              ) : null}
            </section>

            <CronRunHistory
              query={runQuery}
              runs={runs}
              statusFilter={runStatusFilter}
              total={runsData?.total ?? runs.length}
              onQueryChange={setRunQuery}
              onRefresh={() => void loadCron()}
              onStatusFilterChange={setRunStatusFilter}
            />
          </>
        ) : null}
      </div>

      <CronFormModal
        activeSection={activeSection}
        createPayloadText={createPayloadText}
        form={form}
        formMode={formMode}
        formOptions={formOptions}
        isOpen={isFormOpen}
        isSubmitting={isSubmitting}
        onActiveSectionChange={setActiveSection}
        onChange={setForm}
        onOpenChange={setIsFormOpen}
        onSubmit={submitForm}
      />

      <AlertDialog.Backdrop isOpen={jobToDelete !== null} onOpenChange={(open) => !open && setJobToDelete(null)}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[440px]">
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>删除定时任务？</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">这会删除 {jobToDelete?.name || jobToDelete?.id}，并清理对应输出目录。</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="tertiary" onPress={() => setJobToDelete(null)}>取消</Button>
              <Button variant="danger" isPending={mutatingJobId === jobToDelete?.id} onPress={deleteJob}>删除</Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </DashboardLayout>
  )
}

const cronHeroGridStroke = 'rgba(247, 247, 247, 1)'

function CronHeroIllustration(props: Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'xmlns'>) {
  const { className, ...rest } = props
  const accentMuted = 'color-mix(in oklch, var(--accent) 72%, white)'
  const accentDeep = 'color-mix(in oklch, var(--accent), black 0%)'
  const accentBright = 'color-mix(in oklch, var(--accent), white 26%)'
  const accentFill = 'var(--accent)'
  const stripeSoft = 'color-mix(in oklch, var(--accent), white 18%)'

  const bannerGradId = 'hermesCronHeroBannerGrad'

  const vb = { x: 128, y: 0, w: 390, h: 302 }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      fill="none"
      className={className}
      aria-hidden
      {...rest}
    >
      <path stroke={cronHeroGridStroke} strokeWidth={2} d="M140 71H510" />
      <path stroke={cronHeroGridStroke} strokeWidth={2} d="M140 121H510" />
      <path stroke={cronHeroGridStroke} strokeWidth={2} d="M210 1V301" />
      <path stroke={cronHeroGridStroke} strokeWidth={2} d="M180 1V301" />

      <rect fill="#F7F7F7" height={130} width={190} x={210} y={51} />
      <rect fill={`url(#${bannerGradId})`} height={30} width={190} x={210} y={41} />
      <rect fill="#FFFFFF" height={10} width={110} x={250} y={91} />
      <rect fill="#EBECEC" height={10} width={110} x={250} y={111} />
      <rect fill="#EBECEC" height={10} width={110} x={250} y={131} />
      <rect fill="#EBECEC" height={10} width={110} x={250} y={151} />

      <rect fill="#F7F7F7" height={40} width={90} x={320} y={191} />
      <rect fill="#EBECEC" height={40} width={20} x={400} y={191} />
      <rect fill={accentBright} height={10} width={100} x={320} y={191} />
      <rect fill={accentMuted} height={10} width={20} x={400} y={191} />
      <path fill="#EBECEC" d="M320 231 320 251 340 231z" />

      <rect fill="#FFFFFF" height={60} width={130} x={180} y={121} />
      <rect fill="#F7F7F7" height={60} width={30} x={180} y={121} />
      <rect fill={stripeSoft} height={10} width={130} x={180} y={121} />
      <rect fill={accentBright} height={10} width={30} x={180} y={121} />
      <path fill="#EBECEC" d="M180 181 180 211 210 181z" />

      <circle cx={210} cy={71} fill="#C3C5C6" r={30} />
      <path
        fill="#181818"
        d="M210 101C226.569 101 240 87.5685 240 71C240 54.4315 226.569 41 210 41L210 101Z"
      />
      <circle cx={210} cy={71} fill="#FFFFFF" r={20} />
      <rect fill={accentMuted} height={15} width={5} x={207.5} y={56} />
      <rect fill={accentFill} height={15} transform="rotate(90 222.5 68.5)" width={5} x={222.5} y={68.5} />

      <defs>
        <linearGradient gradientUnits="userSpaceOnUse" id={bannerGradId} x1={400} x2={210} y1={56} y2={56}>
          <stop offset="0" stopColor={accentBright} />
          <stop offset="0.52" stopColor="var(--accent)" />
          <stop offset="1" stopColor={accentDeep} />
        </linearGradient>
      </defs>
    </svg>
  )
}

function CronHero({ isRefreshing, onCreate, onRefresh }: { isRefreshing: boolean; onCreate: () => void; onRefresh: () => void }) {
  return (
    <Card variant="transparent" className="overflow-visible">
      <Card.Content>
        <div className="flex flex-row items-center gap-4 md:gap-6">
          <div className="flex h-36 shrink-0 items-center justify-center overflow-visible rounded-2xl p-1 drop-shadow-[0_8px_14px_color-mix(in_oklch,var(--accent)_28%,transparent)]">
            <CronHeroIllustration className="h-full w-auto md:scale-105" />
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            <div className="min-w-0">
              <Card.Title className="text-2xl font-bold md:text-3xl">定时任务</Card.Title>
              <Card.Description className="mt-4 text-base md:text-lg">安排提醒、简报、脚本巡检和 skill 驱动的周期任务。</Card.Description>
            </div>
            <div className="flex flex-row items-center gap-3">
              <Button variant="primary" onPress={onCreate}>
                <Icon icon="lucide:plus" className="size-4" />
                创建任务
              </Button>
              <Button isIconOnly aria-label="刷新任务" variant={isRefreshing ? 'primary' : 'tertiary'} isDisabled={isRefreshing} onPress={onRefresh}>
                <Icon icon={isRefreshing ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={isRefreshing ? 'animate-spin' : ''} />
              </Button>
            </div>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function CronStatusCard({ status, stats }: { status: HermesCronStatusResponse | null; stats: ReturnType<typeof getCronStats> }) {
  const data = [
    { name: '已启用', value: stats.enabled, fill: chartColors.enabled },
    { name: '已暂停', value: stats.paused, fill: chartColors.paused },
  ].filter((item) => item.value > 0)
  const displayData = data.length ? data : [{ name: '暂无数据', value: 1, fill: 'var(--surface-secondary)' }]
  return (
    <Card>
      <Card.Content>
        <div className="flex flex-row items-center gap-6">
          <div className="relative shrink-0">
            <PieChart height={160} width={160}>
              <PieChart.Pie cx="50%" cy="50%" data={displayData} dataKey="value" innerRadius="56%" nameKey="name" strokeWidth={0}>
                {displayData.map((item) => <PieChart.Cell key={item.name} fill={item.fill} />)}
              </PieChart.Pie>
              <PieChart.Tooltip content={<PieChart.TooltipContent />} />
            </PieChart>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold tabular-nums text-foreground">{numberFormatter.format(stats.total)}</span>
              <span className="text-[10px] text-muted">全部</span>
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <Legend label="Gateway" value={status?.gatewayRunning ? '运行中' : '未运行'} color={status?.gatewayRunning ? 'var(--success)' : 'var(--warning)'} />
            <Legend label="启用" value={numberFormatter.format(stats.enabled)} color={chartColors.enabled} />
            <Legend label="暂停" value={numberFormatter.format(stats.paused)} color={chartColors.paused} />
            <p className="truncate text-xs text-muted">下次运行 {status?.nextRunAt ? formatDateTime(status.nextRunAt) : '无'}</p>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function Legend({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  )
}

function CronColumn({
  id,
  jobs,
  mutatingJobId,
  onClone,
  onDelete,
  onEdit,
  onRun,
  onToggle,
}: {
  id: BoardColumn
  jobs: HermesCronJob[]
  mutatingJobId: string
  onClone: (job: HermesCronJob) => void
  onDelete: (job: HermesCronJob) => void
  onEdit: (job: HermesCronJob) => void
  onRun: (job: HermesCronJob) => void
  onToggle: (job: HermesCronJob) => void
}) {
  return (
    <Card className="min-h-[420px]">
      <Card.Header className="items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`size-2.5 rounded-full ${id === 'enabled' ? 'bg-success' : 'bg-default'}`} />
          <Card.Title className="text-sm">{id === 'enabled' ? '已启用' : '已暂停'}</Card.Title>
        </div>
        <Chip size="sm" variant="soft">{jobs.length}</Chip>
      </Card.Header>
      <Card.Content>
        <div className="grid gap-3">
          {jobs.length > 0 ? jobs.map((job) => (
            <CronJobCard
              key={job.id}
              job={job}
              mutating={mutatingJobId === job.id}
              onClone={onClone}
              onDelete={onDelete}
              onEdit={onEdit}
              onRun={onRun}
              onToggle={onToggle}
            />
          )) : (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl bg-surface-secondary/50 px-6 py-8 text-center">
              <Icon icon="lucide:calendar-x" className="size-8 text-muted" />
              <p className="mt-3 text-sm text-muted">暂无任务</p>
            </div>
          )}
        </div>
      </Card.Content>
    </Card>
  )
}

function CronJobCard({ job, mutating, onClone, onDelete, onEdit, onRun, onToggle }: {
  job: HermesCronJob
  mutating: boolean
  onClone: (job: HermesCronJob) => void
  onDelete: (job: HermesCronJob) => void
  onEdit: (job: HermesCronJob) => void
  onRun: (job: HermesCronJob) => void
  onToggle: (job: HermesCronJob) => void
}) {
  return (
    <Card className="bg-surface-secondary/50">
      <Card.Content>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">{job.name || job.id}</h3>
              <Chip size="sm" variant="soft" color={(job.enabled ?? true) ? 'success' : 'default'}>{(job.enabled ?? true) ? '启用' : '暂停'}</Chip>
              {job.no_agent ? <Chip size="sm" variant="soft">no-agent</Chip> : null}
            </div>
            <p className="mt-2 line-clamp-2 text-sm leading-5 text-muted">{job.promptPreview || job.prompt || job.script || '无提示词'}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Chip size="sm" variant="soft">{formatSchedule(job)}</Chip>
              <Chip size="sm" variant="soft">repeat {job.repeatLabel || 'forever'}</Chip>
              {job.deliver ? <Chip size="sm" variant="soft">{job.deliver}</Chip> : null}
              {(job.skills ?? []).slice(0, 3).map((skill) => <Chip key={skill} size="sm" variant="soft">{skill}</Chip>)}
            </div>
            <div className="mt-3 grid gap-1 text-xs text-muted">
              <span>下次 {job.next_run_at ? formatDateTime(job.next_run_at) : '无'}</span>
              {job.last_run_at ? <span>上次 {formatDateTime(job.last_run_at)} · {job.last_status || 'unknown'}</span> : null}
              {job.last_error ? <span className="text-danger">{job.last_error}</span> : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button isIconOnly size="sm" variant="ghost" aria-label="立即运行" isDisabled={mutating} onPress={() => onRun(job)}>
              <Icon icon={mutating ? 'lucide:loader-circle' : 'lucide:play'} className={mutating ? 'animate-spin' : ''} />
            </Button>
            <Button isIconOnly size="sm" variant="ghost" aria-label="编辑" onPress={() => onEdit(job)}>
              <Icon icon="lucide:pencil" />
            </Button>
            <Button isIconOnly size="sm" variant="ghost" aria-label="克隆" isDisabled={mutating} onPress={() => onClone(job)}>
              <Icon icon="lucide:copy" />
            </Button>
            <Button isIconOnly size="sm" variant="danger" aria-label="删除" onPress={() => onDelete(job)}>
              <Icon icon="lucide:trash-2" />
            </Button>
            <Switch aria-label="启停任务" isDisabled={mutating} isSelected={job.enabled ?? true} size="lg" onChange={() => onToggle(job)}>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function CronRunHistory({ runs, query, statusFilter, total, onQueryChange, onRefresh, onStatusFilterChange }: {
  runs: HermesCronRunEntry[]
  query: string
  statusFilter: RunStatusFilter
  total: number
  onQueryChange: (query: string) => void
  onRefresh: () => void
  onStatusFilterChange: (filter: RunStatusFilter) => void
}) {
  if (total === 0) return null

  return (
    <Card>
      <Card.Header>
        <div className="flex w-full items-center justify-between gap-4">
          <div>
            <Card.Title>运行输出</Card.Title>
            <Card.Description>来自 ~/.hermes/cron/output 的 markdown 输出。</Card.Description>
          </div>
          <div className="flex items-center gap-2">
            <Segment selectedKey={statusFilter} onSelectionChange={(key) => onStatusFilterChange(String(key) as RunStatusFilter)}>
              {[
                { id: 'all', label: '全部' },
                { id: 'ok', label: '成功' },
                { id: 'error', label: '错误' },
              ].map((option) => (
                <Segment.Item key={option.id} id={option.id}>
                  <Segment.Separator />
                  {option.label}
                </Segment.Item>
              ))}
            </Segment>
            <SearchField variant="primary" className="md:w-64" value={query} onChange={onQueryChange} aria-label="搜索运行输出">
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="搜索输出..." />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <Button isIconOnly variant="ghost" aria-label="刷新运行输出" onPress={onRefresh}>
              <Icon icon="lucide:refresh-cw" />
            </Button>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        {runs.length > 0 ? (
          <div className="grid gap-3">
            {runs.map((run) => (
              <div key={`${run.jobId}-${run.file}`} className="rounded-2xl bg-surface-secondary/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{run.jobName || run.jobId}</p>
                    <p className="mt-1 text-xs text-muted">{formatDateTime(run.ts)} · {run.file}</p>
                  </div>
                  <Chip size="sm" variant="soft">{run.status || 'ok'}</Chip>
                </div>
                <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-muted">{run.summary || '无输出摘要'}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-48 flex-col items-center justify-center text-center">
            <Icon icon="lucide:scroll-text" className="size-8 text-muted" />
            <p className="mt-3 text-sm text-muted">{total > 0 ? '没有匹配的运行输出' : '暂无运行输出'}</p>
          </div>
        )}
      </Card.Content>
    </Card>
  )
}

function CronFormModal({
  activeSection,
  createPayloadText,
  form,
  formMode,
  formOptions,
  isOpen,
  isSubmitting,
  onActiveSectionChange,
  onChange,
  onOpenChange,
  onSubmit,
}: {
  activeSection: FormSection
  createPayloadText: string
  form: CronFormState
  formMode: FormMode
  formOptions: CronFormOptions
  isOpen: boolean
  isSubmitting: boolean
  onActiveSectionChange: (section: FormSection) => void
  onChange: (form: CronFormState) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
}) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="sm:max-w-[680px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
              <Icon icon="lucide:calendar-plus" className="size-5" />
            </Modal.Icon>
            <div>
              <Modal.Heading>{formMode === 'create' ? '创建 Hermes 定时任务' : '编辑 Hermes 定时任务'}</Modal.Heading>
              <p className="mt-1 text-sm text-muted">让 Hermes 在合适的时间主动完成提醒、简报、脚本巡检或 skill 任务。</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="space-y-5">
              <Segment selectedKey={activeSection} onSelectionChange={(key) => onActiveSectionChange(String(key) as FormSection)}>
                {formSections.map((section) => (
                  <Segment.Item key={section.id} id={section.id}>
                    <Segment.Separator />
                    {section.label}
                  </Segment.Item>
                ))}
              </Segment>
              <div className="max-h-[480px] overflow-auto">
                {activeSection === 'preview' ? (
                  <Card>
                    <Card.Header className="items-start justify-between gap-4">
                      <div>
                        <Card.Title>JSON 预览</Card.Title>
                        <Card.Description>提交前确认 Hermes cron 将收到的任务参数。</Card.Description>
                      </div>
                    </Card.Header>
                    <Card.Content>
                      <pre className="max-h-[440px] overflow-auto rounded-2xl bg-surface-secondary/50 p-4 text-xs leading-5 text-foreground">{createPayloadText}</pre>
                    </Card.Content>
                  </Card>
                ) : (
                  <CronCreateForm
                    activeSection={activeSection}
                    form={form}
                    formOptions={formOptions}
                    isSubmitting={isSubmitting}
                    onChange={onChange}
                  />
                )}
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={() => onOpenChange(false)}>取消</Button>
            <Button variant="primary" isPending={isSubmitting} onPress={onSubmit}>
              <Icon icon="lucide:save" className="size-4" />
              {formMode === 'create' ? '创建任务' : '保存任务'}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function CronCreateForm({
  activeSection,
  form,
  formOptions,
  isSubmitting,
  onChange,
}: {
  activeSection: Exclude<FormSection, 'preview'>
  form: CronFormState
  formOptions: CronFormOptions
  isSubmitting: boolean
  onChange: (form: CronFormState) => void
}) {
  const update = (patch: Partial<CronFormState>) => onChange({ ...form, ...patch })

  return (
    <div className="space-y-5">
      {activeSection === 'schedule' ? <ScheduleForm form={form} isSubmitting={isSubmitting} update={update} /> : null}
      {activeSection === 'execution' ? <ExecutionForm form={form} formOptions={formOptions} isSubmitting={isSubmitting} update={update} /> : null}
      {activeSection === 'delivery' ? <DeliveryForm form={form} formOptions={formOptions} isSubmitting={isSubmitting} update={update} /> : null}
    </div>
  )
}

function ScheduleForm({ form, isSubmitting, update }: { form: CronFormState; isSubmitting: boolean; update: (patch: Partial<CronFormState>) => void }) {
  return (
    <>
      <ItemCardGroup className="overflow-hidden">
        <ItemCardGroup.Header>
          <ItemCardGroup.Title>基础信息</ItemCardGroup.Title>
          <ItemCardGroup.Description>给任务一个清晰名称，后续在列表和运行输出里更容易辨认。</ItemCardGroup.Description>
        </ItemCardGroup.Header>
        <FormItem description="会显示在任务列表和运行历史里。" icon="lucide:tag" title="任务名称">
          <Input fullWidth variant="secondary" value={form.name} disabled={isSubmitting} placeholder="每日简报" onChange={(event) => update({ name: event.target.value })} />
        </FormItem>
        <Separator />
        <FormItem icon="lucide:repeat" title="重复次数">
          <Input fullWidth variant="secondary" type="number" min={0} value={form.repeat} disabled={isSubmitting} placeholder="留空默认，0 表示永久" onChange={(event) => update({ repeat: event.target.value })} />
        </FormItem>
      </ItemCardGroup>

      <Alert>
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>重复次数说明</Alert.Title>
          <Alert.Description>
            留空使用 Hermes 默认值；一次性任务默认运行一次，周期任务默认持续运行。0 或负数表示不限次数。
          </Alert.Description>
        </Alert.Content>
      </Alert>

      <ItemCardGroup className="overflow-hidden">
        <ItemCardGroup.Header>
          <ItemCardGroup.Title>计划</ItemCardGroup.Title>
          <ItemCardGroup.Description>选择 Hermes cron 解析的触发方式。</ItemCardGroup.Description>
        </ItemCardGroup.Header>
        <FormItem description="支持一次性、固定间隔和标准 Cron 表达式。" icon="lucide:calendar-clock" title="计划类型">
          <Segment
            selectedKey={form.scheduleKind}
            onSelectionChange={(key) => {
              const scheduleKind = String(key) as ScheduleKind
              update({ schedule: defaultScheduleByKind[scheduleKind], scheduleKind })
            }}
          >
            {scheduleTabs.map((tab) => (
              <Segment.Item key={tab.id} id={tab.id}>
                <Segment.Separator />
                {tab.label}
              </Segment.Item>
            ))}
          </Segment>
        </FormItem>
        <Separator />
        {form.scheduleKind === 'every' ? (
          <FormItem icon="lucide:timer-reset" title="固定间隔">
            <div className="flex gap-3">
              <Input className="w-24" variant="secondary" type="number" min={1} value={form.everyValue} disabled={isSubmitting} placeholder="1" onChange={(event) => update({ everyValue: event.target.value })} />
              <FriendlySelect
                allowEmpty={false}
                ariaLabel="间隔单位"
                isDisabled={isSubmitting}
                options={[
                  { id: 'm', label: '分钟' },
                  { id: 'h', label: '小时' },
                  { id: 'd', label: '天' },
                ]}
                value={form.everyUnit}
                onChange={(value) => update({ everyUnit: normalizeEveryUnit(value) })}
              />
            </div>
          </FormItem>
        ) : (
          <FormItem
            description={form.scheduleKind === 'once' ? "可填 30m、2h、1d 或 ISO 时间。" : "例如 0 9 * * *。"}
            icon={form.scheduleKind === 'once' ? 'lucide:calendar-range' : 'lucide:code-2'}
            title={form.scheduleKind === 'once' ? '运行时间或延迟' : '表达式'}
          >
            <Input fullWidth variant="secondary" value={form.schedule} disabled={isSubmitting} placeholder={form.scheduleKind === 'once' ? '30m' : '0 9 * * *'} onChange={(event) => update({ schedule: event.target.value })} />
          </FormItem>
        )}
      </ItemCardGroup>
    </>
  )
}

function ExecutionForm({
  form,
  formOptions,
  isSubmitting,
  update,
}: {
  form: CronFormState
  formOptions: CronFormOptions
  isSubmitting: boolean
  update: (patch: Partial<CronFormState>) => void
}) {
  const providerOptions = useMemo(() => buildProviderOptions(formOptions.models), [formOptions.models])
  const modelOptions = useMemo(() => buildModelOptions(formOptions.models, form.provider), [form.provider, formOptions.models])
  return (
    <>
      <Card>
        <Card.Header>
          <div>
            <Card.Title>任务提示词</Card.Title>
            <Card.Description>告诉 Hermes 到点后要完成什么；搭配 skills 时这里是任务指令。</Card.Description>
          </div>
        </Card.Header>
        <Card.Content>
          <textarea
            className="min-h-28 w-full rounded-2xl border border-divider bg-surface-secondary/50 px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent disabled:opacity-60"
            disabled={isSubmitting}
            placeholder="生成今天的运营简报，并汇总需要跟进的事项。"
            value={form.prompt}
            onChange={(event) => update({ prompt: event.target.value })}
          />
        </Card.Content>
      </Card>

      <ItemCardGroup className="overflow-hidden">
        <ItemCardGroup.Header>
          <ItemCardGroup.Title>执行内容</ItemCardGroup.Title>
          <ItemCardGroup.Description>选择 skill、脚本和上下文来源。</ItemCardGroup.Description>
        </ItemCardGroup.Header>
        <FormItem description="选择执行时要加载的技能，可多选。" icon="lucide:sparkles" title="Skills">
          <SkillsDropdown
            isDisabled={isSubmitting}
            skills={formOptions.skills}
            value={splitList(form.skills)}
            onChange={(skills) => update({ skills: skills.join(', ') })}
          />
        </FormItem>
        <Separator />
        <FormItem  icon="lucide:file-code-2" title="Script">
          <Input fullWidth variant="secondary" value={form.script} disabled={isSubmitting} placeholder="daily_report.py" onChange={(event) => update({ script: event.target.value })} />
        </FormItem>
        <Separator />
        <FormItem  icon="lucide:git-branch" title="Context From">
          <Input fullWidth variant="secondary" value={form.contextFrom} disabled={isSubmitting} placeholder="job_id_1, job_id_2" onChange={(event) => update({ contextFrom: event.target.value })} />
        </FormItem>
        <Separator />
        <FormItem actionClassName="w-fit"  icon="lucide:terminal-square" title="No Agent">
          <Switch size="lg" aria-label="No Agent" isSelected={form.noAgent} isDisabled={isSubmitting} onChange={(noAgent) => update({ noAgent })}>
            <Switch.Control><Switch.Thumb /></Switch.Control>
          </Switch>
        </FormItem>
      </ItemCardGroup>

      <ItemCardGroup className="overflow-hidden">
        <ItemCardGroup.Header>
          <ItemCardGroup.Title>运行参数</ItemCardGroup.Title>
          <ItemCardGroup.Description>必要时为这个任务单独调整模型、工具和工作目录。</ItemCardGroup.Description>
        </ItemCardGroup.Header>
        <FormItem description="必须是已存在的绝对路径。" icon="lucide:folder" title="工作目录">
          <Input fullWidth variant="secondary" value={form.workdir} disabled={isSubmitting} placeholder="" onChange={(event) => update({ workdir: event.target.value })} />
        </FormItem>
        <Separator />
        <FormItem icon="lucide:cloud-cog" title="Provider">
          <FriendlySelect
            ariaLabel="Provider"
            emptyLabel="使用默认 Provider"
            isDisabled={isSubmitting}
            options={providerOptions}
            value={form.provider}
            onChange={(provider) => {
              const nextModels = buildModelOptions(formOptions.models, provider)
              const model = nextModels.some((option) => option.id === form.model) ? form.model : ''
              update({ model, provider })
            }}
          />
        </FormItem>
        <Separator />
        <FormItem icon="lucide:brain" title="Model">
          <FriendlySelect
            ariaLabel="Model"
            emptyLabel="使用默认模型"
            isDisabled={isSubmitting}
            options={modelOptions}
            value={form.model}
            onChange={(model) => update({ model })}
          />
        </FormItem>
        <Separator />
        <FormItem description="覆盖 provider base_url，通常保持为空。" icon="lucide:link" title="Base URL">
          <Input fullWidth variant="secondary" value={form.baseUrl} disabled={isSubmitting} placeholder="https://api.example.com" onChange={(event) => update({ baseUrl: event.target.value })} />
        </FormItem>
        <Separator />
        <FormItem description="只在需要限制可用工具集时填写。" icon="lucide:wrench" title="启用工具集">
          <Input fullWidth variant="secondary" value={form.enabledToolsets} disabled={isSubmitting} placeholder="web, terminal, file" onChange={(event) => update({ enabledToolsets: event.target.value })} />
        </FormItem>
      </ItemCardGroup>
    </>
  )
}

function DeliveryForm({
  form,
  formOptions,
  isSubmitting,
  update,
}: {
  form: CronFormState
  formOptions: CronFormOptions
  isSubmitting: boolean
  update: (patch: Partial<CronFormState>) => void
}) {
  return (
    <>
      <ItemCardGroup className="overflow-hidden">
        <ItemCardGroup.Header>
          <ItemCardGroup.Title>投递配置</ItemCardGroup.Title>
          <ItemCardGroup.Description>决定任务完成后是否把结果发给本地、来源会话或外部平台。</ItemCardGroup.Description>
        </ItemCardGroup.Header>
        <FormItem icon="lucide:send" title="投递目标">
          <MultiValueDropdown
            emptyLabel="未选择消息平台"
            isDisabled={isSubmitting}
            options={formOptions.deliverTargets}
            placeholder="选择投递目标"
            value={splitList(form.deliver)}
            onChange={(targets) => update({ deliver: targets.join(', ') })}
          />
        </FormItem>
        <Separator />
      </ItemCardGroup>

      <Alert>
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>运行说明</Alert.Title>
          <Alert.Description>
            Gateway 未运行时任务不会自动触发，但仍可创建、编辑和标记为下次运行；Hermes cron 由 Gateway scheduler tick 执行。立即运行会把任务标记为下一次 tick 运行。
          </Alert.Description>
        </Alert.Content>
      </Alert>
    </>

  )
}

function FriendlySelect({
  allowEmpty = true,
  ariaLabel,
  emptyLabel = '不覆盖',
  isDisabled,
  onChange,
  options,
  value,
}: {
  allowEmpty?: boolean
  ariaLabel: string
  emptyLabel?: string
  isDisabled?: boolean
  onChange: (value: string) => void
  options: SelectOption[]
  value: string
}) {
  const emptyKey = '__empty__'
  const selected = options.find((option) => option.id === value)
  const label = selected?.label ?? (value || emptyLabel)

  return (
    <Dropdown>
      <Button
        aria-label={ariaLabel}
        isDisabled={isDisabled}
        variant="tertiary"
      >
        {label}
        <Icon icon="lucide:chevron-down" className="size-4 shrink-0 text-muted" />
      </Button>
      <Dropdown.Popover className="min-w-72" placement="bottom start">
        <Dropdown.Menu selectedKeys={new Set([value || emptyKey])} selectionMode="single" onAction={(key) => onChange(String(key) === emptyKey ? '' : String(key))}>
          {allowEmpty ? (
            <Dropdown.Item id={emptyKey} textValue={emptyLabel}>
              <Dropdown.ItemIndicator />
              <DropdownItemContent icon="lucide:sparkles" label={emptyLabel} />
            </Dropdown.Item>
          ) : null}
          {value && !selected ? (
            <Dropdown.Item id={value} textValue={value}>
              <Dropdown.ItemIndicator />
              <DropdownItemContent icon="lucide:circle-help" label={value} />
            </Dropdown.Item>
          ) : null}
          {options.map((option) => (
            <Dropdown.Item key={option.id} id={option.id} textValue={option.label}>
              <Dropdown.ItemIndicator />
              <DropdownItemContent icon={option.icon ?? 'lucide:circle'} label={option.label} />
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function SkillsDropdown({
  isDisabled,
  onChange,
  skills,
  value,
}: {
  isDisabled?: boolean
  onChange: (skills: string[]) => void
  skills: HermesSkillInfo[]
  value: string[]
}) {
  const options = useMemo<SelectOption[]>(() => {
    return skills
      .filter((skill) => !skill.disabled)
      .map((skill) => ({
        icon: skill.bundled ? 'lucide:package-check' : 'lucide:sparkles',
        id: skill.name,
        label: skill.name,
      }))
      .sort((a, b) => collator.compare(a.label, b.label))
  }, [skills])

  return (
    <MultiValueDropdown
      emptyLabel="未选择 Skill"
      isDisabled={isDisabled}
      options={options}
      placeholder="选择 Skills"
      value={value}
      onChange={onChange}
    />
  )
}

function MultiValueDropdown({
  emptyLabel,
  isDisabled,
  onChange,
  options,
  placeholder,
  value,
}: {
  emptyLabel: string
  isDisabled?: boolean
  onChange: (value: string[]) => void
  options: SelectOption[]
  placeholder: string
  value: string[]
}) {
  const selectedValues = value.filter(Boolean)
  const optionMap = new Map(options.map((option) => [option.id, option]))
  const customOptions = selectedValues
    .filter((item) => !optionMap.has(item))
    .map<SelectOption>((item) => ({ icon: 'lucide:circle-help', id: item, label: item }))
  const displayOptions = [...customOptions, ...options]
  const selectedLabels = selectedValues.map((item) => optionMap.get(item)?.label ?? item)

  return (
    <Dropdown>
      <Button
        aria-label={placeholder}
        isDisabled={isDisabled}
        variant="tertiary"
      >
          {selectedLabels.length ? selectedLabels.join(', ') : emptyLabel}
        <Icon icon="lucide:chevron-down" className="size-4 shrink-0 text-muted" />
      </Button>
      <Dropdown.Popover className="min-w-80" placement="bottom start">
        <Dropdown.Menu
          selectedKeys={new Set(selectedValues)}
          selectionMode="multiple"
          onSelectionChange={(selection) => onChange(selectionToStrings(selection))}
        >
          {displayOptions.length ? displayOptions.map((option) => (
            <Dropdown.Item key={option.id} id={option.id} textValue={option.label}>
              <Dropdown.ItemIndicator />
              <DropdownItemContent icon={option.icon ?? 'lucide:circle'} label={option.label} />
            </Dropdown.Item>
          )) : (
            <Dropdown.Item id="__empty__" textValue="暂无可选项" isDisabled>
              <DropdownItemContent icon="lucide:circle-alert" label="暂无可选项" />
            </Dropdown.Item>
          )}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function DropdownItemContent({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex shrink-0 items-center justify-center">
        <Icon icon={icon} className="size-4 text-muted" />
      </span>
      <Label className="min-w-0 truncate">{label}</Label>
    </div>
  )
}

function FormItem({
  actionClassName = 'w-full min-w-0 sm:w-auto',
  children,
  description,
  icon,
  title,
}: {
  actionClassName?: string
  children: ReactNode
  description?: string
  icon: string
  title: string
}) {
  return (
    <ItemCard>
      <ItemCard.Icon className="size-10 rounded-full bg-surface-secondary/50 text-muted">
        <Icon icon={icon} className="size-5" />
      </ItemCard.Icon>
      <ItemCard.Content>
        <ItemCard.Title>{title}</ItemCard.Title>
        {description ? <ItemCard.Description>{description}</ItemCard.Description> : null}
      </ItemCard.Content>
      <ItemCard.Action>
        <div className={actionClassName}>{children}</div>
      </ItemCard.Action>
    </ItemCard>
  )
}

function ErrorCard({ error }: { error: string }) {
  return (
    <Card>
      <Card.Content>
        <div className="flex items-start gap-3 text-warning">
          <Icon icon="lucide:triangle-alert" className="mt-0.5 size-5" />
          <div>
            <p className="font-medium">Hermes 定时任务加载失败</p>
            <p className="mt-1 text-sm text-muted">{error}</p>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function EmptyState() {
  return (
    <div className="flex min-h-[auto] flex-col items-center justify-center rounded-2xl bg-surface px-6 py-10 text-center">
      <Icon icon="lucide:calendar-plus" className="size-8 text-muted" />
      <p className="mt-3 font-medium text-foreground">还没有 Hermes 定时任务</p>
      <p className="mt-1 text-sm text-muted">点击“创建任务”添加第一个 cron 作业。</p>
      {/* <Button className="mt-5" variant="primary" onPress={onCreate}>
        <Icon icon="lucide:plus" />
        创建任务
      </Button> */}
    </div>
  )
}

function CronSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Skeleton className="h-64 rounded-3xl" />
      <Skeleton className="h-64 rounded-3xl" />
    </div>
  )
}

function getCronStats(jobs: HermesCronJob[]) {
  return jobs.reduce((stats, job) => {
    stats.total += 1
    if (job.enabled ?? true) stats.enabled += 1
    else stats.paused += 1
    return stats
  }, { enabled: 0, paused: 0, total: 0 })
}

function groupJobs(jobs: HermesCronJob[]): Record<BoardColumn, HermesCronJob[]> {
  const sorted = [...jobs].sort((a, b) => collator.compare(a.name || a.id, b.name || b.id))
  return {
    enabled: sorted.filter((job) => job.enabled ?? true),
    paused: sorted.filter((job) => !(job.enabled ?? true)),
  }
}

function buildDeliveryTargetOptions(platforms: HermesPlatformInfo[]): SelectOption[] {
  const fixedOptions: SelectOption[] = [
    { icon: 'lucide:broadcast', id: 'all', label: 'All' },
    { icon: 'lucide:hard-drive', id: 'local', label: 'Local' },
    { icon: 'lucide:webhook', id: 'webhook', label: 'Webhook' },
  ]
  const platformOptions = platforms
    .filter((platform) => platform.configured && cronDeliveryPlatformNames.has(platform.name))
    .filter((platform) => !fixedOptions.some((option) => option.id === platform.name))
    .map((platform) => ({
      icon: platform.icon || 'lucide:send',
      id: platform.name,
      label: platform.label || platform.name,
    }))
    .sort((a, b) => collator.compare(a.label, b.label))

  return [...fixedOptions, ...platformOptions]
}

function buildProviderOptions(data: HermesModelsResponse | null): SelectOption[] {
  return Object.entries(data?.providers ?? {})
    .map(([key, provider]) => ({
      icon: 'lucide:cloud-cog',
      id: key,
      label: provider.name || key,
    }))
    .sort((a, b) => collator.compare(a.label, b.label))
}

function buildModelOptions(data: HermesModelsResponse | null, providerKey: string): SelectOption[] {
  const providers = data?.providers ?? {}
  const effectiveProviderKey = providerKey || data?.model?.provider || ''
  const provider = providers[effectiveProviderKey]
  const entries = provider
    ? [[effectiveProviderKey, provider] as const]
    : Object.entries(providers)

  return entries
    .flatMap(([, item]) => (item.models ?? []).map((model) => ({
      icon: model.input?.includes('image') ? 'lucide:eye' : 'lucide:box',
      id: model.id,
      label: model.name || model.id,
    })))
    .sort((a, b) => collator.compare(a.label, b.label))
}

function buildCreatePayload(form: CronFormState): HermesCronJobCreate {
  return {
    baseUrl: form.baseUrl.trim() || undefined,
    contextFrom: splitList(form.contextFrom),
    deliver: form.deliver.trim() || undefined,
    enabledToolsets: splitList(form.enabledToolsets),
    model: form.model.trim() || undefined,
    name: form.name.trim() || undefined,
    noAgent: form.noAgent,
    prompt: form.prompt,
    provider: form.provider.trim() || undefined,
    repeat: form.repeat.trim() ? Number(form.repeat.trim()) : undefined,
    schedule: scheduleFromForm(form),
    script: form.script.trim() || undefined,
    skills: splitList(form.skills),
    workdir: form.workdir.trim() || undefined,
  }
}

function buildPatchPayload(form: CronFormState): HermesCronJobPatch {
  return buildCreatePayload(form)
}

function jobToCreatePayload(job: HermesCronJob): HermesCronJobCreate {
  return {
    baseUrl: job.base_url ?? undefined,
    contextFrom: stringsFromUnknown(job.context_from),
    deliver: job.deliver,
    enabledToolsets: job.enabled_toolsets ?? undefined,
    model: job.model ?? undefined,
    name: job.name,
    noAgent: job.no_agent,
    prompt: job.prompt ?? '',
    provider: job.provider ?? undefined,
    repeat: job.repeat?.times ?? undefined,
    schedule: scheduleToInput(job),
    script: job.script ?? undefined,
    skills: job.skills ?? undefined,
    workdir: job.workdir ?? undefined,
  }
}

function jobToForm(job: HermesCronJob): CronFormState {
  const payload = jobToCreatePayload(job)
  const kind = scheduleKind(job)
  return {
    ...defaultForm,
    baseUrl: payload.baseUrl || '',
    contextFrom: (payload.contextFrom ?? []).join(', '),
    deliver: payload.deliver || '',
    enabledToolsets: (payload.enabledToolsets ?? []).join(', '),
    everyUnit: everyUnitFromJob(job),
    everyValue: everyValueFromJob(job),
    model: payload.model || '',
    name: payload.name || '',
    noAgent: Boolean(payload.noAgent),
    prompt: payload.prompt || '',
    provider: payload.provider || '',
    repeat: payload.repeat === undefined || payload.repeat === null ? '' : String(payload.repeat),
    schedule: kind === 'every' ? defaultForm.schedule : payload.schedule,
    scheduleKind: kind,
    script: payload.script || '',
    skills: (payload.skills ?? []).join(', '),
    workdir: payload.workdir || '',
  }
}

function scheduleFromForm(form: CronFormState) {
  if (form.scheduleKind === 'every') {
    return `every ${form.everyValue.trim() || '1'}${form.everyUnit}`
  }
  return form.schedule.trim()
}

function scheduleToInput(job: HermesCronJob) {
  const schedule = job.schedule as Record<string, unknown>
  if (schedule.kind === 'interval') return `every ${schedule.minutes}m`
  if (schedule.kind === 'once') return String(schedule.run_at || job.scheduleDisplay || job.schedule_display || '')
  if (schedule.kind === 'cron') return String(schedule.expr || job.scheduleDisplay || job.schedule_display || '')
  return job.scheduleDisplay || job.schedule_display || ''
}

function scheduleKind(job: HermesCronJob): ScheduleKind {
  const kind = (job.schedule as Record<string, unknown>)?.kind
  if (kind === 'interval') return 'every'
  if (kind === 'once') return 'once'
  return 'cron'
}

function everyValueFromJob(job: HermesCronJob) {
  const schedule = job.schedule as Record<string, unknown>
  const minutes = Number(schedule.minutes || 60)
  if (minutes % 1440 === 0) return String(minutes / 1440)
  if (minutes % 60 === 0) return String(minutes / 60)
  return String(minutes)
}

function everyUnitFromJob(job: HermesCronJob): CronFormState['everyUnit'] {
  const schedule = job.schedule as Record<string, unknown>
  const minutes = Number(schedule.minutes || 60)
  if (minutes % 1440 === 0) return 'd'
  if (minutes % 60 === 0) return 'h'
  return 'm'
}

function validateForm(form: CronFormState) {
  if (!scheduleFromForm(form).trim()) return '请输入计划'
  if (form.noAgent && !form.script.trim()) return 'No Agent 模式需要填写 script'
  if (!form.noAgent && !form.prompt.trim() && splitList(form.skills).length === 0) return '请输入 Prompt 或至少一个 Skill'
  return ''
}

function splitList(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function selectionToStrings(selection: Selection) {
  if (selection === 'all') return []
  return Array.from(selection).map((item) => String(item)).filter((item) => item !== '__empty__')
}

function stringsFromUnknown(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return undefined
}

function normalizeEveryUnit(value: string): CronFormState['everyUnit'] {
  if (value === 'd' || value === 'h' || value === 'm') return value
  return 'h'
}

function formatSchedule(job: HermesCronJob) {
  return job.scheduleDisplay || job.schedule_display || scheduleToInput(job) || '未知计划'
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

export default HermesCronPage
