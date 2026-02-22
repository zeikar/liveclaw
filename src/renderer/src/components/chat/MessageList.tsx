import type { Message } from '@charivo/core'
import type { RefObject } from 'react'
import { MessageBubble } from './MessageBubble'

type MessageListProps = {
  messages: Message[]
  characterName: string
  isLoading: boolean
  error: string | null
  messagesEndRef: RefObject<HTMLDivElement | null>
}

export function MessageList({
  messages,
  characterName,
  isLoading,
  error,
  messagesEndRef
}: MessageListProps): React.JSX.Element {
  return (
    <section className="pointer-events-none absolute inset-0 z-10 px-3 pb-28 pt-16 sm:px-4">
      <div className="pointer-events-auto flex h-full flex-col gap-3 overflow-y-auto pr-1">
        {messages.map((msg) => {
          const isUser = msg.type === 'user'
          return (
            <MessageBubble
              key={msg.id}
              roleLabel={isUser ? 'You' : characterName}
              content={msg.content}
              isUser={isUser}
            />
          )
        })}

        {isLoading && (
          <MessageBubble roleLabel={characterName} content="..." isUser={false} isTyping />
        )}

        {error && (
          <div className="mx-auto max-w-xl rounded-xl border border-red-300/40 bg-red-900/70 px-4 py-3 text-center text-sm text-red-100">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </section>
  )
}
