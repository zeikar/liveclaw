import { join } from 'path'
import { pathToFileURL } from 'url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

const h = vi.hoisted(() => ({
  isDev: false,
  // Captures what handleTrusted registers, so a test can invoke the channel the way Electron would.
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    // Fake webContents opt in to being window-owned; anything else stands in for a child view.
    fromWebContents: (contents: { ownedByWindow?: boolean }) => (contents.ownedByWindow ? {} : null)
  },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      h.handlers.set(channel, handler)
    }
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    get dev() {
      return h.isDev
    }
  }
}))

import { RENDERER_ENTRY_PATH, handleTrusted, isTrustedRendererSender } from './renderer-trust'

const DEV_URL = 'http://localhost:5173'

type FakeFrame = { url: string; parent: FakeFrame | null }

const mainFrame = (url: string): FakeFrame => ({ url, parent: null })

const event = (frame: FakeFrame | null, ownedByWindow = true): IpcMainInvokeEvent =>
  ({ senderFrame: frame, sender: { ownedByWindow } }) as unknown as IpcMainInvokeEvent

beforeEach(() => {
  h.isDev = false
  vi.stubEnv('ELECTRON_RENDERER_URL', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('in development', () => {
  beforeEach(() => {
    h.isDev = true
    vi.stubEnv('ELECTRON_RENDERER_URL', DEV_URL)
  })

  it('trusts a main frame on the dev server origin', () => {
    expect(isTrustedRendererSender(event(mainFrame(`${DEV_URL}/index.html`)))).toBe(true)
  })

  it('rejects a main frame on any other origin', () => {
    expect(isTrustedRendererSender(event(mainFrame('http://evil.example/index.html')))).toBe(false)
  })
})

describe('when packaged', () => {
  const entryURL = pathToFileURL(RENDERER_ENTRY_PATH).href

  it('trusts a main frame on the exact renderer entry', () => {
    expect(isTrustedRendererSender(event(mainFrame(entryURL)))).toBe(true)
  })

  it('rejects any other file: URL', () => {
    const sibling = pathToFileURL(join(RENDERER_ENTRY_PATH, '../other.html')).href

    expect(isTrustedRendererSender(event(mainFrame(sibling)))).toBe(false)
  })

  // `is.dev` is the only thing keeping a stray ELECTRON_RENDERER_URL from widening a packaged
  // build's trust to whatever origin it names.
  it('ignores ELECTRON_RENDERER_URL, so the dev-server origin stays untrusted', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', DEV_URL)

    expect(isTrustedRendererSender(event(mainFrame(`${DEV_URL}/index.html`)))).toBe(false)
  })
})

describe('the sender itself', () => {
  const entryURL = pathToFileURL(RENDERER_ENTRY_PATH).href

  it('rejects a subframe even on the trusted URL', () => {
    const subframe: FakeFrame = { url: entryURL, parent: mainFrame(entryURL) }

    expect(isTrustedRendererSender(event(subframe))).toBe(false)
  })

  it('rejects a destroyed frame reported as null', () => {
    expect(isTrustedRendererSender(event(null))).toBe(false)
  })

  it('rejects webContents that no BrowserWindow owns', () => {
    expect(isTrustedRendererSender(event(mainFrame(entryURL), false))).toBe(false)
  })
})

describe('handleTrusted', () => {
  const entryURL = pathToFileURL(RENDERER_ENTRY_PATH).href
  const invoke = (channel: string, sender: IpcMainInvokeEvent, ...args: unknown[]): unknown =>
    h.handlers.get(channel)!(sender, ...args)

  beforeEach(() => {
    h.handlers.clear()
  })

  it('forwards the arguments and the return value for the app’s own renderer', async () => {
    const handler = vi.fn(async (_event: IpcMainInvokeEvent, a: number, b: number) => a + b)
    handleTrusted('math:add', handler)

    await expect(invoke('math:add', event(mainFrame(entryURL)), 2, 3)).resolves.toBe(5)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  // The whole point: the handler body must not run at all, so a channel that spends money or hands
  // out a credential never gets that far.
  it('throws without running the handler for an untrusted sender', () => {
    const handler = vi.fn()
    handleTrusted('tts:getConfig', handler)

    expect(() =>
      invoke('tts:getConfig', event(mainFrame('http://evil.example/index.html')))
    ).toThrow(/tts:getConfig is only available to the LiveClaw renderer/)
    expect(handler).not.toHaveBeenCalled()
  })

  it('refuses a subframe and a destroyed frame the same way', () => {
    const handler = vi.fn()
    handleTrusted('llm:chat', handler)
    const subframe: FakeFrame = { url: entryURL, parent: mainFrame(entryURL) }

    expect(() => invoke('llm:chat', event(subframe))).toThrow()
    expect(() => invoke('llm:chat', event(null))).toThrow()
    expect(handler).not.toHaveBeenCalled()
  })
})
