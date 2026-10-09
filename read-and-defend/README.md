# Read & Defend — קוראים ומגינים

A castle-defense game that teaches children to **read** Hebrew and English.
Monsters walk toward the castle carrying a letter, syllable, word or sentence;
the child reads it aloud, the speech recogniser listens, and a correct reading
zaps the monster. The learning system underneath teaches *decoding* — every
item is chosen by the letter-sound skills it needs, never from a fixed word
list — so retries bring different words, and children are regularly shown
words they have never seen, built only from sounds they have learned.

```bash
cd read-and-defend
npm install
npm run dev          # http://localhost:5173
npm test             # 73 unit tests (content, selection, difficulty, evaluation, level state, proxy)
npm run build        # typecheck + production build into dist/
npm run test:e2e     # browser tests against dist/ (needs Playwright + Chromium)
```

Node 18+ (developed on 22). No runtime dependencies; dev dependencies are
Vite, Vitest, TypeScript and `@types/node`.

---

## What is in the game

| Area | What exists |
|---|---|
| Onboarding | Language picker (Hebrew / English), interactive 3-step tutorial, microphone explanation **before** the browser prompt, a practice stage whose monster cannot hurt the castle |
| Gameplay | Winding road, castle with 5 hearts (6 when the game is easing off), enemies spawn up to 3 at a time, the one closest to the castle glows and has a bouncing arrow, time slows to 20 % while the child reads, pause/retry/quit |
| Enemies | **Slime** — letters & sound chunks; **Goblin** — words; **Knight** (armoured, slower, 2 damage) — long/complex words; **Bat** (fast) — words this child already reads fluently; **Troll boss** — a whole sentence, or a chain of three readings before sentences are taught |
| Feedback | Correct: projectile, burst, chime, "+150". Wrong: gentle two-note hum, "Almost!", the word splits into its sounds with the wrong one highlighted; after 2 tries a **Listen** button plays an example; after 3 the monster freezes so there is no time pressure. Unclear/silence: "I didn't quite hear that" — never counted as a mistake |
| Progression | 32 English and 26 Hebrew levels across 6 worlds (Letter Meadow → Sky Castle of Stories), stars, coins, XP, castle workshop (banners, walls, magic colours), optional daily challenge (no streaks), 8 learning achievements, reading-progress report for grown-ups |
| Settings | Speed (slow/normal/fast), hold-to-talk or tap-to-talk, sound, spoken instructions, extra-large text, less motion, difficulty cap, speech engine, server address, development mode, reset — behind a 3-second "grown-ups" hold |
| Platform | Responsive phone/tablet/desktop, portrait & landscape (sideways phones dock the reading panel), safe-area insets, touch-first, keyboard-operable mic, offline service worker, PWA manifest, Capacitor config |

## How the reading curriculum works

```
src/content/
  types.ts          LearningItem, Skill, Unit, LanguagePack
  english/          phonics.ts (grapheme parser) · data.ts (words, letters, chunks, sentences) · pack.ts (units, derivation)
  hebrew/           script.ts (niqqud parser, phonetics, plene spelling) · data.ts (pointed words, letters, sentences) · pack.ts
  selector.ts       picks the items for one attempt at a level
  registry.ts       language registry
```

**Skills are separate from items.** A skill is a letter-sound relationship
(`en:G:sh`, `he:L:בּ`), a vowel (`he:V:o`), a pattern (`en:P:blend`,
`he:P:plain` = reading without niqqud) or a tricky word (`en:T:the`). Each item
carries: language, display text, accepted spoken forms, parts for the
sound-it-out hint, required skills, difficulty, pattern, niqqud flag, real-word
flag, text for the example pronunciation, and strict/tolerant evaluation.
**All of that metadata is derived by code** from the word itself — the English
grapheme parser knows `sh`, `ck`, `ee`, magic-e (`a_e`)…; the Hebrew parser reads
the niqqud (dagesh decides בּ/ב, כּ/כ, פּ/פ; shin/sin dots; holam male, shuruk,
silent final ה/א, patah genuva). Adding a word is adding one string to a list.

**Units** introduce skills in order. English: s a t p → i n m d → … → sound
chunks → sh ch th → CVC words → *Explorer* (transfer) → digraphs → blends →
magic e → vowel teams → *Explorer* → sentences. Hebrew: בּ מ ל שׁ → ד ת נ ר א →
קָמָץ/פַּתָּח syllables → חִירִיק → first words + final letters → חוֹלָם → שׁוּרוּק/קֻבּוּץ →
צֵירֵה/סֶגּוֹל + soft ב כ פ → *Explorer* → שְׁוָא and longer words → reading without
niqqud → sentences. The two languages have separate progressions and
separate decoding rules; nothing is translated across.

**Generation is rule-based and validated.** Hebrew CV syllables (בָּ בִּ בּוֹ …)
are generated for every taught consonant × vowel sign — they are legitimate
reading drills and are marked as non-words. English word families are
practised as chunks (`at`, `an`, `ip`) and then as real words. No random
strings are ever shown as vocabulary; every word in the bank is a real,
curated word. Reduced-niqqud items are generated from the pointed words with
standard plene spelling (כִּתָּה → כיתה, מִכְתָּב → מכתב).

**Selection per attempt** (`selector.ts`) draws from *all* items whose skills
have been taught: ~45 % focus (this unit's new skills), ~30 % never-seen items
(transfer; ~50 %+ in Explorer units), the rest weighted toward the child's
weakest skills. Items from the previous attempt are heavily penalised and the
order is never repeated — **a retry keeps the objectives and changes the
words**. Well-known items (3+ first-try reads) are down-weighted.

## How learning is measured (`src/learning/`)

- Every resolved reading records: attempts, first-try success, reading time,
  and per-skill results.
- Evidence is **novelty-weighted**: a first encounter counts fully, the tenth
  read of the same word counts little. A skill is *mastered* only with high
  accuracy across **at least three different items**.
- **Transfer rate** = first-try success on items the child had never seen.
- `chooseDifficulty`: low recent first-try accuracy → *ease* (slower, fewer
  monsters, easier ceiling, 6 hearts, no fast bats). *Challenge* requires
  **both** high accuracy **and** success on new words, so repeating familiar
  words never raises difficulty. Parents can cap it.
- Struggle scaffolds: split into sounds/syllables → highlight the sound that
  went wrong → example audio → freeze. Weak skills are recommended on the map.

## Speech recognition

`src/speech/types.ts` defines the contract: `checkAvailability`,
`requestPermission`, `start()` → a session with `stop()`, `abort()` and a
`result` promise of alternatives with optional confidence, or a typed
`SpeechError` (`permission-denied`, `not-supported`, `insecure-context`,
`network`, `not-configured`, `language-unsupported`, …).

| Provider | Where it works | Notes |
|---|---|---|
| `webspeech` | Chrome & Edge (desktop, Android); Safari 14.1+ macOS / 14.5+ iOS (prefixed `webkitSpeechRecognition`) | Default. Supports `he-IL` and `en-US`. Chrome sends audio to Google for recognition. Not in Firefox (flag only), not in Android/iOS WebViews, and fails with a "network" error in Chromium builds without Google keys (e.g. Brave, Electron). |
| `server` | Any browser with `MediaRecorder` | Records one clip, VAD auto-stop, uploads to **your** proxy (`server/stt-proxy.mjs`). Clips with no speech are never uploaded. |
| `native` | The Capacitor app | `@capacitor-community/speech-recognition` (Android SpeechRecognizer / iOS SFSpeechRecognizer). |
| `simulated` | Development mode only | Never chosen automatically. Every screen shows a striped "simulated — NOT real voice recognition" banner, and the progress report counts simulated readings. |

*Automatic* picks native → browser → server. If none works, the game stops
and says why (unsupported browser, blocked microphone, http page, server not
configured) with a "Check again" button — it never falls back to the
simulator. Text input never counts as reading.

**Evaluation** (`src/evaluation/`) is language-specific:

- English: lowercase, strip punctuation, digits → words, filler words
  removed, homophones a recogniser cannot distinguish accepted (sun/son),
  all alternatives checked. A near miss reports which grapheme differed.
- Hebrew: niqqud and final-letter normalisation; exact unpointed and plene
  spellings accepted; otherwise the recogniser's spelling is turned into a
  regular expression of its possible readings and tested against the
  target's phonetic form (so כיתה matches כִּתָּה, תל matches טַל, but אמא does
  not match מָה and שר does not match שִׁיר). CV syllables are strict about the
  vowel; a bare consonant ("ב") is *uncertain*, not wrong.
- Sentences: in-order word alignment, ≥ 80 % of words; feedback marks which
  words were read.
- Uncertain (silence, confidence < 0.4, long unrelated talk) → "try again",
  no penalty. A short cooldown stops one utterance from triggering twice.

Known limitation, stated plainly: general-purpose recognisers are poor at
**isolated phonemes** ("sss"), so letter levels accept letter *names* (and a
few sound spellings), and letter-sound knowledge is assessed through syllables
and words, where recognition is reliable.

### Setting up the server engine (optional, needs a paid API key)

```bash
OPENAI_API_KEY=sk-... npm run stt-proxy      # listens on :8787
npm run dev                                   # Vite proxies /api → :8787
```

Then *Settings → Speech engine → Speech server* (or leave *Automatic*; it is
used when the browser has no recogniser). Environment: `OPENAI_API_KEY`
(required), `STT_MODEL` (default `gpt-4o-mini-transcribe`; `whisper-1`
works), `PORT`, `ALLOWED_ORIGIN`, `SERVE_DIST=1` to serve the built game from
the same process. The key exists only on the server.

**Data sent**: a few seconds of audio per reading, plus the language code.
The proxy does not log or store audio or transcripts, and never sends the
target word as a hint. Check the transcription provider's own retention
policy (OpenAI's API does not train on API data by default) before deploying
for children, and obtain parental consent as your jurisdiction requires
(COPPA, GDPR-K, Israeli Privacy Protection Law).

## Privacy

- Progress is stored only on the device (`localStorage`, key
  `read-and-defend:profile:v1`): skill statistics, levels, coins, settings. No
  names, no accounts, no analytics, no ads, no purchases.
- No recordings are stored. Audio exists only in memory during one reading.
- The browser engine is the browser vendor's service (Google for Chrome,
  Apple for Safari); the README and the microphone explainer say so.

## Architecture

```
src/
  core/          seeded RNG, event emitter
  content/       skills, items, curriculum, selection          (pure)
  learning/      learner model, adaptive difficulty, scaffolds (pure)
  evaluation/    normalisation + reading evaluation            (pure)
  game/          levels, level state machine (pure), enemy plan, path, art, renderer
  speech/        provider contract + webspeech/server/native/simulated adapters
  audio/         synthesised SFX (Web Audio), speech synthesis for examples
  persistence/   StorageAdapter (localStorage / memory; swap for cloud or Capacitor Preferences)
  progress/      profile schema, rewards, achievements, shop, daily
  platform/      Capacitor detection, haptics, wake lock, service worker
  i18n/          interface strings (Hebrew uses gender-neutral plural forms)
  ui/            app shell, screens, game session controller
```

The pure modules have no DOM access and are what the unit tests cover. The
renderer only reads `LevelState`; effects live in the renderer so the
simulation stays deterministic.

**Adding a language**: write a builder returning a `LanguagePack` (skills,
units, items, `dir`, `speechLang`), register it in `content/registry.ts`, add a
string table in `i18n/strings.ts`, and — if its spelling is not phonemic in
the way English or Hebrew are — a matcher in `evaluation/`.

## Testing

```bash
npm test               # unit tests (Vitest)
npm run build && npm run test:e2e
```

Unit tests cover: content integrity (every item reachable, metadata present,
distinct Hebrew/English progressions, niqqud rules), selection (taught skills
only, focus share, varied retries, transfer preference, weak-skill bias, boss
rules), difficulty progression (ease, challenge only via transfer, parental
cap, scaffolds), normalisation and evaluation (homophones, plene spelling,
strict syllables, uncertainty, sentences, whole-bank self-consistency and
cross-acceptance), the level state machine (movement, defeat, wrong,
uncertain, breach, win, lose, pause, practice, freeze, boss phases) and the
speech proxy (no key, key never exposed, no hint sent, error mapping).

`e2e/smoke.mjs` runs the production build in Chromium: tutorial → win level 1
→ progress persists after reload and unlocks level 2 · wrong/unclear/silent
answers credit nothing · losing a level and retrying with different words for
the same unit · Hebrew RTL with he-IL and Hebrew-only content, played to a
win · 320×568 phone without horizontal scroll · microphone denied → explained
and paused · no recogniser and no server → clear message, no fake fallback.
It uses the labelled simulator for answers; **real microphone recognition
must be tested by hand on real devices** (see below).

Manual device checklist: Chrome (Windows/macOS/Android), Safari (macOS, iPhone,
iPad), Edge; both languages; deny then re-allow the microphone; noisy room;
quiet child voice; airplane mode (game opens, voice explains it needs a
network).

## Deploying

`npm run build` produces a static `dist/` (relative paths, works under any
sub-path). Host it on any static host **over HTTPS** — browsers only allow the
microphone on `https://` or `localhost`. Deploy `server/stt-proxy.mjs` (any
Node 18+ host) only if you want the server engine, and route `/api/stt` to it
or set its URL in Settings.

## Mobile apps (iOS / Android) — the path, not a claim

The game is not published in any store. To package it:

```bash
npm i -D @capacitor/cli@6 && npm i @capacitor/core@6 @capacitor/ios@6 @capacitor/android@6 \
  @capacitor-community/speech-recognition @capacitor/haptics
npm run build
npx cap add ios && npx cap add android
```

In `src/main.ts` of the native build, expose the plugin:
`import { SpeechRecognition } from '@capacitor-community/speech-recognition'; window.__nativeSpeech = SpeechRecognition;`
(`nativeProvider.ts` also finds it on `Capacitor.Plugins`).

- **iOS** `Info.plist`: `NSMicrophoneUsageDescription` and
  `NSSpeechRecognitionUsageDescription` (child-friendly reasons). WKWebView
  does not offer the Web Speech recogniser, so the native plugin is required.
- **Android** `AndroidManifest.xml`: `RECORD_AUDIO`; Hebrew recognition needs
  the Google speech services on the device (most phones have them).
- Then `npx cap sync` and build in Xcode / Android Studio. Test both
  languages on real devices; recogniser behaviour differs per OS and
  manufacturer.
- Store review: both stores have kids-category rules (no third-party
  analytics/ads, parental gate for external links and purchases — the
  settings gate already exists).

The service worker is not registered inside the native shell (assets are
bundled there).

## Credentials and paid services

| Feature | Needs |
|---|---|
| Browser recognition | Nothing (browser vendor's service) |
| Server recognition | An OpenAI API key on the server (paid per minute of audio) |
| Native app recognition | Nothing extra (OS recogniser) |
| Fonts | Google Fonts (Andika, Fredoka, Noto Sans Hebrew); system fonts are used offline |

All art, sounds and content are original: castle, monsters and landscapes are
drawn in code, sound effects are synthesised.
