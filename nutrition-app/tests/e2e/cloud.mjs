// End-to-end test of cloud accounts: Google sign-in (PKCE), sync between two
// devices, photo backup, the "which copy" choice, sign-out and delete-all —
// against an in-memory fake of the Supabase APIs the app uses.
// Also covers the profile picture, nickname and the profile layout.
// Run: node tests/e2e/cloud.mjs

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? '✓' : '✗'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
}

// ---------- fake Supabase ----------
const SUPA = 'https://e2e.supabase.co';
const USER = { id: '6f1c0e1a-0000-4000-8000-000000000001', email: 'tester@example.com', user_metadata: { full_name: 'מתן בודק' } };
// Friends: two other people and a request from one of them, as PostgREST would hold them.
const BOB = { user_id: '6f1c0e1a-0000-4000-8000-0000000000b0', username: 'bob', display_name: 'Bob', wins: 3, losses: 1 };
const CAROL = { user_id: '6f1c0e1a-0000-4000-8000-0000000000c0', username: 'carol', display_name: 'Carol', wins: 0, losses: 0 };
const fake = { profiles: [BOB, CAROL], requests: [{ id: 'req-1', from_user: CAROL.user_id, to_user: USER.id, status: 'pending', created_at: '2026-10-10T08:00:00Z', updated_at: '2026-10-10T08:00:00Z' }], challenges: [], challengeDays: [], rpcCalls: [], codes: new Map(), row: null, files: new Map(), calls: [], deletedAccount: false, badAuth: 0 };

async function supabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname;
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  fake.calls.push(`${req.method()} ${p}`);

  if (p === '/auth/v1/authorize') {
    const code = `code-${fake.codes.size + 1}`;
    fake.codes.set(code, url.searchParams.get('code_challenge'));
    const back = new URL(url.searchParams.get('redirect_to'));
    back.searchParams.set('code', code);
    return route.fulfill({ status: 302, headers: { location: back.toString() } });
  }
  if (p === '/auth/v1/token') {
    const body = JSON.parse(req.postData());
    if (url.searchParams.get('grant_type') === 'pkce') {
      const want = fake.codes.get(body.auth_code);
      const got = createHash('sha256').update(body.code_verifier).digest('base64url');
      if (!want || want !== got) { fake.badAuth++; return json(400, { error: 'invalid_grant' }); }
    }
    return json(200, { access_token: 'tok-1', refresh_token: 'ref-1', expires_in: 3600, user: USER });
  }
  if (p === '/auth/v1/logout') return json(204);

  // Everything below needs the user's token and the anon key.
  if (req.headers().authorization !== 'Bearer tok-1' || req.headers().apikey !== 'anon-e2e') return json(401, { message: 'no' });

  if (p === '/rest/v1/nutri_state' && req.method() === 'GET') return json(200, fake.row ? [{ data: fake.row.data }] : []);
  if (p === '/rest/v1/nutri_state' && req.method() === 'POST') {
    const body = JSON.parse(req.postData());
    if (body.user_id !== USER.id) return json(403, { message: 'rls' });
    fake.row = body;
    return json(201);
  }
  // ---- friends (RLS in short: profiles readable by all, own row writable; requests visible to both sides) ----
  if (p === '/rest/v1/nutri_profiles') {
    const q = url.searchParams;
    if (req.method() === 'GET') {
      let rows = fake.profiles;
      const f = (k) => q.get(k);
      if (f('user_id') && f('user_id').startsWith('eq.')) rows = rows.filter((x) => x.user_id === f('user_id').slice(3));
      if (f('user_id') && f('user_id').startsWith('in.(')) { const ids = f('user_id').slice(4, -1).split(','); rows = rows.filter((x) => ids.includes(x.user_id)); }
      if (f('username') && f('username').startsWith('eq.')) rows = rows.filter((x) => x.username === f('username').slice(3));
      return json(200, rows);
    }
    if (req.method() === 'PATCH') {
      if (q.get('user_id') !== `eq.${USER.id}`) return json(403, { message: 'rls' });
      const body = JSON.parse(req.postData());
      if (!/^[a-z0-9_]{3,20}$/.test(body.username)) return json(400, { code: '23514' });
      if (fake.profiles.some((x) => x.username === body.username && x.user_id !== USER.id)) return json(409, { code: '23505', message: 'duplicate key' });
      const mine = fake.profiles.find((x) => x.user_id === USER.id);
      if (!mine) return json(200, []);
      Object.assign(mine, body);
      return json(200, [mine]);
    }
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData());
      if (body.user_id !== USER.id) return json(403, { message: 'rls' });
      if (fake.profiles.some((x) => x.user_id === USER.id)) return json(409, { code: '23505' });
      if (!/^[a-z0-9_]{3,20}$/.test(body.username)) return json(400, { code: '23514' });
      if (fake.profiles.some((x) => x.username === body.username && x.user_id !== USER.id)) return json(409, { code: '23505', message: 'duplicate key' });
      const mine = fake.profiles.find((x) => x.user_id === USER.id);
      const row = { wins: 0, losses: 0, ...(mine || {}), user_id: USER.id, username: body.username, display_name: body.display_name };
      fake.profiles = [...fake.profiles.filter((x) => x.user_id !== USER.id), row];
      return json(201, [row]);
    }
  }
  if (p === '/rest/v1/nutri_friend_requests') {
    const q = url.searchParams;
    const mineRow = (r) => r.from_user === USER.id || r.to_user === USER.id;
    if (req.method() === 'GET') return json(200, fake.requests.filter(mineRow));
    if (req.method() === 'POST') {
      const b = JSON.parse(req.postData());
      if (b.from_user !== USER.id || b.to_user === USER.id) return json(403, { message: 'rls' });
      if (fake.requests.some((r) => r.from_user === b.from_user && r.to_user === b.to_user)) return json(409, { code: '23505' });
      fake.requests.push({ id: `req-${fake.requests.length + 1}`, from_user: b.from_user, to_user: b.to_user, status: 'pending', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      return json(201);
    }
    const id = (q.get('id') || '').replace('eq.', '');
    const target = fake.requests.find((r) => r.id === id && mineRow(r));
    if (!target) return json(204);
    if (req.method() === 'PATCH') {
      if (target.to_user !== USER.id) return json(403, { message: 'rls' });
      Object.assign(target, { status: JSON.parse(req.postData()).status, updated_at: new Date().toISOString() });
      return json(204);
    }
    if (req.method() === 'DELETE') { fake.requests = fake.requests.filter((r) => r !== target); return json(204); }
  }
  // ---- challenges: the same rules as supabase/setup.sql, in short ----
  if (p === '/rest/v1/nutri_challenges' && req.method() === 'GET') return json(200, fake.challenges.filter((c) => c.creator === USER.id || c.opponent === USER.id));
  if (p === '/rest/v1/nutri_challenge_days' && req.method() === 'GET') {
    const ids = (url.searchParams.get('challenge_id') || '').replace(/^in\.\(|\)$/g, '').split(',');
    return json(200, fake.challengeDays.filter((d) => ids.includes(d.challenge_id)));
  }
  if (p.startsWith('/rest/v1/rpc/') && p !== '/rest/v1/rpc/delete_my_account') {
    const name = p.slice('/rest/v1/rpc/'.length);
    const a = JSON.parse(req.postData() || '{}');
    fake.rpcCalls.push({ name, args: a });
    const err = (status, message, code = '42501') => json(status, { code, message });
    const addDay = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
    const mine = (c) => c.creator === USER.id || c.opponent === USER.id;
    const misses = (c, uid, to) => {
      const rows = fake.challengeDays.filter((d) => d.challenge_id === c.id && d.user_id === uid);
      const fb = rows.length ? Math.max(...rows.map((r) => r.planned)) : 3;
      let n = 0;
      for (let d = c.start_date; d <= to; d = addDay(d, 1)) { const r = rows.find((x) => x.day === d); n += r ? Math.max(r.planned - r.logged, 0) : fb; }
      return n;
    };
    const finish = (c, loser) => {
      Object.assign(c, { status: 'finished', loser, result: loser ? 'loss' : 'draw', finished_at: new Date().toISOString() });
      if (loser) for (const pr of fake.profiles) { if (pr.user_id === loser) pr.losses++; else if ([c.creator, c.opponent].includes(pr.user_id)) pr.wins++; }
    };
    const evaluate = (c, today) => {
      if (c.status !== 'active') return c.status;
      const end = [c.end_date, addDay(today, -1)].sort()[0];
      const mc = misses(c, c.creator, end);
      const mo = misses(c, c.opponent, end);
      if (!(mc > c.max_misses || mo > c.max_misses || today > c.end_date)) return 'active';
      finish(c, mc > mo ? c.creator : mo > mc ? c.opponent : null);
      return 'finished';
    };
    const find = () => fake.challenges.find((c) => c.id === a.p_id);
    if (name === 'create_challenge') {
      const friends = fake.requests.some((r) => r.status === 'accepted' && [[r.from_user, r.to_user], [r.to_user, r.from_user]].some(([x, y]) => x === USER.id && y === a.p_opponent));
      if (!friends) return err(403, 'not_friends');
      if (fake.challenges.some((c) => ['pending', 'active'].includes(c.status) && mine(c) && [c.creator, c.opponent].includes(a.p_opponent))) return err(409, 'already_challenged', '23505');
      const c = { id: `00000000-0000-4000-8000-${String(fake.challenges.length + 1).padStart(12, '0')}`, creator: USER.id, opponent: a.p_opponent, status: 'pending', days: a.p_days, max_misses: a.p_max_misses, start_date: null, end_date: null, loser: null, result: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), finished_at: null };
      fake.challenges.unshift(c);
      return json(200, c.id);
    }
    const c = find();
    if (!c || !mine(c)) return err(403, 'not_allowed');
    if (name === 'respond_challenge') {
      if (c.opponent !== USER.id || c.status !== 'pending') return err(403, 'not_allowed');
      if (a.p_accept) Object.assign(c, { status: 'active', start_date: addDay(a.p_today, 1), end_date: addDay(a.p_today, c.days) }); else c.status = 'declined';
      return json(200, c.status);
    }
    if (name === 'cancel_challenge') { if (c.creator !== USER.id || c.status !== 'pending') return err(403, 'not_allowed'); c.status = 'cancelled'; return json(200, null); }
    if (name === 'forfeit_challenge') { if (c.status !== 'active') return err(403, 'not_allowed'); finish(c, USER.id); return json(200, null); }
    if (name === 'report_challenge_day') {
      if (c.status !== 'active') return err(403, 'not_allowed');
      if (a.p_day >= c.start_date && a.p_day <= c.end_date && a.p_day <= a.p_today && a.p_day >= addDay(a.p_today, -1)) {
        fake.challengeDays = fake.challengeDays.filter((d) => !(d.challenge_id === c.id && d.user_id === USER.id && d.day === a.p_day));
        fake.challengeDays.push({ challenge_id: c.id, user_id: USER.id, day: a.p_day, planned: a.p_planned, logged: Math.min(a.p_logged, a.p_planned) });
      }
      return json(200, evaluate(c, a.p_today));
    }
    if (name === 'evaluate_challenge') return json(200, evaluate(c, a.p_today));
  }
  if (p === '/rest/v1/rpc/delete_my_account') { fake.row = null; fake.deletedAccount = true; return json(204); }

  const prefix = `/storage/v1/object/nutri/${USER.id}/`;
  if (p.startsWith(prefix) && req.method() === 'POST') { fake.files.set(p.slice(prefix.length), req.postDataBuffer()); return json(200, { Key: p }); }
  const getPrefix = `/storage/v1/object/authenticated/nutri/${USER.id}/`;
  if (p.startsWith(getPrefix)) {
    const f = fake.files.get(p.slice(getPrefix.length));
    return f ? route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'image/jpeg' }, body: f }) : json(400, { error: 'not_found' });
  }
  if (p === '/storage/v1/object/list/nutri') {
    const { prefix: pre } = JSON.parse(req.postData());
    const folder = pre.slice(USER.id.length + 1);
    return json(200, [...fake.files.keys()].filter((k) => k.startsWith(`${folder}/`)).map((k) => ({ name: k.slice(folder.length + 1) })));
  }
  if (p === '/storage/v1/object/nutri' && req.method() === 'DELETE') {
    for (const full of JSON.parse(req.postData()).prefixes) fake.files.delete(full.slice(USER.id.length + 1));
    return json(200, []);
  }
  return json(404, { message: `unhandled ${p}` });
}

const server = createServer({
  env: { NO_PUSH: '1' },
  overrides: { '/js/config.js': (t) => t.replace(/url: '[^']*',/, `url: '${SUPA}',`).replace(/anonKey: '[^']*',/, "anonKey: 'anon-e2e',") },
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ channel: 'chromium' }).catch(() => chromium.launch());
const pageErrors = [];

async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  await ctx.route(`${SUPA}/**`, supabase);
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('nutri-lang')) localStorage.setItem('nutri-lang', 'he'); } catch {} });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (400|401|404|409)/.test(m.text())) pageErrors.push(`${name}: ${m.text()}`); });
  return { ctx, page };
}

const wait = (page, ms = 300) => page.waitForTimeout(ms);
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  return false;
}

// (ASCII file names: Playwright's setInputFiles silently drops a Hebrew one.)
async function makeImage(page, file, hue) {
  const b64 = await page.evaluate(async (hue) => {
    const c = document.createElement('canvas');
    c.width = 600; c.height = 800;
    const g = c.getContext('2d');
    g.fillStyle = `hsl(${hue},45%,70%)`; g.fillRect(0, 0, 600, 800);
    g.fillStyle = '#334'; g.beginPath(); g.arc(300, 330, 150, 0, Math.PI * 2); g.fill();
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (const b of buf) s += String.fromCharCode(b);
    return btoa(s);
  }, hue);
  const out = path.join(SHOTS, file);
  writeFileSync(out, Buffer.from(b64, 'base64'));
  return out;
}

async function onboard(page, name) {
  await page.click('#ob-next');
  await page.fill('#ob-name', name);
  await page.getByRole('radio', { name: 'גבר' }).click();
  await page.fill('#ob-age', '28');
  await page.fill('#ob-height', '178');
  await page.click('#ob-next');
  await page.fill('#ob-weight', '82');
  await page.fill('#ob-bf', '20');
  await page.click('#ob-next');
  await page.getByRole('radio', { name: /חיטוב/ }).click();
  await page.click('#ob-next');
  await page.click('#ob-next');
  await page.getByRole('radio', { name: /פעיל קל/ }).click();
  await page.click('#ob-next');
  await page.click('#ob-next');
  await page.getByRole('button', { name: /תמונת פתיחה/ }).click();
  await page.locator('.sheet .photo-buttons input[type=file]:not([capture])').setInputFiles(await makeImage(page, `cloud-w0-${name.length}.jpg`, 150));
  await page.waitForSelector('.baseline-img');
  await page.click('#ob-next');
  await page.waitForSelector('.page-today');
}

const headText = (page) => page.locator('.page-head').first().innerText();

try {
  // ======== no AI vendor names anywhere in the app's code strings ========
  const vendor = /Anthropic|Claude|Groq|Gemini|Mistral|OpenAI|ChatGPT|GPT-|NVIDIA|DeepSeek|Cerebras|OpenRouter/i;
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(js|html|webmanifest)$/.test(f.name)) files.push(p); } };
  walk(path.join(here, '../../www'));
  const leaks = [];
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
      // "llama" is also the Spanish word for flame, so only check it outside the language packs
      if (vendor.test(code) || (!/[\\/]lang[\\/]/.test(f) && /Llama/i.test(code))) leaks.push(`${path.basename(f)}:${i + 1}`);
    });
  }
  check('no AI company or model name in any user-facing string', leaks.length === 0, leaks.join(', '));

  // ======== device A: registers, profile character, then signs in ========
  const A = await device('A');
  await A.page.goto(BASE + '/');
  await A.page.waitForSelector('#entry');
  const entryBtns = await A.page.locator('#entry button').evaluateAll((els) => els.map((e) => e.id));
  check(`the first screen offers the language picker, then exactly sign in / create account / guest (${entryBtns})`, entryBtns.join() === 'lang-btn,entry-login,entry-signup,entry-guest');
  check('no registration field or tab bar behind the first screen', (await A.page.locator('#ob-next').count()) === 0 && !(await A.page.locator('#tabbar').isVisible()));
  await A.page.screenshot({ path: path.join(SHOTS, 'c01-entry.png') });
  await A.page.click('#entry-guest');
  await A.page.waitForSelector('#ob-next');
  check('"no account" goes to the registration welcome, with a way back to the choices', await A.page.locator('#entry-back').isVisible());
  await A.page.screenshot({ path: path.join(SHOTS, 'c01b-guest-welcome.png') });
  await A.page.reload();
  await A.page.waitForSelector('#ob-next');
  check('the guest choice is remembered on this device', (await A.page.locator('#entry').count()) === 0);
  await onboard(A.page, 'מתן');

  const head = await headText(A.page);
  check(`Today greets by name, and the date no longer says "יום יום" (${head.replace(/\n/g, ' / ')})`, /מתן/.test(head) && !/יום יום/.test(head) && /יום (ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/.test(head));

  // Inviting friends is one tap from Today, even before signing in.
  check('Today has an "invite friends" card', await A.page.locator('#invite-card').isVisible());
  await A.page.click('#btn-invite-today');
  await A.page.waitForSelector('#invite-sheet #btn-google-friends');
  check('not signed in: the invite sheet asks to sign in first', await A.page.locator('#invite-sheet #btn-google-friends').isVisible());
  await A.page.screenshot({ path: path.join(SHOTS, 'c02b-invite-signin.png') });
  await A.page.keyboard.press('Escape');
  await A.page.click('a[href="#/profile"]');
  await A.page.waitForSelector('.profile-head');
  const order = await A.page.locator('.page-profile > *').evaluateAll((els) => els.slice(0, 3).map((e) => e.id || e.className));
  check(`profile opens with the picture, then personal details, then the account (${order})`, order[0] === 'profile-head' && order[1] === 'details-card' && order[2] === 'account-card');
  check('no picture yet: the first letter stands in', (await A.page.locator('.profile-head .avatar').innerText()).trim() === 'מ');

  // nickname
  await A.page.click('#btn-edit-details');
  await A.page.fill('#ed-nickname', 'מתנוש');
  await A.page.locator('.sheet .btn-primary').click();
  await wait(A.page, 400);
  check('nickname shows as the profile title, the name under it', (await A.page.locator('.profile-head h1').innerText()) === 'מתנוש' && (await A.page.locator('.profile-id').innerText()).includes('מתן'));

  // profile picture from the gallery
  await A.page.click('#btn-avatar');
  await A.page.waitForSelector('#avatar-sheet');
  check('picture sheet offers camera (front) and gallery', (await A.page.locator('#avatar-sheet input[capture="user"]').count()) === 1 && (await A.page.locator('#avatar-sheet #btn-gallery').count()) === 1);
  await A.page.locator('#avatar-sheet input[type=file]:not([capture])').setInputFiles(await makeImage(A.page, 'cloud-avatar.jpg', 30));
  await A.page.waitForSelector('.profile-head .avatar img');
  const av = await A.page.locator('.profile-head .avatar img').evaluate((i) => new Promise((r) => (i.complete ? r([i.naturalWidth, i.naturalHeight]) : i.addEventListener('load', () => r([i.naturalWidth, i.naturalHeight])))));
  check(`profile picture is a centred square (${av})`, av[0] === av[1] && av[0] <= 320 && av[0] > 0);
  await wait(A.page, 2800); // let the toast go
  await A.page.screenshot({ path: path.join(SHOTS, 'c02-profile.png') });
  await A.page.click('a[href="#/today"]');
  await A.page.waitForSelector('.page-today');
  check('Today shows the picture and greets by nickname', (await A.page.locator('.head-avatar img').count()) === 1 && (await headText(A.page)).includes('מתנוש'));
  await wait(A.page, 2800); // let the toast go
  await A.page.screenshot({ path: path.join(SHOTS, 'c03-today-avatar.png') });

  // sign in
  await A.page.click('a[href="#/profile"]');
  await A.page.waitForSelector('#account-card #btn-google');
  await A.page.click('#account-card #btn-google');
  await A.page.waitForSelector('#account-user', { timeout: 15000 });
  check('Google sign-in completes with PKCE (verifier matches the challenge)', fake.badAuth === 0 && fake.calls.includes('POST /auth/v1/token'));
  check('the address bar no longer carries the one-time code', !A.page.url().includes('code=') && A.page.url().includes('#/profile'));
  check('account card shows the signed-in user', (await A.page.locator('#account-user').innerText()).includes('tester@example.com'));
  check('device data uploaded to the account', await until(() => fake.row && fake.row.data.profile.nickname === 'מתנוש'));
  check('profile picture uploaded; progress photos not (backup is off)', await until(() => fake.files.has('profile/avatar.jpg')) && ![...fake.files.keys()].some((k) => k.startsWith('photos/')));
  check('row is written for the signed-in user only', fake.row.user_id === USER.id);
  await wait(A.page, 2800); // let the toast go
  await A.page.screenshot({ path: path.join(SHOTS, 'c04-account.png') });

  await A.page.check('#photo-backup');
  check('turning photo backup on uploads the progress photos', await until(() => [...fake.files.keys()].some((k) => k.startsWith('photos/'))));
  await A.page.click('a[href="#/today"]');
  await A.page.waitForSelector('.page-today');
  await A.page.locator('.check-btn').first().click();
  check('a change on the device reaches the cloud within seconds', await until(() => {
    const logs = fake.row && fake.row.data.logs;
    return logs && Object.values(logs).some((l) => l.eaten && l.eaten.length);
  }));

  // ======== friends: username, invite link, requests, inbox ========
  await A.page.click('a[href="#/profile"]');
  await A.page.waitForSelector('#friends-card');
  check('Profile: an invite button at the top and in the Friends card', (await A.page.locator('#btn-invite-head').count()) === 1 && (await A.page.locator('#btn-invite-card').count()) === 1);
  check('Profile has a Friends card after the account card', (await A.page.locator('.page-profile > *').evaluateAll((els) => els.map((e) => e.id))).join().includes('account-card,friends-card'));
  await A.page.waitForSelector('#username-form');
  await A.page.fill('#username-input', 'ab');
  await A.page.click('#username-save');
  check('a too short username is refused before asking the server', (await A.page.locator('#username-msg').innerText()).length > 5 && !fake.profiles.some((x) => x.user_id === USER.id));
  await A.page.fill('#username-input', 'Bob');
  await A.page.click('#username-save');
  await until(async () => (await A.page.locator('#username-msg').innerText()).length > 5 && !(await A.page.locator('#username-msg').innerText()).includes('…'));
  check('a taken username is refused', await A.page.locator('#username-form').isVisible() && !fake.profiles.some((x) => x.user_id === USER.id));
  await A.page.fill('#username-input', '@Matan_Test');
  await A.page.click('#username-save');
  await A.page.waitForSelector('#my-username');
  check('the username is saved lower case, without the @ typed', (await A.page.locator('#my-username').innerText()) === '@matan_test' && fake.profiles.find((x) => x.user_id === USER.id).username === 'matan_test');
  const wa = await A.page.locator('#share-whatsapp').getAttribute('href');
  check('the WhatsApp button carries the invite link to the profile', wa.startsWith('https://wa.me/?text=') && decodeURIComponent(wa).includes('#/u/matan_test') && decodeURIComponent(wa).includes(BASE));
  await A.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await A.page.click('#share-copy');
  check('"copy link" puts the same link on the clipboard', (await A.page.evaluate(() => navigator.clipboard.readText())).endsWith('#/u/matan_test'));
  await A.page.screenshot({ path: path.join(SHOTS, 'c05-friends-card.png'), fullPage: true });

  // The bell: the welcome message and Carol's request.
  await A.page.click('a[href="#/today"]');
  await A.page.waitForSelector('#bell');
  await A.page.click('#btn-invite-today');
  await A.page.waitForSelector('#invite-sheet #share-whatsapp');
  check('Today: the invite button opens the WhatsApp / copy options for your link', (await A.page.locator('#invite-sheet #my-username').innerText()) === '@matan_test' && await A.page.locator('#invite-sheet #share-copy').isVisible());
  await A.page.screenshot({ path: path.join(SHOTS, 'c05b-invite-sheet.png') });
  await A.page.keyboard.press('Escape');
  await A.page.waitForTimeout(400);
  await until(async () => (await A.page.locator('.bell-badge').innerText()) === '2');
  check('the bell counts the welcome message and the waiting friend request', (await A.page.locator('.bell-badge').innerText()) === '2');
  await A.page.click('#bell');
  await A.page.waitForSelector('#inbox-list');
  check('the inbox opens on the app messages: the welcome is there', (await A.page.locator('.inbox-item[data-kind="welcome"]').count()) === 1);
  await until(async () => (await A.page.locator('#tab-requests .count').count()) === 1);
  check('friend requests are a separate folder with their own count', (await A.page.locator('#tab-requests .count').innerText()) === '1');
  await A.page.screenshot({ path: path.join(SHOTS, 'c06-inbox.png') });
  await A.page.click('#tab-requests');
  await A.page.waitForSelector('#requests-in');
  check("Carol's request is in the requests folder, not among the messages", (await A.page.locator('#requests-in').innerText()).includes('Carol') && (await A.page.locator('.inbox-item[data-kind]').count()) === 0);
  await A.page.screenshot({ path: path.join(SHOTS, 'c07-requests.png') });
  await A.page.click('#requests-in [data-act="accept"]');
  await until(() => fake.requests.find((r) => r.id === 'req-1').status === 'accepted');
  check('accepting updates the request on the server', fake.requests.find((r) => r.id === 'req-1').status === 'accepted');
  await A.page.waitForSelector('#requests-empty');
  await A.page.click('a.tab[href="#/today"]');
  await A.page.waitForSelector('.page-today');
  check('the badge drops once the messages were read and the request answered', await until(async () => (await A.page.locator('.bell-badge').isHidden())));

  // Find Bob by username, ask him, take it back.
  await A.page.click('a.tab[href="#/profile"]');
  await A.page.waitForSelector('#friend-search');
  check('the accepted friend is on the list', (await A.page.locator('#friend-list').innerText()).includes('Carol'));
  await A.page.fill('#friend-search', '@Bob');
  await A.page.click('#friend-find');
  await A.page.waitForSelector('#user-name');
  check("searching goes to the person's profile with name, @username and win rate", (await A.page.locator('#user-name').innerText()) === 'Bob' && (await A.page.locator('#user-handle').innerText()) === '@bob' && (await A.page.locator('#user-stats').innerText()).includes('75'));
  await A.page.screenshot({ path: path.join(SHOTS, 'c08-user-profile.png') });
  await A.page.click('#friend-add');
  await A.page.waitForSelector('#friend-sent');
  check('"send friend request" posts one request', fake.requests.some((r) => r.from_user === USER.id && r.to_user === BOB.user_id && r.status === 'pending'));
  await A.page.click('#friend-cancel');
  await A.page.waitForSelector('#friend-add');
  check('cancelling removes it', !fake.requests.some((r) => r.to_user === BOB.user_id));

  // An invite link opened directly.
  await A.page.goto(`${BASE}/#/u/carol`);
  await A.page.reload();
  await A.page.waitForSelector('#user-name');
  check("an invite link opens that person's profile, already friends", (await A.page.locator('#user-name').innerText()) === 'Carol' && (await A.page.locator('#friend-badge').count()) === 1);
  await A.page.goto(`${BASE}/#/u/nobody_here`);
  await A.page.reload();
  await A.page.waitForSelector('#user-missing');
  check('a link to a username that does not exist says so', true);
  await A.page.goto(`${BASE}/#/u/matan_test`);
  await A.page.reload();
  await A.page.waitForSelector('#share-whatsapp');
  check('your own link opens your profile with the share buttons', (await A.page.locator('#user-handle').innerText()) === '@matan_test');
  await A.page.goto(`${BASE}/#/today`);
  await A.page.reload();
  await A.page.waitForSelector('.page-today');

  // ======== challenges: invite, accept, report, scoreboard, forfeit ========
  const dayKey = (n = 0) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  await A.page.goto(`${BASE}/#/u/carol`);
  await A.page.reload();
  await A.page.waitForSelector('#friend-challenge');
  check("a friend's profile offers a challenge", true);
  await A.page.click('#friend-challenge');
  await A.page.waitForSelector('#challenge-sheet');
  await A.page.click('#challenge-sheet [data-days="14"]');
  await A.page.click('#challenge-more');
  const maxShown = await A.page.locator('#challenge-max').innerText();
  await A.page.screenshot({ path: path.join(SHOTS, 'c09-challenge-sheet.png') });
  await A.page.click('#challenge-send');
  await until(() => fake.challenges.length === 1);
  const sent = fake.challenges[0];
  check('sending creates one pending challenge with the chosen rules', sent && sent.status === 'pending' && sent.days === 14 && sent.max_misses === Number(maxShown.replace(/\D/g, '')) && sent.opponent === CAROL.user_id, JSON.stringify(sent));
  await A.page.waitForSelector('#friend-challenge-open');
  check('the profile now links to the open challenge instead of offering another', (await A.page.locator('#friend-challenge').count()) === 0);
  await A.page.click('#friend-challenge-open');
  await A.page.waitForSelector('#challenge-page');
  check('a pending challenge shows waiting and a cancel button', await A.page.locator('#challenge-waiting').isVisible() && await A.page.locator('#challenge-cancel').isVisible());
  await A.page.screenshot({ path: path.join(SHOTS, 'c10-challenge-pending.png'), fullPage: true });
  await A.page.click('#challenge-cancel');
  await until(() => fake.challenges[0].status === 'cancelled');
  check('cancelling is recorded on the server', fake.challenges[0].status === 'cancelled');

  // Carol invites; accept from the inbox.
  const carolCh = { id: '00000000-0000-4000-8000-0000000000c1', creator: CAROL.user_id, opponent: USER.id, status: 'pending', days: 7, max_misses: 3, start_date: null, end_date: null, loser: null, result: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), finished_at: null };
  fake.challenges.unshift(carolCh);
  await A.page.goto(`${BASE}/#/today`);
  await A.page.reload();
  await A.page.waitForSelector('.page-today');
  await until(async () => (await A.page.locator('.bell-badge').count()) === 1 && await A.page.locator('.bell-badge').isVisible());
  check('the bell counts a challenge invitation', await A.page.locator('.bell-badge').isVisible());
  await A.page.click('.bell, a[href="#/inbox"]');
  await A.page.waitForSelector('#tab-requests');
  await A.page.click('#tab-requests');
  await A.page.waitForSelector('#challenge-invites [data-act="accept-challenge"]');
  await A.page.screenshot({ path: path.join(SHOTS, 'c11-challenge-invite.png') });
  await A.page.click('#challenge-invites [data-act="accept-challenge"]');
  await until(() => carolCh.status === 'active');
  check('accepting starts it tomorrow for the chosen number of days', carolCh.status === 'active' && carolCh.start_date === dayKey(1) && carolCh.end_date === dayKey(7), JSON.stringify(carolCh));

  // A running challenge: Today strip, page, scoreboard.
  Object.assign(carolCh, { start_date: dayKey(-1), end_date: dayKey(5), max_misses: 30 });
  fake.challengeDays.push({ challenge_id: carolCh.id, user_id: CAROL.user_id, day: dayKey(-1), planned: 3, logged: 1 });
  await A.page.goto(`${BASE}/#/today`);
  await A.page.reload();
  await A.page.waitForSelector('#challenge-strip [data-challenge]');
  check('Today shows a strip for the running challenge', (await A.page.locator('#challenge-strip [data-challenge]').count()) === 1);
  await A.page.screenshot({ path: path.join(SHOTS, 'c12-today-strip.png') });
  await until(() => fake.rpcCalls.some((r) => r.name === 'report_challenge_day'));
  check("this phone reports its own day to the server", fake.rpcCalls.some((r) => r.name === 'report_challenge_day' && r.args.p_id === carolCh.id));
  await A.page.click('#challenge-strip [data-challenge]');
  await A.page.waitForSelector('#scoreboard');
  check('the challenge page has a scoreboard, a day list and a forfeit button', await A.page.locator('#day-list').count() === 1 && await A.page.locator('#challenge-forfeit').isVisible());
  await A.page.screenshot({ path: path.join(SHOTS, 'c13-challenge-running.png'), fullPage: true });
  await A.page.goto(`${BASE}/#/profile`);
  await A.page.waitForSelector('#challenges-card');
  check('the profile lists the challenge and a record', (await A.page.locator('#challenge-list').innerText()).includes('Carol') && await A.page.locator('#my-record').count() === 1);
  await A.page.screenshot({ path: path.join(SHOTS, 'c14-profile-challenges.png'), fullPage: true });
  await A.page.goto(`${BASE}/#/challenge/${carolCh.id}`);
  await A.page.waitForSelector('#challenge-forfeit');
  await A.page.click('#challenge-forfeit');
  const confirmBtn = A.page.locator('.sheet .btn-danger, .sheet [data-confirm], .modal .btn-danger').first();
  if (await confirmBtn.count()) await confirmBtn.click();
  await until(() => carolCh.status === 'finished');
  check('giving up ends it as a loss for you and a win for them', carolCh.status === 'finished' && carolCh.loser === USER.id, JSON.stringify(carolCh));
  await A.page.waitForSelector('#challenge-result');
  await A.page.screenshot({ path: path.join(SHOTS, 'c15-challenge-lost.png'), fullPage: true });
  await A.page.goto(`${BASE}/#/today`);
  await A.page.reload();
  await A.page.waitForSelector('.page-today');

  // ======== device B: new phone, "sign in" on the first screen ========
  const B = await device('B');
  await B.page.goto(BASE + '/');
  await B.page.waitForSelector('#entry-login');
  await B.page.click('#entry-login');
  await B.page.waitForSelector('.page-today', { timeout: 15000 });
  check('new device opens straight on the restored plan', (await headText(B.page)).includes('מתנוש'));
  check('the eaten meal came along', (await B.page.locator('.meal.eaten, .meal .check-btn[aria-pressed="true"]').count()) >= 1);
  check('profile picture restored', (await B.page.locator('.head-avatar img').count()) === 1);
  await B.page.click('a[href="#/gallery"]');
  await B.page.waitForSelector('.page-gallery');
  check('progress photo restored from the backup', await until(async () => (await B.page.locator('.tile-img img').count()) >= 1));
  await B.page.screenshot({ path: path.join(SHOTS, 'c05-device-b-gallery.png') });

  // change on B, picked up by A
  await B.page.click('a[href="#/profile"]');
  await B.page.click('#btn-edit-details');
  await B.page.fill('#ed-nickname', 'מתי');
  await B.page.locator('.sheet .btn-primary').click();
  check('B\'s edit reaches the cloud', await until(() => fake.row.data.profile.nickname === 'מתי'));
  await A.page.reload();
  await A.page.waitForSelector('.page-today');
  check('A picks up the newer copy on the next open', await until(async () => (await headText(A.page)).includes('מתי')));

  // ======== device C: has its own data, signs in to the same account ========
  const C = await device('C');
  await C.page.goto(BASE + '/');
  await C.page.click('#entry-guest');
  await C.page.waitForSelector('#ob-next');
  await onboard(C.page, 'אחר');
  await C.page.click('a[href="#/profile"]');
  await C.page.click('#account-card #btn-google');
  await C.page.waitForSelector('#conflict', { timeout: 15000 });
  check('both sides have data: the user is asked which copy to keep, nothing overwritten yet', fake.row.data.profile.name === 'מתן');
  await C.page.screenshot({ path: path.join(SHOTS, 'c06-conflict.png') });
  await C.page.click('#keep-cloud');
  await C.page.waitForSelector('.profile-head');
  check('"load from the account" replaces this device\'s data', await until(async () => (await C.page.locator('.profile-head h1').innerText()) === 'מתי'));

  await C.page.click('#btn-signout');
  await C.page.click('#signout-keep');
  await C.page.waitForSelector('#account-card #btn-google');
  check('sign-out keeps the data on the device', (await C.page.locator('.profile-head h1').innerText()) === 'מתי');

  // ======== delete everything from A: device + cloud + account ========
  await A.page.click('a[href="#/profile"]');
  await A.page.click('#btn-delete-all');
  check('delete warns it also closes the cloud account', (await A.page.locator('.sheet').innerText()).includes('מהחשבון בענן'));
  await A.page.fill('#confirm-delete', 'מחק');
  await A.page.click('#confirm-delete-btn');
  await A.page.waitForSelector('#entry', { timeout: 15000 });
  check('delete removes the row, every file and the account', fake.row === null && fake.files.size === 0 && fake.deletedAccount);
  check('after deleting everything the first screen is back', await A.page.locator('#entry-signup').isVisible());

  // ======== "sign in" with an account that has no data / "create account" ========
  await A.page.click('#entry-login');
  await A.page.waitForSelector('#ob-next', { timeout: 15000 });
  check('signing in to an account without data starts a new plan, and says so', await until(async () => (await A.page.locator('#toast, .toast').allInnerTexts()).join().includes('לא נמצא חשבון עם נתונים')));
  check('a signed-in person is not asked to choose again, and has no "back to choices" button', (await A.page.locator('#entry-back').count()) === 0);

  const G = await device('G');
  await G.page.goto(BASE + '/');
  await G.page.click('#entry-signup');
  await G.page.waitForSelector('#ob-next', { timeout: 15000 });
  check('creating an account goes on to registration, and says the account was created', await until(async () => (await G.page.locator('#toast, .toast').allInnerTexts()).join().includes('החשבון נוצר')));
  await onboard(G.page, 'חדש');
  check('registration finished while signed in: the plan is uploaded to the new account', await until(() => fake.row && fake.row.data.profile.name === 'חדש'));

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  console.error(e);
  console.log('page errors:', pageErrors);
  for (const pg of browser.contexts().flatMap((c) => c.pages())) {
    await pg.screenshot({ path: path.join(SHOTS, `c-fail-${Math.random().toString(36).slice(2, 6)}.png`) }).catch(() => {});
    console.log('page text:', (await pg.locator('body').innerText().catch(() => '')).slice(0, 600));
  }
  check('run completed', false, e.message);
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
