import type { Message } from '@charivo/core'
import type { RefObject } from 'react'
import { MessageBubble } from './MessageBubble'

type MessageListProps = {
  messages: Message[]
  isLoading: boolean
  error: string | null
  messagesEndRef: RefObject<HTMLDivElement | null>
}

export function MessageList({
  messages,
  isLoading,
  error,
  messagesEndRef
}: MessageListProps): React.JSX.Element {
  const characterMessages = messages.filter((msg) => msg.type !== 'user')
  const userMessages = messages.filter((msg) => msg.type === 'user')

  return (
    <section className="pointer-events-none absolute inset-0 z-10 px-3 pb-28 pt-16 sm:px-4">
      <div className="pointer-events-auto h-full overflow-y-auto pr-1">
        <div className="grid min-h-full grid-cols-2 items-start gap-x-4 py-1 sm:gap-x-8">
          <div className="flex min-h-full flex-col gap-3">
            {characterMessages.map((msg) => (
              <MessageBubble key={msg.id} content={msg.content} isUser={false} />
            ))}

            {isLoading && <MessageBubble content="..." isUser={false} isTyping />}
          </div>

          <div className="flex min-h-full flex-col gap-3">
            {userMessages.map((msg) => (
              <MessageBubble key={msg.id} content={msg.content} isUser />
            ))}
          </div>
        </div>

        {error && (
          <div className="mx-auto mt-3 max-w-xl rounded-xl border border-red-300/40 bg-red-900/70 px-4 py-3 text-center text-sm text-red-100">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </section>
  )
}
