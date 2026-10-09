// End-to-end run of every user flow in headless Chromium at phone size.
//
//   npm run test:e2e                 (needs `npx playwright install chromium` once)
//   SHOTS=/some/dir npm run test:e2e (where screenshots go; default tests/e2e/screenshots)
//
// The Anthropic API is stubbed (no key, no cost); the device clock is driven
// with Playwright's clock so weekly check-ins can be tested in seconds.

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../server/dev-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = playwright;

const SHOTS = process.env.SHOTS || path.join(here, 'screenshots');
mkdirSync(SHOTS, { recursive: true });

// ---------- tiny assertion log ----------
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? '✓' : '✗'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
}

// ---------- stub Anthropic ----------
const upstream = [];
async function fakeAnthropic(url, init) {
  const body = JSON.parse(init.body);
  upstream.push({ url: String(url), headers: new Headers(init.headers), body });
  if (typeof body.system === 'string' && body.system.includes('body fat')) {
    const est = { ok: true, estimate: 26.5, low: 23, high: 30, confidence: 'medium', notes: 'הערכה לפי קו המותן והירכיים.', issue: '' };
    return new Response(JSON.stringify({
      id: 'msg_bf', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: JSON.stringify(est) }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const ctx = body.system[1].text;
  const text = ctx.includes('computedEquivalents')
    ? 'במקום הפריט:\n- **קינואה מבושלת** — 160 ג׳ (כוס אחת), 192 קק״ל\n- **כוסמת** — 210 ג׳, 193 קק״ל'
    : 'תשובה קצרה: אפשר יוגורט חלבון 200 ג׳ עם פרי.\n- 120 קק״ל\n- 20 ג׳ חלבון';
  return new Response(JSON.stringify({
    id: 'msg_test', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const server = createServer({ env: { ANTHROPIC_API_KEY: 'sk-ant-e2e-fake' }, fetchImpl: fakeAnthropic });
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
const BASE = `http://localhost:${PORT}`;

const DAY = 86400000;
const T0 = new Date('2026-10-11T09:00:00+03:00').getTime();
const at = (days) => new Date(T0 + days * DAY);

// Full Chromium (new headless) when available: the headless shell always denies notifications.
const LAUNCH = { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] };
const browser = await chromium.launch({ channel: 'chromium', ...LAUNCH }).catch(() => chromium.launch(LAUNCH));
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  locale: 'he-IL', timezoneId: 'Asia/Jerusalem', acceptDownloads: true,
});
await ctx.clock.setFixedTime(at(0));
await ctx.grantPermissions(['camera']);
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
// The one deliberate failure (body-fat service down) is not a page error.
page.on('console', (m) => { if (m.type() === 'error' && !/status of 503/.test(m.text())) pageErrors.push(m.text()); });

const shot = (name, opts = {}) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts });
const wait = (ms = 250) => page.waitForTimeout(ms);
const visible = (sel) => page.locator(sel).first().isVisible().catch(() => false);
const text = () => page.locator('#view').innerText();

async function setDay(days) {
  await ctx.clock.setFixedTime(at(days));
  await page.reload();
  await page.waitForSelector('#view > *:not(#splash)');
  await wait(300);
}

// Generates a JPEG in the page (big noisy one for the compression test, or a
// simple "progress photo" placeholder whose figure narrows week by week).
async function makeImage(file, { w, h, noise = false, slim = 1, hue = 160 }) {
  const b64 = await page.evaluate(async ({ w, h, noise, slim, hue }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, `hsl(${hue},25%,88%)`);
    grd.addColorStop(1, `hsl(${hue},20%,70%)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    if (noise) {
      const img = g.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = Math.random() * 255;
        img.data[i] = n; img.data[i + 1] = (n * 7) % 255; img.data[i + 2] = (n * 13) % 255;
      }
      g.putImageData(img, 0, 0);
    }
    g.fillStyle = '#3b4b46';
    g.beginPath(); g.arc(w / 2, h * 0.2, w * 0.09, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(w / 2, h * 0.55, w * 0.2 * slim, h * 0.28, 0, 0, Math.PI * 2); g.fill();
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', noise ? 0.97 : 0.9));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, { w, h, noise, slim, hue });
  const out = path.join(SHOTS, file);
  writeFileSync(out, Buffer.from(b64, 'base64'));
  return out;
}

async function idbDump() {
  return page.evaluate(() => new Promise((resolve) => {
    const r = indexedDB.open('nutri');
    r.onsuccess = () => {
      const db = r.result;
      const names = [...db.objectStoreNames];
      if (!names.length) { db.close(); resolve({ stores: [] }); return; }
      const t = db.transaction(names, 'readonly');
      const out = { stores: names };
      let left = names.length;
      for (const n of names) {
        const q = t.objectStore(n).getAll();
        q.onsuccess = () => {
          out[n] = n === 'photos' ? q.result.map((p) => ({ id: p.id, week: p.week, size: p.blob.size, width: p.width, height: p.height, type: p.blob.type })) : q.result;
          if (--left === 0) { db.close(); resolve(out); }
        };
      }
    };
  }));
}

try {
  // =============== PWA basics before anything else ===============
  await page.goto(BASE + '/');
  await page.waitForSelector('#ob-next');
  await shot('01-welcome');
  check('app boots to onboarding for a new user', await visible('.welcome'));

  const manifest = await (await page.request.get(BASE + '/manifest.webmanifest')).json();
  check('manifest: standalone, rtl, he, start_url, icons 192/512/maskable',
    manifest.display === 'standalone' && manifest.dir === 'rtl' && manifest.lang === 'he' && manifest.start_url
    && manifest.icons.some((i) => i.sizes === '192x192') && manifest.icons.some((i) => i.sizes === '512x512') && manifest.icons.some((i) => i.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    const r = await page.request.get(`${BASE}/${icon.src}`);
    check(`icon ${icon.src} served`, r.ok());
  }

  // =============== onboarding ===============
  await page.click('#ob-next');
  await page.click('#ob-next'); // empty step
  await wait();
  check('onboarding validation blocks an empty step', (await page.locator('#err-name').innerText()).length > 0 && (await page.locator('.step-count').innerText()).startsWith('2'));
  await page.fill('#ob-name', 'דנה');
  await page.getByRole('radio', { name: 'אישה' }).click();
  await page.fill('#ob-age', '32');
  await page.fill('#ob-height', '165');
  await shot('02-onboarding-details');
  await page.click('#ob-next');
  await page.fill('#ob-weight', '68');

  // ---- "don't know my body fat": four-angle camera capture ----
  await page.click('#ob-bf-estimate');
  await page.waitForSelector('.overlay.bf #bf-start');
  check('body-fat photos need explicit consent first', await page.locator('#bf-start').isDisabled());
  check('body-fat screen shows the no-guarantee disclaimer up front', (await page.locator('.overlay.bf').innerText()).includes('אין התחייבות'));
  await page.check('#bf-consent');
  await page.click('#bf-start');
  await page.waitForSelector('.bf-video');
  await page.getByRole('radio', { name: '3 שנ׳' }).click();
  await page.waitForFunction(() => document.querySelector('.bf-video')?.videoWidth > 0, null, { timeout: 10000 });
  await shot('24-bodyfat-camera');
  for (let i = 0; i < 4; i++) {
    await page.waitForSelector('#bf-shoot:not([disabled])');
    await page.waitForFunction(() => document.querySelector('.bf-video')?.videoWidth > 0, null, { timeout: 10000 });
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); // a re-render must not close the camera
    await page.click('#bf-shoot');
    await page.waitForSelector('#bf-keep', { timeout: 10000 });
    await page.click('#bf-keep');
  }
  await page.waitForSelector('#bf-skip-tape');
  await page.click('#bf-skip-tape');
  await page.waitForSelector('#bf-use', { timeout: 20000 });
  const bfReqBody = upstream.filter((u) => typeof u.body.system === 'string').at(-1)?.body;
  check('four photos (front, left, back, right) go to the analysis', bfReqBody && bfReqBody.messages[0].content.filter((b) => b.type === 'image').length === 4
    && ['front', 'left', 'back', 'right'].every((a) => bfReqBody.messages[0].content.some((b) => b.type === 'text' && b.text.includes(a))));
  check('result screen has no stray "null" text', !(await page.locator('.overlay.bf').innerText()).includes('null'));
  check('result shows the estimate, range and disclaimer', (await page.locator('#bf-value').innerText()).includes('26.5') && (await page.locator('#bf-disclaimer').innerText()).includes('תזונאי'));
  await shot('25-bodyfat-result');
  await page.click('#bf-use');
  await wait(300);
  check('estimate fills the body-fat field', (await page.inputValue('#ob-bf')) === '26.5');
  check('camera is released after the estimate', await page.evaluate(() => !document.querySelector('.bf-video')));

  await page.fill('#ob-bf', '80');
  await page.click('#ob-next');
  check('body-fat 80% rejected', (await page.locator('#err-bf').innerText()).includes('3'));
  await page.fill('#ob-bf', '30');
  await page.click('#ob-next');
  await page.getByRole('radio', { name: /חיטוב/ }).click();
  await page.click('#ob-next');
  await page.getByRole('radio', { name: '4', exact: true }).click();
  await page.fill('#ob-targetWeight', '60');
  await wait();
  check('unrealistic target warned with a realistic alternative', await visible('.notice.warn') && (await page.locator('.notice.warn').innerText()).includes('הקצב הבטוח'));
  await shot('03-onboarding-unrealistic');
  await page.locator('.notice.warn button', { hasText: 'יעד' }).first().click();
  await wait();
  const tw = Number(await page.inputValue('#ob-targetWeight'));
  check('applying the suggestion sets a reachable target', tw > 60 && tw < 68, `target ${tw}`);
  await page.click('#ob-next');
  await page.getByRole('radio', { name: /פעיל קל/ }).click();
  await page.getByRole('button', { name: 'הוסף' }).click();
  await page.click('#ob-next');
  await page.getByRole('radio', { name: 'צמחוני' }).click();
  await page.locator('input[role="switch"]').check();
  await page.getByRole('button', { name: 'אגוזים' }).click();
  await page.fill('input[placeholder^="לדוגמה: טונה"]', 'טונה, בטטה');
  await wait();
  check('disliked foods preview lists what will be removed', (await text()).includes('יוצאו מהתפריט'));
  await page.getByRole('radio', { name: '5' }).click();
  await shot('04-onboarding-prefs');
  await page.click('#ob-next');
  check('summary shows calculated calories', /\d/.test(await page.locator('.summary .big').innerText()));
  await page.getByRole('button', { name: /תמונת פתיחה/ }).click();
  const small0 = await makeImage('w0.jpg', { w: 900, h: 1200, slim: 1.15, hue: 150 });
  await page.locator('.sheet .photo-buttons input[type=file]:not([capture])').setInputFiles(small0);
  await page.waitForSelector('.baseline-img');
  await shot('05-onboarding-summary');
  await page.click('#ob-next');
  await page.waitForSelector('.page-today');
  check('finishing onboarding opens Today with the tab bar', await visible('#tabbar .tab.on'));

  // =============== Today ===============
  const todayText = await text();
  check('5 meals generated', (await page.locator('.meal').count()) === 5);
  const forbidden = ['טונה', 'בטטה', 'עוף', 'בקר', 'סלמון', 'הודו', 'שקדים', 'אגוזי מלך', 'דג לבן', 'שרימפס'];
  const hits = forbidden.filter((f) => todayText.includes(f));
  check('Today menu contains no restricted foods (vegetarian, nuts, dislikes)', hits.length === 0, hits.join(','));
  await page.locator('.check-btn').first().click();
  await wait(400);
  check('marking a meal eaten fills the calorie ring', (await page.locator('.ring-label strong').innerText()) !== '0');
  await shot('06-today', { fullPage: true });

  // =============== Plan & swaps ===============
  await page.click('a[href="#/plan"]');
  await page.waitForSelector('.page-plan');
  await shot('07-plan', { fullPage: true });
  const firstMains = [];
  for (let i = 0; i < 7; i++) {
    await page.locator('.day-strip .day').nth(i).click();
    await wait(120);
    firstMains.push(await page.locator('.meal').nth(2).locator('.item-name').first().innerText());
  }
  await page.locator('.day-strip .day').first().click();
  await wait(150);
  check(`each day of the week shows a different lunch (${new Set(firstMains).size}/7)`, new Set(firstMains).size === 7, firstMains.join(' | '));
  const firstMeal = page.locator('.meal').first();
  const before = await firstMeal.innerText();
  await firstMeal.getByRole('button', { name: /החלף פחמימה/ }).first().click();
  await page.waitForSelector('.sheet .alt');
  await shot('08-swap-sheet');
  const altName = await page.locator('.sheet .alt .alt-name').first().innerText();
  await page.locator('.sheet .alt button').first().click();
  await wait(500);
  check('choosing a substitute replaces the item in the menu', (await page.locator('.meal').first().innerText()).includes(altName), altName);
  const m2 = page.locator('.meal').nth(2);
  const m2before = await m2.innerText();
  await m2.getByRole('button', { name: 'ארוחה אחרת' }).click();
  await wait(400);
  check('"another meal" reshuffles the meal', (await page.locator('.meal').nth(2).innerText()) !== m2before);
  await page.locator('.day-strip .day').nth(3).click();
  await wait(300);
  check('another day shows a different menu', (await page.locator('.meal').first().innerText()) !== before);
  await page.locator('.day-strip .day').first().click();
  await wait(300);

  // =============== "I don't eat this" ===============
  const firstItem = page.locator('.meal').first().locator('.item').first();
  const neverName = (await firstItem.locator('.item-name').innerText()).trim();
  await firstItem.locator('.chip-btn').click();
  await page.waitForSelector('#btn-never');
  await page.click('#btn-never');
  await wait(500);
  let seen = 0;
  for (let i = 0; i < 7; i++) {
    await page.locator('.day-strip .day').nth(i).click();
    await wait(150);
    if ((await page.locator('.page-plan').innerText()).includes(neverName)) seen++;
  }
  check(`"I don't eat this" removes ${neverName} from the whole week`, seen === 0, `still on ${seen} days`);
  await page.locator('.day-strip .day').first().click();
  await wait(200);

  // =============== weekly shopping list ===============
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await page.click('#btn-shopping');
  await page.waitForSelector('.page-shopping .shop-item');
  const products = await page.locator('.shop-item').count();
  const depts = await page.locator('.shop-group').count();
  check(`shopping list built (${products} products in ${depts} sections)`, products >= 8 && products <= 55 && depts >= 3);
  const excludedIds = (await idbDump()).kv.find((v) => v && v.prefs)?.prefs.excluded || [];
  const listed = await page.locator('.shop-items li').evaluateAll((els) => els.map((e) => e.dataset.item));
  check('shopping list never lists an excluded food', excludedIds.length > 0 && !listed.some((id) => excludedIds.includes(id)), `${excludedIds} vs ${listed}`);
  check('plan tab stays highlighted on the shopping screen', (await page.locator('#tabbar .tab.on').innerText()).includes('תפריט'));
  await shot('22-shopping', { fullPage: true });
  await page.locator('.shop-item input').first().check();
  await wait(300);
  await page.reload();
  await page.waitForSelector('.page-shopping .shop-item');
  check('ticked shopping items survive a reload', await page.locator('.shop-item input').first().isChecked());
  await page.click('#shop-share');
  await wait(300);
  const shared = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check('shopping list can be shared / copied', shared.includes('🛒') && shared.includes('☐'), shared.slice(0, 80));
  await page.getByRole('radio', { name: /שבוע הבא/ }).click();
  await wait(300);
  check('next week has its own list', (await page.locator('.shop-item input:checked').count()) === 0 && (await page.locator('.shop-item').count()) > 0);
  await page.click('a[aria-label="חזרה לתפריט"]');
  await page.waitForSelector('.page-plan');

  // =============== recipes ===============
  await page.locator('.meal').first().locator('.rc-open').click();
  await page.waitForSelector('.overlay.recipes .rc-card');
  const countOf = async () => Number((await page.locator('#rc-count').innerText()).replace(/[^\d]/g, ''));
  const totalRecipes = await countOf();
  check(`meal has a large recipe collection (${totalRecipes})`, totalRecipes >= 40);
  await page.locator('.rc-card .rc-head').first().click();
  const firstSteps = await page.locator('.rc-card').first().locator('.rc-steps li').count();
  const firstIngr = await page.locator('.rc-card').first().locator('.rc-ingr').innerText();
  check('a recipe shows ingredients with exact grams and step-by-step instructions', firstSteps >= 3 && /\d+ ג׳/.test(firstIngr));
  await wait(400);
  await shot('27-recipes', { fullPage: false });
  await page.click('#rc-filter-btn');
  await page.waitForSelector('#rc-panel');
  await page.locator('#rc-panel').getByRole('button', { name: 'תנור', exact: true }).click();
  await wait(200);
  const ovenCount = await countOf();
  const metas = await page.locator('.rc-card .rc-meta').allInnerTexts();
  check(`tool filter: oven only (${ovenCount})`, ovenCount > 0 && ovenCount < totalRecipes && metas.every((m) => m.includes('תנור')));
  await page.locator('#rc-panel').getByRole('button', { name: 'תנור', exact: true }).click();
  await page.locator('#rc-panel').getByRole('button', { name: 'נקה' }).click();
  for (const item of ['שום', 'לימון', 'זעתר', 'פטרוזיליה', 'שמיר']) await page.locator('#rc-panel .chips').first().getByRole('button', { name: item, exact: true }).click();
  await page.check('#rc-pantry-only');
  await wait(200);
  const pantryCount = await countOf();
  check(`"what I have at home" filter (${pantryCount} recipes with just garlic, lemon, za'atar, parsley, dill)`, pantryCount > 0 && pantryCount < totalRecipes);
  await shot('28-recipe-filters', { fullPage: false });
  await page.uncheck('#rc-pantry-only');
  await page.check('#rc-no-spicy');
  await page.locator('.overlay.recipes .icon-btn[aria-label="סגירה"]').click();
  await page.locator('.meal').first().locator('.rc-open').click();
  await page.waitForSelector('.overlay.recipes .rc-card');
  await page.click('#rc-filter-btn');
  check('recipe filters are remembered', await page.isChecked('#rc-no-spicy'));
  await page.uncheck('#rc-no-spicy');
  await page.locator('.rc-card .rc-head').nth(2).click();
  const favTitle = await page.locator('.rc-card').nth(2).locator('.rc-title').innerText();
  await page.locator('.rc-card').nth(2).getByRole('button', { name: /שמירה/ }).click();
  await page.check('#rc-favs');
  await wait(200);
  check('favourite recipes', (await countOf()) === 1 && (await page.locator('.rc-title').first().innerText()) === favTitle);
  await page.uncheck('#rc-favs');
  await page.click('#rc-more');
  check('"more recipes" pages through the collection', (await page.locator('.rc-card').count()) === 24);
  await page.click('#rc-ai');
  await page.waitForSelector('.page-assistant .msg.assistant:not(.typing)');
  await wait(300);
  check('"new idea from the assistant" sends the meal ingredients', upstream.at(-1).body.system[1].text.includes('recipeRequest') && (await page.locator('.msg.user').last().innerText()).includes('מתכון'));
  await page.click('a[href="#/plan"]');
  await page.waitForSelector('.page-plan');

  // =============== Assistant ===============
  await page.locator('.meal').first().getByRole('button', { name: /החלף חלבון/ }).first().click();
  await page.waitForSelector('.sheet .alt, .sheet .empty');
  await page.getByRole('button', { name: /שאל את העוזר/ }).click();
  await page.waitForSelector('.page-assistant .msg.assistant:not(.typing)');
  await wait(300);
  const last = upstream[upstream.length - 1];
  check('quick action opens the assistant pre-filled and sends', (await page.locator('.msg.user').last().innerText()).includes('תחליפים'));
  check('assistant request carries profile, restrictions and computed equivalents',
    last && last.body.system[1].text.includes('computedEquivalents') && last.body.system[1].text.includes('טונה') && last.body.system[1].text.includes('kosher'));
  check('no name or photo is sent to the assistant', last && !last.body.system[1].text.includes('דנה') && !/data:image|blob:/.test(last.body.system[1].text));
  check('proxy uses claude-opus-5-5 with server-side fallbacks', last && last.body.model === 'claude-opus-5-5' && last.body.fallbacks === 'default');
  check('API key is added by the server only', last && last.headers.get('x-api-key') === 'sk-ant-e2e-fake');
  const repliesBefore = await page.locator('.msg.assistant:not(.typing)').count();
  await page.fill('#chat-input', 'מה לאכול לפני אימון?');
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => document.querySelectorAll('.msg.assistant:not(.typing)').length > n, repliesBefore);
  check('free-text question answered', (await page.locator('.msg.assistant').last().innerText()).includes('יוגורט'));
  await shot('09-assistant');

  const jsFiles = ['js/app.js', 'js/chat.js', 'js/config.js', 'js/store.js', 'index.html', 'sw.js'];
  let leak = false;
  for (const f of jsFiles) {
    const body = await (await page.request.get(`${BASE}/${f}`)).text();
    if (/sk-ant|x-api-key|anthropic-version/i.test(body)) leak = true;
  }
  check('no API key or direct Anthropic call in client code', !leak);

  await ctx.setOffline(true);
  await page.fill('#chat-input', 'שאלה בלי אינטרנט');
  await page.keyboard.press('Enter');
  await wait(400);
  check('offline: assistant explains it needs a connection', (await page.locator('.msg.error').last().innerText()).includes('חיבור'));
  check('offline banner visible', await visible('#offline-banner'));
  await page.click('a[href="#/plan"]');
  await page.locator('.meal').first().getByRole('button', { name: /החלף פחמימה/ }).first().click();
  await page.getByRole('button', { name: /שאל את העוזר/ }).click();
  await page.waitForSelector('.msg.local');
  check('offline: substitution falls back to on-device answer', (await page.locator('.msg.local').last().innerText()).includes('ג׳'));
  await ctx.setOffline(false);

  // =============== service worker / offline / installability ===============
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(() => {});
  check('service worker controls the page', await page.evaluate(() => !!navigator.serviceWorker.controller));
  const cdp = await ctx.newCDPSession(page);
  const inst = await cdp.send('Page.getInstallabilityErrors');
  // Test contexts are incognito; that is the only acceptable error.
  const instErrors = inst.installabilityErrors.filter((e) => e.errorId !== 'in-incognito');
  check('Chrome reports the app installable', instErrors.length === 0, JSON.stringify(inst.installabilityErrors));
  const appManifest = await cdp.send('Page.getAppManifest');
  check('Chrome parsed the manifest without errors', appManifest.errors.length === 0, JSON.stringify(appManifest.errors));
  await page.evaluate(() => { location.hash = '#/today'; });
  await page.waitForSelector('.page-today');
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('.page', { timeout: 5000 }).catch(() => {});
  check('app opens fully offline (plan & data from the device)', await visible('.meal'));
  await ctx.setOffline(false);

  // =============== weekly gate: week 1 ===============
  await setDay(7);
  check('day 7: weekly photo gate appears', await visible('#gate'));
  check('gate hides the tab bar', !(await visible('#tabbar')));
  const gateButtons = await page.locator('#gate button').allInnerTexts();
  check('gate has no skip / later / close option', !gateButtons.some((b) => /דלג|אחר כך|מאוחר|סגור|ביטול|הזכר/.test(b)), gateButtons.join('|'));
  await shot('10-gate-photo');

  for (const hash of ['#/today', '#/plan', '#/assistant', '#/gallery', '#/profile']) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await wait(200);
    check(`bypass via ${hash} blocked`, await visible('#gate') && !(await visible('.page')));
  }
  await page.goto(`${BASE}/index.html#/assistant`);
  await page.waitForSelector('#gate');
  check('bypass via direct URL blocked', !(await visible('.page')));
  await page.evaluate(() => document.getElementById('gate').remove());
  await wait(300);
  check('bypass by deleting the gate from the DOM is undone', await visible('#gate'));
  await page.evaluate(() => { const t = document.getElementById('tabbar'); t.hidden = false; t.inert = false; });
  await page.evaluate(() => { location.hash = '#/plan'; });
  await wait(300);
  check('bypass by un-hiding the tab bar blocked', await visible('#gate') && !(await visible('.page')));
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  await page.goBack().catch(() => {});
  await wait(300);
  check('back button / resume keep the gate', await visible('#gate'));

  const big = await makeImage('big.jpg', { w: 4000, h: 3000, noise: true });
  const bigSize = readFileSync(big).length;
  await page.locator('#gate .photo-buttons input[type=file]:not([capture])').setInputFiles(big);
  await page.waitForSelector('#m-weight', { timeout: 15000 });
  const dump1 = await idbDump();
  const p1 = dump1.photos.find((p) => p.week === 1);
  check(`large photo compressed client-side (${(bigSize / 1048576).toFixed(1)}MB → ${p1 ? Math.round(p1.size / 1024) : '?'}KB)`, p1 && p1.size < 650 * 1024 && Math.max(p1.width, p1.height) <= 1600 && p1.type === 'image/jpeg');
  await shot('11-gate-metrics');

  await page.reload();
  await page.waitForSelector('#gate');
  check('closing the app mid check-in resumes at step 2', await visible('#m-weight'));
  for (const hash of ['#/today', '#/gallery']) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await wait(200);
    check(`step 2 also blocks ${hash}`, await visible('#m-weight'));
  }
  // Estimator inside the weekly gate, with the analysis service down → tape fallback.
  await page.route('**/api/bodyfat', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"not_configured"}' }));
  await page.click('#m-bf-estimate');
  await page.check('#bf-consent');
  await page.click('#bf-start');
  for (let i = 0; i < 4; i++) {
    await page.waitForSelector('#bf-file', { state: 'attached' });
    await page.locator('#bf-file').setInputFiles(await makeImage(`bf${i}.jpg`, { w: 900, h: 1200, hue: 40 }));
    await page.waitForSelector('#bf-keep');
    await page.click('#bf-keep');
  }
  await page.fill('#bf-waist', '74');
  await page.fill('#bf-neck', '32');
  await page.fill('#bf-hip', '100');
  await page.click('#bf-analyze');
  await page.waitForSelector('#bf-use');
  const fb = await page.locator('.overlay.bf').innerText();
  check('analysis unavailable → falls back to the tape-measure method and says so', fb.includes('לא הוגדר') && fb.includes('מדידות סרט'), fb.slice(0, 160));
  check('estimator survives inside the locked weekly gate', await visible('#gate'));
  await page.click('#bf-use');
  await wait(200);
  check('fallback estimate fills the weekly body-fat field', /^\d+(\.5)?$/.test(await page.inputValue('#m-bf')));
  await page.unroute('**/api/bodyfat');
  await page.fill('#m-bf', '');
  await page.click('#gate button[type=submit]');
  await wait(200);
  check('metrics are required', (await page.locator('#m-weight-err').innerText()).length > 0 && (await page.locator('#m-bf-err').innerText()).length > 0);
  await page.fill('#m-weight', '55');
  await page.fill('#m-bf', '29');
  await page.click('#gate button[type=submit]');
  await wait(200);
  check('implausible weight jump asks for confirmation', (await page.locator('#m-weight-err').innerText()).includes('לאישור'));
  await page.fill('#m-weight', '67.2');
  await page.fill('#m-bf', '29.5');
  await page.click('#gate button[type=submit]');
  await page.waitForSelector('#checkin-summary');
  const sum = await page.locator('#checkin-summary').innerText();
  check('weekly summary compares with last week and shows the recalculated plan', sum.includes('−0.8') && sum.includes('התוכנית עודכנה'), sum.slice(0, 200));
  await shot('12-checkin-summary');
  await page.click('#summary-continue');
  await page.waitForSelector('.page-today');
  check('after photo + metrics the app unlocks', await visible('#tabbar'));

  // =============== missed week 2, check in for week 3 ===============
  await setDay(21);
  check('day 21: gate for week 3', (await page.locator('#gate-title').innerText()).includes('3'));
  check('missed week 2 is called out', (await page.locator('#gate').innerText()).includes('2'));
  await page.locator('#gate .photo-buttons input[type=file][capture]').setInputFiles(await makeImage('w3.jpg', { w: 900, h: 1200, slim: 0.95, hue: 150 }));
  await page.waitForSelector('#m-weight');
  await page.fill('#m-weight', '66.4');
  await page.fill('#m-bf', '28.6');
  await page.click('#gate button[type=submit]');
  await page.waitForSelector('#checkin-summary');
  await page.click('#summary-continue');

  // =============== gallery ===============
  await page.click('a[href="#/gallery"]');
  await page.waitForSelector('.gallery-grid .tile');
  await wait(500);
  const tiles = await page.locator('.gallery-grid .tile').count();
  const empty = await page.locator('.gallery-grid .tile.empty').count();
  check('gallery: one slot per week (0–3), missed week 2 shown empty', tiles === 4 && empty === 1, `${tiles} tiles, ${empty} empty`);
  check('gallery captions show week, date, weight and body fat', (await page.locator('.tile').nth(1).innerText()).includes('67.2'));
  check('gallery offers no per-photo delete', !(await page.locator('.page-gallery').innerText()).includes('מחק'));
  await shot('13-gallery', { fullPage: true });
  await page.locator('.tile:not(.empty)').first().click();
  await page.waitForSelector('.viewer img[src^="blob:"]');
  await shot('14-viewer');
  await page.getByRole('button', { name: 'שבוע הבא' }).click();
  await wait(200);
  check('full-screen viewer pages between weeks', (await page.locator('.viewer-cap').innerText()).includes('שבוע 1'));
  await page.keyboard.press('Escape');
  await page.click('#btn-compare');
  await page.waitForSelector('.cmp-stage img');
  await page.locator('.cmp-range').fill('30');
  await wait(200);
  const clip = await page.locator('.cmp-img.top').evaluate((el) => el.style.clipPath);
  check('before/after slider moves', clip.includes('70%'), clip);
  await shot('15-compare-slider');
  await page.getByRole('button', { name: 'זה לצד זה' }).click();
  await wait(300);
  check('side-by-side compare', (await page.locator('.cmp-side img').count()) === 2);
  await shot('16-compare-side');
  await page.locator('.compare .icon-btn[aria-label="סגירה"]').click();

  // =============== clock rollback ===============
  await setDay(10);
  check('setting the clock back does not move the app back in time', !(await visible('#gate')) && (await visible('.page')));
  await setDay(28);
  check('day 28: gate for week 4', (await page.locator('#gate-title').innerText()).includes('4'));
  await setDay(23);
  check('rolling the clock back 5 days does not lift a due gate', await visible('#gate'));
  await setDay(28);
  await page.locator('#gate .photo-buttons input[type=file]:not([capture])').setInputFiles(await makeImage('w4.jpg', { w: 900, h: 1200, slim: 0.85, hue: 150 }));
  await page.waitForSelector('#m-weight');
  await page.fill('#m-weight', '65.6');
  await page.fill('#m-bf', '27.8');
  await page.click('#gate button[type=submit]');
  await page.waitForSelector('#checkin-summary');
  await page.click('#summary-continue');
  await page.waitForSelector('.page-today');

  // =============== period end & next period ===============
  check('period end prompts a review on Today', await visible('#period-ended'));
  await page.click('#period-ended button');
  await page.waitForSelector('.sheet');
  await shot('17-period-review');
  await page.locator('.sheet .btn-primary').last().click();
  await wait(500);
  check('next period (maintain) starts', !(await visible('#period-ended')) && (await page.locator('#period-card').innerText()).includes('שמירה'));

  // =============== profile ===============
  await page.click('a[href="#/profile"]');
  await page.waitForSelector('.page-profile');
  const kcalBefore = await page.locator('#period-settings').innerText();
  await page.fill('#m-weight', '64.8');
  await page.fill('#m-bf', '27');
  await page.click('.page-profile form button[type=submit]');
  await wait(500);
  check('manual weight / body-fat update recalculates the plan', (await page.locator('#period-settings').innerText()) !== kcalBefore);
  await page.locator('.card', { hasText: 'העדפות תזונה' }).getByRole('button', { name: /עריכה/ }).click();
  await page.click('#btn-food-picker');
  await page.waitForSelector('.picker .food-chip');
  await shot('23-food-picker');
  // Try to exclude every fat: the picker must stop at two.
  const fatChips = page.locator('.picker-group', { hasText: 'שומנים' }).locator('.food-chip');
  const fatCount = await fatChips.count();
  for (let i = 0; i < fatCount; i++) {
    const chip = page.locator('.picker-group', { hasText: 'שומנים' }).locator('.food-chip:not(.off)').first();
    if (await chip.count()) await chip.click();
    await wait(60);
  }
  const fatsLeft = await page.locator('.picker-group', { hasText: 'שומנים' }).locator('.food-chip:not(.off)').count();
  check('food picker always keeps at least 2 options per category', fatsLeft === 2, `${fatsLeft} left of ${fatCount}`);
  await page.click('#picker-save');
  await wait(300);
  check('picker shows how many foods were removed', (await page.locator('#btn-food-picker').innerText()).includes('הוצאו'));
  await page.locator('.sheet').getByRole('radio', { name: '3' }).click();
  await page.locator('.sheet .btn-primary').click();
  await wait(400);
  await page.click('a[href="#/today"]');
  await page.waitForSelector('.page-today');
  check('changing meals/day regenerates the menu', (await page.locator('.meal').count()) === 3);

  for (const [diet, banned] of [['קיטו', ['לחם', 'אורז', 'פסטה', 'קינואה', 'בטטה', 'תפוח', 'בננה', 'עדשים', 'פיתה']], ['קרניבור', ['לחם', 'אורז', 'סלט', 'ירקות', 'ברוקולי', 'טופו', 'שמן זית', 'אבוקדו', 'טחינה', 'עדשים']]]) {
    await page.click('a[href="#/profile"]');
    await page.waitForSelector('.page-profile');
    await page.locator('.card', { hasText: 'העדפות תזונה' }).getByRole('button', { name: /עריכה/ }).click();
    await page.locator('.sheet').getByRole('radio', { name: diet }).click();
    check(`${diet}: the diet is explained when chosen`, (await page.locator('.sheet .diet-note').innerText()).length > 20);
    await page.locator('.sheet .btn-primary').last().click();
    await wait(400);
    await page.click('a[href="#/plan"]');
    await page.waitForSelector('.page-plan');
    let found = [];
    for (let i = 0; i < 7; i++) {
      await page.locator('.day-strip .day').nth(i).click();
      await wait(120);
      const txt = (await page.locator('.page-plan .meal').allInnerTexts()).join('\n');
      found = found.concat(banned.filter((b) => txt.includes(b)));
    }
    check(`${diet}: a week of menus has none of ${banned.length} off-plan foods`, found.length === 0, [...new Set(found)].join(','));
    if (diet === 'קיטו') await shot('26-keto-plan', { fullPage: true });
  }
  await page.click('a[href="#/profile"]');
  await page.locator('.card', { hasText: 'העדפות תזונה' }).getByRole('button', { name: /עריכה/ }).click();
  await page.locator('.sheet').getByRole('radio', { name: 'צמחוני' }).click();
  await page.locator('.sheet .btn-primary').last().click();
  await wait(300);
  await page.click('a[href="#/today"]');
  await page.waitForSelector('.page-today');

  await ctx.grantPermissions(['notifications'], { origin: BASE });
  await page.click('a[href="#/profile"]');
  await page.waitForSelector('.page-profile');
  await page.locator('.switch-row', { hasText: 'תזכורת' }).locator('input').check();
  await wait(500);
  const perm = await page.evaluate(() => Notification.permission);
  const settingsRow = (await idbDump()).kv.find((v) => v && typeof v === 'object' && 'reminders' in v);
  check('weekly reminder can be enabled', settingsRow && settingsRow.reminders === true, `permission=${perm} settings=${JSON.stringify(settingsRow)}`);
  const periodic = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return 'periodicSync' in reg ? (await reg.periodicSync.getTags().catch((e) => [`err:${e.name}`])) : ['unsupported'];
  });
  console.log('   periodic sync tags:', periodic.join(','));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /ליומן/ }).click()]);
  const icsPath = path.join(SHOTS, 'weekly.ics');
  await dl.saveAs(icsPath);
  const ics = readFileSync(icsPath, 'utf8');
  check('calendar reminder is a weekly recurring event', ics.includes('RRULE:FREQ=WEEKLY') && ics.includes('DTSTART;VALUE=DATE:20261115'), ics.match(/DTSTART[^\r]*/)?.[0]);
  await shot('18-profile', { fullPage: true });

  await page.getByRole('radio', { name: 'כהה' }).click();
  await page.click('a[href="#/today"]');
  await wait(400);
  await shot('19-today-dark', { fullPage: true });
  check('dark theme applies', await page.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(14, 22, 20)');
  await page.click('a[href="#/gallery"]');
  await wait(500);
  await shot('20-gallery-dark');
  await page.click('a[href="#/profile"]');
  await page.getByRole('radio', { name: 'בהיר' }).click();

  // =============== layout at several phone sizes ===============
  for (const [w, h] of [[320, 640], [360, 740], [390, 844], [430, 932]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const r of ['today', 'plan', 'assistant', 'gallery', 'profile']) {
      await page.evaluate((x) => { location.hash = `#/${x}`; }, r);
      await wait(250);
      const m = await page.evaluate(() => {
        const overflow = document.documentElement.scrollWidth - window.innerWidth;
        const small = [];
        for (const el of document.querySelectorAll('#view button, #view a, #tabbar a, #view input, #view select, #view textarea')) {
          // A control inside a <label> is tapped through the whole label.
          const b = (el.closest('label') || el).getBoundingClientRect();
          const s = getComputedStyle(el);
          if (!b.width || s.visibility === 'hidden' || el.closest('.visually-hidden') || el.type === 'file' || el.type === 'range') continue;
          if (b.height < 34 || b.width < 34) small.push(`${el.tagName.toLowerCase()}:${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 20)}(${Math.round(b.width)}x${Math.round(b.height)})`);
        }
        return { overflow, small };
      });
      check(`${w}px ${r}: no horizontal scroll`, m.overflow <= 0, `overflow ${m.overflow}px`);
      check(`${w}px ${r}: touch targets ≥ 34px`, m.small.length === 0, m.small.join(', '));
      if (w === 360) await shot(`21-${w}-${r}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });

  // =============== service-worker reminder (periodic background sync) ===============
  // The SW runs on the real clock, so make the registration two weeks old in
  // real time, then fire a periodic-sync event through DevTools.
  const realRegDay = (() => { const x = new Date(Date.now() - 15 * DAY); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; })();
  await page.evaluate((regDay) => new Promise((resolve) => {
    const r = indexedDB.open('nutri');
    r.onsuccess = () => {
      const t = r.result.transaction('kv', 'readwrite');
      const kv = t.objectStore('kv');
      const g = kv.get('profile');
      g.onsuccess = () => {
        kv.put({ ...g.result, regDay }, 'profile');
        kv.put({ theme: 'light', reminders: true, installDismissed: false }, 'settings');
      };
      t.oncomplete = () => { r.result.close(); resolve(); };
    };
  }), realRegDay);
  try {
    const sw = await ctx.newCDPSession(page);
    const regs = new Promise((resolve) => sw.on('ServiceWorker.workerRegistrationUpdated', (e) => { if (e.registrations.length) resolve(e.registrations[0]); }));
    await sw.send('ServiceWorker.enable');
    const reg = await regs;
    await sw.send('ServiceWorker.dispatchPeriodicSyncEvent', { origin: BASE, registrationId: reg.registrationId, tag: 'checkin-reminder' });
    await wait(1500);
    const notes = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications({ tag: 'weekly-checkin' })).map((n) => n.title + ' | ' + n.body));
    check('service worker shows the weekly reminder when a check-in is due', notes.length === 1 && notes[0].includes('שבוע 2'), JSON.stringify(notes));
  } catch (e) {
    check('service worker shows the weekly reminder when a check-in is due', false, e.message);
  }

  // =============== delete all data ===============
  await page.evaluate(() => { location.hash = '#/profile'; });
  await page.waitForSelector('#btn-delete-all');
  await page.click('#btn-delete-all');
  check('delete requires typing a confirmation', await page.locator('#confirm-delete-btn').isDisabled());
  await page.fill('#confirm-delete', 'מחק');
  await page.click('#confirm-delete-btn');
  await page.waitForSelector('.welcome', { timeout: 10000 });
  const after = await idbDump();
  check('all data deleted, back to onboarding', (after.photos || []).length === 0 && (after.metrics || []).length === 0 && !(after.kv || []).length);
} catch (e) {
  check('e2e run completed without crashing', false, e.stack);
  await shot('zz-crash').catch(() => {});
} finally {
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '));
  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${SHOTS}`);
  process.exitCode = failed.length ? 1 : 0;
}
