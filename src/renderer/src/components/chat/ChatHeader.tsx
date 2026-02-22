type ChatHeaderProps = {
  characterName: string
  isBusy: boolean
  onClear: () => void
}

export function ChatHeader({ characterName, isBusy, onClear }: ChatHeaderProps): React.JSX.Element {
  return (
    <header className="relative z-20 flex shrink-0 items-center justify-between border-b border-white/10 bg-slate-900/70 px-4 py-2 backdrop-blur [-webkit-app-region:drag]">
      <div className="flex flex-col">
        <span className="text-sm font-bold">LiveClaw</span>
        <span className="text-xs text-slate-300">{characterName} Companion</span>
      </div>

      <button
        className="rounded-full border border-white/10 bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 [-webkit-app-region:no-drag]"
        onClick={onClear}
        disabled={isBusy}
      >
        Clear
      </button>
    </header>
  )
}
