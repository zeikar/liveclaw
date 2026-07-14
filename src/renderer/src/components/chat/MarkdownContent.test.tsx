import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownContent } from './MarkdownContent'

afterEach(cleanup)

describe('MarkdownContent', () => {
  it('renders markdown formatting', () => {
    render(<MarkdownContent content={'**bold** text\n\n- item one'} />)

    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('item one').tagName).toBe('LI')
  })

  it('opens links via the main process instead of navigating', () => {
    const openExternal = vi.fn<Window['api']['openExternal']>().mockResolvedValue(undefined)
    window.api = {
      chat: vi.fn(),
      newConversation: vi.fn(),
      openExternal,
      getSettings: vi.fn(),
      saveSettings: vi.fn(),
      testConnection: vi.fn(),
      getTTSConfig: vi.fn()
    }

    render(<MarkdownContent content={'[docs](https://example.com)'} />)

    const link = screen.getByRole('link', { name: 'docs' })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')

    fireEvent.click(link)

    expect(openExternal).toHaveBeenCalledWith('https://example.com')
  })
})
