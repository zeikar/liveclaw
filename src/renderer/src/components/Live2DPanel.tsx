import { APP_CHARACTER } from '../config/character'
import { useLive2DRenderer } from '../hooks/useLive2DRenderer'

export function Live2DPanel(): React.JSX.Element {
  const { stageRef, rendererError } = useLive2DRenderer()

  return (
    <section className="absolute inset-0">
      <div className="pointer-events-none absolute inset-0 bg-slate-950/40" />
      <div className="pointer-events-none absolute left-16 top-10 h-72 w-72 rounded-full bg-indigo-500/15 blur-3xl" />
      <div className="pointer-events-none absolute right-10 bottom-8 h-64 w-64 rounded-full bg-cyan-500/15 blur-3xl" />

      <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/70 px-3 py-1.5 backdrop-blur">
        <span className="text-xs font-bold text-slate-100">{APP_CHARACTER.name}</span>
      </div>

      <div ref={stageRef} className="absolute inset-0" />

      {rendererError && (
        <p className="absolute left-4 top-16 z-10 max-w-md rounded-lg border border-red-300/40 bg-red-900/70 px-3 py-2 text-xs text-red-100">
          {rendererError}
        </p>
      )}
    </section>
  )
}
