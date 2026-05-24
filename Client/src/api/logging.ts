import { apiRequest } from './client'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LoggingSettingsResponse = {
  status: string
  timestamp: string
  level: LogLevel
  logDir: string
  logFile: string
}

export type LoggingClearResponse = LoggingSettingsResponse & {
  message: string
}

export function getLoggingSettings() {
  return apiRequest<LoggingSettingsResponse>('/api/logging')
}

export function updateLoggingSettings(level: LogLevel) {
  return apiRequest<LoggingSettingsResponse>('/api/logging', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level }),
  })
}

export function clearBackendLogs() {
  return apiRequest<LoggingClearResponse>('/api/logging/clear', {
    method: 'POST',
  })
}
