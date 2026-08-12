import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSTT } from './useSTT'

type FakeSTTManager = {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  isRecording: ReturnType<typeof vi.fn>
}

type PartialListener = (data: { text: string }) => void

type FakeCharivo = {
  getSTTManager: () => FakeSTTManager | undefined
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
}

let fakeManager: FakeSTTManager | undefined
let fakeCharivo: FakeCharivo
let partialListener: PartialListener | undefined

vi.mock('../lib/charivo/session', () => ({
  getCharivoInstance: () => fakeCharivo
}))

beforeEach(() => {
  fakeManager = {
    start: vi.fn(),
    stop: vi.fn(),
    isRecording: vi.fn().mockReturnValue(false)
  }
  partialListener = undefined
  // One stable instance per test, so the hook's subscribe/unsubscribe effect sees the same object
  // across renders exactly like the real module-level singleton.
  fakeCharivo = {
    getSTTManager: () => fakeManager,
    on: vi.fn((event: string, listener: PartialListener) => {
      if (event === 'stt:partial') partialListener = listener
    }),
    off: vi.fn()
  }
})

afterEach(cleanup)

describe('useSTT', () => {
  it('starts recording on the first toggle', async () => {
    fakeManager!.start.mockResolvedValue(undefined)
    const { result } = renderHook(() => useSTT())

    let returned: string | null = null
    await act(async () => {
      returned = await result.current.toggle()
    })

    expect(fakeManager!.start).toHaveBeenCalledTimes(1)
    expect(result.current.isRecording).toBe(true)
    expect(returned).toBeNull()
  })

  it('stops recording and returns the transcript', async () => {
    fakeManager!.start.mockResolvedValue(undefined)
    fakeManager!.stop.mockResolvedValue('hello world')
    const { result } = renderHook(() => useSTT())

    await act(async () => {
      await result.current.toggle()
    })

    let returned: string | null = null
    await act(async () => {
      returned = await result.current.toggle()
    })

    expect(fakeManager!.stop).toHaveBeenCalledTimes(1)
    expect(returned).toBe('hello world')
    expect(result.current.isTranscribing).toBe(false)
  })

  it('resolves null without throwing when there is no manager', async () => {
    fakeManager = undefined
    const { result } = renderHook(() => useSTT())

    let returned: string | null = null
    await act(async () => {
      returned = await result.current.toggle()
    })

    expect(returned).toBeNull()
  })

  it('surfaces a start() failure via error and clears isStarting', async () => {
    fakeManager!.start.mockRejectedValue(new Error('mic denied'))
    const { result } = renderHook(() => useSTT())

    let returned: string | null = null
    await act(async () => {
      returned = await result.current.toggle()
    })

    expect(returned).toBeNull()
    expect(result.current.error).toBe('mic denied')
    expect(result.current.isStarting).toBe(false)
  })

  it('surfaces a stop() failure via error and clears isTranscribing', async () => {
    fakeManager!.start.mockResolvedValue(undefined)
    fakeManager!.stop.mockRejectedValue(new Error('transcription failed'))
    const { result } = renderHook(() => useSTT())

    await act(async () => {
      await result.current.toggle()
    })

    let returned: string | null = null
    await act(async () => {
      returned = await result.current.toggle()
    })

    expect(returned).toBeNull()
    expect(result.current.error).toBe('transcription failed')
    expect(result.current.isTranscribing).toBe(false)
  })

  it('drops a reentrant overlapping toggle while start() is still pending', async () => {
    let resolveStart: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      resolveStart = resolve
    })
    fakeManager!.start.mockReturnValue(pending)
    const { result } = renderHook(() => useSTT())

    await act(async () => {
      const first = result.current.toggle()
      const second = result.current.toggle()
      resolveStart!()
      await Promise.all([first, second])
    })

    expect(fakeManager!.start).toHaveBeenCalledTimes(1)
  })

  it('stops instead of restarting when the stream failed mid-recording', async () => {
    fakeManager!.start.mockResolvedValue(undefined)
    const { result } = renderHook(() => useSTT())

    await act(async () => {
      await result.current.toggle()
    })
    expect(result.current.isRecording).toBe(true)

    // What the realtime transcriber looks like after failTerminal()/cleanup(): no longer recording
    // (the beforeEach default), but still holding the terminal error that only stop() rethrows.
    expect(fakeManager!.isRecording).not.toHaveBeenCalled()
    fakeManager!.stop.mockRejectedValue(new Error('data channel closed'))

    let returned: string | null = null
    await act(async () => {
      returned = await result.current.toggle()
    })

    expect(fakeManager!.stop).toHaveBeenCalledTimes(1)
    expect(fakeManager!.start).toHaveBeenCalledTimes(1)
    expect(returned).toBeNull()
    expect(result.current.error).toBe('data channel closed')
    expect(result.current.isRecording).toBe(false)
  })

  it('starts a new session on the press after a stop() failure', async () => {
    fakeManager!.start.mockResolvedValue(undefined)
    fakeManager!.stop.mockRejectedValue(new Error('transcription failed'))
    const { result } = renderHook(() => useSTT())

    await act(async () => {
      await result.current.toggle()
    })
    await act(async () => {
      await result.current.toggle()
    })

    // The rejected stop must not leave the hook believing a session is still open, or this third
    // press takes the stop arm again and the user loses it.
    await act(async () => {
      await result.current.toggle()
    })

    expect(fakeManager!.start).toHaveBeenCalledTimes(2)
    expect(fakeManager!.stop).toHaveBeenCalledTimes(1)
    expect(result.current.isRecording).toBe(true)
  })

  it('forwards a stt:partial snapshot to onPartial verbatim', () => {
    const onPartial = vi.fn()
    renderHook(() => useSTT({ onPartial }))

    act(() => {
      partialListener!({ text: 'hello wor' })
    })

    expect(fakeCharivo.on).toHaveBeenCalledTimes(1)
    expect(onPartial).toHaveBeenCalledWith('hello wor')
  })

  it('calls the latest onPartial after a re-render without re-subscribing', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ onPartial }) => useSTT({ onPartial }), {
      initialProps: { onPartial: first }
    })

    rerender({ onPartial: second })
    act(() => {
      partialListener!({ text: 'later' })
    })

    expect(second).toHaveBeenCalledWith('later')
    expect(first).not.toHaveBeenCalled()
    expect(fakeCharivo.on).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes the same listener on unmount', () => {
    const { unmount } = renderHook(() => useSTT())
    const registered = fakeCharivo.on.mock.calls[0][1]

    unmount()

    expect(fakeCharivo.off).toHaveBeenCalledWith('stt:partial', registered)
  })
})
