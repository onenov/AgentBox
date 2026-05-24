import { invoke } from '@tauri-apps/api/core'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { isTauriRuntime } from './tauri'

export type StartupPreferences = {
  silentStartup: boolean
}

export type StartupSettings = StartupPreferences & {
  autoStart: boolean
}

const defaultStartupPreferences: StartupPreferences = {
  silentStartup: false,
}

function errorToMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error

  try {
    return JSON.stringify(error)
  } catch {
    return fallback
  }
}

export async function getStartupSettings(): Promise<StartupSettings> {
  if (!isTauriRuntime()) {
    return { ...defaultStartupPreferences, autoStart: false }
  }

  let autoStart = false
  let preferences = defaultStartupPreferences

  try {
    autoStart = await isEnabled()
  } catch (error) {
    console.error('[startup-settings] Failed to read autostart state', error)
    throw new Error(errorToMessage(error, '启动项状态读取失败'))
  }

  try {
    preferences = await invoke<StartupPreferences>('get_startup_preferences')
  } catch (error) {
    console.warn('[startup-settings] Failed to read startup preferences, using defaults', error)
  }

  return {
    autoStart,
    silentStartup: Boolean(preferences.silentStartup),
  }
}

export async function setStartupSettings(settings: StartupSettings): Promise<StartupSettings> {
  if (!isTauriRuntime()) {
    return settings
  }

  try {
    if (settings.autoStart) {
      await enable()
    } else {
      await disable()
    }
  } catch (error) {
    console.error('[startup-settings] Failed to update autostart state', { settings, error })
    throw new Error(errorToMessage(error, '启动项设置保存失败'))
  }

  const preferences: StartupPreferences = {
    silentStartup: settings.autoStart && settings.silentStartup,
  }

  try {
    await invoke('set_startup_preferences', { preferences })
  } catch (error) {
    console.error('[startup-settings] Failed to save startup preferences', { preferences, error })
    throw new Error(errorToMessage(error, '静默启动设置保存失败'))
  }

  let autoStart = settings.autoStart
  try {
    autoStart = await isEnabled()
  } catch (error) {
    console.warn('[startup-settings] Failed to verify autostart state', error)
  }

  return {
    autoStart,
    silentStartup: preferences.silentStartup,
  }
}
