import type { ChangeEvent } from 'react'
import type { Selection } from '@heroui/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Chip, Dropdown, Input, Label, Modal, toast } from '@heroui/react'
import { Icon } from '@iconify/react'
import DashboardLayout from '@/layouts/Dashboard'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useClientVersion } from '@/hooks/useClientVersion'
import { appConfig } from '@/stores/config'
import { openExternalUrl } from '@/utils/openExternalUrl'

interface ConnectItem {
  description?: string
  enabled?: boolean
  id: string
  link: string
  name: string
  qrImage: string
  type?: string
}

interface AdItem {
  buttonText?: string
  description: string
  enabled?: boolean
  icon: string
  id: string
  link: string
  title: string
}

interface AdGroup {
  content: AdItem[]
  description?: string
  enabled?: boolean
  id: string
  title: string
}

interface FeedbackAttachment {
  file: File
  id: string
  isImage: boolean
  previewUrl: string
}

type FeedbackType = 'cooperation' | 'bug' | 'update' | 'ui' | 'performance' | 'feature' | 'other'

const feedbackTypeOptions: Array<{ label: string; value: FeedbackType }> = [
  { label: '合作咨询', value: 'cooperation' },
  { label: '问题反馈', value: 'bug' },
  { label: '更新建议', value: 'update' },
  { label: '界面体验', value: 'ui' },
  { label: '性能问题', value: 'performance' },
  { label: '功能建议', value: 'feature' },
  { label: '其它', value: 'other' },
]

const featureCards = [
  {
    icon: 'lucide:monitor-cog',
    title: '统一控制台',
    description: '集中管理 OpenClaw、Hermes、CC-Connect 的服务状态、运行日志和配置入口。',
  },
  {
    icon: 'lucide:brain-circuit',
    title: '模型与智能体',
    description: '维护模型供应商、智能体配置、技能插件和消息渠道，让运行环境更容易复用。',
  },
  {
    icon: 'lucide:terminal-square',
    title: '开发者工作流',
    description: '内置终端、任务看板、会话管理和工作区文件浏览，适合日常调试和交付。',
  },
  {
    icon: 'lucide:radio-tower',
    title: '服务集成',
    description: '支持多套后端服务的安装、启动、配置和诊断，减少跨工具切换成本。',
  },
]

const acknowledgements = [
  {
    description: '本地优先的开源个人 AI 助手平台，连接模型、工具与消息渠道，让智能体能在你的设备上持续执行真实任务。',
    icon: '/assets/images/OpenClaw-White.png',
    link: 'https://openclaw.ai',
    title: 'OpenClaw',
  },
  {
    description: 'Nous Research 的自学习智能体，内置学习循环，可从使用经验中沉淀记忆、技能与跨会话上下文。',
    icon: '/assets/images/Hermes-White.png',
    link: 'https://hermes-agent.nousresearch.com/',
    title: 'Hermes',
  },
  {
    description: '面向本地 AI Agent 的消息桥接工具，把 Claude Code、Codex 等命令行 Agent 接入飞书、钉钉、Telegram、Discord 等平台。',
    icon: '/assets/images/CC-Connect-White.png',
    link: 'https://github.com/chenhg5/cc-connect',
    title: 'CC-Connect',
  },
]

function AboutPage() {
  usePageTitle('关于')

  const clientVersion = useClientVersion()
  const attachmentInputRef = useRef<HTMLInputElement | null>(null)
  const feedbackAttachmentsRef = useRef<FeedbackAttachment[]>([])
  const [connectTitle, setConnectTitle] = useState('')
  const [connectDescription, setConnectDescription] = useState('')
  const [connectItems, setConnectItems] = useState<ConnectItem[]>([])
  const [promotionTitle, setPromotionTitle] = useState('')
  const [promotionDescription, setPromotionDescription] = useState('')
  const [promotionItems, setPromotionItems] = useState<ConnectItem[]>([])
  const [adGroups, setAdGroups] = useState<AdGroup[]>([])
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)
  const [feedbackTypes, setFeedbackTypes] = useState<FeedbackType[]>([])
  const [feedbackTitle, setFeedbackTitle] = useState('')
  const [feedbackContact, setFeedbackContact] = useState('')
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [feedbackAttachments, setFeedbackAttachments] = useState<FeedbackAttachment[]>([])

  useEffect(() => {
    feedbackAttachmentsRef.current = feedbackAttachments
  }, [feedbackAttachments])

  const selectedFeedbackLabels = useMemo(() => {
    return feedbackTypes.map((type) => feedbackTypeOptions.find((item) => item.value === type)?.label || type).join(' / ')
  }, [feedbackTypes])

  const loadAboutConfig = useCallback(async () => {
    const tasks: Promise<void>[] = []

    if (appConfig.CONNECT_URL) {
      tasks.push(
        fetchConfig(appConfig.CONNECT_URL)
          .then((payload) => {
            setConnectTitle(String(payload.title || ''))
            setConnectDescription(String(payload.description || ''))
            setConnectItems(filterEnabledItems<ConnectItem>(payload.items))
          })
          .catch(() => undefined),
      )
    }

    if (appConfig.PROMOTION_URL) {
      tasks.push(
        fetchConfig(appConfig.PROMOTION_URL)
          .then((payload) => {
            setPromotionTitle(String(payload.title || ''))
            setPromotionDescription(String(payload.description || ''))
            setPromotionItems(filterEnabledItems<ConnectItem>(payload.items))
          })
          .catch(() => undefined),
      )
    }

    if (appConfig.ABOUT_URL) {
      tasks.push(
        fetchConfig(appConfig.ABOUT_URL)
          .then((payload) => {
            const groups = filterEnabledItems<AdGroup>(payload.items)
              .map((group) => ({
                ...group,
                content: filterEnabledItems<AdItem>(group.content),
              }))
              .filter((group) => group.content.length > 0)
            setAdGroups(groups)
          })
          .catch(() => undefined),
      )
    }

    await Promise.allSettled(tasks)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAboutConfig()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadAboutConfig])

  useEffect(() => {
    return () => {
      feedbackAttachmentsRef.current.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      })
    }
  }, [])

  const resetFeedbackForm = useCallback(() => {
    feedbackAttachments.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
    })
    setFeedbackTypes([])
    setFeedbackTitle('')
    setFeedbackContact('')
    setFeedbackMessage('')
    setFeedbackAttachments([])
    if (attachmentInputRef.current) attachmentInputRef.current.value = ''
  }, [feedbackAttachments])

  const handleAttachmentChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    const nextAttachments: FeedbackAttachment[] = []

    for (const file of files) {
      if (!isSupportedAttachment(file)) {
        toast.warning(`${file.name} 类型不支持`)
        continue
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.warning(`${file.name} 超过 10MB`)
        continue
      }

      const isImage = file.type.startsWith('image/')
      nextAttachments.push({
        file,
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        isImage,
        previewUrl: isImage ? URL.createObjectURL(file) : '',
      })
    }

    if (nextAttachments.length) {
      setFeedbackAttachments((current) => [...current, ...nextAttachments])
    }

    event.target.value = ''
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setFeedbackAttachments((current) => {
      const target = current.find((item) => item.id === id)
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
      return current.filter((item) => item.id !== id)
    })
  }, [])

  const submitFeedback = useCallback(async () => {
    if (!feedbackTypes.length) {
      toast.warning('请选择反馈类型')
      return
    }
    if (!feedbackTitle.trim()) {
      toast.warning('请输入反馈标题')
      return
    }
    if (feedbackTitle.trim().length > 100) {
      toast.warning('反馈标题不能超过 100 字')
      return
    }
    if (!feedbackMessage.trim()) {
      toast.warning('请输入反馈内容')
      return
    }
    if (feedbackMessage.trim().length > 1000) {
      toast.warning('反馈内容不能超过 1000 字')
      return
    }
    if (feedbackContact.trim() && !validateContact(feedbackContact.trim())) {
      toast.warning('联系方式需要是邮箱或手机号')
      return
    }
    if (!appConfig.WPUSH_KEY) {
      toast.warning('缺少 WPUSH_KEY，无法提交反馈')
      return
    }

    setFeedbackSubmitting(true)
    try {
      const uploadedAttachments = await uploadAttachments(feedbackAttachments)
      const attachmentMarkdown = uploadedAttachments.length
        ? `\n\n## 附件\n\n${uploadedAttachments.map((item) => item.isImage ? `![${item.name}](${item.url})` : `[${item.name}](${item.url})`).join('\n')}`
        : ''
      const messageContent = `
**新的 ${appConfig.APP_NAME} 反馈**

- **问题类型**: ${selectedFeedbackLabels}
- **标题**: ${feedbackTitle.trim()}
- **联系方式**: ${feedbackContact.trim() || '未填写'}
- **反馈内容**:
${feedbackMessage.trim()}

---
应用: ${appConfig.APP_NAME}
版本: ${clientVersion}
页面: ${window.location.href}
提交时间: ${new Date().toLocaleString('zh-CN')}
${attachmentMarkdown}
`.trim()

      const response = await fetch('https://api.wpush.cn/api/v1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apikey: appConfig.WPUSH_KEY,
          title: `${appConfig.APP_NAME} - ${feedbackTitle.trim()}`,
          content: messageContent,
        }),
      })

      if (!response.ok) throw new Error(`请求失败: ${response.status}`)
      const result = await response.json()
      if (!(result?.code === 200 || result?.success)) {
        throw new Error(result?.message || '提交失败')
      }

      toast.success('反馈已发送')
      setFeedbackOpen(false)
      resetFeedbackForm()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '反馈提交失败')
    } finally {
      setFeedbackSubmitting(false)
    }
  }, [clientVersion, feedbackAttachments, feedbackContact, feedbackMessage, feedbackTitle, feedbackTypes.length, resetFeedbackForm, selectedFeedbackLabels])

  const copyrightText = useMemo(() => {
    const year = String(new Date().getFullYear())
    const raw = appConfig.APP_COPYRIGHT?.trim()
    if (!raw) return `${year} ${appConfig.APP_NAME}`
    return raw
      .replace(/\b\d{4}\b/, year)
      .replace(/^Copyright\s*©\s*/i, '')
      .replace(/^©\s*/i, '')
  }, [])

  return (
    <DashboardLayout>
      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-6">
        <section className="flex flex-col items-center gap-3 text-center my-10">
          <img src={appConfig.APP_LOGO} alt={appConfig.APP_NAME} className="h-36 w-auto object-contain sm:h-48" />
          <div className="flex flex-wrap items-center justify-center gap-3 mt-4">
            <h1 className="text-2xl font-semibold text-foreground">{appConfig.APP_NAME}</h1>
            <Chip color="success" variant="primary">v{clientVersion}</Chip>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-muted">{appConfig.APP_DESCRIPTION}</p>
        </section>

        <section className="flex flex-col gap-4">
          <Card>
            <Card.Content>
              <div className="flex items-center gap-3 justify-between">
                <div className="flex flex-col gap-3">
                  <Card.Title>About</Card.Title>
                  <Card.Description>
                    面向智能体运行环境的管理控制台，用于把服务、配置、日志和生态扩展收拢到一个工作台里。
                  </Card.Description>
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="tertiary" onClick={() => void openExternalUrl('https://github.com/onenov/agentbox')}>
                    <Icon icon="lucide:github" className="size-4" />
                    GitHub
                  </Button>
                  <Button variant="tertiary" onClick={() => void openExternalUrl('https://agent.orence.net/')}>
                    <Icon icon="lucide:globe" className="size-4" />
                    官网
                  </Button>
                </div>
              </div>


            </Card.Content>
          </Card>
          <div className="grid gap-4 sm:grid-cols-2">
            {featureCards.map((item) => (
              <Card key={item.title}>
                <Card.Content>
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                      <Icon icon={item.icon} className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <Card.Title className="text-base">{item.title}</Card.Title>
                      <Card.Description className="leading-6">{item.description}</Card.Description>
                    </div>
                  </div>
                </Card.Content>
              </Card>
            ))}
          </div>
        </section>

        <Card>
          <Card.Content>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
                  <Icon icon="lucide:message-square-warning" className="size-6" />
                </div>
                <div>
                  <Card.Title className="text-base">反馈与协作</Card.Title>
                  <Card.Description className="leading-6">遇到问题、想要新能力，或希望一起改进产品，都可以把上下文发给我们。</Card.Description>
                </div>
              </div>
              <Button className="shrink-0" variant="tertiary" onPress={() => setFeedbackOpen(true)}>
                <Icon icon="lucide:bug" className="size-4" />
                提交反馈
              </Button>
            </div>
          </Card.Content>
        </Card>

        {connectItems.length ? (
          <QrSection title={connectTitle || '公告'} description={connectDescription} items={connectItems} tone="success" />
        ) : null}

        {promotionItems.length ? (
          <QrSection title={promotionTitle || '推广'} description={promotionDescription} items={promotionItems} tone="accent" />
        ) : null}

        {adGroups.length ? (
          <div className="flex flex-col gap-4">
            {adGroups.map((group) => (
              <AdGroupSection key={group.id} group={group} />
            ))}
          </div>
        ) : null}

        <Card>
          <Card.Content>
            <Card.Title>致谢</Card.Title>
            <Card.Description>AgentBox 建立在多个开源与生态项目之上，感谢这些项目持续提供可靠的基础能力。</Card.Description>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {acknowledgements.map((item) => (
                <button key={item.title} type="button" className="block w-full text-left" onClick={() => void openExternalUrl(item.link)}>
                  <div className="flex h-full flex-col gap-3 rounded-2xl border border-border bg-content1 p-4 transition hover:border-accent/50">
                    <div className="flex items-center gap-3">
                      <img src={item.icon} alt={item.title} className="size-10 rounded-lg object-contain" />
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">{item.title}</div>

                      </div>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted">{item.description}</p>
                  </div>

                </button>
              ))}
            </div>
          </Card.Content>
        </Card>

        <p className="text-center text-xs leading-6 text-muted">
          © {copyrightText} · {appConfig.APP_AUTHOR}
        </p>

        <FeedbackModal
          attachmentInputRef={attachmentInputRef}
          attachments={feedbackAttachments}
          contact={feedbackContact}
          isOpen={feedbackOpen}
          isSubmitting={feedbackSubmitting}
          message={feedbackMessage}
          onAttachmentChange={handleAttachmentChange}
          onAttachmentPicker={() => attachmentInputRef.current?.click()}
          onContactChange={setFeedbackContact}
          onMessageChange={setFeedbackMessage}
          onOpenChange={setFeedbackOpen}
          onRemoveAttachment={removeAttachment}
          onSubmit={submitFeedback}
          onTitleChange={setFeedbackTitle}
          onTypesChange={setFeedbackTypes}
          selectedTypes={feedbackTypes}
          title={feedbackTitle}
        />
      </main>
    </DashboardLayout>
  )
}

function QrSection({ description, items, title, tone }: { description: string; items: ConnectItem[]; title: string; tone: 'accent' | 'success' }) {
  return (
    <Card>
      <Card.Content>
        <Card.Title>{title}</Card.Title>
        {description ? <Card.Description>{description}</Card.Description> : null}
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <button key={item.id} type="button" className="block w-full disabled:cursor-default" disabled={!item.link} onClick={() => void openExternalUrl(item.link)}>
              <div className={`flex h-full flex-col items-center gap-2 rounded-2xl border border-border bg-content1 p-4 text-center transition ${tone === 'success' ? 'hover:border-success/50' : 'hover:border-accent/50'}`}>
                <img src={item.qrImage} alt={item.name} className="size-40 rounded-lg bg-white object-contain p-1" />
                <div className="font-medium text-foreground">{item.name}</div>
                {item.description ? <p className="text-sm leading-6 text-muted">{item.description}</p> : null}
              </div>
            </button>
          ))}
        </div>
      </Card.Content>
    </Card>
  )
}

function AdGroupSection({ group }: { group: AdGroup }) {
  return (
    <Card>
      <Card.Content>
        <Card.Title>{group.title}</Card.Title>
        {group.description ? <Card.Description>{group.description}</Card.Description> : null}
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {group.content.map((item) => (
            <button key={`${group.id}-${item.id}`} type="button" className="block w-full text-left" onClick={() => void openExternalUrl(item.link)}>
              <div className="flex h-full flex-col gap-4 rounded-2xl border border-border bg-content1 p-4 transition hover:border-accent/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img src={item.icon} alt={item.title} className="size-8 rounded-full object-cover" />
                    <div className="font-medium text-foreground">{item.title}</div>
                  </div>

                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-foreground">
                    <Icon icon="lucide:arrow-up-right" className="size-4" />
                  </span>
                </div>

                {item.description ? <p className="text-sm leading-6 text-muted">{item.description}</p> : null}
              </div>
            </button>
          ))}
        </div>
      </Card.Content>
    </Card>
  )
}

function FeedbackModal({
  attachmentInputRef,
  attachments,
  contact,
  isOpen,
  isSubmitting,
  message,
  onAttachmentChange,
  onAttachmentPicker,
  onContactChange,
  onMessageChange,
  onOpenChange,
  onRemoveAttachment,
  onSubmit,
  onTitleChange,
  onTypesChange,
  selectedTypes,
  title,
}: {
  attachmentInputRef: React.RefObject<HTMLInputElement | null>
  attachments: FeedbackAttachment[]
  contact: string
  isOpen: boolean
  isSubmitting: boolean
  message: string
  onAttachmentChange: (event: ChangeEvent<HTMLInputElement>) => void
  onAttachmentPicker: () => void
  onContactChange: (value: string) => void
  onMessageChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onRemoveAttachment: (id: string) => void
  onSubmit: () => void
  onTitleChange: (value: string) => void
  onTypesChange: (types: FeedbackType[]) => void
  selectedTypes: FeedbackType[]
  title: string
}) {
  const selectedTypeLabels = selectedTypes
    .map((type) => feedbackTypeOptions.find((item) => item.value === type)?.label || type)
  const selectedTypeText = selectedTypeLabels.length ? selectedTypeLabels.join('、') : '请选择反馈类型'

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="sm:max-w-[680px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent/10 text-accent">
              <Icon icon="lucide:message-square-plus" className="size-5" />
            </Modal.Icon>
            <div>
              <Modal.Heading>提交反馈</Modal.Heading>
              <p className="mt-1 text-sm text-muted">描述问题、建议或合作想法，必要时附上截图或配置片段。</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            <Card>
              <div className="space-y-5">
                <input ref={attachmentInputRef} type="file" accept="image/*,.txt,.md,.json" multiple className="hidden" onChange={onAttachmentChange} />
                <div className="grid gap-2">
                  <Label htmlFor="feedback-title">标题</Label>
                  <Input id="feedback-title" placeholder="一句话说明你遇到的问题或建议" value={title} maxLength={100} variant="secondary" onChange={(event) => onTitleChange(event.target.value)} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>类型</Label>
                    <Dropdown>
                      <Button className="w-full justify-between" variant="tertiary" aria-label="选择反馈类型">
                        <span className="min-w-0 truncate">{selectedTypeText}</span>
                        <Icon icon="lucide:chevron-down" className="size-4 shrink-0 text-muted" />
                      </Button>
                      <Dropdown.Popover className="min-w-64" placement="bottom start">
                        <Dropdown.Menu
                          selectedKeys={new Set(selectedTypes)}
                          selectionMode="multiple"
                          onSelectionChange={(selection) => onTypesChange(selectionToFeedbackTypes(selection))}
                        >
                          {feedbackTypeOptions.map((item) => (
                            <Dropdown.Item key={item.value} id={item.value} textValue={item.label}>
                              <Dropdown.ItemIndicator />
                              <div className="flex min-w-0 items-center gap-3">
                                <Icon icon={feedbackTypeIcon(item.value)} className="size-4 shrink-0 text-muted" />
                                <Label className="min-w-0 truncate">{item.label}</Label>
                              </div>
                            </Dropdown.Item>
                          ))}
                        </Dropdown.Menu>
                      </Dropdown.Popover>
                    </Dropdown>
                  </div>
                  <div className="grid content-start gap-2">
                    <Label htmlFor="feedback-contact">联系方式</Label>
                    <Input id="feedback-contact" placeholder="邮箱或手机号，可选" value={contact} variant="secondary" onChange={(event) => onContactChange(event.target.value)} />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="feedback-message">内容</Label>
                  <textarea
                    id="feedback-message"
                    className="min-h-36 w-full resize-y rounded-2xl border border-border bg-content1 px-3 py-2 text-sm leading-6 text-foreground outline-none transition focus:border-accent"
                    maxLength={1000}
                    placeholder="请尽量描述复现步骤、预期行为、实际表现，或你希望加入的能力。"
                    value={message}
                    onChange={(event) => onMessageChange(event.target.value)}
                  />
                </div>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-foreground">附件</div>
                      <p className="mt-1 text-xs text-muted">支持图片、txt、md、json，单个文件不超过 10MB。</p>
                    </div>
                    <Button size="sm" variant="tertiary" onPress={onAttachmentPicker}>
                      <Icon icon="lucide:paperclip" className="size-4" />
                      添加附件
                    </Button>
                  </div>
                  {attachments.length ? (
                    <div className="flex flex-wrap gap-2">
                      {attachments.map((item) => (
                        <div key={item.id} className="flex items-center gap-2 rounded-2xl border border-border bg-content1 p-2">
                          {item.isImage ? (
                            <img src={item.previewUrl} alt={item.file.name} className="size-10 rounded object-cover" />
                          ) : (
                            <div className="flex size-10 items-center justify-center rounded bg-content2 text-muted">
                              <Icon icon="lucide:file-text" className="size-5" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="max-w-48 truncate text-sm font-medium text-foreground">{item.file.name}</div>
                            <div className="text-xs text-muted">{item.isImage ? 'Image' : 'File'}</div>
                          </div>
                          <Button isIconOnly size="sm" variant="ghost" aria-label={`移除 ${item.file.name}`} onPress={() => onRemoveAttachment(item.id)}>
                            <Icon icon="lucide:x" className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </Card>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" isDisabled={isSubmitting} onPress={() => onOpenChange(false)}>关闭</Button>
            <Button variant="primary" isPending={isSubmitting} onPress={onSubmit}>
              <Icon icon="lucide:send" className="size-4" />
              {isSubmitting ? '提交中' : '提交'}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function filterEnabledItems<T extends { enabled?: boolean }>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter((item): item is T => item && item.enabled !== false) : []
}

function selectionToFeedbackTypes(selection: Selection): FeedbackType[] {
  if (selection === 'all') return feedbackTypeOptions.map((item) => item.value)
  return Array.from(selection).filter((value): value is FeedbackType => (
    typeof value === 'string' && feedbackTypeOptions.some((item) => item.value === value)
  ))
}

function feedbackTypeIcon(type: FeedbackType) {
  switch (type) {
    case 'cooperation':
      return 'lucide:handshake'
    case 'bug':
      return 'lucide:bug'
    case 'update':
      return 'lucide:refresh-cw'
    case 'ui':
      return 'lucide:palette'
    case 'performance':
      return 'lucide:gauge'
    case 'feature':
      return 'lucide:sparkles'
    case 'other':
      return 'lucide:circle-help'
  }
}

async function fetchConfig(url: string) {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  return data?.data || {}
}

function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function validatePhone(phone: string) {
  return /^(\+?\d[\d\s-]{5,}\d)$/.test(phone)
}

function validateContact(contact: string) {
  return validateEmail(contact) || validatePhone(contact)
}

function isSupportedAttachment(file: File) {
  if (file.type.startsWith('image/')) return true
  const lowerName = file.name.toLowerCase()
  return lowerName.endsWith('.txt') || lowerName.endsWith('.md') || lowerName.endsWith('.json')
}

async function uploadAttachments(attachments: FeedbackAttachment[]) {
  const uploaded: Array<{ isImage: boolean; name: string; url: string }> = []

  for (const item of attachments) {
    const formData = new FormData()
    formData.append('file', item.file)
    formData.append('path', 'agentmanager/feedback/')

    const response = await fetch('https://upload.orence.net/upload', {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) throw new Error(`${item.file.name}: HTTP ${response.status}`)
    const result = await response.json()
    if (!result?.success || !result?.fileUrl) {
      throw new Error(result?.message || `${item.file.name}: 上传失败`)
    }

    uploaded.push({ name: item.file.name, url: String(result.fileUrl), isImage: item.isImage })
  }

  return uploaded
}

export default AboutPage
