import { useCallback, useEffect, useState } from 'react'
import type { Key } from '@heroui/react'
import { Button, Card, Chip, ListBox, Table } from '@heroui/react'
import { CellSelect, PieChart, Segment } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import { getOpenClawConfig, getOpenClawRecentChannelMessages, type OpenClawRecentChannelMessage } from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { OpenClawDiscordPanel } from './openclaw-discord'
import { OpenClawDingTalkPanel } from './openclaw-dingtalk'
import { OpenClawFeishuPanel } from './openclaw-feishu'
import { OpenClawMatrixPanel } from './openclaw-matrix'
import { OpenClawQQBotPanel } from './openclaw-qqbot'
import { OpenClawTelegramPanel } from './openclaw-telegram'
import { OpenClawTwitchPanel } from './openclaw-twitch'
import { OpenClawWeComPanel } from './openclaw-wecom'
import { OpenClawWeixinPanel } from './openclaw-weixin'
import { OpenClawWhatsAppPanel } from './openclaw-whatsapp'
import { OpenClawYuanbaoBotPanel } from './openclaw-yuanbao'

type ChannelTab = 'dingtalk' | 'discord' | 'feishu' | 'matrix' | 'qqbot' | 'telegram' | 'twitch' | 'wecom' | 'weixin' | 'whatsapp' | 'yuanbao'

type ChannelTabConfig = {
  channelId: string
  icon: string
  id: ChannelTab
  label: string
}

const channelTabs: ChannelTabConfig[] = [
  { channelId: 'openclaw-weixin', icon: 'simple-icons:wechat', id: 'weixin', label: '微信' },
  { channelId: 'feishu', icon: 'icon-park-outline:lark', id: 'feishu', label: '飞书' },
  { channelId: 'dingtalk-connector', icon: 'ant-design:dingtalk-circle-filled', id: 'dingtalk', label: '钉钉' },
  { channelId: 'qqbot', icon: 'simple-icons:tencentqq', id: 'qqbot', label: 'QQ' },
  { channelId: 'yuanbao', icon: 'lucide:bot-message-square', id: 'yuanbao', label: '元宝' },
  { channelId: 'wecom', icon: 'ant-design:wechat-work-outlined', id: 'wecom', label: '企业微信' },
  { channelId: 'telegram', icon: 'simple-icons:telegram', id: 'telegram', label: 'Telegram' },
  { channelId: 'discord', icon: 'simple-icons:discord', id: 'discord', label: 'Discord' },
  { channelId: 'matrix', icon: 'simple-icons:matrix', id: 'matrix', label: 'Matrix' },
  { channelId: 'twitch', icon: 'simple-icons:twitch', id: 'twitch', label: 'Twitch' },
  { channelId: 'whatsapp', icon: 'simple-icons:whatsapp', id: 'whatsapp', label: 'WhatsApp' },
]

const commonChannelIds: ChannelTab[] = ['weixin', 'feishu', 'dingtalk', 'qqbot', 'yuanbao', 'wecom']
const commonChannelTabs = channelTabs.filter((tab) => commonChannelIds.includes(tab.id))
const moreChannelTabs = channelTabs.filter((tab) => !commonChannelIds.includes(tab.id))
const moreChannelPlaceholderKey = '__more_channels__'
const channelChartColors = {
  disabled: 'var(--warning)',
  enabled: 'var(--success)',
  total: 'var(--accent)',
  empty: 'var(--surface-secondary)',
}

function OpenClawChannelsPage() {
  usePageTitle('OpenClaw 消息渠道')
  const [activeChannel, setActiveChannel] = useState<ChannelTab>('weixin')
  const [accountStats, setAccountStats] = useState(() => ({ enabled: 0, total: 0 }))
  const [recentMessages, setRecentMessages] = useState<OpenClawRecentChannelMessage[]>([])
  const [recentMessagesError, setRecentMessagesError] = useState('')
  const [isLoadingRecentMessages, setIsLoadingRecentMessages] = useState(true)
  const [isRefreshingConfig, setIsRefreshingConfig] = useState(false)
  const selectedMoreChannel = moreChannelTabs.find((tab) => tab.id === activeChannel)
  const moreChannelValue = selectedMoreChannel?.id ?? moreChannelPlaceholderKey

  const loadRecentMessages = useCallback(async () => {
    setIsLoadingRecentMessages(true)
    setRecentMessagesError('')

    try {
      const response = await getOpenClawRecentChannelMessages({ limit: 40 })
      setRecentMessages(response.messages)
    } catch (err) {
      setRecentMessages([])
      setRecentMessagesError(err instanceof Error ? err.message : '最近消息加载失败')
    } finally {
      setIsLoadingRecentMessages(false)
    }
  }, [])

  useEffect(() => {
    let ignore = false

    async function loadAccountStats() {
      const stats = await fetchAccountStats()
      if (!ignore) setAccountStats(stats)
    }

    async function loadInitialRecentMessages() {
      try {
        const response = await getOpenClawRecentChannelMessages({ limit: 40 })
        if (!ignore) setRecentMessages(response.messages)
      } catch (err) {
        if (!ignore) {
          setRecentMessages([])
          setRecentMessagesError(err instanceof Error ? err.message : '最近消息加载失败')
        }
      } finally {
        if (!ignore) setIsLoadingRecentMessages(false)
      }
    }

    void loadAccountStats()
    void loadInitialRecentMessages()

    return () => {
      ignore = true
    }
  }, [])

  async function refreshConfig() {
    setIsRefreshingConfig(true)
    try {
      const [stats] = await Promise.all([fetchAccountStats(), loadRecentMessages()])
      setAccountStats(stats)
    } finally {
      setIsRefreshingConfig(false)
    }
  }

  function handleMoreChannelChange(key: Key | null) {
    const nextChannel = moreChannelTabs.find((tab) => tab.id === key)
    if (nextChannel) setActiveChannel(nextChannel.id)
  }

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)]">
          <Card variant="transparent" className="h-full overflow-visible">
            <Card.Content className="flex h-full items-center justify-center overflow-visible">
              <div className="flex w-full flex-col gap-5 overflow-visible sm:flex-row sm:items-center md:gap-6">
                <div className="flex h-36 shrink-0 items-center justify-center overflow-visible p-1">
                  <img
                    src="https://assets.orence.net/file/20260514115000877.png"
                    alt="Channels"
                    className="h-full w-auto"
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-5">
                  <div className="min-w-0">
                    <Card.Title className="md:text-3xl text-2xl font-bold">消息渠道</Card.Title>
                    <Card.Description className="mt-4 md:text-lg text-base">管理消息接入，配置常用渠道、启用状态与平台连接。</Card.Description>
                  </div>
                </div>
              </div>
            </Card.Content>
          </Card>

          <AccountStatsPieCard stats={accountStats} />
        </section>

        <div className="flex flex-col gap-3 pb-1 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 overflow-x-auto">
            <Segment selectedKey={commonChannelIds.includes(activeChannel) ? activeChannel : undefined} onSelectionChange={(key) => setActiveChannel(String(key) as ChannelTab)}>
              {commonChannelTabs.map((tab) => (
                <Segment.Item key={tab.id} id={tab.id}>
                  <Segment.Separator />
                  <Icon icon={tab.icon} className="size-4" />
                  {tab.label}
                </Segment.Item>
              ))}
            </Segment>
          </div>

          <div className="flex w-full items-center gap-2 lg:w-auto">
            <CellSelect aria-label="更多渠道" className="min-w-0 flex-1 lg:flex-none" value={moreChannelValue} variant="secondary" onChange={handleMoreChannelChange}>
              <CellSelect.Trigger>
                <CellSelect.Value>
                  {() => selectedMoreChannel ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon icon={selectedMoreChannel.icon} className="size-4 text-muted" />
                      <span className="truncate font-medium">{selectedMoreChannel.label}</span>
                    </span>
                  ) : (
                    <span className="flex min-w-0 items-center gap-2 text-muted">
                      <Icon icon="lucide:ellipsis" className="size-4" />
                      <span className="truncate">更多渠道</span>
                    </span>
                  )}
                </CellSelect.Value>
                <CellSelect.Indicator />
              </CellSelect.Trigger>
              <CellSelect.Popover>
                <ListBox>
                  {moreChannelTabs.map((tab) => (
                    <ListBox.Item key={tab.id} id={tab.id} textValue={tab.label}>
                      <Icon icon={tab.icon} className="size-4 text-muted" />
                      {tab.label}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </CellSelect.Popover>
            </CellSelect>
            <Button isIconOnly aria-label="刷新配置" variant="ghost" onPress={() => void refreshConfig()} isDisabled={isRefreshingConfig}>
              <Icon icon="lucide:refresh-cw" className={isRefreshingConfig ? 'size-4 animate-spin' : 'size-4'} />
            </Button>
          </div>
        </div>

        {activeChannel === 'weixin' ? <OpenClawWeixinPanel /> : null}
        {activeChannel === 'dingtalk' ? <OpenClawDingTalkPanel /> : null}
        {activeChannel === 'feishu' ? <OpenClawFeishuPanel /> : null}
        {activeChannel === 'telegram' ? <OpenClawTelegramPanel /> : null}
        {activeChannel === 'discord' ? <OpenClawDiscordPanel /> : null}
        {activeChannel === 'matrix' ? <OpenClawMatrixPanel /> : null}
        {activeChannel === 'twitch' ? <OpenClawTwitchPanel /> : null}
        {activeChannel === 'qqbot' ? <OpenClawQQBotPanel /> : null}
        {activeChannel === 'yuanbao' ? <OpenClawYuanbaoBotPanel /> : null}
        {activeChannel === 'wecom' ? <OpenClawWeComPanel /> : null}
        {activeChannel === 'whatsapp' ? <OpenClawWhatsAppPanel /> : null}
        {activeChannel !== 'weixin' && activeChannel !== 'dingtalk' && activeChannel !== 'feishu' && activeChannel !== 'telegram' && activeChannel !== 'discord' && activeChannel !== 'matrix' && activeChannel !== 'twitch' && activeChannel !== 'qqbot' && activeChannel !== 'yuanbao' && activeChannel !== 'wecom' && activeChannel !== 'whatsapp' ? <ChannelComingSoon channel={channelTabs.find((tab) => tab.id === activeChannel)?.label ?? activeChannel} /> : null}

        <RecentMessagesCard
          error={recentMessagesError}
          isLoading={isLoadingRecentMessages}
          messages={recentMessages}
          onRefresh={loadRecentMessages}
        />
      </div>
    </DashboardLayout>
  )
}

function RecentMessagesCard({
  error,
  isLoading,
  messages,
  onRefresh,
}: {
  error: string
  isLoading: boolean
  messages: OpenClawRecentChannelMessage[]
  onRefresh: () => Promise<void>
}) {
  const [channelFilter, setChannelFilter] = useState('all')
  const filteredMessages = channelFilter === 'all'
    ? messages
    : messages.filter((message) => channelMatchesFilter(message.channel, channelFilter))
  const messageChannels = Array.from(new Set(messages.map((message) => message.channel).filter(Boolean))) as string[]
  const channelOptions = [
    ...channelTabs.map((tab) => ({ icon: tab.icon, id: tab.channelId, label: tab.label })),
    ...messageChannels
      .filter((channel) => !channelTabs.some((tab) => tab.channelId === channel || tab.id === channel))
      .map((channel) => ({ icon: 'lucide:message-square', id: channel, label: formatChannelLabel(channel) })),
  ]
  const selectedChannelOption = channelOptions.find((option) => option.id === channelFilter)

  function handleChannelFilterChange(key: Key | null) {
    setChannelFilter(key ? String(key) : 'all')
  }

  return (
    <Card className="w-full mt-4">
      <Card.Header className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Card.Title>最近消息</Card.Title>
            <Chip size="sm" variant="soft">{filteredMessages.length} 条</Chip>
          </div>
          <Card.Description>最近收发的渠道消息。</Card.Description>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <CellSelect aria-label="筛选消息渠道" className="w-36" value={channelFilter} variant="secondary" onChange={handleChannelFilterChange}>
            <CellSelect.Trigger>
              <CellSelect.Value>
                {() => selectedChannelOption ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon icon={selectedChannelOption.icon} className="size-4 text-muted" />
                    <span className="truncate font-medium">{selectedChannelOption.label}</span>
                  </span>
                ) : (
                  <span className="flex min-w-0 items-center gap-2 text-muted">
                    <Icon icon="lucide:messages-square" className="size-4" />
                    <span className="truncate">全部渠道</span>
                  </span>
                )}
              </CellSelect.Value>
              <CellSelect.Indicator />
            </CellSelect.Trigger>
            <CellSelect.Popover>
              <ListBox>
                <ListBox.Item id="all" textValue="全部渠道">
                  <Icon icon="lucide:messages-square" className="size-4 text-muted" />
                  全部渠道
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                {channelOptions.map((option) => (
                  <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
                    <Icon icon={option.icon} className="size-4 text-muted" />
                    {option.label}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </CellSelect.Popover>
          </CellSelect>
          <Button isIconOnly aria-label="刷新最近消息" variant="ghost" onPress={() => void onRefresh()} isDisabled={isLoading}>
            <Icon icon="lucide:refresh-cw" className={isLoading ? 'size-4 animate-spin' : 'size-4'} />
          </Button>
        </div>
      </Card.Header>
      <Card.Content>
        {error ? (
          <div className="mb-3 flex items-start gap-3 rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
            <Icon icon="lucide:triangle-alert" className="mt-0.5 size-4 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        ) : null}
        <Table variant="secondary">
          <Table.ScrollContainer className="max-h-[420px] overflow-auto">
            <Table.Content aria-label="OpenClaw recent channel messages" className="min-w-[1060px] table-fixed">
              <Table.Header className="sticky top-0 z-10">
                <Table.Column isRowHeader id="channel" className="w-[132px]">渠道</Table.Column>
                <Table.Column id="time" className="w-[156px]">时间</Table.Column>
                <Table.Column id="role" className="w-[96px]">角色</Table.Column>
                <Table.Column id="sender" className="w-[180px]">发送者</Table.Column>
                <Table.Column id="content">内容</Table.Column>
                <Table.Column id="agent" className="w-[96px]">Agent</Table.Column>
              </Table.Header>
              <Table.Body
                items={filteredMessages}
                renderEmptyState={() => (
                  <div className="px-4 py-8 text-center text-sm text-muted">
                    {isLoading ? '加载中...' : '暂无最近消息'}
                  </div>
                )}
              >
                {(item) => (
                  <Table.Row key={item.id} id={item.id}>
                    <Table.Cell className="w-[132px]">
                      <Chip size="sm" variant="soft">{formatChannelLabel(item.channel)}</Chip>
                    </Table.Cell>
                    <Table.Cell className="w-[156px] text-xs tabular-nums text-muted">
                      {formatMessageTime(item.timestamp)}
                    </Table.Cell>
                    <Table.Cell className="w-[96px]">
                      <Chip color={item.role === 'assistant' ? 'accent' : 'default'} size="sm" variant="soft">
                        {formatMessageRole(item.role)}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell className="w-[180px]">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground" title={item.sender || item.senderId || item.chatId || '-'}>
                          {item.sender || item.senderId || '-'}
                        </div>
                        <div className="truncate text-xs text-muted" title={item.chatId || ''}>{item.chatId || '-'}</div>
                      </div>
                    </Table.Cell>
                    <Table.Cell className="min-w-0">
                      <span className="block truncate text-sm leading-6 text-foreground" title={item.content}>
                        {item.content}
                      </span>
                    </Table.Cell>
                    <Table.Cell className="w-[96px] text-xs text-muted">{item.agentId || '-'}</Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Card.Content>
    </Card>
  )
}

function AccountStatsPieCard({ stats }: { stats: { enabled: number; total: number } }) {
  const disabled = Math.max(stats.total - stats.enabled, 0)
  const chartData = [
    { name: '已启用账号', value: stats.enabled, fill: channelChartColors.enabled },
    { name: '未启用账号', value: disabled, fill: channelChartColors.disabled },
  ].filter((item) => item.value > 0)
  const displayChartData = chartData.length ? chartData : [{ name: '暂无账号', value: 1, fill: channelChartColors.empty }]

  return (
    <Card className="h-full">
      <Card.Content>
        <div className="flex h-full flex-col justify-center gap-4 sm:flex-row sm:items-center xl:flex-row 2xl:flex-row">
          <div className="relative mx-auto shrink-0">
            <PieChart height={156} width={156}>
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
              <span className="text-[10px] text-muted">账号</span>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <ChannelLegendItem color={channelChartColors.total} label="全部账号" value={stats.total} />
            <ChannelLegendItem color={channelChartColors.enabled} label="已启用账号" value={stats.enabled} />
            <ChannelLegendItem color={channelChartColors.disabled} label="未启用账号" value={disabled} />
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

function ChannelLegendItem({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface-secondary/50 px-3 py-2">
      <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <div className="flex flex-1 items-center justify-between gap-3">
        <span className="text-sm text-muted">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
      </div>
    </div>
  )
}

function formatMessageTime(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
  })
}

function formatChannelLabel(channel?: string) {
  if (!channel) return '未知'
  return channelTabs.find((tab) => tab.channelId === channel || tab.id === channel)?.label ?? channel
}

function channelMatchesFilter(channel: string | undefined, filter: string) {
  if (!channel) return false
  if (channel === filter) return true
  const tab = channelTabs.find((item) => item.channelId === filter || item.id === filter)
  return tab ? channel === tab.channelId || channel === tab.id : false
}

function formatMessageRole(role?: string) {
  if (role === 'assistant') return '回复'
  if (role === 'user') return '用户'
  return role || '-'
}

function objectMap(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

async function fetchAccountStats() {
  try {
    const response = await getOpenClawConfig()
    return calculateAccountStats(objectMap(response.content?.channels))
  } catch {
    return { enabled: 0, total: 0 }
  }
}

function calculateAccountStats(channels: Record<string, unknown>) {
  return channelTabs.reduce((stats, tab) => {
    const accounts = objectMap(objectMap(channels[tab.channelId]).accounts)
    const accountList = Object.values(accounts).filter(isAccountConfig)

    stats.total += accountList.length
    stats.enabled += accountList.filter((account) => objectMap(account).enabled === true).length
    return stats
  }, { enabled: 0, total: 0 })
}

function isAccountConfig(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function ChannelComingSoon({ channel }: { channel: string }) {
  return (
    <Card>
      <Card.Content>
        <div className="flex flex-col items-center px-6 py-14 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-background-tertiary text-muted">
            <Icon icon="lucide:construction" className="size-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-foreground">{channel}</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted">
            这个渠道的接入面板还没有展开。当前已完成微信渠道，后续平台会复用同一套渠道页结构。
          </p>
        </div>
      </Card.Content>
    </Card>
  )
}

export default OpenClawChannelsPage
