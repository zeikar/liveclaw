import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./components/Live2DPanel', () => ({ Live2DPanel: (): null => null }))

// jsdom has no ResizeObserver; HistoryMessageColumns (rendered by MessageList) uses one to keep the
// chat scrolled to the bottom, so the message list needs this stub to mount at all. `new` requires a
// constructable function, not an arrow function.
vi.stubGlobal(
  'ResizeObserver',
  vi.fn().mockImplementation(function ResizeObserverStub() {
    return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }
  })
)

const sttState = vi.hoisted(() => ({
  isRecording: false,
  isStarting: false,
  isTranscribing: false,
  error: null as string | null,
  toggle: vi.fn()
}))

const charivoState = vi.hoisted(() => ({
  messages: [] as unknown[],
  isLoading: false,
  isBusy: false,
  error: null as string | null,
  sendMessage: vi.fn(),
  clearHistory: vi.fn(),
  clearLocalHistory: vi.fn()
}))

vi.mock('./hooks/useSTT', () => ({ useSTT: () => sttState }))
vi.mock('./hooks/useCharivo', () => ({ useCharivo: () => charivoState }))

const LOCAL_ORIGIN = 'http://127.0.0.1:18789'
const LOCAL_BASE = 'http://127.0.0.1:18789/v1'

const view = (overrides: Partial<SettingsView> = {}): SettingsView => ({
  openClawTokenSet: false,
  openaiApiKeySource: 'stored',
  openClawBaseURL: '',
  ttsModel: '',
  ttsVoice: '',
  openClawSource: 'openclaw-config',
  openClawNoAuth: false,
  openClawBaseURLResolved: LOCAL_BASE,
  openClawTokenOrigin: LOCAL_ORIGIN,
  openClawConfigPath: '/home/user/.openclaw/openclaw.json',
  openClawDetectedOrigin: LOCAL_ORIGIN,
  openClawDetectionError: null,
  chatCompletionsEnabled: true,
  ...overrides
})

const TTS: TTSConfig = { openaiApiKey: 'sk-test', ttsModel: 'tts-1', ttsVoice: 'nova' }

beforeEach(() => {
  window.api = {
    chat: vi.fn(),
    newConversation: vi.fn(),
    openExternal: vi.fn(),
    getSettings: vi.fn().mockResolvedValue(view()),
    saveSettings: vi.fn(),
    testConnection: vi.fn().mockResolvedValue({ ok: true, message: 'Connected to OpenClaw.' }),
    getTTSConfig: vi.fn().mockResolvedValue(TTS),
    bootstrapRealtimeSTT: vi.fn()
  }
  sttState.isRecording = false
  sttState.isStarting = false
  sttState.isTranscribing = false
  sttState.error = null
  charivoState.messages = []
  charivoState.isLoading = false
  charivoState.isBusy = false
  charivoState.error = null
})

afterEach(cleanup)

const renderApp = async (): Promise<void> => {
  render(<App />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy())
}

describe('App', () => {
  it('disables the Settings chip while STT is active and enables it otherwise', async () => {
    sttState.isRecording = true
    await renderApp()

    expect((screen.getByRole('button', { name: 'Settings' }) as HTMLButtonElement).disabled).toBe(
      true
    )

    cleanup()
    sttState.isRecording = false
    await renderApp()

    expect((screen.getByRole('button', { name: 'Settings' }) as HTMLButtonElement).disabled).toBe(
      false
    )
  })

  it('does not send on Enter while a recording is active, keeping the composer text', async () => {
    sttState.isRecording = true
    await renderApp()

    const input = screen.getByPlaceholderText(/Talk to/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hello there' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(input.value).toBe('hello there')
    expect(charivoState.sendMessage).not.toHaveBeenCalled()
  })

  it('shows both a chat error and an STT error without masking either', async () => {
    charivoState.error = 'Chat failed'
    sttState.error = 'Mic error'
    await renderApp()

    expect(screen.getByText(/Chat failed/)).toBeTruthy()
    expect(screen.getByText(/Mic error/)).toBeTruthy()
  })
})
