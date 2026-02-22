type MessageBubbleProps = {
  content: string
  isUser: boolean
  isTyping?: boolean
}

export function MessageBubble({
  content,
  isUser,
  isTyping = false
}: MessageBubbleProps): React.JSX.Element {
  return (
    <div className={`flex w-full flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
      <div>
        <p
          className={`max-w-[95%] rounded-tl-2xl rounded-tr-2xl rounded-bl-2xl rounded-br-none px-4 py-3 text-sm shadow-lg ${
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
