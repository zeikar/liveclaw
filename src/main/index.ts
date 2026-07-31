import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { createOpenClawLLMProvider } from '@charivo/server/openclaw'
// Only loads a cwd .env in development; the real gate on env fallback is `!app.isPackaged` in
// settings.ts, not whether this loaded anything.
import 'dotenv/config'
import {
  getEffectiveOpenClaw,
  getSettingsView,
  getTTSConfig,
  saveSettings,
  testOpenClawConnection
} from './settings'
import { bootstrapRealtimeTranscription } from './realtime-stt'
import { RENDERER_ENTRY_PATH, handleTrusted, isOwnRendererURL } from './renderer-trust'
import { toExternalURL } from './external-url'

// OpenClaw is called from the main process (Node.js) to avoid CORS restrictions in the renderer.
// The session key pins the conversation to one OpenClaw session; without it the gateway opens a
// fresh session per request and nothing carries over between turns. It is fixed at construction,
// so starting a new conversation means a new provider. Token/baseURL are read from settings.ts at
// call time so a token rotated inside OpenClaw is picked up at the next construction, and so the
// origin rule (decision 2) is applied at the only place the provider is built.
const createLLMProvider = (): ReturnType<typeof createOpenClawLLMProvider> => {
  const { token, baseURL } = getEffectiveOpenClaw()
  if (!token) {
    console.warn(
      '[OpenClaw] No OpenClaw token is configured. If your OpenClaw instance requires auth, requests will fail.'
    )
  }
  return createOpenClawLLMProvider({
    token,
    baseURL,
    sessionKey: `liveclaw:${randomUUID()}`,
    // The provider's own default is 1000, which cuts a longer reply off mid-sentence. Reply length
    // is the character prompt's job; this is only the ceiling that stops a truncated one.
    maxTokens: 4000
  })
}

let llmProvider: ReturnType<typeof createLLMProvider> | null = null
const getLLMProvider = (): ReturnType<typeof createLLMProvider> =>
  (llmProvider ??= createLLMProvider())

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Renderer getUserMedia for STT needs main to approve the 'media' permission. Scoped to
  // audio-only, this exact main-window renderer, on its own entry URL: camera, any other
  // webContents, non-main frames, and a navigated-away window are all denied.
  mainWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      if (webContents !== mainWindow.webContents || permission !== 'media') {
        callback(false)
        return
      }

      const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined
      const isAudioOnly =
        Array.isArray(mediaTypes) && mediaTypes.length === 1 && mediaTypes[0] === 'audio'

      callback(
        isAudioOnly &&
          details.isMainFrame === true &&
          !!details.requestingUrl &&
          isOwnRendererURL(details.requestingUrl)
      )
    }
  )

  // Electron consults this ahead of (and separately from) the request handler above, e.g. for
  // navigator.permissions.query pre-checks, so it must enforce the same audio-only + own-renderer
  // scope or it becomes a bypass of the request handler's restrictions.
  mainWindow.webContents.session.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => {
      if (webContents !== mainWindow.webContents || permission !== 'media') return false
      if (details.mediaType !== 'audio' || details.isMainFrame !== true) return false
      if (!requestingOrigin) return false

      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        try {
          return requestingOrigin === new URL(process.env['ELECTRON_RENDERER_URL']).origin
        } catch {
          return false
        }
      }

      // Packaged: a file: page's origin isn't distinguishing, so require the exact renderer entry.
      return isOwnRendererURL(webContents.getURL())
    }
  )

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Same validation as the app:openExternal IPC: a middle-clicked markdown link arrives here
    // rather than through the renderer's own handler, and must not be a wider door than that one.
    const url = toExternalURL(details.url)
    if (url) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // The preload `api` belongs to whatever document the window ends up holding, so a top frame that
  // navigated away would keep every IPC channel. Nothing in this app navigates anywhere but its own
  // entry — links open in the browser instead — so everything else is refused here. This is what the
  // per-channel sender checks are the second line of defence for.
  mainWindow.webContents.on('will-frame-navigate', (details) => {
    if (!isOwnRendererURL(details.url)) {
      console.warn('[navigation] refused a navigation away from the renderer entry:', details.url)
      details.preventDefault()
    }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(RENDERER_ENTRY_PATH)
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Dev-only: point userData at a throwaway profile so Task 5's checks never touch the developer's
  // real credentials. Must run before anything reads settings (settings.ts resolves config.json
  // from app.getPath('userData')).
  if (!app.isPackaged && process.env.LIVECLAW_USER_DATA_DIR) {
    app.setPath('userData', process.env.LIVECLAW_USER_DATA_DIR)
    console.info('[userData]', app.getPath('userData'))
  }

  // Set app user model id for windows
  electronApp.setAppUserModelId('dev.zeikar.liveclaw')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Every channel below is registered through handleTrusted, so each one authenticates its sender
  // before doing anything: the operator-grade gateway behind llm:chat and the gateway settings
  // behind settings:save are worth the same check as the key behind tts:getConfig.

  // Renderer sends messages, main process calls OpenClaw (no CORS in Node.js).
  handleTrusted('llm:chat', async (_, messages: Array<{ role: string; content: string }>) => {
    return await getLLMProvider().generateResponse(messages)
  })

  // Clearing the chat has to rotate the session key too, otherwise OpenClaw keeps replying
  // from the transcript the user just cleared. Deferred: the next chat call constructs the
  // replacement provider.
  handleTrusted('llm:newConversation', () => {
    llmProvider = null
  })

  handleTrusted('settings:get', () => getSettingsView())

  handleTrusted('settings:save', (_, raw: unknown) => {
    const result = saveSettings(raw)
    // Third session-key rotation point: an OpenClaw token/baseURL change must not keep talking to
    // the old (or a now-stale) session, so drop the provider and let the next chat rebuild it.
    if (result.openClawChanged) llmProvider = null
    return result
  })

  handleTrusted('settings:test', (_, raw: unknown) => testOpenClawConnection(raw))

  // This hands the standing OpenAI key to the caller — TTS runs in the renderer and needs it (see
  // the security note in README). That makes the sender check the whole boundary: the key goes to
  // this app's own renderer main frame or nowhere.
  handleTrusted('tts:getConfig', (): TTSConfig => getTTSConfig())

  // Realtime STT bootstraps here, not in the renderer, for two reasons: minting an ephemeral secret
  // is a billable call on the standing OpenAI key, so the sender is authenticated before the key is
  // read or any request goes out; and only the SDP answer, never that key, goes back on this path.
  // TTS still takes the key into the renderer — the accepted local/dev-only posture.
  handleTrusted(
    'stt:bootstrapRealtime',
    async (_, payload: unknown): Promise<RealtimeSTTBootstrapResult> =>
      await bootstrapRealtimeTranscription(getTTSConfig().openaiApiKey, payload)
  )

  handleTrusted('app:openExternal', async (_, rawUrl: unknown) => {
    const url = toExternalURL(rawUrl)
    if (!url) return
    await shell.openExternal(url)
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      // The main process survived the window close, so the old session key is still loaded.
      // The new window starts with an empty chat and would otherwise get replies drawn from a
      // conversation the user can no longer see. Deferred: the next chat call rebuilds it.
      llmProvider = null
      createWindow()
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
