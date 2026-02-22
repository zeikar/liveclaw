import { MarkdownContent } from './MarkdownContent'

type MessageBubbleProps = {
  content: string
  isUser: boolean
  isTyping?: boolean
  autoFade?: boolean
}

export function MessageBubble({
  content,
  isUser,
  isTyping = false,
  autoFade = false
}: MessageBubbleProps): React.JSX.Element {
  return (
    <div className={`flex w-full flex-col items-end gap-1 ${autoFade ? 'bubble-fade-out' : ''}`}>
      <div className="max-w-full">
        <div
          className={`rounded-tl-2xl rounded-tr-2xl rounded-bl-2xl rounded-br-none px-4 py-3 text-sm shadow-lg ${
            isTyping ? 'tracking-wide' : 'leading-relaxed'
          } ${
            isUser
              ? 'bg-blue-500 text-white'
              : 'border border-slate-300/20 bg-slate-800/90 text-slate-100'
          }`}
        >
          <MarkdownContent content={content} />
        </div>
      </div>
    </div>
  )
}
