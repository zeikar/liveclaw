// Deliberately kept out of openclaw-config.test.ts: that file mocks `os` so its cases stay off the
// developer's real config, and under that mock this assertion would pass no matter what the code
// did. Here `os` is the real one, so the environment override is genuinely exercised. Nothing below
// reads a file — only the resolved path string is asserted.
import { userInfo } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openClawConfigPath } from './openclaw-config'

const FAKE_HOME = '/tmp/liveclaw-not-the-real-home'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the packaged config path', () => {
  it('comes from the OS account, so $HOME cannot redirect it', () => {
    vi.stubEnv('HOME', FAKE_HOME)
    vi.stubEnv('USERPROFILE', FAKE_HOME)

    const path = openClawConfigPath(false)

    expect(path).not.toContain(FAKE_HOME)
    expect(path).toBe(join(userInfo().homedir, '.openclaw', 'openclaw.json'))
  })

  // The dev path keeps its override, which is the whole point of the flag.
  it('still honours OPENCLAW_CONFIG_PATH when the env path is allowed', () => {
    vi.stubEnv('OPENCLAW_CONFIG_PATH', '/tmp/liveclaw-dev-gateway.json')

    expect(openClawConfigPath(true)).toBe('/tmp/liveclaw-dev-gateway.json')
  })

  // The account lookup can fail — an arbitrary-uid container has no passwd entry. Falling back to
  // homedir() there would hand the redirection straight back to $HOME in the one case the catch
  // exists for, so this fails closed and detection reports it instead.
  it('fails closed when the account has no home, rather than consulting $HOME', async () => {
    vi.stubEnv('HOME', FAKE_HOME)
    vi.stubEnv('USERPROFILE', FAKE_HOME)
    vi.resetModules()
    vi.doMock('os', async (importOriginal) => ({
      ...(await importOriginal<typeof import('os')>()),
      userInfo: () => {
        throw new Error('getpwuid_r: no such user')
      }
    }))

    try {
      const module = await import('./openclaw-config')

      expect(module.openClawConfigPath(false)).toBeNull()

      const detection = module.detectOpenClaw(false)
      expect(detection.token).toBe('')
      expect(detection.origin).toBeNull()
      expect(detection.error).toMatch(/home directory/i)
    } finally {
      vi.doUnmock('os')
      vi.resetModules()
    }
  })
})
