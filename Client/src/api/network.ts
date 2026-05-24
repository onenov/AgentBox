import { useConfigStore } from '@/stores/config'
import { apiRequest } from './client'

export type NetworkCheckResponse = {
  status: string
  timestamp: string
  cache?: {
    refresh: boolean
  }
  targets: NetworkCheckItem[]
}

export type NetworkCheckItem = {
  name: string
  url: string
  status: string
  statusCode?: number
  latencyMs: number
  error?: string
}

export type BrowserLatencyResult = {
  name: string
  status: string
  latencyMs: number
  error?: string
}

export function getNetworkCheck(refresh = false) {
  return apiRequest<NetworkCheckResponse>('/api/network-check', {
    query: refresh ? { refresh: true } : undefined,
  })
}

export async function checkBrowserAPIHealthLatency(): Promise<BrowserLatencyResult> {
  try {
    const samples: number[] = []
    let lastStatus = 0

    for (let index = 0; index < 4; index += 1) {
      const url = buildHealthURL(index)
      const startedAt = performance.now()
      const response = await fetch(url, {
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
      })
      lastStatus = response.status
      const latencyMs = performance.now() - startedAt

      if (!response.ok) {
        return {
          name: 'API',
          status: 'error',
          latencyMs: Math.round(latencyMs),
          error: `HTTP ${response.status}`,
        }
      }

      if (index > 0) {
        samples.push(latencyMs)
      }
    }

    return {
      name: 'API',
      status: 'ok',
      latencyMs: Math.round(Math.min(...samples)),
      error: lastStatus ? undefined : '无响应状态',
    }
  } catch (error) {
    return {
      name: 'API',
      status: 'error',
      latencyMs: 0,
      error: error instanceof Error ? error.message : '请求失败',
    }
  }
}

function buildHealthURL(sampleIndex: number) {
  const baseURL = useConfigStore.getState().apiUrl.replace(/\/$/, '')
  const url = new URL(`${baseURL}/api/health`)
  url.searchParams.set('t', `${Date.now()}-${sampleIndex}`)
  return url.toString()
}
