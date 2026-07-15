import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectOpenClaw, openClawConfigPath } from './openclaw-config'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'liveclaw-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

function useConfig(contents: string): string {
  const path = join(dir, 'openclaw.json')
  writeFileSync(path, contents)
  vi.stubEnv('OPENCLAW_CONFIG_PATH', path)
  return path
}

describe('detectOpenClaw', () => {
  it('parses a JSON5 config with comments and a trailing comma', () => {
    useConfig(`{
      // gateway settings
      gateway: {
        auth: { token: 'sekrit' },
      },
    }`)

    const result = detectOpenClaw()

    expect(result.token).toBe('sekrit')
    expect(result.error).toBeNull()
  })

  it('parses a strict-JSON config', () => {
    useConfig(JSON.stringify({ gateway: { auth: { token: 'sekrit' } } }))

    const result = detectOpenClaw()

    expect(result.token).toBe('sekrit')
    expect(result.error).toBeNull()
  })

  it('detects a literal token when gateway.auth.mode is unset', () => {
    useConfig(JSON.stringify({ gateway: { auth: { token: 'sekrit' } } }))

    const result = detectOpenClaw()

    expect(result.token).toBe('sekrit')
  })

  it('does not detect a token when gateway.auth.mode is not "token"', () => {
    useConfig(JSON.stringify({ gateway: { auth: { token: 'sekrit', mode: 'password' } } }))

    const result = detectOpenClaw()

    expect(result.token).toBe('')
    expect(result.error).not.toBeNull()
  })

  it('treats gateway.auth.mode "none" as a usable no-auth gateway', () => {
    useConfig(JSON.stringify({ gateway: { port: 18789, auth: { mode: 'none' } } }))

    const result = detectOpenClaw()

    expect(result.token).toBe('')
    expect(result.noAuth).toBe(true)
    expect(result.error).toBeNull()
    expect(result.origin).toBe('http://127.0.0.1:18789')
  })

  it('derives baseURL and origin from a configured gateway.port', () => {
    useConfig(JSON.stringify({ gateway: { port: 4000, auth: { token: 'sekrit' } } }))

    const result = detectOpenClaw()

    expect(result.baseURL).toBe('http://127.0.0.1:4000/v1')
    expect(result.origin).toBe('http://127.0.0.1:4000')
  })

  it('falls back to the default port when gateway.port is missing', () => {
    useConfig(JSON.stringify({ gateway: { auth: { token: 'sekrit' } } }))

    const result = detectOpenClaw()

    expect(result.baseURL).toBe('http://127.0.0.1:18789/v1')
  })

  it('falls back to the default port without throwing when gateway.port is NaN', () => {
    // JSON5 allows NaN as a numeric literal (strict JSON does not).
    useConfig(`{ gateway: { port: NaN, auth: { token: 'sekrit' } } }`)

    let result: ReturnType<typeof detectOpenClaw> | undefined
    expect(() => {
      result = detectOpenClaw()
    }).not.toThrow()

    expect(result?.baseURL).toBe('http://127.0.0.1:18789/v1')
    expect(result?.origin).toBe('http://127.0.0.1:18789')
  })

  it('sets chatCompletionsEnabled to true only when the flag is literally true', () => {
    useConfig(
      JSON.stringify({
        gateway: { http: { endpoints: { chatCompletions: { enabled: true } } } }
      })
    )

    expect(detectOpenClaw().chatCompletionsEnabled).toBe(true)
  })

  it('sets chatCompletionsEnabled to false when the flag is absent', () => {
    useConfig(JSON.stringify({ gateway: {} }))

    expect(detectOpenClaw().chatCompletionsEnabled).toBe(false)
  })

  it('rejects a non-string token', () => {
    useConfig(JSON.stringify({ gateway: { auth: { token: 12345 } } }))

    const result = detectOpenClaw()

    expect(result.token).toBe('')
    expect(result.error).not.toBeNull()
  })

  it('rejects a bare interpolated token', () => {
    useConfig(JSON.stringify({ gateway: { auth: { token: '${OPENCLAW_GATEWAY_TOKEN}' } } }))

    const result = detectOpenClaw()

    expect(result.token).toBe('')
    expect(result.error).not.toBeNull()
  })

  it('rejects a token with embedded interpolation', () => {
    useConfig(JSON.stringify({ gateway: { auth: { token: 'tok-${OPENCLAW_GATEWAY_TOKEN}' } } }))

    const result = detectOpenClaw()

    expect(result.token).toBe('')
    expect(result.error).not.toBeNull()
  })

  it('reports no config found for a missing file', () => {
    vi.stubEnv('OPENCLAW_CONFIG_PATH', join(dir, 'does-not-exist.json'))

    const result = detectOpenClaw()

    expect(result.token).toBe('')
    expect(result.error).toContain('No OpenClaw config')
  })

  it('reports an error instead of throwing for an unreadable path', () => {
    const path = join(dir, 'a-directory')
    mkdirSync(path)
    vi.stubEnv('OPENCLAW_CONFIG_PATH', path)

    expect(() => detectOpenClaw()).not.toThrow()
    expect(detectOpenClaw().error).not.toBeNull()
  })

  it('reports an error instead of throwing for a syntactically broken file', () => {
    useConfig('{ gateway: ')

    expect(() => detectOpenClaw()).not.toThrow()
    expect(detectOpenClaw().error).not.toBeNull()
  })

  it('reports an error instead of throwing when the config root is not an object', () => {
    useConfig('[]')

    let result: ReturnType<typeof detectOpenClaw> | undefined
    expect(() => {
      result = detectOpenClaw()
    }).not.toThrow()

    expect(result?.token).toBe('')
    expect(result?.error).toContain('is not a JSON object')
  })

  it('honours OPENCLAW_CONFIG_PATH over the default ~/.openclaw/openclaw.json', () => {
    const path = useConfig(JSON.stringify({ gateway: { auth: { token: 'sekrit' } } }))

    expect(openClawConfigPath()).toBe(path)
  })
})
