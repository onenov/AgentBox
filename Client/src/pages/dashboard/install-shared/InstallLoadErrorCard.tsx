import { Button, Card } from '@heroui/react'
import { Icon } from '@iconify/react'

type InstallLoadErrorCardProps = {
  compact?: boolean
  error: string
  isRetrying?: boolean
  onRetry: () => void
  title: string
}

export function InstallLoadErrorCard({ compact = false, error, isRetrying = false, onRetry, title }: InstallLoadErrorCardProps) {
  if (compact) {
    return (
      <Card>
        <Card.Content>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3 text-danger">
              <Icon icon="lucide:triangle-alert" className="mt-0.5 size-5 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-foreground">{title}</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-muted">{error}</p>
              </div>
            </div>
            <Button className="w-full sm:w-auto" variant="primary" onPress={onRetry} isDisabled={isRetrying}>
              <Icon icon={isRetrying ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={isRetrying ? 'animate-spin' : ''} />
              重新检测
            </Button>
          </div>
        </Card.Content>
      </Card>
    )
  }

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] w-full items-center justify-center">
      <Card className="w-full max-w-md">
        <Card.Content>
          <div className="flex flex-col items-center px-6 py-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
              <Icon icon="lucide:triangle-alert" className="size-6" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-foreground">{title}</h2>
            <p className="mt-2 max-w-sm whitespace-pre-wrap break-words text-sm leading-6 text-muted">{error}</p>
            <Button className="mt-6" variant="primary" onPress={onRetry} isDisabled={isRetrying}>
              <Icon icon={isRetrying ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={isRetrying ? 'animate-spin' : ''} />
              重新检测
            </Button>
          </div>
        </Card.Content>
      </Card>
    </div>
  )
}
