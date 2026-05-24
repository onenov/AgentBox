import { Navigate } from 'react-router-dom'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useConfigStore } from '@/stores/config'

function HomePage() {
  const homeRoute = useConfigStore((state) => state.homeRoute)
  usePageTitle()

  return <Navigate to={homeRoute} replace />
}

export default HomePage
