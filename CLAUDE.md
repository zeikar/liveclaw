# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # electron-vite dev (Electron + renderer HMR)
npm run build            # typecheck + electron-vite build
npm test                 # vitest run
npm run test:e2e         # electron-vite build + playwright (real Electron app)
npm run lint             # eslint (cached)
npm run typecheck        # tsc for node (main/preload) and web (renderer) projects separately
npm run format           # prettier --write .
```

Run a single test file or case:

```bash
npx vitest run src/renderer/src/hooks/useCharivo.test.ts
npx vitest run -t 'rotates the OpenClaw session'
npx playwright test e2e/chat.spec.ts -g 'rotates the session key'
```

CI (`.github/workflows/ci.yml`) runs lint → typecheck → test → `electron-vite build` → the e2e
suites under `xvfb-run`. Match that before pushing; locally the last step is `npm run test:e2e`.

## Architecture

An Electron desktop AI companion: a Live2D character you chat with. The
[Charivo](https://github.com/zeikar/charivo) framework (`@charivo/*`, a sibling repo by the same
author) orchestrates the character session; this repo is the Electron shell around it.

### Two deliberate, asymmetric paths

Chat and speech reach their providers by different routes, and that asymmetry is intentional:

- **Chat goes through IPC to the main process.** `renderer → window.api.chat → ipcMain 'llm:chat' →
@charivo/server/openclaw → OpenClaw gateway`. It runs in Node to avoid renderer CORS/PNA limits.
  The OpenClaw token is read from OpenClaw's own config by `src/main/openclaw-config.ts`; an
  **auto-detected** token is never copied into LiveClaw's `config.json` (a **manually entered** one
  is, together with its base URL, and is origin-bound like every other implicit token thereafter).
  Effective base URL precedence: `config.json` manual override → an explicitly-set dev
  `OPENCLAW_BASE_URL` → OpenClaw auto-detect → the loopback default — auto-detection is a guess an
  explicit dev override can correct (e.g. a CLI `--port` the config file can't see).
  The settings IPC is write-only for secrets — `settings:get`/`settings:save` exchange
  `openClawTokenSet` and `openaiApiKeySource`, never the values. **Every implicit token — auto-detected,
  `.env`-derived, or previously stored — is bound to the origin it was configured for and is never
  sent anywhere else; only a token submitted in the current request can establish credentials for a
  new origin.** The `GET /v1/models` check `settings:test` runs is a readiness/correctness check, not
  a trust boundary — `llm:chat` and provider construction do not depend on it. That token is an
  **operator-grade credential** for the gateway, not a scoped API key. Every environment variable
  that can supply or redirect a credential is dev-only: `OPENCLAW_TOKEN`, `OPENAI_API_KEY`,
  `OPENCLAW_BASE_URL`, and `OPENCLAW_CONFIG_PATH` (which names the file a token is read from, so it
  is gated exactly like the token itself — `detectOpenClaw(!app.isPackaged)`).
- **TTS is called directly from the renderer** (`@charivo/tts/openai`, `dangerouslyAllowBrowser`).
  The OpenAI key reaches the renderer through the `tts:getConfig` IPC at runtime rather than
  `import.meta.env`, so no key is baked into the bundle — but it's still live in renderer memory, and
  this is accepted for local/dev use only.
- **STT no longer mirrors TTS.** The WebRTC media/data session to OpenAI's realtime API still runs
  from the renderer (`createOpenAIRealtimeSTTTranscriber` from `@charivo/stt/openai-realtime`), but
  the two HTTP hops move to the main process: mint an ephemeral client secret using the standing key,
  then spend that secret — not the standing key — trading the renderer's SDP offer for an answer.
  Both live in `src/main/realtime-stt.ts` (`bootstrapRealtimeTranscription`), exposed to the renderer
  as `stt:bootstrapRealtime` / `window.api.bootstrapRealtimeSTT`. Neither the standing OpenAI key nor
  the ephemeral secret minted from it ever reaches the renderer on this path — only the negotiated SDP
  answer comes back. (TTS above is unaffected.) The mic permission handlers in `src/main/index.ts`
  (`setPermissionRequestHandler`/`setPermissionCheckHandler`) still grant only audio-only, main-frame
  requests from this app's own renderer window. They share their boundary — `isOwnRendererURL`
  (`src/main/renderer-trust.ts`) — with the navigation guard and every IPC channel, instead of each
  defining one separately: loosen it and you loosen all of them. Provider/transcriber changes still
  belong upstream in `charivo`, not patched around here.

### One trust boundary, three enforcement points

`src/main/renderer-trust.ts` owns the answer to "is this this app's own renderer", and nothing else
may answer it:

- **Navigation.** `will-frame-navigate` in `createWindow` refuses any navigation off the renderer
  entry. The preload `api` belongs to whatever document the window holds, so a top frame that
  navigated away would otherwise keep every channel.
- **Every IPC channel.** All handlers are registered with `handleTrusted`, never `ipcMain.handle`
  directly — `llm:chat` reaches an operator-grade gateway and `settings:save` decides which gateway
  that is, so they carry the same check as the key behind `tts:getConfig`. A new channel that skips
  the wrapper is a hole, not a style choice.
- **Mic permission.** The two permission handlers, as above.

`toExternalURL` (`src/main/external-url.ts`) is the matching rule for URLs leaving the app: both
`app:openExternal` and `setWindowOpenHandler` go through it, because a middle-clicked link reaches
the latter without the renderer's own `preventDefault` ever running.

### The renderer's Charivo session

`src/renderer/src/lib/charivo/session.ts` is a module-level singleton: one `Charivo` instance with an
`LLMManager` whose `LLMClient` is just `window.api.chat`. It owns the message list the UI renders
(via `subscribeMessages`), separate from the `LLMManager`'s own history.

`LLMManager` always hands the provider the **full array** `[system(character prompt), ...past turns,
newest user turn]`. What actually goes over the wire is decided in the provider — see below.

### OpenClaw sessions (the part that bites)

The gateway keeps conversation state **server-side**, but opens a brand-new session for any request
carrying no session identifier. `src/main/index.ts` therefore pins a `sessionKey` (`liveclaw:<uuid>`).
**Read [docs/openclaw-integration.md](docs/openclaw-integration.md) before touching the chat path** —
it explains why each of these holds. Do not break them:

- With a `sessionKey` set, the provider **drops past turns** and sends only the system prompt plus the
  newest turn. This is intentional. Do not "fix" it by resending history.
- `sessionKey` is fixed at provider construction, so a new conversation means a **new provider**.
  Rotation happens in **three** places: the `llm:newConversation` IPC (New chat), window re-create —
  on macOS the main process outlives its windows — and a `settings:save` that changes the
  **effective** OpenClaw token or base URL (which also clears the renderer transcript, since the old
  messages belong to a session key that no longer exists). That third rotation cannot land mid-turn:
  the settings chip is disabled while a reply is in flight, and the composer is disabled while the
  settings modal is open.
- `clearHistory` rotates **before** clearing local history, never after.
- Do not send `x-openclaw-agent-id`; it 400s on gateways whose agent is not named `main`.
- The agent's long-term memory survives rotation. "New chat" not wiping the character's memory is
  expected, not a bug to fix here.

Provider changes (session handling, agent routing, model target) belong upstream in the `charivo`
repo's `packages/server/src/openclaw/`, not patched around here.

### Realtime STT (the part that bites)

- `stt:bootstrapRealtime` authenticates its sender (via `handleTrusted`) **before** it reads the
  OpenAI key or sends anything upstream — minting an ephemeral client secret is a billable call, so
  an unauthenticated or navigated-away sender must never reach it.
- `useSTT` (`src/renderer/src/hooks/useSTT.ts`) branches Start/Stop on its own `sessionOpen` ref, not
  the STT manager's `isRecording()`. A streaming session that fails mid-recording reports
  `isRecording() === false` while still holding its terminal error, and only `stop()` rethrows it —
  branching on the manager's own flag would silently retake the Start arm on the user's Stop press.
- The bootstrap's own deadline (`BOOTSTRAP_DEADLINE_MS`, 12s) must stay shorter than the
  transcriber's own bootstrap timeout (`BOOTSTRAP_TIMEOUT_MS` in `@charivo/stt/openai-realtime`,
  15s) — main has to give up first, or a slow upstream call can outlive the transcriber's cleanup
  and leave an orphaned, billable session running.

## Testing

Vitest runs as two projects (`vitest.config.ts`): `renderer`
(`src/renderer/src/**/*.test.{ts,tsx}`, jsdom) and `main` (`src/main/**/*.test.ts`, node, `electron`
mocked). `npm test` runs both. The preload process has no test setup.

- Every renderer test must stub `window.api` — the Charivo session singleton calls it. Missing a newly
  added `api` method breaks typecheck across all test files that assign `window.api`.
- `@testing-library/jest-dom` is **not** installed. Assert on DOM properties (`button.disabled`), not
  `toBeDisabled()`.
- Add `afterEach(cleanup)` in component tests; there is no global auto-cleanup.

## Conventions

- The UI is an overlay: Live2D fills the stage, and controls float above it as glass chips
  (`rounded-full border-white/10 bg-slate-900/70 backdrop-blur`) and a bottom composer pill. New
  controls should join that language rather than introduce chrome like a full-width header bar.
- `@renderer` aliases `src/renderer/src` (declared in both `electron.vite.config.ts` and
  `vitest.config.ts` — add new aliases to both).
