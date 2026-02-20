import { useCallback, useEffect, useRef, useState } from 'react'
import { Charivo, LLMClient, Message } from '@charivo/core'
import { createLLMManager } from '@charivo/llm-core'

// Delegate LLM calls to the main process via IPC to avoid CORS restrictions
const llmClient: LLMClient = {
  call: (messages) => window.api.chat(messages)
}

const charivo = new Charivo()
const llmManager = createLLMManager(llmClient)
charivo.attachLLM(llmManager)
charivo.setCharacter({
  id: 'assistant',
  name: 'Assistant',
  personality: 'You are a helpful and friendly desktop AI assistant.'
})

export function useCharivo() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    charivo.on('message:sent', ({ message }) => {
      setMessages((prev) => [...prev, message])
    })

    charivo.on('message:received', ({ message }) => {
      setMessages((prev) => [...prev, message])
    })
  }, [])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return
    setError(null)
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
        setError('Cannot connect to OpenClaw. Make sure OpenClaw is running. (http://127.0.0.1:18789)')
      } else if (message.includes('401') || message.includes('Unauthorized')) {
        setError(`Authentication error: check your API token. (${message})`)
      } else if (message.includes('429') || message.includes('rate limit')) {
        setError(`Too many requests. Please try again later. (${message})`)
      } else {
        setError(`Error: ${message}`)
      }
    } finally {
      setIsLoading(false)
    }
  }, [isLoading])

  const clearHistory = useCallback(() => {
    charivo.clearHistory()
    setMessages([])
    setError(null)
  }, [])

  return { messages, isLoading, error, sendMessage, clearHistory }
}
