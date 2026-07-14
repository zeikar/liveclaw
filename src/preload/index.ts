import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Expose custom APIs to the renderer via contextBridge
const api = {
  chat: (messages: Array<{ role: string; content: string }>) =>
    ipcRenderer.invoke('llm:chat', messages),
  newConversation: () => ipcRenderer.invoke('llm:newConversation'),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (input: SettingsInput) => ipcRenderer.invoke('settings:save', input),
  // An empty token means "use the implicit one, if it is bound to this origin".
  testConnection: (token: string, baseURL: string) =>
    ipcRenderer.invoke('settings:test', { token, baseURL }),
  getTTSConfig: () => ipcRenderer.invoke('tts:getConfig')
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
