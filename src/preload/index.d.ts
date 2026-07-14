import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      chat: (messages: Array<{ role: string; content: string }>) => Promise<string>
      newConversation: () => Promise<void>
      openExternal: (url: string) => Promise<void>
      getSettings: () => Promise<SettingsView>
      saveSettings: (input: SettingsInput) => Promise<SettingsSaveResult>
      testConnection: (token: string, baseURL: string) => Promise<SettingsTestResult>
      getTTSConfig: () => Promise<TTSConfig>
    }
  }
}
