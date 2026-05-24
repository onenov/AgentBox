import { apiRequest } from './client'

const ANEX_CREDENTIAL_PATTERN = /^anex:(.+)-([a-z]{2})$/i

export type AccessCredentialTarget = 'all' | 'cc' | 'hermes' | 'openclaw'

export type AccessCredential = {
  backendAddress?: string
  suffix?: string
  target?: AccessCredentialTarget
  token: string
  version?: 'a'
}

export type BackendAuthConfigResponse = {
  backendAddress: string
  path: string
  status: string
  timestamp: string
  tokenConfigured: boolean
}

export function updateBackendAuthToken(token: string) {
  return apiRequest<BackendAuthConfigResponse>('/api/auth/config', {
    body: JSON.stringify({ token }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'PATCH',
  })
}

export function verifyBackendAuthToken(token?: string, backendAddress?: string) {
  return apiRequest<BackendAuthConfigResponse>('/api/auth/config', {
    authToken: token,
    baseURL: backendAddress,
    skipAuthRedirect: true,
  })
}

export function parseAccessCredential(value: string): AccessCredential {
  const credential = value.trim()
  const match = credential.match(ANEX_CREDENTIAL_PATTERN)
  if (!match) {
    return { token: credential }
  }

  const [, payload, suffix] = match
  const normalizedSuffix = suffix.toLowerCase()
  const version = normalizedSuffix.slice(0, 1)
  if (version !== 'a') {
    throw new Error(`暂不支持 -${suffix} 版本的访问凭证`)
  }
  const target = parseAccessCredentialTarget(normalizedSuffix.slice(1))

  const decoded = decodeBase64Url(payload)
  const separatorIndex = decoded.indexOf('\n')
  if (separatorIndex < 0) {
    throw new Error('访问凭证内容不完整')
  }

  const backendAddress = normalizeBackendAddress(decoded.slice(0, separatorIndex))
  const token = decoded.slice(separatorIndex + 1).trim()
  return { backendAddress, suffix: normalizedSuffix, target, token, version: 'a' }
}

function parseAccessCredentialTarget(value: string): AccessCredentialTarget | undefined {
  switch (value) {
    case 'a':
      return 'all'
    case 'o':
      return 'openclaw'
    case 'h':
      return 'hermes'
    case 'c':
      return 'cc'
    default:
      throw new Error(`暂不支持 -a${value} 类型的访问凭证`)
  }
}

function normalizeBackendAddress(value: string) {
  const backendAddress = value.trim().replace(/\/+$/, '')
  if (!backendAddress) {
    throw new Error('访问凭证缺少后端地址')
  }

  let url: URL
  try {
    url = new URL(backendAddress)
  } catch {
    throw new Error('访问凭证中的后端地址无效')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('后端地址仅支持 http 或 https')
  }

  return url.toString().replace(/\/+$/, '')
}

function decodeBase64Url(value: string) {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
    const binary = window.atob(base64)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    throw new Error('访问凭证编码无效')
  }
}
