import { useEffect } from 'react'
import { hydrateDesktopThemePreference, useThemeStore } from '@/stores/theme'

function Style() {
  const theme = useThemeStore((state) => state.theme)
  const themeStyle = useThemeStore((state) => state.themeStyle)
  const themeColor = useThemeStore((state) => state.themeColor)
  const themeGeneralRadius = useThemeStore((state) => state.themeGeneralRadius)
  const themeFormsRadius = useThemeStore((state) => state.themeFormsRadius)
  const themeFont = useThemeStore((state) => state.themeFont)
  const syncTheme = useThemeStore((state) => state.syncTheme)

  useEffect(() => {
    hydrateDesktopThemePreference()
  }, [])

  useEffect(() => {
    syncTheme()
  }, [syncTheme, theme, themeColor, themeFont, themeFormsRadius, themeGeneralRadius, themeStyle])

  return null
}

export default Style
