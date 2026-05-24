import { create } from 'zustand'
import type { OpenClawEnvironmentResponse } from '@/api'
import { getOpenClawEnvironment } from '@/api'

export type OpenClawEnvironmentLoadState = 'idle' | 'loading' | 'ready' | 'error'

interface OpenClawEnvironmentStore {
  data: OpenClawEnvironmentResponse | null
  error: string
  lastLoadedAt: number | null
  state: OpenClawEnvironmentLoadState
  loadOpenClawEnvironment: (refresh?: boolean) => Promise<OpenClawEnvironmentResponse>
  resetOpenClawEnvironment: () => void
}

const inflightRequests = new Map<string, Promise<OpenClawEnvironmentResponse>>()

function requestKey(refresh: boolean) {
  return refresh ? 'refresh' : 'cache'
}

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : 'OpenClaw 运行环境加载失败'
}

export const useOpenClawEnvironmentStore = create<OpenClawEnvironmentStore>((set, get) => ({
  data: null,
  error: '',
  lastLoadedAt: null,
  state: 'idle',
  loadOpenClawEnvironment: async (refresh = false) => {
    const key = requestKey(refresh)
    const existing = inflightRequests.get(key)
    if (existing) return existing

    set({
      error: '',
      state: 'loading',
    })

    const request = getOpenClawEnvironment(refresh)
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
  resetOpenClawEnvironment: () => {
    inflightRequests.clear()
    set({
      data: null,
      error: '',
      lastLoadedAt: null,
      state: 'idle',
    })
  },
}))
