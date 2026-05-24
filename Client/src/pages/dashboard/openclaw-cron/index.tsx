import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { Key, TimeValue } from '@heroui/react'
import { AlertDialog, Button, Calendar, Card, Chip, DateField, DatePicker, Dropdown, Input, Label, ListBox, Modal, SearchField, Separator, Skeleton, Switch, TimeField, Tooltip, toast } from '@heroui/react'
import { CellSelect, ItemCard, ItemCardGroup, Kanban, PieChart, Segment, useKanban, useKanbanColumn } from '@heroui-pro/react'
import type { UseKanbanReturn } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type { DateValue } from '@internationalized/date'
import { getLocalTimeZone, parseAbsoluteToLocal } from '@internationalized/date'
import type {
  OpenClawAgentSummary,
  OpenClawCronDeliveryStatus,
  OpenClawCronJob,
  OpenClawCronJobCreate,
  OpenClawCronJobPatch,
  OpenClawCronListResponse,
  OpenClawCronRunEntry,
  OpenClawCronRunsResponse,
  OpenClawCronRunStatus,
  OpenClawCronSchedule,
  OpenClawCronStatusResponse,
  OpenClawModelDefinition,
  OpenClawModelProvider,
} from '@/api'
import {
  createOpenClawCronJob,
  deleteOpenClawCronJob,
  getOpenClawConfig,
  getOpenClawCronStatus,
  listOpenClawAgents,
  listOpenClawCronJobs,
  listOpenClawCronRuns,
  resolveOpenClawGatewayWebSocketURL,
  OpenClawGatewayClient,
  runOpenClawCronJob,
  updateOpenClawCronJob,
} from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { useOpenClawEnvironmentStore } from '@/stores/openclaw-environment'

type LoadState = 'idle' | 'loading' | 'ready' | 'error'
type ScheduleKind = 'at' | 'cron' | 'every'
type SessionTargetPreset = 'current' | 'isolated' | 'main' | 'session'
type DeliveryMode = 'announce' | 'none' | 'webhook'
type CreateFormSection = 'delivery' | 'execution' | 'preview' | 'schedule'
type FormMode = 'create' | 'edit'
type CronBoardColumnId = 'enabled' | 'paused'
type CronScheduleFilter = 'all' | ScheduleKind
type CronRunStatusFilter = 'all' | OpenClawCronRunStatus

type AgentModelOption = {
  label: string
  modelId: string
  providerKey: string
  value: string
}

type DeliveryChannelOption = {
  id: string
  label: string
}

type CronJobsListOptions = NonNullable<Parameters<typeof listOpenClawCronJobs>[0]>
type CronRunsOptions = NonNullable<Parameters<typeof listOpenClawCronRuns>[0]>

type CronFormState = {
  agentId: string
  at: string
  cronExpr: string
  deleteAfterRun: boolean
  deliveryAccountId: string
  deliveryBestEffort: boolean
  deliveryChannel: string
  deliveryMode: DeliveryMode
  deliveryThreadId: string
  deliveryTo: string
  description: string
  enabled: boolean
  everyUnit: 'd' | 'h' | 'm'
  everyValue: string
  exact: boolean
  lightContext: boolean
  message: string
  model: string
  name: string
  scheduleKind: ScheduleKind
  sessionId: string
  sessionTarget: SessionTargetPreset
  systemEvent: string
  thinking: string
  timeoutSeconds: string
  toolsAllow: string
  tz: string
  wakeMode: 'next-heartbeat' | 'now'
}

const defaultForm: CronFormState = {
  agentId: '',
  at: '',
  cronExpr: '0 9 * * *',
  deleteAfterRun: true,
  deliveryAccountId: '',
  deliveryBestEffort: false,
  deliveryChannel: 'last',
  deliveryMode: 'announce',
  deliveryThreadId: '',
  deliveryTo: '',
  description: '',
  enabled: true,
  everyUnit: 'h',
  everyValue: '1',
  exact: false,
  lightContext: false,
  message: '',
  model: '',
  name: '',
  scheduleKind: 'at',
  sessionId: '',
  sessionTarget: 'isolated',
  systemEvent: '',
  thinking: '',
  timeoutSeconds: '',
  toolsAllow: '',
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
  wakeMode: 'now',
}

const scheduleTabs = [
  { id: 'at', label: '一次性' },
  { id: 'every', label: '固定间隔' },
  { id: 'cron', label: 'Cron 表达式' },
]

const createSectionTabs = [
  { id: 'schedule', label: '计划' },
  { id: 'execution', label: '执行' },
  { id: 'delivery', label: '投递' },
  { id: 'preview', label: '预览' },
]

const timezoneOptions = [
  { id: 'Asia/Shanghai', label: '中国标准时间 (Asia/Shanghai)' },
  { id: 'UTC', label: 'UTC' },
  { id: 'Europe/London', label: '英国时间 (Europe/London)' },
  { id: 'America/New_York', label: '美东时间 (America/New_York)' },
  { id: 'America/Los_Angeles', label: '美西时间 (America/Los_Angeles)' },
]

const defaultAgentSelectKey = '__default__'

const openClawDeliveryChannels: DeliveryChannelOption[] = [
  { id: 'openclaw-weixin', label: '微信' },
  { id: 'feishu', label: '飞书' },
  { id: 'dingtalk-connector', label: '钉钉' },
  { id: 'qqbot', label: 'QQ' },
  { id: 'yuanbao', label: '元宝' },
  { id: 'wecom', label: '企业微信' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'discord', label: 'Discord' },
  { id: 'matrix', label: 'Matrix' },
  { id: 'twitch', label: 'Twitch' },
  { id: 'whatsapp', label: 'WhatsApp' },
]

const cronChartColors = {
  enabled: 'var(--success)',
  paused: 'var(--muted)',
}

const cronBoardColumns: Array<{ color: string, id: CronBoardColumnId, label: string }> = [
  { color: 'bg-success', id: 'enabled', label: '已启用' },
  { color: 'bg-default', id: 'paused', label: '已停用' },
]

const cronScheduleFilterOptions: Array<{ id: CronScheduleFilter, label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'at', label: '指定时间' },
  { id: 'every', label: '间隔' },
  { id: 'cron', label: 'Cron' },
]

const cronRunStatusFilterOptions: Array<{ id: CronRunStatusFilter, label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'ok', label: '成功' },
  { id: 'error', label: '错误' },
  { id: 'skipped', label: '跳过' },
]

function OpenClawCronPage() {
  usePageTitle('OpenClaw 定时任务')
  const [state, setState] = useState<LoadState>('idle')
  const [status, setStatus] = useState<OpenClawCronStatusResponse | null>(null)
  const [jobsData, setJobsData] = useState<OpenClawCronListResponse | null>(null)
  const [runsData, setRunsData] = useState<OpenClawCronRunsResponse | null>(null)
  const [scheduleFilters, setScheduleFilters] = useState<Record<CronBoardColumnId, CronScheduleFilter>>({
    enabled: 'all',
    paused: 'all',
  })
  const [runStatusFilter, setRunStatusFilter] = useState<CronRunStatusFilter>('all')
  const [agents, setAgents] = useState<OpenClawAgentSummary[]>([])
  const [modelConfigContent, setModelConfigContent] = useState<Record<string, unknown>>({})
  const [modelConfigError, setModelConfigError] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState<CronFormState>(defaultForm)
  const [formMode, setFormMode] = useState<FormMode>('create')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [activeCreateSection, setActiveCreateSection] = useState<CreateFormSection>('schedule')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRunsRefreshing, setIsRunsRefreshing] = useState(false)
  const [mutatingJobId, setMutatingJobId] = useState('')
  const [editingJobId, setEditingJobId] = useState('')
  const [jobToDelete, setJobToDelete] = useState<OpenClawCronJob | null>(null)

  const loadCron = useCallback(async (nextStatusFilter: CronRunStatusFilter = 'all') => {
    setState('loading')
    setError('')
    try {
      const [nextStatus, nextJobs, nextRuns] = await loadOpenClawCronSnapshotPreferGateway(nextStatusFilter)
      setStatus(nextStatus)
      setJobsData(nextJobs)
      setRunsData(nextRuns)
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : '定时任务加载失败')
      setState('error')
    }
  }, [])

  const refreshCronRuns = useCallback(async (nextStatusFilter: CronRunStatusFilter) => {
    setIsRunsRefreshing(true)
    try {
      const nextRuns = await listOpenClawCronRunsPreferGateway({ limit: 100, sortDir: 'desc', status: nextStatusFilter })
      setRunsData(nextRuns)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '运行历史刷新失败')
    } finally {
      setIsRunsRefreshing(false)
    }
  }, [])

  const changeRunStatusFilter = useCallback((nextStatusFilter: CronRunStatusFilter) => {
    setRunStatusFilter(nextStatusFilter)
    void refreshCronRuns(nextStatusFilter)
  }, [refreshCronRuns])

  const loadAgents = useCallback(async () => {
    setModelConfigError('')
    try {
      const [payload, configPayload] = await Promise.all([
        listOpenClawAgents(),
        getOpenClawConfig().catch((err: unknown) => {
          setModelConfigError(err instanceof Error ? err.message : '模型配置加载失败')
          return null
        }),
      ])
      setAgents(payload.agents ?? [])
      setModelConfigContent(configPayload?.content ?? {})
    } catch {
      setAgents([])
      setModelConfigContent({})
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadCron('all')
      void loadAgents()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadAgents, loadCron])

  const jobs = useMemo(() => jobsData?.jobs ?? [], [jobsData?.jobs])
  const runs = useMemo(() => runsData?.entries ?? [], [runsData?.entries])
  const isLoading = state === 'loading' && !jobsData
  const shouldShowRunHistory = runs.length > 0 || runStatusFilter !== 'all' || isRunsRefreshing
  const stats = useMemo(() => getCronStats(jobs), [jobs])
  const createPayload = useMemo(() => buildCronJobCreate(form), [form])
  const createPayloadText = useMemo(() => JSON.stringify(createPayload, null, 2), [createPayload])
  const agentModelOptions = useMemo(() => buildAgentModelOptions(modelConfigContent), [modelConfigContent])
  const deliveryChannelOptions = useMemo(() => buildDeliveryChannelOptions(modelConfigContent), [modelConfigContent])

  const submitForm = useCallback(async () => {
    const validation = validateCronForm(form, createPayload)
    if (validation) {
      setActiveCreateSection(getValidationSection(validation))
      toast.warning(validation)
      return
    }
    setIsSubmitting(true)
    try {
      if (formMode === 'create') {
        await createOpenClawCronJobPreferGateway(createPayload)
        toast.success('定时任务已创建')
      } else {
        if (!editingJobId) {
          toast.warning('未找到要编辑的任务')
          return
        }
        await updateOpenClawCronJobPreferGateway(editingJobId, buildCronJobPatch(form))
        toast.success('定时任务已保存')
      }
      setForm(defaultForm)
      setFormMode('create')
      setEditingJobId('')
      setIsFormOpen(false)
      setActiveCreateSection('schedule')
      await loadCron(runStatusFilter)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : formMode === 'create' ? '定时任务创建失败' : '定时任务保存失败')
    } finally {
      setIsSubmitting(false)
    }
  }, [createPayload, editingJobId, form, formMode, loadCron, runStatusFilter])

  const toggleJob = useCallback(async (job: OpenClawCronJob) => {
    setMutatingJobId(job.id)
    try {
      await updateOpenClawCronJobPreferGateway(job.id, { enabled: !(job.enabled ?? true) })
      toast.success((job.enabled ?? true) ? '定时任务已停用' : '定时任务已启用')
      await loadCron(runStatusFilter)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '任务状态更新失败')
    } finally {
      setMutatingJobId('')
    }
  }, [loadCron, runStatusFilter])

  const runJob = useCallback(async (job: OpenClawCronJob) => {
    setMutatingJobId(job.id)
    try {
      const result = await runOpenClawCronJobPreferGateway(job.id)
      toast.success('定时任务已入队')
      if ('runId' in result) {
        toast.info(`运行 ID：${result.runId}`)
      }
      await loadCron(runStatusFilter)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '定时任务触发失败')
    } finally {
      setMutatingJobId('')
    }
  }, [loadCron, runStatusFilter])

  const deleteJob = useCallback(async () => {
    if (!jobToDelete) return
    setMutatingJobId(jobToDelete.id)
    try {
      await deleteOpenClawCronJobPreferGateway(jobToDelete.id)
      toast.success('定时任务已删除')
      setJobToDelete(null)
      await loadCron(runStatusFilter)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '定时任务删除失败')
    } finally {
      setMutatingJobId('')
    }
  }, [jobToDelete, loadCron, runStatusFilter])

  const openCreateForm = useCallback(() => {
    setForm(defaultForm)
    setFormMode('create')
    setEditingJobId('')
    setActiveCreateSection('schedule')
    setIsFormOpen(true)
  }, [])

  const openEditForm = useCallback((job: OpenClawCronJob) => {
    setEditingJobId(job.id)
    setForm(jobToCronForm(job))
    setFormMode('edit')
    setActiveCreateSection('schedule')
    setIsFormOpen(true)
  }, [])

  const cloneJob = useCallback(async (job: OpenClawCronJob) => {
    setMutatingJobId(job.id)
    try {
      await createOpenClawCronJobPreferGateway(cloneCronJobCreate(job))
      toast.success('定时任务已克隆')
      await loadCron(runStatusFilter)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '定时任务克隆失败')
    } finally {
      setMutatingJobId('')
    }
  }, [loadCron, runStatusFilter])

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.8fr)]">
          <CronHero
            isRefreshing={state === 'loading'}
            onCreate={openCreateForm}
            onRefresh={() => void loadCron(runStatusFilter)}
          />
          <CronStatusPieChart
            nextWakeAtMs={status?.nextWakeAtMs}
            schedulerEnabled={status?.enabled}
            stats={stats}
          />
        </section>

        {error ? (
          <Card>
            <Card.Content>
              <div className="flex items-start gap-3 text-warning">
                <Icon icon="lucide:triangle-alert" className="mt-0.5 size-5" />
                <div>
                  <p className="font-medium">定时任务加载失败</p>
                  <p className="mt-1 text-sm text-muted">{error}</p>
                </div>
              </div>
            </Card.Content>
          </Card>
        ) : null}

        <section className="grid gap-6">
          <div className="min-w-0">
            {isLoading ? <CronSkeleton /> : null}
            {!isLoading && jobs.length === 0 ? (
              <div className="flex flex-col items-center rounded-2xl bg-surface px-6 py-10 text-center">
                <Icon icon="lucide:calendar-plus" className="size-8 text-muted" />
                <p className="mt-3 font-medium text-foreground">还没有定时任务</p>
                <p className="mt-1 text-sm text-muted">点击“创建任务”添加第一个 Cron 作业。</p>
              </div>
            ) : null}
            {!isLoading && jobs.length > 0 ? (
              <CronKanbanBoard
                key={`${scheduleFilters.enabled}:${scheduleFilters.paused}:${jobs.map((job) => `${job.id}:${job.enabled}:${job.state.runningAtMs ?? 0}`).join('|')}`}
                deliveryPreviews={jobsData?.deliveryPreviews}
                jobs={jobs}
                mutatingJobId={mutatingJobId}
                onClone={(job) => void cloneJob(job)}
                onDelete={setJobToDelete}
                onRun={(job) => void runJob(job)}
                onScheduleFilterChange={(column, filter) =>
                  setScheduleFilters((current) => ({ ...current, [column]: filter }))
                }
                onToggle={(job) => void toggleJob(job)}
                onEdit={(job) => openEditForm(job)}
                scheduleFilters={scheduleFilters}
              />
            ) : null}

            {shouldShowRunHistory ? (
              <CronRunHistoryCard
                isLoading={isLoading}
                isRefreshing={isRunsRefreshing}
                jobs={jobs}
                onRefresh={() => void refreshCronRuns(runStatusFilter)}
                onStatusFilterChange={changeRunStatusFilter}
                runs={runs}
                statusFilter={runStatusFilter}
                total={runsData?.total ?? runs.length}
              />
            ) : null}
          </div>
        </section>
      </div>

      <Modal.Backdrop isOpen={isFormOpen} onOpenChange={(open) => {
        setIsFormOpen(open)
        if (!open) {
          setFormMode('create')
          setEditingJobId('')
          setActiveCreateSection('schedule')
        }
      }} variant="opaque">
        <Modal.Container size="lg" scroll="inside">
          <Modal.Dialog className="sm:max-w-[680px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <Icon icon="lucide:calendar-plus" className="size-5" />
              </Modal.Icon>
              <div>
                <Modal.Heading>{formMode === 'create' ? '创建定时任务' : '编辑定时任务'}</Modal.Heading>
                <p className="mt-1 text-sm text-muted">让 OpenClaw 在合适的时间主动完成提醒、简报或后台巡检。</p>
              </div>
            </Modal.Header>
            <Modal.Body>
              <div className="space-y-5">
                <Segment
                  selectedKey={activeCreateSection}
                  onSelectionChange={(key) => setActiveCreateSection(String(key) as CreateFormSection)}
                >
                  {createSectionTabs.map((tab) => (
                    <Segment.Item key={tab.id} id={tab.id}>
                      <Segment.Separator />
                      {tab.label}
                    </Segment.Item>
                  ))}
                </Segment>
                <div className="max-h-[480px] overflow-auto">
                  {activeCreateSection === 'preview' ? (
                    <Card>
                      <Card.Header className="items-start justify-between gap-4">
                        <div>
                          <Card.Title>JSON 预览</Card.Title>
                          <Card.Description>提交前最后确认任务的时间、会话和投递设置。</Card.Description>
                        </div>
                      </Card.Header>
                      <Card.Content>
                        <pre className="max-h-[440px] overflow-auto rounded-2xl bg-surface-secondary/50 p-4 text-xs leading-5 text-foreground">{createPayloadText}</pre>
                      </Card.Content>
                    </Card>
                  ) : (
                    <CronCreateForm
                      activeSection={activeCreateSection}
                      agents={agents}
                      deliveryChannelOptions={deliveryChannelOptions}
                      form={form}
                      isSubmitting={isSubmitting}
                      modelConfigError={modelConfigError}
                      modelOptions={agentModelOptions}
                      onChange={setForm}
                    />
                  )}
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={() => setIsFormOpen(false)}>取消</Button>
              <Button variant="primary" isPending={isSubmitting} onPress={submitForm}>
                <Icon icon="lucide:save" className="size-4" />
                {formMode === 'create' ? '创建任务' : '保存任务'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <AlertDialog.Backdrop isOpen={jobToDelete !== null} onOpenChange={(open) => !open && setJobToDelete(null)}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[440px]">
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>删除定时任务？</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">这会删除 {jobToDelete?.name || jobToDelete?.id}，不会删除已写入的运行日志。</p>
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

type CronStats = ReturnType<typeof getCronStats>

function CronHero({
  isRefreshing,
  onCreate,
  onRefresh,
}: {
  isRefreshing: boolean
  onCreate: () => void
  onRefresh: () => void
}) {
  return (
    <Card variant="transparent" className="overflow-hidden">
      <Card.Content>
        <div className="flex flex-row items-center gap-4 md:gap-6">
          <div className="flex h-36 shrink-0 items-center justify-center overflow-visible p-1">
            <img
              src="https://assets.orence.net/file/20260513113918121.png"
              alt="Cron Jobs"
              className="h-full w-auto"
            />
          </div>

          <div className="flex min-w-0 flex-col gap-5 pl-2">
            <div className="min-w-0">
              <Card.Title className="text-2xl font-bold md:text-3xl">定时任务</Card.Title>
              <Card.Description className="mt-4 text-base md:text-lg">安排提醒、简报和后台巡检，让 OpenClaw 在合适的时间主动完成工作。</Card.Description>
            </div>
            <div className="flex flex-row items-center gap-3">
              <Button variant="primary" onPress={onCreate}>
                <Icon icon="lucide:plus" className="size-4" />
                创建任务
              </Button>

              <Button
                isIconOnly
                aria-label="刷新任务"
                variant={isRefreshing ? 'primary' : 'tertiary'}
                isDisabled={isRefreshing}
                onPress={onRefresh}
              >
                <Icon icon={isRefreshing ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={isRefreshing ? 'animate-spin' : ''} />
              </Button>

            </div>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function CronStatusPieChart({
  nextWakeAtMs,
  schedulerEnabled,
  stats,
}: {
  nextWakeAtMs?: number | null
  schedulerEnabled?: boolean
  stats: CronStats
}) {
  const chartData = [
    { name: '已启用', value: stats.enabled, fill: cronChartColors.enabled },
    { name: '已停用', value: stats.paused, fill: cronChartColors.paused },
  ].filter((item) => item.value > 0)
  const displayChartData = chartData.length ? chartData : [{ name: '暂无数据', value: 1, fill: 'var(--surface-secondary)' }]

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
              <span className="text-[10px] text-muted">全部任务</span>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <CronLegendItem label="已启用" value={stats.enabled} color={cronChartColors.enabled} />
            <CronLegendItem label="已停用" value={stats.paused} color={cronChartColors.paused} />
            <div className="mt-1 flex flex-col gap-1.5 border-t border-divider pt-3 text-xs text-muted">
              <div className="flex items-center justify-between gap-3">
                <span>调度器</span>
                <span className="font-medium text-foreground">{schedulerEnabled ? '已启用' : '未启用'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>下次唤醒</span>
                <span className="max-w-[160px] truncate font-medium text-foreground">{formatDateTime(nextWakeAtMs)}</span>
              </div>
            </div>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function CronLegendItem({ color, label, value }: { color: string, label: string, value: number }) {
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

function CronCreateForm({
  activeSection,
  agents,
  deliveryChannelOptions,
  form,
  isSubmitting,
  modelConfigError,
  modelOptions,
  onChange,
}: {
  activeSection: CreateFormSection
  agents: OpenClawAgentSummary[]
  deliveryChannelOptions: DeliveryChannelOption[]
  form: CronFormState
  isSubmitting: boolean
  modelConfigError: string
  modelOptions: AgentModelOption[]
  onChange: Dispatch<SetStateAction<CronFormState>>
}) {
  const update = (patch: Partial<CronFormState>) => onChange((current) => ({ ...current, ...patch }))
  const isMain = form.sessionTarget === 'main'
  const selectableDeliveryChannels = useMemo(
    () => withCurrentDeliveryChannelOption(deliveryChannelOptions, form.deliveryChannel),
    [deliveryChannelOptions, form.deliveryChannel],
  )
  const agentOptions = useMemo(
    () => [
      { id: defaultAgentSelectKey, label: '默认 Agent' },
      ...agents.map((agent) => ({
        id: agent.id,
        label: agent.name ? `${agent.name} (${agent.id})` : agent.id,
      })),
    ],
    [agents],
  )
  return (
    <div className="space-y-5">
      {activeSection === 'schedule' ? (
        <>
          <ItemCardGroup className="overflow-hidden">
            <ItemCardGroup.Header>
              <ItemCardGroup.Title>基础信息</ItemCardGroup.Title>
              <ItemCardGroup.Description>给任务一个清晰名称，并选择由哪个智能体执行。</ItemCardGroup.Description>
            </ItemCardGroup.Header>
            <FormItem description="会显示在任务列表和运行历史里。" icon="lucide:tag" title="任务名称">
              <Input fullWidth variant="secondary" value={form.name} disabled={isSubmitting} placeholder="每日简报" onChange={(event) => update({ name: event.target.value })} />
            </FormItem>
            <Separator />
            <FormItem description="写下这个任务的用途，后续更容易辨认。" icon="lucide:file-text" title="任务描述">
              <Input fullWidth variant="secondary" value={form.description} disabled={isSubmitting} placeholder="可选，用于列表检索" onChange={(event) => update({ description: event.target.value })} />
            </FormItem>
            <Separator />
            <FormItem description="默认智能体适合普通提醒，专项任务可以指定智能体。" icon="lucide:bot" title="智能体">
              <FriendlySelect
                ariaLabel="智能体"
                isDisabled={isSubmitting}
                options={agentOptions}
                value={form.agentId || defaultAgentSelectKey}
                onChange={(value) => update({ agentId: String(value ?? defaultAgentSelectKey) === defaultAgentSelectKey ? '' : String(value) })}
              />
            </FormItem>
            <Separator />
            <FormItem actionClassName="w-fit" description="关闭后会先保存为草稿，稍后可手动启用。" icon="lucide:power" title="创建后启用">
              <Switch size="lg" aria-label="创建后启用" isSelected={form.enabled} isDisabled={isSubmitting} onChange={(enabled) => update({ enabled })}>
                <Switch.Control><Switch.Thumb /></Switch.Control>
              </Switch>
            </FormItem>
          </ItemCardGroup>

          <ItemCardGroup className="overflow-hidden">
            <ItemCardGroup.Header>
              <ItemCardGroup.Title>计划</ItemCardGroup.Title>
              <ItemCardGroup.Description>选择任务应该在什么时候开始工作。</ItemCardGroup.Description>
            </ItemCardGroup.Header>
            <FormItem description="选择合适的触发类型。" icon="lucide:calendar-clock" title="计划类型">
              <Segment selectedKey={form.scheduleKind} onSelectionChange={(key) => update({ scheduleKind: String(key) as ScheduleKind })}>
                {scheduleTabs.map((tab) => (
                  <Segment.Item key={tab.id} id={tab.id}>
                    <Segment.Separator />
                    {tab.label}
                  </Segment.Item>
                ))}
              </Segment>
            </FormItem>
            <Separator />
            {form.scheduleKind === 'at' ? (
              <FormItem actionClassName="w-full min-w-0 sm:w-69" description="选择日期和具体时间。" icon="lucide:calendar-range" title="运行时间">
                <CronDatePicker
                  isDisabled={isSubmitting}
                  value={form.at}
                  onChange={(value) => update({ at: value })}
                />
              </FormItem>
            ) : null}
            {form.scheduleKind === 'every' ? (
              <FormItem description="适合需要持续检查或定期汇总的任务。" icon="lucide:timer-reset" title="固定间隔">
                <div className="flex gap-3">
                  <Input className="w-auto" variant="secondary" type="number" min={1} value={form.everyValue} disabled={isSubmitting} placeholder="1" onChange={(event) => update({ everyValue: event.target.value })} />
                  <FriendlySelect
                    ariaLabel="间隔单位"
                    isDisabled={isSubmitting}
                    options={[
                      { id: 'm', label: '分钟' },
                      { id: 'h', label: '小时' },
                      { id: 'd', label: '天' },
                    ]}
                    value={form.everyUnit}
                    onChange={(value) => update({ everyUnit: String(value ?? 'h') as CronFormState['everyUnit'] })}
                  />
                </div>
              </FormItem>
            ) : null}
            {form.scheduleKind === 'cron' ? (
              <>
                <FormItem description="填写标准 Cron 表达式。" icon="lucide:code-2" title="表达式">
                  <Input fullWidth variant="secondary" value={form.cronExpr} disabled={isSubmitting} placeholder="0 9 * * *" onChange={(event) => update({ cronExpr: event.target.value })} />
                </FormItem>
                <Separator />
                <FormItem description="按指定时区计算下一次运行时间。" icon="lucide:globe-2" title="时区">
                  <FriendlySelect
                    ariaLabel="时区"
                    isDisabled={isSubmitting}
                    options={timezoneOptions}
                    value={form.tz || 'Asia/Shanghai'}
                    onChange={(value) => update({ tz: String(value ?? 'Asia/Shanghai') })}
                  />
                </FormItem>
                <Separator />
                <FormItem actionClassName="w-fit" description="开启后按表达式时间精确触发。" icon="lucide:crosshair" title="精确触发">
                  <Switch size="lg" aria-label="精确触发" isSelected={form.exact} isDisabled={isSubmitting} onChange={(exact) => update({ exact })}>
                    <Switch.Control><Switch.Thumb /></Switch.Control>
                  </Switch>
                </FormItem>
              </>
            ) : null}
          </ItemCardGroup>
        </>
      ) : null}

      {activeSection === 'execution' ? (
        <>
          <ItemCardGroup className="overflow-hidden">
            <ItemCardGroup.Header>
              <ItemCardGroup.Title>执行上下文</ItemCardGroup.Title>
              <ItemCardGroup.Description>选择任务使用的会话，并决定主会话提醒何时出现。</ItemCardGroup.Description>
            </ItemCardGroup.Header>
            <FormItem description="隔离会话适合后台任务，主会话适合主动提醒。" icon="lucide:route" title="执行会话">
              <FriendlySelect
                ariaLabel="执行会话"
                isDisabled={isSubmitting}
                options={[
                  { id: 'isolated', label: '隔离会话' },
                  { id: 'main', label: '主会话 Heartbeat' },
                  { id: 'current', label: '当前会话' },
                  { id: 'session', label: '指定持久会话' },
                ]}
                value={form.sessionTarget}
                onChange={(value) => update({ sessionTarget: String(value ?? 'isolated') as SessionTargetPreset })}
              />
            </FormItem>
            {form.sessionTarget === 'session' ? (
              <>
                <Separator />
                <FormItem description="指定一个会保留上下文的持久会话。" icon="lucide:key-square" title="会话 ID">
                  <Input fullWidth variant="secondary" value={form.sessionId} disabled={isSubmitting} placeholder="market-intel" onChange={(event) => update({ sessionId: event.target.value })} />
                </FormItem>
              </>
            ) : null}
            <Separator />
            <FormItem description="立即唤醒会尽快提醒，下次心跳会等到下一轮检查。" icon="lucide:bell-ring" title="唤醒方式">
              <FriendlySelect
                ariaLabel="唤醒方式"
                isDisabled={isSubmitting}
                options={[
                  { id: 'now', label: '立即唤醒' },
                  { id: 'next-heartbeat', label: '下次心跳' },
                ]}
                value={form.wakeMode}
                onChange={(value) => update({ wakeMode: String(value ?? 'now') as CronFormState['wakeMode'] })}
              />
            </FormItem>
          </ItemCardGroup>

          <Card>
            <Card.Header>
              <div>
                <Card.Title>{isMain ? '心跳提示词' : '任务提示词'}</Card.Title>
                <Card.Description>
                  {isMain ? '写下需要在主会话里提醒你的内容。' : '告诉智能体到点后要完成什么。'}
                </Card.Description>
              </div>
            </Card.Header>
            <Card.Content>
              <textarea
                className="min-h-28 w-full rounded-2xl border border-divider bg-surface-secondary/50 px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent disabled:opacity-60"
                disabled={isSubmitting}
                placeholder={isMain ? '下次心跳时检查今天的日程和待办。' : '生成今天的运营简报，并汇总需要跟进的事项。'}
                value={isMain ? form.systemEvent : form.message}
                onChange={(event) => update(isMain ? { systemEvent: event.target.value } : { message: event.target.value })}
              />
            </Card.Content>
          </Card>

          {!isMain ? (
            <ItemCardGroup className="overflow-hidden">
              <ItemCardGroup.Header>
                <ItemCardGroup.Title>智能体运行参数</ItemCardGroup.Title>
                <ItemCardGroup.Description>必要时为这个任务单独调整运行偏好。</ItemCardGroup.Description>
              </ItemCardGroup.Header>
              <FormItem description="留空时沿用智能体自己的模型设置。" icon="lucide:brain" title="模型覆盖">
                <AgentModelSelect
                  error={modelConfigError}
                  isDisabled={isSubmitting}
                  options={modelOptions}
                  value={form.model}
                  onChange={(model) => update({ model })}
                />
              </FormItem>
              <Separator />
              <FormItem description="需要更复杂判断时可调高，简单提醒保持默认即可。" icon="lucide:sparkles" title="思考强度">
                <FriendlySelect
                  ariaLabel="思考强度"
                  isDisabled={isSubmitting}
                  options={[
                    { id: '', label: '默认' },
                    { id: 'off', label: '关闭' },
                    { id: 'minimal', label: '极简' },
                    { id: 'low', label: '低' },
                    { id: 'medium', label: '中' },
                    { id: 'high', label: '高' },
                    { id: 'xhigh', label: '极高' },
                  ]}
                  value={form.thinking}
                  onChange={(value) => update({ thinking: String(value ?? '') })}
                />
              </FormItem>
              <Separator />
              <FormItem description="长任务可以给更多时间，留空时使用默认时长。" icon="lucide:timer" title="超时秒数">
                <Input fullWidth variant="secondary" type="number" min={0} value={form.timeoutSeconds} disabled={isSubmitting} placeholder="留空使用默认" onChange={(event) => update({ timeoutSeconds: event.target.value })} />
              </FormItem>
              <Separator />
              <FormItem description="只在需要限制可用工具时填写。" icon="lucide:wrench" title="工具白名单">
                <Input fullWidth variant="secondary" value={form.toolsAllow} disabled={isSubmitting} placeholder="exec, browser, web_search" onChange={(event) => update({ toolsAllow: event.target.value })} />
              </FormItem>
              <Separator />
              <FormItem actionClassName="w-fit" description="适合简单提醒或轻量简报。" icon="lucide:feather" title="轻量上下文">
                <Switch size="lg" aria-label="轻量上下文" isSelected={form.lightContext} isDisabled={isSubmitting} onChange={(lightContext) => update({ lightContext })}>
                  <Switch.Control><Switch.Thumb /></Switch.Control>
                </Switch>
              </FormItem>
            </ItemCardGroup>
          ) : null}
        </>
      ) : null}

      {activeSection === 'delivery' ? (
        <ItemCardGroup className="overflow-hidden">
          <ItemCardGroup.Header>
            <ItemCardGroup.Title>投递配置</ItemCardGroup.Title>
            <ItemCardGroup.Description>决定任务完成后是否把结果发给你或外部系统。</ItemCardGroup.Description>
          </ItemCardGroup.Header>
          <FormItem description="普通任务建议发送公告，不需要结果时可设为不投递。" icon="lucide:send" title="投递方式">
            <FriendlySelect
              ariaLabel="投递方式"
              isDisabled={isSubmitting}
              options={[
                { id: 'announce', label: '频道公告' },
                { id: 'none', label: '不投递' },
                { id: 'webhook', label: 'Webhook' },
              ]}
              value={form.deliveryMode}
              onChange={(value) => update({ deliveryMode: String(value ?? 'announce') as DeliveryMode })}
            />
          </FormItem>
          {form.deliveryMode !== 'none' ? (
            <>
              <Separator />
              <FormItem description={form.deliveryMode === 'webhook' ? '任务完成事件会 POST 到这个地址。' : '频道、用户或服务目标，例如 channel:C123。'} icon="lucide:radio" title={form.deliveryMode === 'webhook' ? 'Webhook URL' : '投递目标'}>
                <Input fullWidth variant="secondary" value={form.deliveryTo} disabled={isSubmitting} placeholder={form.deliveryMode === 'webhook' ? 'https://example.com/hook' : 'channel:C1234567890'} onChange={(event) => update({ deliveryTo: event.target.value })} />
              </FormItem>
              <Separator />
              <FormItem description="用于支持线程或论坛话题的渠道。" icon="lucide:message-circle-more" title="线程 / 话题">
                <Input fullWidth variant="secondary" value={form.deliveryThreadId} disabled={isSubmitting} placeholder="可选" onChange={(event) => update({ deliveryThreadId: event.target.value })} />
              </FormItem>
              {form.deliveryMode === 'announce' ? (
                <>
                  <Separator />
                  <FormItem description="last 会使用最近一次可用的聊天路由。" icon="lucide:hash" title="频道">
                    <FriendlySelect
                      ariaLabel="频道"
                      isDisabled={isSubmitting}
                      options={selectableDeliveryChannels}
                      value={form.deliveryChannel}
                      onChange={(value) => update({ deliveryChannel: String(value ?? defaultForm.deliveryChannel) })}
                    />
                  </FormItem>
                  <Separator />
                  <FormItem description="多账号渠道下用于选择具体账号。" icon="lucide:user-round-cog" title="账号">
                    <Input fullWidth variant="secondary" value={form.deliveryAccountId} disabled={isSubmitting} placeholder="可选" onChange={(event) => update({ deliveryAccountId: event.target.value })} />
                  </FormItem>
                </>
              ) : null}
              <Separator />
              <FormItem actionClassName="w-fit" description="开启后投递失败不会把任务运行标记为失败。" icon="lucide:badge-check" title="投递失败不算失败">
                <Switch size="lg" aria-label="投递失败不算失败" isSelected={form.deliveryBestEffort} isDisabled={isSubmitting} onChange={(deliveryBestEffort) => update({ deliveryBestEffort })}>
                  <Switch.Control><Switch.Thumb /></Switch.Control>
                </Switch>
              </FormItem>
            </>
          ) : null}
          <Separator />
          <FormItem actionClassName="w-fit" description="仅一次性任务可用，成功运行后自动移除。" icon="lucide:trash-2" title="一次性成功后删除">
            <Switch size="lg" aria-label="一次性成功后删除" isSelected={form.deleteAfterRun} isDisabled={isSubmitting || form.scheduleKind !== 'at'} onChange={(deleteAfterRun) => update({ deleteAfterRun })}>
              <Switch.Control><Switch.Thumb /></Switch.Control>
            </Switch>
          </FormItem>
        </ItemCardGroup>
      ) : null}
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

function CronDatePicker({
  isDisabled,
  onChange,
  value,
}: {
  isDisabled?: boolean
  onChange: (value: string) => void
  value: string
}) {
  const dateValue = useMemo(() => parseCronDateValue(value), [value])

  return (
    <DatePicker
      className="w-full"
      granularity="minute"
      hideTimeZone
      hourCycle={24}
      isDisabled={isDisabled}
      name="cron-at"
      value={dateValue}
      onChange={(nextValue) => onChange(formatCronDateValue(nextValue))}
    >
      {({ state }) => (
        <>
          <Label className="sr-only">运行时间</Label>
          <DateField.Group fullWidth variant="secondary">
            <DateField.Input>{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
            <DateField.Suffix>
              <DatePicker.Trigger>
                <DatePicker.TriggerIndicator />
              </DatePicker.Trigger>
            </DateField.Suffix>
          </DateField.Group>
          <DatePicker.Popover className="flex flex-col gap-3">
            <Calendar aria-label="运行日期">
              <Calendar.Header>
                <Calendar.YearPickerTrigger>
                  <Calendar.YearPickerTriggerHeading />
                  <Calendar.YearPickerTriggerIndicator />
                </Calendar.YearPickerTrigger>
                <Calendar.NavButton slot="previous" />
                <Calendar.NavButton slot="next" />
              </Calendar.Header>
              <Calendar.Grid>
                <Calendar.GridHeader>
                  {(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}
                </Calendar.GridHeader>
                <Calendar.GridBody>{(date) => <Calendar.Cell date={date} />}</Calendar.GridBody>
              </Calendar.Grid>
              <Calendar.YearPickerGrid>
                <Calendar.YearPickerGridBody>
                  {({ year }) => <Calendar.YearPickerCell year={year} />}
                </Calendar.YearPickerGridBody>
              </Calendar.YearPickerGrid>
            </Calendar>
            <div className="flex items-center justify-between gap-3">
              <Label className="text-sm">时间</Label>
              <TimeField
                aria-label="运行时间"
                granularity="minute"
                hideTimeZone
                hourCycle={24}
                name="cron-time"
                value={state.timeValue}
                onChange={(nextValue) => state.setTimeValue(nextValue as TimeValue)}
              >
                <TimeField.Group variant="secondary">
                  <TimeField.Input>
                    {(segment) => <TimeField.Segment segment={segment} />}
                  </TimeField.Input>
                </TimeField.Group>
              </TimeField>
            </div>
          </DatePicker.Popover>
        </>
      )}
    </DatePicker>
  )
}

function FriendlySelect({
  ariaLabel,
  isDisabled,
  onChange,
  options,
  value,
}: {
  ariaLabel: string
  isDisabled?: boolean
  onChange: (value: Key | null) => void
  options: Array<{ id: string, label: string }>
  value: Key | null
}) {
  return (
    <CellSelect aria-label={ariaLabel} className="w-full" isDisabled={isDisabled} value={value} variant="secondary" onChange={onChange}>
      <CellSelect.Trigger>
        <CellSelect.Value />
        <CellSelect.Indicator />
      </CellSelect.Trigger>
      <CellSelect.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </CellSelect.Popover>
    </CellSelect>
  )
}

function AgentModelSelect({
  error,
  isDisabled,
  onChange,
  options,
  value,
}: {
  error: string
  isDisabled: boolean
  onChange: (value: string) => void
  options: AgentModelOption[]
  value: string
}) {
  const selectedOption = options.find((option) => option.value === value)
  const hasMissingCurrentModel = Boolean(value && !selectedOption && options.length)

  if (!options.length) {
    return (
      <div className="rounded-2xl bg-warning/10 px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm leading-6 text-warning">
            {error || '暂无已添加模型，可以先保持默认，或前往模型配置添加模型。'}
          </div>
          <Button
            size="sm"
            variant="tertiary"
            onPress={() => {
              window.location.href = '/dashboard/openclaw-models'
            }}
          >
            <Icon icon="lucide:plus" className="size-4" />
            添加模型
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Dropdown>
        <Button
          className="h-auto min-h-11 w-full justify-between rounded-2xl px-3 py-2 text-left"
          variant="secondary"
          isDisabled={isDisabled}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">
                {selectedOption?.label ?? '使用智能体默认模型'}
              </span>
              <span className="block truncate text-xs text-muted">
                {selectedOption?.value ?? '不覆盖模型'}
              </span>
            </span>
          </span>
          <Icon icon="lucide:chevron-down" className="size-4 shrink-0 text-muted" />
        </Button>
        <Dropdown.Popover className="min-w-[auto]" placement="bottom start">
          <Dropdown.Menu
            selectedKeys={new Set([selectedOption?.value ?? '__default_model__'])}
            selectionMode="single"
            onAction={(key) => onChange(String(key) === '__default_model__' ? '' : String(key))}
          >
            <Dropdown.Item id="__default_model__" textValue="使用智能体默认模型">
              <Dropdown.ItemIndicator />
              <div className="min-w-0">
                <Label className="truncate">使用智能体默认模型</Label>
                <p className="mt-1 truncate text-xs text-muted">不覆盖模型</p>
              </div>
            </Dropdown.Item>
            {options.map((option) => (
              <Dropdown.Item key={option.value} id={option.value} textValue={`${option.label} ${option.value}`}>
                <Dropdown.ItemIndicator />
                <div className="min-w-0">
                  <Label className="truncate">{option.label}</Label>
                  <p className="mt-1 truncate text-xs text-muted">{option.providerKey}/{option.modelId}</p>
                </div>
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      {hasMissingCurrentModel ? (
        <p className="text-xs leading-5 text-warning">
          当前模型不在已添加模型中，请重新选择。
        </p>
      ) : null}
    </div>
  )
}

function CronKanbanBoard({
  deliveryPreviews,
  jobs,
  mutatingJobId,
  onClone,
  onDelete,
  onEdit,
  onRun,
  onScheduleFilterChange,
  onToggle,
  scheduleFilters,
}: {
  deliveryPreviews?: OpenClawCronListResponse['deliveryPreviews']
  jobs: OpenClawCronJob[]
  mutatingJobId: string
  onClone: (job: OpenClawCronJob) => void
  onDelete: (job: OpenClawCronJob) => void
  onEdit: (job: OpenClawCronJob) => void
  onRun: (job: OpenClawCronJob) => void
  onScheduleFilterChange: (column: CronBoardColumnId, filter: CronScheduleFilter) => void
  onToggle: (job: OpenClawCronJob) => void
  scheduleFilters: Record<CronBoardColumnId, CronScheduleFilter>
}) {
  const kanban = useKanban<OpenClawCronJob>({
    getColumn: getCronBoardColumn,
    initialItems: jobs,
    setColumn: (job) => job,
  })

  return (
    <Kanban className="overflow-x-auto" size="md">
      {cronBoardColumns.map((column) => (
        <CronKanbanColumn
          key={column.id}
          column={column}
          deliveryPreviews={deliveryPreviews}
          kanban={kanban}
          mutatingJobId={mutatingJobId}
          onClone={onClone}
          onDelete={onDelete}
          onEdit={onEdit}
          onRun={onRun}
          onScheduleFilterChange={onScheduleFilterChange}
          onToggle={onToggle}
          scheduleFilter={scheduleFilters[column.id]}
        />
      ))}
    </Kanban>
  )
}

function CronKanbanColumn({
  column,
  deliveryPreviews,
  kanban,
  mutatingJobId,
  onClone,
  onDelete,
  onEdit,
  onRun,
  onScheduleFilterChange,
  onToggle,
  scheduleFilter,
}: {
  column: typeof cronBoardColumns[number]
  deliveryPreviews?: OpenClawCronListResponse['deliveryPreviews']
  kanban: UseKanbanReturn<OpenClawCronJob>
  mutatingJobId: string
  onClone: (job: OpenClawCronJob) => void
  onDelete: (job: OpenClawCronJob) => void
  onEdit: (job: OpenClawCronJob) => void
  onRun: (job: OpenClawCronJob) => void
  onScheduleFilterChange: (column: CronBoardColumnId, filter: CronScheduleFilter) => void
  onToggle: (job: OpenClawCronJob) => void
  scheduleFilter: CronScheduleFilter
}) {
  const { items } = useKanbanColumn(kanban, column.id)
  const filteredItems = scheduleFilter === 'all'
    ? items
    : items.filter((job) => job.schedule.kind === scheduleFilter)
  const scheduleLabel = cronScheduleFilterOptions.find((option) => option.id === scheduleFilter)?.label ?? '全部'

  return (
    <Kanban.Column>
      <Kanban.ColumnHeader>
        <Kanban.ColumnIndicator className={column.color} />
        <Kanban.ColumnTitle>{column.label}</Kanban.ColumnTitle>
        <Kanban.ColumnCount>{filteredItems.length}</Kanban.ColumnCount>
        <Kanban.ColumnActions className="opacity-100">
          <Dropdown>
            <Button isIconOnly aria-label={`${column.label}计划筛选`} size="sm" variant="ghost">
              <Icon icon="lucide:filter" className="size-4" />
            </Button>
            <Dropdown.Popover>
              <Dropdown.Menu
                aria-label={`${column.label}计划筛选`}
                selectionMode="single"
                selectedKeys={[scheduleFilter]}
                onAction={(key) => onScheduleFilterChange(column.id, String(key) as CronScheduleFilter)}
              >
                {cronScheduleFilterOptions.map((option) => (
                  <Dropdown.Item key={option.id} id={option.id} textValue={option.label}>
                    <Dropdown.ItemIndicator />
                    {option.label}
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
          <Chip size="sm" variant="soft">
            {scheduleLabel} · {formatCompactCount(filteredItems.length)} / {formatCompactCount(items.length)}
          </Chip>
        </Kanban.ColumnActions>
      </Kanban.ColumnHeader>
      <Kanban.ColumnBody>
        <Kanban.ScrollShadow className="max-h-[560px]">
          <Kanban.CardList
            aria-label={column.label}
            items={filteredItems}
            renderEmptyState={() => '暂无任务'}
          >
            {(job) => (
              <Kanban.Card key={job.id} textValue={job.name || job.id}>
                <CronKanbanCard
                  deliveryLabel={deliveryPreviews?.[job.id]?.label}
                  isMutating={mutatingJobId === job.id}
                  job={job}
                  onClone={() => onClone(job)}
                  onDelete={() => onDelete(job)}
                  onEdit={() => onEdit(job)}
                  onRun={() => onRun(job)}
                  onToggle={() => onToggle(job)}
                />
              </Kanban.Card>
            )}
          </Kanban.CardList>
        </Kanban.ScrollShadow>
      </Kanban.ColumnBody>
    </Kanban.Column>
  )
}

function CronKanbanCard({
  deliveryLabel,
  isMutating,
  job,
  onClone,
  onDelete,
  onEdit,
  onRun,
  onToggle,
}: {
  deliveryLabel?: string
  isMutating: boolean
  job: OpenClawCronJob
  onClone: () => void
  onDelete: () => void
  onEdit: () => void
  onRun: () => void
  onToggle: () => void
}) {
  const enabled = job.enabled ?? true
  return (
    <div className="space-y-3 rounded-xl">
      <div className="w-full min-w-0 text-left">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 font-semibold text-foreground">{job.name || job.id}</p>
          {job.state.runningAtMs ? <Chip className="text-warning" size="sm" variant="secondary">运行中</Chip> : null}
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-muted">{job.description || formatSchedule(job.schedule)}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Chip className={enabled ? 'text-success' : 'text-muted'} size="sm" variant="secondary">{enabled ? '启用' : '停用'}</Chip>
        <Chip size="sm" variant="secondary">{formatScheduleKind(job.schedule)}</Chip>
        <Chip size="sm" variant="secondary">{deliveryLabel || job.delivery?.mode || '默认投递'}</Chip>
      </div>
      <div className="grid gap-1 text-xs text-muted">
        <div className="flex items-center gap-1.5">
          <Icon icon="lucide:clock" className="size-3.5" />
          <span className="truncate">下次 {formatDateTime(job.state.nextRunAtMs)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Icon icon="lucide:route" className="size-3.5" />
          <span className="truncate">{job.sessionTarget || '默认会话'}</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 pt-1">
        <Switch size="lg" aria-label="切换任务启用状态" isSelected={enabled} isDisabled={isMutating} onChange={onToggle}>
          <Switch.Control><Switch.Thumb /></Switch.Control>
        </Switch>
        <div className="flex items-center gap-1">
          <Tooltip delay={300}>
            <Button isIconOnly aria-label="编辑任务" size="sm" variant="ghost" isDisabled={isMutating} onPress={onEdit}>
              <Icon icon="lucide:pencil" className="size-4" />
            </Button>
            <Tooltip.Content>编辑任务</Tooltip.Content>
          </Tooltip>
          <Tooltip delay={300}>
            <Button isIconOnly aria-label="复制任务" size="sm" variant="ghost" isDisabled={isMutating} onPress={onClone}>
              <Icon icon="lucide:copy" className="size-4" />
            </Button>
            <Tooltip.Content>复制任务</Tooltip.Content>
          </Tooltip>
          <Tooltip delay={300}>
            <Button isIconOnly aria-label="运行任务" size="sm" variant="ghost" isDisabled={isMutating} onPress={onRun}>
              <Icon icon="lucide:play" className="size-4" />
            </Button>
            <Tooltip.Content>运行任务</Tooltip.Content>
          </Tooltip>
          <Tooltip delay={300}>
            <Button isIconOnly aria-label="删除任务" size="sm" variant="danger-soft" isDisabled={isMutating} onPress={onDelete}>
              <Icon icon="lucide:trash-2" className="size-4" />
            </Button>
            <Tooltip.Content>删除任务</Tooltip.Content>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

function CronRunHistoryCard({
  isLoading,
  isRefreshing,
  jobs,
  onRefresh,
  onStatusFilterChange,
  runs,
  statusFilter,
  total,
}: {
  isLoading: boolean
  isRefreshing: boolean
  jobs: OpenClawCronJob[]
  onRefresh: () => void
  onStatusFilterChange: (filter: CronRunStatusFilter) => void
  runs: OpenClawCronRunEntry[]
  statusFilter: CronRunStatusFilter
  total: number
}) {
  const [filterText, setFilterText] = useState('')
  const jobById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs])
  const filteredRuns = useMemo(() => filterCronRuns(runs, jobById, filterText), [filterText, jobById, runs])
  const displayTotal = filterText.trim() ? filteredRuns.length : total
  const hasActiveFilters = filterText.trim() || statusFilter !== 'all'

  return (
    <Card className="mt-6">
      <Card.Header>
        <div className="flex min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <Icon icon="lucide:history" className="size-6 shrink-0 text-muted" />
            <div className="min-w-0">
              <Card.Title>运行历史</Card.Title>
              <Card.Description>查看定时任务的最近执行记录、运行状态和触发结果。</Card.Description>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <SearchField aria-label="搜索运行历史" value={filterText} onChange={setFilterText}>
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input className="w-full sm:w-36" placeholder="搜索..." />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <div className="w-auto">
              <FriendlySelect
                ariaLabel="筛选运行结果"
                isDisabled={isRefreshing}
                options={cronRunStatusFilterOptions}
                value={statusFilter}
                onChange={(value) => onStatusFilterChange(String(value ?? 'all') as CronRunStatusFilter)}
              />
            </div>
            <Tooltip delay={300}>
              <Button
                isIconOnly
                aria-label="刷新运行历史"
                size="sm"
                variant="ghost"
                isDisabled={isRefreshing}
                onPress={onRefresh}
              >
                <Icon icon={isRefreshing ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </Button>
              <Tooltip.Content>刷新运行历史</Tooltip.Content>
            </Tooltip>
            <Chip variant="soft">
              共 {formatCompactCount(displayTotal)} 条
            </Chip>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        {isLoading ? (
          <div className="grid gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-20 rounded-2xl" />
            ))}
          </div>
        ) : filteredRuns.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl bg-surface-secondary/50 px-6 py-8 text-center">
            <Icon icon="lucide:history" className="size-7 text-muted" />
            <p className="mt-3 font-medium text-foreground">{hasActiveFilters ? '未找到匹配的运行历史' : '暂无运行历史'}</p>
            <p className="mt-1 text-sm text-muted">{hasActiveFilters ? '尝试更换关键词、结果状态或清空搜索条件。' : '任务触发后会在这里显示最近的运行结果。'}</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredRuns.slice(0, 12).map((run, index) => (
              <CronRunHistoryItem
                key={run.runId || `${run.jobId}-${run.ts}-${index}`}
                job={jobById.get(run.jobId)}
                run={run}
              />
            ))}
          </div>
        )}
      </Card.Content>
    </Card>
  )
}

function CronRunHistoryItem({ job, run }: { job?: OpenClawCronJob; run: OpenClawCronRunEntry }) {
  const status = run.status || 'skipped'
  const tone = cronRunStatusTone(status)
  const title = job?.name || run.jobId || '未知任务'

  return (
    <div className="rounded-2xl bg-surface-secondary/50 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Chip size="sm" variant="soft" color={tone}>
              {formatCronRunStatus(status)}
            </Chip>
            {run.deliveryStatus ? (
              <Chip size="sm" variant="soft" color={run.deliveryStatus === 'delivered' ? 'success' : run.deliveryStatus === 'not-delivered' ? 'warning' : 'default'}>
                {formatDeliveryStatus(run.deliveryStatus)}
              </Chip>
            ) : null}
          </div>
          <div className="mt-2 min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate font-medium text-foreground" title={title}>{title}</div>
              {run.sessionKey || run.sessionId ? (
                <span className="min-w-0 truncate text-xs text-muted" title={run.sessionKey || run.sessionId || undefined}>
                  / {run.sessionKey || run.sessionId}
                </span>
              ) : null}
            </div>
            {run.summary || run.error || run.deliveryError ? (
              <p className={`mt-1 line-clamp-2 text-sm leading-6 ${run.error || run.deliveryError ? 'text-warning' : 'text-muted'}`}>
                {run.error || run.deliveryError || run.summary}
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:w-[360px] lg:shrink-0">
          <RunHistoryMeta icon="lucide:clock-3" label="运行时间" value={formatDateTime(run.runAtMs || run.ts)} />
          <RunHistoryMeta icon="lucide:timer" label="耗时" value={formatDuration(run.durationMs)} />
          {run.nextRunAtMs ? <RunHistoryMeta icon="lucide:calendar-clock" label="下次运行" value={formatDateTime(run.nextRunAtMs)} /> : null}
          <RunHistoryMeta icon="lucide:briefcase-business" label="任务" value={run.jobId} />
          {run.runId ? <RunHistoryMeta icon="lucide:fingerprint" label="Run ID" value={run.runId} /> : null}
        </div>
      </div>
    </div>
  )
}

function RunHistoryMeta({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-surface px-3 py-2">
      <Icon icon={icon} className="size-4 shrink-0 text-muted" />
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <div className="truncate text-xs text-foreground tabular-nums" title={value}>{value}</div>
      </div>
    </div>
  )
}

function filterCronRuns(runs: OpenClawCronRunEntry[], jobById: Map<string, OpenClawCronJob>, filterText: string) {
  const keyword = filterText.trim().toLowerCase()
  if (!keyword) return runs

  return runs.filter((run) => {
    const job = jobById.get(run.jobId)
    return [
      job?.name,
      job?.description,
      run.jobId,
      run.runId,
      run.sessionKey,
      run.sessionId,
      run.status,
      run.deliveryStatus,
      run.summary,
      run.error,
      run.deliveryError,
    ].some((value) => String(value ?? '').toLowerCase().includes(keyword))
  })
}

function getCronBoardColumn(job: OpenClawCronJob): CronBoardColumnId {
  return (job.enabled ?? true) ? 'enabled' : 'paused'
}

function getCronStats(jobs: OpenClawCronJob[]) {
  return jobs.reduce((acc, job) => {
    acc.total += 1
    if (job.enabled ?? true) {
      acc.enabled += 1
    } else {
      acc.paused += 1
    }
    return acc
  }, { total: 0, enabled: 0, paused: 0 })
}

function formatScheduleKind(schedule: OpenClawCronSchedule) {
  if (schedule.kind === 'at') return '一次性'
  if (schedule.kind === 'every') return '固定间隔'
  return 'Cron'
}

function CronSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <Skeleton key={index} className="h-24 rounded-2xl" />
      ))}
    </div>
  )
}

function configObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function buildDeliveryChannelOptions(content: Record<string, unknown>): DeliveryChannelOption[] {
  const channels = configObject(content.channels)
  const knownChannelIds = new Set(openClawDeliveryChannels.map((channel) => channel.id))
  const enabledKnownChannels = openClawDeliveryChannels.filter((channel) => isDeliveryChannelEnabled(configObject(channels[channel.id])))
  const enabledCustomChannels = Object.entries(channels)
    .filter(([channelId, config]) => !knownChannelIds.has(channelId) && isDeliveryChannelEnabled(configObject(config)))
    .map(([channelId, config]) => {
      const channelConfig = configObject(config)
      const label = String(channelConfig.label || channelConfig.name || channelConfig.botName || channelId)
      return { id: channelId, label }
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))

  return [
    { id: defaultForm.deliveryChannel, label: '最近可用频道' },
    ...enabledKnownChannels,
    ...enabledCustomChannels,
  ]
}

function isDeliveryChannelEnabled(config: Record<string, unknown>) {
  if (!Object.keys(config).length) return false
  if (config.enabled === false) return false
  if (config.enabled === true) return true

  const accounts = configObject(config.accounts)
  return Object.values(accounts).some((account) => configObject(account).enabled === true)
}

function withCurrentDeliveryChannelOption(options: DeliveryChannelOption[], value: string): DeliveryChannelOption[] {
  const currentValue = value.trim()
  if (!currentValue || options.some((option) => option.id === currentValue)) return options
  return [...options, { id: currentValue, label: currentValue }]
}

async function withOpenClawGatewayFallback<T>(
  callGateway: (client: OpenClawGatewayClient) => Promise<T>,
  callBackend: () => Promise<T>,
) {
  let client: OpenClawGatewayClient | null = null

  try {
    client = await createOpenClawCronGatewayClient()
    return await callGateway(client)
  } catch {
    return await callBackend()
  } finally {
    client?.close()
  }
}

async function createOpenClawCronGatewayClient() {
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

function loadOpenClawCronSnapshotPreferGateway(statusFilter: CronRunStatusFilter) {
  const jobsOptions: CronJobsListOptions = { enabled: 'all', includeDisabled: true, limit: 100 }
  const runsOptions: CronRunsOptions = { limit: 100, sortDir: 'desc', status: statusFilter }

  return withOpenClawGatewayFallback(
    async (client) => await Promise.all([
      client.cronStatus({ timeoutMs: 15_000 }),
      client.cronJobs(jobsOptions, { timeoutMs: 20_000 }),
      client.cronRuns(
        {
          limit: runsOptions.limit,
          scope: 'all',
          sortDir: runsOptions.sortDir,
          status: runsOptions.status,
        },
        { timeoutMs: 20_000 },
      ),
    ]),
    async () => await Promise.all([
      getOpenClawCronStatus(),
      listOpenClawCronJobs(jobsOptions),
      listOpenClawCronRuns(runsOptions),
    ]),
  )
}

function createOpenClawCronJobPreferGateway(body: OpenClawCronJobCreate) {
  return withOpenClawGatewayFallback(
    (client) => client.cronAdd(body, { timeoutMs: 30_000 }),
    () => createOpenClawCronJob(body),
  )
}

function updateOpenClawCronJobPreferGateway(id: string, body: OpenClawCronJobPatch) {
  return withOpenClawGatewayFallback(
    (client) => client.cronUpdate(id, body, { timeoutMs: 30_000 }),
    () => updateOpenClawCronJob(id, body),
  )
}

function deleteOpenClawCronJobPreferGateway(id: string) {
  return withOpenClawGatewayFallback(
    (client) => client.cronRemove(id, { timeoutMs: 20_000 }),
    () => deleteOpenClawCronJob(id),
  )
}

function runOpenClawCronJobPreferGateway(id: string, mode: 'due' | 'force' = 'force') {
  return withOpenClawGatewayFallback(
    (client) => client.cronRun(id, mode, { timeoutMs: 30_000 }),
    () => runOpenClawCronJob(id, mode),
  )
}

function listOpenClawCronRunsPreferGateway(options: CronRunsOptions = {}) {
  return withOpenClawGatewayFallback(
    (client) =>
      client.cronRuns(
        {
          id: options.id,
          limit: options.limit,
          offset: options.offset,
          query: options.query,
          scope: options.id ? 'job' : 'all',
          sortDir: options.sortDir,
          status: options.status,
          ...(options.deliveryStatus ? { deliveryStatuses: [options.deliveryStatus] } : {}),
        },
        { timeoutMs: 20_000 },
      ),
    () => listOpenClawCronRuns(options),
  )
}

function getGatewayAuth(content?: Record<string, unknown>) {
  const gateway = configObject(configObject(content).gateway)
  const auth = configObject(gateway.auth)
  const token = auth.token
  const password = auth.password

  return {
    password: typeof password === 'string' && password.trim() ? password.trim() : undefined,
    token: typeof token === 'string' && token.trim() ? token.trim() : undefined,
  }
}

function buildAgentModelOptions(content: Record<string, unknown>): AgentModelOption[] {
  const modelsConfig = configObject(content.models)
  const providers = configObject(modelsConfig.providers)
  const options: AgentModelOption[] = []
  const seen = new Set<string>()

  for (const [providerKey, providerValue] of Object.entries(providers)) {
    const provider = configObject(providerValue) as OpenClawModelProvider
    const providerModels = Array.isArray(provider.models) ? provider.models : []

    for (const item of providerModels) {
      const model = typeof item === 'string'
        ? { id: item } satisfies OpenClawModelDefinition
        : configObject(item) as OpenClawModelDefinition
      const modelId = String(model.id ?? '').trim()
      if (!modelId) continue

      const value = `${providerKey}/${modelId}`
      if (seen.has(value)) continue
      seen.add(value)

      options.push({
        label: String(model.name || modelId),
        modelId,
        providerKey,
        value,
      })
    }
  }

  return options.sort((a, b) => a.providerKey.localeCompare(b.providerKey, 'zh-CN') || a.label.localeCompare(b.label, 'zh-CN'))
}

function buildCronJobCreate(form: CronFormState): OpenClawCronJobCreate {
  const sessionTarget = (form.sessionTarget === 'session' ? `session:${form.sessionId.trim()}` : form.sessionTarget) as OpenClawCronJobCreate['sessionTarget']
  const isMain = sessionTarget === 'main'
  const payload: OpenClawCronJobCreate['payload'] = isMain
    ? { kind: 'systemEvent', text: form.systemEvent.trim() }
    : {
      kind: 'agentTurn',
      message: form.message.trim(),
      ...(form.model.trim() ? { model: form.model.trim() } : {}),
      ...(form.thinking.trim() ? { thinking: form.thinking.trim() } : {}),
      ...(parsePositiveNumber(form.timeoutSeconds) !== undefined ? { timeoutSeconds: parsePositiveNumber(form.timeoutSeconds) } : {}),
      ...(form.lightContext ? { lightContext: true } : {}),
      ...(parseList(form.toolsAllow).length ? { toolsAllow: parseList(form.toolsAllow) } : {}),
    }

  const delivery = form.deliveryMode === 'none'
    ? { mode: 'none' as const }
    : {
      mode: form.deliveryMode,
      ...(form.deliveryChannel.trim() && form.deliveryMode === 'announce' ? { channel: form.deliveryChannel.trim() } : {}),
      ...(form.deliveryTo.trim() ? { to: form.deliveryTo.trim() } : {}),
      ...(form.deliveryAccountId.trim() ? { accountId: form.deliveryAccountId.trim() } : {}),
      ...(form.deliveryThreadId.trim() ? { threadId: form.deliveryThreadId.trim() } : {}),
      ...(form.deliveryBestEffort ? { bestEffort: true } : {}),
    }

  return {
    ...(form.agentId.trim() ? { agentId: form.agentId.trim() } : {}),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    deleteAfterRun: form.scheduleKind === 'at' ? form.deleteAfterRun : undefined,
    delivery,
    enabled: form.enabled,
    name: form.name.trim() || defaultJobName(form),
    payload,
    schedule: buildSchedule(form),
    sessionTarget,
    wakeMode: form.wakeMode,
  }
}

function buildCronJobPatch(form: CronFormState): OpenClawCronJobPatch {
  return buildCronJobCreate(form) as OpenClawCronJobPatch
}

function cloneCronJobCreate(job: OpenClawCronJob): OpenClawCronJobCreate {
  return {
    ...(job.agentId ? { agentId: job.agentId } : {}),
    ...(job.deleteAfterRun !== undefined ? { deleteAfterRun: job.deleteAfterRun } : {}),
    ...(job.delivery ? { delivery: job.delivery } : {}),
    ...(job.description ? { description: job.description } : {}),
    ...(job.failureAlert !== undefined ? { failureAlert: job.failureAlert } : {}),
    ...(job.sessionKey ? { sessionKey: job.sessionKey } : {}),
    ...(job.sessionTarget ? { sessionTarget: job.sessionTarget } : {}),
    ...(job.wakeMode ? { wakeMode: job.wakeMode } : {}),
    enabled: job.enabled ?? true,
    name: `${job.name || job.id} 副本`,
    payload: job.payload,
    schedule: job.schedule,
  }
}

function jobToCronForm(job: OpenClawCronJob): CronFormState {
  const payload = job.payload
  const schedule = job.schedule
  const every = schedule.kind === 'every' ? everyMsToForm(schedule.everyMs) : null
  const sessionTarget = String(job.sessionTarget ?? 'isolated')
  const delivery = job.delivery

  return {
    ...defaultForm,
    agentId: job.agentId ?? '',
    at: schedule.kind === 'at' ? schedule.at : '',
    cronExpr: schedule.kind === 'cron' ? schedule.expr : defaultForm.cronExpr,
    deleteAfterRun: schedule.kind === 'at' ? Boolean(job.deleteAfterRun) : defaultForm.deleteAfterRun,
    deliveryAccountId: delivery?.accountId ? String(delivery.accountId) : '',
    deliveryBestEffort: Boolean(delivery?.bestEffort),
    deliveryChannel: delivery?.channel ? String(delivery.channel) : defaultForm.deliveryChannel,
    deliveryMode: delivery?.mode ?? defaultForm.deliveryMode,
    deliveryThreadId: delivery?.threadId ? String(delivery.threadId) : '',
    deliveryTo: delivery?.to ? String(delivery.to) : '',
    description: job.description ?? '',
    enabled: job.enabled ?? true,
    everyUnit: every?.unit ?? defaultForm.everyUnit,
    everyValue: every?.value ?? defaultForm.everyValue,
    exact: schedule.kind === 'cron' ? schedule.staggerMs === 0 : false,
    lightContext: payload.kind === 'agentTurn' ? Boolean(payload.lightContext) : false,
    message: payload.kind === 'agentTurn' ? payload.message : '',
    model: payload.kind === 'agentTurn' ? payload.model ?? '' : '',
    name: job.name ?? '',
    scheduleKind: schedule.kind,
    sessionId: sessionTarget.startsWith('session:') ? sessionTarget.slice('session:'.length) : '',
    sessionTarget: sessionTarget.startsWith('session:') ? 'session' : sessionTarget as SessionTargetPreset,
    systemEvent: payload.kind === 'systemEvent' ? payload.text : '',
    thinking: payload.kind === 'agentTurn' ? payload.thinking ?? '' : '',
    timeoutSeconds: payload.kind === 'agentTurn' && payload.timeoutSeconds != null ? String(payload.timeoutSeconds) : '',
    toolsAllow: payload.kind === 'agentTurn' ? (payload.toolsAllow ?? []).join(', ') : '',
    tz: schedule.kind === 'cron' ? schedule.tz ?? defaultForm.tz : defaultForm.tz,
    wakeMode: job.wakeMode ?? defaultForm.wakeMode,
  }
}

function everyMsToForm(ms: number): { unit: CronFormState['everyUnit'], value: string } {
  if (ms % 86_400_000 === 0) return { unit: 'd', value: String(ms / 86_400_000) }
  if (ms % 3_600_000 === 0) return { unit: 'h', value: String(ms / 3_600_000) }
  return { unit: 'm', value: String(Math.max(1, Math.round(ms / 60_000))) }
}

function buildSchedule(form: CronFormState): OpenClawCronSchedule {
  if (form.scheduleKind === 'every') {
    return { kind: 'every', everyMs: parseEveryMs(form.everyValue, form.everyUnit) }
  }
  if (form.scheduleKind === 'cron') {
    return {
      kind: 'cron',
      expr: form.cronExpr.trim(),
      ...(form.tz.trim() ? { tz: form.tz.trim() } : {}),
      ...(form.exact ? { staggerMs: 0 } : {}),
    }
  }
  const date = form.at ? new Date(form.at) : null
  return { kind: 'at', at: date && Number.isFinite(date.getTime()) ? date.toISOString() : '' }
}

function validateCronForm(form: CronFormState, payload: OpenClawCronJobCreate) {
  if (!payload.name?.trim()) return '请输入任务名称'
  if (payload.schedule.kind === 'at' && !payload.schedule.at) return '请选择一次性运行时间'
  if (form.scheduleKind === 'every' && parseEveryMs(form.everyValue, form.everyUnit) <= 0) return '请输入有效的固定间隔'
  if (form.scheduleKind === 'cron' && !form.cronExpr.trim()) return '请输入 Cron 表达式'
  if (form.sessionTarget === 'session' && !form.sessionId.trim()) return '请输入持久会话 ID'
  if (payload.sessionTarget === 'main' && payload.payload.kind === 'systemEvent' && !payload.payload.text.trim()) return '请输入系统事件内容'
  if (payload.sessionTarget !== 'main' && payload.payload.kind === 'agentTurn' && !payload.payload.message.trim()) return '请输入 Agent 提示词'
  if (form.deliveryMode === 'webhook' && !form.deliveryTo.trim()) return 'Webhook 投递需要填写 URL'
  return ''
}

function getValidationSection(message: string): CreateFormSection {
  if (message.includes('投递') || message.includes('Webhook')) return 'delivery'
  if (message.includes('会话') || message.includes('提示词') || message.includes('系统事件')) return 'execution'
  return 'schedule'
}

function defaultJobName(form: CronFormState) {
  if (form.scheduleKind === 'at') return '一次性提醒'
  if (form.scheduleKind === 'every') return `每 ${form.everyValue || 1}${form.everyUnit} 执行`
  return 'Cron 定时任务'
}

function parseEveryMs(value: string, unit: CronFormState['everyUnit']) {
  const amount = Math.max(0, Number(value) || 0)
  const multiplier = unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : 60_000
  return Math.floor(amount * multiplier)
}

function parsePositiveNumber(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function parseList(value: string) {
  return value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean)
}

function parseCronDateValue(value: string): DateValue | null {
  if (!value) return null
  try {
    return parseAbsoluteToLocal(value)
  } catch {
    return null
  }
}

function formatCronDateValue(value: DateValue | null) {
  if (!value) return ''
  return value.toDate(getLocalTimeZone()).toISOString()
}

function formatSchedule(schedule: OpenClawCronSchedule) {
  if (schedule.kind === 'at') return `一次性 · ${schedule.at}`
  if (schedule.kind === 'every') return `每 ${formatDuration(schedule.everyMs)}`
  return `Cron · ${schedule.expr}${schedule.tz ? ` · ${schedule.tz}` : ''}`
}

function formatDuration(ms?: number) {
  if (!ms || ms < 0) return '暂无'
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000} 天`
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000} 小时`
  if (ms % 60_000 === 0) return `${ms / 60_000} 分钟`
  return `${ms} ms`
}

function formatCronRunStatus(status: OpenClawCronRunEntry['status']) {
  if (status === 'ok') return '成功'
  if (status === 'error') return '失败'
  if (status === 'skipped') return '跳过'
  return '未知'
}

function cronRunStatusTone(status: OpenClawCronRunEntry['status']) {
  if (status === 'ok') return 'success' as const
  if (status === 'error') return 'danger' as const
  if (status === 'skipped') return 'warning' as const
  return 'default' as const
}

function formatDeliveryStatus(status: OpenClawCronDeliveryStatus) {
  if (status === 'delivered') return '已投递'
  if (status === 'not-delivered') return '未投递'
  if (status === 'not-requested') return '未请求'
  return '未知投递'
}

function formatCompactCount(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: value >= 1000 ? 1 : 0,
    notation: value >= 10000 ? 'compact' : 'standard',
  }).format(value)
}

function formatDateTime(value?: number | null) {
  if (!value) return '暂无'
  return new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value))
}

export default OpenClawCronPage
