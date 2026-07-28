import { app, shell, BrowserWindow, ipcMain } from 'electron'
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
import { RENDERER_ENTRY_PATH, isOwnRendererURL, isTrustedRendererSender } from './renderer-trust'

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
    sessionKey: `liveclaw:${randomUUID()}`
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
    shell.openExternal(details.url)
    return { action: 'deny' }
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

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // IPC handler: renderer sends messages, main process calls OpenClaw (no CORS in Node.js)
  ipcMain.handle('llm:chat', async (_, messages: Array<{ role: string; content: string }>) => {
    return await getLLMProvider().generateResponse(messages)
  })

  // Clearing the chat has to rotate the session key too, otherwise OpenClaw keeps replying
  // from the transcript the user just cleared. Deferred: the next chat call constructs the
  // replacement provider.
  ipcMain.handle('llm:newConversation', () => {
    llmProvider = null
  })

  ipcMain.handle('settings:get', () => getSettingsView())

  ipcMain.handle('settings:save', (_, raw: unknown) => {
    const result = saveSettings(raw)
    // Third session-key rotation point: an OpenClaw token/baseURL change must not keep talking to
    // the old (or a now-stale) session, so drop the provider and let the next chat rebuild it.
    if (result.openClawChanged) llmProvider = null
    return result
  })

  ipcMain.handle('settings:test', (_, raw: unknown) => testOpenClawConnection(raw))

  // This hands the standing OpenAI key to the caller — TTS runs in the renderer and needs it (see
  // the security note in README). That makes the sender check the whole boundary: the key goes to
  // this app's own renderer main frame or nowhere.
  ipcMain.handle('tts:getConfig', (event): TTSConfig => {
    if (!isTrustedRendererSender(event)) {
      throw new Error('TTS configuration is only available to the LiveClaw renderer.')
    }
    return getTTSConfig()
  })

  // Realtime STT bootstraps here, not in the renderer, for two reasons: minting an ephemeral secret
  // is a billable call on the standing OpenAI key, so the sender is authenticated before the key is
  // read or any request goes out; and only the SDP answer, never that key, goes back on this path.
  // TTS still takes the key into the renderer — the accepted local/dev-only posture — but both
  // channels now gate on the same sender check. A document that navigated off the renderer entry is
  // refused here; a `will-navigate` guard would be a separate, broader change.
  ipcMain.handle(
    'stt:bootstrapRealtime',
    async (event, payload: unknown): Promise<RealtimeSTTBootstrapResult> => {
      if (!isTrustedRendererSender(event)) {
        throw new Error('Realtime transcription is only available to the LiveClaw renderer.')
      }
      return await bootstrapRealtimeTranscription(getTTSConfig().openaiApiKey, payload)
    }
  )

  ipcMain.handle('app:openExternal', async (_, rawUrl: string) => {
    const url = rawUrl?.trim()
    if (!url) return

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return
    }

    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      return
    }

    await shell.openExternal(parsed.toString())
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
