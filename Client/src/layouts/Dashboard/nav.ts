export interface DashboardNavItem {
  badge?: string
  icon: string
  items?: DashboardNavItem[]
  label: string
  path?: string
}

export interface DashboardNavGroup {
  items: DashboardNavItem[]
  label: string
}

export const dashboardNavGroups: DashboardNavGroup[] = [
  {
    label: '监控',
    items: [
      { icon: 'lucide:laptop-minimal', label: '仪表盘', path: '/dashboard/openclaw' },
      { icon: 'lucide:laptop-minimal', label: '仪表盘', path: '/dashboard/hermes' },
      { icon: 'lucide:laptop-minimal', label: '仪表盘', path: '/dashboard/cc' },
    ],
  },
  {
    label: 'Hermes',
    items: [
      { icon: 'lucide:terminal-square', label: '终端', path: '/dashboard/hermes-terminal' },
      { icon: 'lucide:messages-square', label: '会话管理', path: '/dashboard/hermes-sessions' },
      { icon: 'lucide:kanban-square', label: '任务看板', path: '/dashboard/hermes-kanban' },
    ],
  },
  {
    label: 'CC-Connect',
    items: [
      { icon: 'lucide:terminal-square', label: '终端', path: '/dashboard/cc-terminal' },
      { icon: 'lucide:messages-square', label: '会话管理', path: '/dashboard/cc-sessions' },
    ],
  },
  {
    label: '配置',
    items: [
      { icon: 'lucide:users-round', label: '智能体', path: '/dashboard/openclaw-agents' },
      { icon: 'lucide:brain-circuit', label: '模型配置', path: '/dashboard/openclaw-models' },
      { icon: 'lucide:messages-square', label: '消息渠道', path: '/dashboard/openclaw-channels' },
      { icon: 'lucide:users-round', label: '智能体', path: '/dashboard/hermes-agents' },
      { icon: 'lucide:brain-circuit', label: '模型配置', path: '/dashboard/hermes-models' },
      { icon: 'lucide:messages-square', label: '消息平台', path: '/dashboard/hermes-platforms' },
      { icon: 'lucide:folder-cog', label: '项目管理', path: '/dashboard/cc-projects' },
      { icon: 'lucide:brain-circuit', label: '模型配置', path: '/dashboard/cc-models' },
    ],
  },
  {
    label: '扩展',
    items: [
      { icon: 'lucide:moon-star', label: '梦境模式', path: '/dashboard/openclaw-dreaming' },
      { icon: 'lucide:sparkles', label: '技能中心', path: '/dashboard/openclaw-skills' },
      { icon: 'lucide:package-plus', label: '扩展插件', path: '/dashboard/openclaw-plugins' },
      { icon: 'lucide:calendar-clock', label: '定时任务', path: '/dashboard/openclaw-cron' },
      { icon: 'lucide:sparkles', label: '技能中心', path: '/dashboard/hermes-skills' },
      { icon: 'lucide:puzzle', label: '扩展插件', path: '/dashboard/hermes-plugins' },
      { icon: 'lucide:calendar-clock', label: '定时任务', path: '/dashboard/hermes-cron' },
      { icon: 'lucide:sparkles', label: '技能中心', path: '/dashboard/cc-skills' },
    ],
  },
  {
    label: '管理',
    items: [
      // { icon: 'lucide:wand-sparkles', label: '安装向导', path: '/dashboard/openclaw-install' },
      // { icon: 'lucide:wand-sparkles', label: '安装向导', path: '/dashboard/hermes-install' },
      { icon: 'lucide:folder-tree', label: '文件管理', path: '/dashboard/openclaw-workspaces' },
      { icon: 'lucide:server-cog', label: '服务管理', path: '/dashboard/openclaw-service' },
      { icon: 'lucide:scroll-text', label: '运行日志', path: '/dashboard/hermes-logs' },
      { icon: 'lucide:bot', label: '服务管理', path: '/dashboard/hermes-service' },
      { icon: 'lucide:radio-tower', label: 'CC 服务', path: '/dashboard/cc-service' },
      { icon: 'lucide:scroll-text', label: '运行日志', path: '/dashboard/cc-logs' },
      { icon: 'lucide:scroll-text', label: '运行日志', path: '/dashboard/openclaw-logs' },
    ],
  },
]

export const dashboardNavItems: DashboardNavItem[] = dashboardNavGroups.flatMap((group) => group.items)

export const dashboardFooterNavItems: DashboardNavItem[] = [
  { icon: 'lucide:blocks', label: '应用管理', path: '/dashboard/plugins' },
  { icon: 'lucide:monitor-cog', label: '系统信息', path: '/dashboard/system' },
]

export const dashboardMobileNavItems: DashboardNavItem[] = [
  ...dashboardNavItems,
  ...dashboardFooterNavItems,
]

export function findDashboardNavItem(pathname: string) {
  return findNavItem([...dashboardNavItems, ...dashboardFooterNavItems], pathname)
}

function findNavItem(items: DashboardNavItem[], pathname: string): DashboardNavItem | undefined {
  for (const item of items) {
    if (item.path === pathname) {
      return item
    }

    if (item.items) {
      const matched = findNavItem(item.items, pathname)
      if (matched) {
        return matched
      }
    }
  }
}
