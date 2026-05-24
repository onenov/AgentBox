import { type SVGProps, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertDialog, Button, Card, Chip, Description, Dropdown, Input, Label, ListBox, Modal, SearchField, Separator, Skeleton, Tooltip, toast } from '@heroui/react'
import { CellSelect, ItemCard, ItemCardGroup, Kanban, PieChart, Segment, useKanban, useKanbanColumn } from '@heroui-pro/react'
import type { UseKanbanReturn } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type {
  HermesAgentInfo,
  HermesKanbanBoardMeta,
  HermesKanbanBoardResponse,
  HermesKanbanStatus,
  HermesKanbanTask,
  HermesKanbanTaskCreate,
  HermesKanbanTaskDetailResponse,
} from '@/api'
import {
  addHermesKanbanComment,
  createHermesKanbanTask,
  dispatchHermesKanban,
  getHermesKanbanBoard,
  getHermesKanbanTask,
  listHermesKanbanBoards,
  updateHermesKanbanTask,
} from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { useHermesAgentStore } from '@/stores/hermes-agent'
import { HermesLoadErrorCard } from '../hermes-shared/HermesLoadErrorCard'

type LoadState = 'idle' | 'loading' | 'ready' | 'error'
type CreateColumn = HermesKanbanStatus | 'auto'

type CreateTaskForm = {
  assignee: string
  body: string
  maxRetries: string
  maxRuntimeSeconds: string
  parents: string
  priority: string
  skills: string
  tenant: string
  title: string
  triage: boolean
  workspaceKind: string
  workspacePath: string
}

type StatusAction = {
  blockReason: string
  kind: 'blocked' | 'done'
  summary: string
  task: HermesKanbanTask
}

const defaultBoardSlug = 'default'

const defaultCreateForm: CreateTaskForm = {
  assignee: '',
  body: '',
  maxRetries: '',
  maxRuntimeSeconds: '',
  parents: '',
  priority: '0',
  skills: '',
  tenant: '',
  title: '',
  triage: true,
  workspaceKind: 'scratch',
  workspacePath: '',
}

const statusColumns: Array<{
  color: string
  description: string
  icon: string
  id: HermesKanbanStatus
  label: string
}> = [
    { color: 'bg-accent', description: '原始想法、待拆解或等待整理', icon: 'lucide:sparkles', id: 'triage', label: '待整理' },
    { color: 'bg-default', description: '等待分配、依赖未完成或暂存', icon: 'lucide:circle', id: 'todo', label: '待处理' },
    { color: 'bg-success', description: '已分配，等待调度执行', icon: 'lucide:circle-dashed', id: 'ready', label: '准备执行' },
    { color: 'bg-warning', description: '执行器已认领并正在处理', icon: 'lucide:circle-play', id: 'running', label: '执行中' },
    { color: 'bg-danger', description: '等待人工输入或失败处理', icon: 'lucide:octagon-alert', id: 'blocked', label: '已阻塞' },
    { color: 'bg-success', description: '已完成并写入结果摘要', icon: 'lucide:circle-check', id: 'done', label: '已完成' },
  ]

const archivedColumn = { color: 'bg-default', description: '已归档任务', icon: 'lucide:archive', id: 'archived' as HermesKanbanStatus, label: '已归档' }

const createColumnOptions: Array<{ id: CreateColumn; label: string }> = [
  { id: 'auto', label: '自动' },
  { id: 'triage', label: '待整理' },
  { id: 'ready', label: '准备执行' },
]

const createSectionTabs = [
  { id: 'basis', label: '基础' },
  { id: 'execution', label: '执行' },
  { id: 'preview', label: '预览' },
] as const

const detailSectionTabs = [
  { id: 'overview', label: '概览' },
  { id: 'activity', label: '动态' },
  { id: 'runs', label: '运行' },
] as const

const kanbanChartColors = {
  blocked: 'var(--color-danger)',
  done: 'var(--color-success)',
  ready: 'var(--color-accent)',
  running: 'var(--color-warning)',
  waiting: 'var(--color-default)',
}

type CreateSection = typeof createSectionTabs[number]['id']
type DetailSection = typeof detailSectionTabs[number]['id']

function HermesKanbanPage() {
  usePageTitle('Hermes 任务看板')
  const selectedAgentName = useHermesAgentStore((store) => store.selectedName)
  const profiles = useHermesAgentStore((store) => store.profiles)
  const loadAgents = useHermesAgentStore((store) => store.loadAgents)
  const [state, setState] = useState<LoadState>('idle')
  const [boards, setBoards] = useState<HermesKanbanBoardMeta[]>([])
  const [selectedBoard, setSelectedBoard] = useState(defaultBoardSlug)
  const [boardData, setBoardData] = useState<HermesKanbanBoardResponse | null>(null)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [tenantFilter, setTenantFilter] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const [isCreateOpen, setCreateOpen] = useState(false)
  const [createColumn, setCreateColumn] = useState<CreateColumn>('auto')
  const [createForm, setCreateForm] = useState<CreateTaskForm>(defaultCreateForm)
  const [isSubmitting, setSubmitting] = useState(false)
  const [detailTaskId, setDetailTaskId] = useState('')
  const [detail, setDetail] = useState<HermesKanbanTaskDetailResponse | null>(null)
  const [detailState, setDetailState] = useState<LoadState>('idle')
  const [commentText, setCommentText] = useState('')
  const [statusAction, setStatusAction] = useState<StatusAction | null>(null)
  const [movingTaskId, setMovingTaskId] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<HermesKanbanTask | null>(null)
  const [deletingTaskId, setDeletingTaskId] = useState('')

  const loadKanban = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const [boardsPayload, nextBoard] = await Promise.all([
        listHermesKanbanBoards({ includeArchived: true, profile: selectedAgentName }),
        getHermesKanbanBoard({
          board: selectedBoard,
          includeArchived,
          profile: selectedAgentName,
          tenant: tenantFilter || undefined,
        }),
      ])
      setBoards(boardsPayload.boards?.length ? boardsPayload.boards : [{ name: 'Default', slug: defaultBoardSlug }])
      setBoardData(nextBoard)
      setVersion((value) => value + 1)
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hermes 看板加载失败')
      setState('error')
    }
  }, [includeArchived, selectedAgentName, selectedBoard, tenantFilter])

  useEffect(() => {
    void loadAgents()
  }, [loadAgents])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadKanban()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadKanban])

  const tasks = useMemo(() => flattenBoardTasks(boardData), [boardData])
  const filteredTasks = useMemo(() => filterKanbanTasks(tasks, query), [query, tasks])
  const stats = useMemo(() => getKanbanStats(tasks), [tasks])

  const openCreate = useCallback((column: CreateColumn = 'auto') => {
    setCreateColumn(column)
    setCreateForm({ ...defaultCreateForm, triage: column === 'auto' || column === 'triage' })
    setCreateOpen(true)
  }, [])

  const submitCreate = useCallback(async () => {
    const title = createForm.title.trim()
    if (!title) {
      toast.warning('任务标题不能为空')
      return
    }
    setSubmitting(true)
    try {
      const payload = buildCreatePayload(createForm, createColumn)
      await createHermesKanbanTask(payload, { board: selectedBoard, profile: selectedAgentName })
      toast.success('Kanban 任务已创建')
      setCreateOpen(false)
      setCreateForm(defaultCreateForm)
      await loadKanban()
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '任务创建失败')
    } finally {
      setSubmitting(false)
    }
  }, [createColumn, createForm, loadKanban, selectedAgentName, selectedBoard])

  const openDetail = useCallback(async (taskId: string) => {
    setDetailTaskId(taskId)
    setDetailState('loading')
    setDetail(null)
    try {
      const payload = await getHermesKanbanTask(taskId, { board: selectedBoard, profile: selectedAgentName })
      setDetail(payload)
      setDetailState('ready')
    } catch (err) {
      setDetailState('error')
      toast.warning(err instanceof Error ? err.message : '任务详情加载失败')
    }
  }, [selectedAgentName, selectedBoard])

  const closeDetail = useCallback(() => {
    setDetailTaskId('')
    setDetail(null)
    setCommentText('')
  }, [])

  const refreshDetail = useCallback(async () => {
    if (!detailTaskId) return
    const payload = await getHermesKanbanTask(detailTaskId, { board: selectedBoard, profile: selectedAgentName })
    setDetail(payload)
  }, [detailTaskId, selectedAgentName, selectedBoard])

  const moveTask = useCallback(async (task: HermesKanbanTask, status: HermesKanbanStatus) => {
    if (task.status === status || movingTaskId === task.id) return
    if (status === 'running') {
      toast.warning('执行中状态只能由调度器认领产生')
      void loadKanban()
      return
    }
    if (status === 'done') {
      setStatusAction({ blockReason: '', kind: 'done', summary: '', task })
      void loadKanban()
      return
    }
    if (status === 'blocked') {
      setStatusAction({ blockReason: '', kind: 'blocked', summary: '', task })
      void loadKanban()
      return
    }
    setMovingTaskId(task.id)
    try {
      await updateHermesKanbanTask(task.id, { status }, { board: selectedBoard, profile: selectedAgentName })
      toast.success(`${task.id} 已移动到 ${getStatusLabel(status)}`)
      await loadKanban()
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '任务状态更新失败')
      await loadKanban()
    } finally {
      setMovingTaskId('')
    }
  }, [loadKanban, movingTaskId, selectedAgentName, selectedBoard])

  const submitStatusAction = useCallback(async () => {
    if (!statusAction) return
    if (statusAction.kind === 'done' && !statusAction.summary.trim()) {
      toast.warning('完成任务前需要填写 summary')
      return
    }
    setSubmitting(true)
    try {
      if (statusAction.kind === 'done') {
        await updateHermesKanbanTask(statusAction.task.id, {
          result: statusAction.summary.trim(),
          status: 'done',
          summary: statusAction.summary.trim(),
        }, { board: selectedBoard, profile: selectedAgentName })
        toast.success('任务已完成')
      } else {
        await updateHermesKanbanTask(statusAction.task.id, {
          blockReason: statusAction.blockReason.trim() || undefined,
          status: 'blocked',
        }, { board: selectedBoard, profile: selectedAgentName })
        toast.warning('任务已标记为阻塞')
      }
      setStatusAction(null)
      await loadKanban()
      if (detailTaskId === statusAction.task.id) {
        await refreshDetail()
      }
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '任务状态更新失败')
    } finally {
      setSubmitting(false)
    }
  }, [detailTaskId, loadKanban, refreshDetail, selectedAgentName, selectedBoard, statusAction])

  const addComment = useCallback(async () => {
    if (!detailTaskId || !commentText.trim()) return
    setSubmitting(true)
    try {
      await addHermesKanbanComment(detailTaskId, { body: commentText.trim() }, { board: selectedBoard, profile: selectedAgentName })
      setCommentText('')
      toast.success('评论已添加')
      await refreshDetail()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '评论添加失败')
    } finally {
      setSubmitting(false)
    }
  }, [commentText, detailTaskId, refreshDetail, selectedAgentName, selectedBoard])

  const deleteTask = useCallback(async () => {
    if (!deleteTarget || deletingTaskId) return
    setDeletingTaskId(deleteTarget.id)
    try {
      await updateHermesKanbanTask(deleteTarget.id, { status: 'archived' }, { board: selectedBoard, profile: selectedAgentName })
      toast.success('任务已删除并移入归档')
      if (detailTaskId === deleteTarget.id) {
        closeDetail()
      }
      setDeleteTarget(null)
      await loadKanban()
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '任务删除失败')
    } finally {
      setDeletingTaskId('')
    }
  }, [closeDetail, deletingTaskId, deleteTarget, detailTaskId, loadKanban, selectedAgentName, selectedBoard])

  const runDispatch = useCallback(async () => {
    setSubmitting(true)
    try {
      const payload = await dispatchHermesKanban({ board: selectedBoard, max: 8, profile: selectedAgentName })
      toast.info(`调度器已执行：新认领 ${payload.spawned?.length ?? 0} 个，推进 ${payload.promoted ?? 0} 个`)
      await loadKanban()
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '调度器执行失败')
    } finally {
      setSubmitting(false)
    }
  }, [loadKanban, selectedAgentName, selectedBoard])

  const isLoading = state === 'loading' && !boardData
  const hasData = Boolean(boardData)
  const hasLoadError = Boolean(error && !boardData)

  return (
    <DashboardLayout>
      <div className={hasLoadError ? 'flex min-h-[calc(100dvh-8rem)] items-center justify-center' : 'mx-auto flex max-w-7xl flex-col gap-6'}>
        {hasLoadError ? (
          <HermesLoadErrorCard
            error={error}
            isRetrying={state === 'loading'}
            title="无法加载 Hermes 任务看板"
            onRetry={() => void loadKanban()}
          />
        ) : null}

        {!hasLoadError ? (
          <>
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(300px,0.65fr)]">
              <HermesKanbanHero
                onCreate={() => openCreate()}
                onDispatch={() => void runDispatch()}
              />
              <HermesKanbanStatusPieChart stats={stats} />
            </section>


            <div className="flex gap-3 justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <BoardSelect boards={boards} value={selectedBoard} onChange={setSelectedBoard} />
                <TenantSelect tenants={boardData?.tenants ?? []} value={tenantFilter} onChange={setTenantFilter} />
              </div>
              <div className="flex items-center gap-2">
                <SearchField variant="primary" className="sm:w-48" value={query} onChange={setQuery} aria-label="搜索任务">
                  <SearchField.Group>
                    <SearchField.SearchIcon />
                    <SearchField.Input placeholder="搜索..." />
                    <SearchField.ClearButton />
                  </SearchField.Group>
                </SearchField>
                <Tooltip delay={300}>
                  <Button
                    isIconOnly
                    aria-label={includeArchived ? '隐藏归档任务' : '显示归档任务'}
                    className={includeArchived ? 'bg-accent text-accent-foreground hover:bg-accent/90' : ''}
                    variant={includeArchived ? 'primary' : 'ghost'}
                    onPress={() => setIncludeArchived((value) => !value)}
                  >
                    <Icon icon="lucide:archive" className="size-4" />
                  </Button>
                  <Tooltip.Content>{includeArchived ? '隐藏归档任务' : '显示归档任务'}</Tooltip.Content>
                </Tooltip>
                <Button
                  isIconOnly
                  aria-label="刷新看板"
                  variant="ghost"
                  isDisabled={state === 'loading'}
                  onPress={() => void loadKanban()}
                >
                  <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : 'size-4'} />
                </Button>
              </div>
            </div>
            {error ? (
              <Card>
                <Card.Content>
                  <div className="flex items-start gap-3 text-warning">
                    <Icon icon="lucide:triangle-alert" className="mt-0.5 size-5" />
                    <div>
                      <p className="font-medium">看板加载失败</p>
                      <p className="mt-1 text-sm text-muted">{error}</p>
                    </div>
                  </div>
                </Card.Content>
              </Card>
            ) : null}

            {isLoading ? <KanbanSkeleton /> : null}
            {hasData ? (
              <HermesKanbanSurface
                key={`${selectedAgentName || 'default'}:${selectedBoard}:${includeArchived}:${tenantFilter}:${version}`}
                deletingTaskId={deletingTaskId}
                includeArchived={includeArchived}
                movingTaskId={movingTaskId}
                tasks={filteredTasks}
                onCreateInColumn={(column) => openCreate(column)}
                onDeleteTask={setDeleteTarget}
                onMoveTask={moveTask}
                onOpenTask={openDetail}
              />
            ) : null}

            <CreateTaskModal
              column={createColumn}
              form={createForm}
              isOpen={isCreateOpen}
              isSubmitting={isSubmitting}
              profiles={profiles}
              selectedAgentName={selectedAgentName}
              onColumnChange={setCreateColumn}
              onFormChange={setCreateForm}
              onOpenChange={setCreateOpen}
              onSubmit={submitCreate}
            />

            <TaskDetailModal
              commentText={commentText}
              detail={detail}
              isOpen={!!detailTaskId}
              isSubmitting={isSubmitting}
              state={detailState}
              onAddComment={addComment}
              onCommentChange={setCommentText}
              onOpenChange={(open) => !open && closeDetail()}
              onRefresh={() => void refreshDetail()}
              onRequestDelete={setDeleteTarget}
              onStatusAction={(task, kind) => setStatusAction({ blockReason: '', kind, summary: '', task })}
            />

            <DeleteTaskDialog
              isDeleting={Boolean(deletingTaskId)}
              task={deleteTarget}
              onConfirm={() => void deleteTask()}
              onOpenChange={(open) => !open && !deletingTaskId && setDeleteTarget(null)}
            />

            <StatusActionModal
              action={statusAction}
              isSubmitting={isSubmitting}
              onActionChange={setStatusAction}
              onOpenChange={(open) => !open && setStatusAction(null)}
              onSubmit={submitStatusAction}
            />
          </>
        ) : null}
      </div>
    </DashboardLayout>
  )
}

const kanbanGridStroke = 'rgba(247, 247, 247, 1)'

function KanbanHeroIllustration(props: Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'xmlns'>) {
  const { className, ...rest } = props
  const accentRing = 'color-mix(in oklch, var(--accent) 62%, white)'
  const accentSoft = 'color-mix(in oklch, var(--accent) 36%, white)'
  const accentStripe = 'var(--accent)'
  const accentStripeLight = 'color-mix(in oklch, var(--accent), white 26%)'
  const accentMuted = 'color-mix(in oklch, var(--accent) 72%, white)'
  const accentButton = 'color-mix(in oklch, var(--accent), white 28%)'

  const leadMaskId = 'hermesKanbanHeroLeadMask'

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="78 0 464 300"
      fill="none"
      className={className}
      aria-hidden
      {...rest}
    >
      <circle cx="400" cy="120" r="20" stroke={accentRing} strokeWidth={2} transform="rotate(180 380 100)" />
      <circle cx="480" cy="120" r="20" stroke={accentRing} strokeWidth={2} transform="rotate(180 460 100)" />
      <circle cx="440" cy="120" r="20" stroke={accentRing} strokeWidth={2} transform="rotate(180 420 100)" />
      <circle cx="520" cy="120" r="20" stroke={accentRing} strokeWidth={2} transform="rotate(180 500 100)" />
      <path stroke={kanbanGridStroke} strokeWidth={2} d="M400 1.06384V300" />
      <path stroke={kanbanGridStroke} strokeWidth={2} d="M360 0.491V300" />
      <path stroke={kanbanGridStroke} strokeWidth={2} d="M480 1.06384V300" />
      <path stroke={kanbanGridStroke} strokeWidth={2} d="M440 0.491V300" />
      <path stroke={kanbanGridStroke} strokeWidth={2} d="M120 0.491V300" />
      <path stroke={kanbanGridStroke} strokeWidth={2} d="M140 0.491V300" />
      <path stroke={kanbanGridStroke} strokeWidth={2} d="M114 80H530" />
      <path stroke={kanbanGridStroke} strokeWidth={2} d="M114 260H530" />
      <circle cx="370" cy="90" r="5" fill="#FFFFFF" transform="rotate(180 365 85)" />
      <circle cx="450" cy="90" r="5" fill="#FFFFFF" transform="rotate(180 445 85)" />
      <circle cx="410" cy="90" r="5" fill="#FFFFFF" transform="rotate(180 405 85)" />
      <circle cx="490" cy="90" r="5" fill="#FFFFFF" transform="rotate(180 485 85)" />
      <path fill="#EBECEC" fillRule="evenodd" d="M280 260 360 260 340 240 300 240 280 260z" />
      <path fill={accentSoft} d="M200 240 440 240 440 100 200 100 200 240z" />
      <path fill="#FFFFFF" d="M220 200 420 200 420 120 220 120 220 200z" />
      <circle cx="320" cy="220" r="10" fill={accentButton} />
      <rect width="200" height="20" x="0" y="0" fill="#F7F7F7" transform="matrix(-1 0 0 1 400 120)" />
      <rect width="200" height="10" x="0" y="0" fill="#181818" transform="matrix(-1 0 0 1 420 160)" />
      <rect width="100" height="20" x="0" y="0" fill="#EBECEC" transform="matrix(-1 0 0 1 400 120)" />
      <rect width="200" height="20" x="0" y="0" fill="#F7F7F7" transform="matrix(-1 0 0 1 340 60)" />
      <rect width="200" height="20" x="0" y="0" fill="#F7F7F7" transform="matrix(-1 0 0 1 280 0)" />
      <rect width="100" height="20" x="0" y="0" fill="#EBECEC" transform="matrix(-1 0 0 1 280 0)" />
      <rect width="100" height="20" x="0" y="0" fill="#EBECEC" transform="matrix(-1 0 0 1 240 60)" />
      <path
        fill="#C3C5C6"
        fillRule="evenodd"
        d="M180 100 310.313 100 310.313 120 200 120C200 108.95 191.05 100 180 100z"
      />
      <path
        fill="#C3C5C6"
        fillRule="evenodd"
        d="M148 40 320 40 320 60 161 60C161 48.95 155.18 40 148 40z"
      />
      <path
        fill="#F7F7F7"
        fillRule="evenodd"
        d="M120 40 220.302 40 220.302 60 140 60C140 48.95 131.05 40 120 40z"
      />
      <path
        fill="#F7F7F7"
        fillRule="evenodd"
        d="M280 100 379.947 100 379.947 120 300 120C300 108.95 291.05 100 280 100z"
      />
      <path
        fill="#F7F7F7"
        fillRule="evenodd"
        d="M359.505 100 237 100 237 80 340.303 80C340.303 90.7826 348.825 99.5656 359.505 99.9844 359.505 100z"
      />
      <path
        fill="#EBECEC"
        fillRule="evenodd"
        d="M419.505 160 297 160 297 140 400.303 140C400.303 150.783 408.825 159.566 419.505 159.984 419.505 160z"
      />
      <path
        fill="#F7F7F7"
        fillRule="evenodd"
        d="M300 40 99.9667 40 99.9667 20 280 20C280 31.05 288.95 40 300 40z"
      />
      <path fill="#C3C5C6" d="M320 60 320 40C331.046 40 340 48.9543 340 60 320 60z" />
      <path fill="#F7F7F7" d="M220 60 220 40C231.046 40 240 48.9543 240 60 220 60z" />
      <path fill="#F7F7F7" d="M380 120 380 100C391.046 100 400 108.954 400 120 380 120z" />
      <path fill="#F7F7F7" d="M100 20 100 40C88.9543 40 80 31.0457 80 20 100 20z" />
      <path
        fill="#EBECEC"
        fillRule="evenodd"
        d="M300 40 199.999 40 199.999 20 280 20C280 31.05 288.95 40 300 40z"
      />
      <path
        fill="#EBECEC"
        fillRule="evenodd"
        d="M260 100 160.011 100 160.011 80 240 80C240 91.05 248.95 100 260 100z"
      />
      <path
        fill="#F7F7F7"
        fillRule="evenodd"
        d="M320 160 220.011 160 220.011 140 300 140C300 151.05 308.95 160 320 160z"
      />
      <path fill="#EBECEC" d="M200 20 200 40C188.954 40 180 31.0457 180 20 200 20z" />
      <path fill="#EBECEC" d="M160 80 160 100C148.954 100 140 91.0457 140 80 160 80z" />
      <path fill="#F7F7F7" d="M220 140 220 160C208.954 160 200 151.046 200 140 220 140z" />
      <path fill={accentMuted} d="M120 120.477 129.722 103.317 139.722 120.638 120 120.477z" />
      <defs>
        <mask id={leadMaskId} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" style={{ maskType: 'alpha' }}>
          <path fill="#FFFFFF" d="M120 120.477 129.722 103.317 139.722 120.638 120 120.477z" />
        </mask>
      </defs>
      <g mask={`url(#${leadMaskId})`}>
        <path fill="#000000" d="M120 109.16 129.722 92 139.722 109.321 120 109.16z" />
      </g>
      <path fill={accentStripe} d="M120 220 130 220 130 120 120 120 120 220z" />
      <path fill={accentStripeLight} d="M130 220 140 220 140 120 130 120 130 220z" />
      <circle cx="130" cy="230" r="10" fill={accentSoft} />
      <path fill="#EBECEC" d="M120 220 140 220 140 210 120 210 120 220z" />
      <path fill={accentSoft} d="M120 230 140 230 140 220 120 220 120 230z" />
    </svg>
  )
}

function HermesKanbanHero({ onCreate, onDispatch }: { onCreate: () => void; onDispatch: () => void }) {
  return (
    <Card variant="transparent" className="overflow-visible">
      <Card.Content>
        <div className="flex flex-row items-center gap-4 md:gap-6">
          <div className="flex h-36 shrink-0 items-center justify-center overflow-visible rounded-2xl p-1 drop-shadow-[0_8px_14px_color-mix(in_oklch,var(--accent)_28%,transparent)]">
            <KanbanHeroIllustration className="h-full w-auto md:scale-105" />
          </div>
          <div className="flex min-w-0 flex-col gap-5 pl-2">
            <div className="min-w-0">
              <Card.Title className="text-2xl font-bold md:text-3xl">任务看板</Card.Title>
              <Card.Description className="mt-4 text-base md:text-lg">
                管理任务拆解、分派、阻塞和完成流转。
              </Card.Description>
            </div>
            <div className="flex flex-row items-center gap-3">
              <Button variant="primary" onPress={onCreate}>
                <Icon icon="lucide:plus" className="size-4" />
                新建任务
              </Button>
              <Tooltip delay={300}>
                <Button isIconOnly aria-label="执行调度器" variant="tertiary" onPress={onDispatch}>
                  <Icon icon="lucide:zap" className="size-4" />
                </Button>
                <Tooltip.Content>执行调度器</Tooltip.Content>
              </Tooltip>
            </div>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function HermesKanbanStatusPieChart({ stats }: { stats: ReturnType<typeof getKanbanStats> }) {
  const chartData = [
    { name: '等待处理', value: stats.waiting, fill: kanbanChartColors.waiting },
    { name: '准备执行', value: stats.ready, fill: kanbanChartColors.ready },
    { name: '执行中', value: stats.running, fill: kanbanChartColors.running },
    { name: '已阻塞', value: stats.blocked, fill: kanbanChartColors.blocked },
    { name: '已完成', value: stats.done, fill: kanbanChartColors.done },
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
            <KanbanLegendItem label="等待处理" value={stats.waiting} color={kanbanChartColors.waiting} />
            <KanbanLegendItem label="准备执行" value={stats.ready} color={kanbanChartColors.ready} />
            <KanbanLegendItem label="执行中" value={stats.running} color={kanbanChartColors.running} />
            <KanbanLegendItem label="已阻塞" value={stats.blocked} color={kanbanChartColors.blocked} />
            <KanbanLegendItem label="已完成" value={stats.done} color={kanbanChartColors.done} />
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function KanbanLegendItem({ color, label, value }: { color: string; label: string; value: number }) {
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

function HermesKanbanSurface({
  deletingTaskId,
  includeArchived,
  movingTaskId,
  onCreateInColumn,
  onDeleteTask,
  onMoveTask,
  onOpenTask,
  tasks,
}: {
  deletingTaskId: string
  includeArchived: boolean
  movingTaskId: string
  onCreateInColumn: (column: CreateColumn) => void
  onDeleteTask: (task: HermesKanbanTask) => void
  onMoveTask: (task: HermesKanbanTask, status: HermesKanbanStatus) => void
  onOpenTask: (taskId: string) => void
  tasks: HermesKanbanTask[]
}) {
  const kanban = useKanban<HermesKanbanTask>({
    getColumn: (item) => item.status,
    getKey: (item) => item.id,
    initialItems: tasks,
    setColumn: (item, column) => {
      const status = column as HermesKanbanStatus
      if (item.status !== status) {
        window.setTimeout(() => onMoveTask(item, status), 0)
      }
      return { ...item, status }
    },
  })
  const columns = includeArchived ? [...statusColumns, archivedColumn] : statusColumns

  return (
    <Kanban className="overflow-x-auto" size="md">
      {columns.map((column) => (
        <HermesKanbanColumn
          key={column.id}
          column={column}
          deletingTaskId={deletingTaskId}
          kanban={kanban}
          movingTaskId={movingTaskId}
          onCreate={() => onCreateInColumn(column.id === 'triage' || column.id === 'ready' ? column.id : 'auto')}
          onDeleteTask={onDeleteTask}
          onOpenTask={onOpenTask}
        />
      ))}
    </Kanban>
  )
}

function HermesKanbanColumn({
  column,
  deletingTaskId,
  kanban,
  movingTaskId,
  onCreate,
  onDeleteTask,
  onOpenTask,
}: {
  column: typeof statusColumns[number] | typeof archivedColumn
  deletingTaskId: string
  kanban: UseKanbanReturn<HermesKanbanTask>
  movingTaskId: string
  onCreate: () => void
  onDeleteTask: (task: HermesKanbanTask) => void
  onOpenTask: (taskId: string) => void
}) {
  const { dragAndDropHooks, items } = useKanbanColumn(kanban, column.id)
  return (
    <Kanban.Column>
      <Kanban.ColumnHeader>
        <Kanban.ColumnIndicator className={column.color} />
        <Icon icon={column.icon} className="size-4 text-muted" />
        <Kanban.ColumnTitle>{column.label}</Kanban.ColumnTitle>
        <Kanban.ColumnCount>{items.length}</Kanban.ColumnCount>
        <Kanban.ColumnActions className="opacity-100">
          <Tooltip delay={300}>
            <Button isIconOnly aria-label={`${column.label}说明`} size="sm" variant="ghost">
              <Icon icon="lucide:info" className="size-4" />
            </Button>
            <Tooltip.Content>{column.description}</Tooltip.Content>
          </Tooltip>
          <Button isIconOnly aria-label={`在 ${column.label} 创建任务`} size="sm" variant="ghost" onPress={onCreate}>
            <Icon icon="lucide:plus" className="size-4" />
          </Button>
        </Kanban.ColumnActions>
      </Kanban.ColumnHeader>
      <Kanban.ColumnBody>
        <Kanban.ScrollShadow className="max-h-[620px]">
          <Kanban.CardList aria-label={column.label} dragAndDropHooks={dragAndDropHooks} items={items} renderEmptyState={() => '暂无任务'}>
            {(task) => (
              <Kanban.Card key={task.id} textValue={`${task.id} ${task.title}`}>
                <HermesKanbanCard
                  isDeleting={deletingTaskId === task.id}
                  isMoving={movingTaskId === task.id}
                  task={task}
                  onDelete={() => onDeleteTask(task)}
                  onOpen={() => onOpenTask(task.id)}
                />
              </Kanban.Card>
            )}
          </Kanban.CardList>
        </Kanban.ScrollShadow>
      </Kanban.ColumnBody>
    </Kanban.Column>
  )
}

function HermesKanbanCard({
  isDeleting,
  isMoving,
  onDelete,
  onOpen,
  task,
}: {
  isDeleting: boolean
  isMoving: boolean
  onDelete: () => void
  onOpen: () => void
  task: HermesKanbanTask
}) {
  const summary = task.latestSummary || task.latest_summary || task.result || task.body || ''
  const comments = task.commentCount ?? task.comment_count ?? 0
  const links = task.linkCounts ?? task.link_counts
  const failures = task.consecutiveFailures ?? task.consecutive_failures ?? 0
  const isArchived = task.status === 'archived'
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <button type="button" className="block max-w-full text-left text-sm font-medium text-foreground hover:text-accent" onClick={onOpen}>
            <span className="line-clamp-2">{task.title}</span>
          </button>
          <p className="mt-1 font-mono text-xs text-muted">{task.id}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip delay={300}>
            <Button isIconOnly aria-label="查看任务详情" size="sm" variant="ghost" onPress={onOpen}>
              <Icon icon="lucide:panel-top-open" className="size-4" />
            </Button>
            <Tooltip.Content>查看详情</Tooltip.Content>
          </Tooltip>
          <Dropdown>
            <Button isIconOnly aria-label="任务设置" size="sm" variant="ghost">
              <Icon icon="lucide:settings" className="size-4" />
            </Button>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu
                onAction={(key) => {
                  if (key === 'open') onOpen()
                  if (key === 'delete' && !isArchived) onDelete()
                }}
              >
                <Dropdown.Item id="open" textValue="查看详情">
                  <div className="flex h-8 items-start justify-center pt-px">
                    <Icon icon="lucide:panel-top-open" className="size-4 shrink-0 text-muted" />
                  </div>
                  <div className="flex flex-col">
                    <Label>查看详情</Label>
                    <Description>打开任务详情弹窗</Description>
                  </div>
                </Dropdown.Item>
                <Dropdown.Item id="delete" textValue="删除任务" variant="danger" isDisabled={isArchived}>
                  <div className="flex h-8 items-start justify-center pt-px">
                    <Icon icon="lucide:trash-2" className="size-4 shrink-0 text-danger" />
                  </div>
                  <div className="flex flex-col">
                    <Label>{isArchived ? '已归档' : '删除任务'}</Label>
                    <Description>{isArchived ? '任务已在归档列中' : '移入归档列'}</Description>
                  </div>
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
          <Kanban.DragHandle />
        </div>
      </div>
      {summary ? <p className="line-clamp-3 text-xs leading-5 text-muted">{summary}</p> : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip size="sm" variant="soft">P{task.priority ?? 0}</Chip>
        {task.assignee ? <Chip size="sm" variant="soft">{task.assignee}</Chip> : <Chip size="sm" variant="soft">未分配</Chip>}
        {task.tenant ? <Chip size="sm" variant="soft">{task.tenant}</Chip> : null}
        {comments > 0 ? <Chip size="sm" variant="soft">{comments} 评论</Chip> : null}
        {links && (links.parents > 0 || links.children > 0) ? <Chip size="sm" variant="soft">{links.parents}/{links.children} 依赖</Chip> : null}
        {failures > 0 ? <Chip color="danger" size="sm" variant="soft">{failures} 失败</Chip> : null}
        {isMoving ? <Chip color="accent" size="sm" variant="soft">同步中</Chip> : null}
        {isDeleting ? <Chip color="danger" size="sm" variant="soft">删除中</Chip> : null}
      </div>
    </div>
  )
}

function BoardSelect({ boards, onChange, value }: { boards: HermesKanbanBoardMeta[]; onChange: (value: string) => void; value: string }) {
  const items = boards.length ? boards : [{ name: 'Default', slug: defaultBoardSlug }]
  const selectedBoard = items.find((board) => board.slug === value) ?? items[0]

  return (
    <Dropdown>
      <Button variant="tertiary" className="min-w-0 rounded-full pl-1 pr-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Icon icon="lucide:kanban-square" className="size-3.5" />
        </span>
        <span className="min-w-0 max-w-44 truncate text-sm font-semibold text-foreground">{selectedBoard?.name || selectedBoard?.slug || '选择 Board'}</span>
        <Icon icon="lucide:chevron-down" className="size-4 text-muted" />
      </Button>
      <Dropdown.Popover placement="bottom start">
        <Dropdown.Menu selectedKeys={new Set(value ? [value] : [])} selectionMode="single" onAction={(key) => onChange(String(key || defaultBoardSlug))}>
          {items.map((board) => (
            <Dropdown.Item key={board.slug} id={board.slug} textValue={board.name || board.slug}>
              <Dropdown.ItemIndicator type="dot" />
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground ring-2 ring-accent/30">
                  <Icon icon="lucide:kanban-square" className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <Label className="truncate">{board.name || board.slug}</Label>
                  <p className="mt-1 truncate font-mono text-xs text-muted">{board.slug} · {board.total ?? 0} tasks</p>
                </div>
              </div>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function TenantSelect({ onChange, tenants, value }: { onChange: (value: string) => void; tenants: string[]; value: string }) {
  const allTenantsKey = '__all__'
  const items = [{ id: allTenantsKey, label: '全部租户' }, ...tenants.map((tenant) => ({ id: tenant, label: tenant }))]
  const selectedTenant = items.find((item) => item.id === (value || allTenantsKey)) ?? items[0]

  return (
    <Dropdown>
      <Button variant="tertiary" className="min-w-0 rounded-full pl-1 pr-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-muted">
          <Icon icon="lucide:building-2" className="size-3.5" />
        </span>
        <span className="min-w-0 max-w-36 truncate text-sm font-semibold text-foreground">{selectedTenant.label}</span>
        <Icon icon="lucide:chevron-down" className="size-4 text-muted" />
      </Button>
      <Dropdown.Popover placement="bottom start">
        <Dropdown.Menu selectedKeys={new Set([value || allTenantsKey])} selectionMode="single" onAction={(key) => onChange(String(key ?? allTenantsKey) === allTenantsKey ? '' : String(key))}>
          {items.map((item) => (
            <Dropdown.Item key={item.id} id={item.id} textValue={item.label}>
              <Dropdown.ItemIndicator type="dot" />
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-muted ring-2 ring-muted/30">
                  <Icon icon={item.id === allTenantsKey ? 'lucide:layers-3' : 'lucide:building-2'} className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <Label className="truncate">{item.label}</Label>
                  <p className="mt-1 truncate text-xs text-muted">{item.id === allTenantsKey ? '跨租户汇总' : '租户筛选'}</p>
                </div>
              </div>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function AssigneeProfileDropdown({
  currentName,
  profiles,
  selectedName,
  onSelect,
}: {
  currentName: string
  profiles: HermesAgentInfo[]
  selectedName: string
  onSelect: (name: string) => void
}) {
  const fallbackProfile = profiles.find((profile) => profile.name === currentName) ?? profiles[0]
  const selectedProfile = profiles.find((profile) => profile.name === selectedName) ?? fallbackProfile
  if (!selectedProfile) return null

  return (
    <Dropdown>
      <Button variant="tertiary" className="min-w-0 rounded-full pl-1 pr-2">
        <ProfileAvatar profile={selectedProfile} size="sm" />
        <span className="min-w-0 max-w-44 truncate text-sm font-semibold text-foreground">{selectedProfile.displayName || selectedProfile.name}</span>
        <Icon icon="lucide:chevron-down" className="size-4 text-muted" />
      </Button>
      <Dropdown.Popover placement="bottom start">
        <Dropdown.Menu selectedKeys={new Set(selectedProfile.name ? [selectedProfile.name] : [])} selectionMode="single" onAction={(key) => onSelect(String(key))}>
          {profiles.map((profile) => (
            <Dropdown.Item key={profile.name} id={profile.name} textValue={profile.name}>
              <Dropdown.ItemIndicator type="dot" />
              <div className="flex min-w-0 items-center gap-3">
                <ProfileAvatar profile={profile} />
                <div className="min-w-0 flex-1">
                  <Label className="truncate">{profile.displayName || profile.name}</Label>
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

function CreateTaskModal({
  column,
  form,
  isOpen,
  isSubmitting,
  profiles,
  selectedAgentName,
  onColumnChange,
  onFormChange,
  onOpenChange,
  onSubmit,
}: {
  column: CreateColumn
  form: CreateTaskForm
  isOpen: boolean
  isSubmitting: boolean
  profiles: HermesAgentInfo[]
  selectedAgentName: string
  onColumnChange: (column: CreateColumn) => void
  onFormChange: (form: CreateTaskForm) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
}) {
  const update = (patch: Partial<CreateTaskForm>) => onFormChange({ ...form, ...patch })
  const [activeSection, setActiveSection] = useState<CreateSection>('basis')
  const createPayloadText = JSON.stringify(buildCreatePayload(form, column), null, 2)
  const assigneeName = form.assignee || selectedAgentName || profiles[0]?.name || ''

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={(open) => {
        onOpenChange(open)
        if (!open) setActiveSection('basis')
      }}
      variant="opaque"
    >
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="sm:max-w-[720px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
              <Icon icon="lucide:square-pen" className="size-5" />
            </Modal.Icon>
            <div>
              <Modal.Heading>创建任务</Modal.Heading>
              <p className="mt-1 text-sm text-muted">新任务会写入当前 Hermes 看板。</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="space-y-5">
              <Segment selectedKey={activeSection} onSelectionChange={(key) => setActiveSection(String(key) as CreateSection)}>
                {createSectionTabs.map((tab) => (
                  <Segment.Item key={tab.id} id={tab.id}>
                    <Segment.Separator />
                    {tab.label}
                  </Segment.Item>
                ))}
              </Segment>
              <div className="max-h-[500px] overflow-auto">
                {activeSection === 'basis' ? (
                  <div className="space-y-5">
                    <ItemCardGroup className="overflow-hidden">
                      <ItemCardGroup.Header>
                        <ItemCardGroup.Title>基础信息</ItemCardGroup.Title>
                        <ItemCardGroup.Description>给任务一个清晰标题，并决定它最初进入哪个状态。</ItemCardGroup.Description>
                      </ItemCardGroup.Header>
                      <FormItem description="标题会显示在看板卡片和详情页。" icon="lucide:tag" title="任务标题">
                        <Input fullWidth variant="secondary" value={form.title} placeholder="让 Agent 完成什么任务？" onChange={(event) => update({ title: event.target.value })} />
                      </FormItem>
                      <Separator />
                      <FormItem description="默认留空则交给当前 Agent 处理。" icon="lucide:user-round" title="负责人">
                        <AssigneeProfileDropdown
                          currentName={selectedAgentName}
                          profiles={profiles}
                          selectedName={assigneeName}
                          onSelect={(name) => update({ assignee: name === selectedAgentName ? '' : name })}
                        />
                      </FormItem>
                      <Separator />
                      <FormItem description="任务所属租户或业务域。" icon="lucide:building-2" title="租户">
                        <Input fullWidth variant="secondary" value={form.tenant} placeholder="可选" onChange={(event) => update({ tenant: event.target.value })} />
                      </FormItem>
                      <Separator />
                      <FormItem actionClassName="w-fit" description="越高越优先。" icon="lucide:flag" title="优先级">
                        <Input className="w-24" fullWidth={false} inputMode="numeric" variant="secondary" value={form.priority} placeholder="0" onChange={(event) => update({ priority: event.target.value })} />
                      </FormItem>
                    </ItemCardGroup>
                    <Card>
                      <Card.Header>
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-secondary/50 text-muted">
                            <Icon icon="lucide:file-text" className="size-5" />
                          </div>
                          <div className="min-w-0">
                            <Card.Title>任务说明</Card.Title>
                            <Card.Description>说明背景、目标和验收标准。</Card.Description>
                          </div>
                        </div>
                      </Card.Header>
                      <Card.Content>
                        <textarea
                          className="min-h-28 w-full rounded-2xl border border-divider bg-surface-secondary/50 px-4 py-3 text-sm text-foreground outline-none"
                          placeholder="背景、验收标准、约束条件"
                          value={form.body}
                          onChange={(event) => update({ body: event.target.value })}
                        />
                      </Card.Content>
                    </Card>
                    <ItemCardGroup className="overflow-hidden">
                      <ItemCardGroup.Header>
                        <ItemCardGroup.Title>入口状态</ItemCardGroup.Title>
                        <ItemCardGroup.Description>决定新任务是先进入待整理，还是直接进入准备执行。</ItemCardGroup.Description>
                      </ItemCardGroup.Header>
                      <FormItem actionClassName="w-auto min-w-0" description="选择新任务的初始状态。" icon="lucide:arrow-right" title="任务创建入口">
                        <Segment selectedKey={column} onSelectionChange={(key) => onColumnChange(String(key) as CreateColumn)}>
                          {createColumnOptions.map((option) => (
                            <Segment.Item key={option.id} id={option.id}>
                              <Segment.Separator />
                              {option.label}
                            </Segment.Item>
                          ))}
                        </Segment>
                      </FormItem>
                    </ItemCardGroup>
                  </div>
                ) : null}
                {activeSection === 'execution' ? (
                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>执行参数</ItemCardGroup.Title>
                      <ItemCardGroup.Description>这些字段会直接影响 worker 如何运行这个任务。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem description="父任务用于表达依赖关系。" icon="lucide:git-branch" title="父任务">
                      <Input fullWidth variant="secondary" value={form.parents} placeholder="t_xxx, t_yyy" onChange={(event) => update({ parents: event.target.value })} />
                    </FormItem>
                    <Separator />
                    <FormItem description="用于选择执行这个任务时可用的技能。" icon="lucide:sparkles" title="技能">
                      <Input fullWidth variant="secondary" value={form.skills} placeholder="kanban-worker, ..." onChange={(event) => update({ skills: event.target.value })} />
                    </FormItem>
                    <Separator />
                    <FormItem description="只在需要限制运行时间时填写。" icon="lucide:timer" title="运行上限秒数">
                      <Input fullWidth variant="secondary" inputMode="numeric" value={form.maxRuntimeSeconds} placeholder="可选" onChange={(event) => update({ maxRuntimeSeconds: event.target.value })} />
                    </FormItem>
                    <Separator />
                    <FormItem description="指定目录或工作树模式下可填写路径。" icon="lucide:folder" title="工作区路径">
                      <Input fullWidth variant="secondary" value={form.workspacePath} placeholder="可选路径" onChange={(event) => update({ workspacePath: event.target.value })} />
                    </FormItem>
                    <Separator />
                    <FormItem description="选择临时空间、指定目录或隔离工作树。" icon="lucide:folder-cog" title="工作区类型">
                      <CellSelect aria-label="工作区类型" selectedKey={form.workspaceKind} variant="secondary" onChange={(key) => update({ workspaceKind: String(key || 'scratch') })}>
                        <CellSelect.Trigger>
                          <CellSelect.Value />
                          <CellSelect.Indicator />
                        </CellSelect.Trigger>
                        <CellSelect.Popover>
                          <ListBox>
                            <ListBox.Item id="scratch" textValue="临时空间">临时空间</ListBox.Item>
                            <ListBox.Item id="dir" textValue="指定目录">指定目录</ListBox.Item>
                            <ListBox.Item id="worktree" textValue="隔离工作树">隔离工作树</ListBox.Item>
                          </ListBox>
                        </CellSelect.Popover>
                      </CellSelect>
                    </FormItem>
                    <Separator />
                    <FormItem description="为空时使用全局默认值。" icon="lucide:rotate-ccw" title="最大重试">
                      <Input className="w-24" fullWidth={false} inputMode="numeric" variant="secondary" value={form.maxRetries} placeholder="全局默认" onChange={(event) => update({ maxRetries: event.target.value })} />
                    </FormItem>
                  </ItemCardGroup>
                ) : null}
                {activeSection === 'preview' ? (
                  <Card>
                    <Card.Header className="items-start justify-between gap-4">
                      <div>
                        <Card.Title>提交预览</Card.Title>
                        <Card.Description>提交前最后确认任务内容。</Card.Description>
                      </div>
                    </Card.Header>
                    <Card.Content>
                      <pre className="max-h-[440px] overflow-auto rounded-2xl bg-surface-secondary/50 p-4 text-xs leading-5 text-foreground">{createPayloadText}</pre>
                    </Card.Content>
                  </Card>
                ) : null}
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={() => onOpenChange(false)}>取消</Button>
            <Button isDisabled={isSubmitting} onPress={onSubmit}>创建任务</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function TaskDetailModal({
  commentText,
  detail,
  isOpen,
  isSubmitting,
  onAddComment,
  onCommentChange,
  onOpenChange,
  onRefresh,
  onRequestDelete,
  onStatusAction,
  state,
}: {
  commentText: string
  detail: HermesKanbanTaskDetailResponse | null
  isOpen: boolean
  isSubmitting: boolean
  onAddComment: () => void
  onCommentChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onRefresh: () => void
  onRequestDelete: (task: HermesKanbanTask) => void
  onStatusAction: (task: HermesKanbanTask, kind: 'blocked' | 'done') => void
  state: LoadState
}) {
  const task = detail?.task
  const [activeSection, setActiveSection] = useState<DetailSection>('overview')

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={(open) => {
        onOpenChange(open)
        if (!open) setActiveSection('overview')
      }}
      variant="opaque"
    >
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="sm:max-w-[860px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
              <Icon icon="lucide:list-checks" className="size-5" />
            </Modal.Icon>
            <div className="min-w-0">
              <Modal.Heading>{task?.title || '任务详情'}</Modal.Heading>
              <p className="mt-1 truncate text-sm text-muted">{task ? `${task.id} · ${getStatusLabel(task.status)}` : '加载当前任务的上下文、动态和运行记录。'}</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            {state === 'loading' ? <Skeleton className="h-80 rounded-2xl" /> : null}
            {state === 'error' ? (
              <Card className="bg-danger/10 text-danger">
                <Card.Content>
                  <div className="flex items-start gap-3">
                    <Icon icon="lucide:circle-alert" className="mt-0.5 size-5" />
                    <div>
                      <p className="font-medium">任务详情加载失败</p>
                      <p className="mt-1 text-sm text-muted">请刷新详情或稍后重试。</p>
                    </div>
                  </div>
                </Card.Content>
              </Card>
            ) : null}
            {task ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip variant="soft">{getStatusLabel(task.status)}</Chip>
                  <Chip variant="soft">P{task.priority}</Chip>
                  {task.assignee ? <Chip variant="soft">{task.assignee}</Chip> : <Chip variant="soft">未分配</Chip>}
                  {task.tenant ? <Chip variant="soft">{task.tenant}</Chip> : null}
                </div>
                <Segment selectedKey={activeSection} onSelectionChange={(key) => setActiveSection(String(key) as DetailSection)}>
                  {detailSectionTabs.map((tab) => (
                    <Segment.Item key={tab.id} id={tab.id}>
                      <Segment.Separator />
                      {tab.label}
                    </Segment.Item>
                  ))}
                </Segment>
                <div className="max-h-[560px] overflow-auto">
                  {activeSection === 'overview' ? (
                    <div className="space-y-5">
                      <ItemCardGroup className="overflow-hidden">
                        <ItemCardGroup.Header>
                          <ItemCardGroup.Title>任务概览</ItemCardGroup.Title>
                          <ItemCardGroup.Description>任务本体信息和当前状态。</ItemCardGroup.Description>
                        </ItemCardGroup.Header>
                        <ItemCard>
                          <ItemCard.Content>
                            <p className="whitespace-pre-wrap text-sm leading-6 text-muted">{task.body || '无说明'}</p>
                          </ItemCard.Content>
                        </ItemCard>
                        <Separator />
                        <ItemCard>
                          <ItemCard.Content>
                            <p className="whitespace-pre-wrap text-sm leading-6 text-muted">{task.latestSummary || task.latest_summary || task.result || '暂无结果'}</p>
                          </ItemCard.Content>
                        </ItemCard>
                      </ItemCardGroup>
                      <ItemCardGroup className="overflow-hidden">
                        <ItemCardGroup.Header>
                          <ItemCardGroup.Title>运行信息</ItemCardGroup.Title>
                          <ItemCardGroup.Description>依赖、运行和错误情况。</ItemCardGroup.Description>
                        </ItemCardGroup.Header>
                        <ItemCard>
                          <ItemCard.Content>
                            <div className="grid gap-4 md:grid-cols-2">
                              <InfoList title="依赖" items={[`父任务：${detail?.links.parents.join(', ') || '-'}`, `子任务：${detail?.links.children.join(', ') || '-'}`]} />
                              <InfoList title="运行信息" items={[`运行次数：${detail?.runs.length ?? 0}`, `当前运行：${task.currentRunId ?? task.current_run_id ?? '-'}`, `连续失败：${task.consecutiveFailures ?? task.consecutive_failures ?? 0}`]} />
                            </div>
                          </ItemCard.Content>
                        </ItemCard>
                      </ItemCardGroup>
                    </div>
                  ) : null}
                  {activeSection === 'activity' ? (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <Timeline title="事件" items={(detail?.events ?? []).map((event) => ({
                        body: formatPayload(event.payload),
                        label: event.kind,
                        time: formatEpoch(event.createdAt ?? event.created_at),
                      }))} />
                      <Timeline title="评论" items={(detail?.comments ?? []).map((comment) => ({
                        body: comment.body,
                        label: comment.author,
                        time: formatEpoch(comment.createdAt ?? comment.created_at),
                      }))} />
                    </div>
                  ) : null}
                  {activeSection === 'runs' ? (
                    <ItemCardGroup className="overflow-hidden">
                      <ItemCardGroup.Header>
                        <ItemCardGroup.Title>运行历史</ItemCardGroup.Title>
                        <ItemCardGroup.Description>最近的 run 和结果。</ItemCardGroup.Description>
                      </ItemCardGroup.Header>
                      <ItemCard>
                        <ItemCard.Content>
                          <div className="space-y-3">
                            {(detail?.runs ?? []).length ? (detail?.runs ?? []).map((run) => (
                              <div key={run.id} className="rounded-2xl bg-surface-secondary/50 px-4 py-3">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-sm font-medium text-foreground">{run.status}</p>
                                  <p className="text-xs text-muted">{formatEpoch(run.startedAt ?? run.started_at)}</p>
                                </div>
                                {run.summary ? <p className="mt-2 text-xs leading-5 text-muted">{run.summary}</p> : null}
                              </div>
                            )) : <p className="text-sm text-muted">暂无运行记录</p>}
                          </div>
                        </ItemCard.Content>
                      </ItemCard>
                    </ItemCardGroup>
                  ) : null}
                  <Card className='mt-4'>
                    <Card.Header>
                      <div className="flex items-center justify-between gap-2 w-full">
                        <div className="flex items-center gap-2">
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-secondary/50 text-muted">
                            <Icon icon="lucide:message-square-plus" className="size-5" />
                          </div>
                          <div className="min-w-0">
                            <Card.Title>添加评论</Card.Title>
                            <Card.Description>写入任务动态，记录补充说明或处理进展。</Card.Description>
                          </div>
                        </div>
                        <Button size="sm" variant="primary" isDisabled={isSubmitting || !commentText.trim()} onPress={onAddComment}>添加评论</Button>
                      </div>
                    </Card.Header>
                    <Card.Content>
                      <textarea
                        className="min-h-28 w-full resize-y rounded-2xl border border-divider bg-surface-secondary/50 px-4 py-3 text-sm text-foreground outline-none transition focus:border-accent"
                        placeholder="写入任务评论"
                        value={commentText}
                        onChange={(event) => onCommentChange(event.target.value)}
                      />
                    </Card.Content>
                  </Card>
                </div>
              </div>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <div className="flex items-center justify-between gap-2 w-full">
              <div className="flex items-center gap-2">
                <Button isIconOnly variant="tertiary" onPress={onRefresh} isDisabled={state === 'loading'}>
                  <Icon icon="lucide:refresh-cw" className="size-4" />
                </Button>
                <Button variant="tertiary" onPress={() => onOpenChange(false)}>关闭</Button>
                {task && task.status !== 'archived' ? (
                  <Button variant="danger" onPress={() => onRequestDelete(task)} isDisabled={isSubmitting}>
                    <Icon icon="lucide:trash-2" className="size-4" />
                    删除任务
                  </Button>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {task && task.status !== 'done' && task.status !== 'archived' ? <Button variant="tertiary" onPress={() => onStatusAction(task, 'blocked')}>标记阻塞</Button> : null}
                {task && task.status !== 'done' && task.status !== 'archived' ? <Button onPress={() => onStatusAction(task, 'done')}>标记完成</Button> : null}
              </div>
            </div>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function DeleteTaskDialog({
  isDeleting,
  onConfirm,
  onOpenChange,
  task,
}: {
  isDeleting: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  task: HermesKanbanTask | null
}) {
  return (
    <AlertDialog.Backdrop isOpen={Boolean(task)} onOpenChange={onOpenChange}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[460px]">
          <AlertDialog.CloseTrigger />
          <AlertDialog.Header>
            <AlertDialog.Icon status="danger" />
            <AlertDialog.Heading>删除任务？</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <div className="space-y-3">
              <p className="text-sm leading-6 text-muted">
                删除后任务会移入归档列，不再出现在默认看板中。需要查看时可以打开“显示归档任务”。
              </p>
              {task ? (
                <div className="rounded-2xl bg-surface-secondary/60 p-3">
                  <p className="line-clamp-2 text-sm font-medium text-foreground">{task.title}</p>
                  <p className="mt-1 font-mono text-xs text-muted">{task.id}</p>
                </div>
              ) : null}
            </div>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button variant="tertiary" onPress={() => onOpenChange(false)} isDisabled={isDeleting}>取消</Button>
            <Button variant="danger" onPress={onConfirm} isDisabled={isDeleting || !task}>
              <Icon icon={isDeleting ? 'lucide:loader-circle' : 'lucide:trash-2'} className={isDeleting ? 'animate-spin' : 'size-4'} />
              删除任务
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}

function StatusActionModal({
  action,
  isSubmitting,
  onActionChange,
  onOpenChange,
  onSubmit,
}: {
  action: StatusAction | null
  isSubmitting: boolean
  onActionChange: (action: StatusAction | null) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
}) {
  const isDone = action?.kind === 'done'
  return (
    <Modal.Backdrop isOpen={!!action} onOpenChange={onOpenChange}>
      <Modal.Container size="md">
        <Modal.Dialog className="sm:max-w-[520px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className={isDone ? 'bg-success text-success-foreground' : 'bg-warning text-warning-foreground'}>
              <Icon icon={isDone ? 'lucide:circle-check' : 'lucide:octagon-alert'} className="size-5" />
            </Modal.Icon>
            <div>
              <Modal.Heading>{isDone ? '完成任务' : '标记阻塞'}</Modal.Heading>
              <p className="mt-1 text-sm text-muted">{action?.task.id}</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            {action ? (
              <ItemCardGroup className="overflow-hidden">
                <ItemCardGroup.Header>
                  <ItemCardGroup.Title>{isDone ? '完成摘要' : '阻塞原因'}</ItemCardGroup.Title>
                  <ItemCardGroup.Description>{isDone ? '写清完成内容、修改点和验证结果。' : '说明为什么需要人工介入。'}</ItemCardGroup.Description>
                </ItemCardGroup.Header>
                <ItemCard>
                  <ItemCard.Content>
                    <textarea
                      className="min-h-32 w-full resize-y rounded-2xl border border-divider bg-surface-secondary/50 px-4 py-3 text-sm text-foreground outline-none"
                      placeholder={isDone ? '说明完成内容、修改点和验证结果' : '说明需要人工补充什么信息'}
                      value={isDone ? action.summary : action.blockReason}
                      onChange={(event) => onActionChange(isDone ? { ...action, summary: event.target.value } : { ...action, blockReason: event.target.value })}
                    />
                  </ItemCard.Content>
                </ItemCard>
              </ItemCardGroup>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={() => onOpenChange(false)}>取消</Button>
            <Button isDisabled={isSubmitting} onPress={onSubmit}>{isDone ? '确认完成' : '确认阻塞'}</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function InfoList({ items, title }: { items: string[]; title: string }) {
  return (
    <div className="rounded-2xl bg-surface-secondary/50 p-4">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <div className="mt-2 space-y-1">
        {items.map((item) => <p key={item} className="text-xs text-muted">{item}</p>)}
      </div>
    </div>
  )
}

function Timeline({ items, title }: { items: Array<{ body: string; label: string; time: string }>; title: string }) {
  return (
    <Card>
      <Card.Header>
        <Card.Title>{title}</Card.Title>
      </Card.Header>
      <Card.Content>
        <div className="max-h-72 space-y-2 overflow-y-auto rounded-2xl bg-surface-secondary/50 p-4">
          {items.length ? items.map((item, index) => (
            <div key={`${item.label}-${item.time}-${index}`} className="border-b border-divider pb-2 last:border-b-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-foreground">{item.label}</p>
                <p className="text-xs text-muted">{item.time}</p>
              </div>
              {item.body ? <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted">{item.body}</p> : null}
            </div>
          )) : <p className="text-sm text-muted">暂无记录</p>}
        </div>
      </Card.Content>
    </Card>
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

function KanbanSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-80 rounded-lg" />)}
    </div>
  )
}

function flattenBoardTasks(data: HermesKanbanBoardResponse | null) {
  return data?.columns.flatMap((column) => column.tasks ?? []) ?? []
}

function filterKanbanTasks(tasks: HermesKanbanTask[], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return tasks
  return tasks.filter((task) => {
    const haystack = [
      task.id,
      task.title,
      task.body,
      task.result,
      task.latestSummary,
      task.latest_summary,
      task.assignee,
      task.tenant,
    ].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(needle)
  })
}

function getKanbanStats(tasks: HermesKanbanTask[]) {
  return {
    blocked: tasks.filter((task) => task.status === 'blocked').length,
    done: tasks.filter((task) => task.status === 'done').length,
    ready: tasks.filter((task) => task.status === 'ready').length,
    running: tasks.filter((task) => task.status === 'running').length,
    total: tasks.length,
    waiting: tasks.filter((task) => task.status === 'todo' || task.status === 'triage').length,
  }
}

function buildCreatePayload(form: CreateTaskForm, column: CreateColumn): HermesKanbanTaskCreate {
  const priority = Number.parseInt(form.priority, 10)
  const maxRuntimeSeconds = Number.parseInt(form.maxRuntimeSeconds, 10)
  const maxRetries = Number.parseInt(form.maxRetries, 10)
  return {
    assignee: cleanOptional(form.assignee),
    body: cleanOptional(form.body),
    maxRetries: Number.isFinite(maxRetries) ? maxRetries : undefined,
    maxRuntimeSeconds: Number.isFinite(maxRuntimeSeconds) ? maxRuntimeSeconds : undefined,
    parents: splitList(form.parents),
    priority: Number.isFinite(priority) ? priority : 0,
    skills: splitList(form.skills),
    tenant: cleanOptional(form.tenant),
    title: form.title.trim(),
    triage: column === 'triage' || (column === 'auto' && form.triage),
    workspaceKind: form.workspaceKind || 'scratch',
    workspacePath: cleanOptional(form.workspacePath),
  }
}

function splitList(value: string) {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
}

function cleanOptional(value: string) {
  return value.trim() || undefined
}

function getStatusLabel(status: HermesKanbanStatus) {
  return statusColumns.find((column) => column.id === status)?.label ?? (status === 'archived' ? '已归档' : status)
}

function formatEpoch(value?: number | null) {
  if (!value) return '-'
  return new Date(value * 1000).toLocaleString()
}

function formatPayload(value?: Record<string, unknown> | null) {
  if (!value) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default HermesKanbanPage
