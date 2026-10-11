// Engine chain: many free AI providers behind one call, Anthropic as the paid
// one. Works on Cloudflare Workers and on Node (plain fetch, no SDK).
//
// Which engines may do which task (see POLICY):
//   chat       every engine. Free ones first, in rotation; Anthropic last.
//   mealphoto  free engines that can see images. Never Anthropic (saves credits).
//   bodyfat    Anthropic only. Handled in api.js, not here.
// ENGINES_CHAT / ENGINES_MEALPHOTO (comma-separated engine ids) restrict a task.
//
// One key per provider. Opening several accounts at one provider to get around
// its limit breaks that provider's terms, and can get every key blocked.
//
// A provider that answers 429 / 402 rests for a few minutes and the request
// moves on. State is per Worker instance (like the rate limiter in api.js):
// good enough to spread load, not a global quota counter.

const REST_MS = { quota: 5 * 60 * 1000, auth: 30 * 60 * 1000, down: 60 * 1000 };
const TIMEOUT_MS = { text: 40_000, image: 60_000 };

// Free OpenAI-compatible providers, best-quality first. Every model can be
// overridden with <ENV>_MODEL / <ENV>_VISION_MODEL, because free-tier model
// lists change often; vision: null means the provider is text-only here.
export const VENDORS = [
  { id: 'google', env: 'GOOGLE_API_KEY', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-3.6-flash', vision: 'gemini-3.6-flash' },
  { id: 'mistral', env: 'MISTRAL_API_KEY', url: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-small-latest', vision: 'mistral-small-latest' },
  { id: 'github', env: 'GITHUB_MODELS_TOKEN', url: 'https://models.github.ai/inference/chat/completions', model: 'openai/gpt-4.1-mini', vision: 'openai/gpt-4.1-mini' },
  { id: 'groq', env: 'GROQ_API_KEY', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', vision: 'meta-llama/llama-4-scout-17b-16e-instruct' },
  { id: 'nvidia', env: 'NVIDIA_API_KEY', url: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'meta/llama-3.3-70b-instruct', vision: 'meta/llama-3.2-90b-vision-instruct' },
  { id: 'cerebras', env: 'CEREBRAS_API_KEY', url: 'https://api.cerebras.ai/v1/chat/completions', model: 'gpt-oss-120b', vision: null },
  { id: 'openrouter', env: 'OPENROUTER_API_KEY', url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-oss-20b:free', vision: 'google/gemma-3-27b-it:free' },
  { id: 'xai', env: 'XAI_API_KEY', url: 'https://api.x.ai/v1/chat/completions', model: 'grok-4.5', vision: 'grok-4.5' },
];

const POLICY = {
  chat: { free: true, anthropic: true, image: false },
  mealphoto: { free: true, anthropic: false, image: true },
};

const rest = new Map(); // engine id -> time it may be tried again
const turn = {}; // task -> rotation counter

export class EngineError extends Error {
  constructor(status, code, detail = '') {
    super(`${code}${detail ? `: ${detail}` : ''}`);
    this.status = status;
    this.code = code;
  }
}

// ---- which engines exist ----

export function engineList(env) {
  const out = [];
  for (const v of VENDORS) {
    const key = String(env[v.env] || '').trim();
    if (!key) continue;
    out.push({
      id: v.id, kind: 'openai', free: true, key, url: env[`${v.env.replace(/_API_KEY|_TOKEN/, '')}_API_URL`] || v.url,
      model: env[`${v.id.toUpperCase()}_MODEL`] || v.model,
      visionModel: v.vision ? (env[`${v.id.toUpperCase()}_VISION_MODEL`] || v.vision) : null,
    });
  }
  // Cloudflare's own free models, through the Workers AI binding (no key, a
  // small daily allowance). Text only, and last among the free ones.
  if (env.AI && typeof env.AI.run === 'function') {
    out.push({ id: 'workers-ai', kind: 'workers-ai', free: true, model: env.WORKERS_AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast', visionModel: null });
  }
  if (env.ANTHROPIC_API_KEY) out.push({ id: 'anthropic', kind: 'anthropic', free: false, model: env.CLAUDE_MODEL || 'claude-opus-5-5', visionModel: 'claude-opus-5-5' });
  return out;
}

function allowedFor(env, task, spec) {
  const p = POLICY[task];
  if (!p) return [];
  const only = String(env[`ENGINES_${task.toUpperCase()}`] || '').split(',').map((s) => s.trim()).filter(Boolean);
  const anthropicOk = p.anthropic || (task === 'mealphoto' && String(env.MEALPHOTO_ALLOW_ANTHROPIC || '') === '1');
  let list = engineList(env).filter((e) => (e.kind === 'anthropic' ? anthropicOk : p.free));
  if (spec.image || p.image) list = list.filter((e) => e.visionModel);
  if (spec.json) list = list.filter((e) => e.kind !== 'workers-ai'); // too unreliable for structured output
  if (only.length) {
    list = only.map((id) => list.find((e) => e.id === id)).filter(Boolean);
  }
  return list;
}

// Is there anything that may serve this task? (Used by the front door.)
export function hasEngine(env, task, spec = {}) {
  return allowedFor(env, task, spec).length > 0;
}

// The order to try for this request: free engines rotate so their allowances
// are used evenly; engines that are resting go last; Anthropic is always last.
function ordered(env, task, spec) {
  const list = allowedFor(env, task, spec);
  const only = String(env[`ENGINES_${task.toUpperCase()}`] || '').trim();
  const free = list.filter((e) => e.kind !== 'anthropic');
  const paid = list.filter((e) => e.kind === 'anthropic');
  let rotated = free;
  if (!only && free.length > 1) {
    const at = (turn[task] = (turn[task] || 0) + 1) % free.length;
    rotated = free.slice(at).concat(free.slice(0, at));
  }
  const now = Date.now();
  const awake = (e) => (rest.get(e.id) || 0) <= now;
  return rotated.filter(awake).concat(paid.filter(awake), rotated.filter((e) => !awake(e)), paid.filter((e) => !awake(e)));
}

// ---- parsing and checking structured output ----

export function extractJson(text) {
  let s = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

// Just enough JSON-Schema (type, required, enum, properties, items) to reject
// an answer that is the wrong shape; the handlers still clamp every value.
export function matchesSchema(v, schema) {
  if (!schema) return true;
  if (schema.enum && !schema.enum.includes(v)) return false;
  switch (schema.type) {
    case 'object':
      if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
      for (const k of schema.required || []) if (!(k in v)) return false;
      for (const [k, sub] of Object.entries(schema.properties || {})) if (k in v && !matchesSchema(v[k], sub)) return false;
      return true;
    case 'array': return Array.isArray(v) && v.every((x) => matchesSchema(x, schema.items));
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'boolean': return typeof v === 'boolean';
    default: return true;
  }
}

// ---- one call ----

function openAIMessages(spec, engine) {
  const sys = spec.json && spec.schema
    ? `${spec.system}\n\nReply with ONE JSON object only, no prose and no code fences, matching this JSON Schema exactly:\n${JSON.stringify(spec.schema)}`
    : spec.system;
  const messages = [{ role: 'system', content: sys }];
  spec.messages.forEach((m, i) => {
    const last = i === spec.messages.length - 1;
    if (last && spec.image && m.role === 'user') {
      messages.push({ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${spec.image}` } },
        { type: 'text', text: m.content },
      ] });
    } else messages.push({ role: m.role, content: m.content });
  });
  return messages;
}

async function viaOpenAI(engine, spec, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  const send = async (withFormat) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), spec.image ? TIMEOUT_MS.image : TIMEOUT_MS.text);
    try {
      return await doFetch(engine.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${engine.key}` },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: spec.image ? engine.visionModel : engine.model,
          messages: openAIMessages(spec, engine),
          max_tokens: spec.maxTokens || 3000,
          ...(spec.json ? { temperature: 0.2 } : {}),
          ...(withFormat ? { response_format: { type: 'json_object' } } : {}),
        }),
      });
    } finally {
      clearTimeout(timer);
    }
  };
  let res = await send(!!spec.json);
  // Some providers don't take response_format: ask again without it.
  if (res.status === 400 && spec.json) res = await send(false);
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new EngineError(res.status, `http_${res.status}`, detail);
  }
  const data = await res.json().catch(() => null);
  const choice = data && data.choices && data.choices[0];
  const content = choice && choice.message && choice.message.content;
  const text = Array.isArray(content) ? content.map((p) => p.text || '').join('') : String(content || '');
  if (!text.trim()) throw new EngineError(502, 'empty_reply');
  if (choice.finish_reason === 'content_filter') throw new EngineError(502, 'filtered');
  return { text: text.trim(), truncated: choice.finish_reason === 'length' };
}

async function viaWorkersAI(engine, spec, env) {
  const out = await env.AI.run(engine.model, {
    messages: [{ role: 'system', content: spec.system }, ...spec.messages],
    max_tokens: Math.min(spec.maxTokens || 2048, 4096),
  });
  const text = String((out && (out.response || out.result)) || '').trim();
  if (!text) throw new EngineError(502, 'empty_reply');
  return { text, truncated: false };
}

function restFor(e) {
  const s = e.status;
  if (s === 429 || s === 402) return REST_MS.quota;
  if (s === 401 || s === 403) return REST_MS.auth;
  if (s === 413 || s === 400 || s === 404) return 0; // this request didn't fit; the provider is fine
  return REST_MS.down; // 5xx, timeouts, network
}

// task: 'chat' | 'mealphoto'. spec: { system, messages: [{role, content}],
//   image?: base64 JPEG, json?: bool, schema?, maxTokens?, anthropic?: async () => result }.
// Returns { text, engine, truncated?, refusal? }; throws the last error when
// every allowed engine failed.
export async function complete(env, task, spec, { fetchImpl } = {}) {
  const chain = ordered(env, task, spec);
  if (!chain.length) throw new EngineError(503, 'not_configured');
  let last = null;
  for (const engine of chain) {
    try {
      let r;
      if (engine.kind === 'anthropic') {
        if (!spec.anthropic) continue;
        r = await spec.anthropic();
      } else if (engine.kind === 'workers-ai') {
        r = await viaWorkersAI(engine, spec, env);
      } else {
        r = await viaOpenAI(engine, spec, fetchImpl);
      }
      if (spec.json && engine.kind !== 'anthropic' && !r.refusal) {
        const parsed = extractJson(r.text);
        if (!parsed || !matchesSchema(parsed, spec.schema)) throw new EngineError(502, 'bad_output');
        r.text = JSON.stringify(parsed);
      }
      rest.delete(engine.id);
      return { ...r, engine: engine.id };
    } catch (e) {
      last = e;
      // A wrong-shaped, empty or filtered answer says nothing about the provider's quota.
      const ms = ['bad_output', 'empty_reply', 'filtered'].includes(e.code) ? 0 : restFor({ status: e.status || (e.name === 'AbortError' ? 504 : 502) });
      if (ms) rest.set(engine.id, Date.now() + ms);
      if (e.code !== 'bad_output') console.warn(`engine ${engine.id} failed:`, e.status || e.name, String(e.message).slice(0, 120));
    }
  }
  throw last;
}

export const __test = {
  reset() { rest.clear(); for (const k of Object.keys(turn)) delete turn[k]; },
  resting: () => [...rest.keys()],
  ordered: (env, task, spec = {}) => ordered(env, task, spec).map((e) => e.id),
};
