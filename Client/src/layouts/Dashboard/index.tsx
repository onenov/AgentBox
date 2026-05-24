import type { PropsWithChildren, ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { AlertDialog, Button, Chip, Dropdown, Input, Separator, Switch, toast } from '@heroui/react'
import { AppLayout, ItemCard, ItemCardGroup, Navbar, Segment, Sidebar } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import { useLocation, useNavigate } from 'react-router-dom'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import TauriTrafficLights from '@/components/Tauri/TrafficLights'
import DashboardBrandLogo from '@/components/Tauri/DashboardBrandLogo'
import AppUpdateModal from '@/components/AppUpdateModal'
import BackendSecurityCapsule, { useBackendSecuritySnapshot } from '@/components/BackendSecurityCapsule'
import CredentialManagerButton, { useActiveAccessCredential } from '@/components/CredentialManager'
import OpenClawStatusCapsule from '@/components/OpenClawStatusCapsule'
import HermesAgentCapsule from '@/components/HermesAgentCapsule'
import CCConnectStatusCapsule from '@/components/CCConnectStatusCapsule'
import StyleSwitcher from '@/components/Style/Switcher'
import { clearAuthToken, clearBackendLogs, clearBackendSQLiteData, getAuthTokenPersistence, setAuthToken, updateBackendAuthToken, ApiError, verifyBackendAuthToken, getProxySettings, updateProxySettings, checkProxySettings, getLoggingSettings, updateLoggingSettings, type LogLevel, type LoggingSettingsResponse, type ProxyCheckResponse, type ProxyMode, type ProxySettings } from '@/api'
import { getStartupSettings, setStartupSettings, type StartupSettings } from '@/utils/startupSettings'
import { isTauriRuntime } from '@/utils/tauri'
import { useConfigStore } from '@/stores/config'
import { useHermesEnvironmentStore } from '@/stores/hermes-environment'
import { useOpenClawEnvironmentStore } from '@/stores/openclaw-environment'
import { useCCConnectEnvironmentStore } from '@/stores/cc-connect-environment'
import { useNoticeStore } from '@/stores/notice'
import { useAppUpdateStore } from '@/stores/update'
import { clearDashboardPageCache } from '@/utils/dashboardCache'
import { clearActiveAccessCredential } from '@/utils/accessCredentials'
import { clearDesktopStorage, setDesktopLocalStorageValue } from '@/utils/desktopStorage'
import { dashboardFooterNavItems, dashboardNavGroups, dashboardNavItems, findDashboardNavItem } from './nav'

const fallbackNavLabels = new Set(['服务管理'])
const dashboardPageImporters = import.meta.glob('/src/pages/dashboard/**/*.tsx')
const prefetchedDashboardPaths = new Set<string>()
const DashboardLayoutContext = createContext(false)

const SIDEBAR_STATE_COOKIE = 'sidebar_state'
const DASHBOARD_ENGINE_STORAGE_KEY = 'dashboard_active_engine'
const DASHBOARD_ABOUT_PATH = '/dashboard'
const UPDATE_CHECK_DELAY_MS = 3500
const dashboardNavbarTitles: Record<string, string> = {
  '/dashboard': 'About',
}
const sidebarOpenListeners = new Set<() => void>()
const dashboardEngineListeners = new Set<() => void>()

type DashboardEngine = 'openclaw' | 'hermes' | 'cc'
type SecuritySettingsSection = 'access' | 'startup' | 'proxy' | 'logs' | 'maintenance'
type AccessProtectionStatus = 'unknown' | 'protected' | 'open'

const defaultProxySettings: ProxySettings = {
  mode: 'builtin',
  httpProxy: '',
  httpsProxy: '',
  allProxy: '',
  noProxy: '127.0.0.1,localhost,::1',
}

const defaultLoggingSettings: LoggingSettingsResponse = {
  status: 'ok',
  timestamp: '',
  level: 'info',
  logDir: '',
  logFile: '',
}

const dashboardEngines: Array<{
  avatarFallback: string
  description: string
  key: DashboardEngine
  label: string
  logo: string
  path: string
}> = [
    {
      avatarFallback: 'OC',
      description: 'OpenClaw 管理控制台',
      key: 'openclaw',
      label: 'OpenClaw',
      logo: '/assets/images/OpenClaw-White.png',
      path: '/dashboard/openclaw',
    },
    {
      avatarFallback: 'HE',
      description: 'Hermes 控制台',
      key: 'hermes',
      label: 'Hermes',
      logo: '/assets/images/Hermes-White.png',
      path: '/dashboard/hermes',
    },
    {
      avatarFallback: 'CC',
      description: 'CC-Connect 控制台',
      key: 'cc',
      label: 'CC-Connect',
      logo: '/assets/images/CC-Connect-White.png',
      path: '/dashboard/cc',
    },
  ]

function readSidebarOpenCookie() {
  if (typeof document === 'undefined') {
    return true
  }

  return document.cookie.split('; ').find((row) => row.startsWith(`${SIDEBAR_STATE_COOKIE}=`))?.split('=')[1] !== 'false'
}

let sharedSidebarOpen = readSidebarOpenCookie()
let sharedDashboardEngine = readDashboardEngineStorage()

function subscribeSidebarOpen(listener: () => void) {
  sidebarOpenListeners.add(listener)

  return () => {
    sidebarOpenListeners.delete(listener)
  }
}

function getSidebarOpenSnapshot() {
  return sharedSidebarOpen
}

function persistSidebarOpen(open: boolean) {
  if (typeof document === 'undefined') {
    return
  }

  document.cookie = `${SIDEBAR_STATE_COOKIE}=${String(open)}; path=/; max-age=31536000`
}

function setSharedSidebarOpen(open: boolean) {
  if (sharedSidebarOpen === open) {
    return
  }

  sharedSidebarOpen = open
  persistSidebarOpen(open)
  sidebarOpenListeners.forEach((listener) => listener())
}

function readDashboardEngineStorage(): DashboardEngine {
  if (typeof window === 'undefined') {
    return 'openclaw'
  }

  const value = window.localStorage.getItem(DASHBOARD_ENGINE_STORAGE_KEY)
  if (value === 'hermes' || value === 'cc') return value
  return 'openclaw'
}

function subscribeDashboardEngine(listener: () => void) {
  dashboardEngineListeners.add(listener)

  return () => {
    dashboardEngineListeners.delete(listener)
  }
}

function getDashboardEngineSnapshot() {
  return sharedDashboardEngine
}

function setSharedDashboardEngine(engine: DashboardEngine) {
  if (sharedDashboardEngine === engine) {
    return
  }

  sharedDashboardEngine = engine
  try {
    setDesktopLocalStorageValue(DASHBOARD_ENGINE_STORAGE_KEY, engine)
  } catch {
    // localStorage can be unavailable in private contexts
  }
  dashboardEngineListeners.forEach((listener) => listener())
}

function DashboardLayout({ children }: PropsWithChildren) {
  const hasDashboardLayout = useContext(DashboardLayoutContext)

  if (hasDashboardLayout) {
    return <>{children}</>
  }

  return <DashboardLayoutShell>{children}</DashboardLayoutShell>
}

function DashboardLayoutShell({ children }: PropsWithChildren) {
  const navigate = useNavigate()
  const location = useLocation()
  const sidebarOpen = useSyncExternalStore(subscribeSidebarOpen, getSidebarOpenSnapshot, getSidebarOpenSnapshot)
  const storedEngine = useSyncExternalStore(subscribeDashboardEngine, getDashboardEngineSnapshot, getDashboardEngineSnapshot)
  const activeAccessCredential = useActiveAccessCredential()
  const checkForUpdates = useAppUpdateStore((state) => state.check)
  const updateChecked = useAppUpdateStore((state) => state.checked)
  const credentialEngine = accessCredentialTargetToDashboardEngine(activeAccessCredential?.target)
  const routeEngine = getExplicitDashboardEngine(location.pathname)
  const activeEngine = credentialEngine ?? routeEngine ?? storedEngine

  useEffect(() => {
    if (routeEngine && routeEngine !== storedEngine) {
      setSharedDashboardEngine(routeEngine)
    }
  }, [routeEngine, storedEngine])

  useEffect(() => {
    if (!credentialEngine || !routeEngine || credentialEngine === routeEngine) return

    const targetPath = dashboardEngines.find((engine) => engine.key === credentialEngine)?.path ?? '/dashboard/openclaw'
    navigate(targetPath, { replace: true })
  }, [credentialEngine, navigate, routeEngine])

  useEffect(() => {
    if (updateChecked) return

    const timer = window.setTimeout(() => {
      void checkForUpdates()
    }, UPDATE_CHECK_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [checkForUpdates, updateChecked])

  const handleSidebarOpenChange = useCallback((open: boolean) => {
    setSharedSidebarOpen(open)
  }, [])
  const handleNavigate = useCallback((href: string) => {
    console.info('[Dashboard导航] AppLayout 收到侧边栏/导航跳转', {
      from: location.pathname,
      to: href,
      time: new Date().toISOString(),
    })
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    prefetchDashboardPath(href)
    navigate(href)
  }, [location.pathname, navigate])

  return (
    <DashboardLayoutContext.Provider value>
      <AppLayout
        navbar={<DashboardNavbar activeEngine={activeEngine} sidebarOpen={sidebarOpen} />}
        navigate={handleNavigate}
        onSidebarOpenChange={handleSidebarOpenChange}
        sidebar={<DashboardSidebar activeEngine={activeEngine} sidebarOpen={sidebarOpen} />}
        sidebarOpen={sidebarOpen}
        sidebarVariant="floating"
        scrollMode="content"
      >
        <main className="min-h-full px-6 pb-4 pt-4">{children}</main>
        <AppUpdateModal />
      </AppLayout>
    </DashboardLayoutContext.Provider>
  )
}

function DashboardSidebar({ activeEngine, sidebarOpen }: { activeEngine: DashboardEngine; sidebarOpen: boolean }) {
  const appName = useConfigStore((state) => state.appName)
  const appLogo = useConfigStore((state) => state.appLogo)
  const resetApiUrl = useConfigStore((state) => state.resetApiUrl)
  const location = useLocation()
  const navigate = useNavigate()
  const isDesktopApp = isTauriRuntime()
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [securitySettingsOpen, setSecuritySettingsOpen] = useState(false)
  const isOpenAccess = useBackendSecuritySnapshot().openAccess === true
  const openClawAvailable = useOpenClawAvailable()
  const hermesInstalled = useHermesInstalled()
  const ccConnectInstalled = useCCConnectInstalled()
  const navGroups = useMemo(() => {
    const engineGroups = dashboardNavGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => isSharedDashboardPath(item.path) || getExplicitDashboardEngine(item.path ?? '') === activeEngine),
      }))
      .filter((group) => group.items.length > 0)

    if (activeEngine === 'hermes' && hermesInstalled === false) {
      return engineGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => item.path === '/dashboard/hermes-service'),
        }))
        .filter((group) => group.items.length > 0)
    }

    if (activeEngine === 'cc' && ccConnectInstalled === false) {
      return engineGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => item.path === '/dashboard/cc' || item.path === '/dashboard/cc-service'),
        }))
        .filter((group) => group.items.length > 0)
    }

    if (activeEngine !== 'openclaw' || openClawAvailable !== false) return engineGroups

    return engineGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => fallbackNavLabels.has(item.label)),
      }))
      .filter((group) => group.items.length > 0)
  }, [activeEngine, ccConnectInstalled, hermesInstalled, openClawAvailable])

  useEffect(() => {
    prefetchDashboardNavGroups(navGroups)
    dashboardFooterNavItems.forEach((item) => prefetchDashboardPath(item.path))
  }, [navGroups])

  const logout = useCallback(() => {
    clearAuthToken()
    void clearActiveAccessCredential()
    resetApiUrl()
    clearDashboardPageCache()
    clearDesktopStorage()
    window.sessionStorage.clear()
    window.localStorage.clear()
    toast.success('已退出登录')
    setLogoutConfirmOpen(false)
    navigate('/login', { replace: true })
  }, [navigate, resetApiUrl])

  const openAboutPage = useCallback(() => {
    prefetchDashboardPath(DASHBOARD_ABOUT_PATH)
    navigate(DASHBOARD_ABOUT_PATH)
  }, [navigate])

  return (
    <>
      <Sidebar>
        <Sidebar.Header>

          {sidebarOpen ? <TauriTrafficLights /> : null}
          <div className={`flex items-center gap-2 px-1 py-1 ${sidebarOpen && isDesktopApp ? 'mt-2' : ''}`}>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left transition-colors hover:bg-content2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              aria-label={`打开关于 ${appName}`}
              onClick={openAboutPage}
            >
              <DashboardBrandLogo />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" data-sidebar="label">
                {appName}
              </span>
            </button>
          </div>
        </Sidebar.Header>

        <Sidebar.Content>
          {navGroups.map((group) => (
            <Sidebar.Group key={group.label}>
              <Sidebar.GroupLabel>{group.label}</Sidebar.GroupLabel>
              <Sidebar.Menu aria-label={group.label}>
                {group.items.map((item) => (
                  <Sidebar.MenuItem
                    key={item.label}
                    href={item.items ? undefined : item.path}
                    id={item.label}
                    isCurrent={item.path ? location.pathname === item.path : false}
                    textValue={item.label}
                    tooltip={item.label}
                  >
                    <Sidebar.MenuIcon>
                      <Icon icon={item.icon} className="size-4" />
                    </Sidebar.MenuIcon>
                    <Sidebar.MenuLabel>
                      {item.label}
                      {item.items ? (
                        <Sidebar.MenuTrigger>
                          <Sidebar.MenuIndicator />
                        </Sidebar.MenuTrigger>
                      ) : null}
                    </Sidebar.MenuLabel>
                    {item.badge ? (
                      <Sidebar.MenuChip>
                        <Chip color="success" size="sm" variant="soft">
                          {item.badge}
                        </Chip>
                      </Sidebar.MenuChip>
                    ) : null}
                    {item.items ? (
                      <Sidebar.Submenu>
                        {item.items.map((subitem) => (
                          <Sidebar.MenuItem
                            key={subitem.label}
                            href={subitem.path ?? '#'}
                            id={`${item.label}-${subitem.label}`}
                            isCurrent={subitem.path ? location.pathname === subitem.path : false}
                            textValue={subitem.label}
                            tooltip={subitem.label}
                          >
                            <Sidebar.MenuLabel>{subitem.label}</Sidebar.MenuLabel>
                          </Sidebar.MenuItem>
                        ))}
                      </Sidebar.Submenu>
                    ) : null}
                  </Sidebar.MenuItem>
                ))}
              </Sidebar.Menu>
            </Sidebar.Group>
          ))}
        </Sidebar.Content>

        <Sidebar.Footer>
          <Sidebar.Menu aria-label="Footer actions">
            <Sidebar.Separator />
            {dashboardFooterNavItems.map((item) => (
              <Sidebar.MenuItem
                key={item.label}
                href={item.path}
                id={item.label}
                isCurrent={item.path ? location.pathname === item.path : false}
                textValue={item.label}
                tooltip={item.label}
              >
                <Sidebar.MenuIcon>
                  <Icon icon={item.icon} className="size-4" />
                </Sidebar.MenuIcon>
                <Sidebar.MenuLabel>{item.label}</Sidebar.MenuLabel>
              </Sidebar.MenuItem>
            ))}
            <Sidebar.Separator />
            <SecuritySettingsMenuItem onAction={() => setSecuritySettingsOpen(true)} />
            {isOpenAccess ? null : <LogoutMenuItem onAction={() => setLogoutConfirmOpen(true)} />}
          </Sidebar.Menu>
        </Sidebar.Footer>
        {/* <Sidebar.Rail /> */}
      </Sidebar>

      <Sidebar.Mobile>
        <Sidebar.Header>
          <div className="flex items-center gap-2 px-1 py-2">
            <img src={appLogo} alt={appName} className="size-6 rounded-2xl" draggable={false} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
              {appName}
            </span>
          </div>
        </Sidebar.Header>
        <Sidebar.Content>
          {navGroups.map((group) => (
            <Sidebar.Group key={group.label}>
              <Sidebar.GroupLabel>{group.label}</Sidebar.GroupLabel>
              <Sidebar.Menu aria-label={group.label}>
                {group.items.map((item) => (
                  <Sidebar.MenuItem
                    key={item.label}
                    href={item.items ? undefined : item.path}
                    id={item.label}
                    isCurrent={item.path ? location.pathname === item.path : false}
                    textValue={item.label}
                    tooltip={item.label}
                  >
                    <Sidebar.MenuIcon>
                      <Icon icon={item.icon} className="size-4" />
                    </Sidebar.MenuIcon>
                    <Sidebar.MenuLabel>
                      {item.label}
                      {item.items ? (
                        <Sidebar.MenuTrigger>
                          <Sidebar.MenuIndicator />
                        </Sidebar.MenuTrigger>
                      ) : null}
                    </Sidebar.MenuLabel>
                    {item.badge ? (
                      <Sidebar.MenuChip>
                        <Chip color="success" size="sm" variant="soft">
                          {item.badge}
                        </Chip>
                      </Sidebar.MenuChip>
                    ) : null}
                    {item.items ? (
                      <Sidebar.Submenu>
                        {item.items.map((subitem) => (
                          <Sidebar.MenuItem
                            key={subitem.label}
                            href={subitem.path ?? '#'}
                            id={`${item.label}-${subitem.label}`}
                            isCurrent={subitem.path ? location.pathname === subitem.path : false}
                            textValue={subitem.label}
                            tooltip={subitem.label}
                          >
                            <Sidebar.MenuLabel>{subitem.label}</Sidebar.MenuLabel>
                          </Sidebar.MenuItem>
                        ))}
                      </Sidebar.Submenu>
                    ) : null}
                  </Sidebar.MenuItem>
                ))}
              </Sidebar.Menu>
            </Sidebar.Group>
          ))}
        </Sidebar.Content>
        <Sidebar.Footer>
          <Sidebar.Menu aria-label="Footer actions">
            <Sidebar.Separator />
            {dashboardFooterNavItems.map((item) => (
              <Sidebar.MenuItem
                key={item.label}
                href={item.path}
                id={item.label}
                isCurrent={item.path ? location.pathname === item.path : false}
                textValue={item.label}
                tooltip={item.label}
              >
                <Sidebar.MenuIcon>
                  <Icon icon={item.icon} className="size-4" />
                </Sidebar.MenuIcon>
                <Sidebar.MenuLabel>{item.label}</Sidebar.MenuLabel>
              </Sidebar.MenuItem>
            ))}
            <Sidebar.Separator />
            <SecuritySettingsMenuItem onAction={() => setSecuritySettingsOpen(true)} />
            {isOpenAccess ? null : <LogoutMenuItem onAction={() => setLogoutConfirmOpen(true)} />}
          </Sidebar.Menu>
        </Sidebar.Footer>
      </Sidebar.Mobile>
      <SecuritySettingsDialog isOpen={securitySettingsOpen} onOpenChange={setSecuritySettingsOpen} />
      <LogoutConfirmDialog isOpen={logoutConfirmOpen} onConfirm={logout} onOpenChange={setLogoutConfirmOpen} />
    </>
  )
}

function EngineSwitcher({ activeEngine }: { activeEngine: DashboardEngine }) {
  const navigate = useNavigate()
  const selectedEngine = dashboardEngines.find((engine) => engine.key === activeEngine) ?? dashboardEngines[0]

  const switchEngine = useCallback((engine: DashboardEngine) => {
    if (engine === activeEngine) return

    const targetPath = dashboardEngines.find((item) => item.key === engine)?.path ?? '/dashboard/openclaw'
    prefetchDashboardPath(targetPath)
    navigate(targetPath)
    setSharedDashboardEngine(engine)
  }, [activeEngine, navigate])

  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label="选择引擎"
        className="hover:bg-default flex h-9 items-center gap-2 rounded-full border border-border bg-content1 text-left shadow-xs outline-none transition-colors"
      >
        <EngineLogo engine={selectedEngine} />
        {/* <span className="hidden max-w-28 truncate text-sm font-medium text-foreground sm:inline">
          {selectedEngine.label}
        </span>
        <Icon icon="lucide:chevron-down" className="size-3 shrink-0 text-muted" /> */}
      </Dropdown.Trigger>
      <Dropdown.Popover className="w-auto" placement="bottom end">
        <Dropdown.Menu
          aria-label="选择引擎"
          selectedKeys={new Set([activeEngine])}
          selectionMode="single"
          onAction={(key) => switchEngine(String(key) as DashboardEngine)}
        >
          {dashboardEngines.map((engine) => (
            <Dropdown.Item key={engine.key} id={engine.key} textValue={engine.label}>
              <Dropdown.ItemIndicator type="dot" />
              <div className="flex min-w-0 items-center gap-3">
                <EngineLogo engine={engine} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{engine.label}</div>
                  {/* <p className="mt-0.5 truncate text-xs text-muted">{engine.description}</p> */}
                </div>
              </div>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function EngineLogo({ engine }: { engine: (typeof dashboardEngines)[number] }) {
  return (
    <span className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-muted">
      <img alt={engine.label} src={engine.logo} className="size-full object-cover" />
      <span className="absolute inset-0 -z-10 flex items-center justify-center">{engine.avatarFallback}</span>
    </span>
  )
}

function prefetchDashboardPath(path?: string) {
  if (!path || !path.startsWith('/dashboard')) return
  const modulePath = dashboardPathToModulePath(path)
  const importer = dashboardPageImporters[modulePath]
  if (!importer || prefetchedDashboardPaths.has(modulePath)) return

  prefetchedDashboardPaths.add(modulePath)
  void importer().catch(() => {
    prefetchedDashboardPaths.delete(modulePath)
  })
}

function prefetchDashboardNavGroups(groups: typeof dashboardNavGroups) {
  groups.forEach((group) => {
    group.items.forEach((item) => {
      prefetchDashboardPath(item.path)
      item.items?.forEach((subitem) => prefetchDashboardPath(subitem.path))
    })
  })
}

function dashboardPathToModulePath(path: string) {
  const normalized = path.replace(/\/+$/, '')
  if (normalized === '/dashboard') {
    return '/src/pages/dashboard/index/index.tsx'
  }
  return `/src/pages${normalized}/index.tsx`
}

function SecuritySettingsMenuItem({ onAction }: { onAction: () => void }) {
  return (
    <Sidebar.MenuItem
      id="设置"
      textValue="设置"
      tooltip="设置"
      onAction={onAction}
    >
      <Sidebar.MenuIcon>
        <Icon icon="lucide:settings" className="size-4" />
      </Sidebar.MenuIcon>
      <Sidebar.MenuLabel>设置</Sidebar.MenuLabel>
    </Sidebar.MenuItem>
  )
}

function LogoutMenuItem({ onAction }: { onAction: () => void }) {
  return (
    <Sidebar.MenuItem
      id="退出登录"
      className="text-danger"
      textValue="退出登录"
      tooltip="退出登录"
      onAction={onAction}
    >
      <Sidebar.MenuIcon>
        <Icon icon="lucide:power" className="size-4" />
      </Sidebar.MenuIcon>
      <Sidebar.MenuLabel>退出登录</Sidebar.MenuLabel>
    </Sidebar.MenuItem>
  )
}

function SecuritySettingsDialog({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (isOpen: boolean) => void }) {
  const appName = useConfigStore((state) => state.appName)
  const [token, setToken] = useState('')
  const [ignoreRiskMode, setIgnoreRiskMode] = useState(false)
  const [accessProtectionStatus, setAccessProtectionStatus] = useState<AccessProtectionStatus>('unknown')
  const [isCheckingAccessProtection, setCheckingAccessProtection] = useState(false)
  const [error, setError] = useState('')
  const [isSaving, setSaving] = useState(false)
  const [maintenanceAction, setMaintenanceAction] = useState<'browser' | 'sqlite' | null>(null)
  const [activeSection, setActiveSection] = useState<SecuritySettingsSection>('access')
  const [maintenanceState, setMaintenanceState] = useState<'idle' | 'browser' | 'sqlite'>('idle')
  const isDesktopApp = isTauriRuntime()
  const [startupSettings, setStartupSettingsState] = useState<StartupSettings>({ autoStart: false, silentStartup: false })
  const [startupSettingsState, setStartupSettingsStateStatus] = useState<'idle' | 'loading' | 'saving' | 'unavailable'>(isDesktopApp ? 'loading' : 'unavailable')
  const [proxySettings, setProxySettingsState] = useState<ProxySettings>(defaultProxySettings)
  const [proxyDraft, setProxyDraft] = useState<ProxySettings>(defaultProxySettings)
  const [proxyState, setProxyState] = useState<'idle' | 'loading' | 'saving' | 'checking'>('loading')
  const [proxyCheck, setProxyCheck] = useState<ProxyCheckResponse | null>(null)
  const [loggingSettings, setLoggingSettings] = useState<LoggingSettingsResponse>(defaultLoggingSettings)
  const [logLevelDraft, setLogLevelDraft] = useState<LogLevel>('info')
  const [loggingState, setLoggingState] = useState<'idle' | 'loading' | 'saving' | 'clearing'>('loading')
  const isMaintenanceRunning = maintenanceState !== 'idle'
  const isStartupSettingsBusy = startupSettingsState === 'loading' || startupSettingsState === 'saving'
  const isProxyBusy = proxyState === 'loading' || proxyState === 'saving' || proxyState === 'checking'
  const isLoggingBusy = loggingState === 'loading' || loggingState === 'saving' || loggingState === 'clearing'
  const isAccessProtectionOpen = accessProtectionStatus === 'open'
  const hasAccessProtectionChanges = token.trim().length > 0 || (accessProtectionStatus !== 'unknown' ? ignoreRiskMode !== isAccessProtectionOpen : ignoreRiskMode)
  const shouldShowAccessProtectionSave = activeSection === 'access' && hasAccessProtectionChanges
  const hasProxyChanges = !proxySettingsEqual(proxySettings, proxyDraft)
  const hasLoggingChanges = loggingSettings.level !== logLevelDraft
  const settingsSections = useMemo(() => {
    const sections: Array<{ id: SecuritySettingsSection; label: string }> = [
      { id: 'access', label: '访问' },
    ]
    if (isDesktopApp) {
      sections.push({ id: 'startup', label: '桌面' })
    }
    sections.push({ id: 'proxy', label: '代理' })
    sections.push({ id: 'logs', label: '日志' })
    sections.push({ id: 'maintenance', label: '维护' })
    return sections
  }, [isDesktopApp])

  const resetForm = useCallback(() => {
    setToken('')
    setIgnoreRiskMode(false)
    setAccessProtectionStatus('unknown')
    setCheckingAccessProtection(false)
    setError('')
    setSaving(false)
  }, [])

  useEffect(() => {
    if (!isOpen) return

    let cancelled = false
    setCheckingAccessProtection(true)
    verifyBackendAuthToken('')
      .then(() => {
        if (cancelled) return
        setAccessProtectionStatus('open')
        setIgnoreRiskMode(true)
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 401) {
          setAccessProtectionStatus('protected')
          setIgnoreRiskMode(false)
          return
        }
        setAccessProtectionStatus('unknown')
        setIgnoreRiskMode(false)
      })
      .finally(() => {
        if (cancelled) return
        setCheckingAccessProtection(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !isDesktopApp) return

    let cancelled = false
    setStartupSettingsStateStatus('loading')
    getStartupSettings()
      .then((settings) => {
        if (cancelled) return
        setStartupSettingsState(settings)
        setStartupSettingsStateStatus('idle')
      })
      .catch(() => {
        if (cancelled) return
        setStartupSettingsStateStatus('unavailable')
      })

    return () => {
      cancelled = true
    }
  }, [isDesktopApp, isOpen])

  useEffect(() => {
    if (!isOpen) return

    let cancelled = false
    setProxyState('loading')
    getProxySettings()
      .then((response) => {
        if (cancelled) return
        const settings = normalizeProxySettings(response.settings)
        setProxySettingsState(settings)
        setProxyDraft(settings)
        setProxyCheck(null)
        setProxyState('idle')
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : '代理设置读取失败'
        setError(message)
        setProxySettingsState(defaultProxySettings)
        setProxyDraft(defaultProxySettings)
        setProxyState('idle')
      })

    return () => {
      cancelled = true
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    let cancelled = false
    setLoggingState('loading')
    getLoggingSettings()
      .then((response) => {
        if (cancelled) return
        const settings = normalizeLoggingSettings(response)
        setLoggingSettings(settings)
        setLogLevelDraft(settings.level)
        setLoggingState('idle')
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : '日志设置读取失败'
        setError(message)
        setLoggingSettings(defaultLoggingSettings)
        setLogLevelDraft(defaultLoggingSettings.level)
        setLoggingState('idle')
      })

    return () => {
      cancelled = true
    }
  }, [isOpen])

  const updateStartupSettings = useCallback(async (nextSettings: StartupSettings) => {
    setError('')
    setStartupSettingsStateStatus('saving')
    try {
      const savedSettings = await setStartupSettings(nextSettings)
      setStartupSettingsState(savedSettings)
      setStartupSettingsStateStatus('idle')
      toast.success('启动设置已更新')
    } catch (err) {
      console.error('[dashboard] Failed to save startup settings', { nextSettings, error: err })
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '启动设置保存失败'
      setError(message)
      setStartupSettingsStateStatus('idle')
      toast.warning(message)
    }
  }, [])

  const updateAutoStart = useCallback((autoStart: boolean) => {
    const nextSettings = {
      autoStart,
      silentStartup: autoStart ? startupSettings.silentStartup : false,
    }
    setStartupSettingsState(nextSettings)
    void updateStartupSettings(nextSettings)
  }, [startupSettings.silentStartup, updateStartupSettings])

  const updateSilentStartup = useCallback((silentStartup: boolean) => {
    const nextSettings = { ...startupSettings, silentStartup }
    setStartupSettingsState(nextSettings)
    void updateStartupSettings(nextSettings)
  }, [startupSettings, updateStartupSettings])

  const updateProxyDraft = useCallback((patch: Partial<ProxySettings>) => {
    setProxyCheck(null)
    setProxyDraft((current) => normalizeProxySettings({ ...current, ...patch }, false))
  }, [])

  const updateProxyMode = useCallback((mode: ProxyMode) => {
    updateProxyDraft({ mode })
  }, [updateProxyDraft])

  const saveProxySettings = useCallback(async () => {
    setError('')
    setProxyState('saving')
    try {
      const response = await updateProxySettings(proxyDraft)
      const settings = normalizeProxySettings(response.settings)
      setProxySettingsState(settings)
      setProxyDraft(settings)
      setProxyState('idle')
      toast.success('代理设置已更新')
    } catch (err) {
      const message = err instanceof Error ? err.message : '代理设置保存失败'
      setError(message)
      setProxyState('idle')
      toast.warning(message)
    }
  }, [proxyDraft])

  const runProxyCheck = useCallback(async () => {
    setError('')
    setProxyCheck(null)
    setProxyState('checking')
    try {
      const result = await checkProxySettings(proxyDraft)
      setProxyCheck(result)
      setProxyState('idle')
      if (result.ok) {
        toast.success('代理可用')
      } else {
        toast.warning(result.error || '代理检查未通过')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '代理可用性检查失败'
      setError(message)
      setProxyState('idle')
      toast.warning(message)
    }
  }, [proxyDraft])

  const saveLoggingSettings = useCallback(async () => {
    setError('')
    setLoggingState('saving')
    try {
      const response = await updateLoggingSettings(logLevelDraft)
      const settings = normalizeLoggingSettings(response)
      setLoggingSettings(settings)
      setLogLevelDraft(settings.level)
      setLoggingState('idle')
      toast.success('日志级别已更新')
    } catch (err) {
      const message = err instanceof Error ? err.message : '日志设置保存失败'
      setError(message)
      setLoggingState('idle')
      toast.warning(message)
    }
  }, [logLevelDraft])

  const clearLogs = useCallback(async () => {
    setError('')
    setLoggingState('clearing')
    try {
      const response = await clearBackendLogs()
      const settings = normalizeLoggingSettings(response)
      setLoggingSettings(settings)
      setLogLevelDraft(settings.level)
      setLoggingState('idle')
      toast.success('后端日志已清除')
    } catch (err) {
      const message = err instanceof Error ? err.message : '后端日志清除失败'
      setError(message)
      setLoggingState('idle')
      toast.warning(message)
    }
  }, [])

  const changeOpen = useCallback((open: boolean) => {
    if (isSaving || isMaintenanceRunning || isLoggingBusy) return
    if (!open) {
      resetForm()
      setActiveSection('access')
    }
    onOpenChange(open)
  }, [isLoggingBusy, isMaintenanceRunning, isSaving, onOpenChange, resetForm])

  const saveToken = useCallback(async () => {
    const nextToken = token.trim()
    setError('')

    if (ignoreRiskMode) {
      setSaving(true)
      try {
        await updateBackendAuthToken('')
        clearAuthToken()
        window.dispatchEvent(new Event('agent-box:auth-refresh'))
        toast.success('已关闭访问保护')
        setAccessProtectionStatus('open')
        setToken('')
        setIgnoreRiskMode(true)
        setError('')
        onOpenChange(false)
      } catch (err) {
        const message = err instanceof Error ? err.message : '安全设置保存失败'
        setError(message)
        toast.warning(message)
      } finally {
        setSaving(false)
      }
      return
    }

    if (!nextToken) {
      setError('请输入新的访问凭证')
      return
    }

    setSaving(true)
    try {
      await updateBackendAuthToken(nextToken)
      setAuthToken(nextToken, getAuthTokenPersistence())
      window.dispatchEvent(new Event('agent-box:auth-refresh'))
      toast.success('安全设置已更新')
      setAccessProtectionStatus('protected')
      setToken('')
      setIgnoreRiskMode(false)
      setError('')
      onOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : '访问凭证更新失败'
      setError(message)
      toast.warning(message)
    } finally {
      setSaving(false)
    }
  }, [ignoreRiskMode, onOpenChange, resetForm, token])

  const clearBrowserStorage = useCallback(() => {
    setMaintenanceState('browser')
    clearAuthToken()
    void clearActiveAccessCredential()
    clearDashboardPageCache()
    clearDesktopStorage()
    try {
      window.sessionStorage.clear()
      window.localStorage.clear()
    } catch {
      // Browser storage can be unavailable in private contexts.
    }
    toast.success('浏览器本地缓存已清除')
    window.setTimeout(() => window.location.reload(), 120)
  }, [])

  const clearSQLiteData = useCallback(async () => {
    setMaintenanceState('sqlite')
    try {
      const result = await clearBackendSQLiteData()
      toast.success(`后端 SQLite 已清理 ${result.deletedRows} 条记录`)
      clearDashboardPageCache()
      setMaintenanceAction(null)
      onOpenChange(false)
      window.setTimeout(() => window.location.reload(), 120)
    } catch (err) {
      const message = err instanceof Error ? err.message : '后端 SQLite 清理失败'
      setError(message)
      toast.warning(message)
    } finally {
      setMaintenanceState('idle')
    }
  }, [onOpenChange])

  const confirmMaintenanceAction = useCallback(() => {
    if (maintenanceAction === 'browser') {
      clearBrowserStorage()
      return
    }
    if (maintenanceAction === 'sqlite') {
      void clearSQLiteData()
    }
  }, [clearBrowserStorage, clearSQLiteData, maintenanceAction])

  const changeActiveSection = useCallback((key: string | number) => {
    setActiveSection(String(key) as SecuritySettingsSection)
  }, [])

  return (
    <>
      <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={changeOpen}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[680px]">
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon className="bg-default text-foreground">
                <Icon icon="lucide:settings" className="size-5" />
              </AlertDialog.Icon>
              <AlertDialog.Heading>应用设置</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>

              <p className="text-sm leading-6 text-muted mb-4">
                管理访问保护、桌面启动、代理策略、日志和维护操作。
              </p>

              {error ? (
                <div className="rounded-lg bg-danger/10 px-3 py-2 text-sm leading-6 text-danger mt-4">
                  {error}
                </div>
              ) : null}

              <div className=" mt-2">

                <Segment
                  aria-label="设置分组"
                  selectedKey={activeSection}

                  onSelectionChange={changeActiveSection}
                >
                  {settingsSections.map((section) => (
                    <Segment.Item key={section.id} id={section.id}>
                      <Segment.Separator />
                      {section.label}
                    </Segment.Item>
                  ))}
                </Segment>
                <div className="space-y-3 mt-2">
                  {activeSection === 'access' ? (
                    <ItemCardGroup className="overflow-hidden">
                      <ItemCardGroup.Header>
                        <div className="flex w-full items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <ItemCardGroup.Title>访问</ItemCardGroup.Title>
                            <ItemCardGroup.Description>
                              更新访问凭证后，此设备会继续保持已登录状态。
                            </ItemCardGroup.Description>
                          </div>
                          {shouldShowAccessProtectionSave ? (
                            <Button
                              size="sm"
                              variant="primary"
                              isDisabled={isSaving || isMaintenanceRunning || isCheckingAccessProtection}
                              onPress={() => void saveToken()}
                            >
                              <Icon icon={isSaving ? 'lucide:loader-circle' : 'lucide:save'} className={isSaving ? 'size-4 animate-spin' : 'size-4'} />
                              保存
                            </Button>
                          ) : null}
                        </div>
                      </ItemCardGroup.Header>
                      <SettingsItem description="用于保护 AgentBox" icon="lucide:key-round" title="新的访问凭证">
                        <Input
                          fullWidth
                          autoComplete="new-password"
                          aria-label="新的访问凭证"
                          disabled={isSaving || ignoreRiskMode || isCheckingAccessProtection}
                          placeholder="新的访问凭证"
                          type="password"
                          value={token}
                          variant="secondary"
                          onChange={(event) => setToken(event.target.value)}
                        />
                      </SettingsItem>
                      <Separator />
                      <SettingsItem actionClassName="w-fit" description="关闭密码保护，任何人都可以直接访问。" icon="lucide:shield-off" iconTone="danger" title="无视风险模式">
                        <Switch
                          size="lg"
                          aria-label="无视风险模式"
                          isDisabled={isSaving || isCheckingAccessProtection}
                          isSelected={ignoreRiskMode}
                          onChange={setIgnoreRiskMode}
                        >
                          <Switch.Control><Switch.Thumb /></Switch.Control>
                        </Switch>
                      </SettingsItem>
                    </ItemCardGroup>
                  ) : null}

                  {activeSection === 'startup' && isDesktopApp ? (
                    <ItemCardGroup className="overflow-hidden">
                      <ItemCardGroup.Header>
                        <ItemCardGroup.Title>桌面</ItemCardGroup.Title>
                        <ItemCardGroup.Description>
                          控制是否随系统启动，以及自启时是否隐藏窗口。
                        </ItemCardGroup.Description>
                      </ItemCardGroup.Header>
                      <SettingsItem
                        actionClassName="w-fit"
                        description="登录 Windows 或 Ubuntu 后自动启动。"
                        icon="lucide:rocket"
                        title="开机自启"
                      >
                        <Switch
                          size="lg"
                          aria-label="开机自启"
                          isDisabled={isSaving || isMaintenanceRunning || isStartupSettingsBusy}
                          isSelected={startupSettings.autoStart}
                          onChange={updateAutoStart}
                        >
                          <Switch.Control><Switch.Thumb /></Switch.Control>
                        </Switch>
                      </SettingsItem>
                      {startupSettings.autoStart ? (
                        <>
                          <Separator />
                          <SettingsItem
                            actionClassName="w-fit"
                            description="开机自启时隐藏桌面窗口，仅保留托盘入口和后端服务。"
                            icon="lucide:eye-off"
                            title="静默启动"
                          >
                            <Switch
                              size="lg"
                              aria-label="静默启动"
                              isDisabled={isSaving || isMaintenanceRunning || isStartupSettingsBusy}
                              isSelected={startupSettings.silentStartup}
                              onChange={updateSilentStartup}
                            >
                              <Switch.Control><Switch.Thumb /></Switch.Control>
                            </Switch>
                          </SettingsItem>
                        </>
                      ) : null}
                    </ItemCardGroup>
                  ) : null}

                  {activeSection === 'proxy' ? (
                    <ItemCardGroup className="overflow-hidden">
                      <ItemCardGroup.Header>
                        <div className="flex w-full items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <ItemCardGroup.Title>代理</ItemCardGroup.Title>
                            <ItemCardGroup.Description>
                              直连不可用时，后端安装命令和外部 HTTP 请求会按这里的策略重试。
                            </ItemCardGroup.Description>
                          </div>
                          {hasProxyChanges ? (
                            <Button
                              size="sm"
                              variant="primary"
                              isDisabled={isSaving || isMaintenanceRunning || isProxyBusy}
                              onPress={() => void saveProxySettings()}
                            >
                              <Icon icon={proxyState === 'saving' ? 'lucide:loader-circle' : 'lucide:save'} className={proxyState === 'saving' ? 'size-4 animate-spin' : 'size-4'} />
                              保存
                            </Button>
                          ) : null}
                        </div>
                      </ItemCardGroup.Header>
                      <SettingsItem actionClassName="w-auto" icon="lucide:route" title="代理模式">
                        <ProxyModeDropdown
                          mode={proxyDraft.mode}
                          isDisabled={isProxyBusy}
                          onChange={updateProxyMode}
                        />
                      </SettingsItem>
                      {proxyDraft.mode === 'custom' ? (
                        <>
                          <Separator />
                          <SettingsItem actionClassName="w-auto" icon="lucide:globe-2" title="HTTP 代理">
                            <Input
                              fullWidth
                              aria-label="HTTP 代理"
                              autoComplete="off"
                              disabled={isProxyBusy}
                              placeholder="http://user:pass@host:port"
                              value={proxyDraft.httpProxy ?? ''}
                              variant="secondary"
                              onChange={(event) => updateProxyDraft({ httpProxy: event.target.value })}
                            />
                          </SettingsItem>
                          <Separator />
                          <SettingsItem actionClassName="w-auto" icon="lucide:lock-keyhole" title="HTTPS 代理">
                            <Input
                              fullWidth
                              aria-label="HTTPS 代理"
                              autoComplete="off"
                              disabled={isProxyBusy}
                              placeholder="http://user:pass@host:port"
                              value={proxyDraft.httpsProxy ?? ''}
                              variant="secondary"
                              onChange={(event) => updateProxyDraft({ httpsProxy: event.target.value })}
                            />
                          </SettingsItem>
                          <Separator />
                          <SettingsItem actionClassName="w-auto" icon="lucide:shuffle" title="ALL_PROXY">
                            <Input
                              fullWidth
                              aria-label="ALL_PROXY"
                              autoComplete="off"
                              disabled={isProxyBusy}
                              placeholder="socks5://127.0.0.1:7890"
                              value={proxyDraft.allProxy ?? ''}
                              variant="secondary"
                              onChange={(event) => updateProxyDraft({ allProxy: event.target.value })}
                            />
                          </SettingsItem>
                        </>
                      ) : null}
                      <Separator />
                      <SettingsItem actionClassName="w-auto" icon="lucide:unplug" title="不走代理">
                        <Input
                          fullWidth
                          aria-label="不走代理"
                          autoComplete="off"
                          disabled={isProxyBusy || proxyDraft.mode === 'off'}
                          placeholder="127.0.0.1,localhost,::1"
                          value={proxyDraft.noProxy ?? ''}
                          variant="secondary"
                          onChange={(event) => updateProxyDraft({ noProxy: event.target.value })}
                        />
                      </SettingsItem>
                      <Separator />
                      <ProxyCheckItem
                        check={proxyCheck}
                        isChecking={proxyState === 'checking'}
                        isDisabled={isSaving || isMaintenanceRunning || isProxyBusy || proxyDraft.mode === 'off'}
                        onCheck={() => void runProxyCheck()}
                      />
                    </ItemCardGroup>
                  ) : null}

                  {activeSection === 'logs' ? (
                    <ItemCardGroup className="overflow-hidden">
                      <ItemCardGroup.Header>
                        <div className="flex w-full items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <ItemCardGroup.Title>日志</ItemCardGroup.Title>
                            <ItemCardGroup.Description>
                              后端日志写入 DefaultDataDir/logs，默认级别为 info。
                            </ItemCardGroup.Description>
                          </div>
                          {hasLoggingChanges ? (
                            <Button
                              size="sm"
                              variant="primary"
                              isDisabled={isSaving || isMaintenanceRunning || isLoggingBusy}
                              onPress={() => void saveLoggingSettings()}
                            >
                              <Icon icon={loggingState === 'saving' ? 'lucide:loader-circle' : 'lucide:save'} className={loggingState === 'saving' ? 'size-4 animate-spin' : 'size-4'} />
                              保存
                            </Button>
                          ) : null}
                        </div>
                      </ItemCardGroup.Header>
                      <SettingsItem actionClassName="w-auto" description={loggingSettings.logFile || 'DefaultDataDir/logs/agent-box.log'} icon="lucide:list-filter" title="日志级别">
                        <LogLevelDropdown
                          level={logLevelDraft}
                          isDisabled={isLoggingBusy}
                          onChange={setLogLevelDraft}
                        />
                      </SettingsItem>
                      <Separator />
                      <SettingsItem
                        actionClassName="w-fit"
                        description={loggingSettings.logDir || 'DefaultDataDir/logs'}
                        icon="lucide:file-x-2"
                        iconTone="danger"
                        title="清除日志"
                      >
                        <Button size="sm" variant="danger-soft" isDisabled={isSaving || isMaintenanceRunning || isLoggingBusy} onPress={() => void clearLogs()}>
                          <Icon icon={loggingState === 'clearing' ? 'lucide:loader-circle' : 'lucide:trash-2'} className={loggingState === 'clearing' ? 'size-4 animate-spin' : 'size-4'} />
                          清除
                        </Button>
                      </SettingsItem>
                    </ItemCardGroup>
                  ) : null}

                  {activeSection === 'maintenance' ? (
                    <ItemCardGroup className="overflow-hidden">
                      <ItemCardGroup.Header>
                        <ItemCardGroup.Title>维护</ItemCardGroup.Title>
                        <ItemCardGroup.Description>
                          清理本机保存的数据。操作前会再次确认。
                        </ItemCardGroup.Description>
                      </ItemCardGroup.Header>
                      <MaintenanceActionItem
                        description="清理服务保存的会话和运行缓存。"
                        icon="lucide:database-zap"
                        isDisabled={isSaving || isMaintenanceRunning}
                        isPending={maintenanceState === 'sqlite'}
                        title="清除数据"
                        onAction={() => setMaintenanceAction('sqlite')}
                      />
                      <Separator />
                      <MaintenanceActionItem
                        description="清除当前浏览器数据和页面缓存。"
                        icon="lucide:hard-drive-download"
                        isDisabled={isSaving || isMaintenanceRunning}
                        isPending={maintenanceState === 'browser'}
                        title="清除缓存"
                        onAction={() => setMaintenanceAction('browser')}
                      />
                    </ItemCardGroup>
                  ) : null}
                </div>
              </div>

            </AlertDialog.Body>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
      <MaintenanceConfirmDialog
        appName={appName}
        action={maintenanceAction}
        isPending={isMaintenanceRunning}
        onConfirm={confirmMaintenanceAction}
        onOpenChange={(open) => !open && !isMaintenanceRunning && setMaintenanceAction(null)}
      />
    </>
  )
}

function SettingsItem({
  actionClassName = 'w-full min-w-0 sm:w-[240px]',
  children,
  description,
  icon,
  iconTone = 'default',
  title,
}: {
  actionClassName?: string
  children: ReactNode
  description?: string
  icon: string
  iconTone?: 'danger' | 'default'
  title: string
}) {
  const iconClassName = iconTone === 'danger'
    ? 'size-10 rounded-full bg-danger/10 text-danger'
    : 'size-10 rounded-full bg-surface-secondary/50 text-muted'

  return (
    <ItemCard>
      <ItemCard.Icon className={iconClassName}>
        <Icon icon={icon} className="size-5" />
      </ItemCard.Icon>
      <ItemCard.Content>
        <ItemCard.Title>{title}</ItemCard.Title>
        {description ? <ItemCard.Description>{description}</ItemCard.Description> : null}
      </ItemCard.Content>
      <ItemCard.Action>
        <div className={actionClassName}>{children}</div>
      </ItemCard.Action>
    </ItemCard>
  )
}

function MaintenanceActionItem({
  description,
  icon,
  isDisabled,
  isPending,
  onAction,
  title,
}: {
  description: string
  icon: string
  isDisabled: boolean
  isPending: boolean
  onAction: () => void
  title: string
}) {
  return (
    <SettingsItem actionClassName="w-fit" description={description} icon={icon} iconTone="danger" title={title}>
      <Button size="sm" variant="danger-soft" isDisabled={isDisabled} onPress={onAction}>
        <Icon icon={isPending ? 'lucide:loader-circle' : 'lucide:trash-2'} className={isPending ? 'size-4 animate-spin' : 'size-4'} />
        清除
      </Button>
    </SettingsItem>
  )
}

const proxyModeOptions: Array<{ icon: string; label: string; value: ProxyMode }> = [
  { icon: 'lucide:circle-slash', label: '关闭', value: 'off' },
  { icon: 'lucide:shield-check', label: '内置代理', value: 'builtin' },
  { icon: 'lucide:sliders-horizontal', label: '自定义代理', value: 'custom' },
]

const logLevelOptions: Array<{ icon: string; label: string; value: LogLevel }> = [
  { icon: 'lucide:bug', label: 'Debug', value: 'debug' },
  { icon: 'lucide:info', label: 'Info', value: 'info' },
  { icon: 'lucide:triangle-alert', label: 'Warn', value: 'warn' },
  { icon: 'lucide:circle-alert', label: 'Error', value: 'error' },
]

function ProxyModeDropdown({
  isDisabled,
  mode,
  onChange,
}: {
  isDisabled: boolean
  mode: ProxyMode
  onChange: (mode: ProxyMode) => void
}) {
  const selected = proxyModeOptions.find((option) => option.value === mode) ?? proxyModeOptions[1]

  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label="代理模式"
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border bg-content1 px-3 text-left text-sm outline-none transition-colors hover:bg-default disabled:cursor-not-allowed disabled:opacity-50"
        isDisabled={isDisabled}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon icon={selected.icon} className="size-4 shrink-0 text-muted" />
          <span className="truncate text-foreground">{selected.label}</span>
        </span>
        <Icon icon="lucide:chevron-down" className="size-4 shrink-0 text-muted" />
      </Dropdown.Trigger>
      <Dropdown.Popover className="w-44" placement="bottom end">
        <Dropdown.Menu
          aria-label="代理模式"
          selectedKeys={new Set([mode])}
          selectionMode="single"
          onAction={(key) => onChange(String(key) as ProxyMode)}
        >
          {proxyModeOptions.map((option) => (
            <Dropdown.Item key={option.value} id={option.value} textValue={option.label}>
              <Dropdown.ItemIndicator type="dot" />
              <div className="flex min-w-0 items-center gap-2">
                <Icon icon={option.icon} className="size-4 shrink-0 text-muted" />
                <span className="truncate text-sm text-foreground">{option.label}</span>
              </div>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function LogLevelDropdown({
  isDisabled,
  level,
  onChange,
}: {
  isDisabled: boolean
  level: LogLevel
  onChange: (level: LogLevel) => void
}) {
  const selected = logLevelOptions.find((option) => option.value === level) ?? logLevelOptions[1]

  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label="日志级别"
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border bg-content1 px-3 text-left text-sm outline-none transition-colors hover:bg-default disabled:cursor-not-allowed disabled:opacity-50"
        isDisabled={isDisabled}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon icon={selected.icon} className="size-4 shrink-0 text-muted" />
          <span className="truncate text-foreground">{selected.label}</span>
        </span>
        <Icon icon="lucide:chevron-down" className="size-4 shrink-0 text-muted" />
      </Dropdown.Trigger>
      <Dropdown.Popover className="w-44" placement="bottom end">
        <Dropdown.Menu
          aria-label="日志级别"
          selectedKeys={new Set([level])}
          selectionMode="single"
          onAction={(key) => onChange(String(key) as LogLevel)}
        >
          {logLevelOptions.map((option) => (
            <Dropdown.Item key={option.value} id={option.value} textValue={option.label}>
              <Dropdown.ItemIndicator type="dot" />
              <div className="flex min-w-0 items-center gap-2">
                <Icon icon={option.icon} className="size-4 shrink-0 text-muted" />
                <span className="truncate text-sm text-foreground">{option.label}</span>
              </div>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

function ProxyCheckItem({
  check,
  isChecking,
  isDisabled,
  onCheck,
}: {
  check: ProxyCheckResponse | null
  isChecking: boolean
  isDisabled: boolean
  onCheck: () => void
}) {
  const targets = mergeProxyCheckTargets(check?.targets)

  return (
    <SettingsItem
      actionClassName="w-full min-w-0 sm:w-[360px]"
      icon="lucide:radar"
      title="可用性检查"
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {check ? (
               <div className="flex items-center gap-2">
               {targets.map((target) => (
                 <div key={target.name} className="flex items-center justify-between gap-2 rounded-lg bg-surface-secondary/50 px-2.5 py-2">
                   <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                     <Icon icon={target.icon} className="size-3.5 text-muted" />
                     {/* <span className="truncate">{target.name}</span> */}
                   </div>
                   <div className={`text-xs ${target.status === 'error' ? 'text-warning' : target.status === 'ok' ? 'text-success' : 'text-muted'}`}>
                     {target.status === 'pending' ? '-' : target.status === 'ok' ? `${target.latencyMs}ms` : '失败'}
                   </div>
                 </div>
               ))}
             </div>
          ) : null}
          <Button size="sm" variant="secondary" isDisabled={isDisabled} onPress={onCheck}>
            <Icon icon={isChecking ? 'lucide:loader-circle' : 'lucide:activity'} className={isChecking ? 'size-4 animate-spin' : 'size-4'} />
            检查
          </Button>
        </div>
      </div>
    </SettingsItem>
  )
}

type ProxyCheckDisplayTarget = {
  icon: string
  latencyMs: number
  name: 'Google' | 'GitHub' | 'npm Registry'
  status: 'error' | 'ok' | 'pending'
}

const proxyCheckDisplayTargets: Array<Pick<ProxyCheckDisplayTarget, 'icon' | 'name'>> = [
  { icon: 'logos:google-icon', name: 'Google' },
  { icon: 'lucide:github', name: 'GitHub' },
  { icon: 'simple-icons:npm', name: 'npm Registry' },
]

function mergeProxyCheckTargets(targets?: ProxyCheckResponse['targets']): ProxyCheckDisplayTarget[] {
  return proxyCheckDisplayTargets.map((displayTarget) => {
    const target = targets?.find((item) => item.name.toLowerCase() === displayTarget.name.toLowerCase())
    return {
      ...displayTarget,
      latencyMs: target?.latencyMs ?? 0,
      status: target ? target.status === 'ok' ? 'ok' : 'error' : 'pending',
    }
  })
}

function normalizeProxySettings(settings: ProxySettings, includeDefaults = true): ProxySettings {
  const mode: ProxyMode = settings.mode === 'off' || settings.mode === 'custom' ? settings.mode : 'builtin'
  const base = includeDefaults ? defaultProxySettings : { mode } as ProxySettings
  return {
    ...base,
    ...settings,
    mode,
    httpProxy: settings.httpProxy ?? base.httpProxy ?? '',
    httpsProxy: settings.httpsProxy ?? base.httpsProxy ?? '',
    allProxy: settings.allProxy ?? base.allProxy ?? '',
    noProxy: settings.noProxy ?? base.noProxy ?? '',
  }
}

function proxySettingsEqual(left: ProxySettings, right: ProxySettings) {
  const normalizedLeft = normalizeProxySettings(left)
  const normalizedRight = normalizeProxySettings(right)
  return normalizedLeft.mode === normalizedRight.mode
    && normalizedLeft.httpProxy === normalizedRight.httpProxy
    && normalizedLeft.httpsProxy === normalizedRight.httpsProxy
    && normalizedLeft.allProxy === normalizedRight.allProxy
    && normalizedLeft.noProxy === normalizedRight.noProxy
}

function normalizeLoggingSettings(settings: LoggingSettingsResponse): LoggingSettingsResponse {
  const level = settings.level === 'debug' || settings.level === 'warn' || settings.level === 'error'
    ? settings.level
    : 'info'
  return {
    ...defaultLoggingSettings,
    ...settings,
    level,
  }
}

function MaintenanceConfirmDialog({
  appName,
  action,
  isPending,
  onConfirm,
  onOpenChange,
}: {
  appName: string
  action: 'browser' | 'sqlite' | null
  isPending: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  const title = action === 'sqlite' ? '清除后端 SQLite 数据？' : '清除浏览器本地缓存？'
  const body = action === 'sqlite'
    ? `这会清空 ${appName} 后端 SQLite 用户表数据，保留表结构。正在运行的后端会继续使用同一个数据库连接。`
    : '这会清空当前浏览器的本地存储、会话缓存和页面缓存，并立即刷新界面。'

  return (
    <AlertDialog.Backdrop isOpen={action !== null} onOpenChange={onOpenChange}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[440px]">
          <AlertDialog.CloseTrigger />
          <AlertDialog.Header>
            <AlertDialog.Icon status="danger" />
            <AlertDialog.Heading>{title}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p className="text-sm leading-6 text-muted">{body}</p>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="tertiary" isDisabled={isPending}>取消</Button>
            <Button variant="danger" isDisabled={isPending} onPress={onConfirm}>
              <Icon icon={isPending ? 'lucide:loader-circle' : 'lucide:trash-2'} className={isPending ? 'size-4 animate-spin' : 'size-4'} />
              确认清除
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}

function LogoutConfirmDialog({
  isOpen,
  onConfirm,
  onOpenChange,
}: {
  isOpen: boolean
  onConfirm: () => void
  onOpenChange: (isOpen: boolean) => void
}) {
  return (
    <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[440px]">
          <AlertDialog.CloseTrigger />
          <AlertDialog.Header>
            <AlertDialog.Icon status="warning" />
            <AlertDialog.Heading>退出登录？</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p className="text-sm leading-6 text-muted">
              这只会清除当前浏览器中的访问凭证、会话缓存和本地存储，并返回登录界面；不会修改后端配置里的 Token。
            </p>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="tertiary">取消</Button>
            <Button variant="danger" onPress={onConfirm}>
              <Icon icon="lucide:power" className="size-4" />
              确认退出
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}

function useOpenClawAvailable() {
  const [available, setAvailable] = useState<boolean | null>(null)
  const location = useLocation()
  const loadOpenClawEnvironment = useOpenClawEnvironmentStore((store) => store.loadOpenClawEnvironment)

  useEffect(() => {
    let cancelled = false

    const loadAvailability = (refresh = location.pathname === '/dashboard/openclaw-service') => {
      loadOpenClawEnvironment(refresh)
        .then((environment) => {
          if (cancelled) return
          setAvailable(Boolean(environment.cli.available && environment.home.exists && environment.home.configExists))
        })
        .catch(() => {
          if (cancelled) return
          setAvailable(false)
        })
    }

    loadAvailability()
    const handleStatusRefresh = () => loadAvailability(true)
    window.addEventListener('openclaw:status-refresh', handleStatusRefresh)

    return () => {
      cancelled = true
      window.removeEventListener('openclaw:status-refresh', handleStatusRefresh)
    }
  }, [loadOpenClawEnvironment, location.pathname])

  return available
}

function useHermesInstalled() {
  const [installed, setInstalled] = useState<boolean | null>(null)
  const location = useLocation()
  const loadHermesEnvironment = useHermesEnvironmentStore((store) => store.loadHermesEnvironment)

  useEffect(() => {
    let cancelled = false

    const loadInstalled = (refresh = location.pathname === '/dashboard/hermes-service') => {
      loadHermesEnvironment(refresh)
        .then((environment) => {
          if (cancelled) return
          setInstalled(!isHermesUninstalled(environment))
        })
        .catch(() => {
          if (cancelled) return
          setInstalled(false)
        })
    }

    loadInstalled()
    const handleStatusRefresh = () => loadInstalled(true)
    window.addEventListener('hermes:status-refresh', handleStatusRefresh)

    return () => {
      cancelled = true
      window.removeEventListener('hermes:status-refresh', handleStatusRefresh)
    }
  }, [loadHermesEnvironment, location.pathname])

  return installed
}

function isHermesUninstalled(environment: { cli?: { available?: boolean }; home?: { exists?: boolean } }) {
  return environment.cli?.available === false && environment.home?.exists === false
}

function useCCConnectInstalled() {
  const [installed, setInstalled] = useState<boolean | null>(null)
  const location = useLocation()
  const loadCCConnectEnvironment = useCCConnectEnvironmentStore((store) => store.loadCCConnectEnvironment)

  useEffect(() => {
    let cancelled = false

    const loadInstalled = (refresh = location.pathname === '/dashboard/cc-service') => {
      loadCCConnectEnvironment(refresh)
        .then((environment) => {
          if (cancelled) return
          setInstalled(Boolean(environment.cli.available && environment.home.configExists))
        })
        .catch(() => {
          if (cancelled) return
          setInstalled(false)
        })
    }

    loadInstalled()
    const handleStatusRefresh = () => loadInstalled(true)
    window.addEventListener('cc-connect:status-refresh', handleStatusRefresh)

    return () => {
      cancelled = true
      window.removeEventListener('cc-connect:status-refresh', handleStatusRefresh)
    }
  }, [loadCCConnectEnvironment, location.pathname])

  return installed
}

function getExplicitDashboardEngine(pathname: string): DashboardEngine | null {
  if (pathname.startsWith('/dashboard/cc')) return 'cc'
  if (pathname.startsWith('/dashboard/hermes')) return 'hermes'
  if (pathname.startsWith('/dashboard/openclaw')) return 'openclaw'
  return null
}

function accessCredentialTargetToDashboardEngine(target?: 'all' | DashboardEngine) {
  if (!target || target === 'all') return null
  return target
}

function isSharedDashboardPath(pathname?: string) {
  return pathname === '/dashboard/plugins' || pathname === '/dashboard/system'
}

function DashboardNavbar({ activeEngine, sidebarOpen }: { activeEngine: DashboardEngine; sidebarOpen: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const currentItem = findDashboardNavItem(location.pathname) ?? dashboardNavItems[0]
  const currentTitle = dashboardNavbarTitles[location.pathname] ?? currentItem.label
  const activeAccessCredential = useActiveAccessCredential()
  const shouldShowEngineSwitcher = !activeAccessCredential || activeAccessCredential.target === 'all'
  const noticeEnabled = useNoticeStore((state) => state.enable)
  const openNotice = useNoticeStore((state) => state.open)
  const refreshPage = useCallback(() => {
    window.location.reload()
  }, [])

  return (
    <Navbar maxWidth="full" navigate={navigate}>
      <Navbar.Header data-tauri-drag-region>
        {sidebarOpen ? null : <TauriTrafficLights />}
        <AppLayout.MenuToggle />
        <Sidebar.Trigger />
        <div className="flex min-w-0 items-center gap-2 font-semibold text-foreground">
          {/* <Icon icon={currentItem.icon} className="size-4 shrink-0" /> */}
          <span className="truncate">{currentTitle}</span>
        </div>
        <Navbar.Spacer />
        <Navbar.Content>
          <Button isIconOnly size="sm" variant="ghost" aria-label="刷新页面" onPress={refreshPage}>
            <Icon icon="lucide:refresh-cw" className="size-4" />
          </Button>
          {noticeEnabled ? (
            <Button isIconOnly size="sm" variant="ghost" aria-label="公告" onPress={openNotice}>
              <Icon icon="lucide:bell" className="size-4" />
            </Button>
          ) : null}
          <BackendSecurityCapsule />
          {activeEngine === 'openclaw' ? <OpenClawStatusCapsule /> : null}
          {activeEngine === 'hermes' ? <HermesAgentCapsule /> : null}
          {activeEngine === 'cc' ? <CCConnectStatusCapsule /> : null}
          <StyleSwitcher />
          <ThemeSwitcher />
          {shouldShowEngineSwitcher ? <EngineSwitcher activeEngine={activeEngine} /> : null}
          <CredentialManagerButton />
        </Navbar.Content>
      </Navbar.Header>
    </Navbar>
  )
}

export default DashboardLayout
