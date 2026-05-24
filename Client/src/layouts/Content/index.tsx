import type { PropsWithChildren } from 'react'
import ContentHeader from '@/components/Content/Header'

interface ContentLayoutProps extends PropsWithChildren {
  title?: string
  description?: string
}

function ContentLayout({ children }: ContentLayoutProps) {
  return (
    <main className="min-h-screen px-6 py-8 text-foreground lg:px-10">
      <div className="max-w-7xl mx-auto flex flex-col gap-6">
        <ContentHeader />

        <section>{children}</section>
      </div>
    </main>
  )
}

export default ContentLayout
