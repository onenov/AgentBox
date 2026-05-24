import { create } from 'zustand'
import type { HermesAgentInfo, HermesAgentsResponse } from '@/api'
import { listHermesAgents, useHermesAgent as setHermesActiveAgent } from '@/api'

type HermesAgentStoreState = 'idle' | 'loading' | 'ready' | 'error'

type HermesAgentStore = {
  data: HermesAgentsResponse | null
  error: string
  selectedName: string
  state: HermesAgentStoreState
  activeProfile: HermesAgentInfo | null
  profiles: HermesAgentInfo[]
  selectedProfile: HermesAgentInfo | null
  loadAgents: (refresh?: boolean) => Promise<HermesAgentsResponse>
  refreshAgents: () => Promise<HermesAgentsResponse>
  selectAgent: (name: string) => void
  setActiveAgent: (name: string) => Promise<void>
}

let inflightRequest: Promise<HermesAgentsResponse> | null = null

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : 'Hermes Agents 加载失败'
}

function normalizeAgentName(name: string) {
  const trimmed = name.trim()
  return trimmed.toLowerCase() === 'default' ? 'default' : trimmed
}

function findProfile(profiles: HermesAgentInfo[], name: string) {
  const normalized = normalizeAgentName(name)
  if (!normalized) return null
  return profiles.find((profile) => profile.name === normalized)
    ?? profiles.find((profile) => profile.displayName?.toLowerCase() === normalized.toLowerCase())
    ?? (normalized === 'default' ? profiles.find((profile) => profile.isDefault) : undefined)
    ?? null
}

function chooseSelectedProfile(profiles: HermesAgentInfo[], current: string) {
  const selected = findProfile(profiles, current)
  if (selected) return selected.name
  return profiles.find((profile) => profile.isActive)?.name || profiles.find((profile) => profile.isDefault)?.name || profiles[0]?.name || ''
}

export const useHermesAgentStore = create<HermesAgentStore>((set, get) => ({
  activeProfile: null,
  data: null,
  error: '',
  profiles: [],
  selectedName: '',
  selectedProfile: null,
  state: 'idle',
  loadAgents: async (refresh = false) => {
    if (inflightRequest && !refresh) return inflightRequest

    set({ error: '', state: 'loading' })
    inflightRequest = listHermesAgents()
      .then((payload) => {
        const selectedName = chooseSelectedProfile(payload.profiles ?? [], get().selectedName)
        const activeProfile = payload.profiles.find((profile) => profile.isActive) ?? null
        const selectedProfile = payload.profiles.find((profile) => profile.name === selectedName) ?? null
        set({
          activeProfile,
          data: payload,
          error: '',
          profiles: payload.profiles ?? [],
          selectedName,
          selectedProfile,
          state: 'ready',
        })
        return payload
      })
      .catch((err) => {
        set({
          error: getErrorMessage(err),
          state: get().data ? 'ready' : 'error',
        })
        throw err
      })
      .finally(() => {
        inflightRequest = null
      })

    return inflightRequest
  },
  refreshAgents: async () => get().loadAgents(true),
  selectAgent: (name: string) => {
    const normalized = normalizeAgentName(name)
    const selectedProfile = findProfile(get().profiles, normalized)
    set({
      selectedName: selectedProfile?.name ?? normalized,
      selectedProfile,
    })
  },
  setActiveAgent: async (name: string) => {
    await setHermesActiveAgent(name)
    const payload = await get().loadAgents(true)
    const selectedName = chooseSelectedProfile(payload.profiles ?? [], name)
    const selectedProfile = payload.profiles.find((profile) => profile.name === selectedName) ?? null
    set({ selectedName, selectedProfile })
  },
}))
