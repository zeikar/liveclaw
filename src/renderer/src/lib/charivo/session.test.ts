import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getCharivoInstance,
  getMessagesSnapshot,
  resetMessages,
  subscribeMessages
} from './session'

const chatMock = vi.fn<Window['api']['chat']>()

beforeEach(() => {
  window.api = { chat: chatMock, openExternal: vi.fn() }
  chatMock.mockReset()
  getCharivoInstance().clearHistory()
  resetMessages()
})

describe('session message history', () => {
  it('delivers the current snapshot immediately on subscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeMessages(listener)

    expect(listener).toHaveBeenCalledWith([])

    unsubscribe()
  })

  it('records user and character messages through userSay', async () => {
    chatMock.mockResolvedValue('Hello from Hiyori!')

    await getCharivoInstance().userSay('Hi there')

    const messages = getMessagesSnapshot()
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ type: 'user', content: 'Hi there' })
    expect(messages[1]).toMatchObject({
      type: 'character',
      content: 'Hello from Hiyori!',
      characterId: 'hiyori'
    })
  })

  it('sends the system prompt and user message to the main process', async () => {
    chatMock.mockResolvedValue('ok')

    await getCharivoInstance().userSay('Hi')

    expect(chatMock).toHaveBeenCalledTimes(1)
    const apiMessages = chatMock.mock.calls[0][0]
    expect(apiMessages[0].role).toBe('system')
    expect(apiMessages[apiMessages.length - 1]).toEqual({ role: 'user', content: 'Hi' })
  })

  it('keeps the user message and rethrows when the LLM call fails', async () => {
    chatMock.mockRejectedValue(new Error('Failed to fetch'))

    await expect(getCharivoInstance().userSay('Hi')).rejects.toThrow('Failed to fetch')

    const messages = getMessagesSnapshot()
    expect(messages).toHaveLength(1)
    expect(messages[0].type).toBe('user')
  })

  it('notifies subscribers on new messages and stops after unsubscribe', async () => {
    chatMock.mockResolvedValue('first')
    const listener = vi.fn()
    const unsubscribe = subscribeMessages(listener)

    await getCharivoInstance().userSay('one')

    // initial snapshot + message:sent + message:received
    expect(listener).toHaveBeenCalledTimes(3)

    unsubscribe()
    await getCharivoInstance().userSay('two')

    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('clears history and notifies subscribers on resetMessages', async () => {
    chatMock.mockResolvedValue('yo')
    await getCharivoInstance().userSay('hey')

    const listener = vi.fn()
    const unsubscribe = subscribeMessages(listener)
    resetMessages()

    expect(getMessagesSnapshot()).toEqual([])
    expect(listener).toHaveBeenLastCalledWith([])

    unsubscribe()
  })
})
