import { createCharivo, type Charivo, type LLMClient, type Message } from '@charivo/core'
import { createLLMManager } from '@charivo/llm'
import { createSTTManager } from '@charivo/stt'
import { createOpenAIRealtimeSTTTranscriber } from '@charivo/stt/openai-realtime'
import { createTTSManager } from '@charivo/tts'
import { createOpenAITTSPlayer } from '@charivo/tts/openai'
import { APP_CHARACTER } from '../../config/character'
import { toModel, toVoice } from '../../config/tts'

const llmClient: LLMClient = {
  call: (messages) => window.api.chat(messages)
}

const charivo = createCharivo({
  llm: createLLMManager(llmClient),
  character: APP_CHARACTER
})

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

// The OpenAI key itself never reaches the transcriber: the realtime session is minted by the main
// process via window.api.bootstrapRealtimeSTT, which holds the key. This check only gates on
// whether the main process has a key to mint with — same observable gating as before, just no key
// handoff. Synchronous on purpose, same reasoning as applyTTSSettings above — and, once the
// composer's recording UI lands (a later task), a settings save cannot occur mid-recording because
// the Settings chip is gated closed for the recording lifecycle.
export const applySTTSettings = (config: TTSConfig): boolean => {
  charivo.detachSTT()

  const apiKey = config.openaiApiKey.trim()
  if (!apiKey) {
    console.info('[STT] No OpenAI API key configured. STT is disabled.')
    return false
  }

  const sttTranscriber = createOpenAIRealtimeSTTTranscriber({
    bootstrap: (request) => window.api.bootstrapRealtimeSTT(request)
  })
  charivo.attachSTT(createSTTManager(sttTranscriber))
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
