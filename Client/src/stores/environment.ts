import { create } from 'zustand'
import type { EnvironmentResponse, EnvironmentSection } from '@/api'
import { getEnvironment } from '@/api'

export type EnvironmentLoadState = 'idle' | 'loading' | 'ready' | 'error'

interface EnvironmentStore {
  data: EnvironmentResponse | null
  error: string
  lastLoadedAt: number | null
  refreshingSections: EnvironmentSection[]
  state: EnvironmentLoadState
  loadEnvironment: (refresh?: boolean, section?: EnvironmentSection) => Promise<EnvironmentResponse>
  resetEnvironment: () => void
}

const inflightRequests = new Map<string, Promise<EnvironmentResponse>>()

function requestKey(refresh: boolean, section?: EnvironmentSection) {
  return `${refresh ? 'refresh' : 'cache'}:${section ?? 'all'}`
}

function mergeEnvironmentData(
  current: EnvironmentResponse | null,
  payload: EnvironmentResponse,
  section?: EnvironmentSection,
) {
  if (!section || !current) return payload

  return {
    ...current,
    status: payload.status || current.status,
    timestamp: payload.timestamp || current.timestamp,
    [section]: payload[section] ?? current[section],
  }
}

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : '系统环境加载失败'
}

export const useEnvironmentStore = create<EnvironmentStore>((set, get) => ({
  data: null,
  error: '',
  lastLoadedAt: null,
  refreshingSections: [],
  state: 'idle',
  loadEnvironment: async (refresh = false, section) => {
    const key = requestKey(refresh, section)
    const existing = inflightRequests.get(key)
    if (existing) return existing

    const hasData = Boolean(get().data)
    set((current) => ({
      error: '',
      refreshingSections: section
        ? Array.from(new Set([...current.refreshingSections, section]))
        : current.refreshingSections,
      state: section && hasData ? current.state : 'loading',
    }))

    const request = getEnvironment(refresh, section)
      .then((payload) => {
        set((current) => ({
          data: mergeEnvironmentData(current.data, payload, section),
          error: '',
          lastLoadedAt: Date.now(),
          refreshingSections: section
            ? current.refreshingSections.filter((item) => item !== section)
            : current.refreshingSections,
          state: 'ready',
        }))
        return payload
      })
      .catch((err) => {
        const message = getErrorMessage(err)
        set((current) => ({
          error: message,
          refreshingSections: section
            ? current.refreshingSections.filter((item) => item !== section)
            : current.refreshingSections,
          state: current.data ? 'ready' : 'error',
        }))
        throw err
      })
      .finally(() => {
        inflightRequests.delete(key)
      })

    inflightRequests.set(key, request)
    return request
  },
  resetEnvironment: () => {
    inflightRequests.clear()
    set({
      data: null,
      error: '',
      lastLoadedAt: null,
      refreshingSections: [],
      state: 'idle',
    })
  },
}))
