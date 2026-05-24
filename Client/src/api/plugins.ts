import { apiRequest, buildAPIURL } from './client'

export type PluginAppStatus = {
  id: string
  name: string
  tagline: string
  description: string
  homepage?: string
  logoUrl?: string
  installCommand: string
  installed: boolean
  cliPath?: string
  version?: string
  status: 'installed' | 'missing' | string
  canInstall: boolean
  canUpdate: boolean
  canUninstall: boolean
  updateAvailable?: boolean
  searchExamples?: string[]
  error?: string
}

export type PluginsStatusResponse = {
  status: string
  timestamp: string
  cache: {
    refresh: boolean
  }
  plugins: PluginAppStatus[]
  summary: {
    total: number
    installed: number
    missing: number
  }
}

export type PluginUpdateStatus = {
  id: string
  canUpdate: boolean
  updateAvailable: boolean
  error?: string
}

export type PluginsUpdatesResponse = {
  status: string
  timestamp: string
  cache: {
    refresh: boolean
  }
  updates: PluginUpdateStatus[]
}

export type PluginActionResponse = {
  status: string
  timestamp: string
  id: string
  action: 'install' | 'update' | 'uninstall' | string
  command: string
  stdout?: string
  stderr?: string
  app: PluginAppStatus
}

export type PluginActionStreamMeta = {
  id: string
  pluginId: string
  action: PluginActionResponse['action']
  timestamp: string
}

export type PluginActionStreamStatus = {
  id: string
  pluginId: string
  action: PluginActionResponse['action']
  status: 'pending' | 'running' | 'done' | 'error' | string
  progress: number
  error?: string
  timestamp: string
}

export type PluginActionStreamLog = {
  id: string
  pluginId: string
  line: string
  timestamp: string
}

export type PluginActionStreamError = {
  id: string
  pluginId: string
  message: string
  timestamp: string
}

export type PluginActionStreamDone = {
  id: string
  pluginId: string
  action: PluginActionResponse['action']
  app: PluginAppStatus
  timestamp: string
}

export function listPlugins(refresh = false) {
  return apiRequest<PluginsStatusResponse>('/api/plugins/status', {
    query: { refresh },
  })
}

export function listPluginUpdates(refresh = false) {
  return apiRequest<PluginsUpdatesResponse>('/api/plugins/updates', {
    query: { refresh },
  })
}

export function installPlugin(id: string) {
  return apiRequest<PluginActionResponse>(`/api/plugins/${encodeURIComponent(id)}/install`, {
    method: 'POST',
  })
}

export function getPluginInstallStreamURL(id: string) {
  return buildAPIURL(`/api/plugins/${encodeURIComponent(id)}/install/stream`)
}

export function updatePlugin(id: string) {
  return apiRequest<PluginActionResponse>(`/api/plugins/${encodeURIComponent(id)}/update`, {
    method: 'POST',
  })
}

export function uninstallPlugin(id: string) {
  return apiRequest<PluginActionResponse>(`/api/plugins/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
