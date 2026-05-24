import { useEffect } from 'react'
import { appConfig } from '@/stores/config'

export const getDocumentTitle = (pageTitle?: string) => {
  if (pageTitle) return `${pageTitle} - ${appConfig.APP_NAME}`

  return `${appConfig.APP_NAME} - ${appConfig.APP_DESCRIPTION}`
}

export const setDocumentTitle = (pageTitle?: string) => {
  document.title = getDocumentTitle(pageTitle)
}

export const usePageTitle = (pageTitle?: string) => {
  useEffect(() => {
    setDocumentTitle(pageTitle)
  }, [pageTitle])
}
