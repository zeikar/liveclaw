import { describe, expect, it } from 'vitest'
import { toExternalURL } from './external-url'

describe('toExternalURL', () => {
  it('accepts the three schemes a link may legitimately use', () => {
    expect(toExternalURL('https://example.com/docs')).toBe('https://example.com/docs')
    expect(toExternalURL('http://127.0.0.1:18789/v1')).toBe('http://127.0.0.1:18789/v1')
    expect(toExternalURL('mailto:someone@example.com')).toBe('mailto:someone@example.com')
  })

  it('trims surrounding whitespace before parsing', () => {
    expect(toExternalURL('  https://example.com/  ')).toBe('https://example.com/')
  })

  // The window-open handler used to pass its URL straight to shell.openExternal, so anything the
  // OS had a handler for was reachable through a middle-clicked link.
  it('refuses every other scheme', () => {
    expect(toExternalURL('file:///etc/passwd')).toBeNull()
    expect(toExternalURL('xmpp:someone@example.com')).toBeNull()
    expect(toExternalURL('irc://example.com/room')).toBeNull()
    expect(toExternalURL('javascript:alert(1)')).toBeNull()
    expect(toExternalURL('data:text/html,<script>alert(1)</script>')).toBeNull()
  })

  it('refuses anything that is not a parseable absolute URL', () => {
    expect(toExternalURL('')).toBeNull()
    expect(toExternalURL('   ')).toBeNull()
    expect(toExternalURL('/relative/path')).toBeNull()
    expect(toExternalURL('not a url')).toBeNull()
  })

  it('refuses a non-string payload instead of throwing', () => {
    expect(toExternalURL(undefined)).toBeNull()
    expect(toExternalURL(null)).toBeNull()
    expect(toExternalURL(42)).toBeNull()
    expect(toExternalURL({ href: 'https://example.com' })).toBeNull()
  })
})
