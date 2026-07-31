import type { Message } from '@charivo/core'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageList } from './MessageList'

// jsdom implements neither of the two APIs useChatScroll needs: ResizeObserver to react to wrapping
// text, and Element.prototype.scrollTo for the new-message scroll. `new` requires a constructable
// function, not an arrow function.
vi.stubGlobal(
  'ResizeObserver',
  vi.fn().mockImplementation(function ResizeObserverStub() {
    return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }
  })
)

const scrollTo = vi.fn()

beforeEach(() => {
  scrollTo.mockClear()
  Element.prototype.scrollTo = scrollTo
})

afterEach(cleanup)

let clock = 0
const message = (id: string, type: Message['type'], content: string): Message => ({
  id,
  type,
  content,
  timestamp: new Date(++clock)
})

describe('MessageList', () => {
  it('keeps the existing bubbles mounted when a new message arrives', () => {
    const first = message('c1', 'character', 'hello')
    const { rerender } = render(<MessageList messages={[first]} isLoading={false} error={null} />)
    const firstBubble = screen.getByText('hello')

    rerender(
      <MessageList
        messages={[first, message('c2', 'character', 'again')]}
        isLoading={false}
        error={null}
      />
    )

    // The very same DOM node, not a rebuilt one: a remount would re-parse every bubble's markdown
    // from scratch on every turn.
    expect(screen.getByText('hello')).toBe(firstBubble)
    expect(screen.getByText('again')).toBeDefined()
  })

  it('smooth-scrolls on a new message instead of taking the first-mount jump', () => {
    const first = message('c1', 'character', 'hello')
    const { rerender } = render(<MessageList messages={[first]} isLoading={false} error={null} />)
    // The first mount jumps by assigning scrollTop, so nothing is scrolled through this API yet.
    expect(scrollTo).not.toHaveBeenCalled()

    rerender(
      <MessageList
        messages={[first, message('c2', 'character', 'again')]}
        isLoading={false}
        error={null}
      />
    )

    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
  })

  it('announces the error banner so a screen reader does not miss it', () => {
    render(<MessageList messages={[]} isLoading={false} error="Cannot connect to OpenClaw." />)

    expect(screen.getByRole('alert').textContent).toBe('Cannot connect to OpenClaw.')
  })

  it('scrolls the column the message belongs to, leaving the other one alone', () => {
    const character = message('c1', 'character', 'hello')
    const { rerender } = render(
      <MessageList messages={[character]} isLoading={false} error={null} />
    )

    rerender(
      <MessageList
        messages={[character, message('u1', 'user', 'hi')]}
        isLoading={false}
        error={null}
      />
    )

    // Only the user column gained a message; the character column must not scroll along with it.
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })
})
