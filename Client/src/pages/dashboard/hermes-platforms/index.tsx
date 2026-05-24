import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject, type SVGProps } from 'react'
import * as QRCode from 'qrcode'
import { Button, Card, Chip, Input, Label, ListBox, Modal, Skeleton, Switch, TextArea, TextField, Tooltip, toast } from '@heroui/react'
import { CellSelect, ItemCard, ItemCardGroup, PieChart, RadioButtonGroup } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type { HermesPlatformInfo, HermesPlatformsResponse, HermesTaskResponse, HermesTaskStreamError, HermesTaskStreamLog, HermesTaskStreamMeta, HermesTaskStreamStatus } from '@/api'
import { getHermesPlatformQRSetupStreamURL, getHermesPlatforms, updateHermesPlatform } from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { openExternalUrl } from '@/utils/openExternalUrl'
import DashboardLayout from '@/layouts/Dashboard'
import { useHermesAgentStore } from '@/stores/hermes-agent'
import { HermesLoadErrorCard } from '../hermes-shared/HermesLoadErrorCard'
import { HermesPairingModal } from './hermes-pairing'

type LoadState = 'idle' | 'loading' | 'ready' | 'error'
type PlatformTab = 'all' | 'common' | 'core' | 'enabled' | 'plugin'
type HermesPlatformQRInfo = {
  description: string
  icon: string
  label: string
  openLabel?: string
  openWindowName?: string
}
type PlatformDraft = {
  allowed: string
  enabled: boolean
  env: Record<string, string>
  freeResponse: string
  gatewayRestartNotification: boolean
  noticeDelivery: string
  replyToMode: string
  requireMention: boolean
  unauthorizedDmBehavior: string
}

const platformChartColors = {
  connected: 'var(--success)',
  configured: 'var(--accent)',
  enabled: 'var(--warning)',
  total: 'var(--muted)',
}

const platformsGridStroke = 'rgba(247, 247, 247, 1)'

function HermesPlatformsHeroIllustration(props: Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'xmlns'>) {
  const { className, ...rest } = props
  const accentRing = 'color-mix(in oklch, var(--accent) 62%, white)'
  const accentSoft = 'color-mix(in oklch, var(--accent) 36%, white)'
  const accentDeep = 'color-mix(in oklch, var(--accent), black 14%)'
  const accentHalf = 'color-mix(in oklch, var(--accent) 80%, black)'
  const phoneGradId = 'hermesPlatformsHeroPhone'

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="128 60 318 180"
      fill="none"
      className={className}
      aria-hidden
      {...rest}
    >
      <defs>
        <linearGradient id={phoneGradId} x1="280" y1="109.52539" x2="420" y2="240" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor={accentDeep} />
        </linearGradient>
      </defs>
      <circle cx="180" cy="160" r="20" stroke={accentRing} strokeWidth={2} />
      <circle cx="180" cy="200" r="20" stroke={accentRing} strokeWidth={2} />
      <circle cx="180" cy="120" r="20" stroke={accentRing} strokeWidth={2} />
      <circle cx="220" cy="160" r="20" stroke={accentRing} strokeWidth={2} />
      <circle cx="220" cy="120" r="20" stroke={accentRing} strokeWidth={2} />
      <circle cx="260" cy="120" r="20" stroke={accentRing} strokeWidth={2} />
      <path stroke={platformsGridStroke} strokeWidth={2} d="M140 120H439" />
      <path stroke={platformsGridStroke} strokeWidth={2} d="M140 160H439" />
      <path stroke={platformsGridStroke} strokeWidth={2} d="M140 200H439" />
      <path stroke={platformsGridStroke} strokeWidth={2} d="M180 240V60" />
      <path stroke={platformsGridStroke} strokeWidth={2} d="M220 240V60" />
      <path stroke={platformsGridStroke} strokeWidth={2} d="M260 240V60" />
      <circle cx="180" cy="120" r="6" fill="#FFFFFF" />
      <circle cx="180" cy="160" r="6" fill="#FFFFFF" />
      <circle cx="180" cy="200" r="6" fill="#FFFFFF" />
      <circle cx="220" cy="120" r="6" fill="#FFFFFF" />
      <circle cx="260" cy="120" r="6" fill="#FFFFFF" />
      <circle cx="220" cy="160" r="6" fill="#FFFFFF" />
      <path
        fillRule="evenodd"
        fill="#EBECEC"
        d="M340 180C373.137 180 400 153.137 400 120C400 86.8629 373.137 60 340 60C306.863 60 280 86.8629 280 120C280 131.046 271.046 140 260 140C248.954 140 240 148.954 240 160C240 171.046 231.046 180 220 180C208.954 180 200 188.954 200 200C200 211.046 191.046 220 180 220C168.95 220 160 228.95 160 240L339 240L339 179.992C339.333 179.997 339.666 180 340 180Z"
      />
      <path
        fillRule="evenodd"
        fill="#F7F7F7"
        d="M340 120C340 86.86 366.86 60 400 60L400 240L220 240C220 228.95 228.95 220 240 220C251.046 220 260 211.046 260 200C260 188.954 268.954 180 280 180C291.046 180 300 171.046 300 160C300 148.954 308.954 140 320 140C331.046 140 340 131.046 340 120Z"
      />
      <path fill={`url(#${phoneGradId})`} d="M280 240L420 240L420 60L280 60L280 240Z" />
      <path fill="#FFFFFF" d="M300 210L400 210L400 80L300 80L300 210Z" />
      <path fill="#FFFFFF" d="M330 230L370 230L370 220L330 220L330 230Z" />
      <path fill="#F7F7F7" d="M300 110L300 210L400 210L300 110Z" />
      <path
        fillRule="evenodd"
        fill={accentHalf}
        d="M380 140C368.954 140 360 131.046 360 120C360 108.954 368.954 100 380 100L420 100C431.046 100 440 108.954 440 120C440 131.046 431.046 140 420 140L380 140Z"
      />
      <path fill="#FFFFFF" d="M372 119.5C372 115.91 374.91 113 378.5 113C382.088 113 385 115.91 385 119.5C385 123.09 382.088 126 378.5 126C374.91 126 372 123.09 372 119.5Z" />
      <path fill="#FFFFFF" d="M415 119.5C415 115.91 417.91 113 421.5 113C425.088 113 428 115.91 428 119.5C428 123.09 425.088 126 421.5 126C417.91 126 415 123.09 415 119.5Z" />
      <path fill="#FFFFFF" d="M393 119.5C393 115.91 395.91 113 399.5 113C403.088 113 406 115.91 406 119.5C406 123.09 403.088 126 399.5 126C395.91 126 393 123.09 393 119.5Z" />
      <rect x="260" y="180" width="60" height="60" fill="var(--accent)" />
      <path fill={accentSoft} d="M260 180L320 240L260 240L260 180Z" />
    </svg>
  )
}

const platformTabs: Array<{ id: PlatformTab; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'common', label: '常用' },
  { id: 'core', label: '核心' },
  { id: 'enabled', label: '已启用' },
  { id: 'plugin', label: '插件' },
]

const numberFormatter = new Intl.NumberFormat('zh-CN')
const collator = new Intl.Collator('zh-CN')

const hermesPlatformQRSupport: Record<string, HermesPlatformQRInfo> = {
  dingtalk: {
    description: '扫码授权并写入 Client ID / Client Secret。',
    icon: 'lucide:qr-code',
    label: '扫码授权',
    openLabel: '打开授权页',
    openWindowName: 'hermes-dingtalk-auth',
  },
  feishu: {
    description: '扫码创建机器人并写入 App ID / App Secret。',
    icon: 'icon-park-outline:lark',
    label: '扫码配置',
    openLabel: '网页授权',
    openWindowName: 'hermes-feishu-auth',
  },
  qqbot: {
    description: '扫码绑定 QQBot 并写入 App ID / Client Secret。',
    icon: 'lucide:qr-code',
    label: '扫码配置',
    openLabel: '打开授权页',
    openWindowName: 'hermes-qqbot-auth',
  },
  wecom: {
    description: '扫码创建企业微信机器人并写入 Bot ID / Secret。',
    icon: 'lucide:qr-code',
    label: '扫码添加',
  },
  weixin: {
    description: '扫码登录 Weixin iLink 机器人身份并保存 token。',
    icon: 'lucide:qr-code',
    label: '扫码登录',
  },
  whatsapp: {
    description: '启动 WhatsApp Web 配对并等待授权完成。',
    icon: 'lucide:qr-code',
    label: '扫码配对',
  },
}

function HermesPlatformsPage() {
  usePageTitle('Hermes 消息平台')
  const selectedAgentName = useHermesAgentStore((store) => store.selectedName)
  const loadAgents = useHermesAgentStore((store) => store.loadAgents)
  const [state, setState] = useState<LoadState>('idle')
  const [data, setData] = useState<HermesPlatformsResponse | null>(null)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<PlatformTab>('all')
  const [selectedName, setSelectedName] = useState('')
  const [draftOverride, setDraftOverride] = useState<{ draft: PlatformDraft; name: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [pairingPlatform, setPairingPlatform] = useState<HermesPlatformInfo | null>(null)
  const [qrPlatform, setQrPlatform] = useState<HermesPlatformInfo | null>(null)

  const loadPlatforms = useCallback(async (refresh = false) => {
    setState('loading')
    setError('')
    try {
      const payload = await getHermesPlatforms(refresh, selectedAgentName)
      setData(payload)
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hermes 消息平台加载失败')
      setState('error')
    }
  }, [selectedAgentName])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAgents(false)
      void loadPlatforms(false)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadAgents, loadPlatforms])

  const platforms = useMemo(() => data?.platforms ?? [], [data?.platforms])
  const selectedPlatform = useMemo(() => platforms.find((platform) => platform.name === selectedName) ?? platforms[0] ?? null, [platforms, selectedName])
  const draft = useMemo(() => {
    if (!selectedPlatform) return null
    if (draftOverride?.name === selectedPlatform.name) return draftOverride.draft
    return platformToDraft(selectedPlatform)
  }, [draftOverride, selectedPlatform])

  const filteredPlatforms = useMemo(() => {
    return platforms
      .filter((platform) => matchesPlatformTab(platform, activeTab))
      .sort(comparePlatformsForList)
  }, [activeTab, platforms])

  useEffect(() => {
    if (filteredPlatforms.length === 0) return
    if (filteredPlatforms.some((platform) => platform.name === selectedName)) return
    setSelectedName(filteredPlatforms[0].name)
  }, [filteredPlatforms, selectedName])

  const hasChanges = useMemo(() => {
    if (!selectedPlatform || !draft) return false
    return JSON.stringify(platformToComparableDraft(platformToDraft(selectedPlatform))) !== JSON.stringify(platformToComparableDraft(draft))
  }, [draft, selectedPlatform])

  const saveSelectedPlatform = useCallback(async () => {
    if (!selectedPlatform || !draft) return
    setSaving(true)
    try {
      const payload = await updateHermesPlatform(selectedPlatform.name, platformDraftToRequest(draft), selectedAgentName)
      setData(payload)
      setDraftOverride(null)
      toast.success('平台配置已保存，重启 Gateway 后生效')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '平台配置保存失败')
    } finally {
      setSaving(false)
    }
  }, [draft, selectedAgentName, selectedPlatform])

  const hasLoadError = Boolean(error && !data)

  return (
    <DashboardLayout>
      <div className={hasLoadError ? 'flex min-h-[calc(100dvh-8rem)] items-center justify-center' : 'mx-auto flex max-w-7xl flex-col gap-6'}>
        {hasLoadError ? (
          <HermesLoadErrorCard
            error={error}
            isRetrying={state === 'loading'}
            title="无法加载 Hermes 消息平台"
            onRetry={() => void loadPlatforms(true)}
          />
        ) : null}

        {!hasLoadError ? (
          <>
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)]">
          <PlatformHero data={data} error={error} state={state} onRefresh={() => void loadPlatforms(true)} />
          <PlatformStatsCard data={data} />
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(320px,0.4fr)_minmax(0,1.42fr)] xl:items-start">
          <Card className="flex min-w-0 flex-col xl:sticky xl:top-6 h-[calc(100dvh-310px)] xl:overflow-hidden">
            <Card.Header>
              <div className="flex w-full min-w-0 flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Card.Title className="text-base font-bold">平台列表</Card.Title>
                    {/* <Card.Description>从当前 Agent 的 config.yaml、.env 与 gateway_state.json 聚合。</Card.Description> */}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Chip color="accent" variant="soft">{numberFormatter.format(filteredPlatforms.length)}</Chip>
                    <CellSelect aria-label="平台筛选" className="w-32" value={activeTab} variant="secondary" onChange={(key) => setActiveTab(String(key) as PlatformTab)}>
                      <CellSelect.Trigger>
                        <CellSelect.Value>
                          {() => (
                            <span className="flex min-w-0 items-center gap-2">
                              <Icon icon="lucide:filter" className="size-4 text-muted" />
                              <span className="truncate">{platformTabs.find((tab) => tab.id === activeTab)?.label ?? '全部'}</span>
                            </span>
                          )}
                        </CellSelect.Value>
                        <CellSelect.Indicator />
                      </CellSelect.Trigger>
                      <CellSelect.Popover>
                        <ListBox>
                          {platformTabs.map((tab) => (
                            <ListBox.Item key={tab.id} id={tab.id} textValue={tab.label}>
                              {tab.label}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </CellSelect.Popover>
                    </CellSelect>
                  </div>
                </div>
              </div>
            </Card.Header>
            <Card.Content className="min-h-0 flex-1 overflow-hidden">
              {state === 'loading' && platforms.length === 0 ? (
                <div className="grid gap-3 xl:max-h-[calc(100dvh-280px)] xl:overflow-y-auto xl:pr-1">
                  {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-2xl" />)}
                </div>
              ) : (
                <div className="overflow-y-auto p-1 xl:max-h-[calc(100dvh-280px)]">
                  {filteredPlatforms.length === 0 ? (
                    <EmptyPanel icon="lucide:message-circle-off" text="没有匹配的平台" />
                  ) : (
                    <RadioButtonGroup
                      aria-label="Hermes 平台列表"
                      className="grid gap-3"
                      name="hermes-platform"
                      value={selectedPlatform?.name ?? ''}
                      variant="secondary"
                      onChange={setSelectedName}
                    >
                      {filteredPlatforms.map((platform) => (
                        <PlatformListItem key={platform.name} platform={platform} />
                      ))}
                    </RadioButtonGroup>
                  )}
                </div>
              )}
            </Card.Content>
          </Card>

          <PlatformEditor
            draft={draft}
            hasChanges={hasChanges}
            platform={selectedPlatform}
            saving={saving}
            onPairingOpen={setPairingPlatform}
            onQROpen={setQrPlatform}
            onDraftChange={(nextDraft) => {
              if (selectedPlatform) setDraftOverride({ draft: nextDraft, name: selectedPlatform.name })
            }}
            onRefresh={() => void loadPlatforms(true)}
            onSave={() => void saveSelectedPlatform()}
          />
        </section>
          </>
        ) : null}
      </div>
      <HermesPairingModal
        isOpen={Boolean(pairingPlatform)}
        platform={pairingPlatform?.name ?? selectedPlatform?.name ?? ''}
        platformLabel={pairingPlatform?.label ?? selectedPlatform?.label}
        profile={selectedAgentName}
        onApproved={() => void loadPlatforms(true)}
        onOpenChange={(open) => {
          if (!open) setPairingPlatform(null)
        }}
      />
      <HermesQRSetupModal
        isOpen={Boolean(qrPlatform)}
        platform={qrPlatform}
        profile={selectedAgentName}
        onCompleted={() => void loadPlatforms(true)}
        onOpenChange={(open) => {
          if (!open) setQrPlatform(null)
        }}
      />
    </DashboardLayout>
  )
}

function PlatformHero({ data, error, state, onRefresh }: { data: HermesPlatformsResponse | null; error: string; state: LoadState; onRefresh: () => void }) {
  return (
    <Card variant="transparent" className="overflow-visible">
      <Card.Content>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-28 shrink-0 items-center justify-center overflow-visible rounded-2xl p-1 drop-shadow-[0_8px_14px_color-mix(in_oklch,var(--accent)_24%,transparent)] md:h-32">
            <HermesPlatformsHeroIllustration className="h-full w-auto max-w-44" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Card.Title className="text-xl font-bold md:text-2xl">消息平台</Card.Title>
              {data?.profile ? <Chip color={data.profile.isDefault ? 'accent' : 'success'} variant="soft">{data.profile.name}</Chip> : null}
              <Button isIconOnly size="sm" aria-label="刷新消息平台" variant="ghost" isDisabled={state === 'loading'} onPress={onRefresh}>
                <Icon icon={state === 'loading' ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={`size-4 ${state === 'loading' ? 'animate-spin' : ''}`} />
              </Button>
            </div>
            <Card.Description className="mt-2 text-sm md:text-base">
              管理 Gateway 平台启用、消息策略、凭据存在性和运行状态。
            </Card.Description>
            <div className="mt-3 flex flex-col gap-1 text-sm text-muted">
              <PathPill icon="lucide:file-cog" label={data?.config.path ?? 'config.yaml'} ok={data?.config.exists ?? false} />
              <PathPill icon="lucide:file-key-2" label={data?.env.path ?? '.env'} ok={data?.env.exists ?? false} />
            </div>
            {state === 'error' ? <div className="mt-3 text-sm text-danger">{error}</div> : null}
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function PlatformStatsCard({ data }: { data: HermesPlatformsResponse | null }) {
  const summary = data?.summary
  const chartData = [
    { name: '已连接', value: summary?.connected ?? 0, fill: platformChartColors.connected },
    { name: '已配置', value: Math.max((summary?.configured ?? 0) - (summary?.connected ?? 0), 0), fill: platformChartColors.configured },
    { name: '已启用', value: Math.max((summary?.enabled ?? 0) - (summary?.configured ?? 0), 0), fill: platformChartColors.enabled },
    { name: '其他', value: Math.max((summary?.total ?? 0) - (summary?.enabled ?? 0), 0), fill: platformChartColors.total },
  ].filter((item) => item.value > 0)
  const visibleChartData = chartData.length ? chartData : [{ name: '暂无', value: 1, fill: 'var(--surface-secondary)' }]

  return (
    <Card>
      <Card.Content>
        <div className="grid gap-4 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center">
          <div className="mx-auto size-36">
            {summary ? (
              <PieChart height={144} width={144}>
                <PieChart.Pie cx="50%" cy="50%" data={visibleChartData} dataKey="value" innerRadius={45} nameKey="name" outerRadius={68} strokeWidth={0}>
                  {visibleChartData.map((item) => (
                    <PieChart.Cell key={item.name} fill={item.fill} />
                  ))}
                </PieChart.Pie>
              </PieChart>
            ) : (
              <Skeleton className="size-36 rounded-full" />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="总数" value={summary?.total ?? 0} />
            <Metric label="启用" value={summary?.enabled ?? 0} tone="warning" />
            <Metric label="配置" value={summary?.configured ?? 0} tone="accent" />
            <Metric label="连接" value={summary?.connected ?? 0} tone="success" />
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function PlatformListItem({ platform }: { platform: HermesPlatformInfo }) {
  const iconToneClass = platform.configured && platform.connected
    ? 'bg-success'
    : platform.configured || platform.connected
      ? 'bg-warning'
      : 'bg-muted'

  return (
    <RadioButtonGroup.Item value={platform.name} className="min-w-0 p-2">
      <RadioButtonGroup.ItemContent className="flex-row items-center gap-3">
        <RadioButtonGroup.ItemIcon className={`flex size-10 shrink-0 items-center justify-center rounded-full ${iconToneClass} text-white`}>
          <Icon icon={platform.icon || 'lucide:message-circle'} className="size-5" />
        </RadioButtonGroup.ItemIcon>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Label className="truncate text-sm font-semibold">{platform.label}</Label>
            {platform.plugin ? <Chip color="default" size="sm" variant="soft">Plugin</Chip> : null}
          </div>
          {/* <Description className="mt-1 truncate font-mono text-xs">{platform.name}</Description> */}
        </div>
      </RadioButtonGroup.ItemContent>
    </RadioButtonGroup.Item>
  )
}

function PlatformEditor({
  draft,
  hasChanges,
  platform,
  saving,
  onDraftChange,
  onPairingOpen,
  onQROpen,
  onRefresh,
  onSave,
}: {
  draft: PlatformDraft | null
  hasChanges: boolean
  platform: HermesPlatformInfo | null
  saving: boolean
  onDraftChange: (draft: PlatformDraft) => void
  onPairingOpen: (platform: HermesPlatformInfo) => void
  onQROpen: (platform: HermesPlatformInfo) => void
  onRefresh: () => void
  onSave: () => void
}) {
  if (!platform || !draft) {
    return (
      <Card>
        <Card.Content>
          <EmptyPanel icon="lucide:message-circle-off" text="请选择一个平台" />
        </Card.Content>
      </Card>
    )
  }

  const update = (patch: Partial<PlatformDraft>) => onDraftChange({ ...draft, ...patch })
  const qrInfo = hermesPlatformQRSupport[platform.name]

  return (
    <div className="flex min-w-0 flex-col gap-4 overflow-y-auto -mr-4">
      <Card variant="transparent" className="min-w-0">
        <Card.Header>
          <div className="flex w-full min-w-0 items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className={`flex size-12 shrink-0 items-center justify-center rounded-full ${platform.connected ? 'bg-success' : platform.enabled ? 'bg-accent' : 'bg-muted'} text-white`}>
                <Icon icon={platform.icon || 'lucide:message-circle'} className="size-6" />
              </span>
              <div className="min-w-0">
                <Card.Title className="truncate">{platform.label}</Card.Title>
                <Card.Description className="font-mono">{platform.name}</Card.Description>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Chip color={platform.enabled ? 'success' : 'default'} variant="soft">{platform.enabled ? '已启用' : '未启用'}</Chip>
              <Chip color={platform.connected ? 'success' : platform.runtimeError ? 'danger' : 'default'} variant="soft">{platform.runtimeState || '未连接'}</Chip>
              <Button isIconOnly size="sm" aria-label="刷新平台配置" variant="ghost" onPress={onRefresh} isDisabled={saving}>
                <Icon icon="lucide:refresh-cw" className="size-4" />
              </Button>
              <Button size="sm" variant="tertiary" isDisabled={saving} onPress={() => onPairingOpen(platform)}>
                <Icon icon="lucide:shield-check" className="size-4" />
                配对审批
              </Button>
              {qrInfo ? (
                <Button size="sm" variant="primary" isDisabled={saving} onPress={() => onQROpen(platform)}>
                  <Icon icon="lucide:qr-code" className="size-4" />
                  扫码连接
                </Button>
              ) : null}
              {hasChanges ? <Button size="sm" variant="primary" isPending={saving} isDisabled={saving} onPress={onSave}>保存配置</Button> : null}
            </div>
          </div>
        </Card.Header>
        <Card.Content>
          <ItemCardGroup className="overflow-hidden">
            {platform.runtimeError ? (
              <FragmentWithSeparator showSeparator={false}>
                <RuntimeErrorItem error={platform.runtimeError} />
              </FragmentWithSeparator>
            ) : null}
            <FragmentWithSeparator showSeparator={Boolean(platform.runtimeError)}>
              <SwitchRow icon="lucide:power" title="启用平台" description="写入 platforms 与平台顶层配置。" checked={draft.enabled} onChange={(enabled) => update({ enabled })} />
            </FragmentWithSeparator>
            <FragmentWithSeparator showSeparator>
              <SwitchRow icon="lucide:bell-ring" title="网关重启通知" description="允许发送 Gateway online/restarted 提醒。" checked={draft.gatewayRestartNotification} onChange={(gatewayRestartNotification) => update({ gatewayRestartNotification })} />
            </FragmentWithSeparator>
            <FragmentWithSeparator showSeparator>
              <InfoRow icon="lucide:badge-check" label="凭据要求" value={platform.requiredEnv.length ? `${platform.requiredEnv.length} 个 key` : '无需额外 env key'} ok={!platform.requiredEnv.length || platform.requiredEnv.every((item) => item.present)} />
            </FragmentWithSeparator>
            {platform.homeChannelKey || platform.homeChannel ? (
              <FragmentWithSeparator showSeparator>
                <InfoRow
                  icon="lucide:send"
                  label="默认投递目标"
                  value={platform.homeChannel || (platform.homeChannelKey ? `${platform.homeChannelKey} 未设置` : '未设置')}
                  ok={Boolean(platform.homeChannel)}
                />
              </FragmentWithSeparator>
            ) : null}
            {platform.requiredEnv.map((item) => (
              <FragmentWithSeparator key={item.key} showSeparator>
                <SecretItem
                  envKey={item.key}
                  present={item.present}
                  source={item.source}
                  value={draft.env[item.key] ?? ''}
                  onChange={(value) => update({ env: { ...draft.env, [item.key]: value } })}
                />
              </FragmentWithSeparator>
            ))}
            <FragmentWithSeparator showSeparator>
              <SwitchRow icon="lucide:at-sign" title="共享频道需提及" description="群聊或频道内仅在提及 Agent 时响应。" checked={draft.requireMention} onChange={(requireMention) => update({ requireMention })} />
            </FragmentWithSeparator>
            <FragmentWithSeparator showSeparator>
              <SelectFieldItem icon="lucide:messages-square" title="回复线程模式" description="控制共享频道中的跟帖回复范围。">
                <CellSelect aria-label="回复线程模式" value={draft.replyToMode || 'first'} variant="secondary" onChange={(key) => update({ replyToMode: String(key) })}>
                  <CellSelect.Trigger>
                    <CellSelect.Value>
                      {() => <SelectValue icon="lucide:messages-square" label={replyModeLabel(draft.replyToMode)} />}
                    </CellSelect.Value>
                    <CellSelect.Indicator />
                  </CellSelect.Trigger>
                  <CellSelect.Popover>
                    <ListBox>
                      {[
                        ['first', '首条跟帖'],
                        ['all', '全部跟帖'],
                        ['off', '关闭跟帖'],
                      ].map(([id, label]) => (
                        <ListBox.Item key={id} id={id} textValue={label}>
                          {label}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </CellSelect.Popover>
                </CellSelect>
              </SelectFieldItem>
            </FragmentWithSeparator>
            <FragmentWithSeparator showSeparator>
              <SelectFieldItem icon="lucide:user-lock" title="未授权私聊策略" description="配置私聊未通过准入时的处理方式。">
                <CellSelect aria-label="未授权私聊策略" value={draft.unauthorizedDmBehavior || 'pair'} variant="secondary" onChange={(key) => update({ unauthorizedDmBehavior: String(key) })}>
                  <CellSelect.Trigger>
                    <CellSelect.Value>
                      {() => <SelectValue icon="lucide:user-lock" label={draft.unauthorizedDmBehavior === 'ignore' ? '忽略' : '配对'} />}
                    </CellSelect.Value>
                    <CellSelect.Indicator />
                  </CellSelect.Trigger>
                  <CellSelect.Popover>
                    <ListBox>
                      <ListBox.Item id="pair" textValue="配对">配对<ListBox.ItemIndicator /></ListBox.Item>
                      <ListBox.Item id="ignore" textValue="忽略">忽略<ListBox.ItemIndicator /></ListBox.Item>
                    </ListBox>
                  </CellSelect.Popover>
                </CellSelect>
              </SelectFieldItem>
            </FragmentWithSeparator>
            <FragmentWithSeparator showSeparator>
              <SelectFieldItem icon="lucide:bell" title="通知投递" description="控制平台通知以公开或私有方式投递。">
                <CellSelect aria-label="通知投递" value={draft.noticeDelivery || 'public'} variant="secondary" onChange={(key) => update({ noticeDelivery: String(key) })}>
                  <CellSelect.Trigger>
                    <CellSelect.Value>
                      {() => <SelectValue icon="lucide:bell" label={draft.noticeDelivery === 'private' ? '私有' : '公开'} />}
                    </CellSelect.Value>
                    <CellSelect.Indicator />
                  </CellSelect.Trigger>
                  <CellSelect.Popover>
                    <ListBox>
                      <ListBox.Item id="public" textValue="公开">公开<ListBox.ItemIndicator /></ListBox.Item>
                      <ListBox.Item id="private" textValue="私有">私有<ListBox.ItemIndicator /></ListBox.Item>
                    </ListBox>
                  </CellSelect.Popover>
                </CellSelect>
              </SelectFieldItem>
            </FragmentWithSeparator>
          </ItemCardGroup>
        </Card.Content>
      </Card>

      <div className="grid gap-4 px-4 lg:grid-cols-2">
        <TextareaFieldCard
          description={platform.configKeys.freeResponse ? '配置允许自由响应的会话、频道或用户范围。' : '此平台暂无通用自由响应列表字段。'}
          icon="lucide:message-square-reply"
          isDisabled={!platform.configKeys.freeResponse}
          label="自由响应范围"
          placeholder="chat_id_1, channel_id_2"
          value={draft.freeResponse}
          onChange={(freeResponse) => update({ freeResponse })}
        />
        <TextareaFieldCard
          description={platform.configKeys.allowed ? '配置允许访问该平台的用户、频道或会话范围。' : '此平台暂无通用准入列表字段。'}
          icon="lucide:list-checks"
          isDisabled={!platform.configKeys.allowed}
          label="准入范围"
          placeholder="user_id_1, channel_id_2"
          value={draft.allowed}
          onChange={(allowed) => update({ allowed })}
        />
      </div>

    </div>
  )
}

function RuntimeErrorItem({ error }: { error: string }) {
  return (
    <ItemCard className="min-w-0 text-danger">
      <ItemCard.Icon>
        <Icon icon="lucide:triangle-alert" />
      </ItemCard.Icon>
      <ItemCard.Content className="min-w-0">
        <ItemCard.Title>运行错误</ItemCard.Title>
        <ItemCard.Description className="break-words text-danger [overflow-wrap:anywhere]">{error}</ItemCard.Description>
      </ItemCard.Content>
    </ItemCard>
  )
}

function SwitchRow({ checked, description, icon, title, onChange }: { checked: boolean; description: string; icon: string; title: string; onChange: (checked: boolean) => void }) {
  return (
    <ItemCard className="min-w-0">
      <ItemCard.Icon>
        <Icon icon={icon} className="text-muted" />
      </ItemCard.Icon>
      <ItemCard.Content className="min-w-0">
        <ItemCard.Title>{title}</ItemCard.Title>
        <ItemCard.Description>{description}</ItemCard.Description>
      </ItemCard.Content>
      <ItemCard.Action>
        <Switch aria-label={title} isSelected={checked} onChange={onChange}>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch>
      </ItemCard.Action>
    </ItemCard>
  )
}

function SelectFieldItem({ children, description, icon, title }: { children: ReactNode; description: string; icon: string; title: string }) {
  return (
    <ItemCard className="min-w-0">
      <ItemCard.Icon>
        <Icon icon={icon} className="text-muted" />
      </ItemCard.Icon>
      <ItemCard.Content className="min-w-0">
        <ItemCard.Title>{title}</ItemCard.Title>
        <ItemCard.Description>{description}</ItemCard.Description>
      </ItemCard.Content>
      <ItemCard.Action className="w-full sm:w-auto">
        {children}
      </ItemCard.Action>
    </ItemCard>
  )
}

function TextareaFieldCard({ description, icon, isDisabled, label, placeholder, value, onChange }: { description: string; icon: string; isDisabled?: boolean; label: string; placeholder: string; value: string; onChange: (value: string) => void }) {
  return (
    <Card className="min-w-0">
      <Card.Header>
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-secondary/50 text-muted">
            <Icon icon={icon} className="size-5" />
          </div>
          <div className="min-w-0">
            <Card.Title>{label}</Card.Title>
            <Card.Description>{description}</Card.Description>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        <TextField fullWidth isDisabled={isDisabled} variant="secondary">
          <Label className="sr-only">{label}</Label>
          <TextArea className="min-h-28 resize-y" placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
        </TextField>
      </Card.Content>
    </Card>
  )
}

function HermesQRSetupModal({
  isOpen,
  platform,
  profile,
  onCompleted,
  onOpenChange,
}: {
  isOpen: boolean
  platform: HermesPlatformInfo | null
  profile?: string
  onCompleted: () => void
  onOpenChange: (open: boolean) => void
}) {
  const [task, setTask] = useState<HermesTaskResponse | null>(null)
  const [qr, setQr] = useState<{ dataUrl: string; url: string } | null>(null)
  const [footerMessage, setFooterMessage] = useState('')
  const [view, setView] = useState<'qr' | 'logs'>('qr')
  const [running, setRunning] = useState(false)
  const sourceRef = useRef<EventSource | null>(null)
  const logRef = useRef<HTMLPreElement | null>(null)
  const qrUrlRef = useRef('')
  const streamFinishedRef = useRef(false)
  const info = platform ? hermesPlatformQRSupport[platform.name] : undefined

  const closeStream = useCallback(() => {
    sourceRef.current?.close()
    sourceRef.current = null
  }, [])

  const resetTaskState = useCallback(() => {
    closeStream()
    setRunning(false)
    setTask(null)
    setQr(null)
    setFooterMessage('')
    setView('qr')
    qrUrlRef.current = ''
    streamFinishedRef.current = false
  }, [closeStream])

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      resetTaskState()
    }
    onOpenChange(open)
  }, [onOpenChange, resetTaskState])

  useEffect(() => () => closeStream(), [closeStream])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [task?.logs])

  const renderQr = useCallback(async (url: string) => {
    if (!url || qrUrlRef.current === url) return
    qrUrlRef.current = url
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 280,
      })
      setQr({ dataUrl, url })
    } catch {
      toast.warning('二维码渲染失败')
    }
  }, [])

  const start = useCallback(() => {
    if (!platform || !info) return
    closeStream()
    streamFinishedRef.current = false
    qrUrlRef.current = ''
    setQr(null)
    setFooterMessage('')
    setView('qr')
    setRunning(true)
    const now = new Date().toISOString()
    setTask({
      id: `${platform.name}-${Date.now()}`,
      logs: ['正在连接流式任务。'],
      progress: 0,
      startedAt: now,
      status: 'pending',
      updatedAt: now,
    })

    const source = new EventSource(getHermesPlatformQRSetupStreamURL(platform.name, profile))
    sourceRef.current = source

    source.addEventListener('meta', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as HermesTaskStreamMeta
        setTask((current) => current ? { ...current, id: payload.id, status: 'running', updatedAt: payload.timestamp } : current)
      } catch {
        // ignore malformed stream metadata
      }
    })

    source.addEventListener('status', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as HermesTaskStreamStatus
        setTask((current) => current ? {
          ...current,
          error: payload.error || current.error,
          id: payload.id || current.id,
          progress: payload.progress,
          status: payload.status,
          updatedAt: payload.timestamp,
        } : current)
        if (payload.status === 'done') {
          streamFinishedRef.current = true
          closeStream()
          setRunning(false)
          toast.success(`${platform.label} 扫码配置完成`)
          onCompleted()
          handleOpenChange(false)
        }
        if (payload.status === 'error' && payload.error) {
          streamFinishedRef.current = true
          closeStream()
          setRunning(false)
          toast.warning(payload.error)
          onCompleted()
        }
      } catch {
        // ignore malformed status payload
      }
    })

    source.addEventListener('log', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as HermesTaskStreamLog
        const qrUrl = extractHermesQrUrl(platform.name, payload.line)
        if (qrUrl) void renderQr(qrUrl)
        if (isHermesGatewayRestartLog(payload.line)) {
          setFooterMessage(`${platform.label} 扫码配置完成，正在重启网关`)
        }
        setTask((current) => current ? {
          ...current,
          id: payload.id || current.id,
          logs: appendTaskLog(current.logs, maskHermesQRSecrets(payload.line)),
          updatedAt: payload.timestamp,
        } : current)
      } catch {
        // ignore malformed log payload
      }
    })

    source.addEventListener('error', (event) => {
      const data = (event as MessageEvent).data
      if (!data) {
        if (!streamFinishedRef.current) {
          closeStream()
          setRunning(false)
          setTask((current) => current ? { ...current, logs: appendTaskLog(current.logs, '失败：流式连接中断'), status: 'error' } : current)
        }
        return
      }
      try {
        const payload = JSON.parse(data) as HermesTaskStreamError
        streamFinishedRef.current = true
        closeStream()
        setRunning(false)
        setTask((current) => current ? {
          ...current,
          error: payload.message,
          id: payload.id || current.id,
          logs: appendTaskLog(current.logs, `失败：${payload.message}`),
          status: 'error',
          updatedAt: payload.timestamp,
        } : current)
      } catch {
        // ignore malformed error payload
      }
    })
  }, [closeStream, handleOpenChange, info, onCompleted, platform, profile, renderQr])

  const openExternal = () => {
    void openExternalUrl(qr?.url)
  }

  if (!platform || !info) return null
  const isLogView = view === 'logs'
  const canShowLogs = Boolean(task)

  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={handleOpenChange} variant="opaque">
        <Modal.Container size="lg">
          <Modal.Dialog className="sm:max-w-[720px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Icon className="bg-accent/10 text-accent">
                <Icon icon={info.icon} className="size-5" />
              </Modal.Icon>
              <div>
                <Modal.Heading>{platform.label}{info.label}</Modal.Heading>
                <p className="mt-1 text-sm text-muted">{info.description}</p>
              </div>
            </Modal.Header>
            <Modal.Body>
              {isLogView && task ? (
                <TaskLogPanel logRef={logRef} task={task} />
              ) : (
                <QRPreview platform={platform} info={info} qr={qr} running={running} onOpenExternal={openExternal} onStart={start} />
              )}
            </Modal.Body>
            {qr ? (
              <Modal.Footer>
                {footerMessage ? (
                  <div className="mr-auto flex min-w-0 items-center gap-2 text-sm text-muted">
                    <Icon icon="lucide:loader-circle" className="size-4 shrink-0 animate-spin" />
                    <span className="truncate">{footerMessage}</span>
                  </div>
                ) : null}
                <Button variant="tertiary" onPress={() => handleOpenChange(false)} isDisabled={running}>关闭</Button>
                <Button variant="secondary" onPress={() => setView(isLogView ? 'qr' : 'logs')} isDisabled={!canShowLogs}>
                  <Icon icon={isLogView ? 'lucide:qr-code' : 'lucide:scroll-text'} className="size-4" />
                  {isLogView ? '查看二维码' : '查看日志'}
                </Button>
              </Modal.Footer>
            ) : null}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

function QRPreview({
  info,
  onOpenExternal,
  onStart,
  platform,
  qr,
  running,
}: {
  info: HermesPlatformQRInfo
  onOpenExternal: () => void
  onStart: () => void
  platform: HermesPlatformInfo
  qr: { dataUrl: string; url: string } | null
  running: boolean
}) {
  return (
    <div className="flex min-h-[360px] items-center justify-center rounded-xl bg-surface p-4">
      {qr ? (
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-xl bg-white p-4">
            <img src={qr.dataUrl} alt={`${platform.label} 二维码`} className="size-[260px]" />
          </div>
          {info.openLabel ? (
            <Button size="sm" variant="tertiary" onPress={onOpenExternal}>
              <Icon icon="lucide:external-link" className="size-4" />
              {info.openLabel}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-center text-sm text-muted">
          <Icon icon="lucide:qr-code" className="size-10" />
          <span>{platform.name === 'whatsapp' ? '启动任务后等待配对状态。' : '点击扫码连接开始获取二维码'}</span>
          <Button variant="primary" onPress={onStart} isPending={running} isDisabled={running}>
            <Icon icon="lucide:qr-code" className="size-4" />
            扫码连接
          </Button>
        </div>
      )}
    </div>
  )
}

function TaskLogPanel({ logRef, task }: { logRef: RefObject<HTMLPreElement | null>; task: HermesTaskResponse | null }) {
  if (!task) {
    return null
  }
  const tone = task.status === 'done' ? 'success' : task.status === 'error' ? 'danger' : 'accent'
  const isRunning = task.status === 'pending' || task.status === 'running'
  const copyLogs = async () => {
    const text = [task.logs.join('\n'), task.error ? task.error : ''].filter(Boolean).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('日志已复制')
    } catch {
      toast.warning('日志复制失败')
    }
  }

  return (
    <Card className="min-w-0">
      <Card.Header>
        <div className="flex w-full items-center justify-between gap-3">
          <Card.Title className="text-base font-bold">扫码任务日志</Card.Title>
          <div className="flex items-center gap-2">
            <Chip color={tone} variant="soft">{task.status}</Chip>
            <Button isIconOnly variant="ghost" aria-label="复制日志" onPress={() => void copyLogs()}>
              <Icon icon="lucide:copy" className="size-4" />
            </Button>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        <div className="mb-3 h-2 overflow-hidden rounded-full bg-surface-secondary/50">
          <div className={`h-full rounded-full ${task.status === 'error' ? 'bg-danger' : 'bg-success'}`} style={{ width: `${Math.max(3, task.progress)}%` }} />
        </div>
        {isRunning ? (
          <div className="mb-3 flex items-center gap-2 text-sm text-muted">
            <Icon icon="lucide:loader-circle" className="size-4 animate-spin" />
            正在执行。日志会同步授权状态和可打开链接。
          </div>
        ) : null}
        <pre ref={logRef} className="max-h-[22rem] overflow-auto rounded-xl bg-surface-secondary/50 p-4 font-mono text-[10px] leading-4 text-foreground whitespace-pre">
          {task.logs.join('\n')}
          {task.error ? `\n${task.error}` : ''}
        </pre>
      </Card.Content>
    </Card>
  )
}

function SecretItem({ envKey, present, source, value, onChange }: { envKey: string; present: boolean; source?: string; value: string; onChange: (value: string) => void }) {
  return (
    <ItemCard className="min-w-0">
      <ItemCard.Icon>
        <Icon icon={present ? 'lucide:key-round' : 'lucide:key-square'} className={present ? 'text-success' : 'text-muted'} />
      </ItemCard.Icon>
      <ItemCard.Content className="min-w-0">
        <ItemCard.Title className="truncate font-mono text-xs">{envKey}</ItemCard.Title>
        <ItemCard.Description className="inline-flex items-center gap-1.5">
          <StatusDot ok={present} label={present ? '存在' : '不存在'} />
          {present ? source || '存在' : '未设置'}
        </ItemCard.Description>
      </ItemCard.Content>
      <ItemCard.Action className="w-full sm:w-auto">
        <Input placeholder={present ? '留空不修改，输入新值覆盖' : '输入并保存到 .env'} value={value} variant="secondary" onChange={(event) => onChange(event.target.value)} />
      </ItemCard.Action>
    </ItemCard>
  )
}

function SelectValue({ icon, label }: { icon: string; label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Icon icon={icon} className="size-4 text-muted" />
      <span className="truncate font-medium">{label}</span>
    </span>
  )
}

function InfoRow({ icon, label, ok, value }: { icon: string; label: string; ok: boolean; value: string }) {
  return (
    <ItemCard className="min-w-0">
      <ItemCard.Icon>
        <Icon icon={icon} className="text-muted" />
      </ItemCard.Icon>
      <ItemCard.Content className="min-w-0">
        <ItemCard.Title>{label}</ItemCard.Title>
        <ItemCard.Description className="min-w-0 break-words text-foreground [overflow-wrap:anywhere]">{value}</ItemCard.Description>
      </ItemCard.Content>
      <ItemCard.Action>
        <StatusDot ok={ok} label={ok ? '存在' : '不存在'} />
      </ItemCard.Action>
    </ItemCard>
  )
}

function PathPill({ icon, label, ok }: { icon: string; label: string; ok: boolean }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full bg-surface-secondary/60 px-3 py-1.5">
      <Icon icon={icon} className="size-4 shrink-0" />
      <span className={`size-2 shrink-0 rounded-full ${ok ? 'bg-success' : 'bg-danger'}`} />
      <span className="truncate font-mono text-xs">{label}</span>
    </span>
  )
}

function Metric({ label, tone = 'default', value }: { label: string; tone?: 'accent' | 'default' | 'success' | 'warning'; value: number }) {
  const colorClass = tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : tone === 'accent' ? 'text-accent' : 'text-foreground'
  return (
    <div className="rounded-2xl bg-surface-secondary/50 p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${colorClass}`}>{numberFormatter.format(value)}</div>
    </div>
  )
}

function StatusDot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <Tooltip delay={300}>
      <span aria-label={label} className={`block size-2.5 rounded-full ${ok ? 'bg-success shadow-[0_0_12px_color-mix(in_oklch,var(--success)_80%,transparent)]' : 'bg-danger shadow-[0_0_12px_color-mix(in_oklch,var(--danger)_70%,transparent)]'}`} />
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  )
}

function FragmentWithSeparator({ children, showSeparator }: { children: ReactNode; showSeparator: boolean }) {
  return (
    <>
      {showSeparator ? <div className="h-px bg-separator" /> : null}
      {children}
    </>
  )
}

function EmptyPanel({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl bg-surface-secondary/50 p-6 text-center text-sm text-muted">
      <Icon icon={icon} className="mb-2 size-6" />
      {text}
    </div>
  )
}

function platformToDraft(platform: HermesPlatformInfo): PlatformDraft {
  return {
    allowed: platform.allowed || '',
    enabled: platform.enabled,
    env: {},
    freeResponse: platform.freeResponse || '',
    gatewayRestartNotification: platform.gatewayRestartNotification,
    noticeDelivery: platform.noticeDelivery || 'public',
    replyToMode: platform.replyToMode || 'first',
    requireMention: platform.requireMention ?? false,
    unauthorizedDmBehavior: platform.unauthorizedDmBehavior || 'pair',
  }
}

function platformToComparableDraft(draft: PlatformDraft) {
  return {
    ...draft,
    env: cleanEnvDraft(draft.env),
  }
}

function platformDraftToRequest(draft: PlatformDraft) {
  return {
    ...draft,
    env: cleanEnvDraft(draft.env),
  }
}

function cleanEnvDraft(env: Record<string, string>) {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value.trim() !== ''))
}

function appendTaskLog(logs: string[], line: string) {
  const next = line.trim() ? [...logs, line] : logs
  return next.length > 240 ? next.slice(next.length - 240) : next
}

function extractHermesQrUrl(platform: string, line: string) {
  const cleanLine = stripAnsi(line)
  const patterns: Record<string, RegExp> = {
    dingtalk: /https:\/\/[^\s"'<>]+\/openapp\/registration\/openClaw\?\S+/i,
    feishu: /https:\/\/(?:open\.)?(?:feishu|larksuite|larkoffice)\.[^\s)）\],;，；]+/i,
    qqbot: /https:\/\/q\.qq\.com\/qqbot\/openclaw\/connect\.html\?\S+/i,
    wecom: /https:\/\/work\.weixin\.qq\.com\/ai\/qc\/(?:gen|auth|scan|[^\s"'<>]+)\?\S+/i,
    weixin: /https:\/\/liteapp\.weixin\.qq\.com\/q\/\S+/i,
  }
  const pattern = patterns[platform]
  if (!pattern) return ''
  const match = cleanLine.match(pattern)
  if (!match) return ''
  const url = match[0].replace(/[)。）\],;，；]+$/, '')
  if (platform === 'feishu' && !/oauth|verification|authorize|auth|app|onboard|launcher/i.test(url)) return ''
  return url
}

function maskHermesQRSecrets(line: string) {
  return line
    .replace(/(Client Secret:\s*)\S+/gi, '$1<client-secret>')
    .replace(/(clientSecret=|clientSecret["':\s]+|client_secret["':\s]+)[^,\s"'}]+/gi, '$1<client-secret>')
    .replace(/(app_secret["':\s=]+)[^,\s"'}]+/gi, '$1<app-secret>')
    .replace(/(secret["':\s=]+)[^,\s"'}]+/gi, '$1<secret>')
    .replace(/(token["':\s=]+)[^,\s"'}]+/gi, '$1<token>')
}

function isHermesGatewayRestartLog(line: string) {
  return line.includes('重启 Hermes Gateway') || line.includes('hermes gateway restart')
}

function stripAnsi(value: string) {
  return value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g'), '')
}

function comparePlatformsForList(a: HermesPlatformInfo, b: HermesPlatformInfo) {
  const readyCompare = Number(isPlatformFullyReady(b)) - Number(isPlatformFullyReady(a))
  if (readyCompare !== 0) return readyCompare

  const categoryCompare = categoryWeight(a.category) - categoryWeight(b.category)
  if (categoryCompare !== 0) return categoryCompare
  return collator.compare(a.label, b.label)
}

function isPlatformFullyReady(platform: HermesPlatformInfo) {
  return platform.enabled && platform.configured && platform.connected
}

function matchesPlatformTab(platform: HermesPlatformInfo, tab: PlatformTab) {
  if (tab === 'all') return true
  if (tab === 'enabled') return platform.enabled
  return platform.category === tab
}

function categoryWeight(category: string) {
  if (category === 'core') return 0
  if (category === 'common') return 1
  if (category === 'more') return 2
  if (category === 'plugin') return 3
  return 9
}

function replyModeLabel(value: string) {
  if (value === 'all') return '全部跟帖'
  if (value === 'off') return '关闭跟帖'
  return '首条跟帖'
}

export default HermesPlatformsPage
