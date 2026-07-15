// Ambient (import-free) global types shared by main, preload, and renderer. Because this file has no
// top-level import/export it is a global script, so the renderer never has to import a runtime module
// from the main/preload side just to name these shapes.

// Decision 5: every settings update is a discriminated union, so no field ever means two things.

type OpenClawInput =
  | { mode: 'auto' }
  | {
      mode: 'manual'
      baseURL: string
      token: { action: 'keep' } | { action: 'set'; value: string }
    }

type OpenAIKeyInput = { action: 'keep' } | { action: 'clear' } | { action: 'set'; value: string }

type SettingsInput = {
  openClaw: OpenClawInput
  openaiApiKey: OpenAIKeyInput
  ttsModel: string
  ttsVoice: string
}

// The optional OpenClaw override persisted in config.json. Invariant: a non-empty `token` always
// carries the `baseURL` it was configured for; a `baseURL` with an empty `token` is legal.
type StoredOpenClaw = { token: string; baseURL: string } | null

// The on-disk shape of config.json. All fields are strings; '' means "not set".
type StoredSettings = {
  openClawToken: string
  openClawBaseURL: string
  openaiApiKey: string
  ttsModel: string
  ttsVoice: string
}

// What the renderer receives — never a secret. Decision 6: the key is represented only by a source
// enum, there is deliberately no `openaiApiKeySet`.
type SettingsView = {
  openClawTokenSet: boolean
  openaiApiKeySource: 'stored' | 'env' | 'none'
  openClawBaseURL: string
  ttsModel: string
  ttsVoice: string
  openClawSource: 'manual' | 'openclaw-config' | 'env' | 'none'
  // True when the effective OpenClaw gateway is a detected no-auth gateway (no token needed at all).
  openClawNoAuth: boolean
  openClawBaseURLResolved: string
  openClawTokenOrigin: string | null
  openClawConfigPath: string
  openClawDetectedOrigin: string | null
  openClawDetectionError: string | null
  // Decision 10: null means the detected config does not describe the effective gateway.
  chatCompletionsEnabled: boolean | null
}

// The only channel that hands the OpenAI key to the renderer, where Web Audio TTS runs.
type TTSConfig = {
  openaiApiKey: string
  ttsModel: string
  ttsVoice: string
}

type SettingsSaveResult = {
  view: SettingsView
  openClawChanged: boolean
}

type SettingsTestResult = {
  ok: boolean
  message: string
}
