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
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.map': 'application/json' };
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

async function readCorrectUntil(page, selector, max = 40) {
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
  const lang = await page.getAttribute('[data-testid=target-text]', 'lang').catch(() => 'en');
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
  await page.evaluate(() => { const a = window.__rd.app; a.progress.tutorialDone = true; a.save(); a.startLevel(a.levels[14]); });
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
  assert(await page.locator('.parts .part').count() > 0, 'sound-it-out breakdown should appear after a wrong reading');
  await page.context().close();
});

await test('losing a level, then the retry uses different words for the same objectives', async () => {
  const page = await newPage();
  await setup(page, 'en');
  await page.evaluate(() => { const a = window.__rd.app; a.progress.tutorialDone = true; a.save(); a.startLevel(a.levels[15]); });
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
  const unit = await page.evaluate(() => window.__rd.app.levels[15].unitIndex);
  assert(unit === 7, 'retry must keep the same unit');
  await page.context().close();
});

await test('Hebrew mode: RTL layout, Hebrew content, Hebrew speech language', async () => {
  const page = await newPage();
  await setup(page, 'he');
  const dir = await page.evaluate(() => document.documentElement.dir);
  assert(dir === 'rtl', 'Hebrew should be RTL, got ' + dir);
  assert(await page.evaluate(() => document.documentElement.lang) === 'he', 'html lang should be he');
  await page.evaluate(() => { const a = window.__rd.app; a.progress.tutorialDone = true; a.save(); a.startLevel(a.levels[8]); });
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
  await page.evaluate(() => { const a = window.__rd.app; a.progress.tutorialDone = true; a.save(); a.startLevel(a.levels[24]); });
  await page.waitForFunction(() => window.__rd.session?.state?.enemies.some((e) => e.status === 'walking'));
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const mic = document.querySelector('[data-testid=mic]').getBoundingClientRect();
    const txt = document.querySelector('[data-testid=target-text]').getBoundingClientRect();
    return { sw: document.documentElement.scrollWidth, iw: innerWidth, ih: innerHeight, mic: [mic.left, mic.right, mic.bottom, mic.width], txt: [txt.left, txt.right, txt.width] };
  });
  assert(m.sw <= m.iw, `horizontal overflow: ${m.sw} > ${m.iw}`);
  assert(m.mic[0] >= 0 && m.mic[1] <= m.iw && m.mic[2] <= m.ih, 'mic button off screen: ' + JSON.stringify(m.mic));
  assert(m.mic[3] >= 56, 'mic button too small to tap');
  assert(m.txt[0] >= 0 && m.txt[1] <= m.iw && m.txt[2] > 0, 'reading text off screen');
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

await browser.close();
server.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
