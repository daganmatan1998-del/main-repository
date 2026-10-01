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
- **Two-hand gesture zoom (page 2.10.0) lives in the CAMERA window**, the
  only webview with the stream: camera.html loads the vendored MediaPipe
  (`dist/vendor/mediapipe`: IIFE bundle, SIMD wasm, hand_landmarker.task —
  no CDN) and `dist/gesture-zoom.js`, which is pure logic above the tracker
  and is tested in Node with REAL landmarks (scratchpad handimgs/
  landmarks.json, from MediaPipe's own test photos). Pinch = thumb tip to
  index tip over palm length (on < 0.30, off > 0.42, two frames each way)
  AND the fist guard (index tip and thumb tip both > 0.38 palm from the
  index knuckle since 2.12.0 — a fist reads 0.20 on the pinch alone). Distance is over
  hand size, so leaning in is not a zoom. Since 2.10.4 it is MOVEMENT
  control, not position: each ~1 cm (1/PALM_CM of a palm, PALM_CM = 9) the
  pinches move apart is one step in, together one step out, counted from an
  anchor that moves one step at a time (no twitching); hands held still do
  nothing; the first `threshold` mm are ignored; "zooming" starts at the
  first real step. ZoomManager sends one notch per step (×STEP_3D = 1.1 for
  our viewer), at most maxSpeed a second, at most a second's worth queued,
  and stops at min/maxZoom. Settings: sensitivity = steps per cm, threshold
  mm, maxSpeed steps/s. Either hand letting go ends it. Rust does only the OS half: `zoom_target`
  (foreground, else the last non-orb/camera window; exe via
  QueryFullProcessImageName, UWP child exe; class; full screen) and
  `zoom_send` (verified-foreground, WindowFromPoint-aimed Ctrl/Alt/plain
  wheel or Ctrl+=/-). Adapters are chosen in JS (selectAdapter) by exe and
  class — Blender gets the PLAIN wheel (Ctrl+wheel pans there), Photoshop
  Alt+wheel, Electron Ctrl+=/-, our model window the direct
  `jarvis://model-zoom` event; unknown windowed apps get Ctrl+wheel (what a
  touchpad pinch sends), unknown full-screen apps nothing. Never resize or
  move a window for it. Settings: orb GESTURES tab → Store key
  gesture_zoom (the camera reads jarvis_store:gesture_zoom) + the
  `jarvis://gesture-settings` event. In the sandbox the GPU delegate runs
  in software at ~600 ms a frame, so tests force `delegate: 'CPU'`; the
  controller itself falls back to CPU when the GPU path averages > 70 ms.
- **Whole hands and precise control (2.12.0).** handMetrics measures the
  WHOLE hand: scale = mean of wrist->knuckles 5/9/13/17 (x PALM_RAY 1.03,
  so the unit is still ~ wrist->middle knuckle) in 3D when landmarks carry
  z (z * width), palm centre = wrist + 4 knuckles, pts = all 21 for the
  overlay. FIST_GUARD is 0.38 (with depth a fist reaches 0.31). Slots are
  assigned by palm centre. The inter-hand zoom distance stays 2D between
  pinch points (per-hand z is relative to its own wrist, so cross-hand z
  means nothing). landmarks.json (2D) and landmarks3d.json (with z and
  world) are the real data; the world landmarks are NOT usable for pinch
  (an OK sign reads 7 cm). HandGestures wraps TwoHandZoom (gesture.state is
  still the zoom's) and adds the turn: exactly one pinch, not latched, held
  TURN_ARM_MS, past TURN_DEAD_MM -> dx (his right = picture LEFT, hence
  the minus) and dy in degrees from the One Euro-filtered palm centre;
  LATCH = any moment with both pinched, cleared only when both open; a
  jump > TURN_JUMP palms in a frame is a glitch. TurnRelay emits
  jarvis://model-rotate {phase, dx, dy} only while a model-pong is under
  TURN_PRESENT_MS old; model.html applies it as a trackball about
  controls.target (axis = camUp*dx - camRight*dy) and the spin is now a
  turn about world-up through the same pivot. The cut-out hands in the
  e2e scenes are big: keep two hands far apart or the tracker sees one.
- **The stall breaker counts work, not text (2.10.1).** lastThinkStart is
  the last sign of life: every stream chunk (readMessageStream), every
  answered request (the callClaude wrapper around callClaudeOnce) and every
  finished tool refresh it. The limit is 45 s of nothing, 180 s while
  `requestsInFlight` > 0, and 10 min while `toolRunningSince` is set. A real
  stall also aborts currentAbortController. Counted from text alone, a 3D
  turn (analysis streamed as input_json_delta, a model thinking before its
  first byte, a minutes-long job) was released mid-work and started over.
  stall.e2e.mjs jumps the page clock; ORB_DIR runs it against an old copy.
- **A bare "create a 3D model" while something is shown IS "of it"
  (2.10.1).** wantsModelOfSeen takes a create verb plus 3D unless another
  object is named ("of a chair", "של כיסא"). Every 3D tool and both prompts
  say infer and state the assumption, never ask for sizes or sides.
- **"Bring the X to this window" (2.10.1)** is the bring_window flow
  (second in FLOW_RULES; its strong "regex" is an object with test() that
  calls bringRequestOf, which is anchored to the whole sentence) and the
  bring_window_here tool, both through callBringWindowTool. Names resolve
  via BRING_TARGETS (own label, exe, title; anything else is searched as
  said). Rust bring_window_here picks "here" (foreground, or the topmost
  real program if ours is in front), sizes it small (bring_size), places
  it bottom-right of here avoiding the orb (bring_place), and moves it with
  SW_SHOWNOACTIVATE + SWP_NOACTIVATE, never stealing focus. Camera
  not_open → opened first (or its window put back if the page thinks it is
  on). Needs Win32_Graphics_Dwm for the cloaked check.
- **Full screen, the orb must not be on top of its own windows (2.10.2).**
  The orb is alwaysOnTop (tauri.conf); expanded it is opaque and
  monitor-sized, so the 3D viewer (not topmost) opened behind it and the
  camera (topmost) fell under it on every click — "camera and 3D do not
  work in full screen". setExpanded calls `orb_layer` (main.rs) before
  setFullscreen(true) and after setFullscreen(false): expanded, the orb is
  not topmost and model/ws-* windows are; ORB_EXPANDED makes a viewer or
  pane created meanwhile start above it. tao only reorders when the flag
  CHANGES. No orb_layer (old build) → makeRoomForOwnWindow leaves full
  screen before opening the camera or viewer. The desktop has NO chat on
  screen (html.tauri #commPanel is display:none), so anything shown only
  there is invisible: build_3d_model now exports a .glb → `stash_model` →
  model.html?glb=stash:KEY → `stashed_model` (data: URL ≤ 900 KB as the
  fallback), and the HUD's TASK line (hudFollow) mirrors the tool status and
  3D job notes. take_screenshot/capture_screen_frame exclude the orb for the
  capture (OrbOutOfCapture, WDA_EXCLUDEFROMCAPTURE) so JARVIS never captures
  himself. fullscreen.e2e.mjs covers the page half.
- **Local commands are understood by meaning, not shape (2.10.3).**
  understandCommand (last step of detectWorkflowCommand, on restNamed, and
  the only step for a sentence over 12 words): LOOSE_FILLER_PHRASES/WORDS
  and his name removed ANYWHERE; every remaining word must be in
  LOOSE_LEXICON (O:thing, ON, OFF, N, WANT, P) — one outside word and it is
  conversation for the model; exactly one thing and one direction → a flow
  in LOOSE_FLOWS. Hebrew prefixes via looseWord. Add a new local action by
  adding its thing and verbs to the lexicon and LOOSE_FLOWS, not by writing
  sentence regexes. Claims: ACTION_CLAIM_GERUND_LED (lead-ins like "Sure,")
  and claimsPromise ("I'll open", אפתח — never offers or conditionals).
  impliedLocalFlow + doImpliedFlow: a no-tool turn whose claim names the
  same thing he asked about (verb directly on it, not negated, not a
  question) is carried out by the app before any corrective round.
  planRequests drops a courtesy-only part ("could you do me a favour").
- **The camera window tries every camera (2.10.4).** "Timeout starting
  video source" is Windows opening a camera that never sends a frame —
  usually the infrared Windows Hello camera picked for "facingMode: user",
  a camera still being released, or one busy elsewhere. camera.html start():
  remembered deviceId (jarvis:camdev) → the ordinary request → every
  videoinput by deviceId, IR/Hello last, 720p then any size → the whole
  round again after 2 s; NotAllowed/NotFound stop at once; the failure has
  a Try again button; play() is raced with 2.5 s so a frameless camera does
  not hang the window. The main window never holds the camera (its
  getUserMedia video calls are click-only website features).
- **"Make it a 3D model" is a LOCK, not a turn (2.11.0).** askJarvis keeps
  the turn's picture (pictureOfTurn from its images, or a tool's __attach /
  image result) with the reply as lastDescribedPicture (15 min).
  makeItModelCommand runs on looseTokens in handleSend right after
  addMessage ("make/turn it|this|that (into) a 3d model", "תעשה מזה מודל
  תלת מימדי"): with nothing described it does NOTHING (a system note, kept
  out of chatHistory); after a description it runs runLockedModel3d. "Make
  a 3d model OF it" is deliberately not matched — in screen-watch mode
  every turn has a picture, and taking it would have replaced the 2.9.3
  studied photo_to_3d flow (model3d.e2e covers that). The lock:
  modelLock (declared beside isThinking, so no TDZ) + html.model-lock,
  silenceForLock, then ONE quiet model call (LOCK_STUDY_SYSTEM, no tools)
  whose JSON is completed from the description (analysisFromDescription /
  completeAnalysis, so check3dAnalysis always passes), then pending3d +
  callPhoto3dTool. Guards on modelLock: startListening, enqueueSpeech,
  speak, stopJarvis, handleSend, tasksShouldHold, eyeTick, startAmbient
  and the orb watchdog; it has its own 12-min clock instead. A new guard
  anywhere that listens, speaks or starts work must check modelLock. The
  ways out are the job ending and Refresh: orb menu / tray / Ctrl+Shift+F5
  → refresh_orb (main.rs: leaves full screen, orb topmost again, reload).
  The viewer (model.html) has the blueprint backdrop on by default
  (jarvis:model-backdrop), FULL SCREEN (needs allow-set-fullscreen in
  capabilities/model.json), and SAVE → save_model_file (glTF magic
  checked; jarvis_folder finds an existing JARVIS / ג'רוויס folder or makes
  one on the Desktop; never overwrites; Windows reserved names get
  "model-"). open_model_window takes an optional name (the caption) for
  the file. lock.e2e.mjs, makeit.test.mjs and viewer.e2e.mjs cover it.
- **Two 3D services, one contract (worker 2.7.0).** model3dProvider(env)
  picks Tripo when tripoKey(env) has a key, else Meshy (MODEL3D_PROVIDER
  prefers one; a preferred service without a key is ignored). The page sees
  the same { taskId, kind, stage } / { status, progress, glb, textured }
  either way. A Tripo task id is "tripo:<id>" and handleModel3dStatus routes
  on that prefix, so a running job finishes on its own service; keep the
  colon URL-encoded and never strip it in the page. Tripo is upload
  (multipart, no Content-Type of ours) -> POST /task (only type + file or
  prompt: texture and pbr default on) -> GET /task/{id}; a 200 whose body
  has code != 0 is a failure. Its errors are tripo_key / tripo_credits /
  tripo_busy / tripo_down / tripo_content, and model3d_missing when neither
  key exists; every failure object carries `fix` and `tell_the_user`, and
  the page (meshyReason) just passes them on. The Tripo endpoints and
  fields were written from its published API WITHOUT a live key: if the
  first real model fails, read the error text first (it quotes Tripo's own
  message) before changing the flow.
- **The desktop app and the website are two copies of the page (2.11.3).**
  The app bakes `dist/` in at build time (tauri.conf frontendDist), so a
  page change reaches it only after a rebuild, and it keeps its own saved
  conversation and memory. Anything JARVIS "knows" about the backend (which
  3D service, which keys) must therefore be given to him per request from
  /health, not left to his memory: model3dServiceNote() does that for the
  3D provider, appended in cameraSystemExtras().
- **His own "3D WORKSPACE" program (2.13.0).** workspace3dCommand (on
  ws3dCanon: looseTokens with every spelling of the name — 3-D/three d/
  תלת מימד, work space/וורקספייס/סביבת העבודה, either order — squeezed to
  the token APP) runs FIRST in detectWorkflowCommand, because the
  dashboards' workspace rule reads "open ... workspace" as its own; a
  sentence naming APP that is not a plain command returns null there, never
  'workspace'. Every word must be a verb, a model word or in
  WS3D_OTHER_WORDS (one outside word = conversation for the model, which has
  open_3d_workspace). Flows workspace3d / workspace3d_project are
  self-contained (compound sentences). Rust launch_3d_workspace finds the
  program by name (ws3d_score: "3d"+"workspace", never an uninstaller or
  setup; Start menu, desktops, LocalAppData\Programs, Program Files,
  Documents), writes the model through write_glb into JARVIS\3D Workspace,
  and starts it via ShellExecuteW (Win32_UI_Shell + Win32_System_Com) with
  the model path as its one argument. The found path is kept in Store
  workspace3d_path and dropped when it stops working. Not-found is
  {launched:false}, not an error, so the saved model is still reported.
- **The Meshy key is read through meshyKey(env) (worker 2.6.7), never
  env.MESHY_API_KEY directly.** It takes MESHY_API_KEY, then MESHY_KEY /
  MESHY_API_TOKEN / MESHY_TOKEN / MESHY, and cleans it (spaces, quotes,
  "Bearer ", a pasted label; an msy_ key is extracted). Meshy refusals go
  through meshyFailure: coded meshy_key / meshy_credits / meshy_busy /
  meshy_down (meshy_missing when absent), each with error (the fix) and
  tell_the_user (a short spoken line), returned as 502, NEVER 401 (the page
  reads 401 as its own session expiring and would show the PIN screen).
  GET /model3d/check reads only the balance (no credit spent); /health
  reports model3d_key set|missing|not_msy and the name, never the value.
  Page: meshyReason carries code/tell_the_user/fix out of runModel3dJob;
  check_3d_service is offered only when health says model3d_check.
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
