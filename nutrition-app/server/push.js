// Daily reminders as Web Push, with no third-party service.
//
// How it works
//  - The app subscribes the device to push (the browser gives it an "endpoint",
//    a long private URL at the browser maker's push service) and sends the
//    endpoint here, with its time zone and which meals are already marked.
//  - A cron trigger (wrangler.toml, every 15 minutes) calls runReminders():
//    for each device whose local clock has just reached a reminder time, and
//    whose meal is not marked eaten, it sends an EMPTY push. The service
//    worker (www/sw.js) turns that into a notification, choosing the text
//    from the device's local time. An empty push needs no encryption, only a
//    VAPID signature (RFC 8292), which WebCrypto does.
//  - The VAPID key pair is made on first use and kept in KV, so there is no
//    secret to set up. The private key never leaves the Worker.
//
// Storage: one KV namespace (binding PUSH). Keys: `vapid`, `meta`, and one
// `sub:<time zone>:<hash of endpoint>` per device. The time zone is in the
// key so a run can tell which devices are near a reminder time without reading
// every record.
//
// Privacy: a record holds the endpoint, the time zone and four booleans
// (which meals are marked today) — no name, no food, no health data.

export const REMINDERS = [
  { id: 'morning', at: 9 * 60, kind: 'nudge' },
  { id: 'lunch', at: 13 * 60, kind: 'meal', meal: 'l' },
  { id: 'afternoon', at: 17 * 60, kind: 'nudge' },
  { id: 'dinner', at: 20 * 60, kind: 'meal', meal: 'd' },
];
// A reminder is sent when the local time is within this many minutes after it.
export const WINDOW_MIN = 30;
// A nudge (not tied to a meal) is skipped if the app was open this recently.
export const RECENT_OPEN_MS = 90 * 60 * 1000;

const DEFAULT_TZ = 'Asia/Jerusalem';
const MAX_BODY = 4 * 1024;
// Only the browser makers' own push services. The Worker POSTs to the
// endpoint it is given, so anything else would be a way to make it call
// arbitrary addresses.
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];

export const endpointAllowed = (endpoint) => {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:' || endpoint.length > 1000) return false;
    return PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch { return false; }
};

const validTz = (tz) => {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return typeof tz === 'string' && tz.length < 60 && !tz.includes(':'); } catch { return false; }
};

// { day: 'YYYY-MM-DD', minutes: since local midnight } in a time zone.
export function localTime(tz, now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const b64u = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const sha = async (text) => b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).slice(0, 32);

// ---------- VAPID ----------

export async function vapidKeys(kv) {
  const saved = await kv.get('vapid', 'json');
  if (saved) return saved;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const keys = {
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
    publicKey: b64u(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
  };
  await kv.put('vapid', JSON.stringify(keys));
  return (await kv.get('vapid', 'json')) || keys;
}

// The Authorization header for one push to `endpoint`.
export async function vapidHeader(keys, endpoint, subject, now = Date.now()) {
  const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })}`;
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned)));
  return `vapid t=${unsigned}.${b64u(sig)}, k=${keys.publicKey}`;
}

// ---------- records ----------

const subKey = async (tz, endpoint) => `sub:${tz}:${await sha(endpoint)}`;
const cleanState = (s, now) => {
  const done = (s && s.done) || {};
  return {
    day: typeof (s && s.day) === 'string' ? s.day.slice(0, 10) : '',
    done: { b: !!done.b, l: !!done.l, d: !!done.d, s: !!done.s },
    any: !!(s && s.any),
    ...(s && s.open ? { openAt: now } : {}),
  };
};

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export async function handlePush(request, env, now = Date.now()) {
  const kv = env.PUSH;
  const { pathname } = new URL(request.url);
  // Without the KV namespace the feature is simply off. The key route says so
  // with a normal answer (the app asks it before offering reminders).
  if (!kv) return pathname === '/api/push/key' ? json(200, { ready: false }) : json(503, { error: 'not_configured' });

  if (pathname === '/api/push/key' && request.method === 'GET') {
    return json(200, { publicKey: (await vapidKeys(kv)).publicKey });
  }
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const text = await request.text();
  if (text.length > MAX_BODY) return json(413, { error: 'too_large' });
  let body;
  try { body = JSON.parse(text); } catch { return json(400, { error: 'bad_json' }); }
  const endpoint = body && body.endpoint;
  if (!endpointAllowed(endpoint)) return json(400, { error: 'bad_endpoint' });

  if (pathname === '/api/push/subscribe') {
    const tz = validTz(body.tz) ? body.tz : DEFAULT_TZ;
    const key = await subKey(tz, endpoint);
    const old = await kv.get(key, 'json');
    const rec = { endpoint, tz, created: (old && old.created) || now, sent: (old && old.sent) || {}, state: cleanState(body.state, now) };
    await kv.put(key, JSON.stringify(rec));
    await kv.put('meta', JSON.stringify({ origin: new URL(request.url).origin }));
    return json(200, { ok: true });
  }

  // state / unsubscribe: find the record by endpoint (the time zone is part of its key).
  const tz = validTz(body.tz) ? body.tz : DEFAULT_TZ;
  const key = await subKey(tz, endpoint);
  if (pathname === '/api/push/unsubscribe') {
    await kv.delete(key);
    return json(200, { ok: true });
  }
  if (pathname === '/api/push/state') {
    const rec = await kv.get(key, 'json');
    if (!rec) return json(404, { error: 'unknown_subscription' });
    const lastOpen = rec.state && rec.state.openAt;
    rec.state = cleanState(body.state, now);
    if (!rec.state.openAt && lastOpen) rec.state.openAt = lastOpen;
    await kv.put(key, JSON.stringify(rec));
    return json(200, { ok: true });
  }
  return json(404, { error: 'not_found' });
}

// ---------- the cron run ----------

// Which reminder, if any, is due for a device at this local time.
export function dueReminder(local, rec, now) {
  for (const r of REMINDERS) {
    const since = local.minutes - r.at;
    if (since < 0 || since >= WINDOW_MIN) continue;
    if (rec.sent && rec.sent[r.id] === local.day) continue;
    const st = rec.state && rec.state.day === local.day ? rec.state : { done: {}, any: false };
    if (r.kind === 'meal' && st.done && st.done[r.meal]) continue;
    if (r.kind === 'nudge') {
      if (rec.state && rec.state.openAt && now - rec.state.openAt < RECENT_OPEN_MS) continue;
      if (r.id === 'morning' && st.any) continue;
      if (r.id === 'afternoon' && st.done && st.done.d) continue;
    }
    return r;
  }
  return null;
}

export async function runReminders(env, { now = Date.now(), fetchImpl = fetch } = {}) {
  const kv = env.PUSH;
  const stats = { checked: 0, sent: 0, removed: 0, failed: 0 };
  if (!kv) return stats;
  const keys = await vapidKeys(kv);
  const meta = (await kv.get('meta', 'json')) || {};
  const subject = meta.origin || 'https://example.com';
  const nearByTz = new Map();
  const near = (tz) => {
    if (!nearByTz.has(tz)) {
      const m = localTime(tz, now).minutes;
      nearByTz.set(tz, REMINDERS.some((r) => m - r.at >= 0 && m - r.at < WINDOW_MIN));
    }
    return nearByTz.get(tz);
  };
  let cursor;
  do {
    const page = await kv.list({ prefix: 'sub:', cursor });
    for (const { name } of page.keys) {
      const tz = name.split(':')[1];
      if (!validTz(tz) || !near(tz)) continue;
      const rec = await kv.get(name, 'json');
      if (!rec) continue;
      stats.checked += 1;
      const local = localTime(tz, now);
      const due = dueReminder(local, rec, now);
      if (!due) continue;
      let res;
      try {
        res = await fetchImpl(rec.endpoint, { method: 'POST', headers: { authorization: await vapidHeader(keys, rec.endpoint, subject, now), ttl: '3600', urgency: 'normal' } });
      } catch { stats.failed += 1; continue; }
      if (res.status === 404 || res.status === 410) { await kv.delete(name); stats.removed += 1; continue; }
      if (!res.ok) { stats.failed += 1; continue; }
      rec.sent = { [due.id]: local.day, ...Object.fromEntries(Object.entries(rec.sent || {}).filter(([, d]) => d === local.day)) };
      await kv.put(name, JSON.stringify(rec));
      stats.sent += 1;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return stats;
}

// An in-memory stand-in for the KV namespace (local dev and tests).
export function memoryKV() {
  const m = new Map();
  return {
    async get(key, type) { const v = m.get(key); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; },
    async put(key, value) { m.set(key, String(value)); },
    async delete(key) { m.delete(key); },
    async list({ prefix = '' } = {}) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
    _dump: () => new Map(m),
  };
}
