import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ userData: '', isPackaged: false }))
vi.mock('electron', () => ({
  app: {
    getPath: () => h.userData,
    get isPackaged() {
      return h.isPackaged
    }
  }
}))

import {
  getEffectiveOpenClaw,
  getSettingsView,
  getTTSConfig,
  saveSettings,
  testOpenClawConnection
} from './settings'

let detectionDir: string
let fetchMock: ReturnType<typeof vi.fn>

const ENV_VARS = [
  'OPENCLAW_TOKEN',
  'OPENCLAW_BASE_URL',
  'OPENAI_API_KEY',
  'VITE_OPENAI_API_KEY',
  'OPENAI_TTS_MODEL',
  'VITE_OPENAI_TTS_MODEL',
  'OPENAI_TTS_VOICE',
  'VITE_OPENAI_TTS_VOICE'
]

beforeEach(() => {
  h.userData = mkdtempSync(join(tmpdir(), 'liveclaw-settings-'))
  h.isPackaged = false
  detectionDir = mkdtempSync(join(tmpdir(), 'liveclaw-openclaw-'))
  // Neutralise every relevant env var so the developer's real OpenClaw/.env install cannot change
  // results, then point detection at a nonexistent path (no detectable config by default).
  for (const name of ENV_VARS) vi.stubEnv(name, '')
  vi.stubEnv('OPENCLAW_CONFIG_PATH', join(detectionDir, 'nonexistent.json'))
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  rmSync(h.userData, { recursive: true, force: true })
  rmSync(detectionDir, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const writeConfig = (contents: string): void =>
  writeFileSync(join(h.userData, 'config.json'), contents)

const storeConfig = (stored: Partial<StoredSettings>): void => writeConfig(JSON.stringify(stored))

const readConfig = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(h.userData, 'config.json'), 'utf-8'))

const useDetection = (config: object): void => {
  const path = join(detectionDir, 'openclaw.json')
  writeFileSync(path, JSON.stringify(config))
  vi.stubEnv('OPENCLAW_CONFIG_PATH', path)
}

const detectedToken = (token: string, extra: object = {}): object => ({
  gateway: { port: 18789, auth: { token }, ...extra }
})

const input = (over: Partial<SettingsInput> & { openClaw: OpenClawInput }): SettingsInput => ({
  openaiApiKey: { action: 'keep' },
  ttsModel: '',
  ttsVoice: '',
  ...over
})

const LOCAL_BASE = 'http://127.0.0.1:18789/v1'

describe('the prospective-resolution blocker', () => {
  it('lets a manual save with a fresh token establish a brand-new origin', () => {
    // Nothing stored, detection is local-only (no token) — the newly submitted token must be
    // allowed to authorize itself even though the stored file did not yet contain it.
    const result = saveSettings(
      input({
        openClaw: {
          mode: 'manual',
          baseURL: 'https://new.example/v1',
          token: { action: 'set', value: 'brand-new' }
        }
      })
    )

    expect(result.view.openClawSource).toBe('manual')
    expect(result.openClawChanged).toBe(true)
    expect(readConfig().openClawToken).toBe('brand-new')
    expect(readConfig().openClawBaseURL).toBe('https://new.example/v1')
  })
})

describe('the clear-to-unconfigured blocker', () => {
  it('lets mode:auto empty a stored pair and land on openClawSource none', () => {
    storeConfig({ openClawToken: 'stored-tok', openClawBaseURL: LOCAL_BASE })

    const result = saveSettings(input({ openClaw: { mode: 'auto' } }))

    expect(result.view.openClawSource).toBe('none')
    expect(result.openClawChanged).toBe(true)
    expect(readConfig().openClawToken).toBe('')
    expect(readConfig().openClawBaseURL).toBe('')
  })
})

describe('the origin rule for implicit tokens', () => {
  it('refuses a detected token for a foreign origin without calling fetch', async () => {
    useDetection(detectedToken('detected-tok'))

    const result = await testOpenClawConnection({ token: '', baseURL: 'https://evil.example/v1' })

    expect(result).toEqual({ ok: false, message: 'Enter the OpenClaw token for this gateway.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses an env token for a foreign origin without calling fetch', async () => {
    vi.stubEnv('OPENCLAW_TOKEN', 'env-tok')

    const result = await testOpenClawConnection({ token: '', baseURL: 'https://evil.example/v1' })

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Enter the OpenClaw token for this gateway.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('drops a stored token when a manual keep targets a different origin, then refuses', () => {
    storeConfig({ openClawToken: 'tok-A', openClawBaseURL: LOCAL_BASE })

    expect(() =>
      saveSettings(
        input({
          openClaw: { mode: 'manual', baseURL: 'https://b.example/v1', token: { action: 'keep' } }
        })
      )
    ).toThrow('Enter the OpenClaw token for this gateway.')
  })

  it('replaces the origin with a fresh token on set, erasing the old token from the file', () => {
    storeConfig({ openClawToken: 'tok-A', openClawBaseURL: LOCAL_BASE })

    saveSettings(
      input({
        openClaw: {
          mode: 'manual',
          baseURL: 'https://b.example/v1',
          token: { action: 'set', value: 'tok-B' }
        }
      })
    )

    expect(readConfig().openClawToken).toBe('tok-B')
    expect(readConfig().openClawBaseURL).toBe('https://b.example/v1')
  })

  it('resolves getEffectiveOpenClaw to an empty token when no candidate origin matches', () => {
    // A token-less base-only override is legal; nothing else covers its origin.
    storeConfig({ openClawBaseURL: 'https://nowhere.example/v1' })

    expect(getEffectiveOpenClaw()).toEqual({ token: '', baseURL: 'https://nowhere.example/v1' })
  })

  it('uses an implicit token for its own origin when the tested token is blank', async () => {
    storeConfig({ openClawToken: 'tok-A', openClawBaseURL: LOCAL_BASE })
    fetchMock.mockResolvedValue({ ok: true, status: 200 })

    const result = await testOpenClawConnection({ token: '', baseURL: '' })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://127.0.0.1:18789/v1/models')
    expect(options.headers.Authorization).toBe('Bearer tok-A')
  })
})

describe('the OpenClaw state machine', () => {
  it('preserves the stored token on a manual keep for the same origin and updates the path', () => {
    storeConfig({ openClawToken: 'tok-A', openClawBaseURL: LOCAL_BASE })

    const result = saveSettings(
      input({
        openClaw: {
          mode: 'manual',
          baseURL: 'http://127.0.0.1:18789/v2',
          token: { action: 'keep' }
        }
      })
    )

    expect(result.view.openClawSource).toBe('manual')
    expect(readConfig().openClawToken).toBe('tok-A')
    expect(readConfig().openClawBaseURL).toBe('http://127.0.0.1:18789/v2')
  })

  it('stores a token-less override when a manual keep is covered by detection', () => {
    useDetection(detectedToken('detected-tok'))

    const result = saveSettings(
      input({
        openClaw: { mode: 'manual', baseURL: LOCAL_BASE, token: { action: 'keep' } }
      })
    )

    expect(result.view.openClawSource).toBe('openclaw-config')
    expect(result.view.openClawTokenSet).toBe(false)
    // The stored override still reports its base URL — the tokenless-override state Task 4 shows.
    expect(result.view.openClawBaseURL).toBe(LOCAL_BASE)
    expect(readConfig().openClawToken).toBe('')
    expect(readConfig().openClawBaseURL).toBe(LOCAL_BASE)
  })
})

describe('the OpenAI key state machine', () => {
  const keepOpenClaw: OpenClawInput = {
    mode: 'manual',
    baseURL: LOCAL_BASE,
    token: { action: 'keep' }
  }

  beforeEach(() => {
    storeConfig({ openClawToken: 'tok-A', openClawBaseURL: LOCAL_BASE, openaiApiKey: 'old-key' })
  })

  it('keeps the stored key and reports the stored source', () => {
    const result = saveSettings(input({ openClaw: keepOpenClaw, openaiApiKey: { action: 'keep' } }))

    expect(result.view.openaiApiKeySource).toBe('stored')
    expect(getTTSConfig().openaiApiKey).toBe('old-key')
  })

  it('clears the key, emptying getTTSConfig and reporting source none', () => {
    const result = saveSettings(
      input({ openClaw: keepOpenClaw, openaiApiKey: { action: 'clear' } })
    )

    expect(result.view.openaiApiKeySource).toBe('none')
    expect(getTTSConfig().openaiApiKey).toBe('')
  })

  it('replaces the key on set', () => {
    const result = saveSettings(
      input({ openClaw: keepOpenClaw, openaiApiKey: { action: 'set', value: 'new-key' } })
    )

    expect(result.view.openaiApiKeySource).toBe('stored')
    expect(getTTSConfig().openaiApiKey).toBe('new-key')
  })

  it('reports source env when only a dev env key exists', () => {
    writeConfig('{}')
    vi.stubEnv('OPENAI_API_KEY', 'env-key')

    expect(getSettingsView().openaiApiKeySource).toBe('env')
    expect(getTTSConfig().openaiApiKey).toBe('env-key')
  })
})

describe('invalid payloads', () => {
  const invalid: unknown[] = [
    null,
    [],
    'nope',
    { openClaw: { mode: 'nope' }, openaiApiKey: { action: 'keep' }, ttsModel: '', ttsVoice: '' },
    {
      openClaw: { mode: 'manual', baseURL: '', token: { action: 'keep' } },
      openaiApiKey: { action: 'keep' },
      ttsModel: '',
      ttsVoice: ''
    },
    {
      openClaw: { mode: 'manual', baseURL: LOCAL_BASE, token: { action: 'set', value: '' } },
      openaiApiKey: { action: 'keep' },
      ttsModel: '',
      ttsVoice: ''
    },
    {
      openClaw: { mode: 'auto' },
      openaiApiKey: { action: 'set', value: '' },
      ttsModel: '',
      ttsVoice: ''
    },
    {
      openClaw: { mode: 'auto' },
      openaiApiKey: { action: 'nope' },
      ttsModel: '',
      ttsVoice: ''
    },
    { openClaw: { mode: 'auto' }, openaiApiKey: { action: 'keep' }, ttsModel: 5, ttsVoice: '' }
  ]

  it.each(invalid.map((payload, i) => [i, payload] as const))(
    'rejects payload #%i with Invalid settings payload',
    (_i, payload) => {
      expect(() => saveSettings(payload)).toThrow('Invalid settings payload')
    }
  )
})

describe('precedence', () => {
  it('resolves to none when nothing is configured', () => {
    expect(getSettingsView().openClawSource).toBe('none')
    expect(getEffectiveOpenClaw().token).toBe('')
  })

  it('resolves to env when only an env token exists', () => {
    vi.stubEnv('OPENCLAW_TOKEN', 'env-tok')

    expect(getSettingsView().openClawSource).toBe('env')
    expect(getEffectiveOpenClaw().token).toBe('env-tok')
  })

  it('prefers detection over env at the same origin', () => {
    useDetection(detectedToken('detected-tok'))
    vi.stubEnv('OPENCLAW_TOKEN', 'env-tok')

    expect(getSettingsView().openClawSource).toBe('openclaw-config')
    expect(getEffectiveOpenClaw().token).toBe('detected-tok')
  })

  it('prefers a manual pair over detection', () => {
    storeConfig({ openClawToken: 'manual-tok', openClawBaseURL: LOCAL_BASE })
    useDetection(detectedToken('detected-tok'))

    expect(getSettingsView().openClawSource).toBe('manual')
    expect(getEffectiveOpenClaw().token).toBe('manual-tok')
  })

  it('never persists the detected token when saving in auto mode', () => {
    useDetection(detectedToken('detected-tok'))

    saveSettings(input({ openClaw: { mode: 'auto' } }))

    expect(readConfig().openClawToken).toBe('')
  })
})

describe('a packaged build never trusts dev env vars', () => {
  beforeEach(() => {
    h.isPackaged = true
  })

  it('ignores an OPENCLAW_TOKEN in the environment', () => {
    vi.stubEnv('OPENCLAW_TOKEN', 'env-tok')

    expect(getEffectiveOpenClaw()).toEqual({ token: '', baseURL: LOCAL_BASE })
    expect(getSettingsView().openClawSource).toBe('none')
  })

  it('ignores an OPENAI_API_KEY in the environment', () => {
    vi.stubEnv('OPENAI_API_KEY', 'env-key')

    expect(getSettingsView().openaiApiKeySource).toBe('none')
    expect(getTTSConfig().openaiApiKey).toBe('')
  })
})

describe('the settings view', () => {
  it('exposes no secrets and no openaiApiKeySet field', () => {
    storeConfig({
      openClawToken: 'secret-tok',
      openClawBaseURL: LOCAL_BASE,
      openaiApiKey: 'secret-key'
    })

    const view = getSettingsView()

    expect(Object.keys(view).sort()).toEqual(
      [
        'chatCompletionsEnabled',
        'openClawBaseURL',
        'openClawBaseURLResolved',
        'openClawConfigPath',
        'openClawDetectedOrigin',
        'openClawDetectionError',
        'openClawSource',
        'openClawTokenOrigin',
        'openaiApiKeySource',
        'openClawTokenSet',
        'ttsModel',
        'ttsVoice'
      ].sort()
    )
    expect(view).not.toHaveProperty('openaiApiKeySet')
    const serialized = JSON.stringify(view)
    expect(serialized).not.toContain('secret-tok')
    expect(serialized).not.toContain('secret-key')
  })

  it('reports chatCompletionsEnabled for a local effective gateway', () => {
    useDetection(
      detectedToken('detected-tok', {
        http: { endpoints: { chatCompletions: { enabled: true } } }
      })
    )

    expect(getSettingsView().chatCompletionsEnabled).toBe(true)
  })

  it('reports chatCompletionsEnabled as null for a different effective origin', () => {
    useDetection(
      detectedToken('detected-tok', {
        http: { endpoints: { chatCompletions: { enabled: true } } }
      })
    )
    storeConfig({ openClawToken: 'ov', openClawBaseURL: 'https://gw.example/v1' })

    expect(getSettingsView().chatCompletionsEnabled).toBeNull()
  })
})

describe('reading own config', () => {
  it('returns defaults when config.json is missing', () => {
    expect(() => getSettingsView()).not.toThrow()
    expect(getSettingsView().openClawSource).toBe('none')
  })

  it('propagates EISDIR when a directory sits at the config path', () => {
    mkdirSync(join(h.userData, 'config.json'))

    expect(() => getSettingsView()).toThrow()
  })

  it.each(['null', '[]', '{ not json'])('warns and uses defaults for root %s', (contents) => {
    writeConfig(contents)

    expect(() => getSettingsView()).not.toThrow()
    expect(getSettingsView().openClawSource).toBe('none')
  })

  it('drops both fields when a token has no base URL', () => {
    storeConfig({ openClawToken: 'orphan-tok' })

    const view = getSettingsView()

    expect(view.openClawTokenSet).toBe(false)
    expect(view.openClawBaseURL).toBe('')
  })

  it('clears an unparseable base URL with no token and still resolves normally', () => {
    storeConfig({ openClawBaseURL: 'not-a-url' })

    expect(() => getSettingsView()).not.toThrow()
    expect(getSettingsView().openClawBaseURL).toBe('')
    expect(getEffectiveOpenClaw().token).toBe('')
  })
})

describe('base URL validation', () => {
  it.each(['ftp://host/v1', 'file:///x', 'http://user:pass@host/v1'])('rejects %s', (baseURL) => {
    expect(() =>
      saveSettings(
        input({ openClaw: { mode: 'manual', baseURL, token: { action: 'set', value: 'x' } } })
      )
    ).toThrow('OpenClaw base URL must be an http(s) URL')
  })
})

describe('testOpenClawConnection', () => {
  it('reports success on an ok response', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 })

    const result = await testOpenClawConnection({ token: 'tok', baseURL: LOCAL_BASE })

    expect(result).toEqual({ ok: true, message: 'Connected to OpenClaw.' })
  })

  it('tells the user to check the token on 401', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 })

    const result = await testOpenClawConnection({ token: 'tok', baseURL: LOCAL_BASE })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('check the token')
  })

  it('surfaces the repair commands on 404', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 })

    const result = await testOpenClawConnection({ token: 'tok', baseURL: LOCAL_BASE })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('openclaw config set gateway.http.endpoints.chatCompletions')
    expect(result.message).toContain('openclaw gateway restart')
  })

  it('reports the raw HTTP status for other errors', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })

    const result = await testOpenClawConnection({ token: 'tok', baseURL: LOCAL_BASE })

    expect(result.message).toBe('HTTP 500')
  })

  it('returns a message instead of throwing on a bad base URL', async () => {
    const result = await testOpenClawConnection({ token: 'tok', baseURL: 'ftp://host/v1' })

    expect(result).toEqual({ ok: false, message: 'OpenClaw base URL must be an http(s) URL' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('save side effects', () => {
  it('reports openClawChanged false for a TTS-only save', () => {
    storeConfig({ openClawToken: 'tok-A', openClawBaseURL: LOCAL_BASE })

    const result = saveSettings(
      input({
        openClaw: { mode: 'manual', baseURL: LOCAL_BASE, token: { action: 'keep' } },
        ttsModel: 'tts-1'
      })
    )

    expect(result.openClawChanged).toBe(false)
    expect(readConfig().ttsModel).toBe('tts-1')
  })

  it.skipIf(process.platform === 'win32')('writes config.json with 0600 permissions', () => {
    saveSettings(
      input({
        openClaw: { mode: 'manual', baseURL: LOCAL_BASE, token: { action: 'set', value: 'tok' } }
      })
    )

    const mode = statSync(join(h.userData, 'config.json')).mode & 0o777
    expect(mode).toBe(0o600)
  })
})
