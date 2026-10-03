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

## The 3D service: Tripo (recommended) or Meshy

Since worker 2.7.0 3D models can be made by **Tripo** or by **Meshy**. The
worker uses Tripo whenever it has a Tripo key, and Meshy otherwise, so
nothing changes for a worker that only has a Meshy key. Both keys live on
the worker, never in the app.

**Tripo** has no subscription: a new API account starts with free credits
(2,000 at the time of writing, roughly 40 to 65 textured models), and after
that credits cost $1 per 100. To set it up:

1. Sign up at platform.tripo3d.ai and open **API Keys**. Creating the first
   key is what gives the starting credits. The key starts with `tsk_`.
2. In the Cloudflare dashboard, open the jarvis worker → Settings →
   Variables and Secrets → add a **Secret** named `TRIPO_API_KEY`.
3. Deploy the worker, then ask JARVIS "is my 3D key working?". He reads the
   balance from Tripo itself (nothing is made, nothing is spent) and says
   whether the key works and how many credits are left.

Details: a picture is uploaded to Tripo and turned into a textured model
(the picture carries the colour, so the texture prompt and symmetry hints
that Meshy takes are not sent); a sentence becomes a text-to-model task.
Tripo task ids travel as `tripo:<id>`, so a job already running finishes on
its own service even if the keys change. `MODEL3D_PROVIDER=meshy` (or
`tripo`) prefers one service when both keys are set. `/health` reports
`model3d_provider`. Errors are named the same way as Meshy's:
`tripo_key`, `tripo_credits`, `tripo_busy`, `tripo_down`, `tripo_content`.
Written from Tripo's published API without a live key, so the first real
model is worth watching: `/model3d/check` and the error text are there to
make a mismatch quick to see.

### The Meshy key

Meshy needs a paid plan to create a key of your own. The key lives on the
worker:

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

## Music: "let's put some music" plays the jarvis playlist on YouTube

The same commands as before ("let's put some music", "let's hear some music",
"play some music", "put on my playlist", "music please", "שים מוזיקה", "בוא נשמע
מוזיקה", "תפעיל מוזיקה", "תנגן את הפלייליסט"...). He finds your YouTube playlist
named **jarvis** (any spelling: Jarvis, JARVIS, ג'רוויס, ג׳רוויס, גרוויס,
ג'וויס) and opens it in your browser at its first video, so it plays from the
start, in order. "Stop the music" / "תעצור את המוזיקה" pauses it; "next song",
"previous" and "resume" go through the keyboard's media keys, which the browser
hands to YouTube. (2.22.0 used Spotify; its developer API now needs a Premium
account, so it was dropped.)

**Setup, once. Either way works:**

- **The quick way, no sign-in.** Make the playlist *Public* or *Unlisted*, copy
  its link (Share → Copy link), and put it on the worker as a secret:
  `wrangler secret put JARVIS_PLAYLIST` (or Cloudflare → the worker → Settings →
  Variables and Secrets → Add → Secret). Deploy. Done.
- **By name, from your channel** (private playlists too, and the name can
  change later): uses the Google sign-in the calendar already has.
  1. In [Google Cloud console](https://console.cloud.google.com/), the same
     project as the calendar: APIs & Services → Library → **YouTube Data API
     v3** → Enable.
  2. Nothing to add to the redirect URIs: since worker 2.9.1 the YouTube
     sign-in comes back to the calendar's address (`/calendar/oauth`), which
     is already registered. (2.9.0 used `/youtube/oauth`, and Google refused
     it with `redirect_uri_mismatch`.)
  3. If Google says the scope is not allowed: OAuth consent screen → Data
     access → add `.../auth/youtube.readonly`. Google shows the
     unverified-app warning when you connect; it is your own app: Advanced →
     continue.
  4. Say **"connect YouTube"** and approve; pick the channel that has the
     playlist.

Whether it starts with sound is the browser's choice: Chrome plays YouTube
automatically on a computer where YouTube is used regularly; if it ever opens
paused, one click on the video starts it (and from then on it autoplays).

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

## Page 2.12.0: whole hands, and precise control (one hand turns a 3D model)

**The whole hand.** The camera window now draws every hand it sees in full,
all 21 points and the bones between them, before any pinch, so you can see
the hand is being tracked. The measuring changed with it:

- a hand's size is the wrist to all four knuckles, in 3D, using the depth
  the tracker gives;
- its position is the palm centre, not the fingertips.

On a real side-on hand from the test photos, the old flat measure read the
hand's length as 5.6 times its width; with depth it reads 1.26, as a hand
facing the camera does. In practice:

- tilting your hands toward or away from the camera is no longer a zoom.
  In the test, a 55° tilt gave 0 zoom steps with depth, and at least 3 with
  the old measure;
- a fist is still never a pinch: the fist guard moved from 0.33 to 0.38,
  because with depth a fist reads up to 0.31. Every real pinch reads 0.52
  and up.

The two-hand zoom itself is unchanged: both pinches, then the hands moving
apart or together, with the line between the pinch points.

**Precise control.** Pinch with ONE hand (the other open or out of view)
while a 3D model is open, and the model turns with your hand. Right turns
it right, left left, up up, down down, and every direction in between
turns it that way too. It goes all the way round, over the top as well; the
viewer turns it like a trackball about the model's own centre. Details:

- it turns 12° for every centimetre the hand moves (the "Turn per cm"
  slider, 3 to 40);
- the hand's position is its palm centre, smoothed, so a still hand turns
  nothing.

It does not fight the zoom:

- a single pinch has to be held 0.22 s, and then move more than 4 mm,
  before anything turns;
- a second pinch always makes it a zoom;
- after a zoom, the hand still pinched does not start turning when the
  other lets go, until both hands open.

Only 3D models: the camera window asks every two seconds whether a model is
open (`jarvis://model-ping`, answered by the viewer with `model-pong`). With
none open, a single pinch does nothing, and the camera says "no 3D model
open". When your hand takes the model, the spin stops. **STRAIGHTEN** in
the model's right-click menu puts it back the way it arrived. Precise
control has its own switch and speed slider in the orb's GESTURES tab. The
`gesture_zoom` tool takes `turn` to switch it on or off by voice.

This needs the app rebuilt: the camera and viewer pages are inside it, and
the viewer has a new permission to answer the camera window
(`core:event:allow-emit` in `capabilities/model.json`). Tested in:

- `turn.test.mjs` (50, real hands with depth);
- `rotate.e2e.mjs` (25, the real hand tracker in the real camera window);
- `viewer.e2e.mjs` (43, the real viewer in WebGL);
- `gesturepanel.e2e.mjs` (27).

## Page 2.11.3: the desktop app still said "Meshy"

The desktop app has the page baked into it when it is built
(`frontendDist: ../dist`), and keeps its own conversation and memory, so
uploading a new `index.html` to the website changes only the website. Two
things follow, and this version addresses the second:

- the desktop app shows a new page only after it is **rebuilt**;
- what JARVIS says about his 3D service came from that saved history, never
  from the worker, because the page did not tell him. It now adds one line
  to every request, read from `/health` (`model3d_provider`): "3D models are
  made by Tripo ... if your memory names a different service, that is out
  of date". A worker that does not report a provider adds nothing.

Tested in `tripo.e2e.mjs`.

## Page 2.11.2 / worker 2.7.0: Tripo as the 3D service

Meshy needs a paid plan to make an API key, so the worker can now use
Tripo, which starts with free credits and has no subscription. See "The 3D
service" above for setup. The page did not need a new flow, only to know
the new error codes and to take the fix text from the worker. Tested in
`tripo.test.mjs` (63, the real worker against a stub that behaves like
Tripo's API, including multipart upload and both services side by side) and
`tripo.e2e.mjs` (16, the real page, task id with a colon, both languages).

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

## Page 2.13.0: your own 3D WORKSPACE app (needs the app rebuilt)

**"Open 3D workspace"** starts your own program, 3D WORKSPACE. It works
with the wording loose: "open the 3D workspace", "launch 3-D work space",
"start 3D workspace", "can you open 3D workspace please",
"תפתח את ה-3D workspace", "תפתח את סביבת העבודה התלת מימדית".

**"Open a new project at 3D model workspace with this model"** starts it
with the last 3D model JARVIS made. Other wordings work too:

- "put this model in 3D workspace", "open it in 3D workspace";
- "new project in 3D workspace with the model you just made";
- "תפתח פרויקט חדש ב-3D workspace עם המודל הזה", "תעביר את המודל ל-3D workspace".

How it works:

- The model is saved as a `.glb` in `JARVIS\3D Workspace\` (next to it,
  `latest-model.json` names the newest one).
- The program is started with that file's full path as its one argument,
  the same way Windows does "Open with". If your app reads its first
  command-line argument, it opens the model straight away.
- With no model made yet, it opens the program and says so.

**Finding the program.** JARVIS looks for a name containing "3D" and
"workspace" (a shortcut, an .exe, or an install folder) in these places:

- the Start menu (yours and everyone's);
- the desktop (including OneDrive's);
- `%LOCALAPPDATA%\Programs`;
- Program Files;
- Documents.

Uninstallers and setups are never picked. The place it was found is
remembered. If it cannot be found, he says so: put a shortcut named
**3D WORKSPACE** on the desktop, or tell him where the program is (the
`open_3d_workspace` tool takes the path, and remembers it).

"Open workspace" on its own is still the Shopify/Instagram dashboards. A
question about the app ("what is 3D workspace"), "close 3D workspace", or
"don't open it" is never taken as the command.

## Page 2.13.1: hand tracking reads every camera frame (needs the app rebuilt)

**Before.** The tracker ran on a timer: 30 ms after the last detection while
hands were in view, 110 ms when there were none. The timer knew nothing of
the camera, so:

- frames that arrived between two ticks were never looked at;
- the same frame was sometimes read twice;
- a hand coming into view first waited out the slow idle tick.

That was the missed frames and the stutter. Measured on the same camera
feed, the old loop read 33 times for 17 frames.

**Now.**

- The video calls the tracker for every frame it shows
  (`requestVideoFrameCallback`), and each frame is read exactly once, with
  hands in view or not. In the same test: 24 frames, 24 reads, none missed,
  none twice.
- The camera is asked for 60 frames a second (`frameRate: { ideal: 60 }`).
  A camera that cannot do 60 gives the most it can, and is never refused.
  The camera window's status line shows the rate it got (for example
  "1280×720 · 60 fps — live").
- The picture sent to the orb every 400 ms used to be JPEG-encoded on the
  camera window's own thread, which stalled the tracker each time. It is
  now encoded off that thread. While your hands are in view it goes every
  1.2 s instead, which is still fresh for "look at this".
- The tracker's confidence thresholds stay at 0.55 / 0.5 / 0.5. Lowering
  them to 0.4 was tried and measured: on the real hand photos it read OK
  signs as open hands, so it was not kept.
- `stats()` reports frames read, missed and the rate (`fps`), for checking.

## Page 2.14.0: a full turn is 3/4 of the screen

Precise control (one pinched hand turning a 3D model) is now measured on
the screen, not in centimetres. Moving the hand across **3/4 of the
picture is one full turn (360°)**, however far the hand is from the camera
and however fast it moves:

- across: 3/4 of the width is 360°, so a quarter of the width is 120°;
- up and down: 3/4 of the height is 360°;
- diagonally: both at once, in proportion.

Because it is the distance on the screen that counts, the nearer your hands
are to the camera, the less real movement a turn needs. Your hand looks
bigger and covers the screen faster. In the test, a hand near the camera
turned about 3 times more per real centimetre than one far away, for the
same 240° over half the screen.

The orb's GESTURES tab replaces "Turn per cm" with **"Full turn across"**:
25% to 150% of the screen, 75% by default. An old saved "turn per cm"
value is ignored. The dead zone (the first 4 mm after pinching) and the
glitch guard are unchanged.

## Page 2.15.0: "let me see your agent system" opens the Agent Atlas, and your hands steer it (needs the app rebuilt)

**The command.** "Hey Jarvis, let me see your agent system" opens **JARVIS
Agent Atlas**, your 3D map of the agents (the Tauri app built from
`jarvis-atlas-desktop`). Other wordings work too:

- "show me your agent system", "open the agent atlas", "open the atlas";
- "show me the agent map", "let me see all your agents";
- "תראה לי את מערכת הסוכנים שלך", "תפתח את מערכת הסוכנים", "תפתח את האטלס".

If the Atlas is already open, it is brought to the front instead of opened
twice. A question about the agents ("what did the agents find today",
"מה הסוכנים מצאו") is not this command and still goes to JARVIS as before.
JARVIS finds the program the same way as 3D Workspace (Start menu, desktop,
`%LOCALAPPDATA%`, Program Files), and remembers where it found it. The
`open_agent_atlas` tool covers any other wording.

**Hand control, like the 3D models.** With the camera on and the Atlas in
front:

- **one pinched hand turns the map:** right is right, up and down tilt it,
  3/4 of the camera picture is a full turn (a quarter of it measured
  116.5°);
- **two pinched hands zoom it** (the plain wheel, forward is in).

The Atlas is a separate program, so JARVIS steers it the way you would with
the mouse. A left-button drag turns it (OrbitControls: one window-height of
drag is 360°); the drag lets go and takes hold again at the window edge, so
a turn never runs out of room. Your pointer goes back where it was
afterwards. If you switch to another program mid-turn, the button is let go
at once; if the camera stops talking for 2 s, a watchdog lets it go too.

**Where it presses.** A press on one of the Atlas's labels never reaches the
3D view, and its release clicks that agent. The labels turn with the map,
so no fixed spot is always free: tested over 98 views, the first spot was
covered in 52 of them. So JARVIS tries each spot the way a person would. It
moves the pointer there and presses only where the Atlas shows the plain
arrow, not the hand it shows over a label or an agent. The same goes for
the wheel.

**Tested on the real Atlas page** (the atlas-build-1 build, in Chromium with
WebGL):

| Asked | Measured |
|---|---|
| 90° right | 88° |
| 60° back | 56° |
| 400° (one fresh hold at the edge) | 395° |
| 20° tilt | 18.4° |

- A point on the map moves the way your hand does.
- A pinch that barely moved never clicks an agent.
- Four wheel notches zoom it in.
- In all 98 views (every department, every agent and tool, the overview
  turned all the way round), the press landed on bare map.

## Page 2.16.0: one hand scrolls everything else, one finger is the mouse in the Agent Atlas (needs the app rebuilt)

**One pinched hand: 3D turns, everything else scrolls.** The one-hand pinch
still turns a 3D model (the JARVIS viewer) and the Agent Atlas when one of
them is the window in front. Over anything else (a browser, a document,
Explorer, any program the wheel reaches), it grabs the page and scrolls it.
The page follows your hand, as on a touch screen:

| Your hand | The page |
|---|---|
| down | comes down (scrolls **up**) |
| up | goes up (scrolls **down**) |
| to your right | scrolls **left** |
| to your left | scrolls **right** |

- **Speed:** a quarter of the camera picture is four wheel notches. The new
  "Scroll speed" slider in the GESTURES tab goes from 0.25× to 4×.
- **Smoothness:** small movements add up and are never lost. Browsers and
  Office scroll by the fraction, so it is smooth.
- **What is in front decides:** a JARVIS 3D viewer left open behind the
  browser is no longer turned by the pinch.
- **No scrolling** in programs whose wheel is their zoom (Blender, other 3D
  programs).

**In the Agent Atlas, one finger is the mouse.** Raise only your index
finger, the others folded:

- the fingertip moves the pointer;
- the middle of the camera picture spans the whole window, so you never
  reach for the edges;
- your right is right.

**Fold the finger: a left click.** While the finger bends, the pointer
freezes, so the click lands where you were pointing, not where the bending
fingertip drifted. The click rules:

- one fold is one click;
- straighten the finger and the next fold is the next click;
- a half fold that comes back is no click;
- holding the fist clicks nothing more.

A pinch on your other hand still zooms or turns, and takes over from the
pointer.

**How it was measured, on MediaPipe's real hand photos:**

- **Finger straightness:** "straight" is the wrist-to-fingertip distance over
  the wrist-to-middle-joint distance, in 3D. A straight finger reads
  1.17–1.41, a folded one 0.60–0.75. Of all 16 hands in the set, only the
  pointing hand counts as pointing; the fist, the thumbs-up, the victory
  sign, open hands and OK signs do not.
- **A still finger:** with tracker jitter, it wanders 4 px on a 1920 window.
- **A stopped finger:** the pointer settles within a frame.
- **End to end with the real tracker:**
  - a real pointing hand moved the pointer the way the hand moved;
  - swapping it in place for a real fist clicked exactly once, where it had
    pointed;
  - on the real Atlas page, that click opened the item under the finger.

**A bug fixed on the way.** A single hand that changed slot, for example
after the tracker briefly saw a second hand, kept its old slot's pinch for
a moment. That alone set the "after a zoom" latch, which locked the
one-hand gesture out until both hands opened. Now only two hands really in
view count as a zoom.

## Page 2.17.0: the index finger is the mouse everywhere on the computer (needs the app rebuilt)

The finger mouse from 2.16.0 is no longer only for the Agent Atlas. It works
anywhere: the desktop, the taskbar, a browser, any program.

- **Point:** raise your index finger, the others folded, and hold it a
  quarter of a second (so a passing gesture while you talk does not take
  the mouse). The fingertip then moves the real mouse pointer.
- **The map:** the middle of the camera picture spans the whole monitor
  the pointer was on when you started, taskbar included. The map stays on
  that monitor while you point, so a window coming to the front never
  moves it under your finger.
- **Click:** fold the finger for a left click, right where you were
  pointing; the pointer freezes while the finger bends. Straighten it and
  fold again for the next click.
- **Stop:** lower the hand (or open it) and the pointer stays where you
  left it, like a mouse.
- **On/off:** a new **👆 FINGER MOUSE** switch in the GESTURES tab. The
  gesture tool JARVIS uses has a `pointer` option for it too, so he can
  switch it when you ask.

The one-hand pinch (turn or scroll) and the two-hand zoom are unchanged. A
pinch on your other hand still takes over from the pointer.

Tested end to end with the real tracker and real hands, in the Atlas, in a
browser and on the bare desktop: the pointer followed the hand, a fold was
exactly one click, and switched off nothing moved.

## Page 2.18.0: the finger mouse by its angle, one gesture at a time (needs the app rebuilt)

**The click is now an angle.** The finger is read as how far it is bent,
in degrees, measured from **your own** straight finger. Your straight is
what it read while you held it up to start, and it is followed as your
hand turns.

- **Fully straight** (within 15°): the mouse follows the finger.
- **Between straight and 45°:** nothing happens. The pointer stays where
  it was, even if the hand moves.
- **Bent 45° or more:** one left click, where the finger was last
  straight. After that nothing happens until the finger is fully straight
  again; then the next 45° is the next click.

Why it was hard before: "folded" was the wrist-to-tip distance over the
wrist-to-middle-joint distance. That number hardly moves when the finger
bends at the big knuckle. MediaPipe's real pointing hand, bent 90° there,
still read as straight. So only a nearly full curl clicked, and a finger
bent 45° or 55° never clicked at all.

**One gesture at a time.** A pinch on either hand stops the finger mouse
at once: no move, no click. That includes a pinch by the pointing hand
itself, which used to be taken for its own click and ignored. When the
pinch's scroll or turn, or the two-hand zoom, really begins, the finger
mouse lets go. It never starts while a pinch is on. A pinch dropped
before it scrolls is never a click either: the pointer waits for a fully
straight finger first, as after a click. Before, the pointing
hand could pinch and scroll while the pointer stayed held, and the window
label said POINTER instead of SCROLL.

**Less sticking:**

- **The pointer's smoothing:** it now reacts faster. The first 8 px of a
  slow move come a quarter sooner, and it lags 40% less while moving. A
  still finger still wanders under 4 px of a 1920 x 1080 screen.
- **The other three fingers:** while you point, they only need to stay
  curled. They used to need a tight fold, so loosening them a little froze
  the pointer, then dropped it.
- **A scroll pinch that opens for a moment** (a fast hand blurs) no longer
  ends the scroll. It waits 150 ms and carries on from there. It used to
  stop, re-arm and stall for about a third of a second.

**Tested:**

- **Unit tests:** run on MediaPipe's real pointing hand, its index bent by
  known angles at its own joints. A 45° bend reads 45.0°. 53 tests,
  24 of which fail on 2.17.0.
- **End to end:** with the real tracker on real hands. A straight finger
  moving read 8.7–12.1°, never more than 2.7° from its own straight, and
  every frame moved the pointer. The pointing hand switching to a real
  pinch gave no click, let the mouse go, and scrolled.

## Page 2.19.0: the finger mouse as one continuous line (needs the app rebuilt)

**What you saw in the video.** The camera gives a position about 30 times a
second, and each one is a tenth of a second old. 2.18.0 sent every sample
straight to Windows. So the cursor moved in thirty small steps a second,
unevenly, since the calls that carried them did not arrive evenly. And when
the tracker lost the hand for a few frames, the cursor froze and then
threw itself to wherever the hand was found. The video also shows the
tracker itself missing: in the second where the mouse is on, the pink ring
sits on your face while your finger is on the left. No filter can fix a
wrong answer, but it should not follow it blindly either.

**A thread in Rust moves the cursor** (`glide.rs`, about 250 times a
second, only between pointing and letting go):

- **It coasts.** Between two samples the cursor keeps going at the hand's
  speed, so the path is a line. Under 100 px/s nothing is extrapolated, so
  tracker jitter never becomes motion.
- **It leads a little.** At most 20 px ahead of where the hand has got to.
  The camera is a tenth of a second late and this takes part of that off.
  The cursor still arrives at a stop from behind, since the lead is less
  than the delay. A hand that stops dead at 1000 px/s is passed by about
  35 px, and the cursor settles.
- **It bridges a dropout.** With no new sample the cursor keeps going,
  slowing, for at most 100 ms of travel.
- **It never jumps.** Its step is limited to the hand's speed plus
  2500 px/s, so a hand found again far away is a quick glide.
- **A click goes exactly where you pointed**, from rest.
- **The Windows timer** is asked for 1 ms steps while the cursor is being
  moved, and let go after.

**The page gives Rust the finger's speed** with its place. The pointer
tracker also:

- **Does not believe a jump.** A fingertip that lands further than any hand
  moves in a frame (5% of the window, plus 1.5 windows a second for the
  time since the last answer it believed) is ignored. It is believed only
  when three answers in a row agree with each other.
- **Carries on through a flicker.** The other three fingers' reading can
  go wrong for a frame or two as the hand turns. For up to 3 frames the
  pointer keeps following while the index is straight. It used to hold,
  then let go.
- **Stops cleanly on a pinch or a bend.** The first frame says "stop here"
  with no speed, so the cursor does not coast on into a pinch or a click.
- **Rearms by itself.** After a click or a pause, a finger that reads under
  30° of your straight for a second and a half (the angle reads high for
  good, or your straight moved) is straight enough and follows again.
  Bent 40° or more it stays frozen: that is not a rest.

**Measured, on the whole chain.** A real hand (MediaPipe's pointing photo)
was moved along known paths and seen through a camera with a 100 ms delay,
30 fps and ±1.5 px of noise. The real gesture code ran in front of it. In
place of Windows was `glide.rs` itself, built as a program. "Step" is the
biggest move between two looks at the cursor at 144 Hz.

| | 2.18.0 | 2.19.0 |
|---|---|---|
| Medium sweep, step | 52 px | 14 px |
| Medium sweep, how far behind the hand | 100 px | 74 px |
| Circle, how far behind | 80 px | 53 px |
| Lost frames, worst jump | 301 px | 22 px |
| Lost frames and ghosts, worst jump | 742 px | 26 px |
| A still hand, wander over 2 s | 4.2 px | 4.2 px |

**What stays.** The camera is still a tenth of a second late and the
tracker still sometimes misses. This makes the cursor smooth and keeps it
from teleporting. It does not make the tracker see better. If the pink
ring is off your finger in the camera window, that is the tracker's
answer, not the cursor's.

## Page 2.20.0: the camera is measured, and half a minute of tracking can be recorded (needs the app rebuilt)

**The camera window now measures what the camera really does**, each
second, instead of showing the camera's setting. Before, "30 fps" was only
what the camera was *asked* for. A webcam in a dim room quietly drops to 15
fps, and that alone makes a cursor jumpy. The window's line now reads, for
example, `1280×720 — live · 27 fps · 38 ms · late 92 ms`:

- **fps:** the pictures a second the camera gives. Under 24 it adds LOW.
- **ms:** how long the tracker takes to read one picture.
- **late:** how old a picture is when it has been read. The browser stamps
  each frame with the moment the camera captured it, so this is measured
  and not guessed. If the stamps are missing it shows nothing.

The same three numbers show under the buttons in the GESTURES tab.

**The cursor's lead follows the delay.** Rust looks a third of the measured
delay ahead (10 to 45 ms; 30 ms when unknown), and its cap scales with it. A
slow camera gets more help, a fast one less overshoot.

**⏺ RECORD TRACKING (30 s)**, in the GESTURES tab, is for studying your
camera and your hands instead of guessing. Press it, then for half a minute
point and move your finger around the screen: slowly, fast, in circles, a
few clicks, in and out of the camera's view. A file is saved in
`JARVIS\Tracking\tracking-<date>-<time>.json`. It holds, per frame:

- when the frame was read and how long that took;
- the camera's own stamps for it;
- the 21 points of each hand, and how sure the tracker was;
- what the pointer did.

The header names the camera and lists what it can be set to (exposure,
frame rate). **There is no picture in it, only numbers.** Send it to
Claude.

The file can be replayed through the real gesture code and the real
`glide.rs` (`replay.mjs` in the working folder). That says how many frames
the camera lost, how long a read takes, how often the tracker is unsure,
and what the cursor does on *your* frames.

**What can be done about a slow camera** (the numbers in the window say
which one you have):

- **Under 24 fps:** more light, in front of you and not behind. Webcams
  lower their frame rate to gather light. In the camera's own software (for
  Logitech: G HUB or Logi Tune) switch off "low-light compensation" or
  "RightLight" and any automatic frame rate. Plug it into a USB 3 port,
  directly and not through a hub.
- **A read over 40 ms:** the tracker is on the CPU, or the GPU path is
  slow. The camera window says which in the log; "delegate": "CPU" can be
  forced in the saved settings.

## Page 2.21.0: the hand is read twice as fast (needs the app rebuilt)

**What the photo showed.** The camera window's line read `30 FPS · 139 MS ·
LATE 162 MS`. The camera was fine at 30 pictures a second. But a single read
of the hand took 139 ms, so the tracker could read only about 7 pictures a
second. That is what made the cursor jump: the Rust glide fills in the gaps,
but it can only guess between positions that are 140 ms apart.

**Three causes, three fixes** (measured on the same real tracker, on the CPU
path, where a read took 117 ms before):

1. **The wrong path was probably chosen for good.** The page tries the
   graphics card first and switches to the CPU if the first 20 reads average
   over 70 ms. But a graphics path's first read compiles its shaders and
   takes a second or more. One read of 1.5 s among 20 gave a 104 ms
   "average" for a card that reads in 15 ms, so it was thrown out for good.
   The verdict is now the *median* of the reads after the first six, taken
   after 36. A test with a 1.5 s first read keeps the card; the old code
   switched. A genuinely slow card (110 ms a read, steady) is still dropped.
   The line now names the path (`GPU` or `CPU`), so you can see which one you
   are on.
2. **A picture read at its full size costs more than needed.** On the CPU
   path the picture is drawn at 960 wide first. Same hand, about 30% faster;
   the fingertip moves by under half a camera pixel. The graphics path still
   gets the video as it is.
3. **While one hand is in view and two are asked for, the palm detector runs
   on every frame** to look for the second. That is half of a read. While the
   finger is the mouse, only that hand is looked for (about 45% faster), and
   two hands again as soon as the pointer lets go. A change takes about
   15 ms and one re-detection, so it is not done more often than every 1.5 s.

**The trade.** While you are pointing, the other hand is not seen, so you
cannot start a zoom with it. Lower the finger first (the pointer lets go
after a third of a second) and then use both hands. The one-hand pinch
(scroll, turn) still looks for two hands.

**Measured** (real tracker, CPU, one pointing hand): 117 ms a read became
about 55 ms, so about 18 reads a second instead of 8. On a machine like
yours (139 ms) expect about 65 ms. If you are on the CPU and still see 60
ms or more, a working graphics path (up-to-date driver) is the next gain.

**Switches** for tuning, in the saved gesture settings: `trackWidth` (960;
0 = as the camera gives it) and `oneHandPointing` (true).

## Page 2.22.0 / worker 2.8.0: why he stops answering, said out loud; music; record tracking in the menu

**"He does not answer."** There are five different reasons, and in the
small orb none of them showed on screen:
- the server cannot be reached;
- the session has expired;
- every thinking engine is out of credit;
- the transcription allowance is spent (Workers AI's free 10,000 neurons a
  day are shared by speech, chat fallbacks and pictures, so a long day of
  talking runs them out);
- listening is switched off.

Three changes:

1. **Groq hears him first (worker 2.8.0).** `/stt` sends the recording to
   Groq's `whisper-large-v3-turbo` whenever a Groq key exists anywhere on the
   worker: `GROQ_API_KEY`, or a `gsk_` key already in one of the chat slots
   (`PRIMARY_API_KEY`, `FALLBACK_API_KEY`...), so no new secret is needed if
   you have one. Its free tier is about 2,000 requests and 8 hours of audio a
   day, separate from Workers AI. Workers AI stays behind it, unchanged, when
   Groq refuses or returns only a hallucination. `/health` now says
   `stt_via: groq | workers-ai` and the key's name, never its value.
2. **"Check yourself" (orb right-click menu).** He asks each of these in
   turn and *says* what he found: the server, the session, each engine (the
   failing one by name, and which one he is answering through instead),
   hearing, listening off, push-to-talk, a 3D lock, and the camera's real
   numbers. The full report goes on the clipboard, so you can paste it to
   Claude.
3. **The voice can no longer hold everything up.** A `/tts` request that did
   not answer used to stall the whole speech queue, and every reply after
   it with it. After 15 s the line is spoken in the computer's own voice
   instead.

**The camera rests when no hand is there.** With no hand in view for 2 s,
the tracker reads at most one frame every 120 ms instead of every frame. It
was using a whole core, and the graphics card, all day on an empty picture,
beside JARVIS's own page. A hand coming in is seen within one of those reads,
and from then on every frame is read again. The camera window's line says
`resting` (the GESTURES panel: `resting (no hand in view)`).

**Record tracking is in the menu.** The GESTURES panel is not on screen in
the desktop app, which is why the button could not be found. Right-click the
orb → **Camera & hands ›** → **⏺ Record tracking**. He says when it starts,
and then where the file is saved (`JARVIS\Tracking`). The same page has
**👆 Finger mouse** and **✋ Hand control** on/off, each confirmed out loud.
"Record my hand tracking" works by voice too (the `gesture_zoom` tool's
`record`). The menu was made to fit the 180 px orb: Reset position and Hide
moved under **More ›**.

**Music** (see "Music" near the top): "let's put some music" plays the
**jarvis** playlist from the first song (on YouTube since 2.23.0).

**Windows targets open now.** "Open Windows settings" and "open the Windows
camera app" were refused by the app itself: the opener plugin's default
allows only http, https, mailto and tel. `capabilities/default.json` now
allows exactly `ms-settings:` and `microsoft.windows.camera:` (`spotify:` was
there in 2.22.x).

**Needs the app rebuilt** (the capability file, the menu and the camera
change) **and the worker deployed** (Groq, Spotify).

## Page 2.22.1: a complex 3D request no longer ends in silence

**What happened.** Asked for something with many parts ("a cargo drone with six
landing legs, a sensor dome, a ring of thrusters and a hinged hatch"), he said
"on it" and then nothing. A model built from code is written as the arguments
of one tool call, and a complex one is several thousand tokens. When the
length limit landed inside that call, the call had no arguments and nothing
could run. The automatic retry with more room only happened when he had said
*nothing* first, and he almost always opens with "on it". The warning went to
the chat, which is not on screen in the desktop app. So: silence.

**Fixed, in order:**
1. **A cut-off tool call is retried with more room whatever he said first**
   (10,000 → 20,000 tokens). He says aloud "That is a big build, trying again
   with more room."
2. **Still cut off: one more try with a "much shorter" instruction** in the
   system prompt (loops and helper functions, 24–32 segments, under 150
   lines, no introduction). Never more than three attempts.
3. **Cut off for good: he says why and what to do** ("The code for that model
   was too long for me to finish. Ask for a simpler one, or tell me to
   generate it with the 3D service"). He no longer says "I did not actually
   do that, say it again", which only repeated the same failure.
4. **The build tool tells the model to keep the code short** for complex
   objects (helper functions and loops, shared geometry, 32 segments on small
   parts), since the length of the code is what gets cut off.
5. **A heavy model is built once and simplified, not frozen.** The code used
   to run three times (a check, a chat bubble nobody can see on the desktop,
   the window). Now once. If the result is over 250,000 triangles the same
   code is run again with the segment counts capped at 32, then 20, then 12
   (`cappedThree`), and he says the detail was reduced. 300 parts at 64
   segments went from 14 s of frozen page to under 6 s in the (software
   graphics) test browser, and a 13 MB model became 4 MB.
6. **"Check yourself" lists the last few problems** (a cut-off, a tool that
   failed), so "he went quiet" leaves a trace even though the desktop has no
   chat on screen. "He used all his working steps" is now spoken too.

**Not changed:** the 3D *service* path (`generate_3d_model`, Tripo or Meshy).
The worker cuts its prompt at 600 characters; a very long description loses
its tail but does not fail. If a service-built model is what went missing,
say what he answered.

## Page 2.23.0 / worker 2.9.0: music from YouTube, and a 3D model is never a no

**Music moved to YouTube** (see "Music" near the top). Same commands; the
jarvis playlist opens in the browser at its first video. The worker has
`POST /youtube/playlist` (JARVIS_PLAYLIST, or the playlist found by name on
his channel after "connect YouTube"); Spotify's routes, tools and the
`spotify:` scheme are gone. Stop / next / previous are media keys sent by the
new `media_key` command in the app (needs the rebuild).

**A 3D model he asks for is always made.** "Make me a 3D model of a dragon"
used to end, sometimes, with "I can't build organic shapes" or "the 3D service
is out of credits". Now a turn that asked for a 3D model does not end without
one on his screen:
1. Both 3D tools say a model is never declined: organic subjects go to the 3D
   service when it is there and are built as a stylised low-poly version in
   code when it is not; a failed service means "build it in code", not "no".
2. If the turn ends with no model anyway, it is handed back (twice at most):
   first for a simpler version, then for the simplest recognisable one.
3. If there is still nothing, the app asks the 3D service itself with his own
   words; and if there is no service, it puts up a rough stand-in and says so.
4. "I can't..." is never spoken in such a turn unless, after all of that,
   there is truly nothing.
5. "Make it a 3D model" (the lock, from a picture) falls back to building it
   in code from the description when the 3D service fails.
A question about 3D ("how do I make a 3D model in Blender") is still just
answered.

## Page 2.23.1 / worker 2.9.1: YouTube connects, and 3D models that look like the request

**"redirect_uri_mismatch" from Google.** The YouTube sign-in asked Google to
come back to `/youtube/oauth`, an address that was never added to the OAuth
client. It now comes back to `/calendar/oauth`, which is already registered;
the signed state says which connection it is, so the calendar is untouched.

**The models looked nothing like what he asked for.** A model built in code
is stacked from boxes, cylinders and spheres, written blind: fine for a bottle,
hopeless for a dragon or a drone. Three changes:
1. **The 3D service is now the default for anything that is not a simple
   geometric object** (creatures, characters, vehicles, drones, buildings,
   weapons, plants, detailed products), with a full description as its prompt:
   shape and proportions, every part he named and where it sits, pose, style,
   and each part's material and colour. Code builds stay for bottles, boxes,
   cans, cups, simple furniture, and for when the service is missing or fails.
2. **A code build is looked at.** The first build of a turn is rendered from
   two angles and the picture goes back to the model with the instruction to
   compare it with the request and rebuild once if it does not read as that.
3. **The "never a no" hand-back asks for the service first** when it is
   there, and only then for a simpler code build.

For the service to be used, the worker needs a Tripo (recommended) or Meshy
key with credits; `/health` shows `model3d: true` and `model3d_key: "set"`
when it is ready (see "The 3D service" near the top).
