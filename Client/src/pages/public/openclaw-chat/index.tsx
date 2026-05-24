import { AppLayout } from '@heroui-pro/react'
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePageTitle } from '@/hooks/usePageTitle'
import OpenClawChatMainContent from './MainContent'
import { OpenClawChatProvider } from './OpenClawChatContext'
import OpenClawChatPageHeader from './PageHeader'
import OpenClawChatSidebarContent from './SidebarContent'

const RESIZABLE_AUTO_SAVE_ID = 'openclaw-chat:resizable-sidebar'
const SIDEBAR_STATE_COOKIE = 'sidebar_state'

function readSidebarOpenCookie() {
  if (typeof document === 'undefined') return true

  return document.cookie.split('; ').find((row) => row.startsWith(`${SIDEBAR_STATE_COOKIE}=`))?.split('=')[1] !== 'false'
}

function persistSidebarOpen(open: boolean) {
  if (typeof document === 'undefined') return

  document.cookie = `${SIDEBAR_STATE_COOKIE}=${String(open)}; path=/; max-age=31536000`
}

function OpenClawChatPage() {
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpenCookie)
  usePageTitle('Chat')

  const handleSidebarOpenChange = useCallback((open: boolean) => {
    setSidebarOpen(open)
    persistSidebarOpen(open)
  }, [])

  return (
    <OpenClawChatProvider>
      <AppLayout
        navbar={<OpenClawChatPageHeader sidebarOpen={sidebarOpen} />}
        navigate={navigate}
        onSidebarOpenChange={handleSidebarOpenChange}
        resizableAutoSaveId={RESIZABLE_AUTO_SAVE_ID}
        sidebar={<OpenClawChatSidebarContent sidebarOpen={sidebarOpen} />}
        sidebarCollapsible="offcanvas"
        sidebarDefaultSize={22}
        sidebarMaxSize={40}
        sidebarMinSize={20}
        sidebarOpen={sidebarOpen}
        sidebarResizable
      >
        <OpenClawChatMainContent />
      </AppLayout>
    </OpenClawChatProvider>
  )
}

export default OpenClawChatPage
