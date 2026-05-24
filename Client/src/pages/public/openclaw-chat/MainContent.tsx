import Message from './Message'
import ChatSendBox from './SendBox'
import { Card } from '@heroui/react'

function OpenClawChatMainContent() {
  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] min-h-0 w-full max-w-6xl flex-col gap-4 md:px-4 md:pb-0 px-0 pb-0">
      <Card variant="transparent" className="flex min-h-0 flex-1 overflow-hidden">
        <Card.Content className="flex min-h-0 flex-1 flex-col p-0">
          <Message />
          <ChatSendBox />
        </Card.Content>
      </Card>
    </div>
  )
}

export default OpenClawChatMainContent
