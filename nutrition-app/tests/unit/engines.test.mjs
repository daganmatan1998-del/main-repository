import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { complete, engineList, hasEngine, extractJson, matchesSchema, __test, EngineError } from '../../server/engines.js';
import { handleApi } from '../../server/api.js';

beforeEach(() => __test.reset());

const KEYS = { GOOGLE_API_KEY: 'AIza-x', MISTRAL_API_KEY: 'mk', GROQ_API_KEY: 'gsk_x', CEREBRAS_API_KEY: 'csk-x', OPENROUTER_API_KEY: 'sk-or-x' };
const host = (u) => new URL(u).host;

// A fetch stub that answers per host: a string is the model's text, a number an HTTP error.
function net(table) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ host: host(url), body });
    let r = table[host(url)];
    if (Array.isArray(r)) r = r[Math.min(calls.filter((c) => c.host === host(url)).length - 1, r.length - 1)];
    if (typeof r === 'function') r = r(body);
    if (typeof r === 'number') return new Response('{}', { status: r });
    return new Response(JSON.stringify({ choices: [{ message: { content: r }, finish_reason: 'stop' }] }), { status: 200 });
  };
  return { calls, fetchImpl };
}
const CHAT = { system: 's', messages: [{ role: 'user', content: 'hi' }] };

test('every provider with a key becomes an engine; none without', () => {
  assert.deepEqual(engineList({}).map((e) => e.id), []);
  assert.deepEqual(engineList(KEYS).map((e) => e.id), ['google', 'mistral', 'groq', 'cerebras', 'openrouter']);
  assert.equal(engineList({ ...KEYS, ANTHROPIC_API_KEY: 'k' }).at(-1).id, 'anthropic');
  assert.deepEqual(engineList({ GITHUB_MODELS_TOKEN: 't', NVIDIA_API_KEY: 'n', XAI_API_KEY: 'x' }).map((e) => e.id).sort(), ['github', 'nvidia', 'xai']);
  assert.ok(engineList({ AI: { run() {} } }).some((e) => e.id === 'workers-ai'));
});

test('requests rotate across the free engines so every allowance gets used', async () => {
  const t = net({ 'generativelanguage.googleapis.com': 'g', 'api.mistral.ai': 'm', 'api.groq.com': 'q', 'api.cerebras.ai': 'c', 'openrouter.ai': 'o' });
  const used = new Set();
  for (let i = 0; i < 10; i++) used.add((await complete(KEYS, 'chat', CHAT, { fetchImpl: t.fetchImpl })).engine);
  assert.equal(used.size, 5, `only ${[...used]} were used`);
});

test('a provider that is out of quota rests and the request moves on', async () => {
  const t = net({ 'generativelanguage.googleapis.com': 429, 'api.groq.com': 'ok' });
  const env = { GOOGLE_API_KEY: 'a', GROQ_API_KEY: 'b', ENGINES_CHAT: 'google,groq' };
  const r = await complete(env, 'chat', CHAT, { fetchImpl: t.fetchImpl });
  assert.equal(r.engine, 'groq');
  assert.deepEqual(__test.resting(), ['google']);
  const before = t.calls.length;
  for (let i = 0; i < 4; i++) await complete(env, 'chat', CHAT, { fetchImpl: t.fetchImpl });
  assert.ok(t.calls.slice(before).every((c) => c.host === 'api.groq.com'), 'a resting provider is not tried again');
});

test('a request that is too big for one provider does not put it to rest', async () => {
  const t = net({ 'api.groq.com': 413, 'api.mistral.ai': 'ok' });
  const r = await complete({ GROQ_API_KEY: 'a', MISTRAL_API_KEY: 'b' }, 'chat', CHAT, { fetchImpl: t.fetchImpl });
  assert.equal(r.engine, 'mistral');
  assert.deepEqual(__test.resting(), []);
});

test('chat: Anthropic is the last resort and only runs when every free engine failed', async () => {
  const t = net({ 'api.groq.com': 500, 'api.mistral.ai': 500 });
  let paid = 0;
  const spec = { ...CHAT, anthropic: async () => { paid++; return { text: 'from claude' }; } };
  const env = { GROQ_API_KEY: 'a', MISTRAL_API_KEY: 'b', ANTHROPIC_API_KEY: 'c' };
  const r = await complete(env, 'chat', spec, { fetchImpl: t.fetchImpl });
  assert.deepEqual([r.engine, r.text, paid], ['anthropic', 'from claude', 1]);
  __test.reset();
  const ok = net({ 'api.groq.com': 'free answer' });
  const r2 = await complete({ ...env, MISTRAL_API_KEY: '' }, 'chat', spec, { fetchImpl: ok.fetchImpl });
  assert.deepEqual([r2.engine, paid], ['groq', 1], 'no credits spent while a free engine answers');
});

test('structured output: fenced or chatty JSON is accepted, the wrong shape moves on to the next engine', async () => {
  const schema = { type: 'object', properties: { ok: { type: 'boolean' }, items: { type: 'array', items: { type: 'object', properties: { grams: { type: 'number' } }, required: ['grams'] } } }, required: ['ok', 'items'] };
  const good = JSON.stringify({ ok: true, items: [{ grams: 5 }] });
  const t = net({ 'api.groq.com': 'Sure! ```json\n{"ok": true}\n```', 'api.mistral.ai': `Here you go:\n\`\`\`json\n${good}\n\`\`\`` });
  const r = await complete({ GROQ_API_KEY: 'a', MISTRAL_API_KEY: 'b' }, 'chat', { ...CHAT, json: true, schema }, { fetchImpl: t.fetchImpl });
  assert.deepEqual(JSON.parse(r.text), { ok: true, items: [{ grams: 5 }] });
  assert.equal(r.engine, 'mistral');
  assert.deepEqual(__test.resting(), [], 'a bad answer is not a reason to rest a provider');
  assert.equal(extractJson('<think>hmm {"a":1}</think>{"a":2}').a, 2);
  assert.equal(extractJson('no json here'), null);
  assert.equal(matchesSchema({ ok: 'yes', items: [] }, schema), false);
});

test('a provider that rejects response_format is asked again without it', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const b = JSON.parse(init.body);
    seen.push(!!b.response_format);
    if (b.response_format) return new Response('{}', { status: 400 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }] }), { status: 200 });
  };
  const r = await complete({ GROQ_API_KEY: 'a' }, 'chat', { ...CHAT, json: true, schema: { type: 'object' } }, { fetchImpl });
  assert.deepEqual(seen, [true, false]);
  assert.equal(r.engine, 'groq');
});

test('images only go to engines that can see them; for plates Anthropic is the last resort', async () => {
  const env = { ...KEYS, ANTHROPIC_API_KEY: 'k' };
  const order = __test.ordered(env, 'mealphoto', { image: true });
  assert.ok(!order.includes('cerebras'), 'text-only provider');
  assert.equal(order.at(-1), 'anthropic', 'tried only after every free engine');
  assert.ok(order.includes('google') && order.includes('groq'));
  assert.equal(hasEngine({ ANTHROPIC_API_KEY: 'k' }, 'mealphoto', { image: true }), true, 'Anthropic alone can serve it');
  assert.equal(hasEngine({ CEREBRAS_API_KEY: 'k' }, 'mealphoto', { image: true }), false);
  assert.equal(hasEngine({ ANTHROPIC_API_KEY: 'k', MEALPHOTO_ALLOW_ANTHROPIC: '0' }, 'mealphoto', { image: true }), false, 'the opt-out switch');
  assert.equal(hasEngine({ ANTHROPIC_API_KEY: 'k' }, 'chat'), true);
});

test('body fat is the other way round: Anthropic first, the free vision engines after', async () => {
  const env = { ...KEYS, ANTHROPIC_API_KEY: 'k' };
  const order = __test.ordered(env, 'bodyfat', { image: true });
  assert.equal(order[0], 'anthropic');
  assert.ok(order.includes('google') && order.includes('groq') && !order.includes('cerebras'));
  assert.deepEqual(__test.ordered({ GROQ_API_KEY: 'g' }, 'bodyfat', { image: true }), ['groq'], 'free engines alone can serve it');
  assert.equal(hasEngine({}, 'bodyfat', { image: true }), false);
});

test('an empty Anthropic balance sends the next requests straight to the free engines', async () => {
  const env = { GROQ_API_KEY: 'g', ANTHROPIC_API_KEY: 'k' };
  let anthropicCalls = 0;
  const spec = { system: 's', messages: [{ role: 'user', content: 'x' }], images: [{ label: 'front', data: 'QQ==' }], json: true, schema: { type: 'object' },
    anthropic: async () => { anthropicCalls += 1; const e = new Error('400 {"type":"error","error":{"message":"Your credit balance is too low to access the Anthropic API."}}'); e.status = 400; throw e; } };
  const t = net({ 'api.groq.com': '{"ok":true}' });
  const first = await complete(env, 'bodyfat', spec, { fetchImpl: t.fetchImpl });
  assert.equal(first.engine, 'groq');
  assert.equal(anthropicCalls, 1);
  const sent = t.calls[0].body.messages.at(-1).content;
  assert.deepEqual(sent.map((p) => p.type), ['text', 'image_url', 'text'], 'the photo, with its label, goes to the free engine');
  await complete(env, 'bodyfat', spec, { fetchImpl: t.fetchImpl });
  assert.equal(anthropicCalls, 1, 'Anthropic is resting, not asked again');
  assert.deepEqual(__test.ordered(env, 'bodyfat', { image: true }), ['groq', 'anthropic']);
});

test('ENGINES_<TASK> restricts which engines a task may use, in the order given', async () => {
  const order = __test.ordered({ ...KEYS, ENGINES_CHAT: 'groq,google' }, 'chat');
  assert.deepEqual(order, ['groq', 'google']);
});

test('Workers AI answers chat but is never used for structured output', async () => {
  const AI = { run: async () => ({ response: 'שלום מ-Workers AI' }) };
  const r = await complete({ AI }, 'chat', CHAT);
  assert.deepEqual([r.engine, r.text], ['workers-ai', 'שלום מ-Workers AI']);
  assert.equal(hasEngine({ AI }, 'mealphoto', { image: true }), false);
});

test('when everything fails the caller gets the last error, and the API answers 503 / 429', async () => {
  const t = net({ 'api.groq.com': 500 });
  await assert.rejects(complete({ GROQ_API_KEY: 'a' }, 'chat', CHAT, { fetchImpl: t.fetchImpl }), (e) => e instanceof EngineError && e.status === 500);
  __test.reset();
  const req = (b) => new Request('https://nutri.example/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.77' }, body: JSON.stringify(b) });
  const body = { messages: [{ role: 'user', content: 'שלום' }], context: {} };
  assert.equal((await handleApi(req(body), { GROQ_API_KEY: 'a' }, { fetchImpl: t.fetchImpl })).status, 503);
  __test.reset();
  const limited = net({ 'api.groq.com': 429 });
  assert.equal((await handleApi(req(body), { GROQ_API_KEY: 'a' }, { fetchImpl: limited.fetchImpl })).status, 429);
});

test('chat works with no Anthropic key at all, and never leaks a key', async () => {
  const t = net({ 'api.groq.com': 'תשובה קצרה' });
  const req = new Request('https://nutri.example/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.88' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'שלום' }], context: { x: 1 } }) });
  const res = await handleApi(req, { GROQ_API_KEY: 'gsk_secret' }, { fetchImpl: t.fetchImpl });
  const j = await res.json();
  assert.deepEqual([res.status, j.text, j.engine], [200, 'תשובה קצרה', 'groq']);
  assert.ok(!JSON.stringify(j).includes('gsk_secret'));
  assert.match(t.calls[0].body.messages[0].content, /USER CONTEXT/);
  const health = await (await handleApi(new Request('https://nutri.example/api/health'), { GROQ_API_KEY: 'gsk_secret' })).json();
  assert.deepEqual(health, { ok: true, configured: true, engines: ['groq'] });
});

test('body fat: with only free keys the estimate still works, marked as an alternative service with lower confidence', async () => {
  const out = { ok: true, estimate: 22.4, low: 19, high: 26, confidence: 'high', notes: 'x', issue: '' };
  const t = net({ 'api.groq.com': JSON.stringify(out) });
  const photos = ['front', 'left'].map((angle) => ({ angle, data: Buffer.from('x').toString('base64') }));
  const req = () => new Request('https://nutri.example/api/bodyfat', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.99' }, body: JSON.stringify({ photos, profile: { sex: 'male', bmiPriorPct: 19.6 } }) });
  const res = await handleApi(req(), { GROQ_API_KEY: 'gsk_x' }, { fetchImpl: t.fetchImpl });
  const j = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual([j.ok, j.estimate, j.confidence, j.alt], [true, 22.4, 'medium', true], 'a free engine is never "high"');
  const msg = t.calls[0].body.messages;
  assert.ok(!JSON.stringify(msg).includes('22.4') && !/"estimate":\s*\d/.test(msg[0].content), 'no example number in the prompt');
});

test('body fat: Anthropic out of credits falls back to the free engines in the same request', async () => {
  const out = { ok: true, estimate: 17.1, low: 14, high: 20, confidence: 'medium', notes: '', issue: '' };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(host(url));
    if (host(url) === 'api.anthropic.com') return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }), { status: 400, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) }, finish_reason: 'stop' }] }), { status: 200 });
  };
  const photos = ['front'].map((angle) => ({ angle, data: Buffer.from('x').toString('base64') }));
  const req = () => new Request('https://nutri.example/api/bodyfat', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.98' }, body: JSON.stringify({ photos, profile: {} }) });
  const j = await (await handleApi(req(), { ANTHROPIC_API_KEY: 'sk-ant-x', GROQ_API_KEY: 'gsk_x' }, { fetchImpl })).json();
  assert.deepEqual([j.ok, j.estimate, j.alt], [true, 17.1, true]);
  assert.equal(calls[0], 'api.anthropic.com', 'Anthropic was asked first');
  assert.ok(calls.includes('api.groq.com'));
});

test('a provider that rejects reasoning_effort is asked again without it, and not asked again later', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const b = JSON.parse(init.body);
    seen.push(b.reasoning_effort ? 'effort' : 'plain');
    if (b.reasoning_effort) return new Response('{}', { status: 400 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }] }), { status: 200 });
  };
  const spec = { ...CHAT, json: true, fast: true, schema: { type: 'object' } };
  await complete({ MISTRAL_API_KEY: 'a' }, 'chat', spec, { fetchImpl });
  await complete({ MISTRAL_API_KEY: 'a' }, 'chat', spec, { fetchImpl });
  assert.deepEqual(seen, ['effort', 'plain', 'plain'], 'the second request goes straight to the form it accepts');
});

test('an engine that takes too long goes to the back for a while', async () => {
  const realNow = Date.now;
  let t = realNow();
  Date.now = () => t;
  try {
    const fetchImpl = async (url) => {
      if (host(url) === 'api.groq.com') t += 40_000; // 40 s answer
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }), { status: 200 });
    };
    const env = { GROQ_API_KEY: 'a', MISTRAL_API_KEY: 'b', ENGINES_CHAT: '' };
    for (let i = 0; i < 6; i++) await complete(env, 'chat', CHAT, { fetchImpl });
    const next = [];
    for (let i = 0; i < 6; i++) next.push((await complete(env, 'chat', CHAT, { fetchImpl })).engine);
    assert.ok(next.every((e) => e === 'mistral'), `slow engine was still used: ${next}`);
    t += 11 * 60 * 1000;
    const later = new Set();
    for (let i = 0; i < 6; i++) later.add((await complete(env, 'chat', CHAT, { fetchImpl })).engine);
    assert.ok(later.has('groq'), 'it gets another chance after a while');
  } finally {
    Date.now = realNow;
  }
});
