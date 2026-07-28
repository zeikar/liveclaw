// Keeps this file a module so `declare global` augments Window instead of redeclaring it. It used
// to get that from the `@electron-toolkit/preload` import; dropping that import made the file a
// global script and silently disabled the augmentation. (The opposite of `src/shared/*.d.ts`, which
// must stay global scripts.)
export {}

declare global {
  interface Window {
    api: {
      chat: (messages: Array<{ role: string; content: string }>) => Promise<string>
      newConversation: () => Promise<void>
      openExternal: (url: string) => Promise<void>
      getSettings: () => Promise<SettingsView>
      saveSettings: (input: SettingsInput) => Promise<SettingsSaveResult>
      testConnection: (token: string, baseURL: string) => Promise<SettingsTestResult>
      getTTSConfig: () => Promise<TTSConfig>
      bootstrapRealtimeSTT: (
        request: RealtimeSTTBootstrapRequest
      ) => Promise<RealtimeSTTBootstrapResult>
    }
  }
}
