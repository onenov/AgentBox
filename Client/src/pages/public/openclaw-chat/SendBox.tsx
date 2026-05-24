import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Chip, Dropdown, Label, Spinner } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useOpenClawChat, type OpenClawChatAttachmentDraft, type OpenClawChatModelOption, type OpenClawChatSlashCommand } from './OpenClawChatContext'

const TEXTAREA_MAX_HEIGHT = 192
const TEXTAREA_MIN_ROWS = 2
const COMPOSITION_ENTER_GRACE_MS = 50

function ChatSendBox() {
  const {
    abortCurrentRun,
    addAttachments,
    attachments,
    connectionStatus,
    currentRunId,
    isSending,
    isSwitchingModel,
    modelOptions,
    removeAttachment,
    selectedModel,
    sendMessage,
    slashCommands,
    switchModel,
  } = useOpenClawChat()
  const [activeSlashIndex, setActiveSlashIndex] = useState(0)
  const [message, setMessage] = useState('')
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const isComposingRef = useRef(false)
  const lastCompositionEndAtRef = useRef(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const hasMessage = message.trim().length > 0
  const isReady = connectionStatus === 'ready'
  const isBusy = isSending || Boolean(currentRunId)
  const slashMenu = useMemo(
    () => buildSlashMenu(message, slashCommands),
    [message, slashCommands],
  )
  const slashMenuOpen = !slashMenuDismissed && slashMenu.items.length > 0
  const selectedSlashIndex = slashMenu.items.length ? Math.min(activeSlashIndex, slashMenu.items.length - 1) : 0

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = '0px'
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 24
    const minHeight = lineHeight * TEXTAREA_MIN_ROWS
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), TEXTAREA_MAX_HEIGHT)
    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = textarea.scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden'
  }, [message])

  async function submit() {
    if (!hasMessage || !isReady || isBusy) return
    const text = message
    setComposerMessage('')
    await sendMessage(text)
  }

  function setComposerMessage(value: string) {
    const shouldShowSlashMenu = isSlashMenuCandidate(value)
    setMessage(value)
    setSlashMenuDismissed(!shouldShowSlashMenu)
    if (shouldShowSlashMenu) setActiveSlashIndex(0)
  }

  function applySlashCommand(item = slashMenu.items[selectedSlashIndex]) {
    if (!item) return
    const nextValue = item.command.acceptsArgs ? `${item.alias} ` : item.alias
    setComposerMessage(nextValue)
    setSlashMenuDismissed(true)
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      textarea?.focus()
      textarea?.setSelectionRange(nextValue.length, nextValue.length)
    })
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    await addAttachments(files)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (imageInputRef.current) imageInputRef.current.value = ''
  }

  return (
    <div>
      {attachments.length ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <AttachmentPreview
              key={attachment.id}
              attachment={attachment}
              onRemove={() => removeAttachment(attachment.id)}
            />
          ))}
        </div>
      ) : null}

      <div className="rounded-system-lg relative border-2 bg-surface p-3 pb-14 transition-colors focus-within:border-accent">
        <textarea
          ref={textareaRef}
          aria-label="输入消息"
          className="block min-h-8 w-full resize-none bg-transparent text-base leading-6 text-foreground outline-none placeholder:text-muted disabled:opacity-60"
          disabled={!isReady}
          onChange={(event) => setComposerMessage(event.target.value)}
          onCompositionEnd={() => {
            isComposingRef.current = false
            lastCompositionEndAtRef.current = Date.now()
          }}
          onCompositionStart={() => {
            isComposingRef.current = true
          }}
          onKeyDown={(event) => {
            if (slashMenuOpen) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveSlashIndex((current) => (current + 1) % slashMenu.items.length)
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveSlashIndex((current) => (current - 1 + slashMenu.items.length) % slashMenu.items.length)
                return
              }
              if (event.key === 'Tab') {
                event.preventDefault()
                applySlashCommand()
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setSlashMenuDismissed(true)
                return
              }
            }

            if (event.key !== 'Enter') return
            if (event.shiftKey) return

            const nativeEvent = event.nativeEvent
            const isComposing = isComposingRef.current
              || nativeEvent.isComposing
              || nativeEvent.keyCode === 229
              || Date.now() - lastCompositionEndAtRef.current < COMPOSITION_ENTER_GRACE_MS

            if (!isComposing) {
              if (slashMenuOpen) {
                event.preventDefault()
                applySlashCommand()
                return
              }

              event.preventDefault()
              void submit()
            }
          }}
          placeholder={isReady ? '有什么问题尽管问我...' : '正在等待 Gateway 连接...'}
          rows={2}
          value={message}
        />

        {slashMenuOpen ? (
          <SlashCommandMenu
            activeIndex={selectedSlashIndex}
            items={slashMenu.items}
            onSelect={applySlashCommand}
            onHover={setActiveSlashIndex}
          />
        ) : null}

        <input ref={fileInputRef} className="hidden" type="file" multiple onChange={(event) => void handleFiles(event.currentTarget.files)} />
        <input ref={imageInputRef} accept="image/*" className="hidden" type="file" multiple onChange={(event) => void handleFiles(event.currentTarget.files)} />

        <div className="absolute bottom-3 left-3 flex max-w-[calc(100%-7rem)] items-center gap-2">
          <ModelSelector
            isDisabled={!isReady || isBusy || isSwitchingModel}
            isSwitching={isSwitchingModel}
            options={modelOptions}
            value={selectedModel}
            onChange={(model) => void switchModel(model)}
          />
          <Button isIconOnly aria-label="选择文件" isDisabled={!isReady || isBusy} size="sm" variant="ghost" onPress={() => fileInputRef.current?.click()}>
            <Icon icon="lucide:paperclip" className="size-4" />
          </Button>
          <Button isIconOnly aria-label="选择图片" isDisabled={!isReady || isBusy} size="sm" variant="ghost" onPress={() => imageInputRef.current?.click()}>
            <Icon icon="lucide:image" className="size-4" />
          </Button>
        </div>

        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          {hasMessage && !isBusy ? (
            <Button isIconOnly aria-label="清除输入" size="sm" variant="ghost" onPress={() => setComposerMessage('')}>
              <Icon icon="lucide:eraser" className="size-4" />
            </Button>
          ) : null}
          {isBusy ? (
            <Button isIconOnly aria-label="停止生成" size="sm" variant="danger-soft" onPress={() => void abortCurrentRun()}>
              {isSending ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:square" className="size-4" />}
            </Button>
          ) : (
            <Button isIconOnly aria-label="发送消息" isDisabled={!hasMessage || !isReady} size="sm" onPress={() => void submit()}>
              <Icon icon="lucide:send-horizontal" className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

type SlashMenuItem = {
  alias: string
  command: OpenClawChatSlashCommand
}

function SlashCommandMenu({
  activeIndex,
  items,
  onHover,
  onSelect,
}: {
  activeIndex: number
  items: SlashMenuItem[]
  onHover: (index: number) => void
  onSelect: (item: SlashMenuItem) => void
}) {
  return (
    <div className="absolute inset-x-3 bottom-[calc(100%-0.5rem)] z-20 max-h-72 overflow-y-auto rounded-system-lg border border-border bg-background p-1 shadow-surface" role="listbox">
      {items.map((item, index) => (
        <button
          key={`${item.command.name}:${item.alias}`}
          className={`flex w-full items-center gap-3 rounded-system-md px-2.5 py-2 text-left transition-colors ${index === activeIndex ? 'bg-surface-secondary' : 'hover:bg-surface-secondary'}`}
          role="option"
          type="button"
          aria-selected={index === activeIndex}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onHover(index)}
          onClick={() => onSelect(item)}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-system border border-accent/20 bg-accent/10 text-accent">
            <Icon icon={slashCommandIcon(item.command.category)} className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-sm font-medium text-foreground">{item.alias}</span>
              <span className="shrink-0 rounded-system-sm bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-normal text-muted">
                {slashCommandCategoryLabel(item.command.category)}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted">{item.command.description}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

function buildSlashMenu(message: string, commands: OpenClawChatSlashCommand[]) {
  if (!isSlashMenuCandidate(message)) return { items: [] as SlashMenuItem[] }

  const query = message.trim().toLowerCase()
  const seen = new Set<string>()
  const items: SlashMenuItem[] = []

  for (const command of commands) {
    const aliases = command.textAliases?.length ? command.textAliases : [`/${command.name}`]
    const alias = aliases.find((item) => item.toLowerCase().startsWith(query))
      ?? aliases.find((item) => item.toLowerCase().includes(query.slice(1)))
    if (!alias || seen.has(command.name)) continue
    seen.add(command.name)
    items.push({ alias, command })
  }

  return {
    items: items
      .sort((left, right) => {
        const leftExact = left.alias.toLowerCase() === query ? 0 : 1
        const rightExact = right.alias.toLowerCase() === query ? 0 : 1
        return leftExact - rightExact || left.alias.localeCompare(right.alias)
      })
      .slice(0, 8),
  }
}

function isSlashMenuCandidate(value: string) {
  return /^\/[^\s]*$/.test(value)
}

function slashCommandCategoryLabel(category?: OpenClawChatSlashCommand['category']) {
  switch (category) {
    case 'docks':
      return 'Dock'
    case 'management':
      return 'Mgmt'
    case 'media':
      return 'Media'
    case 'options':
      return 'Option'
    case 'session':
      return 'Session'
    case 'status':
      return 'Status'
    case 'tools':
      return 'Tool'
    default:
      return 'Cmd'
  }
}

function slashCommandIcon(category?: OpenClawChatSlashCommand['category']) {
  switch (category) {
    case 'docks':
      return 'lucide:panel-left'
    case 'management':
      return 'lucide:settings'
    case 'media':
      return 'lucide:volume-2'
    case 'options':
      return 'lucide:sliders-horizontal'
    case 'session':
      return 'lucide:messages-square'
    case 'status':
      return 'lucide:circle-help'
    case 'tools':
      return 'lucide:wrench'
    default:
      return 'lucide:slash'
  }
}

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: OpenClawChatAttachmentDraft
  onRemove: () => void
}) {
  const isImage = attachment.category === 'image'
  const previewUrl = isImage ? buildAttachmentDataUrl(attachment) : ''

  return (
    <div className="group relative flex h-16 w-16 shrink-0 overflow-hidden rounded-system-lg border border-border bg-background shadow-surface">
      {previewUrl ? (
        <img
          alt={attachment.name}
          className="h-full w-full object-cover"
          src={previewUrl}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-muted">
          <Icon icon="lucide:file" className="size-5" />
          <span className="w-full truncate text-center text-[10px] leading-3">{attachment.name}</span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-background/45 opacity-0 transition-opacity group-hover:opacity-100" />
      <button
        aria-label="移除附件"
        className="absolute left-1/2 top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground opacity-0 shadow-surface backdrop-blur transition-[background,color,opacity,transform] hover:bg-danger hover:text-danger-foreground group-hover:opacity-100"
        type="button"
        onClick={onRemove}
      >
        <Icon icon="lucide:x" className="size-4" />
      </button>
      {previewUrl ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/80 to-transparent px-1 pb-1 pt-4 opacity-0 transition-opacity group-hover:opacity-100">
          <div className="truncate text-[10px] leading-3 text-foreground">{attachment.name}</div>
        </div>
      ) : null}
    </div>
  )
}

function ModelSelector({
  isDisabled,
  isSwitching,
  onChange,
  options,
  value,
}: {
  isDisabled?: boolean
  isSwitching: boolean
  onChange: (value: string) => void
  options: OpenClawChatModelOption[]
  value: string
}) {
  const selected = options.find((option) => option.id === value)

  if (!options.length) {
    return (
      <Button isIconOnly aria-label="暂无模型" isDisabled size="sm" variant="ghost">
        <Icon icon="lucide:cpu" className="size-4" />
      </Button>
    )
  }

  return (
    <Dropdown>
      <Button aria-label="选择对话模型" isDisabled={isDisabled} size="sm" variant="tertiary">
        <span className="flex min-w-0 items-center gap-1.5">
          {isSwitching ? (
            <Spinner color="current" size="sm" />
          ) : (
            <Icon icon="lucide:sparkles" className="size-3.5 shrink-0 text-muted" />
          )}
          <span className="max-w-20 truncate text-xs font-medium">{isSwitching ? '切换中' : selected?.label || value || '模型'}</span>
        </span>
      </Button>
      <Dropdown.Popover className="min-w-[auto]">
      <div className="max-h-[50vh] overflow-y-auto">
        <Dropdown.Menu
          
          selectedKeys={new Set([value])}
          selectionMode="single"
          onSelectionChange={(keys) => {
            const nextKey = Array.from(keys)[0]
            if (nextKey) onChange(String(nextKey))
          }}
        >
          {options.map((option) => (
            <Dropdown.Item key={option.id} id={option.id} textValue={`${option.label} ${option.id}`}>
              <Dropdown.ItemIndicator type="dot" />
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Label className="truncate">{option.label}</Label>
                  {option.isPrimary ? (
                    <Chip color="accent" size="sm" variant="soft">
                      主模型
                    </Chip>
                  ) : null}
                </div>
                <p className="mt-1 truncate text-xs text-muted">
                  {option.provider}/{option.modelId}
                </p>
              </div>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
        </div>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function buildAttachmentDataUrl(attachment: OpenClawChatAttachmentDraft) {
  return `data:${attachment.mimeType || 'image/png'};base64,${attachment.data}`
}

export default ChatSendBox
