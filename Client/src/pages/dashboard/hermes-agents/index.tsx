import { type SVGProps, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Key } from '@heroui/react'
import { AlertDialog, Button, Card, Checkbox, Chip, Description, Dropdown, Input, Label, ListBox, Modal, Separator, Skeleton, toast } from '@heroui/react'
import { CellSelect, ItemCard, ItemCardGroup, PieChart, RadioButtonGroup, Segment } from '@heroui-pro/react'
import Editor from '@monaco-editor/react'
import { Icon } from '@iconify/react'
import type { HermesAgentDetailResponse, HermesAgentInfo, HermesAgentsResponse, HermesProfileFile, HermesTextFileResponse } from '@/api'
import { createHermesAgent, deleteHermesAgent, getHermesAgent, getHermesAgentFile, listHermesAgents, renameHermesAgent, updateHermesAgentFile, useHermesAgent as setHermesActiveAgent } from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { useHermesAgentStore } from '@/stores/hermes-agent'
import { useThemeStore } from '@/stores/theme'
import { HermesLoadErrorCard } from '../hermes-shared/HermesLoadErrorCard'

type HermesAgentTab = 'overview' | 'config' | 'env' | 'memory'
type HermesMemoryFileKey = 'memory' | 'soul' | 'user'
type CloneMode = 'fresh' | 'clone' | 'clone-all'

const numberFormatter = new Intl.NumberFormat('zh-CN')

const chartColors = {
  active: 'var(--accent)',
  running: 'var(--success)',
  configured: 'var(--warning)',
  idle: 'var(--muted)',
}

const agentsHeroGridStroke = 'rgba(247, 247, 247, 1)'

function AgentsHeroIllustration(props: Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'xmlns'>) {
  const { className, ...rest } = props
  const accentSoft = 'color-mix(in oklch, var(--accent) 36%, white)'
  const accentDeep = 'color-mix(in oklch, var(--accent), black 0%)'
  const accentBright = 'color-mix(in oklch, var(--accent), white 26%)'
  const platformGradId = 'hermesAgentsHeroPlatformGrad'
  const vb = { x: 146, y: 0, w: 308, h: 241 }
  const gx0 = vb.x
  const gx1 = vb.x + vb.w

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} fill="none" className={className} aria-hidden {...rest}>
      <path stroke={agentsHeroGridStroke} strokeWidth={2} d={`M${gx0} 240H${gx1}`} />
      <path stroke={agentsHeroGridStroke} strokeWidth={2} d={`M${gx0} 200H${gx1}`} />
      <rect x="179" y="200" width="240" height="40" fill={`url(#${platformGradId})`} />
      <rect x="159" y="220" width="280" height="20" fill={accentSoft} />
      <path fill="#F7F7F7" d="M319 0 379 0 419 39.9937 419 120.011 319 120.011 319 0z" />
      <rect x="339" y="50" width="60" height="10" fill="#EBECEC" />
      <rect x="339" y="70" width="60" height="10" fill="#EBECEC" />
      <path fill="#EBECEC" d="M279 40 339 40 379 79.9937 379 160.011 279 160.011 279 40z" />
      <rect x="299" y="90" width="60" height="10" fill="#FFFFFF" />
      <rect x="299" y="110" width="60" height="10" fill="#FFFFFF" />
      <path fill="#F7F7F7" d="M239 80 299 80 339 119.994 339 200.011 239 200.011 239 80z" />
      <rect x="259" y="130" width="60" height="10" fill="#EBECEC" />
      <rect x="259" y="150" width="60" height="10" fill="#EBECEC" />
      <path fill="#C3C5C6" d="M299 80 339 120 299 120 299 80z" />
      <path stroke="var(--accent)" strokeWidth={5} d="M219 151.683V130h60v21.683" />
      <rect x="199" y="150" width="100" height="50" fill={accentSoft} />
      <rect x="199" y="180" width="100" height="5" fill="var(--accent)" />
      <rect x="216.5" y="192.5" width="20" height="10" fill={accentDeep} transform="rotate(-90 216.5 192.5)" />
      <rect x="271.5" y="192.5" width="20" height="10" fill={accentDeep} transform="rotate(-90 271.5 192.5)" />
      <defs>
        <linearGradient id={platformGradId} x1="419" y1="220" x2="179" y2="220" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={accentDeep} />
          <stop offset="0.52" stopColor="var(--accent)" />
          <stop offset="1" stopColor={accentBright} />
        </linearGradient>
      </defs>
    </svg>
  )
}

function HermesAgentsPage() {
  usePageTitle('Hermes 智能体')
  const isDark = useThemeStore((store) => store.isDark)
  const sharedSelectedName = useHermesAgentStore((store) => store.selectedName)
  const selectSharedAgent = useHermesAgentStore((store) => store.selectAgent)
  const loadSharedAgents = useHermesAgentStore((store) => store.loadAgents)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [data, setData] = useState<HermesAgentsResponse | null>(null)
  const [error, setError] = useState('')
  const [selectedName, setSelectedName] = useState('')
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [detailData, setDetailData] = useState<HermesAgentDetailResponse | null>(null)
  const [detailError, setDetailError] = useState('')
  const [activeTab, setActiveTab] = useState<HermesAgentTab>('overview')
  const [fileState, setFileState] = useState<'idle' | 'loading' | 'saving' | 'ready' | 'error'>('idle')
  const [fileData, setFileData] = useState<HermesTextFileResponse | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [fileError, setFileError] = useState('')
  const [selectedMemoryFile, setSelectedMemoryFile] = useState<HermesMemoryFileKey>('memory')
  const [createOpen, setCreateOpen] = useState(false)
  const [createState, setCreateState] = useState<'idle' | 'saving'>('idle')
  const [createError, setCreateError] = useState('')
  const [createForm, setCreateForm] = useState({ name: '', cloneMode: 'fresh' as CloneMode, cloneFrom: 'default', noSkills: false })
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameState, setRenameState] = useState<'idle' | 'saving'>('idle')
  const [renameError, setRenameError] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteState, setDeleteState] = useState<'idle' | 'deleting'>('idle')
  const [useStateName, setUseStateName] = useState('')

  const profiles = useMemo(() => data?.profiles ?? [], [data?.profiles])
  const selectedProfile = useMemo(() => profiles.find((profile) => profile.name === selectedName) ?? detailData?.profile ?? null, [detailData?.profile, profiles, selectedName])
  const editableFileKey = activeTab === 'config' || activeTab === 'env' ? activeTab : activeTab === 'memory' ? selectedMemoryFile : ''
  const selectedFileMeta = selectedProfile && editableFileKey ? getProfileFileMeta(selectedProfile, editableFileKey) : null
  const isFileDirty = fileContent !== (fileData?.content ?? '')
  const editorLanguage = activeTab === 'env' ? 'shell' : activeTab === 'memory' ? 'markdown' : 'yaml'
  const editorTheme = isDark ? 'vs-dark' : 'vs'

  const loadAgents = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const payload = await listHermesAgents()
      setData(payload)
      setState('ready')
      setSelectedName((current) => {
        if (sharedSelectedName && payload.profiles.some((profile) => profile.name === sharedSelectedName)) return sharedSelectedName
        if (current && payload.profiles.some((profile) => profile.name === current)) return current
        return payload.profiles.find((profile) => profile.isActive)?.name || payload.profiles[0]?.name || ''
      })
      return payload
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hermes 智能体加载失败')
      setState('error')
      return null
    }
  }, [sharedSelectedName])

  const loadDetail = useCallback(async (name: string) => {
    if (!name) return null
    setDetailState('loading')
    setDetailError('')
    try {
      const payload = await getHermesAgent(name)
      setDetailData(payload)
      setDetailState('ready')
      return payload
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Hermes 智能体详情加载失败')
      setDetailState('error')
      return null
    }
  }, [])

  const loadFile = useCallback(async (name: string, file: string) => {
    if (!name || !file) return null
    setFileState('loading')
    setFileError('')
    try {
      const payload = await getHermesAgentFile(name, file)
      setFileData(payload)
      setFileContent(payload.content ?? '')
      setFileState('ready')
      return payload
    } catch (err) {
      setFileData(null)
      setFileContent('')
      setFileError(err instanceof Error ? err.message : '文件加载失败')
      setFileState('error')
      return null
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAgents()
      void loadSharedAgents(false)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAgents, loadSharedAgents])

  useEffect(() => {
    if (!sharedSelectedName || sharedSelectedName === selectedName) return
    if (profiles.length && !profiles.some((profile) => profile.name === sharedSelectedName)) return
    const frame = window.requestAnimationFrame(() => {
      setSelectedName(sharedSelectedName)
      setActiveTab('overview')
    })
    return () => window.cancelAnimationFrame(frame)
  }, [profiles, selectedName, sharedSelectedName])

  useEffect(() => {
    if (!selectedName || selectedName === sharedSelectedName) return
    selectSharedAgent(selectedName)
  }, [selectSharedAgent, selectedName, sharedSelectedName])

  useEffect(() => {
    if (!selectedName) return
    const timer = window.setTimeout(() => {
      void loadDetail(selectedName)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadDetail, selectedName])

  useEffect(() => {
    if (!selectedName || !editableFileKey) return
    const timer = window.setTimeout(() => {
      void loadFile(selectedName, editableFileKey)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [editableFileKey, loadFile, selectedName])

  useEffect(() => {
    if (activeTab !== 'memory') return
    if (!selectedMemoryFile) {
      const frame = window.requestAnimationFrame(() => setSelectedMemoryFile('memory'))
      return () => window.cancelAnimationFrame(frame)
    }
  }, [activeTab, selectedMemoryFile])

  const refreshAgents = useCallback(async () => {
    const payload = await loadAgents()
    if (selectedName && payload?.profiles.some((profile) => profile.name === selectedName)) {
      await loadDetail(selectedName)
    }
  }, [loadAgents, loadDetail, selectedName])

  const saveFile = useCallback(async () => {
    if (!selectedName || !editableFileKey) return
    setFileState('saving')
    setFileError('')
    try {
      const payload = await updateHermesAgentFile(selectedName, editableFileKey, fileContent)
      setFileData(payload)
      setFileContent(payload.content ?? '')
      setFileState('ready')
      toast.success('文件已保存')
      await loadAgents()
      await loadDetail(selectedName)
    } catch (err) {
      setFileError(err instanceof Error ? err.message : '文件保存失败')
      setFileState('error')
      toast.warning('文件保存失败')
    }
  }, [editableFileKey, fileContent, loadAgents, loadDetail, selectedName])

  const createProfile = useCallback(async () => {
    setCreateState('saving')
    setCreateError('')
    try {
      const payload = await createHermesAgent({
        name: createForm.name.trim(),
        cloneMode: createForm.cloneMode,
        cloneFrom: createForm.cloneMode === 'fresh' ? undefined : createForm.cloneFrom.trim() || 'default',
        noSkills: createForm.cloneMode === 'fresh' ? createForm.noSkills : false,
      })
      toast.success('Hermes 智能体已创建')
      setCreateOpen(false)
      setCreateForm({ name: '', cloneMode: 'fresh', cloneFrom: 'default', noSkills: false })
      await loadAgents()
      await loadSharedAgents(true)
      setSelectedName(payload.name)
      selectSharedAgent(payload.name)
      setActiveTab('overview')
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '创建失败')
      toast.warning('创建失败')
    } finally {
      setCreateState('idle')
    }
  }, [createForm, loadAgents, loadSharedAgents, selectSharedAgent])

  const renameProfile = useCallback(async () => {
    if (!selectedProfile) return
    setRenameState('saving')
    setRenameError('')
    try {
      const payload = await renameHermesAgent(selectedProfile.name, { newName: renameValue.trim() })
      toast.success('Hermes 智能体已重命名')
      setRenameOpen(false)
      await loadAgents()
      await loadSharedAgents(true)
      setSelectedName(payload.name)
      selectSharedAgent(payload.name)
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : '重命名失败')
      toast.warning('重命名失败')
    } finally {
      setRenameState('idle')
    }
  }, [loadAgents, loadSharedAgents, renameValue, selectSharedAgent, selectedProfile])

  const deleteProfile = useCallback(async () => {
    if (!selectedProfile || selectedProfile.isDefault) return
    setDeleteState('deleting')
    try {
      await deleteHermesAgent(selectedProfile.name)
      toast.success('Hermes 智能体已删除')
      setDeleteOpen(false)
      setSelectedName('')
      await loadAgents()
      await loadSharedAgents(true)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeleteState('idle')
    }
  }, [loadAgents, loadSharedAgents, selectedProfile])

  const makeActive = useCallback(async (profile: HermesAgentInfo) => {
    setUseStateName(profile.name)
    try {
      await setHermesActiveAgent(profile.name)
      toast.success('默认 Hermes 智能体已切换')
      await loadAgents()
      await loadSharedAgents(true)
      selectSharedAgent(profile.name)
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '切换失败')
    } finally {
      setUseStateName('')
    }
  }, [loadAgents, loadSharedAgents, selectSharedAgent])

  const openRename = useCallback((profile: HermesAgentInfo) => {
    setRenameValue(profile.name)
    setRenameError('')
    setRenameOpen(true)
  }, [])

  const copyText = useCallback(async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(message)
    } catch {
      toast.warning('复制失败')
    }
  }, [])

  const isLoading = state === 'loading' && !data
  const hasBlockingLoadError = Boolean(error && !data)

  return (
    <DashboardLayout>
      <div className={hasBlockingLoadError ? 'flex min-h-[calc(100dvh-8rem)] items-center justify-center' : 'mx-auto flex max-w-7xl flex-col gap-6'}>
        {hasBlockingLoadError ? (
          <HermesLoadErrorCard
            error={error}
            isRetrying={state === 'loading'}
            title="无法加载 Hermes 智能体"
            onRetry={() => void loadAgents()}
          />
        ) : null}

        {error && data ? (
          <Card>
            <Card.Content>
              <div className="flex items-start gap-3 text-danger">
                <Icon icon="lucide:circle-alert" className="mt-0.5 size-5" />
                <div>
                  <p className="font-medium">Hermes 智能体刷新失败</p>
                  <p className="mt-1 text-sm text-muted">{error}</p>
                </div>
              </div>
            </Card.Content>
          </Card>
        ) : null}

        {!hasBlockingLoadError ? (
          <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
            <Card variant="transparent" className="h-full overflow-visible">
              <Card.Content className="flex h-full items-center justify-start overflow-visible">
                <div className="flex w-full flex-row items-center  gap-4 overflow-visible md:gap-6">
                  <div className="flex h-36 shrink-0 items-center justify-center overflow-visible p-1 drop-shadow-[0_8px_14px_color-mix(in_oklch,var(--accent)_28%,transparent)]">
                    <AgentsHeroIllustration className="h-full w-auto md:scale-105" />
                  </div>
                  <div className="flex min-w-0 w-full flex-col gap-5">
                    <div className="min-w-0 flex flex-col gap-1">
                      <Card.Title className="text-2xl font-bold md:text-3xl">Agents</Card.Title>
                      <Card.Description className="mt-4 text-base md:text-lg">多 Profile：独立 Home、配置、环境变量与网关。</Card.Description>
                      <Button className="mt-4" size="sm" variant="primary" onPress={() => setCreateOpen(true)}>
                        <Icon icon="lucide:user-plus" className="size-4" />
                        新建Agent
                      </Button>
                    </div>
                  </div>
                </div>
              </Card.Content>
            </Card>

            {data ? <HermesAgentDistributionCard data={data} /> : <Skeleton className="h-full min-h-[190px] rounded-2xl" />}
          </section>
        ) : null}

        {isLoading ? <HermesAgentsSkeleton /> : null}

        {data ? (
          <section className="flex flex-col gap-6">
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                  {selectedProfile ? (
                    <ProfileSelectDropdown
                      profiles={profiles}
                      selectedName={selectedName}
                      onSelect={(name) => {
                        setSelectedName(name)
                        selectSharedAgent(name)
                        setActiveTab('overview')
                      }}
                    />
                  ) : null}

                  <Segment selectedKey={activeTab} onSelectionChange={(key) => setActiveTab(String(key) as HermesAgentTab)}>
                    <Segment.Item id="overview">
                      <Segment.Separator />
                      概览
                    </Segment.Item>
                    <Segment.Item id="config">
                      <Segment.Separator />
                      配置文件
                    </Segment.Item>
                    <Segment.Item id="env">
                      <Segment.Separator />
                      环境变量
                    </Segment.Item>
                    <Segment.Item id="memory">
                      <Segment.Separator />
                      记忆
                    </Segment.Item>
                  </Segment>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {(activeTab === 'config' || activeTab === 'env') && selectedProfile && isFileDirty ? (
                    <Button size="sm" variant="primary" onPress={saveFile} isDisabled={fileState === 'loading' || fileState === 'saving'}>
                      <Icon icon={fileState === 'saving' ? 'lucide:loader-circle' : 'lucide:save'} className={fileState === 'saving' ? 'animate-spin' : ''} />
                      保存
                    </Button>
                  ) : null}
                  {activeTab === 'overview' && selectedProfile ? (
                    <>
                      <Button size="sm" variant="tertiary" onPress={() => makeActive(selectedProfile)} isDisabled={selectedProfile.isActive || Boolean(useStateName)}>
                        <Icon icon={useStateName === selectedProfile.name ? 'lucide:loader-circle' : 'lucide:badge-check'} className={useStateName === selectedProfile.name ? 'animate-spin' : ''} />
                        设为默认
                      </Button>
                      <Button size="sm" variant="tertiary" onPress={() => openRename(selectedProfile)} isDisabled={selectedProfile.isDefault}>
                        <Icon icon="lucide:pencil" className="size-4" />
                        编辑
                      </Button>
                      {!selectedProfile.isDefault ? (
                        <Button size="sm" variant="danger" onPress={() => setDeleteOpen(true)} isDisabled={deleteState === 'deleting'}>
                          <Icon icon={deleteState === 'deleting' ? 'lucide:loader-circle' : 'lucide:trash-2'} className={deleteState === 'deleting' ? 'animate-spin' : ''} />
                          卸载
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    onPress={() => {
                      if (selectedProfile && editableFileKey) {
                        void loadFile(selectedProfile.name, editableFileKey)
                        return
                      }
                      void refreshAgents()
                    }}
                    isDisabled={state === 'loading' || fileState === 'loading' || fileState === 'saving'}
                  >
                    <Icon icon={state === 'loading' || fileState === 'loading' || fileState === 'saving' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' || fileState === 'loading' || fileState === 'saving' ? 'animate-spin' : ''} />
                  </Button>
                </div>
              </div>

              <Card className="relative overflow-visible">
                <Card.Content>
                  {detailError && !detailData ? (
                    <InlineError title="智能体详情加载失败" message={detailError} onRetry={() => selectedName && loadDetail(selectedName)} />
                  ) : null}

                  {selectedProfile ? (
                    <>
                      {activeTab === 'overview' ? (
                        <ProfileOverview profile={detailData?.profile ?? selectedProfile} isLoading={detailState === 'loading' && !detailData} onCopy={copyText} />
                      ) : activeTab === 'memory' ? (
                        <HermesMemoryPanel
                          files={detailData?.memory ?? getHermesMemoryFiles(selectedProfile)}
                          selectedKey={selectedMemoryFile}
                          content={fileContent}
                          error={fileError}
                          isDirty={isFileDirty}
                          isLoading={fileState === 'loading'}
                          isSaving={fileState === 'saving'}
                          onSelectKey={setSelectedMemoryFile}
                          onContentChange={setFileContent}
                          onReload={() => loadFile(selectedProfile.name, selectedMemoryFile)}
                          onSave={saveFile}
                          onCopy={() => copyText(fileContent, '记忆内容已复制')}
                        />
                      ) : (
                        <ProfileFileEditor
                          fileKey={editableFileKey}
                          profile={selectedProfile}
                          content={fileContent}
                          error={fileError}
                          isDirty={isFileDirty}
                          isLoading={fileState === 'loading'}
                          isSaving={fileState === 'saving'}
                          language={editorLanguage}
                          theme={editorTheme}
                          exists={fileData?.exists ?? selectedFileMeta?.exists}
                          path={fileData?.path ?? selectedFileMeta?.path}
                          onChange={setFileContent}
                          onReload={() => loadFile(selectedProfile.name, editableFileKey)}
                          onSave={saveFile}
                        />
                      )}
                    </>
                  ) : (
                    <EmptyState className="min-h-[460px]" title="还没有 Hermes Profile" description="创建一个 Profile 后即可在这里管理它。" icon="lucide:users-round" />
                  )}
                </Card.Content>
              </Card>
            </div>
          </section>
        ) : null}
      </div>

      <CreateProfileModal
        isOpen={createOpen}
        value={createForm}
        error={createError}
        isSaving={createState === 'saving'}
        profiles={profiles}
        onChange={setCreateForm}
        onCancel={() => {
          setCreateOpen(false)
          setCreateError('')
        }}
        onSave={createProfile}
      />

      <RenameProfileModal
        isOpen={renameOpen}
        value={renameValue}
        error={renameError}
        isSaving={renameState === 'saving'}
        onChange={setRenameValue}
        onCancel={() => {
          setRenameOpen(false)
          setRenameError('')
        }}
        onSave={renameProfile}
      />

      <DeleteProfileDialog
        isOpen={deleteOpen}
        profile={selectedProfile}
        isDeleting={deleteState === 'deleting'}
        onOpenChange={setDeleteOpen}
        onDelete={deleteProfile}
      />
    </DashboardLayout>
  )
}

function HermesAgentDistributionCard({ data }: { data: HermesAgentsResponse }) {
  const chartData = [
    { name: '默认', value: data.summary.active, fill: chartColors.active },
    { name: '运行中', value: data.summary.running, fill: chartColors.running },
    { name: '已配置', value: Math.max(0, data.summary.withEnv + data.summary.withSoul - data.summary.running - data.summary.active), fill: chartColors.configured },
  ].filter((item) => item.value > 0)
  const displayData = chartData.length ? chartData : [{ name: '暂无数据', value: 1, fill: 'var(--surface-secondary)' }]

  return (
    <Card className="h-full">
      <Card.Content className="flex h-full items-center">
        <div className="flex w-full items-center gap-6">
          <div className="relative shrink-0">
            <PieChart height={160} width={160}>
              <PieChart.Pie cx="50%" cy="50%" data={displayData} dataKey="value" innerRadius="56%" nameKey="name" strokeWidth={0}>
                {displayData.map((item) => (
                  <PieChart.Cell key={item.name} fill={item.fill} />
                ))}
              </PieChart.Pie>
              <PieChart.Tooltip content={<PieChart.TooltipContent />} />
            </PieChart>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold tabular-nums text-foreground">{numberFormatter.format(data.summary.total)}</span>
              <span className="text-[10px] text-muted">全部</span>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <LegendItem label="默认" value={data.summary.active} color={chartColors.active} />
            <LegendItem label="运行中" value={data.summary.running} color={chartColors.running} />
            <LegendItem label="有 .env" value={data.summary.withEnv} color={chartColors.configured} />
            <LegendItem label="技能" value={data.summary.skillCount} color={chartColors.idle} />
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function ProfileSelectDropdown({ profiles, selectedName, onSelect }: { profiles: HermesAgentInfo[]; selectedName: string; onSelect: (name: string) => void }) {
  const selectedProfile = profiles.find((profile) => profile.name === selectedName) ?? profiles[0]
  if (!selectedProfile) return null

  return (
    <Dropdown>
      <Button variant="tertiary" className="min-w-0 rounded-full pl-1 pr-2">
        <ProfileAvatar profile={selectedProfile} size="sm" />
        <span className="min-w-0 max-w-44 truncate text-sm font-semibold text-foreground">{selectedProfile.displayName || selectedProfile.name}</span>
        {/* {selectedProfile.isActive ? <Chip size="sm" color="accent" variant="soft">默认</Chip> : null} */}
        <Icon icon="lucide:chevron-down" className="size-4 text-muted" />
      </Button>
      <Dropdown.Popover placement="bottom start">

        <Dropdown.Menu selectedKeys={new Set(selectedName ? [selectedName] : [])} selectionMode="single" onAction={(key) => onSelect(String(key))}>
          {profiles.map((profile) => (
            <Dropdown.Item key={profile.name} id={profile.name} textValue={profile.name}>
               <Dropdown.ItemIndicator type="dot" />
              <div className="flex min-w-0 items-center gap-3">
                <ProfileAvatar profile={profile} />
                <div className="min-w-0 flex-1">
                  <Label className="truncate">{profile.displayName || profile.name}</Label>
                  <p className="mt-1 truncate text-xs text-muted">{profile.model || profile.path}</p>
                </div>
                {/* {profile.isActive ? <Chip size="sm" color="accent" variant="soft">默认</Chip> : null} */}
                {/* {profile.name === selectedName ? <Icon icon="lucide:check" className="size-4 shrink-0 text-accent" /> : null} */}
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

function ProfileOverview({ profile, isLoading, onCopy }: { profile: HermesAgentInfo; isLoading: boolean; onCopy: (text: string, message: string) => void }) {
  if (isLoading) {
    return <Skeleton className="h-[460px] rounded-2xl" />
  }

  const rows = [
    { label: 'Profile Path', value: profile.path },
    { label: 'Setup Command', value: profile.setupCommand, copy: true },
    { label: 'Chat Command', value: profile.chatCommand, copy: true },
    { label: 'Skills Dir', value: profile.skillsDir },
    { label: 'Sessions Dir', value: profile.sessionsDir },
    { label: 'Workspace', value: profile.workspaceDir },
    { label: 'Per-profile HOME', value: profile.homeDir },
    { label: 'Memory Dir', value: profile.memoryDir },
  ]

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(440px,1.1fr)]">
        <div className="space-y-4">
          <section className="grid gap-4 sm:grid-cols-2">
            <InfoCard label="Profile" value={profile.name} />
            <InfoCard label="模型" value={profile.model || '-'} />
            <InfoCard label="Provider" value={profile.provider || '-'} />
            <InfoCard label="默认Profile" value={profile.isActive ? '是' : '否'} />
            <InfoCard label="Gateway" value={profile.gatewayRunning ? '运行中' : '已停止'} />
            <InfoCard label="API Server" value={profile.apiServerEnabled ? '启用' : '未启用'} />
            <InfoCard label="Profile Path" value={profile.path || '-'} />
            <InfoCard label="Workspace" value={profile.workspaceDir || '-'} />
          </section>

          <section className="grid grid-cols-3 gap-4">
            <StatusTile label="config.yaml" ok={profile.config.exists} text={profile.config.exists ? '文件存在' : '文件缺失'} />
            <StatusTile label=".env" ok={profile.env.exists} text={profile.env.exists ? '文件存在' : '文件缺失'} />
            <StatusTile label="SOUL.md" ok={profile.soul.exists} text={profile.soul.exists ? '文件存在' : '文件缺失'} />
          </section>

          <div className="rounded-2xl bg-surface-secondary/50 px-4 py-4 text-sm leading-6 text-muted">
            {profile.toolsets?.length ? `Toolsets: ${profile.toolsets.join(' · ')}` : '当前 Profile 未显式配置 toolsets。'}
          </div>
        </div>

        <div className="space-y-4">
          <section className="grid gap-3 sm:grid-cols-2">
            <SummaryCard icon="lucide:sparkles" label="技能" value={profile.skillCount} />
            <SummaryCard icon="lucide:messages-square" label="会话" value={profile.sessionCount} />
            <SummaryCard icon="lucide:scroll-text" label="日志" value={profile.logCount} />
            <SummaryCard icon="lucide:brain" label="记忆文件" value={profile.memoryFileCount} />
          </section>

          <div className="rounded-2xl border border-divider">
            {rows.map((row) => (
              <div key={row.label} className="grid gap-2 border-b border-divider px-4 py-3 last:border-b-0 items-center md:grid-cols-[150px_minmax(0,1fr)_auto]">
                <span className="text-sm text-muted">{row.label}</span>
                <span className="min-w-0 break-all font-mono text-sm text-foreground">{row.value || '—'}</span>
                {row.copy && row.value ? (
                  <Button size="sm" isIconOnly variant="ghost" onPress={() => onCopy(row.value, '已复制')}>
                    <Icon icon="lucide:copy" className="size-4" />
                  </Button>
                ) : <span />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ProfileFileEditor({
  fileKey,
  profile,
  content,
  error,
  exists,
  isDirty,
  isLoading,
  isSaving,
  language,
  path,
  theme,
  onChange,
  onReload,
  onSave,
}: {
  fileKey: string
  profile: HermesAgentInfo
  content: string
  error: string
  exists?: boolean
  isDirty: boolean
  isLoading: boolean
  isSaving: boolean
  language: string
  path?: string
  theme: string
  onChange: (value: string) => void
  onReload: () => void
  onSave: () => void
}) {
  const title = fileKey === 'env' ? '.env' : 'config.yaml'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground">{title}</h3>
            <span
              aria-label={exists ? '文件存在' : '文件不存在'}
              className={`size-2.5 rounded-full ${exists ? 'bg-success shadow-[0_0_10px_color-mix(in_oklch,var(--success)_70%,transparent)]' : 'bg-danger shadow-[0_0_10px_color-mix(in_oklch,var(--danger)_70%,transparent)]'}`}
              title={exists ? '文件存在' : '文件不存在'}
            />
            {isDirty ? <Chip size="sm" color="warning" variant="soft">未保存</Chip> : null}
          </div>
          <p className="mt-1 truncate text-xs text-muted">{path || profile.path}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onPress={onReload} isDisabled={isLoading || isSaving}>
            <Icon icon={isLoading ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={isLoading ? 'animate-spin' : ''} />
            重新读取
          </Button>
          <Button variant="primary" onPress={onSave} isDisabled={!isDirty || isLoading || isSaving}>
            <Icon icon={isSaving ? 'lucide:loader-circle' : 'lucide:save'} className={isSaving ? 'animate-spin' : ''} />
            保存
          </Button>
        </div>
      </div>
      {error ? <div className="rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">{error}</div> : null}
      <div className="h-[calc(100dvh-230px))] overflow-hidden rounded-2xl border border-divider">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Icon icon="lucide:loader-circle" className="size-6 animate-spin text-muted" />
          </div>
        ) : (
          <Editor
            key={`${profile.name}:${fileKey}:${path || ''}`}
            height="100%"
            language={language}
            options={{ automaticLayout: true, fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: 'on' }}
            theme={theme}
            value={content}
            onChange={(value) => onChange(value ?? '')}
          />
        )}
      </div>
    </div>
  )
}

function HermesMemoryPanel({
  files,
  selectedKey,
  content,
  error,
  isDirty,
  isLoading,
  isSaving,
  onSelectKey,
  onContentChange,
  onReload,
  onSave,
  onCopy,
}: {
  files: HermesProfileFile[]
  selectedKey: HermesMemoryFileKey
  content: string
  error: string
  isDirty: boolean
  isLoading: boolean
  isSaving: boolean
  onSelectKey: (key: HermesMemoryFileKey) => void
  onContentChange: (content: string) => void
  onReload: () => void
  onSave: () => void
  onCopy: () => void
}) {
  const selectedFile = files.find((file) => file.key === selectedKey) ?? files[0]

  return (
    <div className="grid min-h-[calc(100dvh-180px)] gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col rounded-2xl bg-surface-secondary/50 p-3">
        <div className="flex items-center justify-between gap-3 px-1 pb-3">
          <div className="min-w-0">
            <p className="font-semibold text-foreground">记忆文件</p>
            <p className="mt-1 text-xs text-muted">MEMORY.md / SOUL.md / USER.md</p>
          </div>
          {isLoading ? <Icon icon="lucide:loader-circle" className="size-4 animate-spin text-muted" /> : <Chip size="sm" variant="soft">{files.length}</Chip>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {files.length ? (
            <RadioButtonGroup
              aria-label="Hermes 记忆文件"
              className="w-full gap-2"
              name="hermes-memory-files"
              value={selectedKey}
              variant="secondary"
              onChange={(value) => onSelectKey(String(value) as HermesMemoryFileKey)}
            >
              {files.map((file) => (
                <RadioButtonGroup.Item
                  key={file.key}
                  className="min-w-0 flex w-full flex-row items-center"
                  value={file.key}
                >
                  <RadioButtonGroup.ItemIcon className={`flex size-9 shrink-0 items-center justify-center rounded-full ${file.exists ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
                    <Icon icon={hermesMemoryIcon(file.key)} className="size-4" />
                  </RadioButtonGroup.ItemIcon>
                  <RadioButtonGroup.ItemContent className="min-w-0">
                    <Label className="block truncate text-sm font-medium">{hermesMemoryLabel(file.key)}</Label>
                    <Description className="mt-1 block truncate text-xs">
                      {file.label} · {formatBytes(file.bytes)} · {file.exists ? '已创建' : '未创建'}
                    </Description>
                  </RadioButtonGroup.ItemContent>
                  <RadioButtonGroup.Indicator />
                </RadioButtonGroup.Item>
              ))}
            </RadioButtonGroup>
          ) : (
            <EmptyState text="暂无记忆文件。" />
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-col rounded-2xl bg-surface-secondary/50 p-3">
        <div className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 px-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-semibold text-foreground">{selectedFile ? hermesMemoryLabel(selectedFile.key) : '记忆内容'}</p>
              {isDirty ? <Chip size="sm" color="warning" variant="soft">未保存</Chip> : null}
            </div>
            <p className="mt-1 truncate text-xs text-muted">{selectedFile?.path || '选择左侧文件查看内容'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button isIconOnly size="sm" variant="ghost" aria-label="复制记忆内容" onPress={onCopy} isDisabled={!selectedFile || isLoading || isSaving}>
              <Icon icon="lucide:copy" className="size-4" />
            </Button>
            <Button size="sm" variant="ghost" onPress={onReload} isDisabled={!selectedFile || isLoading || isSaving}>
              <Icon icon={isLoading ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={isLoading ? 'animate-spin' : ''} />
              重新读取
            </Button>
            <Button size="sm" variant="primary" onPress={onSave} isDisabled={!selectedFile || !isDirty || isLoading || isSaving}>
              <Icon icon={isSaving ? 'lucide:loader-circle' : 'lucide:save'} className={isSaving ? 'animate-spin' : ''} />
              保存
            </Button>
          </div>
        </div>

        {error ? <div className="mb-3 rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">{error}</div> : null}

        <textarea
          value={content}
          onChange={(event) => onContentChange(event.target.value)}
          spellCheck={false}
          className={`min-h-[360px] flex-1 resize-none rounded-2xl border border-divider bg-surface px-4 py-4 font-mono text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent ${isLoading || isSaving ? 'pointer-events-none opacity-60' : ''}`}
          placeholder="记忆文件为空，可在这里编辑后保存。"
        />
      </div>
    </div>
  )
}

function CreateProfileModal({ isOpen, value, error, isSaving, profiles, onChange, onCancel, onSave }: {
  isOpen: boolean
  value: { name: string; cloneMode: CloneMode; cloneFrom: string; noSkills: boolean }
  error: string
  isSaving: boolean
  profiles: HermesAgentInfo[]
  onChange: (value: { name: string; cloneMode: CloneMode; cloneFrom: string; noSkills: boolean }) => void
  onCancel: () => void
  onSave: () => void
}) {
  const update = <K extends keyof typeof value>(key: K, nextValue: typeof value[K]) => onChange({ ...value, [key]: nextValue })

  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={(open) => {
        if (!open) onCancel()
      }}>
        <Modal.Container placement="auto" size="md" scroll="inside">
          <Modal.Dialog className="sm:max-w-[560px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <Icon icon="lucide:user-plus" className="size-5" />
              </Modal.Icon>
              <Modal.Heading>新建 Hermes 智能体</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="space-y-5 p-1">
                {error ? <div className="rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">{error}</div> : null}

                <ItemCardGroup className="overflow-hidden">
                  <ItemCardGroup.Header>
                    <ItemCardGroup.Title>基础信息</ItemCardGroup.Title>
                    <ItemCardGroup.Description>给这个 Hermes Profile 一个清晰的名字。</ItemCardGroup.Description>
                  </ItemCardGroup.Header>
                  <FormItem icon="lucide:tag" title="Profile 名称">
                    <Input
                      fullWidth
                      variant="secondary"
                      value={value.name}
                      onChange={(event) => update('name', event.target.value)}
                      disabled={isSaving}
                      placeholder="coder"
                    />
                  </FormItem>
                </ItemCardGroup>

                <ItemCardGroup className="overflow-hidden">
                  <ItemCardGroup.Header>
                    <ItemCardGroup.Title>创建方式</ItemCardGroup.Title>
                    <ItemCardGroup.Description>决定新 Profile 的初始内容和继承范围。</ItemCardGroup.Description>
                  </ItemCardGroup.Header>
                  <CreateModeItem
                    description="创建空白隔离 Profile，可选择不预置内置技能。"
                    icon="lucide:sparkles"
                    isSelected={value.cloneMode === 'fresh'}
                    title="全新 Profile"
                    onPress={() => update('cloneMode', 'fresh')}
                  />
                  <Separator />
                  <CreateModeItem
                    description="复制 config.yaml、.env、SOUL.md、技能和核心记忆。"
                    icon="lucide:copy"
                    isSelected={value.cloneMode === 'clone'}
                    title="克隆配置"
                    onPress={() => update('cloneMode', 'clone')}
                  />
                  <Separator />
                  <CreateModeItem
                    description="完整复制来源 Profile 的状态。"
                    icon="lucide:archive"
                    isSelected={value.cloneMode === 'clone-all'}
                    title="完整克隆"
                    onPress={() => update('cloneMode', 'clone-all')}
                  />
                </ItemCardGroup>

                {value.cloneMode !== 'fresh' ? (
                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>来源 Profile</ItemCardGroup.Title>
                      <ItemCardGroup.Description>从哪个 Profile 克隆初始化内容。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem icon="lucide:layers-3" title="来源选择" description="默认使用 default。">
                      <FriendlySelect
                        ariaLabel="来源 Profile"
                        isDisabled={isSaving}
                        options={profiles.map((profile) => ({
                          id: profile.name,
                          label: profile.displayName ? `${profile.displayName} (${profile.name})` : profile.name,
                        }))}
                        value={value.cloneFrom}
                        onChange={(nextValue) => update('cloneFrom', String(nextValue ?? 'default'))}
                      />
                    </FormItem>
                  </ItemCardGroup>
                ) : (
                  <ItemCardGroup className="overflow-hidden">
                    <ItemCardGroup.Header>
                      <ItemCardGroup.Title>创建选项</ItemCardGroup.Title>
                      <ItemCardGroup.Description>决定新 Profile 是否预置 Hermes 内置技能。</ItemCardGroup.Description>
                    </ItemCardGroup.Header>
                    <FormItem icon="lucide:sparkles" title="内置技能" description="关闭后会创建一个空白 Profile。">
                      <Checkbox isSelected={value.noSkills} onChange={(isSelected) => update('noSkills', isSelected)} isDisabled={isSaving}>
                        不预置内置技能
                      </Checkbox>
                    </FormItem>
                  </ItemCardGroup>
                )}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="ghost" onPress={onCancel} isDisabled={isSaving}>取消</Button>
              <Button variant="primary" onPress={onSave} isDisabled={isSaving || !value.name.trim()}>
                <Icon icon={isSaving ? 'lucide:loader-circle' : 'lucide:plus'} className={isSaving ? 'animate-spin' : ''} />
                创建
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

function RenameProfileModal({ isOpen, value, error, isSaving, onChange, onCancel, onSave }: {
  isOpen: boolean
  value: string
  error: string
  isSaving: boolean
  onChange: (value: string) => void
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={(open) => {
        if (!open) onCancel()
      }}>
        <Modal.Container placement="auto" size="sm" scroll="inside">
          <Modal.Dialog className="sm:max-w-[420px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <Icon icon="lucide:pencil" className="size-5" />
              </Modal.Icon>
              <Modal.Heading>重命名 Profile</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="space-y-4 p-1">
                {error ? <div className="rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">{error}</div> : null}
                <div className="space-y-2">
                  <Label htmlFor="hermes-profile-rename" className="text-xs font-medium text-muted">新名称</Label>
                  <Input
                    id="hermes-profile-rename"
                    fullWidth
                    variant="secondary"
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    disabled={isSaving}
                  />
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="ghost" onPress={onCancel} isDisabled={isSaving}>取消</Button>
              <Button variant="primary" onPress={onSave} isDisabled={isSaving || !value.trim()}>
                <Icon icon={isSaving ? 'lucide:loader-circle' : 'lucide:save'} className={isSaving ? 'animate-spin' : ''} />
                保存
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

function DeleteProfileDialog({ isOpen, profile, isDeleting, onOpenChange, onDelete }: {
  isOpen: boolean
  profile: HermesAgentInfo | null
  isDeleting: boolean
  onOpenChange: (isOpen: boolean) => void
  onDelete: () => void
}) {
  return (
    <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[480px]">
          <AlertDialog.CloseTrigger />
          <AlertDialog.Header>
            <AlertDialog.Icon status="danger" />
            <AlertDialog.Heading>删除 Hermes 智能体？</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p className="text-sm leading-6 text-muted">
              将删除 Profile「{profile?.name}」的配置、环境变量、记忆、会话、技能、定时任务与日志。正在运行的 Gateway 也会由 Hermes CLI 尝试停止。
            </p>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button variant="ghost" onPress={() => onOpenChange(false)} isDisabled={isDeleting}>取消</Button>
            <Button variant="danger" onPress={onDelete} isDisabled={isDeleting}>
              <Icon icon={isDeleting ? 'lucide:loader-circle' : 'lucide:trash-2'} className={isDeleting ? 'animate-spin' : ''} />
              删除
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}

function CreateModeItem({ description, icon, isSelected, title, onPress }: { description: string; icon: string; isSelected: boolean; title: string; onPress: () => void }) {
  return (
    <ItemCard>
      <ItemCard.Icon className="size-10 rounded-full bg-surface-secondary/50 text-muted">
        <Icon icon={icon} className="size-5" />
      </ItemCard.Icon>
      <ItemCard.Content>
        <ItemCard.Title>{title}</ItemCard.Title>
        <ItemCard.Description>{description}</ItemCard.Description>
      </ItemCard.Content>
      <ItemCard.Action>
        <Button size="sm" variant={isSelected ? 'primary' : 'outline'} onPress={onPress}>
          {isSelected ? '已选择' : '选择'}
        </Button>
      </ItemCard.Action>
    </ItemCard>
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

function getProfileFileMeta(profile: HermesAgentInfo, key: string) {
  if (key === 'config') return profile.config
  if (key === 'env') return profile.env
  if (key === 'soul') return profile.soul
  if (key === 'memory') return profile.memory
  if (key === 'user') return profile.user
  return null
}

function getHermesMemoryFiles(profile: HermesAgentInfo): HermesProfileFile[] {
  return [profile.memory, profile.soul, profile.user]
}

function hermesMemoryLabel(key: string) {
  if (key === 'memory') return '长期记忆'
  if (key === 'soul') return '人格设定'
  if (key === 'user') return '用户信息'
  return key
}

function hermesMemoryIcon(key: string) {
  if (key === 'memory') return 'lucide:brain'
  if (key === 'soul') return 'lucide:sparkles'
  if (key === 'user') return 'lucide:user-round'
  return 'lucide:file-text'
}

function formatBytes(value?: number) {
  if (!value) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function LegendItem({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="flex items-center gap-2 text-muted">
        <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </span>
      <span className="font-semibold tabular-nums text-foreground">{numberFormatter.format(value)}</span>
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-divider bg-surface-secondary/50 px-4 py-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-2 min-w-0 truncate text-sm font-semibold text-foreground" title={value}>{value}</p>
    </div>
  )
}

function StatusTile({ label, ok, text }: { label: string; ok: boolean; text: string }) {
  return (
    <div className="rounded-2xl border border-divider bg-surface-secondary/50 px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-foreground">{label}</span>
        <span className={`size-2.5 rounded-full ${ok ? 'bg-success' : 'bg-warning'}`} />
      </div>
      <p className="mt-2 text-xs text-muted">{text}</p>
    </div>
  )
}

function SummaryCard({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-divider p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">{label}</span>
        <Icon icon={icon} className="size-4 text-muted" />
      </div>
      <div className="mt-3 text-2xl font-semibold tabular-nums text-foreground">{numberFormatter.format(value)}</div>
    </div>
  )
}

function EmptyState({ className = '', title = '暂无内容', description, icon = 'lucide:inbox', text }: { className?: string; title?: string; description?: string; icon?: string; text?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center px-6 py-10 text-center ${className}`}>
      <div className="flex size-12 items-center justify-center rounded-full bg-surface-secondary/50 text-muted">
        <Icon icon={icon} className="size-6" />
      </div>
      <h3 className="mt-4 font-semibold text-foreground">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{description || text}</p>
    </div>
  )
}

function InlineError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4 rounded-2xl bg-warning/10 px-4 py-3 text-warning">
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted">{message}</p>
      </div>
      <Button size="sm" variant="ghost" onPress={onRetry}>
        <Icon icon="lucide:refresh-cw" className="size-4" />
        重试
      </Button>
    </div>
  )
}

function HermesAgentsSkeleton() {
  return (
    <Skeleton className="h-[620px] rounded-2xl" />
  )
}

export default HermesAgentsPage
