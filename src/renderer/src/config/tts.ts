import { type OpenAITTSPlayerConfig } from '@charivo/tts/openai'

export const OPENAI_TTS_MODELS = ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'] as const
export const OPENAI_TTS_VOICES = [
  'alloy',
  'echo',
  'fable',
  'marin',
  'onyx',
  'nova',
  'shimmer'
] as const
export const DEFAULT_OPENAI_TTS_MODEL: NonNullable<OpenAITTSPlayerConfig['defaultModel']> =
  'gpt-4o-mini-tts'
export const DEFAULT_OPENAI_TTS_VOICE: NonNullable<OpenAITTSPlayerConfig['defaultVoice']> = 'marin'

export const toModel = (
  model: string | undefined
): NonNullable<OpenAITTSPlayerConfig['defaultModel']> => {
  const normalized = model?.trim()
  return OPENAI_TTS_MODELS.find((candidate) => candidate === normalized) ?? DEFAULT_OPENAI_TTS_MODEL
}

export const toVoice = (
  voice: string | undefined
): NonNullable<OpenAITTSPlayerConfig['defaultVoice']> => {
  const normalized = voice?.trim()
  return OPENAI_TTS_VOICES.find((candidate) => candidate === normalized) ?? DEFAULT_OPENAI_TTS_VOICE
}
