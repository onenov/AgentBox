import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './tauri'

export const desktopStorageLocalStorageKeys = [
  'agent-box-auth-token',
  'agent-box-api-url',
  'agent-box-dashboard-engine',
  'agent-manager-notice-dismissed-meta',
  'openclaw-device-identity-v1',
  'openclaw.device.auth.v1',
  'agent-box-theme',
  'agent-box-theme-style',
  'agent-box-theme-color',
  'agent-box-theme-general-radius',
  'agent-box-theme-forms-radius',
  'agent-box-theme-font',
]

export async function getDesktopStorageValue<T>(key: string): Promise<T | null> {
  if (!isTauriRuntime()) return null
  try {
    const value = await invoke<T | null>('get_desktop_storage_value', { key })
    return value ?? null
  } catch {
    return null
  }
}

export function setDesktopStorageValue(key: string, value: unknown) {
  if (!isTauriRuntime()) return
  void invoke('set_desktop_storage_value', { key, value }).catch(() => undefined)
}

export async function setDesktopStorageValueAsync(key: string, value: unknown) {
  if (!isTauriRuntime()) return
  await invoke('set_desktop_storage_value', { key, value })
}

export function removeDesktopStorageValue(key: string) {
  if (!isTauriRuntime()) return
  void invoke('remove_desktop_storage_value', { key }).catch(() => undefined)
}

export function clearDesktopStorage() {
  if (!isTauriRuntime()) return
  void invoke('clear_desktop_storage').catch(() => undefined)
}

export async function hydrateDesktopLocalStorage(keys = desktopStorageLocalStorageKeys) {
  if (!isTauriRuntime() || typeof window === 'undefined') return

  await Promise.all(keys.map(async (key) => {
    const value = await getDesktopStorageValue<unknown>(key)
    if (typeof value === 'string') {
      window.localStorage.setItem(key, value)
      window.sessionStorage.removeItem(key)
    }
  }))
}

export function setDesktopLocalStorageValue(key: string, value: string) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(key, value)
  }
  setDesktopStorageValue(key, value)
}

export function removeDesktopLocalStorageValue(key: string) {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(key)
  }
  removeDesktopStorageValue(key)
}
