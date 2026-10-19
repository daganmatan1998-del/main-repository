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
- **`mic-test.html` deliberately duplicates the detector's maths.** If the VAD
  constants or the RMS calculation change in `dist/index.html`, change them
  there too or the tool starts lying.

## Verifying without a build

Rust: `rustfmt --edition 2021 --check src-tauri/src/main.rs` (exit 0 or 1 means
it parses; 101 is a real syntax error). The full Tauri build needs Windows or
macOS and is not runnable here.

The worker runs under plain Node — import it as an ES module, stub
`globalThis.fetch`, and drive it through `worker.fetch(new Request(...), env)`.
It exports `__test` for cooldown and chain inspection.

The page's CSS can be checked in the pre-installed Chromium via Playwright
(`/opt/node22/lib/node_modules/playwright`), forcing state by setting
`document.documentElement.className`. Wait out any transition before reading
`getComputedStyle`, or you read the value at the start of the animation.

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

**Projects, tasks, video (2.37.0).** `src-tauri/src/projects.rs` is the only
way a real folder becomes reachable: `project_authorize` opens the folder
picker (rfd) and takes no path. Its logic runs on Linux in a scratch crate
with stand-in `tauri` (identity `#[command]` proc macro + a thread-based
`async_runtime::spawn_blocking`) and `rfd` (returns `$PICK`) crates, including
its `#[cfg(test)]` tests; the real crate cannot `cargo test` here (no GTK).
The task engine in `index.html` (search "PROJECTS, TASKS AND THE
ORCHESTRATOR") is reachable from Playwright through `window.__tasksTest`;
mock `window.__TAURI__.core.invoke` with `addInitScript` and route the
worker's `POST /` to a scripted model. Every step's system prompt starts
"You are the <Role> Agent", the planner's says "orchestrator of
J.A.R.V.I.S.", which is how a mock tells them apart. Browser-recorded WebM has
no duration (Infinity) until a far seek - `fileToVideoFrames` handles it, so
a MediaRecorder clip made in the page is a fair test video.

**System diagnostics (2.38.0).** One isolated block in `index.html` (search
"SYSTEM SELF-DIAGNOSTICS"): `DiagEngine`, `buildDiagRegistry`, the overlay,
`diagNarrator`. `window.__diagTest` exposes them to Playwright. A test returns
`{status, summary, evidence, fix}`; to add one, `add({id, name, category,
critical 1-3, requires:[earlier ids], run})` in the registry (`quick:true` puts
it in the quick run too). The overlay reads the app's own CSS variables
(`--cyan-rgb`, `--blue-rgb`, `--panel-rgb`), so it follows ULTRON mode; note
that in this app setting the language to English switches to ULTRON (amber),
Hebrew to JARVIS (cyan): a test that calls `setLangMode('en')` is testing the
amber look. `var diagBusy` (not `let`) because `speak()` reads it and can run
before the block is reached. The hook object must be defined AFTER the classes:
a class referenced earlier is a temporal-dead-zone error that stops the whole page.
Screenshots from the Playwright run can be read back with the Read tool to check
layout; colour/brightness can be measured with PIL on them.
