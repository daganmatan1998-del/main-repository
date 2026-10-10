/**
 * End-to-end smoke test in a real Chromium, against the production build.
 *
 *   npm run build && npm run test:e2e
 *
 * Uses the development simulator for answers (it is labelled as simulated in
 * the UI); everything else — evaluation, game state, persistence, layout,
 * permission and unsupported-browser handling — is the real code.
 * Playwright is taken from node_modules, or from PLAYWRIGHT_MODULE.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/ missing — run `npm run build` first.');
  process.exit(1);
}

let pw;
try { pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright'); }
catch { pw = await import('/opt/node22/lib/node_modules/playwright/index.mjs'); }
const { chromium } = pw;

/* ---------------------------------------------------------- static server */
const types = { '.json': 'application/json', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.map': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) { res.writeHead(404); res.end(); return; }
  let file = path.join(dist, decodeURIComponent(url.pathname));
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

/* ---------------------------------------------------------------- harness */
const browser = await chromium.launch();
let failures = 0;
const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push(`  ✓ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { failures++; results.push(`  ✗ ${name}\n      ${String(e?.message ?? e).split('\n')[0]}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...opts.context });
  // Block Google Fonts so the test never depends on the network.
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  if (opts.init) await ctx.addInitScript(opts.init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.errors = errors;
  await page.goto(BASE);
  return page;
}

/** Fresh profile → language → dev mode switched on through the grown-up gate. */
async function setup(page, lang) {
  await page.click(`[data-testid=lang-${lang}]`);
  await page.click('[data-testid=open-settings]');
  const gate = page.locator('[data-testid=gate]');
  const box = await gate.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(3200);
  await page.mouse.up();
  await page.waitForSelector('[data-testid=screen-settings]');
  await page.click('[data-testid=dev-on]');
  await page.click('[data-testid=voice-off]');
  await page.click('[data-testid=back]');
}

/** Start a level by its id (e.g. "en-4a"), with the tutorial already done. */
async function startLevelById(page, id) {
  await page.evaluate((levelId) => {
    const a = window.__rd.app;
    a.progress.tutorialDone = true;
    a.save();
    a.startLevel(a.levels.find((l) => l.id === levelId));
  }, id);
  await page.waitForFunction(() => window.__rd.session?.state);
}

/** A stand-in for the browser's speech engine that returns scripted transcripts. */
/**
 * A stand-in for the browser's speech engine, in continuous mode like the
 * real one: while running it delivers each queued phrase (window.__say) as a
 * final result, and window.__sayPartial as a partial result first.
 */
const SPEECH_STUB = () => {
  window.__say = [];
  window.__sayPartial = [];
  window.__heard = [];
  window.__starts = 0;
  window.__live = 0;
  const Stub = class {
    start() {
      window.__starts++;
      window.__live++;
      this.alive = true;
      this.results = [];
      const emit = (transcript, isFinal) => {
        const res = { isFinal, length: 1, 0: { transcript, confidence: 0.9 } };
        if (this.results.length && !this.results[this.results.length - 1].isFinal) this.results[this.results.length - 1] = res;
        else this.results.push(res);
        const results = { length: this.results.length };
        this.results.forEach((r, k) => { results[k] = r; });
        this.onresult({ resultIndex: this.results.length - 1, results });
      };
      const poll = () => {
        if (!this.alive) return;
        if (window.__sayPartial.length) emit(window.__sayPartial.shift(), false);
        else if (window.__say.length) { const t = window.__say.shift(); window.__heard.push(t); emit(t, true); }
        setTimeout(poll, 80);
      };
      setTimeout(poll, 80);
    }
    end() { if (!this.alive) return; this.alive = false; window.__live--; this.onend && this.onend(); }
    stop() { this.end(); }
    abort() { this.end(); }
  };
  for (const k of ['SpeechRecognition', 'webkitSpeechRecognition']) Object.defineProperty(window, k, { configurable: true, writable: true, value: Stub });
  navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
};

/** Start the game with the stand-in engine (real browser speech code path). */
async function startWithStub(page, lang, settings = {}) {
  await page.click(`[data-testid=lang-${lang}]`);
  await page.evaluate((st) => { const a = window.__rd.app; Object.assign(a.profile.settings, { engine: 'browser', voiceHints: false }, st); a.progress.tutorialDone = true; a.save(); }, settings);
  await page.click('[data-testid=play]');
  await page.click('[data-testid=allow-mic]');
  await page.waitForFunction(() => window.__rd.session?.state?.enemies.some((e) => e.status === 'walking'), null, { timeout: 8000 });
}

async function readCorrectUntil(page, selector, max = 90) {
  for (let i = 0; i < max; i++) {
    if (await page.locator(selector).count()) return true;
    const hasTarget = await page.evaluate(() => {
      const s = window.__rd.session?.state;
      return !!s && s.enemies.some((e) => e.status === 'walking');
    });
    if (hasTarget) await page.click('[data-sim=correct]');
    await page.waitForTimeout(hasTarget ? 700 : 400);
  }
  return (await page.locator(selector).count()) > 0;
}

/* ------------------------------------------------------------------ tests */

await test('tutorial, win level 1, progress persists after refresh (English, LTR)', async () => {
  const page = await newPage();
  await setup(page, 'en');
  assert(await page.evaluate(() => document.documentElement.dir) === 'ltr', 'English should be LTR');
  await page.click('[data-testid=play]');
  for (let i = 0; i < 3; i++) await page.click('[data-testid=tut-next]');
  assert(await page.locator('#devBanner:not([hidden])').count() === 1, 'simulated mode must show its banner');
  assert(await readCorrectUntil(page, '[data-testid=tut-done]'), 'tutorial did not finish');
  await page.click('[data-testid=tut-done]');
  await page.waitForTimeout(500);
  await page.waitForFunction(() => document.querySelector('[data-testid=target-text]')?.textContent);
  const lang = await page.getAttribute('[data-testid=target-text]', 'lang');
  assert(lang === 'en', 'target text should be marked English');
  assert(await readCorrectUntil(page, '[data-testid=victory]'), 'level 1 was not won');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('read-and-defend:profile:v1')));
  assert(stored.langs.en.levels['en-1a'].wins === 1, 'win not saved');
  assert(Object.keys(stored.langs.en.learner.items).length > 0, 'learner model not saved');
  await page.reload();
  await page.waitForSelector('[data-testid=screen-home]');
  await page.click('[data-testid=open-map]');
  assert(await page.locator('[data-testid=level-2]').isEnabled(), 'level 2 should be unlocked after refresh');
  assert(!(await page.locator('[data-testid=level-3]').isEnabled()), 'level 3 should still be locked');
  assert(page.errors.length === 0, 'page errors: ' + page.errors.join('; '));
  await page.context().close();
});

await test('wrong answers never defeat an enemy; unclear answers cost nothing', async () => {
  const page = await newPage();
  await setup(page, 'en');
  await startLevelById(page, 'en-4a');
  await page.waitForFunction(() => window.__rd.session?.state?.enemies.some((e) => e.status === 'walking'));
  const before = await page.evaluate(() => window.__rd.session.state.correct);
  await page.click('[data-sim=wrong]');
  await page.waitForTimeout(700);
  let s = await page.evaluate(() => { const st = window.__rd.session.state; return { correct: st.correct, wrong: st.wrong }; });
  assert(s.correct === before && s.wrong === 1, `wrong answer was credited: ${JSON.stringify(s)}`);
  await page.click('[data-sim=unclear]');
  await page.waitForTimeout(700);
  await page.click('[data-sim=silence]');
  await page.waitForTimeout(700);
  s = await page.evaluate(() => { const st = window.__rd.session.state; return { correct: st.correct, wrong: st.wrong }; });
  assert(s.correct === before && s.wrong === 1, `unclear/silence changed the score: ${JSON.stringify(s)}`);
  const fb = await page.textContent('[data-testid=feedback]');
  assert(/hear/i.test(fb), 'expected a "didn\'t hear" message, got: ' + fb);
  // The breakdown appears after a miss when there is something to split (a word, not a single letter).
  const parts = await page.evaluate(() => { const s = window.__rd.session.state; const e = s.enemies.filter((x) => x.status === 'walking').sort((a, b) => b.progress - a.progress)[0]; return e ? e.items[e.phase].parts.length : 0; });
  const shown = await page.locator('.parts .part').count();
  if (parts > 1) assert(shown > 0, 'sound-it-out breakdown should appear after a wrong reading');
  await page.context().close();
});

await test('losing a level, then the retry uses different words for the same objectives', async () => {
  const page = await newPage();
  await setup(page, 'en');
  await startLevelById(page, 'en-4b');
  await page.waitForFunction(() => window.__rd.session?.state?.enemies.some((e) => e.status === 'walking'));
  const first = await page.evaluate(() => window.__rd.session.state.enemies.map((e) => e.items.map((i) => i.id).join('+')));
  // Fast-forward: one heart left, the front enemy reaches the gate.
  await page.evaluate(() => {
    const st = window.__rd.session.state;
    st.castleHp = 1;
    st.enemies.find((e) => e.status === 'walking').progress = 0.9999;
  });
  await page.waitForSelector('[data-testid=defeat]', { timeout: 5000 });
  const hp = await page.evaluate(() => window.__rd.session.state.castleHp);
  assert(hp === 0, 'castle health should reach 0');
  await page.click('[data-testid=retry]');
  await page.waitForFunction(() => window.__rd.session?.state?.status === 'playing');
  const second = await page.evaluate(() => window.__rd.session.state.enemies.map((e) => e.items.map((i) => i.id).join('+')));
  assert(JSON.stringify(first) !== JSON.stringify(second), 'retry repeated the identical sequence');
  const overlap = second.filter((x) => first.includes(x)).length;
  assert(overlap < second.length, 'retry used no new items at all');
  const unit = await page.evaluate(() => window.__rd.session.level.unitIndex);
  assert(unit === 3, 'retry must keep the same unit');
  await page.context().close();
});

await test('Hebrew mode: RTL layout, Hebrew content, Hebrew speech language', async () => {
  const page = await newPage();
  await setup(page, 'he');
  const dir = await page.evaluate(() => document.documentElement.dir);
  assert(dir === 'rtl', 'Hebrew should be RTL, got ' + dir);
  assert(await page.evaluate(() => document.documentElement.lang) === 'he', 'html lang should be he');
  await startLevelById(page, 'he-3a');
  await page.waitForFunction(() => window.__rd.session?.state?.enemies.some((e) => e.status === 'walking'));
  const info = await page.evaluate(() => ({
    speech: window.__rd.app.pack.speechLang,
    allHebrew: window.__rd.session.state.enemies.every((e) => e.items.every((i) => /[א-ת]/.test(i.display))),
  }));
  assert(info.speech === 'he-IL', 'speech language should be he-IL');
  assert(info.allHebrew, 'Hebrew level showed non-Hebrew items');
  await page.waitForSelector('[data-testid=target-text][lang=he][dir=rtl]');
  assert(await readCorrectUntil(page, '[data-testid=victory]'), 'Hebrew level was not won');
  assert(page.errors.length === 0, 'page errors: ' + page.errors.join('; '));
  await page.context().close();
});

await test('narrow phone (320×568): no horizontal scroll, controls on screen', async () => {
  const page = await newPage({ context: { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true } });
  await setup(page, 'he');
  await startLevelById(page, 'he-5a');
  await page.waitForFunction(() => window.__rd.session?.state?.enemies.some((e) => e.status === 'walking'));
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const inside = (el) => { const r = el.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.width > 0; };
    const hud = [...document.querySelectorAll('.hud > *')];
    const pause = document.querySelector('[data-testid=pause]').getBoundingClientRect();
    const field = window.__rd.app.renderer.sceneLayout.field;
    return {
      sw: document.documentElement.scrollWidth, iw: innerWidth, ih: innerHeight,
      hudInside: hud.every(inside), hudCount: hud.length,
      pause: [pause.width, pause.height],
      mic: document.querySelectorAll('[data-testid=mic]').length,
      fieldShare: field.h / innerHeight,
    };
  });
  assert(m.sw <= m.iw, `horizontal overflow: ${m.sw} > ${m.iw}`);
  assert(m.hudInside, 'a HUD element is cut off on a 320 px phone');
  assert(Math.abs(m.pause[0] - m.pause[1]) <= 2, `pause button is not round: ${m.pause}`);
  assert(m.mic === 0, 'there should be no microphone button');
  assert(m.fieldShare > 0.65, `the battlefield should fill most of the screen, got ${(m.fieldShare * 100).toFixed(0)}%`);
  await page.context().close();
});

await test('microphone permission denied is explained, not ignored', async () => {
  const page = await newPage();
  await page.click('[data-testid=lang-en]');
  await page.evaluate(() => {
    const a = window.__rd.app;
    a.profile.settings.engine = 'browser';
    a.profile.settings.voiceHints = false;
    a.progress.tutorialDone = true;
    a.save();
  });
  // Pretend the browser has a recogniser; the microphone is refused.
  await page.evaluate(() => {
    window.webkitSpeechRecognition = window.webkitSpeechRecognition || function () {};
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
  });
  await page.click('[data-testid=play]');
  await page.click('[data-testid=allow-mic]');
  await page.waitForSelector('[data-testid=mic-denied]', { timeout: 5000 });
  const paused = await page.evaluate(() => window.__rd.session.state.status);
  assert(paused === 'paused', 'game should not run while the microphone is blocked');
  await page.context().close();
});

await test('no speech recognition and no server: clear message, no fake recognition', async () => {
  const page = await newPage({ init: () => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; } });
  await page.click('[data-testid=lang-he]');
  await page.evaluate(() => { const a = window.__rd.app; a.progress.tutorialDone = true; a.profile.settings.voiceHints = false; a.save(); });
  await page.click('[data-testid=play]');
  await page.waitForSelector('[data-testid=stt-unavailable]', { timeout: 8000 });
  const txt = await page.textContent('[data-testid=mic-reasons]');
  assert(txt.length > 10, 'reasons should be listed');
  assert(await page.locator('#devBanner:not([hidden])').count() === 0, 'must not silently fall back to the simulator');
  assert(await page.evaluate(() => window.__rd.session.state.status) === 'paused', 'game must not start without a recogniser');
  await page.context().close();
});

await test('a standard enemy takes about 7 seconds to reach the castle — on a phone and on a desktop', async () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 720 }]) {
    const page = await newPage({ context: { viewport } });
    await setup(page, 'en');
    await startLevelById(page, 'en-1a');
    // Record, in real time, when the first enemy appears and when it reaches the gate.
    const secs = await page.evaluate(() => new Promise((resolve) => {
      const st = () => window.__rd.session.state;
      let t0 = 0;
      const poll = () => {
        const e = st().enemies[0];
        if (!t0 && e.status === 'walking') t0 = performance.now();
        if (t0 && e.status === 'breached') return resolve((performance.now() - t0) / 1000);
        setTimeout(poll, 16);
      };
      poll();
    }));
    assert(secs > 6.4 && secs < 7.9, `${viewport.width}×${viewport.height}: took ${secs.toFixed(2)} s, expected ≈7`);
    await page.context().close();
  }
});

await test('resizing the window mid-walk does not jump the enemy or change its arrival time', async () => {
  const page = await newPage({ context: { viewport: { width: 1100, height: 700 } } });
  await setup(page, 'en');
  await startLevelById(page, 'en-1a');
  await page.waitForFunction(() => window.__rd.session.state.enemies[0].status === 'walking');
  const t0 = Date.now();
  await page.waitForTimeout(2800);
  const before = await page.evaluate(() => window.__rd.session.state.enemies[0].progress);
  await page.setViewportSize({ width: 420, height: 800 }); // very different road
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => window.__rd.session.state.enemies[0].progress);
  assert(Math.abs(after - before) < 0.06, `enemy jumped on resize: ${before.toFixed(3)} → ${after.toFixed(3)}`);
  await page.waitForFunction(() => window.__rd.session.state.enemies[0].status === 'breached', null, { timeout: 8000 });
  const total = (Date.now() - t0) / 1000;
  assert(total > 6.3 && total < 8, `total walk ${total.toFixed(2)} s after a resize, expected ≈7`);
  await page.context().close();
});

await test('pausing freezes the walk; resuming continues it', async () => {
  const page = await newPage({ context: { viewport: { width: 390, height: 844 } } });
  await setup(page, 'en');
  await startLevelById(page, 'en-1a');
  await page.waitForFunction(() => window.__rd.session.state.enemies[0].status === 'walking');
  await page.waitForTimeout(1500);
  await page.click('[data-testid=pause]');
  const p1 = await page.evaluate(() => window.__rd.session.state.enemies[0].progress);
  await page.waitForTimeout(2500);
  const p2 = await page.evaluate(() => window.__rd.session.state.enemies[0].progress);
  assert(p1 === p2, `enemy moved while paused: ${p1} → ${p2}`);
  await page.click('[data-testid=resume]');
  await page.waitForTimeout(800);
  const p3 = await page.evaluate(() => window.__rd.session.state.enemies[0].progress);
  assert(p3 > p2 && p3 - p2 < 0.25, `enemy did not resume smoothly: ${p2} → ${p3}`);
  await page.context().close();
});

await test('boss fight: announced, three words one at a time, wrong answers do not advance it, level ends on the third', async () => {
  const page = await newPage();
  await setup(page, 'en');
  await startLevelById(page, 'en-1a');
  // Defeat the regular enemies by reading them.
  for (let i = 0; i < 120; i++) {
    const info = await page.evaluate(() => {
      const s = window.__rd.session.state;
      return { regularLeft: s.enemies.filter((e) => e.type !== 'boss' && e.status !== 'defeated' && e.status !== 'breached').length, intro: s.intro, bossWalking: s.enemies.some((e) => e.type === 'boss' && e.status === 'walking') };
    });
    if (info.regularLeft === 0 && (info.intro > 0 || info.bossWalking)) break;
    const walking = await page.evaluate(() => window.__rd.session.state.enemies.some((e) => e.status === 'walking'));
    if (walking) await page.click('[data-sim=correct]');
    await page.waitForTimeout(500);
  }
  const intro = await page.evaluate(() => ({ intro: window.__rd.session.state.intro, banner: document.querySelector('.toast, #toast')?.textContent ?? '' }));
  assert(intro.intro > 0, 'the boss should be announced before it walks');
  assert(/troll|three words/i.test(intro.banner), 'announcement text missing: ' + intro.banner);
  await page.waitForFunction(() => window.__rd.session.state.enemies.some((e) => e.type === 'boss' && e.status === 'walking'), null, { timeout: 6000 });

  const words = await page.evaluate(() => window.__rd.session.state.enemies.find((e) => e.type === 'boss').items.map((i) => i.display));
  assert(words.length === 3 && new Set(words).size === 3, 'boss needs exactly three different words: ' + words);
  const readShown = () => page.textContent('[data-testid=target-text]');
  for (let stage = 0; stage < 3; stage++) {
    const shown = (await readShown()).trim();
    assert(shown.endsWith(`: ${words[stage]}`), `stage ${stage + 1} shows "${shown}", expected "${words[stage]}"`);
    assert(shown.includes(`${stage + 1}`) && shown.includes('3'), 'should say which word of three: ' + shown);
    for (const other of words.filter((_, i) => i !== stage)) {
      assert(!shown.endsWith(`: ${other}`), `another boss word "${other}" is shown while reading "${shown}"`);
    }
    // what the boss's sign shows is its current item, one word only
    const signItem = await page.evaluate(() => { const b = window.__rd.session.state.enemies.find((e) => e.type === 'boss'); return b.items[b.phase].display; });
    assert(signItem === words[stage], 'the boss sign is not on the current word');
    if (stage === 1) {
      // wrong, unclear and silent attempts leave the boss on the second word
      for (const a of ['wrong', 'unclear', 'silence']) { await page.click(`[data-sim=${a}]`); await page.waitForTimeout(650); }
      const phase = await page.evaluate(() => window.__rd.session.state.enemies.find((e) => e.type === 'boss').phase);
      assert(phase === 1, 'a failed attempt advanced the boss to phase ' + phase);
      assert((await readShown()).trim().endsWith(`: ${words[1]}`), 'the word changed after a failed attempt');
    }
    await page.click('[data-sim=correct]');
    await page.waitForTimeout(700);
  }
  await page.waitForSelector('[data-testid=victory]', { timeout: 8000 });
  const stats = await page.evaluate(() => { const s = window.__rd.session.state; return { status: s.status, boss: s.enemies.find((e) => e.type === 'boss').status }; });
  assert(stats.status === 'won' && stats.boss === 'defeated', 'level should be won with the boss defeated: ' + JSON.stringify(stats));
  await page.context().close();
});

await test('the microphone opens by itself once permission is given, and pauses with the game', async () => {
  const page = await newPage({ init: SPEECH_STUB });
  await startWithStub(page, 'he');
  assert(await page.locator('[data-testid=mic]').count() === 0, 'there should be no microphone button');
  await page.waitForFunction(() => window.__live === 1, null, { timeout: 3000 });
  assert(await page.getAttribute('[data-testid=ear]', 'class') !== 'ear off', 'listening indicator should be on');
  await page.click('[data-testid=pause]');
  await page.waitForFunction(() => window.__live === 0, null, { timeout: 3000 });
  await page.waitForFunction(() => document.querySelector('[data-testid=ear]').className.includes('off'), null, { timeout: 1000 })
    .catch(() => { throw new Error('indicator should show the mic is paused'); });
  await page.click('[data-testid=resume]');
  await page.waitForFunction(() => window.__live === 1, null, { timeout: 3000 });
  await page.context().close();
});

await test('Hebrew letter: a correct but oddly transcribed reading is accepted; another letter is not', async () => {
  const page = await newPage({ init: SPEECH_STUB });
  await startWithStub(page, 'he');
  await page.waitForFunction(() => window.__live === 1);
  const target = await page.evaluate(() => {
    const e = window.__rd.session.state.enemies.find((x) => x.status === 'walking');
    return { letter: e.items[0].display.normalize('NFD').replace(/[\u0591-\u05C7]/g, ''), kind: e.items[0].kind };
  });
  assert(target.kind === 'letter', 'level 1 should start with a letter, got ' + target.kind);
  const other = target.letter === 'ל' ? 'מם' : 'למד';
  await page.evaluate((t) => { window.__say.push(t); }, other);
  await page.waitForTimeout(700);
  assert((await page.evaluate(() => window.__rd.session.state.correct)) === 0, 'a different letter was accepted');
  await page.evaluate((t) => { window.__say.push(t); }, target.letter + 'י');
  await page.waitForFunction(() => window.__rd.session.state.correct >= 1, null, { timeout: 4000 });
  await page.context().close();
});

await test('fast reading: two letters in one breath both count', async () => {
  const page = await newPage({ init: SPEECH_STUB });
  await startWithStub(page, 'he', { pace: 'verySlow' });
  await page.waitForFunction(() => window.__rd.session.state.enemies.filter((e) => e.status === 'walking').length >= 2, null, { timeout: 12000 });
  const names = await page.evaluate(() => {
    const letters = window.__rd.app.pack.items.filter((i) => i.kind === 'letter');
    return window.__rd.session.state.enemies.filter((e) => e.status === 'walking')
      .sort((a, b) => b.progress - a.progress)
      .map((e) => letters.find((l) => l.id === e.items[0].id).accepted[1]); // the letter's name, as engines write it
  });
  await page.evaluate((t) => { window.__say.push(t); }, names.slice(0, 2).join(' '));
  await page.waitForFunction(() => window.__rd.session.state.correct >= 2, null, { timeout: 4000 });
  await page.context().close();
});

await test('a reading counts while the child is still speaking (partial result)', async () => {
  const page = await newPage({ init: SPEECH_STUB });
  await startWithStub(page, 'en');
  await page.waitForFunction(() => window.__live === 1);
  const name = await page.evaluate(() => window.__rd.session.state.enemies.find((x) => x.status === 'walking').items[0].accepted[0]);
  await page.evaluate((t) => { window.__sayPartial.push(t); }, name); // never finalised
  // the words appear on screen live, while still being said
  await page.waitForFunction((t) => { const c = document.querySelector('[data-testid=live-caption]'); return c?.classList.contains('show') && c.textContent.includes(t); }, name, { timeout: 2000 });
  await page.waitForFunction(() => window.__rd.session.state.correct >= 1, null, { timeout: 3000 });
  await page.context().close();
});

await test('English still works through the real browser speech path', async () => {
  const page = await newPage({ init: SPEECH_STUB });
  await startWithStub(page, 'en');
  await page.waitForFunction(() => window.__live === 1);
  const item = await page.evaluate(() => window.__rd.session.state.enemies.find((x) => x.status === 'walking').items[0].accepted[0]);
  await page.evaluate(() => { window.__say.push('banana'); });
  await page.waitForTimeout(700);
  assert((await page.evaluate(() => window.__rd.session.state.correct)) === 0, 'a wrong English answer was accepted');
  await page.evaluate((t) => { window.__say.push(t); }, item);
  await page.waitForFunction(() => window.__rd.session.state.correct >= 1, null, { timeout: 4000 });
  await page.context().close();
});

await test('monster speed can be slowed from the pause menu, mid-level', async () => {
  const page = await newPage();
  await setup(page, 'en');
  await startLevelById(page, 'en-1a');
  await page.waitForFunction(() => window.__rd.session.state.enemies[0].status === 'walking');
  const before = await page.evaluate(() => window.__rd.session.state.config.durationFactor);
  await page.click('[data-testid=pause]');
  await page.click('[data-testid=pace-verySlow]');
  await page.click('[data-testid=resume]');
  const after = await page.evaluate(() => window.__rd.session.state.config.durationFactor);
  assert(Math.abs(after / before - 3) < 0.01, `very slow should triple the walk: ${before} → ${after}`);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('read-and-defend:profile:v1')).settings.pace);
  assert(saved === 'verySlow', 'speed choice should be saved, got ' + saved);
  await page.context().close();
});

await test('weapons shop: buy, equip and the game uses it', async () => {
  const page = await newPage();
  await page.click('[data-testid=lang-en]');
  await page.evaluate(() => { const a = window.__rd.app; a.profile.coins = 120; a.save(); });
  await page.click('[data-testid=open-shop]');
  await page.click('[data-testid=try-weapon-cannon]');            // try before buying
  await page.click('[data-testid=shop-weapon-fire]');              // buy (90)
  await page.waitForSelector('[data-testid=screen-shop]');
  const p = await page.evaluate(() => { const pr = window.__rd.app.profile; return { coins: pr.coins, weapon: pr.equipped.weapon, owned: pr.owned }; });
  assert(p.coins === 30 && p.weapon === 'weapon-fire' && p.owned.includes('weapon-fire'), 'purchase failed: ' + JSON.stringify(p));
  const rendererWeapon = await page.evaluate(() => window.__rd.app.renderer.opts.weapon);
  assert(rendererWeapon === 'weapon-fire', 'the game renderer is not using the equipped weapon');
  assert(page.errors.length === 0, 'page errors: ' + page.errors.join('; '));
  await page.context().close();
});

await test('tutorial: a monster that reaches the castle hurts it and goes back, it does not just stop', async () => {
  const page = await newPage();
  await setup(page, 'en');
  await page.click('[data-testid=play]');
  for (let i = 0; i < 3; i++) await page.click('[data-testid=tut-next]');
  await page.waitForFunction(() => window.__rd.session?.state?.enemies.some((e) => e.status === 'walking'));
  const before = await page.evaluate(() => { const st = window.__rd.session.state; st.enemies.find((e) => e.status === 'walking').progress = 0.985; return st.castleHp; });
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => { const st = window.__rd.session.state; const e = st.enemies.find((x) => x.status === 'walking'); return { hp: st.castleHp, progress: e?.progress, status: st.status }; });
  assert(after.hp < before, `the castle should lose a heart (${before} → ${after.hp})`);
  assert(after.progress !== undefined && after.progress < 0.5 && after.status === 'playing', 'the monster should walk again from the start: ' + JSON.stringify(after));
  assert(page.errors.length === 0, 'page errors: ' + page.errors.join('; '));
  await page.context().close();
});

await test('install button: one tap with the browser prompt, or the steps when there is none', async () => {
  // Chrome/Edge: the browser offers installation, the button uses it.
  let page = await newPage({ init: () => {
    window.__installCalls = 0;
    window.addEventListener('DOMContentLoaded', () => setTimeout(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true });
      e.prompt = async () => { window.__installCalls++; };
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(e);
    }, 100));
  } });
  await page.click('[data-testid=lang-en]');
  await page.waitForTimeout(300);
  await page.click('[data-testid=install]');
  await page.waitForTimeout(200);
  assert(await page.evaluate(() => window.__installCalls) === 1, 'the browser install prompt was not used');
  assert(await page.locator('[data-testid=install]').count() === 0, 'the button should disappear once installed');
  await page.context().close();

  // iPhone Safari: no prompt exists, so the two taps are explained (in Hebrew too).
  page = await newPage({ context: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } });
  await page.click('[data-testid=lang-he]');
  await page.click('[data-testid=install]');
  const steps = await page.locator('.install-steps li').allTextContents();
  assert(steps.length === 3 && steps[0].includes('שיתוף'), 'iPhone steps missing: ' + JSON.stringify(steps));
  assert(page.errors.length === 0, 'page errors: ' + page.errors.join('; '));
  await page.context().close();

  // Already installed (standalone): no button.
  page = await newPage({ init: () => { const m = window.matchMedia.bind(window); window.matchMedia = (q) => q.includes('standalone') ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : m(q); } });
  await page.click('[data-testid=lang-en]');
  assert(await page.locator('[data-testid=install]').count() === 0, 'no install button inside the installed app');
  await page.context().close();
});

await test('update button: appears only when a newer version is online, and loads it', async () => {
  // Same version online: no button.
  let page = await newPage();
  await page.click('[data-testid=lang-en]');
  await page.waitForTimeout(1500);
  assert(await page.locator('[data-testid=update]').count() === 0, 'no update button when the site has this version');
  const served = await page.evaluate(() => fetch('./version.json', { cache: 'no-store' }).then((r) => r.json()));
  assert(typeof served.version === 'string' && served.version.length > 0, 'dist/version.json missing: ' + JSON.stringify(served));
  await page.context().close();

  // A newer version is published: the button appears on the menus.
  page = await newPage({ init: () => {} });
  await page.context().route(/version\.json/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 'newer-build' }) }));
  await page.reload();
  await page.click('[data-testid=lang-he]');
  await page.waitForSelector('[data-testid=update]', { timeout: 5000 });
  const text = await page.locator('#updateBar').textContent();
  assert(text.includes('עדכון'), 'update bar should be in Hebrew: ' + text);
  // Not in the middle of a level.
  await page.evaluate(() => { window.__rd.app.sessionActive = true; window.__rd.app.afterShow(); });
  assert(await page.locator('[data-testid=update]').count() === 0, 'the update button must not interrupt a level');
  await page.evaluate(() => { window.__rd.app.sessionActive = false; window.__rd.app.show('home'); });
  await page.waitForSelector('[data-testid=update]');
  // Pressing it reloads the game; progress (language choice) survives.
  await Promise.all([page.waitForEvent('load'), page.click('[data-testid=update]')]);
  await page.waitForSelector('[data-testid=screen-home]');
  assert(await page.evaluate(() => document.documentElement.lang) === 'he', 'progress/settings should survive the update');
  assert(page.errors.length === 0, 'page errors: ' + page.errors.join('; '));
  await page.context().close();
});

await browser.close();
server.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
