import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from '@/utils/tauri'
import { removeDesktopLocalStorageValue, setDesktopLocalStorageValue } from '@/utils/desktopStorage'
import { appConfig } from './config'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'
export type ThemeStyle = 'glass' | 'default'
export type ThemeFont = 'Raleway' | 'DM Sans' | 'Geist' | 'Inter' | 'Poppins' | 'Outfit'
export type ThemeColor =
  | 'lime'
  | 'green'
  | 'red'
  | 'orange'
  | 'pink'
  | 'emerald'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'purple'
  | 'neutral'

const THEME_STORAGE_KEY = 'agent-box-theme'
const THEME_STYLE_STORAGE_KEY = 'agent-box-theme-style'
const THEME_COLOR_STORAGE_KEY = 'agent-box-theme-color'
const THEME_GENERAL_RADIUS_STORAGE_KEY = 'agent-box-theme-general-radius'
const THEME_FORMS_RADIUS_STORAGE_KEY = 'agent-box-theme-forms-radius'
const THEME_FONT_STORAGE_KEY = 'agent-box-theme-font'
const DEFAULT_THEME_STYLE: ThemeStyle = 'glass'
const DEFAULT_THEME_COLOR: ThemeColor = 'blue'
const DEFAULT_THEME_GENERAL_RADIUS = 0.5
const DEFAULT_THEME_FORMS_RADIUS = 0.75
const DEFAULT_THEME_FONT: ThemeFont = 'Inter'
const mediaQuery = '(prefers-color-scheme: dark)'

interface ThemePreferenceSnapshot {
  theme: ThemeMode
  themeStyle: ThemeStyle
  themeColor: ThemeColor
  themeGeneralRadius: number
  themeFormsRadius: number
  themeFont: ThemeFont
}

const themeColors: ThemeColor[] = [
  'lime',
  'green',
  'red',
  'orange',
  'pink',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'neutral',
]

const colorPreviewMap: Record<ThemeColor, string> = {
  lime: '#84cc16',
  green: '#22c55e',
  red: '#ef4444',
  orange: '#f97316',
  pink: '#ec4899',
  emerald: '#10b981',
  teal: '#14b8a6',
  cyan: '#06b6d4',
  sky: '#0ea5e9',
  blue: '#3b82f6',
  indigo: '#6366f1',
  violet: '#8b5cf6',
  purple: '#a855f7',
  neutral: '#737373',
}

export const themeColorOptions = themeColors.map((value) => ({
  value,
  color: colorPreviewMap[value],
}))

export const themeFontOptions: Array<{
  label: ThemeFont
  value: string
}> = [
  { label: 'Raleway', value: "'Raleway', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif" },
  { label: 'DM Sans', value: "'DM Sans', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif" },
  { label: 'Geist', value: "'Geist', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif" },
  { label: 'Inter', value: "'Inter', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif" },
  { label: 'Poppins', value: "'Poppins', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif" },
  { label: 'Outfit', value: "'Outfit', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif" },
]

const normalizeThemeMode = (value: unknown): ThemeMode | null => {
  return value === 'light' || value === 'dark' || value === 'system' ? value : null
}

const normalizeThemeStyle = (value: unknown): ThemeStyle | null => {
  return value === 'glass' || value === 'default' ? value : null
}

const normalizeThemeColor = (value: unknown): ThemeColor | null => {
  return typeof value === 'string' && themeColors.includes(value as ThemeColor) ? value as ThemeColor : null
}

const normalizeThemeFont = (value: unknown): ThemeFont | null => {
  return typeof value === 'string' && themeFontOptions.some((option) => option.label === value) ? value as ThemeFont : null
}

const normalizeRadius = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null

  const radius = Number(value)

  return Number.isFinite(radius) ? Math.min(Math.max(radius, 0), 1) : null
}

const normalizeThemePreferenceSnapshot = (
  value: Partial<ThemePreferenceSnapshot> | null | undefined,
  fallback: ThemePreferenceSnapshot,
): ThemePreferenceSnapshot | null => {
  if (!value || typeof value !== 'object') return null

  return {
    theme: normalizeThemeMode(value.theme) ?? fallback.theme,
    themeStyle: normalizeThemeStyle(value.themeStyle) ?? fallback.themeStyle,
    themeColor: normalizeThemeColor(value.themeColor) ?? fallback.themeColor,
    themeGeneralRadius: normalizeRadius(value.themeGeneralRadius) ?? fallback.themeGeneralRadius,
    themeFormsRadius: normalizeRadius(value.themeFormsRadius) ?? fallback.themeFormsRadius,
    themeFont: normalizeThemeFont(value.themeFont) ?? fallback.themeFont,
  }
}

const getSystemTheme = (): ResolvedTheme => {
  if (typeof window === 'undefined') return 'light'

  return window.matchMedia(mediaQuery).matches ? 'dark' : 'light'
}

const getInitialTheme = (): ThemeMode => {
  if (typeof window === 'undefined') return 'system'

  const storedTheme = normalizeThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY))
  if (storedTheme) return storedTheme

  const configTheme = normalizeThemeMode(appConfig.THEME)
  if (configTheme) return configTheme

  return 'system'
}

const getInitialThemeStyle = (): ThemeStyle => {
  if (typeof window === 'undefined') return DEFAULT_THEME_STYLE

  const storedThemeStyle = normalizeThemeStyle(window.localStorage.getItem(THEME_STYLE_STORAGE_KEY))
  if (storedThemeStyle) return storedThemeStyle

  const configThemeStyle = normalizeThemeStyle(appConfig.THEME_STYLE)
  if (configThemeStyle) return configThemeStyle

  return DEFAULT_THEME_STYLE
}

const getInitialThemeColor = (): ThemeColor => {
  if (typeof window === 'undefined') return DEFAULT_THEME_COLOR

  const storedThemeColor = normalizeThemeColor(window.localStorage.getItem(THEME_COLOR_STORAGE_KEY))
  if (storedThemeColor) return storedThemeColor

  const configThemeColor = normalizeThemeColor(appConfig.THEME_COLOR)
  if (configThemeColor) return configThemeColor

  return DEFAULT_THEME_COLOR
}

const getInitialThemeGeneralRadius = () => {
  if (typeof window === 'undefined') return DEFAULT_THEME_GENERAL_RADIUS

  const storedThemeGeneralRadius = normalizeRadius(window.localStorage.getItem(THEME_GENERAL_RADIUS_STORAGE_KEY))
  if (storedThemeGeneralRadius !== null) return storedThemeGeneralRadius

  const configThemeGeneralRadius = normalizeRadius(appConfig.THEME_GENERAL_RADIUS)
  if (configThemeGeneralRadius !== null) return configThemeGeneralRadius

  return DEFAULT_THEME_GENERAL_RADIUS
}

const getInitialThemeFormsRadius = () => {
  if (typeof window === 'undefined') return DEFAULT_THEME_FORMS_RADIUS

  const storedThemeFormsRadius = normalizeRadius(window.localStorage.getItem(THEME_FORMS_RADIUS_STORAGE_KEY))
  if (storedThemeFormsRadius !== null) return storedThemeFormsRadius

  const configThemeFormsRadius = normalizeRadius(appConfig.THEME_FORMS_RADIUS)
  if (configThemeFormsRadius !== null) return configThemeFormsRadius

  return DEFAULT_THEME_FORMS_RADIUS
}

const getInitialThemeFont = (): ThemeFont => {
  if (typeof window === 'undefined') return DEFAULT_THEME_FONT

  const storedThemeFont = normalizeThemeFont(window.localStorage.getItem(THEME_FONT_STORAGE_KEY))
  if (storedThemeFont) return storedThemeFont

  const configThemeFont = normalizeThemeFont(appConfig.THEME_FONT)
  if (configThemeFont) return configThemeFont

  return DEFAULT_THEME_FONT
}

const getThemeFontValue = (themeFont: ThemeFont) => {
  return themeFontOptions.find((option) => option.label === themeFont)?.value ?? themeFontOptions[3].value
}

const resolveTheme = (theme: ThemeMode): ResolvedTheme => {
  return theme === 'system' ? getSystemTheme() : theme
}

const getDataTheme = (themeStyle: ThemeStyle, resolvedTheme: ResolvedTheme) => {
  if (themeStyle === 'glass') return `glass-${resolvedTheme}`

  return resolvedTheme === 'light' ? 'default' : 'dark'
}

const applyTheme = (
  theme: ThemeMode,
  themeStyle: ThemeStyle,
  themeColor: ThemeColor,
  themeGeneralRadius: number,
  themeFormsRadius: number,
  themeFont: ThemeFont,
) => {
  if (typeof document === 'undefined') return resolveTheme(theme)

  const resolvedTheme = resolveTheme(theme)
  const root = document.documentElement
  const dataTheme = getDataTheme(themeStyle, resolvedTheme)

  root.dataset.theme = dataTheme
  root.dataset.themeMode = theme
  root.dataset.themeStyle = themeStyle
  root.dataset.themeColor = themeColor
  root.dataset.themeFont = themeFont

  root.classList.toggle('light', themeStyle === 'default' && resolvedTheme === 'light')
  root.classList.toggle('default', themeStyle === 'default' && resolvedTheme === 'light')
  root.classList.toggle('dark', resolvedTheme === 'dark')
  root.classList.toggle('glass-light', themeStyle === 'glass' && resolvedTheme === 'light')
  root.classList.toggle('glass-dark', themeStyle === 'glass' && resolvedTheme === 'dark')
  root.style.colorScheme = resolvedTheme
  root.style.setProperty('--radius', `${themeGeneralRadius}rem`)
  root.style.setProperty('--field-radius', `${themeFormsRadius}rem`)
  root.style.setProperty('--font-sans', getThemeFontValue(themeFont))

  return resolvedTheme
}

interface ThemeState {
  theme: ThemeMode
  themeStyle: ThemeStyle
  themeColor: ThemeColor
  themeGeneralRadius: number
  themeFormsRadius: number
  themeFont: ThemeFont
  resolvedTheme: ResolvedTheme
  isDark: boolean
  setTheme: (theme: ThemeMode) => void
  setThemeStyle: (themeStyle: ThemeStyle) => void
  setThemeColor: (themeColor: ThemeColor) => void
  setThemeGeneralRadius: (themeGeneralRadius: number) => void
  setThemeFormsRadius: (themeFormsRadius: number) => void
  setThemeFont: (themeFont: ThemeFont) => void
  resetThemeStyle: () => void
  syncSystemTheme: () => void
  syncTheme: () => void
}

const persistThemePreference = (state: ThemePreferenceSnapshot) => {
  if (typeof window === 'undefined') return

  setDesktopLocalStorageValue(THEME_STORAGE_KEY, state.theme)
  setDesktopLocalStorageValue(THEME_STYLE_STORAGE_KEY, state.themeStyle)
  setDesktopLocalStorageValue(THEME_COLOR_STORAGE_KEY, state.themeColor)
  setDesktopLocalStorageValue(THEME_GENERAL_RADIUS_STORAGE_KEY, `${state.themeGeneralRadius}`)
  setDesktopLocalStorageValue(THEME_FORMS_RADIUS_STORAGE_KEY, `${state.themeFormsRadius}`)
  setDesktopLocalStorageValue(THEME_FONT_STORAGE_KEY, state.themeFont)
}

let desktopThemePreferenceHydrated = !isTauriRuntime()
let pendingDesktopThemePreference: ThemePreferenceSnapshot | null = null
let desktopThemePreferenceWriteTimer: number | null = null

const persistDesktopThemePreference = (state: ThemePreferenceSnapshot) => {
  if (!isTauriRuntime() || typeof window === 'undefined') return

  pendingDesktopThemePreference = { ...state }
  if (!desktopThemePreferenceHydrated) return

  if (desktopThemePreferenceWriteTimer !== null) {
    window.clearTimeout(desktopThemePreferenceWriteTimer)
  }

  desktopThemePreferenceWriteTimer = window.setTimeout(() => {
    const preferences = pendingDesktopThemePreference
    pendingDesktopThemePreference = null
    desktopThemePreferenceWriteTimer = null
    if (!preferences) return

    invoke('set_theme_preferences', { preferences }).catch((error) => {
      console.warn('[theme] Failed to save Tauri theme preferences', error)
    })
  }, 120)
}

export async function hydrateDesktopThemePreference() {
  if (!isTauriRuntime() || desktopThemePreferenceHydrated) return

  try {
    const preferences = await invoke<Partial<ThemePreferenceSnapshot> | null>('get_theme_preferences')
    const state = useThemeStore.getState()
    const nextThemeSnapshot = normalizeThemePreferenceSnapshot(preferences, {
      theme: state.theme,
      themeColor: state.themeColor,
      themeFormsRadius: state.themeFormsRadius,
      themeFont: state.themeFont,
      themeGeneralRadius: state.themeGeneralRadius,
      themeStyle: state.themeStyle,
    })

    if (nextThemeSnapshot) {
      useThemeStore.setState(nextThemeSnapshot)
    }
  } catch (error) {
    console.warn('[theme] Failed to read Tauri theme preferences', error)
  } finally {
    desktopThemePreferenceHydrated = true
    if (pendingDesktopThemePreference) {
      persistDesktopThemePreference(pendingDesktopThemePreference)
    }
  }
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initialTheme = getInitialTheme()
  const initialThemeStyle = getInitialThemeStyle()
  const initialThemeColor = getInitialThemeColor()
  const initialThemeGeneralRadius = getInitialThemeGeneralRadius()
  const initialThemeFormsRadius = getInitialThemeFormsRadius()
  const initialThemeFont = getInitialThemeFont()
  const initialResolvedTheme = applyTheme(
    initialTheme,
    initialThemeStyle,
    initialThemeColor,
    initialThemeGeneralRadius,
    initialThemeFormsRadius,
    initialThemeFont,
  )

  if (typeof window !== 'undefined') {
    window.matchMedia(mediaQuery).addEventListener('change', () => {
      get().syncSystemTheme()
    })
  }

  return {
    theme: initialTheme,
    themeStyle: initialThemeStyle,
    themeColor: initialThemeColor,
    themeGeneralRadius: initialThemeGeneralRadius,
    themeFormsRadius: initialThemeFormsRadius,
    themeFont: initialThemeFont,
    resolvedTheme: initialResolvedTheme,
    isDark: initialResolvedTheme === 'dark',
    setTheme: (theme) => {
      set({ theme })
    },
    setThemeStyle: (themeStyle) => {
      set({ themeStyle })
    },
    setThemeColor: (themeColor) => {
      set({ themeColor })
    },
    setThemeGeneralRadius: (themeGeneralRadius) => {
      const nextThemeGeneralRadius = normalizeRadius(themeGeneralRadius) ?? DEFAULT_THEME_GENERAL_RADIUS
      set({ themeGeneralRadius: nextThemeGeneralRadius })
    },
    setThemeFormsRadius: (themeFormsRadius) => {
      const nextThemeFormsRadius = normalizeRadius(themeFormsRadius) ?? DEFAULT_THEME_FORMS_RADIUS
      set({ themeFormsRadius: nextThemeFormsRadius })
    },
    setThemeFont: (themeFont) => {
      const nextThemeFont = normalizeThemeFont(themeFont) ?? DEFAULT_THEME_FONT
      set({ themeFont: nextThemeFont })
    },
    resetThemeStyle: () => {
      removeDesktopLocalStorageValue(THEME_STYLE_STORAGE_KEY)
      removeDesktopLocalStorageValue(THEME_COLOR_STORAGE_KEY)
      removeDesktopLocalStorageValue(THEME_GENERAL_RADIUS_STORAGE_KEY)
      removeDesktopLocalStorageValue(THEME_FORMS_RADIUS_STORAGE_KEY)
      removeDesktopLocalStorageValue(THEME_FONT_STORAGE_KEY)
      set({
        themeStyle: getInitialThemeStyle(),
        themeColor: getInitialThemeColor(),
        themeGeneralRadius: getInitialThemeGeneralRadius(),
        themeFormsRadius: getInitialThemeFormsRadius(),
        themeFont: getInitialThemeFont(),
      })
    },
    syncSystemTheme: () => {
      const { theme, themeStyle, themeColor, themeGeneralRadius, themeFormsRadius, themeFont } = get()
      if (theme !== 'system') return

      const resolvedTheme = applyTheme(theme, themeStyle, themeColor, themeGeneralRadius, themeFormsRadius, themeFont)
      set({ resolvedTheme, isDark: resolvedTheme === 'dark' })
    },
    syncTheme: () => {
      const { theme, themeStyle, themeColor, themeGeneralRadius, themeFormsRadius, themeFont } = get()
      const resolvedTheme = applyTheme(theme, themeStyle, themeColor, themeGeneralRadius, themeFormsRadius, themeFont)
      const nextThemeSnapshot = { theme, themeColor, themeFont, themeFormsRadius, themeGeneralRadius, themeStyle }
      persistThemePreference(nextThemeSnapshot)
      persistDesktopThemePreference(nextThemeSnapshot)
      set({ resolvedTheme, isDark: resolvedTheme === 'dark' })
    },
  }
})

let previousThemeSnapshot = {
  theme: useThemeStore.getState().theme,
  themeColor: useThemeStore.getState().themeColor,
  themeFont: useThemeStore.getState().themeFont,
  themeFormsRadius: useThemeStore.getState().themeFormsRadius,
  themeGeneralRadius: useThemeStore.getState().themeGeneralRadius,
  themeStyle: useThemeStore.getState().themeStyle,
}

if (typeof window !== 'undefined') {
  useThemeStore.subscribe((state) => {
    const nextThemeSnapshot = {
      theme: state.theme,
      themeColor: state.themeColor,
      themeFont: state.themeFont,
      themeFormsRadius: state.themeFormsRadius,
      themeGeneralRadius: state.themeGeneralRadius,
      themeStyle: state.themeStyle,
    }
    const unchanged = Object.entries(nextThemeSnapshot).every(([key, value]) => previousThemeSnapshot[key as keyof typeof previousThemeSnapshot] === value)
    if (unchanged) return

    previousThemeSnapshot = nextThemeSnapshot
    const resolvedTheme = applyTheme(state.theme, state.themeStyle, state.themeColor, state.themeGeneralRadius, state.themeFormsRadius, state.themeFont)
    persistThemePreference(nextThemeSnapshot)
    persistDesktopThemePreference(nextThemeSnapshot)
    useThemeStore.setState({ resolvedTheme, isDark: resolvedTheme === 'dark' })
  })
}
