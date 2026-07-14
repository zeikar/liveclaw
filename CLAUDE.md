# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # electron-vite dev (Electron + renderer HMR)
npm run build            # typecheck + electron-vite build
npm test                 # vitest run
npm run lint             # eslint (cached)
npm run typecheck        # tsc for node (main/preload) and web (renderer) projects separately
npm run format           # prettier --write .
```

Run a single test file or case:

```bash
npx vitest run src/renderer/src/hooks/useCharivo.test.ts
npx vitest run -t 'rotates the OpenClaw session'
```

CI (`.github/workflows/ci.yml`) runs lint → typecheck → test → `electron-vite build`. Match that
before pushing.

## Architecture

An Electron desktop AI companion: a Live2D character you chat with. The
[Charivo](https://github.com/zeikar/charivo) framework (`@charivo/*`, a sibling repo by the same
author) orchestrates the character session; this repo is the Electron shell around it.

### Two deliberate, asymmetric paths

Chat and speech reach their providers by different routes, and that asymmetry is intentional:

- **Chat goes through IPC to the main process.** `renderer → window.api.chat → ipcMain 'llm:chat' →
@charivo/server/openclaw → OpenClaw gateway`. It runs in Node to avoid renderer CORS/PNA limits,
  and to keep the OpenClaw token out of the renderer — that token is an **operator-grade credential**
  for the gateway, not a scoped API key.
- **TTS is called directly from the renderer** (`@charivo/tts/openai`, `dangerouslyAllowBrowser`).
  This exposes the OpenAI key to the renderer and is accepted for local/dev use only.

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
  Rotation happens in exactly two places: the `llm:newConversation` IPC (New chat) and window
  re-create — on macOS the main process outlives its windows.
- `clearHistory` rotates **before** clearing local history, never after.
- Do not send `x-openclaw-agent-id`; it 400s on gateways whose agent is not named `main`.
- The agent's long-term memory survives rotation. "New chat" not wiping the character's memory is
  expected, not a bug to fix here.

Provider changes (session handling, agent routing, model target) belong upstream in the `charivo`
repo's `packages/server/src/openclaw/`, not patched around here.

## Testing

Vitest is configured for the **renderer only** (`src/renderer/src/**/*.test.{ts,tsx}`, jsdom). The main
and preload processes have no test setup.

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
