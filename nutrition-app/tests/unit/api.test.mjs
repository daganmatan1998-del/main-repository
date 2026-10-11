import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi, normalizeMessages } from '../../server/api.js';
import worker from '../../server/worker.js';

function stubAnthropic(reply = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'במקום 150 ג׳ אורז: - קינואה 160 ג׳' }] }, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
    return new Response(JSON.stringify(status === 200 ? { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 1 }, ...reply } : { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }), {
      status, headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetchImpl };
}

const req = (body, headers = {}) => new Request('https://nutri.example/api/chat', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const ENV = { ANTHROPIC_API_KEY: 'sk-ant-test-key' };
const good = { messages: [{ role: 'user', content: 'תחליף לאורז?' }], context: { restrictions: { kosher: true }, excludedFoods: ['טונה'] } };

test('normalizeMessages merges, trims and requires a final user turn', () => {
  assert.deepEqual(normalizeMessages([{ role: 'assistant', content: 'hi' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' }]),
    [{ role: 'user', content: 'a\n\nb' }]);
  assert.equal(normalizeMessages([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]), null);
  assert.equal(normalizeMessages([{ role: 'system', content: 'x' }]), null);
  assert.equal(normalizeMessages('nope'), null);
});

test('missing key -> not_configured, no upstream call', async () => {
  const { calls, fetchImpl } = stubAnthropic();
  const res = await handleApi(req(good), {}, { fetchImpl });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'not_configured');
  assert.equal(calls.length, 0);
});

test('happy path: key only on the server, model, fallbacks, effort, system prompt + context', async () => {
  const { calls, fetchImpl } = stubAnthropic();
  const res = await handleApi(req(good), ENV, { fetchImpl });
  assert.equal(res.status, 200);
  assert.match((await res.json()).text, /קינואה/);
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.match(c.url, /\/v1\/messages/);
  assert.equal(c.headers.get('x-api-key'), 'sk-ant-test-key');
  assert.match(c.headers.get('anthropic-beta'), /server-side-fallback-2026-07-01/);
  assert.equal(c.body.model, 'claude-opus-5-5');
  assert.equal(c.body.fallbacks, 'default');
  assert.equal(c.body.output_config.effort, 'low');
  assert.equal(c.body.thinking, undefined);
  assert.match(c.body.system[0].text, /Never suggest a food that violates/);
  assert.match(c.body.system[1].text, /טונה/);
  assert.deepEqual(c.body.messages, [{ role: 'user', content: 'תחליף לאורז?' }]);
});

test('refusal is turned into a polite reply', async () => {
  const { fetchImpl } = stubAnthropic({ stop_reason: 'refusal', content: [] });
  const res = await handleApi(req(good), ENV, { fetchImpl });
  const j = await res.json();
  assert.equal(res.status, 200);
  assert.ok(j.refusal);
});

test('upstream 429 -> rate_limited', async () => {
  const { fetchImpl } = stubAnthropic(undefined, 429);
  const res = await handleApi(req(good), ENV, { fetchImpl });
  assert.equal(res.status, 429);
});

test('validation: bad json, bad messages, oversized context, foreign origin, wrong method', async () => {
  const { fetchImpl, calls } = stubAnthropic();
  const bad = new Request('https://nutri.example/api/chat', { method: 'POST', body: '{nope' });
  assert.equal((await handleApi(bad, ENV, { fetchImpl })).status, 400);
  assert.equal((await handleApi(req({ messages: [] }), ENV, { fetchImpl })).status, 400);
  assert.equal((await handleApi(req({ ...good, context: { x: 'a'.repeat(30000) } }), ENV, { fetchImpl })).status, 413);
  assert.equal((await handleApi(req(good, { origin: 'https://evil.example' }), ENV, { fetchImpl })).status, 403);
  const ok = await handleApi(req(good, { origin: 'capacitor://localhost' }), { ...ENV, ALLOWED_ORIGINS: 'capacitor://localhost' }, { fetchImpl });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'capacitor://localhost');
  assert.equal((await handleApi(new Request('https://nutri.example/api/chat'), ENV, { fetchImpl })).status, 405);
  assert.equal(calls.length, 1);
});

test('per-IP limiter kicks in', async () => {
  const { fetchImpl } = stubAnthropic();
  let last;
  for (let i = 0; i < 35; i++) last = await handleApi(req(good, { 'cf-connecting-ip': '203.0.113.9' }), ENV, { fetchImpl });
  assert.equal(last.status, 429);
});

test('worker routes /api to the handler and the rest to static assets', async () => {
  const env = { ...ENV, ASSETS: { fetch: async () => new Response('asset') } };
  assert.equal(await (await worker.fetch(new Request('https://nutri.example/index.html'), env)).text(), 'asset');
  const health = await worker.fetch(new Request('https://nutri.example/api/health'), env);
  assert.deepEqual(await health.json(), { ok: true, configured: true, engines: ['anthropic'] });
});

// ---------- /api/bodyfat ----------
const PHOTO = Buffer.from('fake-jpeg-bytes').toString('base64');
const bfReq = (body, headers = {}) => new Request('https://nutri.example/api/bodyfat', {
  method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 200)}`, ...headers }, body: JSON.stringify(body),
});
const bfBody = {
  photos: ['front', 'left', 'back', 'right'].map((angle) => ({ angle, data: PHOTO })),
  profile: { sex: 'male', age: 30, heightCm: 180, weightKg: 82, bmiPriorPct: 19.6 },
};

test('bodyfat: sends all four photos as images with a JSON schema and returns a clamped estimate', async () => {
  const { calls, fetchImpl } = stubAnthropic({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ok: true, estimate: 21.5, low: 18, high: 25, confidence: 'medium', notes: 'קווי מותן רכים.', issue: '' }) }] });
  const res = await handleApi(bfReq(bfBody), ENV, { fetchImpl });
  const j = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual([j.ok, j.estimate, j.low, j.high, j.confidence], [true, 21.5, 18, 25, 'medium']);
  const body = calls[0].body;
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(body.messages[0].content.filter((b) => b.type === 'image').length, 4);
  assert.match(body.system, /body fat/);
  assert.match(body.messages[0].content.at(-1).text, /bmiPriorPct/);
});

test('bodyfat: unsuitable photos and refusals come back as ok=false with a reason', async () => {
  let { fetchImpl } = stubAnthropic({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ok: false, estimate: 0, low: 0, high: 0, confidence: 'low', notes: '', issue: 'לא רואים את כל הגוף.' }) }] });
  let j = await (await handleApi(bfReq(bfBody), ENV, { fetchImpl })).json();
  assert.equal(j.ok, false);
  assert.match(j.issue, /הגוף/);
  ({ fetchImpl } = stubAnthropic({ stop_reason: 'refusal', content: [] }));
  j = await (await handleApi(bfReq(bfBody), ENV, { fetchImpl })).json();
  assert.equal(j.ok, false);
});

test('bodyfat: rejects bad input before calling the model', async () => {
  const { calls, fetchImpl } = stubAnthropic();
  for (const body of [
    { photos: [] },
    { photos: [{ angle: 'top', data: PHOTO }] },
    { photos: [{ angle: 'front', data: '<script>' }] },
    { photos: [{ angle: 'front', data: 'A'.repeat(1000 * 1024) }] },
    { photos: Array(5).fill({ angle: 'front', data: PHOTO }) },
  ]) {
    assert.equal((await handleApi(bfReq(body), ENV, { fetchImpl })).status, 400);
  }
  assert.equal(calls.length, 0);
  assert.equal((await handleApi(bfReq(bfBody), {}, { fetchImpl })).status, 503);
});

// ---------- /api/meal-photo ----------
const mpReq = (body) => new Request('https://nutri.example/api/meal-photo', {
  method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `203.0.113.${Math.floor(Math.random() * 200)}` }, body: JSON.stringify(body),
});
const mpBody = {
  photo: PHOTO,
  meal: 'ארוחת צהריים',
  planned: [{ name: 'חזה עוף צלוי', grams: 150 }, { name: 'אורז לבן מבושל', grams: 180 }],
  foods: [{ id: 'chicken_breast', name: 'חזה עוף צלוי' }, { id: 'white_rice', name: 'אורז לבן מבושל' }, { id: 'bad id!', name: 'x' }],
};
const mpItem = (o) => ({ name: 'x', grams: 100, kcal: 100, p: 1, c: 1, f: 1, foodId: '', confidence: 'medium', ...o });

// Free engines speak the OpenAI chat format. `replies` is a list (one per call) of
// a JSON object (answered as the model's text), a number (an HTTP error) or a function.
function stubFree(replies) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), headers: new Headers(init.headers), body });
    let r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (typeof r === 'function') r = r(body, String(url));
    if (typeof r === 'number') return new Response(JSON.stringify({ error: { message: 'nope' } }), { status: r, headers: { 'content-type': 'application/json' } });
    const text = typeof r === 'string' ? r : JSON.stringify(r);
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}
const FREE_ENV = { ANTHROPIC_API_KEY: 'sk-ant-test-key', GROQ_API_KEY: 'gsk_test' };

test('meal-photo: sends the photo with the plan and food list to a free engine and returns cleaned items', async () => {
  const out = {
    ok: true, confidence: 'high', notes: 'השמן בטיגון מוערך.', issue: '',
    items: [
      mpItem({ name: 'חזה עוף', grams: 160, kcal: 264, p: 49.6, c: 0, f: 5.8, foodId: 'chicken_breast', confidence: 'high' }),
      mpItem({ name: 'רוטב טחינה', grams: 30, kcal: 180, p: 5, c: 6, f: 16, foodId: 'made_up_id' }),
      mpItem({ name: 'שמן (בבישול)', grams: 99999, kcal: 99999 }),
      mpItem({ name: 'קלוריות לא תואמות', grams: 50, kcal: 900, p: 1, c: 1, f: 1 }),
      mpItem({ name: '', grams: 50 }),
      mpItem({ name: 'אוויר', grams: 0 }),
    ],
  };
  const { calls, fetchImpl } = stubFree([out]);
  const res = await handleApi(mpReq(mpBody), FREE_ENV, { fetchImpl });
  const j = await res.json();
  assert.equal(res.status, 200);
  assert.equal(j.ok, true);
  assert.equal(j.engine, 'groq');
  assert.equal(j.confidence, 'medium', 'a free engine never reports "high"');
  assert.deepEqual(j.items.map((i) => i.name), ['חזה עוף', 'רוטב טחינה', 'שמן (בבישול)', 'קלוריות לא תואמות']);
  assert.equal(j.items[0].foodId, 'chicken_breast');
  assert.equal(j.items[1].foodId, '', 'unknown ids are dropped');
  assert.ok(j.items[2].grams <= 3000 && j.items[2].kcal <= 5000, 'values are clamped');
  assert.ok(j.items[3].kcal < 900 && j.items[3].confidence === 'low', 'calories that contradict the macros are pulled toward them and flagged');
  const c = calls[0];
  assert.match(c.url, /api\.groq\.com/);
  assert.equal(c.headers.get('authorization'), 'Bearer gsk_test');
  assert.match(c.body.model, /llama-4|scout/i, 'the vision model, not the text model');
  assert.equal(c.body.response_format.type, 'json_object');
  assert.equal(c.body.messages[0].role, 'system');
  assert.match(c.body.messages[0].content, /JSON Schema/);
  const user = c.body.messages[1].content;
  assert.equal(user[0].type, 'image_url');
  assert.match(user[0].image_url.url, /^data:image\/jpeg;base64,/);
  assert.match(user[1].text, /חזה עוף צלוי/);
  assert.ok(!user[1].text.includes('bad id!'), 'invalid food ids never reach the model');
});

test('meal-photo: never uses Anthropic unless explicitly allowed', async () => {
  const anth = stubAnthropic({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ok: true, confidence: 'high', notes: '', issue: '', items: [mpItem({ name: 'עוף', grams: 100 })] }) }] });
  // Only an Anthropic key: the camera is simply not available.
  let res = await handleApi(mpReq(mpBody), { ANTHROPIC_API_KEY: 'sk-ant-x' }, { fetchImpl: anth.fetchImpl });
  assert.equal(res.status, 503);
  assert.equal(anth.calls.length, 0);
  // Free engines all down: it fails rather than falling back to the paid engine.
  const free = stubFree([503]);
  const both = async (url, init) => (String(url).includes('anthropic') ? anth.fetchImpl(url, init) : free.fetchImpl(url, init));
  res = await handleApi(mpReq(mpBody), FREE_ENV, { fetchImpl: both });
  assert.equal(res.status, 503);
  assert.equal(anth.calls.length, 0, 'no Anthropic credits spent');
  // The opt-in switch.
  res = await handleApi(mpReq(mpBody), { ...FREE_ENV, MEALPHOTO_ALLOW_ANTHROPIC: '1' }, { fetchImpl: both });
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.engine, 'anthropic');
  assert.equal(anth.calls.length, 1);
});

test('meal-photo: no food, refusals and bad input', async () => {
  let { fetchImpl } = stubFree([{ ok: false, items: [], confidence: 'low', notes: '', issue: 'התמונה חשוכה מדי.' }]);
  let j = await (await handleApi(mpReq(mpBody), FREE_ENV, { fetchImpl })).json();
  assert.deepEqual([j.ok, j.issue], [false, 'התמונה חשוכה מדי.']);
  ({ fetchImpl } = stubFree([{ ok: true, items: [], confidence: 'low', notes: '', issue: '' }]));
  j = await (await handleApi(mpReq(mpBody), FREE_ENV, { fetchImpl })).json();
  assert.equal(j.ok, false);
  const stub = stubFree(['{}']);
  for (const body of [{}, { photo: '<img>' }, { photo: 'A'.repeat(1000 * 1024) }]) {
    assert.equal((await handleApi(mpReq(body), FREE_ENV, { fetchImpl: stub.fetchImpl })).status, 400);
  }
  assert.equal(stub.calls.length, 0);
});
