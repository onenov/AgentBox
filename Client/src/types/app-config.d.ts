export interface AppConfig {
  APP_VERSION: string
  APP_NAME: string
  APP_LOGO: string
  APP_DESCRIPTION: string
  APP_KEYWORDS: string
  APP_AUTHOR: string
  APP_COPYRIGHT: string
  GEETEST_ID: string
  AMAP_WEB_KEY: string
  AMAP_JS_KEY: string
  AMAP_SECURITY_CODE: string
  THEME?: 'light' | 'dark' | 'system'
  THEME_STYLE?: 'glass' | 'default'
  THEME_COLOR?: 'lime' | 'green' | 'red' | 'orange' | 'pink' | 'emerald' | 'teal' | 'cyan' | 'sky' | 'blue' | 'indigo' | 'violet' | 'purple' | 'neutral'
  THEME_GENERAL_RADIUS?: number
  THEME_FORMS_RADIUS?: number
  THEME_FONT?: 'Raleway' | 'DM Sans' | 'Geist' | 'Inter' | 'Poppins' | 'Outfit'
  HOME_ROUTE: string
  API_URL: string
  MODEL_CATALOG_URL: string
  MODEL_INITIALIZATION_URL: string
  MODEL_ICON_BASE_URL: string
  NOTICE_URL: string
  UPDATE_URL: string
  ABOUT_URL: string
  CONNECT_URL: string
  PROMOTION_URL: string
  WPUSH_KEY: string
}

export {}

declare global {
  interface Window {
    APP_CONFIG: AppConfig
  }
}
