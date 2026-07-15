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

charivo.attachLLM(llmManager)
charivo.setCharacter(APP_CHARACTER)

// Applies the TTS config that now arrives over the tts:getConfig IPC at runtime instead of being
// inlined into the bundle at build time. Synchronous on purpose: the settings gate guarantees no
// speech can be in flight when this runs, so it never has to stop the manager first.
export const applyTTSSettings = (config: TTSConfig): boolean => {
  charivo.detachTTS()

  const apiKey = config.openaiApiKey.trim()
  if (!apiKey) {
    console.info('[TTS] No OpenAI API key configured. TTS is disabled.')
    return false
  }

  const ttsPlayer = createOpenAITTSPlayer({
    apiKey,
    defaultModel: toModel(config.ttsModel),
    defaultVoice: toVoice(config.ttsVoice),
    // The Electron renderer is a browser context; the key stays local to this desktop app.
    dangerouslyAllowBrowser: true
  })
  charivo.attachTTS(createTTSManager(ttsPlayer))
  return true
}

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
