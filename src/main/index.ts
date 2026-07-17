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
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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

  ipcMain.handle('tts:getConfig', () => getTTSConfig())

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
