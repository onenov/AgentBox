import type { AppConfig } from '@/types/app-config'
import { clearDesktopApiUrl, persistDesktopApiUrl } from '@/utils/desktopAuthPreferences'
interface ConfigState {
  config: AppConfig
  appName: string
  appLogo: string
  appDescription: string
  appKeywords: string
  appAuthor: string
  appCopyright: string
  homeRoute: string
  apiUrl: string
  modelCatalogUrl: string
  modelInitializationUrl: string
  modelIconBaseUrl: string
  resetApiUrl: () => void
  setApiUrl: (apiUrl: string, persistence?: ConfigPersistence) => void
  theme?: AppConfig['THEME']
  themeStyle?: AppConfig['THEME_STYLE']
  themeColor?: AppConfig['THEME_COLOR']
  themeGeneralRadius?: AppConfig['THEME_GENERAL_RADIUS']
  themeFormsRadius?: AppConfig['THEME_FORMS_RADIUS']
  themeFont?: AppConfig['THEME_FONT']
}

type ConfigPersistence = 'persistent' | 'session'

const API_URL_STORAGE_KEY = 'agent-box-api-url'

const getWindowConfig = () => window.APP_CONFIG

export const appConfig = getWindowConfig()

export const useConfigStore = create<ConfigState>(() => ({
  config: appConfig,
  appName: appConfig.APP_NAME,
  appLogo: appConfig.APP_LOGO,
  appDescription: appConfig.APP_DESCRIPTION,
  appKeywords: appConfig.APP_KEYWORDS,
  appAuthor: appConfig.APP_AUTHOR,
  appCopyright: appConfig.APP_COPYRIGHT,
  homeRoute: appConfig.HOME_ROUTE,
  theme: appConfig.THEME,
  themeStyle: appConfig.THEME_STYLE,
  themeColor: appConfig.THEME_COLOR,
  themeGeneralRadius: appConfig.THEME_GENERAL_RADIUS,
  themeFormsRadius: appConfig.THEME_FORMS_RADIUS,
  themeFont: appConfig.THEME_FONT,
  apiUrl: readApiUrlOverride() || resolveDefaultApiUrl(appConfig.API_URL),
  modelCatalogUrl: appConfig.MODEL_CATALOG_URL,
  modelInitializationUrl: appConfig.MODEL_INITIALIZATION_URL,
  modelIconBaseUrl: appConfig.MODEL_ICON_BASE_URL,
  resetApiUrl: () => {
    clearApiUrlOverride()
    clearDesktopApiUrl()
    useConfigStore.setState({ apiUrl: resolveDefaultApiUrl(appConfig.API_URL) })
  },
  setApiUrl: (apiUrl, persistence = 'persistent') => {
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) return
    writeApiUrlOverride(normalized, persistence)
    useConfigStore.setState({ apiUrl: normalized })
  },
}))

function resolveDefaultApiUrl(apiUrl: string) {
  const normalized = normalizeApiUrl(apiUrl)
  if (normalized) return normalized
  return typeof window !== 'undefined' ? window.location.origin : ''
}

function normalizeApiUrl(apiUrl: string) {
  return apiUrl.trim().replace(/\/+$/, '')
}

function readApiUrlOverride() {
  return normalizeApiUrl(
    getSafeLocalStorage()?.getItem(API_URL_STORAGE_KEY)
      || getSafeSessionStorage()?.getItem(API_URL_STORAGE_KEY)
      || '',
  )
}

function writeApiUrlOverride(apiUrl: string, persistence: ConfigPersistence) {
  const localStorage = getSafeLocalStorage()
  const sessionStorage = getSafeSessionStorage()

  if (persistence === 'persistent') {
    localStorage?.setItem(API_URL_STORAGE_KEY, apiUrl)
    sessionStorage?.removeItem(API_URL_STORAGE_KEY)
    persistDesktopApiUrl(apiUrl)
  } else {
    sessionStorage?.setItem(API_URL_STORAGE_KEY, apiUrl)
    localStorage?.removeItem(API_URL_STORAGE_KEY)
    clearDesktopApiUrl()
  }
}

function clearApiUrlOverride() {
  getSafeLocalStorage()?.removeItem(API_URL_STORAGE_KEY)
  getSafeSessionStorage()?.removeItem(API_URL_STORAGE_KEY)
}

function getSafeLocalStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

function getSafeSessionStorage() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}
