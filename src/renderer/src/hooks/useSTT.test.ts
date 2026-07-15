import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSTT } from './useSTT'

type FakeSTTManager = {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  isRecording: ReturnType<typeof vi.fn>
}

let fakeManager: FakeSTTManager | undefined

vi.mock('../lib/charivo/session', () => ({
  getCharivoInstance: () => ({
    getSTTManager: () => fakeManager
  })
}))

beforeEach(() => {
  fakeManager = {
    start: vi.fn(),
    stop: vi.fn(),
    isRecording: vi.fn().mockReturnValue(false)
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
    fakeManager!.isRecording.mockReturnValue(true)
    fakeManager!.stop.mockResolvedValue('hello world')
    const { result } = renderHook(() => useSTT())

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
    fakeManager!.isRecording.mockReturnValue(true)
    fakeManager!.stop.mockRejectedValue(new Error('transcription failed'))
    const { result } = renderHook(() => useSTT())

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
})
