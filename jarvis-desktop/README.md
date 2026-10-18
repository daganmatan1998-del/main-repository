# JARVIS — Desktop Panel

The same `index.html` you already host, running as a floating always-on-top
panel with a global hotkey. **No shell access yet, on purpose** — this step is
only about proving the wrapper works. Commands come next, one at a time.

## What you get

This is **not the website in a smaller window.** The site is where you sit down
and work — chat, panels, history, settings. This is a voice orb: you summon it
mid-task, speak, and dismiss it without your hands leaving what you were doing.
Same file, same brain, same memory; a different job.

| | |
|---|---|
| **Ctrl+Shift+Space** | summons the orb, and the microphone opens on its own |
| While it is up | continuous conversation, always — no button to press, ever |
| Addressing him | say his name in any natural way — "Hey Jarvis", "Jarvis", "שומע ג'רוויס", or at the end of a sentence. Follow-ups need no name for 30s |
| Languages | Hebrew by default. Any way of asking works — "english mode", "תעבור לאנגלית", "speak english", "אנגלית בבקשה", "become Ultron" — and the same in reverse to come back |
| The colour | cyan = JARVIS/Hebrew, orange = ULTRON/English |
| Switching | "become Ultron" / "ultron mode" / "english mode" → orange English. "become Jarvis" / "hebrew mode" → cyan Hebrew |
| While it is away | the microphone is closed; nothing listens in the background |
| The orb | just the hologram, nothing else — no HUD, no chat, no buttons |
| No frame | no border, no ring — the hologram itself shows state, brightening and spinning up with your voice |
| Moving it | drag the outer rim — the middle stays clickable |
| Click the orb | starts a turn straight away, no name needed — also cuts him off |
| The dot | only in the expanded view: filled and pulsing = listening, amber = working, hollow red = standby or failed. Click it to toggle |
| Right-click | mute: stops listening and answering, stays on screen, dims. Remembered |
| Dismissing | press the hotkey again, or Escape |
| "Jarvis, go down" | sleep — hides, answers nothing, sends nothing |
| Waking him | Ctrl+Shift+Space, or say "Jarvis, wake up" / "get up" / "תתעורר" |
| "Close this window" | closes whatever window is in front (Windows only) |
| "Close Chrome" | closes a whole window found by its title (Windows only) |
| "Close this tab" | closes one tab, leaving the window open (Windows only) |
| "What's on my screen" | captures the primary monitor and reads it |
| "Open the camera" / "תפתח את המצלמה" | live view, and every message after it carries a fresh frame. "Close the camera" switches it off |
| "What does this page say" | reads the text of a named site, not just search results — product listings, competitor pricing, docs |
| Double-click | expands to full screen and back; the microphone indicator lives there |
| Tray icon | Show / Hide / Quit — the way back if the hotkey is taken |

**The PIN is asked once.** On the web it guards the URL and is never stored.
The desktop app is already behind your machine's login, so after the first
launch it unlocks silently — the saved PIN lives in the app's local storage in
plain text, readable by anyone with access to your unlocked account, which is
the same person who could already use the app. Worth not reusing that PIN
elsewhere. If you change `AUTH_PIN` on the worker, the saved one is discarded
and you are asked once for the new one.

The microphone opening by itself is the point, and continuous conversation is
not a mode here — it is the only way the orb works, because there is nothing to
press. Dismissing it closes the microphone; it never listens while hidden.

**If it cannot hear you at all**, the desktop window will now say why. WebView2
has no Web Speech API — that is a Chromium feature backed by a Google service,
not something every webview carries — so the browser's own recogniser is not a
fallback here, it is nothing. Transcription must come from the worker, which
means deploying the `jarvis-worker.js` that has `/stt`. Until then the orb can
speak but not listen, and it used to fail silently.

**What sleep costs.** The microphone stays on while he sleeps, because
hearing "wake up" requires hearing — a fully deaf sleep and a spoken wake
word cannot both exist. Audio is only sent for transcription when the local
level meter detects actual sound, and that meter runs in the page for free:
a quiet room costs nothing, while transcribing continuously would spend the
entire daily Workers AI allowance in about six minutes. Anything heard while
asleep is discarded unless it is a wake phrase — nothing reaches the model.
If you want him properly deaf, use Stop from the right-click menu instead.

A watchdog re-opens listening if it ever stops while the orb is up. Listening
is restarted from five different points in the code and any one of them can be
missed — one silent reply used to close the microphone permanently, with
nothing on screen to explain why. Summoning it and then having to
press something would make the hotkey pointless.

Not a bare `Ctrl`: every OS treats a lone modifier as the start of another
combination, never as a shortcut by itself, so it could never fire. Change it
at the top of `src-tauri/src/main.rs` if you want something else.

## One-time setup

**1. Rust.** This is the only real prerequisite, and it is a single installer.

- Windows: <https://rustup.rs> — also install the
  **Microsoft C++ Build Tools** it prompts you for.
- macOS: `xcode-select --install`, then `curl https://sh.rustup.rs -sSf | sh`

**2. Node**, if you do not have it: <https://nodejs.org>

**3. Then:**

```bash
cd jarvis-desktop
npm install
npm run dev
```

First run compiles Rust and takes several minutes. Every run after is seconds.

## Building an installer

```bash
npm run build
```

Output lands in `src-tauri/target/release/bundle/` — `.msi` on Windows,
`.dmg` on macOS. Unsigned, which is fine for your own machine: Windows will
show a SmartScreen warning once, and you click through it. Signing is only
worth it if you distribute to other people.

## What carries over, and what gets better

The worker is untouched — it is already a remote backend and does not care who
calls it. Everything keeps working: modes, voice, Shopify, the calendar.

Three things that were broken in a browser are simply gone here:

- **Microphone and camera permissions stop resetting.** Safari discards them
  every session for an ordinary tab; a desktop app is granted once.
- **No CORS.** Cartesia can be called directly if you ever want to skip the
  worker hop for voice.
- **No tab to lose.** It is always there, behind one key.

## A note on `tauri.conf.json`

`withGlobalTauri: true` is what exposes `window.__TAURI__` to the page. The
panel is one plain HTML file with no bundler and no imports, so without it
there is no way to reach the API at all and the hide gestures silently do
nothing.

Do not annotate this file with `"//key"` comment entries. JSON has no comments
and most tools ignore that convention, but Tauri validates against a strict
schema and rejects any key it does not recognise — the app then refuses to
start with `Additional properties are not allowed`. Explanations go here
instead.

## Serious Mode is not in the orb

In the orb, ULTRON is a palette and nothing else. It is the English half of
the language switch: the same assistant, the same tools, the same limits, in
orange. Saying "become Ultron" switches to English; "become Jarvis" switches
back to Hebrew. Every such phrase needs a verb, because a bare "Jarvis" is the
wake word and must not change anything.

That separation is enforced in code rather than asked for. `seriousMode()` is
what every capability reads — the identity in the system prompt, the token
budgets, and which tools are sent — and it is false on the desktop whatever
the palette says. Only the painting reads the raw mode flag. Saying "become Ultron"
switches to English; "become Jarvis" switches back to Hebrew. Every such
phrase needs a verb, because a bare "Jarvis" is the wake word and must not
change anything.

Serious Mode — the one with a bigger token budget and the 3-D, image and
packaging tools — is a different thing entirely. It exists on the website and
is unchanged there. It is deliberately unreachable from the orb: it shares the orange palette that now marks English
mode, and everything it adds — 3-D models, image generation, project
packaging — produces things you need a screen to look at. Voice commands for
it are ignored here rather than half-working.

## Opening links

`open_url` is the first capability that reaches outside the app: ask him to
open YouTube, your Shopify admin, anything, and it opens in your default
browser. Desktop only — the browser build has no such power, so the tool is
not offered there.

It is deliberately the narrowest useful capability. The URL is parsed and
**only http and https are allowed** — `file://` would read local files,
`javascript:` would run code, and schemes like `vscode://` can launch
applications with arguments. All refused. The worst this tool can do is open a
web page you did not ask for.

He also cannot see what loads. It opens on your screen, not in his context.

## Adding commands later

Deliberately absent. `src-tauri/capabilities/default.json` grants the window
the ability to show, hide and move itself, plus `opener` for http/https links —
nothing more. No filesystem plugin, no shell.

One caveat on "no filesystem": `take_screenshot` writes a PNG into your
Pictures/Screenshots folder from Rust, so it does touch the disk. It is not
reachable from the page as a general file API — the command takes no path and
can only ever write that one file to that one place — but the flat claim above
was not accurate, and this is the exception.

When we add commands, the shape is **one Rust function per capability**, not a
general shell. "Open this folder", "take a screenshot", "mute the system" —
each with its own fixed arguments. A model that mis-reads a page it was shown
cannot turn that into an arbitrary command, because there is no arbitrary
command to turn it into.

Tauri fails silently on a missing permission: the frontend call does nothing
and the Rust never runs. If something you add appears dead, check
`capabilities/default.json` first — that is almost always the reason.

## Projects, tasks and approvals (2.37.0)

- **Authorized projects** (`src-tauri/src/projects.rs`). He adds a folder with
  the folder picker; nothing else can add one. Inside it JARVIS can index,
  search, read, find a symbol, list recent changes, write files (each
  overwrite first saved to `%APPDATA%\jarvis\backups\<project>\<time>\`, and
  refused as a conflict if the file changed since it was read), restore,
  run git read commands, `add`/`commit` only after an on-screen approval,
  and run the project's own commands detected from `package.json`, Cargo or
  pytest. Test/lint/build/check commands run on their own; any other script
  needs approval. Nothing runs from a shell string. Every action is written
  to `%APPDATA%\jarvis\audit.log` (paths and command names, no contents).
- **Tasks**. `start_task` hands a goal to an orchestrator that plans
  steps for five roles (research, coding, computer, visual, qa). It runs
  independent steps in parallel (two at a time), retries a failed step
  once, adds an independent QA step when anything was changed, and posts
  one report. Pause, resume, cancel, answer and priority work through
  `task_control` or the task panel. Budgets are in localStorage
  `jarvis:taskLimits`: model calls per task (40) and per day (400), 8 steps,
  8 rounds per step, 4 minutes per step and 30 minutes per task. A task
  interrupted by a restart comes back paused, with its finished steps kept.
- **Local approvals**. A high-risk action stops on a card on this screen.
  He approves by clicking, or by saying "approve"/"deny" while holding the
  talk key. If he doesn't answer within 10 minutes, the action is denied.
- **Video**. Dropped videos are scanned locally at low resolution for scene
  changes. One keyframe per scene (at most 8) is sent, with timestamps.

The worker needs no change for any of this: tasks call the same `POST /`
the agents already use.
