/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENAI_API_KEY?: string
  readonly VITE_OPENAI_TTS_MODEL?: 'tts-1' | 'tts-1-hd' | 'gpt-4o-mini-tts'
  readonly VITE_OPENAI_TTS_VOICE?:
    | 'alloy'
    | 'echo'
    | 'fable'
    | 'marin'
    | 'onyx'
    | 'nova'
    | 'shimmer'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
