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
  assert.deepEqual(await health.json(), { ok: true, configured: true });
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
