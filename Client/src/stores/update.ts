import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { create } from 'zustand'
import { appConfig } from '@/stores/config'
import { isTauriRuntime } from '@/utils/tauri'

type UpdateStatus = 'idle' | 'checking' | 'available' | 'current' | 'installing' | 'restarting' | 'error'

interface AppUpdateState {
  check: () => Promise<void>
  checked: boolean
  contentLength: number
  currentVersion: string
  downloadedBytes: number
  downloadProgress: number
  error: string
  install: () => Promise<void>
  installError: string
  latestVersion: string
  notes: string
  packageUrl: string
  pendingUpdate: Update | null
  pubDate: string
  status: UpdateStatus
  target: string
}

export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
  checked: false,
  contentLength: 0,
  currentVersion: appConfig.APP_VERSION,
  downloadedBytes: 0,
  downloadProgress: 0,
  error: '',
  installError: '',
  latestVersion: '',
  notes: '',
  packageUrl: '',
  pendingUpdate: null,
  pubDate: '',
  status: 'idle',
  target: '',
  check: async () => {
    if (!isTauriRuntime() || !appConfig.UPDATE_URL) return
    if (get().status === 'checking' || get().checked) return

    set({ error: '', installError: '', status: 'checking' })

    try {
      const [currentVersion, target] = await Promise.all([
        getVersion().catch(() => appConfig.APP_VERSION),
        getDesktopUpdateTarget(),
      ])
      const update = await check(target ? { target, timeout: 30000 } : { timeout: 30000 })

      if (!update) {
        set({
          checked: true,
          currentVersion,
          latestVersion: currentVersion,
          pendingUpdate: null,
          status: 'current',
          target,
        })
        return
      }

      set({
        checked: true,
        contentLength: 0,
        currentVersion: update.currentVersion || currentVersion,
        downloadedBytes: 0,
        downloadProgress: 0,
        latestVersion: update.version,
        notes: update.body || '',
        packageUrl: getUpdatePackageUrl(update.rawJson, target),
        pendingUpdate: update,
        pubDate: update.date || '',
        status: 'available',
        target,
      })
    } catch (err) {
      set({
        checked: true,
        error: err instanceof Error ? err.message : '更新检查失败',
        status: 'error',
      })
    }
  },
  install: async () => {
    const pendingUpdate = get().pendingUpdate
    if (!pendingUpdate || get().status === 'installing' || get().status === 'restarting') return

    set({
      contentLength: 0,
      downloadedBytes: 0,
      downloadProgress: 0,
      installError: '',
      status: 'installing',
    })

    let downloadedBytes = 0

    try {
      await pendingUpdate.download((event) => {
        const nextState = progressState(event, downloadedBytes)
        downloadedBytes = nextState.downloadedBytes ?? downloadedBytes
        set(nextState)
      })

      set({ downloadProgress: 100 })
      await prepareDesktopUpdate()
      await pendingUpdate.install()
      set({ status: 'restarting' })
      await relaunch()
    } catch (err) {
      set({
        installError: err instanceof Error ? err.message : '更新安装失败',
        status: 'available',
      })
    }
  },
}))

async function getDesktopUpdateTarget() {
  try {
    return await invoke<string>('get_desktop_update_target')
  } catch {
    return fallbackUpdateTarget()
  }
}

function fallbackUpdateTarget() {
  const userAgent = navigator.userAgent.toLowerCase()
  if (userAgent.includes('mac')) return 'darwin-aarch64'
  if (userAgent.includes('win')) return 'windows-x86_64'
  return 'linux-x86_64'
}

function getUpdatePackageUrl(rawJson: Record<string, unknown>, target: string) {
  const directUrl = rawJson.url
  if (typeof directUrl === 'string') return directUrl

  const platforms = rawJson.platforms
  if (!platforms || typeof platforms !== 'object') return ''

  const platformItem = (platforms as Record<string, unknown>)[target]
  if (!platformItem || typeof platformItem !== 'object') return ''

  const url = (platformItem as Record<string, unknown>).url
  return typeof url === 'string' ? url : ''
}

async function prepareDesktopUpdate() {
  try {
    await invoke('prepare_desktop_update')
  } catch {
    // Older desktop builds do not expose this command; continue with updater install.
  }
}

function progressState(event: DownloadEvent, previousDownloadedBytes: number) {
  if (event.event === 'Started') {
    return {
      contentLength: event.data.contentLength ?? 0,
      downloadedBytes: 0,
      downloadProgress: 0,
    }
  }

  if (event.event === 'Progress') {
    const downloadedBytes = previousDownloadedBytes + event.data.chunkLength
    const contentLength = useAppUpdateStore.getState().contentLength
    return {
      downloadedBytes,
      downloadProgress: contentLength > 0 ? Math.min(Math.round((downloadedBytes / contentLength) * 100), 99) : 0,
    }
  }

  return {
    downloadProgress: 100,
  }
}
