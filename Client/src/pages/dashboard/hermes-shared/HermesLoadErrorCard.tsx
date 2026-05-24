import { Button, Card } from '@heroui/react'
import { Icon } from '@iconify/react'

type HermesLoadErrorCardProps = {
  error: string
  isRetrying?: boolean
  onRetry: () => void
  title: string
}

export function HermesLoadErrorCard({ error, isRetrying = false, onRetry, title }: HermesLoadErrorCardProps) {
  return (
    <Card className="w-full max-w-md">
      <Card.Content>
        <div className="flex flex-col items-center px-6 py-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
            <Icon icon="lucide:circle-alert" className="size-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-foreground">{title}</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{error}</p>
          <Button className="mt-6" variant="primary" onPress={onRetry} isDisabled={isRetrying}>
            <Icon icon={isRetrying ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={isRetrying ? 'animate-spin' : ''} />
            重新加载
          </Button>
        </div>
      </Card.Content>
    </Card>
  )
}
