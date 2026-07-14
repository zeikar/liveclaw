import { Charivo, type LLMClient, type Message } from '@charivo/core'
import { createLLMManager } from '@charivo/llm'
import { createTTSManager } from '@charivo/tts'
import { createOpenAITTSPlayer } from '@charivo/tts/openai'
import { APP_CHARACTER } from '../../config/character'
import { toModel, toVoice } from '../../config/tts'

const llmClient: LLMClient = {
  call: (messages) => window.api.chat(messages)
}

const charivo = new Charivo()
const llmManager = createLLMManager(llmClient)

const attachDirectOpenAITTS = (): void => {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY?.trim()
  if (!apiKey) {
    console.info('[TTS] VITE_OPENAI_API_KEY is not set. TTS is disabled.')
    return
  }

  const ttsPlayer = createOpenAITTSPlayer({
    apiKey,
    defaultModel: toModel(import.meta.env.VITE_OPENAI_TTS_MODEL),
    defaultVoice: toVoice(import.meta.env.VITE_OPENAI_TTS_VOICE),
    // The Electron renderer is a browser context; the key stays local to this desktop app.
    dangerouslyAllowBrowser: true
  })
  const ttsManager = createTTSManager(ttsPlayer)
  charivo.attachTTS(ttsManager)
}

charivo.attachLLM(llmManager)
attachDirectOpenAITTS()
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
