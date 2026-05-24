import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type SkillMarkdownViewerProps = {
  className?: string
  content: string
  empty?: string
}

function SkillMarkdownViewer({
  className = '',
  content,
  empty = '未读取到 SKILL.md 内容',
}: SkillMarkdownViewerProps) {
  return (
    <div className={['skill-markdown overflow-auto rounded-2xl bg-surface-secondary/50 p-4 text-sm leading-6 text-foreground', className].filter(Boolean).join(' ')}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {content || empty}
      </ReactMarkdown>
    </div>
  )
}

export default SkillMarkdownViewer
