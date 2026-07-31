// The one place that decides which URLs may be handed to the OS. Both doors out of the app — the
// `app:openExternal` IPC and the window-open handler a middle-clicked link reaches (auxclick fires
// no React onClick, so the renderer's own preventDefault never runs) — go through it, so a scheme
// one refuses cannot be smuggled through the other.

const ALLOWED_PROTOCOLS = ['http:', 'https:', 'mailto:']

/** The URL to hand to `shell.openExternal`, or null when it must not be opened at all. */
export const toExternalURL = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null

  const trimmed = raw.trim()
  if (trimmed === '') return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) return null

  return parsed.toString()
}
