import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Chip, Modal, Skeleton, toast } from '@heroui/react'
import { Icon } from '@iconify/react'
import type { HermesPairingRequest } from '@/api'
import { approveHermesPairingRequest, listHermesPairingRequests } from '@/api'

type PairingLoadState = 'error' | 'idle' | 'loading' | 'ready'

export function HermesPairingModal({
  isOpen,
  onApproved,
  onOpenChange,
  platform,
  platformLabel,
  profile,
}: {
  isOpen: boolean
  onApproved?: () => void
  onOpenChange: (open: boolean) => void
  platform: string
  platformLabel?: string
  profile?: string
}) {
  const [state, setState] = useState<PairingLoadState>('idle')
  const [requests, setRequests] = useState<HermesPairingRequest[]>([])
  const [error, setError] = useState('')
  const [approvingCode, setApprovingCode] = useState('')
  const label = platformLabel || platform

  const loadRequests = useCallback(async () => {
    if (!platform) return
    setState('loading')
    setError('')
    try {
      const result = await listHermesPairingRequests(platform, profile)
      setRequests(result.requests ?? [])
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : '配对审批列表加载失败')
      setState('error')
    }
  }, [platform, profile])

  useEffect(() => {
    if (!isOpen) return
    const timer = window.setTimeout(() => {
      void loadRequests()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [isOpen, loadRequests])

  const approveRequest = useCallback(async (request: HermesPairingRequest) => {
    if (!request.code || approvingCode) return
    setApprovingCode(request.code)
    try {
      const result = await approveHermesPairingRequest(platform, { code: request.code }, profile)
      toast.success(result.message || '配对请求已批准')
      onApproved?.()
      await loadRequests()
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : '配对请求批准失败')
    } finally {
      setApprovingCode('')
    }
  }, [approvingCode, loadRequests, onApproved, platform, profile])

  const isLoading = state === 'loading'
  const hasRequests = requests.length > 0

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="sm:max-w-[720px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
              <Icon icon="lucide:shield-check" className="size-5" />
            </Modal.Icon>
            <div className="min-w-0">
              <Modal.Heading>配对审批</Modal.Heading>
              <p className="mt-1 text-sm text-muted">{label} 待审批请求</p>
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="space-y-3">
              {error ? (
                <div className="rounded-xl bg-warning/10 p-3 text-sm leading-6 text-warning">
                  {error}
                </div>
              ) : null}

              {isLoading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((item) => (
                    <div key={item} className="rounded-2xl border border-border p-4">
                      <Skeleton className="h-5 w-36" />
                      <Skeleton className="mt-3 h-4 w-full" />
                      <Skeleton className="mt-2 h-4 w-2/3" />
                    </div>
                  ))}
                </div>
              ) : hasRequests ? (
                <div className="grid gap-3">
                  {requests.map((request) => (
                    <HermesPairingRequestCard
                      key={`${request.code}:${request.id}`}
                      request={request}
                      isApproving={approvingCode === request.code}
                      isDisabled={Boolean(approvingCode)}
                      onApprove={() => void approveRequest(request)}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center bg-surface">
                  <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-surface-secondary/50 text-muted">
                    <Icon icon="lucide:inbox" className="size-5" />
                  </div>
                  <p className="mt-3 text-sm font-medium text-foreground">暂无待审批请求</p>
                  <p className="mt-1 text-sm text-muted">收到新的 pairing code 后会显示在这里。</p>
                </div>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={() => onOpenChange(false)}>关闭</Button>
            <Button variant="primary" isDisabled={isLoading || Boolean(approvingCode)} onPress={() => void loadRequests()}>
              <Icon icon={isLoading ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={`size-4 ${isLoading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function HermesPairingRequestCard({
  isApproving,
  isDisabled,
  onApprove,
  request,
}: {
  isApproving: boolean
  isDisabled: boolean
  onApprove: () => void
  request: HermesPairingRequest
}) {
  const metaEntries = useMemo(() => readableMetaEntries(request), [request])
  const requester = requesterLabel(request)
  return (
    <Card>
      <Card.Content>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Card.Title className="break-all text-base">{requester}</Card.Title>
              <Chip variant="soft">{request.code}</Chip>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted">
              <PairingInfo icon="lucide:user-round" value={request.id || '未知发送者'} />
              <PairingInfo icon="lucide:clock-3" value={formatPairingTime(request.createdAt)} />
            </div>
            {metaEntries.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {metaEntries.map((item) => (
                  <Chip key={item.key} variant="soft">
                    {item.key}: {item.value}
                  </Chip>
                ))}
              </div>
            ) : null}
          </div>
          <Button className="shrink-0" variant="primary" isDisabled={isDisabled} isPending={isApproving} onPress={onApprove}>
            <Icon icon="lucide:check" className="size-4" />
            批准
          </Button>
        </div>
      </Card.Content>
    </Card>
  )
}

function PairingInfo({ icon, value }: { icon: string; value: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Icon icon={icon} className="size-3.5 shrink-0" />
      <span className="min-w-0 break-all">{value}</span>
    </span>
  )
}

function requesterLabel(request: HermesPairingRequest) {
  const userName = metaString(request.meta, 'userName')
  if (userName) return userName
  return request.id || request.code
}

function readableMetaEntries(request: HermesPairingRequest) {
  const meta = request.meta ?? {}
  return Object.entries(meta)
    .filter(([key, value]) => !['userName'].includes(key) && value != null && String(value).trim() !== '')
    .slice(0, 6)
    .map(([key, value]) => ({ key, value: String(value) }))
}

function metaString(meta: Record<string, unknown> | undefined, key: string) {
  const value = meta?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function formatPairingTime(value: string) {
  if (!value) return '未知时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
