type MessageBubbleProps = {
  roleLabel: string
  content: string
  isUser: boolean
  isTyping?: boolean
}

export function MessageBubble({
  roleLabel,
  content,
  isUser,
  isTyping = false
}: MessageBubbleProps): React.JSX.Element {
  return (
    <div
      className={`flex max-w-2xl flex-col gap-1 ${
        isUser ? 'ml-auto items-end' : 'mr-auto ml-4 items-start sm:ml-6'
      }`}
    >
      <span className="px-1 text-xs font-semibold text-slate-300">{roleLabel}</span>

      <div>
        <p
          className={`rounded-tl-2xl rounded-tr-2xl rounded-bl-2xl rounded-br-none px-4 py-3 text-sm shadow-lg ${
            isTyping ? 'tracking-wide' : 'leading-relaxed'
          } ${
            isUser
              ? 'bg-blue-500 text-white'
              : 'border border-slate-300/20 bg-slate-800/90 text-slate-100'
          }`}
        >
          {content}
        </p>
      </div>
    </div>
  )
}
