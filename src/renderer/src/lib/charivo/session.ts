import { Charivo, type LLMClient, type Message } from '@charivo/core'
import { createLLMManager } from '@charivo/llm-core'
import { APP_CHARACTER } from '../../config/character'

const llmClient: LLMClient = {
  call: (messages) => window.api.chat(messages)
}

const charivo = new Charivo()
const llmManager = createLLMManager(llmClient)

charivo.attachLLM(llmManager)
charivo.setCharacter(APP_CHARACTER)

type MessageListener = (messages: Message[]) => void

let messageHistory: Message[] = []
const messageListeners = new Set<MessageListener>()

const notifyMessageListeners = (): void => {
  const snapshot = [...messageHistory]
  messageListeners.forEach((listener) => listener(snapshot))
}

const appendMessage = (message: Message): void => {
  messageHistory = [...messageHistory, message]
  notifyMessageListeners()
}

charivo.on('message:sent', ({ message }) => {
  appendMessage(message)
})

charivo.on('message:received', ({ message }) => {
  appendMessage(message)
})

export const getCharivoInstance = (): Charivo => charivo

export const getMessagesSnapshot = (): Message[] => [...messageHistory]

export const subscribeMessages = (listener: MessageListener): (() => void) => {
  messageListeners.add(listener)
  listener(getMessagesSnapshot())

  return () => {
    messageListeners.delete(listener)
  }
}

export const resetMessages = (): void => {
  messageHistory = []
  notifyMessageListeners()
}
