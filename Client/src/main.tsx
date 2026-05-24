import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ToastProvider } from '@heroui/react'
import { RouterProvider } from 'react-router-dom'
import { setupSiteDocument } from './utils/siteDocument'
import { setupTauriDocument } from './utils/tauri'
import { setupExternalLinkInterceptor } from './utils/openExternalUrl'
import { hydrateDesktopLocalStorage } from './utils/desktopStorage'
import { hydrateDesktopAuthPreferences } from './utils/desktopAuthPreferences'
import './assets/css/main.css' // 主入口 CSS 文件
import './assets/css/utilities.scss' // 工具类 CSS 文件

async function bootstrap() {
  setupSiteDocument()
  setupTauriDocument()
  setupExternalLinkInterceptor()
  await hydrateDesktopLocalStorage()
  await hydrateDesktopAuthPreferences()
  const [{ default: Style }, { router }] = await Promise.all([
    import('./components/Style'),
    import('./router'),
  ])

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Style />
      <ToastProvider className="[&_[data-slot=toast-close]]:hidden" placement="bottom" />
      <RouterProvider router={router} />
    </StrictMode>,
  )
}

void bootstrap()
