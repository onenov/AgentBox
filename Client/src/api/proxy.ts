import { apiRequest } from './client'

export type ProxyMode = 'off' | 'builtin' | 'custom'

export type ProxySettings = {
  mode: ProxyMode
  httpProxy?: string
  httpsProxy?: string
  allProxy?: string
  noProxy?: string
  updatedAt?: string
}

export type ProxyEffectiveSettings = {
  mode: ProxyMode
  httpProxy?: string
  httpsProxy?: string
  allProxy?: string
  noProxy?: string
  enabled: boolean
}

export type ProxySettingsResponse = {
  status: string
  timestamp: string
  settings: ProxySettings
  effective: ProxyEffectiveSettings
}

export type ProxyCheckTarget = {
  name: string
  url: string
  status: string
  statusCode?: number
  latencyMs: number
  error?: string
}

export type ProxyCheckResponse = {
  status: string
  timestamp: string
  mode: ProxyMode
  ok: boolean
  exitIP?: string
  targets: ProxyCheckTarget[]
  error?: string
}

export function getProxySettings() {
  return apiRequest<ProxySettingsResponse>('/api/proxy-settings')
}

export function updateProxySettings(settings: ProxySettings) {
  return apiRequest<ProxySettingsResponse>('/api/proxy-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
}

export function checkProxySettings(settings: ProxySettings) {
  return apiRequest<ProxyCheckResponse>('/api/proxy-settings/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
}
