import { useConfigStore } from '@/stores/config'
import { clearDesktopAuthToken, persistDesktopAuthToken } from '@/utils/desktopAuthPreferences'

interface RequestOptions extends RequestInit {
  authToken?: string | null
  baseURL?: string
  query?: Record<string, boolean | number | string | undefined>
  skipAuthRedirect?: boolean
}

export type ApiQuery = RequestOptions['query']

const AUTH_TOKEN_STORAGE_KEY = 'agent-box-auth-token'

export type AuthTokenPersistence = 'persistent' | 'session'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { authToken, baseURL = useConfigStore.getState().apiUrl, query, headers, skipAuthRedirect, ...requestOptions } = options
  const url = buildApiURL(baseURL, path, query)
  const requestHeaders = buildRequestHeaders(headers, authToken)
  const response = await fetch(url, {
    ...requestOptions,
    headers: requestHeaders,
  })

  if (!response.ok) {
    if (response.status === 401 && !skipAuthRedirect) {
      redirectToLogin()
    }
    throw new ApiError(await parseApiErrorMessage(response), response.status)
  }

  return await response.json() as T
}

export function getAuthToken() {
  return readAuthToken()
}

export function getAuthTokenPersistence(): AuthTokenPersistence {
  return getSafeLocalStorage()?.getItem(AUTH_TOKEN_STORAGE_KEY)?.trim() ? 'persistent' : 'session'
}

export function setAuthToken(token: string, persistence: AuthTokenPersistence = 'persistent') {
  const localStorage = getSafeLocalStorage()
  const sessionStorage = getSafeSessionStorage()
  const normalized = token.trim()
  if (normalized) {
    if (persistence === 'persistent') {
      localStorage?.setItem(AUTH_TOKEN_STORAGE_KEY, normalized)
      sessionStorage?.removeItem(AUTH_TOKEN_STORAGE_KEY)
      persistDesktopAuthToken(normalized)
    } else {
      sessionStorage?.setItem(AUTH_TOKEN_STORAGE_KEY, normalized)
      localStorage?.removeItem(AUTH_TOKEN_STORAGE_KEY)
      clearDesktopAuthToken()
    }
  } else {
    localStorage?.removeItem(AUTH_TOKEN_STORAGE_KEY)
    sessionStorage?.removeItem(AUTH_TOKEN_STORAGE_KEY)
    clearDesktopAuthToken()
  }
}

export function clearAuthToken() {
  getSafeLocalStorage()?.removeItem(AUTH_TOKEN_STORAGE_KEY)
  getSafeSessionStorage()?.removeItem(AUTH_TOKEN_STORAGE_KEY)
  clearDesktopAuthToken()
}

function buildRequestHeaders(headers?: HeadersInit, authToken?: string | null) {
  const requestHeaders = new Headers(headers)
  if (!requestHeaders.has('Accept')) {
    requestHeaders.set('Accept', 'application/json')
  }

  const token = authToken === undefined ? readAuthToken() : authToken?.trim() || ''
  if (token && !requestHeaders.has('Authorization')) {
    requestHeaders.set('Authorization', `Bearer ${token}`)
  }

  return requestHeaders
}

function readAuthToken() {
  return getSafeLocalStorage()?.getItem(AUTH_TOKEN_STORAGE_KEY)?.trim()
    || getSafeSessionStorage()?.getItem(AUTH_TOKEN_STORAGE_KEY)?.trim()
    || ''
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

function redirectToLogin() {
  if (typeof window === 'undefined') return
  if (window.location.pathname === '/login') return

  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
  const loginURL = new URL('/login', window.location.origin)
  if (current && current !== '/') {
    loginURL.searchParams.set('redirect', current)
  }
  window.location.assign(loginURL.toString())
}

async function parseApiErrorMessage(response: Response) {
  const fallback = `请求失败：${response.status}`
  const contentType = response.headers.get('content-type') || ''

  try {
    if (contentType.includes('application/json')) {
      const payload = await response.json() as {
        detail?: unknown
        title?: unknown
        errors?: Array<{ message?: unknown }>
      }
      const messages = payload.errors
        ?.map((error) => typeof error.message === 'string' ? error.message.trim() : '')
        .filter(Boolean)
      if (messages?.length) return messages.join('\n')
      if (typeof payload.detail === 'string' && payload.detail.trim()) return payload.detail.trim()
      if (typeof payload.title === 'string' && payload.title.trim()) return payload.title.trim()
      return fallback
    }

    const text = (await response.text()).trim()
    return text || fallback
  } catch {
    return fallback
  }
}

function buildApiURL(baseURL: string, path: string, query?: RequestOptions['query'], includeAuthToken = false) {
  const normalizedBase = baseURL.replace(/\/$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const url = new URL(`${normalizedBase}${normalizedPath}`)

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value))
      }
    }
  }

  const token = includeAuthToken ? readAuthToken() : ''
  if (token && !url.searchParams.has('token') && !url.searchParams.has('authToken')) {
    url.searchParams.set('authToken', token)
  }

  return url.toString()
}

export function buildAPIURL(path: string, query?: ApiQuery) {
  return buildApiURL(useConfigStore.getState().apiUrl, path, query, true)
}
