import { create } from 'zustand'
import type { HermesEnvironmentResponse } from '@/api'
import { getHermesEnvironment } from '@/api'

export type HermesEnvironmentLoadState = 'idle' | 'loading' | 'ready' | 'error'

interface HermesEnvironmentStore {
  data: HermesEnvironmentResponse | null
  error: string
  lastLoadedAt: number | null
  state: HermesEnvironmentLoadState
  profile: string
  loadHermesEnvironment: (refresh?: boolean, profile?: string) => Promise<HermesEnvironmentResponse>
  resetHermesEnvironment: () => void
}

const inflightRequests = new Map<string, Promise<HermesEnvironmentResponse>>()

function normalizeProfile(profile?: string) {
  return profile?.trim() || ''
}

function requestKey(refresh: boolean, profile?: string) {
  return `${normalizeProfile(profile) || '__active__'}:${refresh ? 'refresh' : 'cache'}`
}

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : 'Hermes 运行环境加载失败'
}

export const useHermesEnvironmentStore = create<HermesEnvironmentStore>((set, get) => ({
  data: null,
  error: '',
  lastLoadedAt: null,
  profile: '',
  state: 'idle',
  loadHermesEnvironment: async (refresh = false, profile = '') => {
    const normalizedProfile = normalizeProfile(profile)
    const key = requestKey(refresh, normalizedProfile)
    const existing = inflightRequests.get(key)
    if (existing) return existing

    set({
      error: '',
      profile: normalizedProfile,
      state: 'loading',
    })

    const request = getHermesEnvironment(refresh, normalizedProfile)
      .then((payload) => {
        set({
          data: payload,
          error: '',
          lastLoadedAt: Date.now(),
          profile: normalizedProfile || payload.profile?.name || '',
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
  resetHermesEnvironment: () => {
    inflightRequests.clear()
    set({
      data: null,
      error: '',
      lastLoadedAt: null,
      profile: '',
      state: 'idle',
    })
  },
}))
