import { type SVGProps, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, AlertDialog, Button, Card, Chip, Dropdown, Label, Modal, SearchField, Skeleton, Table, toast } from '@heroui/react'
import { Icon } from '@iconify/react'
import type { HermesAgentInfo, HermesManagedSession, HermesSessionDetailResponse, HermesSessionMessage, HermesSessionsResponse } from '@/api'
import { createHermesTerminal, deleteHermesSessions, endHermesSession, getHermesSession, listHermesSessions } from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { useHermesAgentStore } from '@/stores/hermes-agent'
import { HermesLoadErrorCard } from '../hermes-shared/HermesLoadErrorCard'

type SessionStatusFilter = 'all' | 'active' | 'ended'
type SortKey = 'lastActive' | 'startedAt' | 'messages' | 'tokens' | 'cost'
type SessionProfileOption = Pick<HermesAgentInfo, 'displayName' | 'gatewayRunning' | 'isDefault' | 'model' | 'name' | 'path'>

const numberFormatter = new Intl.NumberFormat('zh-CN')
const currencyFormatter = new Intl.NumberFormat('zh-CN', { currency: 'USD', maximumFractionDigits: 4, style: 'currency' })
const allProfilesKey = 'all'

function HermesSessionsPage() {
  usePageTitle('会话管理')
  const navigate = useNavigate()
  const profiles = useHermesAgentStore((store) => store.profiles)
  const loadAgents = useHermesAgentStore((store) => store.loadAgents)
  const selectAgent = useHermesAgentStore((store) => store.selectAgent)

  const [data, setData] = useState<HermesSessionsResponse | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [profileFilter, setProfileFilter] = useState(allProfilesKey)
  const [statusFilter, setStatusFilter] = useState<SessionStatusFilter>('all')
  const [sortBy, setSortBy] = useState<SortKey>('lastActive')
  const [includeChildren, setIncludeChildren] = useState(false)
  const [reviewTarget, setReviewTarget] = useState<HermesManagedSession | null>(null)
  const [detail, setDetail] = useState<HermesSessionDetailResponse | null>(null)
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [detailError, setDetailError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<HermesManagedSession | null>(null)
  const [deleteState, setDeleteState] = useState<'idle' | 'deleting'>('idle')
  const [endingKey, setEndingKey] = useState('')
  const [resumingKey, setResumingKey] = useState('')

  const debouncedQuery = useDebouncedValue(query, 260)
  const sessions = useMemo(() => data?.sessions ?? [], [data?.sessions])
  const summary = data?.summary
  const profileOptions = useMemo(() => [
    { displayName: '全部 Profile', gatewayRunning: false, isDefault: true, model: '', name: allProfilesKey, path: '跨 Profile 汇总' },
    ...profiles.map((profile) => ({
      displayName: profile.displayName || profile.name,
      gatewayRunning: profile.gatewayRunning,
      isDefault: profile.isDefault,
      model: profile.model,
      name: profile.name,
      path: profile.path,
    })),
  ], [profiles])

  const loadSessions = useCallback(async (refreshProfiles = false) => {
    setState('loading')
    setError('')
    try {
      if (refreshProfiles) {
        await loadAgents(true)
      }
      const payload = await listHermesSessions({
        includeChildren,
        limit: 200,
        profile: profileFilter,
        query: debouncedQuery,
        sortBy,
        sortDir: 'desc',
        status: statusFilter,
      })
      setData(payload)
      setState('ready')
      return payload
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hermes 会话加载失败')
      setState('error')
      return null
    }
  }, [debouncedQuery, includeChildren, loadAgents, profileFilter, sortBy, statusFilter])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAgents(false)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAgents])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSessions(false)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadSessions])

  const openReview = useCallback(async (session: HermesManagedSession) => {
    setReviewTarget(session)
    setDetail(null)
    setDetailError('')
    setDetailState('loading')
    try {
      const payload = await getHermesSession(session.profile, session.id)
      setDetail(payload)
      setDetailState('ready')
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '会话详情加载失败')
      setDetailState('error')
    }
  }, [])

  const resumeSession = useCallback(async (session: HermesManagedSession) => {
    const key = sessionKey(session)
    setResumingKey(key)
    try {
      selectAgent(session.profile)
      const terminal = await createHermesTerminal({
        command: 'chat-tui',
        profile: session.profile,
        resumeSessionId: session.id,
      })
      toast.success(session.endedAt ? '会话已恢复到 Hermes 终端' : '会话已继续到 Hermes 终端')
      navigate(`/dashboard/hermes-terminal?session=${encodeURIComponent(terminal.id)}&profile=${encodeURIComponent(session.profile)}`)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '会话恢复失败')
    } finally {
      setResumingKey('')
    }
  }, [navigate, selectAgent])

  const deleteSession = useCallback(async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteState('deleting')
    try {
      const payload = await deleteHermesSessions([{ id: target.id, profile: target.profile }])
      const result = payload.results[0]
      if (result?.status === 'deleted' || result?.status === 'missing') {
        setData((current) => removeSessionFromResponse(current, target))
        setDeleteTarget(null)
        toast.success(result.status === 'deleted' ? '会话已删除' : '会话已不存在，已从列表移除')
        await loadSessions(false)
        setData((current) => removeSessionFromResponse(current, target))
      } else {
        toast.warning(result?.message || '会话未删除')
      }
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '会话删除失败')
    } finally {
      setDeleteState('idle')
    }
  }, [deleteTarget, loadSessions])

  const endSession = useCallback(async (session: HermesManagedSession) => {
    const key = sessionKey(session)
    setEndingKey(key)
    try {
      const payload = await endHermesSession(session.profile, session.id)
      const suffix = payload.terminatedProcesses > 0 ? `，已中断 ${payload.terminatedProcesses} 个进程` : ''
      toast.success(`会话已结束${suffix}`)
      await loadSessions(false)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '会话结束失败')
    } finally {
      setEndingKey('')
    }
  }, [loadSessions])

  const hasLoadError = Boolean(error && !data)

  return (
    <DashboardLayout>
      <div className={hasLoadError ? 'flex min-h-[calc(100dvh-8rem)] items-center justify-center' : 'mx-auto flex max-w-7xl flex-col gap-6'}>
        {hasLoadError ? (
          <HermesLoadErrorCard
            error={error}
            isRetrying={state === 'loading'}
            title="无法加载 Hermes 会话"
            onRetry={() => void loadSessions(true)}
          />
        ) : null}

        {!hasLoadError ? (
          <>
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.8fr)]">
          <SessionsHero />
          <SessionsSummaryCard summary={summary} />
        </section>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <ProfileSelectDropdown options={profileOptions} selectedName={profileFilter} onSelect={setProfileFilter} />
            <SessionFilterDropdown value={statusFilter} onSelect={setStatusFilter} />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <SearchField aria-label="搜索 Hermes 会话" value={query} onChange={setQuery}>
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input className="w-full sm:w-48" placeholder="搜索会话..." />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>

            <SortDropdown value={sortBy} onSelect={setSortBy} />
            <Button size="sm" variant={includeChildren ? 'primary' : 'tertiary'} onPress={() => setIncludeChildren((value) => !value)}>
              <Icon icon="lucide:git-branch" className="size-4" />
              子会话
            </Button>
            <Button isIconOnly aria-label="刷新 Hermes 会话" variant={state === 'loading' ? 'primary' : 'ghost'} isDisabled={state === 'loading'} onPress={() => void loadSessions(true)}>
              <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
            </Button>
          </div>
        </div>

        <Card>
          <Card.Header>
            <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-2">
                <Icon icon="lucide:messages-square" className="size-6 shrink-0 text-muted" />
                <div className="min-w-0">
                  <Card.Title>会话列表</Card.Title>
                  <Card.Description>{profileFilter === allProfilesKey ? '跨 Profile state.db 汇总' : `Profile ${profileFilter}`}</Card.Description>
                </div>
              </div>
              <div className="hidden shrink-0 items-center gap-2 md:flex">
                <Chip variant="soft">{numberFormatter.format(summary?.returned ?? sessions.length)} rows</Chip>
                <Chip variant="soft">{statusFilter === 'all' ? '全部' : statusFilter === 'active' ? '活跃' : '已结束'}</Chip>
                {includeChildren ? <Chip variant="soft">include children</Chip> : null}
                {debouncedQuery ? <Chip color="accent" variant="soft">search</Chip> : null}
              </div>
            </div>
          </Card.Header>
          <Card.Content>
            {error ? <Alert status="danger" className="mb-4">{error}</Alert> : null}
            {data?.errors?.length ? (
              <Alert status="warning" className="mb-4">{data.errors.join('；')}</Alert>
            ) : null}
            {state === 'loading' && !data ? (
              <div className="grid gap-3">
                <Skeleton className="h-14 rounded-2xl" />
                <Skeleton className="h-14 rounded-2xl" />
                <Skeleton className="h-14 rounded-2xl" />
              </div>
            ) : (
              <Table variant="secondary">
                <Table.ScrollContainer className="h-[calc(100dvh-360px)] min-h-[420px] overflow-auto">
                  <Table.Content aria-label="Hermes sessions" className="min-w-[1128px] table-fixed">
                    <Table.Header className="sticky top-0 z-10">
                      <Table.Column isRowHeader id="session">会话</Table.Column>
                      <Table.Column id="profile" className="w-[150px]">Profile</Table.Column>
                      <Table.Column id="model" className="w-[170px]">模型</Table.Column>
                      <Table.Column id="counts" className="w-[130px]">消息</Table.Column>
                      <Table.Column id="tokens" className="w-[140px]">Token</Table.Column>
                      <Table.Column id="time" className="w-[170px]">最近活跃</Table.Column>
                      <Table.Column id="actions" className="w-[108px] text-end">操作</Table.Column>
                    </Table.Header>
                    <Table.Body items={sessions} renderEmptyState={() => <div className="px-4 py-10 text-center text-sm text-muted">{state === 'loading' ? '加载中...' : '暂无匹配会话'}</div>}>
                      {(item) => (
                        <Table.Row key={sessionKey(item)} id={sessionKey(item)}>
                          <Table.Cell className="min-w-0">
                            <SessionOverviewCell session={item} />
                          </Table.Cell>
                          <Table.Cell className="w-[150px]">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{item.profileDisplayName || item.profile}</p>
                              <p className="truncate text-xs text-muted">{item.profilePath}</p>
                            </div>
                          </Table.Cell>
                          <Table.Cell className="w-[170px]">
                            <p className="truncate text-sm">{item.model || '-'}</p>
                            <p className="truncate text-xs text-muted">{item.userId || item.costStatus || '-'}</p>
                          </Table.Cell>
                          <Table.Cell className="w-[130px] text-sm tabular-nums">
                            <p>{numberFormatter.format(item.messageCount)}</p>
                            <p className="text-xs text-muted">{numberFormatter.format(item.toolCallCount)} tools</p>
                          </Table.Cell>
                          <Table.Cell className="w-[140px] text-sm tabular-nums">
                            <p>{numberFormatter.format(item.totalTokens || item.inputTokens + item.outputTokens + item.reasoningTokens)}</p>
                            <p className="text-xs text-muted">{item.costUsd ? currencyFormatter.format(item.costUsd) : '-'}</p>
                          </Table.Cell>
                          <Table.Cell className="w-[170px] text-xs tabular-nums text-muted">
                            <p>{formatDateTime(item.lastActiveAt || item.startedAt)}</p>
                            <p>{item.endedAt ? `结束 ${formatDateTime(item.endedAt)}` : item.isActive ? '运行中' : '未活跃'}</p>
                          </Table.Cell>
                          <Table.Cell className="w-[108px] text-end">
                            <SessionActionsDropdown
                              isEnding={endingKey === sessionKey(item)}
                              isResuming={resumingKey === sessionKey(item)}
                              session={item}
                              onDelete={setDeleteTarget}
                              onEnd={(session) => void endSession(session)}
                              onReview={(session) => void openReview(session)}
                              onResume={(session) => void resumeSession(session)}
                            />
                          </Table.Cell>
                        </Table.Row>
                      )}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            )}
          </Card.Content>
        </Card>
          </>
        ) : null}
      </div>

      <SessionReviewModal
        detail={detail}
        error={detailError}
        isOpen={reviewTarget !== null}
        state={detailState}
        target={reviewTarget}
        onOpenChange={(open) => {
          if (!open) {
            setReviewTarget(null)
            setDetail(null)
          }
        }}
      />
      <AlertDialog.Backdrop isOpen={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[460px]">
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>删除 Hermes 会话？</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              将从 Profile {deleteTarget?.profileDisplayName || deleteTarget?.profile} 的 state.db 删除此会话和消息，并同步删除 sessions 目录中的同名记录文件。运行中的会话会被后端跳过。
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="tertiary" isDisabled={deleteState === 'deleting'} onPress={() => setDeleteTarget(null)}>取消</Button>
              <Button variant="danger-soft" isPending={deleteState === 'deleting'} onPress={() => void deleteSession()}>删除</Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </DashboardLayout>
  )
}

function SessionsHeroIllustration(props: Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'xmlns'>) {
  const { className, ...rest } = props
  const accentRing = 'color-mix(in oklch, var(--accent) 62%, white)'
  const accentSoft = 'color-mix(in oklch, var(--accent) 36%, white)'
  const accentDeep = 'color-mix(in oklch, var(--accent), black 0%)'
  const accentBright = 'color-mix(in oklch, var(--accent), white 26%)'

  const gradId = 'hermesSessionsHeroAccent'
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="132 0 291 300"
      fill="none"
      className={className}
      aria-hidden
      {...rest}
    >
      <circle cx="359" cy="220" r="20" stroke={accentRing} strokeWidth={2} />
      <circle cx="319" cy="220" r="20" stroke={accentRing} strokeWidth={2} />
      <circle cx="279" cy="220" r="20" stroke={accentRing} strokeWidth={2} />
      <circle cx="399" cy="220" r="20" stroke={accentRing} strokeWidth={2} />
      <path stroke="rgba(247, 247, 247, 1)" strokeWidth={2} d="M399 298.936L399 0" />
      <path stroke="rgba(247, 247, 247, 1)" strokeWidth={2} d="M359 298.936L359 0" />
      <path stroke="rgba(247, 247, 247, 1)" strokeWidth={2} d="M319 298.936L319 0" />
      <path stroke="rgba(247, 247, 247, 1)" strokeWidth={2} d="M279 298.936L279 0" />
      <path stroke="rgba(247, 247, 247, 1)" strokeWidth={2} d="M258 219L420 219" />
      <circle cx="359" cy="220" r="5" fill="#FFFFFF" />
      <circle cx="319" cy="220" r="5" fill="#FFFFFF" />
      <circle cx="279" cy="220" r="5" fill="#FFFFFF" />
      <circle cx="399" cy="220" r="5" fill="#FFFFFF" />
      <rect x="139" y="120" width="160" height="80" fill="#F7F7F7" />
      <path fill="#EBECEC" d="M139 200 179 200 139 240z" />
      <rect x="179" y="80" width="200" height="120" fill={accentSoft} />
      <path stroke="rgba(255, 255, 255, 1)" strokeWidth={4} d="m219 117h120" />
      <path stroke="rgba(255, 255, 255, 1)" strokeWidth={4} d="m219 131h120" />
      <path stroke="rgba(255, 255, 255, 1)" strokeWidth={4} d="m219 145h120" />
      <path stroke="rgba(255, 255, 255, 1)" strokeWidth={4} d="m219 159h40" />
      <path fill="#F7F7F7" d="M179 200 259 200 179 280z" />
      <path
        fillRule="evenodd"
        fill={`url(#${gradId})`}
        d="M419 120 259 120 259 40h120.03C401.106 40.016 419 57.92 419 80v40Z"
      />
      <path fill="#181818" d="m259 120 40 0-40 40z" />
      <path stroke="rgba(255, 255, 255, 1)" strokeWidth={4} d="m289 62 20 20 20-20 20 20 20-20 20 20" />
      <path stroke="rgba(255, 255, 255, 1)" strokeWidth={4} d="m289 78 20 20 20-20 20 20 20-20 20 20" />
      <defs>
        <linearGradient id={gradId} x1="417.285" y1="80" x2="259" y2="80" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={accentDeep} />
          <stop offset="0.5" stopColor="var(--accent)" />
          <stop offset="1" stopColor={accentBright} />
        </linearGradient>
      </defs>
    </svg>
  )
}

function SessionsHero() {
  return (
    <Card variant="transparent" className="overflow-visible">
      <Card.Content>
        <div className="flex flex-row items-center gap-4 md:gap-6">
          <div className="flex h-36 shrink-0 items-center justify-center overflow-visible rounded-2xl p-1 drop-shadow-[0_8px_14px_color-mix(in_oklch,var(--accent)_28%,transparent)]">
            <SessionsHeroIllustration className="h-full w-auto md:scale-105" />
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            <div className="min-w-0">
              <Card.Title className="text-2xl font-bold md:text-3xl">会话管理</Card.Title>
              <Card.Description className="mt-4 text-base md:text-lg">跨 Profile 搜索和审阅 state.db 会话记录。</Card.Description>
            </div>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function SessionsSummaryCard({ summary }: { summary?: HermesSessionsResponse['summary'] }) {
  return (
    <Card>
      <Card.Content>
        <div className="grid gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-muted">匹配会话</p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">{numberFormatter.format(summary?.totalMatched ?? 0)}</p>
            </div>
            <div className="flex size-16 items-center justify-center rounded-3xl bg-surface-secondary/50 text-primary">
              <Icon icon="lucide:database" className="size-8" />
            </div>
          </div>
          <div className="grid gap-3">
            {/* <SummaryRow label="Profile" value={profileFilter === allProfilesKey ? `${numberFormatter.format(summary?.profiles ?? 0)} 个` : profileFilter} /> */}
            <SummaryRow label="活跃 / 已结束" value={`${numberFormatter.format(summary?.active ?? 0)} / ${numberFormatter.format(summary?.ended ?? 0)}`} />
            {/* <SummaryRow label="消息 / 工具" value={`${numberFormatter.format(summary?.totalMessages ?? 0)} / ${numberFormatter.format(summary?.totalToolCalls ?? 0)}`} /> */}
            <SummaryRow label="Token / 成本" value={`${numberFormatter.format(summary?.totalTokens ?? 0)} / ${currencyFormatter.format(summary?.totalCostUsd ?? 0)}`} />
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="size-2.5 shrink-0 rounded-full bg-accent" />
      <span className="min-w-0 flex-1 truncate text-sm text-muted">{label}</span>
      <span className="truncate text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  )
}

function SessionOverviewCell({ session }: { session: HermesManagedSession }) {
  const status = getSessionStatusMeta(session)
  const title = session.title || session.preview || session.id
  const source = session.platform || session.source

  return (
    <div className="flex min-w-0 items-start gap-3 py-1">
      <SessionStatusAvatar session={session} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{title}</span>
          <Chip size="sm" color={status.color} variant="soft">{status.label}</Chip>
          {session.matchedMessageCount > 0 ? <Chip size="sm" color="accent" variant="soft">{session.matchedMessageCount} 命中</Chip> : null}
        </div>
        {/* <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{description}</p> */}
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
          <Chip size="sm" variant="soft">{truncateMiddle(session.id, 18)}</Chip>
          {source ? <Chip size="sm" variant="soft">{truncateMiddle(source, 28)}</Chip> : null}
          {session.parentSessionId ? <Chip size="sm" color="warning" variant="soft">子会话</Chip> : null}
          {session.activeProcessIds?.length ? <Chip size="sm" color="success" variant="soft">{session.activeProcessIds.length} 进程</Chip> : null}
        </div>
      </div>
    </div>
  )
}

function SessionStatusAvatar({ session }: { session: HermesManagedSession }) {
  const status = getSessionStatusMeta(session)
  return (
    <span className={`relative flex size-10 shrink-0 items-center justify-center rounded-full text-white ring-2 ${status.avatarClass}`}>
      <Icon icon={status.icon} className="size-4" />
    </span>
  )
}

function SessionActionsDropdown({
  isEnding,
  isResuming,
  session,
  onDelete,
  onEnd,
  onResume,
  onReview,
}: {
  isEnding: boolean
  isResuming: boolean
  session: HermesManagedSession
  onDelete: (session: HermesManagedSession) => void
  onEnd: (session: HermesManagedSession) => void
  onResume: (session: HermesManagedSession) => void
  onReview: (session: HermesManagedSession) => void
}) {
  const canResume = !session.isActive
  const canEnd = !session.endedAt
  const resumeLabel = session.endedAt ? '恢复会话' : '继续会话'
  const isBusy = isEnding || isResuming

  return (
    <Dropdown>
      <Button size="sm" isIconOnly variant="tertiary" isDisabled={isBusy}>
        <Icon icon={isBusy ? 'lucide:loader-circle' : 'lucide:ellipsis'} className={isBusy ? 'size-4 animate-spin' : 'size-4'} />
      </Button>
      <Dropdown.Popover className="w-auto" placement="bottom end">
        <Dropdown.Menu className="w-auto"
          onAction={(key) => {
            if (key === 'review') onReview(session)
            if (key === 'resume') onResume(session)
            if (key === 'end') onEnd(session)
            if (key === 'delete') onDelete(session)
          }}
        >
          <Dropdown.Item id="review" textValue="查看详情">
            <Dropdown.ItemIndicator type="dot" />
            <div className="flex min-w-0 items-center gap-3">
              <Icon icon="lucide:panel-right-open" className="size-4 text-muted" />
              <Label>查看详情</Label>
            </div>
          </Dropdown.Item>
          {canResume ? (
            <Dropdown.Item id="resume" textValue={resumeLabel}>
              <Dropdown.ItemIndicator type="dot" />
              <div className="flex min-w-0 items-center gap-3">
                <Icon icon={session.endedAt ? 'lucide:rotate-ccw' : 'lucide:play'} className="size-4 text-muted" />
                <Label>{resumeLabel}</Label>
              </div>
            </Dropdown.Item>
          ) : null}
          {canEnd ? (
            <Dropdown.Item id="end" textValue="结束会话">
              <Dropdown.ItemIndicator type="dot" />
              <div className="flex min-w-0 items-center gap-3">
                <Icon icon={session.isActive ? 'lucide:octagon-x' : 'lucide:circle-stop'} className="size-4 text-muted" />
                <Label>{session.isActive ? '结束运行中会话' : '结束未活跃会话'}</Label>
              </div>
            </Dropdown.Item>
          ) : null}
          <Dropdown.Item id="delete" textValue="删除会话" isDisabled={session.isActive}>
            <Dropdown.ItemIndicator type="dot" />
            <div className="flex min-w-0 items-center gap-3 text-danger">
              <Icon icon="lucide:trash-2" className="size-4" />
              <Label>删除会话</Label>
            </div>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function ProfileSelectDropdown({ options, selectedName, onSelect }: { options: SessionProfileOption[]; selectedName: string; onSelect: (value: string) => void }) {
  const selected = options.find((item) => item.name === selectedName) ?? options[0]
  return (
    <Dropdown>
      <Button variant="tertiary" className="min-w-0 rounded-full pl-1 pr-2">
        <ProfileAvatar profile={selected} size="sm" />
        <span className="min-w-0 max-w-44 truncate text-sm font-semibold text-foreground">{selected.displayName}</span>
        <Icon icon="lucide:chevron-down" className="size-4 text-muted" />
      </Button>
      <Dropdown.Popover placement="bottom start">
        <Dropdown.Menu selectedKeys={new Set(selectedName ? [selectedName] : [])} selectionMode="single" onAction={(key) => onSelect(String(key))}>
          {options.map((item) => (
            <Dropdown.Item key={item.name} id={item.name} textValue={item.displayName}>
              <Dropdown.ItemIndicator type="dot" />
              <div className="flex min-w-0 items-center gap-3">
                <ProfileAvatar profile={item} />
                <div className="min-w-0 flex-1">
                  <Label className="truncate">{item.displayName}</Label>
                  <p className="mt-1 truncate text-xs text-muted">{item.model || item.path}</p>
                </div>
              </div>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function ProfileAvatar({ profile, size = 'md' }: { profile: SessionProfileOption; size?: 'sm' | 'md' }) {
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

function SessionFilterDropdown({ value, onSelect }: { value: SessionStatusFilter; onSelect: (value: SessionStatusFilter) => void }) {
  const options = [
    { id: 'all', label: '全部' },
    { id: 'active', label: '活跃' },
    { id: 'ended', label: '已结束' },
  ] as const
  const selected = options.find((item) => item.id === value) ?? options[0]
  return (
    <Dropdown>
      <Button variant="tertiary" className="min-w-0 rounded-full pl-3 pr-2">
        <span className="truncate text-sm font-semibold text-foreground">{selected.label}</span>
        <Icon icon="lucide:filter" className="size-4 text-muted" />
      </Button>
      <Dropdown.Popover placement="bottom start">
        <Dropdown.Menu selectedKeys={new Set([value])} selectionMode="single" onAction={(key) => onSelect(String(key) as SessionStatusFilter)}>
          {options.map((item) => (
            <Dropdown.Item key={item.id} id={item.id} textValue={item.label}>
              <Dropdown.ItemIndicator type="dot" />
              <Label>{item.label}</Label>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function SortDropdown({ value, onSelect }: { value: SortKey; onSelect: (value: SortKey) => void }) {
  const options = [
    { id: 'lastActive', label: '最近活跃' },
    { id: 'startedAt', label: '开始时间' },
    { id: 'messages', label: '消息数' },
    { id: 'tokens', label: 'Token' },
    { id: 'cost', label: '成本' },
  ] as const
  const selected = options.find((item) => item.id === value) ?? options[0]
  return (
    <Dropdown>
      <Button variant="tertiary" className="min-w-0 rounded-full pl-3 pr-2">
        <span className="truncate text-sm font-semibold text-foreground">{selected.label}</span>
        <Icon icon="lucide:arrow-up-down" className="size-4 text-muted" />
      </Button>
      <Dropdown.Popover placement="bottom end">
        <Dropdown.Menu selectedKeys={new Set([value])} selectionMode="single" onAction={(key) => onSelect(String(key) as SortKey)}>
          {options.map((item) => (
            <Dropdown.Item key={item.id} id={item.id} textValue={item.label}>
              <Dropdown.ItemIndicator type="dot" />
              <Label>{item.label}</Label>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function SessionReviewModal({ detail, error, isOpen, state, target, onOpenChange }: {
  detail: HermesSessionDetailResponse | null
  error: string
  isOpen: boolean
  state: 'idle' | 'loading' | 'ready' | 'error'
  target: HermesManagedSession | null
  onOpenChange: (open: boolean) => void
}) {
  const session = detail?.session ?? target
  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
        <Modal.Container size="lg" scroll="inside">
          <Modal.Dialog className="sm:max-w-[920px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Icon className="bg-accent text-accent-foreground">
                <Icon icon="lucide:messages-square" className="size-5" />
              </Modal.Icon>
              <div className="min-w-0">
                <Modal.Heading>{session?.title || session?.preview || '会话详情'}</Modal.Heading>
                <p className="text-sm text-muted">{session ? `${session.profileDisplayName || session.profile} · ${session.id}` : 'Hermes session'}</p>
              </div>
            </Modal.Header>
            <Modal.Body>
              {state === 'loading' ? (
                <div className="grid gap-3">
                  <Skeleton className="h-20 rounded-2xl" />
                  <Skeleton className="h-28 rounded-2xl" />
                  <Skeleton className="h-28 rounded-2xl" />
                </div>
              ) : state === 'error' ? (
                <Alert status="danger">{error}</Alert>
              ) : (
                <div className="grid gap-4">
                  {session ? <SessionMeta session={session} /> : null}
                  <div className="grid gap-3">
                    {(detail?.messages ?? []).map((message) => (
                      <MessageBubble key={message.id} message={message} />
                    ))}
                    {detail && detail.messages.length === 0 ? <div className="rounded-2xl bg-surface-secondary/50 p-6 text-center text-sm text-muted">这个会话暂无消息记录</div> : null}
                  </div>
                </div>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

function SessionMeta({ session }: { session: HermesManagedSession }) {
  return (
    <Card>
      <Card.Content>
        <div className="grid gap-3 sm:grid-cols-4">
          <MetaItem label="Profile" value={session.profileDisplayName || session.profile} detail={session.profilePath} />
          <MetaItem label="模型" value={session.model || '-'} detail={session.platform || session.source || '-'} />
          <MetaItem label="消息" value={numberFormatter.format(session.messageCount)} detail={`${numberFormatter.format(session.toolCallCount)} tools`} />
          <MetaItem label="最近活跃" value={formatDateTime(session.lastActiveAt || session.startedAt)} detail={session.isActive ? '运行中' : session.endedAt ? '已结束' : '未活跃'} />
        </div>
      </Card.Content>
    </Card>

  )
}

function MetaItem({ detail, label, value }: { detail?: string; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold">{value}</p>
      <p className="mt-1 truncate text-xs text-muted">{detail || '-'}</p>
    </div>
  )
}

function MessageBubble({ message }: { message: HermesSessionMessage }) {
  const tone = message.role === 'assistant' ? 'accent' : message.role === 'tool' ? 'warning' : message.role === 'system' ? 'default' : 'success'
  const content = message.text || stringifyContent(message.content) || message.toolName || '-'
  return (
    <Card>
      <Card.Content>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Chip size="sm" color={tone} variant="soft">{message.role || 'message'}</Chip>
            {message.toolName ? <Chip size="sm" variant="soft">{message.toolName}</Chip> : null}
          </div>
          <span className="text-xs tabular-nums text-muted">{formatDateTime(message.timestamp)}</span>
        </div>
        <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-background/70 p-3 text-xs leading-6 text-foreground">{content}</pre>
        {message.reasoningContent || message.reasoning ? (
          <p className="mt-2 line-clamp-3 text-xs text-muted">{message.reasoningContent || message.reasoning}</p>
        ) : null}
      </Card.Content>
    </Card>
  )
}

function sessionKey(session: HermesManagedSession) {
  return `${session.profile}:${session.id}`
}

function removeSessionFromResponse(data: HermesSessionsResponse | null, target: HermesManagedSession) {
  if (!data) return data
  const sessions = data.sessions.filter((session) => sessionKey(session) !== sessionKey(target))
  if (sessions.length === data.sessions.length) return data
  const removed = data.sessions.length - sessions.length
  return {
    ...data,
    sessions,
    summary: {
      ...data.summary,
      active: target.isActive ? Math.max(0, data.summary.active - removed) : data.summary.active,
      ended: target.endedAt ? Math.max(0, data.summary.ended - removed) : data.summary.ended,
      returned: Math.max(0, data.summary.returned - removed),
      totalCostUsd: Math.max(0, data.summary.totalCostUsd - (target.costUsd ?? 0)),
      totalMatched: Math.max(0, data.summary.totalMatched - removed),
      totalMessages: Math.max(0, data.summary.totalMessages - target.messageCount),
      totalTokens: Math.max(0, data.summary.totalTokens - target.totalTokens),
      totalToolCalls: Math.max(0, data.summary.totalToolCalls - target.toolCallCount),
    },
  }
}

function getSessionStatusMeta(session: HermesManagedSession) {
  if (session.isActive) {
    return {
      avatarClass: 'bg-success shadow-[0_0_14px_color-mix(in_oklch,var(--success)_55%,transparent)] ring-success/30',
      color: 'success' as const,
      icon: 'lucide:activity',
      label: '运行中',
    }
  }
  if (session.endedAt) {
    return {
      avatarClass: 'bg-muted ring-muted/30',
      color: 'default' as const,
      icon: 'lucide:circle-stop',
      label: '已结束',
    }
  }
  return {
    avatarClass: 'bg-warning ring-warning/30',
    color: 'warning' as const,
    icon: 'lucide:pause',
    label: '未活跃',
  }
}

function formatDateTime(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  })
}

function truncateMiddle(value: string, limit: number) {
  if (value.length <= limit) return value
  const half = Math.max(4, Math.floor((limit - 3) / 2))
  return `${value.slice(0, half)}...${value.slice(-half)}`
}

function stringifyContent(value: unknown) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function useDebouncedValue<T>(value: T, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay)
    return () => window.clearTimeout(timer)
  }, [delay, value])
  return debouncedValue
}

export default HermesSessionsPage
