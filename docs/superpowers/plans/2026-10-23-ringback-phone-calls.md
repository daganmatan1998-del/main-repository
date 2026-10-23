# Ringback Phone Calls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** JARVIS (desktop app only) can ring the user's phone and hold a two-way voice call through the ringback MCP server running in Docker.

**Architecture:** A pure-std Rust module `ringback.rs` (no Tauri imports, so it compiles and tests standalone) owns the MCP stdio client, env-file parsing and the `docker run` command. Three thin Tauri commands in `main.rs` wrap it. The page gets three tools (`phone_call`, `phone_say`, `phone_hangup`) that go through `invoke`, and a call mode that pauses the orb's own mic and voice.

**Tech Stack:** Rust (std + `serde_json`, already a dependency), Tauri 2 commands, vanilla JS in the single `dist/index.html`, Playwright/Chromium for page tests, a Python fake MCP server for protocol tests.

**Spec:** `docs/superpowers/specs/2026-10-23-ringback-phone-calls-design.md`

## Global Constraints

- `dist/index.html` is one file with no build step: edit by targeted replacement, never rewrite it (`CLAUDE.md`).
- Every tool `input_schema` must have a non-empty `properties` (Gemini rejects empty ones; fixed once already in `callClaudeOnce`).
- Every `invoke()` name must match `generate_handler!` in `src-tauri/src/main.rs`; `build.rs` derives permissions from that list, so do not hand-edit `permissions/`.
- Declare any `let`/`const` before first use (temporal dead zone has broken this page before).
- Credentials live only in `ringback.env` on disk: never `localStorage`, never the worker, never chat.
- ringback dials only the SIP URI in its env file; the Rust side must refuse any MCP tool outside `call_start`, `converse`, `call_end`, `call_status`, `get_conversation`.
- Docker image: `ghcr.io/mohitbadwal/ringback:latest`; default `VOICE_STUN=stun.l.google.com:19302` (Docker Desktop on Windows needs STUN or audio is one-way).
- Call hard cap: 20 minutes. Tool rounds per turn: 10 normally, 40 during a call.
- v1 calls are English (ringback ships `small.en` STT and an English Piper voice).
- Verify the Rust with `rustfmt --edition 2021 --check` (exit 0/1 fine, 101 = syntax error) and a standalone `cargo test` of `ringback.rs`; the Tauri build and a real call cannot run here.
- After any change, send the user `jarvis-worker.js` (if changed), `dist/index.html`, `JARVIS-SITE.zip` and `jarvis-desktop.zip` via SendUserFile; committing is not delivery.

## Review Focus

1. Docker missing or not running -> `ringback_status` names it; a call returns a `tell_the_user` error instead of hanging.
2. `ringback.env` written on Windows: CRLF endings, a UTF-8 BOM, `export KEY="v"` lines, quotes, comments, placeholder values such as `CHANGE_ME` -> parsed correctly, placeholders count as missing.
3. ringback exits mid-call (container stopped, phone hung up) -> next call errors cleanly, client is dropped, the page leaves call mode and the mic/voice come back.
4. The model asks for a tool outside the whitelist or sends an empty `opening_line` -> rejected before anything reaches ringback.
5. A call running past 20 minutes, or the app quitting -> the child is killed (stdin closing also ends the `--rm` container).

---

### Task 0: Bring the repo up to the delivered app

**Files:**
- Modify: whole `jarvis-desktop/` (replace with the user's current folder, plus the fixes already delivered this session)

**Interfaces:**
- Produces: a repo whose `jarvis-desktop/dist/index.html` is the version the user runs (`APP_VERSION = '2.30.1'`), so later commits are small diffs.

- [ ] **Step 1:** From the working extract (`/tmp/claude-0/x/desk/jarvis-desktop`), replace the repo's `jarvis-desktop/` with it, excluding `node_modules/`, `src-tauri/target/`, `src-tauri/gen/`.
- [ ] **Step 2:** Verify: `grep -c "APP_VERSION = '2.30.1'" jarvis-desktop/dist/index.html` prints `1` and `grep -c "showOrbError" jarvis-desktop/dist/index.html` prints `2` or more.
- [ ] **Step 3: Commit**

```bash
git add -A jarvis-desktop && git commit -m "Bring jarvis-desktop up to the version on his machine (2.30.1 + delivered fixes)"
```

### Task 1: ringback core (pure Rust, tested standalone)

**Files:**
- Create: `jarvis-desktop/src-tauri/src/ringback.rs`
- Create: `jarvis-desktop/src-tauri/tests-support/fake_mcp.py` (fake MCP server used only by tests)
- Modify: `jarvis-desktop/src-tauri/src/main.rs` (add `mod ringback;` next to `mod glide;`)

**Interfaces:**
- Produces (all `pub`, std + `serde_json` only):
  - `const ALLOWED_TOOLS: [&str; 5]`
  - `const REQUIRED_ENV: [&str; 3]` = `VOICE_SIP_ID`, `VOICE_SIP_USER`, `VOICE_SIP_PASS`
  - `fn parse_env_file(text: &str) -> BTreeMap<String, String>`
  - `fn missing_env(vars: &BTreeMap<String, String>) -> Vec<&'static str>`
  - `fn docker_args(image: &str, env_file: &Path, vars: &BTreeMap<String, String>) -> Vec<String>`
  - `struct McpClient` with `fn start(cmd: std::process::Command) -> Result<McpClient, String>`, `fn call_tool(&mut self, name: &str, args: serde_json::Value, timeout: Duration) -> Result<String, String>`, `fn is_alive(&mut self) -> bool`, `fn stop(&mut self)`
  - `fn tool_allowed(name: &str) -> bool`

- [ ] **Step 1: Write the failing tests** in `ringback.rs` `#[cfg(test)] mod tests`:
  - `parse_env_handles_windows_files`: input `"\u{feff}# c\r\nexport VOICE_SIP_ID=\"sip:a@sip.linphone.org\"\r\nVOICE_SIP_USER=a\r\nVOICE_SIP_PASS='p w'\r\n"` gives the three keys with unquoted values, no `\r`, no BOM, and the comment ignored.
  - `placeholders_count_as_missing`: `VOICE_SIP_PASS=CHANGE_ME` and an absent `VOICE_SIP_USER` -> `missing_env` returns exactly `["VOICE_SIP_USER", "VOICE_SIP_PASS"]` in `REQUIRED_ENV` order.
  - `docker_args_adds_stun_only_when_absent`: without `VOICE_STUN` in vars the args contain `-e VOICE_STUN=stun.l.google.com:19302`; with it they do not. Both always contain `run -i --rm`, `--env-file <path>`, and end with the image.
  - `tool_whitelist`: `tool_allowed` is true for exactly the five names in `ALLOWED_TOOLS` and false for `speak`, `listen`, `""` and `"call_start; rm"`.
  - `client_round_trip_with_fake_server`: spawn `python3 fake_mcp.py` (answers `initialize`, ignores the `initialized` notification, answers `tools/call` for `call_start` with `{"content":[{"type":"text","text":"hello <arg>"}]}` and for `fail` with `{"isError":true,"content":[{"type":"text","text":"boom"}]}`); assert `call_tool("call_start", {"opening_line":"hi"}, 5s)` is `Ok("hello hi")` and the `isError` case is `Err("boom")`.
  - `client_reports_death_and_timeout`: fake server started with `--exit-after-init` -> `call_tool` returns `Err` containing `"ended"` within the timeout and `is_alive()` is false; fake server started with `--hang` -> `call_tool(.., 300ms)` returns `Err` containing `"timed out"`.
- [ ] **Step 2: Run to verify failure.** Scratch crate: `cargo new --lib /tmp/claude-0/rbtest` (already exists) with `serde_json`; copy `ringback.rs` as `src/lib.rs` and the fake server beside it. Run `cargo test` there. Expected: compile failure (items undefined).
- [ ] **Step 3: Implement the signatures above.** `McpClient::start` spawns with piped stdin/stdout, stderr null, starts a reader thread that forwards each stdout line over an `mpsc::channel`; `initialize` (protocolVersion `2024-11-05`, clientInfo `jarvis`) then a `notifications/initialized` line; requests are one JSON object per line with an incrementing integer `id`; `call_tool` waits with `recv_timeout`, skips lines whose `id` differs, maps `result.isError == true` to `Err(text)`, joins `content[].text` with `"\n"`; a closed channel is `Err("ringback ended")`, a timeout is `Err("ringback timed out after Ns")`. `stop` kills the child and waits. `parse_env_file` strips BOM, `\r`, a leading `export `, matching quotes, ignores blank/`#` lines. Placeholder values (case-insensitive `change_me`, `yourname`, `your-password`, empty) count as missing.
- [ ] **Step 4: Run tests** (`cargo test` in the scratch crate). Expected: all pass. Also `rustfmt --edition 2021 --check ringback.rs` exits 0 or 1.
- [ ] **Step 5: Commit**

```bash
git add jarvis-desktop/src-tauri/src/ringback.rs jarvis-desktop/src-tauri/src/main.rs jarvis-desktop/src-tauri/tests-support
git commit -m "ringback: MCP stdio client, env parsing, docker command (tested standalone)"
```

### Task 2: Tauri commands

**Files:**
- Modify: `jarvis-desktop/src-tauri/src/main.rs` (commands near `open_jarvis_folder`; `generate_handler!`; `.manage(...)`; `.run(...)` exit hook)

**Interfaces:**
- Consumes: Task 1's `McpClient`, `docker_args`, `parse_env_file`, `missing_env`, `tool_allowed`.
- Produces (invoked from the page; every result is JSON with `ok: bool`):
  - `ringback_status() -> {ok, docker: bool, env_path: String, env_found: bool, missing: [String], running: bool, ready: bool, why: String}` (`ready` = docker present AND env found AND nothing missing; `why` is one plain sentence, empty when ready).
  - `ringback_call(tool: String, args: Value) -> {ok, text?: String, error?: String, tell_the_user?: String}`
  - `ringback_stop() -> {ok}`

- [ ] **Step 1:** `struct RingbackState { client: Mutex<Option<ringback::McpClient>>, call_started: Mutex<Option<Instant>> }`, registered with `.manage(...)`. The env file is `dirs_next::config_dir()/JARVIS/ringback.env`.
- [ ] **Step 2:** `ringback_status` checks `docker --version` runs (no daemon query), reads and parses the env file, and never spawns ringback.
- [ ] **Step 3:** `ringback_call` is `async` and does its blocking work in `tauri::async_runtime::spawn_blocking`: refuse a tool that fails `tool_allowed`; if not ready return `ok:false` with `tell_the_user = why`; start the client lazily (`docker_args` -> `Command::new("docker")`); for `call_start` record the start time; if more than 20 minutes since it, stop the client and return `ok:false` with `tell_the_user` "the call hit the 20 minute limit"; call with a 90 s timeout (`converse` waits for speech); on `call_end`, or on any `Err`, stop and drop the client.
- [ ] **Step 4:** Add the three names to `generate_handler!`; change the final `.run(tauri::generate_context!())` to `.build(...).expect(...).run(|app, ev| if let tauri::RunEvent::Exit = ev { stop the client })`.
- [ ] **Step 5: Verify:** `rustfmt --edition 2021 --check jarvis-desktop/src-tauri/src/main.rs` exits 0 or 1; `grep -c "ringback_status\|ringback_call\|ringback_stop" main.rs` shows each name in both the command definitions and `generate_handler!`.
- [ ] **Step 6: Commit**

```bash
git add jarvis-desktop/src-tauri/src/main.rs
git commit -m "ringback: status/call/stop commands, lazy docker child, 20 minute cap, exit cleanup"
```

### Task 3: Page tools and call mode

**Files:**
- Modify: `jarvis-desktop/dist/index.html` (tool definitions beside `CALL_TOOL`; dispatch beside `call_me`; tool offering in `callClaudeOnce` desktop branch; `MAX_TOOL_ROUNDS` loop guard; `startListening`; `enqueueSpeech`; `cameraSystemExtras`)
- Test: `/tmp/claude-0/h/phone.js` (Playwright harness built from the existing `run6.js` pattern: Tauri mock whose `invoke` is scripted)

**Interfaces:**
- Consumes: Task 2's `ringback_status` / `ringback_call` / `ringback_stop` result shapes.
- Produces:
  - `PHONE_CALL_TOOL` `{name:'phone_call', input_schema.properties.opening_line (string, required)}`, `PHONE_SAY_TOOL` `{name:'phone_say', properties.text (string, required)}`, `PHONE_HANGUP_TOOL` `{name:'phone_hangup', properties.text (string, optional goodbye)}`
  - `async function callPhoneTool(name: string, input: object): Promise<object>` (maps `phone_call`->`call_start{opening_line}`, `phone_say`->`converse{text}`, `phone_hangup`->`call_end{text}`)
  - `let phoneCallActive = false`, `let phoneStatus = null`, `async function refreshPhoneStatus(): Promise<void>` (cached 60 s)

- [ ] **Step 1: Write the failing harness test** with a scripted `invoke`: (a) status `ready:true` -> the request body to the (stubbed) worker contains `phone_call`, `phone_say`, `phone_hangup` and none of them has empty `properties`; (b) status `ready:false, why:"Docker is not installed"` -> none of the three tools is offered and the system prompt contains that sentence and the words "never claim to dial"; (c) the stub model answers with a `phone_call` tool_use -> `invoke('ringback_call', {tool:'call_start', args:{opening_line:...}})` is called once and `phoneCallActive` (read through a test hook `window.__phoneTest`) becomes true; (d) while active, `enqueueSpeech('x')` produces no `/tts` request and `startListening()` opens no capture; (e) a `phone_hangup` result, or an `ok:false` result, sets `phoneCallActive` false and speech works again; (f) empty `opening_line` is rejected without an `invoke`.
- [ ] **Step 2: Run** `node phone.js` -> expected: FAIL (tools absent).
- [ ] **Step 3: Implement.** Tool descriptions: `phone_call` only when he asks to be called or to talk by phone, never on its own initiative, plain short English sentences, no code or URLs; `phone_say` carries each turn and returns what he said; end with `phone_hangup` when he says bye. Offer them when `IS_DESKTOP && phoneStatus && phoneStatus.ready`. `callPhoneTool` sets `phoneCallActive = true` on a successful `call_start` and false on `call_end` or any error. Guards: `startListening` returns early and `enqueueSpeech` returns early while `phoneCallActive`; the loop guard uses `phoneCallActive ? 40 : MAX_TOOL_ROUNDS`. The not-ready note goes in `cameraSystemExtras()` (desktop only) and also tells the model `call_me` stays the one-way option. Declare `phoneCallActive` and `phoneStatus` near `silentMode` (above every use). Expose `window.__phoneTest = { get active(){...}, callPhoneTool, refreshPhoneStatus }`.
- [ ] **Step 4: Run** `node phone.js` -> expected: all six checks pass. Re-run `/tmp/claude-0/h/run6.js` (orb click/drag/zoom) and a plain question -> no regressions, no `pageerror`.
- [ ] **Step 5: Commit**

```bash
git add jarvis-desktop/dist/index.html
git commit -m "phone calls: ringback tools, call mode (mic/voice paused), status-gated"
```

### Task 4: Setup files and delivery

**Files:**
- Create: `jarvis-desktop/JARVIS-RINGBACK-הגדרה.txt`, `jarvis-desktop/ringback.env.example`

- [ ] **Step 1:** `ringback.env.example` contains `VOICE_SIP_ID`, `VOICE_SIP_USER`, `VOICE_SIP_PASS` with `CHANGE_ME` placeholders and a comment that the file must be saved as plain `KEY=value` lines at `%APPDATA%\JARVIS\ringback.env`.
- [ ] **Step 2:** The Hebrew guide lists, in order: Docker Desktop installed and running; the Linphone account he already has (username and password from the account page, not the API key; never paste them into chat); the Linphone app on his phone signed in to that account; copy the example to `%APPDATA%\JARVIS\ringback.env` and fill it; `docker pull ghcr.io/mohitbadwal/ringback:latest` once; rebuild the app with `JARVIS-UPDATE.bat`; say "check ringback". It states v1 calls are in English.
- [ ] **Step 3:** Rebuild `JARVIS-SITE.zip` (site files from the same `dist/`) and `jarvis-desktop.zip` using the commands in `CLAUDE.md` adapted to the repo path; confirm `unzip -p ... index.html | grep -c callPhoneTool` is 1 in both.
- [ ] **Step 4:** Send `index.html`, both zips and the two new files with SendUserFile.
- [ ] **Step 5: Commit and push**

```bash
git add jarvis-desktop && git commit -m "ringback: setup guide and env example" && git push -u origin claude/sleepy-newton-c7a93p
```
