import { useEffect, useState, useSyncExternalStore } from 'react'
import { Popover } from '@heroui/react'
import { Icon } from '@iconify/react'
import { ApiError, verifyBackendAuthToken } from '@/api'

export type BackendSecuritySnapshot = {
  openAccess: boolean | null
}

const backendSecurityStoreListeners = new Set<() => void>()

let backendSecurityCheckPromise: Promise<void> | null = null
let backendSecuritySnapshot: BackendSecuritySnapshot = {
  openAccess: null,
}

export function subscribeBackendSecuritySnapshot(listener: () => void) {
  backendSecurityStoreListeners.add(listener)
  return () => backendSecurityStoreListeners.delete(listener)
}

export function getBackendSecuritySnapshot() {
  return backendSecuritySnapshot
}

export function useBackendSecuritySnapshot() {
  return useSyncExternalStore(subscribeBackendSecuritySnapshot, getBackendSecuritySnapshot, getBackendSecuritySnapshot)
}

function BackendSecurityCapsule() {
  const securitySnapshot = useBackendSecuritySnapshot()
  const [isOpen, setOpen] = useState(false)

  useEffect(() => {
    void refreshBackendSecuritySnapshot()

    const handleStatusRefresh = () => {
      void refreshBackendSecuritySnapshot()
    }
    const handleAuthRefresh = () => {
      void refreshBackendSecuritySnapshot()
    }
    window.addEventListener('openclaw:status-refresh', handleStatusRefresh)
    window.addEventListener('agent-box:auth-refresh', handleAuthRefresh)

    return () => {
      window.removeEventListener('openclaw:status-refresh', handleStatusRefresh)
      window.removeEventListener('agent-box:auth-refresh', handleAuthRefresh)
    }
  }, [])

  if (securitySnapshot.openAccess !== true) {
    return null
  }

  return (
    <Popover isOpen={isOpen} onOpenChange={setOpen}>
      <Popover.Trigger>
        <button
          aria-label="访问保护已关闭"
          className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-[calc(var(--radius)_*_2.5)] bg-default px-3 text-foreground transition-colors"
          title="后端当前无需访问凭证即可进入"
          type="button"
        >
          <BackendSecurityIndicator size="sm" />
          <span className="text-xs font-bold">未受保护</span>
        </button>
      </Popover.Trigger>

      <Popover.Content className="w-72" offset={8} placement="bottom">
        <Popover.Dialog className="p-3">
          <div className="flex items-center gap-3">
            <BackendSecurityIndicator className="mt-0.5" />
            <div className="min-w-0">
              <Popover.Heading className="text-sm font-semibold text-foreground">访问保护已关闭</Popover.Heading>
            </div>
          </div>
          <div className="mt-2 px-1 text-xs leading-5 text-muted">
            当前面板无需访问凭证即可进入。请只在可信网络中使用，在侧边栏安全设置中完成访问鉴权。
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}

function BackendSecurityIndicator({ size = 'md', className = '' }: { size?: 'sm' | 'md'; className?: string }) {
  const sizeClass = size === 'sm' ? 'size-5 [&>svg]:size-3' : 'size-9 [&>svg]:size-4'

  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-warning text-white shadow-[0_0_14px_color-mix(in_oklch,var(--warning)_70%,transparent)] ring-2 ring-warning/30 ${sizeClass} ${className}`}>
      <Icon icon="lucide:shield-alert" />
    </span>
  )
}

function emitBackendSecuritySnapshot(snapshot: BackendSecuritySnapshot) {
  backendSecuritySnapshot = snapshot
  for (const listener of backendSecurityStoreListeners) listener()
}

function refreshBackendSecuritySnapshot() {
  if (backendSecurityCheckPromise) return backendSecurityCheckPromise

  backendSecurityCheckPromise = (async () => {
    try {
      await verifyBackendAuthToken('')
      emitBackendSecuritySnapshot({ openAccess: true })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        emitBackendSecuritySnapshot({ openAccess: false })
        return
      }

      emitBackendSecuritySnapshot({ openAccess: null })
    } finally {
      backendSecurityCheckPromise = null
    }
  })()

  return backendSecurityCheckPromise
}

export default BackendSecurityCapsule
