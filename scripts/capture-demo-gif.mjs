// Records the README/social demo GIF by driving the real app.
//
//   npm run demo:gif -- ["question"] [out.gif]
//
// Playwright launches the built app the same way the e2e suite does, frames are grabbed as PNGs,
// and ImageMagick assembles them. Two things are worth knowing before editing:
//
//   - The reply wait is deliberately not filmed. A cold OpenClaw session answers in 20-40s, which
//     no GIF should sit through, so capture stops at send and resumes when the reply renders.
//   - The typing indicator is a character bubble whose text is exactly "..."
//     (HistoryMessageColumns), so "has the reply arrived" has to read bubble text, not bubble count.
//
// Needs: a built app (`electron-vite build`), a reachable OpenClaw gateway, an OpenAI key in .env
// for speech, and `magick` on PATH.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const QUESTION = process.argv[2] || 'Hey Hiyori, introduce yourself in one line!'
const OUT_GIF = resolve(process.argv[3] || join(PROJECT, 'docs', 'images', 'demo.gif'))

const FPS = Number(process.env.FPS || 8) // ~8 is the ceiling; a screenshot costs ~120ms
const WIDTH = Number(process.env.WIDTH || 720) // GIF width; frames come in at 2x for retina
const SPEAK_MS = Number(process.env.SPEAK_MS || 10_000)
// The stage is a smooth dark gradient, which 256 colours band into visible rings. Dithering trades
// those rings for noise — and that noise lands on the chat bubbles too, where it eats letters.
// Compared on the same frames: FloydSteinberg smooths the background best but leaves the question
// text visibly chewed (and costs 2.3MB); None keeps text sharpest but bands the background hard;
// Riemersma reads nearly as clean as None on text, rings far less than None, and is the smallest of
// the three at ~1.2MB. Hence the default.
const DITHER = process.env.DITHER || 'Riemersma'
// How near two pixels must be to count as unchanged between frames. This is the single biggest
// lever on file size: at 3% a dithered capture drops from ~7MB to ~2MB, because the background
// stops being redrawn every frame.
const FUZZ = process.env.FUZZ || '3%'
// KEEP_FRAMES=1 leaves the PNGs on disk and prints the path, so the assembly can be retried at
// other settings without paying for another cold session.
const KEEP_FRAMES = process.env.KEEP_FRAMES === '1'
const CHAR_BUBBLE = '.bg-slate-800\\/90'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Counts rendered character replies, ignoring the "..." typing indicator. */
const repliesIn = (selector) =>
  [...document.querySelectorAll(selector)].filter((el) => (el.textContent || '').trim() !== '...')
    .length

async function main() {
  const frameDir = mkdtempSync(join(tmpdir(), 'liveclaw-frames-'))
  const userDataDir = mkdtempSync(join(tmpdir(), 'liveclaw-gif-'))
  const env = { ...process.env, LIVECLAW_USER_DATA_DIR: userDataDir }
  delete env.ELECTRON_RENDERER_URL

  const app = await electron.launch({ args: [join(PROJECT, 'out', 'main', 'index.js')], env })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // Pin the window so every frame shares one size and the GIF has a known aspect.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setBounds({ x: 60, y: 60, width: 1280, height: 720 })
    win.show()
  })

  await page.locator('canvas').waitFor({ state: 'attached', timeout: 30_000 })
  const composer = page.getByPlaceholder(/Talk to/)
  await composer.waitFor({ timeout: 30_000 })
  await sleep(2500) // let the model load and settle into its idle loop

  let frame = 0
  let capturing = false
  let pump = null
  const start = () => {
    capturing = true
    pump = (async () => {
      const interval = 1000 / FPS
      while (capturing) {
        const began = Date.now()
        await page.screenshot({ path: join(frameDir, `f${String(frame++).padStart(4, '0')}.png`) })
        const rest = interval - (Date.now() - began)
        if (rest > 0) await sleep(rest)
      }
    })()
  }
  const stop = async () => {
    capturing = false
    await pump
  }

  start()

  // Beat 1 - idle, with the gaze following the cursor. Kept to three moves: a GIF that loops wants
  // to reach the point quickly, and the gaze reads in about two seconds.
  for (const [x, y] of [
    [1000, 300],
    [480, 260],
    [700, 430]
  ]) {
    await page.mouse.move(x, y, { steps: 12 })
    await sleep(180)
  }

  // Beat 2 - the question is typed in. The per-character pause is small because the concurrent
  // screenshot pump already stretches this beat.
  await composer.click()
  for (const ch of QUESTION) {
    await composer.type(ch, { delay: 0 })
    await sleep(12)
  }
  await sleep(400)

  // Beat 3 - send, holding just long enough to read as thinking.
  const before = await page.evaluate(repliesIn, CHAR_BUBBLE)
  await page.keyboard.press('Enter')
  await sleep(1600)

  // Beat 4 - the wait is not filmed.
  await stop()
  const cut = frame
  console.log('waiting for the reply (not captured)...')
  await page.waitForFunction(
    ({ selector, n }) =>
      [...document.querySelectorAll(selector)].filter(
        (el) => (el.textContent || '').trim() !== '...'
      ).length > n,
    { selector: CHAR_BUBBLE, n: before },
    { timeout: 240_000 }
  )

  // Beat 5 - the reply is on screen and being spoken, so the mouth moves.
  start()
  await sleep(SPEAK_MS)
  await stop()

  const reply = await page.evaluate(
    ({ selector }) => {
      const bubbles = [...document.querySelectorAll(selector)].filter(
        (el) => (el.textContent || '').trim() !== '...'
      )
      return (bubbles.at(-1)?.textContent || '').trim()
    },
    { selector: CHAR_BUBBLE }
  )

  await app.close()
  rmSync(userDataDir, { recursive: true, force: true })

  console.log(`\nreply (${reply.length} chars): ${reply}`)
  console.log(`frames: ${readdirSync(frameDir).length}, wait cut at ${cut}`)

  mkdirSync(dirname(OUT_GIF), { recursive: true })
  execFileSync(
    'magick',
    [
      '-delay',
      String(Math.round(100 / FPS)),
      '-loop',
      '0',
      join(frameDir, 'f*.png'),
      '-resize',
      String(WIDTH),
      '-dither',
      DITHER,
      '-colors',
      '256',
      '-fuzz',
      FUZZ,
      '-layers',
      'Optimize',
      OUT_GIF
    ],
    { stdio: 'inherit' }
  )
  if (KEEP_FRAMES) console.log(`frames kept at ${frameDir}`)
  else rmSync(frameDir, { recursive: true, force: true })
  console.log(`\nwrote ${OUT_GIF}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
