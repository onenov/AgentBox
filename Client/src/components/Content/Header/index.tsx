import type { ReactNode } from 'react'
import { Navbar } from '@heroui-pro/react'
import { Icon } from '@iconify/react'
import { useLocation, useNavigate } from 'react-router-dom'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import StyleSwitcher from '@/components/Style/Switcher'
import { useConfigStore } from '@/stores/config'

export interface ContentHeaderNavItem {
  label: string
  path: string
  icon?: string
}

interface ContentHeaderProps {
  title?: string
  description?: string
  navItems?: ContentHeaderNavItem[]
  showBrand?: boolean
  actions?: ReactNode
  className?: string
}

const defaultNavItems: ContentHeaderNavItem[] = [
  { label: '欢迎', path: '/welcome', icon: 'gravity-ui:house' },
  { label: 'About', path: '/dashboard', icon: 'gravity-ui:chart-column' },
]

function ContentHeader({
  title,
  description,
  navItems = defaultNavItems,
  showBrand = true,
  actions,
  className,
}: ContentHeaderProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const appName = useConfigStore((state) => state.appName)
  const appLogo = useConfigStore((state) => state.appLogo)

  return (
    <Navbar
      maxWidth="full"
      navigate={navigate}
      position="static"
      className={['rounded-3xl bg-surface/80 shadow-surface backdrop-blur', className].filter(Boolean).join(' ')}
    >
      <Navbar.Header>
        <Navbar.MenuToggle className="md:hidden" />

        {showBrand ? (
          <Navbar.Brand>
            <img src={appLogo} alt={appName} className="size-9 rounded-2xl" draggable={false} />
            <Navbar.Label>{appName}</Navbar.Label>
          </Navbar.Brand>
        ) : null}

        {title ? (
          <div className="min-w-0">
            <p className="truncate text-sm text-muted">{description}</p>
            <h1 className="truncate text-xl font-bold tracking-tight text-foreground">{title}</h1>
          </div>
        ) : null}

        <Navbar.Content className="hidden md:flex">
          {navItems.map((item) => (
            <Navbar.Item key={item.path} href={item.path} isCurrent={location.pathname === item.path}>
              {item.icon ? <Icon data-slot="icon" icon={item.icon} /> : null}
              <Navbar.Label>{item.label}</Navbar.Label>
            </Navbar.Item>
          ))}
        </Navbar.Content>

        <Navbar.Spacer />

        {actions ? <Navbar.Content>{actions}</Navbar.Content> : null}

        <Navbar.Content>
          <StyleSwitcher />
          <ThemeSwitcher />
        </Navbar.Content>
      </Navbar.Header>

      <Navbar.Menu>
        {navItems.map((item) => (
          <Navbar.MenuItem key={item.path} href={item.path} isCurrent={location.pathname === item.path}>
            {item.icon ? <Icon data-slot="icon" icon={item.icon} /> : null}
            <Navbar.Label>{item.label}</Navbar.Label>
          </Navbar.MenuItem>
        ))}
      </Navbar.Menu>
    </Navbar>
  )
}

export default ContentHeader
