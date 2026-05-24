import * as QRCode from 'qrcode'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Key, Selection } from '@heroui/react'
import { Button, Card, Chip, Dropdown, Input, Label, ListBox, Modal, SearchField, Separator, Skeleton, Switch, Tooltip, toast } from '@heroui/react'
import { CellSelect, ItemCard, ItemCardGroup, PieChart, RadioButtonGroup, Segment, Stepper } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type {
  CCConnectModelProviderConfig,
  CCConnectProjectAgentConfig,
  CCConnectProjectConfig,
  CCConnectProjectPlatformConfig,
  CCConnectProjectsConfig,
  CCConnectProjectsConfigResponse,
} from '@/api'
import {
  addCCConnectProjectPlatform,
  beginCCConnectFeishuSetup,
  beginCCConnectWeixinSetup,
  getCCConnectModelsConfig,
  getCCConnectProjectsConfig,
  pollCCConnectFeishuSetup,
  pollCCConnectWeixinSetup,
  saveCCConnectFeishuSetup,
  saveCCConnectWeixinSetup,
  updateCCConnectProjectsConfig,
} from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { openExternalUrl } from '@/utils/openExternalUrl'
import DashboardLayout from '@/layouts/Dashboard'
import { CCConnectProjectsHeroIllustration } from './CCConnectProjectsHeroIllustration'

type LoadState = 'idle' | 'loading' | 'saving' | 'ready' | 'error'
type ProjectEditorSection = 'basic' | 'agent' | 'platforms'
type ProjectWizardStep = 'basic' | 'platform' | 'connect'
type ProjectWizardConnectMode = 'qr' | 'manual'
type ProjectSwitchKey = keyof Pick<CCConnectProjectConfig, 'filterExternalSessions' | 'injectSender' | 'replyFooter' | 'showContextIndicator'>

const defaultSelectKey = '__default__'
const projectChartColors = ['var(--accent)', 'var(--success)', 'var(--warning)', 'var(--danger)', 'var(--muted)']
const agentTypes = ['claudecode', 'codex', 'cursor', 'gemini', 'iflow', 'opencode', 'pi', 'qoder']
const permissionModes = ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk']
const platformTypes = ['feishu', 'telegram', 'slack', 'dingtalk', 'discord', 'line', 'wecom', 'weixin', 'qqbot']
const reservedDefaultProjectName = 'default-project'
const isReservedDefaultProject = (projectName: string) => projectName.trim() === reservedDefaultProjectName
const platformSetupMeta: Record<string, { label: string; icon: string; description: string; qr?: boolean; fields: Array<{ key: string; label: string; required?: boolean; secret?: boolean; placeholder?: string }> }> = {
  feishu: { label: '飞书 / Lark', icon: 'icon-park-outline:lark', description: '推荐扫码自动创建 PersonalAgent。', qr: true, fields: [{ key: 'app_id', label: 'App ID', required: true, placeholder: 'cli_xxx' }, { key: 'app_secret', label: 'App Secret', required: true, secret: true }, { key: 'allow_from', label: 'Allow From', placeholder: 'ou_xxx, chat_xxx' }] },
  weixin: { label: '微信', icon: 'simple-icons:wechat', description: '推荐扫码绑定 iLink 机器人', qr: true, fields: [{ key: 'token', label: 'Bot Token', required: true, secret: true }, { key: 'base_url', label: 'Base URL', placeholder: 'https://ilinkai.weixin.qq.com' }, { key: 'account_id', label: 'Account ID' }, { key: 'allow_from', label: 'Allow From' }] },
  telegram: { label: 'Telegram', icon: 'simple-icons:telegram', description: '通过 BotFather 创建机器人后填入 bot token。', fields: [{ key: 'bot_token', label: 'Bot Token', required: true, secret: true }, { key: 'allow_from', label: 'Allow From' }] },
  slack: { label: 'Slack', icon: 'simple-icons:slack', description: '需要 Slack Bot Token 与 App Token。', fields: [{ key: 'bot_token', label: 'Bot Token', required: true, secret: true }, { key: 'app_token', label: 'App Token', required: true, secret: true }, { key: 'allow_from', label: 'Allow From' }] },
  dingtalk: { label: '钉钉', icon: 'ant-design:dingtalk-circle-filled', description: '配置钉钉机器人 client_id 与 client_secret。', fields: [{ key: 'client_id', label: 'Client ID', required: true }, { key: 'client_secret', label: 'Client Secret', required: true, secret: true }, { key: 'allow_from', label: 'Allow From' }] },
  discord: { label: 'Discord', icon: 'simple-icons:discord', description: '配置 Discord bot token。', fields: [{ key: 'token', label: 'Bot Token', required: true, secret: true }, { key: 'allow_from', label: 'Allow From' }] },
  line: { label: 'LINE', icon: 'simple-icons:line', description: '配置 LINE channel secret 和 access token。', fields: [{ key: 'channel_secret', label: 'Channel Secret', required: true, secret: true }, { key: 'channel_access_token', label: 'Channel Access Token', required: true, secret: true }, { key: 'allow_from', label: 'Allow From' }] },
  wecom: { label: '企业微信', icon: 'ant-design:wechat-work-outlined', description: '配置企业 ID、应用 ID 和 Secret。', fields: [{ key: 'corp_id', label: 'Corp ID', required: true }, { key: 'agent_id', label: 'Agent ID', required: true }, { key: 'secret', label: 'Secret', required: true, secret: true }, { key: 'allow_from', label: 'Allow From' }] },
  qqbot: { label: 'QQ Bot', icon: 'simple-icons:tencentqq', description: '配置 QQ Bot app_id 与 token。', fields: [{ key: 'app_id', label: 'App ID', required: true }, { key: 'token', label: 'Token', required: true, secret: true }, { key: 'secret', label: 'Secret', secret: true }] },
}
const reasoningEfforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
const projectSwitches: Array<{ key: ProjectSwitchKey; label: string; description: string }> = [
  { key: 'showContextIndicator', label: '上下文标识', description: '在回复中显示项目上下文标识。' },
  { key: 'replyFooter', label: '回复页脚', description: '附加 cc-connect 的回复页脚。' },
  { key: 'injectSender', label: '注入发送人', description: '把消息发送人注入给 Agent。' },
  { key: 'filterExternalSessions', label: '过滤外部会话', description: '只处理本项目关联会话。' },
]

const emptyProject: CCConnectProjectConfig = {
  name: 'my-project',
  resetOnIdleMins: 30,
  runAsUser: '',
  runAsEnv: [],
  showContextIndicator: false,
  replyFooter: false,
  injectSender: false,
  filterExternalSessions: false,
  adminFrom: '',
  disabledCommands: [],
  agent: {
    type: 'claudecode',
    workDir: '',
    mode: 'default',
    model: '',
    provider: '',
    reasoningEffort: '',
    allowedTools: [],
    disallowedTools: [],
    systemPrompt: '',
    providerRefs: [],
    env: {},
    additionalOptions: {},
  },
  platforms: [],
}

function CCConnectProjectsPage() {
  usePageTitle('CC-Connect 项目管理')

  const [state, setState] = useState<LoadState>('idle')
  const [data, setData] = useState<CCConnectProjectsConfigResponse | null>(null)
  const [draft, setDraft] = useState<CCConnectProjectsConfig | null>(null)
  const [savedFingerprint, setSavedFingerprint] = useState('')
  const [selectedProjectName, setSelectedProjectName] = useState('')
  const [query, setQuery] = useState('')
  const [providerOptions, setProviderOptions] = useState<CCConnectModelProviderConfig[]>([])
  const [wizardOpen, setWizardOpen] = useState(false)
  const [platformWizardProjectName, setPlatformWizardProjectName] = useState('')
  const [error, setError] = useState('')

  const loadConfig = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const [payload, modelsPayload] = await Promise.all([
        getCCConnectProjectsConfig(),
        getCCConnectModelsConfig().catch(() => null),
      ])
      const nextDraft = normalizeConfig(payload.config)
      const visibleProjects = visibleCCConnectProjects(nextDraft.projects)
      setData(payload)
      setProviderOptions(modelsPayload?.config.providers ?? [])
      setDraft(nextDraft)
      setSavedFingerprint(configFingerprint(nextDraft))
      setSelectedProjectName((current) => current && visibleProjects.some((project) => project.name === current) ? current : visibleProjects[0]?.name ?? '')
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : '项目配置加载失败')
      setState('error')
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadConfig()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadConfig])

  const filteredProjects = useMemo(() => {
    const projects = visibleCCConnectProjects(draft?.projects ?? [])
    const needle = query.trim().toLowerCase()
    if (!needle) return projects
    return projects.filter((project) => {
      const platforms = project.platforms.map((platform) => platform.type).join(' ')
      return `${project.name} ${project.agent.type} ${project.agent.workDir ?? ''} ${project.agent.mode ?? ''} ${platforms}`.toLowerCase().includes(needle)
    })
  }, [draft?.projects, query])

  const selectedProject = useMemo(() => {
    if (!draft) return null
    if (filteredProjects.some((project) => project.name === selectedProjectName)) {
      return filteredProjects.find((project) => project.name === selectedProjectName) ?? null
    }
    return filteredProjects[0] ?? null
  }, [draft, filteredProjects, selectedProjectName])

  const stats = useMemo(() => summarizeDraft(draft), [draft])
  const visibleProjectCount = visibleCCConnectProjects(draft?.projects ?? []).length
  const hasUnsavedChanges = Boolean(draft && savedFingerprint && configFingerprint(draft) !== savedFingerprint)
  const isLoading = state === 'loading' && !data
  const isSaving = state === 'saving'

  const updateDraft = useCallback((updater: (current: CCConnectProjectsConfig) => CCConnectProjectsConfig) => {
    setDraft((current) => current ? normalizeConfig(updater(cloneConfig(current))) : current)
  }, [])

  const addProject = useCallback(() => {
    setWizardOpen(true)
  }, [])

  const applyProjectSetup = useCallback((payload: { config: CCConnectProjectsConfig; project: CCConnectProjectConfig }) => {
    const nextDraft = normalizeConfig(payload.config)
    setDraft(nextDraft)
    setSavedFingerprint(configFingerprint(nextDraft))
    setSelectedProjectName(payload.project.name)
    setData((current) => current ? { ...current, config: nextDraft, summary: summarizeDraft(nextDraft) } : current)
    setState('ready')
    void loadConfig()
  }, [loadConfig])

  const updateProject = useCallback((projectName: string, patch: Partial<CCConnectProjectConfig>) => {
    updateDraft((current) => ({
      ...current,
      projects: current.projects.map((project) => project.name === projectName ? normalizeProject({ ...project, ...patch }) : project),
    }))
    if (patch.name?.trim() && patch.name.trim() !== projectName) {
      setSelectedProjectName(patch.name.trim())
    }
  }, [updateDraft])

  const updateProjectAgent = useCallback((projectName: string, patch: Partial<CCConnectProjectAgentConfig>) => {
    updateDraft((current) => ({
      ...current,
      projects: current.projects.map((project) => project.name === projectName ? normalizeProject({ ...project, agent: { ...project.agent, ...patch } }) : project),
    }))
  }, [updateDraft])

  const updateProjectPlatform = useCallback((projectName: string, index: number, patch: Partial<CCConnectProjectPlatformConfig>) => {
    updateDraft((current) => ({
      ...current,
      projects: current.projects.map((project) => {
        if (project.name !== projectName) return project
        const platforms = [...project.platforms]
        platforms[index] = { ...platforms[index], ...patch }
        return normalizeProject({ ...project, platforms })
      }),
    }))
  }, [updateDraft])

  const openPlatformWizard = useCallback((projectName: string) => {
    setPlatformWizardProjectName(projectName)
  }, [])

  const closePlatformWizard = useCallback((open: boolean) => {
    if (!open) setPlatformWizardProjectName('')
  }, [])

  const deleteProjectPlatform = useCallback((projectName: string, index: number) => {
    updateDraft((current) => ({
      ...current,
      projects: current.projects.map((project) => project.name === projectName
        ? normalizeProject({ ...project, platforms: project.platforms.filter((_, itemIndex) => itemIndex !== index) })
        : project),
    }))
  }, [updateDraft])

  const deleteProject = useCallback((projectName: string) => {
    if (isReservedDefaultProject(projectName)) {
      toast.warning('default-project 为系统保留项目，不能删除')
      return
    }
    const visibleProjectCount = visibleCCConnectProjects(draft?.projects ?? []).length
    if (visibleProjectCount <= 1) {
      toast.warning('至少需要保留一个项目')
      return
    }
    updateDraft((current) => {
      if (visibleCCConnectProjects(current.projects).length <= 1) return current
      return { ...current, projects: current.projects.filter((project) => project.name !== projectName) }
    })
    setSelectedProjectName((current) => current === projectName ? '' : current)
  }, [draft?.projects, updateDraft])

  const saveConfig = useCallback(async () => {
    if (!draft) return
    setState('saving')
    setError('')
    try {
      const normalizedDraft = normalizeConfig(draft)
      const payload = await updateCCConnectProjectsConfig(normalizedDraft)
      const nextDraft = normalizeConfig(payload.config)
      const visibleProjects = visibleCCConnectProjects(nextDraft.projects)
      setData(payload)
      setDraft(nextDraft)
      setSavedFingerprint(configFingerprint(nextDraft))
      setSelectedProjectName((current) => current && visibleProjects.some((project) => project.name === current) ? current : visibleProjects[0]?.name ?? '')
      setState('ready')
      toast.success('项目配置已保存')
    } catch (err) {
      setError(err instanceof Error ? err.message : '项目配置保存失败')
      setState('error')
      toast.warning('项目配置保存失败')
    }
  }, [draft])

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
                <h2 className="mt-4 text-lg font-semibold text-foreground">无法加载项目配置</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{error}</p>
                <Button className="mt-6" variant="primary" onPress={loadConfig} isDisabled={state === 'loading'}>
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
                  <p className="font-medium">项目配置操作失败</p>
                  <p className="mt-1 text-sm text-muted">{error}</p>
                </div>
              </div>
            </Card.Content>
          </Card>
        ) : null}

        {isLoading ? <ProjectsSkeleton /> : null}

        {draft && data ? (
          <>
            <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.8fr)]">
              <Card variant="transparent" className="h-full overflow-visible">
                <Card.Content className="flex h-full items-center justify-start overflow-visible">
                  <div className="flex w-full flex-row items-center gap-4 overflow-visible md:gap-6">
                    <div className="flex h-36 shrink-0 items-center justify-center overflow-visible rounded-2xl p-1 drop-shadow-[0_8px_14px_color-mix(in_oklch,var(--accent)_28%,transparent)]">
                      <CCConnectProjectsHeroIllustration className="h-full w-auto md:scale-105" />
                    </div>
                    <div className="min-w-0 flex flex-col gap-1">
                      <Card.Title className="text-2xl font-bold md:text-3xl">项目管理</Card.Title>
                      <Card.Description className="mt-4 text-base md:text-lg">管理 CC-Connect 的 projects、Agent 运行参数和消息平台绑定。</Card.Description>
                    </div>
                  </div>
                </Card.Content>
              </Card>

              <ProjectsOverviewChart stats={stats} />
            </section>

            <div className={visibleProjectCount > 0 ? 'grid gap-4 xl:grid-cols-[minmax(300px,0.46fr)_minmax(0,1.54fr)]' : 'grid gap-4'}>
              {visibleProjectCount > 0 ? (
                <Card className="h-fit xl:sticky xl:top-4">
                <Card.Header className="gap-3">
                  <div className="flex items-center gap-2 justify-between">
                    <div>
                      <Card.Title>项目列表</Card.Title>
                      <Card.Description>选择项目后编辑配置。</Card.Description>
                    </div>
                    <Button size="sm" variant="primary" onPress={addProject} isDisabled={isSaving}>
                      <Icon icon="lucide:plus" />
                      新建
                    </Button>
                  </div>
                </Card.Header>
                <Card.Content className="grid gap-4">
                  <SearchField aria-label="搜索项目" className="w-full" value={query} onChange={setQuery}>
                    <SearchField.Group>
                      <SearchField.Input placeholder="搜索项目、Agent、目录或平台" />
                    </SearchField.Group>
                  </SearchField>

                  <div className="max-h-[48rem] overflow-y-auto p-1">
                    {filteredProjects.length > 0 ? (
                      <RadioButtonGroup
                        className="grid gap-2"
                        name="cc-connect-project"
                        value={selectedProject?.name ?? ''}
                        variant="secondary"
                        onChange={(value) => setSelectedProjectName(value)}
                      >
                        {filteredProjects.map((project) => (
                          <RadioButtonGroup.Item className="p-2" key={project.name} value={project.name}>
                            <RadioButtonGroup.ItemContent className="flex-row items-center gap-3">
                              <RadioButtonGroup.ItemIcon>
                                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-secondary text-muted">
                                  <Icon icon="lucide:folder-cog" className="size-5" />
                                </div>
                              </RadioButtonGroup.ItemIcon>
                              <div className="min-w-0 flex-1 pr-5 gap-1 flex flex-col">
                                <div className="truncate text-base font-semibold text-foreground">{project.name || '未命名项目'}</div>

                                <div className="flex flex-wrap gap-1.5">
                                  <Chip size="sm" variant="soft">{project.platforms.length} platforms</Chip>
                                  {project.agent.mode ? <Chip size="sm" variant="soft">{project.agent.mode}</Chip> : null}
                                </div>
                              </div>
                            </RadioButtonGroup.ItemContent>
                          </RadioButtonGroup.Item>
                        ))}
                      </RadioButtonGroup>
                    ) : <EmptyState icon="lucide:search-x" title="没有匹配项目" />}
                  </div>
                </Card.Content>
                </Card>
              ) : null}

              <div className="grid gap-4">
                <Card>
                  <Card.Content>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-foreground">项目配置</div>
                        <div className="mt-1 text-sm text-muted">按项目管理 Agent、工作目录、命令权限和消息平台。</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button isIconOnly variant="ghost" onPress={loadConfig} isDisabled={isSaving || state === 'loading'}>
                          <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={state === 'loading' ? 'animate-spin' : ''} />
                        </Button>
                        {hasUnsavedChanges ? (
                          <Button size="sm" variant="primary" onPress={saveConfig} isDisabled={isSaving}>
                            <Icon icon={isSaving ? 'lucide:loader-circle' : 'lucide:save'} className={isSaving ? 'animate-spin' : ''} />
                            保存
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </Card.Content>
                </Card>

                {selectedProject ? (
                  <ProjectEditor
                    isSaving={isSaving}
                    project={selectedProject}
                    onAgentChange={(patch) => updateProjectAgent(selectedProject.name, patch)}
                    providerOptions={providerOptions}
                    onChange={(patch) => updateProject(selectedProject.name, patch)}
                    onDelete={() => deleteProject(selectedProject.name)}
                    canDelete={visibleCCConnectProjects(draft?.projects ?? []).length > 1 && !isReservedDefaultProject(selectedProject.name)}
                    onPlatformAdd={() => openPlatformWizard(selectedProject.name)}
                    onPlatformChange={(index, patch) => updateProjectPlatform(selectedProject.name, index, patch)}
                    onPlatformDelete={(index) => deleteProjectPlatform(selectedProject.name, index)}
                  />
                ) : (
                  <Card>
                    <Card.Content>
                      <EmptyState
                        action={(
                          <Button variant="primary" onPress={addProject} isDisabled={isSaving}>
                            <Icon icon="lucide:plus" />
                            新建项目
                          </Button>
                        )}
                        icon="lucide:folder-plus"
                        title="还没有项目"
                      />
                    </Card.Content>
                  </Card>
                )}
              </div>
            </div>
            <ProjectCreateWizard
              existingProjects={draft.projects}
              isOpen={wizardOpen}
              onCompleted={applyProjectSetup}
              onOpenChange={setWizardOpen}
            />
            <ProjectPlatformAddWizard
              isOpen={Boolean(platformWizardProjectName)}
              projectName={platformWizardProjectName}
              onCompleted={applyProjectSetup}
              onOpenChange={closePlatformWizard}
            />
          </>
        ) : null}
      </div>
    </DashboardLayout>
  )
}

function ProjectPlatformAddWizard({
  isOpen,
  onCompleted,
  onOpenChange,
  projectName,
}: {
  isOpen: boolean
  onCompleted: (payload: { config: CCConnectProjectsConfig; project: CCConnectProjectConfig }) => void
  onOpenChange: (open: boolean) => void
  projectName: string
}) {
  const [step, setStep] = useState<Extract<ProjectWizardStep, 'platform' | 'connect'>>('platform')
  const [platformType, setPlatformType] = useState('feishu')
  const [connectMode, setConnectMode] = useState<ProjectWizardConnectMode>('qr')
  const [manualOptions, setManualOptions] = useState<Record<string, string>>({})
  const [qrImage, setQrImage] = useState('')
  const [qrMessage, setQrMessage] = useState('')
  const [qrPayload, setQrPayload] = useState<Record<string, string>>({})
  const [qrUrl, setQrUrl] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState('')
  const openSeenRef = useRef(false)
  const pollTimerRef = useRef<number | null>(null)
  const qrMetaRef = useRef<{ deviceCode?: string; qrKey?: string; baseUrl?: string; apiUrl?: string; interval?: number }>({})
  const platformMeta = platformSetupMeta[platformType] ?? platformSetupMeta.feishu
  const canUseQr = Boolean(platformMeta.qr && (platformType === 'feishu' || platformType === 'weixin'))
  const requiredFields = platformMeta.fields.filter((field) => field.required)
  const manualValid = requiredFields.every((field) => manualOptions[field.key]?.trim())
  const canFinish = connectMode === 'qr' ? Boolean(qrPayload.ready === 'true') : manualValid

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const resetWizard = useCallback(() => {
    clearPollTimer()
    setStep('platform')
    setPlatformType('feishu')
    setConnectMode('qr')
    setManualOptions({})
    setQrImage('')
    setQrMessage('')
    setQrPayload({})
    setQrUrl('')
    setIsBusy(false)
    setError('')
    qrMetaRef.current = {}
  }, [clearPollTimer])

  useEffect(() => {
    if (isOpen && !openSeenRef.current) {
      openSeenRef.current = true
      window.setTimeout(resetWizard, 0)
    }
    if (!isOpen) openSeenRef.current = false
    return () => clearPollTimer()
  }, [clearPollTimer, isOpen, resetWizard])

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) clearPollTimer()
    onOpenChange(open)
  }, [clearPollTimer, onOpenChange])

  const selectPlatform = useCallback((value: string) => {
    const meta = platformSetupMeta[value] ?? platformSetupMeta.feishu
    clearPollTimer()
    setPlatformType(value)
    setConnectMode(meta.qr ? 'qr' : 'manual')
    setManualOptions({})
    setQrImage('')
    setQrMessage('')
    setQrPayload({})
    setQrUrl('')
    setError('')
    qrMetaRef.current = {}
  }, [clearPollTimer])

  const updateManualOption = useCallback((key: string, value: string) => {
    setManualOptions((current) => ({ ...current, [key]: value }))
  }, [])

  const completeQrWizard = useCallback(async (payloadOptions: Record<string, string>) => {
    if (!projectName.trim()) return
    setIsBusy(true)
    setError('')
    setQrMessage('扫码完成，正在添加平台。')
    try {
      const payload = platformType === 'feishu'
        ? await saveCCConnectFeishuSetup({ projectName, appId: payloadOptions.appId, appSecret: payloadOptions.appSecret, ownerOpenId: payloadOptions.ownerOpenId, platformType: payloadOptions.platform || 'feishu' })
        : await saveCCConnectWeixinSetup({ projectName, token: payloadOptions.token, baseUrl: payloadOptions.baseUrl, ilinkBotId: payloadOptions.ilinkBotId, ilinkUserId: payloadOptions.ilinkUserId })
      onCompleted({ config: payload.config, project: payload.project })
      toast.success('消息平台已添加')
      handleOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加平台失败')
      toast.warning('添加平台失败')
      setIsBusy(false)
    }
  }, [handleOpenChange, onCompleted, platformType, projectName])

  async function pollFeishu() {
    const deviceCode = qrMetaRef.current.deviceCode
    if (!deviceCode) return
    try {
      const payload = await pollCCConnectFeishuSetup({ deviceCode, baseUrl: qrMetaRef.current.baseUrl })
      if (payload.baseUrl) qrMetaRef.current.baseUrl = payload.baseUrl
      if (payload.status === 'completed' && payload.appId && payload.appSecret) {
        clearPollTimer()
        const completedPayload = { appId: payload.appId, appSecret: payload.appSecret, ownerOpenId: payload.ownerOpenId ?? '', platform: payload.platform ?? 'feishu', ready: 'true' }
        setQrPayload(completedPayload)
        void completeQrWizard(completedPayload)
        return
      }
      if (payload.status === 'denied' || payload.status === 'expired' || payload.status === 'error') {
        clearPollTimer()
        setError(payload.error || '扫码未完成，请重新生成二维码')
        setIsBusy(false)
        return
      }
      setQrMessage(payload.slowDown ? '平台要求放慢轮询，继续等待扫码确认' : '等待扫码授权中')
      pollTimerRef.current = window.setTimeout(() => void pollFeishu(), Math.max(qrMetaRef.current.interval ?? 4, 2) * 1000)
    } catch (err) {
      clearPollTimer()
      setError(err instanceof Error ? err.message : '飞书扫码轮询失败')
      setIsBusy(false)
    }
  }

  async function pollWeixin() {
    const qrKey = qrMetaRef.current.qrKey
    if (!qrKey) return
    try {
      const payload = await pollCCConnectWeixinSetup({ qrKey, apiUrl: qrMetaRef.current.apiUrl })
      if (payload.status === 'confirmed' && payload.botToken) {
        clearPollTimer()
        const completedPayload = { token: payload.botToken, baseUrl: payload.baseUrl ?? '', ilinkBotId: payload.ilinkBotId ?? '', ilinkUserId: payload.ilinkUserId ?? '', ready: 'true' }
        setQrPayload(completedPayload)
        void completeQrWizard(completedPayload)
        return
      }
      setQrMessage('等待微信扫码确认中。')
      pollTimerRef.current = window.setTimeout(() => void pollWeixin(), 3000)
    } catch (err) {
      clearPollTimer()
      setError(err instanceof Error ? err.message : '微信扫码轮询失败')
      setIsBusy(false)
    }
  }

  const beginQrSetup = async () => {
    if (!canUseQr) return
    clearPollTimer()
    setIsBusy(true)
    setError('')
    setQrPayload({})
    setQrMessage('正在生成二维码。')
    try {
      if (platformType === 'feishu') {
        const payload = await beginCCConnectFeishuSetup()
        const image = await QRCode.toDataURL(payload.qrUrl, { errorCorrectionLevel: 'M', margin: 2, width: 280 })
        qrMetaRef.current = { deviceCode: payload.deviceCode, interval: payload.interval || 4 }
        setQrUrl(payload.qrUrl)
        setQrImage(image)
        setQrMessage('请使用飞书或 Lark 扫码授权。')
        pollTimerRef.current = window.setTimeout(() => void pollFeishu(), Math.max(payload.interval || 4, 2) * 1000)
      } else if (platformType === 'weixin') {
        const payload = await beginCCConnectWeixinSetup()
        const image = payload.qrUrl.startsWith('data:') ? payload.qrUrl : await QRCode.toDataURL(payload.qrUrl, { errorCorrectionLevel: 'M', margin: 2, width: 280 })
        qrMetaRef.current = { qrKey: payload.qrKey }
        setQrUrl(payload.qrUrl)
        setQrImage(image)
        setQrMessage('请使用微信扫码绑定机器人。')
        pollTimerRef.current = window.setTimeout(() => void pollWeixin(), 3000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '二维码生成失败')
      setIsBusy(false)
    }
  }

  const completeWizard = useCallback(async () => {
    if (!canFinish || !projectName.trim()) return
    setIsBusy(true)
    setError('')
    try {
      const payload = connectMode === 'qr' && platformType === 'feishu'
        ? await saveCCConnectFeishuSetup({ projectName, appId: qrPayload.appId, appSecret: qrPayload.appSecret, ownerOpenId: qrPayload.ownerOpenId, platformType: qrPayload.platform || 'feishu' })
        : connectMode === 'qr' && platformType === 'weixin'
          ? await saveCCConnectWeixinSetup({ projectName, token: qrPayload.token, baseUrl: qrPayload.baseUrl, ilinkBotId: qrPayload.ilinkBotId, ilinkUserId: qrPayload.ilinkUserId })
          : await addCCConnectProjectPlatform({ projectName, type: platformType, options: cleanTextRecord(manualOptions) })
      onCompleted({ config: payload.config, project: payload.project })
      toast.success('消息平台已添加')
      handleOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加平台失败')
      toast.warning('添加平台失败')
    } finally {
      setIsBusy(false)
    }
  }, [canFinish, connectMode, handleOpenChange, manualOptions, onCompleted, platformType, projectName, qrPayload])

  const openQrUrl = useCallback(() => {
    if (!qrUrl) return
    void openExternalUrl(qrUrl)
  }, [qrUrl])

  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={handleOpenChange} variant="opaque">
        <Modal.Container size="lg" scroll="inside">
          <Modal.Dialog className="sm:max-w-[640px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Icon className="bg-accent/10 text-accent"><Icon icon="lucide:messages-square" /></Modal.Icon>
              <div>
                <Modal.Heading>添加消息平台</Modal.Heading>
                <p className="mt-1 text-sm text-muted">为 {projectName || '当前项目'} 选择平台，并完成扫码或密钥配置。</p>
              </div>
            </Modal.Header>
            <Modal.Body>
              <div className="grid gap-5 p-1">
                <PlatformWizardSteps step={step} onStepChange={(nextStep) => setStep(nextStep)} />
                {error ? (
                  <Card><Card.Content><div className="flex items-start gap-3 text-danger"><Icon icon="lucide:circle-alert" className="mt-0.5 size-5 shrink-0" /><p className="text-sm leading-6">{error}</p></div></Card.Content></Card>
                ) : null}
                {step === 'platform' ? (
                  <Card>
                    <Card.Header><Card.Title>选择消息平台</Card.Title><Card.Description>选择后进入连接步骤，扫码平台支持自动授权。</Card.Description></Card.Header>
                    <Card.Content>
                      <RadioButtonGroup className="w-full grid-cols-2 sm:grid-cols-3" layout="grid" name="add-project-platform" value={platformType} variant="secondary" onChange={selectPlatform}>
                        {platformTypes.map((type) => {
                          const meta = platformSetupMeta[type]
                          return (
                            <RadioButtonGroup.Item className="p-2" key={type} value={type}>
                              <RadioButtonGroup.Indicator />
                              <RadioButtonGroup.ItemContent className="flex-row items-center gap-3">
                                <RadioButtonGroup.ItemIcon>
                                  <div className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-surface-secondary text-muted shadow-surface">
                                    <Icon icon={meta.icon} className="size-4" />
                                  </div>
                                </RadioButtonGroup.ItemIcon>
                                <div className="min-w-0 flex-1">
                                  <Label className="font-semibold text-foreground">{meta.label}</Label></div>
                              </RadioButtonGroup.ItemContent>
                            </RadioButtonGroup.Item>
                          )
                        })}
                      </RadioButtonGroup>
                    </Card.Content>
                  </Card>
                ) : null}
                {step === 'connect' ? (
                  <Card>
                    <Card.Header>
                      <div><Card.Title>{platformMeta.label} 连接</Card.Title><Card.Description>完成连接后会直接写入当前项目平台配置。</Card.Description></div>
                      {canUseQr ? (<Segment aria-label="连接方式" selectedKey={connectMode} onSelectionChange={(key) => setConnectMode(String(key) as ProjectWizardConnectMode)}><Segment.Item id="qr"><Segment.Separator />扫码连接</Segment.Item><Segment.Item id="manual"><Segment.Separator />手动密钥</Segment.Item></Segment>) : null}
                    </Card.Header>
                    <Card.Content>
                      {connectMode === 'qr' && canUseQr ? (
                        <Card className="overflow-hidden"><Card.Content className="flex min-h-[360px] flex-col items-center justify-center gap-4 bg-surface-secondary/50 px-6 py-8 text-center">
                          {qrImage ? <img src={qrImage} alt={`${platformMeta.label} 二维码`} className="size-[280px]" /> : <div className="flex size-[220px] items-center justify-center rounded-3xl bg-surface text-muted shadow-surface"><Icon icon="lucide:qr-code" className="size-16" /></div>}
                          <div className="max-w-md space-y-2"><div className="text-base font-semibold text-foreground">{qrPayload.ready === 'true' ? '平台连接已完成' : qrImage ? '等待平台授权' : '等待生成二维码'}</div><p className="text-sm leading-6 text-muted">{qrMessage || '点击生成二维码，扫码完成后会自动添加平台。'}</p></div>
                          <div className="flex items-center justify-center gap-2">
                            {qrImage ? <Tooltip delay={300}><Tooltip.Trigger><Button isIconOnly aria-label="重新生成二维码" variant="ghost" onPress={beginQrSetup} isDisabled={isBusy}><Icon icon={isBusy ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={isBusy ? 'animate-spin' : ''} /></Button></Tooltip.Trigger><Tooltip.Content>重新生成二维码</Tooltip.Content></Tooltip> : <Button variant="primary" onPress={beginQrSetup} isDisabled={isBusy}><Icon icon={isBusy ? 'lucide:loader-circle' : 'lucide:qr-code'} className={isBusy ? 'animate-spin' : ''} />生成二维码</Button>}
                            {qrUrl && qrPayload.ready !== 'true' ? <Button variant="secondary" onPress={openQrUrl}><Icon icon="lucide:external-link" />网页授权</Button> : null}
                          </div>
                        </Card.Content></Card>
                      ) : (
                        <ItemCardGroup className="overflow-hidden" variant="secondary">
                          <ItemCardGroup.Header><ItemCardGroup.Title>手动密钥配置</ItemCardGroup.Title><ItemCardGroup.Description>填写 {platformMeta.label} 的必填凭据后添加平台。</ItemCardGroup.Description></ItemCardGroup.Header>
                          {platformMeta.fields.map((field, index) => (<Fragment key={field.key}>{index > 0 ? <Separator /> : null}<WizardFormItem icon={field.secret ? 'lucide:key-round' : 'lucide:settings-2'} title={`${field.label}${field.required ? ' *' : ''}`} description={field.required ? '必填字段' : '可选高级设置'}><Input fullWidth variant="secondary" type="text" value={manualOptions[field.key] ?? ''} placeholder={field.placeholder} onChange={(event) => updateManualOption(field.key, event.target.value)} /></WizardFormItem></Fragment>))}
                        </ItemCardGroup>
                      )}
                    </Card.Content>
                  </Card>
                ) : null}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={() => handleOpenChange(false)} isDisabled={isBusy}>取消</Button>
              {step === 'connect' ? <Button variant="secondary" onPress={() => setStep('platform')} isDisabled={isBusy}>上一步</Button> : null}
              {step === 'platform' ? <Button variant="primary" onPress={() => { setStep('connect'); setConnectMode(canUseQr ? 'qr' : 'manual') }}>下一步</Button> : null}
              {step === 'connect' && connectMode === 'manual' ? <Button variant="primary" onPress={completeWizard} isDisabled={!canFinish || isBusy}><Icon icon={isBusy ? 'lucide:loader-circle' : 'lucide:check'} className={isBusy ? 'animate-spin' : ''} />添加平台</Button> : null}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

function ProjectCreateWizard({
  existingProjects,
  isOpen,
  onCompleted,
  onOpenChange,
}: {
  existingProjects: CCConnectProjectConfig[]
  isOpen: boolean
  onCompleted: (payload: { config: CCConnectProjectsConfig; project: CCConnectProjectConfig }) => void
  onOpenChange: (open: boolean) => void
}) {
  const [step, setStep] = useState<ProjectWizardStep>('basic')
  const [name, setName] = useState('')
  const [workDir, setWorkDir] = useState('')
  const [agentType, setAgentType] = useState('claudecode')
  const [platformType, setPlatformType] = useState('feishu')
  const [connectMode, setConnectMode] = useState<ProjectWizardConnectMode>('qr')
  const [manualOptions, setManualOptions] = useState<Record<string, string>>({})
  const [qrImage, setQrImage] = useState('')
  const [qrMessage, setQrMessage] = useState('')
  const [qrPayload, setQrPayload] = useState<Record<string, string>>({})
  const [qrUrl, setQrUrl] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState('')
  const openSeenRef = useRef(false)
  const pollTimerRef = useRef<number | null>(null)
  const qrMetaRef = useRef<{ deviceCode?: string; qrKey?: string; baseUrl?: string; apiUrl?: string; interval?: number }>({})
  const platformMeta = platformSetupMeta[platformType] ?? platformSetupMeta.feishu
  const projectNameExists = existingProjects.some((project) => project.name === name.trim())
  const canUseQr = Boolean(platformMeta.qr && (platformType === 'feishu' || platformType === 'weixin'))
  const requiredFields = platformMeta.fields.filter((field) => field.required)
  const basicValid = Boolean(name.trim() && workDir.trim() && agentType.trim() && !projectNameExists)
  const manualValid = requiredFields.every((field) => manualOptions[field.key]?.trim())
  const canFinish = connectMode === 'qr' ? Boolean(qrPayload.ready === 'true') : manualValid

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const resetWizard = useCallback(() => {
    clearPollTimer()
    setStep('basic')
    setName(nextProjectName(existingProjects))
    setWorkDir('')
    setAgentType('claudecode')
    setPlatformType('feishu')
    setConnectMode('qr')
    setManualOptions({})
    setQrImage('')
    setQrMessage('')
    setQrPayload({})
    setQrUrl('')
    setIsBusy(false)
    setError('')
    qrMetaRef.current = {}
  }, [clearPollTimer, existingProjects])

  useEffect(() => {
    if (isOpen && !openSeenRef.current) {
      openSeenRef.current = true
      window.setTimeout(resetWizard, 0)
    }
    if (!isOpen) {
      openSeenRef.current = false
    }
    return () => clearPollTimer()
  }, [clearPollTimer, isOpen, resetWizard])

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) clearPollTimer()
    onOpenChange(open)
  }, [clearPollTimer, onOpenChange])

  const updateManualOption = useCallback((key: string, value: string) => {
    setManualOptions((current) => ({ ...current, [key]: value }))
  }, [])

  const completeQrWizard = useCallback(async (payloadOptions: Record<string, string>) => {
    if (!basicValid) {
      setError('请先填写完整的项目名称、工作目录和 Agent 类型。')
      setIsBusy(false)
      return
    }
    setIsBusy(true)
    setError('')
    setQrMessage('扫码完成，正在创建项目。')
    try {
      const base = { projectName: name.trim(), workDir: workDir.trim(), agentType }
      const payload = platformType === 'feishu'
        ? await saveCCConnectFeishuSetup({ ...base, appId: payloadOptions.appId, appSecret: payloadOptions.appSecret, ownerOpenId: payloadOptions.ownerOpenId, platformType: payloadOptions.platform || 'feishu' })
        : await saveCCConnectWeixinSetup({ ...base, token: payloadOptions.token, baseUrl: payloadOptions.baseUrl, ilinkBotId: payloadOptions.ilinkBotId, ilinkUserId: payloadOptions.ilinkUserId })
      onCompleted({ config: payload.config, project: payload.project })
      toast.success('项目已创建并完成消息平台连接')
      handleOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建项目失败')
      toast.warning('创建项目失败')
      setIsBusy(false)
    }
  }, [agentType, basicValid, handleOpenChange, name, onCompleted, platformType, workDir])

  const selectPlatform = useCallback((value: string) => {
    const meta = platformSetupMeta[value] ?? platformSetupMeta.feishu
    clearPollTimer()
    setPlatformType(value)
    setConnectMode(meta.qr ? 'qr' : 'manual')
    setManualOptions({})
    setQrImage('')
    setQrMessage('')
    setQrPayload({})
    setQrUrl('')
    setError('')
    qrMetaRef.current = {}
  }, [clearPollTimer])

  async function pollCCConnectFeishu() {
    const deviceCode = qrMetaRef.current.deviceCode
    if (!deviceCode) return
    try {
      const payload = await pollCCConnectFeishuSetup({ deviceCode, baseUrl: qrMetaRef.current.baseUrl })
      if (payload.baseUrl) qrMetaRef.current.baseUrl = payload.baseUrl
      if (payload.status === 'completed' && payload.appId && payload.appSecret) {
        clearPollTimer()
        const completedPayload = { appId: payload.appId, appSecret: payload.appSecret, ownerOpenId: payload.ownerOpenId ?? '', platform: payload.platform ?? 'feishu', ready: 'true' }
        setQrPayload(completedPayload)
        setQrMessage('扫码完成，正在创建项目。')
        void completeQrWizard(completedPayload)
        return
      }
      if (payload.status === 'denied' || payload.status === 'expired' || payload.status === 'error') {
        clearPollTimer()
        setError(payload.error || '扫码未完成，请重新生成二维码')
        setIsBusy(false)
        return
      }
      setQrMessage(payload.slowDown ? '平台要求放慢轮询，继续等待扫码确认' : '等待扫码授权中')
      pollTimerRef.current = window.setTimeout(() => void pollCCConnectFeishu(), Math.max(qrMetaRef.current.interval ?? 4, 2) * 1000)
    } catch (err) {
      clearPollTimer()
      setError(err instanceof Error ? err.message : '飞书扫码轮询失败')
      setIsBusy(false)
    }
  }

  async function pollCCConnectWeixin() {
    const qrKey = qrMetaRef.current.qrKey
    if (!qrKey) return
    try {
      const payload = await pollCCConnectWeixinSetup({ qrKey, apiUrl: qrMetaRef.current.apiUrl })
      if (payload.status === 'confirmed' && payload.botToken) {
        clearPollTimer()
        const completedPayload = { token: payload.botToken, baseUrl: payload.baseUrl ?? '', ilinkBotId: payload.ilinkBotId ?? '', ilinkUserId: payload.ilinkUserId ?? '', ready: 'true' }
        setQrPayload(completedPayload)
        setQrMessage('扫码完成，正在创建项目。')
        void completeQrWizard(completedPayload)
        return
      }
      setQrMessage('等待微信扫码确认中。')
      pollTimerRef.current = window.setTimeout(() => void pollCCConnectWeixin(), 3000)
    } catch (err) {
      clearPollTimer()
      setError(err instanceof Error ? err.message : '微信扫码轮询失败')
      setIsBusy(false)
    }
  }

  const beginQrSetup = async () => {
    if (!canUseQr) return
    clearPollTimer()
    setIsBusy(true)
    setError('')
    setQrPayload({})
    setQrMessage('正在生成二维码。')
    try {
      if (platformType === 'feishu') {
        const payload = await beginCCConnectFeishuSetup()
        const image = await QRCode.toDataURL(payload.qrUrl, { errorCorrectionLevel: 'M', margin: 2, width: 280 })
        qrMetaRef.current = { deviceCode: payload.deviceCode, interval: payload.interval || 4 }
        setQrUrl(payload.qrUrl)
        setQrImage(image)
        setQrMessage('请使用飞书或 Lark 扫码授权。')
        pollTimerRef.current = window.setTimeout(() => void pollCCConnectFeishu(), Math.max(payload.interval || 4, 2) * 1000)
      } else if (platformType === 'weixin') {
        const payload = await beginCCConnectWeixinSetup()
        const image = payload.qrUrl.startsWith('data:') ? payload.qrUrl : await QRCode.toDataURL(payload.qrUrl, { errorCorrectionLevel: 'M', margin: 2, width: 280 })
        qrMetaRef.current = { qrKey: payload.qrKey }
        setQrUrl(payload.qrUrl)
        setQrImage(image)
        setQrMessage('请使用微信扫码绑定机器人。')
        pollTimerRef.current = window.setTimeout(() => void pollCCConnectWeixin(), 3000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '二维码生成失败')
      setIsBusy(false)
    }
  }

  const openQrUrl = useCallback(() => {
    if (!qrUrl) return
    void openExternalUrl(qrUrl)
  }, [qrUrl])

  const completeWizard = useCallback(async () => {
    if (!basicValid || !canFinish) return
    setIsBusy(true)
    setError('')
    try {
      const base = { projectName: name.trim(), workDir: workDir.trim(), agentType }
      const payload = connectMode === 'qr' && platformType === 'feishu'
        ? await saveCCConnectFeishuSetup({ ...base, appId: qrPayload.appId, appSecret: qrPayload.appSecret, ownerOpenId: qrPayload.ownerOpenId, platformType: qrPayload.platform || 'feishu' })
        : connectMode === 'qr' && platformType === 'weixin'
          ? await saveCCConnectWeixinSetup({ ...base, token: qrPayload.token, baseUrl: qrPayload.baseUrl, ilinkBotId: qrPayload.ilinkBotId, ilinkUserId: qrPayload.ilinkUserId })
          : await addCCConnectProjectPlatform({ ...base, type: platformType, options: cleanTextRecord(manualOptions) })
      onCompleted({ config: payload.config, project: payload.project })
      toast.success('项目已创建并完成消息平台连接')
      handleOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建项目失败')
      toast.warning('创建项目失败')
    } finally {
      setIsBusy(false)
    }
  }, [agentType, basicValid, canFinish, connectMode, handleOpenChange, manualOptions, name, onCompleted, platformType, qrPayload, workDir])

  const goPlatformStep = useCallback(() => {
    if (!basicValid) return
    setStep('platform')
  }, [basicValid])

  const goConnectStep = useCallback(() => {
    if (!platformType) return
    setStep('connect')
    setConnectMode(canUseQr ? 'qr' : 'manual')
  }, [canUseQr, platformType])

  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={handleOpenChange} variant="opaque">
        <Modal.Container size="lg" scroll="inside">
          <Modal.Dialog className="sm:max-w-[640px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Icon className="bg-accent/10 text-accent">
                <Icon icon="lucide:folder-plus" />
              </Modal.Icon>
              <div>
                <Modal.Heading>新增 CC-Connect 项目</Modal.Heading>
                <p className="mt-1 text-sm text-muted">完整流程：填写项目信息，选择消息平台，并完成扫码或密钥配置后才创建项目。</p>
              </div>
            </Modal.Header>
            <Modal.Body>
              <div className="grid gap-5 p-1">
                <WizardSteps step={step} onStepChange={(nextStep) => {
                  if (nextStep === 'basic') setStep('basic')
                  if (nextStep === 'platform' && basicValid) setStep('platform')
                  if (nextStep === 'connect' && basicValid) goConnectStep()
                }} />
                {error ? (
                  <Card>
                    <Card.Content>
                      <div className="flex items-start gap-3 text-danger">
                        <Icon icon="lucide:circle-alert" className="mt-0.5 size-5 shrink-0" />
                        <p className="text-sm leading-6">{error}</p>
                      </div>
                    </Card.Content>
                  </Card>
                ) : null}
                {step === 'basic' ? (
                  <Card>
                    <Card.Header>
                      <Card.Title>项目基础信息</Card.Title>
                      <Card.Description>先确认项目身份、运行目录和默认 Agent。下一步会要求完成消息平台连接。</Card.Description>
                    </Card.Header>
                    <Card.Content>
                      <ItemCardGroup className="overflow-hidden" variant="secondary">
                        <WizardFormItem icon="lucide:folder-cog" title="项目名称" description="仅支持英文、数字和连字符">
                          <Input fullWidth variant="secondary" value={name} placeholder="my-project" onChange={(event) => setName(event.target.value)} />
                          {projectNameExists ? <div className="mt-1 text-xs text-danger">项目名称已存在</div> : null}
                        </WizardFormItem>
                        <Separator />
                        <WizardFormItem icon="lucide:folder-open" title="工作目录" description="Agent 执行命令和读取仓库的目录">
                          <Input fullWidth variant="secondary" value={workDir} placeholder="" onChange={(event) => setWorkDir(event.target.value)} />
                        </WizardFormItem>
                        <Separator />
                        <WizardFormItem icon="lucide:bot" title="Agent 类型" description="选择该项目使用的 Agent 引擎。">
                          <SelectField options={agentTypes} value={agentType} onChange={(value) => setAgentType(value || 'claudecode')} />
                        </WizardFormItem>
                      </ItemCardGroup>
                    </Card.Content>
                  </Card>
                ) : null}
                {step === 'platform' ? (
                  <Card>
                    <Card.Header>
                      <Card.Title>选择消息平台</Card.Title>
                      <Card.Description>选择一个平台后必须在下一步完成扫码或密钥配置，向导不会创建未连接的平台。</Card.Description>
                    </Card.Header>
                    <Card.Content>
                      <RadioButtonGroup
                        className="w-full grid-cols-1 sm:grid-cols-2"
                        layout="grid"
                        name="project-platform"
                        value={platformType}
                        variant="secondary"
                        onChange={selectPlatform}
                      >
                        {platformTypes.map((type) => {
                          const meta = platformSetupMeta[type]
                          return (
                            <RadioButtonGroup.Item key={type} value={type}>
                              <RadioButtonGroup.Indicator />
                              <RadioButtonGroup.ItemContent className="flex-row items-start gap-3">
                                <RadioButtonGroup.ItemIcon>
                                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface text-muted shadow-surface">
                                    <Icon icon={meta.icon} className="size-5" />
                                  </div>
                                </RadioButtonGroup.ItemIcon>
                                <div className="min-w-0 flex-1">
                                  <Label className="font-semibold text-foreground">{meta.label}             {meta.qr ? <Chip size="sm" variant="soft">支持扫码</Chip> : null}</Label>
                                  <p className="mt-1 text-xs leading-5 text-muted">{meta.description}</p>

                                </div>
                              </RadioButtonGroup.ItemContent>
                            </RadioButtonGroup.Item>
                          )
                        })}
                      </RadioButtonGroup>
                    </Card.Content>
                  </Card>
                ) : null}
                {step === 'connect' ? (
                  <Card>
                    <Card.Header>
                      <div className='mb-2'>
                        <Card.Title>{platformMeta.label} 连接</Card.Title>
                        <Card.Description>完成连接后才会创建项目；扫码和手动密钥都会写入有效平台配置。</Card.Description>
                      </div>
                      {canUseQr ? (
                        <Segment aria-label="连接方式" selectedKey={connectMode} onSelectionChange={(key) => setConnectMode(String(key) as ProjectWizardConnectMode)}>
                          <Segment.Item id="qr"><Segment.Separator />扫码连接</Segment.Item>
                          <Segment.Item id="manual"><Segment.Separator />手动密钥</Segment.Item>
                        </Segment>
                      ) : null}
                    </Card.Header>
                    <Card.Content>
                      {connectMode === 'qr' && canUseQr ? (
                        <Card className="overflow-hidden">
                          <Card.Content className="flex min-h-[360px] flex-col items-center justify-center gap-4 bg-surface-secondary/50 px-6 py-8 text-center">
                            {qrImage ? (
                              <img src={qrImage} alt={`${platformMeta.label} 二维码`} className="size-[240px]" />
                            ) : (
                              <div className="flex size-[220px] items-center justify-center rounded-3xl bg-surface text-muted shadow-surface">
                                <Icon icon="lucide:qr-code" className="size-16" />
                              </div>
                            )}
                            <div className="max-w-md space-y-2">
                              <div className="text-base font-semibold text-foreground">
                                {qrPayload.ready === 'true' ? '平台连接已完成' : qrImage ? '等待平台授权' : '等待生成二维码'}
                              </div>
                              <p className="text-sm leading-6 text-muted">
                                {qrMessage || '点击生成二维码，扫码完成后才能创建项目。'}
                              </p>
                            </div>
                            {qrPayload.ready === 'true' ? <Chip color="success" variant="soft">平台连接已完成</Chip> : null}
                            <div className="flex items-center justify-center gap-2">
                              {qrImage ? (
                                <Tooltip delay={300}>
                                  <Tooltip.Trigger>
                                    <Button isIconOnly aria-label="重新生成二维码" variant="ghost" onPress={beginQrSetup} isDisabled={isBusy}>
                                      <Icon icon={isBusy ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={isBusy ? 'animate-spin' : ''} />
                                    </Button>
                                  </Tooltip.Trigger>
                                  <Tooltip.Content>重新生成二维码</Tooltip.Content>
                                </Tooltip>
                              ) : (
                                <Button variant="primary" onPress={beginQrSetup} isDisabled={isBusy}>
                                  <Icon icon={isBusy ? 'lucide:loader-circle' : 'lucide:qr-code'} className={isBusy ? 'animate-spin' : ''} />
                                  生成二维码
                                </Button>
                              )}
                              {qrUrl && qrPayload.ready !== 'true' ? (
                                <Button variant="secondary" onPress={openQrUrl}>
                                  <Icon icon="lucide:external-link" />
                                  网页授权
                                </Button>
                              ) : null}
                            </div>
                          </Card.Content>
                        </Card>
                      ) : (
                        <ItemCardGroup className="overflow-hidden" variant="secondary">
                          <ItemCardGroup.Header>
                            <ItemCardGroup.Title>手动密钥配置</ItemCardGroup.Title>
                            <ItemCardGroup.Description>请填写 {platformMeta.label} 的必填凭据。完成校验后才会创建项目，不会生成未连接的平台配置。</ItemCardGroup.Description>
                          </ItemCardGroup.Header>
                          {platformMeta.fields.map((field, index) => (
                            <Fragment key={field.key}>
                              {index > 0 ? <Separator /> : null}
                              <WizardFormItem icon={field.secret ? 'lucide:key-round' : 'lucide:settings-2'} title={`${field.label}${field.required ? ' *' : ''}`} description={field.required ? '必填字段' : '可选高级设置'}>
                                <Input fullWidth variant="secondary" type="text" value={manualOptions[field.key] ?? ''} placeholder={field.placeholder} onChange={(event) => updateManualOption(field.key, event.target.value)} />
                              </WizardFormItem>
                            </Fragment>
                          ))}
                        </ItemCardGroup>
                      )}
                    </Card.Content>
                  </Card>
                ) : null}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={() => handleOpenChange(false)} isDisabled={isBusy}>取消</Button>
              {step !== 'basic' ? <Button variant="secondary" onPress={() => setStep(step === 'connect' ? 'platform' : 'basic')} isDisabled={isBusy}>上一步</Button> : null}
              {step === 'basic' ? <Button variant="primary" onPress={goPlatformStep} isDisabled={!basicValid}>下一步</Button> : null}
              {step === 'platform' ? <Button variant="primary" onPress={goConnectStep}>下一步</Button> : null}
              {step === 'connect' ? (
                <Button variant="primary" onPress={completeWizard} isDisabled={!canFinish || isBusy}>
                  <Icon icon={isBusy ? 'lucide:loader-circle' : 'lucide:check'} className={isBusy ? 'animate-spin' : ''} />
                  创建项目
                </Button>
              ) : null}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

function PlatformWizardSteps({ onStepChange, step }: { onStepChange: (step: Extract<ProjectWizardStep, 'platform' | 'connect'>) => void; step: Extract<ProjectWizardStep, 'platform' | 'connect'> }) {
  const steps: Array<{ key: Extract<ProjectWizardStep, 'platform' | 'connect'>; title: string; description: string; icon: string }> = [
    { key: 'platform', title: '平台', description: '选择消息入口', icon: 'lucide:messages-square' },
    { key: 'connect', title: '连接', description: '扫码或密钥', icon: 'lucide:plug-zap' },
  ]
  const currentIndex = Math.max(0, steps.findIndex((item) => item.key === step))
  return (
    <Stepper currentStep={currentIndex} size="md" onStepChange={(index) => onStepChange(steps[index]?.key ?? step)}>
      {steps.map((item) => (
        <Stepper.Step key={item.key}>
          <Stepper.Indicator><Stepper.Icon><Icon icon={item.icon} className="size-4" /></Stepper.Icon></Stepper.Indicator>
          <Stepper.Content><Stepper.Title>{item.title}</Stepper.Title><Stepper.Description>{item.description}</Stepper.Description></Stepper.Content>
          <Stepper.Separator />
        </Stepper.Step>
      ))}
    </Stepper>
  )
}

function WizardSteps({ onStepChange, step }: { onStepChange: (step: ProjectWizardStep) => void; step: ProjectWizardStep }) {
  const steps: Array<{ key: ProjectWizardStep; title: string; description: string; icon: string }> = [
    { key: 'basic', title: '项目', description: '名称与 Agent', icon: 'lucide:folder-cog' },
    { key: 'platform', title: '平台', description: '选择消息入口', icon: 'lucide:messages-square' },
    { key: 'connect', title: '连接', description: '扫码或密钥', icon: 'lucide:plug-zap' },
  ]
  const currentIndex = Math.max(0, steps.findIndex((item) => item.key === step))
  return (
    <Stepper currentStep={currentIndex} size="md" onStepChange={(index) => onStepChange(steps[index]?.key ?? step)}>
      {steps.map((item) => (
        <Stepper.Step key={item.key}>
          <Stepper.Indicator>
            <Stepper.Icon>
              <Icon icon={item.icon} className="size-4" />
            </Stepper.Icon>
          </Stepper.Indicator>
          <Stepper.Content>
            <Stepper.Title>{item.title}</Stepper.Title>
            <Stepper.Description>{item.description}</Stepper.Description>
          </Stepper.Content>
          <Stepper.Separator />
        </Stepper.Step>
      ))}
    </Stepper>
  )
}

function WizardFormItem({ children, description, icon, title }: { children: ReactNode; description: string; icon: string; title: string }) {
  return (
    <ItemCard>
      <ItemCard.Icon>
        <Icon icon={icon} />
      </ItemCard.Icon>
      <ItemCard.Content>
        <ItemCard.Title>{title}</ItemCard.Title>
        <ItemCard.Description>{description}</ItemCard.Description>
      </ItemCard.Content>
      <ItemCard.Action className="w-auto max-w-sm">
        {children}
      </ItemCard.Action>
    </ItemCard>
  )
}

function ProjectEditor({
  canDelete,
  isSaving,
  onAgentChange,
  onChange,
  onDelete,
  onPlatformAdd,
  onPlatformChange,
  onPlatformDelete,
  project,
  providerOptions,
}: {
  canDelete: boolean
  isSaving: boolean
  onAgentChange: (patch: Partial<CCConnectProjectAgentConfig>) => void
  onChange: (patch: Partial<CCConnectProjectConfig>) => void
  onDelete: () => void
  onPlatformAdd: () => void
  onPlatformChange: (index: number, patch: Partial<CCConnectProjectPlatformConfig>) => void
  onPlatformDelete: (index: number) => void
  project: CCConnectProjectConfig
  providerOptions: CCConnectModelProviderConfig[]
}) {
  const [activeSection, setActiveSection] = useState<ProjectEditorSection>('basic')
  const [editingPlatformIndex, setEditingPlatformIndex] = useState<number | null>(null)
  const providerNames = useMemo(() => uniqueCleanList(providerOptions.map((provider) => provider.name)), [providerOptions])
  const providerRefValues = useMemo(() => project.agent.providerRefs ?? [], [project.agent.providerRefs])
  const selectableProviderNames = useMemo(() => uniqueCleanList(project.agent.provider && !providerRefValues.includes(project.agent.provider) ? [...providerRefValues, project.agent.provider] : providerRefValues), [project.agent.provider, providerRefValues])
  const modelOptions = useMemo(() => providerModelOptions(providerOptions, project.agent.provider, project.agent.model ?? ''), [project.agent.model, project.agent.provider, providerOptions])

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Segment aria-label="项目配置分区" selectedKey={activeSection} onSelectionChange={(key) => setActiveSection(String(key) as ProjectEditorSection)}>
          <Segment.Item id="basic">
            <Segment.Separator />
            基本信息
          </Segment.Item>
          <Segment.Item id="agent">
            <Segment.Separator />
            Agent 配置
          </Segment.Item>
          <Segment.Item id="platforms">
            <Segment.Separator />
            消息平台
          </Segment.Item>
        </Segment>

        <Tooltip delay={300}>
          <Button aria-label="删除项目" className="self-end md:self-auto" variant="danger" onPress={onDelete} isDisabled={isSaving || !canDelete}>
            <Icon icon="lucide:trash-2" />
            删除
          </Button>
          <Tooltip.Content>{canDelete ? '删除项目' : '至少需要保留一个项目'}</Tooltip.Content>
        </Tooltip>
      </div>

      {activeSection === 'basic' ? (
        <div className="grid gap-4">
          <ItemCardGroup className="overflow-hidden">
            <ItemCardGroup.Header>
              <ItemCardGroup.Title>基本信息</ItemCardGroup.Title>
              <ItemCardGroup.Description>{project.agent.workDir || '未设置工作目录'}</ItemCardGroup.Description>
            </ItemCardGroup.Header>
            <ProjectFormItem description="会写入 [[projects]] 的 name，也是消息路由时最重要的识别字段。" icon="lucide:folder-cog" title="Name">
              <Input fullWidth variant="secondary" value={project.name} disabled={isSaving} placeholder="my-project" onChange={(event) => onChange({ name: event.target.value })} />
            </ProjectFormItem>
            <Separator />
            <ProjectFormItem description="Agent 执行命令和读取仓库的工作目录。" icon="lucide:folder-open" title="Work Dir">
              <Input fullWidth variant="secondary" value={project.agent.workDir ?? ''} disabled={isSaving} placeholder="" onChange={(event) => onAgentChange({ workDir: event.target.value })} />
            </ProjectFormItem>
            <Separator />
            <ProjectFormItem description="项目长时间无消息时重置会话上下文，0 表示不主动重置。" icon="lucide:timer-reset" title="Reset On Idle">
              <Input fullWidth variant="secondary" type="number" min={0} value={String(project.resetOnIdleMins || '')} disabled={isSaving} placeholder="30" onChange={(event) => onChange({ resetOnIdleMins: numberFromInput(event.target.value) })} />
            </ProjectFormItem>
            <Separator />
            <ProjectFormItem description="需要以指定系统用户运行 Agent 时填写。" icon="lucide:user-round" title="Run As User">
              <Input fullWidth variant="secondary" value={project.runAsUser ?? ''} disabled={isSaving} placeholder="deploy" onChange={(event) => onChange({ runAsUser: event.target.value })} />
            </ProjectFormItem>
            <Separator />
            <ProjectFormItem description="运行时允许透传的环境变量名，多个用逗号分隔。" icon="lucide:list-plus" title="Run As Env">
              <Input fullWidth variant="secondary" value={(project.runAsEnv ?? []).join(', ')} disabled={isSaving} placeholder="PGSSLROOTCERT, PGSSLMODE" onChange={(event) => onChange({ runAsEnv: splitCommaList(event.target.value) })} />
            </ProjectFormItem>
          </ItemCardGroup>

          <ItemCardGroup className="overflow-hidden">
            <ItemCardGroup.Header>
              <ItemCardGroup.Title>命令与权限</ItemCardGroup.Title>
              <ItemCardGroup.Description>控制管理命令、回复形态和发送人注入。</ItemCardGroup.Description>
            </ItemCardGroup.Header>
            <ProjectFormItem description="允许执行 /shell、/restart、/upgrade 等高权限命令的用户或群。" icon="lucide:shield-check" title="Admin From">
              <Input fullWidth variant="secondary" value={project.adminFrom ?? ''} disabled={isSaving} placeholder="ou_xxx, chat_xxx" onChange={(event) => onChange({ adminFrom: event.target.value })} />
            </ProjectFormItem>
            <Separator />
            <ProjectFormItem description="隐藏或禁用指定命令，多个命令用逗号分隔。" icon="lucide:ban" title="Disabled Commands">
              <Input fullWidth variant="secondary" value={(project.disabledCommands ?? []).join(', ')} disabled={isSaving} placeholder="/shell, /restart" onChange={(event) => onChange({ disabledCommands: splitCommaList(event.target.value) })} />
            </ProjectFormItem>
            {projectSwitches.map((item) => (
              <Fragment key={item.key}>
                <Separator />
                <ProjectFormItem actionClassName="w-fit" description={item.description} icon={projectSwitchIcon(item.key)} title={item.label}>
                  <Switch size="lg" aria-label={item.label} isSelected={Boolean(project[item.key])} isDisabled={isSaving} onChange={(isSelected) => onChange({ [item.key]: isSelected })}>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch>
                </ProjectFormItem>
              </Fragment>
            ))}
          </ItemCardGroup>
        </div>
      ) : null}

      {activeSection === 'agent' ? (
        <div className="grid gap-4">
          <ItemCardGroup className="overflow-hidden">
            <ItemCardGroup.Header>
              <ItemCardGroup.Title>运行目标</ItemCardGroup.Title>
              <ItemCardGroup.Description>选择 Agent 引擎和权限模式。</ItemCardGroup.Description>
            </ItemCardGroup.Header>
            <ProjectFormItem description="决定该项目使用 Claude Code、Codex、Cursor、Gemini 等哪个引擎。" icon="lucide:bot" title="Type">
              <InlineSelect ariaLabel="Agent Type" disabled={isSaving} options={agentTypes} value={project.agent.type} onChange={(value) => onAgentChange({ type: value || 'claudecode' })} />
            </ProjectFormItem>
            <Separator />
            <ProjectFormItem description="控制 Agent 执行工具和编辑文件时的确认策略。" icon="lucide:shield-check" title="权限模式">
              <InlineSelect ariaLabel="权限模式" disabled={isSaving} options={permissionModes} renderOption={permissionModeLabel} value={project.agent.mode ?? 'default'} onChange={(value) => onAgentChange({ mode: value || 'default' })} />
            </ProjectFormItem>
          </ItemCardGroup>

          <ItemCardGroup className="overflow-hidden">
            <ItemCardGroup.Header>
              <ItemCardGroup.Title>模型与工具</ItemCardGroup.Title>
              <ItemCardGroup.Description>必要时覆盖模型、Provider、思考强度和工具权限。</ItemCardGroup.Description>
            </ItemCardGroup.Header>
            <ProjectFormItem description="留空时沿用 Agent 默认模型；选择 Provider 后会列出该 Provider 的模型。" icon="lucide:brain-circuit" title="Model">
              <ModelSelect
                disabled={isSaving}
                options={modelOptions}
                value={project.agent.model ?? ''}
                onChange={(model) => onAgentChange({ model })}
              />
            </ProjectFormItem>
            <Separator />
            <ProjectFormItem description="从已引用的 Provider Refs 中选择一个；留空时由 Agent 自己解析。" icon="lucide:plug" title="Provider">
              <ProviderSelect
                disabled={isSaving}
                options={selectableProviderNames}
                value={project.agent.provider ?? ''}
                onChange={(provider) => onAgentChange({ provider })}
              />
            </ProjectFormItem>
            <Separator />
            <ProjectFormItem description="引用全局 providers 配置，可选择多个。" icon="lucide:link" title="Provider Refs">
              <ProviderRefsSelect
                disabled={isSaving}
                options={providerNames}
                value={providerRefValues}
                onChange={(providerRefs) => onAgentChange({ providerRefs, provider: providerRefs.includes(project.agent.provider ?? '') ? project.agent.provider : '', model: providerRefs.includes(project.agent.provider ?? '') ? project.agent.model : '' })}
              />
            </ProjectFormItem>
            <Separator />
            <ProjectFormItem description="复杂任务可调高，普通项目保持默认即可。" icon="lucide:sparkles" title="Reasoning Effort">
              <InlineSelect ariaLabel="Reasoning Effort" disabled={isSaving} options={reasoningEfforts} value={project.agent.reasoningEffort ?? ''} onChange={(value) => onAgentChange({ reasoningEffort: value })} />
            </ProjectFormItem>
            <Separator />
            <ProjectFormItem description="只允许使用这些工具，多个用逗号分隔。" icon="lucide:wrench" title="Allowed Tools">
              <Input fullWidth variant="secondary" value={(project.agent.allowedTools ?? []).join(', ')} disabled={isSaving} placeholder="Read, Grep, Glob" onChange={(event) => onAgentChange({ allowedTools: splitCommaList(event.target.value) })} />
            </ProjectFormItem>
            <Separator />
            <ProjectFormItem description="显式禁止某些工具，多个用逗号分隔。" icon="lucide:shield-x" title="Disallowed Tools">
              <Input fullWidth variant="secondary" value={(project.agent.disallowedTools ?? []).join(', ')} disabled={isSaving} placeholder="WebSearch" onChange={(event) => onAgentChange({ disallowedTools: splitCommaList(event.target.value) })} />
            </ProjectFormItem>
          </ItemCardGroup>

          <Card>
            <Card.Header>
              <div>
                <Card.Title>环境与提示词</Card.Title>
                <Card.Description>补充运行环境变量、额外启动参数和系统提示词。</Card.Description>
              </div>
            </Card.Header>
            <Card.Content className="grid gap-4 lg:grid-cols-2">
              <TextAreaField disabled={isSaving} label="Env" value={stringMapToText(project.agent.env)} placeholder="ANTHROPIC_BASE_URL=https://api.example.com" onChange={(value) => onAgentChange({ env: textToStringMap(value) })} />
              <TextAreaField disabled={isSaving} label="Additional Options" value={stringMapToText(project.agent.additionalOptions)} placeholder="permission_mode=acceptEdits" onChange={(value) => onAgentChange({ additionalOptions: textToStringMap(value) })} />
              <div className="lg:col-span-2">
                <TextAreaField disabled={isSaving} label="System Prompt" value={project.agent.systemPrompt ?? ''} placeholder="追加给 Agent 的系统提示" onChange={(value) => onAgentChange({ systemPrompt: value })} />
              </div>
            </Card.Content>
          </Card>
        </div>
      ) : null}

      {activeSection === 'platforms' ? (
        <Card>
          <Card.Header>
            <div className="flex items-center justify-between">
              <Card.Title className="text-base">
                消息平台
              </Card.Title>
              {/* <Card.Description>对应 [[projects.platforms]] 与 options。</Card.Description> */}
              <Button size="sm" variant="primary" onPress={onPlatformAdd} isDisabled={isSaving}>
                <Icon icon="lucide:plus" />
                添加
              </Button>
            </div>
          </Card.Header>
          <Card.Content>
            {project.platforms.length > 0 ? (
              <ItemCardGroup className="overflow-hidden">
                {project.platforms.map((platform, index) => {
                  const meta = platformSetupMeta[platform.type] ?? platformSetupMeta.feishu
                  const status = platformConfigStatus(platform)
                  return (
                    <Fragment key={`${platform.type}-${index}`}>
                      {index > 0 ? <Separator /> : null}
                      <ItemCard>
                        <ItemCard.Icon className={`size-10 rounded-full ${status.complete ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
                          <Icon icon={meta.icon} className="size-5" />
                        </ItemCard.Icon>
                        <ItemCard.Content>
                          <ItemCard.Title>{meta.label}</ItemCard.Title>
                          <ItemCard.Description>
                            {platformDetailLabel(platform)}
                          </ItemCard.Description>
                        </ItemCard.Content>
                        <ItemCard.Action>
                          <div className="flex items-center gap-1">
                            <Tooltip delay={300}>
                              <Tooltip.Trigger>
                                <Button isIconOnly aria-label="设置平台" variant="ghost" onPress={() => setEditingPlatformIndex(index)} isDisabled={isSaving}>
                                  <Icon icon="lucide:settings" />
                                </Button>
                              </Tooltip.Trigger>
                              <Tooltip.Content>设置平台</Tooltip.Content>
                            </Tooltip>
                            <Tooltip delay={300}>
                              <Tooltip.Trigger>
                                <Button isIconOnly aria-label="移除平台" className="text-danger" variant="ghost" onPress={() => onPlatformDelete(index)} isDisabled={isSaving}>
                                  <Icon icon="lucide:trash-2" />
                                </Button>
                              </Tooltip.Trigger>
                              <Tooltip.Content>移除平台</Tooltip.Content>
                            </Tooltip>
                          </div>
                        </ItemCard.Action>
                      </ItemCard>
                    </Fragment>
                  )
                })}
              </ItemCardGroup>
            ) : <EmptyState icon="lucide:messages-square" title="未配置消息平台" description="添加 Feishu、Telegram、Slack 等平台后，消息才能路由到该项目。" />}
            <PlatformEditModal
              index={editingPlatformIndex}
              isDisabled={isSaving}
              platform={editingPlatformIndex === null ? null : project.platforms[editingPlatformIndex] ?? null}
              onChange={onPlatformChange}
              onClose={() => setEditingPlatformIndex(null)}
            />
          </Card.Content>
        </Card>
      ) : null}
    </div>
  )
}

function platformConfigStatus(platform: CCConnectProjectPlatformConfig) {
  const missingLabels = platformOptionEntries(platform)
    .filter((entry) => entry.required && entry.key !== 'allow_from' && !String(entry.value ?? '').trim())
    .map((entry) => entry.label)
  return { complete: missingLabels.length === 0, missingLabels }
}

function platformDetailLabel(platform: CCConnectProjectPlatformConfig) {
  const options = platform.options ?? {}
  const idKey = Object.keys(options).find((key) => /(^|_)id$/i.test(key) && String(options[key] ?? '').trim())
  if (idKey) return `${idKey}: ${String(options[idKey] ?? '').trim()}`
  const tokenKey = Object.keys(options).find((key) => /token/i.test(key) && String(options[key] ?? '').trim())
  if (tokenKey) return `${tokenKey}: ${String(options[tokenKey] ?? '').trim()}`
  return '未填写 ID / Token'
}

function PlatformEditModal({
  index,
  isDisabled,
  onChange,
  onClose,
  platform,
}: {
  index: number | null
  isDisabled: boolean
  onChange: (index: number, patch: Partial<CCConnectProjectPlatformConfig>) => void
  onClose: () => void
  platform: CCConnectProjectPlatformConfig | null
}) {
  const isOpen = index !== null && Boolean(platform)
  const meta = platform ? platformSetupMeta[platform.type] ?? platformSetupMeta.feishu : platformSetupMeta.feishu

  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={(open) => {
        if (!open) onClose()
      }} variant="opaque">
        <Modal.Container size="lg" scroll="inside">
          <Modal.Dialog className="sm:max-w-[640px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Icon className="bg-accent/10 text-accent">
                <Icon icon={meta.icon} />
              </Modal.Icon>
              <div>
                <Modal.Heading>设置消息平台</Modal.Heading>
                <p className="mt-1 text-sm text-muted">修改 {meta.label} 的 options 设置项。</p>
              </div>
            </Modal.Header>
            <Modal.Body>
              {platform && index !== null ? (
                <ItemCardGroup className="overflow-hidden">
                  {platformOptionEntries(platform).map((entry, entryIndex) => (
                    <Fragment key={entry.key}>
                      {entryIndex > 0 ? <Separator /> : null}
                      <ProjectFormItem actionClassName="w-full" description={entry.description} icon={entry.secret ? 'lucide:key-round' : 'lucide:settings-2'} title={entry.label}>
                        <Input
                          fullWidth
                          disabled={isDisabled}
                          placeholder={entry.placeholder}
                          type="text"
                          value={entry.value}
                          variant="secondary"
                          onChange={(event) => onChange(index, { options: { ...(platform.options ?? {}), [entry.key]: event.target.value } })}
                        />
                      </ProjectFormItem>
                    </Fragment>
                  ))}
                </ItemCardGroup>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="primary" onPress={onClose}>完成</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

function platformOptionEntries(platform: CCConnectProjectPlatformConfig) {
  const meta = platformSetupMeta[platform.type] ?? platformSetupMeta.feishu
  const knownKeys = new Set(meta.fields.map((field) => field.key))
  const extraFields = Object.keys(platform.options ?? {})
    .filter((key) => !knownKeys.has(key))
    .sort()
    .map((key) => ({ key, label: key, placeholder: undefined, required: false, secret: /secret|token|key|password/i.test(key) }))
  const fields = [...meta.fields, ...extraFields]
  return fields.length ? fields.map((field) => ({
    ...field,
    description: field.required ? '必填设置项' : '可选设置项',
    value: String(platform.options?.[field.key] ?? ''),
  })) : [{ key: 'value', label: 'value', description: '设置项', placeholder: 'value', required: false, secret: false, value: String(platform.options?.value ?? '') }]
}

function ProjectFormItem({
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

function ModelSelect({ disabled, onChange, options, value }: { disabled?: boolean; onChange: (value: string) => void; options: string[]; value: string }) {
  return (
    <CellSelect aria-label="Model" isDisabled={disabled} value={value || defaultSelectKey} variant="secondary" onChange={(key: Key | null) => onChange(key && key !== defaultSelectKey ? String(key) : '')}>
      <CellSelect.Trigger>
        <CellSelect.Value>
          {value || '默认模型'}
        </CellSelect.Value>
        <CellSelect.Indicator />
      </CellSelect.Trigger>
      <CellSelect.Popover>
        <ListBox>
          <ListBox.Item id={defaultSelectKey} textValue="默认模型">
            默认模型
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {options.length ? options.map((option) => (
            <ListBox.Item key={option} id={option} textValue={option}>
              {option}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          )) : (
            <ListBox.Item id="__empty__" textValue="当前 Provider 未配置模型" isDisabled>
              当前 Provider 未配置模型
            </ListBox.Item>
          )}
        </ListBox>
      </CellSelect.Popover>
    </CellSelect>
  )
}

function ProviderSelect({ disabled, onChange, options, value }: { disabled?: boolean; onChange: (value: string) => void; options: string[]; value: string }) {
  const displayOptions = useMemo(() => uniqueCleanList(value ? [...options, value] : options), [options, value])

  return (
    <CellSelect aria-label="Provider" isDisabled={disabled} value={value || defaultSelectKey} variant="secondary" onChange={(key: Key | null) => onChange(key && key !== defaultSelectKey ? String(key) : '')}>
      <CellSelect.Trigger>
        <CellSelect.Value>
          {value || '自动解析'}
        </CellSelect.Value>
        <CellSelect.Indicator />
      </CellSelect.Trigger>
      <CellSelect.Popover>
        <ListBox>
          <ListBox.Item id={defaultSelectKey} textValue="自动解析">
            自动解析
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {displayOptions.map((option) => (
            <ListBox.Item key={option} id={option} textValue={option}>
              {option}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </CellSelect.Popover>
    </CellSelect>
  )
}

function ProviderRefsSelect({ disabled, onChange, options, value }: { disabled?: boolean; onChange: (value: string[]) => void; options: string[]; value: string[] }) {
  const displayOptions = useMemo(() => uniqueCleanList([...options, ...value]), [options, value])
  const selectedLabels = value.length ? value.join(', ') : '未引用 Provider'

  return (
    <Dropdown>
      <Button aria-label="Provider Refs" className="justify-between" isDisabled={disabled} variant="tertiary">
        <span className="min-w-0 truncate">{selectedLabels}</span>
        <Icon icon="lucide:chevron-down" className="size-4 shrink-0 text-muted" />
      </Button>
      <Dropdown.Popover className="min-w-72" placement="bottom end">
        <Dropdown.Menu
          selectedKeys={new Set(value)}
          selectionMode="multiple"
          onSelectionChange={(selection) => onChange(selectionToStrings(selection))}
        >
          {displayOptions.length ? displayOptions.map((option) => (
            <Dropdown.Item key={option} id={option} textValue={option}>
              <Dropdown.ItemIndicator />
              <div className="flex min-w-0 items-center gap-3">
                <Icon icon="lucide:plug" className="size-4 shrink-0 text-muted" />
                <Label className="min-w-0 truncate">{option}</Label>
              </div>
            </Dropdown.Item>
          )) : (
            <Dropdown.Item id="__empty__" textValue="暂无可选 Provider" isDisabled>
              <div className="flex min-w-0 items-center gap-3">
                <Icon icon="lucide:circle-alert" className="size-4 shrink-0 text-muted" />
                <Label className="min-w-0 truncate">暂无可选 Provider</Label>
              </div>
            </Dropdown.Item>
          )}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function InlineSelect({
  ariaLabel,
  disabled,
  onChange,
  options,
  renderOption,
  value,
}: {
  ariaLabel: string
  disabled?: boolean
  onChange: (value: string) => void
  options: string[]
  renderOption?: (value: string) => string
  value: string
}) {
  return (
    <CellSelect aria-label={ariaLabel} isDisabled={disabled} value={value || defaultSelectKey} variant="secondary" onChange={(key: Key | null) => onChange(key && key !== defaultSelectKey ? String(key) : '')}>
      <CellSelect.Trigger>
        <CellSelect.Value />
        <CellSelect.Indicator />
      </CellSelect.Trigger>
      <CellSelect.Popover>
        <ListBox>
          <ListBox.Item id={defaultSelectKey} textValue="默认 / 未设置">
            默认 / 未设置
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {options.map((option) => (
            <ListBox.Item key={option} id={option} textValue={renderOption?.(option) ?? option}>
              {renderOption?.(option) ?? option}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </CellSelect.Popover>
    </CellSelect>
  )
}

function permissionModeLabel(mode: string) {
  switch (mode) {
    case 'acceptEdits':
      return 'acceptEdits (edit)'
    case 'bypassPermissions':
      return 'bypassPermissions (yolo)'
    default:
      return mode
  }
}

function projectSwitchIcon(key: ProjectSwitchKey) {
  switch (key) {
    case 'filterExternalSessions':
      return 'lucide:filter'
    case 'injectSender':
      return 'lucide:user-round-plus'
    case 'replyFooter':
      return 'lucide:panel-bottom'
    case 'showContextIndicator':
      return 'lucide:badge-info'
  }
}

function SelectField({ disabled, onChange, options, value }: { disabled?: boolean; onChange: (value: string) => void; options: string[]; value: string }) {
  return (
    <div className="grid gap-2">
      <CellSelect aria-label="Agent Type" isDisabled={disabled} value={value || defaultSelectKey} variant="secondary" onChange={(key: Key | null) => onChange(key && key !== defaultSelectKey ? String(key) : '')}>
        <CellSelect.Trigger>
          <CellSelect.Value />
          <CellSelect.Indicator />
        </CellSelect.Trigger>
        <CellSelect.Popover>
          <ListBox>
            <ListBox.Item id={defaultSelectKey} textValue="默认 / 未设置">
              默认 / 未设置
              <ListBox.ItemIndicator />
            </ListBox.Item>
            {options.map((option) => (
              <ListBox.Item key={option} id={option} textValue={option}>
                {option}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </CellSelect.Popover>
      </CellSelect>
    </div>
  )
}

function TextAreaField({ disabled, label, onChange, placeholder, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; placeholder?: string; value: string }) {
  return (
    <div className="grid gap-2">
      <Label className="text-sm font-medium">{label}</Label>
      <textarea
        aria-label={label}
        className="min-h-32 w-full resize-y rounded-2xl border border-border bg-surface-secondary/50 px-3 py-2 font-mono text-xs leading-6 text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function ProjectsOverviewChart({ stats }: { stats: ReturnType<typeof summarizeDraft> }) {
  const entries = Object.entries(stats.agentTypes)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
  const chartData = entries.map(([name, value], index) => ({
    fill: projectChartColors[index % projectChartColors.length],
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
              <span className="text-xl font-bold tabular-nums text-foreground">{stats.projectCount}</span>
              <span className="text-[10px] text-muted">全部项目</span>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-3">
            <ProjectOverviewMetric label="Agent Types" value={Object.keys(stats.agentTypes).length} />
            {entries.slice(0, 3).map(([name, value], index) => (
              <ProjectOverviewLegendItem key={name} label={name} value={value} color={projectChartColors[index % projectChartColors.length]} />
            ))}
            {entries.length === 0 ? <ProjectOverviewMetric label="暂无 Agent" value={0} /> : null}
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function ProjectOverviewMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  )
}

function ProjectOverviewLegendItem({ label, value, color }: { label: string; value: number; color: string }) {
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

function EmptyState({ action, description, icon, title }: { action?: ReactNode; description?: string; icon: string; title: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-2xl bg-surface-secondary/40 px-6 py-8 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-surface text-muted">
        <Icon icon={icon} className="size-5" />
      </div>
      <div className="mt-3 text-sm font-medium text-foreground">{title}</div>
      {description ? <div className="mt-1 max-w-md text-xs leading-5 text-muted">{description}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

function ProjectsSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-56 rounded-3xl" />
      <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.46fr)_minmax(0,1.54fr)]">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-[42rem] rounded-2xl" />
      </div>
    </div>
  )
}

function visibleCCConnectProjects(projects: CCConnectProjectConfig[]) {
  return projects.filter((project) => !isReservedDefaultProject(project.name))
}

function normalizeConfig(config: CCConnectProjectsConfig): CCConnectProjectsConfig {
  return {
    projects: (config.projects ?? []).map(normalizeProject).filter((project) => project.name),
  }
}

function normalizeProject(project: CCConnectProjectConfig): CCConnectProjectConfig {
  return {
    ...cloneProject(emptyProject),
    ...project,
    name: project.name?.trim() ?? '',
    resetOnIdleMins: project.resetOnIdleMins ?? 0,
    runAsEnv: uniqueCleanList(project.runAsEnv ?? []),
    disabledCommands: uniqueCleanList(project.disabledCommands ?? []),
    agent: normalizeAgent(project.agent ?? emptyProject.agent),
    platforms: (project.platforms ?? []).map((platform) => ({
      type: platform.type?.trim() ?? '',
      options: platform.options ?? {},
    })).filter((platform) => platform.type),
  }
}

function normalizeAgent(agent: CCConnectProjectAgentConfig): CCConnectProjectAgentConfig {
  return {
    ...emptyProject.agent,
    ...agent,
    type: agent.type?.trim() || 'claudecode',
    allowedTools: uniqueCleanList(agent.allowedTools ?? []),
    disallowedTools: uniqueCleanList(agent.disallowedTools ?? []),
    providerRefs: uniqueCleanList(agent.providerRefs ?? []),
    env: agent.env ?? {},
    additionalOptions: agent.additionalOptions ?? {},
  }
}

function cloneConfig(config: CCConnectProjectsConfig): CCConnectProjectsConfig {
  return JSON.parse(JSON.stringify(config)) as CCConnectProjectsConfig
}

function cloneProject(project: CCConnectProjectConfig): CCConnectProjectConfig {
  return JSON.parse(JSON.stringify(project)) as CCConnectProjectConfig
}

function configFingerprint(config: CCConnectProjectsConfig) {
  return JSON.stringify(normalizeConfig(config))
}

function providerModelOptions(providers: CCConnectModelProviderConfig[], providerName: string | undefined, currentModel: string) {
  const provider = providers.find((item) => item.name === providerName)
  const models = provider?.models?.map((item) => item.alias || item.model) ?? []
  return uniqueCleanList(currentModel ? [...models, currentModel] : models)
}

function summarizeDraft(config: CCConnectProjectsConfig | null) {
  const summary = { agentTypes: {} as Record<string, number>, platformCount: 0, platformTypes: {} as Record<string, number>, projectCount: 0 }
  if (!config) return summary
  summary.projectCount = visibleCCConnectProjects(config.projects).length
  for (const project of visibleCCConnectProjects(config.projects)) {
    if (project.agent.type) {
      summary.agentTypes[project.agent.type] = (summary.agentTypes[project.agent.type] ?? 0) + 1
    }
    summary.platformCount += project.platforms.length
    for (const platform of project.platforms) {
      if (platform.type) {
        summary.platformTypes[platform.type] = (summary.platformTypes[platform.type] ?? 0) + 1
      }
    }
  }
  return summary
}

function nextProjectName(projects: CCConnectProjectConfig[]) {
  const names = new Set(projects.map((project) => project.name))
  let index = projects.length + 1
  let name = `project-${index}`
  while (names.has(name)) {
    index += 1
    name = `project-${index}`
  }
  return name
}

function uniqueCleanList(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))]
}

function splitCommaList(value: string) {
  return uniqueCleanList(value.split(','))
}

function numberFromInput(value: string) {
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function selectionToStrings(selection: Selection) {
  if (selection === 'all') return []
  return Array.from(selection).map((item) => String(item)).filter((item) => item !== '__empty__')
}

function stringMapToText(value?: Record<string, string>) {
  return Object.entries(value ?? {}).map(([key, itemValue]) => `${key}=${itemValue}`).join('\n')
}

function textToStringMap(value: string) {
  const out: Record<string, string> = {}
  for (const line of value.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex < 0) {
      out[trimmed] = ''
      continue
    }
    const key = trimmed.slice(0, separatorIndex).trim()
    if (!key) continue
    out[key] = trimmed.slice(separatorIndex + 1).trim()
  }
  return out
}

function cleanTextRecord(values: Record<string, string>) {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    const cleanKey = key.trim()
    if (!cleanKey) continue
    out[cleanKey] = value.trim()
  }
  return out
}

export default CCConnectProjectsPage
