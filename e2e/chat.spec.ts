import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { isolatedLaunchEnv } from './isolation'

// The one span no other suite covers: preload bridge → ipcMain 'llm:chat' → @charivo/server/openclaw
// → gateway, and the reply back into the DOM. The unit suites stub window.api, so everything from
// the bridge down is untested there; the smoke suite runs unconfigured and never reaches chat.
//
// A real OpenClaw gateway would tie this to a running daemon and a live model, so instead a local
// HTTP server plays the gateway's OpenAI-compatible role. That keeps the whole chain real — the
// provider, the OpenAI SDK, and a genuine socket — while staying hermetic enough for CI.

const GATEWAY_TOKEN = 'e2e-gateway-token'

type ChatCall = {
  authorization: string
  /** The session pin: the provider sends `sessionKey` as OpenAI's `user` field. */
  user?: string
  messages: Array<{ role: string; content: string }>
}

const chatCalls: ChatCall[] = []
/**
 * One-shot failure injection: the next chat call is answered with this HTTP status instead of a
 * completion. Lets the failure path run against the same app instance as the happy path, so both
 * cross the same bridge, the same provider, and the same socket.
 */
let failNextChatWith: number | null = null
let gateway: Server
let gatewayPort: number

let app: ElectronApplication
let page: Page
let userDataDir: string

const readBody = async (stream: NodeJS.ReadableStream): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf-8')
}

const startGateway = (): Promise<void> =>
  new Promise((resolve) => {
    gateway = createServer((req, res) => {
      const json = (status: number, payload: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      }

      // Reject anything unauthenticated, so a token that never left the main process fails the
      // suite instead of silently passing.
      if (req.headers.authorization !== `Bearer ${GATEWAY_TOKEN}`) {
        json(401, { error: { message: 'missing or wrong bearer token' } })
        return
      }

      // What settings:test probes; useSettings gates the chat view on it answering 200.
      if (req.method === 'GET' && req.url === '/v1/models') {
        json(200, { object: 'list', data: [{ id: 'openclaw/default', object: 'model' }] })
        return
      }

      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        readBody(req)
          .then((raw) => {
            const body = JSON.parse(raw) as Pick<ChatCall, 'user' | 'messages'>
            chatCalls.push({
              authorization: req.headers.authorization ?? '',
              user: body.user,
              messages: body.messages
            })

            // Recorded first: a rejected turn still has to prove it reached the gateway.
            const failure = failNextChatWith
            failNextChatWith = null
            if (failure !== null) {
              json(failure, { error: { message: 'injected gateway failure', type: 'e2e' } })
              return
            }

            // Echo the newest user turn back, so each test asserts on a reply only its own input
            // could have produced — the assertions stay independent of call order.
            const latestUser = [...body.messages].reverse().find((msg) => msg.role === 'user')
            json(200, {
              id: `chatcmpl-e2e-${chatCalls.length}`,
              object: 'chat.completion',
              created: 0,
              model: 'openclaw/default',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: `Echo: ${latestUser?.content ?? ''}` },
                  finish_reason: 'stop'
                }
              ]
            })
          })
          .catch((err: unknown) => {
            json(400, { error: { message: err instanceof Error ? err.message : String(err) } })
          })
        return
      }

      json(404, { error: { message: `unexpected ${req.method} ${req.url}` } })
    })

    gateway.listen(0, '127.0.0.1', () => {
      gatewayPort = (gateway.address() as AddressInfo).port
      resolve()
    })
  })

const send = async (text: string): Promise<void> => {
  await page.getByRole('textbox').fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}

test.beforeAll(async () => {
  // The port is only known once the gateway is listening, and config.json has to carry it — so the
  // gateway must come up before the config is written, and the config before Electron launches.
  await startGateway()

  userDataDir = mkdtempSync(join(tmpdir(), 'liveclaw-e2e-chat-'))

  // A stored token plus its base URL is the manual override — top of the base-URL precedence and
  // origin-bound to this gateway, so it resolves without depending on detection or dev env vars.
  // The OpenAI key stays empty on purpose: that leaves TTS and STT disabled, so this suite makes no
  // request to OpenAI and exercises the chat path alone.
  writeFileSync(
    join(userDataDir, 'config.json'),
    JSON.stringify({
      openClawToken: GATEWAY_TOKEN,
      openClawBaseURL: `http://127.0.0.1:${gatewayPort}/v1`,
      openaiApiKey: '',
      ttsModel: '',
      ttsVoice: ''
    }),
    { mode: 0o600 }
  )

  // isolation.ts is what keeps the app off the developer's .env, real OpenClaw config, and — the
  // one that costs money — a real OpenAI key. The config.json above is then the only thing telling
  // this app where its gateway is.
  app = await electron.launch({
    args: [join(__dirname, '..', 'out', 'main', 'index.js')],
    env: isolatedLaunchEnv(userDataDir)
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  await new Promise<void>((resolve) => gateway?.close(() => resolve()))
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true })
})

test('reaches the chat view instead of the setup screen', async () => {
  // needsSetup stays false only if settings:get resolved the stored gateway AND settings:test got a
  // 200 from it — so the composer appearing already proves the /v1/models handshake happened over a
  // real socket with the stored token.
  await expect(page.getByRole('button', { name: 'Send' })).toBeAttached({ timeout: 30_000 })
})

test('runs with TTS and STT disabled, so no turn can bill OpenAI', async () => {
  // A standing guard, not a formality: TTS speaks every reply this suite produces, and it speaks it
  // through the real OpenAI API. If a stray OPENAI_API_KEY / VITE_OPENAI_API_KEY ever reaches the
  // app here — from the shell, from .env — every run starts costing money. Fail loudly instead.
  const source = await page.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        api: { getSettings: () => Promise<{ openaiApiKeySource: string }> }
      }
    ).api
    return (await api.getSettings()).openaiApiKeySource
  })

  expect(source).toBe('none')
  // The mic button only renders when a key is present, so its absence is the same claim in the DOM.
  await expect(page.getByRole('button', { name: 'Start recording' })).toHaveCount(0)
})

test('sends a message through the bridge and renders the gateway reply', async () => {
  await send('hello from the e2e suite')

  await expect(page.getByText('Echo: hello from the e2e suite')).toBeVisible({ timeout: 15_000 })

  expect(chatCalls).toHaveLength(1)
  expect(chatCalls[0].authorization).toBe(`Bearer ${GATEWAY_TOKEN}`)
  // The character prompt rides along as the system message, and the user's turn is what it framed.
  expect(chatCalls[0].messages.map((msg) => msg.role)).toEqual(['system', 'user'])
  expect(chatCalls[0].messages.at(-1)?.content).toBe('hello from the e2e suite')
})

test('pins one session key and sends no past turns on the next message', async () => {
  await send('second turn')
  await expect(page.getByText('Echo: second turn')).toBeVisible({ timeout: 15_000 })

  expect(chatCalls).toHaveLength(2)
  // The gateway holds the transcript server-side, so the provider deliberately drops past turns —
  // resending them would stack a duplicate history on top of the session's own. This asserts that
  // documented behaviour, and would fail loudly if someone "fixed" it by replaying history.
  expect(chatCalls[1].messages.map((msg) => msg.role)).toEqual(['system', 'user'])
  expect(chatCalls[1].messages.at(-1)?.content).toBe('second turn')

  // Same provider, so the same pinned session — this is what keeps the two turns one conversation.
  expect(chatCalls[1].user).toBe(chatCalls[0].user)
  expect(chatCalls[0].user).toMatch(/^liveclaw:/)
})

test('New chat rotates the session key', async () => {
  await page.getByRole('button', { name: 'New chat' }).click()
  await expect(page.getByText('Echo: second turn')).toHaveCount(0)

  await send('after the reset')
  await expect(page.getByText('Echo: after the reset')).toBeVisible({ timeout: 15_000 })

  expect(chatCalls).toHaveLength(3)
  // llm:newConversation drops the provider; the next call builds one with a fresh session key, so
  // the gateway opens a new session rather than replying from the transcript the user just cleared.
  expect(chatCalls[2].user).not.toBe(chatCalls[1].user)
  expect(chatCalls[2].user).toMatch(/^liveclaw:/)
})

test('surfaces a gateway rejection instead of dropping the turn silently', async () => {
  // 401 is the realistic version of this — a token rotated inside OpenClaw after LiveClaw read it —
  // and, unlike a 5xx, the OpenAI SDK does not retry it, so the call count stays exact.
  failNextChatWith = 401
  await send('this turn gets rejected')

  const alert = page.getByRole('alert')
  await expect(alert).toBeVisible({ timeout: 15_000 })
  await expect(alert).toContainText('Authentication error')

  // The rejection was real: the turn crossed the bridge and the gateway answered it.
  expect(chatCalls).toHaveLength(4)
  // The user's own message survives a failed turn, so retrying costs no retyping...
  await expect(page.getByText('this turn gets rejected')).toBeVisible()
  // ...and no reply bubble appears for a turn that never produced one.
  await expect(page.getByText('Echo: this turn gets rejected')).toHaveCount(0)
})

test('recovers on the next message after a rejection', async () => {
  await send('back to normal')

  await expect(page.getByText('Echo: back to normal')).toBeVisible({ timeout: 15_000 })
  // A failed turn must not leave a stale error hanging over a conversation that now works.
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(chatCalls).toHaveLength(5)
  // The failed turn neither rotated the session nor cost the pin.
  expect(chatCalls[4].user).toBe(chatCalls[2].user)
})

// Last on purpose: it takes the gateway down, so nothing may run after it.
test('reports an unreachable gateway', async () => {
  await new Promise<void>((resolve) => gateway.close(() => resolve()))

  await send('nobody is listening')

  const alert = page.getByRole('alert')
  await expect(alert).toBeVisible({ timeout: 15_000 })
  await expect(alert).toContainText('Cannot connect to OpenClaw')
})
