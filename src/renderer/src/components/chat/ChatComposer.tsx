type ChatComposerProps = {
  characterName: string
  input: string
  isLoading: boolean
  isBusy: boolean
  isDisabled?: boolean
  sttEnabled: boolean
  isRecording: boolean
  isStarting: boolean
  isTranscribing: boolean
  onInputChange: (value: string) => void
  onSend: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onToggleMic: () => void
}

export function ChatComposer({
  characterName,
  input,
  isLoading,
  isBusy,
  isDisabled = false,
  sttEnabled,
  isRecording,
  isStarting,
  isTranscribing,
  onInputChange,
  onSend,
  onKeyDown,
  onToggleMic
}: ChatComposerProps): React.JSX.Element {
  // Recording must stay stoppable even if isBusy/isDisabled flips mid-recording; only the
  // not-yet-recording (start) path is gated by the other busy flags.
  const micDisabled = !isRecording && (isBusy || isDisabled || isStarting || isTranscribing)
  const sttActive = isRecording || isStarting || isTranscribing

  return (
    <footer className="absolute inset-x-0 bottom-3 z-20 px-3 sm:px-4">
      <div className="mx-auto flex w-full max-w-4xl items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/80 p-2 backdrop-blur">
        <input
          className="h-10 min-w-0 flex-1 rounded-xl border border-slate-300/20 bg-slate-900 px-4 text-sm text-slate-100 outline-none transition placeholder:text-slate-400 focus:border-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
          type="text"
          placeholder={`Talk to ${characterName}...`}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={isLoading || isDisabled}
        />
        {sttEnabled && (
          <button
            type="button"
            className={`h-10 rounded-xl px-3 transition disabled:cursor-not-allowed disabled:opacity-50 ${
              isRecording
                ? 'animate-pulse bg-red-500 text-white hover:bg-red-400'
                : 'border border-white/10 bg-slate-900 text-slate-100 hover:border-white/25 hover:bg-slate-800/80'
            }`}
            aria-label={isRecording ? 'Stop recording' : 'Start recording'}
            onClick={onToggleMic}
            disabled={micDisabled}
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
        )}
        <button
          className="h-10 rounded-xl bg-blue-500 px-4 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onSend}
          disabled={isBusy || isDisabled || sttActive || !input.trim()}
        >
          Send
        </button>
      </div>
    </footer>
  )
}
