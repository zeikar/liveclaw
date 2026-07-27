import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootstrapRealtimeTranscription } from './realtime-stt'

const CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets'
const CALLS_URL = 'https://api.openai.com/v1/realtime/calls'

let fetchMock: ReturnType<typeof vi.fn>

const jsonResponse = (status: number, body: unknown): unknown => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body)
})

const textResponse = (status: number, body: string): unknown => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body
})

const validPayload = { sdpOffer: 'v=0\r\noffer', session: { model: 'gpt-4o-transcribe' } }

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the happy path', () => {
  it('mints a secret then exchanges the offer, calling the two URLs in order', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { value: 'ephemeral-secret' }))
      .mockResolvedValueOnce(textResponse(200, 'v=0\r\nanswer'))

    const result = await bootstrapRealtimeTranscription('api-key', validPayload)

    expect(result).toEqual({ answerSdp: 'v=0\r\nanswer' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe(CLIENT_SECRETS_URL)
    expect(fetchMock.mock.calls[1][0]).toBe(CALLS_URL)
  })

  it('reads the secret from the legacy client_secret.value shape', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { client_secret: { value: 'legacy-secret' } }))
      .mockResolvedValueOnce(textResponse(200, 'v=0\r\nanswer'))

    const result = await bootstrapRealtimeTranscription('api-key', validPayload)

    expect(result).toEqual({ answerSdp: 'v=0\r\nanswer' })
  })

  it('authenticates the exchange with the ephemeral secret, not the standing key', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { value: 'ephemeral-secret' }))
      .mockResolvedValueOnce(textResponse(200, 'v=0\r\nanswer'))

    await bootstrapRealtimeTranscription('api-key', validPayload)

    const [, exchangeInit] = fetchMock.mock.calls[1]
    expect(exchangeInit.headers.Authorization).toBe('Bearer ephemeral-secret')
  })
})

describe('the mint request body', () => {
  it('carries turn_detection: null and omits language when it was not supplied', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { value: 'secret' }))
      .mockResolvedValueOnce(textResponse(200, 'v=0\r\nanswer'))

    await bootstrapRealtimeTranscription('api-key', validPayload)

    const [, mintInit] = fetchMock.mock.calls[0]
    const body = JSON.parse(mintInit.body)
    expect(body.session.audio.input.turn_detection).toBeNull()
    expect(body.session.audio.input.transcription).toEqual({ model: 'gpt-4o-transcribe' })
    expect(body.session.audio.input.transcription).not.toHaveProperty('language')
  })

  it('forwards session.language when it is a non-empty string', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { value: 'secret' }))
      .mockResolvedValueOnce(textResponse(200, 'v=0\r\nanswer'))

    await bootstrapRealtimeTranscription('api-key', {
      sdpOffer: 'v=0\r\noffer',
      session: { model: 'gpt-4o-transcribe', language: 'en' }
    })

    const [, mintInit] = fetchMock.mock.calls[0]
    const body = JSON.parse(mintInit.body)
    expect(body.session.audio.input.transcription.language).toBe('en')
  })
})

describe('mint failures', () => {
  it('labels a non-2xx mint response', async () => {
    fetchMock.mockResolvedValueOnce(textResponse(500, 'boom'))

    await expect(bootstrapRealtimeTranscription('api-key', validPayload)).rejects.toThrow(
      /\[step 1\/2 client_secrets\] mint failed with 500/
    )
  })

  it('labels a mint body that is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(textResponse(200, 'not json'))

    await expect(bootstrapRealtimeTranscription('api-key', validPayload)).rejects.toThrow(
      /\[step 1\/2 client_secrets\] response was not JSON/
    )
  })

  it('labels a mint body with no secret', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { nothing: 'here' }))

    await expect(bootstrapRealtimeTranscription('api-key', validPayload)).rejects.toThrow(
      /\[step 1\/2 client_secrets\] response had no ephemeral secret/
    )
  })

  it.each([
    ['null root', null],
    ['array root', []],
    ['string root', 'nope']
  ] as const)(
    'labels a non-object JSON root (%s) as a missing secret, not a bare TypeError',
    async (_name, root) => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, root))

      await expect(bootstrapRealtimeTranscription('api-key', validPayload)).rejects.toThrow(
        /\[step 1\/2 client_secrets\] response had no ephemeral secret/
      )
    }
  )
})

describe('exchange failures', () => {
  it('labels a non-2xx exchange response', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { value: 'secret' }))
      .mockResolvedValueOnce(textResponse(500, 'boom'))

    await expect(bootstrapRealtimeTranscription('api-key', validPayload)).rejects.toThrow(
      /\[step 2\/2 realtime\/calls\] SDP exchange failed with 500/
    )
  })

  it('labels an exchange body that does not start with v=', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { value: 'secret' }))
      .mockResolvedValueOnce(textResponse(200, 'not sdp'))

    await expect(bootstrapRealtimeTranscription('api-key', validPayload)).rejects.toThrow(
      /\[step 2\/2 realtime\/calls\] response body was not SDP/
    )
  })
})

describe('input validation', () => {
  it('rejects an empty API key with a message that names the key as missing', async () => {
    await expect(bootstrapRealtimeTranscription('', validPayload)).rejects.toThrow(
      /OpenAI API key is missing/
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a payload missing sdpOffer', async () => {
    await expect(
      bootstrapRealtimeTranscription('api-key', { session: { model: 'gpt-4o-transcribe' } })
    ).rejects.toThrow(/sdpOffer is required/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a payload missing session.model', async () => {
    await expect(
      bootstrapRealtimeTranscription('api-key', { sdpOffer: 'v=0\r\noffer', session: {} })
    ).rejects.toThrow(/session\.model is required/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['null root', null],
    ['array root', []],
    ['string root', 'nope']
  ] as const)(
    'rejects a non-object payload root (%s) as an invalid payload',
    async (_name, root) => {
      await expect(bootstrapRealtimeTranscription('api-key', root)).rejects.toThrow(
        /Invalid realtime transcription request: expected an object payload/
      )
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('rejects a non-object session as session.model is required', async () => {
    await expect(
      bootstrapRealtimeTranscription('api-key', { sdpOffer: 'v=0\r\noffer', session: 'nope' })
    ).rejects.toThrow(/session\.model is required/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('the shared deadline', () => {
  it('aborts both steps after 12s and names the step that died', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('This operation was aborted', 'AbortError'))
          })
        })
    )

    const pending = bootstrapRealtimeTranscription('api-key', validPayload)
    const assertion = expect(pending).rejects.toThrow(
      /\[step 1\/2 client_secrets\] timed out after 12000ms/
    )

    await vi.advanceTimersByTimeAsync(12_000)
    await assertion
  })

  it('lets step 1 finish, then aborts step 2 on the same 12s clock (not a restarted one)', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { value: 'secret' })).mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('This operation was aborted', 'AbortError'))
          })
        })
    )

    const pending = bootstrapRealtimeTranscription('api-key', validPayload)
    const assertion = expect(pending).rejects.toThrow(
      /\[step 2\/2 realtime\/calls\] timed out after 12000ms/
    )

    await vi.advanceTimersByTimeAsync(12_000)
    await assertion
  })
})
