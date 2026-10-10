# Read & Defend — קוראים ומגינים

A castle-defense game that teaches children to **read** Hebrew and English.
Monsters walk toward the castle carrying a letter, word or sentence;
the child reads it aloud, the speech recogniser listens, and a correct reading
zaps the monster. The learning system underneath teaches *decoding* — every
item is chosen by the letter-sound skills it needs, never from a fixed word
list — so retries bring different words, and children are regularly shown
words they have never seen, built only from sounds they have learned.

```bash
cd read-and-defend
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (content, selection, difficulty, evaluation, timing, boss, progression, proxy)
npm run build        # typecheck + production build into dist/
npm run test:e2e     # browser tests against dist/ (needs Playwright + Chromium)
```

Node 18+ (developed on 22). The browser build has no runtime dependencies (Capacitor is only loaded inside the Android app); dev dependencies are
Vite, Vitest, TypeScript and `@types/node`.

---

## What is in the game

| Area | What exists |
|---|---|
| Onboarding | Language picker (Hebrew / English), interactive 3-step tutorial, microphone explanation **before** the browser prompt, a practice stage whose monster cannot hurt the castle |
| Gameplay | Winding road, castle with 5 hearts (6 when the game is easing off), enemies spawn up to 3 at a time, the one closest to the castle glows and has a bouncing arrow. **No reading panel and no microphone button:** the word is on the monster's sign (long sentences wrap onto several lines), the microphone opens once permission is given and stays open for the level, and a small indicator in the HUD shows listening / hearing you / paused. Enemies slow to 20 % while the child is speaking. Pause, retry, quit |
| Enemy speed | A standard enemy (slime, goblin) takes **7 seconds** from spawn to castle at *Normal*. Speed is `road length ÷ walk time`, derived from the real path, so it is the same on a phone and a desktop, survives window resizes and does not depend on frame rate. **Five speeds:** Very slow 21 s · Slow 14 s · Relaxed ≈ 10 s · Normal 7 s · Fast ≈ 5.6 s — in Settings and in the pause menu, applied immediately to monsters already on the road. Adaptive difficulty scales them further |
| Enemies | **Slime** — letters & sound chunks; **Goblin** — words; **Knight** (armoured, 9 s, 2 damage) — long/complex words and sentences; **Bat** (5 s) — words this child already reads fluently; **Troll boss** — see below |
| Boss | **Every level ends with a boss.** Once the regular enemies are done the scene dims, "BOSS" sweeps in and the troll rises while nothing moves; then it walks (40 s). It carries **three words, shown one at a time** ("Word 2 of 3"); each correct reading knocks it back and updates it, the third defeats it and ends the level. Wrong or unclear attempts change nothing. Waiting cannot win: if it reaches the castle it costs 2 hearts and trudges back to the start, keeping the words already read |
| Feedback | Correct: the castle fires the equipped weapon, burst, chime, "+150". Wrong: gentle two-note hum, "Almost!", the word's sounds appear in a strip at the bottom with the wrong one highlighted; after 2 tries a **Listen** button plays an example; after 3 the monster freezes so there is no time pressure. Unclear: "I didn't quite hear that" — never counted as a mistake |
| Progression | 26 English and 22 Hebrew levels across 6 worlds, every one ending in a boss, stars, coins, XP, castle workshop (**weapons**, banners, walls, magic colours), optional daily challenge (no streaks), 8 learning achievements, reading-progress report for grown-ups |
| Settings | Monster speed (5 levels), sound, spoken instructions, extra-large text, less motion, difficulty cap, Hebrew letter listening (Exact / Forgiving / Very forgiving), speech engine, server address, development mode, reset — behind a 3-second "grown-ups" hold |
| Platform | Responsive phone/tablet/desktop, portrait & landscape, one-row HUD that fits a 320 px phone, safe-area insets, touch-first, offline service worker, PWA manifest, Capacitor config |

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

**Units** introduce skills in order, and the course is deliberately front-loaded
with reading rather than with letters. English: s a t p → i n d m (both **letters
only**, exactly the first four levels as originally shipped) → g o c k e with
the first CVC words → u r h b f l → j v w x y z q + sh ch th →
*Explorer* (transfer) → ck ng ll ss ff zz qu wh → blends → magic e → vowel teams →
*Explorer* → sentences (13 units; first words at level 5, previously level 13).
Hebrew: בּ מ ל שׁ (letters only) → ד ת נ ר א + קָמָץ/פַּתָּח and the first words →
חִירִיק, silent ה/א → חוֹלָם + final letters + more consonants →
שׁוּרוּק/קֻבּוּץ → צֵירֵה/סֶגּוֹל + soft ב כ פ → *Explorer* → שְׁוָא and longer words →
reading without niqqud → sentences (11 units; first words in the second stage, previously level 9).
There are **no syllable drills**: from the second stage on, the small monsters
carry short words (sounds are still shown under a word when the child is stuck).
The two languages have separate progressions and separate decoding rules.

**Progress follows ability, not level count.** Once a reader is *fluent* in a
unit's sounds (accurate on at least two different items per sound, ≥ 80 % recent
first-try accuracy) the **next unit's exercises start to appear a unit early** —
letters → short words → longer words — using only sounds already taught (only
procedural skills such as blending or silent letters are borrowed from the next
unit). A reader who three-stars a level, is fluent, and is reading unseen words
first try **skips the unit's second level** ("Skipped" on the map). Neither
happens in the first two units, and neither can be triggered by repeating the
same word. A struggling reader gets the unit as written, eased (slower, fewer
monsters) with the sound-it-out scaffolds.

**The boss's three words** are chosen by the same skill-based selector: real,
decodable words, easiest first, preferring unseen words, this unit's new sounds
and the child's weak sounds, avoiding the previous attempt's words and the words
already read in the level. Blending is assumed (so English level 1's boss can use
sat / pat / tap / sap). The very first Hebrew levels have no vowel taught yet, so
there the pool widens by at most two untaught skills and the boss shows the
sound breakdown from the start (flagged `assist`).

**Generation is rule-based and validated.** Hebrew CV syllables (בָּ בִּ בּוֹ …)
are still generated for every taught consonant × vowel sign and marked as
non-words, but no unit practises them as monsters — they exist for the
evaluator and for the sound breakdown shown under a word. English word families are
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
- Hebrew uses a **layered pipeline** (`evaluation/evaluator.ts`, `hebrewPhonetic.ts`, `config.ts`):
  1. *Normalise* — niqqud, final letters (ך→כ…), punctuation, geresh, filler words ("אה", "האות …", "סופית") removed.
  2. *Exact* — unpointed or plene spelling equal to the target, or a spelling whose possible readings (a regular expression over consonants + vowel letters) include the target's pronunciation (כיתה = כִּתָּה, תל = טַל).
  3. *Phonetic similarity* — letters are mapped to sound classes (ט=ת, א=ע, כ≈ק, ב≈ו…) and compared with a weighted edit distance in which acoustically close consonants (b/p, d/t, m/n, g/k…) cost a little, vowel letters (ו י) and a final ה cost a full edit (kara ≠ kora, gadol ≠ gdola), and only the silent א/ע are cheap.
  4. *Per-kind thresholds* — `config.ts` holds `accept` and `floor` for letters, syllables, words and sentence words, plus the near/flex costs. Similarity ≥ `accept` is correct; between `floor` and `accept` is **"try again"** (never marked wrong); below, wrong.
  - **Letters** are the most forgiving. The name is matched by sound, not spelling; letters that sound alike (ט/ת, א/ע, final forms) share their names; a short word that starts with the right consonant ("מה" for מ) is recovered using the known target; for ש ל מ נ the first two letters of the name ("שי", "לא", "מה", "נו") are accepted spellings, so they count even in a fast run of letters - but inside a longer utterance only when everything said was a reading ("מה זה" is a question, not the letter); a name cut off or swallowed by the engine ("למ", "למה" for למד) or a drawn-out/doubled sound ("לל", "שש", "shhh") counts as the letter; and an unexpected word is "try again". A letter is only called **wrong** when the engine clearly returned a *different* letter.
  - **Syllables**: consonant by sound, vowel strictly (ba vs bi is wrong; a vs e cannot be told apart in spelling, so both pass).
  - **Words** keep a high bar; one close-consonant slip is tolerated only in words of four or more letters.
  - A **Hebrew letter-listening setting** (Settings → for grown-ups: Exact / Forgiving / Very forgiving) switches the preset without code changes. *Forgiving* is the default.
- Sentences: in-order word alignment, ≥ 80 % of words; feedback marks which
  words were read.
- Uncertain (silence, confidence < 0.4, long unrelated talk) → "try again",
  no penalty. A short cooldown stops one utterance from triggering twice.

Known limitation, stated plainly: general-purpose recognisers are poor at
**isolated phonemes** ("sss") and often at isolated Hebrew letters. The
evaluator can forgive a different *spelling* of what the engine heard; it
**cannot recover speech the engine never captured** (a letter returned as a
completely unrelated word, a very quiet child, a noisy room). In those cases
the game says "I didn't quite hear that — try again" rather than marking the
child wrong, and "Very forgiving" accepts more near-misses at the price of
occasionally accepting a similar-sounding wrong letter (measured: ≈1 % of
wrong-letter attempts in that mode, 0 % in the default). Letter-sound knowledge
is also assessed through words, where recognition is more reliable.

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

## Listening: always on, live, and fast readers

There is no microphone button. When a level starts (after the one-time
permission prompt) the microphone opens and stays open until the level ends
or the game is paused; it closes when the app goes to the background.

- **Live results.** The browser engine runs in continuous mode with partial
  results, so a reading is credited the moment it is recognisable, without
  waiting for the engine to decide the child has finished.
- **Several readings in one breath.** A fast reader often says three letters
  as one utterance ("מם למד שין"). Each utterance is split into words and
  matched left to right against every monster on the road
  (`game/utterance.ts`), so each one read is credited. A boss loses its words
  in order only.
- **Guessing from how a word starts.** For words of three or more consonants,
  a heard beginning counts when it covers ¾ of the word while the child is
  still speaking, or 60 % when the engine's final text stops there
  (`prefixCoverage`; thresholds in `evaluation/config.ts`). A *different
  complete* word ("קום" for קוֹף) is never a beginning. Only the monster
  nearest the castle is guessed, and *Exact* mode turns guessing off.
- **The room is not the reader.** An utterance of three or more words must be
  mostly readings, or it credits nothing (a parent saying "מה אתה עושה" does
  not defeat the מ monster). Inside a multi-word utterance a letter is
  matched only by its name. Long unrelated talk is ignored silently.
- **The game's own voice is not the child.** While the Listen button or
  spoken instructions are playing (and 0.7 s after), everything heard is
  ignored, so the game can never "read" a word to itself.
- Engines without a continuous mode (the server proxy, the native plugin)
  run as a loop of single utterances. The server engine never uploads a clip
  in which no speech was detected, so an open microphone in a quiet room
  sends nothing.

## Weapons

The workshop sells weapons — magic bolt (free), arrow volley, ice shard,
fireball, cannon, lightning, star shower. They change **only** how the castle
shoots and how a hit looks; every weapon defeats a monster on exactly one
correct reading. The workshop preview is the real game renderer, and
**Try it** fires a weapon at a practice monster before buying.

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

## Install button (web version)

The home screen has an **Install the app** button (hidden once the game runs as
an installed app). On Chrome/Edge/Samsung Internet it triggers the browser's own
install prompt in one tap (`platform/install.ts` keeps the `beforeinstallprompt`
event). Safari on iPhone/iPad has no install API - Apple only allows Share → Add
to Home Screen - so there the button shows those steps (in Hebrew or English).

## Update button

Every build writes `dist/version.json` (the commit id on GitHub) and carries the
same id inside the page. While the game is open it checks `version.json` on
start, whenever it comes back to the foreground and every five minutes; when a
newer version is online an **Update** button appears on the menus (never in the
middle of a level). Pressing it clears the offline copy and reloads - no
reinstalling, and progress is kept. The service worker never caches
`version.json`. The Capacitor Android app carries its files inside the APK, so
it is updated by installing a new APK instead.

## Mobile apps (Android on Windows; iOS on a Mac)

The game is wrapped with Capacitor 6 and the native speech plugin
(`@capacitor-community/speech-recognition`, Android `SpeechRecognizer`). It is
not published in any store. **On Windows you can build the Android app with one
command**; iOS needs a Mac with Xcode (Apple does not allow it elsewhere).

**Easiest: double-click `Build-Android.bat`.** Nothing needs to be installed
beforehand - the script installs Node.js and Java 17 (via winget) and the Android
SDK command-line tools if they are missing (Android Studio is optional). The
first run takes 10-20 minutes. Or, in PowerShell, in this folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-android.ps1
```

It installs the packages, builds the game, creates the `android/` project (first
run), adds the microphone permission (`scripts/patch-android.mjs`), generates the
icon from `assets/`, copies the game in and runs Gradle. The result is
`ReadAndDefend-debug.apk` next to the script. Copy it to the phone and open it
(allow "install unknown apps"), or plug the phone in with USB debugging on and
add `-Install`. `-Open` opens the project in Android Studio instead (press Run
to start it on a phone or an emulator); `-Clean` rebuilds the android folder
from scratch. After changing the game just run the script again.

How voice works inside the app: the WebView has no Web Speech API, so
`main.ts` loads the native plugin (only there) and `nativeProvider.ts` drives it
live: partial results arrive while the child is still speaking, each turn ends
on a pause with its final words, and the next turn starts at once. Hebrew needs the
Google speech services on the phone (most Android phones have them). Honest
limits: Android's recogniser restarts between turns, so there is a very short
gap and, on some phones, a system sound; live words still arrive during a turn. Test
both languages on a real phone.

- **iOS** (on a Mac): `npm i -D @capacitor/ios@6 && npx cap add ios`, add
  `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` to
  `Info.plist` (child-friendly reasons), build in Xcode.
- A **release** build for the Play Store needs a signing key and an
  Android App Bundle (`gradlew bundleRelease`); the debug APK is for your own
  devices. Kids-category rules apply (no third-party analytics/ads, parental
  gate for external links and purchases - the settings gate already exists).

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
