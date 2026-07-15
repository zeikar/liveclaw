import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsForm } from './SettingsForm'

const CONFIG_PATH = '/home/user/.openclaw/openclaw.json'
const LOCAL_ORIGIN = 'http://127.0.0.1:18789'
const LOCAL_BASE = 'http://127.0.0.1:18789/v1'

const baseView = (overrides: Partial<SettingsView> = {}): SettingsView => ({
  openClawTokenSet: false,
  openaiApiKeySource: 'none',
  openClawBaseURL: '',
  ttsModel: '',
  ttsVoice: '',
  openClawSource: 'openclaw-config',
  openClawNoAuth: false,
  openClawBaseURLResolved: LOCAL_BASE,
  openClawTokenOrigin: LOCAL_ORIGIN,
  openClawConfigPath: CONFIG_PATH,
  openClawDetectedOrigin: LOCAL_ORIGIN,
  openClawDetectionError: null,
  chatCompletionsEnabled: true,
  ...overrides
})

const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const saveSettingsMock = vi.fn<Window['api']['saveSettings']>()
const testConnectionMock = vi.fn<Window['api']['testConnection']>()

beforeEach(() => {
  window.api = {
    chat: vi.fn(),
    newConversation: vi.fn(),
    openExternal: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: saveSettingsMock,
    testConnection: testConnectionMock,
    getTTSConfig: vi.fn()
  }
  saveSettingsMock.mockReset()
  testConnectionMock.mockReset()
})

afterEach(cleanup)

describe('SettingsForm', () => {
  it('openclaw-config source with no override hides manual inputs, shows config path, and Save sends auto mode', async () => {
    const view = baseView()
    saveSettingsMock.mockResolvedValue({ view, openClawChanged: false })
    const onSaved = vi.fn()
    render(<SettingsForm view={view} connection={null} submitLabel="Save" onSaved={onSaved} />)

    expect(screen.queryByLabelText('OpenClaw token')).toBeNull()
    expect(screen.queryByLabelText('OpenClaw base URL')).toBeNull()
    expect(screen.getByText(`Using the token from ${CONFIG_PATH}`)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledTimes(1))
    expect(saveSettingsMock.mock.calls[0][0].openClaw).toEqual({ mode: 'auto' })
  })

  it('a no-auth gateway shows no-token wording instead of "Using the token from"', () => {
    const view = baseView({ openClawNoAuth: true })
    render(<SettingsForm view={view} connection={null} submitLabel="Save" onSaved={vi.fn()} />)

    expect(screen.getByText(`Using the no-auth gateway from ${CONFIG_PATH}`)).toBeTruthy()
    expect(screen.queryByText(`Using the token from ${CONFIG_PATH}`)).toBeNull()
  })

  it('openclaw-config source with a stored tokenless base URL starts manual mode on and Save keeps the override', async () => {
    const view = baseView({ openClawBaseURL: LOCAL_BASE })
    saveSettingsMock.mockResolvedValue({ view, openClawChanged: false })
    const onSaved = vi.fn()
    render(<SettingsForm view={view} connection={null} submitLabel="Save" onSaved={onSaved} />)

    const baseURLInput = screen.getByLabelText('OpenClaw base URL') as HTMLInputElement
    expect(baseURLInput.value).toBe(LOCAL_BASE)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledTimes(1))
    expect(saveSettingsMock.mock.calls[0][0].openClaw).toEqual({
      mode: 'manual',
      baseURL: LOCAL_BASE,
      token: { action: 'keep' }
    })
  })

  it('turning manual mode off on a view with a set token sends auto and leaves Save enabled', async () => {
    const view = baseView({ openClawTokenSet: true, openClawBaseURL: LOCAL_BASE })
    saveSettingsMock.mockResolvedValue({ view, openClawChanged: true })
    const onSaved = vi.fn()
    render(<SettingsForm view={view} connection={null} submitLabel="Save" onSaved={onSaved} />)

    const toggle = screen.getByLabelText(
      'Enter an OpenClaw token or gateway URL manually'
    ) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)
    expect(toggle.checked).toBe(false)

    const saveButton = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(false)

    fireEvent.click(saveButton)

    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledTimes(1))
    expect(saveSettingsMock.mock.calls[0][0].openClaw).toEqual({ mode: 'auto' })
  })

  it('an empty token field on a matching origin keeps the stored token', async () => {
    const view = baseView({ openClawTokenSet: true, openClawBaseURL: LOCAL_BASE })
    saveSettingsMock.mockResolvedValue({ view, openClawChanged: false })
    const onSaved = vi.fn()
    render(<SettingsForm view={view} connection={null} submitLabel="Save" onSaved={onSaved} />)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledTimes(1))
    expect(saveSettingsMock.mock.calls[0][0].openClaw).toEqual({
      mode: 'manual',
      baseURL: LOCAL_BASE,
      token: { action: 'keep' }
    })
  })

  it('typing a token sends it as a fresh token', async () => {
    const view = baseView({ openClawTokenSet: true, openClawBaseURL: LOCAL_BASE })
    saveSettingsMock.mockResolvedValue({ view, openClawChanged: true })
    const onSaved = vi.fn()
    render(<SettingsForm view={view} connection={null} submitLabel="Save" onSaved={onSaved} />)

    fireEvent.change(screen.getByLabelText('OpenClaw token'), { target: { value: 'new-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledTimes(1))
    expect(saveSettingsMock.mock.calls[0][0].openClaw).toEqual({
      mode: 'manual',
      baseURL: LOCAL_BASE,
      token: { action: 'set', value: 'new-token' }
    })
  })

  it('a manual base URL on a foreign origin disables Save and Test until a token is typed', () => {
    const view = baseView({ openClawTokenSet: true, openClawBaseURL: LOCAL_BASE })
    render(<SettingsForm view={view} connection={null} submitLabel="Save" onSaved={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('OpenClaw base URL'), {
      target: { value: 'https://foreign.example/v1' }
    })

    const saveButton = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    const testButton = screen.getByRole('button', { name: 'Test connection' }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(true)
    expect(testButton.disabled).toBe(true)
    expect(screen.getByText(/not the gateway detected/i)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('OpenClaw token'), {
      target: { value: 'foreign-token' }
    })

    expect(saveButton.disabled).toBe(false)
    expect(testButton.disabled).toBe(false)
  })

  it('openClawSource none forces manual inputs on and disables Save while the token is empty', () => {
    const view = baseView({
      openClawSource: 'none',
      openClawTokenSet: false,
      openClawBaseURL: '',
      openClawTokenOrigin: null,
      openClawDetectedOrigin: null,
      openClawDetectionError: 'No OpenClaw config found.'
    })
    render(<SettingsForm view={view} connection={null} submitLabel="Save" onSaved={vi.fn()} />)

    expect(screen.getByLabelText('OpenClaw token')).toBeTruthy()
    expect(screen.getByLabelText('OpenClaw base URL')).toBeTruthy()
    expect(screen.queryByLabelText('Enter an OpenClaw token or gateway URL manually')).toBeNull()

    const saveButton = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(true)
  })

  it('Remove key clears the stored OpenAI key, an untouched field keeps it, and the button is disabled for an env key', async () => {
    const storedView = baseView({ openaiApiKeySource: 'stored' })
    saveSettingsMock.mockResolvedValue({ view: storedView, openClawChanged: false })
    const onSaved = vi.fn()

    render(
      <SettingsForm view={storedView} connection={null} submitLabel="Save" onSaved={onSaved} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove key' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledTimes(1))
    expect(saveSettingsMock.mock.calls[0][0].openaiApiKey).toEqual({ action: 'clear' })
    cleanup()

    render(
      <SettingsForm view={storedView} connection={null} submitLabel="Save" onSaved={onSaved} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledTimes(2))
    expect(saveSettingsMock.mock.calls[1][0].openaiApiKey).toEqual({ action: 'keep' })
    cleanup()

    const envView = baseView({ openaiApiKeySource: 'env' })
    render(<SettingsForm view={envView} connection={null} submitLabel="Save" onSaved={onSaved} />)
    const removeButton = screen.getByRole('button', { name: 'Remove key' }) as HTMLButtonElement
    expect(removeButton.disabled).toBe(true)
  })

  it('a disabled chat-completions endpoint with a failed connection shows the fix', () => {
    const view = baseView({ chatCompletionsEnabled: false })
    const connection: SettingsTestResult = { ok: false, message: 'HTTP 404' }
    render(
      <SettingsForm view={view} connection={connection} submitLabel="Save" onSaved={vi.fn()} />
    )

    expect(
      screen.getByText(/openclaw config set gateway\.http\.endpoints\.chatCompletions/)
    ).toBeTruthy()
  })

  it('a successful connection result hides the chat-completions fix', () => {
    const view = baseView({ chatCompletionsEnabled: false })
    const connection: SettingsTestResult = { ok: true, message: 'Connected to OpenClaw.' }
    render(
      <SettingsForm view={view} connection={connection} submitLabel="Save" onSaved={vi.fn()} />
    )

    expect(
      screen.queryByText(/openclaw config set gateway\.http\.endpoints\.chatCompletions/)
    ).toBeNull()
  })

  it('the OpenClaw token and base-URL inputs are disabled while a connection test is pending', async () => {
    const view = baseView({ openClawTokenSet: true, openClawBaseURL: LOCAL_BASE })
    const { promise, resolve } = deferred<SettingsTestResult>()
    testConnectionMock.mockReturnValue(promise)
    render(<SettingsForm view={view} connection={null} submitLabel="Save" onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    const tokenInput = screen.getByLabelText('OpenClaw token') as HTMLInputElement
    const baseURLInput = screen.getByLabelText('OpenClaw base URL') as HTMLInputElement
    expect(tokenInput.disabled).toBe(true)
    expect(baseURLInput.disabled).toBe(true)

    resolve({ ok: true, message: 'Connected to OpenClaw.' })
    await waitFor(() => expect(tokenInput.disabled).toBe(false))
    expect(baseURLInput.disabled).toBe(false)
  })

  it('Save and Cancel are disabled while a save is pending and onSavingChange reports it', async () => {
    const view = baseView({ openClawTokenSet: true, openClawBaseURL: LOCAL_BASE })
    const { promise, resolve } = deferred<SettingsSaveResult>()
    saveSettingsMock.mockReturnValue(promise)
    const onSavingChange = vi.fn()
    render(
      <SettingsForm
        view={view}
        connection={null}
        submitLabel="Save"
        onSaved={vi.fn()}
        onCancel={vi.fn()}
        onSavingChange={onSavingChange}
      />
    )

    const saveButton = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    const cancelButton = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement

    fireEvent.click(saveButton)

    expect(saveButton.disabled).toBe(true)
    expect(cancelButton.disabled).toBe(true)
    expect(onSavingChange).toHaveBeenNthCalledWith(1, true)

    resolve({ view, openClawChanged: false })
    await waitFor(() => expect(onSavingChange).toHaveBeenNthCalledWith(2, false))
  })

  it('renders a successful test connection result', async () => {
    const view = baseView({ openClawTokenSet: true, openClawBaseURL: LOCAL_BASE })
    testConnectionMock.mockResolvedValue({ ok: true, message: 'Connected to OpenClaw.' })
    render(<SettingsForm view={view} connection={null} submitLabel="Save" onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText(/Connected/)).toBeTruthy()
  })

  it('renders a failed test connection result', async () => {
    const view = baseView({ openClawTokenSet: true, openClawBaseURL: LOCAL_BASE })
    testConnectionMock.mockResolvedValue({
      ok: false,
      message: 'OpenClaw rejected the token (HTTP 401); check the token.'
    })
    render(<SettingsForm view={view} connection={null} submitLabel="Save" onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText(/rejected the token/)).toBeTruthy()
  })

  it('editing the token clears a showing test result', async () => {
    const view = baseView({ openClawTokenSet: true, openClawBaseURL: LOCAL_BASE })
    testConnectionMock.mockResolvedValue({ ok: true, message: 'Connected to OpenClaw.' })
    render(<SettingsForm view={view} connection={null} submitLabel="Save" onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    await screen.findByText(/Connected/)

    fireEvent.change(screen.getByLabelText('OpenClaw token'), { target: { value: 'edited' } })

    expect(screen.queryByText(/Connected/)).toBeNull()
  })

  it('editing the base URL clears a showing test result', async () => {
    const view = baseView({ openClawTokenSet: true, openClawBaseURL: LOCAL_BASE })
    testConnectionMock.mockResolvedValue({ ok: true, message: 'Connected to OpenClaw.' })
    render(<SettingsForm view={view} connection={null} submitLabel="Save" onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    await screen.findByText(/Connected/)

    fireEvent.change(screen.getByLabelText('OpenClaw base URL'), {
      target: { value: 'http://127.0.0.1:19999/v1' }
    })

    expect(screen.queryByText(/Connected/)).toBeNull()
  })

  it('renders the seeded connection prop on mount without it being cleared by mounting', () => {
    const view = baseView({ openClawTokenSet: true, openClawBaseURL: LOCAL_BASE })
    const connection: SettingsTestResult = {
      ok: false,
      message: 'OpenClaw rejected the token (HTTP 401); check the token.'
    }
    render(
      <SettingsForm view={view} connection={connection} submitLabel="Save" onSaved={vi.fn()} />
    )

    expect(screen.getByText(/rejected the token/)).toBeTruthy()
  })
})
