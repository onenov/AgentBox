import { create } from 'zustand'
import type { CCConnectEnvironmentResponse } from '@/api'
import { getCCConnectEnvironment } from '@/api'

export type CCConnectEnvironmentLoadState = 'idle' | 'loading' | 'ready' | 'error'

interface CCConnectEnvironmentStore {
  data: CCConnectEnvironmentResponse | null
  error: string
  lastLoadedAt: number | null
  state: CCConnectEnvironmentLoadState
  loadCCConnectEnvironment: (refresh?: boolean) => Promise<CCConnectEnvironmentResponse>
  resetCCConnectEnvironment: () => void
}

const inflightRequests = new Map<string, Promise<CCConnectEnvironmentResponse>>()

function requestKey(refresh: boolean) {
  return refresh ? 'refresh' : 'cache'
}

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : 'CC-Connect 运行环境加载失败'
}

export const useCCConnectEnvironmentStore = create<CCConnectEnvironmentStore>((set, get) => ({
  data: null,
  error: '',
  lastLoadedAt: null,
  state: 'idle',
  loadCCConnectEnvironment: async (refresh = false) => {
    const key = requestKey(refresh)
    const existing = inflightRequests.get(key)
    if (existing) return existing

    set({
      error: '',
      state: 'loading',
    })

    const request = getCCConnectEnvironment(refresh)
      .then((payload) => {
        set({
          data: payload,
          error: '',
          lastLoadedAt: Date.now(),
          state: 'ready',
        })
        return payload
      })
      .catch((err) => {
        const message = getErrorMessage(err)
        set({
          error: message,
          state: get().data ? 'ready' : 'error',
        })
        throw err
      })
      .finally(() => {
        inflightRequests.delete(key)
      })

    inflightRequests.set(key, request)
    return request
  },
  resetCCConnectEnvironment: () => {
    inflightRequests.clear()
    set({
      data: null,
      error: '',
      lastLoadedAt: null,
      state: 'idle',
    })
  },
}))
