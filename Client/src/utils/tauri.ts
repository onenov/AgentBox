type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown
  __AGENTBOX_CONTEXT_MENU_DISABLED__?: boolean
}

export function isTauriRuntime() {
  return typeof window !== 'undefined' && Boolean((window as TauriWindow).__TAURI_INTERNALS__)
}

export function setupTauriDocument() {
  if (!isTauriRuntime() || typeof document === 'undefined') return
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent.toLowerCase()
  const isWindows = userAgent.includes('windows')
  const isMacOS = userAgent.includes('mac os')
  document.documentElement.classList.add('tauri')
  document.body.classList.add('tauri')
  document.documentElement.classList.toggle('tauri-windows', isWindows)
  document.body.classList.toggle('tauri-windows', isWindows)
  document.documentElement.classList.toggle('tauri-macos', isMacOS)
  document.body.classList.toggle('tauri-macos', isMacOS)
  disableTauriContextMenu()
}

function disableTauriContextMenu() {
  if ((window as TauriWindow).__AGENTBOX_CONTEXT_MENU_DISABLED__) return
  ;(window as TauriWindow).__AGENTBOX_CONTEXT_MENU_DISABLED__ = true
  document.addEventListener('contextmenu', (event) => event.preventDefault(), { capture: true })
}
