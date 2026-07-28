// Ambient (import-free) global types for the realtime STT bootstrap channel. Like settings.d.ts,
// this file has no top-level import/export so it stays a global script.

// Structurally compatible with @charivo/stt/openai-realtime's bootstrap signature, but declared here
// so main and preload never import a renderer-side package just to type the channel.
type RealtimeSTTBootstrapRequest = {
  sdpOffer: string
  session: {
    model: string
    language?: string
  }
}

type RealtimeSTTBootstrapResult = {
  answerSdp: string
}
