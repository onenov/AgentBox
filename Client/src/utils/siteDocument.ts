import { setDocumentTitle } from '@/hooks/usePageTitle'
import { appConfig } from '@/stores/config'

const setMetaContent = (name: string, content: string) => {
  let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)

  if (!meta) {
    meta = document.createElement('meta')
    meta.name = name
    document.head.append(meta)
  }

  meta.content = content
}

const setFavicon = (href: string) => {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')

  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    link.type = 'image/svg+xml'
    document.head.append(link)
  }

  link.href = href
}

export const setupSiteDocument = () => {
  setDocumentTitle()
  setFavicon(appConfig.APP_LOGO)
  setMetaContent('description', appConfig.APP_DESCRIPTION)
  setMetaContent('keywords', appConfig.APP_KEYWORDS)
  setMetaContent('author', appConfig.APP_AUTHOR)
  setMetaContent('copyright', appConfig.APP_COPYRIGHT)
}
