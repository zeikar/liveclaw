import { useRef, useState } from 'react'
import { Live2DPanel } from './components/Live2DPanel'
import { ChatComposer } from './components/chat/ChatComposer'
import { MessageList } from './components/chat/MessageList'
import { NewChatButton } from './components/chat/NewChatButton'
import { SettingsModal } from './components/settings/SettingsModal'
import { SetupScreen } from './components/settings/SetupScreen'
import { APP_CHARACTER } from './config/character'
import { useCharivo } from './hooks/useCharivo'
import { useSettings } from './hooks/useSettings'
import { useSTT } from './hooks/useSTT'

const chipClass =
  'rounded-full border border-white/10 bg-slate-900/70 px-3 py-1.5 text-xs font-bold text-slate-100 backdrop-blur transition hover:border-white/25 hover:bg-slate-800/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-40'

function App(): React.JSX.Element {
  const { view, connection, isLoading, loadError, needsSetup, reload, handleSaved } = useSettings()
  const {
    messages,
    isLoading: isReplyLoading,
    isBusy,
    error,
    sendMessage,
    clearHistory,
    clearLocalHistory
  } = useCharivo()
  const [input, setInput] = useState('')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  // Whether this recording has already written into the composer, which is what lets an empty final
  // tell "drop the stale interim text" apart from "leave a typed-but-unsent message alone".
  const partialsWroteInput = useRef(false)
  const {
    isRecording,
    isStarting,
    isTranscribing,
    error: sttError,
    toggle
  } = useSTT({
    // Snapshots are cumulative — each one is the full text so far — so they replace the input.
    // While recording the mic owns the field: a snapshot landing after the user edits overwrites
    // that edit.
    onPartial: (transcription) => {
      partialsWroteInput.current = true
      setInput(transcription)
    }
  })

  const sttEnabled = view?.openaiApiKeySource !== 'none'
  const sttActive = isRecording || isStarting || isTranscribing
  // Both a chat error and a fresh STT failure can be live at once; joining instead of `??` keeps
  // a new STT error from being hidden behind a stale chat error (or vice versa).
  const visibleError = [error, sttError].filter(Boolean).join(' · ') || null

  const handleSend = async (): Promise<void> => {
    const text = input.trim()
    // Recording/transcribing must resolve to a reviewable transcript before a turn can send.
    if (!text || sttActive) return
    setInput('')
    await sendMessage(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleToggleMic = async (): Promise<void> => {
    // Guarded on sttActive so a toggle the hook drops as reentrant cannot clear the flag
    // mid-session.
    if (!sttActive) partialsWroteInput.current = false
    const transcript = await toggle()
    // Partials replace the input live, the final transcript then overwrites them as the
    // authoritative text, and neither ever sends: pressing Send stays the user's move.
    // Nothing to write: a start, a drop, or a failure the error surface reports.
    if (transcript === null) return
    // An empty final drops the interim text this recording wrote, but must not wipe a message the
    // user typed before ever pressing the mic.
    if (transcript === '' && !partialsWroteInput.current) return
    setInput(transcript)
  }

  const handleSettingsSaved = (result: SettingsSaveResult): void => {
    handleSaved(result)
    setIsSettingsOpen(false)
    if (result.openClawChanged) {
      // The transcript goes because the session key rotated with the credentials. The disabled
      // composer + the isBusy chip gate are what make dropping it safe: no turn can be in flight.
      clearLocalHistory()
    }
  }

  const renderContent = (): React.JSX.Element => {
    // The chat UI, including the composer, does not exist in any branch but the last, which is what
    // makes the synchronous applyTTSSettings safe: no turn can start before settings have loaded.
    if (isLoading) {
      return <Live2DPanel />
    }

    if (loadError) {
      // Never fall through to chat: settings are unknown, TTS is unconfigured, and the modal has
      // nothing to bind to.
      return (
        <>
          <Live2DPanel />
          <div className="absolute inset-0 z-30 flex items-center justify-center p-4">
            <div className="w-full max-w-md space-y-3 rounded-2xl border border-white/10 bg-slate-900/80 p-4 text-center backdrop-blur">
              <p className="text-sm text-slate-200">{loadError}</p>
              <button
                type="button"
                className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-400"
                onClick={reload}
              >
                Retry
              </button>
            </div>
          </div>
        </>
      )
    }

    if (needsSetup) {
      return (
        <>
          <Live2DPanel />
          {view && (
            <SetupScreen
              view={view}
              connection={connection}
              onSaved={handleSettingsSaved}
              onRetry={reload}
            />
          )}
        </>
      )
    }

    return (
      <>
        <Live2DPanel />

        {/* inert while the modal is open: a covered composer is still keyboard-focusable, and Enter
            would start a userSay under a provider rotation. */}
        <div inert={isSettingsOpen}>
          <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
            <button
              className={chipClass}
              // A settings save re-runs applySTTSettings/detachSTT, which would orphan a live
              // recorder, so the chip stays closed for the whole recording lifecycle.
              disabled={isBusy || sttActive}
              onClick={() => {
                if (!isBusy && !sttActive) setIsSettingsOpen(true)
              }}
            >
              Settings
            </button>
            <NewChatButton
              isBusy={isBusy}
              hasMessages={messages.length > 0}
              onNewChat={clearHistory}
            />
          </div>

          {/* Deliberately unkeyed: a key derived from the message count would remount the whole
              list every turn, resetting useChatScroll's own new-message tracking to a first-mount
              jump and re-parsing every bubble's markdown from scratch. */}
          <MessageList messages={messages} isLoading={isReplyLoading} error={visibleError} />

          <ChatComposer
            characterName={APP_CHARACTER.name}
            input={input}
            isLoading={isReplyLoading}
            isBusy={isBusy}
            isDisabled={isSettingsOpen}
            sttEnabled={sttEnabled}
            isRecording={isRecording}
            isStarting={isStarting}
            isTranscribing={isTranscribing}
            onInputChange={setInput}
            onSend={handleSend}
            onKeyDown={handleKeyDown}
            onToggleMic={handleToggleMic}
          />
        </div>

        {isSettingsOpen && view && (
          <SettingsModal
            view={view}
            connection={connection}
            onClose={() => setIsSettingsOpen(false)}
            onSaved={handleSettingsSaved}
          />
        )}
      </>
    )
  }

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 top-0 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute -right-16 bottom-0 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" />
      </div>

      <main className="relative z-10 min-h-0 flex-1 overflow-hidden">{renderContent()}</main>
    </div>
  )
}

export default App
