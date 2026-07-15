import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatComposer } from './ChatComposer'

afterEach(cleanup)

const renderComposer = (overrides: Partial<Parameters<typeof ChatComposer>[0]> = {}): void => {
  render(
    <ChatComposer
      characterName="Test"
      input=""
      isLoading={false}
      isBusy={false}
      sttEnabled={false}
      isRecording={false}
      isStarting={false}
      isTranscribing={false}
      onInputChange={vi.fn()}
      onSend={vi.fn()}
      onKeyDown={vi.fn()}
      onToggleMic={vi.fn()}
      {...overrides}
    />
  )
}

const micButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: /recording/i }) as HTMLButtonElement

const sendButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement

describe('ChatComposer', () => {
  it('hides the mic button when STT is disabled', () => {
    renderComposer({ sttEnabled: false })

    expect(screen.queryByRole('button', { name: /recording/i })).toBe(null)
  })

  it('calls onToggleMic when the mic button is clicked', () => {
    const onToggleMic = vi.fn()
    renderComposer({ sttEnabled: true, onToggleMic })

    micButton().click()

    expect(onToggleMic).toHaveBeenCalledTimes(1)
  })

  it('disables the mic button while a reply is in flight', () => {
    renderComposer({ sttEnabled: true, isRecording: false, isBusy: true })

    expect(micButton().disabled).toBe(true)
  })

  it('disables the mic button while starting', () => {
    renderComposer({ sttEnabled: true, isRecording: false, isStarting: true })

    expect(micButton().disabled).toBe(true)
  })

  it('disables the mic button while transcribing', () => {
    renderComposer({ sttEnabled: true, isRecording: false, isTranscribing: true })

    expect(micButton().disabled).toBe(true)
  })

  it('keeps the stop button reachable while recording even if busy', () => {
    renderComposer({ sttEnabled: true, isRecording: true, isBusy: true })

    expect(micButton().disabled).toBe(false)
  })

  it('disables Send while recording, even with non-empty input', () => {
    renderComposer({ sttEnabled: true, isRecording: true, input: 'hello' })

    expect(sendButton().disabled).toBe(true)
  })

  it('labels the mic button by recording state', () => {
    renderComposer({ sttEnabled: true, isRecording: true })

    expect(screen.getByRole('button', { name: 'Stop recording' })).toBeTruthy()

    cleanup()
    renderComposer({ sttEnabled: true, isRecording: false })

    expect(screen.getByRole('button', { name: 'Start recording' })).toBeTruthy()
  })
})
