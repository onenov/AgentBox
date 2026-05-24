import { Button, Chip, Dropdown, Label, Tooltip } from '@heroui/react'
import { AppLayout, Sidebar } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import OpenClawStatusCapsule from '@/components/OpenClawStatusCapsule'
import StyleSwitcher from '@/components/Style/Switcher'
import TauriTrafficLights from '@/components/Tauri/TrafficLights'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import { startTauriWindowDrag } from '@/utils/tauriWindowDrag'
import { useOpenClawChat, type OpenClawChatAgentOption } from './OpenClawChatContext'

function OpenClawChatPageHeader({ sidebarOpen }: { sidebarOpen: boolean }) {
  const { agentOptions, connectionStatus, createSession, refresh, selectAgent, selectedAgentId, showToolCards, toggleToolCards } = useOpenClawChat()
  const isReady = connectionStatus === 'ready'

  return (
    <header className="flex h-14 w-full shrink-0 cursor-default select-none items-center px-4 text-foreground" data-tauri-drag-region onMouseDown={startTauriWindowDrag}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {sidebarOpen ? null : <TauriTrafficLights />}
        <AppLayout.MenuToggle />
        <Sidebar.Trigger />
        {/* <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <span className="truncate font-semibold text-foreground">{currentSession?.title || 'OpenClaw Chat'}</span>
          {gatewayVersion ? (
            <span className="hidden shrink-0 text-xs text-muted md:inline">{gatewayVersion}</span>
          ) : null}
        </div> */}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Tooltip delay={0}>
          <Button isIconOnly aria-label="新建对话" size="sm" variant="tertiary" onPress={createSession}>
            <Icon icon="lucide:plus" className="size-4" />
          </Button>
          <Tooltip.Content>
            <p>新建对话</p>
          </Tooltip.Content>
        </Tooltip>

        <Tooltip delay={0}>
          <Button isIconOnly aria-label="刷新 Gateway 连接" size="sm" variant="tertiary" onPress={() => void refresh()}>
            <Icon icon="lucide:refresh-cw" className="size-4" />
          </Button>
          <Tooltip.Content>
            <p>刷新 Gateway 连接</p>
          </Tooltip.Content>
        </Tooltip>

        <Tooltip delay={0}>
          <Button
            isIconOnly
            aria-label={showToolCards ? '隐藏工具调用卡片' : '显示工具调用卡片'}
            size="sm"
            variant={showToolCards ? 'tertiary' : 'ghost'}
            onPress={toggleToolCards}
          >
            <Icon icon="lucide:wrench" className="size-4" />
          </Button>
          <Tooltip.Content>
            <p>{showToolCards ? '隐藏工具调用卡片' : '显示工具调用卡片'}</p>
          </Tooltip.Content>
        </Tooltip>
        <AgentSelector
          isDisabled={!isReady}
          options={agentOptions}
          value={selectedAgentId}
          onChange={selectAgent}
        />
        <OpenClawStatusCapsule />
        <StyleSwitcher />
        <ThemeSwitcher />
      </div>
    </header>
  )
}

function AgentSelector({
  isDisabled,
  onChange,
  options,
  value,
}: {
  isDisabled?: boolean
  onChange: (value: string) => void
  options: OpenClawChatAgentOption[]
  value: string
}) {
  const selected = options.find((option) => option.id === value) ?? options[0]

  if (!options.length) {
    return null
  }

  return (
    <Dropdown>
      <Button aria-label="选择 Agent" isDisabled={isDisabled} size="sm" variant="tertiary">
        <span className="flex min-w-0 items-center gap-2">
          <span className="rounded-system flex size-5 shrink-0 items-center justify-center bg-surface-secondary/50 text-xs">
            {selected?.emoji || <Icon icon="lucide:user-round" className="size-3.5" />}
          </span>
          <span className="truncate text-xs font-medium">{selected?.label || 'Agent'}</span>
        </span>
      </Button>
      <Dropdown.Popover className="min-w-[auto]">
        <Dropdown.Menu
          selectedKeys={new Set([value])}
          selectionMode="single"
          onSelectionChange={(keys) => {
            const nextKey = Array.from(keys)[0]
            if (nextKey) onChange(String(nextKey))
          }}
        >
          {options.map((agent) => (
            <Dropdown.Item key={agent.id} id={agent.id} textValue={`${agent.label} ${agent.id}`}>
              <Dropdown.ItemIndicator type="dot" />
              <div className="flex min-w-0 items-center gap-3">
                <span className="rounded-system flex size-8 shrink-0 items-center justify-center bg-accent/10 text-sm text-accent">
                  {agent.emoji || <Icon icon="lucide:user-round" className="size-4" />}
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <Label className="truncate">{agent.label}</Label>
                    {agent.isDefault ? (
                      <Chip size="sm" variant="soft">
                        默认
                      </Chip>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted">
                    {agent.id}
                    {agent.model ? ` · ${agent.model}` : ''}
                  </p>
                </div>
              </div>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

export default OpenClawChatPageHeader
