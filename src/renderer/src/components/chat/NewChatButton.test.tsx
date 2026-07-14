import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewChatButton } from './NewChatButton'

afterEach(cleanup)

const newChatButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'New chat' }) as HTMLButtonElement

describe('NewChatButton', () => {
  it('starts a new chat when clicked', () => {
    const onNewChat = vi.fn()
    render(<NewChatButton isBusy={false} hasMessages onNewChat={onNewChat} />)

    newChatButton().click()

    expect(onNewChat).toHaveBeenCalledTimes(1)
  })

  it('is disabled with nothing to clear', () => {
    render(<NewChatButton isBusy={false} hasMessages={false} onNewChat={vi.fn()} />)

    expect(newChatButton().disabled).toBe(true)
  })

  it('is disabled while a reply is in flight', () => {
    render(<NewChatButton isBusy hasMessages onNewChat={vi.fn()} />)

    expect(newChatButton().disabled).toBe(true)
  })
})
