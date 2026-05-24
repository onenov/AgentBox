import { apiRequest } from './client'

export type MaintenanceSQLiteClearResponse = {
  status: string
  timestamp: string
  tables: Array<{
    name: string
    deletedRows: number
  }>
  deletedRows: number
  message: string
  skippedTables?: string[]
}

export function clearBackendSQLiteData() {
  return apiRequest<MaintenanceSQLiteClearResponse>('/api/maintenance/sqlite/clear', {
    method: 'POST',
  })
}
