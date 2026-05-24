import { useEffect } from 'react'
import { useLocation, useNavigation, useOutlet } from 'react-router-dom'
import { Spinner } from '@heroui/react'
import { Icon } from '@iconify/react'
import AppNoticeModal from '@/components/AppNoticeModal'
import { findDashboardNavItem } from '@/layouts/Dashboard/nav'
import DashboardLayout from '@/layouts/Dashboard'
import { setDocumentTitle } from '@/hooks/usePageTitle'
import { useNoticeStore } from '@/stores/notice'

const NOTICE_LOAD_DELAY_MS = 3000

const dashboardRouteLog = (message: string, detail?: Record<string, unknown>) => {
  console.info(`[Dashboard路由] ${message}`, detail ?? '')
}

const dashboardPageTitles: Record<string, string> = {
  '/dashboard': 'About',
  '/dashboard/openclaw': 'OpenClaw',
  '/dashboard/openclaw-agents': 'OpenClaw 智能体',
  '/dashboard/openclaw-channels': 'OpenClaw 消息渠道',
  '/dashboard/openclaw-cron': 'OpenClaw 定时任务',
  '/dashboard/openclaw-dreaming': 'OpenClaw 梦境模式',
  '/dashboard/openclaw-logs': 'OpenClaw 日志',
  '/dashboard/openclaw-models': 'OpenClaw 模型配置',
  '/dashboard/openclaw-plugins': 'OpenClaw 扩展插件',
  '/dashboard/openclaw-service': 'OpenClaw 服务管理',
  '/dashboard/openclaw-skills': 'OpenClaw 技能中心',
  '/dashboard/openclaw-workspaces': 'OpenClaw 工作区文件',
  '/dashboard/hermes': 'Hermes',
  '/dashboard/hermes-cron': 'Hermes 定时任务',
  '/dashboard/hermes-agents': 'Hermes 智能体',
  '/dashboard/hermes-install': 'Hermes 安装向导',
  '/dashboard/hermes-kanban': 'Hermes 任务看板',
  '/dashboard/hermes-logs': 'Hermes 日志',
  '/dashboard/hermes-models': 'Hermes 模型配置',
  '/dashboard/hermes-platforms': 'Hermes 消息平台',
  '/dashboard/hermes-plugins': 'Hermes 插件',
  '/dashboard/hermes-sessions': 'Hermes 会话管理',
  '/dashboard/hermes-service': 'Hermes 服务管理',
  '/dashboard/hermes-skills': 'Hermes 技能中心',
  '/dashboard/hermes-terminal': 'Hermes 终端',
  '/dashboard/cc': 'CC-Connect',
  '/dashboard/cc-install': 'CC-Connect 安装向导',
  '/dashboard/cc-logs': 'CC-Connect 日志',
  '/dashboard/cc-models': 'CC-Connect 模型配置',
  '/dashboard/cc-projects': 'CC-Connect 项目管理',
  '/dashboard/cc-sessions': 'CC-Connect 会话管理',
  '/dashboard/cc-service': 'CC-Connect 服务管理',
  '/dashboard/cc-skills': 'CC-Connect 技能中心',
  '/dashboard/cc-terminal': 'CC-Connect 终端',
  '/dashboard/plugins': '应用管理',
  '/dashboard/system': '系统信息',
}

function isDashboardPath(pathname: string) {
  return pathname === '/dashboard' || pathname.startsWith('/dashboard/')
}

function normalizeDashboardCacheKey(pathname: string) {
  const normalizedPathname = pathname.replace(/\/+$/, '')

  return normalizedPathname || '/dashboard'
}

function DashboardRouteLoading({ activeKey }: { activeKey: string }) {
  const item = findDashboardNavItem(activeKey)
  const title = dashboardPageTitles[activeKey] ?? item?.label ?? '加载中'

  return (
    <div className="flex min-h-[calc(100dvh-9rem)] items-center justify-center">
      <div className="flex flex-col items-center text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-surface-secondary/60 text-muted">
          {item?.icon ? <Icon icon={item.icon} className="size-7" /> : <Spinner color="current" size="sm" />}
        </div>
        <div className="mt-4 text-base font-semibold text-foreground">{title}</div>
        <div className="mt-2 flex items-center gap-2 text-sm text-muted">
          <Spinner color="current" size="sm" />
          正在加载页面
        </div>
      </div>
    </div>
  )
}

function DefaultLayout() {
  const location = useLocation()
  const navigation = useNavigation()
  const outlet = useOutlet()
  const currentDashboardKey = isDashboardPath(location.pathname) ? normalizeDashboardCacheKey(location.pathname) : null
  const pendingDashboardKey = navigation.location && isDashboardPath(navigation.location.pathname)
    ? normalizeDashboardCacheKey(navigation.location.pathname)
    : null
  const dashboardActiveKey = pendingDashboardKey ?? currentDashboardKey
  const isDashboardRoute = isDashboardPath(location.pathname) || Boolean(pendingDashboardKey)
  const isDashboardPending = Boolean(pendingDashboardKey && pendingDashboardKey !== currentDashboardKey)
  const isLoginPath = location.pathname === '/login'
  const noticeLoaded = useNoticeStore((state) => state.loaded)
  const loadNotice = useNoticeStore((state) => state.load)
  const closeNotice = useNoticeStore((state) => state.close)

  useEffect(() => {
    dashboardRouteLog('DefaultLayout 路由状态变化', {
      currentDashboardKey,
      dashboardActiveKey,
      isDashboardPending,
      locationPathname: location.pathname,
      navigationPathname: navigation.location?.pathname ?? null,
      navigationState: navigation.state,
      pendingDashboardKey,
    })
  }, [currentDashboardKey, dashboardActiveKey, isDashboardPending, location.pathname, navigation.location?.pathname, navigation.state, pendingDashboardKey])

  useEffect(() => {
    if (!dashboardActiveKey) return
    setDocumentTitle(dashboardPageTitles[dashboardActiveKey] ?? findDashboardNavItem(dashboardActiveKey)?.label)
  }, [dashboardActiveKey])

  useEffect(() => {
    if (isLoginPath) {
      closeNotice()
      return
    }

    if (noticeLoaded) return

    const timer = window.setTimeout(() => {
      void loadNotice()
    }, NOTICE_LOAD_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [closeNotice, isLoginPath, loadNotice, noticeLoaded])

  const dashboardContent = isDashboardPending && !currentDashboardKey && dashboardActiveKey
    ? <DashboardRouteLoading activeKey={dashboardActiveKey} />
    : outlet

  return (
    <main className={isLoginPath ? 'grid min-h-screen place-items-center px-4 py-8 text-foreground' : 'min-h-screen text-foreground'}>
      {isDashboardRoute ? <DashboardLayout>{dashboardContent}</DashboardLayout> : outlet}
      <AppNoticeModal />
    </main>
  )
}

export default DefaultLayout
