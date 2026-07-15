import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTTSSettings } from '../lib/charivo/session'
import { useSettings } from './useSettings'

vi.mock('../lib/charivo/session', () => ({ applyTTSSettings: vi.fn() }))

const LOCAL_ORIGIN = 'http://127.0.0.1:18789'
const LOCAL_BASE = 'http://127.0.0.1:18789/v1'

const view = (overrides: Partial<SettingsView> = {}): SettingsView => ({
  openClawTokenSet: false,
  openaiApiKeySource: 'none',
  openClawBaseURL: '',
  ttsModel: '',
  ttsVoice: '',
  openClawSource: 'openclaw-config',
  openClawBaseURLResolved: LOCAL_BASE,
  openClawTokenOrigin: LOCAL_ORIGIN,
  openClawConfigPath: '/home/user/.openclaw/openclaw.json',
  openClawDetectedOrigin: LOCAL_ORIGIN,
  openClawDetectionError: null,
  chatCompletionsEnabled: true,
  ...overrides
})

const TTS: TTSConfig = { openaiApiKey: 'sk-test', ttsModel: 'tts-1', ttsVoice: 'nova' }

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const getSettingsMock = vi.fn<Window['api']['getSettings']>()
const getTTSConfigMock = vi.fn<Window['api']['getTTSConfig']>()
const testConnectionMock = vi.fn<Window['api']['testConnection']>()
const applyTTSSettingsMock = vi.mocked(applyTTSSettings)

beforeEach(() => {
  window.api = {
    chat: vi.fn(),
    newConversation: vi.fn(),
    openExternal: vi.fn(),
    getSettings: getSettingsMock,
    saveSettings: vi.fn(),
    testConnection: testConnectionMock,
    getTTSConfig: getTTSConfigMock
  }
  getSettingsMock.mockReset()
  getTTSConfigMock.mockReset()
  testConnectionMock.mockReset()
  applyTTSSettingsMock.mockReset()
})

afterEach(cleanup)

describe('useSettings', () => {
  it('a detected token with a passing check does not need setup and applies the TTS config', async () => {
    getSettingsMock.mockResolvedValue(view())
    getTTSConfigMock.mockResolvedValue(TTS)
    testConnectionMock.mockResolvedValue({ ok: true, message: 'Connected to OpenClaw.' })

    const { result } = renderHook(() => useSettings())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.needsSetup).toBe(false)
    expect(applyTTSSettingsMock).toHaveBeenCalledWith(TTS)
  })

  it('a detected token with a failing check needs setup and exposes the reason', async () => {
    getSettingsMock.mockResolvedValue(view())
    getTTSConfigMock.mockResolvedValue(TTS)
    testConnectionMock.mockResolvedValue({ ok: false, message: 'HTTP 404' })

    const { result } = renderHook(() => useSettings())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.needsSetup).toBe(true)
    expect(result.current.connection?.message).toBe('HTTP 404')
  })

  it('an unconfigured source needs setup without calling testConnection', async () => {
    getSettingsMock.mockResolvedValue(view({ openClawSource: 'none' }))
    getTTSConfigMock.mockResolvedValue(TTS)

    const { result } = renderHook(() => useSettings())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.needsSetup).toBe(true)
    expect(testConnectionMock).not.toHaveBeenCalled()
  })

  it('a rejected getSettings surfaces the error and stops loading', async () => {
    getSettingsMock.mockRejectedValue(new Error('EACCES'))

    const { result } = renderHook(() => useSettings())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.loadError).toBe('EACCES')
  })

  it('a rejected getTTSConfig surfaces the error and stops loading', async () => {
    getSettingsMock.mockResolvedValue(view())
    getTTSConfigMock.mockRejectedValue(new Error('EIO'))

    const { result } = renderHook(() => useSettings())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.loadError).toBe('EIO')
  })

  it('reload after a failed load clears the error', async () => {
    getSettingsMock.mockRejectedValueOnce(new Error('EACCES')).mockResolvedValue(view())
    getTTSConfigMock.mockResolvedValue(TTS)
    testConnectionMock.mockResolvedValue({ ok: true, message: 'Connected to OpenClaw.' })

    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.loadError).toBe('EACCES'))

    await act(async () => {
      result.current.reload()
    })

    await waitFor(() => expect(result.current.loadError).toBeNull())
  })

  it('a slow first load resolving after a reload neither overwrites the view nor reapplies TTS', async () => {
    const slow = deferred<SettingsView>()
    const newView = view({ ttsModel: 'tts-1-hd' })
    getSettingsMock.mockReturnValueOnce(slow.promise).mockResolvedValue(newView)
    getTTSConfigMock.mockResolvedValue(TTS)
    testConnectionMock.mockResolvedValue({ ok: true, message: 'Connected to OpenClaw.' })

    const { result } = renderHook(() => useSettings())

    await act(async () => {
      result.current.reload()
    })
    await waitFor(() => expect(result.current.view).toBe(newView))
    expect(applyTTSSettingsMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      slow.resolve(view({ ttsModel: 'stale' }))
      await slow.promise
      await Promise.resolve()
    })

    expect(result.current.view).toBe(newView)
    expect(applyTTSSettingsMock).toHaveBeenCalledTimes(1)
  })

  it('a stale getTTSConfig resolving after a newer load has already applied its own is never applied', async () => {
    // getSettings is fast for both requests, so request #1 clears the *first* guard (right after
    // getSettings) well before request #2 starts. Only the guard immediately before
    // applyTTSSettings — the one guarding the getTTSConfig await — can still stop it.
    const slowTTS = deferred<TTSConfig>()
    const staleTTS: TTSConfig = { openaiApiKey: 'sk-stale', ttsModel: 'tts-1', ttsVoice: 'nova' }
    const freshTTS: TTSConfig = {
      openaiApiKey: 'sk-fresh',
      ttsModel: 'tts-1-hd',
      ttsVoice: 'alloy'
    }
    getSettingsMock.mockResolvedValue(view())
    getTTSConfigMock.mockReturnValueOnce(slowTTS.promise).mockResolvedValue(freshTTS)
    testConnectionMock.mockResolvedValue({ ok: true, message: 'Connected to OpenClaw.' })

    const { result } = renderHook(() => useSettings())

    // Let request #1 (the mount load) reach its getTTSConfig await and hang there.
    await waitFor(() => expect(getTTSConfigMock).toHaveBeenCalledTimes(1))

    await act(async () => {
      result.current.reload()
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(applyTTSSettingsMock).toHaveBeenCalledTimes(1)
    expect(applyTTSSettingsMock).toHaveBeenCalledWith(freshTTS)

    // Only now does request #1's getTTSConfig resolve, with a stale config.
    await act(async () => {
      slowTTS.resolve(staleTTS)
      await slowTTS.promise
      await Promise.resolve()
    })

    expect(applyTTSSettingsMock).toHaveBeenCalledTimes(1)
    expect(applyTTSSettingsMock).not.toHaveBeenCalledWith(staleTTS)
  })
})
