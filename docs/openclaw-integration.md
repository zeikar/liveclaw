# OpenClaw integration

Background for the chat backend: how the OpenClaw gateway actually behaves, and why LiveClaw talks to
it the way it does. Setup steps live in the [README](../README.md); the rules an editor must not break
live in [CLAUDE.md](../CLAUDE.md). This file is the reasoning behind both.

Verified against **OpenClaw 2026.6.11** by calling a live gateway. Official reference:
<https://docs.openclaw.ai/gateway/openai-http-api>.

## The endpoint

OpenClaw's gateway exposes an OpenAI-compatible HTTP API on port `18789` (default bind `loopback`),
alongside `/v1/models`, `/v1/embeddings`, and `/v1/responses`.

It is **disabled by default**. There is no `--experimental` CLI flag; it is a plain config opt-in in
`~/.openclaw/openclaw.json` (JSON5, not TOML):

```json5
{ gateway: { http: { endpoints: { chatCompletions: { enabled: true } } } } }
```

Auth is a standard `Authorization: Bearer <token>` using the gateway token (`gateway.auth.token`).
That token is **not a scoped API key** — the docs call the endpoint "full operator access to the
gateway instance." It can drive any tool the agent's policy allows, which is why the token stays in
the main process and never reaches the renderer.

### LiveClaw's auto-detection is a guess, not a trust boundary

The gateway token lives in `gateway.auth.token` in `~/.openclaw/openclaw.json` (JSON5, mode `0600`).
LiveClaw reads it at runtime, but the file is only ever a guess: it cannot show a CLI `--port`
override, an `OPENCLAW_GATEWAY_PORT` env override, a token OpenClaw resolves through `${…}`
interpolation, or whether an endpoint flag has gone stale since OpenClaw last started. So LiveClaw
checks the guess with `GET /v1/models` before presenting the app as configured, and falls back to
manual entry when that check fails. See `src/main/openclaw-config.ts`.

## `model` is an agent target, not a model name

`/v1/models` returns _agents_, not backend models:

```
openclaw          openclaw/default          openclaw/main
```

LiveClaw sends `openclaw/default` — the stable alias for whatever agent the gateway has configured as
default. Passing a real model id (`gpt-4o`) does nothing; a backend model override would be the
`x-openclaw-model` header.

The gateway also reads `x-openclaw-agent-id` to target a specific agent. **LiveClaw deliberately does
not send it.** `@charivo/server` used to hardcode `x-openclaw-agent-id: main`, which fails with a 400
on any gateway whose agent is not literally named `main`. Omitting the header lets the gateway resolve
its own default agent.

## Sessions: the part that matters

The gateway keeps conversation state **server-side**. It is not a stateless OpenAI-style endpoint. But
it derives the session key per request like this:

| Request carries                 | Session key                           |
| ------------------------------- | ------------------------------------- |
| `x-openclaw-session-key` header | that value verbatim                   |
| OpenAI `user` field             | `agent:<agentId>:openai-user:<user>`  |
| neither                         | `agent:<agentId>:openai:<randomUUID>` |

The third row is the trap: **with no identifier, every single request opens a brand-new session.**
Nothing carries over between turns, and each turn strands a throwaway session in the store.

Verified with a nonce against a live gateway:

|                           | turn 1 "remember `ZK93017221793`" | turn 2 "what was the code?"     |
| ------------------------- | --------------------------------- | ------------------------------- |
| no `user` field           | STORED                            | **UNKNOWN**                     |
| `user: "liveclaw:<uuid>"` | STORED                            | **ZK93017221793**               |
| different `user` value    | —                                 | UNKNOWN (isolated, as intended) |

LiveClaw pins the session with the **`user` field**, not the header. The gateway prefixes `user` into
its own namespace, which sidesteps the reserved prefixes (`subagent:`, `cron:`, `acp:`) that make
`x-openclaw-session-key` return 400.

### Consequences for the client

**Do not resend history when the session is pinned.** The gateway flattens whatever `messages[]` you
send into the prompt, on top of the history it already holds — you would inject a duplicate transcript
every turn. `@charivo/server`'s provider therefore drops past turns and sends only the system prompt
plus the newest turn. This looks like a bug if you skim it; it is the point.

**The system prompt is still sent every turn.** It is not needed once the session holds it (verified:
the character persona survived a turn where no system message was sent), but a dropped session would
otherwise make the character silently vanish. Cheap insurance, so no first-turn-only state tracking.

**Rotating the key is the only way to start over.** The key is fixed at provider construction, so a new
conversation means a new provider. The old transcript stays behind under the old key; nothing deletes
it. The OpenAI HTTP surface has no session lifecycle controls (reset/list) — that would need the
gateway's `sessions.*` RPC or the `openclaw` CLI.

## Agent memory is orthogonal to sessions

The OpenClaw agent writes durable notes to its own memory (e.g.
`~/.openclaw/workspace/memory/<date>.md`) and reads them back in later sessions. Observed directly: a
code given in one conversation was recalled in a **freshly rotated session**, because the agent had
written it down.

So "New chat" resets conversation _context_, not the character's _memory_. This is the same split as
Claude Code's own memory, and it cannot be fixed from the app — it is gateway-side agent
configuration.

## Streaming

The gateway supports `stream: true` (SSE, `chat.completion.chunk`, terminated by `data: [DONE]`).
LiveClaw does not use it: `ipcMain.handle('llm:chat')` is a request/response `invoke`, and streaming
would mean converting it to an event channel. Worth doing if TTS/lip-sync latency ever demands it.

## Re-verifying

```bash
# is the endpoint on, and what agents exist?
curl http://127.0.0.1:18789/v1/models -H "Authorization: Bearer $OPENCLAW_TOKEN"

# which session keys has the gateway created?
cat ~/.openclaw/agents/main/sessions/sessions.json | jq 'keys'
#   agent:main:openai:<uuid>            <- one per unidentified request (the leak)
#   agent:main:openai-user:liveclaw:…   <- one per pinned conversation
```
