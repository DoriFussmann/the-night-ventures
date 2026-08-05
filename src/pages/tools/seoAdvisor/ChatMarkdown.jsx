import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

const markdownComponents = {
  table: ({ className, ...props }) => (
    <div className="my-3 max-w-full overflow-x-auto rounded-md border border-border">
      <table
        className={cn('w-full min-w-[420px] border-collapse text-left text-xs', className)}
        {...props}
      />
    </div>
  ),
  thead: ({ className, ...props }) => (
    <thead className={cn('bg-muted/60', className)} {...props} />
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        'whitespace-nowrap border-b border-border px-2.5 py-1.5 font-medium text-muted-foreground',
        className
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn(
        'max-w-[240px] truncate border-b border-border/70 px-2.5 py-1.5 align-top text-foreground/90',
        className
      )}
      {...props}
    />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn('text-primary underline-offset-2 hover:underline', className)}
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
}

export default function ChatMarkdown({ children, className }) {
  return (
    <div
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-ul:my-2 prose-li:my-0.5 prose-headings:mb-2 prose-headings:mt-3',
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {children || ''}
      </ReactMarkdown>
    </div>
  )
}
