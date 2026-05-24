import { apiRequest } from './client'

export type EnvironmentResponse = {
  status: string
  timestamp: string
  os?: OSInfo
  user?: UserInfo
  cpu?: CPUInfo
  memory?: MemoryInfo
  load?: LoadInfo
  uptime?: UptimeInfo
  disks?: DiskInfo[]
  network?: NetworkInfo
  process?: ProcessInfo
  runtime?: RuntimeInfo
  tools?: ToolsInfo
}

export type OSInfo = {
  name: string
  arch: string
  platform?: string
  family?: string
  version?: string
  kernel?: string
  hostname?: string
  executable?: string
  workingDir?: string
}

export type UserInfo = {
  username?: string
  name?: string
  uid?: string
  gid?: string
  homeDir?: string
}

export type CPUInfo = {
  architecture: string
  logicalCores: number
  model?: string
}

export type MemoryInfo = {
  total: number
  available: number
  used: number
  usedPercent: number
  swapTotal?: number
  swapUsed?: number
}

export type LoadInfo = {
  load1: number
  load5: number
  load15: number
}

export type UptimeInfo = {
  systemSeconds: number
  backendSeconds: number
  backendStarted: string
}

export type DiskInfo = {
  device: string
  mountpoint: string
  filesystem: string
  total: number
  free: number
  used: number
  usedPercent: number
}

export type IPInfo = {
  interface: string
  address: string
  family: string
}

export type NetworkIOInfo = {
  name: string
  bytesSent: number
  bytesRecv: number
  bytesSentPerSecond?: number
  bytesRecvPerSecond?: number
  packetsSent?: number
  packetsRecv?: number
  errIn?: number
  errOut?: number
  dropIn?: number
  dropOut?: number
}

export type NetworkInfo = {
  ips?: IPInfo[]
  dns?: { servers?: string[] }
  io?: NetworkIOInfo[]
}

export type ProcessInfo = {
  pid: number
  ppid?: number
  name?: string
  status?: string
  rss: number
  cpuPercent: number
  goroutines: number
  threads?: number
  uptimeSeconds: number
}

export type RuntimeInfo = {
  goVersion: string
  compiler: string
  numCpu: number
  gomaxprocs: number
}

export type ToolInfo = {
  available: boolean
  path?: string
  version?: string
  globalPrefix?: string
  running?: boolean
  metadata?: Record<string, string>
  error?: string
}

export type ToolsInfo = {
  nodejs?: ToolInfo
  npm?: ToolInfo
  npx?: ToolInfo
  python?: ToolInfo
  uv?: ToolInfo
  git?: ToolInfo
  homebrew?: ToolInfo
  xcode?: ToolInfo
  docker?: ToolInfo
}

export type EnvironmentSection = 'cpu' | 'disks' | 'load' | 'memory' | 'network' | 'os' | 'process' | 'runtime' | 'tools' | 'uptime' | 'user'

export function getEnvironment(refresh = false, section?: EnvironmentSection) {
  return apiRequest<EnvironmentResponse>('/api/environment', {
    query: {
      refresh: refresh || undefined,
      section,
    },
  })
}
