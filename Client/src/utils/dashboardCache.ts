const DASHBOARD_CACHE_CLEAR_EVENT = 'agent-box:dashboard-cache-clear'

export function addDashboardPageCacheClearListener(listener: () => void) {
  window.addEventListener(DASHBOARD_CACHE_CLEAR_EVENT, listener)

  return () => window.removeEventListener(DASHBOARD_CACHE_CLEAR_EVENT, listener)
}

export function clearDashboardPageCache() {
  window.dispatchEvent(new Event(DASHBOARD_CACHE_CLEAR_EVENT))
}
