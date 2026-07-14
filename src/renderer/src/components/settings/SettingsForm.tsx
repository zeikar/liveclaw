import { useState } from 'react'
import { OPENAI_TTS_MODELS, OPENAI_TTS_VOICES, toModel, toVoice } from '../../config/tts'

type SettingsFormProps = {
  view: SettingsView
  connection: SettingsTestResult | null
  submitLabel: string
  onSaved: (result: SettingsSaveResult) => void
  onCancel?: () => void
  onSavingChange?: (saving: boolean) => void
}

// Tolerates an in-progress, unparseable URL (e.g. while the user is still typing) instead of
// throwing during render.
const safeOrigin = (url: string): string | null => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

const openClawStatusMessage = (view: SettingsView): string => {
  switch (view.openClawSource) {
    case 'openclaw-config':
      return `Using the token from ${view.openClawConfigPath}`
    case 'env':
      return 'Using OPENCLAW_TOKEN from your environment'
    case 'manual':
      return 'Using the token you entered here'
    case 'none':
      return 'No OpenClaw token found'
  }
}

const inputClass =
  'h-10 min-w-0 flex-1 rounded-xl border border-slate-300/20 bg-slate-900 px-4 text-sm text-slate-100 outline-none transition placeholder:text-slate-400 focus:border-blue-400 disabled:cursor-not-allowed disabled:opacity-60'

const secondaryButtonClass =
  'rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-40'

export function SettingsForm({
  view,
  connection,
  submitLabel,
  onSaved,
  onCancel,
  onSavingChange
}: SettingsFormProps): React.JSX.Element {
  const canToggleManualMode = view.openClawSource !== 'none'
  // Decision 8: a tokenless base-URL override must keep manual mode (and the field) visible, or an
  // unrelated save would submit { mode: 'auto' } and silently delete the override.
  const initialManualMode =
    view.openClawTokenSet || view.openClawBaseURL !== '' || view.openClawSource === 'none'

  const [manualMode, setManualMode] = useState(initialManualMode)
  const [token, setToken] = useState('')
  const [baseURL, setBaseURL] = useState(
    initialManualMode ? view.openClawBaseURL || view.openClawBaseURLResolved : ''
  )
  const [openaiKey, setOpenaiKey] = useState('')
  const [clearOpenAIKey, setClearOpenAIKey] = useState(false)
  const [ttsModel, setTtsModel] = useState(toModel(view.ttsModel))
  const [ttsVoice, setTtsVoice] = useState(toVoice(view.ttsVoice))
  const [testResult, setTestResult] = useState<SettingsTestResult | null>(connection)
  const [isTesting, setIsTesting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleManualModeChange = (checked: boolean): void => {
    setManualMode(checked)
    setTestResult(null)
    if (checked) {
      setBaseURL(view.openClawBaseURL || view.openClawBaseURLResolved)
    } else {
      setBaseURL('')
      setToken('')
    }
  }

  const targetOrigin = safeOrigin(manualMode ? baseURL : view.openClawBaseURLResolved)
  const hasImplicitToken =
    view.openClawTokenOrigin !== null && view.openClawTokenOrigin === targetOrigin
  // Mirrors main's one refusal: a manual save with no usable token is not allowed to submit.
  const requiresToken = manualMode && !hasImplicitToken && token.trim() === ''
  const foreignGateway = manualMode && targetOrigin !== view.openClawDetectedOrigin
  // A live success (from the connection prop or an in-form test) proves the endpoint is enabled
  // whatever the parsed config flag said.
  const showChatCompletionsWarning =
    view.chatCompletionsEnabled === false && testResult?.ok !== true

  const handleTestConnection = async (): Promise<void> => {
    setIsTesting(true)
    try {
      const result = await window.api.testConnection(token.trim(), manualMode ? baseURL.trim() : '')
      setTestResult(result)
    } finally {
      setIsTesting(false)
    }
  }

  const handleRemoveOpenAIKey = (): void => {
    setClearOpenAIKey(true)
    setOpenaiKey('')
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setSaveError(null)
    setIsSaving(true)
    onSavingChange?.(true)
    try {
      const openClaw: OpenClawInput = manualMode
        ? {
            mode: 'manual',
            baseURL: baseURL.trim(),
            token: token.trim() ? { action: 'set', value: token.trim() } : { action: 'keep' }
          }
        : { mode: 'auto' }
      const openaiApiKey: OpenAIKeyInput = clearOpenAIKey
        ? { action: 'clear' }
        : openaiKey.trim()
          ? { action: 'set', value: openaiKey.trim() }
          : { action: 'keep' }

      const result = await window.api.saveSettings({ openClaw, openaiApiKey, ttsModel, ttsVoice })
      onSaved(result)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSaving(false)
      onSavingChange?.(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/80 p-4 backdrop-blur"
    >
      <div className="space-y-1 text-sm text-slate-300">
        <p>{openClawStatusMessage(view)}</p>
        {view.openClawSource === 'none' && view.openClawDetectionError && (
          <p className="text-xs text-slate-400">{view.openClawDetectionError}</p>
        )}
        <p className="text-xs text-slate-400">Gateway: {view.openClawBaseURLResolved}</p>
      </div>

      {showChatCompletionsWarning && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          <p>The OpenClaw chat-completions endpoint looks disabled. Enable it with:</p>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-950/60 p-2 text-slate-100">
            <code>
              {'openclaw config set gateway.http.endpoints.chatCompletions.enabled true\n' +
                'openclaw gateway restart'}
            </code>
          </pre>
        </div>
      )}

      {canToggleManualMode && (
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm text-slate-200" htmlFor="manualMode">
            <input
              id="manualMode"
              type="checkbox"
              checked={manualMode}
              onChange={(e) => handleManualModeChange(e.target.checked)}
            />
            Enter an OpenClaw token or gateway URL manually
          </label>
          {!manualMode && <p className="text-xs text-slate-400">Use the auto-detected gateway.</p>}
        </div>
      )}

      {manualMode && (
        <div className="space-y-2">
          <div>
            <label htmlFor="openClawToken" className="mb-1 block text-sm text-slate-200">
              OpenClaw token
            </label>
            <input
              id="openClawToken"
              type="password"
              className={inputClass}
              value={token}
              placeholder={view.openClawTokenSet ? 'Saved - leave blank to keep' : ''}
              disabled={isTesting}
              onChange={(e) => {
                setToken(e.target.value)
                setTestResult(null)
              }}
            />
          </div>
          <div>
            <label htmlFor="openClawBaseURL" className="mb-1 block text-sm text-slate-200">
              OpenClaw base URL
            </label>
            <input
              id="openClawBaseURL"
              type="text"
              className={inputClass}
              value={baseURL}
              disabled={isTesting}
              onChange={(e) => {
                setBaseURL(e.target.value)
                setTestResult(null)
              }}
            />
          </div>
          {requiresToken && (
            <p className="text-xs text-amber-300">Enter the OpenClaw token for this gateway.</p>
          )}
          {foreignGateway && (
            <p className="text-xs text-amber-300">
              This is not the gateway detected in your OpenClaw config, so its own token is
              required.
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={isTesting || requiresToken}
              onClick={handleTestConnection}
            >
              Test connection
            </button>
            {testResult && (
              <span className={testResult.ok ? 'text-xs text-emerald-400' : 'text-xs text-red-400'}>
                {testResult.message}
              </span>
            )}
          </div>
        </div>
      )}

      <div>
        <label htmlFor="openaiApiKey" className="mb-1 block text-sm text-slate-200">
          OpenAI API key
        </label>
        <div className="flex items-center gap-2">
          <input
            id="openaiApiKey"
            type="password"
            className={inputClass}
            value={openaiKey}
            placeholder={view.openaiApiKeySource === 'stored' ? 'Saved - leave blank to keep' : ''}
            disabled={clearOpenAIKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
          />
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={view.openaiApiKeySource !== 'stored'}
            onClick={handleRemoveOpenAIKey}
          >
            Remove key
          </button>
        </div>
        {clearOpenAIKey && <p className="text-xs text-slate-400">The saved key will be removed</p>}
        {view.openaiApiKeySource === 'env' && (
          <p className="text-xs text-slate-400">
            Using the key from .env in development — change it there.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="ttsModel" className="mb-1 block text-sm text-slate-200">
            TTS model
          </label>
          <select
            id="ttsModel"
            className={inputClass}
            value={ttsModel}
            onChange={(e) => setTtsModel(toModel(e.target.value))}
          >
            {OPENAI_TTS_MODELS.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ttsVoice" className="mb-1 block text-sm text-slate-200">
            TTS voice
          </label>
          <select
            id="ttsVoice"
            className={inputClass}
            value={ttsVoice}
            onChange={(e) => setTtsVoice(toVoice(e.target.value))}
          >
            {OPENAI_TTS_VOICES.map((voice) => (
              <option key={voice} value={voice}>
                {voice}
              </option>
            ))}
          </select>
        </div>
      </div>

      {saveError && <p className="text-xs text-red-400">{saveError}</p>}

      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={isSaving}
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isSaving || isTesting || requiresToken}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
