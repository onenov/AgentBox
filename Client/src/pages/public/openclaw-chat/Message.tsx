import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Spinner, Tooltip, toast } from '@heroui/react'
import { Icon } from '@iconify/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useOpenClawChat, type OpenClawChatMessage, type OpenClawChatMessageMeta, type OpenClawChatToolCall } from './OpenClawChatContext'

function CollapsibleContent({
  children,
  expanded,
}: {
  children: ReactNode
  expanded: boolean
}) {
  return (
    <div
      aria-hidden={!expanded}
      className={`grid transition-[grid-template-rows] duration-200 ease-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={`transition-[opacity,transform] duration-200 ease-out ${expanded
            ? 'translate-y-0 opacity-100'
            : '-translate-y-1 opacity-0'
            }`}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

async function copyMessageContent(content: string) {
  const text = content.trim()
  if (!text) return

  try {
    if (!navigator.clipboard) throw new Error('Clipboard API unavailable')
    await navigator.clipboard.writeText(text)
    toast.success('已复制正文', { timeout: 1600 })
  } catch {
    toast.danger('复制失败', { timeout: 1600 })
  }
}

function ThinkingPanel({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-system-lg overflow-hidden bg-surface">
      <button
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors"
        type="button"
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="rounded-system flex size-4 shrink-0 items-center justify-center bg-warning/10 text-warning ring-1 ring-warning/15">
            <Icon icon="lucide:brain-circuit" className="size-3.5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">深度思考</span>
            {/* <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted">
              {expanded ? content : preview}
            </span> */}
          </span>
        </span>
        <span className="rounded-system flex size-7 shrink-0 items-center justify-center text-muted">
          <Icon icon="lucide:chevron-down" className={`size-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
        </span>
      </button>
      <CollapsibleContent expanded={expanded}>
        <div className="px-3 pb-3">
          <div className="rounded-system max-h-72 overflow-auto bg-surface-secondary/50 px-3 py-2">
            <MarkdownContent content={content} />
          </div>
        </div>
      </CollapsibleContent>
    </div>
  )
}

function ToolCallChain({ defaultExpanded = true, tools }: { defaultExpanded?: boolean; tools: OpenClawChatToolCall[] }) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  if (tools.length === 0) return null

  return (
    <div className="rounded-system-lg bg-surface p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-system flex size-7 shrink-0 items-center justify-center bg-accent/15 text-accent ring-1 ring-accent/20">
            <Icon icon="lucide:wrench" className="size-3.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-foreground">TOOL</div>
            <div className="truncate text-[11px] text-muted">{tools.length} 个步骤</div>
          </div>
        </div>
        <Tooltip delay={300}>
          <Button
            isIconOnly
            aria-label={expanded ? '收起执行轨迹' : '展开执行轨迹'}
            aria-expanded={expanded}
            size="sm"
            variant="ghost"
            onPress={() => setExpanded((current) => !current)}
          >
            <Icon icon="lucide:chevron-down" className={`size-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
          </Button>
          <Tooltip.Content>{expanded ? '收起执行轨迹' : '展开执行轨迹'}</Tooltip.Content>
        </Tooltip>
      </div>
      <CollapsibleContent expanded={expanded}>
        <div className="mt-3 space-y-2">
          {tools.map((tool, index) => (
            <div key={`${tool.id}-${index}`} className="relative flex gap-3 rounded-system-lg border border-border/70 bg-background/60 p-2.5">
              <span
                className={`rounded-system relative z-10 flex size-6 shrink-0 items-center justify-center ring-1 ${tool.status === 'error'
                  ? 'bg-danger/15 text-danger ring-danger/20'
                  : tool.status === 'done'
                    ? 'bg-success/15 text-success ring-success/20'
                    : 'bg-warning/15 text-warning ring-warning/20'
                  }`}
              >
                <Icon icon={getToolStatusIcon(tool)} className={tool.status === 'running' || tool.status === 'pending' ? 'size-4 animate-spin' : 'size-4'} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{tool.name}</div>
                    {/* <div className="mt-0.5 text-[11px] text-muted">
                      {tool.status === 'running' ? '正在执行' : tool.status === 'error' ? '执行失败' : '执行完成'}
                    </div> */}
                  </div>
                  {/* <Chip color={tool.status === 'error' ? 'danger' : tool.status === 'done' ? 'success' : 'warning'} size="sm" variant="soft">
                    {formatToolStatus(tool.status)}
                  </Chip> */}
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">
                  {tool.result || tool.description || '等待结果'}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </div>
  )
}

function getToolStatusIcon(tool: OpenClawChatToolCall) {
  if (tool.status === 'running' || tool.status === 'pending') return 'lucide:loader-circle'
  if (tool.status === 'done') return 'lucide:check'
  if (tool.status === 'error') return tool.icon || 'lucide:circle-alert'

  return tool.icon || 'lucide:wrench'
}

function MessageMedia({ message }: { message: OpenClawChatMessage }) {
  const hasImages = Boolean(message.images?.length)
  const hasFiles = Boolean(message.files?.length)
  if (!hasImages && !hasFiles) return null

  return (
    <div className="-mx-1 overflow-x-auto overscroll-x-contain px-1 pb-1">
      <div className="flex w-max max-w-full gap-2">
        {message.images?.map((src, index) => (
          <img
            key={`${src}-${index}`}
            alt="消息图片"
            className="rounded-system-lg h-40 w-56 shrink-0 border border-border object-cover"
            src={src}
          />
        ))}
        {message.files?.map((file) => (
          <a
            key={file.id}
            className="rounded-system-lg flex h-20 w-56 shrink-0 items-center gap-2 border border-border bg-background/70 px-3 py-2 text-sm text-foreground transition-colors hover:bg-surface-secondary"
            href={file.url || file.dataUrl}
            rel="noreferrer"
            target="_blank"
          >
            <span className="rounded-system flex size-9 shrink-0 items-center justify-center bg-surface-secondary text-muted">
              <Icon icon="lucide:file" className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{file.name}</span>
              {file.size ? <span className="mt-1 block text-xs text-muted">{formatFileSize(file.size)}</span> : null}
            </span>
          </a>
        ))}
      </div>
    </div>
  )
}

function MessageMeta({
  contextTokens,
  meta,
  timestamp,
}: {
  contextTokens?: number | null
  meta?: OpenClawChatMessageMeta
  timestamp: number
}) {
  const parts = buildMessageMetaParts(meta, contextTokens)
  const time = formatMessageTime(timestamp)
  if (!parts.length) return null

  return (
    <div className="flex items-center gap-2">
      <div className="text-sm text-muted">
        {time ? <span className="whitespace-nowrap">{time}</span> : null}
      </div>
      <details className="group inline-flex max-w-full items-center gap-1.5 text-[11px] leading-none text-muted">
        <summary
          className="rounded-system inline-flex min-h-6 cursor-[var(--cursor-interactive)] list-none items-center gap-1 border border-border bg-background px-2 py-1 transition-colors marker:hidden hover:border-accent/40 hover:bg-surface-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden"
          title="Show message context details"
        >
          <Icon icon="lucide:chevron-right" className="size-3 transition-transform duration-150 group-open:rotate-90" />

          <span>Context</span>
        </summary>
        <span className="rounded-system inline-flex min-h-6 max-w-full flex-wrap items-center gap-x-2 gap-y-1 border border-border bg-background px-2 py-1">
          {parts.map((part) => (
            <span key={part.key} className={part.className}>
              {part.label}
            </span>
          ))}
        </span>
      </details>
    </div>

  )
}

function ChatMessageItem({
  defaultToolChainExpanded,
  message,
}: {
  defaultToolChainExpanded: boolean
  message: OpenClawChatMessage
}) {
  const { currentSession, showToolCards } = useOpenClawChat()
  const isUser = message.role === 'user'
  const botContent = message.content.trim()
  const hasMeta = !isUser && buildMessageMetaParts(message.meta, currentSession?.contextTokens).length > 0
  const hasVisibleContent = Boolean(
    message.content.trim()
    || message.reasoning?.trim()
    || message.images?.length
    || message.files?.length
    || hasMeta
    || message.streaming
  )
  const hasVisibleTools = Boolean(showToolCards && message.tools?.length)

  if (!isUser && !hasVisibleContent && !hasVisibleTools) {
    return null
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[82%] space-y-2">
        {!isUser ? (
          <div className="flex items-center gap-2 text-xs font-medium text-muted">
            <Tooltip delay={300}>
              <button
                aria-label="复制正文"
                className="group rounded-system flex size-6 items-center justify-center bg-accent text-accent-foreground transition-colors cursor-[var(--cursor-interactive)] hover:bg-accent/90"
                type="button"
                onClick={() => void copyMessageContent(botContent)}
              >
                <span className="relative flex size-3.5 items-center justify-center">
                  {message.streaming ? (
                    <Icon icon="lucide:loader-circle" className="absolute inset-0 size-3.5 animate-spin" />
                  ) : (
                    <>
                      <Icon icon="lucide:bot" className="absolute inset-0 size-3.5 transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0" />
                      <Icon icon="lucide:copy" className="absolute inset-0 size-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
                    </>
                  )}
                </span>
              </button>
              <Tooltip.Content>复制正文</Tooltip.Content>
            </Tooltip>
            OpenClaw Assistant
          </div>
        ) : null}
        {message.reasoning ? <ThinkingPanel content={message.reasoning} /> : null}
        {hasVisibleTools ? <ToolCallChain defaultExpanded={defaultToolChainExpanded} tools={message.tools ?? []} /> : null}
        <MessageMedia message={message} />
        {message.content || message.streaming ? (
          <div className={isUser ? 'rounded-system-lg bg-accent px-4 py-3 text-accent-foreground' : 'rounded-system-lg bg-surface px-4 py-3 shadow-surface border border-border'}>
            {message.content ? (
              <MarkdownContent content={message.content} />
            ) : (
              <span className="inline-flex items-center gap-2 text-sm text-muted">
                <Spinner color="current" size="sm" />
                思考中....
              </span>
            )}
          </div>
        ) : null}
        {!isUser ? <MessageMeta contextTokens={currentSession?.contextTokens} meta={message.meta} timestamp={message.timestamp} /> : null}
      </div>
    </div>
  )
}

function Message() {
  const { connectionStatus, error, isLoadingMessages, messages } = useOpenClawChat()
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const shouldStickToBottomRef = useRef(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const threshold = 96
    const updateVisibility = () => {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      const isNearBottom = distanceFromBottom <= threshold
      shouldStickToBottomRef.current = isNearBottom
      setShowScrollToBottom(!isNearBottom)
    }

    updateVisibility()
    viewport.addEventListener('scroll', updateVisibility, { passive: true })

    return () => {
      viewport.removeEventListener('scroll', updateVisibility)
    }
  }, [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !shouldStickToBottomRef.current) return

    viewport.scrollTop = viewport.scrollHeight
    setShowScrollToBottom(false)
  }, [messages])

  function scrollToBottom() {
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: 'smooth' })
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div ref={viewportRef} className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto overscroll-contain md:p-6 pb-4">
        {error ? (
          <div className="rounded-system-lg flex items-start gap-3 border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger">
            <Icon icon="lucide:triangle-alert" className="mt-0.5 size-4 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        ) : null}
        {isLoadingMessages ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
            <Spinner color="current" size="sm" />
            正在加载消息
          </div>
        ) : messages.length > 0 ? (
          (() => {
            let lastVisibleToolChainIndex = -1

            messages.forEach((message, index) => {
              if (message.role !== 'user' && message.tools?.length) {
                lastVisibleToolChainIndex = index
              }
            })

            return messages.map((message, index) => (
              <ChatMessageItem
                key={message.id}
                defaultToolChainExpanded={index === lastVisibleToolChainIndex}
                message={message}
              />
            ))
          })()
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-sm text-center">
              <img src="/assets/images/OpenClaw.png" alt="Empty" className="mx-auto mb-6 h-32 rounded-full" />
              <h2 className="text-base font-semibold text-foreground">{connectionStatus === 'ready' ? '开始与 OpenClaw 对话' : '等待 Gateway 连接'}</h2>
            </div>
          </div>
        )}
      </div>
      {showScrollToBottom ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button isIconOnly
            variant="tertiary"
            className="pointer-events-auto bg-surface border border-border/40"
            size="sm"
            onPress={scrollToBottom}
          >
            <Icon icon="lucide:arrow-down" className="size-4" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="openclaw-chat-markdown break-words text-[15px]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {content}
      </ReactMarkdown>
    </div>
  )
}


function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function buildMessageMetaParts(meta?: OpenClawChatMessageMeta, contextTokens?: number | null) {
  if (!meta) return []

  const contextPercent = meta.contextPercent ?? getContextPercent(meta, contextTokens)
  const parts: Array<{ className: string; key: string; label: string }> = []

  if (meta.input) parts.push({ className: 'whitespace-nowrap', key: 'input', label: `↑${formatTokens(meta.input)}` })
  if (meta.output) parts.push({ className: 'whitespace-nowrap', key: 'output', label: `↓${formatTokens(meta.output)}` })
  if (meta.cacheRead) parts.push({ className: 'whitespace-nowrap', key: 'cache-read', label: `R${formatTokens(meta.cacheRead)}` })
  if (meta.cacheWrite) parts.push({ className: 'whitespace-nowrap', key: 'cache-write', label: `W${formatTokens(meta.cacheWrite)}` })
  if (meta.cost && meta.cost > 0) parts.push({ className: 'whitespace-nowrap text-success', key: 'cost', label: `$${meta.cost.toFixed(4)}` })
  if (contextPercent !== undefined) {
    const tone = contextPercent >= 90
      ? 'text-danger'
      : contextPercent >= 75
        ? 'text-warning'
        : ''
    parts.push({ className: `whitespace-nowrap ${tone}`, key: 'context', label: `${contextPercent}% ctx` })
  }
  if (meta.model) {
    parts.push({
      className: 'rounded-system bg-surface-secondary px-1.5 py-0.5 font-mono whitespace-nowrap',
      key: 'model',
      label: shortenModel(meta.model),
    })
  }

  return parts
}

function getContextPercent(meta: OpenClawChatMessageMeta, contextTokens?: number | null) {
  if (!contextTokens) return undefined
  const promptTokens = (meta.input ?? 0) + (meta.cacheRead ?? 0) + (meta.cacheWrite ?? 0)
  if (!promptTokens) return undefined
  return Math.min(Math.round((promptTokens / contextTokens) * 100), 100)
}

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(value)
}

function shortenModel(model: string) {
  return model.includes('/') ? model.split('/').pop() || model : model
}

function formatMessageTime(timestamp: number) {
  if (!Number.isFinite(timestamp)) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

export default Message
