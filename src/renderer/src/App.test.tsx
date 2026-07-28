import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

// Captures the callbacks App hands the hook, so a test can drive `stt:partial` the way the real
// hook would.
const sttOptions = vi.hoisted(() => ({
  onPartial: null as ((transcription: string) => void) | null
}))

vi.mock('./hooks/useSTT', () => ({
  useSTT: (options: { onPartial?: (transcription: string) => void } = {}) => {
    sttOptions.onPartial = options.onPartial ?? null
    return sttState
  }
}))
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
  // Call counts and resolved values leak between tests otherwise, which would make assertions like
  // "nothing was auto-sent" pass or fail on execution order rather than on behaviour.
  sttState.toggle.mockReset()
  sttState.toggle.mockResolvedValue(null)
  sttOptions.onPartial = null
  charivoState.messages = []
  charivoState.isLoading = false
  charivoState.isBusy = false
  charivoState.error = null
  charivoState.sendMessage.mockReset()
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

describe('App live transcript fill', () => {
  const inputEl = (): HTMLInputElement =>
    screen.getByPlaceholderText(/Talk to/i) as HTMLInputElement

  // The label flips between 'Start recording' and 'Stop recording'; only one mic button exists.
  // The mocked hook returns `sttState` by reference, so flipping a flag reaches App only on its
  // next render — the emitPartial / fireEvent.change after each one is what delivers it.
  const clickMic = async (): Promise<void> => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /recording/i }))
    })
  }

  const emitPartial = (transcription: string): void => {
    act(() => sttOptions.onPartial?.(transcription))
  }

  it('fills the composer with each cumulative snapshot, replacing the previous one', async () => {
    await renderApp()

    emitPartial('hello')
    expect(inputEl().value).toBe('hello')

    emitPartial('hello there')
    expect(inputEl().value).toBe('hello there')
    expect(charivoState.sendMessage).not.toHaveBeenCalled()
  })

  it('overwrites the last partial with the resolved final transcript', async () => {
    await renderApp()
    await clickMic()

    sttState.isRecording = true
    emitPartial('hello ther')

    sttState.toggle.mockResolvedValue('Hello there.')
    await clickMic()

    expect(inputEl().value).toBe('Hello there.')
    expect(charivoState.sendMessage).not.toHaveBeenCalled()
  })

  it('clears the stale partial when the final transcript comes back empty', async () => {
    await renderApp()
    await clickMic()

    sttState.isRecording = true
    emitPartial('half a wor')

    sttState.toggle.mockResolvedValue('')
    await clickMic()

    expect(inputEl().value).toBe('')
    expect(charivoState.sendMessage).not.toHaveBeenCalled()
  })

  it('leaves a typed message alone when an empty final arrives with no partials', async () => {
    await renderApp()
    await clickMic()

    sttState.isRecording = true
    fireEvent.change(inputEl(), { target: { value: 'typed but unsent' } })

    sttState.toggle.mockResolvedValue('')
    await clickMic()

    expect(inputEl().value).toBe('typed but unsent')
    expect(charivoState.sendMessage).not.toHaveBeenCalled()
  })

  it('keeps the last partial when the stop rejects and returns null', async () => {
    await renderApp()
    await clickMic()

    sttState.isRecording = true
    emitPartial('what I said')

    sttState.error = 'Transcription failed'
    sttState.toggle.mockResolvedValue(null)
    await clickMic()

    expect(inputEl().value).toBe('what I said')
    expect(charivoState.sendMessage).not.toHaveBeenCalled()
  })
})
