import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCharivoInstance, resetMessages } from '../lib/charivo/session'
import { useCharivo } from './useCharivo'

const chatMock = vi.fn<Window['api']['chat']>()
const newConversationMock = vi.fn<Window['api']['newConversation']>()

beforeEach(() => {
  window.api = { chat: chatMock, newConversation: newConversationMock, openExternal: vi.fn() }
  chatMock.mockReset()
  newConversationMock.mockReset()
  newConversationMock.mockResolvedValue(undefined)
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

  it('clears messages and rotates the OpenClaw session on clearHistory', async () => {
    chatMock.mockResolvedValue('hi')
    const { result } = renderHook(() => useCharivo())
    await act(() => result.current.sendMessage('Hello'))
    expect(result.current.messages).toHaveLength(2)

    await act(() => result.current.clearHistory())

    expect(newConversationMock).toHaveBeenCalledTimes(1)
    expect(result.current.messages).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('keeps the history when the session rotation fails', async () => {
    chatMock.mockResolvedValue('hi')
    newConversationMock.mockRejectedValue(new Error('gateway is down'))
    const { result } = renderHook(() => useCharivo())
    await act(() => result.current.sendMessage('Hello'))

    await act(() => result.current.clearHistory())

    // Clearing the UI while OpenClaw still holds the transcript would let the character
    // answer from a conversation the user believes is gone.
    expect(result.current.messages).toHaveLength(2)
    expect(result.current.error).toContain('gateway is down')
  })
})
