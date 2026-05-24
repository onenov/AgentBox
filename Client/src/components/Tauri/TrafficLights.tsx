import type { Window as TauriAppWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import { isTauriRuntime } from '@/utils/tauri'

function TauriTrafficLights() {
  const [appWindow, setAppWindow] = useState<TauriAppWindow | null>(null)
  const [hovered, setHovered] = useState(false)
  const [isFocused, setIsFocused] = useState(true)

  useEffect(() => {
    let disposed = false
    let retryTimer: number | null = null
    let unlistenFocus: (() => void) | null = null
    let attempts = 0
    const maxAttempts = 120

    const connect = async () => {
      if (disposed) return

      if (!isTauriRuntime()) {
        if (attempts < maxAttempts) {
          attempts += 1
          retryTimer = window.setTimeout(() => {
            void connect()
          }, 16)
        }
        return
      }

      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        if (disposed) return

        const current = getCurrentWindow()
        setAppWindow(current)
        unlistenFocus = await current.onFocusChanged(({ payload }) => {
          setIsFocused(Boolean(payload))
        })
      } catch {
        if (attempts < maxAttempts) {
          attempts += 1
          retryTimer = window.setTimeout(() => {
            void connect()
          }, 16)
        }
      }
    }

    void connect()

    return () => {
      disposed = true
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer)
      }
      unlistenFocus?.()
    }
  }, [])

  if (!appWindow) return null

  return (
    <div
      className={`tauri-traffic-lights ${isFocused ? 'is-focused' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button className="tauri-traffic-light tauri-traffic-light--close" type="button" aria-label="关闭窗口" onClick={() => void appWindow.close()}>
        {hovered ? <Icon icon="lucide:x" className="size-2" /> : null}
      </button>
      <button className="tauri-traffic-light tauri-traffic-light--minimize" type="button" aria-label="最小化窗口" onClick={() => void appWindow.minimize()}>
        {hovered ? <Icon icon="lucide:minus" className="size-2" /> : null}
      </button>
      <button className="tauri-traffic-light tauri-traffic-light--maximize" type="button" aria-label="缩放窗口" onClick={() => void appWindow.toggleMaximize()}>
        {hovered ? <Icon icon="lucide:plus" className="size-2" /> : null}
      </button>
    </div>
  )
}

export default TauriTrafficLights

