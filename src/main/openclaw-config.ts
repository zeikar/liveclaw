// Reads OpenClaw's own config file to guess a token, base URL, and endpoint availability so the
// user doesn't have to hand-copy them into LiveClaw. This is a best-effort guess: the config file
// cannot reveal a CLI `--port` override, an `OPENCLAW_GATEWAY_PORT` env override, a token that
// OpenClaw resolves via interpolation, or whether an endpoint flag has gone stale since OpenClaw
// last started. Never throw here — a bad or missing OpenClaw config just means "fall back to
// manual configuration".
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import JSON5 from 'json5'

const DEFAULT_GATEWAY_PORT = 18789

export interface OpenClawDetection {
  path: string
  /** Empty string means no literal token was detected. */
  token: string
  baseURL: string
  /** Origin the detected gateway is configured for; null when no usable gateway was detected. */
  origin: string | null
  /** True when the gateway itself requires no auth token (gateway.auth.mode === 'none'). */
  noAuth: boolean
  chatCompletionsEnabled: boolean
  error: string | null
}

export function openClawConfigPath(): string {
  return process.env.OPENCLAW_CONFIG_PATH?.trim() || join(homedir(), '.openclaw', 'openclaw.json')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function detectionResult(baseURL: string, error: string | null): OpenClawDetection {
  return {
    path: openClawConfigPath(),
    token: '',
    baseURL,
    origin: null,
    noAuth: false,
    chatCompletionsEnabled: false,
    error
  }
}

export function detectOpenClaw(): OpenClawDetection {
  const path = openClawConfigPath()
  const defaultBaseURL = `http://127.0.0.1:${DEFAULT_GATEWAY_PORT}/v1`

  let raw: unknown
  try {
    const contents = readFileSync(path, 'utf-8')
    raw = JSON5.parse(contents)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return detectionResult(defaultBaseURL, `No OpenClaw config at ${path}.`)
    }
    const message = err instanceof Error ? err.message : String(err)
    return detectionResult(defaultBaseURL, message)
  }

  if (!isPlainObject(raw)) {
    return detectionResult(defaultBaseURL, `OpenClaw config at ${path} is not a JSON object.`)
  }

  const gateway = isPlainObject(raw.gateway) ? raw.gateway : {}
  const isValidPort =
    typeof gateway.port === 'number' &&
    Number.isInteger(gateway.port) &&
    gateway.port >= 1 &&
    gateway.port <= 65535
  const port = isValidPort ? (gateway.port as number) : DEFAULT_GATEWAY_PORT
  const baseURL = `http://127.0.0.1:${port}/v1`

  const auth = isPlainObject(gateway.auth) ? gateway.auth : {}
  const rawToken = auth.token
  const mode = auth.mode
  const noAuth = mode === 'none'
  const modeAllowsToken = mode === 'token' || mode === undefined
  const isLiteralToken =
    typeof rawToken === 'string' && rawToken.length > 0 && !rawToken.includes('${')

  let token = ''
  let error: string | null = null
  if (noAuth) {
    // The gateway itself requires no auth token — nothing to detect, and nothing to error about.
  } else if (isLiteralToken && modeAllowsToken) {
    token = rawToken
  } else {
    error = 'OpenClaw is not using a literal gateway token; enter one manually.'
  }

  const http = isPlainObject(gateway.http) ? gateway.http : {}
  const endpoints = isPlainObject(http.endpoints) ? http.endpoints : {}
  const chatCompletions = isPlainObject(endpoints.chatCompletions) ? endpoints.chatCompletions : {}
  const chatCompletionsEnabled = chatCompletions.enabled === true

  return {
    path,
    token,
    baseURL,
    origin: token || noAuth ? new URL(baseURL).origin : null,
    noAuth,
    chatCompletionsEnabled,
    error
  }
}
