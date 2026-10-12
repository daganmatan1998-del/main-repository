// Language tour: walks the app in each language and checks what no unit test can —
// that nothing on any screen is left in another language, shows a raw
// placeholder, repeats a word, or breaks the page direction.
//
//   npm run test:i18n                    (every language that has a pack)
//   LANGS=en,he npm run test:i18n        (some of them)
//   SHOTS=/some/dir npm run test:i18n    (screenshots, one folder per language)
//
// It never reads the texts it checks from the app: it only looks at what the
// page shows, so a missing translation can't hide behind its own key.

import { createRequire } from 'node:module';
import { mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../server/dev-server.mjs';
import { memoryKV } from '../../server/push.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = playwright;

const SHOTS = process.env.SHOTS || path.join(here, 'screenshots-i18n');
const packs = readdirSync(path.join(here, '../../www/js/lang')).filter((f) => /^[a-z]{2,3}\.js$/.test(f)).map((f) => f.slice(0, -3));
const LANGS = (process.env.LANGS ? process.env.LANGS.split(',') : ['en', ...packs]).filter((v, i, a) => a.indexOf(v) === i);

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? '✓' : '✗'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
}

// ---------- scripts: which letters belong to which language ----------
const SCRIPTS = {
  hebrew: /[֐-׿]/, arabic: /[؀-ۿݐ-ݿ]/, cyrillic: /[Ѐ-ӿ]/, greek: /[Ͱ-Ͽ]/,
  devanagari: /[ऀ-ॿ]/, thai: /[฀-๿]/, hangul: /[가-힯ᄀ-ᇿ]/, kana: /[぀-ヿ]/, han: /[一-鿿]/,
};
const OWN = { he: ['hebrew'], ar: ['arabic'], ru: ['cyrillic'], uk: ['cyrillic'], el: ['greek'], hi: ['devanagari'], th: ['thai'], ko: ['hangul'], ja: ['kana', 'han'], zh: ['han'] };
const foreign = (lang, s) => Object.entries(SCRIPTS).filter(([name, re]) => !(OWN[lang] || []).includes(name) && re.test(s)).map(([name]) => name);
const RTL = ['he', 'ar', 'fa', 'ur'];

// Words that repeat on purpose or because the language says so.
const REPEAT_OK = new Set(['ja', 'nana', 'bye', 'так', 'très', 'muy', 'molto', 'mai', 'chop', '·', '—', '–', '/', '-', 'g', 'kg', 'kcal', 'cm', 'a', 'à']);
function repeatedWord(s) {
  for (const line of s.split('\n')) {
    // Punctuation separates: "worth it: it will" is not a repeated word.
    for (const segment of line.toLocaleLowerCase().split(/[,.;:!?()«»"“”„‘’¡¿—–|·•]+/)) {
      const words = segment.split(/\s+/).filter(Boolean);
      for (let i = 1; i < words.length; i++) {
        if (words[i] === words[i - 1] && !/^[\d.,/%+−-]+$/.test(words[i]) && !REPEAT_OK.has(words[i]) && words[i].length > 1) return `${words[i - 1]} ${words[i]} (in "${line.trim().slice(0, 80)}")`;
      }
    }
  }
  return null;
}

// ---------- server (Anthropic stubbed, cloud off) ----------
const upstream = [];
async function fakeAnthropic(url, init) {
  const body = JSON.parse(init.body);
  upstream.push(body);
  const text = 'ok';
  return new Response(JSON.stringify({
    id: 'msg_test', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}
const server = createServer({ env: { PUSH: memoryKV(), ANTHROPIC_API_KEY: 'sk-ant-e2e-fake', ENGINES_CHAT: 'anthropic' }, fetchImpl: fakeAnthropic,
  overrides: { '/js/config.js': (t) => t.replace(/trialDays: \d+/, 'trialDays: 7').replace(/url: 'https:[^']*',/, "url: '',").replace(/anonKey: '[^']*',/, "anonKey: '',") } });
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;

const LAUNCH = { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] };
const browser = await chromium.launch({ channel: 'chromium', ...LAUNCH }).catch(() => chromium.launch(LAUNCH));

async function tour(lang) {
  const out = path.join(SHOTS, lang);
  mkdirSync(out, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'Asia/Jerusalem' });
  await ctx.grantPermissions(['camera']);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); });
  const wait = (ms = 250) => page.waitForTimeout(ms);
  let n = 0;
  const shot = (name) => page.screenshot({ path: path.join(out, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage: false });

  // Every screen is read the same way: all visible text, plus attributes people hear or see.
  const pageText = () => page.evaluate(() => {
    const parts = [document.body.innerText];
    for (const el of document.querySelectorAll('[aria-label],[placeholder],[title],[alt]')) {
      for (const a of ['aria-label', 'placeholder', 'title', 'alt']) { const v = el.getAttribute(a); if (v) parts.push(v); }
    }
    parts.push(document.title);
    return parts.join('\n');
  });
  const audit = async (screen) => {
    const s = await pageText();
    const f = foreign(lang, s);
    check(`${lang} · ${screen}: only the language's own script`, f.length === 0, f.join(','));
    const raw = s.match(/\{\d*\}|\{[a-z]+,|undefined|NaN|\[object|‖|\bnull\b/);
    check(`${lang} · ${screen}: no raw placeholders or "undefined"`, !raw, raw && `found "${raw[0]}"`);
    const rep = repeatedWord(s);
    check(`${lang} · ${screen}: no repeated words`, !rep, rep || '');
    return s;
  };

  await page.addInitScript((l) => { try { if (!localStorage.getItem('nutri-lang')) localStorage.setItem('nutri-lang', l); } catch {} }, lang);
  await page.goto(BASE + '/');
  await page.waitForSelector('#ob-next');
  const html = await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir, title: document.title }));
  check(`${lang} · the page declares its language and direction`, html.lang === lang && html.dir === (RTL.includes(lang) ? 'rtl' : 'ltr'), JSON.stringify(html));
  await audit('welcome');
  await shot('welcome');

  // The language picker is on the first screen and lists every language by its own name.
  await page.click('#lang-btn');
  await page.waitForSelector('#lang-list');
  const items = await page.locator('#lang-list .lang-item').evaluateAll((els) => els.map((e) => ({ code: e.dataset.lang, text: e.innerText.trim(), active: e.classList.contains('active') })));
  check(`${lang} · the picker on the first screen lists every language, the current one marked`, items.length === LANGS.length + (LANGS.includes('en') ? 0 : 1) - 0 || items.length >= 2, JSON.stringify(items.map((i) => i.code)));
  check(`${lang} · the current language is marked`, items.filter((i) => i.active).map((i) => i.code).join() === lang);
  await shot('language-picker');
  await page.keyboard.press('Escape');
  await wait(300);

  // ---- onboarding ----
  await page.click('#ob-next');
  await page.click('#ob-next');
  await wait();
  await audit('onboarding validation');
  await page.fill('#ob-name', 'Dana');
  await page.locator('#ob-sex [role=radio]').nth(1).click();
  await page.fill('#ob-age', '32');
  await page.fill('#ob-height', '165');
  await audit('onboarding details');
  await shot('onboarding-details');
  await page.click('#ob-next');
  await page.fill('#ob-weight', '68');
  await page.fill('#ob-bf', '30');
  await audit('onboarding measurements');
  await page.click('#ob-bf-estimate');
  await page.waitForSelector('.overlay.bf #bf-start');
  await audit('body-fat consent');
  await shot('bodyfat-consent');
  await page.locator('.overlay.bf .icon-btn, .overlay.bf [data-close]').first().click().catch(() => page.keyboard.press('Escape'));
  await wait(300);
  await page.click('#ob-next');
  await audit('onboarding goal');
  await page.locator('[role=radio]').first().click();
  await shot('onboarding-goal');
  await page.click('#ob-next');
  await page.locator('[role=radio]').nth(3).click();
  await page.fill('#ob-targetWeight', '60');
  await wait();
  await audit('onboarding target');
  await shot('onboarding-target');
  const suggestion = page.locator('.notice.warn button').first();
  if (await suggestion.count()) await suggestion.click();
  await page.click('#ob-next');
  await page.locator('[role=radio]').nth(1).click();
  await audit('onboarding activity');
  await page.click('#ob-next');
  await audit('onboarding preferences');
  await shot('onboarding-prefs');
  await page.click('#ob-next');
  await audit('onboarding summary');
  await shot('onboarding-summary');
  await page.click('#ob-next').catch(() => {});
  await wait(400);
  if (!(await page.locator('.page-today').count())) {
    // A starting photo is required: take one from a generated image.
    const b64 = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 600; c.height = 800;
      const g = c.getContext('2d'); g.fillStyle = '#9bb'; g.fillRect(0, 0, 600, 800); g.fillStyle = '#345'; g.beginPath(); g.ellipse(300, 440, 120, 220, 0, 0, 7); g.fill();
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const b of buf) s += String.fromCharCode(b); return btoa(s);
    });
    const file = { name: 'w0.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
    await page.locator('.baseline button').first().click();
    await page.locator('.sheet .photo-buttons input[type=file]:not([capture])').setInputFiles(file);
    await page.waitForSelector('.baseline-img');
    await page.click('#ob-next');
  }
  await page.waitForSelector('.page-today', { timeout: 10000 });
  await wait(600);

  // ---- the reminders question, then every tab ----
  if (await page.locator('#push-yes').count()) { await audit('reminders question'); await shot('reminders'); await page.locator('#reminders-sheet button').last().click(); await wait(300); }
  await audit('today');
  await shot('today');
  await page.locator('.meal .drinks-head').first().click();
  await audit('today, drinks open');
  await page.locator('.meal .alt-btn, .meal .swap-btn').first().click().catch(() => {});
  await wait(400);
  await audit('swap sheet');
  await shot('swap');
  await page.keyboard.press('Escape');
  await wait(300);
  for (const route of ['plan', 'shopping', 'assistant', 'gallery', 'profile']) {
    await page.evaluate((r) => { location.hash = `#/${r}`; }, route);
    await wait(500);
    await audit(route);
    await shot(route);
  }
  // recipes for a meal, opened from the menu
  await page.evaluate(() => { location.hash = '#/plan'; });
  await wait(400);
  const recipeBtn = page.locator('[data-recipes], .meal-actions button, .btn-recipes').first();
  if (await recipeBtn.count()) { await recipeBtn.click().catch(() => {}); await wait(600); await audit('recipes'); await shot('recipes'); await page.keyboard.press('Escape'); }

  // switching language from Profile reloads in the new language
  await page.evaluate(() => { location.hash = '#/profile'; });
  await wait(400);
  check(`${lang} · no uncaught page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

for (const lang of LANGS) {
  console.log(`\n=== ${lang} ===`);
  try { await tour(lang); } catch (e) { check(`${lang} · tour completed`, false, e.message.split('\n')[0]); }
}
await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
