import { Icon } from '@iconify/react'
import { Tabs } from '@heroui/react'
import type { Key } from 'react'
import { useThemeStore, type ThemeMode } from '@/stores/theme'

const themeOptions: Array<{ label: string; mode: ThemeMode; icon: string }> = [
  { label: 'light', mode: 'light', icon: 'material-symbols:light-mode-rounded' },
  { label: 'dark', mode: 'dark', icon: 'material-symbols:dark-mode-rounded' },
  { label: 'system', mode: 'system', icon: 'material-symbols:desktop-windows-rounded' },
]

function ThemeSwitcher() {
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)

  const handleThemeChange = (key: Key) => {
    if (key === 'light' || key === 'dark' || key === 'system') {
      setTheme(key)
    }
  }

  return (
    <Tabs aria-label="主题切换" data-theme-toggle selectedKey={theme} onSelectionChange={handleThemeChange}>
      <Tabs.ListContainer>
        <Tabs.List>
          {themeOptions.map((option) => (
            <Tabs.Tab aria-label={option.label} className="size-7 p-1.5" id={option.mode} key={option.mode}>
              <Icon className="size-4" icon={option.icon} />
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs>
  )
}

export default ThemeSwitcher
