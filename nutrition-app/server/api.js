// /api/chat — the only server endpoint. Runs unchanged on Cloudflare Workers
// (server/worker.js) and on Node (server/dev-server.mjs).
//
// The Anthropic API key exists only here, as the ANTHROPIC_API_KEY secret.
// The browser never sees it.

import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, BODYFAT_PROMPT } from './system-prompt.js';

const MODEL = 'claude-opus-5-5';
const MAX_BODY = 64 * 1024;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4000;
const MAX_CONTEXT_CHARS = 20000;
const MAX_PHOTO_BODY = 4 * 1024 * 1024; // four compressed photos, base64
const MAX_PHOTO_B64 = 900 * 1024;
const ANGLES = { front: 'מקדימה', left: 'צד שמאל', back: 'מאחור', right: 'צד ימין' };

// Best-effort per-instance limiter. For production on Cloudflare, also bind the
// Workers Rate Limiting API as RATE_LIMITER (see wrangler.toml) — it is used
// automatically when present.
const WINDOW_MS = 10 * 60 * 1000;
const WINDOW_MAX = 30;
const hits = new Map();

function localLimit(key, now = Date.now()) {
  const list = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= WINDOW_MAX) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return true;
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  const list = allowedOrigins(env);
  if (origin && list.includes(origin)) {
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      vary: 'origin',
    };
  }
  return {};
}

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

// Same-origin requests always pass. Cross-origin ones (another host, or a
// Capacitor app) only when listed in ALLOWED_ORIGINS.
function originAllowed(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  if (origin === new URL(request.url).origin) return true;
  return allowedOrigins(env).includes(origin);
}

// The API needs strictly alternating turns starting with the user.
export function normalizeMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const m of raw.slice(-MAX_MESSAGES)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return null;
    const content = m.content.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${content}`;
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (!out.length || out[out.length - 1].role !== 'user') return null;
  return out;
}

// Shared front door for every endpoint: CORS, method, origin, key, rate
// limit, size limit and JSON parsing. Returns { res } to send back as-is, or
// { body, cors } to continue with.
async function admit(request, env, maxBody) {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return { res: new Response(null, { status: 204, headers: cors }) };
  if (request.method !== 'POST') return { res: json(405, { error: 'method_not_allowed' }, cors) };
  if (!originAllowed(request, env)) return { res: json(403, { error: 'forbidden_origin' }) };

  if (!env.ANTHROPIC_API_KEY) {
    return { res: json(503, { error: 'not_configured', message: 'ANTHROPIC_API_KEY is not set on the server.' }, cors) };
  }

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'local';
  if (env.RATE_LIMITER) {
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) return { res: json(429, { error: 'rate_limited' }, cors) };
  } else if (!localLimit(ip)) {
    return { res: json(429, { error: 'rate_limited' }, cors) };
  }

  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBody) return { res: json(413, { error: 'too_large' }, cors) };
  try {
    const text = await request.text();
    if (text.length > maxBody) return { res: json(413, { error: 'too_large' }, cors) };
    return { body: JSON.parse(text), cors };
  } catch {
    return { res: json(400, { error: 'bad_json' }, cors) };
  }
}

function clientFor(env, fetchImpl) {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 55_000, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}

function upstreamError(e, cors) {
  if (e instanceof Anthropic.RateLimitError) return json(429, { error: 'rate_limited' }, cors);
  if (e instanceof Anthropic.AuthenticationError) {
    console.error('Anthropic auth failed — check ANTHROPIC_API_KEY');
    return json(503, { error: 'not_configured', message: 'The server API key was rejected.' }, cors);
  }
  if (e instanceof Anthropic.BadRequestError) {
    console.error('Anthropic bad request', e.message);
    return json(502, { error: 'upstream_bad_request' }, cors);
  }
  if (e instanceof Anthropic.APIConnectionError) return json(502, { error: 'upstream_unreachable' }, cors);
  if (e instanceof Anthropic.APIError) {
    console.error('Anthropic API error', e.status, e.message);
    return json(e.status === 529 ? 503 : 502, { error: 'upstream_error' }, cors);
  }
  console.error(e);
  return json(500, { error: 'server_error' }, cors);
}

export async function handleChat(request, env, { fetchImpl } = {}) {
  const gate = await admit(request, env, MAX_BODY);
  if (gate.res) return gate.res;
  const { body, cors } = gate;

  const messages = normalizeMessages(body.messages);
  if (!messages) return json(400, { error: 'bad_messages' }, cors);
  const context = JSON.stringify(body.context ?? {});
  if (context.length > MAX_CONTEXT_CHARS) return json(413, { error: 'context_too_large' }, cors);

  const client = clientFor(env, fetchImpl);

  try {
    const response = await client.beta.messages.create({
      model: env.CLAUDE_MODEL || MODEL,
      max_tokens: 4000,
      // Chat replies are short and routine: low effort keeps them fast and cheap.
      output_config: { effort: 'low' },
      // If a request is declined by a safety classifier, the API retries it on
      // Anthropic's recommended fallback model instead of failing.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [
        { type: 'text', text: SYSTEM_PROMPT },
        { type: 'text', text: `USER CONTEXT (JSON, from the app):\n${context}` },
      ],
      messages,
    });

    if (response.stop_reason === 'refusal') {
      return json(200, { text: 'לא אוכל לעזור בשאלה הזו. אפשר לשאול על התפריט, תחליפים ומזון.', refusal: true }, cors);
    }
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!text) return json(502, { error: 'empty_reply' }, cors);
    return json(200, { text, truncated: response.stop_reason === 'max_tokens' }, cors);
  } catch (e) {
    return upstreamError(e, cors);
  }
}

const BODYFAT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    estimate: { type: 'number' },
    low: { type: 'number' },
    high: { type: 'number' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    notes: { type: 'string' },
    issue: { type: 'string' },
  },
  required: ['ok', 'estimate', 'low', 'high', 'confidence', 'notes', 'issue'],
  additionalProperties: false,
};

// /api/bodyfat — visual body-fat estimate from up to four photos (front,
// left, back, right). Photos are forwarded to Claude and never stored here.
export async function handleBodyFat(request, env, { fetchImpl } = {}) {
  const gate = await admit(request, env, MAX_PHOTO_BODY);
  if (gate.res) return gate.res;
  const { body, cors } = gate;

  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (photos.length < 1 || photos.length > 4) return json(400, { error: 'bad_photos' }, cors);
  for (const ph of photos) {
    if (!ph || !ANGLES[ph.angle] || typeof ph.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(ph.data) || ph.data.length > MAX_PHOTO_B64) {
      return json(400, { error: 'bad_photos' }, cors);
    }
  }
  const p = body.profile || {};
  const num = (v, lo, hi) => (typeof v === 'number' && v >= lo && v <= hi ? v : null);
  const profile = {
    sex: p.sex === 'female' ? 'female' : 'male',
    age: num(p.age, 10, 100),
    heightCm: num(p.heightCm, 100, 250),
    weightKg: num(p.weightKg, 25, 350),
    bmiPriorPct: num(p.bmiPriorPct, 2, 70),
  };

  const content = [];
  for (const ph of photos) {
    content.push({ type: 'text', text: `Photo — ${ph.angle}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: ph.data } });
  }
  content.push({ type: 'text', text: `Person (self-reported): ${JSON.stringify(profile)}\nEstimate body fat percentage. Reply with the JSON object only.` });

  try {
    const response = await clientFor(env, fetchImpl).beta.messages.create({
      model: env.CLAUDE_MODEL || MODEL,
      max_tokens: 3000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: BODYFAT_SCHEMA } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: BODYFAT_PROMPT,
      messages: [{ role: 'user', content }],
    });
    if (response.stop_reason === 'refusal') {
      return json(200, { ok: false, issue: 'לא ניתן לנתח את התמונות האלה. נסו תמונות אחרות או הזינו ערך ידנית.' }, cors);
    }
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let out;
    try { out = JSON.parse(text); } catch { return json(502, { error: 'bad_model_output' }, cors); }
    if (!out.ok) return json(200, { ok: false, issue: String(out.issue || 'התמונות לא מתאימות לניתוח.').slice(0, 300) }, cors);
    const clampPct = (v) => Math.round(Math.min(60, Math.max(3, Number(v) || 0)) * 10) / 10;
    const estimate = clampPct(out.estimate);
    const low = Math.min(estimate, clampPct(out.low));
    const high = Math.max(estimate, clampPct(out.high));
    return json(200, {
      ok: true,
      estimate,
      low,
      high,
      confidence: ['low', 'medium', 'high'].includes(out.confidence) ? out.confidence : 'low',
      notes: String(out.notes || '').slice(0, 600),
    }, cors);
  } catch (e) {
    return upstreamError(e, cors);
  }
}

export async function handleApi(request, env, opts) {
  const { pathname } = new URL(request.url);
  if (pathname === '/api/chat') return handleChat(request, env, opts);
  if (pathname === '/api/bodyfat') return handleBodyFat(request, env, opts);
  if (pathname === '/api/health') return json(200, { ok: true, configured: !!env.ANTHROPIC_API_KEY });
  return json(404, { error: 'not_found' });
}
