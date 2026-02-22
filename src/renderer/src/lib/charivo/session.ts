import { Charivo, type LLMClient, type Message } from '@charivo/core'
import { createLLMManager } from '@charivo/llm-core'
import { createTTSManager } from '@charivo/tts-core'
import { createOpenAITTSPlayer, type OpenAITTSPlayerConfig } from '@charivo/tts-player-openai'
import { APP_CHARACTER } from '../../config/character'

const OPENAI_TTS_MODELS = ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'] as const
const OPENAI_TTS_VOICES = ['alloy', 'echo', 'fable', 'marin', 'onyx', 'nova', 'shimmer'] as const
const DEFAULT_OPENAI_TTS_MODEL: NonNullable<OpenAITTSPlayerConfig['defaultModel']> =
  'gpt-4o-mini-tts'
const DEFAULT_OPENAI_TTS_VOICE: NonNullable<OpenAITTSPlayerConfig['defaultVoice']> = 'marin'

const llmClient: LLMClient = {
  call: (messages) => window.api.chat(messages)
}

const charivo = new Charivo()
const llmManager = createLLMManager(llmClient)

const toModel = (model: string | undefined): NonNullable<OpenAITTSPlayerConfig['defaultModel']> => {
  const normalized = model?.trim()
  return OPENAI_TTS_MODELS.find((candidate) => candidate === normalized) ?? DEFAULT_OPENAI_TTS_MODEL
}

const toVoice = (voice: string | undefined): NonNullable<OpenAITTSPlayerConfig['defaultVoice']> => {
  const normalized = voice?.trim()
  return OPENAI_TTS_VOICES.find((candidate) => candidate === normalized) ?? DEFAULT_OPENAI_TTS_VOICE
}

const attachDirectOpenAITTS = (): void => {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY?.trim()
  if (!apiKey) {
    console.info('[TTS] VITE_OPENAI_API_KEY is not set. TTS is disabled.')
    return
  }

  const ttsPlayer = createOpenAITTSPlayer({
    apiKey,
    defaultModel: toModel(import.meta.env.VITE_OPENAI_TTS_MODEL),
    defaultVoice: toVoice(import.meta.env.VITE_OPENAI_TTS_VOICE)
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
