import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlePush, runReminders, localTime, dueReminder, memoryKV, endpointAllowed, vapidKeys, REMINDERS } from '../../server/push.js';

const EP = 'https://fcm.googleapis.com/fcm/send/abc123';
const EP2 = 'https://web.push.apple.com/QWERTY';
const req = (path, body, method = 'POST') => new Request(`https://nutri.example.dev${path}`, { method, body: method === 'GET' ? undefined : JSON.stringify(body) });
const post = (env, path, body, now) => handlePush(req(path, body), env, now);

// 2026-10-12 is Monday, Israel is on summer time (UTC+3) until 2026-10-25.
const at = (iso) => Date.parse(iso);
const il = (hhmm) => at(`2026-10-12T${hhmm}:00+03:00`);

test('only the browser makers\' push services are accepted', () => {
  assert.ok(endpointAllowed(EP) && endpointAllowed(EP2) && endpointAllowed('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert.ok(endpointAllowed('https://wns2-par02p.notify.windows.com/w/?token=1'));
  assert.ok(!endpointAllowed('https://evil.example.com/x') && !endpointAllowed('http://fcm.googleapis.com/x') && !endpointAllowed('https://fcm.googleapis.com.evil.com/x') && !endpointAllowed('not a url'));
});

test('local time follows the time zone, including the clock change', () => {
  assert.deepEqual(localTime('Asia/Jerusalem', at('2026-10-12T10:00:00Z')), { day: '2026-10-12', minutes: 13 * 60 });
  assert.deepEqual(localTime('Asia/Jerusalem', at('2026-11-12T11:00:00Z')), { day: '2026-11-12', minutes: 13 * 60 }, 'winter: UTC+2');
  assert.equal(localTime('Asia/Jerusalem', at('2026-10-12T21:30:00Z')).day, '2026-10-13', 'past midnight is the next day');
});

test('the VAPID key is made once and the public key is served', async () => {
  const env = { PUSH: memoryKV() };
  const a = await (await handlePush(req('/api/push/key', null, 'GET'), env)).json();
  const b = await (await handlePush(req('/api/push/key', null, 'GET'), env)).json();
  assert.equal(a.publicKey, b.publicKey);
  assert.equal(Buffer.from(a.publicKey, 'base64url').length, 65, 'an uncompressed P-256 point');
  assert.deepEqual(await (await handlePush(req('/api/push/key', null, 'GET'), {})).json(), { ready: false }, 'no KV: reminders are off');
  assert.equal((await post({}, '/api/push/subscribe', { endpoint: EP })).status, 503);
});

test('subscribe validates the endpoint and the size', async () => {
  const env = { PUSH: memoryKV() };
  assert.equal((await post(env, '/api/push/subscribe', { endpoint: 'https://evil.example/x', tz: 'Asia/Jerusalem' })).status, 400);
  assert.equal((await handlePush(new Request('https://nutri.example.dev/api/push/subscribe', { method: 'POST', body: 'x'.repeat(5000) }), env)).status, 413);
  assert.equal((await post(env, '/api/push/subscribe', { endpoint: EP, tz: 'Asia/Jerusalem' })).status, 200);
  assert.equal((await post(env, '/api/push/state', { endpoint: EP2, tz: 'Asia/Jerusalem', state: {} })).status, 404, 'unknown device');
});

// A device with a fake push service: records every push it is sent.
async function setup(state, tz = 'Asia/Jerusalem') {
  const env = { PUSH: memoryKV() };
  await post(env, '/api/push/subscribe', { endpoint: EP, tz, state }, il('08:00'));
  const pushes = [];
  const fetchImpl = async (url, init) => { pushes.push({ url, headers: init.headers }); return new Response(null, { status: 201 }); };
  return { env, pushes, fetchImpl, run: (time) => runReminders(env, { now: time, fetchImpl }) };
}

test('lunch at 13:00 local if the meal isn\'t marked; once a day', async () => {
  const s = await setup({ day: '2026-10-12', done: { b: true }, any: true });
  assert.equal((await s.run(il('12:45'))).sent, 0, 'not yet');
  assert.equal((await s.run(il('13:00'))).sent, 1);
  assert.equal((await s.run(il('13:15'))).sent, 0, 'the next cron run in the window does not repeat it');
  assert.equal(s.pushes.length, 1);
  assert.equal(s.pushes[0].url, EP);
});

test('a marked lunch is not reminded', async () => {
  const s = await setup({ day: '2026-10-12', done: { l: true }, any: true });
  assert.equal((await s.run(il('13:00'))).sent, 0);
  // the same flag from yesterday doesn't count
  const t = await setup({ day: '2026-10-11', done: { l: true }, any: true });
  assert.equal((await t.run(il('13:00'))).sent, 1);
});

test('dinner at 20:00 unless marked; the afternoon nudge is skipped once dinner is done', async () => {
  const s = await setup({ day: '2026-10-12', done: { l: true }, any: true });
  assert.equal((await s.run(il('20:00'))).sent, 1);
  const done = await setup({ day: '2026-10-12', done: { d: true }, any: true });
  assert.equal((await done.run(il('20:00'))).sent, 0);
  assert.equal((await done.run(il('17:00'))).sent, 0);
});

test('nudges: morning only if nothing is logged yet, none right after the app was open', async () => {
  const fresh = await setup({ day: '2026-10-12', done: {}, any: false });
  assert.equal((await fresh.run(il('09:00'))).sent, 1);
  const busy = await setup({ day: '2026-10-12', done: { b: true }, any: true });
  assert.equal((await busy.run(il('09:00'))).sent, 0);
  const s = await setup({ day: '2026-10-12', done: {}, any: false });
  await post(s.env, '/api/push/state', { endpoint: EP, tz: 'Asia/Jerusalem', state: { day: '2026-10-12', done: {}, any: false, open: true } }, il('16:20'));
  assert.equal((await s.run(il('17:00'))).sent, 0, 'opened 40 minutes ago');
  assert.equal((await s.run(il('17:10'))).sent, 0);
});

test('the four reminders are the ones asked for', () => {
  assert.deepEqual(REMINDERS.map((r) => [r.id, r.at / 60]), [['morning', 9], ['lunch', 13], ['afternoon', 17], ['dinner', 20]]);
});

test('each device is judged by its own clock', async () => {
  const s = await setup({ day: '2026-10-12', done: {}, any: false }, 'America/New_York');
  assert.equal((await s.run(il('13:00'))).sent, 0, '13:00 in Israel is 06:00 in New York');
  assert.equal((await s.run(at('2026-10-12T17:00:00Z'))).sent, 1, '13:00 in New York');
});

test('a push service that says the device is gone removes it; a failure is retried', async () => {
  const env = { PUSH: memoryKV() };
  await post(env, '/api/push/subscribe', { endpoint: EP, tz: 'Asia/Jerusalem', state: { day: '2026-10-12', done: {}, any: true } });
  const gone = await runReminders(env, { now: il('13:00'), fetchImpl: async () => new Response(null, { status: 410 }) });
  assert.equal(gone.removed, 1);
  assert.equal([...env.PUSH._dump().keys()].filter((k) => k.startsWith('sub:')).length, 0);
  await post(env, '/api/push/subscribe', { endpoint: EP, tz: 'Asia/Jerusalem', state: { day: '2026-10-12', done: {}, any: true } });
  const down = await runReminders(env, { now: il('13:00'), fetchImpl: async () => new Response(null, { status: 503 }) });
  assert.equal(down.failed, 1);
  const retry = await runReminders(env, { now: il('13:15'), fetchImpl: async () => new Response(null, { status: 201 }) });
  assert.equal(retry.sent, 1, 'not marked as sent, so the next run tries again');
});

test('the push carries a valid VAPID signature for the push service', async () => {
  const s = await setup({ day: '2026-10-12', done: {}, any: true });
  await s.run(il('13:00'));
  const auth = s.pushes[0].headers.authorization;
  const m = auth.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
  assert.ok(m, auth);
  const [, h, p, sig, k] = m;
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'https://nutri.example.dev');
  assert.ok(claims.exp * 1000 > il('13:00') && claims.exp * 1000 <= il('13:00') + 24 * 3600 * 1000);
  const pub = await crypto.subtle.importKey('raw', Buffer.from(k, 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, Buffer.from(sig, 'base64url'), new TextEncoder().encode(`${h}.${p}`));
  assert.ok(ok, 'the signature verifies with the published public key');
  assert.equal(k, (await vapidKeys(s.env.PUSH)).publicKey);
});

test('unsubscribe removes the device', async () => {
  const s = await setup({ day: '2026-10-12', done: {}, any: true });
  await post(s.env, '/api/push/unsubscribe', { endpoint: EP, tz: 'Asia/Jerusalem' });
  assert.equal((await s.run(il('13:00'))).sent, 0);
});

test('dueReminder needs no state for a brand-new device', () => {
  assert.equal(dueReminder({ day: '2026-10-12', minutes: 13 * 60 + 5 }, { sent: {} }, il('13:05')).id, 'lunch');
});

test('the service worker\'s reminder table matches the server\'s', async () => {
  const { readFileSync } = await import('node:fs');
  const sw = readFileSync(new URL('../../www/sw.js', import.meta.url), 'utf8');
  const table = new Function(`${sw.match(/const REMINDERS = \[[\s\S]*?\n\];/)[0]}; return REMINDERS;`)();
  assert.deepEqual(table.map((r) => [r.id, r.at]), REMINDERS.map((r) => [r.id, r.at]));
  // every language has a title and a body for every reminder and the weekly photo
  const NOTIFY = new Function(`${sw.match(/const NOTIFY = \{[\s\S]*?\n\};/)[0]}; return NOTIFY;`)();
  const ids = [...table.map((r) => r.id), 'weekly'];
  assert.ok(NOTIFY.en && NOTIFY.he);
  for (const [code, texts] of Object.entries(NOTIFY)) {
    for (const id of ids) assert.ok(texts[id] && texts[id][0] && texts[id][1], `${code}/${id}`);
    assert.ok(texts.weekly[1].includes('{0}'), `${code}: the weekly text carries the week number`);
  }
  assert.match(NOTIFY.he.lunch[1], /ארוחת הצהריים/);
  assert.match(NOTIFY.he.dinner[1], /ארוחת הערב/);
  assert.match(NOTIFY.en.lunch[1], /lunch/);
  // which text a device shows at which hour
  const pick = new Function(`${sw.match(/function pickReminder\(date\) \{[\s\S]*?\n\}/)[0]}; const REMINDERS = ${sw.match(/const REMINDERS = (\[[\s\S]*?\n\]);/)[1]}; return (h, m) => pickReminder({ getHours: () => h, getMinutes: () => m }).id;`)();
  assert.equal(pick(8, 0), 'morning');
  assert.equal(pick(13, 0), 'lunch');
  assert.equal(pick(13, 29), 'lunch');
  assert.equal(pick(17, 5), 'afternoon');
  assert.equal(pick(20, 10), 'dinner');
  assert.equal(pick(23, 0), 'dinner');
});
