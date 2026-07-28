import { join } from 'path'
import { pathToFileURL } from 'url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

const h = vi.hoisted(() => ({ isDev: false }))

vi.mock('electron', () => ({
  BrowserWindow: {
    // Fake webContents opt in to being window-owned; anything else stands in for a child view.
    fromWebContents: (contents: { ownedByWindow?: boolean }) => (contents.ownedByWindow ? {} : null)
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    get dev() {
      return h.isDev
    }
  }
}))

import { RENDERER_ENTRY_PATH, isTrustedRendererSender } from './renderer-trust'

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
