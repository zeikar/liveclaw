import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCharivoInstance, resetMessages } from '../lib/charivo/session'
import { useCharivo } from './useCharivo'

const chatMock = vi.fn<Window['api']['chat']>()

beforeEach(() => {
  window.api = { chat: chatMock, openExternal: vi.fn() }
  chatMock.mockReset()
  getCharivoInstance().clearHistory()
  resetMessages()
})

afterEach(cleanup)

describe('useCharivo', () => {
  it('sends a message and exposes the conversation', async () => {
    chatMock.mockResolvedValue('Nice to meet you!')
    const { result } = renderHook(() => useCharivo())

    await act(() => result.current.sendMessage('Hello'))

    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[1].content).toBe('Nice to meet you!')
    expect(result.current.isLoading).toBe(false)
    expect(result.current.isBusy).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('ignores blank input', async () => {
    const { result } = renderHook(() => useCharivo())

    await act(() => result.current.sendMessage('   '))

    expect(chatMock).not.toHaveBeenCalled()
    expect(result.current.messages).toEqual([])
  })

  it.each([
    ['Failed to fetch', 'Cannot connect to OpenClaw'],
    ['401 Unauthorized', 'Authentication error'],
    ['429 rate limit exceeded', 'Too many requests'],
    ['something exploded', 'Error: something exploded']
  ])('maps "%s" to a user-facing error', async (rawMessage, expected) => {
    chatMock.mockRejectedValue(new Error(rawMessage))
    const { result } = renderHook(() => useCharivo())

    await act(() => result.current.sendMessage('Hello'))

    expect(result.current.error).toContain(expected)
    expect(result.current.isBusy).toBe(false)
    expect(result.current.isLoading).toBe(false)
  })

  it('clears messages and error on clearHistory', async () => {
    chatMock.mockResolvedValue('hi')
    const { result } = renderHook(() => useCharivo())
    await act(() => result.current.sendMessage('Hello'))
    expect(result.current.messages).toHaveLength(2)

    act(() => {
      result.current.clearHistory()
    })

    expect(result.current.messages).toEqual([])
    expect(result.current.error).toBeNull()
  })
})
