import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'

const MAIN_ENTRY = join(__dirname, '..', 'out', 'main', 'index.js')

// The full bridge surface, listed rather than derived: this is the contract the renderer codes
// against, so a method silently appearing or vanishing is exactly what this suite should notice.
const BRIDGE_METHODS = [
  'bootstrapRealtimeSTT',
  'chat',
  'getSettings',
  'getTTSConfig',
  'newConversation',
  'openExternal',
  'saveSettings',
  'testConnection'
]

let app: ElectronApplication
let page: Page
let userDataDir: string
const consoleErrors: string[] = []

test.beforeAll(async () => {
  // LIVECLAW_USER_DATA_DIR only applies when `app.isPackaged` is false, which is how Playwright
  // launches the app — so the suite never reads or writes the real config.json, and never has to
  // care whether the developer running it has a token configured.
  userDataDir = mkdtempSync(join(tmpdir(), 'liveclaw-e2e-'))

  // Main picks the dev server over the built renderer whenever ELECTRON_RENDERER_URL is set, so drop
  // it: this suite always exercises the bundle that actually ships.
  const env = { ...process.env, LIVECLAW_USER_DATA_DIR: userDataDir }
  delete env.ELECTRON_RENDERER_URL

  app = await electron.launch({ args: [MAIN_ENTRY], env })

  page = await app.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true })
})

test('opens exactly one window', async () => {
  expect(app.windows()).toHaveLength(1)
})

test('renders the Live2D stage on a healthy WebGL context', async () => {
  // Live2DPanel renders in every App branch — loading, load error, setup, and chat — so this holds
  // whether or not an OpenClaw gateway is reachable.
  const canvas = page.locator('canvas')
  await expect(canvas).toBeAttached({ timeout: 30_000 })

  const context = await canvas.evaluate((element) => {
    const node = element as HTMLCanvasElement
    // Asking for a context type the canvas was not created with returns null without disturbing the
    // live one, so probing in this order is safe.
    const gl = (node.getContext('webgl2') ??
      node.getContext('webgl')) as WebGLRenderingContext | null
    return {
      width: node.width,
      height: node.height,
      hasContext: gl !== null,
      lost: gl?.isContextLost() ?? true
    }
  })

  expect(context.hasContext).toBe(true)
  expect(context.lost).toBe(false)
  expect(context.width).toBeGreaterThan(0)
  expect(context.height).toBeGreaterThan(0)
})

test('actually draws the character onto the stage', async () => {
  // A live GL context is not proof that anything was painted: a failed model load leaves the canvas
  // present and healthy but empty. So measure what the canvas contributes, by shooting its box twice
  // — once as-is, once with the canvas transparent — and comparing how well each PNG compresses.
  //
  // A drawn character adds sharp, high-frequency detail on top of the panel's blurred background,
  // which inflates the PNG; an empty canvas leaves that background alone (ratio ~1.0), and a canvas
  // cleared to a flat colour compresses *better* than the gradient it hides (ratio < 1). Both
  // failure modes therefore land under the bound. Measured on this model: 470KB vs 200KB, 2.35x.
  const canvas = page.locator('canvas')

  const painted = await canvas.screenshot()
  await canvas.evaluate((element) => ((element as HTMLElement).style.opacity = '0'))
  const background = await canvas.screenshot()
  await canvas.evaluate((element) => ((element as HTMLElement).style.opacity = ''))

  expect(painted.length).toBeGreaterThan(background.length * 1.5)
})

test('surfaces no renderer error', async () => {
  // useLive2DRenderer routes a rejected initialize() into `rendererError`, and that message is the
  // only <p> Live2DPanel ever renders — so an empty count means the setup path came up clean.
  //
  // Scope, established by breaking things and watching this run: it covers failures that actually
  // reject (the dynamic @charivo/render imports, createRenderManager, initialize). It does NOT cover
  // a model that fails to load — that resolves quietly, leaving an empty stage and no message. The
  // pixel test above and the console-error test below are what catch that.
  const errorParagraphs = await page.evaluate(
    () => document.querySelector('canvas')?.closest('section')?.querySelectorAll('p').length ?? -1
  )

  expect(errorParagraphs).toBe(0)
})

test('exposes exactly the eight bridge methods, and nothing from Node', async () => {
  const surface = await page.evaluate(() => {
    const api = (globalThis as unknown as { api?: Record<string, unknown> }).api
    return {
      methods: api ? Object.keys(api).sort() : [],
      // The renderer runs inside Chromium's OS sandbox (v1.4.1). None of these may be reachable.
      hasRequire: 'require' in globalThis,
      hasProcess: 'process' in globalThis,
      hasBuffer: 'Buffer' in globalThis
    }
  })

  expect(surface.methods).toEqual(BRIDGE_METHODS)
  expect(surface.hasRequire).toBe(false)
  expect(surface.hasProcess).toBe(false)
  expect(surface.hasBuffer).toBe(false)
})

test('answers settings:get regardless of gateway state', async () => {
  // settings:get is the one channel that must work before anything is set up — it is what decides
  // whether the setup screen appears — so it answers whether or not OpenClaw is running here. It
  // also proves handleTrusted admits this window.
  const settings = await page.evaluate(async () => {
    const api = (globalThis as unknown as { api: { getSettings: () => Promise<unknown> } }).api
    return api.getSettings()
  })

  expect(settings).toBeTruthy()
  // Secrets are write-only across this IPC: the payload carries presence flags, never values.
  expect(JSON.stringify(settings)).not.toContain('sk-')
})

test('refuses to navigate off the renderer entry', async () => {
  const before = page.url()

  await page.evaluate(() => {
    window.location.href = 'https://example.com/'
  })
  // The guard cancels the navigation before any request leaves, so this only needs long enough for
  // a navigation to have committed had it been allowed.
  await page.waitForTimeout(1_000)

  expect(page.url()).toBe(before)
})

test('logs no console errors during startup', async () => {
  expect(consoleErrors).toEqual([])
})
