import type { Message } from '@charivo/core'
import { useMemo } from 'react'
import { HistoryMessageColumns } from './HistoryMessageColumns'

type MessageListProps = {
  messages: Message[]
  isLoading: boolean
  error: string | null
}

export function MessageList({ messages, isLoading, error }: MessageListProps): React.JSX.Element {
  const characterMessages = useMemo(
    () =>
      [...messages]
        .filter((msg) => msg.type !== 'user')
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    [messages]
  )
  const userMessages = useMemo(
    () =>
      [...messages]
        .filter((msg) => msg.type === 'user')
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    [messages]
  )

  return (
    <section className="pointer-events-none absolute inset-0 z-10 px-3 pb-28 pt-16 sm:px-4">
      <div className="pointer-events-auto h-full">
        <HistoryMessageColumns
          characterMessages={characterMessages}
          userMessages={userMessages}
          isLoading={isLoading}
        />
      </div>

      {error && (
        <div className="pointer-events-none mt-3">
          <div className="mx-auto max-w-xl rounded-xl border border-red-300/40 bg-red-900/70 px-4 py-3 text-center text-sm text-red-100">
            {error}
          </div>
        </div>
      )}
    </section>
  )
}
