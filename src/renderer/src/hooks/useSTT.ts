import { useCallback, useRef, useState } from 'react'
import { getCharivoInstance } from '../lib/charivo/session'

type UseSTTResult = {
  isRecording: boolean
  isStarting: boolean
  isTranscribing: boolean
  error: string | null
  toggle: () => Promise<string | null>
}

export function useSTT(): UseSTTResult {
  const [isRecording, setIsRecording] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // React state (isStarting/isTranscribing) and the manager's own recording flag (which only
  // flips after getUserMedia resolves) both update asynchronously, so this ref is checked-and-set
  // synchronously before any await to drop a reentrant overlapping toggle — mirroring useSettings'
  // `latest` ref sequencing.
  const busy = useRef(false)

  const toggle = useCallback(async () => {
    const manager = getCharivoInstance().getSTTManager()
    if (!manager) return null
    if (busy.current) return null
    busy.current = true

    try {
      // Branch on the manager's live state, not React state, so the correct arm is chosen even
      // under a race (e.g. a stale closure from a rapid double toggle); the busy ref above is what
      // actually guards against a reentrant overlapping toggle.
      if (!manager.isRecording()) {
        setError(null)
        setIsStarting(true)
        try {
          await manager.start()
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
