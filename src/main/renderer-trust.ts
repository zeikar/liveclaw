// The one place that decides what counts as "this app's own renderer" URL: the mic permission
// handlers and the privileged STT IPC must agree on that boundary, so they share these checks rather
// than each inventing one.

import { BrowserWindow } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'

export const RENDERER_ENTRY_PATH = join(__dirname, '../renderer/index.html')

// Trusts ONLY the exact renderer entry this app loads, mirroring the load branch in index.ts's
// createWindow — this must keep tracking the entry createWindow loads, or packaged STT silently
// breaks. Dev is deliberately wider: HMR gives the entry no stable URL, so every path on the dev
// server's origin is trusted; `is.dev` is what keeps that widening out of packaged builds.
export const isOwnRendererURL = (url: string): boolean => {
  try {
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      // Dev: renderer served over http(s); match the dev server's exact origin.
      return new URL(url).origin === new URL(process.env['ELECTRON_RENDERER_URL']).origin
    }
    return url === pathToFileURL(RENDERER_ENTRY_PATH).href
  } catch {
    return false
  }
}

// Authenticates the caller of a privileged IPC channel: the preload `api` is exposed to whatever
// document the window ends up holding, so a payload that parses proves nothing. Only this app's own
// renderer top-level frame, inside a real window, is trusted.
export const isTrustedRendererSender = (event: IpcMainInvokeEvent): boolean => {
  const frame = event.senderFrame
  // Null once the frame has navigated or been destroyed; either way there is nobody left to vouch
  // for. A document that navigated away and kept its frame is refused by the URL check below.
  if (!frame) return false
  if (frame.parent !== null) return false
  if (!isOwnRendererURL(frame.url)) return false
  // A webContents no window owns is a child view, not the renderer this app loads. This accepts any
  // BrowserWindow, where the permission handlers pin mainWindow.webContents — equivalent today,
  // since createWindow is the only construction site and setWindowOpenHandler denies every open.
  return BrowserWindow.fromWebContents(event.sender) !== null
}
