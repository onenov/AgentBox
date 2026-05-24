import type { Selection } from '@heroui/react'
import { useEffect, useMemo, useRef, useState, type SVGProps } from 'react'
import { Button, Card, Chip, Dropdown, Label, Modal, SearchField, Table, toast } from '@heroui/react'
import { Segment } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type {
  HermesLogStreamError,
  HermesLogStreamLine,
  HermesLogStreamMeta,
} from '@/api'
import { getHermesLogStreamURL } from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { useHermesAgentStore } from '@/stores/hermes-agent'

type HermesLogKind = 'gateway' | 'gateway-run' | 'gateway-exit' | 'errors' | 'agent'

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

type HermesLogRow = HermesLogStreamLine & {
  id: string
}

type HermesLogTab = {
  key: HermesLogKind
  label: string
  file: string
  description: string
}

const hermesLogTabs: HermesLogTab[] = [
  { key: 'gateway', label: 'Gateway', file: 'gateway.log', description: 'Gateway 主日志' },
  { key: 'gateway-run', label: '运行输出', file: 'gateway-run.log', description: 'Gateway 启动输出' },
  { key: 'gateway-exit', label: '退出诊断', file: 'gateway-exit-diag.log', description: 'Gateway 启停诊断' },
  { key: 'errors', label: '错误日志', file: 'errors.log', description: 'Hermes 错误与警告' },
  { key: 'agent', label: 'Agent', file: 'agent.log', description: 'Agent 运行日志' },
]

const levelOptions: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
const maxLogRows = 2000

const logsGridStroke = 'rgba(247, 247, 247, 1)'

function HermesLogsHeroIllustration(props: Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'xmlns'>) {
  const { className, ...rest } = props
  const accentRing = 'color-mix(in oklch, var(--accent) 62%, white)'
  const accentSoft = 'color-mix(in oklch, var(--accent) 36%, white)'
  const accentBright = 'color-mix(in oklch, var(--accent), white 26%)'
  const phoneGradId = 'hermesLogsHeroPhone'

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="130 0 320 281"
      fill="none"
      className={className}
      aria-hidden
      {...rest}
    >
      <defs>
        <linearGradient id={phoneGradId} x1="381" y1="141" x2="381" y2="281" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor={accentBright} />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="20" stroke={accentRing} strokeWidth={2} transform="matrix(-1 0 0 1 421 101)" />
      <circle cx="20" cy="20" r="20" stroke={accentRing} strokeWidth={2} transform="matrix(-1 0 0 1 421 61)" />
      <path stroke={logsGridStroke} strokeWidth={2} d="M141 81H440" />
      <path stroke={logsGridStroke} strokeWidth={2} d="M141 121H440" />
      <path stroke={logsGridStroke} strokeWidth={2} d="M401 210V0.754395" />
      <circle cx="5" cy="5" r="5" fill="#FFFFFF" transform="matrix(-1 0 0 1 406 116)" />
      <circle cx="5" cy="5" r="5" fill="#FFFFFF" transform="matrix(-1 0 0 1 406 76)" />
      <rect x="181" y="41" width="200" height="240" fill="#EBECEC" />
      <rect x="201" y="61" width="160" height="200" fill="#FFFFFF" />
      <rect x="271" y="93" width="50" height="10" fill="#F7F7F7" />
      <rect x="271" y="153" width="50" height="10" fill="#F7F7F7" />
      <rect x="271" y="213" width="50" height="10" fill="#F7F7F7" />
      <rect x="271" y="169" width="50" height="10" fill="#F7F7F7" />
      <rect x="271" y="229" width="50" height="10" fill="#F7F7F7" />
      <rect x="271" y="109" width="70" height="10" fill="#F7F7F7" />
      <circle cx="236" cy="226" r="15" fill={accentSoft} />
      <path fill="#FFFFFF" d="M226.465 228.51 229.791 225.148 234.811 230.222 231.485 233.583 226.465 228.51z" />
      <path fill="#FFFFFF" d="M243.116 218.445 246.462 221.828 233.159 235.275 229.812 231.892 243.116 218.445z" />
      <circle cx="236" cy="166" r="15" fill={accentSoft} />
      <path fill="#FFFFFF" d="M226.465 168.51 229.791 165.148 234.811 170.222 231.485 173.583 226.465 168.51z" />
      <path fill="#FFFFFF" d="M243.116 158.445 246.462 161.828 233.159 175.275 229.812 171.892 243.116 158.445z" />
      <circle cx="236" cy="106" r="15" fill={accentSoft} />
      <path fill="#FFFFFF" d="M226.465 108.51 229.791 105.148 234.811 110.222 231.485 113.583 226.465 108.51z" />
      <path fill="#FFFFFF" d="M243.116 98.445 246.462 101.828 233.159 115.275 229.812 111.892 243.116 98.445z" />
      <rect x="241" y="41" width="80" height="30" stroke="rgba(24, 24, 24, 1)" strokeWidth={10} />
      <rect x="221" y="21" width="120" height="30" fill="#C3C5C6" />
      <rect x="221" y="21" width="120" height="20" fill="#EBECEC" />
      <rect x="341" y="141" width="80" height="140" fill={`url(#${phoneGradId})`} />
      <rect x="351" y="151" width="60" height="110" fill="#FFFFFF" />
      <path fill="#F7F7F7" d="M411 201 411 261 351 261 411 201z" />
      <circle cx="381" cy="271" r="5" fill="#FFFFFF" />
      <path fill="#EBECEC" d="M381 231 381 261 351 261 381 231z" />
      <circle cx="381" cy="196" r="15" fill="#181818" />
      <path fill="#FFFFFF" d="M371.465 198.51 374.791 195.148 379.811 200.222 376.485 203.583 371.465 198.51z" />
      <path fill="#FFFFFF" d="M388.116 188.445 391.462 191.828 378.159 205.275 374.812 201.892 388.116 188.445z" />
    </svg>
  )
}

function HermesLogsPage() {
  usePageTitle('Hermes 日志')
  const selectedAgentName = useHermesAgentStore((store) => store.selectedName)
  const loadAgents = useHermesAgentStore((store) => store.loadAgents)

  const [activeTab, setActiveTab] = useState<string | number>('gateway')
  const [loading, setLoading] = useState(false)
  const [meta, setMeta] = useState<HermesLogStreamMeta | null>(null)
  const [rows, setRows] = useState<HermesLogRow[]>([])
  const [filterText, setFilterText] = useState('')
  const [selectedLevels, setSelectedLevels] = useState<Selection>(new Set(levelOptions))
  const [autoFollow, setAutoFollow] = useState(true)
  const [refreshIndex, setRefreshIndex] = useState(0)
  const rowSeed = useRef(0)

  const activeKind = activeTab as HermesLogKind
  const activeTabConfig = useMemo(
    () => hermesLogTabs.find((item) => item.key === activeKind) ?? hermesLogTabs[0],
    [activeKind],
  )

  const selectedLevelList = useMemo(() => selectionToArray(selectedLevels), [selectedLevels])
  const levelsQuery = selectedLevelList.join(',')
  const debouncedFilterText = useDebouncedValue(filterText, 250)
  const sortedRows = useMemo(() => [...rows].sort((left, right) => getLogSortTime(right) - getLogSortTime(left)), [rows])

  useEffect(() => {
    let cancelled = false
    const resetTimer = window.setTimeout(() => {
      if (cancelled) return
      setLoading(true)
      setRows([])
      setMeta(null)
    }, 0)

    const url = getHermesLogStreamURL({
      kind: activeKind,
      tail: 200,
      follow: autoFollow,
      filter: debouncedFilterText,
      levels: levelsQuery,
      profile: selectedAgentName,
    })

    rowSeed.current += 1
    const streamId = `${activeKind}-${rowSeed.current}`
    const source = new EventSource(url)
    let rowIndex = 0
    const seen = new Set<string>()

    const close = () => {
      source.close()
      setLoading(false)
    }

    source.addEventListener('meta', (event) => {
      try {
        setMeta(JSON.parse((event as MessageEvent).data) as HermesLogStreamMeta)
      } catch {
        // ignore malformed meta payload
      }
      setLoading(false)
    })

    source.addEventListener('log', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as HermesLogStreamLine
        const normalizedPayload = normalizeLogPayload(payload)
        const fingerprint = `${normalizedPayload.timestamp}|${normalizedPayload.time ?? ''}|${normalizedPayload.level ?? ''}|${normalizedPayload.subsystem ?? ''}|${normalizedPayload.line}`
        if (seen.has(fingerprint)) return
        seen.add(fingerprint)
        rowIndex += 1
        setRows((current) => appendLogRow(current, {
          id: createLogRowId(streamId, rowIndex, fingerprint),
          ...normalizedPayload,
        }))
      } catch {
        // ignore malformed log payload
      }
    })

    source.addEventListener('error', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as HermesLogStreamError
        rowIndex += 1
        setRows((current) => appendLogRow(
          current,
          createErrorLogRow({
            message: payload.message,
            timestamp: payload.timestamp,
            streamId,
            rowIndex,
          }),
        ))
      } catch {
        rowIndex += 1
        setRows((current) => appendLogRow(
          current,
          createErrorLogRow({
            message: '日志流连接失败',
            timestamp: new Date().toISOString(),
            streamId,
            rowIndex,
          }),
        ))
      }
      setLoading(false)
    })

    source.addEventListener('done', () => {
      close()
    })

    source.onerror = () => {
      setLoading(false)
    }

    return () => {
      cancelled = true
      window.clearTimeout(resetTimer)
      source.close()
    }
  }, [activeKind, autoFollow, debouncedFilterText, levelsQuery, refreshIndex, selectedAgentName])

  useEffect(() => {
    void loadAgents(false)
  }, [loadAgents])

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="w-full">
          <Card variant="transparent" className="overflow-visible">
            <Card.Content className="overflow-visible">
              <div className="flex flex-row items-center gap-4 overflow-visible md:gap-6">
                <div className="flex h-24 shrink-0 items-center justify-center overflow-visible rounded-2xl p-1 drop-shadow-[0_8px_14px_color-mix(in_oklch,var(--accent)_28%,transparent)]">
                  <HermesLogsHeroIllustration className="h-full w-auto md:scale-105" />
                </div>
                <div className="flex min-w-0 flex-col gap-5">
                  <div className="min-w-0">
                    <Card.Title className="text-2xl font-bold md:text-3xl">运行日志</Card.Title>
                    <Card.Description className="mt-4 text-base md:text-lg">查看 Hermes Gateway、运行输出、退出诊断、错误和 Agent 日志。</Card.Description>
                  </div>
                </div>
              </div>
            </Card.Content>
          </Card>
        </section>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Segment selectedKey={activeTab} onSelectionChange={setActiveTab}>
            {hermesLogTabs.map((tab) => (
              <Segment.Item key={tab.key} id={tab.key}>
                <Segment.Separator />
                {tab.label}
              </Segment.Item>
            ))}
          </Segment>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <SearchField aria-label="搜索日志" value={filterText} onChange={setFilterText}>
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input className="w-full sm:w-48" placeholder="搜索..." />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>

            <Dropdown>
              <Button size="sm" variant="tertiary">
                <Icon icon="lucide:funnel" className="size-4" />
                筛选 {selectedLevelList.length}/{levelOptions.length}
              </Button>
              <Dropdown.Popover className="min-w-[auto]">
                <Dropdown.Menu
                  disallowEmptySelection
                  selectedKeys={selectedLevels}
                  selectionMode="multiple"
                  onSelectionChange={setSelectedLevels}
                >
                  {levelOptions.map((level) => (
                    <Dropdown.Item key={level} id={level} textValue={level}>
                      <Dropdown.ItemIndicator />
                      <Label>{level}</Label>
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>

            <Button size="sm" variant={autoFollow ? 'primary' : 'tertiary'} onPress={() => setAutoFollow((current) => !current)}>
              {autoFollow ? '自动刷新' : '手动刷新'}
            </Button>

            <Button size="sm" isIconOnly variant="ghost" aria-label="刷新 Hermes 日志" onPress={() => setRefreshIndex((current) => current + 1)} isDisabled={loading}>
              <Icon icon={loading ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
        </div>

        <Card>
          <Card.Header>
            <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-2">
                <Icon icon="lucide:scroll-text" className="size-6 shrink-0 text-muted" />
                <div className="min-w-0">
                  <Card.Title>{meta?.file ?? activeTabConfig.file}</Card.Title>
                  <Card.Description>
                    {meta ? <span className="break-all">{meta.path}</span> : <span>{loading ? '加载日志中...' : activeTabConfig.description}</span>}
                  </Card.Description>
                </div>
              </div>
              <div className="hidden shrink-0 items-center gap-2 md:flex">
                <Chip variant="soft">{activeTabConfig.file}</Chip>
                {meta ? <Chip variant="soft">tail {meta.tail}</Chip> : null}
                {meta ? <Chip variant="soft">{meta.follow ? 'follow' : 'snapshot'}</Chip> : null}
                {meta ? <Chip variant="soft">{rows.length} rows</Chip> : null}
              </div>
            </div>
          </Card.Header>
          <Card.Content>
            <Table variant="secondary">
              <Table.ScrollContainer className="h-[calc(100dvh-240px)] overflow-auto">
                <Table.Content aria-label="Hermes logs" className="min-w-[980px] table-fixed">
                  <Table.Header className="sticky top-0 z-10">
                    <Table.Column isRowHeader id="time" className="w-[160px]">
                      时间
                    </Table.Column>
                    <Table.Column id="level" className="w-[66px]">
                      级别
                    </Table.Column>
                    <Table.Column id="subsystem" className="w-[140px]">
                      模块
                    </Table.Column>
                    <Table.Column id="message">
                      日志内容
                    </Table.Column>
                    <Table.Column id="actions" className="w-[56px] text-end">
                      操作
                    </Table.Column>
                  </Table.Header>
                  <Table.Body items={sortedRows} renderEmptyState={() => <div className="px-4 py-8 text-center text-sm text-muted">{loading ? '加载中...' : '暂无日志'}</div>}>
                    {(item) => (
                      <Table.Row key={item.id} id={item.id}>
                        <Table.Cell className="w-[160px] text-xs tabular-nums text-muted">
                          {formatTime(item.time || item.timestamp)}
                        </Table.Cell>
                        <Table.Cell className="w-[66px]">
                          <Chip size="sm" variant="soft" color={levelColor(item.level)}>
                            <Chip.Label>{item.level || '-'}</Chip.Label>
                          </Chip>
                        </Table.Cell>
                        <Table.Cell className="w-[140px] text-xs text-muted">
                          {item.subsystem || '-'}
                        </Table.Cell>
                        <Table.Cell className="min-w-0">
                          <span className="block truncate font-mono text-xs leading-6" title={item.message || item.line}>
                            {item.message || item.line}
                          </span>
                        </Table.Cell>
                        <Table.Cell className="w-[56px] text-end">
                          <LogDetailModal item={item} />
                        </Table.Cell>
                      </Table.Row>
                    )}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </Card.Content>
        </Card>
      </div>
    </DashboardLayout>
  )
}

function LogDetailModal({ item }: { item: HermesLogRow }) {
  const content = item.message || item.line

  return (
    <Modal>
      <Button isIconOnly aria-label="查看日志详情" size="sm" variant="ghost">
        <Icon icon="lucide:eye" className="size-4" />
      </Button>
      <Modal.Backdrop variant="transparent">
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-2xl">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Icon className="bg-default text-foreground">
                <Icon icon="lucide:scroll-text" className="size-5" />
              </Modal.Icon>
              <Modal.Heading>日志详情</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="grid gap-3 text-sm">
                <div className="grid gap-2 sm:grid-cols-3">
                  <InfoPill label="时间" value={formatTime(item.time || item.timestamp)} />
                  <InfoPill label="级别" value={item.level || '-'} />
                  <InfoPill label="模块" value={item.subsystem || '-'} />
                </div>
                <pre className="max-h-[50dvh] overflow-auto rounded-2xl bg-surface-secondary/50 p-4 font-mono text-xs leading-6 whitespace-pre-wrap break-all text-foreground">
                  {content}
                </pre>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="tertiary">
                取消
              </Button>
              <Button slot="close" onPress={() => copyLogText(content)}>
                复制
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-secondary/50 px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 truncate text-sm text-foreground" title={value}>{value}</div>
    </div>
  )
}

async function copyLogText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('已复制日志')
  } catch {
    toast.warning('复制失败')
  }
}

function appendLogRow(current: HermesLogRow[], row: HermesLogRow) {
  if (current.length >= maxLogRows) {
    return [...current.slice(current.length - maxLogRows + 1), row]
  }
  return [...current, row]
}

function createErrorLogRow({ message, rowIndex, streamId, timestamp }: { message: string; rowIndex: number; streamId: string; timestamp: string }): HermesLogRow {
  const line = `日志读取失败：${message}`
  return {
    id: `${streamId}-${rowIndex}-error-${hashLogFingerprint(line)}`,
    level: 'error',
    line,
    message,
    subsystem: 'hermes-log',
    time: timestamp,
    timestamp,
  }
}

function normalizeLogPayload(payload: HermesLogStreamLine): HermesLogStreamLine {
  const parsed = parsePlainLogLine(payload.line)
  return {
    ...payload,
    level: normalizeLevel(payload.level || parsed.level),
    message: payload.message || parsed.message,
    subsystem: payload.subsystem || parsed.subsystem,
    time: payload.time || parsed.time,
  }
}

function parsePlainLogLine(line: string) {
  const pythonMatch = line.match(/^(?<time>\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2},\d{3})\s+(?<level>[A-Z]+)\s+(?<subsystem>[^:]+):\s*(?<message>.*)$/)
  if (pythonMatch?.groups) {
    return {
      level: normalizeLevel(pythonMatch.groups.level),
      message: pythonMatch.groups.message,
      subsystem: pythonMatch.groups.subsystem,
      time: pythonMatch.groups.time,
    }
  }

  const bracketMatch = line.match(/^(?<time>\S+)\s+\[(?<subsystem>[^\]]+)]\s+(?<message>.*)$/)
  const message = bracketMatch?.groups?.message ?? line
  const lowerMessage = message.toLowerCase()
  const levelMatch = lowerMessage.match(/\b(trace|debug|info|warn|warning|error|fatal)\b/)
  const level = normalizeLevel(levelMatch?.[1])

  return {
    level,
    message,
    subsystem: bracketMatch?.groups?.subsystem,
    time: bracketMatch?.groups?.time,
  }
}

function selectionToArray(selection: Selection) {
  if (selection === 'all') return levelOptions
  return Array.from(selection).map(String) as LogLevel[]
}

function createLogRowId(streamId: string, rowIndex: number, fingerprint: string) {
  return `${streamId}-${rowIndex}-${hashLogFingerprint(fingerprint)}`
}

function getLogSortTime(row: HermesLogRow) {
  const value = row.time || row.timestamp
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

function hashLogFingerprint(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index)
  }
  return Math.abs(hash).toString(36)
}

function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])

  return debounced
}

function normalizeLevel(value?: string) {
  const normalized = value?.trim().toLowerCase()
  return normalized === 'warning' ? 'warn' : normalized
}

function levelColor(level?: string) {
  switch (level) {
    case 'trace':
    case 'debug':
      return 'default'
    case 'info':
      return 'accent'
    case 'warn':
      return 'warning'
    case 'error':
    case 'fatal':
      return 'danger'
    default:
      return 'default'
  }
}

function formatTime(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

export default HermesLogsPage
