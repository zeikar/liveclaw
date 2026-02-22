# LiveClaw

OpenClaw-powered desktop AI companion with Live2D avatars, voice input, and speech synthesis.

> **Work in progress** - actively under development. Contributions and feedback are welcome.

Built with **Electron + React + TypeScript** and the [Charivo](https://github.com/zeikar/charivo) framework.

## Tech Stack

- **Electron** - Desktop app shell
- **React + TypeScript** - Renderer UI
- **electron-vite** - Build tooling
- **Live2D** (`@charivo/render-live2d`, `@charivo/render-core`) - Character model rendering and motion playback
- **Charivo** (`@charivo/core`, `@charivo/llm-core`, `@charivo/tts-core`) - Character session orchestration (LLM/TTS/Renderer)
- **[OpenClaw](https://openclaw.ai/)** (`@charivo/llm-provider-openclaw`) - Local LLM backend for chat
- **OpenAI TTS** (`@charivo/tts-player-openai`) - Direct renderer-side speech synthesis for local use

## Architecture

```txt
[Renderer - React]
  useCharivo + Live2DPanel/useLive2DRenderer
       |
       | Charivo events
       v
[Renderer - Live2D]
  @charivo/render-live2d
       |
       | IPC (window.api.chat)
       v
[Main Process - Node.js]
  @charivo/llm-provider-openclaw
       |
       | HTTP (OpenAI-compatible)
       v
[OpenClaw - localhost:18789]
```

```txt
[Renderer - React]
  @charivo/tts-player-openai
       |
       | HTTPS
       v
[OpenAI Audio API]
```

OpenClaw API calls are handled in the Electron **main process (Node.js)** to avoid renderer CORS/PNA limits.
TTS is intentionally direct from the renderer for local development convenience.

## Live2D Integration

Live2D is already integrated through Charivo renderer attachment.

- Live2D renderer hook: `src/renderer/src/hooks/useLive2DRenderer.ts`
- Live2D panel component: `src/renderer/src/components/Live2DPanel.tsx`
- Model path config: `src/renderer/src/config/live2d.ts`

`charivo.attachRenderer(manager)` and `charivo.setCharacter(APP_CHARACTER)` are already wired in the renderer lifecycle.

## Prerequisites

- [OpenClaw](https://openclaw.ai/) installed and running (default: `http://127.0.0.1:18789`)
- OpenAI API key for TTS
- Node.js and npm

## Configuration

### 1. OpenClaw chat provider

OpenClaw token and connection settings are defined at the top of `src/main/index.ts`:

```ts
const llmProvider = createOpenClawLLMProvider({
  token: 'YOUR_OPENCLAW_TOKEN',
  baseURL: 'http://127.0.0.1:18789/v1' // default
})
```

### 2. Direct OpenAI TTS

Create `.env` in the project root:

```bash
VITE_OPENAI_API_KEY=your_openai_api_key
VITE_OPENAI_TTS_MODEL=gpt-4o-mini-tts
VITE_OPENAI_TTS_VOICE=marin
```

Supported models: `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`

Supported voices: `alloy`, `echo`, `fable`, `marin`, `onyx`, `nova`, `shimmer`

If `VITE_OPENAI_API_KEY` is not set, TTS is disabled and chat still works.

### 3. Character profile

Character profile can be changed in `src/renderer/src/config/character.ts`.

## Security Note

Direct renderer-side OpenAI usage exposes the API key to the local client runtime.
Use this setup only for trusted local/dev environments.

## Roadmap

- [x] OpenClaw LLM integration via IPC
- [x] Chat UI (message history, error handling)
- [x] Live2D rendering integration (`@charivo/render-live2d`)
- [x] Direct OpenAI TTS integration (`@charivo/tts-player-openai`)
- [ ] Speech-to-text (`@charivo/stt-core`)
- [ ] WebSocket support for real-time streaming responses

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Type Check

```bash
$ npm run typecheck
```

### Build

```bash
# For Windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
