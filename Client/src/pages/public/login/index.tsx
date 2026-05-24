import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Checkbox, Chip, Input, Label, Popover, Spinner, Tooltip, toast } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getAuthToken, getAuthTokenPersistence, parseAccessCredential, setAuthToken, verifyBackendAuthToken } from '@/api'
import type { AccessCredentialTarget } from '@/api/auth'
import TauriTrafficLights from '@/components/Tauri/TrafficLights'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useConfigStore } from '@/stores/config'
import {
  ACCESS_CREDENTIALS_CHANGED_EVENT,
  activateStoredAccessCredential,
  checkAccessCredentialHealth,
  checkStoredAccessCredentialHealth,
  clearActiveAccessCredential,
  listStoredAccessCredentials,
  saveAndActivateAccessCredential,
  type StoredAccessCredential,
} from '@/utils/accessCredentials'

function LoginPage() {
  usePageTitle('登录')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const appName = useConfigStore((state) => state.appName)
  const appLogo = useConfigStore((state) => state.appLogo)
  const appCopyright = useConfigStore((state) => state.appCopyright)
  const setApiUrl = useConfigStore((state) => state.setApiUrl)
  const resetApiUrl = useConfigStore((state) => state.resetApiUrl)
  const [token, setToken] = useState(() => getAuthToken())
  const [autoLogin, setAutoLogin] = useState(() => getAuthTokenPersistence() === 'persistent')
  const [error, setError] = useState('')
  const [state, setState] = useState<'checking' | 'idle' | 'submitting'>('checking')
  const [savedCredentials, setSavedCredentials] = useState<StoredAccessCredential[]>([])
  const [savedCredentialsState, setSavedCredentialsState] = useState<'idle' | 'loading'>('loading')
  const [savedCredentialSubmittingId, setSavedCredentialSubmittingId] = useState('')
  const [testingCredentialId, setTestingCredentialId] = useState('')
  const [healthyCredentialIds, setHealthyCredentialIds] = useState<Set<string>>(() => new Set())
  const [credentialPickerOpen, setCredentialPickerOpen] = useState(false)
  const [urlCredentialState, setUrlCredentialState] = useState<'handled' | 'none' | 'processing'>(() => getCachedURLLoginCredential() ? 'processing' : 'none')
  const redirectParam = searchParams.get('redirect')
  const hasExplicitRedirect = useMemo(() => isValidRedirect(redirectParam), [redirectParam])
  const redirectPath = useMemo(() => normalizeRedirect(redirectParam), [redirectParam])

  const authenticateCredential = useCallback(async (rawCredential: string, persistence: 'persistent' | 'session', backendAddressOverride = '') => {
    const credential = parseAccessCredential(rawCredential)
    const backendAddress = credential.backendAddress || normalizeURLBackendAddress(backendAddressOverride)
    if (backendAddress) {
      await checkAccessCredentialHealth({ ...credential, backendAddress })
    }
    await verifyBackendAuthToken(credential.token, backendAddress || credential.backendAddress)
    if (backendAddress) {
      setApiUrl(backendAddress, persistence)
    } else {
      resetApiUrl()
    }
    setAuthToken(credential.token, persistence)
    if (credential.backendAddress && credential.target) {
      await saveAndActivateAccessCredential(rawCredential, credential)
    } else {
      await clearActiveAccessCredential()
    }
    return credential
  }, [resetApiUrl, setApiUrl])

  useEffect(() => {
    if (urlCredentialState !== 'processing') return
    let cancelled = false

    const payload = getCachedURLLoginCredential()
    if (!payload?.credential) {
      setUrlCredentialState('none')
      return
    }

    setToken(payload.credential)
    setAutoLogin(payload.persistence === 'persistent')
    setState('submitting')
    setError('')

    authenticateCredential(payload.credential, payload.persistence, payload.backendAddress)
      .then((credential) => {
        if (cancelled) return
        clearCachedURLLoginCredential()
        toast.success('登录成功')
        navigate(hasExplicitRedirect ? redirectPath : credentialTargetRoute(credential.target), { replace: true })
      })
      .catch((err) => {
        if (cancelled) return
        clearCachedURLLoginCredential()
        const message = err instanceof Error ? err.message : 'URL 访问凭证验证失败'
        setError(message)
        setState('idle')
        setUrlCredentialState('handled')
        toast.warning('无法进入控制台，请检查 URL 访问凭证')
      })

    return () => {
      cancelled = true
    }
  }, [authenticateCredential, hasExplicitRedirect, navigate, redirectPath, urlCredentialState])

  useEffect(() => {
    if (urlCredentialState !== 'none') return
    let cancelled = false

    const timer = window.setTimeout(() => {
      verifyBackendAuthToken()
        .then(() => {
          if (cancelled) return
          navigate(redirectPath, { replace: true })
        })
        .catch(() => {
          if (cancelled) return
          setState('idle')
        })
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [navigate, redirectPath, urlCredentialState])

  useEffect(() => {
    let cancelled = false

    const load = () => {
      setSavedCredentialsState('loading')
      listStoredAccessCredentials()
        .then((items) => {
          if (cancelled) return
          setSavedCredentials(sortStoredCredentials(items))
          setSavedCredentialsState('idle')
        })
        .catch(() => {
          if (cancelled) return
          setSavedCredentials([])
          setSavedCredentialsState('idle')
        })
    }

    load()
    window.addEventListener(ACCESS_CREDENTIALS_CHANGED_EVENT, load)
    return () => {
      cancelled = true
      window.removeEventListener(ACCESS_CREDENTIALS_CHANGED_EVENT, load)
    }
  }, [])

  const submit = useCallback(async () => {
    const persistence = autoLogin ? 'persistent' : 'session'
    setState('submitting')
    setError('')

    try {
      const credential = await authenticateCredential(token, persistence)
      toast.success('登录成功')
      navigate(hasExplicitRedirect ? redirectPath : credentialTargetRoute(credential.target), { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Token 验证失败'
      setError(message)
      toast.warning('无法进入控制台，请检查访问凭证')
    } finally {
      setState('idle')
    }
  }, [authenticateCredential, autoLogin, hasExplicitRedirect, navigate, redirectPath, token])

  const loginWithSavedCredential = useCallback(async (credential: StoredAccessCredential) => {
    const persistence = autoLogin ? 'persistent' : 'session'
    setSavedCredentialSubmittingId(credential.id)
    setError('')

    try {
      const parsed = parseAccessCredential(credential.credential)
      await checkStoredAccessCredentialHealth(credential)
      setHealthyCredentialIds((current) => new Set(current).add(credential.id))
      await verifyBackendAuthToken(parsed.token, parsed.backendAddress)
      if (parsed.backendAddress) {
        setApiUrl(parsed.backendAddress, persistence)
      }
      setAuthToken(parsed.token, persistence)
      await activateStoredAccessCredential(credential.id)
      toast.success('登录成功')
      setCredentialPickerOpen(false)
      navigate(hasExplicitRedirect ? redirectPath : credentialTargetRoute(parsed.target), { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : '凭据验证失败'
      setError(message)
      toast.warning(message)
    } finally {
      setSavedCredentialSubmittingId('')
    }
  }, [autoLogin, hasExplicitRedirect, navigate, redirectPath, setApiUrl])

  const testSavedCredential = useCallback(async (credential: StoredAccessCredential) => {
    setTestingCredentialId(credential.id)
    setError('')

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

  return (
    <>
      <div className="fixed inset-0 z-0" data-tauri-drag-region />

      <div className="fixed left-5 top-4 z-50">
        <TauriTrafficLights />
      </div>

      <section className="relative z-10 flex w-full max-w-md flex-col gap-5">
        <div className="flex items-center gap-3" data-tauri-drag-region>
          <img src={appLogo} alt={appName} className="size-11 rounded-2xl shadow-surface" draggable={false} />
          <div className="min-w-0">
            <h1 className="truncate text-3xl font-bold">{appName}</h1>
          </div>
        </div>

        <Card>
          <Card.Header>
            <div className="flex min-w-0 items-center gap-3">
              <Popover isOpen={credentialPickerOpen} onOpenChange={setCredentialPickerOpen}>
                <Popover.Trigger>
                  <Button
                    isIconOnly
                    aria-label="显示已保存凭据"
                    className="size-11 shrink-0 rounded-full"
                    isDisabled={state === 'checking' || (!savedCredentials.length && savedCredentialsState !== 'loading')}
                    type="button"
                    variant="secondary"
                  >
                    <Icon icon="lucide:user-round-key" className="size-5" />
                  </Button>
                </Popover.Trigger>
                <Popover.Content className="w-[420px] max-w-[calc(100vw-32px)]" offset={8} placement="bottom left">
                  <Popover.Dialog className="p-2">
                    <SavedCredentialFloatingPanel
                      credentials={savedCredentials}
                      healthyCredentialIds={healthyCredentialIds}
                      isLoading={savedCredentialsState === 'loading'}
                      submittingId={savedCredentialSubmittingId}
                      testingId={testingCredentialId}
                      onLogin={loginWithSavedCredential}
                      onTest={testSavedCredential}
                    />
                  </Popover.Dialog>
                </Popover.Content>
              </Popover>
              <div className="min-w-0">
                <Card.Title>欢迎回来</Card.Title>
                <Card.Description>{state === 'checking' ? '正在确认当前设备的访问权限。' : '请输入访问凭证继续使用控制台。'}</Card.Description>
              </div>
            </div>
          </Card.Header>
          <Card.Content>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                void submit()
              }}
            >
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  autoComplete="current-password"
                  aria-label="访问凭证"
                  className="min-w-0 flex-1"
                  placeholder="访问凭证"
                  type="password"
                  value={token}
                  variant="secondary"
                  disabled={state === 'checking'}
                  onChange={(event) => setToken(event.target.value)}
                />
                <Button
                  isIconOnly
                  aria-label="进入控制台"
                  className="size-11 shrink-0 rounded-full"
                  isDisabled={state === 'checking' || state === 'submitting'}
                  type="submit"
                  variant="primary"
                >
                  {state === 'submitting' ? <Spinner color="current" size="sm" /> : <span className="text-xs font-black">GO</span>}
                </Button>
              </div>

              <Checkbox id="auto-login" isDisabled={state === 'checking'} isSelected={autoLogin} onChange={setAutoLogin}>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Checkbox.Content>
                  <Label htmlFor="auto-login">自动登录</Label>
                </Checkbox.Content>
              </Checkbox>

              {error ? (
                <div className="flex items-start gap-2 rounded-2xl bg-danger/10 px-3 py-2 text-sm leading-6 text-danger">
                  <Icon icon="lucide:circle-alert" className="mt-1 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}
            </form>
          </Card.Content>
        </Card>

        <p className="text-center text-xs text-muted" data-tauri-drag-region>
          {appCopyright}
        </p>
      </section>
    </>
  )
}

function SavedCredentialFloatingPanel({
  credentials,
  healthyCredentialIds,
  isLoading,
  submittingId,
  testingId,
  onLogin,
  onTest,
}: {
  credentials: StoredAccessCredential[]
  healthyCredentialIds: Set<string>
  isLoading: boolean
  submittingId: string
  testingId: string
  onLogin: (credential: StoredAccessCredential) => void
  onTest: (credential: StoredAccessCredential) => void
}) {
  return (
    <div className="text-left">
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-system py-5 text-sm text-muted">
          <Spinner size="sm" />
          正在读取凭据
        </div>
      ) : (
        <div className="grid max-h-72 gap-2 overflow-y-auto">
          {credentials.map((credential) => (
            <SavedCredentialLoginItem
              key={credential.id}
              credential={credential}
              isHealthy={healthyCredentialIds.has(credential.id)}
              isPending={submittingId === credential.id}
              isTesting={testingId === credential.id}
              onLogin={() => onLogin(credential)}
              onTest={() => onTest(credential)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SavedCredentialLoginItem({
  credential,
  isHealthy,
  isPending,
  isTesting,
  onLogin,
  onTest,
}: {
  credential: StoredAccessCredential
  isHealthy: boolean
  isPending: boolean
  isTesting: boolean
  onLogin: () => void
  onTest: () => void
}) {
  const color = normalizeCredentialColor(credential.color || targetColorMap[credential.target])

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl bg-background border border-border p-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full text-xs font-black text-white" style={{ backgroundColor: color }}>
        {targetInitialMap[credential.target]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{credential.label}</span>
          <Chip size="sm" variant="soft" color="default">
            {targetLabelMap[credential.target]}
          </Chip>
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted">{credential.backendAddress}</span>
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <Tooltip delay={300}>
          <Button
            isIconOnly
            aria-label="测试后端健康检查"
            className={isHealthy ? 'text-success' : undefined}
            size="sm"
            variant="ghost"
            isDisabled={isPending || isTesting}
            onPress={onTest}
          >
            {isTesting ? <Spinner color="current" size="sm" /> : <Icon icon={isHealthy ? 'lucide:badge-check' : 'lucide:activity'} className="size-4" />}
          </Button>
          <Tooltip.Content>{isHealthy ? '连通性已通过' : '检查连通性'}</Tooltip.Content>
        </Tooltip>
        <Tooltip delay={300}>
          <Button isIconOnly aria-label="使用此凭据登录" size="sm" variant="tertiary" isDisabled={isPending || isTesting} onPress={onLogin}>
            {isPending ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:chevron-right" className="size-4" />}
          </Button>
          <Tooltip.Content>切换到此凭据</Tooltip.Content>
        </Tooltip>
      </div>
    </div>
  )
}

function normalizeRedirect(value: string | null): string {
  if (!isValidRedirect(value)) {
    return '/dashboard/openclaw'
  }
  return value
}

function isValidRedirect(value: string | null): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/login')
}

function credentialTargetRoute(target: ReturnType<typeof parseAccessCredential>['target']) {
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

function sortStoredCredentials(credentials: StoredAccessCredential[]) {
  return [...credentials].sort((left, right) => {
    const leftTime = left.lastUsedAt || left.updatedAt
    const rightTime = right.lastUsedAt || right.updatedAt
    return rightTime.localeCompare(leftTime)
  })
}

type URLLoginCredential = {
  backendAddress: string
  credential: string
  persistence: 'persistent' | 'session'
}

const urlCredentialParamKeys = ['credential', 'anex', 'token', 'authToken', 'accessToken']
const urlBackendAddressParamKeys = ['apiUrl', 'apiURL', 'backendAddress', 'backend']
const urlLoginParamKeys = [
  ...urlCredentialParamKeys,
  ...urlBackendAddressParamKeys,
  'autoLogin',
  'persist',
  'persistence',
  'remember',
]

let cachedURLLoginCredential: URLLoginCredential | null | undefined

function getCachedURLLoginCredential() {
  if (cachedURLLoginCredential === undefined) {
    cachedURLLoginCredential = readAndClearURLLoginCredential()
  }
  return cachedURLLoginCredential
}

function clearCachedURLLoginCredential() {
  cachedURLLoginCredential = null
}

function readAndClearURLLoginCredential(): URLLoginCredential | null {
  if (typeof window === 'undefined') return null

  const url = new URL(window.location.href)
  const credentialParamKey = urlCredentialParamKeys.find((key) => {
    const value = url.searchParams.get(key)
    return typeof value === 'string' && value.trim() !== ''
  })
  const credentialValue = credentialParamKey ? url.searchParams.get(credentialParamKey)?.trim() || '' : ''
  const backendAddress = firstURLParam(url.searchParams, urlBackendAddressParamKeys)
  const persistence = parseURLPersistence(url.searchParams)

  clearURLLoginParams(url)
  if (!credentialValue) return null

  return {
    backendAddress,
    credential: credentialParamKey === 'anex' && !credentialValue.toLowerCase().startsWith('anex:')
      ? `anex:${credentialValue}`
      : credentialValue,
    persistence,
  }
}

function clearURLLoginParams(url: URL) {
  let changed = false
  for (const key of urlLoginParamKeys) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key)
      changed = true
    }
  }
  if (!changed) return

  const nextPath = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState(window.history.state, '', nextPath)
}

function firstURLParam(searchParams: URLSearchParams, keys: string[]) {
  for (const key of keys) {
    const value = searchParams.get(key)?.trim()
    if (value) return value
  }
  return ''
}

function parseURLPersistence(searchParams: URLSearchParams): 'persistent' | 'session' {
  const value = firstURLParam(searchParams, ['persistence', 'persist', 'remember', 'autoLogin']).toLowerCase()
  if (['0', 'false', 'no', 'off', 'session'].includes(value)) return 'session'
  return 'persistent'
}

function normalizeURLBackendAddress(value: string) {
  const normalized = value.trim().replace(/\/+$/, '')
  if (!normalized) return ''

  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new Error('URL 参数中的后端地址无效')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL 参数中的后端地址仅支持 http 或 https')
  }

  return url.toString().replace(/\/+$/, '')
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

function normalizeCredentialColor(color: string) {
  const normalized = color.trim().toLowerCase()
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : '#3b82f6'
}

export default LoginPage
