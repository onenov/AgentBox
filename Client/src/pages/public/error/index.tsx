import { Button } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useEffect } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useConfigStore } from '@/stores/config'

function getErrorMessage(error: unknown) {
  if (isRouteErrorResponse(error)) {
    if (typeof error.data === 'string') return error.data
    if (error.data && typeof error.data === 'object' && 'message' in error.data) {
      return String(error.data.message)
    }

    return error.statusText || '请求的页面无法访问'
  }

  if (error instanceof Error) return error.message

  return '页面不存在或发生未知错误'
}

function serializeUnknown(value: unknown) {
  if (value instanceof Error) {
    return JSON.stringify(
      {
        name: value.name,
        message: value.message,
        stack: value.stack,
        cause: value.cause,
      },
      null,
      2,
    )
  }

  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}

function ErrorPage() {
  const error = useRouteError()
  const isRouteError = isRouteErrorResponse(error)
  const isRuntimeError = error instanceof Error
  const status = isRouteError ? error.status : isRuntimeError ? 500 : 404
  const message = getErrorMessage(error)
  const homeRoute = useConfigStore((state) => state.homeRoute)
  const shouldShowDevDetails = import.meta.env.DEV && isRuntimeError
  const errorStack = isRuntimeError ? error.stack ?? error.message : message
  const errorName = isRuntimeError ? error.name : isRouteError ? 'Route Error Response' : typeof error
  const errorCause = isRuntimeError && error.cause ? serializeUnknown(error.cause) : '无'
  const rawError = serializeUnknown(error)
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
  const timestamp = new Date().toLocaleString()
  const fullDebugText = [
    `Name: ${errorName}`,
    `Status: ${status}`,
    `Path: ${currentUrl}`,
    `Time: ${timestamp}`,
    `Message: ${message}`,
    '',
    'Cause:',
    errorCause,
    '',
    'Stack:',
    errorStack,
    '',
    'Raw Error:',
    rawError,
  ].join('\n')

  usePageTitle(`${status}`)

  useEffect(() => {
    if (isRuntimeError) {
      console.error(error)
    }
  }, [error, isRuntimeError])

  if (shouldShowDevDetails) {
    return (
      <main className="min-h-screen bg-background p-4 text-foreground">
        <section className="mx-auto flex w-full flex-col gap-5">
          <div className="rounded-3xl bg-surface p-6">
            <div className="flex items-start gap-4">
              <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-danger/10 text-danger">
                <Icon icon="lucide:bug" className="text-2xl" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger">Development Error</span>
                  <span className="rounded-full bg-surface-secondary/50 px-2.5 py-1 text-xs text-muted">React Router Boundary</span>
                  <span className="rounded-full bg-surface-secondary/50 px-2.5 py-1 text-xs text-muted">{errorName}</span>
                </div>
                <h1 className="break-words text-xl font-semibold leading-tight text-foreground sm:text-2xl">{message}</h1>
                <p className="mt-2 break-all text-sm text-muted">{currentUrl}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button isIconOnly variant="outline" onPress={() => navigator.clipboard?.writeText(fullDebugText)}>
                  <Icon icon="lucide:copy" className="text-base" />
                </Button>
                <Button isIconOnly variant="outline" onPress={() => window.history.back()}>
                  <Icon icon="lucide:corner-up-left" className="text-base" />
                </Button>
                <Button isIconOnly variant="primary" onPress={() => window.location.reload()}>
                  <Icon icon="lucide:refresh-cw" className="text-base" />
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
            <aside className="rounded-3xl bg-surface p-5">
              <div className="space-y-4 text-sm">
                <div>
                  <p className="mb-1 text-xs text-muted">Status</p>
                  <p className="font-medium text-foreground">{status}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted">Error Name</p>
                  <p className="break-words font-medium text-foreground">{errorName}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted">Route</p>
                  <p className="break-all font-medium text-foreground">{currentUrl}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted">Time</p>
                  <p className="font-medium text-foreground">{timestamp}</p>
                </div>
              </div>
            </aside>

            <div className="flex flex-col gap-5">
              <section className="rounded-3xl bg-surface p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                  <Icon icon="lucide:message-square-warning" className="text-base text-danger" />
                  Message
                </div>
                <pre className="overflow-auto whitespace-pre-wrap rounded-2xl bg-surface-secondary/50 p-4 text-sm leading-6 text-foreground">{message}</pre>
              </section>

              <section className="rounded-3xl bg-surface p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                  <Icon icon="lucide:terminal" className="text-base text-muted" />
                  Stack Trace
                </div>
                <pre className="max-h-[42vh] overflow-auto whitespace-pre-wrap rounded-2xl bg-surface-secondary/50 p-4 text-xs leading-6 text-muted">{errorStack}</pre>
              </section>

              <section className="grid gap-5 xl:grid-cols-2">
                <div className="rounded-3xl bg-surface p-5">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                    <Icon icon="lucide:git-branch" className="text-base text-muted" />
                    Cause
                  </div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl bg-surface-secondary/50 p-4 text-xs leading-6 text-muted">{errorCause}</pre>
                </div>

                <div className="rounded-3xl bg-surface p-5">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                    <Icon icon="lucide:braces" className="text-base text-muted" />
                    Raw Error
                  </div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl bg-surface-secondary/50 p-4 text-xs leading-6 text-muted">{rawError}</pre>
                </div>
              </section>
            </div>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="grid min-h-screen place-items-center px-6 py-10 text-foreground">
      <section className="flex w-full max-w-4xl flex-col items-center rounded-3xl bg-surface/90 p-8 text-center">
        <img
          src="https://assets.orence.net/file/20260511184753205.png"
          alt="错误提示"
          className="w-64 h-auto select-none object-contain"
          draggable={false}
        />

        <div className="mb-2 rounded-full bg-surface-secondary/50 px-3 py-1 text-sm font-medium text-muted">
          {status}
        </div>
        <h1 className="text-3xl font-semibold leading-tight text-foreground">页面出错了</h1>
        <p className="mt-3 max-w-sm text-sm leading-6 text-muted">{message}</p>

        <div className="mb-10 mt-6 flex flex-wrap justify-center gap-2">
          <Button
            variant="primary"
            onPress={() => window.location.assign(homeRoute)}
          >
            <Icon icon="lucide:house" className="text-base" />
            返回首页
          </Button>
          <Button
            variant="tertiary"
            onPress={() => window.history.back()}
          >
            <Icon icon="lucide:corner-up-left" className="text-base" />
            返回上一页
          </Button>
        </div>
      </section>
    </main>
  )
}

export default ErrorPage
