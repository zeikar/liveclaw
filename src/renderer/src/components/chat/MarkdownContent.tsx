import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

type MarkdownContentProps = {
  content: string
}

const markdownComponents: Components = {
  a: ({ href, children, ...props }) => (
    <a
      {...props}
      href={href}
      rel="noopener noreferrer"
      target="_blank"
      onClick={(event) => {
        if (!href) return
        event.preventDefault()
        void window.api.openExternal(href)
      }}
    >
      {children}
    </a>
  )
}

export function MarkdownContent({ content }: MarkdownContentProps): React.JSX.Element {
  return (
    <div className="break-words [&_a]:underline [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-white/30 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-black/20 [&_code]:px-1 [&_code]:py-0.5 [&_h1]:my-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:my-2 [&_h2]:text-sm [&_h2]:font-semibold [&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-black/25 [&_pre]:p-2 [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-white/20 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-white/20 [&_th]:px-2 [&_th]:py-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
