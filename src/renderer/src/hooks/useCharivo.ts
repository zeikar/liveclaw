import { useCallback, useEffect, useState } from 'react'
import type { Message } from '@charivo/core'
import {
  getCharivoInstance,
  getMessagesSnapshot,
  resetMessages,
  subscribeMessages
} from '../lib/charivo/session'

type UseCharivoResult = {
  messages: Message[]
  isLoading: boolean
  isBusy: boolean
  error: string | null
  sendMessage: (text: string) => Promise<void>
  clearHistory: () => void
}

export function useCharivo(): UseCharivoResult {
  const [messages, setMessages] = useState<Message[]>(() => getMessagesSnapshot())
  const [isLoading, setIsLoading] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const charivo = getCharivoInstance()

  useEffect(
    () =>
      subscribeMessages((nextMessages) => {
        setMessages(nextMessages)

        const lastMessage = nextMessages[nextMessages.length - 1]
        if (lastMessage?.type === 'character') {
          // Hide typing indicator as soon as text response is ready, even if TTS is still playing.
          setIsLoading(false)
        }
      }),
    []
  )

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isBusy) return
      setError(null)
      setIsBusy(true)
      setIsLoading(true)
      try {
        await charivo.userSay(text)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (
          message.includes('fetch') ||
          message.includes('ECONNREFUSED') ||
          message.includes('Failed to fetch') ||
          message.includes('NetworkError') ||
          message.includes('Connection error')
        ) {
          setError(
            'Cannot connect to OpenClaw. Make sure OpenClaw is running. (http://127.0.0.1:18789)'
          )
        } else if (message.includes('401') || message.includes('Unauthorized')) {
          setError(`Authentication error: check your API token. (${message})`)
        } else if (message.includes('429') || message.includes('rate limit')) {
          setError(`Too many requests. Please try again later. (${message})`)
        } else {
          setError(`Error: ${message}`)
        }
      } finally {
        setIsBusy(false)
        setIsLoading(false)
      }
    },
    [charivo, isBusy]
  )

  const clearHistory = useCallback(() => {
    charivo.clearHistory()
    resetMessages()
    setError(null)
  }, [charivo])

  return { messages, isLoading, isBusy, error, sendMessage, clearHistory }
}
