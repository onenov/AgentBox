import { Button, Chip, Spinner, Tooltip } from '@heroui/react'
import { Sidebar } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import TauriTrafficLights from '@/components/Tauri/TrafficLights'
import { startTauriWindowDrag } from '@/utils/tauriWindowDrag'
import { useOpenClawChat, type OpenClawChatSession } from './OpenClawChatContext'

function Brand({ sidebarOpen }: { sidebarOpen: boolean }) {
  const { isLoadingSessions, sessions } = useOpenClawChat()

  return (
    <div className="flex justify-between items-center gap-3 mb-2" data-tauri-drag-region onMouseDown={startTauriWindowDrag}>
      <div className="flex items-center gap-3">
        {sidebarOpen ? <TauriTrafficLights /> : null}
        <span className="text-base font-semibold text-foreground" data-sidebar="label">
          Chat
        </span>
        <Chip color={isLoadingSessions ? 'warning' : 'success'} size="sm" variant="soft">
          {isLoadingSessions ? <Spinner color="current" size="sm" /> : sessions.length}
        </Chip>
      </div>
    </div>
  )
}

function ConversationItem({ isActive, session }: { isActive: boolean; session: OpenClawChatSession }) {
  const { selectSession } = useOpenClawChat()

  return (
    <button
      className={`rounded-system-lg w-full border p-2 text-left transition-colors ${isActive ? 'border-accent bg-background' : 'border-transparent hover:border-border hover:bg-surface-secondary'
        }`}
      type="button"
      onClick={() => selectSession(session.key)}
    >
      <div className="flex items-center justify-between gap-3">
        <ChannelAvatar channel={session.channel || session.channelId} />
        <div className="min-w-0 flex-1" data-sidebar="label">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{session.title}</span>
            {isActive ? <span className="rounded-system-sm size-2 bg-success shrink-0" /> : null}
          </div>
          <p className="truncate text-xs text-muted">
            <span className="text-xs text-muted">{formatSessionTime(session.updatedAt)}</span>
          </p>
        </div>
      </div>
    </button>
  )
}

function ChannelAvatar({ channel }: { channel?: string }) {
  const info = getChannelAvatarInfo(channel)

  return (
    <span className={`rounded-system flex size-8 items-center justify-center border ${info.border} ${info.bg} ${info.fg}`} title={info.label}>
      <Icon icon={info.icon} className="size-4" />
    </span>
  )
}

function ConversationList() {
  const { currentSessionKey, sessions } = useOpenClawChat()

  return (
    <Sidebar.Group>
      <div className="flex flex-col gap-2 px-1">
        {sessions.length ? (
          sessions.map((session) => (
            <ConversationItem key={session.key} isActive={session.key === currentSessionKey} session={session} />
          ))
        ) : (
          <div className="rounded-system-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted" data-sidebar="label">
            暂无会话
          </div>
        )}
      </div>
    </Sidebar.Group>
  )
}

function getChannelAvatarInfo(channel?: string) {
  const value = (channel || 'webchat').toLowerCase()
  if (value.includes('qq')) {
    return { bg: 'bg-sky-500/10', border: 'border-sky-500/20', fg: 'text-sky-500', icon: 'simple-icons:tencentqq', label: 'QQ' }
  }
  if (value.includes('wecom') || value.includes('wechat-work')) {
    return { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', fg: 'text-emerald-500', icon: 'ant-design:wechat-work-outlined', label: '企业微信' }
  }
  if (value.includes('weixin') || value.includes('wechat')) {
    return { bg: 'bg-green-500/10', border: 'border-green-500/20', fg: 'text-green-500', icon: 'simple-icons:wechat', label: '微信' }
  }
  if (value.includes('telegram')) {
    return { bg: 'bg-sky-500/10', border: 'border-sky-500/20', fg: 'text-sky-500', icon: 'simple-icons:telegram', label: 'Telegram' }
  }
  if (value.includes('discord')) {
    return { bg: 'bg-indigo-500/10', border: 'border-indigo-500/20', fg: 'text-indigo-500', icon: 'simple-icons:discord', label: 'Discord' }
  }
  return { bg: 'bg-accent/10', border: 'border-accent/20', fg: 'text-accent', icon: 'lucide:message-circle', label: value || 'webchat' }
}

function FooterActions() {
  const { createSession, isLoadingSessions, refresh } = useOpenClawChat()

  return (
    <div className="flex items-center gap-2 p-2" data-sidebar="label">
      <Button className="flex-1" isIconOnly size="sm" variant="primary" onPress={createSession}>
        <Icon icon="lucide:plus" className="size-4" />
        新对话
      </Button>
      <Tooltip delay={0}>
        <Button isIconOnly size="sm" variant="primary" onPress={() => window.location.assign('/dashboard/openclaw')}>
          <Icon icon="lucide:circle-gauge" className="size-4" />
        </Button>
        <Tooltip.Content>
          <p>仪表盘</p>
        </Tooltip.Content>
      </Tooltip>


      <Button isIconOnly className="shrink-0" isDisabled={isLoadingSessions} size="sm" variant="tertiary" onPress={() => void refresh()}>
        <Icon icon="lucide:refresh-cw" className={isLoadingSessions ? 'size-4 animate-spin' : 'size-4'} />
      </Button>
    </div>
  )
}

function OpenClawChatSidebarContent({ sidebarOpen }: { sidebarOpen: boolean }) {
  return (
    <>
      <Sidebar>
        <Sidebar.Header>
          <Brand sidebarOpen={sidebarOpen} />
        </Sidebar.Header>

        <Sidebar.Content>
          <ConversationList />
        </Sidebar.Content>

        

        <Sidebar.Footer>
          <FooterActions />
        </Sidebar.Footer>
      </Sidebar>

      <Sidebar.Mobile>
        <Sidebar.Header>
          <Brand sidebarOpen={sidebarOpen} />
        </Sidebar.Header>
        <Sidebar.Content>
          <ConversationList />
        </Sidebar.Content>
        <Sidebar.Footer>
          <FooterActions />
        </Sidebar.Footer>
      </Sidebar.Mobile>
    </>
  )
}

function formatSessionTime(value?: number) {
  if (!value) return ''
  const date = new Date(value)
  const now = Date.now()
  const diff = now - date.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟`
  if (date.toDateString() === new Date().toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export default OpenClawChatSidebarContent
