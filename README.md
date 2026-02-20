# LiveClaw

An OpenClaw desktop assistant with Live2D avatars, integrating speech recognition (STT) and speech synthesis (TTS).

Built with **Electron + React + TypeScript** and the [Charivo](https://github.com/zeikar/charivo) framework.

## Tech Stack

- **Electron** - Desktop app shell
- **React + TypeScript** - Renderer UI
- **electron-vite** - Build tooling
- **Charivo** (`@charivo/core`, `@charivo/llm-core`) - LLM session & character management
- **OpenClaw** - Local AI agent backend (OpenAI-compatible API)

## Architecture

```
[Renderer - React]
  useCharivo hook
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

OpenClaw API calls are handled in the Electron **main process (Node.js)**.
Direct `fetch` from the renderer (Chromium) is blocked by CORS and Private Network Access policies, so an IPC bridge is used instead.

## Prerequisites

- [OpenClaw](https://openclaw.ai) installed and running (default port: `18789`)

## Configuration

OpenClaw token and connection settings are defined at the top of `src/main/index.ts`:

```ts
const llmProvider = createOpenClawLLMProvider({
  token: 'YOUR_OPENCLAW_TOKEN',
  baseURL: 'http://127.0.0.1:18789/v1' // default
})
```

Character name and personality can be changed in `src/renderer/src/hooks/useCharivo.ts`:

```ts
charivo.setCharacter({
  id: 'assistant',
  name: 'Assistant',
  personality: 'You are a helpful and friendly desktop AI assistant.'
})
```

## Roadmap

- [x] OpenClaw LLM integration via IPC
- [x] Chat UI (message history, error handling)
- [ ] Live2D avatar rendering (`@charivo/render-live2d`)
- [ ] Text-to-speech (`@charivo/tts-core`)
- [ ] Speech-to-text (`@charivo/stt-core`)

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

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
