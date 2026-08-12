import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getCharivoInstance } from '../lib/charivo/session'

type UseSTTOptions = {
  // Receives every interim snapshot. Deliberately not mirrored into this hook's state: the composer
  // input owns that text, and a second copy here would fight the user's edits.
  onPartial?: (transcription: string) => void
}

type UseSTTResult = {
  isRecording: boolean
  isStarting: boolean
  isTranscribing: boolean
  error: string | null
  toggle: () => Promise<string | null>
}

export function useSTT(options: UseSTTOptions = {}): UseSTTResult {
  const [isRecording, setIsRecording] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // `sessionOpen` below is only assigned after `await manager.start()` resolves, and React state
  // updates asynchronously too, so neither is set yet at the entry of a second toggle. This ref is
  // therefore checked-and-set synchronously before any await to drop a reentrant overlapping
  // toggle — mirroring useSettings' `latest` ref sequencing.
  const busy = useRef(false)
  // The session the UI believes is open. The manager's own flag cannot drive the branch anymore: a
  // streaming session that failed mid-recording reports isRecording() === false while still holding
  // its terminal error, and only stop() rethrows that error. Branching on the manager would take
  // the start arm on the user's Stop press, clearing the error and opening a second session behind
  // the user's back. Keeping our own isRecording true through that failure is load-bearing, not an
  // oversight: it holds App's `sttActive` gate on the Settings chip, so applySTTSettings' detachSTT
  // cannot orphan the failed session before the user presses Stop.
  const sessionOpen = useRef(false)

  const onPartialRef = useRef(options.onPartial)
  // Layout effect, not a passive one: passive effects flush in a scheduler task after commit, and a
  // data-channel message landing in that window would reach the previous render's callback.
  useLayoutEffect(() => {
    onPartialRef.current = options.onPartial
  })

  useEffect(() => {
    const charivo = getCharivoInstance()
    // One stable listener reading through the ref: subscribes once instead of per render, and
    // still never calls a stale callback.
    const listener = ({ text }: { text: string }): void => {
      onPartialRef.current?.(text)
    }
    charivo.on('stt:partial', listener)
    return () => charivo.off('stt:partial', listener)
  }, [])

  const toggle = useCallback(async () => {
    const manager = getCharivoInstance().getSTTManager()
    if (!manager) return null
    if (busy.current) return null
    busy.current = true

    try {
      if (!sessionOpen.current) {
        setError(null)
        setIsStarting(true)
        try {
          await manager.start()
          sessionOpen.current = true
          setIsRecording(true)
          // Returns null because the transcript only exists after stop(); permission/getUserMedia
          // denial is a realistic I/O failure surfaced via error instead.
          return null
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
          return null
        } finally {
          setIsStarting(false)
        }
      }

      // Cleared while taking the stop arm, not after it resolves, so a failed stop cannot leave the
      // hook stuck believing a session is still open.
      sessionOpen.current = false
      setIsRecording(false)
      setIsTranscribing(true)
      try {
        return await manager.stop()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return null
      } finally {
        setIsTranscribing(false)
      }
    } finally {
      busy.current = false
    }
  }, [])

  return { isRecording, isStarting, isTranscribing, error, toggle }
}
