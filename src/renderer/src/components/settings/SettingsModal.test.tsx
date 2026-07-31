import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsModal } from './SettingsModal'

// Stubs the form so the close-gating (decision 12) can be driven directly through onSavingChange,
// without going through a real save.
vi.mock('./SettingsForm', () => ({
  SettingsForm: ({
    onSavingChange
  }: {
    onSavingChange?: (saving: boolean) => void
  }): React.JSX.Element => (
    <div>
      <button onClick={() => onSavingChange?.(true)}>start saving</button>
      <button onClick={() => onSavingChange?.(false)}>stop saving</button>
    </div>
  )
}))

const view: SettingsView = {
  openClawTokenSet: false,
  openaiApiKeySource: 'none',
  openClawBaseURL: '',
  ttsModel: '',
  ttsVoice: '',
  openClawSource: 'openclaw-config',
  openClawNoAuth: false,
  openClawBaseURLResolved: 'http://127.0.0.1:18789/v1',
  openClawTokenOrigin: 'http://127.0.0.1:18789',
  openClawConfigPath: '/home/user/.openclaw/openclaw.json',
  openClawDetectedOrigin: 'http://127.0.0.1:18789',
  openClawDetectionError: null,
  chatCompletionsEnabled: true
}

beforeEach(() => {
  window.api = {
    chat: vi.fn(),
    newConversation: vi.fn(),
    openExternal: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    testConnection: vi.fn(),
    getTTSConfig: vi.fn(),
    bootstrapRealtimeSTT: vi.fn()
  }
})

afterEach(cleanup)

describe('SettingsModal', () => {
  it('exposes the panel as a modal dialog, not an anonymous div', () => {
    render(<SettingsModal view={view} connection={null} onClose={vi.fn()} onSaved={vi.fn()} />)
    const dialog = screen.getByRole('dialog')

    expect(dialog.getAttribute('aria-modal')).toBe('true')
    // Focus moves into the panel on mount, which is only meaningful if the panel names itself.
    expect(document.activeElement).toBe(dialog)
  })

  it('Escape closes the modal when no save is in flight', () => {
    const onClose = vi.fn()
    render(<SettingsModal view={view} connection={null} onClose={onClose} onSaved={vi.fn()} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a backdrop click closes the modal when no save is in flight', () => {
    const onClose = vi.fn()
    const { container } = render(
      <SettingsModal view={view} connection={null} onClose={onClose} onSaved={vi.fn()} />
    )

    fireEvent.click(container.firstChild as Element)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clicking inside the panel does not close the modal', () => {
    const onClose = vi.fn()
    render(<SettingsModal view={view} connection={null} onClose={onClose} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByText('start saving'))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('Escape and a backdrop click are no-ops while a save is in flight, and work again once it settles', () => {
    const onClose = vi.fn()
    const { container } = render(
      <SettingsModal view={view} connection={null} onClose={onClose} onSaved={vi.fn()} />
    )

    fireEvent.click(screen.getByText('start saving'))

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(container.firstChild as Element)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('stop saving'))

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(container.firstChild as Element)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
