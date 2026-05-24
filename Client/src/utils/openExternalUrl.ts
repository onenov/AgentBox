import { toast } from '@heroui/react'
import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './tauri'

let externalLinkInterceptorSetup = false

export async function openExternalUrl(url?: string | null): Promise<boolean> {
  const targetUrl = url?.trim()
  if (!targetUrl) return false

  try {
    if (!isTauriRuntime()) {
      return Boolean(window.open(targetUrl, '_blank', 'noopener,noreferrer'))
    }

    await invoke('open_external_url', { url: targetUrl })
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : '无法打开链接'
    toast.warning(message)
    return false
  }
}

export function setupExternalLinkInterceptor() {
  if (externalLinkInterceptorSetup || !isTauriRuntime() || typeof document === 'undefined') return
  externalLinkInterceptorSetup = true

  document.addEventListener(
    'click',
    (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(target instanceof HTMLAnchorElement)) return

      const url = target.href
      if (!url || !/^https?:\/\//i.test(url)) return

      event.preventDefault()
      void openExternalUrl(url)
    },
    { capture: true },
  )
}
