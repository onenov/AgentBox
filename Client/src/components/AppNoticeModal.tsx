import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Modal } from '@heroui/react'
import { useNoticeStore } from '@/stores/notice'

function AppNoticeModal() {
  const banner = useNoticeStore((state) => state.banner)
  const content = useNoticeStore((state) => state.content)
  const isOpen = useNoticeStore((state) => state.modalOpen)
  const setModalOpen = useNoticeStore((state) => state.setModalOpen)
  const title = useNoticeStore((state) => state.title)
  const updateTime = useNoticeStore((state) => state.updateTime)
  const modalTitle = [title || '公告', updateTime].filter(Boolean).join(' - ')

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={setModalOpen} variant="opaque">
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="sm:max-w-[720px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{modalTitle}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="space-y-4">
              {banner ? (
                <img
                  src={banner}
                  alt={title || '公告'}
                  className="max-h-72 w-full rounded-lg object-cover"
                  draggable={false}
                />
              ) : null}
              <div className="skill-markdown min-w-0 overflow-x-auto bg-transparent p-0 text-sm leading-6 text-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
                  {content}
                </ReactMarkdown>
              </div>
            </div>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

export default AppNoticeModal
