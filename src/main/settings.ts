// LiveClaw's own settings store, resolver, and the origin rule that keeps every implicit token
// bound to the gateway it was configured for.
//
// Decision 2 — THE security invariant: only a token submitted in the current request may be used
// with an origin other than the one it was configured for. Every implicit token (auto-detected,
// environment-derived, or previously stored) is bound to the origin it was configured for and must
// never be sent anywhere else. That rule is enforced here in the main process — in
// resolveOpenClaw / saveSettings / testOpenClawConnection — not in the renderer form.
//
// Nothing may touch `electron` at module scope, so this module stays importable under vitest's node
// environment; `app` is only read inside functions.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'
import { detectOpenClaw, type OpenClawDetection } from './openclaw-config'

const DEFAULT_OPENCLAW_BASE_URL = 'http://127.0.0.1:18789/v1'

const configPath = (): string => join(app.getPath('userData'), 'config.json')

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const coerceString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const emptyStored = (): StoredSettings => ({
  openClawToken: '',
  openClawBaseURL: '',
  openaiApiKey: '',
  ttsModel: '',
  ttsVoice: ''
})

// fetch rejects a URL with embedded credentials, and a non-http(s) scheme is never a gateway. Reject
// both here so a bad base URL fails loudly instead of silently at fetch time.
const parseBaseURL = (raw: string): URL => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('OpenClaw base URL must be an http(s) URL')
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error('OpenClaw base URL must be an http(s) URL')
  }
  return url
}

// Derive the /models endpoint with URL semantics so query/hash are dropped and duplicate slashes in
// the configured path do not produce `//models`.
const modelsEndpoint = (base: URL): URL => {
  const url = new URL(base.toString())
  url.pathname = base.pathname.replace(/\/+$/, '') + '/models'
  url.search = ''
  url.hash = ''
  return url
}

const readStored = (): StoredSettings => {
  let contents: string
  try {
    contents = readFileSync(configPath(), 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyStored()
    }
    // Rethrow every other I/O error (EACCES, EISDIR, …) so Task 5's loadError screen surfaces it
    // instead of the app pretending it is simply unconfigured.
    throw err
  }

  let raw: unknown
  try {
    raw = JSON.parse(contents)
  } catch {
    console.warn('[settings] config.json is not valid JSON; using defaults.')
    return emptyStored()
  }

  // A parsed root that is not a plain object (null, array, scalar) is a content problem: warn and
  // fall back to defaults. Never index into it or delete it.
  if (!isPlainObject(raw)) {
    console.warn('[settings] config.json root is not an object; using defaults.')
    return emptyStored()
  }

  return {
    openClawToken: coerceString(raw.openClawToken),
    openClawBaseURL: coerceString(raw.openClawBaseURL),
    openaiApiKey: coerceString(raw.openaiApiKey),
    ttsModel: coerceString(raw.ttsModel),
    ttsVoice: coerceString(raw.ttsVoice)
  }
}

// Sanitise the persisted override so nothing invalid can reach resolveOpenClaw (which would throw).
// A base-only override is legal (decision 8), so a non-empty base URL is validated whether or not it
// carries a token.
const storedOpenClaw = (stored: StoredSettings): StoredOpenClaw => {
  const { openClawToken: token, openClawBaseURL: baseURL } = stored

  if (baseURL === '') {
    // A token without its base URL is not a legal override — drop both.
    if (token !== '') {
      console.warn(
        '[settings] config.json has an OpenClaw token without its base URL; dropping both.'
      )
    }
    return null
  }

  try {
    parseBaseURL(baseURL)
  } catch {
    if (token !== '') {
      console.warn(
        '[settings] config.json OpenClaw base URL is unparseable; dropping the token too.'
      )
    } else {
      console.warn('[settings] config.json OpenClaw base URL is unparseable; clearing it.')
    }
    return null
  }

  return { token, baseURL }
}

type TokenCandidate = {
  token: string
  origin: string
  source: 'manual' | 'openclaw-config' | 'env'
}

const envOpenClawToken = (): string =>
  !app.isPackaged ? process.env.OPENCLAW_TOKEN?.trim() || '' : ''

const envOpenClawBaseURL = (): string =>
  process.env.OPENCLAW_BASE_URL?.trim() || DEFAULT_OPENCLAW_BASE_URL

// Every implicit token, paired with the origin it belongs to. The order encodes decision 8's
// precedence: manual override → OpenClaw auto-detect → dev env.
const candidates = (override: StoredOpenClaw, detection: OpenClawDetection): TokenCandidate[] => {
  const list: TokenCandidate[] = []

  if (override && override.token !== '') {
    list.push({ token: override.token, origin: new URL(override.baseURL).origin, source: 'manual' })
  }

  if (detection.token !== '' && detection.origin) {
    list.push({ token: detection.token, origin: detection.origin, source: 'openclaw-config' })
  }

  // Dev-only: a shipped build must never trust a stray OPENCLAW_TOKEN in the environment.
  const envToken = envOpenClawToken()
  if (envToken !== '') {
    try {
      list.push({
        token: envToken,
        origin: parseBaseURL(envOpenClawBaseURL()).origin,
        source: 'env'
      })
    } catch {
      // A malformed OPENCLAW_BASE_URL simply means the env token has no usable origin.
    }
  }

  return list
}

type ResolvedOpenClaw = {
  baseURL: string
  origin: string
  token: string
  source: 'manual' | 'openclaw-config' | 'env' | 'none'
  /** True when the effective gateway is a detected no-auth gateway (no token needed at all). */
  noAuth: boolean
  detection: OpenClawDetection
}

// Resolve a prospective state, not only the stored one: every caller passes the override it means —
// the stored one for reads, the *proposed* one for a save — so a freshly submitted token can be seen
// here before anything is written.
const resolveOpenClaw = (override: StoredOpenClaw): ResolvedOpenClaw => {
  const detection = detectOpenClaw()

  // Effective base URL precedence per decision 3/8: config.json override → an explicitly-set dev
  // OPENCLAW_BASE_URL → OpenClaw auto-detect → default. Auto-detection is a guess (it cannot see a
  // CLI --port or OPENCLAW_GATEWAY_PORT override), so an explicit dev env gateway outranks it even
  // when detection otherwise succeeded. detection.baseURL is only used as a fallback when detection
  // actually found a usable gateway (a real token, or no error at all — e.g. a no-auth gateway); a
  // failed detection's baseURL is just a guessed default.
  const detectionSucceeded = detection.token !== '' || detection.error === null
  const envBase = !app.isPackaged ? process.env.OPENCLAW_BASE_URL?.trim() || '' : ''
  const baseURL =
    override?.baseURL ||
    envBase ||
    (detectionSucceeded ? detection.baseURL : '') ||
    DEFAULT_OPENCLAW_BASE_URL
  const origin = new URL(baseURL).origin

  // Decision 2: an implicit token is bound to the origin it was configured for, so only a candidate
  // whose origin equals the effective gateway may be used. This is the line that stops a detected /
  // env / stored token from ever being sent to a different origin than the one it belongs to.
  const match = candidates(override, detection).find((candidate) => candidate.origin === origin)
  if (match) {
    return { baseURL, origin, token: match.token, source: match.source, noAuth: false, detection }
  }

  // A no-auth gateway needs no token at all: if nothing else claims this origin but detection found
  // a no-auth gateway there, the gateway is still configured — just without a bearer token.
  if (detection.noAuth && detection.origin === origin) {
    return { baseURL, origin, token: '', source: 'openclaw-config', noAuth: true, detection }
  }

  return { baseURL, origin, token: '', source: 'none', noAuth: false, detection }
}

const tokenForOrigin = (
  origin: string,
  override: StoredOpenClaw,
  detection: OpenClawDetection
): TokenCandidate | null =>
  candidates(override, detection).find((candidate) => candidate.origin === origin) ?? null

const envOpenAIKey = (): string =>
  !app.isPackaged
    ? process.env.OPENAI_API_KEY?.trim() || process.env.VITE_OPENAI_API_KEY?.trim() || ''
    : ''

const envTTSModel = (): string =>
  !app.isPackaged
    ? process.env.OPENAI_TTS_MODEL?.trim() || process.env.VITE_OPENAI_TTS_MODEL?.trim() || ''
    : ''

const envTTSVoice = (): string =>
  !app.isPackaged
    ? process.env.OPENAI_TTS_VOICE?.trim() || process.env.VITE_OPENAI_TTS_VOICE?.trim() || ''
    : ''

// Reduced to what provider construction needs, so a provider can never receive a token bound to
// another origin.
export const getEffectiveOpenClaw = (): { token: string; baseURL: string } => {
  const resolved = resolveOpenClaw(storedOpenClaw(readStored()))
  return { token: resolved.token, baseURL: resolved.baseURL }
}

const openaiKeySource = (stored: StoredSettings): 'stored' | 'env' | 'none' => {
  if (stored.openaiApiKey !== '') return 'stored'
  if (envOpenAIKey() !== '') return 'env'
  return 'none'
}

export const getSettingsView = (): SettingsView => {
  const stored = readStored()
  const override = storedOpenClaw(stored)
  const resolved = resolveOpenClaw(override)
  const { detection, origin } = resolved

  return {
    openClawTokenSet: override !== null && override.token !== '',
    openaiApiKeySource: openaiKeySource(stored),
    // Report the stored override even when it is token-less, so Task 4 can keep that state visible.
    openClawBaseURL: override?.baseURL ?? '',
    // Model and voice live as '' here; the renderer's toModel/toVoice supply the defaults so they
    // live in one place. They still fall back to dev env vars when unpackaged.
    ttsModel: stored.ttsModel || envTTSModel(),
    ttsVoice: stored.ttsVoice || envTTSVoice(),
    openClawSource: resolved.source,
    openClawNoAuth: resolved.noAuth,
    openClawBaseURLResolved: resolved.baseURL,
    openClawTokenOrigin: resolved.token !== '' ? origin : null,
    openClawConfigPath: detection.path,
    openClawDetectedOrigin: detection.origin,
    openClawDetectionError: detection.error,
    // Decision 10: the detection's flag only describes the effective gateway when the detected
    // config is the one actually being used (same origin); otherwise we cannot claim to know.
    chatCompletionsEnabled: detection.origin === origin ? detection.chatCompletionsEnabled : null
  }
}

export const getTTSConfig = (): TTSConfig => {
  const stored = readStored()
  // The VITE_* reads inside envOpenAIKey/envTTS* are back-compat with existing .env files from
  // before in-app settings.
  return {
    openaiApiKey: stored.openaiApiKey || envOpenAIKey(),
    ttsModel: stored.ttsModel || envTTSModel(),
    ttsVoice: stored.ttsVoice || envTTSVoice()
  }
}

const invalidPayload = (): never => {
  throw new Error('Invalid settings payload')
}

type TokenAction = { action: 'keep' } | { action: 'set'; value: string }

const parseTokenAction = (raw: unknown): TokenAction => {
  if (!isPlainObject(raw)) invalidPayload()
  const value = raw as Record<string, unknown>
  if (value.action === 'keep') return { action: 'keep' }
  if (value.action === 'set') {
    if (typeof value.value !== 'string' || value.value === '') invalidPayload()
    return { action: 'set', value: value.value as string }
  }
  return invalidPayload()
}

const parseOpenClawInput = (raw: unknown): OpenClawInput => {
  if (!isPlainObject(raw)) invalidPayload()
  const value = raw as Record<string, unknown>
  if (value.mode === 'auto') return { mode: 'auto' }
  if (value.mode === 'manual') {
    if (typeof value.baseURL !== 'string' || value.baseURL === '') invalidPayload()
    return {
      mode: 'manual',
      baseURL: value.baseURL as string,
      token: parseTokenAction(value.token)
    }
  }
  return invalidPayload()
}

const parseOpenAIKeyInput = (raw: unknown): OpenAIKeyInput => {
  if (!isPlainObject(raw)) invalidPayload()
  const value = raw as Record<string, unknown>
  if (value.action === 'keep') return { action: 'keep' }
  if (value.action === 'clear') return { action: 'clear' }
  if (value.action === 'set') {
    if (typeof value.value !== 'string' || value.value === '') invalidPayload()
    return { action: 'set', value: value.value as string }
  }
  return invalidPayload()
}

const parseSettingsInput = (raw: unknown): SettingsInput => {
  if (!isPlainObject(raw)) invalidPayload()
  const value = raw as Record<string, unknown>
  const openClaw = parseOpenClawInput(value.openClaw)
  const openaiApiKey = parseOpenAIKeyInput(value.openaiApiKey)
  if (typeof value.ttsModel !== 'string' || typeof value.ttsVoice !== 'string') invalidPayload()
  return {
    openClaw,
    openaiApiKey,
    ttsModel: value.ttsModel as string,
    ttsVoice: value.ttsVoice as string
  }
}

// The prospective override, computed from the input and the *currently* stored override, before
// anything is written.
const nextOverrideFor = (input: OpenClawInput, current: StoredOpenClaw): StoredOpenClaw => {
  // mode:'auto' clears the stored pair — this is the OpenClaw "clear" action.
  if (input.mode === 'auto') return null

  const target = parseBaseURL(input.baseURL)

  // Decision 2: a freshly submitted token may establish credentials for any origin.
  if (input.token.action === 'set') {
    return { token: input.token.value, baseURL: target.toString() }
  }

  // action === 'keep': carry the stored token only if it was configured for this same origin.
  // Otherwise the stale token is dropped (never recombined with a new origin), while the user's
  // chosen base URL is still honoured as a token-less override (decision 8).
  if (current && current.token !== '' && new URL(current.baseURL).origin === target.origin) {
    return { token: current.token, baseURL: target.toString() }
  }
  return { token: '', baseURL: target.toString() }
}

const applyKeyAction = (input: OpenAIKeyInput, stored: string): string => {
  if (input.action === 'set') return input.value
  if (input.action === 'clear') return ''
  return stored
}

const writeStored = (settings: StoredSettings): void => {
  const path = configPath()
  const dir = dirname(path)
  const tmp = join(dir, `config.json.${process.pid}.tmp`)
  const json = JSON.stringify(settings, null, 2)

  mkdirSync(dir, { recursive: true })
  // 0600 keeps the token and key readable only by the owner. POSIX-only; the mode is ignored on
  // Windows and on an existing file, hence the explicit chmod below.
  writeFileSync(tmp, json, { mode: 0o600 })
  chmodSync(tmp, 0o600)
  // A rename within the same directory is atomic, so a reader never sees a half-written config.
  renameSync(tmp, path)
}

export const saveSettings = (raw: unknown): SettingsSaveResult => {
  const input = parseSettingsInput(raw)
  const stored = readStored()
  const currentOverride = storedOpenClaw(stored)

  // Snapshot the effective OpenClaw before writing, so openClawChanged reflects a real change to
  // what a provider would use — clearing an override that changes the effective values counts too.
  const before = resolveOpenClaw(currentOverride)

  const nextOverride = nextOverrideFor(input.openClaw, currentOverride)

  // Resolve the prospective state, which now sees any freshly submitted token because it was put
  // into nextOverride first. That is how a brand-new token authorizes itself for a new origin.
  const next = resolveOpenClaw(nextOverride)

  // Single refusal, scoped so clearing stays possible: a manual save must land on a usable token.
  // mode:'auto' may legitimately land on 'none' — that is how a user deletes a stored credential,
  // and the setup gate that follows is the correct consequence, not an error.
  if (input.openClaw.mode === 'manual' && next.token === '') {
    throw new Error('Enter the OpenClaw token for this gateway.')
  }

  const toWrite: StoredSettings = {
    // Never persist the detected token — only the five stored fields.
    openClawToken: nextOverride?.token ?? '',
    openClawBaseURL: nextOverride?.baseURL ?? '',
    openaiApiKey: applyKeyAction(input.openaiApiKey, stored.openaiApiKey),
    ttsModel: input.ttsModel,
    ttsVoice: input.ttsVoice
  }

  writeStored(toWrite)

  const openClawChanged = before.token !== next.token || before.baseURL !== next.baseURL
  return { view: getSettingsView(), openClawChanged }
}

const parseTestInput = (raw: unknown): { token: string; baseURL: string } => {
  if (!isPlainObject(raw) || typeof raw.token !== 'string' || typeof raw.baseURL !== 'string') {
    invalidPayload()
  }
  const value = raw as { token: string; baseURL: string }
  return { token: value.token, baseURL: value.baseURL }
}

// Decision 3: this live /v1/models fetch is a readiness/correctness check, NOT a trust boundary. It
// only confirms the gateway answers and the chat endpoint is reachable; it never grants trust. The
// same origin rule as resolveOpenClaw applies, so an implicit token is only ever tried against its
// own origin. This never throws.
export const testOpenClawConnection = async (raw: unknown): Promise<SettingsTestResult> => {
  try {
    const { token: rawToken, baseURL: rawBaseURL } = parseTestInput(raw)

    const override = storedOpenClaw(readStored())
    const resolved = resolveOpenClaw(override)
    const target = parseBaseURL(rawBaseURL.trim() || resolved.baseURL)

    const submitted = rawToken.trim()
    // A freshly submitted credential may be tried against any origin. Otherwise fall back to an
    // implicit token — but only one whose own origin matches the target. Reuse resolved.detection,
    // the single detection snapshot this call already took, so resolution and testing can never
    // disagree about the OpenClaw config.
    const token =
      submitted !== ''
        ? submitted
        : (tokenForOrigin(target.origin, override, resolved.detection)?.token ?? '')

    // A no-auth gateway needs no token at all: only trust that when nothing was submitted and
    // detection itself found the no-auth gateway at this exact target origin.
    const noAuthGateway =
      submitted === '' && resolved.detection.noAuth && resolved.detection.origin === target.origin

    if (token === '' && !noAuthGateway) {
      return { ok: false, message: 'Enter the OpenClaw token for this gateway.' }
    }

    const response = await fetch(modelsEndpoint(target), {
      headers: token !== '' ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(5000)
    })

    if (response.ok) {
      return { ok: true, message: 'Connected to OpenClaw.' }
    }
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        message: `OpenClaw rejected the token (HTTP ${response.status}); check the token.`
      }
    }
    if (response.status === 404) {
      return {
        ok: false,
        message:
          'The OpenClaw chat-completions endpoint looks disabled (HTTP 404). Enable it with:\n' +
          '  openclaw config set gateway.http.endpoints.chatCompletions.enabled true\n' +
          '  openclaw gateway restart'
      }
    }
    return { ok: false, message: `HTTP ${response.status}` }
  } catch (err) {
    // Includes URL validation errors — surface the message instead of throwing.
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
