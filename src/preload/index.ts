import { contextBridge, ipcRenderer } from 'electron'

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
  getTTSConfig: () => ipcRenderer.invoke('tts:getConfig'),
  bootstrapRealtimeSTT: (request: RealtimeSTTBootstrapRequest) =>
    ipcRenderer.invoke('stt:bootstrapRealtime', request)
}

// Only the `api` object above is exposed. @electron-toolkit/preload's `electronAPI` is deliberately
// NOT bridged: it carries a generic `ipcRenderer.invoke(channel, ...args)`, which would let any
// document in this window call any main handler by name — including `tts:getConfig`, which returns
// the standing OpenAI key in the clear. Authenticating individual channels cannot close that, since
// the generic invoke bypasses this object entirely. Nothing in the renderer used it.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
