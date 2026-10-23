# JARVIS desktop: phone calls through ringback

## Goal
He says "Jarvis, call me" (or Jarvis needs him) and his phone rings; a two-way voice
call follows with JARVIS as the brain. Desktop app only. Success: with ringback
configured, `phone_call` rings his Linphone app, `phone_say` carries the conversation,
`phone_hangup` ends it; with ringback missing, JARVIS says exactly what is missing and
never pretends to dial.

## Not in scope (v1)
- Hebrew speech on the call (ringback ships English STT `small.en` and an English Piper
  voice). Follow-up: multilingual whisper model + `VOICE_TTS_CMD` using JARVIS's own voice.
- The website and the worker. The existing `call_me` tool (CallMeBot via the worker) is
  untouched and stays the one-way option.
- Dialling anyone but him: ringback only calls the single SIP URI configured.

## Facts about ringback (read from its README, not assumed)
- An MCP server over stdio, run locally. Tools: `call_start(opening_line)`,
  `converse(text)`, `get_conversation()`, `speak`, `listen`, `call_end(text)`,
  `call_status()`; and `alert_me` in the separate `ringback-alert` server.
- No model of its own: the caller is the brain. ~1-2 s per turn, barge-in supported.
- On Windows it runs in Docker Desktop (`ghcr.io/mohitbadwal/ringback:latest`); media
  needs `VOICE_STUN` because Docker Desktop's NAT drops return RTP.
- Needs `VOICE_SIP_ID`, `VOICE_SIP_USER`, `VOICE_SIP_PASS` (a Linphone SIP account) and the
  Linphone app on his phone signed in to the same account.

## Design
### App (Rust) - new `src-tauri/src/ringback.rs`
- Lazily spawns `docker run -i --rm -e VOICE_STUN=... --env-file <JARVIS>\ringback.env <image>`
  on first use; one process; speaks MCP JSON-RPC (initialize, tools/call) on stdio.
- Commands, registered in `generate_handler!` (permissions regenerate from `build.rs`):
  `ringback_status` (configured? docker present? image pulled? running?),
  `ringback_call(tool, args)`, `ringback_stop`.
- Credentials live only in `ringback.env` in the app folder: never in page storage,
  never sent to the worker. Child is killed on app exit, on `ringback_stop`, and after 20
  minutes of call.
### Page (`dist/index.html`)
- Tools `phone_call`, `phone_say`, `phone_hangup`, offered only when `IS_DESKTOP` and
  `ringback_status` reports ready. Dispatch via `invoke('ringback_call', ...)`.
- While a call is up the orb's own microphone and speech are paused (no echo, no double
  talk) and the tool-round limit rises from 10 to 40 for that turn.
- Not ready -> the model gets a tool-less turn plus a note naming what is missing.
- Calls only when he asks. One call at a time.
### Setup for him
- `JARVIS-RINGBACK-הגדרה.txt` (Hebrew steps) and `ringback.env.example`.
- Steps: Docker Desktop running; Linphone account (already has one) and app signed in;
  fill `ringback.env`; one-time `docker pull`; say "check ringback".

## Testing
- Protocol framing against a fake MCP server (Python), run from a harness.
- Page tools against a mocked `invoke` in Chromium (ready / not ready / call / hangup).
- `rustfmt --edition 2021 --check` on the Rust. The Tauri build and a real call cannot run
  here (needs Windows, SIP, a phone): he tests those; the Rust change needs an app rebuild.

## Risks
- Docker Desktop one-way audio if STUN is blocked.
- GPL pjproject inside the image (fine for personal use; see ringback NOTICE).
- English-only calls until the Hebrew follow-up.
