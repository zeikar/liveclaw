// Main-process bootstrap for @charivo/stt's OpenAI realtime transcriber. This is the Node-side
// counterpart of the transcriber's `bootstrap` callback: mint an ephemeral secret for a
// `type: "transcription"` session, then trade the renderer's SDP offer for the realtime answer.
//
// Reads no settings and imports no Electron module — the caller (the IPC handler, wired in a later
// task) resolves the OpenAI key and passes it in, so this module is plain and test-friendly.

const CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets'
const CALLS_URL = 'https://api.openai.com/v1/realtime/calls'

const MINT_STEP = 'step 1/2 client_secrets'
const EXCHANGE_STEP = 'step 2/2 realtime/calls'

// The transcriber abandons the bootstrap after 15s (BOOTSTRAP_TIMEOUT_MS in
// @charivo/stt/openai-realtime). Give up first, with headroom, so a slow upstream call cannot
// outlive the transcriber's own cleanup and leave an orphaned — billable — session running. This is
// the budget for BOTH steps together: one signal covers the whole exchange rather than restarting the
// clock per call.
const BOOTSTRAP_DEADLINE_MS = 12_000

export interface RealtimeTranscriptionBootstrap {
  answerSdp: string
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Run one upstream call against the shared deadline. The body read happens here too, because an
 * abort errors the response stream as well as the request.
 */
const fetchWithDeadline = async (
  step: string,
  url: string,
  init: RequestInit,
  signal: AbortSignal
): Promise<{ ok: boolean; status: number; body: string }> => {
  try {
    const response = await fetch(url, { ...init, signal })
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text()
    }
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`[${step}] timed out after ${BOOTSTRAP_DEADLINE_MS}ms`)
    }
    throw new Error(
      `[${step}] request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Mint an ephemeral client secret for a transcription-only realtime session. `turn_detection: null`
 * keeps the server from segmenting the utterance, so the single commit the transcriber sends at stop
 * is the only commit in the session.
 */
const mintTranscriptionSecret = async (
  apiKey: string,
  model: string,
  language: string | undefined,
  signal: AbortSignal
): Promise<string> => {
  const transcription: Record<string, unknown> = { model }
  if (language) {
    transcription.language = language
  }

  const { ok, status, body } = await fetchWithDeadline(
    MINT_STEP,
    CLIENT_SECRETS_URL,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session: {
          type: 'transcription',
          audio: { input: { transcription, turn_detection: null } }
        }
      })
    },
    signal
  )

  if (!ok) {
    throw new Error(`[${MINT_STEP}] mint failed with ${status}: ${body}`)
  }

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    throw new Error(`[${MINT_STEP}] response was not JSON: ${body}`)
  }

  // A parsed root that is not a plain object (null, array, scalar) never carries a secret at either
  // shape below — treat it as a missing secret rather than indexing into it and throwing a bare
  // TypeError.
  if (!isPlainObject(payload)) {
    throw new Error(
      `[${MINT_STEP}] response had no ephemeral secret (checked \`value\` and \`client_secret.value\`)`
    )
  }

  // The API returns the secret at the top level `value` for transcription sessions;
  // `client_secret.value` is the older shape. Accept both.
  const clientSecret = isPlainObject(payload.client_secret) ? payload.client_secret : undefined
  const secret = typeof payload.value === 'string' ? payload.value : clientSecret?.value

  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error(
      `[${MINT_STEP}] response had no ephemeral secret (checked \`value\` and \`client_secret.value\`)`
    )
  }

  return secret
}

/**
 * Trade the renderer's SDP offer for the realtime answer SDP, authenticated with the ephemeral
 * secret rather than the standing API key.
 */
const exchangeSdp = async (
  ephemeralKey: string,
  sdpOffer: string,
  signal: AbortSignal
): Promise<string> => {
  const { ok, status, body } = await fetchWithDeadline(
    EXCHANGE_STEP,
    CALLS_URL,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        'Content-Type': 'application/sdp'
      },
      body: sdpOffer
    },
    signal
  )

  if (!ok) {
    throw new Error(`[${EXCHANGE_STEP}] SDP exchange failed with ${status}: ${body}`)
  }

  if (!body.startsWith('v=')) {
    throw new Error(`[${EXCHANGE_STEP}] response body was not SDP: ${body}`)
  }

  return body
}

const parseBootstrapRequest = (
  payload: unknown
): { sdpOffer: string; model: string; language: string | undefined } => {
  if (!isPlainObject(payload)) {
    throw new Error('Invalid realtime transcription request: expected an object payload')
  }

  const { sdpOffer, session } = payload
  if (typeof sdpOffer !== 'string' || sdpOffer.length === 0) {
    throw new Error('Invalid realtime transcription request: sdpOffer is required')
  }

  if (!isPlainObject(session) || typeof session.model !== 'string' || session.model.length === 0) {
    throw new Error('Invalid realtime transcription request: session.model is required')
  }

  const language =
    typeof session.language === 'string' && session.language.length > 0
      ? session.language
      : undefined

  return { sdpOffer, model: session.model, language }
}

/**
 * The main-process side of the OpenAI realtime transcriber's `bootstrap` callback: validate the
 * renderer's raw IPC payload, mint an ephemeral secret, and trade the SDP offer for an answer — all
 * against one shared deadline.
 */
export const bootstrapRealtimeTranscription = async (
  apiKey: string,
  payload: unknown
): Promise<RealtimeTranscriptionBootstrap> => {
  if (!apiKey) {
    throw new Error('Cannot bootstrap realtime transcription: OpenAI API key is missing')
  }

  const { sdpOffer, model, language } = parseBootstrapRequest(payload)

  const controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(), BOOTSTRAP_DEADLINE_MS)

  try {
    const ephemeralKey = await mintTranscriptionSecret(apiKey, model, language, controller.signal)
    const answerSdp = await exchangeSdp(ephemeralKey, sdpOffer, controller.signal)
    return { answerSdp }
  } finally {
    clearTimeout(deadline)
  }
}
