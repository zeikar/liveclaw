import type { Message } from '@charivo/core'
import { useLayoutEffect, useRef } from 'react'
import { MessageBubble } from './MessageBubble'

type HistoryMessageColumnsProps = {
  characterMessages: Message[]
  userMessages: Message[]
  isLoading?: boolean
}

function useChatScroll(messages: Message[], isLoading?: boolean) {
  const containerRef = useRef<HTMLDivElement>(null)
  const isInitialMount = useRef(true)
  const prevMsgCount = useRef(messages.length)
  const prevIsLoading = useRef(isLoading)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const listContainer = container.firstElementChild as HTMLElement
    if (!listContainer) return

    const updateLayout = () => {
      const lastChild = listContainer.lastElementChild as HTMLElement
      if (lastChild) {
        const newPadding = Math.max(0, container.clientHeight - lastChild.offsetHeight)
        listContainer.style.paddingBottom = `${newPadding}px`
      }
    }

    // 1. Synchronously update padding before paint
    updateLayout()

    // 2. Handle scroll
    const isNewMessage = messages.length !== prevMsgCount.current || isLoading !== prevIsLoading.current
    
    if (isInitialMount.current) {
      container.scrollTop = container.scrollHeight
      isInitialMount.current = false
    } else if (isNewMessage) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth'
      })
    }

    prevMsgCount.current = messages.length
    prevIsLoading.current = isLoading

    // 3. Observe resizes (window resize or text wrapping)
    const observer = new ResizeObserver(updateLayout)
    observer.observe(container)
    const lastChild = listContainer.lastElementChild as HTMLElement
    if (lastChild) {
      observer.observe(lastChild)
    }

    return () => observer.disconnect()
  }, [messages, isLoading])

  return containerRef
}

export function HistoryMessageColumns({
  characterMessages,
  userMessages,
  isLoading
}: HistoryMessageColumnsProps): React.JSX.Element {
  const charRef = useChatScroll(characterMessages, isLoading)
  const userRef = useChatScroll(userMessages)

  return (
    <div className="flex h-full items-start gap-x-3 py-1 sm:gap-x-6 lg:gap-x-10">
      <div
        className="h-full min-w-0 flex-1 overflow-y-auto pr-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        ref={charRef}
      >
        <div className="flex min-h-full flex-col gap-3">
          {characterMessages.map((msg) => (
            <MessageBubble key={msg.id} content={msg.content} isUser={false} />
          ))}
          {isLoading && <MessageBubble content="..." isUser={false} isTyping />}
        </div>
      </div>

      <div className="w-10 shrink-0 sm:w-24 lg:w-36" aria-hidden="true" />

      <div className="h-full min-w-0 flex-1 overflow-y-auto pl-1" ref={userRef}>
        <div className="flex min-h-full flex-col gap-3">
          {userMessages.map((msg) => (
            <MessageBubble key={msg.id} content={msg.content} isUser />
          ))}
        </div>
      </div>
    </div>
  )
}
