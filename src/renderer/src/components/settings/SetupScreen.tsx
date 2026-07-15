import { SettingsForm } from './SettingsForm'

type SetupScreenProps = {
  view: SettingsView
  connection: SettingsTestResult | null
  onSaved: (result: SettingsSaveResult) => void
  onRetry: () => void
}

export function SetupScreen({
  view,
  connection,
  onSaved,
  onRetry
}: SetupScreenProps): React.JSX.Element {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-100">Connect LiveClaw to OpenClaw</h1>
          <button
            type="button"
            className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-white/25"
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
        <SettingsForm
          view={view}
          connection={connection}
          submitLabel="Get started"
          onSaved={onSaved}
        />
      </div>
    </div>
  )
}
