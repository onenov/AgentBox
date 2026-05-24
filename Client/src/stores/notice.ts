import { appConfig } from '@/stores/config'
import { setDesktopLocalStorageValue } from '@/utils/desktopStorage'

const NOTICE_DISMISSED_KEY = 'agent-manager-notice-dismissed-meta'

interface NoticeMeta {
  autoDisplay: boolean
  banner: string
  enable: boolean
  title: string
  updateTime: string
}

interface NoticeState extends NoticeMeta {
  content: string
}

interface NoticeStoreState extends NoticeState {
  close: () => void
  dismiss: () => void
  load: () => Promise<void>
  loaded: boolean
  modalOpen: boolean
  open: () => void
  setModalOpen: (open: boolean) => void
}

function buildNoticeMetaFingerprint(meta: NoticeMeta) {
  return JSON.stringify({
    title: meta.title,
    banner: meta.banner,
    updateTime: meta.updateTime,
    autoDisplay: meta.autoDisplay,
    enable: meta.enable,
  })
}

function parseBoolean(value: string | undefined) {
  return String(value || '').trim().toLowerCase() === 'true'
}

function parseNoticeMarkdown(raw: string): NoticeState {
  const normalized = raw.replace(/\r\n/g, '\n')
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const metaBlock = match?.[1] || ''
  const bodyBlock = match?.[2] || normalized
  const meta: Record<string, string> = {}

  for (const line of metaBlock.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (key) meta[key] = value
  }

  const content = bodyBlock
    .split('\n')
    .filter((line) => line.trim() !== '/* ----------')
    .join('\n')
    .trim()

  return {
    title: meta.title || '',
    banner: meta.banner || '',
    updateTime: meta.updateTime || '',
    autoDisplay: parseBoolean(meta.autoDisplay),
    enable: parseBoolean(meta.enable),
    content,
  }
}

export const useNoticeStore = create<NoticeStoreState>((set, get) => ({
  autoDisplay: false,
  banner: '',
  content: '',
  enable: false,
  loaded: false,
  modalOpen: false,
  title: '',
  updateTime: '',
  close: () => {
    set({ modalOpen: false })
  },
  dismiss: () => {
    set({ modalOpen: false })

    try {
      const state = get()
      setDesktopLocalStorageValue(NOTICE_DISMISSED_KEY, buildNoticeMetaFingerprint({
        title: state.title,
        banner: state.banner,
        updateTime: state.updateTime,
        autoDisplay: state.autoDisplay,
        enable: state.enable,
      }))
    } catch {
      // localStorage may be unavailable in private contexts.
    }
  },
  load: async () => {
    const noticeUrl = appConfig.NOTICE_URL
    if (!noticeUrl) {
      set({ loaded: true })
      return
    }

    try {
      const resolvedNoticeUrl = new URL(noticeUrl, window.location.href).toString()
      const response = await fetch(resolvedNoticeUrl, { cache: 'no-store' })
      if (!response.ok) throw new Error(`Failed to fetch notice: ${response.status}`)

      const raw = await response.text()
      const parsed = parseNoticeMarkdown(raw)
      const banner = parsed.banner ? new URL(parsed.banner, resolvedNoticeUrl).toString() : ''
      const nextState = { ...parsed, banner }

      set({
        ...nextState,
        loaded: true,
        modalOpen: parsed.enable ? get().modalOpen : false,
      })

      if (!parsed.enable) return

      const currentMeta = buildNoticeMetaFingerprint(nextState)
      const dismissedMeta = window.localStorage.getItem(NOTICE_DISMISSED_KEY)
      if (parsed.autoDisplay && dismissedMeta !== currentMeta) {
        set({ modalOpen: true })
      }
    } catch {
      set({
        enable: false,
        loaded: true,
        modalOpen: false,
      })
    }
  },
  open: () => {
    if (!get().enable) return
    set({ modalOpen: true })
  },
  setModalOpen: (open) => {
    if (!open) {
      get().dismiss()
      return
    }
    get().open()
  },
}))
