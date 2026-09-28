# Glowpulse-pro — working notes

## Delivering changes

**After every fix, send the updated files to the user, always.** Not a summary of
the change — the files themselves:

- `jarvis-worker.js` — whenever the worker changed
- `jarvis-desktop/dist/index.html` — whenever the page changed
- `jarvis-desktop/mic-test.html` — whenever the mic test changed
- `jarvis-desktop.zip` — the whole `jarvis-desktop/` folder, rebuilt, every time
  any file inside it changed

Build the zip so it unpacks to a `jarvis-desktop/` folder, matching the layout
the user already has, so it drops straight in:

```bash
cd /home/user/Glowpulse-pro && rm -f /tmp/jarvis-desktop.zip && \
  zip -qr /tmp/jarvis-desktop.zip jarvis-desktop \
  -x 'jarvis-desktop/node_modules/*' 'jarvis-desktop/src-tauri/target/*' \
     'jarvis-desktop/src-tauri/gen/*'
```

Send them with SendUserFile. Committing and pushing is not a substitute — the
user works from the files, not from the branch.

## Layout

Two deployables, separate: `jarvis-worker.js` is the Cloudflare Worker holding
every secret; `jarvis-desktop/` is the Tauri app whose entire frontend is the
single file `dist/index.html`.

## Things that bite here

- **The page is one file with no build step.** No bundler, no imports of its
  own — edit `dist/index.html` directly. It is ~500KB, so edit by targeted
  replacement, never by rewriting the file.
- **Tauri, not Electron.** `-webkit-app-region` does nothing; window dragging
  needs `data-tauri-drag-region`. A CSS `mask` does not create a hole in
  hit-testing — only stacking or `clip-path` does.
- **Elements can exist with no stylesheet.** Several ids and state classes were
  toggled by live code and styled nowhere, so the behaviour ran invisibly. When
  adding a class or element, check the CSS actually exists for it.
- **Check the page against the worker.** Every endpoint the page fetches must
  exist in `jarvis-worker.js`, and every `invoke()` name must match
  `generate_handler!` in `src-tauri/src/main.rs`.
- **Push-to-talk (the `\` key since 2.9.2 — Caps Lock before, which left
  Windows stuck in capitals; PTT_CODE in main.rs) gates `startListening()`.** While
  `pttMode` is on, nothing opens the microphone unless `pttHeld` — every
  automatic restart ends there. Whether a recording is a key recording is fixed
  when it starts (`myPtt`); endpointing, speculation and the echo guard are
  skipped for it. A build whose Rust lacks `push_to_talk_key` stays hands-free.
- **Before worker 2.5.1, /stt answered 200 with empty text when every model
  FAILED** (allowance spent, binding broken) — indistinguishable from silence,
  so he said "Say that again?" or nothing. The page now tells them apart by
  the `tried` list; keep that working for workers that are not redeployed.
- **The multi-agent Supervisor (2.8.0 / worker 2.6.0).** AGENT_REGISTRY
  (19 personas) lives ONLY in jarvis-worker.js — GET /agents is the one
  source of truth; the page fetches it and builds each persona's system
  prompt + tool list from it (agentToolDefs() in index.html). Never hand-copy
  an agent's tool list into the page without it also being in the worker's
  registry, and vice versa — `supervisor.e2e.mjs` in the test set checks this
  cross-file consistency and has already caught one real miss
  (workspace_list_dir defined but never added to agentToolDefs()).
  JARVIS himself reads the system back through agent_system_info (2.8.1,
  read-only: /agents, /approvals/pending, /events/recent, /memory, each
  failing on its own), and his prompt carries the roster built from the
  cached registry — never a hand-written list of agents.
  Approval is required ONLY for filesystem.write and git.write (the Coding
  Agent) — shopify.write/whatsapp.send/phone.call stay exactly as already
  shipped (log-gated, no approval step; see handleShopify's own comment).
  Don't "fix" that inconsistency; it's a deliberate, already-made choice.
  shell.execute, payments.read/write and production.deploy are granted to
  NOBODY and enforced in agentHasPermission() regardless of what a registry
  entry says — never wire a real capability to any of those three.
  Four agents (competitor, news, analytics, inventory — SERVER_RUNNABLE_
  SCHEDULED_AGENTS) run server-side from the Cron Trigger via
  runAgentInWorker's own tiny tool loop (search_web/read_page/remember,
  plus shopify_admin_query for the latter two); everything else runs
  client-side via runAgentPersona, reusing JARVIS's own tool
  implementations (callSearchWebTool etc.) rather than reimplementing
  them. shopify_admin_query is read-only for analytics/inventory IN
  PRACTICE, not just by convention: checkToolPermission upgrades a
  mutating query to shopify.write and refuses it before dispatch runs,
  and neither agent's registry entry holds that permission — a scheduled
  run cannot write to the store no matter what it asks for. Store Manager
  itself (which DOES hold shopify.write) is deliberately NOT in that set —
  an unattended store manager on a timer is a much bigger decision than a
  read-only reporting agent, and was not asked for. The Coding Agent's
  filesystem/git tools are confined
  to one folder (dirs_next::data_dir()/jarvis-workspace) by
  resolve_in_workspace in main.rs — canonicalize-and-starts_with, which is
  what actually catches a symlink escape; a plain string check on the
  unresolved path does not. There is deliberately no shell.execute tool at
  all — workspace_git only runs a fixed allowlist of git subcommands via
  Command::arg, never a shell string.
- **Gemini 3 refuses a replayed tool call without its thought signature**
  (worker 2.6.2). It arrives on `tool_calls[].extra_content.google.
  thought_signature`; the worker puts it on the tool_use block as
  `thought_signature` (streamed: in content_block_start, or a
  `thought_signature_delta`), the page sends blocks back verbatim, and the
  worker replays it to Google (placeholder `skip_thought_signature_validator`
  when absent) and strips it before Anthropic. Its 400 says "model", so
  without this every tool round on Gemini failed over — to a blind engine,
  losing any picture. A picture reaching an engine that cannot see is now
  described by Workers AI first (runEngineChain), never silently stripped.
- **Google Calendar is connected from the app** (worker 2.6.3 / page 2.8.3).
  Only GOOGLE_CLIENT_ID/SECRET are secrets; "connect my calendar" →
  connect_google_calendar → POST /calendar/connect → Google consent (signed
  15-min state, prefix `calendar-state.` so it is never a session token) →
  public GET /calendar/oauth → refresh token + account email in jarvis_meta
  `google_calendar`. Every calendar reply carries `calendar` (whose). The
  consent URL goes to the browser, never to the model.
  googleClient() cleans both values (whitespace, quotes, a pasted label):
  a dirty secret only fails at the LAST step, as invalid_client, after he
  has approved everything — and each oauth failure names its own fix.
- **"Ran" is not "worked".** turnToolSucceeded (set from the RESULT, not the
  dispatch) gates the voice's held claims and a second corrective pass for
  "every tool failed, yet he says done". roundBoundary() sends '\n' to the
  voice between rounds — without it the last sentence of one round and the
  first of the next were glued into one, and a correction was held along
  with the false claim it followed. Hebrew negation (לא/אל before the verb)
  is not a claim.
- **Screen watching (2.9.0) needs the rebuilt app.** "Can you see my
  screen" → every message carries a fresh capture from capture_screen_frame
  (main.rs; 1280px PNG, never written to disk — take_screenshot's saving
  stays for real screenshots) until "thank you jarvis" and the like, or ten
  quiet minutes. Start/end are matched in handleSend by screenWatchCommand
  BEFORE the local command detectors (else "look at my screen" is the
  camera's "look at this"), and the capture is added after the message is
  drawn and only when it goes to the model. Only the newest capture is sent;
  stopping drops them all from chatHistory (dropScreenFrames), or the last
  one kept riding along after "thanks". The watch_screen tool puts its
  capture BESIDE the tool_result (payload.__attach), never inside it — inside
  it reaches every non-Anthropic engine as base64 text. A build without
  capture_screen_frame refuses honestly; it never falls back to
  take_screenshot, which would save a file per sentence.
- **Blind engines get the picture DESCRIBED, and the describers must work
  (worker 2.6.5).** Llama 3.2 Vision is licence-gated (5016 until "agree" —
  the user's decision, never sent automatically) and LLaVA takes a byte array
  that a screen capture makes enormous; with only those two, every screen
  frame reached a text engine as the "backend limitation" placeholder. Llama 4
  Scout and Gemma 3 go first (chat `messages` with an `image_url` data URL;
  answer in `response`). When all fail, `X-Jarvis-Blind-Why` names each —
  keep it ASCII, it is a header. Images inside a `tool_result` are lifted out
  beside the results (liftToolResultImages): the OpenAI shape has no image in
  a tool message. The page sends screen captures as JPEG (screenFrameAsJpeg,
  PNG fallback); test stubs matching describer names need `scout|gemma` too.
- **"Open YouTube" is opened locally (2.9.1)**, like the camera: the
  open_site flow (OPEN_SITES, anchored to the whole sentence, last in
  FLOW_RULES, in SELF_CONTAINED_FLOWS) calls callOpenUrlTool itself. Fallback
  engines answered "I called open_url to open YouTube" — read aloud as "open
  underscore url" — and sometimes called nothing. ACTION_CLAIM_TOOL makes
  "I called/used <snake_case>" a claim; humaniseToolTalk turns a real one
  into "I opened YouTube" (screen and voice), speakableToolTalk strips any
  leftover underscores for the voice. On the website open_site returns
  false and the model answers as before.
- **A turn with a picture in it is a turn ABOUT the picture (2.9.3).** While
  watching his screen, every description ("a button with an icon on it",
  "two orders marked done", "Created 3 hours ago", "הזמנות שבוצעו") was held
  by the voice gate as an unbacked "I did it", so screen mode went silent and
  ended every turn with "I did not actually do that" plus a corrective round.
  turnIsLook (set in askJarvis from the turn's images) switches claimsAnAction
  to the strict set: first-person verbs, tool names, a bare "Done."/"Opened,
  sir.", Hebrew first-person verbs — not בוצע/הנה לך/mid-sentence "done".
  "done"/"on it" also no longer count mid-sentence anywhere. And a dozing
  orb strips the wake word AND its filler ("can", "you", "look"), so "hey
  jarvis you see my screen" reaches screenWatchCommand as "see my screen" —
  the anchored start patterns for those stripped shapes must stay.
- **He says "sir" / "אדוני" once a reply (2.9.3)** — in both prompts, in the
  canned lines, and on every local-flow line via addressHim() (not on a
  failure, never twice). CLAIM_COURTESY allows the ", sir".
- **"Make a 3D model of it" is studied first (page 2.9.3 / worker 2.6.6).**
  photo_to_3d has two steps enforced in code: without `analysis` it only
  takes the picture (camera / screen / attached, pick3dPicture), keeps it
  as pending3d and hands it to the model BESIDE the result; only a second
  call with that image_id and an analysis covering all six sides,
  proportions, materials and symmetry (check3dAnalysis) sends anything.
  materials → Meshy texture_prompt (≤800), symmetry → symmetry_mode, an
  optional crop cuts the object out first. MODEL3D_OF_IT_NOTE steers every
  engine to it for the turn. A finished job opens the model window itself,
  and each poll refreshes lastThinkStart (the 45 s stall breaker otherwise
  "released" a two-minute job). The model window is frameless and
  transparent (main.rs; `.transparent` is cfg-gated off macOS), in the
  taskbar, closed from model.html's own right-click menu, moved by
  Shift/Alt-drag — which needs capabilities/model.json (close,
  start-dragging), or the calls are refused.
- **The level meter reads 8-bit samples with a floor of about 0.0055.** Any
  live signal, however faint, reads one step of the scale; "room 0.0056" in
  mic-test is that floor, not the room.
- **`mic-test.html` deliberately duplicates the detector's maths.** If the VAD
  constants or the RMS calculation change in `dist/index.html`, change them
  there too or the tool starts lying.

## Verifying without a build

Rust: `rustfmt --edition 2021 --check src-tauri/src/main.rs` (exit 0 or 1 means
it parses; 101 is a real syntax error). The full Tauri build needs Windows or
macOS and is not runnable here — but main.rs CAN be really type-checked for
Windows: `rustup target add x86_64-pc-windows-msvc`, copy `src-tauri/` and
`dist/` into the scratchpad, and run `cargo check --target
x86_64-pc-windows-msvc` there with `CARGO_TARGET_DIR` in the scratchpad too
(about 2 minutes cold, seconds warm). It resolves the real Tauri, plugin and
windows-sys APIs, and a broken file fails it, so run it after every Rust
change. It also puts the resolved crates' source under `~/.cargo/registry/src`
to read — check that version, not a guessed one (global-hotkey 0.8 is not
0.7).

The real microphone pipeline (getUserMedia with its processing, the real
MediaRecorder) can be driven with Chromium's `--use-fake-device-for-media-stream
--use-fake-ui-for-media-stream --use-file-for-fake-audio-capture=file.wav`.
Capture the body POSTed to `/stt` and decode it in the page with
`OfflineAudioContext.decodeAudioData` to see exactly what Whisper receives.

The worker runs under plain Node — import it as an ES module, stub
`globalThis.fetch`, and drive it through `worker.fetch(new Request(...), env)`.
It exports `__test` for cooldown and chain inspection.

The page's CSS can be checked in the pre-installed Chromium via Playwright
(`/opt/node22/lib/node_modules/playwright`), forcing state by setting
`document.documentElement.className`. Wait out any transition before reading
`getComputedStyle`, or you read the value at the start of the animation.

A backslash-u escape typed into a tool command does not always arrive as
typed: in some commands (python3 -c, a quoted heredoc) it has arrived as the
character itself, in others as the six characters — and Python reading a
file behaves normally, so it is not Python. In JS source both spellings mean
the same, so behaviour is unaffected; but a replacement that searches for the
escaped spelling can miss, and a test can pin the wrong form. After writing,
grep the file for what actually landed, and match on text with no escapes
in it where you can.

When patching with a Python script that collects edits in a string and writes
once at the end, an assertion failure on a later edit silently discards every
earlier one — the "ok" lines already printed are a lie. Write the file inside
the helper after each successful replacement, or re-grep afterwards to confirm
what actually landed. This has cost real time three times.

The page's whole script lives inside `(function(){ "use strict"; ... })()`, so
nothing is on `window` except the handful of explicit `window.__orb*` hooks.
Playwright cannot call `liveActive()`, `grabLiveFrame()` or `applyLanguage()` —
drive the DOM instead (click the real buttons, read `srcObject`, read classes),
or slice the function out by string index and run it in a harness.

`tauri.conf.json` being valid JSON proves nothing — validate it against Tauri's
own schema, which ships inside the CLI package: `npm pack @tauri-apps/cli@2`,
then `package/config.schema.json`. `bundle.macOS.infoPlist` is a *path to* a
plist, so an inline object there is good JSON that fails the build on every
platform. Reason strings go in `src-tauri/Info.plist`, which Tauri picks up on
its own. And never let PowerShell write the file: `Set-Content -Encoding UTF8`
adds a BOM in 5.1, and serde rejects a BOM as "expected value at line 1
column 1".

Serve `dist/` over http for anything touching storage — `localStorage` throws on
`file://`. The auth gate can be set aside with
`document.getElementById('authGate').style.display='none'`; everything behind it
is ordinary DOM and drives normally.

**The 3D viewer CAN be rendered here, despite the CDN being blocked.** jsdelivr
is refused by the egress proxy but npm is not: `npm pack three@0.128.0`, unpack
it, and serve `build/three.min.js` plus the `examples/js/` addons locally.
Launch Chromium with `--use-gl=swiftshader --enable-unsafe-swiftshader` and
WebGL works. Slice `mountModelViewer` straight out of `index.html` by string
index into a harness rather than retyping it, so what runs is the real function.
Framing and clipping are then measurable: project a model's bounding-box corners
with `vec.project(camera)` and check the result stays inside NDC -1..1.
