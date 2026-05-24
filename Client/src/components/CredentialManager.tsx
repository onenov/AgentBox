import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Chip, ColorSwatchPicker, Input, Label, Modal, Popover, Separator, Spinner, Tooltip, toast } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useNavigate } from 'react-router-dom'
import { clearAuthToken, getAuthTokenPersistence, setAuthToken, verifyBackendAuthToken } from '@/api'
import type { AccessCredentialTarget } from '@/api/auth'
import { parseAccessCredential } from '@/api/auth'
import { useConfigStore } from '@/stores/config'
import { clearDashboardPageCache } from '@/utils/dashboardCache'
import {
  ACCESS_CREDENTIALS_CHANGED_EVENT,
  activateStoredAccessCredential,
  checkStoredAccessCredentialHealth,
  deleteStoredAccessCredential,
  getActiveAccessCredential,
  listStoredAccessCredentials,
  saveStoredAccessCredential,
  type StoredAccessCredential,
} from '@/utils/accessCredentials'

type CredentialState = 'idle' | 'loading' | 'saving' | 'using' | 'deleting'

export function useActiveAccessCredential() {
  const [credential, setCredential] = useState<StoredAccessCredential | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = () => {
      getActiveAccessCredential()
        .then((nextCredential) => {
          if (!cancelled) setCredential(nextCredential)
        })
        .catch(() => {
          if (!cancelled) setCredential(null)
        })
    }

    load()
    window.addEventListener(ACCESS_CREDENTIALS_CHANGED_EVENT, load)
    window.addEventListener('storage', load)
    return () => {
      cancelled = true
      window.removeEventListener(ACCESS_CREDENTIALS_CHANGED_EVENT, load)
      window.removeEventListener('storage', load)
    }
  }, [])

  return credential
}

function CredentialManagerButton() {
  const navigate = useNavigate()
  const setApiUrl = useConfigStore((state) => state.setApiUrl)
  const resetApiUrl = useConfigStore((state) => state.resetApiUrl)
  const activeCredential = useActiveAccessCredential()
  const [isOpen, setOpen] = useState(false)
  const [credentials, setCredentials] = useState<StoredAccessCredential[]>([])
  const [credentialInput, setCredentialInput] = useState('')
  const [labelInput, setLabelInput] = useState('')
  const [colorInput, setColorInput] = useState(credentialColorOptions[0])
  const [error, setError] = useState('')
  const [state, setState] = useState<CredentialState>('idle')
  const [testingCredentialId, setTestingCredentialId] = useState('')
  const [healthyCredentialIds, setHealthyCredentialIds] = useState<Set<string>>(() => new Set())
  const activeCredentialId = activeCredential?.id ?? ''
  const sortedCredentials = useMemo(() => {
    return [...credentials].sort((left, right) => {
      const leftTime = left.lastUsedAt || left.updatedAt
      const rightTime = right.lastUsedAt || right.updatedAt
      return rightTime.localeCompare(leftTime)
    })
  }, [credentials])

  const loadCredentials = useCallback(() => {
    setState((current) => current === 'idle' ? 'loading' : current)
    listStoredAccessCredentials()
      .then((items) => {
        setCredentials(items)
        setState((current) => current === 'loading' ? 'idle' : current)
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : '凭据读取失败'
        setError(message)
        setState((current) => current === 'loading' ? 'idle' : current)
      })
  }, [])

  useEffect(() => {
    loadCredentials()
    window.addEventListener(ACCESS_CREDENTIALS_CHANGED_EVENT, loadCredentials)
    return () => window.removeEventListener(ACCESS_CREDENTIALS_CHANGED_EVENT, loadCredentials)
  }, [loadCredentials])

  useEffect(() => {
    if (isOpen) loadCredentials()
  }, [isOpen, loadCredentials])

  const addCredential = useCallback(async () => {
    setError('')
    setState('saving')
    try {
      await saveStoredAccessCredential(credentialInput, labelInput, colorInput)
      setCredentialInput('')
      setLabelInput('')
      setColorInput(credentialColorOptions[0])
      toast.success('凭据已保存')
      loadCredentials()
    } catch (err) {
      const message = err instanceof Error ? err.message : '凭据保存失败'
      setError(message)
      toast.warning(message)
    } finally {
      setState('idle')
    }
  }, [colorInput, credentialInput, labelInput, loadCredentials])

  const useCredential = useCallback(async (credential: StoredAccessCredential) => {
    setError('')
    setState('using')
    try {
      const parsed = parseAccessCredential(credential.credential)
      await checkStoredAccessCredentialHealth(credential)
      setHealthyCredentialIds((current) => new Set(current).add(credential.id))
      await verifyBackendAuthToken(parsed.token, parsed.backendAddress)
      if (parsed.backendAddress) {
        setApiUrl(parsed.backendAddress, getAuthTokenPersistence())
      }
      setAuthToken(parsed.token, getAuthTokenPersistence())
      await activateStoredAccessCredential(credential.id)
      toast.success('已切换凭据')
      setOpen(false)
      navigate(credentialTargetRoute(parsed.target), { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : '凭据验证失败'
      setError(message)
      toast.warning(message)
    } finally {
      setState('idle')
    }
  }, [navigate, setApiUrl])

  const deleteCredential = useCallback(async (credential: StoredAccessCredential) => {
    setError('')
    setState('deleting')
    const deletingActiveCredential = credential.id === activeCredentialId
    try {
      await deleteStoredAccessCredential(credential.id)
      toast.success('凭据已删除')
      setHealthyCredentialIds((current) => {
        const next = new Set(current)
        next.delete(credential.id)
        return next
      })
      if (deletingActiveCredential) {
        clearAuthToken()
        resetApiUrl()
        clearDashboardPageCache()
        setOpen(false)
        navigate('/login', { replace: true })
        return
      }
      loadCredentials()
    } catch (err) {
      const message = err instanceof Error ? err.message : '凭据删除失败'
      setError(message)
      toast.warning(message)
    } finally {
      setState('idle')
    }
  }, [activeCredentialId, loadCredentials, navigate, resetApiUrl])

  const testCredential = useCallback(async (credential: StoredAccessCredential) => {
    setError('')
    setTestingCredentialId(credential.id)
    try {
      const payload = await checkStoredAccessCredentialHealth(credential)
      setHealthyCredentialIds((current) => new Set(current).add(credential.id))
      toast.success(`健康检查通过${typeof payload?.status === 'string' ? `：${payload.status}` : ''}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : '健康检查失败'
      setHealthyCredentialIds((current) => {
        const next = new Set(current)
        next.delete(credential.id)
        return next
      })
      setError(message)
      toast.warning(message)
    } finally {
      setTestingCredentialId('')
    }
  }, [])

  const isBusy = state === 'saving' || state === 'using' || state === 'deleting'
  const activeTarget = activeCredential?.target ?? 'all'
  const activeColor = normalizeHexColor(activeCredential?.color || targetColorMap[activeTarget])
  return (
    <>
      <Button
        isIconOnly
        aria-label="凭据管理"
        className="size-9 shrink-0 rounded-full border border-border bg-content1 text-foreground shadow-xs"
        variant="secondary"
        onPress={() => setOpen(true)}
      >
        <span className="grid size-8 place-items-center rounded-full text-white" style={{ backgroundColor: activeColor }}>
          <Icon icon="lucide:user-round-key" className="size-4" />
        </span>
      </Button>

      <Modal.Backdrop isOpen={isOpen} onOpenChange={setOpen} variant="opaque">
        <Modal.Container size="lg" scroll="inside">
          <Modal.Dialog className="sm:max-w-[640px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <Icon icon="lucide:key-round" className="size-5" />
              </Modal.Icon>
              <div>
                <Modal.Heading>凭据管理</Modal.Heading>
                <p className="mt-1 text-sm text-muted">保存多个登录凭据，并选择当前使用的凭据。</p>
              </div>
            </Modal.Header>
            <Modal.Body>
              <Card>
                <div className="grid gap-5 p-1">
                  <div className="grid gap-3">
                    <div className="grid gap-2">
                      <Label htmlFor="credential-label">名称</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          className="min-w-0 flex-1"
                          id="credential-label"
                          autoComplete="off"
                          placeholder="如生产 OpenClaw"
                          value={labelInput}
                          variant="secondary"
                          onChange={(event) => setLabelInput(event.target.value)}
                        />
                        <CredentialColorPicker value={colorInput} onChange={setColorInput} />
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="credential-value">访问凭据</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          className="flex-1"
                          id="credential-value"
                          autoComplete="off"
                          placeholder="anex:..."
                          value={credentialInput}
                          variant="secondary"
                          onChange={(event) => setCredentialInput(event.target.value)}
                        />
                        <Button variant="primary" isDisabled={isBusy || !credentialInput.trim()} onPress={() => void addCredential()}>
                          {state === 'saving' ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:plus" className="size-4" />}
                          添加
                        </Button>
                      </div>
                    </div>
                  </div>

                  {error ? (
                    <div className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm leading-6 text-danger">
                      <Icon icon="lucide:circle-alert" className="mt-1 size-4 shrink-0" />
                      <span>{error}</span>
                    </div>
                  ) : null}

                  <Separator />


                  <div className="grid gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-foreground">已保存凭据</h3>
                      <span className="text-xs text-muted">{sortedCredentials.length} 个</span>
                    </div>
                    {state === 'loading' ? (
                      <div className="flex items-center justify-center gap-2 rounded-system border border-border py-8 text-sm text-muted">
                        <Spinner size="sm" />
                        正在读取凭据
                      </div>
                    ) : sortedCredentials.length ? (
                      <div className="grid gap-2">
                        {sortedCredentials.map((credential) => (
                          <CredentialListItem
                            key={credential.id}
                            credential={credential}
                            isActive={credential.id === activeCredentialId}
                            isBusy={isBusy}
                            isHealthy={healthyCredentialIds.has(credential.id)}
                            isTesting={testingCredentialId === credential.id}
                            onDelete={() => void deleteCredential(credential)}
                            onTest={() => void testCredential(credential)}
                            onUse={() => void useCredential(credential)}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-system border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
                        暂无保存的凭据
                      </div>
                    )}
                  </div>


                </div>
              </Card>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  )
}

function CredentialListItem({
  credential,
  isActive,
  isBusy,
  isHealthy,
  isTesting,
  onDelete,
  onTest,
  onUse,
}: {
  credential: StoredAccessCredential
  isActive: boolean
  isBusy: boolean
  isHealthy: boolean
  isTesting: boolean
  onDelete: () => void
  onTest: () => void
  onUse: () => void
}) {
  const itemClassName = isActive
    ? 'flex items-center gap-3 rounded-system border border-accent bg-accent/10 p-3 shadow-xs'
    : 'flex items-center gap-3 rounded-system border border-border bg-content1 p-3'
  const credentialColor = getCredentialColor(credential)

  return (
    <div className={itemClassName}>
      <span className="h-10 w-1 shrink-0 rounded-full" style={{ backgroundColor: credentialColor }} />
      <CredentialAvatar color={credentialColor} target={credential.target} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{credential.label}</span>
          <Chip size="sm" variant="soft" color={isActive ? 'success' : 'default'}>
            {targetLabelMap[credential.target]}
          </Chip>
        </div>
        <p className="mt-1 truncate text-xs text-muted">{credential.backendAddress}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="secondary" isDisabled={isBusy || isActive} onPress={onUse}>
          切换
        </Button>
        <Tooltip delay={300}>
          <Button
            isIconOnly
            aria-label="测试后端健康检查"
            className={isHealthy ? 'text-success' : undefined}
            size="sm"
            variant="secondary"
            isDisabled={isBusy || isTesting}
            onPress={onTest}
          >
            {isTesting ? <Spinner color="current" size="sm" /> : <Icon icon={isHealthy ? 'lucide:badge-check' : 'lucide:activity'} className="size-4" />}
          </Button>
          <Tooltip.Content>{isHealthy ? '连通性已通过' : '检查连通性'}</Tooltip.Content>
        </Tooltip>
        <Tooltip delay={300}>
          <Button isIconOnly aria-label="删除凭据" size="sm" variant="danger-soft" isDisabled={isBusy} onPress={onDelete}>
            <Icon icon="lucide:trash-2" className="size-4" />
          </Button>
          <Tooltip.Content>删除凭据</Tooltip.Content>
        </Tooltip>
      </div>
    </div>
  )
}

function CredentialColorPicker({ onChange, value }: { onChange: (color: string) => void; value: string }) {
  return (
    <Popover>
      <Popover.Trigger>
        <Button
          isIconOnly
          aria-label="选择凭据颜色"
          className="size-10 shrink-0 rounded-full border border-border bg-content1 p-0"
          variant="secondary"
        >
          <span className="size-5 rounded-full" style={{ backgroundColor: value }} />
        </Button>
      </Popover.Trigger>
      <Popover.Content className="w-auto" offset={8} placement="bottom end">
        <Popover.Dialog className="p-3">
          <ColorSwatchPicker
            aria-label="凭据颜色"
            className="grid grid-cols-4 gap-2"
            value={value}
            onChange={(color) => onChange(normalizeHexColor(color.toString('hex')))}
          >
            {credentialColorOptions.map((color) => (
              <ColorSwatchPicker.Item key={color} color={color} aria-label={color}>
                <ColorSwatchPicker.Swatch />
                <ColorSwatchPicker.Indicator />
              </ColorSwatchPicker.Item>
            ))}
          </ColorSwatchPicker>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}

function CredentialAvatar({ color, target }: { color: string; target: AccessCredentialTarget }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full text-xs font-black text-white" style={{ backgroundColor: color }}>
      {targetInitialMap[target]}
    </span>
  )
}

function credentialTargetRoute(target: AccessCredentialTarget | undefined) {
  switch (target) {
    case 'cc':
      return '/dashboard/cc-service'
    case 'hermes':
      return '/dashboard/hermes'
    case 'all':
    case 'openclaw':
    default:
      return '/dashboard/openclaw'
  }
}

const targetInitialMap: Record<AccessCredentialTarget, string> = {
  all: 'A',
  cc: 'C',
  hermes: 'H',
  openclaw: 'O',
}

const targetLabelMap: Record<AccessCredentialTarget, string> = {
  all: '全部',
  cc: 'CC-Connect',
  hermes: 'Hermes',
  openclaw: 'OpenClaw',
}

const targetColorMap: Record<AccessCredentialTarget, string> = {
  all: '#3b82f6',
  cc: '#0891b2',
  hermes: '#7c3aed',
  openclaw: '#059669',
}

const credentialColorOptions = [
  '#3b82f6',
  '#f43f5e',
  '#d946ef',
  '#8b5cf6',
  '#06b6d4',
  '#10b981',
  '#84cc16',
  '#f59e0b',
]

function getCredentialColor(credential: StoredAccessCredential) {
  return normalizeHexColor(credential.color || targetColorMap[credential.target])
}

function normalizeHexColor(color: string) {
  const normalized = color.trim().toLowerCase()
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : '#3b82f6'
}

export default CredentialManagerButton
