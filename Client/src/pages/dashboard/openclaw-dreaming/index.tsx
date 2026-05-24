import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertDialog, Button, Card, Chip, Input, Label, ListBox, Separator, Skeleton, Switch, toast } from '@heroui/react'
import { CellSelect, ItemCard, ItemCardGroup } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import {
  backfillOpenClawDreamDiary,
  clearOpenClawDreamingGroundedShortTerm,
  getOpenClawConfig,
  getOpenClawDreamDiary,
  getOpenClawDreaming,
  resolveOpenClawGatewayWebSocketURL,
  OpenClawGatewayClient,
  resetOpenClawDreamDiary,
  updateOpenClawDreamingConfig,
  type OpenClawDoctorMemoryDreamActionPayload,
  type OpenClawDoctorMemoryDreamDiaryPayload,
  type OpenClawDoctorMemoryStatusPayload,
  type OpenClawDreamDiaryResponse,
  type OpenClawDreamingActionResponse,
  type OpenClawDreamingConfigPatch,
  type OpenClawDreamingConfigStatus,
  type OpenClawDreamingPhaseConfig,
  type OpenClawDreamingResponse,
  type OpenClawModelDefinition,
  type OpenClawModelProvider,
} from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { useOpenClawEnvironmentStore } from '@/stores/openclaw-environment'

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

type DreamingFormState = {
  enabled: boolean
  frequency: string
  model: string
  timezone: string
}

type AgentModelOption = {
  label: string
  modelId: string
  providerKey: string
  value: string
}

type TimezoneOption = {
  detail: string
  id: string
  label: string
}

type DreamingAction = 'backfill' | 'clearGrounded' | 'resetDiary'
type GatewayClientFactory = () => Promise<OpenClawGatewayClient | null>

const defaultFormState: DreamingFormState = {
  enabled: false,
  frequency: '',
  model: '',
  timezone: '',
}

const defaultTimezoneKey = '__default__'

const preferredTimezones = [
  'Asia/Shanghai',
  'UTC',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
]

const dreamingHeroImage = 'https://assets.orence.net/file/20260513102820751.png'

const dreamingActionMeta: Record<DreamingAction, { body: string, confirmLabel: string, title: string }> = {
  backfill: {
    body: '将扫描当前 Agent 的 memory/YYYY-MM-DD.md 历史记录，并写入可回滚的回填日记条目。',
    confirmLabel: '开始回填',
    title: '回填梦境日记？',
  },
  resetDiary: {
    body: '只会移除带 openclaw:dreaming:backfill-entry 标记的回填条目，普通梦境日记会保留。',
    confirmLabel: '重置日记',
    title: '重置回填日记？',
  },
  clearGrounded: {
    body: '只会清理 grounded-only 且没有 live recall / daily support 的短期记忆条目，不会修改 MEMORY.md。',
    confirmLabel: '清空记忆',
    title: '清空 grounded 短期记忆？',
  },
}

function OpenClawDreamingPage() {
  usePageTitle('OpenClaw 梦境模式')
  const loadOpenClawEnvironment = useOpenClawEnvironmentStore((store) => store.loadOpenClawEnvironment)
  const [state, setState] = useState<LoadState>('idle')
  const [data, setData] = useState<OpenClawDreamingResponse | null>(null)
  const [error, setError] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [, setDiaryState] = useState<LoadState>('idle')
  const [diaryData, setDiaryData] = useState<OpenClawDreamDiaryResponse | null>(null)
  const [diaryError, setDiaryError] = useState('')
  const [form, setForm] = useState<DreamingFormState>(defaultFormState)
  const [savedForm, setSavedForm] = useState<DreamingFormState>(defaultFormState)
  const [modelConfigState, setModelConfigState] = useState<LoadState>('idle')
  const [modelConfigContent, setModelConfigContent] = useState<Record<string, unknown>>({})
  const [modelConfigError, setModelConfigError] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving'>('idle')
  const [syncState, setSyncState] = useState<'idle' | 'saving'>('idle')
  const [actionState, setActionState] = useState<DreamingAction | null>(null)
  const dreamingRequestRef = useRef(0)
  const modelConfigContentRef = useRef<Record<string, unknown>>({})

  const createGatewayClient = useCallback(async () => {
    let content = modelConfigContentRef.current

    if (!Object.keys(content).length) {
      try {
        const payload = await getOpenClawConfig()

        content = payload.content ?? {}
        modelConfigContentRef.current = content
        setModelConfigContent(content)
      } catch {
        content = {}
      }
    }

    const environment = await loadOpenClawEnvironment()
    const gatewayUrl = resolveOpenClawGatewayWebSocketURL(environment.gateway)

    if (
      !gatewayUrl ||
      !(
        environment.gateway.tcpReachable ||
        environment.gateway.httpHealthOk ||
        environment.gateway.healthzOk ||
        environment.gateway.readyzOk
      )
    ) {
      return null
    }

    return new OpenClawGatewayClient({
      requestTimeoutMs: 30_000,
      token: getGatewayToken(content),
      url: gatewayUrl,
    })
  }, [loadOpenClawEnvironment])

  const loadDreaming = useCallback(async (agentId?: string) => {
    const requestId = dreamingRequestRef.current + 1
    dreamingRequestRef.current = requestId
    setState('loading')
    setError('')
    try {
      const requestedAgentId = agentId?.trim() || undefined
      const payload = await getOpenClawDreaming(requestedAgentId)
      if (requestId !== dreamingRequestRef.current) return
      const selected = selectDreamingAgentFromPayload(payload, requestedAgentId)
      const nextPayload = selected?.isDefault
        ? await overlayDreamingWithGatewayStatus(payload, createGatewayClient)
        : payload

      if (requestId !== dreamingRequestRef.current) return
      setData(nextPayload)
      setSelectedAgentId(requestedAgentId || nextPayload.selected.id)
      const nextForm = toFormState(nextPayload.config)
      setForm(nextForm)
      setSavedForm(nextForm)
      setState('ready')
    } catch (err) {
      if (requestId !== dreamingRequestRef.current) return
      setError(err instanceof Error ? err.message : '梦境模式加载失败')
      setState('error')
    }
  }, [createGatewayClient])

  const loadModelConfig = useCallback(async () => {
    setModelConfigState('loading')
    setModelConfigError('')
    try {
      const payload = await getOpenClawConfig()
      const content = payload.content ?? {}
      modelConfigContentRef.current = content
      setModelConfigContent(content)
      setModelConfigState('ready')
      return content
    } catch (err) {
      setModelConfigContent({})
      setModelConfigError(err instanceof Error ? err.message : '模型配置加载失败')
      setModelConfigState('error')
      return {}
    }
  }, [])

  const loadInitial = useCallback(async () => {
    await Promise.all([
      loadDreaming(),
      loadModelConfig(),
    ])
  }, [loadDreaming, loadModelConfig])

  const loadDiary = useCallback(async (agentId: string) => {
    if (!agentId) {
      setDiaryData(null)
      return
    }
    setDiaryState('loading')
    setDiaryError('')
    try {
      const agent = selectDreamingAgentFromPayload(data, agentId)
      const gatewayDiary = agent?.isDefault
        ? await getGatewayDreamDiary(agentId, createGatewayClient)
        : null

      setDiaryData(gatewayDiary ?? await getOpenClawDreamDiary(agentId))
      setDiaryState('ready')
    } catch (err) {
      setDiaryData(null)
      setDiaryError(err instanceof Error ? err.message : '梦境日记加载失败')
      setDiaryState('error')
    }
  }, [createGatewayClient, data])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadInitial()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadInitial])

  useEffect(() => {
    if (!selectedAgentId) return
    const timer = window.setTimeout(() => {
      void loadDiary(selectedAgentId)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadDiary, selectedAgentId])

  const agents = useMemo(() => data?.agents ?? [], [data?.agents])
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? data?.selected ?? null,
    [agents, data?.selected, selectedAgentId],
  )
  const config = data?.config ?? null
  const summary = data?.summary
  const modelOptions = useMemo(() => buildAgentModelOptions(modelConfigContent), [modelConfigContent])
  const timezoneOptions = useMemo(() => buildTimezoneOptions(form.timezone), [form.timezone])
  const configDirty = useMemo(
    () => !isSameDreamingForm(form, savedForm),
    [form, savedForm],
  )

  const changeAgent = useCallback((agentId: string) => {
    setSelectedAgentId(agentId)
    void loadDreaming(agentId)
  }, [loadDreaming])

  const saveConfig = useCallback(async () => {
    const patch = buildDreamingPatch(form, savedForm)
    if (!patch) {
      toast.info('当前没有可保存的修改')
      return
    }
    setSaveState('saving')
    try {
      const next = await updateOpenClawDreamingConfig(patch)
      const nextForm = toFormState(next.config)
      setData((current) => current ? ({ ...current, config: next.config }) : current)
      setForm(nextForm)
      setSavedForm(nextForm)
      toast.success('梦境配置已保存')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '梦境配置保存失败')
    } finally {
      setSaveState('idle')
    }
  }, [form, savedForm])

  const toggleEnabled = useCallback(async (enabled: boolean) => {
    setSyncState('saving')
    try {
      const next = await updateOpenClawDreamingConfig({ enabled })
      const nextForm = toFormState(next.config)
      setData((current) => current ? ({ ...current, config: next.config }) : current)
      setForm(nextForm)
      setSavedForm(nextForm)
      toast.success(enabled ? '梦境模式已启用' : '梦境模式已停用')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '梦境开关更新失败')
    } finally {
      setSyncState('idle')
    }
  }, [])

  const runDreamingAction = useCallback(async (action: DreamingAction) => {
    const agentId = selectedAgentId || data?.selected.id
    if (!agentId) {
      toast.warning('请先选择 Agent')
      return
    }
    setActionState(action)
    try {
      const agent = selectDreamingAgentFromPayload(data, agentId)
      const gatewayResult = agent?.isDefault
        ? await executeGatewayDreamingAction(action, agentId, createGatewayClient)
        : null
      const result = gatewayResult ?? await executeDreamingAction(action, agentId)
      toast.success(dreamingActionSuccessMessage(action, result))
      await Promise.all([
        loadDreaming(agentId),
        loadDiary(agentId),
      ])
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : dreamingActionFailureMessage(action))
    } finally {
      setActionState(null)
    }
  }, [createGatewayClient, data, loadDiary, loadDreaming, selectedAgentId])

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <Card variant="transparent" className="h-full overflow-visible">
            <Card.Content className="flex h-full items-center justify-start overflow-visible">
              <div className="flex w-full flex-row items-center gap-4 overflow-visible md:gap-6">
                <div className="flex h-36 shrink-0 items-center justify-center overflow-visible p-1">
                  <img src={dreamingHeroImage} alt="OpenClaw Dreaming" className="h-full w-auto" />
                </div>
                <div className="flex min-w-0 flex-col gap-5">
                  <div className="min-w-0">
                    <Card.Title className="text-2xl font-bold md:text-3xl">梦境</Card.Title>
                    <Card.Description className="mt-4 text-base md:text-lg">把短期记忆、grounded 信号与高频线索编织成长期记忆的可视化场景。</Card.Description>

                    <div className={config?.enabled ? 'mt-5 rounded-2xl border border-accent/20 bg-accent/10 px-4 py-3 text-sm text-accent' : 'mt-5 rounded-2xl border border-divider bg-surface-secondary/50 px-4 py-3 text-sm text-muted'}>
                      <div className="flex items-center gap-2 font-medium">
                        <span className={config?.enabled ? 'size-2 rounded-full bg-accent' : 'size-2 rounded-full bg-muted'} />
                        <span>{config?.enabled ? '正在整理上下文、筛选线索、沉淀长期记忆。' : 'Dreaming 当前处于空闲状态，等待下一轮整理。'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card.Content>
          </Card>
            <HeroDreamingSummary
              diaryExists={diaryData?.diary.exists}
              enabled={config?.enabled}
              isRefreshing={state === 'loading'}
              onRefresh={() => void loadDreaming(selectedAgentId)}
              shortTermCount={summary?.shortTermCount}
              totalSignalCount={summary?.totalSignalCount}
            />
        </section>

        {error ? (
          <Card>
            <Card.Content>
              <div className="flex items-start gap-3 text-warning">
                <Icon icon="lucide:triangle-alert" className="mt-0.5 size-5" />
                <div>
                  <p className="font-medium">梦境模式加载失败</p>
                  <p className="mt-1 text-sm text-muted">{error}</p>
                </div>
              </div>
            </Card.Content>
          </Card>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <Card className="relative overflow-visible">
              <div className="absolute right-4 top-4 z-10 w-auto">
                <AgentSelect
                  agents={agents}
                  isDisabled={state === 'loading'}
                  value={selectedAgentId}
                  onChange={changeAgent}
                />
              </div>
              <Card.Header className="items-start justify-between gap-4 pr-40">
                <div>
                  <Card.Title>Dream Diary</Card.Title>
                  <Card.Description>{formatDateTime(diaryData?.diary.updatedAt || '暂无记录')}</Card.Description>
                </div>
              </Card.Header>
              <Card.Content className="space-y-3">
                {diaryError ? <p className="text-sm text-warning">{diaryError}</p> : null}
                <pre className="max-h-[420px] overflow-auto rounded-2xl bg-surface-secondary/50 p-4 text-xs leading-6 text-foreground whitespace-pre-wrap">{diaryData?.content || '暂无梦境日记内容。'}</pre>
              </Card.Content>
            </Card>

            <Card>
              <Card.Header>
                <div>
                  <Card.Title>最近报告</Card.Title>
                  <Card.Description>light / rem / deep 阶段最近生成的 Markdown 报告。</Card.Description>
                </div>
              </Card.Header>
              <Card.Content className="space-y-2">
                {(selectedAgent?.reports ?? []).length === 0 ? (
                  <p className="rounded-2xl bg-surface-secondary/50 p-4 text-sm text-muted">暂无报告。</p>
                ) : (
                  (selectedAgent?.reports ?? []).map((report) => (
                    <div key={`${report.phase}-${report.relativePath}`} className="rounded-2xl bg-surface-secondary/50 p-4 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <Chip size="sm" variant="secondary">{report.phase}</Chip>
                        <span className="text-xs text-muted">{formatDateTime(report.updatedAt)}</span>
                      </div>
                      <p className="mt-2 break-all font-medium text-foreground">{report.relativePath}</p>
                    </div>
                  ))
                )}
              </Card.Content>
            </Card>

            <Card>
              <Card.Content className="grid gap-4 lg:grid-cols-3">
                <PhaseCard title="Light" config={config?.phases.light} />
                <PhaseCard title="REM" config={config?.phases.rem} />
                <PhaseCard title="Deep" config={config?.phases.deep} />
              </Card.Content>
            </Card>

          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <DreamingSettingsGroup
              configDirty={configDirty}
              frequency={form.frequency}
              isSaving={saveState === 'saving'}
              isSyncing={syncState === 'saving'}
              model={form.model}
              modelConfigError={modelConfigError}
              modelConfigState={modelConfigState}
              modelOptions={modelOptions}
              pendingAction={actionState}
              pluginId={config?.pluginId || 'memory-core'}
              timezone={form.timezone}
              timezoneOptions={timezoneOptions}
              enabled={form.enabled}
              onFrequencyChange={(frequency) => setForm((current) => ({ ...current, frequency }))}
              onModelChange={(model) => setForm((current) => ({ ...current, model }))}
              onSave={() => void saveConfig()}
              onRunAction={(action) => void runDreamingAction(action)}
              onTimezoneChange={(timezone) => setForm((current) => ({ ...current, timezone }))}
              onToggle={(enabled) => {
                setForm((current) => ({ ...current, enabled }))
                void toggleEnabled(enabled)
              }}
            />

            <Card>
              <Card.Header>
                <div>
                  <Card.Title>.dreams 存储</Card.Title>
                  <Card.Description>短期记忆、阶段信号和 session corpus 的文件状态。</Card.Description>
                </div>
              </Card.Header>
              <Card.Content className="space-y-3">
                <StorageRow label="目录" value={selectedAgent?.store.dir} exists={selectedAgent?.store.exists} />
                <StorageRow label="short-term-recall" value={selectedAgent?.store.shortTermRecallPath} exists={selectedAgent?.store.shortTermRecallExists} />
                <StorageRow label="phase-signals" value={selectedAgent?.store.phaseSignalsPath} exists={selectedAgent?.store.phaseSignalsExists} />
                <StorageRow label="session-corpus" value={selectedAgent?.store.sessionCorpusDir} exists={selectedAgent?.store.sessionCorpusExists} />
              </Card.Content>
            </Card>
          </div>
        </section>
      </div>
    </DashboardLayout>
  )
}

function toFormState(config: OpenClawDreamingConfigStatus): DreamingFormState {
  return {
    enabled: config.enabled,
    frequency: config.frequency ?? '',
    model: config.model ?? '',
    timezone: config.timezone ?? '',
  }
}

function buildDreamingPatch(form: DreamingFormState, saved: DreamingFormState): OpenClawDreamingConfigPatch | null {
  const patch: OpenClawDreamingConfigPatch = {}
  if (form.enabled !== saved.enabled) patch.enabled = form.enabled
  if (normalizeText(form.frequency) !== normalizeText(saved.frequency)) patch.frequency = normalizeText(form.frequency) || ''
  if (normalizeText(form.timezone) !== normalizeText(saved.timezone)) patch.timezone = normalizeText(form.timezone) || ''
  if (normalizeText(form.model) !== normalizeText(saved.model)) patch.model = normalizeText(form.model) || ''
  return Object.keys(patch).length ? patch : null
}

function selectDreamingAgentFromPayload(payload: OpenClawDreamingResponse | null, agentId?: string) {
  if (!payload) return null
  const normalized = normalizeText(agentId ?? '')

  if (normalized) {
    return payload.agents.find((agent) => normalizeText(agent.id) === normalized) ?? payload.selected
  }

  return payload.selected
}

async function overlayDreamingWithGatewayStatus(payload: OpenClawDreamingResponse, createClient: GatewayClientFactory) {
  const client = await createClient()

  if (!client) return payload

  try {
    return mergeGatewayDreamingStatus(payload, await client.doctorMemoryStatus())
  } catch {
    return payload
  } finally {
    client.close()
  }
}

async function getGatewayDreamDiary(agentId: string, createClient: GatewayClientFactory) {
  const client = await createClient()

  if (!client) return null

  try {
    return gatewayDreamDiaryToResponse(agentId, await client.doctorMemoryDreamDiary())
  } catch {
    return null
  } finally {
    client.close()
  }
}

async function executeGatewayDreamingAction(action: DreamingAction, agentId: string, createClient: GatewayClientFactory) {
  const client = await createClient()

  if (!client) return null

  try {
    const payload = action === 'backfill'
      ? await client.doctorMemoryBackfillDreamDiary({ timeoutMs: 180_000 })
      : action === 'resetDiary'
        ? await client.doctorMemoryResetDreamDiary({ timeoutMs: 60_000 })
        : await client.doctorMemoryResetGroundedShortTerm({ timeoutMs: 60_000 })

    return gatewayDreamingActionToResponse(action, agentId, payload)
  } catch {
    return null
  } finally {
    client.close()
  }
}

function executeDreamingAction(action: DreamingAction, agentId: string) {
  if (action === 'backfill') return backfillOpenClawDreamDiary(agentId)
  if (action === 'resetDiary') return resetOpenClawDreamDiary(agentId)
  return clearOpenClawDreamingGroundedShortTerm(agentId)
}

function dreamingActionSuccessMessage(action: DreamingAction, result: OpenClawDreamingActionResponse) {
  if (action === 'backfill') {
    return `已回填 ${result.written ?? 0} 条梦境日记`
  }
  if (action === 'resetDiary') {
    return `已移除 ${result.removedEntries ?? 0} 条回填日记`
  }
  return `已清空 ${result.removedShortTermEntries ?? 0} 条 grounded 短期记忆`
}

function dreamingActionFailureMessage(action: DreamingAction) {
  if (action === 'backfill') return '梦境日记回填失败'
  if (action === 'resetDiary') return '梦境日记重置失败'
  return 'grounded 短期记忆清空失败'
}

function isSameDreamingForm(a: DreamingFormState, b: DreamingFormState) {
  return normalizeText(a.frequency) === normalizeText(b.frequency)
    && normalizeText(a.model) === normalizeText(b.model)
    && normalizeText(a.timezone) === normalizeText(b.timezone)
    && a.enabled === b.enabled
}

function mergeGatewayDreamingStatus(payload: OpenClawDreamingResponse, gateway: OpenClawDoctorMemoryStatusPayload): OpenClawDreamingResponse {
  const dreaming = configObject(gateway.dreaming)

  if (!Object.keys(dreaming).length) return payload

  return {
    ...payload,
    config: {
      ...payload.config,
      enabled: booleanFromUnknown(dreaming.enabled, payload.config.enabled),
      separateReports: booleanFromUnknown(dreaming.separateReports, payload.config.separateReports),
      storageMode: stringFromUnknown(dreaming.storageMode, payload.config.storageMode),
      timezone: stringFromUnknown(dreaming.timezone, payload.config.timezone ?? ''),
      phases: mergeGatewayDreamingPhases(payload.config.phases, dreaming.phases),
    },
    summary: {
      ...payload.summary,
      dailySignalCount: numberFromUnknown(dreaming.dailySignalCount, payload.summary.dailySignalCount),
      groundedSignalCount: numberFromUnknown(dreaming.groundedSignalCount, payload.summary.groundedSignalCount),
      lightPhaseHitCount: numberFromUnknown(dreaming.lightPhaseHitCount, payload.summary.lightPhaseHitCount),
      phaseSignalCount: numberFromUnknown(dreaming.phaseSignalCount, payload.summary.phaseSignalCount),
      promotedCount: numberFromUnknown(dreaming.promotedTotal, payload.summary.promotedCount),
      recallSignalCount: numberFromUnknown(dreaming.recallSignalCount, payload.summary.recallSignalCount),
      remPhaseHitCount: numberFromUnknown(dreaming.remPhaseHitCount, payload.summary.remPhaseHitCount),
      shortTermCount: numberFromUnknown(dreaming.shortTermCount, payload.summary.shortTermCount),
      totalSignalCount: numberFromUnknown(dreaming.totalSignalCount, payload.summary.totalSignalCount),
    },
  }
}

function mergeGatewayDreamingPhases(
  current: OpenClawDreamingConfigStatus['phases'],
  rawPhases: unknown,
): OpenClawDreamingConfigStatus['phases'] {
  const phases = configObject(rawPhases)

  return {
    deep: mergeGatewayDreamingPhase(current.deep, phases.deep),
    light: mergeGatewayDreamingPhase(current.light, phases.light),
    rem: mergeGatewayDreamingPhase(current.rem, phases.rem),
  }
}

function mergeGatewayDreamingPhase(current: OpenClawDreamingPhaseConfig, rawPhase: unknown) {
  const phase = configObject(rawPhase)

  return {
    ...current,
    enabled: booleanFromUnknown(phase.enabled, current.enabled),
    limit: numberFromUnknown(phase.limit, current.limit),
    lookbackDays: numberFromUnknown(phase.lookbackDays, current.lookbackDays),
    maxAgeDays: numberFromUnknown(phase.maxAgeDays, current.maxAgeDays),
    minPatternStrength: numberFromUnknown(phase.minPatternStrength, current.minPatternStrength),
    minRecallCount: numberFromUnknown(phase.minRecallCount, current.minRecallCount),
    minScore: numberFromUnknown(phase.minScore, current.minScore),
    minUniqueQueries: numberFromUnknown(phase.minUniqueQueries, current.minUniqueQueries),
    recencyHalfLifeDays: numberFromUnknown(phase.recencyHalfLifeDays, current.recencyHalfLifeDays),
  }
}

function gatewayDreamDiaryToResponse(agentId: string, payload: OpenClawDoctorMemoryDreamDiaryPayload): OpenClawDreamDiaryResponse {
  const path = stringFromUnknown(payload.path, 'DREAMS.md')
  const content = typeof payload.content === 'string' ? payload.content : ''
  const exists = payload.found === true
  const updatedAtMs = typeof payload.updatedAtMs === 'number' && Number.isFinite(payload.updatedAtMs)
    ? payload.updatedAtMs
    : undefined

  return {
    agentId: stringFromUnknown(payload.agentId, agentId),
    content: exists ? content : '',
    diary: {
      exists,
      path,
      relativePath: basename(path),
      size: content.length,
      updatedAt: updatedAtMs ? new Date(updatedAtMs).toISOString() : undefined,
    },
    status: 'ok',
    timestamp: new Date().toISOString(),
  }
}

function gatewayDreamingActionToResponse(
  action: DreamingAction,
  agentId: string,
  payload: OpenClawDoctorMemoryDreamActionPayload,
): OpenClawDreamingActionResponse {
  const path = stringFromUnknown(payload.path, 'DREAMS.md')

  return {
    action: action === 'backfill' ? 'backfill' : action === 'resetDiary' ? 'reset' : 'resetGroundedShortTerm',
    agentId,
    diary: {
      exists: payload.found === true,
      path,
      relativePath: basename(path),
    },
    found: payload.found === true,
    path,
    removedEntries: numberFromUnknown(payload.removedEntries, undefined),
    removedShortTermEntries: numberFromUnknown(payload.removedShortTermEntries, undefined),
    replaced: numberFromUnknown(payload.replaced, undefined),
    scannedFiles: numberFromUnknown(payload.scannedFiles, undefined),
    status: 'ok',
    timestamp: new Date().toISOString(),
    written: numberFromUnknown(payload.written, undefined),
  }
}

function normalizeText(value: string) {
  return value.trim()
}

function configObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function getGatewayToken(content?: Record<string, unknown>) {
  const gateway = configObject(configObject(content).gateway)
  const auth = configObject(gateway.auth)
  const token = auth.token

  return typeof token === 'string' && token.trim() ? token.trim() : ''
}

function booleanFromUnknown(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function numberFromUnknown<TFallback extends number | undefined>(value: unknown, fallback: TFallback): number | TFallback {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringFromUnknown(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function basename(value: string) {
  return value.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? value
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

function buildTimezoneOptions(currentTimezone: string): TimezoneOption[] {
  const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  const selected = normalizeText(currentTimezone)
  const ids = [
    ...preferredTimezones,
    systemTimezone,
    selected,
  ].filter(Boolean)
  const seen = new Set<string>()

  return ids.flatMap((id) => {
    if (seen.has(id)) return []
    seen.add(id)
    return [{
      detail: id,
      id,
      label: timezoneLabel(id),
    }]
  })
}

function timezoneLabel(id: string) {
  const known: Record<string, string> = {
    'America/Los_Angeles': '太平洋时间',
    'America/New_York': '纽约时间',
    'Asia/Shanghai': '中国标准时间',
    'Europe/London': '伦敦时间',
    UTC: 'UTC',
  }
  return known[id] ?? id.replaceAll('_', ' ')
}

function formatCount(value?: number) {
  return typeof value === 'number' ? String(value) : '0'
}

function formatDateTime(value?: string) {
  if (!value) return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function HeroDreamingSummary({
  diaryExists,
  enabled,
  isRefreshing,
  onRefresh,
  shortTermCount,
  totalSignalCount,
}: {
  diaryExists?: boolean
  enabled?: boolean
  isRefreshing?: boolean
  onRefresh: () => void
  shortTermCount?: number
  totalSignalCount?: number
}) {
  return (
    <Card className="h-full">
      <Card.Content>
        <div className="grid gap-3">
          <div className="rounded-2xl bg-surface-secondary/50 p-4">
            <div className="flex items-center gap-3">
              <div className={enabled ? 'flex size-11 shrink-0 animate-pulse items-center justify-center rounded-full bg-success/10 text-success shadow-[0_0_18px_color-mix(in_oklch,var(--success)_55%,transparent)]' : 'flex size-11 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning'}>
                <Icon icon={enabled ? 'lucide:moon-star' : 'lucide:moon'} className="size-5" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-foreground">
                  {enabled ? 'Running...' : 'Stopped...'}
                </div>
              </div>
              <Button size="sm" isIconOnly className="ml-auto shrink-0" variant={isRefreshing ? 'primary' : 'ghost'} isDisabled={isRefreshing} onPress={onRefresh}>
                <Icon icon={isRefreshing ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={isRefreshing ? 'animate-spin' : ''} />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-surface-secondary/50 p-4">
              <div>
                <div className="text-sm text-muted">短期</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{formatCount(shortTermCount)}</div>
              </div>
            </div>
            <div className="rounded-2xl bg-surface-secondary/50 p-4">
              <div>
                <div className="text-sm text-muted">信号</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{formatCount(totalSignalCount)}</div>
              </div>
            </div>
            <div className="rounded-2xl bg-surface-secondary/50 p-4">
              <div>
                <div className="text-sm text-muted">日记</div>
                <div className={diaryExists ? 'mt-1 text-sm font-semibold text-success' : 'mt-1 text-sm font-semibold text-warning'}>
                  {diaryExists ? '存在' : '缺失'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function StorageRow({ exists, label, value }: { exists?: boolean, label: string, value?: string }) {
  return (
    <div className="rounded-2xl bg-surface-secondary/50 px-4 py-3 text-sm">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <span className={`size-2 shrink-0 rounded-full ${exists ? 'bg-success' : 'bg-warning'}`} aria-label={exists ? '存在' : '缺失'} />
          <span>{label}</span>
        </p>
        <p className="mt-1 truncate text-left text-muted" dir="rtl"><span dir="ltr">{value || '未知'}</span></p>
      </div>
    </div>
  )
}

function AgentSelect({
  agents,
  isDisabled,
  onChange,
  value,
}: {
  agents: OpenClawDreamingResponse['agents']
  isDisabled?: boolean
  onChange: (value: string) => void
  value: string
}) {
  const selectedAgent = agents.find((agent) => agent.id === value) ?? agents[0]
  if (!agents.length) {
    return <Chip size="sm" variant="secondary">无 Agent</Chip>
  }

  return (
    <CellSelect
      aria-label="选择 Dream Diary Agent"
      value={selectedAgent?.id}
      isDisabled={isDisabled}
      variant="secondary"
      onChange={(key) => onChange(String(key))}
    >
      <CellSelect.Trigger className="max-w-full">
        <CellSelect.Value>
          {selectedAgent?.name || selectedAgent?.id || '选择 Agent'}
        </CellSelect.Value>
        <CellSelect.Indicator />
      </CellSelect.Trigger>
      <CellSelect.Popover>
        <ListBox>
          {agents.map((agent) => (
            <ListBox.Item key={agent.id} id={agent.id} textValue={`${agent.name || ''} ${agent.id}`}>
              <div className="min-w-0">
                <Label className="truncate">{agent.name || agent.id}</Label>
                {/* <p className="mt-1 truncate text-xs text-muted">{agent.id}</p> */}
              </div>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </CellSelect.Popover>
    </CellSelect>
  )
}

function DreamingSettingsGroup({
  configDirty,
  enabled,
  frequency,
  isSaving,
  isSyncing,
  model,
  modelConfigError,
  modelConfigState,
  modelOptions,
  onFrequencyChange,
  onModelChange,
  onRunAction,
  onSave,
  onTimezoneChange,
  onToggle,
  pendingAction,
  pluginId,
  timezone,
  timezoneOptions,
}: {
  configDirty: boolean
  enabled: boolean
  frequency: string
  isSaving: boolean
  isSyncing: boolean
  model: string
  modelConfigError: string
  modelConfigState: LoadState
  modelOptions: AgentModelOption[]
  onFrequencyChange: (value: string) => void
  onModelChange: (value: string) => void
  onRunAction: (action: DreamingAction) => void
  onSave: () => void
  onTimezoneChange: (value: string) => void
  onToggle: (value: boolean) => void
  pendingAction: DreamingAction | null
  pluginId: string
  timezone: string
  timezoneOptions: TimezoneOption[]
}) {
  const [confirmAction, setConfirmAction] = useState<DreamingAction | null>(null)
  const confirmMeta = confirmAction ? dreamingActionMeta[confirmAction] : null

  return (
    <>
      <ItemCardGroup>
        <ItemCardGroup.Header>
          <div className="flex items-start justify-between gap-3">
            <div>
              <ItemCardGroup.Title>Dreaming 设置</ItemCardGroup.Title>
              <ItemCardGroup.Description>配置梦境模式运行方式</ItemCardGroup.Description>
            </div>
            {configDirty || isSaving ? (
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="primary" isPending={isSaving} isDisabled={isSaving || !configDirty} onPress={onSave}>
                  <Icon icon="lucide:save" className="size-4" />
                  保存
                </Button>
              </div>
            ) : null}
            <Chip size="sm" variant="secondary">{pluginId}</Chip>
          </div>
        </ItemCardGroup.Header>
        <SettingItem icon="lucide:power" title="Dreaming">
          <Switch
            size="lg"
            aria-label="启用 Dreaming"
            isDisabled={isSyncing}
            isSelected={enabled}
            onChange={onToggle}
          >
            <Switch.Control><Switch.Thumb /></Switch.Control>
          </Switch>
        </SettingItem>
        <Separator />
        <SettingItem icon="lucide:calendar-clock" title="频率">
          <Input
            fullWidth
            aria-label="Dreaming 频率"
            variant="secondary"
            value={frequency}
            disabled={isSaving}
            placeholder="0 3 * * *"
            onChange={(event) => onFrequencyChange(event.target.value)}
          />
        </SettingItem>
        <Separator />
        <SettingItem icon="lucide:globe-2" title="时区">
          <TimezoneSelect
            options={timezoneOptions}
            value={timezone}
            isDisabled={isSaving}
            onChange={onTimezoneChange}
          />
        </SettingItem>
        <Separator />
        <SettingItem icon="lucide:brain" title="模型">
          <DreamingModelSelect
            error={modelConfigError}
            loadState={modelConfigState}
            options={modelOptions}
            value={model}
            isDisabled={isSaving}
            onChange={onModelChange}
          />
        </SettingItem>
      </ItemCardGroup>

      <ItemCardGroup>
        <SettingItem icon="lucide:archive-restore" title="回填梦境日记">
          <Button
            size="sm"
            variant="tertiary"
            isPending={pendingAction === 'backfill'}
            isDisabled={Boolean(pendingAction)}
            onPress={() => setConfirmAction('backfill')}
          >
            回填
          </Button>
        </SettingItem>
        <Separator />
        <SettingItem icon="lucide:rotate-ccw" title="重置梦境日记">
          <Button
            size="sm"
            variant="tertiary"
            isPending={pendingAction === 'resetDiary'}
            isDisabled={Boolean(pendingAction)}
            onPress={() => setConfirmAction('resetDiary')}
          >
            重置
          </Button>
        </SettingItem>
        <Separator />
        <SettingItem icon="lucide:eraser" title="清空 grounded 短期记忆">
          <Button
            size="sm"
            variant="tertiary"
            isPending={pendingAction === 'clearGrounded'}
            isDisabled={Boolean(pendingAction)}
            onPress={() => setConfirmAction('clearGrounded')}
          >
            清空
          </Button>
        </SettingItem>
      </ItemCardGroup>

      <AlertDialog.Backdrop isOpen={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[420px]">
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status={confirmAction === 'backfill' ? 'warning' : 'danger'} />
              <AlertDialog.Heading>{confirmMeta?.title}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>{confirmMeta?.body}</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="tertiary" onPress={() => setConfirmAction(null)}>取消</Button>
              <Button
                variant={confirmAction === 'backfill' ? 'primary' : 'danger'}
                isDisabled={Boolean(pendingAction)}
                onPress={() => {
                  if (!confirmAction) return
                  const action = confirmAction
                  setConfirmAction(null)
                  onRunAction(action)
                }}
              >
                {confirmMeta?.confirmLabel}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  )
}

function SettingItem({
  actionClassName = 'w-full min-w-0 sm:w-auto',
  children,
  icon,
  title,
}: {
  actionClassName?: string
  children: ReactNode
  icon: string
  title: string
}) {
  return (
    <ItemCard>
      <ItemCard.Icon>
        <Icon icon={icon} />
      </ItemCard.Icon>
      <ItemCard.Content>
        <ItemCard.Title>{title}</ItemCard.Title>
      </ItemCard.Content>
      <ItemCard.Action>
        <div className={actionClassName}>{children}</div>
      </ItemCard.Action>
    </ItemCard>
  )
}

function TimezoneSelect({
  isDisabled,
  onChange,
  options,
  value,
}: {
  isDisabled?: boolean
  onChange: (value: string) => void
  options: TimezoneOption[]
  value: string
}) {
  const selectedOption = options.find((option) => option.id === value)
  const selectedKey = selectedOption ? selectedOption.id : defaultTimezoneKey
  return (
    <CellSelect
      aria-label="Dreaming 时区"
      value={selectedKey}
      isDisabled={isDisabled}
      variant="secondary"
      onChange={(key) => onChange(String(key) === defaultTimezoneKey ? '' : String(key))}
    >
      <CellSelect.Trigger className="max-w-full">
        <CellSelect.Value>
          {selectedOption?.label ?? '默认时区'}
        </CellSelect.Value>
        <CellSelect.Indicator />
      </CellSelect.Trigger>
      <CellSelect.Popover>
        <ListBox>
          <ListBox.Item id={defaultTimezoneKey} textValue="默认时区">
            默认时区
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={`${option.label} ${option.detail}`}>
              <div className="min-w-0">
                <Label className="truncate">{option.label}</Label>
                <p className="mt-1 truncate text-xs text-muted">{option.detail}</p>
              </div>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </CellSelect.Popover>
    </CellSelect>
  )
}

function DreamingModelSelect({
  error,
  isDisabled,
  loadState,
  onChange,
  options,
  value,
}: {
  error: string
  isDisabled?: boolean
  loadState: LoadState
  onChange: (value: string) => void
  options: AgentModelOption[]
  value: string
}) {
  const selectedOption = options.find((option) => option.value === value)
  const selectedKey = value || '__default_model__'
  const hasMissingCurrentModel = Boolean(value && !selectedOption && options.length)

  if (loadState === 'idle' || loadState === 'loading') {
    return <Skeleton className="h-9 w-full rounded-2xl" />
  }

  if (!options.length) {
    return (
      <Button
        size="sm"
        variant="tertiary"
        onPress={() => {
          window.location.href = '/dashboard/openclaw-models'
        }}
      >
        <Icon icon="lucide:plus" className="size-4" />
        {error ? '重新配置' : '添加模型'}
      </Button>
    )
  }

  return (
    <div className="space-y-1">
      <CellSelect
        aria-label="Dream Diary 模型"
        value={selectedKey}
        isDisabled={isDisabled}
        variant="secondary"
        onChange={(key) => onChange(String(key) === '__default_model__' ? '' : String(key))}
      >
        <CellSelect.Trigger className="max-w-full">
          <CellSelect.Value>
            {selectedOption?.label ?? (value ? '未配置模型' : '默认模型')}
          </CellSelect.Value>
          <CellSelect.Indicator />
        </CellSelect.Trigger>
        <CellSelect.Popover>
          <ListBox>
            <ListBox.Item id="__default_model__" textValue="默认模型">
              默认模型
              <ListBox.ItemIndicator />
            </ListBox.Item>
            {options.map((option) => (
              <ListBox.Item key={option.value} id={option.value} textValue={`${option.label} ${option.value}`}>
                <div className="min-w-0">
                  <Label className="truncate">{option.label}</Label>
                  <p className="mt-1 truncate text-xs text-muted">{option.providerKey}/{option.modelId}</p>
                </div>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </CellSelect.Popover>
      </CellSelect>
      {hasMissingCurrentModel ? (
        <p className="text-xs leading-5 text-warning">
          当前模型不在已添加模型中，请重新选择。
        </p>
      ) : null}
    </div>
  )
}

function PhaseCard({ config, title }: { config?: OpenClawDreamingPhaseConfig, title: string }) {
  const items = [
    // { label: '启用', value: config?.enabled ? '是' : '否' },
    { label: 'Limit', value: formatValue(config?.limit) },
    { label: 'Lookback', value: formatValue(config?.lookbackDays) },
    { label: 'Min Score', value: formatValue(config?.minScore) },
    { label: 'Min Recall', value: formatValue(config?.minRecallCount) },
    { label: 'Min Unique', value: formatValue(config?.minUniqueQueries) },
    { label: 'Half-life', value: formatValue(config?.recencyHalfLifeDays) },
    { label: 'Max Age', value: formatValue(config?.maxAgeDays) },
    { label: 'Pattern', value: formatValue(config?.minPatternStrength) },
  ]

  return (
    <div className="rounded-2xl bg-surface-secondary/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-foreground">{title}</p>
        <span
          className={`size-2.5 rounded-full ${config?.enabled ? 'bg-success shadow-[0_0_12px_color-mix(in_oklch,var(--success)_80%,transparent)]' : 'bg-muted shadow-[0_0_10px_color-mix(in_oklch,var(--muted)_60%,transparent)]'}`}
          aria-label={config?.enabled ? 'on' : 'off'}
        />
      </div>
      <div className="mt-3 grid gap-2 text-sm">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 border-b border-divider/60 pb-2 last:border-0 last:pb-0">
            <span className="text-muted">{item.label}</span>
            <span className="break-all text-foreground">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatValue(value?: number | boolean) {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2)
  return '—'
}

export default OpenClawDreamingPage
