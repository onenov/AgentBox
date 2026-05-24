import { Button, Modal } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useAppUpdateStore } from '@/stores/update'

function AppUpdateModal() {
  const contentLength = useAppUpdateStore((state) => state.contentLength)
  const currentVersion = useAppUpdateStore((state) => state.currentVersion)
  const downloadedBytes = useAppUpdateStore((state) => state.downloadedBytes)
  const downloadProgress = useAppUpdateStore((state) => state.downloadProgress)
  const install = useAppUpdateStore((state) => state.install)
  const installError = useAppUpdateStore((state) => state.installError)
  const latestVersion = useAppUpdateStore((state) => state.latestVersion)
  const notes = useAppUpdateStore((state) => state.notes)
  const packageUrl = useAppUpdateStore((state) => state.packageUrl)
  const pubDate = useAppUpdateStore((state) => state.pubDate)
  const status = useAppUpdateStore((state) => state.status)
  const target = useAppUpdateStore((state) => state.target)

  const isOpen = status === 'available'
    || status === 'installing'
    || status === 'restarting'
  const isInstalling = status === 'installing' || status === 'restarting'
  const progressLabel = status === 'restarting'
    ? '正在重启'
    : downloadProgress >= 100
      ? '正在安装更新'
      : '正在下载更新'

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={() => undefined} variant="opaque">
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="sm:max-w-[620px]">
          <Modal.Header>
            <Modal.Icon className="bg-warning/10 text-warning">
              <Icon icon="lucide:download" className="size-5" />
            </Modal.Icon>
            <div>
              <Modal.Heading>发现新版本</Modal.Heading>
              <p className="mt-1 text-sm text-muted">请安装更新后继续使用 AgentBox。</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="space-y-4">
              <div className="grid gap-3 rounded-lg border border-border bg-content1 p-4 text-sm sm:grid-cols-2">
                <InfoRow label="当前版本" value={`v${currentVersion}`} />
                <InfoRow label="最新版本" value={`v${latestVersion}`} />
                {target ? <InfoRow label="更新目标" value={target} /> : null}
                {pubDate ? <InfoRow label="发布时间" value={formatDate(pubDate)} /> : null}
              </div>
              {notes ? (
                <div className="rounded-lg border border-border bg-content1 p-4">
                  <div className="text-sm font-medium text-foreground">更新内容</div>
                  <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted">{notes}</div>
                </div>
              ) : null}
              {isInstalling ? (
                <div className="rounded-lg border border-border bg-content1 p-4">
                  <div className="flex items-center justify-between gap-4 text-sm">
                    <span className="font-medium text-foreground">{progressLabel}</span>
                    <span className="tabular-nums text-muted">{downloadProgress}%</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-tertiary)]">
                    <div
                      className="h-full rounded-full bg-[var(--accent)] transition-all"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {contentLength > 0 ? `${formatBytes(downloadedBytes)} / ${formatBytes(contentLength)}` : '正在准备下载更新包'}
                  </p>
                </div>
              ) : null}
              {installError ? (
                <div className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm leading-6 text-danger">
                  <Icon icon="lucide:circle-alert" className="mt-1 size-4 shrink-0" />
                  <span>{installError}</span>
                </div>
              ) : null}
              <div className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm leading-6 text-warning">
                <Icon icon="lucide:circle-alert" className="mt-1 size-4 shrink-0" />
                <span>此弹窗不可关闭。点击安装后会自动下载更新包，安装完成后客户端会重新启动。</span>
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button
              fullWidth
              variant="primary"
              isDisabled={isInstalling}
              onPress={() => void install()}
            >
              <Icon icon={isInstalling ? 'lucide:loader-circle' : 'lucide:download'} className={isInstalling ? 'size-4 animate-spin' : 'size-4'} />
              {status === 'restarting' ? '正在重启' : isInstalling ? '正在安装' : packageUrl ? '安装并重启' : '安装更新'}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 truncate font-medium text-foreground">{value}</span>
    </div>
  )
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN')
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`
}

export default AppUpdateModal
