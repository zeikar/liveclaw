import { useCallback, useEffect, useRef, useState } from 'react'
import { applyTTSSettings } from '../lib/charivo/session'

// Shown as the connection result when there is no OpenClaw token to check at all.
const NO_TOKEN_RESULT: SettingsTestResult = { ok: false, message: 'No OpenClaw token found' }

type UseSettingsResult = {
  view: SettingsView | null
  connection: SettingsTestResult | null
  isLoading: boolean
  loadError: string | null
  needsSetup: boolean
  reload: () => void
  handleSaved: (result: SettingsSaveResult) => void
}

export function useSettings(): UseSettingsResult {
  const [view, setView] = useState<SettingsView | null>(null)
  const [connection, setConnection] = useState<SettingsTestResult | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Sequences overlapping loads: only the newest request may write state or touch the TTS singleton.
  const latest = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++latest.current
    setIsLoading(true)
    try {
      const next = await window.api.getSettings()
      if (requestId !== latest.current) return

      const ttsConfig = await window.api.getTTSConfig()
      // applyTTSSettings is a side effect on the Charivo singleton, not a state write, so it must be
      // guarded like one: a superseded load must not detach and re-attach the TTS manager.
      if (requestId !== latest.current) return
      applyTTSSettings(ttsConfig)

      let nextConnection = NO_TOKEN_RESULT
      if (next.openClawSource !== 'none') {
        nextConnection = await window.api.testConnection('', '')
        if (requestId !== latest.current) return
      }

      setView(next)
      setConnection(nextConnection)
      setLoadError(null)
    } catch (err) {
      // Any stage failing (getTTSConfig is a file read too) lands here, so TTS is never left
      // half-configured with the chat showing.
      if (requestId !== latest.current) return
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      if (requestId === latest.current) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    return () => {
      // Bump the counter so an in-flight load applies nothing after unmount (StrictMode
      // double-mount). Mutating the ref itself is the intent — it is a request counter, not a DOM
      // node — so the ref-in-cleanup lint does not apply here.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      latest.current++
    }
  }, [load])

  const reload = useCallback(() => {
    load()
  }, [load])

  const handleSaved = useCallback(
    (result: SettingsSaveResult) => {
      setView(result.view)
      // Re-run the load so the TTS config and the connection check follow the new settings.
      load()
    },
    [load]
  )

  // Zero-config win: a detected token whose check passes leaves needsSetup false, so the user never
  // sees a setup screen.
  const needsSetup =
    !isLoading && !loadError && (!view || view.openClawSource === 'none' || connection?.ok !== true)

  return { view, connection, isLoading, loadError, needsSetup, reload, handleSaved }
}
