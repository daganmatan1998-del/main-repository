# Glowpulse-pro

J.A.R.V.I.S. — the voice assistant, in the two halves it actually ships as.

| Path | What it is |
|---|---|
| `jarvis-worker.js` | The Cloudflare Worker backend. Every secret lives here; the browser never sees one. Model proxy with fallback keys, `/tts`, `/stt`, `/image`, Shopify, Google Calendar, remote MCP proxy. |
| `jarvis-desktop/` | The Tauri desktop app — the same page as a floating always-on-top orb on `Ctrl+Shift+Space`. See [its README](jarvis-desktop/README.md) for setup and for what the orb can and cannot do. |
| `jarvis-desktop/dist/index.html` | The whole frontend, one file, no bundler. This is also what you host on the web. |
| `jarvis-desktop/mic-test.html` | A standalone page that measures the exact RMS level the voice detector thresholds against, so "he cannot hear me" becomes a number instead of a guess. |

The two halves are deployed separately and do not need each other to build: the
worker goes up with `wrangler deploy`, the desktop app with `npm run build`
inside `jarvis-desktop/`.

## Deploying the worker

```bash
wrangler deploy jarvis-worker.js
```

The secrets it reads are listed at the top of the file. Only `JARVIS_PIN`,
`JARVIS_TOKEN_SECRET` and one model API key are required — every other feature
switches itself off when its secret is absent, and `GET /health` reports which
ones came up.

Voice input needs `/stt`, which this worker has. WebView2 carries no Web Speech
API, so on the desktop app transcription has nowhere else to come from.

## The Meshy key (3D models)

3D models are made by Meshy, and the key lives on the worker, never in the
app:

1. At meshy.ai, go to Settings → API and create a key. It starts with `msy_`.
2. In the Cloudflare dashboard, open the jarvis worker → Settings →
   Variables and Secrets → add a **Secret** named `MESHY_API_KEY` with that
   key as its value.
3. Deploy the worker.

Then ask JARVIS "is my Meshy key working?". He checks with Meshy itself
(`GET /model3d/check`, which only reads the balance, so it makes nothing
and costs no credit) and says whether the key works and how many credits
are left, or what is wrong. Since worker 2.6.7:

- A key stored with a space or newline, in quotes, with "Bearer " in front
  or with its label pasted in is cleaned before use.
- The names `MESHY_KEY`, `MESHY_API_TOKEN` and `MESHY_TOKEN` work too.
- A refused key (401) is said as "Meshy refused the API key", with these
  steps as the fix, not as raw "meshy 401". It also notes when the stored
  key does not start with `msy_` and is probably another service's.
- No credits (402), rate-limited (429) and Meshy down are each named.
- `/health` shows `model3d_key` (`set`, `missing` or `not_msy`) and which
  name it was found under, never the key.

## Connecting Google Calendar

Two secrets on the worker, then one sentence to JARVIS. Once:

1. In [Google Cloud console](https://console.cloud.google.com/), make a project
   and enable **Google Calendar API** (APIs & Services → Library).
2. **OAuth consent screen**: External; add your own Gmail as a test user; then
   **Publish app** so its status reads *In production*. Left in *Testing*,
   Google expires the connection every seven days. Google will warn that the
   app is unverified when you connect — it is your own app; Advanced →
   continue.
3. **Credentials → Create credentials → OAuth client ID → Web application**,
   with this exact **Authorized redirect URI**: `https://<your-worker>/calendar/oauth`
   (the address the app talks to, plus `/calendar/oauth`).
4. Put the two values on the worker: `wrangler secret put GOOGLE_CLIENT_ID` and
   `wrangler secret put GOOGLE_CLIENT_SECRET`, then redeploy.
5. Say **"connect my calendar"**. Google's own sign-in opens in your browser;
   pick the account whose calendar he should use and approve. The page that
   comes back names the account, and from then on every read and write says
   which calendar it touched. Say it again any time to switch accounts or to
   reconnect.

The permission is kept in D1 (`jarvis_meta`), so no refresh token has to be
copied anywhere. An existing `GOOGLE_REFRESH_TOKEN` still works; a connection
made from the app takes precedence over it.

## Watching the screen, on request

"Hey Jarvis, can you see my screen?" (or "תסתכל על המסך") turns it on, and an
amber **◉ SCREEN** tag stays on the orb while it is. From then on every message
carries a fresh capture of the primary screen, taken the moment you spoke, so a
question is always answered about the screen as it is now. "Thank you, Jarvis",
"thanks for helping", "תודה על העזרה", "stop watching" — or ten quiet minutes —
turn it off, and the captures are dropped. "Thanks — and what's this button?" is a
new question and does not.

It is a look each time you speak, not a video stream: nothing is sent while you
are not talking to him. The captures come from `capture_screen_frame` in the
desktop app and are never saved to disk, so **this needs the app rebuilt**; an
older build says so rather than filling Pictures\Screenshots with a file per
sentence.

## One thing to know before you set `ALLOWED_ORIGIN`

It defaults to `*`, which reflects whatever origin asked — so both the website
and the desktop orb work. Pinning it to your site's URL locks the orb out: its
page is served from `tauri://localhost` (`http://tauri.localhost` on Windows),
not from your domain, so the browser drops every reply as a CORS failure. The
symptom is not an error message but an app that appears to have lost its
backend entirely.

If you want the lock, make `ALLOWED_ORIGIN` accept both — the site and
`http://tauri.localhost` — rather than one of them.

## The orb no longer needs the network to draw itself

The hologram *is* three.js, and its thirteen files used to be fetched from
jsdelivr on every cold start — which made whether the app drew an orb or the
`no-webgl` fallback glow a property of the network: a locked-down wifi, a
captive portal, a tunnel, or just a slow first paint on a phone.

They now ship in `dist/vendor/three/` (868KB, pinned to r128, and they never
change — which is why re-fetching them was never buying anything). The CDN
stays as a per-file fallback: each local script is followed by a check for the
global it should have defined, and only a missing one is re-requested from
jsdelivr. So uploading `index.html` without `vendor/` beside it still behaves
exactly as it did before rather than silently losing the orb.

Verified by serving `dist/` with every off-origin request blocked: THREE r128
and all twelve addons load, one canvas, no fallback class, no CDN request
made. With `vendor/` removed, all thirteen CDN requests are attempted — the
fallback is real, not decorative.

## Two web tools, and only one of them needs Anthropic

`web_search` is Anthropic's own server-side tool. The worker notices a server
tool in the request and puts an Anthropic engine first — but if no
`ANTHROPIC_API_KEY` is set, the request goes to whatever engine is configured
and the tool is **dropped from it silently**. Nothing errors; JARVIS simply
answers from memory as though he had searched. If search matters to you, set
`ANTHROPIC_API_KEY`, and check `GET /health` — `engines` lists what the chain
actually holds.

`search_web` is the way round that. It is an ordinary tool backed by the
worker's own `/search`, which queries DuckDuckGo's HTML endpoint and needs no
key of its own, so it works on Google, Groq, Cerebras, xAI and Workers AI
alike. The page offers exactly one search tool, chosen from what `/health`
reports: Anthropic's when an Anthropic engine is in the chain, otherwise this
one, and neither when the worker is too old to have `/search` — in which case
the system prompt tells him outright that he cannot search, rather than
leaving him to answer from memory believing he did.

`read_page` has no such dependency. It is an ordinary tool backed by the
worker's own `/fetch`, so it survives on Google, Groq, Cerebras, xAI and
Workers AI alike. It fetches one page server-side and returns its text, which
is what lets him answer about a specific product listing or competitor page
rather than about search results.

`/fetch` only reaches public http and https addresses: loopback, private
ranges, link-local (including cloud metadata at 169.254.169.254) and non-http
schemes are refused, and because redirects can point anywhere, the final URL
is re-checked after they are followed rather than only the one submitted.

## What each request costs, and what is done about it

The system prompt and the tool schemas are identical from one request to the
next — around 4,200 tokens of them for JARVIS in English, 5,400 for ULTRON —
and they used to be re-sent and re-billed every time.

The worker now marks a cache breakpoint after them on the Anthropic path, so
subsequent requests read that prefix back instead of paying to reprocess it.
It is done in the worker rather than the page for a reason: the page does not
know which engine will answer, the worker does, so Google, Groq, Cerebras, xAI
and Workers AI never see a field they would not understand. If Anthropic ever
refuses the marker the turn is retried once with the untouched body — a saving
must never be the reason an answer fails to arrive.

The other cost was live view. It attaches a fresh camera frame to every
message, and with a sixteen-message window up to eight stale frames rode along
on every request: roughly 4,000 tokens of pictures already looked at and
answered. Only the newest is kept now; the rest are replaced by a line saying
a frame was there, so referring back to what you showed him still makes sense.
Photographs attached deliberately are never touched — those are the
conversation.

## Installing it on a phone

`dist/` is now also a progressive web app, so the same `index.html` is the
website, the desktop orb and the phone app — one file, three targets, no
second copy to keep in sync.

Upload these alongside it, all in the same folder, and serve them over https
(a service worker will not register otherwise):

    index.html   manifest.webmanifest   sw.js
    icon-192.png   icon-512.png   apple-touch-icon.png
    vendor/      (the whole folder, keeping its structure)

`vendor/` is three.js. Leave it out and the page still works, but the orb goes
back to depending on the CDN being reachable.

Then open the site on the phone and add it to the home screen — Share → Add to
Home Screen on iOS, the install prompt on Android. It opens without browser
chrome, with its own icon, and the second launch is near-instant because the
worker serves the page from cache.

The service worker serves `vendor/` cache-first, the same way it used to serve
the CDN copies: 868KB is not worth re-validating on every cold start when the
files are pinned and cannot change. Change the path under `vendor/` (or bump
`CDN_VERSION`) to ship a different build — editing a file in place under the
same name will keep serving the copy already cached.

**Bump `SHELL_VERSION` in `sw.js` whenever `index.html` changes**, or phones
will keep serving the copy they already installed.

Nothing about the backend changes. Every feature the page has — search, page
reading, code execution, Shopify, calendar, camera, voice — runs on the phone
exactly as it does on the desktop, because the page is the client and it
brought its own tool loop with it.

## Telling him something once, and having it hold

The Memory tab summarizes your conversations, which is useful and also a
rebuild: every refresh regenerates the whole picture from the transcripts, so
anything it did not infer that round is simply gone. That is the wrong shape
for a standing instruction — "always quote prices in shekels" is not something
to be re-derived and possibly missed.

The tab now has an **Add** box. What you type there goes into `profile.pinned`,
which the summarizer is explicitly forbidden to touch, and it is handed to him
at the top of every request as a standing instruction that outranks anything
inferred. It reaches the system prompt on the very next message, in every
conversation, old and new, and survives closing the tab because it is written
to `localStorage` rather than held in the page.

Each note has an ✕ next to it, because a note that cannot be removed is a
setting you are stuck with. Notes he saved himself (the `remember_this` tool)
and notes you typed land in the same list and behave identically — one code
path, so there is no second kind of memory to reason about.

It is per browser and per device, like everything else this page stores. The
phone and the desktop keep separate lists; there is no account syncing them.

## The 3D generator was only running half of itself

Meshy's text-to-3D is two jobs. `preview` produces the mesh — the right shape,
but bare geometry with nothing on its surface. `refine` takes that finished
preview and paints it: base colour, and with `enable_pbr` the metalness,
roughness and normal maps that are the difference between a render and a clay
study. Only the first was ever run, which is why generated models arrived grey.

Both now run, chained in the worker rather than the page: the page polls one
endpoint and is told which task to poll next, so the worker stays stateless and
an older deployed copy of it still answers the page correctly. The progress bar
gives each stage half its range.

It costs a second credit and about another minute. If the texture pass cannot
start, or fails, or times out, the mesh that was already generated and paid for
is shown instead and the result says `textured:false` — so he says it is a bare
mesh rather than describing colours it does not have. If `enable_pbr` is
refused, texturing is retried without it before anything is given up, because a
textured model without PBR maps still beats a grey one.

Prompts matter more than they did, and the tool now says so: the texture pass
reads the same prompt, so naming the finish and material of each part ("matte
black anodised aluminium, brushed steel cap, thin copper band") gives it
something to paint where "a bottle" gives it nothing.

## What the model viewer was doing to every model

Two things, both visible in a screenshot.

The camera sat at a fixed `(0, 0.6, 3)` whatever arrived in front of it. At the
stage's real 260px height that is a 2:1 frame, and a model normalised to 1.8
units reached 86% of the way to the bottom edge — so wide objects clipped the
moment you turned them. The camera is now fitted to the model's bounding
**sphere**, which is the same size from every angle, so a framed model cannot
grow out of frame however it is rotated. Measured across a full rotation sweep
(every 15° of azimuth, six elevations) on a tall bottle, a flat wide box and a
sphere, at both desktop and phone aspect: worst case 0.966 of the way to the
edge, on all of them.

And there was nothing under the model, so it floated, and a floating object
reads as a preview rather than as a thing. There is now a soft contact shadow
on the ground beneath it, sized to that model's own footprint. It is a painted
gradient rather than a shadow map: a real one needs per-model bias tuning and
streaks across half of them when it is wrong, and this cannot fail that way.
It is back-face culled, so turning the model underneath does not reveal a dark
disc floating in front of it.

## Why he said he could not see the picture

Two separate faults, and together they made the app look like it was lying.

**The image really was being thrown away.** `engineSeesImages()` decided whether
to forward a picture by looking at the *vendor*, and the whitelist held exactly
one entry: `google`. So GPT-4o, Grok, Pixtral, Llama 4 Scout, every vision model
on OpenRouter — all declared blind. When an engine was "blind" the image block
was replaced, before the request left the worker, with the sentence `[the user
attached an image, which this model cannot view]`. The model then read that
sentence and told the user it could not view images. It was not hallucinating;
by the time it saw the request, there was no image in it.

Vision is a property of the **model**, not of the company selling it, so that is
what is tested now: a list of known vision families (GPT-4o/4.1/5, o-series,
Gemini, Grok 2+, Llama 4 / Scout / Maverick / 3.2-11B and 90B, Pixtral, Qwen-VL,
InternVL, Molmo, Claude, Mistral Small/Medium 3) plus `VISION_ENGINES` as the
manual override — which now accepts a model name, not only a vendor, because a
list of model families is the part that goes stale.

**And the page could never be told.** `cors()` set `X-Jarvis-Engine` and
`X-Jarvis-Fallback` but never `Access-Control-Expose-Headers`, and a browser
hands a cross-origin response only a few safelisted headers unless the server
names the rest. So every one of those headers arrived and was discarded before
the page could read it. That is why the debug line read `engine=unknown` while
the worker knew exactly which engine it was, and why "switched to a fallback
model" never once appeared.

With that fixed there is a channel, so the worker now uses it: when a picture is
about to be dropped it sets `X-Jarvis-Blind`, and the page says so in plain
language — which engine, and the three ways to fix it. The placeholder handed to
the model also says *why* the image is missing, so it reports a backend
limitation rather than claiming it has no eyes.

**Worker 2.6.5 — why the screen still reached him as "a backend limitation".**
When nothing in the chain can see (Claude out of credit, Gemini's allowance
spent, a Groq text model answering), the picture is described by a Workers AI
vision model first. The two describers were Llama 3.2 Vision, which answers
every account with error 5016 until someone sends it the word `agree` once
(Meta's licence), and LLaVA 1.5, handed the picture as a JSON array of one
number per byte, so a screen capture became millions of numbers. Both failed,
nothing was described, and every screen capture arrived as the placeholder
above. Now Llama 4 Scout and Gemma 3 go first. They take the picture as an
ordinary data URL inside the chat message and have no licence step. The old
two stay behind them. `VISION_DESCRIBER` (optional) puts a model of your
choice first. The describer is also told what he asked ("what does this
error say"), so that part is copied out word for word. When every describer
still fails, `X-Jarvis-Blind-Why` says which ones failed and what each said,
and the page shows it beside the "never reached him" line.

Two more fixes rode along:

- A picture inside a tool result (`take_screenshot`, the camera's look) is now
  lifted out beside the results. Before, it reached every non-Claude engine
  as a JSON string of base64.
- The page (2.9.2) sends screen captures as JPEG, a fraction of the PNG's
  size, and falls back to PNG if the conversion fails.

Checked across eleven real provider configurations — that the picture is
actually forwarded where it should be, actually stripped where it must be, that
the warning fires only in the second case, and that a blind primary is overtaken
in the chain by a fallback that can see.

## Page 2.11.1 / worker 2.6.7: "a problem with the Meshy key"

JARVIS reported a problem with the Meshy key and could say no more, because
the worker passed Meshy's refusal on raw and sent the key exactly as stored.
Now:

- the key is cleaned and read under its common names;
- every refusal is coded and names its fix;
- `check_3d_service` (offered only by a worker that has `/model3d/check`)
  lets him test the key without making anything;
- the locked "make it a 3D model" build says the short reason out loud,
  with the fix in the log.

See "The Meshy key" above for setting it. Tested in `meshykey.test.mjs`
(41, the real worker) and `meshy.e2e.mjs` (13, the real page).

## Page 2.11.0: "make it a 3D model", a refresh button, and the blueprint viewer

**"Make it a 3D model", locked.** Say it after JARVIS has described a
picture to you (a photo you sent, a camera look, your screen, anything he
was shown in the last 15 minutes). He then builds exactly that picture:

- there is no conversation with the model about it, so there is nothing to
  argue with;
- the microphone is shut, so nothing said is heard;
- nothing is spoken, not even a progress line;
- nothing typed is taken, and no scheduled task or camera remark starts;
- the stop button, Esc and the stall watchdog cannot cut it short.

The orb shows it the whole time: a steady blue dot and "building 3D".
Behind that, one silent model call studies the picture together with the
description he gave you (all six sides, proportions, materials, symmetry,
a crop). If that study fails, the description itself is the study, so the
build still goes ahead. The picture then goes to the 3D service exactly as
with `photo_to_3d`. When the model's window is open he says "Here it is,
sir." (or "הנה הוא, אדוני.") and listens again. A failure is said the same
way, in one line, and he listens again too. After 12 minutes with no answer
from the service he gives up and says so.

Said with nothing described, the sentence does nothing at all. Its
variants work too: "turn it/this into a 3D model", "make that 3D", and in
Hebrew "תעשה מזה מודל תלת מימדי", "תהפוך את זה למודל תלת מימדי". "Make a
3D model of it" is deliberately not one of them. It stays the studied
`photo_to_3d` turn it has been since 2.9.3, because while he watches your
screen every turn has a picture in it, and that wording would otherwise
have replaced that flow completely. A new photo attached to the same
message is a new picture and also goes to the model as before.

**A refresh button for when he is stuck.** Right-click the orb →
**Refresh JARVIS**, or the tray menu's **Refresh JARVIS**, or
**Ctrl+Shift+F5** from anywhere. It leaves full screen, puts the orb back
on top and reloads the page. The conversation and the unlock survive it,
and the log says "Refreshed." afterwards. It is also the way out of a locked
3D build.

**The 3D window** (`model.html`):

- The model stands on a deep-blue blueprint backdrop with fine and coarse
  grid lines and a floor grid under it. BACKDROP in the right-click menu
  turns this off (back to the model floating on the desktop), and the
  choice is remembered.
- **FULL SCREEN** is in the menu, and a double-click or F11 does the same.
  Esc comes back.
- **SAVE** writes the `.glb` into your JARVIS folder. That is the first
  folder named JARVIS (or Jarvis / ג'רוויס) found on the Desktop, in
  Documents, OneDrive, your home folder, Downloads, Pictures, or at the root
  of C:, D: or E:; if there is none, one is made on the Desktop. The file is
  named after the model ("white-ceramic-mug.glb"), and an existing file is
  never overwritten ("white-ceramic-mug (2).glb"). The window says where the
  file went, or why it could not save.
- The gesture zoom reaches it directly, in full screen too.

This needs the app rebuilt: `refresh_orb`, `save_model_file`, the
Ctrl+Shift+F5 shortcut, the tray item and the viewer's full-screen
permission are all in Rust. Tested in `lock.e2e.mjs` (47), `makeit.test.mjs`
(74) and `viewer.e2e.mjs` (28, the real viewer in WebGL); `main.rs`
type-checks for Windows.

## Page 2.10.4: the camera starts whichever camera works; the hands zoom by movement

**"The camera would not start. Timeout starting video source."** Windows
opened a camera that never delivered a first frame. JARVIS himself is not
the cause: the only camera request while the app runs is the camera
window's own. The usual reasons are:

- the wrong camera: the infrared Windows Hello camera, which a request for
  "the front camera" can land on;
- a camera still being released after the window closed and reopened;
- a camera busy in another program.

`camera.html` now tries, in order:

1. the camera that worked last time;
2. the ordinary request;
3. every camera on the machine by name, infrared and Hello ones last, each
   at 720p and then at any size.

If the whole round times out or finds the cameras busy, it tries once more
after two seconds. The camera that works is remembered. A privacy refusal
or no camera at all stops at once. A failure now says what to do and has a
**Try again** button. A camera that opens but sends nothing no longer
leaves the window stuck on "asking…". Tested in `camstart.e2e.mjs` (13).

**The zoom follows the hands' movement, not their distance**
(`gesture-zoom.js`):

- every centimetre or so the two pinches move **apart** is one step in, and
  every centimetre **together** is one step out;
- hands held still, close together or far apart, do nothing;
- the same 3 cm is the same 3 steps wherever the hands start (before, it
  was a ratio of the starting distance);
- centimetres come from the hands themselves (palm ≈ 9 cm), so leaning in
  is still not a zoom.

Each step is one wheel notch or key press in the program in front, or ×1.1
in JARVIS's own 3D viewer. Steps go out one at a time, at most 6 a second,
with at most a second's worth waiting, so it stays gradual and a fast sweep
leaves no long tail. The first 5 mm of each pinch are ignored, because
pinching itself moves the hands. "Zooming" (green) starts only at the first
real step.

Settings: sensitivity is now **steps per cm**, shown as "1 / 1.0 cm". The
threshold is in **mm** and the maximum speed in **steps a second**. Minimum
and maximum zoom are unchanged. Tested in `gesturezoom.test.mjs` (78, real
landmarks) and `gesture.e2e.mjs` (27, the real tracker in the real camera
window).

## Page 2.10.3: he understands what you mean, not only the sentence he was taught

"hey can you open my camera please" already worked. But "I want to see the
camera", "can I get the camera up", "camera on please jarvis", "i need the
camera", and even "אתה יכול לפתוח לי את המצלמה בבקשה" did not. None of them
fit a command's shape, so they went to the model. A model that answered
"Sure, opening your camera now." without calling anything left the camera
shut. Listing every sentence cannot be done, so three layers replace it:

1. **Reading for meaning** (`understandCommand`).
   - Courtesy and framing are removed wherever they appear: "hey", "can you",
     "could you do me a favour and", "please", "for me", "I want you to",
     "בבקשה", "אתה יכול", "תעשה לי טובה", and his name.
   - What is left must be made only of command words: a thing (the camera,
     full screen, the workspace, a site he names) and what to do with it
     (open, turn on, show, get… up, close, get rid of, תפתח, להדליק, תכבה,
     לצאת…).
   - Any order, any tense, and Hebrew prefixes (ה ל ו ש מ ב) are accepted.
   - One word from outside that vocabulary makes it conversation, not a
     command. "I need a new camera for product shots" goes to the model as
     before.
   - Long polite sentences over 12 words still get this reading.
   - A part before "and" that is only courtesy ("could you do me a favour
     and…") is no longer sent to the model as a second request.

2. **Hearing the promise.**
   - "Sure, opening your camera now." now counts as a claim that has to be
     backed by a real action. Before, the check wanted the gerund at the very
     start of the reply.
   - So do "I'll open the camera", "let me turn it on", "אפתח לך את
     המצלמה" and "בסדר, פותח את המצלמה".
   - Offers and conditions are not claims: "if you want I'll open it", "want
     me to open it?", "אם תרצה אפתח". Neither is "I will not".

3. **The model understood, so the app does it** (`impliedLocalFlow`).
   - This applies when a turn ends with such a claim and no tool call.
   - What he asked and what the model promised must name the same thing, in
     the same direction. The verb has to act on the thing directly
     ("opening your camera", not "opening a guide to camera settings"), and
     it must not be negated.
   - Then the app performs that action itself, and the sentence he hears
     becomes true.
   - A question ("what camera should I buy") never qualifies. Anything else
     still gets the corrective round.

**Tested:**

- `understand.test.mjs` (97): about 70 phrasings in English and Hebrew, 25
  sentences that only mention these things, a compound request, and the
  model-understood cases.
- `promise.test.mjs` (34).
- `understand.e2e.mjs` (15), on the real page:
  - spoken and typed commands open the camera with no model call;
  - a model that only talks still gets the camera opened, and his sentence
    is spoken with no correction;
  - a question about cameras switches nothing on.

**Unchanged on purpose:** while he is dozing (a minute of quiet), only a
sentence with his name is for him.

## Page 2.10.2: the camera and 3D models in full screen

Full screen, the camera "did not work" and 3D models "were never made".
Both were being made. They were just out of sight. Everything that differs
between the small orb and full screen was checked. Four real causes:

1. **The orb covered its own windows.** The orb is always-on-top, which is
   right for a 180 px circle. Full screen, the same flag put an opaque,
   monitor-sized window above everything:
   - the 3D viewer is an ordinary window, so it opened behind the orb;
   - the camera window is also always-on-top, so it went under the orb as
     soon as you clicked or spoke to the orb.

   Now, full screen, the orb is an ordinary window, and the camera, the 3D
   viewer and the workspace panes float above it. Small again, everything
   goes back as before. This is `orb_layer` in `main.rs`, called on each
   side of `setFullscreen`. A viewer or pane created while full screen
   starts above the orb, and the viewer opens centred on the orb's monitor.
   A build without `orb_layer` leaves full screen before opening one of
   these windows, rather than opening it where it cannot be seen.

2. **A model he built himself went only to the chat, and the desktop has no
   chat on screen.** That is true in the small orb and in full screen, so a
   `build_3d_model` result was never visible on the desktop. It now goes to
   the 3D viewer window too:
   - the page exports a `.glb` and leaves it with the app (`stash_model`);
   - `model.html?glb=stash:KEY` asks for it (`stashed_model`), at any size;
   - an older build gets a `data:` URL instead, which works up to about
     900 KB, and past that he says so honestly.

   The tool result no longer says "displayed in the chat".

3. **Screen captures were of JARVIS.** A capture is the composed desktop, so
   with the orb full screen, "look at my screen" and "a 3D model of what is
   on my screen" got the HUD. For the moment of each capture the orb is
   excluded from it (`WDA_EXCLUDEFROMCAPTURE`, Windows 10 2004 and later)
   and put back straight after. Nothing changes on screen, and your own
   screenshots are untouched.

4. **Nothing showed the work.** A 3D job's progress was written to the
   chat, which is not on the desktop. The full-screen HUD now has a TASK
   line under MIC: it mirrors the current status ("3D model: texturing
   45 %"), glows while a job runs, and clears when the job is done.

**Tested** (`fullscreen.e2e.mjs`, the real page and the real `model.html`,
26 checks):

- `orb_layer` is called before the window fills the screen and after it
  leaves.
- The camera opens without leaving full screen.
- A built model reaches the viewer through the stash, and `model.html`
  renders it. So does one over a megabyte.
- A stash key that has expired is reported, not left as a blank window.
- The `data:` fallback works, and an oversized model is refused honestly.
- The TASK line lights up at 40 % and clears.
- An old build leaves full screen first.

The Rust half is type-checked for Windows. Needs the app rebuilt.

## Page 2.10.1: long 3D turns finish, he infers instead of asking, "bring the camera to this window"

**A 3D model no longer starts over halfway through.** The watchdog that
unsticks a request that never returns released any turn that went 45
seconds without new text. A 3D turn is exactly that kind of turn:

- the model writes its analysis into a tool call, which streams with no
  text at all;
- an engine can think for a minute before it sends its first byte;
- the job itself takes two to four minutes.

So the turn was dropped mid-work, the microphone reopened, and whatever he
said next started the model over from the first photo. Now:

- every streamed chunk counts as a sign of life, not only text;
- a request still waiting for its first byte gets three minutes;
- a running tool gets ten minutes (the 3D job also sends its own heartbeat
  on every poll).

A request that really is stuck is still released, and it is now also cut
off, so its answer can no longer arrive later on top of the next turn.

**He works it out instead of asking.** A bare "create a 3D model" or "צור
מודל 3D", said while the camera is on, the screen is being watched, or a
photo has just been sent, now takes the studied photo route, the same as
"make a 3D model of it". Naming something else ("of a chair", "של כיסא")
still means build it from scratch. `photo_to_3d`, the study note,
`build_3d_model`, `generate_3d_model` and both system prompts now all tell
him the same thing: infer the length, width and height, the hidden sides
and the materials from the picture and from how such objects are made, then
act and state the main assumption in one sentence. He never asks for what
he can see or work out.

**"Bring the camera to this window".** Any window arrives small, in the
bottom-right corner of the window you are working in, whatever size it
was before, and your keyboard stays where it is. What you can name:

- JARVIS's own windows: the camera, the 3D model, JARVIS himself (moved
  only; the orb is small already), and the Shopify, Instagram and TikTok
  panes;
- any program by name: Chrome, Spotify, WhatsApp, VS Code, Word, Explorer,
  and around 40 more with Hebrew names;
- anything else, looked up by program name or window title ("bring the
  YouTube window", "bring obsidian").

In English: bring, move, put, get or pull the thing, then to this window,
to my screen, here, over here, to me, or to where I'm working. In Hebrew:
תביא, תעביר, תזיז, תקפיץ or תשים, then לחלון הזה, לפה, לכאן, אליי, or
לחלון שאני עובד עליו. Anchored to the whole sentence, so "bring up
YouTube" and "take a look here" are untouched. For any other wording the
model has the same thing as the `bring_window_here` tool.

| Step | Where | What it does |
|---|---|---|
| "Here" | Rust `bring_window_here` | The window in front. If that is the orb or the camera (you clicked it), it is the topmost real program window, found by walking top-level windows in Z order. Minimised, cloaked (another virtual desktop), tool and shell windows are skipped. |
| Which window | Rust | Ours by label. A program by score: exact file name, then title, then partial file name, with the topmost winning ties. A Store app is named by its real program, as in gesture zoom. |
| Size | `bring_size` | Camera: 20 % of the screen's width (280–480 px), 5 : 4. 3D viewer: 22 %, square. A program: 30 % (440–760 px), 3 : 2. |
| Place | `bring_place` | Bottom-right of the window you are in, 24 px in, inside the work area. If the orb is in that corner, it tries the other corners in turn. |
| Move | Rust | Restored without activating (`SW_SHOWNOACTIVATE`), then raised above your window without focus (`SWP_NOACTIVATE`). |

If the camera is off, it is opened first. If nothing matches, he says so
and names what is open. If Windows refuses (an elevated program such as
Task Manager), he says why.

**Tested:**

- The stall on the real page, with the page clock jumped forward: a
  request out for a minute, a tool call streaming for 280 seconds, a tool
  running for five minutes, and a request that is really stuck. The
  previous page fails the first cases.
- The 3D wording.
- "Bring": 23 phrasings in English and Hebrew and nine that must not
  trigger, with the camera off, a stale camera window, not found, refused,
  already here, an older app, and the model's tool.
- The size and placement maths as Rust unit tests.
- `main.rs` type-checked for Windows.

**Needs the app rebuilt** for "bring"; the stall fix and the 3D changes are
in the page alone.

## Page 2.10.0: two-hand gesture zoom, for whatever is in front

**The gesture.** In front of the camera, pinch the thumb and index finger of
both hands. Pull your hands apart to zoom in, and bring them together to
zoom out. The zoom is proportional: a little apart is a little zoom, twice
as far apart is a lot. Bring your hands back to where they started and the
zoom goes back too. Open either hand and it stops at once. The next pinch
starts fresh from wherever your hands are.

**Where it runs.** In the camera window, the only window that has the camera
(two webviews cannot share a stream). It needs the camera window open.

| Stage | Where | What it does |
|---|---|---|
| Hand tracking | `vendor/mediapipe` | MediaPipe HandLandmarker, bundled. It works offline and nothing leaves the machine. GPU first, falling back to CPU if the GPU path is slow. |
| Pinch | `gesture-zoom.js` | Thumb tip to index tip, measured in palm lengths. On below 0.30, off above 0.42, two frames each way. A fist guard stops a fist (0.20 on the pinch alone) from counting. |
| Distance | `gesture-zoom.js` | Between the two pinch points, divided by hand size, so leaning toward the camera is not a zoom. |
| Smoothing | `gesture-zoom.js` | A One Euro filter, a median baseline, an 8 % dead zone that is subtracted rather than jumped, then easing and a speed cap. Notches carry hysteresis, so a hand held at a boundary never makes the content twitch in and out. |
| Foreground | Rust `zoom_target` | The window in front, or the last one you used if you clicked the camera or the orb. Reports its program name (a Store app's real one), window class, and whether it is full screen. Re-read every half second, so switching programs mid-gesture carries the gesture over. |
| Adapter | `selectAdapter` | Chooses how this program zooms (table below). |
| Zoom | Rust `zoom_send` | Sends to that window only, while it is in front, and aimed with `WindowFromPoint` so the wheel lands on it and not on whatever sits on top. Nothing is ever moved or resized. |

**How each kind of program is zoomed:**

| Program | Method |
|---|---|
| Browsers, PDF readers, Office, image viewers, terminals, Explorer, JARVIS workspace panes | Ctrl + wheel at the pointer, or at the window's centre if the pointer is elsewhere |
| Blender and other 3D apps | The plain wheel (in Blender, Ctrl + wheel pans) |
| Photoshop | Alt + wheel |
| Electron apps (VS Code, Slack, Discord) | Ctrl + = and Ctrl + - |
| The JARVIS 3D viewer | Directly: the camera eases toward the model's centre |
| Any other windowed app | Ctrl + wheel, which is what Windows itself sends when you pinch a precision touchpad |
| An unknown full-screen app | Nothing (probably a game, where Ctrl + wheel is not a zoom) |
| The desktop, the taskbar | Nothing |

**Settings.** The GESTURES tab in OPTIONS: on/off (on by default), plus:

- Sensitivity
- Movement before it zooms
- Smoothing
- Maximum zoom speed
- Maximum and minimum zoom, counted from where JARVIS first found each window

By voice: "turn on gesture zoom", through the `gesture_zoom` tool. Turning it
on opens the camera.

**Tested:**

- In Node, with landmarks the real model produced from MediaPipe's own test
  photos: two OK signs (a real pinch), relaxed open hands, and a fist.
- End to end in the real camera window, with the real model, on a camera
  stream made from those photos, with the hands moved apart and together.

The Rust half is type-checked for Windows; the full build needs Windows.

## Page 2.9.3 / worker 2.6.6: screen mode out loud, "sir", studied 3D models

**Screen mode went silent.** A description of a screen is full of words the
voice gate was built to catch: a button with an icon *on it*, orders marked
*done*, "*Created* 3 hours ago", הזמנות *שבוצעו*. Each such sentence was held
as an "I did it" with no tool behind it. It was never spoken, and the turn
ended with "I did not actually do that" plus a corrective model round. So he
said "I can see your screen" and then nothing true.

- A turn that carries a picture (screen, camera or photo) now holds only
  claims that cannot be descriptions: "I opened…", a tool's name, a bare
  "Done." or "Opened, sir.", and Hebrew first-person verbs.
- "Done" and "on it" no longer count mid-sentence anywhere.

Separately, a dozing orb strips the wake word *and* its filler words. So
"hey jarvis, you see my screen" arrived as "see my screen", and "look at my
screen" as "at my screen". Neither started screen watching by voice. Both
shapes start it now.

**Sir.** He addresses you as "sir", or "אדוני" in Hebrew, once a reply. The
prompt says so, and so do the lines the app speaks on its own (wake reply,
"Say that again, sir?", "YouTube is open, sir.").

**"Make a 3D model of it."** The picture is no longer sent the moment it is
taken. `photo_to_3d` has two steps, and the page enforces both:

1. The first call only takes the picture: the camera, the screen while
   watched, or a photo. It puts that exact picture in front of the model.
2. Only a second call sends anything, and only with a study that covers
   front, back, left, right, top and bottom (seen or inferred, and from
   what), proportions, materials and symmetry. A thin study is refused and
   names what is missing.

The study does real work on the way out:

- The materials become Meshy's texture prompt.
- The symmetry becomes its symmetry mode, so the unseen side mirrors the
  seen one.
- An optional crop cuts the object out of a busy screen.

The finished model opens in its own window. The window has no frame and no
background, so the model stands on the desktop by itself. Drag turns it,
Shift-drag moves the window, and the ways to close it are right-click →
Close or the taskbar.

## The loop that needed Ctrl+C

`lastSpokeEndedAt` was declared at the top of the file and assigned nowhere in
it. Half the echo guard was therefore comparing `Date.now()` against `0`, which
is false forever, and the other half asked "is he speaking *now*" — a question
about the wrong moment, because transcription is a round trip. Audio recorded
while he was still talking came back a second later, when he had stopped, and
arrived unguarded as a fresh command. He answered himself, and kept going.

The recording is stamped instead of the clock consulted: `captureSawSpeech` is
set when the meter hears a voice during a capture, and travels with that blob
into `transcribeAndSend` and `handleTranscript`. What matters is whether he was
talking *while this audio was being recorded*, and that stays true however long
the transcript took to come back.

Two other ways the same freeze was reachable are closed with it. `getUserMedia`
can hang rather than reject — a busy microphone, a permission prompt nobody
answered — leaving `whisperActive` true forever while the watchdog reads it as
healthy; it now races an eight-second timeout and retries. And a capture left
open longer than a minute is torn down and restarted.

## Saying he did it, and not doing it

He would repeat the task back and stop. The turn ends, the text claims an
action, and no tool was called — so nothing happened, and the only clue was the
absence of a result you had no particular reason to look for.

`claimsAnAction` catches the three shapes this takes — the perfect ("I've opened
YouTube", "פתחתי לך"), the progressive ("I'm opening it", "אני פותח"), and the
bare gerund that is by far the commonest ("Opening Spotify.") — in both
languages. A gerund is only a claim when no finite verb follows it in the same
sentence, which is what keeps "Opening hours are nine to five" out.

When one fires with `loopGuard === 0`, the reply is handed straight back with an
instruction to call the tool now or say plainly that it cannot be done. Once,
never a loop, and never when a tool actually ran.

A tool that ran and *failed* used to count as having run. Asked for a meeting
on 2 November, `create_calendar_event` came back "calendar not configured" and
he said "Done, it's in your calendar" — which nothing checked. Now the turn
records whether anything succeeded (`turnToolSucceeded`), not just whether
something was dispatched: when every tool failed and the last words still
claim success, the reply is handed back once with what failed, and a claim is
held from the voice until a tool has actually worked. `לא הוספתי` ("I did not
add it") is a negation, not a claim, and is read as one.

"Open YouTube" was the case that kept coming back. A fallback model would write
"I called open_url to open YouTube" — read aloud as "open underscore url" — and
sometimes had called nothing at all. Now a site he names on its own (YouTube,
Gmail, Google, Drive, Maps, WhatsApp, Facebook, Instagram, TikTok, Netflix,
Spotify, Shopify) is opened by the app directly, like the camera; "I called
<tool_name>" counts as a claim; and when the call did happen the sentence is
turned into "I opened YouTube" before anyone hears or reads it.

## Serious Mode does not exist on the desktop

`seriousMode()` returns `modeState.mode === 'ultron' && !IS_DESKTOP` — false on
the desktop *by design*, because in the orb ULTRON is the English half of the
language switch and not a second assistant. Every capability gate read that
function, so the desktop app inherited the website's Normal Mode restrictions
and told you a request needed a mode that does not exist there.

Gates now read `fullCapability()`, which is `IS_DESKTOP || seriousMode()`, and
the desktop prompt says outright never to mention another mode.

## Only his name interrupts him

Any sound over the bar used to cut him off mid-sentence. The level meter no
longer votes on whether to stop — only on *when to look*: sustained speech over
his voice shortens the endpoint wait to 260ms so his name is acted on quickly.
Stopping is decided on the words, against the wake list, where there is an
actual transcript to check.

## The camera, as an eye

A camera that only looks when spoken to is a photo booth. With the pane open, a
32×24 grey thumbnail is taken every 900ms and compared twice: against the
previous one, which detects motion, and against the scenes already accounted
for, which detects novelty. Motion only *arms* him — describing something still
being brought into shot means describing a blurred hand. He speaks when the
scene has moved, then settled, and differs from everything in his short scene
memory. A room that never changes costs nothing.

He holds four scenes, not one: with a single reference, putting a part back down
is a large change *away* from the part, and he announces the empty bench. A
matched scene is refreshed in place, so the room may drift with the light all
afternoon without eventually reading as a new one.

He never speaks over himself, over a reply, or over a sentence in progress — but
an *open* microphone is explicitly not a reason to stay quiet, or he would be
silent in LOOP mode, which is exactly where being told what you are holding is
worth most. A user turn always wins: `eyeAbandon()` aborts an in-flight look and
bumps a generation counter so its answer is dropped even if it was already on
the wire.

The character is in the prompt, and it is the point: name the thing, say where
you think each part goes, and **commit to a view when you are not sure** — a
guess labelled as a guess beats "I can't tell" for someone holding a part and
asking where it goes. He can decline a frame by answering with a single `·`,
which produces no bubble, no speech, and pulls the stub turn back out of the
transcript. WATCHING in the pane's own bar mutes it without closing the camera,
and so does `open_camera` with `watch: false`.

## Where things sit

The camera pane was nailed to the bottom-right corner, which is fine until the
thing you want to look at is what the corner is covering. Drag it anywhere by
its picture — the button bar stays clickable — and it stays there across
restarts. Double-click the picture to send it home. It is clamped on every move
and on every resize, so a rotated phone or a shrunken window can never leave it
somewhere you cannot reach it.

The orb's own window is the same story: its position is saved in **logical**
pixels (physical ones mean different distances on different monitors) and
restored on start-up and on leaving fullscreen, instead of being forced back to
the right edge. The saved point is clamped onto the monitor actually attached,
so a position saved on a second screen that has since been unplugged does not
strand him off-canvas. Right-click → Reset position puts both back.

## The language switch only half-landed

`LANG_MODE_KEY` was written on every switch and never once read back, so the
language he chose lasted until the app closed. And `setLangMode` told the *model*
to answer in English without telling the *interface* anything — every status
line, tooltip, the wording the camera is asked with, and the language handed to
the recogniser stayed as they were.

Both are one call now: `setLangMode` applies the interface language too, and the
choice is restored at boot, quietly. The orb's right-click menu has a Language
item opening עברית and English, each named in itself so it is readable in the
one case you need it — when it came up in the language you cannot read. It calls
`setLangMode`, the same function the spoken command calls. They carry the same
weight because they are the same control.

## "He does not stop talking and I cannot give him commands"

A deadlock, and it explains both halves of that sentence at once. The turn ends
when the input level drops; his own voice through the speaker keeps the level
up; so while he is talking the microphone never endpoints, nothing is ever
transcribed, and the name check in `handleTranscript` — the only thing that can
stop him — is never reached. Saying his name over him did nothing, and neither
did any other command, because nothing was ever sent. The fix is three
independent ways out, because the one that matters is the one that works when
the other two have failed.

**Listen while he talks, not after.** While someone is audibly talking over
him, a snapshot of the audio so far is transcribed on a timer — `HUSH_PROBE_MS`,
capped at `HUSH_PROBE_MAX` per reply — without waiting for a pause that may
never come. `hushIfNamed` checks it for his name and stops him. It changes no
turn state; it is a listener for one word, running beside the ordinary
endpointing. The speculative transcript, which already existed to judge whether
a sentence sounded finished, is now checked for his name too.

**A key that cannot be drowned out.** `Ctrl+Shift+X`, registered as a global
shortcut in Rust, emits `jarvis://hush`; the page stops him and closes the
conversation window, so silencing him does not leave the next thing said in the
room being taken as a command. It works with the window hidden and unfocused,
and deliberately does not raise it. The same is on the tray menu, and Escape now
stops him before it does anything else.

**Say less to begin with.** The base prompt says "Brevity is not the goal" and
tells him to work ahead of the user, both of which are right on the website and
wrong when every sentence is read aloud. The desktop branch now overrides them:
a command gets a three-word confirmation and nothing else — no list of what else
could be done there, no proposed next step, no "would you like me to" — a
question gets its answer and a full stop, and volunteering is narrowed to things
that would cost money or data if left unsaid.

## Granting the camera once

The webview remembers a camera permission in its own profile, and that profile
lives in the app's data folder, so an answer given once survives every restart.
It was never remembered because it was never properly *asked*: the permission
prompt is drawn inside the window, and the window is a 180-pixel transparent
circle with no frame, pinned above everything. A dialog has nowhere to land in
that, so the request was dismissed by default, every time.

So the first time the camera is wanted the orb goes fullscreen first, the prompt
appears somewhere it can be read and clicked, and the answer is stored —
`navigator.permissions` is consulted first, so a grant from a previous install
skips the expansion entirely. A refusal is now distinguished from a missing
camera and from one another app is holding, and the refusal message names the
actual setting: on Windows, Settings → Privacy & security → Camera, where "Let
desktop apps access your camera" blocks every app of this kind in one switch.
macOS additionally requires a reason string, so `NSCameraUsageDescription` and
`NSMicrophoneUsageDescription` are now in the bundle config.

## Hearing a third of what was said, and doing none of it

Three faults, compounding, and two of them were introduced by the fix before
this one.

**The echo guard was eating the commands.** It asked whether most of the words
that came back had appeared anywhere in his last four hundred characters. In a
real conversation that is true of almost everything you say, because you answer
someone using the words they just used. Measured against the running code, it
threw away "turn on the camera" immediately after he said "the camera is on
now" — which is exactly the report that he used to be able to open the camera
and no longer could. It also matched on substrings, so `open` was found inside
`opened`; and it treated every utterance under four characters as an echo,
silently deleting כן, לא and ok.

An echo is not a paraphrase. It is his own sentence recorded through the
speaker, so it comes back as a contiguous run of his words in his order. The
test is now exactly that: whole words, and a verbatim run of four of them (or
the entire utterance, when it is shorter). The short-utterance rule is gone.

**And every turn was marked suspect before it began.** `captureSawSpeech` was
seeded with `Date.now() - lastSpokeEndedAt < 1500`, while conversation mode
reopens the microphone 400ms after he finishes — so the flag was true at the
start of every single conversational turn, and every turn was then at the mercy
of the test above. The window is now 250ms, shorter than any restart that
follows speech. There is a check in the suite that fails if it ever grows past
one again.

**He was told to say "Opened."** The desktop brevity rule offered it as an
example of a complete answer, which taught him to confirm without calling
anything. Worse, `claimsAnAction` — the corrective pass that exists to catch
precisely this — missed it: the English pattern requires an "I" before the verb
and the gerund pattern only knows `-ing` forms, so `Opened.` `Closed.` `Saved.`
and `Sent.` all went through unchecked. The one phrasing the prompt taught him
was the one phrasing the safety net could not see.

The rule now separates the two questions it had conflated: brevity governs how
much he SAYS and never whether he ACTS, a command is named as a thing to do
with the tool named for it, and writing *opened* without a tool call having run
in the same turn is forbidden outright. The detector gained bare past
participles in both languages — with a Hebrew word boundary written as
`(?![֐-׿])`, because `\b` is defined on ASCII and never matches after
a Hebrew letter, so a pattern written with it silently never fires.

## From assistant to agent

Four things he could not do before: keep a record of what he did, do anything
without being asked, turn a photograph into an object, or change the store.

**The action log** is the foundation and the reason the rest is safe. Every
tool call is recorded before it runs and completed after it returns, with its
arguments, its result and how long it took, kept on disk because the question
it answers is usually asked after a restart. Three states are told apart at a
glance: it worked, it failed, or it started and never came back — that last one
used to be invisible. It reads the RESULT, never the reply, which is what makes
it the answer to the bug we spent a week on: a turn that said "Opened." and
called nothing leaves no row at all, and an empty log under a confident
confirmation is the evidence that the confirmation was false.

**Standing tasks** are work that outlives the conversation: a row on disk with
a goal, a schedule and a memory of when it last ran. "Every night at two, make
the advert." "Tell me the day before anything in my calendar." They run in the
app, which has one honest consequence: an hour that passes while the machine is
off does not fire at that hour — it fires at the next launch instead, once,
saying it is late. A week away produces one advert, not seven. They never speak
over him, they go through the ordinary tool loop so they have everything he has,
and every action they take is logged as coming from the schedule rather than
from you.

**A photograph into a model.** Meshy's image endpoint is a different version, a
different URL and a single pass — the picture already carries the colour, so
there is no preview-then-paint chain — and which kind a task is has to travel
in the query string, because the worker keeps no state and cannot look a task
id up later to find out. It takes the last picture he sent or a fresh frame off
the live camera, and it refuses to fall back to inventing an object when there
is no picture, because a model of an imagined thing is not what was asked for.

**A window of its own** for looking at one properly: a real window, framed,
resizable, deliberately not pinned above everything, that can sit beside the
work it is about. It loads `model.html` rather than the app's own page —
index.html starts a microphone, a scheduler and a hologram the moment it loads,
and opening a second copy of all that to look at a mesh would run the whole
assistant twice. Asked again, the existing window is reused. Its X really
closes it; only the orb refuses to close, because its conversation lives in the
page.

**And writes are open**, at the owner's explicit choice, with no approval step.
The read-only guard did not disappear, it became a declaration: a caller that
means to change something has to say so, so that a document merely mentioning
the word cannot become a write by accident and a read path cannot be widened
into a write path by a prompt that talked its way into the query field. What
replaces the gate is the record — and for a write, the previous state is read
first, while it is still the previous state, so the log says what a price WAS.
That is the difference between "undo this" and "work out what it used to be".

## JARVIS as supervisor, not sole worker

He does not have to do everything himself any more. Nineteen narrower
personas — Research, Competitor Intelligence, Product Development, Creative
Director, Copywriter, Store Manager, Inventory, Analytics, Marketing, Social
Media, Finance, Customer Support, Coding, System Monitor, Security, QA/Website
Testing, Personal Assistant, News/Intelligence, Memory — sit on top of the
same backend, each with its own system prompt and its own permitted slice of
the tools that already existed. Nothing about plain JARVIS changed: he is
still the whole assistant with his whole toolbelt by default, and a persona
never gains a tool JARVIS does not already have a precedent for.

**The registry has one home.** `AGENT_REGISTRY` lives in `jarvis-worker.js`
and nowhere else — `GET /agents` is how the page finds out who exists, what
each one may touch, and what risk band it sits in. Ask "how is the business
doing" and JARVIS can fan the question out to several of these at once — real
concurrency, not a queue — and fold their independent findings into one
answer that says where they agreed and where they didn't, rather than
pretending one specialist's view was the whole picture.

**Permission is default-deny**, and three capabilities — running an arbitrary
shell command, touching a payment, deploying to production — are granted to
*nobody*, enforced in code rather than left as a rule to remember. The one
genuinely new power here is the Coding Agent's: it can read and write files
and use git, but only inside one folder set aside for it, and only a write
needs his sign-off first. Everything he had already decided about Shopify and
WhatsApp writes — no approval step, the action log is the record — stayed
exactly as it was; this did not reopen that choice.

**Four of the nineteen run with nobody watching.** Competitor Intelligence and
News/Intelligence fire from the same Cron Trigger that already sends "at 4pm"
messages with the computer off, read the public web, and write a note to
memory rather than a stream of chat messages nobody is there to read.
Analytics and Inventory joined them: read-only Shopify checks, on a schedule,
with no way to become a write — a mutating query is refused before it ever
reaches the store, whatever is asked for. Store Manager, which does hold a
write permission, stays deliberately off any timer. A daily summary — built
from what actually happened, sent once, silent on a quiet day — goes out the
same way, through the WhatsApp outbox already documented above.
