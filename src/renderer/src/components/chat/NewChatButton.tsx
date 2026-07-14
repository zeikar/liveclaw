type NewChatButtonProps = {
  isBusy: boolean
  hasMessages: boolean
  onNewChat: () => void
}

/**
 * Mirrors the character name chip in Live2DPanel on the opposite corner - same glass token,
 * so the two read as one layer floating over the stage.
 */
export function NewChatButton({
  isBusy,
  hasMessages,
  onNewChat
}: NewChatButtonProps): React.JSX.Element {
  return (
    <button
      className="absolute right-4 top-4 z-20 rounded-full border border-white/10 bg-slate-900/70 px-3 py-1.5 text-xs font-bold text-slate-100 backdrop-blur transition hover:border-white/25 hover:bg-slate-800/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
      onClick={onNewChat}
      disabled={isBusy || !hasMessages}
    >
      New chat
    </button>
  )
}
