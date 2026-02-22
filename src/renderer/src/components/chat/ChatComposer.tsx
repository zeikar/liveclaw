type ChatComposerProps = {
  characterName: string
  input: string
  isLoading: boolean
  isBusy: boolean
  onInputChange: (value: string) => void
  onSend: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

export function ChatComposer({
  characterName,
  input,
  isLoading,
  isBusy,
  onInputChange,
  onSend,
  onKeyDown
}: ChatComposerProps): React.JSX.Element {
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
          disabled={isLoading}
        />
        <button
          className="h-10 rounded-xl bg-blue-500 px-4 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onSend}
          disabled={isBusy || !input.trim()}
        >
          Send
        </button>
      </div>
    </footer>
  )
}
