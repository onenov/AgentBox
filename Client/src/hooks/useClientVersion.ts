import { useEffect, useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { appConfig } from '@/stores/config'
import { isTauriRuntime } from '@/utils/tauri'

export function useClientVersion() {
  const [version, setVersion] = useState(appConfig.APP_VERSION)

  useEffect(() => {
    if (!isTauriRuntime()) {
      return
    }

    let cancelled = false
    void getVersion()
      .then((clientVersion) => {
        if (!cancelled && clientVersion) {
          setVersion(clientVersion)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVersion(appConfig.APP_VERSION)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  return version
}
