import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './tauri'
import { getDesktopStorageValue, removeDesktopStorageValue, setDesktopStorageValue } from './desktopStorage'

const AUTH_TOKEN_STORAGE_KEY = 'agent-box-auth-token'
const API_URL_STORAGE_KEY = 'agent-box-api-url'

type LegacyDesktopAuthPreferences = {
  apiUrl?: string | null
  authToken?: string | null
}

export async function hydrateDesktopAuthPreferences() {
  if (!isTauriRuntime()) return

  try {
    const legacyPreferences = await readLegacyDesktopAuthPreferences()
    const authToken = ((await getDesktopStorageValue<string>(AUTH_TOKEN_STORAGE_KEY)) ?? legacyPreferences?.authToken ?? '').trim()
    const apiUrl = normalizeApiUrl((await getDesktopStorageValue<string>(API_URL_STORAGE_KEY)) ?? legacyPreferences?.apiUrl ?? '')
    if (authToken) {
      window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, authToken)
      window.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
      setDesktopStorageValue(AUTH_TOKEN_STORAGE_KEY, authToken)
    }
    if (apiUrl) {
      window.localStorage.setItem(API_URL_STORAGE_KEY, apiUrl)
      window.sessionStorage.removeItem(API_URL_STORAGE_KEY)
      setDesktopStorageValue(API_URL_STORAGE_KEY, apiUrl)
      const { useConfigStore } = await import('@/stores/config')
      useConfigStore.setState({ apiUrl })
    }
  } catch {
    // Desktop auth preferences are a fallback for Tauri origin changes.
  }
}

async function readLegacyDesktopAuthPreferences() {
  try {
    return await invoke<LegacyDesktopAuthPreferences>('get_auth_preferences')
  } catch {
    return null
  }
}

export function persistDesktopAuthToken(authToken: string) {
  setDesktopStorageValue(AUTH_TOKEN_STORAGE_KEY, authToken)
}

export function clearDesktopAuthToken() {
  removeDesktopStorageValue(AUTH_TOKEN_STORAGE_KEY)
}

export function persistDesktopApiUrl(apiUrl: string) {
  setDesktopStorageValue(API_URL_STORAGE_KEY, normalizeApiUrl(apiUrl))
}

export function clearDesktopApiUrl() {
  removeDesktopStorageValue(API_URL_STORAGE_KEY)
}

function normalizeApiUrl(value: string) {
  return value.trim().replace(/\/+$/, '')
}
