import { useEffect, useRef, useState } from 'react'
import { SettingsForm } from './SettingsForm'

type SettingsModalProps = {
  view: SettingsView
  connection: SettingsTestResult | null
  onClose: () => void
  onSaved: (result: SettingsSaveResult) => void
}

export function SettingsModal({
  view,
  connection,
  onClose,
  onSaved
}: SettingsModalProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  // Fed by the form's onSavingChange. Closing mid-save would lift inert and re-enable the composer
  // while main is still writing the file and possibly nulling the provider — the race decision 12
  // forbids. So every dismissal path is a no-op while a save is in flight.
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    // Move focus into the panel so a visual backdrop is not the only thing stopping Tab.
    panelRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !isSaving) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isSaving, onClose])

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!isSaving) onClose()
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full max-w-lg outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <SettingsForm
          view={view}
          connection={connection}
          submitLabel="Save"
          onSaved={onSaved}
          onCancel={() => {
            if (!isSaving) onClose()
          }}
          onSavingChange={setIsSaving}
        />
      </div>
    </div>
  )
}
