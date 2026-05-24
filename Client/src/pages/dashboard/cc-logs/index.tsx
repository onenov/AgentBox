import type { Selection } from '@heroui/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Chip, Dropdown, Label, Modal, SearchField, Table, toast } from '@heroui/react'
import { Segment } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import type {
  CCConnectLogStreamError,
  CCConnectLogStreamLine,
  CCConnectLogStreamMeta,
} from '@/api'
import { getCCConnectLogStreamURL } from '@/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import DashboardLayout from '@/layouts/Dashboard'
import { useConfigStore } from '@/stores/config'
import { CCConnectLogsHeroIllustration } from './CCConnectLogsHeroIllustration'

type CCConnectLogKind = 'runtime' | 'main'

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

type CCConnectLogRow = CCConnectLogStreamLine & {
  id: string
}

type CCConnectLogTab = {
  key: CCConnectLogKind
  label: string
  file: string
  description: string
}

const getCCConnectLogTabs = (appName: string): CCConnectLogTab[] => [
  { key: 'runtime', label: '运行输出', file: 'agent-box-cc-connect.log', description: `${appName} 后台进程输出` },
  { key: 'main', label: '主日志', file: 'cc-connect.log', description: 'CC-Connect 主日志' },
]

const levelOptions: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
const maxLogRows = 2000

function CCConnectLogsPage() {
  usePageTitle('CC-Connect 日志')
  const appName = useConfigStore((state) => state.appName)
  const ccConnectLogTabs = useMemo(() => getCCConnectLogTabs(appName), [appName])

  const [activeTab, setActiveTab] = useState<string | number>('runtime')
  const [loading, setLoading] = useState(false)
  const [meta, setMeta] = useState<CCConnectLogStreamMeta | null>(null)
  const [error, setError] = useState('')
  const [rows, setRows] = useState<CCConnectLogRow[]>([])
  const [filterText, setFilterText] = useState('')
  const [selectedLevels, setSelectedLevels] = useState<Selection>(new Set(levelOptions))
  const [autoFollow, setAutoFollow] = useState(true)
  const [refreshIndex, setRefreshIndex] = useState(0)
  const rowSeed = useRef(0)

  const activeKind = activeTab as CCConnectLogKind
  const activeTabConfig = useMemo(
    () => ccConnectLogTabs.find((item) => item.key === activeKind) ?? ccConnectLogTabs[0],
    [activeKind, ccConnectLogTabs],
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
      setError('')
      setRows([])
      setMeta(null)
    }, 0)

    const url = getCCConnectLogStreamURL({
      kind: activeKind,
      tail: 200,
      follow: autoFollow,
      filter: debouncedFilterText,
      levels: levelsQuery,
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
        setMeta(JSON.parse((event as MessageEvent).data) as CCConnectLogStreamMeta)
      } catch {
        // ignore malformed meta payload
      }
      setLoading(false)
    })

    source.addEventListener('log', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as CCConnectLogStreamLine
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
        const payload = JSON.parse((event as MessageEvent).data) as CCConnectLogStreamError
        rowIndex += 1
        setError(payload.message)
        setRows([
          createErrorLogRow({
            message: payload.message,
            timestamp: payload.timestamp,
            streamId,
            rowIndex,
          }),
        ])
      } catch {
        rowIndex += 1
        setError('日志流连接失败')
        setRows([
          createErrorLogRow({
            message: '日志流连接失败',
            timestamp: new Date().toISOString(),
            streamId,
            rowIndex,
          }),
        ])
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
  }, [activeKind, autoFollow, debouncedFilterText, levelsQuery, refreshIndex])

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="w-full">
          <Card variant="transparent" className="overflow-visible">
            <Card.Content className="overflow-visible">
              <div className="flex flex-row items-center gap-4 overflow-visible md:gap-6">
                <div className="flex h-24 shrink-0 items-center justify-center overflow-visible -p-4">
                  <CCConnectLogsHeroIllustration className="h-full w-auto rounded-2xl" />
                </div>
                <div className="flex min-w-0 flex-col gap-5">
                  <div className="min-w-0">
                    <Card.Title className="text-2xl font-bold md:text-3xl">运行日志</Card.Title>
                    <Card.Description className="mt-4 text-base md:text-lg">查看 CC-Connect 后台运行输出和主日志。</Card.Description>
                  </div>
                </div>
              </div>
            </Card.Content>
          </Card>
        </section>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Segment selectedKey={activeTab} onSelectionChange={setActiveTab}>
            {ccConnectLogTabs.map((tab) => (
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

            <Button size="sm" isIconOnly variant="ghost" aria-label="刷新 CC-Connect 日志" onPress={() => setRefreshIndex((current) => current + 1)} isDisabled={loading}>
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
                <Chip variant="soft">{meta?.file ?? activeTabConfig.file}</Chip>
                {meta ? <Chip variant="soft">tail {meta.tail}</Chip> : null}
                {meta ? <Chip variant="soft">{meta.follow ? 'follow' : 'snapshot'}</Chip> : null}
                {meta ? <Chip variant="soft">{rows.length} rows</Chip> : null}
              </div>
            </div>
          </Card.Header>
          <Card.Content>
            {error ? (
              <div className="mb-3 flex items-start gap-3 rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
                <Icon icon="lucide:triangle-alert" className="mt-0.5 size-4 shrink-0" />
                <span className="break-all">{error}</span>
              </div>
            ) : null}

            <Table variant="secondary">
              <Table.ScrollContainer className="h-[calc(100dvh-240px)] overflow-auto">
                <Table.Content aria-label="CC-Connect logs" className="min-w-[980px] table-fixed">
                  <Table.Header className="sticky top-0 z-10">
                    <Table.Column isRowHeader id="time" className="w-[170px]">
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
                        <Table.Cell className="w-[170px] text-xs tabular-nums text-muted">
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

function LogDetailModal({ item }: { item: CCConnectLogRow }) {
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

function appendLogRow(current: CCConnectLogRow[], row: CCConnectLogRow) {
  if (current.length >= maxLogRows) {
    return [...current.slice(current.length - maxLogRows + 1), row]
  }
  return [...current, row]
}

function createErrorLogRow({ message, rowIndex, streamId, timestamp }: { message: string; rowIndex: number; streamId: string; timestamp: string }): CCConnectLogRow {
  const line = `日志读取失败：${message}`
  return {
    id: `${streamId}-${rowIndex}-error-${hashLogFingerprint(line)}`,
    level: 'error',
    line,
    message,
    subsystem: 'cc-connect-log',
    time: timestamp,
    timestamp,
  }
}

function normalizeLogPayload(payload: CCConnectLogStreamLine): CCConnectLogStreamLine {
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
  const fields = parseKeyValueLine(line)
  if (fields.time || fields.level || fields.msg) {
    return {
      level: normalizeLevel(fields.level),
      message: fields.msg || fields.message || line,
      subsystem: fields.platform || fields.project || fields.addr || fields.socket,
      time: fields.time,
    }
  }

  const goMatch = line.match(/^(?<time>\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+(?<level>[A-Z]+|\[[^\]]+])\s+(?<message>.*)$/)
  if (goMatch?.groups) {
    return {
      level: normalizeLevel(goMatch.groups.level.replace(/^\[|\]$/g, '')),
      message: goMatch.groups.message,
      time: normalizeGoLogTime(goMatch.groups.time),
    }
  }

  const lowerMessage = line.toLowerCase()
  const levelMatch = lowerMessage.match(/\b(trace|debug|info|warn|warning|error|fatal)\b/)
  return {
    level: normalizeLevel(levelMatch?.[1]),
    message: line,
  }
}

function parseKeyValueLine(line: string) {
  const fields: Record<string, string> = {}
  let index = 0
  while (index < line.length) {
    while (line[index] === ' ') index += 1
    const keyStart = index
    while (index < line.length && line[index] !== '=' && line[index] !== ' ') index += 1
    if (index >= line.length || line[index] !== '=') {
      while (index < line.length && line[index] !== ' ') index += 1
      continue
    }
    const key = line.slice(keyStart, index).trim()
    index += 1

    let value = ''
    if (line[index] === '"') {
      index += 1
      let escaped = false
      while (index < line.length) {
        const char = line[index]
        if (escaped) {
          value += char
          escaped = false
        } else if (char === '\\') {
          escaped = true
        } else if (char === '"') {
          index += 1
          break
        } else {
          value += char
        }
        index += 1
      }
    } else {
      const valueStart = index
      while (index < line.length && line[index] !== ' ') index += 1
      value = line.slice(valueStart, index)
    }

    if (key) fields[key] = value
  }
  return fields
}

function selectionToArray(selection: Selection) {
  if (selection === 'all') return levelOptions
  return Array.from(selection).map(String) as LogLevel[]
}

function createLogRowId(streamId: string, rowIndex: number, fingerprint: string) {
  return `${streamId}-${rowIndex}-${hashLogFingerprint(fingerprint)}`
}

function getLogSortTime(row: CCConnectLogRow) {
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

function normalizeGoLogTime(value: string) {
  const match = value.match(/^(?<year>\d{4})\/(?<month>\d{2})\/(?<day>\d{2})\s+(?<time>\d{2}:\d{2}:\d{2})$/)
  if (!match?.groups) return value
  return `${match.groups.year}-${match.groups.month}-${match.groups.day}T${match.groups.time}`
}

function formatTime(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

export default CCConnectLogsPage
