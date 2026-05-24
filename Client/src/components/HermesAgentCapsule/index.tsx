import { useCallback, useEffect, useState } from 'react'
import { Button, Chip, Description, Label, Popover, Spinner, toast } from '@heroui/react'
import { RadioButtonGroup } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import { useNavigate } from 'react-router-dom'
import type { HermesAgentInfo } from '@/api'
import { restartHermesGateway, stopHermesGateway } from '@/api'
import { useHermesAgentStore } from '@/stores/hermes-agent'
import { useHermesEnvironmentStore } from '@/stores/hermes-environment'

function HermesAgentCapsule() {
  const navigate = useNavigate()
  const state = useHermesAgentStore((store) => store.state)
  const profiles = useHermesAgentStore((store) => store.profiles)
  const selectedName = useHermesAgentStore((store) => store.selectedName)
  const selectedProfile = useHermesAgentStore((store) => store.selectedProfile)
  const loadAgents = useHermesAgentStore((store) => store.loadAgents)
  const refreshAgents = useHermesAgentStore((store) => store.refreshAgents)
  const selectAgent = useHermesAgentStore((store) => store.selectAgent)
  const loadEnvironment = useHermesEnvironmentStore((store) => store.loadHermesEnvironment)
  const [isOpen, setOpen] = useState(false)
  const [actionState, setActionState] = useState<'idle' | 'refreshing' | 'restarting' | 'stopping'>('idle')

  useEffect(() => {
    void loadAgents(false)
  }, [loadAgents])

  const explicitlySelectedProfile = selectedName ? profiles.find((item) => item.name === selectedName) ?? null : null
  const profile = explicitlySelectedProfile ?? selectedProfile ?? profiles.find((item) => item.isActive) ?? profiles[0] ?? null
  const isLoading = state === 'loading' && !profile
  const isRunning = Boolean(profile?.gatewayRunning)
  const hasProfile = Boolean(profile)
  const isStopped = !isLoading && !isRunning
  const statusLabel = isLoading ? 'CHECKING' : isRunning ? 'RUNNING' : 'STOPPED'
  const triggerClassName = `hidden h-8 cursor-pointer items-center gap-2 rounded-[calc(var(--radius)_*_2.5)] px-3 transition-colors sm:inline-flex ${isRunning
    ? 'bg-default text-foreground'
    : isLoading
      ? 'border border-warning/30 bg-warning/10 text-warning'
      : 'bg-danger text-danger-foreground hover:bg-danger/90'
    }`

  const refresh = useCallback(async () => {
    setActionState('refreshing')
    try {
      await refreshAgents()
      if (profile?.name) {
        await loadEnvironment(true, profile.name)
      }
      toast.success('Hermes Agent 状态已刷新')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '刷新失败')
    } finally {
      setActionState('idle')
    }
  }, [loadEnvironment, profile, refreshAgents])

  const restart = useCallback(async () => {
    if (!profile) return
    setActionState('restarting')
    try {
      await restartHermesGateway(profile.name)
      await loadEnvironment(true, profile.name)
      await refreshAgents()
      toast.success('Hermes Gateway 重启完成')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'Gateway 重启失败')
    } finally {
      setActionState('idle')
    }
  }, [loadEnvironment, profile, refreshAgents])

  const stop = useCallback(async () => {
    if (!profile) return
    setActionState('stopping')
    try {
      await stopHermesGateway(profile.name)
      await loadEnvironment(true, profile.name)
      await refreshAgents()
      toast.success('Hermes Gateway 已停止')
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : 'Gateway 停止失败')
    } finally {
      setActionState('idle')
    }
  }, [loadEnvironment, profile, refreshAgents])

  const handleSelect = useCallback((name: string) => {
    selectAgent(name)
    void loadEnvironment(false, name)
    setOpen(false)
  }, [loadEnvironment, selectAgent])

  const openAgentSettings = useCallback(() => {
    setOpen(false)
    navigate('/dashboard/hermes-agents')
  }, [navigate])

  const openInstall = useCallback(() => {
    setOpen(false)
    navigate('/dashboard/hermes-install')
  }, [navigate])

  return (
    <Popover isOpen={isOpen} onOpenChange={setOpen}>
      <Popover.Trigger>
        <button
          aria-label={profile ? `Hermes Agent ${profile.displayName || profile.name}` : 'Hermes Agent'}
          className={triggerClassName}
          title={profile?.path || 'Hermes Agent'}
          type="button"
        >
          <HermesAgentAvatar profile={profile} size="sm" isLoading={isLoading} />
          <span className="max-w-28 truncate text-xs font-bold">{profile?.displayName || profile?.name || 'Hermes'}</span>
          {/* {profile?.isActive ? <span className="text-[10px] font-semibold text-accent">默认</span> : null} */}
        </button>
      </Popover.Trigger>

      <Popover.Content className="w-[360px]" offset={8} placement="bottom">
        <Popover.Dialog className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full text-white ring-2 ${isLoading ? 'bg-warning ring-warning/30' : isRunning ? 'bg-success shadow-[0_0_14px_color-mix(in_oklch,var(--success)_70%,transparent)] ring-success/30' : 'bg-danger shadow-[0_0_14px_color-mix(in_oklch,var(--danger)_70%,transparent)] ring-danger/30'}`}>
                <Icon icon={isRunning ? 'lucide:radio-tower' : isStopped ? 'lucide:server-off' : 'lucide:user-round-cog'} className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Popover.Heading className="truncate text-sm font-semibold text-foreground">{profile?.displayName || profile?.name || 'Hermes Agent'}</Popover.Heading>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip size="sm" color={isRunning ? 'success' : 'default'} variant="soft">{statusLabel}</Chip>
                    {profile?.isActive ? <Chip size="sm" color="accent" variant="soft">默认</Chip> : null}
                  </div>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted" title={profile?.path}>{profile?.path || '未发现 Hermes Profile'}</p>
              </div>
            </div>
            {hasProfile ? (
              <Button isIconOnly size="sm" variant="tertiary" isPending={actionState === 'refreshing'} onPress={refresh}>
                {actionState === 'refreshing' ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:refresh-cw" className="size-4" />}
              </Button>
            ) : null}
          </div>

          {profiles.length ? (
            <div className="mt-3 max-h-64 overflow-y-auto p-1">
              <RadioButtonGroup
                aria-label="Hermes Agent"
                className="w-full gap-2"
                name="hermes-agent-switcher"
                value={profile?.name ?? ''}
                variant="secondary"
                onChange={(value) => handleSelect(String(value))}
              >
                {profiles.map((item) => (
                  <RadioButtonGroup.Item key={item.name} className="min-w-0 flex w-full flex-row items-center p-2!" value={item.name}>
                    <RadioButtonGroup.ItemIcon className="shrink-0">
                      <HermesAgentAvatar profile={item} />
                    </RadioButtonGroup.ItemIcon>
                    <RadioButtonGroup.ItemContent className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <Label className="block truncate text-sm font-medium">{item.name}</Label>
                        {item.isActive ? <span className="shrink-0 text-[10px] font-semibold text-accent">默认</span> : null}
                      </div>
                      <Description className="mt-1 block truncate text-xs">
                        {item.provider || item.path}
                      </Description>
                    </RadioButtonGroup.ItemContent>
                    <RadioButtonGroup.Indicator />
                  </RadioButtonGroup.Item>
                ))}
              </RadioButtonGroup>
            </div>
          ) : null}

          {hasProfile ? (
            <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
              <Button fullWidth size="sm" variant="primary" isPending={actionState === 'restarting'} isDisabled={!profile || actionState !== 'idle'} onPress={restart}>
                {actionState === 'restarting' ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:rotate-ccw" className="size-4" />}
                重启
              </Button>
              <Button fullWidth size="sm" variant="danger" isPending={actionState === 'stopping'} isDisabled={!profile || !isRunning || actionState !== 'idle'} onPress={stop}>
                {actionState === 'stopping' ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:square" className="size-4" />}
                停止
              </Button>
              <Button isIconOnly size="sm" variant="tertiary" onPress={openAgentSettings}>
                <Icon icon="lucide:settings" className="size-4" />
              </Button>
            </div>
          ) : (
            <div className="mt-3">
              <Button fullWidth size="sm" variant="primary" onPress={openInstall}>
                <Icon icon="lucide:package-check" className="size-4" />
                进入安装向导
              </Button>
            </div>
          )}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}

function HermesAgentAvatar({ profile, size = 'md', isLoading = false, className = '' }: { profile?: HermesAgentInfo | null; size?: 'sm' | 'md'; isLoading?: boolean; className?: string }) {
  const sizeClass = size === 'sm' ? 'size-5 [&>svg]:size-3' : 'size-9 [&>svg]:size-4'
  const icon = isLoading ? 'lucide:loader-circle' : profile?.gatewayRunning ? 'lucide:radio-tower' : profile ? profile.isDefault ? 'lucide:brain-cog' : 'lucide:brain' : 'lucide:server-off'
  const toneClass = isLoading
    ? 'bg-warning ring-warning/30'
    : profile?.gatewayRunning
      ? 'bg-success shadow-[0_0_14px_color-mix(in_oklch,var(--success)_70%,transparent)] ring-success/30'
      : profile
        ? profile.isDefault
          ? 'bg-accent ring-accent/30'
          : 'bg-muted ring-muted/30'
        : 'bg-danger ring-danger/30'

  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full text-white ring-2 ${sizeClass} ${toneClass} ${className}`}>
      <Icon icon={icon} className={isLoading ? 'animate-spin' : ''} />
    </span>
  )
}

export default HermesAgentCapsule
