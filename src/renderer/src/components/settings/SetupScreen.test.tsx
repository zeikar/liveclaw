import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SetupScreen } from './SetupScreen'

const view: SettingsView = {
  openClawTokenSet: false,
  openaiApiKeySource: 'none',
  openClawBaseURL: '',
  ttsModel: '',
  ttsVoice: '',
  openClawSource: 'openclaw-config',
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
    getTTSConfig: vi.fn()
  }
})

afterEach(cleanup)

describe('SetupScreen', () => {
  it('renders the heading and calls onRetry when Retry is clicked', () => {
    const onRetry = vi.fn()
    render(<SetupScreen view={view} connection={null} onSaved={vi.fn()} onRetry={onRetry} />)

    expect(screen.getByText('Connect LiveClaw to OpenClaw')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
